// Tests for tileco.js against a fake chrome.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Tileco } from "./tileco.js";
import { FakeChrome, HD, UW } from "./fake_chrome.js";

const HOME = "chrome-extension://tileco/src/launcher.html?mode=home";
const DASHBOARD = "chrome-extension://tileco/src/launcher.html?mode=dashboard";
const homes = (chrome) => chrome.wins.filter((w) => w.url === HOME);
// The windows tileco opened, other than home windows.
const opened = (chrome) => chrome.created.filter((c) => c.url !== HOME && c.url !== DASHBOARD).map(({ id, ...c }) => c);

function on(display, id, extra = {}) {
  const a = display.workArea;
  return { id, left: a.left + 10 * id, top: a.top + 10, width: 400, height: 300, ...extra };
}

// Float window `id` with Search+Shift+F, then drag it to (x, y) at 400x300.
async function floatAt(chrome, tileco, id, x, y) {
  chrome.focus(id);
  await tileco.event();
  await tileco.command("float");
  Object.assign(chrome.win(id), { left: x, top: y, width: 400, height: 300 });
  await tileco.event();
}

async function setup(displays, windows) {
  const chrome = new FakeChrome({ displays, windows });
  const tileco = new Tileco(chrome);
  await tileco.event();
  return { chrome, tileco };
}

test("two windows on a 16:9 display tile master and stack", async () => {
  const { chrome } = await setup([HD], [on(HD, 1, { focused: true }), on(HD, 2)]);
  assert.deepEqual(chrome.box(1), { x: 0, y: 0, w: 1056, h: 1032 });
  assert.deepEqual(chrome.box(2), { x: 1056, y: 0, w: 864, h: 1032 });
});

test("a lone window on an ultrawide is centered at 80%", async () => {
  const { chrome } = await setup([UW], [on(UW, 1)]);
  assert.deepEqual(chrome.box(1), { x: 1920 + 344, y: 0, w: 2752, h: 1392 });
});

test("an ultrawide starts in three columns", async () => {
  const { chrome } = await setup([UW], [on(UW, 1), on(UW, 2), on(UW, 3)]);
  assert.equal(chrome.box(1).x, 1920 + 860, "master in the middle");
});

test("this Chromebook's layouts come from its own settings", async () => {
  const { chrome, tileco } = await setup([UW], [on(UW, 1, { focused: true })]);
  chrome.store.settings = { singleRules: [{ minAspect: 2, width: 0.5 }], ultrawideAspect: 3 };
  await tileco.event();
  assert.deepEqual(chrome.box(1), { x: 1920 + 860, y: 0, w: 1720, h: 1392 }, "half the width");
  chrome.open(on(UW, 2));
  chrome.open(on(UW, 3));
  await tileco.event();
  assert.equal(chrome.box(1).x, 1920, "2.47 is under 3, so it tiles rather than three columns");
});

test("the layout settings reach every workspace, once", async () => {
  const { chrome, tileco } = await setup([HD], [on(HD, 1, { focused: true }), on(HD, 2)]);
  assert.equal(chrome.box(1).w, 1056, "tile's main window starts at 55%");
  chrome.syncStore.settings = { modes: { tile: { mfact: 0.6 } } };
  await tileco.event();
  assert.equal(chrome.box(1).w, 1152, "60% from the settings");
  await tileco.command("grow");
  assert.equal(chrome.box(1).w, 1200, "the keys still adjust it");
  await tileco.event();
  assert.equal(chrome.box(1).w, 1200, "and an unchanged setting doesn't undo them");
  chrome.syncStore.settings = { modes: { tile: { mfact: 0.5 } } };
  await tileco.event();
  assert.equal(chrome.box(1).w, 960, "a changed one does");
});

test("a new workspace starts in the layout the settings give its display", async () => {
  const { chrome, tileco } = await setup([HD], [on(HD, 1, { focused: true }), on(HD, 2)]);
  chrome.syncStore.settings = { defaultMode: { normal: "monocle" } };
  await tileco.event();
  assert.deepEqual(chrome.box(2), { x: 0, y: 0, w: 1920, h: 1032 }, "monocle fills the display");
  await tileco.command("monocle");
  assert.equal(chrome.box(1).w, 1056, "the monocle key leaves a monocle default for tile");
  await tileco.command("monocle");
  assert.equal(chrome.box(1).w, 1920, "and comes back");
});

test("switching workspaces minimizes the old windows and restores them on return", async () => {
  const { chrome, tileco } = await setup([HD], [on(HD, 1, { focused: true }), on(HD, 2)]);
  await tileco.command("workspace-2");
  assert.equal(chrome.win(1).state, "minimized");
  assert.equal(chrome.win(2).state, "minimized");
  chrome.open(on(HD, 9, { focused: true }));
  await tileco.event();
  assert.deepEqual(chrome.box(9), { x: 0, y: 0, w: 1920, h: 1032 }, "a new window joins workspace 2");
  await tileco.command("workspace-1");
  assert.equal(chrome.win(1).state, "normal");
  assert.equal(chrome.win(2).state, "normal");
  assert.equal(chrome.win(9).state, "minimized");
});

test("sending a window to a hidden workspace hides it and retiles the rest", async () => {
  const { chrome, tileco } = await setup([HD], [on(HD, 1, { focused: true }), on(HD, 2)]);
  await tileco.command("send-3");
  assert.equal(chrome.win(1).state, "minimized");
  assert.deepEqual(chrome.box(2), { x: 0, y: 0, w: 1920, h: 1032 });
});

test("a window you minimize stays minimized across a switch", async () => {
  const { chrome, tileco } = await setup([HD], [on(HD, 1, { focused: true }), on(HD, 2)]);
  chrome.win(2).state = "minimized";
  await tileco.event();
  assert.deepEqual(chrome.box(1), { x: 0, y: 0, w: 1920, h: 1032 }, "the rest retile");
  await tileco.command("workspace-2");
  await tileco.command("workspace-1");
  assert.equal(chrome.win(2).state, "minimized");
  assert.equal(chrome.win(1).state, "normal");
});

test("restoring a window from a hidden workspace brings its workspace", async () => {
  const { chrome, tileco } = await setup([HD], [on(HD, 1, { focused: true }), on(HD, 2)]);
  await tileco.command("send-4");
  // You pick window 1 from the shelf.
  chrome.win(1).state = "normal";
  chrome.focus(1);
  await tileco.event();
  assert.equal(tileco.state.displays.hd, 4);
  assert.equal(chrome.win(2).state, "minimized");
  assert.deepEqual(chrome.box(1), { x: 0, y: 0, w: 1920, h: 1032 });
});

