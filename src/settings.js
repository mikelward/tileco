// Settings (SPEC.md §13): the shared ones in chrome.storage.sync, per-machine
// overrides in chrome.storage.local, merged key by key. A bad value is an
// error naming the setting, and that setting keeps its default.

import { APP_COMMANDS, DEFAULT_APPS } from "./apps.js";
import { checkZone, DAY, DEFAULT_CLOCKS, WORK } from "./clocks.js";
import { DEFAULT_SITES } from "./unread.js";

export const SETTINGS_KEY = "settings";

// What follows you to every Chromebook, in storage.sync, and what each one
// keeps for its own displays, in storage.local.
export const SHARED = ["clocks", "day", "work", "apps", "dimStrength", "watched", "defaultMode", "modes"];
export const PER_MACHINE = ["singleRules", "ultrawideAspect", "wheelStep", "startup"];

export function pick(settings, keys) {
  return Object.fromEntries(keys.filter((k) => k in settings).map((k) => [k, settings[k]]));
}

export const DEFAULT_SETTINGS = {
  clocks: DEFAULT_CLOCKS,
  day: DAY,
  work: WORK,
  apps: DEFAULT_APPS,
  dimStrength: 0.1,
  // Sites whose unread counts tileco shows (§10.3).
  watched: DEFAULT_SITES,
  // The layout a workspace starts in, by its display's aspect (§5.2), and
  // each layout's main share and main-window count, in tide's names.
  defaultMode: { normal: "tile", ultrawide: "threecol" },
  modes: {
    tile: { mfact: 0.55, nmaster: 1 },
    threecol: { mfact: 0.5, nmaster: 1 },
    twocol: { mfact: 0.72, nmaster: 2 },
  },
  // Per machine, as they depend on its displays (§5.2).
  singleRules: [{ minAspect: 2.1, width: 0.8 }],
  ultrawideAspect: 2.1,
  // The mouse wheel's step per click, re-applied from crosh at each login
  // (§19.2); null for no reminder.
  wheelStep: null,
  // Web addresses opened at login, in order (§13.1). Per
  // machine, as tide's startup.local.json is.
  startup: [],
};

function checkClocks(clocks) {
  if (!Array.isArray(clocks)) throw new Error("must be a list");
  return clocks.map((c, i) => {
    const at = `clock ${i + 1}`;
    if (typeof c !== "object" || c === null) throw new Error(`${at} must be an object`);
    if (typeof c.zone !== "string" || !c.zone) throw new Error(`${at} has no zone`);
    try {
      checkZone(c.zone);
    } catch (e) {
      throw new Error(`${at}: ${e.message}`);
    }
    const label = typeof c.label === "string" ? c.label.trim() : "";
    if (!label) throw new Error(`${at} has no label`);
    if (label.length > 4) throw new Error(`${at}'s label "${label}" is longer than 4 letters`);
    const clock = { zone: c.zone, label };
    if (typeof c.city === "string" && c.city.trim()) clock.city = c.city.trim();
    return clock;
  });
}

function checkHours(hours) {
  if (!Array.isArray(hours) || hours.length !== 2 || !hours.every((h) => Number.isInteger(h))) {
    throw new Error("must be two whole hours, like [9, 17]");
  }
  const [from, to] = hours;
  if (from < 0 || to > 24 || from >= to) throw new Error(`${from}–${to} isn't a span within 0–24`);
  return [from, to];
}

