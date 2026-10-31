// The launcher's matching and ranking (SPEC.md §9.4), free of chrome.* so it
// tests in Node: tabs, apps and tileco's commands, filtered by a fuzzy match
// and ordered by how well they match, then by how recently you used them.

import { appOfUrl } from "./apps.js";

// How well `query` matches `text`, or null if it doesn't. Every query
// character must appear in order; matches at the start of a word, and runs of
// consecutive matches, score higher, so "gc" finds "Google Calendar" first.
export function fuzzyScore(query, text) {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (q === "") return 0;
  let score = 0;
  let from = 0;
  let last = -2;
  for (const ch of q) {
    if (ch === " ") continue;
    const i = t.indexOf(ch, from);
    if (i < 0) return null;
    score += 1;
    if (i === 0 || /[\s\-_./:()]/.test(t[i - 1])) score += 3;
    if (i === last + 1) score += 2;
    last = i;
    from = i + 1;
  }
  if (t.startsWith(q)) score += 5;
  return score;
}

// The best score of an item over its title, a tab's app name, which counts
// as much, and its other searchable text, such as a tab's host, which counts
// for less.
function itemScore(query, item) {
  const scores = [fuzzyScore(query, item.title), item.app ? fuzzyScore(query, item.app) : null];
  const extra = item.extra ? fuzzyScore(query, item.extra) : null;
  if (extra !== null) scores.push(extra - 2);
  const found = scores.filter((s) => s !== null);
  return found.length === 0 ? null : Math.max(...found);
}

// The two scopes: "launch" is apps and tileco's commands, "tabs" is open tabs.
export const SCOPES = { launch: ["app", "command"], tabs: ["tab"] };

// Items in `scope` matching `query`, best first; ties go to the most recent.
// With no query, tabs come most recent first, apps before commands. A query
// that matches nothing in its scope looks in every scope instead, so a tab
// still turns up from the launch scope.
export function rank(query, items, { scope = null, limit = 8 } = {}) {
  const inScope = scope ? items.filter((i) => SCOPES[scope].includes(i.kind)) : items;
  const found = rankAll(query, inScope, limit);
  return found.length > 0 || !scope || query.trim() === "" ? found : rankAll(query, items, limit);
}

function rankAll(query, items, limit) {
  const q = query.trim();
  const kindOrder = { tab: 0, app: 1, command: 2 };
  const scored = [];
  for (const item of items) {
    const score = q === "" ? 0 : itemScore(q, item);
    if (score !== null) scored.push({ item, score });
  }
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      (q === "" ? kindOrder[a.item.kind] - kindOrder[b.item.kind] : 0) ||
      (b.item.recency ?? 0) - (a.item.recency ?? 0),
  );
  return scored.slice(0, limit).map((s) => s.item);
}

function host(url) {
  try {
    return new URL(url).host;
  } catch {
    // chrome:// and blank pages have no host worth searching
    return "";
  }
}

// The launcher's items: every tab but tileco's own pages, the app keys, and
// the manifest's commands. A tab on an app's site carries the app's name, so
// "calendar" finds Calendar's tabs. `workspaceOf` names a window's
// workspace, or null.
export function items({ tabs = [], apps = [], commands = {}, workspaceOf = () => null, ownOrigin = "" }) {
  const out = [];
  for (const t of tabs) {
    if (ownOrigin && t.url?.startsWith(ownOrigin)) continue;
    const n = workspaceOf(t.windowId);
    out.push({
      kind: "tab",
      title: t.title || t.url || "Untitled",
      extra: host(t.url ?? ""),
      app: appOfUrl(t.url, apps)?.name ?? null,
      detail: n === null ? "tab" : `tab on ${n}`,
      recency: t.lastAccessed ?? 0,
      tabId: t.id,
      windowId: t.windowId,
      icon: t.favIconUrl ?? null,
    });
  }
  for (const a of apps) out.push({ kind: "app", title: a.name, detail: "app", key: a.key ?? "", command: a.command });
  for (const [name, c] of Object.entries(commands)) {
    if (name.startsWith("app-")) continue;
    // Descriptions end with the key in parentheses, which shows on its own.
    const m = /^(.*?)\s*\(([^)]*)\)$/.exec(c.description ?? name);
    out.push({ kind: "command", title: m ? m[1] : c.description ?? name, detail: "command", key: m ? m[2] : "", command: name });
  }
  return out;
}

// The footer's key hints in `scope`, as [key, what it does], naming only the
// keys that work there, as tide's switcher footer does (SPEC.md §9.4).
// Without tab access the Tabs scope is one row, so there's nothing to choose.
export function footerKeys(scope, { home, tabsAllowed }) {
  const tabs = scope === "tabs";
  const enter = !tabs ? "run" : tabsAllowed ? "go there" : "allow tab search";
  return [["Enter", enter]]
    .concat(tabs && !tabsAllowed ? [] : [["↑ ↓", "choose"]])
    .concat([["Tab", `switch to ${tabs ? "Launch" : "Tabs"}`], ["Esc", home ? "clear" : "clear or close"]]);
}

export function footerText(keys) {
  return keys.map(([key, does]) => `${key} to ${does}`).join(" · ");
}