test("dragging a window to the other display moves it to the workspace there", async () => {
  const { chrome, tileco } = await setup([HD, UW], [on(HD, 1, { focused: true }), on(HD, 2), on(UW, 3)]);
  Object.assign(chrome.win(2), { left: 3000, top: 100 });
  await tileco.event();
  assert.deepEqual(tileco.state.workspaces[2].windows, [3, 2]);
  assert.deepEqual(chrome.box(1), { x: 0, y: 0, w: 1920, h: 1032 });
  assert.equal(chrome.box(2).x >= 1920, true);
});

test("popups aren't tiled or hidden", async () => {
  const { chrome, tileco } = await setup([HD], [on(HD, 1, { focused: true }), on(HD, 2, { type: "popup" })]);
  const before = chrome.box(2);
  await tileco.command("workspace-2");
  assert.deepEqual(chrome.box(2), before);
  assert.equal(chrome.win(2).state, "normal");
});

test("an always-on-top window is left alone on every workspace", async () => {
  const { chrome, tileco } = await setup([HD], [on(HD, 1, { focused: true }), on(HD, 2, { alwaysOnTop: true })]);
  assert.deepEqual(chrome.box(1), { x: 0, y: 0, w: 1920, h: 1032 });
  assert.deepEqual(chrome.box(2), { x: 20, y: 10, w: 400, h: 300 });
  assert.equal(2 in tileco.state.windows, false);
  await tileco.command("workspace-2");
  assert.equal(chrome.win(2).state, "normal", "picture-in-picture refuses minimizing, so tileco never asks");
});

test("a window that refuses to minimize doesn't stop the switch", async () => {
  const { chrome, tileco } = await setup([HD], [on(HD, 1, { focused: true }), on(HD, 2), on(HD, 3)]);
  chrome.refuse.add(1);
  await tileco.command("workspace-2");
  assert.equal(chrome.win(1).state, "normal", "it refused");
  assert.equal(chrome.win(2).state, "minimized", "the others still hid");
  assert.equal(chrome.win(3).state, "minimized");
  assert.equal(1 in tileco.state.windows, false, "tileco leaves it alone from now on");
  await tileco.event();
  assert.equal(tileco.state.displays.hd, 2, "the next sync doesn't read it as a restore");
  assert.equal(chrome.win(2).state, "minimized");
});

test("a dimmed window that refuses to minimize is undimmed", async () => {
  const { chrome, tileco } = await setup([HD], [
    on(HD, 1, { focused: true, url: "https://example.com/" }),
    on(HD, 2, { url: "https://example.org/" }),
    on(HD, 3, { url: "https://example.net/" }),
  ]);
  chrome.granted = true;
  await tileco.setDim(true);
  assert.deepEqual([...chrome.dimmed].sort(), [20, 30]);
  chrome.refuse.add(2);
  await tileco.command("workspace-2");
  assert.equal(chrome.win(2).state, "normal", "it refused");
  assert.deepEqual([...chrome.dimmed], [30], "still showing, it isn't left dimmed");
  await tileco.event();
  assert.deepEqual([...chrome.dimmed], [30]);
});

test("Secure Shell's popup windows tile; other popups float", async () => {
  const { chrome, tileco } = await setup([HD], [
    on(HD, 1, { focused: true }),
    on(HD, 2, { type: "popup", url: "chrome-extension://iodihamcpbpeioajjeobimgagajmlibd/html/nassh.html" }),
    on(HD, 3, { type: "popup", url: "https://accounts.example.com/signin" }),
  ]);
  assert.deepEqual(tileco.state.workspaces[1].windows, [1, 2]);
  assert.deepEqual(chrome.box(2), { x: 1056, y: 0, w: 864, h: 1032 });
  assert.equal(3 in tileco.state.windows, false);
});

test("focus-next and swap-master follow the stack", async () => {
  const { chrome, tileco } = await setup([HD], [on(HD, 1, { focused: true }), on(HD, 2), on(HD, 3)]);
  await tileco.command("focus-next");
  assert.equal(chrome.win(2).focused, true);
  await tileco.command("swap-master");
  assert.deepEqual(tileco.state.workspaces[1].windows, [2, 1, 3]);
  assert.equal(chrome.box(2).x, 0, "window 2 is the master now");
});

test("monocle gives every window the area, and toggles back", async () => {
  const { chrome, tileco } = await setup([HD], [on(HD, 1, { focused: true }), on(HD, 2)]);
  await tileco.command("monocle");
  assert.deepEqual(chrome.box(1), chrome.box(2));
  await tileco.command("monocle");
  assert.equal(chrome.box(2).x, 1056);
});

test("grow widens the master by 0.025", async () => {
  const { chrome, tileco } = await setup([HD], [on(HD, 1, { focused: true }), on(HD, 2)]);
  await tileco.command("grow");
  assert.equal(chrome.box(1).w, Math.floor(1920 * 0.575 + 0.5));
});

test("state survives the worker stopping", async () => {
  const { chrome, tileco } = await setup([HD], [on(HD, 1, { focused: true }), on(HD, 2)]);
  await tileco.command("send-5");
  const fresh = new Tileco(chrome);
  await fresh.event();
  assert.equal(fresh.state.windows[1].ws, 5);
  assert.equal(chrome.win(1).state, "minimized");
});

test("a closed window leaves its workspace", async () => {
  const { chrome, tileco } = await setup([HD], [on(HD, 1, { focused: true }), on(HD, 2)]);
  chrome.wins = chrome.wins.filter((w) => w.id !== 2);
  await tileco.event();
  assert.deepEqual(tileco.state.workspaces[1].windows, [1]);
  assert.deepEqual(chrome.box(1), { x: 0, y: 0, w: 1920, h: 1032 });
});

test("maximized windows are left alone", async () => {
  const { chrome } = await setup([HD], [on(HD, 1, { state: "maximized" }), on(HD, 2)]);
  assert.deepEqual(chrome.box(2), { x: 0, y: 0, w: 1920, h: 1032 });
  assert.equal(chrome.win(1).width, 400);
});

