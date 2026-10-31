# Testing and publishing tileco

How to try a change on a Chromebook, then publish it on the Chrome Web
Store. The store steps are from memory of how the store worked through
2026. Where the dashboard says otherwise, it's right and this file is out of
date; fix the file.

## 1. Test before a Chromebook

From a checkout, on any Linux or macOS machine with Node 22:

```sh
make lint    # every script parses
make test    # the node tests, with a fake chrome.* (SPEC.md §17)
npm ci       # once, for the smoke test
npx playwright install chromium   # once
make smoke   # loads the extension in Chromium and opens its pages
```

CI runs the same three on every pull request. The smoke test can't show
tiling, workspaces or keys: desktop Chromium has no chromeOS window
manager. Those need a Chromebook.

## 2. Load it on a Chromebook

Chrome loads an extension from a folder, as it is. There's no build step.

1. Get the files onto the Chromebook, in a folder the Files app can see:
   - **From GitHub:** open the repository, then **Code › Download ZIP**,
     and unzip it in the Files app. This gives you `main`. For a branch,
     switch to it on GitHub first.
   - **From Linux (Crostini):** `git clone` it into your Linux home, which
     the Files app shows as **Linux files**.
2. Open `chrome://extensions` and turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose the folder that holds
   `manifest.json`.
4. Bind the keys at `chrome://extensions/shortcuts`. Chrome binds four
   when it installs tileco; the options page's **Keys** list says which of
   the rest are still to do.
5. Open tileco's options (right-click its toolbar icon › **Options**) and
   work through the **Setup checklist**.

To try a change: update the folder (unzip again, or `git pull`), then click
the reload arrow on tileco's card in `chrome://extensions`. Reloading resets
tileco's worker, not your settings.

To see errors: on tileco's card, **Errors** lists what the worker threw, and
**Inspect views › service worker** opens its console. A page's own console
is the usual DevTools (Ctrl+Shift+J) on that page.

What to check by hand, since no test can: tiling on each display,
workspace keys, sending a window, the home page on an empty workspace,
Search+Space, the dim, and that Android and Linux windows are left alone.

## 3. Before the first upload

What the first upload needs:

- **Icons.** Done: `icons/tileco.svg` (three columns under a bar of
  workspaces and a clock, a T), rendered to the 16, 32, 48 and 128 px PNGs
  the manifest names. After changing the SVG, `make icons` renders them
  again. The store's own listing icon is the 128 px one.
- **A privacy policy URL.** Done: [docs/privacy.md](docs/privacy.md),
  which GitHub Pages serves from `docs/` at
  `https://mikelward.github.io/tileco/privacy`. Give the store that URL. It
  says what tileco reads, keeps and sends, including that Chrome Sync copies
  the shared settings to your Google account when Sync is on. Update it
  when tileco starts reading or keeping something new.
- **Screenshots.** At least one, 1280×800 or 640×400. Take them on the
  Chromebook (Search+Ctrl+Show windows takes a screenshot).
- **A developer account.** Register at the
  [Chrome Web Store developer dashboard](https://chrome.google.com/webstore/devconsole)
  with your Google account. It takes a one-time registration fee, $5 when
  last checked, and the account needs 2-Step Verification.

## 4. Package it

The store takes a ZIP with `manifest.json` at its top level, which GitHub's
**Download ZIP** isn't: that wraps everything in a `tileco-main/` folder and
includes the tests. Build the store's from a checkout:

```sh
make zip     # dist/tileco-<version>.zip; `unzip -l` it to see what went in
```

The version is automatic: the number of commits, so `46` for the 46th.
Chrome takes a version of one to four numbers, and every commit on `main` is
a higher version than the last, as the store requires of an update (46 is
higher than the first release's 0.1.0). `manifest.json` holds a placeholder,
`0`, which is what an unpacked copy shows. Counting
needs the whole history, so `make zip` refuses a shallow clone; run
`git fetch --unshallow` first. `make version` prints the version.

Or let GitHub build it: every merge to `main` is released. The `release`
workflow runs the tests, builds the ZIP and publishes it as release
`v<version>`, tag included, under **Releases** on the repository page.
Running the workflow by hand (**Actions › release › Run workflow**) builds
the ZIP as a download on that run instead, without a release.

## 5. Upload and submit

In the [developer dashboard](https://chrome.google.com/webstore/devconsole):

1. **New item** (or, for an update, the item's **Package** tab ›
   **Upload new package**), and choose the ZIP.
2. **Store listing:** the description (README.md's first paragraph is a
   start), category (Productivity, or Tools), language, the icon and the
   screenshots.
3. **Privacy:**
   - **Single purpose:** "Tiles and arranges Chrome and web app windows on
     chromeOS into workspaces, as a tiling window manager does."
   - **Permission justifications**, one each:
     - `storage`: settings, and the workspace state that survives a
       restart.
     - `system.display`: each display's work area, to lay out windows.
     - `scripting`: the unread-count script on sites you allow, and the
       shade that dims inactive windows.
     - `power`: keep awake, which holds the display on while you've
       turned it on, until you turn it off or the browser restarts.
     - Optional `tabs`: tab titles and URLs, for the launcher's tab search,
       for matching windows after a restart, and for recognizing Secure
       Shell's windows. Asked for only when you allow tab search.
     - Optional host access to each site in the unread counts list, Gmail,
       Chat and Calendar to start with: its unread count, from the page
       title. Asked for only when you allow it.
     - Optional all-sites access: dimming inactive windows, asked for only
       when you turn it on.
   - **Remote code:** no. tileco runs only the code in its package.
   - **Data use:** tileco sends nothing to its developer or anyone else.
     Chrome Sync carrying the shared settings is Chrome's, not tileco's, but
     the privacy policy says so. Then tick the certifications.
4. **Distribution:** **Unlisted** to try a published build first (only
   people with the link can install it), or **Public**. **Private** limits
   it to listed testers.
5. **Submit for review.** Reviews have taken from a day to a few weeks.
   Broad host permissions slow them down. tileco asks for all-sites access
   only as an optional permission, which helps.

tileco's item ID is `ajcfbfgjfglgofbepnkiimmmnaidfedl`, and it keeps it for
every update. Its store page is
<https://chromewebstore.google.com/detail/ajcfbfgjfglgofbepnkiimmmnaidfedl>,
which answers "not found" until the first submission is published.

Once it's published, a Chromebook installs it from the store like any
extension, and updates arrive on their own within a few hours of approval.
Remove the unpacked copy from `chrome://extensions` first, or you'll have
two tilecos fighting over the same windows.
