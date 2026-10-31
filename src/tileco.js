// tileco's core: it reads Chrome's windows and displays, applies an operation
// to the workspace state, and makes the screen match (SPEC.md §5, §6).
// `api` is `chrome` in the extension and a fake in the tests; only its
// promise-returning calls are used.

import { DEFAULT_APPS } from "./apps.js";
import { DEFAULT_SETTINGS, load as loadSettings } from "./settings.js";
import { overlay } from "./dim.js";
import { toggle as toggleKeepAwake } from "./keepawake.js";
import { matchWindows, windowUrls } from "./restart.js";
import * as geometry from "./geometry.js";
import { unreadCount } from "./unread.js";
import * as ws from "./workspaces.js";

// Window types tileco manages. Popups and devtools float untracked (§5.4),
// except the app popups tileco opens itself (§9.1) and Secure Shell's.
const MANAGED = ["normal", "app"];
const TILED_POPUP_ORIGINS = [
  // Secure Shell opens its terminals as popup windows (§6.4).
  "chrome-extension://iodihamcpbpeioajjeobimgagajmlibd/",
];

// Whether tileco manages `w`. Always-on-top windows (Document
// picture-in-picture, always-on-top popups) refuse minimizing, so they're
// left alone on every workspace (§5.4), as is any window that refused once.
function managed(w, appPopups, refused) {
  if (w.alwaysOnTop || refused.has(w.id)) return false;
  if (MANAGED.includes(w.type) || appPopups.has(w.id)) return true;
  const url = w.tabs?.[0]?.url ?? "";
  return w.type === "popup" && TILED_POPUP_ORIGINS.some((o) => url.startsWith(o));
}
const STATE_KEY = "state";
const VIEW_KEY = "view";
// In storage.session, which a browser restart empties: whether this browser
// session has had a window yet.
const SEEN_KEY = "seenWindow";
export const DIM_ORIGINS = ["<all_urls>"];
const BADGE = "#3584e4";
const BADGE_ATTENTION = "#e5a50a";

function area(display) {
  const a = display.workArea;
  return { x: a.left, y: a.top, w: a.width, h: a.height };
}

// The display holding a window's center, else the first.
export function displayFor(win, displays) {
  const cx = win.left + win.width / 2;
  const cy = win.top + win.height / 2;
  const hit = displays.find((d) => {
    const b = d.bounds;
    return cx >= b.left && cx < b.left + b.width && cy >= b.top && cy < b.top + b.height;
  });
  return (hit || displays[0]).id;
}

export class Tileco {
  constructor(api) {
    this.apps = DEFAULT_APPS;
    this.api = api;
    this.settings = DEFAULT_SETTINGS;
    this.state = null;
    this.displays = [];
    this.windows = new Map();
    this.queue = Promise.resolve();
  }

  // Run one step at a time: events arrive faster than Chrome answers, and
  // each step reads what the one before it did.
  run(step) {
    const done = this.queue.then(step);
    this.queue = done.catch((e) => console.error("tileco:", e));
    return done;
  }

  // Something changed outside tileco: a window opened, closed, moved or took
  // focus, or a display came or went.
  event() {
    return this.run(async () => {
      await this.sync();
      await this.apply();
    });
  }

  // A watched page's title changed (§10.3): a rising unread count marks its
  // window, unless you're already in it. A page's first report only sets the
  // baseline, so loading one with old unread mail marks nothing, even in a
  // tab that showed fewer before.
  title(tabId, windowId, title, first = false) {
    return this.run(async () => {
      await this.sync();
      const s = this.state;
      const count = unreadCount(title);
      const before = first ? Infinity : (s.unread[tabId]?.count ?? Infinity);
      s.unread[tabId] = { windowId, count };
      const w = this.windows.get(windowId);
      if (count > before && w && !w.focused) {
        s.marks = [...s.marks.filter((id) => id !== windowId), windowId];
        await this.api.windows.update(windowId, { drawAttention: true });
      }
      await this.apply();
    });
  }