test("a window already minimized when tileco starts stays minimized", async () => {
  const { chrome, tileco } = await setup([HD], [on(HD, 1, { focused: true }), on(HD, 2, { state: "minimized" })]);
  assert.equal(chrome.win(2).state, "minimized");
  assert.equal(tileco.state.windows[2].minimizedByYou, true);
  assert.deepEqual(chrome.box(1), { x: 0, y: 0, w: 1920, h: 1032 });
});

test("an ordinary event never focuses a window on another display", async () => {
  const { chrome, tileco } = await setup([HD, UW], [on(HD, 1, { focused: true }), on(HD, 2), on(UW, 3), on(UW, 4)]);
  await tileco.command("monocle");
  chrome.focus(3);
  chrome.updates.length = 0;
  await tileco.event();
  assert.equal(chrome.win(3).focused, true);
  assert.deepEqual(chrome.updates.filter((u) => u.focused), []);
});

test("returning to a workspace doesn't restore a window you minimized there", async () => {
  const { chrome, tileco } = await setup([HD], [on(HD, 1), on(HD, 2, { focused: true })]);
  chrome.win(2).state = "minimized";
  chrome.win(2).focused = false;
  await tileco.event();
  await tileco.command("workspace-3");
  await tileco.command("workspace-1");
  assert.equal(chrome.win(2).state, "minimized");
  assert.equal(chrome.win(1).focused, true);
});

test("a floating window moves with its workspace to the other display", async () => {
  const { chrome, tileco } = await setup([HD, UW], [on(HD, 1, { focused: true }), on(HD, 2), on(UW, 3)]);
  await floatAt(chrome, tileco, 2, 100, 50);
  chrome.focus(1);
  await tileco.event();
  await tileco.command("workspace-2");
  // The displays swapped, so workspace 1 and its floating window are on the ultrawide.
  assert.equal(tileco.state.displays.uw, 1);
  assert.deepEqual(chrome.box(2), { x: 1920 + 100, y: 50, w: 400, h: 300 });
  await tileco.event();
  assert.equal(tileco.state.windows[2].ws, 1, "the next sync doesn't read it as a drag");
});

test("connecting a display shows its workspace's windows", async () => {
  const { chrome, tileco } = await setup([HD], [on(HD, 1, { focused: true }), on(HD, 2)]);
  await tileco.command("send-2");
  assert.equal(chrome.win(1).state, "minimized");
  chrome.displaysList = [HD, UW];
  await tileco.event();
  assert.equal(tileco.state.displays.uw, 2);
  assert.equal(tileco.state.windows[1].minimizedByYou, false);
  assert.equal(chrome.win(1).state, "normal");
  assert.equal(chrome.box(1).x >= 1920, true, "on the new display");
});

test("disconnecting a display hides its workspace instead of moving it", async () => {
  const { chrome, tileco } = await setup([HD, UW], [on(HD, 1, { focused: true }), on(UW, 2)]);
  chrome.displaysList = [HD];
  // chromeOS moves the ultrawide's window onto the remaining display.
  Object.assign(chrome.win(2), { left: 100, top: 100 });
  await tileco.event();
  assert.equal(tileco.state.displays.hd, 1, "the remaining display keeps its workspace");
  assert.equal(tileco.state.windows[2].ws, 2);
  assert.equal(chrome.win(2).state, "minimized");
  assert.deepEqual(chrome.box(1), { x: 0, y: 0, w: 1920, h: 1032 });
});

test("a focused popup on the other display makes commands act there", async () => {
  const { chrome, tileco } = await setup([HD, UW], [on(HD, 1), on(UW, 2), on(UW, 3, { type: "popup", focused: true })]);
  await tileco.command("workspace-3");
  assert.equal(tileco.state.displays.uw, 3);
  assert.equal(tileco.state.displays.hd, 1);
});

test("a floating window on a hidden workspace comes up on the display that shows it", async () => {
  const { chrome, tileco } = await setup([HD, UW], [on(HD, 1, { focused: true }), on(HD, 2), on(UW, 3)]);
  await floatAt(chrome, tileco, 2, 100, 50);
  await tileco.command("send-4");
  assert.equal(chrome.win(2).state, "minimized");
  chrome.focus(3);
  await tileco.event();
  await tileco.command("workspace-4");
  assert.equal(tileco.state.displays.uw, 4);
  assert.equal(chrome.win(2).state, "normal");
  assert.deepEqual(chrome.box(2), { x: 1920 + 100, y: 50, w: 400, h: 300 });
  await tileco.event();
  assert.equal(tileco.state.windows[2].ws, 4, "the next sync leaves it on workspace 4");
});

test("an app key opens a new window even when the app has one", async () => {
  const { chrome, tileco } = await setup([HD], [
    on(HD, 1, { focused: true }),
    on(HD, 2, { type: "app", url: "https://calendar.google.com/calendar/u/0/r" }),
  ]);
  await tileco.command("send-3");
  chrome.focus(2);
  await tileco.event();
  await tileco.command("send-4");
  // The open Calendar window is on hidden workspace 4.
  chrome.focus(1);
  await tileco.event();
  await tileco.command("app-calendar");
  assert.equal(tileco.state.displays.hd, 1, "it stays on this workspace");
  assert.deepEqual(opened(chrome), [{ url: "https://calendar.google.com/", type: "popup" }]);
  const [{ id }] = chrome.created.filter((c) => c.url === "https://calendar.google.com/");
  assert.equal(chrome.win(id).focused, true, "the new window, not the old one");
  assert.deepEqual(tileco.state.workspaces[1].windows, [id]);
});

test("an app key's popup tiles like an app, and each press opens another", async () => {
  const { chrome, tileco } = await setup([HD], [on(HD, 1, { focused: true })]);
  await tileco.command("app-chat");
  assert.deepEqual(opened(chrome), [{ url: "https://chat.google.com/", type: "popup" }]);
  assert.deepEqual(tileco.state.workspaces[1].windows, [1, 2], "the popup tiles like an app");
  assert.equal(chrome.box(2).x, 1056);
  await tileco.command("app-chat");
  assert.equal(opened(chrome).length, 2, "the second press opens another");
  assert.equal(chrome.win(3).focused, true);
});

