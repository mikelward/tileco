// Tests for manifest.json and background.js.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Tileco } from "./tileco.js";
import { FakeChrome, HD } from "./fake_chrome.js";

const manifest = JSON.parse(readFileSync(new URL("../manifest.json", import.meta.url)));

// The keys Chromium accepts for a command (ui/base/accelerators/command.cc).
const KEYS = /^([A-Z0-9]|Comma|Period|Up|Down|Left|Right|Insert|Delete|Home|End|PageUp|PageDown|Space|Tab)$/;

test("the options page exists and opens in a tab", () => {
  assert.deepEqual(manifest.options_ui, { page: "src/options.html", open_in_tab: true });
  const html = readFileSync(new URL(`../${manifest.options_ui.page}`, import.meta.url), "utf8");
  assert.match(html, /src="optionsview\.js"/);
});

// A PNG's width and height, from its IHDR chunk.
function pngSize(path) {
  const b = readFileSync(new URL(`../${path}`, import.meta.url));
  assert.equal(b.toString("ascii", 1, 4), "PNG", `${path} isn't a PNG`);
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

test("every icon the manifest names is a PNG of its size", () => {
  const all = { ...manifest.icons, ...manifest.action.default_icon };
  assert.ok(manifest.icons["128"], "the store needs a 128 px icon");
  for (const [size, path] of Object.entries(all)) assert.deepEqual(pngSize(path), [Number(size), Number(size)], path);
});

test("at most four commands suggest a key, as Chromium allows", () => {
  const suggested = Object.values(manifest.commands).filter((c) => c.suggested_key);
  assert.ok(suggested.length <= 4, `${suggested.length} suggest keys`);
});

test("every suggested key is one Chromium can bind, on every platform", () => {
  for (const [name, c] of Object.entries(manifest.commands)) {
    if (!c.suggested_key) continue;
    assert.ok("default" in c.suggested_key, `${name} has no default, so it fails to install off chromeOS`);
    for (const [platform, combo] of Object.entries(c.suggested_key)) {
      const parts = combo.split("+");
      const key = parts.pop();
      assert.match(key, KEYS, `${name} ${platform}: ${combo}`);
      for (const mod of parts) {
        assert.ok(["Ctrl", "Alt", "Shift", "Command", "MacCtrl", "Search"].includes(mod), `${name}: ${mod}`);
        if (mod === "Search") assert.equal(platform, "chromeos", `${name}: Search only works on chromeOS`);
      }
    }
  }
});

// chromeOS turns Search+arrows into Home, End, Page Up and Page Down before
// Chrome sees them, so chrome://extensions/shortcuts refuses them (§7.2).
test("no command's key is a Search+arrow", () => {
  for (const [name, c] of Object.entries(manifest.commands)) {
    const key = /\(([^)]*)\)$/.exec(c.description ?? "")?.[1] ?? "";
    assert.doesNotMatch(key, /^Search\+(Shift\+)?(Left|Right|Up|Down)$/, `${name}: ${key}`);
  }
});

// Frequent actions take Search and one key; Shift is for moving a window
// and for rare actions (§7.3).
test("frequent actions take no modifier but Search, and no two commands share a key", () => {
  const keyOf = (c) => /\(([^)]*)\)$/.exec(c.description ?? "")?.[1] ?? "";
  const frequent = /^(focus-|grow|shrink|master-|monocle|layout-|workspace-|popup|attention)/;
  const seen = new Map();
  for (const [name, c] of Object.entries(manifest.commands)) {
    const key = keyOf(c);
    if (frequent.test(name)) assert.match(key, /^Search\+[^+]+$/, `${name}: ${key}`);
    assert.ok(!seen.has(key), `${name} and ${seen.get(key)} both take ${key}`);
    seen.set(key, name);
  }
});