  // The dim is on while tileco holds all-sites access (§10.1) and you haven't
  // turned it off. Turning it off comes here first, to undim every page
  // while tileco can still reach them, then gives the access back.
  setDim(on) {
    return this.run(async () => {
      await this.sync();
      this.state.dimPaused = !on;
      await this.apply();
    });
  }

  // A tab finished loading a page. Any overlay went with the old page, and
  // the new one may be reachable where the old wasn't (a new tab page
  // becoming a website), so forget the tab and look at the dim afresh.
  tabLoaded(tabId) {
    // With the dim off there's nothing to dim, so skip the sync, but the
    // window's URLs still changed, and a restart matches by them (§14.2).
    if (this.state && !this.dimOn()) return this.run(() => this.rememberUrls());
    return this.run(async () => {
      await this.sync();
      this.state.dimmed = (this.state.dimmed ?? []).filter((id) => id !== tabId);
      await this.apply();
    });
  }

  async rememberUrls() {
    this.tabsAllowed = await this.api.permissions.contains({ permissions: ["tabs"] });
    const all = await this.api.windows.getAll({ populate: true, windowTypes: [...MANAGED, "popup"] });
    for (const w of all) if (w.id in this.state.windows) this.state.windows[w.id].urls = this.urlsOf(w);
    await this.save();
  }

  // The tab addresses kept for a restart (§14.2), only with tab search
  // allowed: all-sites access for dimming, or a site's for unread counts,
  // shows Chrome's tabs' addresses too, but that's not the opt-in.
  urlsOf(w) {
    return this.tabsAllowed ? windowUrls(w) : [];
  }

  dimOn() {
    return this.dimGranted && !this.state.dimPaused;
  }

  command(name) {
    return this.run(async () => {
      await this.sync();
      // Pressing a key means the browser has finished restoring (§14.2).
      delete this.state.restoring;
      const focus = await this.perform(name);
      await this.apply(focus);
    });
  }

  async load() {
    if (this.state) return;
    const stored = await this.api.storage.local.get(STATE_KEY);
    this.state = stored[STATE_KEY] || null;
  }

  async save() {
    await this.api.storage.local.set({ [STATE_KEY]: this.state, [VIEW_KEY]: this.view() });
  }

  // What the popup and home window show: each display's workspace and
  // layout, and how many windows each workspace holds.
  view() {
    const s = this.state;
    const displays = {};
    for (const d of this.displays) {
      const n = ws.showing(s, d.id);
      displays[d.id] = { workspace: n, mode: n === null ? null : this.modeOf(n, d) };
    }
    const counts = {};
    for (let n = 1; n <= ws.WORKSPACES; n++) counts[n] = s.workspaces[n].windows.length;
    const urgent = [...new Set(s.marks.map((id) => s.windows[id]?.ws).filter((n) => n !== undefined))];
    return { focusedDisplay: this.focusedDisplay() ?? null, displays, counts, urgent, dim: this.dimOn() };
  }