test("an app key opens the app settings give it, and a key with none does nothing", async () => {
  const { chrome, tileco } = await setup([HD], [on(HD, 1, { focused: true })]);
  chrome.syncStore.settings = { apps: [{ command: "app-chat", name: "Linear", url: "https://linear.app/" }] };
  await tileco.command("app-chat");
  assert.deepEqual(opened(chrome), [{ url: "https://linear.app/", type: "popup" }]);
  await tileco.command("app-meet");
  assert.equal(opened(chrome).length, 1, "Meet's key has no app now");
});

test("the browser key opens a new browser window even with one open", async () => {
  const { chrome, tileco } = await setup([HD], [
    on(HD, 1, { type: "app", url: "https://music.youtube.com/", focused: true }),
    on(HD, 2, { url: "https://example.com/" }),
  ]);
  await tileco.command("app-browser");
  assert.deepEqual(opened(chrome), [{ url: undefined, type: "normal" }]);
  assert.equal(chrome.win(3).focused, true);
  assert.deepEqual(tileco.state.workspaces[1].windows, [1, 2, 3]);
});

test("other popups stay untracked", async () => {
  const { tileco } = await setup([HD], [on(HD, 1, { focused: true }), on(HD, 2, { type: "popup", url: "https://chat.google.com/" })]);
  assert.equal(2 in tileco.state.windows, false);
});

test("an empty workspace gets a focused home window, and loses it when a window arrives", async () => {
  const { chrome, tileco } = await setup([HD], [on(HD, 1, { focused: true })]);
  assert.equal(homes(chrome).length, 0);
  await tileco.command("workspace-2");
  const [home] = homes(chrome);
  assert.ok(home, "a home window opened");
  assert.equal(home.focused, true);
  assert.equal(home.type, "popup");
  assert.equal(home.state, "fullscreen");
  assert.deepEqual(chrome.box(home.id), { x: 0, y: 0, w: 1920, h: 1080 }, "it covers its display");
  assert.equal(2 in tileco.state.windows, false, "it isn't tracked or tiled");
  // A key pressed in the home window acts on its display.
  await tileco.command("app-browser");
  assert.equal(homes(chrome).length, 0, "it closed when the browser window arrived");
  assert.deepEqual(chrome.removed, [home.id]);
});

test("switching between empty workspaces keeps one home window", async () => {
  const { chrome, tileco } = await setup([HD], [on(HD, 1, { focused: true })]);
  await tileco.command("workspace-2");
  await tileco.command("workspace-3");
  assert.equal(homes(chrome).length, 1);
  await tileco.command("workspace-1");
  assert.equal(homes(chrome).length, 0);
  assert.equal(chrome.win(1).focused, true);
});

test("a home window you close stays closed until another empty workspace", async () => {
  const { chrome, tileco } = await setup([HD], [on(HD, 1, { focused: true })]);
  await tileco.command("workspace-2");
  chrome.wins = chrome.wins.filter((w) => w.url !== HOME);
  await tileco.event();
  assert.equal(homes(chrome).length, 0);
  await tileco.command("workspace-3");
  assert.equal(homes(chrome).length, 1);
});

test("switching one display's workspace focuses only that display's home", async () => {
  const { chrome, tileco } = await setup([HD, UW], [on(HD, 1, { focused: true }), on(UW, 2)]);
  await tileco.command("send-4");
  chrome.focus(2);
  await tileco.event();
  await tileco.command("send-5");
  // Both displays now show empty workspaces, each with a home window.
  const hdHome = () => homes(chrome).find((w) => w.left < 1920);
  chrome.focus(hdHome().id);
  await tileco.event();
  await tileco.command("workspace-3");
  assert.equal(tileco.state.displays.hd, 3);
  assert.equal(hdHome().focused, true, "focus stays on the display you switched");
});

test("a disconnected display's home window closes", async () => {
  const { chrome, tileco } = await setup([HD, UW], [on(HD, 1, { focused: true }), on(UW, 2)]);
  chrome.focus(2);
  await tileco.event();
  await tileco.command("send-4");
  const [home] = homes(chrome);
  assert.ok(home.left >= 1920, "the ultrawide got a home");
  chrome.displaysList = [HD];
  Object.assign(home, { left: 100, top: 100 });
  await tileco.event();
  assert.equal(homes(chrome).length, 0);
  assert.deepEqual(tileco.state.homes, {});
});

test("the last window leaving a workspace brings the home window", async () => {
  const { chrome, tileco } = await setup([HD], [on(HD, 1, { focused: true })]);
  await tileco.command("send-2");
  assert.equal(homes(chrome).length, 1);
});

test("the badge shows the focused display's workspace", async () => {
  const { chrome, tileco } = await setup([HD], [on(HD, 1, { focused: true })]);
  assert.equal(chrome.badge, "1");
  await tileco.command("workspace-7");
  assert.equal(chrome.badge, "7");
});

test("the dashboard opens full screen on the focused display, and its key closes it", async () => {
  const { chrome, tileco } = await setup([HD, UW], [on(HD, 1), on(UW, 2, { focused: true })]);
  await tileco.command("popup");
  const [d] = chrome.wins.filter((w) => w.url === DASHBOARD);
  assert.ok(d, "the dashboard opened");
  assert.equal(d.state, "fullscreen");
  assert.equal(d.focused, true);
  assert.deepEqual(chrome.box(d.id), { x: 1920, y: 0, w: 3440, h: 1440 }, "on the ultrawide, where the focus was");
  assert.equal(d.id in tileco.state.windows, false, "it isn't tiled or tracked");
  await tileco.command("popup");
  assert.equal(chrome.wins.some((w) => w.url === DASHBOARD), false, "the key again closes it");
});

test("a command from the dashboard acts on the window you were last in", async () => {
  const { chrome, tileco } = await setup([HD], [on(HD, 1), on(HD, 2, { focused: true })]);
  await tileco.command("popup");
  assert.ok(chrome.wins.find((w) => w.url === DASHBOARD).focused, "the dashboard has focus");
  await tileco.command("send-3");
  assert.equal(tileco.state.windows[2].ws, 3, "the window behind the dashboard moved");
  assert.equal(tileco.state.windows[1].ws, 1);
});

test("a dashboard that closed itself is forgotten", async () => {
  const { chrome, tileco } = await setup([HD], [on(HD, 1, { focused: true })]);
  await tileco.command("popup");
  chrome.wins = chrome.wins.filter((w) => w.url !== DASHBOARD);
  await tileco.event();
  assert.equal(tileco.state.dashboard, undefined);
  await tileco.command("popup");
  assert.equal(chrome.wins.filter((w) => w.url === DASHBOARD).length, 1, "the next press opens a new one");
});