// Tiling needs no permission with an install warning; tab access and each
// site's are asked for on the options page (§14.1).
test("every permission with an install warning is optional", () => {
  // power has no install warning, so keep awake (§11) needs no prompt.
  assert.deepEqual(manifest.permissions, ["storage", "system.display", "scripting", "power"]);
  assert.deepEqual(manifest.optional_permissions, ["tabs"]);
  assert.equal(manifest.content_scripts, undefined, "the title watcher is registered once its sites are allowed");
  assert.equal(manifest.host_permissions, undefined);
});

test("all-sites access is optional, for the dim alone", () => {
  assert.deepEqual(manifest.optional_host_permissions, ["<all_urls>"]);
  assert.ok(manifest.permissions.includes("scripting"));
});

test("the dim is switched on and off in the settings, not on the dashboard", () => {
  const page = (name) => readFileSync(new URL(`./${name}`, import.meta.url), "utf8");
  assert.doesNotMatch(page("launcher.html"), /id="dim"/);
  assert.match(page("options.html"), /id="permissions"/, "the settings list the extras, the dim among them");
  assert.doesNotMatch(page("options.html"), /from the dashboard/);
});

test("every command in the manifest does something", async () => {
  for (const name of Object.keys(manifest.commands)) {
    const chrome = new FakeChrome({
      displays: [HD],
      windows: [
        { id: 1, left: 0, top: 0, width: 400, height: 300, focused: true },
        { id: 2, left: 500, top: 0, width: 400, height: 300 },
      ],
    });
    const tileco = new Tileco(chrome);
    await tileco.event();
    // Removing a master needs a second one to remove, and going or sending
    // to workspace 1 needs to start somewhere else.
    if (name === "master-remove") await tileco.command("master-add");
    // Search+Tab with nothing marked goes back to the last window you were in.
    if (name === "attention") {
      chrome.focus(2);
      await tileco.event();
      chrome.focus(1);
      await tileco.event();
    }
    if (name.endsWith("-1")) {
      await tileco.command("workspace-2");
      chrome.open({ id: 9, left: 0, top: 0, width: 400, height: 300 });
      chrome.focus(9);
      await tileco.event();
    }
    const before = JSON.stringify([tileco.state, chrome.wins]);
    chrome.updates.length = 0;
    await tileco.command(name);
    const after = JSON.stringify([tileco.state, chrome.wins]);
    const acted = before !== after || chrome.updates.some((u) => u.focused) || chrome.awake !== null;
    assert.ok(acted, `${name} changed nothing`);
  }
});

test("background.js adds every listener while it first runs", async () => {
  const added = new Set();
  const event = (name) => ({ addListener: () => added.add(name) });
  globalThis.chrome = {
    commands: { onCommand: event("commands.onCommand") },
    windows: {
      onCreated: event("windows.onCreated"),
      onRemoved: event("windows.onRemoved"),
      onFocusChanged: event("windows.onFocusChanged"),
      onBoundsChanged: event("windows.onBoundsChanged"),
    },
    system: { display: { onDisplayChanged: event("system.display.onDisplayChanged") } },
    tabs: { onActivated: event("tabs.onActivated"), onUpdated: event("tabs.onUpdated") },
    action: { onClicked: event("action.onClicked") },
    permissions: { onAdded: event("permissions.onAdded"), onRemoved: event("permissions.onRemoved") },
    storage: { onChanged: event("storage.onChanged") },
    runtime: {
      onStartup: event("runtime.onStartup"),
      onInstalled: event("runtime.onInstalled"),
      onMessage: event("runtime.onMessage"),
      getManifest: () => manifest,
    },
  };
  await import("./background.js");
  assert.deepEqual([...added].sort(), [
    "action.onClicked",
    "commands.onCommand",
    "permissions.onAdded",
    "permissions.onRemoved",
    "runtime.onInstalled",
    "runtime.onMessage",
    "runtime.onStartup",
    "storage.onChanged",
    "system.display.onDisplayChanged",
    "tabs.onActivated",
    "tabs.onUpdated",
    "windows.onBoundsChanged",
    "windows.onCreated",
    "windows.onFocusChanged",
    "windows.onRemoved",
  ]);
  delete globalThis.chrome;
});