  // Bring the state up to date with Chrome: displays, new and closed
  // windows, and what you did to windows yourself since the last step.
  async sync() {
    await this.load();
    // The options page reports bad settings; here the defaults stand in.
    this.settings = (await loadSettings(this.api.storage)).settings;
    this.apps = this.settings.apps;
    this.displays = await this.api.system.display.getInfo();
    // Before matching windows after a restart, which reads their addresses.
    this.tabsAllowed = await this.api.permissions.contains({ permissions: ["tabs"] });
    const ids = this.displays.map((d) => d.id);
    // Every window type, so a focused popup or devtools window still says
    // which display you're on, but only managed ones are tracked.
    const all = await this.api.windows.getAll({ populate: true, windowTypes: [...MANAGED, "popup", "devtools"] });
    this.seenWindow ??= Boolean((await this.api.storage.session.get(SEEN_KEY))[SEEN_KEY]);
    // The state as the last step left the screen, before displays changed,
    // with windows renamed if the browser restarted.
    const { state: before, renamed, waiting } = this.restarted(this.state, all);
    if (all.length > 0 && !this.seenWindow) {
      await this.api.storage.session.set({ [SEEN_KEY]: true });
      this.seenWindow = true;
    }
    let s = before ? ws.setDisplays(before, ids) : ws.create(ids);
    // Workspaces from before this setting existed began with the defaults.
    const modes = { ...ws.DEFAULT_MODE_SETTINGS, ...this.settings.modes };
    if (JSON.stringify(s.modesFrom ?? ws.DEFAULT_MODE_SETTINGS) !== JSON.stringify(modes)) s = ws.setModes(s, modes);
    const appPopups = new Set((before?.appPopups ?? []).map(Number));
    const refused = new Set((before?.refused ?? []).filter((id) => all.some((w) => w.id === id)));
    const wins = all.filter((w) => managed(w, appPopups, refused));
    this.windows = new Map(wins.map((w) => [w.id, w]));
    this.all = new Map(all.map((w) => [w.id, w]));
    this.activeTab = new Map(all.map((w) => [w.id, w.tabs?.find((t) => t.active)?.id]));
    this.tabWindow = new Map(all.flatMap((w) => (w.tabs ?? []).map((t) => [t.id, w.id])));
    this.dimGranted = await this.api.permissions.contains({ origins: DIM_ORIGINS });
    for (const id of Object.keys(s.windows).map(Number)) {
      if (!this.windows.has(id)) s = ws.removeWindow(s, id);
    }
    const focusedDisplay = this.focusedDisplay();
    // After every step the screen matches the state, so a mismatch now is
    // something you did. Judge each window against the state the last step
    // left, before any display came or went and before this sync changed
    // anything, so neither a new display nor one restore that brings a
    // workspace makes other windows look minimized or restored.
    // A tiled window you resized, the first if there are several.
    let resized = null;
    for (const w of wins) {
      // Chrome restores a restarted window as it likes; tileco puts it back.
      if (renamed.has(w.id)) {
        if (w.focused) s = ws.focused(s, w.id);
        continue;
      }
      if (!(w.id in s.windows) || !before || !(w.id in before.windows)) {
        s = ws.addWindow(s, w.id, displayFor(w, this.displays));
        // A window already minimized when tileco first sees it stays so.
        if (w.state === "minimized") s = ws.userMinimized(s, w.id);
        if (w.focused) s = ws.focused(s, w.id);
        continue;
      }
      const minimized = w.state === "minimized";
      const shouldShow = ws.isShown(before, w.id);
      if (minimized && shouldShow) s = ws.userMinimized(s, w.id);
      else if (!minimized && !shouldShow) s = ws.userRestored(s, w.id, focusedDisplay);
      else if (!minimized && w.state === "normal") {
        // A window chromeOS moved off a display that's gone wasn't dragged;
        // its workspace just hides.
        const was = ws.displayOf(before, before.windows[w.id].ws);
        const d = displayFor(w, this.displays);
        if (was !== null && ids.includes(was) && was !== d) s = ws.movedToDisplay(s, w.id, d);
        else if (was === d) resized ??= this.resized(before, w, d);
      }
      if (w.focused) s = ws.focused(s, w.id);
    }
    if (resized) s = ws.setMfact(s, resized.n, resized.mode, resized.mfact);
    s.appPopups = [...appPopups].filter((id) => this.windows.has(id));
    s.refused = [...refused];
    if (Object.keys(waiting).length > 0) s.restoring = waiting;
    else delete s.restoring;
    // What a window is, should the browser restart and renumber it.
    for (const w of wins) {
      if (!(w.id in s.windows)) continue;
      s.windows[w.id].urls = this.urlsOf(w);
      s.windows[w.id].type = w.type;
    }
    // A mark clears when you go to its window, or it closes.
    s.marks = (before?.marks ?? []).filter((id) => this.windows.has(id) && !this.windows.get(id).focused);
    s.unread = Object.fromEntries(
      Object.entries(before?.unread ?? {}).filter(([, u]) => this.all.has(u.windowId)),
    );
    // The dashboard closes itself after a choice, or when you click away.
    if (before?.dashboard !== undefined && this.all.has(before.dashboard)) s.dashboard = before.dashboard;
    else delete s.dashboard;
    s.homes = {};
    for (const [d, id] of Object.entries(this.state?.homes ?? {})) {
      if (!this.all.has(id)) continue;
      if (ids.includes(d)) s.homes[d] = id;
      // chromeOS moves a gone display's home onto another, where nothing
      // would ever close it.
      else await this.api.windows.remove(id);
    }
    this.state = s;
  }

