# TODO

## Decisions needing review

Guesses made on autopilot (2026-10-24), each cheap to undo.

- **Keep awake is `Search+S`** (2026-10-31), as tide's and tilemo's
  `Super+S`, though chromeOS has select to speak there, and whether the
  Shortcuts app can remove it is untried. The alternative is `Search+P`,
  free, which tide gave presenter mode. Reversible: the command's
  description in `manifest.json`; Chrome binds no key for it either way.
- **`Search+S` shows nothing but the cup and the toolbar tooltip**
  (2026-10-31): tide's OSD has no equivalent, and a notification would
  cost the `notifications` permission's install warning, which disables an
  installed tileco until the warning is accepted. The alternative is that
  notification, or flashing the toolbar badge. Reversible: `toggle` in
  `src/keepawake.js`.
- **No presenter mode** (2026-10-31): tide's `Super+P` is keep awake plus
  Do not disturb, and an extension can't reach chromeOS's Do not disturb.
  The alternative is a presenter command that holds keep awake alone, as
  tide does without its notification server. Reversible: a command.
- **The bar's logo is tide's two waves, not tileco's own icon**
  (2026-10-31), so the bar reads the same on tide, tilemo and tileco;
  tileco's icon stays the toolbar button's and the store's. The
  alternative is a small copy of `icons/tileco.svg`. Reversible: the SVG
  in `src/launcher.html`.
- **The bar's middle stays a dead space** (2026-10-31): tileco's title
  does nothing on a click, so the room between the chips and the clocks
  isn't given to either; the clocks reach 7px left, half their own gap.
  The alternative is to split that room between the layout symbol and the
  clocks. Reversible: `#clocks::before` in `launcher.css`.
- **Hover is a translucent overlay, darker in light and lighter in dark**
  (2026-10-31): `--hover` is black at 8% on the light bar and white at
  10% on the dark one, since a darker gray doesn't show on a near-black
  bar. It tints a current (accent) chip too. The alternative is opaque
  grays per theme, which would hide a chip's own color. Reversible: the
  `--hover` token in `launcher.css`.
- **No `AGENTS.md` in tileco yet.** The sibling repos each have one; tileco
  follows their shared conventions (tide's especially) without its own copy.
  The alternative is a short one pointing at `SPEC.md` and those
  conventions. Reversible: add the file.
- **Plain Node, no build step, and no runtime dependencies.** Tests use
  `node --test` on Node 22 (CI pins major 22), ES modules throughout, so the
  extension loads the same files it tests. Playwright is the one dev
  dependency, for the smoke test (maintainer, 2026-10-24). The alternative
  is TypeScript or a bundler. Reversible: nothing yet depends on the
  toolchain.
- **The four suggested keys are `Search+J`, `Search+K`, `Search+Space` (the
  dashboard) and `Search+Tab`**, each with an `Alt+Shift+` default so the
  manifest installs off chromeOS too. Attention's default is `Alt+Shift+U`,
  not `Alt+Shift+Tab`, which Windows and most Linux desktops take for window
  switching. `Search+.` (next layout) lost its suggestion to make room.
  Swap-with-master moved off `Search+Space` to `Search+Shift+M`, bound by
  hand; `Search+Z` was the first idea, but it's chromeOS's layout menu.
  Reversible: edit `manifest.json`.
- **A maximized or fullscreen window on a workspace you leave is minimized
  like the rest, and comes back normal**, losing its maximize. The
  alternative is remembering the state and restoring it. Reversible: a
  per-window field.
- **An app key with no window opens the site in a `popup` window**, which
  tileco then tiles and finds as the app's. It never tries
  `chrome.management.launchApp`, which SPEC.md §9.1 leaves unverified for
  web apps. An installed web app's own window is still found and focused.
  The alternative is launching the installed app. Reversible: one function.
- **A page's first title report sets its baseline and marks nothing**, so
  opening, reloading or switching accounts in Gmail with old unread mail
  doesn't mark it; only a rise tileco sees marks. The alternative marks any
  nonzero first count.
  Reversible: one line in `Tileco.title`.
- **Gmail, Chat and Calendar are always watched**, in the manifest's
  `content_scripts`; the options page adds other sites, each with its own
  host permission asked for on that Chromebook, and the same title watcher
  registered at runtime. Settings sync but grants don't, so a site added on
  one Chromebook shows "needs access here" on the next. Only https sites.
  The alternative is making the built-in three removable. Reversible:
  `src/watchers.js`.
- **Granting all-sites access turns the dim on**, and the switch is under
  Extras in the settings. The dashboard only offers it, with the other
  extras, until you dismiss the offer; its prompt takes focus and closes the
  dashboard, so tileco treats the grant itself as the switch. Turning it off
  undims every page, then gives the access back. Revoking the access at
  `chrome://extensions` instead leaves pages dimmed until they reload, since
  tileco can no longer reach them. The alternative is a separate stored
  setting. Reversible: `Tileco.dimOn` and the settings' Extras list.
- **The clock detail opens on a click** of the dashboard's clocks, and is
  always open on the home page, where there's room. Day is 07–19 and work is
  09–17 in every zone, and the DST note looks three weeks ahead. Zone
  abbreviations come from a small built-in table of common zones, since
  Chrome names London "GMT+1"; others show Chrome's form. The alternatives
  are an always-open detail and settings for the hours. Reversible:
  `src/launcherview.js` and `src/clocks.js`.
- **The launcher's ranking**: a home-grown fuzzy match (letters in order,
  word starts and runs score higher), ties broken by `tab.lastAccessed`, and
  a query with no match in its scope searching both. Tabs only, not windows
  as such, since every window's tabs are listed. The alternative is a
  library such as fzf's algorithm. Reversible: `src/launcher.js`.