test("a tab chosen in the launcher comes forward with its window and workspace", async () => {
  const { chrome, tileco } = await setup([HD], [on(HD, 1, { focused: true }), on(HD, 2)]);
  await tileco.command("send-4");
  chrome.focus(2);
  await tileco.event();
  await tileco.tabLoaded(0);
  await tileco.activateTab(10, 1);
  assert.equal(tileco.state.displays.hd, 4, "its workspace comes up");
  assert.equal(chrome.win(1).focused, true);
  assert.deepEqual(chrome.tabUpdates, [{ id: 10, active: true }]);
});

test("the view lists each display's workspace and layout", async () => {
  const { chrome } = await setup([HD, UW], [on(HD, 1, { focused: true }), on(UW, 2)]);
  assert.deepEqual(chrome.store.view, {
    focusedDisplay: "hd",
    displays: { hd: { workspace: 1, mode: "tile" }, uw: { workspace: 2, mode: "threecol" } },
    counts: { 1: 1, 2: 1, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0, 8: 0, 9: 0 },
    urgent: [],
    dim: false,
  });
});

test("a rising unread count marks its window, and Search+Tab goes there", async () => {
  const { chrome, tileco } = await setup([HD], [
    on(HD, 1, { focused: true }),
    on(HD, 2, { type: "app", url: "https://chat.google.com/" }),
  ]);
  await tileco.command("send-3");
  chrome.focus(2);
  await tileco.event();
  await tileco.command("send-4");
  chrome.focus(1);
  await tileco.event();
  // Chat sits alone on hidden workspace 4.
  await tileco.title(20, 2, "Chat");
  assert.deepEqual(tileco.state.marks, [], "a first title with no count marks nothing");
  await tileco.title(20, 2, "Chat (1)");
  assert.deepEqual(tileco.state.marks, [2]);
  assert.ok(chrome.updates.some((u) => u.id === 2 && u.drawAttention), "its shelf icon flashes");
  assert.equal(chrome.badgeColor, "#e5a50a", "the badge turns amber");
  assert.deepEqual(chrome.store.view.urgent, [4]);
  await tileco.command("attention");
  assert.equal(tileco.state.displays.hd, 4, "its workspace comes up");
  assert.equal(chrome.win(2).focused, true);
  assert.deepEqual(tileco.state.marks, []);
  assert.equal(chrome.badgeColor, "#3584e4");
});

test("a count that falls or holds, or rises in the window you're in, marks nothing", async () => {
  const { tileco } = await setup([HD], [on(HD, 1, { focused: true }), on(HD, 2)]);
  await tileco.title(20, 2, "Inbox (5) - Gmail");
  assert.deepEqual(tileco.state.marks, [], "a page loading with unread mail sets the baseline");
  await tileco.title(20, 2, "Inbox (5) - Gmail");
  await tileco.title(20, 2, "Inbox (4) - Gmail");
  await tileco.title(10, 1, "Inbox (0) - Gmail");
  await tileco.title(10, 1, "Inbox (9) - Gmail");
  assert.deepEqual(tileco.state.marks, []);
});

test("a tab loading another page sets a new baseline", async () => {
  const { tileco } = await setup([HD], [on(HD, 1, { focused: true }), on(HD, 2)]);
  await tileco.title(20, 2, "Inbox (2) - Gmail", true);
  // The tab moves to another account with more old mail.
  await tileco.title(20, 2, "Inbox (30) - Gmail", true);
  assert.deepEqual(tileco.state.marks, []);
  await tileco.title(20, 2, "Inbox (31) - Gmail");
  assert.deepEqual(tileco.state.marks, [2], "a rise after that still marks");
});

test("Search+Tab goes to the newest mark, then the next", async () => {
  const { chrome, tileco } = await setup([HD], [on(HD, 1, { focused: true }), on(HD, 2), on(HD, 3)]);
  await tileco.title(20, 2, "Chat");
  await tileco.title(30, 3, "Inbox - Gmail");
  await tileco.title(20, 2, "Chat (1)");
  await tileco.title(30, 3, "Inbox (1) - Gmail");
  await tileco.command("attention");
  assert.equal(chrome.win(3).focused, true);
  await tileco.command("attention");
  assert.equal(chrome.win(2).focused, true);
  assert.deepEqual(tileco.state.marks, []);
});

test("going to a marked window yourself clears its mark", async () => {
  const { chrome, tileco } = await setup([HD], [on(HD, 1, { focused: true }), on(HD, 2)]);
  await tileco.title(20, 2, "Chat");
  await tileco.title(20, 2, "Chat (2)");
  assert.deepEqual(tileco.state.marks, [2]);
  chrome.focus(2);
  await tileco.event();
  assert.deepEqual(tileco.state.marks, []);
});

test("with nothing marked, Search+Tab goes back to the last window", async () => {
  const { chrome, tileco } = await setup([HD], [on(HD, 1, { focused: true }), on(HD, 2), on(HD, 3)]);
  chrome.focus(2);
  await tileco.event();
  chrome.focus(3);
  await tileco.event();
  await tileco.command("attention");
  assert.equal(chrome.win(2).focused, true);
  await tileco.command("attention");
  assert.equal(chrome.win(3).focused, true, "again goes back");
});

test("a closed window's mark and counts go with it", async () => {
  const { chrome, tileco } = await setup([HD], [on(HD, 1, { focused: true }), on(HD, 2)]);
  await tileco.title(20, 2, "Chat");
  await tileco.title(20, 2, "Chat (2)");
  assert.deepEqual(tileco.state.marks, [2]);
  chrome.wins = chrome.wins.filter((w) => w.id !== 2);
  await tileco.event();
  assert.deepEqual(tileco.state.marks, []);
  assert.deepEqual(tileco.state.unread, {});
});

test("the dim is off until you grant all-sites access", async () => {
  const { chrome } = await setup([HD], [on(HD, 1, { focused: true, url: "https://example.com/" }), on(HD, 2, { url: "https://example.org/" })]);
  assert.deepEqual([...chrome.dimmed], []);
  assert.equal(chrome.store.view.dim, false);
});