  // A browser restart gives every window a new ID, so none of the stored
  // ones exist any more; closing windows one by one never does that, since
  // each sync forgets the closed ones. Then each new window takes the place
  // of the old one it shares the most tab URLs with (§14.2). Chrome may
  // bring the windows back over several events, so the old ones nothing
  // matched yet wait in `restoring` for the next sync, until your first
  // command says the restore is over. Returns the state to judge this sync
  // by, the new IDs that were matched, and the old windows still waiting.
  restarted(stored, all) {
    const none = { state: stored, renamed: new Set(), waiting: {} };
    if (!stored) return none;
    const oldIds = Object.keys(stored.windows).map(Number);
    const present = (id) => all.some((w) => w.id === id);
    let state = stored;
    let candidates = all;
    let waiting;
    if (oldIds.length > 0 && !oldIds.some(present)) {
      // An app popup keeps saying so while it waits.
      const appPopups = new Set((stored.appPopups ?? []).map(Number));
      waiting = Object.fromEntries(
        Object.entries(stored.windows).map(([id, info]) => [id, { ...info, appPopup: appPopups.has(Number(id)) }]),
      );
    } else if (stored.restoring) {
      // Put the waiting windows back on their workspaces, and match only
      // windows tileco hasn't seen.
      state = structuredClone(stored);
      for (const [id, { appPopup, ...info }] of Object.entries(stored.restoring)) {
        state.windows[id] = info;
        state.workspaces[info.ws].windows.push(Number(id));
      }
      waiting = stored.restoring;
      candidates = all.filter((w) => !(w.id in stored.windows));
    } else {
      return none;
    }
    // Each kind of window only takes the place of its own kind, so a popup
    // tileco doesn't manage can't take a tab window's place.
    const renames = new Map();
    for (const type of new Set(Object.values(waiting).map((info) => info.type))) {
      const old = Object.fromEntries(
        Object.entries(waiting).filter(([, info]) => info.type === type).map(([id, info]) => [id, info.urls]),
      );
      const current = candidates.filter((w) => w.type === type).map((w) => ({ id: w.id, urls: this.urlsOf(w) }));
      for (const [from, to] of matchWindows(old, current)) renames.set(from, to);
    }
    // A window that matches nothing doesn't end the wait for the rest. No
    // window at all is the browser starting before Chrome restores any, or,
    // once this browser session has had one, you closing them all, when
    // nothing waits.
    if (renames.size === 0 && !stored.restoring && all.length === 0 && this.seenWindow) return none;
    state = ws.renameWindows(state, renames);
    state.appPopups = [
      ...(stored.appPopups ?? []).filter((id) => present(Number(id))),
      ...[...renames].filter(([from]) => waiting[from].appPopup).map(([, to]) => to),
    ];
    const left = Object.fromEntries(Object.entries(waiting).filter(([id]) => !renames.has(Number(id))));
    return { state, renamed: new Set(renames.values()), waiting: left };
  }