// Each app key's app. The keys themselves are fixed in the manifest, so an
// app names one of them; a key with no app does nothing.
function checkApps(apps) {
  if (!Array.isArray(apps)) throw new Error("must be a list");
  const seen = new Set();
  // Tabs belong to an app by their origin (§9.4), so two apps can't share one.
  const origins = new Map();
  return apps.map((a, i) => {
    const at = `app ${i + 1}`;
    if (typeof a !== "object" || a === null) throw new Error(`${at} must be an object`);
    if (!APP_COMMANDS.includes(a.command)) throw new Error(`${at}'s command must be one of ${APP_COMMANDS.join(", ")}`);
    if (seen.has(a.command)) throw new Error(`${at}: ${a.command} has two apps`);
    seen.add(a.command);
    const name = typeof a.name === "string" ? a.name.trim() : "";
    if (!name) throw new Error(`${at} has no name`);
    let url;
    try {
      url = new URL(a.url);
    } catch {
      throw new Error(`${at}'s address "${a.url ?? ""}" isn't a URL`);
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error(`${at}'s address must be a website`);
    if (origins.has(url.origin)) throw new Error(`${at}: ${url.origin} is already ${origins.get(url.origin)}'s site`);
    origins.set(url.origin, at);
    return { command: a.command, name, url: url.href };
  });
}

function checkAspect(aspect, at = "") {
  if (typeof aspect !== "number" || !Number.isFinite(aspect) || aspect < 1 || aspect > 10) {
    throw new Error(`${at}${aspect} isn't an aspect ratio from 1 to 10, like 2.1`);
  }
  return aspect;
}

// The lone window's width fraction from each aspect ratio up (§5.2).
function checkSingleRules(rules) {
  if (!Array.isArray(rules)) throw new Error("must be a list");
  return rules.map((r, i) => {
    const at = `rule ${i + 1}: `;
    if (typeof r !== "object" || r === null) throw new Error(`${at}must be an object`);
    const minAspect = checkAspect(r.minAspect, at);
    if (typeof r.width !== "number" || !(r.width >= 0.1 && r.width <= 1)) {
      throw new Error(`${at}width ${r.width} isn't a fraction from 0.1 to 1, like 0.8`);
    }
    return { minAspect, width: r.width };
  });
}

function checkStrength(strength) {
  if (typeof strength !== "number" || !(strength >= 0.02 && strength <= 0.5)) {
    throw new Error(`${strength} isn't a strength from 0.02 to 0.5 (2% to 50%), like 0.1`);
  }
  return strength;
}

function checkWatched(sites) {
  if (!Array.isArray(sites)) throw new Error("must be a list");
  return [
    ...new Set(
      sites.map((site, i) => {
        let url;
        try {
          url = new URL(site);
        } catch {
          throw new Error(`site ${i + 1}, "${site}", isn't a URL`);
        }
        if (url.protocol !== "https:") throw new Error(`site ${i + 1}, "${site}", must be https`);
        return url.origin;
      }),
    ),
  ];
}

function checkStartup(addresses) {
  if (!Array.isArray(addresses)) throw new Error("must be a list");
  const seen = new Set();
  return addresses.map((a, i) => {
    let url;
    try {
      url = new URL(typeof a === "string" ? a.trim() : a);
    } catch {
      throw new Error(`address ${i + 1}, "${a}", isn't a URL`);
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error(`address ${i + 1}, "${a}", must be a website`);
    if (seen.has(url.href)) throw new Error(`address ${i + 1}, ${url.href}, is listed already`);
    seen.add(url.href);
    return url.href;
  });
}

function checkWheelStep(step) {
  if (step === null) return null;
  if (typeof step !== "number" || !(step >= 1 && step <= 1000)) {
    throw new Error(`${step} isn't a step from 1 to 1000, like 200, or null for none`);
  }
  return step;
}

export const START_MODES = ["tile", "threecol", "twocol", "monocle"];

// Objects merge key by key onto what's there (§13), as tide's do.
function checkObject(value, keys) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("must be an object");
  const unknown = Object.keys(value).filter((k) => !keys.includes(k));
  if (unknown.length > 0) throw new Error(`${unknown.join(", ")} isn't one of ${keys.join(", ")}`);
}

function checkDefaultMode(value, current) {
  checkObject(value, ["normal", "ultrawide"]);
  for (const [k, mode] of Object.entries(value)) {
    if (!START_MODES.includes(mode)) throw new Error(`${k} must be ${START_MODES.join(", ")}, not ${mode}`);
  }
  return { ...current, ...value };
}

// Monocle has neither; tile alone can have no main window.
const MIN_MASTERS = { tile: 0, threecol: 1, twocol: 1 };

function checkModes(value, current) {
  checkObject(value, Object.keys(MIN_MASTERS));
  const modes = structuredClone(current);
  for (const [mode, o] of Object.entries(value)) {
    checkObject(o, ["mfact", "nmaster"]);
    if ("mfact" in o && (typeof o.mfact !== "number" || !(o.mfact >= 0.1 && o.mfact <= 0.9))) {
      throw new Error(`${mode}.mfact ${o.mfact} isn't a fraction from 0.1 to 0.9, like 0.55`);
    }
    if ("nmaster" in o && (!Number.isInteger(o.nmaster) || o.nmaster < MIN_MASTERS[mode] || o.nmaster > 100)) {
      throw new Error(`${mode}.nmaster ${o.nmaster} isn't a whole number from ${MIN_MASTERS[mode]} to 100`);
    }
    modes[mode] = { ...modes[mode], ...o };
  }
  return modes;
}

const CHECKS = { clocks: checkClocks, day: checkHours, work: checkHours, apps: checkApps, singleRules: checkSingleRules, ultrawideAspect: (a) => checkAspect(a), dimStrength: checkStrength, watched: checkWatched, defaultMode: checkDefaultMode, modes: checkModes, wheelStep: checkWheelStep, startup: checkStartup };

// Settings from what's stored: `sync` then `local`, each an object or
// undefined. Returns {settings, errors}, an error for each bad or unknown
// setting, which keeps its default.
export function resolve(sync, local) {
  const settings = structuredClone(DEFAULT_SETTINGS);
  const errors = [];
  for (const source of [sync, local]) {
    if (source === undefined || source === null) continue;
    if (typeof source !== "object" || Array.isArray(source)) {
      errors.push("settings must be an object");
      continue;
    }
    for (const [key, value] of Object.entries(source)) {
      if (!(key in CHECKS)) {
        errors.push(`unknown setting: ${key}`);
        continue;
      }
      try {
        settings[key] = CHECKS[key](value, settings[key]);
      } catch (e) {
        errors.push(`${key}: ${e.message}`);
      }
    }
  }
  return { settings, errors };
}

// Whether a storage.onChanged batch touched the settings, rather than only
// tileco's own state.
export function settingsChanged(changes) {
  return SETTINGS_KEY in changes;
}

// The settings as stored for this machine. `storage` is chrome.storage.
export async function load(storage) {
  const [sync, local] = await Promise.all([storage.sync.get(SETTINGS_KEY), storage.local.get(SETTINGS_KEY)]);
  return resolve(sync[SETTINGS_KEY], local[SETTINGS_KEY]);
}