test("with the dim on, every shown window but the focused one is dimmed", async () => {
  const { chrome, tileco } = await setup([HD], [
    on(HD, 1, { focused: true, url: "https://example.com/" }),
    on(HD, 2, { url: "https://example.org/" }),
    on(HD, 3, { url: "https://example.net/" }),
  ]);
  chrome.granted = true;
  await tileco.setDim(true);
  assert.deepEqual([...chrome.dimmed].sort(), [20, 30]);
  assert.equal(chrome.store.view.dim, true);
  chrome.focus(2);
  await tileco.event();
  assert.deepEqual([...chrome.dimmed].sort(), [10, 30], "focus moves the dim at once");
});

test("the dim's strength comes from settings, and a change repaints what's dimmed", async () => {
  const { chrome, tileco } = await setup([HD], [
    on(HD, 1, { focused: true, url: "https://example.com/" }),
    on(HD, 2, { url: "https://example.org/" }),
  ]);
  chrome.granted = true;
  await tileco.setDim(true);
  assert.equal(chrome.strength.get(20), 0.1, "10% by default");
  chrome.syncStore.settings = { dimStrength: 0.25 };
  await tileco.event();
  assert.equal(chrome.strength.get(20), 0.25, "the dimmed page took the new strength");
  assert.deepEqual([...chrome.dimmed], [20]);
});

test("a dimmed window on a hidden workspace comes back at the new strength", async () => {
  const { chrome, tileco } = await setup([HD], [
    on(HD, 1, { focused: true, url: "https://example.com/" }),
    on(HD, 2, { url: "https://example.org/" }),
  ]);
  chrome.granted = true;
  await tileco.setDim(true);
  await tileco.command("workspace-2");
  assert.deepEqual([...chrome.dimmed], [20], "its overlay waits for its return");
  chrome.syncStore.settings = { dimStrength: 0.25 };
  await tileco.event();
  await tileco.command("workspace-1");
  assert.equal(chrome.strength.get(20), 0.25);
});

test("a fullscreen window and a chrome:// page aren't dimmed", async () => {
  const { chrome, tileco } = await setup([HD], [
    on(HD, 1, { focused: true, url: "https://example.com/" }),
    on(HD, 2, { url: "chrome://settings/" }),
    on(HD, 3, { url: "https://example.net/", state: "fullscreen" }),
  ]);
  chrome.granted = true;
  await tileco.setDim(true);
  assert.deepEqual([...chrome.dimmed], [], "the chrome:// page fails quietly and the rest goes on");
});

test("a window left alone on its workspace loses the dim", async () => {
  const { chrome, tileco } = await setup([HD], [
    on(HD, 1, { focused: true, url: "https://example.com/" }),
    on(HD, 2, { url: "https://example.org/" }),
  ]);
  chrome.granted = true;
  await tileco.setDim(true);
  assert.deepEqual([...chrome.dimmed], [20]);
  chrome.wins = chrome.wins.filter((w) => w.id !== 1);
  await tileco.event();
  assert.deepEqual([...chrome.dimmed], []);
});

test("a hidden window keeps its dim, and loses it when it comes back focused", async () => {
  const { chrome, tileco } = await setup([HD], [
    on(HD, 1, { focused: true, url: "https://example.com/" }),
    on(HD, 2, { url: "https://example.org/" }),
  ]);
  chrome.granted = true;
  await tileco.setDim(true);
  assert.deepEqual([...chrome.dimmed], [20]);
  await tileco.command("workspace-2");
  assert.deepEqual([...chrome.dimmed], [20], "no churn on a hidden page");
  await tileco.command("workspace-1");
  chrome.focus(2);
  await tileco.event();
  assert.deepEqual([...chrome.dimmed], [10]);
});

test("a dimmed tab that loads a new page gets the dim back", async () => {
  const { chrome, tileco } = await setup([HD], [
    on(HD, 1, { focused: true, url: "https://example.com/" }),
    on(HD, 2, { url: "https://example.org/" }),
  ]);
  chrome.granted = true;
  await tileco.setDim(true);
  // The page reloads, and its overlay goes with the old document.
  chrome.dimmed.delete(20);
  await tileco.tabLoaded(20);
  assert.deepEqual([...chrome.dimmed], [20]);
  await tileco.tabLoaded(10);
  assert.deepEqual([...chrome.dimmed], [20], "the focused tab's load leaves it undimmed");
});

test("a tab that couldn't be dimmed is dimmed once it loads a website", async () => {
  const { chrome, tileco } = await setup([HD], [
    on(HD, 1, { focused: true, url: "https://example.com/" }),
    on(HD, 2, { url: "chrome://newtab/" }),
  ]);
  chrome.granted = true;
  await tileco.setDim(true);
  assert.deepEqual([...chrome.dimmed], []);
  chrome.win(2).url = "https://example.org/";
  await tileco.tabLoaded(20);
  assert.deepEqual([...chrome.dimmed], [20]);
});

test("with the dim off, a load does nothing", async () => {
  const { chrome, tileco } = await setup([HD], [on(HD, 1, { focused: true }), on(HD, 2)]);
  chrome.updates.length = 0;
  await tileco.tabLoaded(20);
  assert.deepEqual(chrome.updates, [], "no retile");
});

test("turning the dim off undims every page while tileco can still reach them", async () => {
  const { chrome, tileco } = await setup([HD], [
    on(HD, 1, { focused: true, url: "https://example.com/" }),
    on(HD, 2, { url: "https://example.org/" }),
  ]);
  chrome.granted = true;
  await tileco.setDim(true);
  await tileco.setDim(false);
  assert.deepEqual([...chrome.dimmed], []);
  assert.equal(chrome.store.view.dim, false);
  chrome.granted = false;
  await tileco.event();
  assert.deepEqual(tileco.state.dimmed, []);
});

