import { test } from "node:test";
import assert from "node:assert/strict";
import { footerKeys, footerText, fuzzyScore, items, rank } from "./launcher.js";

test("a fuzzy match needs every query letter in order", () => {
  assert.equal(fuzzyScore("cal", "Google Calendar") > 0, true);
  assert.equal(fuzzyScore("gc", "Google Calendar") > 0, true);
  assert.equal(fuzzyScore("xyz", "Google Calendar"), null);
  assert.equal(fuzzyScore("lac", "Calendar"), null, "out of order");
});

test("word starts and runs score higher", () => {
  assert.ok(fuzzyScore("gc", "Google Calendar") > fuzzyScore("gc", "biggcat"), "word starts beat the middle of a word");
  assert.ok(fuzzyScore("cal", "Calendar") > fuzzyScore("cal", "Chat, all"), "a run beats scattered letters");
});

const tabs = [
  { id: 10, windowId: 1, title: "Inbox (3) - Gmail", url: "https://mail.google.com/mail/u/0/", lastAccessed: 300 },
  { id: 20, windowId: 2, title: "Design doc", url: "https://docs.google.com/document/d/1", lastAccessed: 500 },
  { id: 30, windowId: 3, title: "tileco", url: "chrome-extension://tileco/src/launcher.html" },
];
const apps = [{ name: "Google Calendar", url: "https://calendar.google.com/", command: "app-calendar", key: "Search+C" }];
const commands = {
  "workspace-4": { description: "Go to workspace 4 (Search+4)" },
  "app-calendar": { description: "Open Google Calendar (Search+C)" },
};
const all = items({ tabs, apps, commands, workspaceOf: (w) => ({ 1: 2, 2: 1 })[w] ?? null, ownOrigin: "chrome-extension://tileco/" });

test("the items are tabs, apps and commands, without tileco's own pages", () => {
  assert.deepEqual(
    all.map((i) => [i.kind, i.title, i.detail, i.key ?? ""]),
    [
      ["tab", "Inbox (3) - Gmail", "tab on 2", ""],
      ["tab", "Design doc", "tab on 1", ""],
      ["app", "Google Calendar", "app", "Search+C"],
      ["command", "Go to workspace 4", "command", "Search+4"],
    ],
  );
});

test("with no query, the most recent tabs come first, then apps and commands", () => {
  assert.deepEqual(rank("", all).map((i) => i.title), ["Design doc", "Inbox (3) - Gmail", "Google Calendar", "Go to workspace 4"]);
});

test("a query ranks by match, then by recency", () => {
  assert.deepEqual(rank("cal", all).map((i) => i.title), ["Google Calendar"]);
  assert.equal(rank("gmail", all)[0].title, "Inbox (3) - Gmail");
  assert.equal(rank("docs.google", all)[0].title, "Design doc", "a tab's host counts too");
  assert.equal(rank("ws 4", all)[0].title, "Go to workspace 4");
});

test("a scope keeps to its kinds: launch is apps and commands, tabs is tabs", () => {
  assert.deepEqual(rank("", all, { scope: "launch" }).map((i) => i.kind), ["app", "command"]);
  assert.deepEqual(rank("", all, { scope: "tabs" }).map((i) => i.title), ["Design doc", "Inbox (3) - Gmail"]);
  assert.deepEqual(rank("google", all, { scope: "launch" }).map((i) => i.title), ["Google Calendar"]);
});

test("a query with no match in its scope looks in every scope", () => {
  assert.equal(rank("gmail", all, { scope: "launch" })[0].title, "Inbox (3) - Gmail");
  assert.deepEqual(rank("zzz", all, { scope: "launch" }), []);
});

test("a tab on an app's site matches by the app's name", () => {
  // A name that's in neither the tab's title nor its host.
  const agenda = [{ name: "Agenda", url: "https://calendar.google.com/", command: "app-calendar" }];
  const week = { id: 40, windowId: 4, title: "Week of October 19", url: "https://calendar.google.com/calendar/u/0/r" };
  const found = items({ tabs: [...tabs, week], apps: agenda });
  assert.deepEqual(rank("agenda", found, { scope: "tabs" }).map((i) => i.title), ["Week of October 19"]);
  assert.equal(found.find((i) => i.tabId === 20).app, null, "a site no app has");
});

// tide's switcher footer names only the keys that work on the tab you're on.
test("the footer names only the keys that work in each scope", () => {
  assert.deepEqual(footerKeys("launch", { home: true, tabsAllowed: true }), [
    ["Enter", "run"],
    ["↑ ↓", "choose"],
    ["Tab", "switch to Tabs"],
    ["Esc", "clear"],
  ]);
  assert.deepEqual(footerKeys("tabs", { home: false, tabsAllowed: true }), [
    ["Enter", "go there"],
    ["↑ ↓", "choose"],
    ["Tab", "switch to Launch"],
    ["Esc", "clear or close"],
  ]);
  // Without tab access the Tabs scope has one row, so nothing to choose.
  assert.deepEqual(footerKeys("tabs", { home: false, tabsAllowed: false }), [
    ["Enter", "allow tab search"],
    ["Tab", "switch to Launch"],
    ["Esc", "clear or close"],
  ]);
  assert.equal(footerText(footerKeys("launch", { home: true, tabsAllowed: true })), "Enter to run · ↑ ↓ to choose · Tab to switch to Tabs · Esc to clear");
});
