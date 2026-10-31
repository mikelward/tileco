// A fake of the parts of `chrome` tileco uses, for tests. Windows and displays
// are plain objects the test can read and change; every call returns a
// promise, like MV3's chrome.* APIs.

export class FakeChrome {
  constructor({ displays, windows = [] }) {
    this.displaysList = displays;
    this.wins = windows.map((w) => ({ type: "normal", state: "normal", focused: false, alwaysOnTop: false, ...w }));
    this.store = {};
    this.syncStore = {};
    // storage.session, which a browser restart empties.
    this.sessionStore = {};
    this.updates = [];
    this.refuse = new Set();
    this.created = [];
    this.removed = [];
    const fake = this;
    this.system = { display: { getInfo: async () => structuredClone(fake.displaysList) } };
    this.storage = {
      local: {
        get: async (key) => (key in fake.store ? { [key]: structuredClone(fake.store[key]) } : {}),
        set: async (items) => {
          for (const [k, v] of Object.entries(items)) fake.store[k] = structuredClone(v);
        },
      },
      sync: {
        get: async (key) => (key in fake.syncStore ? { [key]: structuredClone(fake.syncStore[key]) } : {}),
      },
      session: {
        get: async (key) => (key in fake.sessionStore ? { [key]: structuredClone(fake.sessionStore[key]) } : {}),
        set: async (items) => {
          for (const [k, v] of Object.entries(items)) fake.sessionStore[k] = structuredClone(v);
        },
      },
    };
    this.windows = {
      getAll: async ({ windowTypes, populate } = {}) =>
        structuredClone(
          fake.wins
            .filter((w) => !windowTypes || windowTypes.includes(w.type))
            .map((w) => (populate ? { ...w, tabs: [{ id: w.id * 10, active: true, url: w.url ?? "chrome://newtab/" }] } : w)),
        ),
      create: async ({ url, type = "normal", focused = false, left = 100, top = 100, width = 800, height = 600 } = {}) => {
        const id = Math.max(0, ...fake.wins.map((w) => w.id)) + 1;
        fake.created.push({ id, url, type });
        fake.open({ id, url, type, left, top, width, height });
        if (focused) fake.focus(id);
        return structuredClone(fake.win(id));
      },
      update: async (id, props) => {
        const w = fake.win(id);
        // Like Document picture-in-picture, a window can refuse a state.
        if (props.state && fake.refuse.has(id)) throw new Error(`Window ${id} can't be ${props.state}`);
        fake.updates.push({ id, ...props });
        if (props.focused) {
          for (const o of fake.wins) o.focused = false;
          if (w.state === "minimized") w.state = "normal";
        }
        Object.assign(w, props);
        return structuredClone(w);
      },
      remove: async (id) => {
        fake.win(id);
        fake.removed.push(id);
        fake.wins = fake.wins.filter((w) => w.id !== id);
      },
    };
    this.runtime = { getURL: (path) => `chrome-extension://tileco/${path}` };
    // Each window has one tab, `id * 10`; `dimmed` is the set of tabs
    // showing the dim overlay.
    this.dimmed = new Set();
    this.strength = new Map();
    this.granted = false;
    // `granted` is all-sites access; `grantedOrigins` holds narrower grants.
    this.grantedOrigins = new Set();
    // API permissions, such as tabs; tab search is allowed unless a test
    // takes it away.
    this.grantedPermissions = new Set(["tabs"]);
    this.permissions = {
      contains: async ({ origins = [], permissions = [] }) =>
        permissions.every((p) => fake.grantedPermissions.has(p)) && (fake.granted || origins.every((o) => fake.grantedOrigins.has(o))),
    };
    this.registered = new Map();
    this.injected = [];
    this.scripting = {
      getRegisteredContentScripts: async ({ ids } = {}) =>
        structuredClone([...fake.registered.values()].filter((s) => !ids || ids.includes(s.id))),
      registerContentScripts: async (scripts) => {
        for (const s of scripts) {
          if (fake.registered.has(s.id)) throw new Error(`Duplicate script ID '${s.id}'`);
          fake.registered.set(s.id, structuredClone(s));
        }
      },
      unregisterContentScripts: async ({ ids }) => {
        for (const id of ids) fake.registered.delete(id);
      },
      executeScript: async ({ target, args, files }) => {
        const w = fake.wins.find((x) => x.id * 10 === target.tabId);
        if (!w) throw new Error(`No tab with id: ${target.tabId}.`);
        if ((w.url ?? "chrome://newtab/").startsWith("chrome")) throw new Error("Cannot access a chrome:// URL");
        if (files) {
          fake.injected.push({ tabId: target.tabId, files });
          return [{ result: undefined }];
        }
        if (args[0]) {
          fake.dimmed.add(target.tabId);
          fake.strength.set(target.tabId, args[1]);
        }
        else fake.dimmed.delete(target.tabId);
        return [{ result: undefined }];
      },
    };
    this.badge = "";
    this.badgeColor = null;
    this.action = {
      setBadgeText: async ({ text }) => {
        fake.badge = text;
      },
      setBadgeBackgroundColor: async ({ color }) => {
        fake.badgeColor = color;
      },
    };
    this.tabUpdates = [];
    this.createdTabs = [];
    this.tabs = {
      create: async (props) => {
        fake.createdTabs.push(props);
      },
      update: async (id, props) => {
        fake.tabUpdates.push({ id, ...props });
      },
      // Patterns here are "origin/*", so a prefix match is enough.
      query: async ({ url = [] } = {}) =>
        fake.wins
          .filter((w) => url.some((p) => (w.url ?? "").startsWith(p.slice(0, -1))))
          .map((w) => ({ id: w.id * 10, windowId: w.id, url: w.url })),
    };
  }

  win(id) {
    const w = this.wins.find((x) => x.id === id);
    if (!w) throw new Error(`no window ${id}`);
    return w;
  }

  open(w) {
    this.wins.push({ type: "normal", state: "normal", focused: false, alwaysOnTop: false, ...w });
  }

  focus(id) {
    for (const o of this.wins) o.focused = o.id === id;
  }

  box(id) {
    const w = this.win(id);
    return { x: w.left, y: w.top, w: w.width, h: w.height };
  }
}

export const HD = { id: "hd", bounds: { left: 0, top: 0, width: 1920, height: 1080 }, workArea: { left: 0, top: 0, width: 1920, height: 1032 } };
export const UW = { id: "uw", bounds: { left: 1920, top: 0, width: 3440, height: 1440 }, workArea: { left: 1920, top: 0, width: 3440, height: 1392 } };