  // A drag on a tiled window's edge sets its workspace's main share (§5.3).
  // Its width changed since tileco placed it, on the same display, which has
  // the same work area: a work area that changed may have moved it, and a
  // drag of the whole window keeps the width. Returns {n, mode, mfact}, or
  // null if this wasn't such a drag or the share doesn't move that edge.
  resized(before, w, display) {
    const info = before.windows[w.id];
    const p = info.placed;
    if (!p || info.floating || w.width === p.width) return null;
    const n = ws.showing(before, display);
    const d = this.displays.find((x) => x.id === display);
    if (n === null || info.ws !== n || !d || JSON.stringify(area(d)) !== JSON.stringify(p.area)) return null;
    const edge = w.left !== p.left ? "left" : "right";
    const x = edge === "left" ? w.left : w.left + w.width;
    const mfact = geometry.mfactFor(p.mode, p.area, p.count, before.workspaces[n].modes[p.mode], this.settings.singleRules, p.index, edge, x);
    return mfact === null ? null : { n, mode: p.mode, mfact };
  }

  // The display of the focused window, any type: a home window or a popup
  // counts, so keys pressed there act on its display.
  focusedDisplay() {
    const f = [...(this.all?.values() ?? [])].find((w) => w.focused && w.state !== "minimized");
    return f ? displayFor(f, this.displays) : this.displays[0]?.id;
  }

  focusedWindow() {
    for (const w of this.windows.values()) if (w.focused) return w.id;
    return null;
  }

  modeOf(n, display) {
    return this.state.workspaces[n].layout ?? this.defaultModeOf(display);
  }

  defaultModeOf(display) {
    const a = display.workArea;
    return this.settings.defaultMode[a.width / a.height >= this.settings.ultrawideAspect ? "ultrawide" : "normal"];
  }

  // A floating window keeps its size and its place relative to its display,
  // but moves with its workspace when that shows on another display, so
  // every shown window is on its workspace's display and the next sync
  // doesn't read the difference as a drag.
  async placeFloating(update) {
    const s = this.state;
    for (const [key, info] of Object.entries(s.windows)) {
      const id = Number(key);
      const w = this.windows.get(id);
      if (!info.floating || !w || w.state !== "normal" || !ws.isShown(s, id)) continue;
      const target = this.displays.find((d) => d.id === ws.displayOf(s, info.ws));
      const source = this.displays.find((d) => d.id === displayFor(w, this.displays));
      if (!target || !source || target.id === source.id) continue;
      const t = target.workArea;
      const from = source.workArea;
      const width = Math.min(w.width, t.width);
      const height = Math.min(w.height, t.height);
      const left = Math.min(Math.max(t.left + (w.left - from.left), t.left), t.left + t.width - width);
      const top = Math.min(Math.max(t.top + (w.top - from.top), t.top), t.top + t.height - height);
      await update(id, { left, top, width, height });
    }
  }