test("after a browser restart, windows go back to their workspaces by their tabs", async () => {
  const { chrome, tileco } = await setup([HD], [
    on(HD, 1, { focused: true, url: "https://mail.google.com/" }),
    on(HD, 2, { url: "https://docs.google.com/a" }),
    on(HD, 3, { url: "https://github.com/" }),
  ]);
  await tileco.command("send-3");
  chrome.focus(2);
  await tileco.event();
  await tileco.command("float");
  // The browser restarts: the same windows return with new IDs, all showing,
  // and the service worker starts afresh from storage.
  chrome.wins = [];
  chrome.open(on(HD, 11, { url: "https://github.com/" }));
  chrome.open(on(HD, 12, { url: "https://mail.google.com/" }));
  chrome.open(on(HD, 13, { url: "https://docs.google.com/a" }));
  chrome.open(on(HD, 14, { url: "https://example.com/new" }));
  chrome.focus(13);
  const after = new Tileco(chrome);
  await after.event();
  const s = after.state;
  assert.equal(s.windows[12].ws, 3, "Gmail went back to workspace 3");
  assert.equal(chrome.win(12).state, "minimized", "which isn't showing");
  assert.equal(s.windows[13].floating, true, "the floating window still floats");
  assert.deepEqual(s.workspaces[1].windows, [13, 11, 14], "the stack order holds, and the new window joins the end");
  assert.equal(1 in s.windows, false);
});

test("after a restart, windows Chrome restores one at a time still find their workspaces", async () => {
  const { chrome, tileco } = await setup([HD], [
    on(HD, 1, { focused: true, url: "https://mail.google.com/" }),
    on(HD, 2, { url: "https://github.com/" }),
  ]);
  await tileco.command("send-3");
  chrome.wins = [];
  chrome.open(on(HD, 11, { url: "https://github.com/", focused: true }));
  const after = new Tileco(chrome);
  await after.event();
  assert.equal(after.state.windows[11].ws, 1);
  assert.equal(after.state.restoring[1].ws, 3, "Gmail's window waits for its return");
  chrome.open(on(HD, 12, { url: "https://mail.google.com/" }));
  await after.event();
  assert.equal(after.state.windows[12].ws, 3, "Gmail went back to workspace 3");
  assert.equal(chrome.win(12).state, "minimized");
  assert.equal(after.state.restoring, undefined, "nothing is left waiting");
});

test("after a restart, a window still matches after its page changed with the dim off", async () => {
  const { chrome, tileco } = await setup([HD], [
    on(HD, 1, { focused: true, url: "https://example.com/" }),
    on(HD, 2, { url: "https://example.org/" }),
  ]);
  await tileco.command("float");
  chrome.win(1).url = "https://example.net/";
  await tileco.tabLoaded(10);
  chrome.wins = [];
  chrome.open(on(HD, 11, { url: "https://example.org/" }));
  chrome.open(on(HD, 12, { url: "https://example.net/", focused: true }));
  const after = new Tileco(chrome);
  await after.event();
  assert.equal(after.state.windows[12].floating, true, "it found the floating window by its new page");
});

test("after a restart, a popup tileco doesn't manage can't take a window's place", async () => {
  const { chrome, tileco } = await setup([HD], [on(HD, 1, { focused: true, url: "https://mail.google.com/" })]);
  await tileco.command("send-3");
  chrome.wins = [];
  chrome.open(on(HD, 11, { type: "popup", url: "https://mail.google.com/" }));
  chrome.open(on(HD, 12, { url: "https://mail.google.com/", focused: true }));
  const after = new Tileco(chrome);
  await after.event();
  assert.equal(after.state.windows[12].ws, 3, "the tab window got Gmail's place");
  assert.equal(11 in after.state.windows, false);
});

test("after a restart, an app popup that comes back late is still the app's", async () => {
  const { chrome, tileco } = await setup([HD], [on(HD, 1, { focused: true, url: "https://github.com/" })]);
  await tileco.command("app-calendar");
  await tileco.command("send-3");
  chrome.wins = [];
  chrome.open(on(HD, 11, { url: "https://github.com/", focused: true }));
  const after = new Tileco(chrome);
  await after.event();
  chrome.open(on(HD, 12, { type: "popup", url: "https://calendar.google.com/" }));
  await after.event();
  assert.equal(after.state.windows[12].ws, 3, "Calendar went back to workspace 3");
  assert.equal(chrome.win(12).state, "minimized");
  assert.ok(after.state.appPopups.includes(12), "it still tiles as Calendar's");
});

test("after a restart, a first window that matches nothing doesn't end the wait", async () => {
  const { chrome, tileco } = await setup([HD], [on(HD, 1, { focused: true, url: "https://mail.google.com/" })]);
  await tileco.command("send-3");
  chrome.wins = [];
  chrome.open(on(HD, 11, { url: "https://example.com/new", focused: true }));
  const after = new Tileco(chrome);
  await after.event();
  assert.equal(after.state.windows[11].ws, 1, "the new window joins the showing workspace");
  chrome.open(on(HD, 12, { url: "https://mail.google.com/" }));
  await after.event();
  assert.equal(after.state.windows[12].ws, 3, "Gmail still went back to workspace 3");
  assert.equal(chrome.win(12).state, "minimized");
});

test("after a restart, a command ends the wait for windows that never came back", async () => {
  const { chrome, tileco } = await setup([HD], [
    on(HD, 1, { focused: true, url: "https://mail.google.com/" }),
    on(HD, 2, { url: "https://github.com/" }),
  ]);
  await tileco.command("send-3");
  chrome.wins = [];
  chrome.open(on(HD, 11, { url: "https://github.com/", focused: true }));
  const after = new Tileco(chrome);
  await after.event();
  await after.command("focus-next");
  assert.equal(after.state.restoring, undefined);
  chrome.open(on(HD, 12, { url: "https://mail.google.com/" }));
  await after.event();
  assert.equal(after.state.windows[12].ws, 1, "a window opened later is just new");
});

test("after a restart, a sync before Chrome restores any window keeps them all waiting", async () => {
  const { chrome, tileco } = await setup([HD], [
    on(HD, 1, { focused: true, url: "https://mail.google.com/" }),
    on(HD, 2, { url: "https://github.com/" }),
  ]);
  await tileco.command("send-3");
  // The browser restarts, and the worker wakes before any window is back.
  chrome.wins = [];
  chrome.sessionStore = {};
  const after = new Tileco(chrome);
  await after.event();
  assert.equal(after.state.restoring[1].ws, 3, "Gmail's window waits for its return");
  assert.equal(after.state.restoring[2].ws, 1, "and so does GitHub's");
  chrome.open(on(HD, 21, { url: "https://github.com/", focused: true }));
  chrome.open(on(HD, 22, { url: "https://mail.google.com/" }));
  await after.event();
  assert.equal(after.state.windows[22].ws, 3, "Gmail went back to workspace 3");
  assert.equal(chrome.win(22).state, "minimized");
  assert.equal(after.state.windows[21].ws, 1);
  assert.equal(after.state.restoring, undefined, "nothing is left waiting");
});