- **The dashboard opens full screen every time**, not as Chrome's toolbar
  popup. If chromeOS shows its full-screen bubble on each open, a large
  centered window is the fallback. Reversible: `Tileco.dashboard`.
- **Always-on-top windows aren't tracked at all**: Document
  picture-in-picture and always-on-top popups stay put on every workspace,
  since chromeOS refuses to minimize them. The alternative is tracking them
  as floating windows that stay on one workspace, which can't hide them.
  Reversible: `managed()` in `src/tileco.js`.
- **Secure Shell's popup windows tile**, by its extension ID in a built-in
  list, until the options page has tile and float rules (SPEC.md §5.4).
  Reversible: `TILED_POPUP_ORIGINS`.
- **A restart is when every stored window ID is gone**, and windows match
  by shared tab URLs, closest fit first (SPEC.md §14.2). A session with
  one window whose tabs all changed comes back unmatched, on the showing
  workspace. The alternative is `runtime.onStartup` as the signal, which
  can arrive after the first window event. Reversible: `Tileco.restarted`
  and `src/restart.js`.
- **The wait for restored windows ends at your first command**, not after
  a time. A window that never returns is forgotten then; one opened before
  you press a key, with a matching tab, takes the old window's place. The
  alternative is a timeout. To decide after trying it on a device.
  Reversible: `Tileco.command`.
- **Two restart edge cases are deferred, not fixed** (Codex on PR 14): a
  restored window that closes before the rest return drops the placements
  still waiting, and a window first seen on a placeholder page such as
  `about:blank` is never matched again. Eight findings came from matching
  incrementally; the alternative is rematching every window against a saved
  snapshot on each sync until the first command, which deletes the class.
  To decide after trying restarts on a device. Reversible: `Tileco.restarted`.

- **A restart with no window yet is told from closing them all by
  `chrome.storage.session`** (2026-10-31): a flag set at the first window
  each browser session; a browser restart empties it. Reloading or updating
  tileco empties it too, so a reload with no Chrome window open keeps the
  old places waiting until your first command. The alternative is
  `runtime.onStartup`, which can arrive after the first window event.
  Reversible: `SEEN_KEY` in `src/tileco.js`.

## Later

- **Set the PRO 2 LIGHTSPEED's DPI from Linux** (SPEC.md §19.2, fix 1).
  The mouse keeps its DPI in onboard profile memory, so a setting written
  there carries to the Chromebook. Solaar 1.1.20 refuses it: "no onboard
  profiles that Solaar supports". Findings from the mouse (2026-10-25):
  - It has `ONBOARD PROFILES {8100}`. Its description is
    `01 07 01 05 01 08 10 00ff 0a`: writable flash (`01`), but profile
    **format 7**, and Solaar's `OnboardProfiles.from_device` accepts 1–5
    only. Five profile slots, 8 buttons, 255-byte profiles.
  - No user profiles yet: the flash header (`hdr0`) is all `ff`, and it
    runs its ROM profile at sector `0x0101`.
  - With the format check relaxed, `bin/solaar profiles` reads it but
    misplaces the fields. Format 7's DPI table starts at byte 4 as five
    steps of X u16, Y u16 and one more byte, probably lift-off distance:
    400, 800 (current), 1600, 3200, 6400. Formats ≤5 have five plain u16s.
    The button table also sits about 16 bytes later.

  Plan, a Solaar PR (pwr-Solaar/Solaar):
  1. Map the whole format-7 profile: dump the ROM profile's raw sector,
     and check each field against what G HUB or the mouse shows (report
     rate, DPI steps, buttons, lighting, name, checksum).
  2. Add a format-7 decoder and encoder beside the existing one in
     `lib/logitech_receiver/hidpp20.py`, with a unit test from the dump.
  3. Test on the mouse: copy the ROM profile into a flash sector, change
     one DPI step to 1600, write it, power-cycle, read back, then check
     the Chromebook. The CRC protects against a bad write; the mouse falls
     back to ROM.
  4. Ask before opening the PR upstream; it posts under your account.

  Until then: a DPI button under the mouse, if it has one, steps through
  the profile's 400–6400; or G HUB once on Windows or a Mac.

- Frame offsets (SPEC.md §5.3): tiles use the bounds as given; measuring
  and correcting each window type's frame waits for a device.
- Profile keys (SPEC.md §9.2).
- Check the setup checklist's `chrome://os-settings` addresses on a
  Chromebook: desktop Chromium has no such pages, so they're unverified.
- Upload each release to the Chrome Web Store from the `release` workflow,
  through the Chrome Web Store API: it needs the listing created by hand
  first, and an OAuth client ID, secret and refresh token as repository
  secrets.