  // Apply a command to the state. Returns the window to focus, if any.
  async perform(name) {
    const s = this.state;
    const display = this.focusedDisplay();
    const n = ws.showing(s, display);
    // With the dashboard or another untracked window in front, a command acts
    // on the window you were last in on this workspace.
    const remembered = n === null ? null : s.workspaces[n].focused;
    const win = this.focusedWindow() ?? (remembered !== null && ws.isShown(s, remembered) ? remembered : null);
    const tracked = win !== null && win in s.windows;
    const step = (k) => ((((n ?? 1) - 1 + k) % ws.WORKSPACES) + ws.WORKSPACES) % ws.WORKSPACES + 1;
    const disp = this.displays.find((d) => d.id === display);
    const mode = n === null || !disp ? null : this.modeOf(n, disp);

    let m;
    if ((m = name.match(/^workspace-([1-9])$/))) return this.showWorkspace(display, Number(m[1]));
    if (name === "workspace-next") return this.showWorkspace(display, step(1));
    if (name === "workspace-prev") return this.showWorkspace(display, step(-1));
    if (name === "popup") return this.dashboard(display);
    if (name === "app-browser") return this.browser(display);
    if (name === "attention") return this.attention(display);
    if (name === "keep-awake") {
      await toggleKeepAwake(this.api);
      return null;
    }
    const app = this.apps.find((a) => a.command === name);
    if (app) return this.app(app, display);
    if (!tracked && name !== "layout-next" && name !== "layout-prev") return null;

    if ((m = name.match(/^send-([1-9])$/))) this.state = ws.send(s, win, Number(m[1]));
    else if (name === "send-next") this.state = ws.send(s, win, step(1));
    else if (name === "send-prev") this.state = ws.send(s, win, step(-1));
    else if (name === "focus-next") return ws.neighbor(s, win, 1);
    else if (name === "focus-prev") return ws.neighbor(s, win, -1);
    else if (name === "move-next") this.state = ws.moveInStack(s, win, 1);
    else if (name === "move-prev") this.state = ws.moveInStack(s, win, -1);
    else if (name === "swap-master") this.state = ws.swapMaster(s, win);
    else if (name === "float") this.state = ws.toggleFloating(s, win);
    else if (n === null || mode === null) return null;
    else if (name === "grow") this.state = ws.adjust(s, n, mode, { mfact: 0.025 });
    else if (name === "shrink") this.state = ws.adjust(s, n, mode, { mfact: -0.025 });
    else if (name === "master-add") this.state = ws.adjust(s, n, mode, { nmaster: 1 });
    else if (name === "master-remove") this.state = ws.adjust(s, n, mode, { nmaster: -1 });
    else if (name === "monocle") this.state = ws.toggleMonocle(s, n, mode, this.defaultModeOf(disp));
    else if (name === "layout-next" || name === "layout-prev") {
      const i = geometry.modes.indexOf(mode);
      const k = name === "layout-next" ? 1 : -1;
      this.state = ws.setLayout(s, n, geometry.modes[(i + k + geometry.modes.length) % geometry.modes.length]);
    }
    return null;
  }

  // Dim every shown window but the focused one, on workspaces showing more
  // than one (§10.1). A hidden window keeps its overlay until it's back.
  async dim(focused) {
    const s = this.state;
    s.dimmed ??= [];
    const want = new Set();
    const shown = new Set();
    for (const display of this.displays) {
      const n = ws.showing(s, display.id);
      if (n === null) continue;
      const ids = s.workspaces[n].windows.filter((id) => ws.isShown(s, id));
      for (const id of ids) shown.add(id);
      if (!this.dimOn() || ids.length < 2) continue;
      for (const id of ids) {
        // Fullscreen is for watching; leave it be.
        if (id !== focused && this.windows.get(id)?.state !== "fullscreen") want.add(this.activeTab.get(id));
      }
    }
    want.delete(undefined);
    const strength = this.settings.dimStrength;
    // A new strength repaints every overlay showing, not just new ones.
    const repaint = s.dimStrength !== undefined && s.dimStrength !== strength;
    s.dimStrength = strength;
    const dimmed = new Set(s.dimmed);
    const set = async (tabId, on) => {
      try {
        await this.api.scripting.executeScript({ target: { tabId }, func: overlay, args: [on, strength] });
        return true;
      } catch {
        // chrome:// pages, the Web Store and the PDF viewer can't be
        // injected, and a closing tab has gone: those just stay undimmed.
        return false;
      }
    };
    for (const tabId of want) if ((repaint || !dimmed.has(tabId)) && (await set(tabId, true))) dimmed.add(tabId);
    for (const tabId of dimmed) {
      if (want.has(tabId)) continue;
      const win = this.tabWindow.get(tabId);
      // Leave a hidden window's overlay for when it comes back; a window tileco
      // stopped managing never will, so it's undimmed.
      if (this.dimOn() && win in s.windows && !shown.has(win)) continue;
      if (win !== undefined) await set(tabId, false);
      dimmed.delete(tabId);
    }
    // Overlays kept on hidden windows take the new strength too, for when
    // they're back.
    if (repaint) for (const tabId of dimmed) if (!want.has(tabId) && this.tabWindow.has(tabId)) await set(tabId, true);
    s.dimmed = [...dimmed];
  }

