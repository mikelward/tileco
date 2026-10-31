// The smoke test (SPEC.md §17): loads the unpacked extension in Chromium and
// opens its pages, which the node tests can't reach. Tiling, workspaces and
// keys need chromeOS's windows, so FakeChrome covers those instead.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const EXTENSION = fileURLToPath(new URL("..", import.meta.url));

let context;
let worker;
let base;

before(async () => {
  context = await chromium.launchPersistentContext("", {
    headless: false,
    args: ["--headless=new", `--disable-extensions-except=${EXTENSION}`, `--load-extension=${EXTENSION}`],
  });
  worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  base = new URL(".", worker.url()).href.replace(/src\/$/, "");
});

after(async () => {
  await context?.close();
});

// Opens one of the extension's pages, failing on any error it throws.
async function open(path) {
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base + path);
  return { page, errors };
}

test("the background worker starts", async () => {
  assert.match(worker.url(), /^chrome-extension:\/\/[a-p]{32}\//);
  // It answers once its module has loaded and its listeners are in place.
  assert.equal(await worker.evaluate(() => typeof chrome.commands.onCommand.hasListeners), "function");
  assert.equal(await worker.evaluate(() => chrome.commands.onCommand.hasListeners()), true);
});

test("the options page renders every section and saves changes", async () => {
  const { page, errors } = await open("src/options.html");
  await page.waitForSelector("#setup li");
  const headings = await page.locator("h2").allInnerTexts();
  for (const h of ["Extras", "Clocks", "Setup checklist", "Keys", "Apps", "Unread counts", "Dim", "Workspaces", "Layouts on this Chromebook", "Mouse on this Chromebook", "Import and export"]) {
    assert.ok(headings.includes(h), `no ${h} section in ${headings}`);
  }
  assert.ok((await page.locator("#clocks tbody tr").count()) > 0, "no clocks");
  assert.ok((await page.locator("#keys tbody tr").count()) > 0, "no keys");
  assert.ok((await page.locator("#modes tbody tr").count()) > 0, "no layouts");
  // Nothing is allowed yet, so every extra offers to be.
  await page.waitForSelector("#permissions li");
  assert.deepEqual(await page.locator("#permissions li button").allInnerTexts(), ["Allow", "Allow", "Allow"]);
  assert.equal(await page.locator("#watched li").count(), 3, "Gmail, Chat and Calendar to start with");
  assert.match(await page.locator("#watched").innerText(), /not allowed yet/);
  await page.locator("#dim-strength").fill("20");
  await page.locator("#dim-strength").dispatchEvent("change");
  await page.waitForFunction(async () => (await chrome.storage.sync.get("settings")).settings?.dimStrength === 0.2);

  await page.locator("#wheel-step").fill("200");
  await page.locator("#wheel-step").dispatchEvent("change");
  await page.waitForFunction(async () => (await chrome.storage.local.get("settings")).settings?.wheelStep === 200);

  await page.locator("#setup input[type=checkbox]").first().check();
  await page.waitForFunction(async () => ((await chrome.storage.local.get("setup")).setup ?? []).length === 1);

  assert.deepEqual(errors, []);
  assert.equal(await page.locator("#errors").isHidden(), true, await page.locator("#errors").innerText());
});

test("the settings open pages in their own window", async () => {
  const page = await context.newPage();
  await page.addInitScript(() => {
    window.opened = [];
    chrome.tabs.create = async (props) => window.opened.push(props);
  });
  await page.goto(base + "src/options.html");
  await page.waitForSelector("#setup li button");
  await page.locator("#setup li button").first().click();
  await page.locator("#open-shortcuts").click();
  await page.waitForFunction(() => window.opened.length === 2);
  const here = await page.evaluate(async () => (await chrome.windows.getCurrent()).id);
  for (const o of await page.evaluate(() => window.opened)) assert.equal(o.windowId, here, o.url);
});

test("turning off Gmail, Chat and Calendar takes them out of the list", async () => {
  // As with all sites allowed for dimming, which keeps their access: Chrome
  // grants only from a real click, so the page's view of it is faked.
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(() => {
    chrome.permissions.contains = async () => true;
    chrome.permissions.remove = async () => true;
  });
  await page.goto(base + "src/options.html");
  await page.waitForFunction(() => document.querySelectorAll("#permissions li button")[1]?.textContent === "Turn off");
  await page.locator("#permissions li button").nth(1).click();
  await page.waitForFunction(async () => (await chrome.storage.sync.get("settings")).settings?.watched?.length === 0);
  await page.waitForFunction(() => document.querySelectorAll("#permissions li button")[1]?.textContent === "Allow");
  assert.deepEqual(errors, []);
  await worker.evaluate(() => chrome.storage.sync.remove("settings"));
});

for (const mode of ["home", "dashboard"]) {
  test(`the ${mode} page renders the bar, clocks and launcher`, async () => {
    const { page, errors } = await open(`src/launcher.html?mode=${mode}`);
    await page.waitForSelector("#clocks li");
    assert.ok(await page.locator("#query").isVisible(), "no launcher");
    if (mode === "dashboard") await page.locator("#clocks").click();
    await page.waitForSelector(".calendar .days");
    const month = await page.locator(".calendar .month strong").innerText();
    await page.locator('[aria-label="Next month"]').click();
    assert.notEqual(await page.locator(".calendar .month strong").innerText(), month, "the calendar didn't step");
    assert.deepEqual(errors, []);
  });
}

// Every point of the bar's logo, chips and clocks, top to bottom, reaches
// one of them: none lands on the bar between or around them.
test("a click anywhere on the bar's logo, chips or clocks reaches one", async () => {
  const { page, errors } = await open("src/launcher.html?mode=dashboard");
  await page.waitForSelector("#clocks li");
  await page.waitForSelector("#workspaces button");
  const dead = await page.evaluate(() => {
    const chips = document.querySelectorAll("#workspaces button");
    const clocks = document.getElementById("clocks");
    const bar = document.querySelector(".bar").getBoundingClientRect();
    const spans = [
      [bar.left, chips[chips.length - 1].getBoundingClientRect().right, (e) => e.closest("#logo, #workspaces button")],
      [clocks.getBoundingClientRect().left, bar.right, (e) => e.closest("#clocks")],
    ];
    const out = [];
    for (const [from, to, owner] of spans) {
      for (let x = Math.ceil(from); x < to; x++) {
        for (const y of [bar.top, (bar.top + bar.bottom) / 2, bar.bottom - 1]) {
          const e = document.elementFromPoint(x, y);
          if (!e || !owner(e)) out.push(`${x},${y}`);
        }
      }
    }
    // The scope chips meet, too.
    const [launch, tabs] = document.querySelectorAll(".scopes button");
    const y = (launch.getBoundingClientRect().top + launch.getBoundingClientRect().bottom) / 2;
    for (let x = Math.ceil(launch.getBoundingClientRect().left); x < tabs.getBoundingClientRect().right; x++) {
      if (!document.elementFromPoint(x, y)?.closest(".scopes button")) out.push(`scopes ${x},${y}`);
    }
    return out;
  });
  assert.deepEqual(dead.slice(0, 10), [], `${dead.length} dead points`);
  // Under the pointer, even at the bar's corner outside the logo itself,
  // the logo's whole target shows, and still takes the click there.
  await page.mouse.move(0, 0);
  const first = await page.evaluate(() => {
    const logo = document.getElementById("logo");
    const shown = getComputedStyle(logo, "::after");
    return {
      background: shown.backgroundColor,
      top: shown.top,
      left: shown.left,
      corner: document.elementFromPoint(0, 0)?.closest("#logo") === logo,
    };
  });
  assert.notEqual(first.background, "rgba(0, 0, 0, 0)", "no hover shown");
  assert.deepEqual([first.top, first.left], ["-5px", "-8px"], "the whole target, not the logo");
  assert.ok(first.corner, "hovering rounds the shape but loses no clicks");
  // Above the clocks' line of text, in their target.
  const row = await page.locator("#clocks").boundingBox();
  await page.mouse.move(row.x + row.width / 2, 1);
  const clocks = await page.evaluate(() => getComputedStyle(document.getElementById("clocks"), "::after").backgroundColor);
  assert.notEqual(clocks, "rgba(0, 0, 0, 0)", "the clocks row shows as one");
  assert.deepEqual(errors, []);
});

test("the bar's cup turns keep awake on and off, and says which", async () => {
  const { page, errors } = await open("src/launcher.html?mode=dashboard");
  const cup = page.locator("#keep-awake");
  await page.waitForSelector("#clocks li");
  assert.equal(await cup.getAttribute("aria-pressed"), "false");
  assert.equal(await cup.getAttribute("title"), "Not keeping awake");
  await cup.click();
  await page.waitForFunction(() => document.getElementById("keep-awake").getAttribute("aria-pressed") === "true");
  assert.equal(await cup.getAttribute("title"), "Keeping awake");
  assert.equal(await worker.evaluate(async () => (await chrome.storage.session.get("keepAwake")).keepAwake), true);
  // Its target meets the clocks', so the gap between them is no dead click.
  const gap = await page.evaluate(() => {
    const c = document.getElementById("keep-awake").getBoundingClientRect();
    const k = document.getElementById("clocks").getBoundingClientRect();
    const out = [];
    for (let x = Math.ceil(c.right); x < k.left; x++) {
      const e = document.elementFromPoint(x, (c.top + c.bottom) / 2);
      if (!e?.closest("#keep-awake, #clocks")) out.push(x);
    }
    return out;
  });
  assert.deepEqual(gap, [], "dead points between the cup and the clocks");
  await cup.click();
  await page.waitForFunction(() => document.getElementById("keep-awake").getAttribute("aria-pressed") === "false");
  assert.deepEqual(errors, []);
});

test("the logo closes the dashboard, and takes home's launcher back to Launch", async () => {
  const { page, errors } = await open("src/launcher.html?mode=dashboard");
  await page.waitForSelector("#clocks li");
  await page.evaluate(() => {
    window.closes = 0;
    window.close = () => window.closes++;
  });
  await page.locator("#logo").click();
  assert.equal(await page.evaluate(() => window.closes), 1);
  const home = await open("src/launcher.html?mode=home");
  await home.page.waitForSelector("#clocks li");
  await home.page.locator('.scopes [data-scope="tabs"]').click();
  await home.page.locator("#query").fill("x");
  await home.page.locator("#logo").click();
  assert.equal(await home.page.locator('.scopes [aria-selected="true"]').innerText(), "Launch");
  assert.equal(await home.page.locator("#query").inputValue(), "");
  assert.ok(await home.page.evaluate(() => document.activeElement?.id === "query"), "ready to type");
  assert.deepEqual([...errors, ...home.errors], []);
});

test("the footer names only the keys that work in each scope", async () => {
  const { page, errors } = await open("src/launcher.html?mode=dashboard");
  await page.waitForSelector("#results li");
  assert.equal(await page.locator("#keys").innerText(), "Enter to run · ↑ ↓ to choose · Tab to switch to Tabs · Esc to clear or close");
  await page.locator('.scopes [data-scope="tabs"]').click();
  assert.equal(await page.locator("#keys").innerText(), "Enter to allow tab search · Tab to switch to Launch · Esc to clear or close");
  assert.deepEqual(errors, []);
});

test("without tab access, the dashboard opens on Launch and offers tab search", async () => {
  const { page, errors } = await open("src/launcher.html?mode=dashboard");
  await page.waitForSelector("#results li");
  assert.equal(await page.locator('.scopes [aria-selected="true"]').innerText(), "Launch");
  await page.locator('.scopes [data-scope="tabs"]').click();
  assert.deepEqual(await page.locator("#results .title").allInnerTexts(), ["Allow tab search"]);
  assert.deepEqual(errors, []);
});

test("the dashboard offers the extras still off until you dismiss it", async () => {
  const { page, errors } = await open("src/launcher.html?mode=dashboard");
  await page.waitForSelector("#extras li");
  assert.deepEqual(await page.locator("#extras li strong").allInnerTexts(), [
    "Find any tab in a keystroke",
    "Show unread counts for Gmail, Chat and Calendar",
    "Dim inactive windows",
  ]);
  await page.locator("#dismiss-extras").click();
  assert.equal(await page.locator("#extras").isHidden(), true);
  const again = await open("src/launcher.html?mode=dashboard");
  await again.page.waitForSelector("#clocks li");
  assert.equal(await again.page.locator("#extras").isHidden(), true, "dismissed stays dismissed");
  const home = await open("src/launcher.html?mode=home");
  await home.page.waitForSelector("#clocks li");
  assert.equal(await home.page.locator("#extras").isHidden(), true, "only on the dashboard");
  assert.deepEqual([...errors, ...again.errors, ...home.errors], []);
  await worker.evaluate(() => chrome.storage.local.remove("extrasDismissed"));
});

test("the dashboard's footer lines up, and its Settings button opens the settings", async () => {
  const page = await context.newPage();
  await page.addInitScript(() => {
    window.optionsOpened = 0;
    chrome.runtime.openOptionsPage = async () => window.optionsOpened++;
  });
  await page.goto(base + "src/launcher.html?mode=dashboard");
  await page.waitForSelector("#clocks li");
  const middle = (sel) => page.locator(sel).evaluate((e) => { const r = e.getBoundingClientRect(); return r.top + r.height / 2; });
  const text = await middle("#keys");
  for (const sel of ["#open-settings"]) assert.ok(Math.abs((await middle(sel)) - text) < 1, `${sel} isn't level with the hint`);
  await page.locator("#open-settings").click();
  await page.waitForFunction(() => window.optionsOpened === 1);
});

test("the dashboard stays open while Chrome asks for an extra's access", async () => {
  const { page, errors } = await open("src/launcher.html?mode=dashboard");
  await page.waitForSelector("#clocks li");
  // Hold the prompt open, and record closes rather than closing.
  await page.evaluate(() => {
    window.answer = null;
    chrome.permissions.request = () => new Promise((resolve) => (window.answer = resolve));
    window.closes = 0;
    window.close = () => window.closes++;
  });
  await page.locator('[aria-label="Allow: Dim inactive windows"]').click();
  await page.waitForFunction(() => window.answer !== null);
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  assert.equal(await page.evaluate(() => window.closes), 0, "closed under the prompt");
  await page.evaluate(() => window.answer(false));
  await page.waitForFunction(() => document.activeElement?.id === "query");
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  assert.equal(await page.evaluate(() => window.closes), 1, "didn't close once answered");
  assert.deepEqual(errors, []);
});

test("clocks on another day line up with the rest", async () => {
  // A day apart in all, so whatever the time, one is on another day.
  const clocks = [
    { zone: "Pacific/Kiritimati", label: "KIR", city: "Kiritimati" },
    { zone: "Pacific/Pago_Pago", label: "PPG", city: "Pago Pago" },
    { zone: "Europe/London", label: "LON", city: "London" },
    { zone: "Asia/Tokyo", label: "TYO", city: "Tokyo" },
  ];
  await worker.evaluate((clocks) => chrome.storage.sync.set({ settings: { clocks } }), clocks);
  try {
    const { page, errors } = await open("src/launcher.html?mode=dashboard");
    await page.waitForSelector("#clocks sup");
    const bottoms = await page.locator("#clocks .label").evaluateAll((labels) => labels.map((l) => l.getBoundingClientRect().bottom));
    assert.ok(bottoms.length >= clocks.length, `${bottoms.length} clocks`);
    assert.ok(Math.max(...bottoms) - Math.min(...bottoms) < 1, `labels at ${bottoms}`);
    assert.deepEqual(errors, []);
  } finally {
    await worker.evaluate(() => chrome.storage.sync.remove("settings"));
  }
});

test("the mouse page fills the mouse's ID into the crosh lines", async () => {
  await worker.evaluate(() => chrome.storage.local.set({ settings: { wheelStep: 200 }, mouseId: 7 }));
  try {
    const { page, errors } = await open("src/mouse.html");
    await page.waitForFunction(() => document.getElementById("line-1").textContent.includes("200"));
    assert.equal(await page.locator("#mouse-id").inputValue(), "7", "the last ID isn't offered");
    assert.equal(await page.locator("#line-1").innerText(), 'gesture_prop set 7 "Mouse Scroll Accel Curve" array:double:200,0,0,0,0');
    await page.locator("#mouse-id").fill("12");
    await page.locator("#mouse-id").dispatchEvent("change");
    assert.match(await page.locator("#line-0").innerText(), /^gesture_prop set 12 "Mouse High Resolution Scrolling"/);
    await page.waitForFunction(async () => (await chrome.storage.local.get("mouseId")).mouseId === 12);
    // A step changed on the options page reaches the open page.
    await worker.evaluate(() => chrome.storage.local.set({ settings: { wheelStep: 300 } }));
    await page.waitForFunction(() => document.getElementById("line-1").textContent.includes("array:double:300,"));
    assert.deepEqual(errors, []);
    assert.equal(await page.locator("#errors").isHidden(), true, await page.locator("#errors").innerText());
  } finally {
    await worker.evaluate(() => chrome.storage.local.remove(["settings", "mouseId"]));
  }
});