test("closing every window one by one, then opening one, matches nothing", async () => {
  const { chrome, tileco } = await setup([HD], [on(HD, 1, { focused: true, url: "https://mail.google.com/" })]);
  await tileco.command("send-3");
  chrome.wins = [];
  await tileco.event();
  chrome.open(on(HD, 2, { url: "https://mail.google.com/", focused: true }));
  await tileco.event();
  assert.equal(tileco.state.windows[2].ws, 1, "a new window joins the workspace showing");
});

test("dragging the master's edge sets the main share, and the stack follows", async () => {
  const { chrome, tileco } = await setup([HD], [on(HD, 1, { focused: true }), on(HD, 2), on(HD, 3)]);
  assert.equal(chrome.box(1).w, 1056);
  // You drag the master's right edge to x = 1344, 70% of 1920.
  chrome.win(1).width = 1344;
  await tileco.event();
  assert.equal(tileco.state.workspaces[1].modes.tile.mfact, 0.7);
  assert.deepEqual(chrome.box(1), { x: 0, y: 0, w: 1344, h: 1032 });
  assert.deepEqual(chrome.box(2), { x: 1344, y: 0, w: 576, h: 516 });
  assert.deepEqual(chrome.box(3), { x: 1344, y: 516, w: 576, h: 516 });
});

test("dragging a stack window's left edge sets the main share too", async () => {
  const { chrome, tileco } = await setup([HD], [on(HD, 1, { focused: true }), on(HD, 2)]);
  Object.assign(chrome.win(2), { left: 768, width: 1152 });
  await tileco.event();
  assert.equal(tileco.state.workspaces[1].modes.tile.mfact, 0.4);
  assert.deepEqual(chrome.box(1), { x: 0, y: 0, w: 768, h: 1032 });
});

test("a resize the share can't follow is put back", async () => {
  const { chrome, tileco } = await setup([HD], [on(HD, 1, { focused: true }), on(HD, 2)]);
  // The master's left edge is the screen's.
  Object.assign(chrome.win(1), { left: 200, width: 856 });
  await tileco.event();
  assert.equal(tileco.state.workspaces[1].modes.tile.mfact, 0.55);
  assert.deepEqual(chrome.box(1), { x: 0, y: 0, w: 1056, h: 1032 });
});

test("moving a window without resizing it leaves the share", async () => {
  const { chrome, tileco } = await setup([HD], [on(HD, 1, { focused: true }), on(HD, 2)]);
  Object.assign(chrome.win(2), { left: 900, top: 50 });
  await tileco.event();
  assert.equal(tileco.state.workspaces[1].modes.tile.mfact, 0.55);
  assert.deepEqual(chrome.box(2), { x: 1056, y: 0, w: 864, h: 1032 });
});

test("a window resized by a change in the work area isn't a drag", async () => {
  const { chrome, tileco } = await setup([HD], [on(HD, 1, { focused: true }), on(HD, 2)]);
  // The shelf hides, and chromeOS widens the master as it goes.
  chrome.displaysList = [{ ...HD, workArea: { left: 0, top: 0, width: 1920, height: 1080 } }];
  chrome.win(1).width = 1300;
  await tileco.event();
  assert.equal(tileco.state.workspaces[1].modes.tile.mfact, 0.55);
});

test("a floating window's resize sets nothing", async () => {
  const { chrome, tileco } = await setup([HD], [on(HD, 1, { focused: true }), on(HD, 2), on(HD, 3)]);
  await floatAt(chrome, tileco, 3, 100, 100);
  chrome.win(3).width = 700;
  await tileco.event();
  assert.equal(tileco.state.workspaces[1].modes.tile.mfact, 0.55);
});

test("a window back from maximized isn't read as resized", async () => {
  const { chrome, tileco } = await setup([HD], [on(HD, 1, { focused: true }), on(HD, 2)]);
  Object.assign(chrome.win(1), { state: "maximized", left: 0, width: 1920 });
  await tileco.event();
  // chromeOS puts it back somewhere of its own choosing.
  Object.assign(chrome.win(1), { state: "normal", left: 0, width: 1500 });
  await tileco.event();
  assert.equal(tileco.state.workspaces[1].modes.tile.mfact, 0.55);
  assert.deepEqual(chrome.box(1), { x: 0, y: 0, w: 1056, h: 1032 });
});

test("without tab search, no tab addresses are kept, even with all sites allowed", async () => {
  const chrome = new FakeChrome({
    displays: [HD],
    windows: [on(HD, 1, { focused: true, url: "https://mail.google.com/" }), on(HD, 2, { url: "https://github.com/" })],
  });
  chrome.grantedPermissions.delete("tabs");
  // All-sites access for dimming lets Chrome show every tab's address.
  chrome.granted = true;
  const tileco = new Tileco(chrome);
  await tileco.event();
  await tileco.tabLoaded(20);
  for (const info of Object.values(chrome.store.state.windows)) assert.deepEqual(info.urls, []);
  chrome.grantedPermissions.add("tabs");
  await tileco.event();
  assert.deepEqual(chrome.store.state.windows[1].urls, ["https://mail.google.com/"], "kept once tab search is allowed");
});

test("Search+S keeps the display awake until it's pressed again", async () => {
  const { chrome, tileco } = await setup([HD], [on(HD, 1, { focused: true })]);
  assert.equal(chrome.awake, null, "nothing held at login");
  await tileco.command("keep-awake");
  assert.equal(chrome.awake, "display");
  assert.equal(chrome.sessionStore.keepAwake, true, "the dashboard reads it from storage.session");
  assert.equal(chrome.actionTitle, "tileco · Keeping awake");
  await tileco.command("keep-awake");
  assert.equal(chrome.awake, null);
  assert.equal(chrome.sessionStore.keepAwake, false);
  assert.equal(chrome.actionTitle, "tileco · Not keeping awake");
});

test("keep awake starts off in a new browser session", async () => {
  const { chrome, tileco } = await setup([HD], [on(HD, 1, { focused: true })]);
  await tileco.command("keep-awake");
  // A restart releases Chrome's request and empties storage.session together.
  chrome.awake = null;
  chrome.sessionStore = {};
  const again = new Tileco(chrome);
  await again.command("keep-awake");
  assert.equal(chrome.awake, "display", "the first press turns it on");
});