  // The toolbar badge shows the focused display's workspace (§8.1).
  async badge() {
    const n = ws.showing(this.state, this.focusedDisplay());
    await this.api.action?.setBadgeText({ text: n === null ? "" : String(n) });
    // Amber while another workspace holds a marked window (§8.1).
    const elsewhere = this.state.marks.some((id) => this.state.windows[id] && this.state.windows[id].ws !== n);
    await this.api.action?.setBadgeBackgroundColor({ color: elsewhere ? BADGE_ATTENTION : BADGE });
  }

  // The launcher page full screen on `display` (§6.2, §8.1): opened on that
  // display first, since Chrome won't take a position and a full-screen
  // state in one call.
  async fullscreen(mode, display, focused) {
    const b = display.bounds;
    const w = await this.api.windows.create({
      url: this.api.runtime.getURL(`src/launcher.html?mode=${mode}`),
      type: "popup",
      focused,
      left: b.left,
      top: b.top,
      width: b.width,
      height: b.height,
    });
    await this.api.windows.update(w.id, { state: "fullscreen" });
    return w;
  }

  // The dashboard, from its key or the toolbar button: the launcher full
  // screen over the focused display. The key again closes it (§8.1).
  async dashboard(display) {
    const s = this.state;
    if (s.dashboard !== undefined) {
      const id = s.dashboard;
      delete s.dashboard;
      await this.api.windows.remove(id);
      return null;
    }
    const d = this.displays.find((x) => x.id === display) ?? this.displays[0];
    s.dashboard = (await this.fullscreen("dashboard", d, true)).id;
    return null;
  }

  // A tab chosen in the launcher: its tab comes forward, and its window with
  // its workspace (§6.1 Activate).
  activateTab(tabId, windowId) {
    return this.run(async () => {
      await this.sync();
      await this.api.tabs.update(tabId, { active: true });
      const focus = windowId in this.state.windows ? this.activate(windowId, this.focusedDisplay()) : windowId;
      await this.apply(focus);
    });
  }

  // Search+Tab (§10.3): the most recent mark, so pressing again goes to the
  // next; with none, the last window you were in.
  attention(display) {
    const s = this.state;
    if (s.marks.length > 0) return this.activate(s.marks.pop(), display);
    const current = this.focusedWindow();
    let last = null;
    for (const [key, info] of Object.entries(s.windows)) {
      const id = Number(key);
      if (id === current || !info.lastFocused) continue;
      if (last === null || info.lastFocused > s.windows[last].lastFocused) last = id;
    }
    return last === null ? null : this.activate(last, display);
  }

  // Bring up a window, with its workspace (§6.1 Activate).
  activate(id, display) {
    this.state = ws.activate(this.state, id, display);
    return id;
  }

  async open(props, display) {
    const w = await this.api.windows.create({ focused: true, ...props });
    this.windows.set(w.id, w);
    this.state = ws.addWindow(this.state, w.id, display);
    return w;
  }

  // The browser key: always a new browser window on this workspace, as
  // tide's and KDE's keys launch one (§9.1).
  async browser(display) {
    return (await this.open({}, display)).id;
  }

  // A web app key: always a new window on this workspace, never one already
  // open, as tide's and KDE's keys launch the app (§9.1). Installed web apps
  // open their own windows, but there's no public way to launch one by
  // origin, so tileco opens the site in an app-like popup and tiles it as the
  // app's.
  async app(app, display) {
    const w = await this.open({ url: app.url, type: "popup" }, display);
    this.state.appPopups.push(w.id);
    return w.id;
  }

  // An empty workspace gets a home window, so tileco's keys still have a
  // Chrome window to work in (§6.2). It isn't tiled or counted, and closes
  // when a window arrives. One you close stays closed until the display
  // shows another empty workspace.
  async homes(focus) {
    const s = this.state;
    s.homeShownFor ??= {};
    const target = this.switchedTo ?? this.focusedDisplay();
    for (const display of this.displays) {
      const n = ws.showing(s, display.id);
      const empty = n !== null && !s.workspaces[n].windows.some((id) => ws.isShown(s, id));
      const home = s.homes[display.id];
      // Only one display's home may take focus: the one you switched, else
      // the one you're on.
      const wantFocus = focus === null && display.id === target;
      if (!empty) delete s.homeShownFor[display.id];
      if (empty && home === undefined && s.homeShownFor[display.id] !== n) {
        s.homeShownFor[display.id] = n;
        const w = await this.fullscreen("home", display, wantFocus);
        s.homes[display.id] = w.id;
      } else if (!empty && home !== undefined) {
        delete s.homes[display.id];
        await this.api.windows.remove(home);
      } else if (empty && home !== undefined) {
        s.homeShownFor[display.id] = n;
        if (wantFocus && this.switchedTo !== undefined) await this.api.windows.update(home, { focused: true });
      }
    }
    this.switchedTo = undefined;
  }

  showWorkspace(display, n) {
    if (display === undefined) return null;
    this.switchedTo = display;
    this.state = ws.show(this.state, display, n);
    const w = this.state.workspaces[n];
    // The remembered window, unless you've minimized it since.
    const remembered = w.focused !== null && ws.isShown(this.state, w.focused) ? w.focused : null;
    return remembered ?? ws.tiled(this.state, display)[0] ?? null;
  }

  // Make the screen match the state, then save it.
  async apply(focus = null) {
    const s = this.state;
    const minimizedNow = new Set([...this.windows.values()].filter((w) => w.state === "minimized").map((w) => w.id));
    const { restore, minimize } = ws.plan(s, minimizedNow);
    // Keep the snapshot current with what each update returns, so every
    // later step in this apply sees a restored window as restored.
    const update = async (id, props) => {
      const w = await this.api.windows.update(id, props);
      if (w && this.windows.has(id)) this.windows.set(id, w);
      return w;
    };
    // A window that refuses to hide (a locked full-screen one, say) can't
    // follow a workspace, so tileco stops managing it rather than stop the
    // switch, or read it still showing as your doing next time (§5.4).
    const refusedNow = [];
    const setState = async (id, state) => {
      try {
        await update(id, { state });
      } catch (e) {
        console.warn(`tileco: window ${id} refused to be ${state}; leaving it alone:`, e?.message ?? e);
        refusedNow.push(id);
      }
    };
    for (const id of restore) await setState(id, "normal");
    for (const id of minimize) await setState(id, "minimized");
    for (const id of refusedNow) {
      this.state = ws.removeWindow(this.state, id);
      this.windows.delete(id);
      this.state.refused = [...new Set([...(this.state.refused ?? []), id])];
    }

    // Only windows tiled now have a placement to judge a resize by; one
    // that's floating, hidden or maximized gets a new one when it tiles.
    for (const info of Object.values(this.state.windows)) delete info.placed;
    for (const display of this.displays) {
      const n = ws.showing(s, display.id);
      if (n === null) continue;
      // Maximized and fullscreen windows are left alone (§5.1).
      const ids = ws.tiled(s, display.id).filter((id) => this.windows.get(id)?.state === "normal");
      const mode = this.modeOf(n, display);
      const boxes = geometry.arrange(mode, area(display), ids.length, s.workspaces[n].modes[mode], this.settings.singleRules);
      await Promise.all(ids.map(async (id, i) => {
        const b = boxes[i];
        const w = await update(id, { left: b.x, top: b.y, width: b.w, height: b.h });
        // Where it ended up, which a minimum size can make differ from the
        // box, so that only your own resize reads as one.
        const info = this.state.windows[id];
        if (info) info.placed = { left: w?.left ?? b.x, width: w?.width ?? b.w, area: area(display), mode, index: i, count: ids.length };
      }));
    }
    await this.placeFloating(update);
    if (focus !== null) {
      await update(focus, { focused: true });
      this.state = ws.focused(this.state, focus);
    }
    await this.homes(focus);
    await this.dim(focus ?? this.focusedWindow());
    await this.badge();
    await this.save();
  }
}
