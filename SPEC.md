---
last_modified: 2026-10-26
---

# tileco: design spec (milestone 1)

tileco is tiling on chromeOS, as close to [tide](https://github.com/mikelward/tide)
and the KDE setup in `mikelward/scripts` (`setup-kde`) as a Chromebook allows
without turning off verified boot. It is a **Manifest V3 extension** that tiles
Chrome and installed web app windows, owns its own workspaces, and dims the
windows you're not in. A **checklist** sets the native chromeOS shortcuts and
settings to the tide key map where the OS can do the job better than an
extension can.

This document is milestone 1: what chromeOS allows, the decisions that
follow, and what "done" means for each later milestone. Claims about chromeOS
and Chromium were checked on 2026-10-23 against Chromium `main` at
`a3f88457` (`chrome/VERSION` major 158) and chrometile at `af8e367`, except
where a claim says *(unverified)* or *(secondary)*: those came from release
notes or news reports, and are what M2 checks on a real device first.

Contents:
[Goals](#1-goals) ·
[What chromeOS allows](#2-what-chromeos-allows) ·
[Decisions](#3-decisions) ·
[Feature map](#4-feature-map) ·
[Windows](#5-windows-and-layouts) ·
[Workspaces](#6-workspaces) ·
[Keys](#7-keys) ·
[Status and clocks](#8-status-bar-and-clocks) ·
[Launching](#9-launcher-and-app-keys) ·
[Focus](#10-focus-cue-focus-and-attention) ·
[The rest of the desktop](#11-the-rest-of-the-desktop) ·
[Linux apps](#12-linux-apps-crostini) ·
[Settings](#13-settings) ·
[The extension](#14-the-extension) ·
[Repos](#15-where-things-live) ·
[Milestones](#16-milestones) ·
[Testing](#17-testing) ·
[Open questions](#18-open-questions) ·
[Patches](#19-upstream-patches-and-workarounds) ·
[Googlebook OS](#20-googlebook-os-tidal) ·
[The rest of the setup](#appendix-a-the-rest-of-the-setup)

---

## 1. Goals

**Must have**, each taken from tide's §1 or `setup-kde`:

- dwm/Krohnkite tiling, never BSP: **tile** (master + stack), **three
  columns**, **two columns + stack**, **monocle**. Layout per workspace.
- A lone window centered at **80%** width on an ultrawide, **100%** on 16:9
  or 16:10.
- Nine **workspaces** on `Search+1…9`, sending a window on
  `Search+Shift+1…9`, stepping on `Search+Page Up/Down` (§7.2).
- The tide **key map**, with Search as Super, for every action chromeOS lets
  tileco or the OS bind.
- **Inactive windows dimmed** as the focus cue.
- **App keys**: `Search+G` browser, `Search+T` terminal, `Search+C` Calendar,
  `Search+M` Meet, `Search+Y` YouTube Music, and the rest of tide's letters.
- **Clocks** for SF, NYC and LON beside local time.
- Dialogs and popups **float**; nothing steals focus.

**Non-goals**

- Replacing the chromeOS shell, shelf, lock screen or login. The OS owns them,
  and no third-party API reaches them (§2).
- Tiling Android or Linux windows from the extension. chromeOS doesn't expose
  them (§2.1). Linux apps get their own path (§12).
- Developer mode, custom firmware or a Chromium OS build. Those are the
  [off-ramp](#36-the-off-ramp-run-tide), not tileco.

**Principles**, carried over from tide:

1. **One owner per job.** Where chromeOS already does a job (lock, launcher,
   notifications, screenshots, theme), tileco configures it and stays out.
   tileco owns only what the OS lacks: tiling, workspaces, the dim and clocks.
2. **Every requirement names its mechanism** (§4), and each is checked on a
   device before it's relied on.
3. **State survives the service worker.** MV3 kills an idle worker, so
   nothing tileco knows lives only in memory (§14.2).

## 2. What chromeOS allows

### 2.1 Extensions see Chrome windows, nothing else

- `chrome.windows` lists **Browser-backed windows only**: tabbed windows,
  popups, devtools and **installed web apps**, which report `type: "app"`
  (`chrome/browser/extensions/browser_extension_window_controller.cc`,
  `api/tabs/windows_util.cc`).
- **Android, Linux, Borealis and system windows are never listed.** When one
  of them has focus, `windows.onFocusChanged` reports `WINDOW_ID_NONE`.
- `windows.update` sets `left`, `top`, `width`, `height`, `focused`, `state`
  and `drawAttention`. Bounds can't be combined with minimized, maximized or
  fullscreen. Google's own
  [virtualdesktops-extension](https://github.com/google/virtualdesktops-extension)
  warns that the bounds you get aren't exactly the ones you asked for.
- Picture-in-picture windows report `type: "normal"` (a TODO in the source,
  crbug 438514981), so tileco has to recognize them another way (§5.4).
  Document picture-in-picture and always-on-top popups are `TYPE_FLOATING`:
  `normal` with `alwaysOnTop: true`, and `windows.update` refuses to
  minimize, maximize or full-screen them (`windows_api.cc`). Video
  picture-in-picture isn't a browser window at all, so tileco never sees it.
- `chrome.system.display.getInfo` gives each display's `bounds` and
  `workArea`, which excludes the shelf. Changing the display layout is
  Kiosk-only (`extensions/common/api/system_display.webidl`).
- Lacros ended in 2024 *(secondary:
  [9to5Google](https://9to5google.com/2024/07/12/chromeos-lacros-ending/))*,
  so the one Ash-integrated Chrome is the only browser to target.

### 2.2 Keys work only while a Chrome window has focus

- An extension may ship **at most 4** commands with suggested keys
  (`kMaxCommandsWithKeybindingPerExtension = 4`,
  `extensions/common/api/commands/commands_handler.cc`). It may declare
  any number more, which **you bind by hand** at
  `chrome://extensions/shortcuts`. No API sets them.
- **Global commands don't exist on chromeOS.**
  `GetGlobalAcceleratorListener()` returns `nullptr` there, with the comment
  "Global extension commands are not supported on ChromeOS"
  (`chrome/browser/extensions/extension_commands_global_registry.cc`).
- So every tileco key fires only while a Chrome or web app window is focused.
  It never fires over an Android app, a Linux app, the launcher or an empty
  desk. tileco designs around that (§6.2). Chromium's tip of tree has a new
  chromeOS global-accelerator listener
  (`ui/base/accelerators/global_accelerator_listener/global_accelerator_listener_chromeos.cc`);
  if it ships for extensions, `"global": true` commands could reach past
  these *(unverified: no flag or milestone found)*.
- **In app windows the page sees keys first.** Installed web apps, site
  shortcuts and chromeOS's system apps (`TYPE_APP`, `TYPE_APP_POPUP`) hand
  every key to the page before Chrome's accelerators
  (`BrowserView::PreHandleKeyboardEvent`, `browser_view.cc`), so a page that
  consumes `Search+…`, like a terminal, keeps tileco's keys from firing.
  Browser windows and plain popups run extension commands first.
- OS shortcuts win over extension ones. Search is a valid modifier for
  extension commands on chromeOS only.
- **Only some keys can be bound**: A–Z, 0–9, Comma, Period, the arrows,
  Insert, Delete, Home, End, Page Up, Page Down, Space, Tab and the media
  keys (`ui/base/accelerators/command.cc`, `ParseImpl`). Return, Backspace,
  `\`, `/`, `=`, `-` and `` ` `` are rejected, so five tide keys need new
  combos (§7.1). The shortcuts page enforces the same set
  *(unverified)*.
- An IME extension (`chrome.input.ime`) is not a way round this. It sees
  keys only while it is the active input method **and** a text field has
  focus (`ui/base/ime/ash/input_method_ash.cc`).

### 2.3 The powerful APIs are allowlisted

| API | Would give | Status |
|---|---|---|
| `wmDesksPrivate` | list, switch and move windows between desks | allowlisted to 6 IDs |
| `automation` | the whole desktop's window tree | allowlisted to 4 IDs, "first-party … very trusted" |
| `accessibilityPrivate` | global key interception | allowlisted to 2 IDs |
| `autotestPrivate` | everything | allowlisted to 3 IDs |
| `wallpaper` | set the wallpaper | component only on `main` |
| `enterprise.*` | device info | policy-installed only; nothing for windows |

Paths: `chrome/common/extensions/api/_permission_features.json`,
`extensions/common/api/_manifest_features.json`,
`chromeos/ash/experiences/extensions/common/api/_permission_features.json`.
The allowlists are hashed IDs, so developer mode doesn't open them either.

**Isolated Web Apps** get Window Management, borderless display and Controlled
Frame, but only for **their own** windows; nothing in the web platform moves
another app's window. A consumer can install an unlisted IWA only behind
`kIsolatedWebAppDevMode`, which is off by default
(`chrome/common/chrome_features.cc`).

### 2.4 What chromeOS does natively

From `ash/public/cpp/accelerators.h` and
`ash/webui/shortcut_customization_ui/backend/accelerator_layout_table.cc`.
"Search" is the launcher key.

| Action | Default |
|---|---|
| Launcher | tap Search |
| Lock | Search+L |
| Snap left / right, cycling the ratio | Alt+[ / Alt+] |
| Maximize / minimize | Alt+= / Alt+- |
| Float | Search+Alt+F |
| Window layout menu (partial split, ⅓ ⅔) | Search+Z |
| Snap Group toggle | Search+Shift+G |
| Move window to the other display | Search+Alt+M |
| Desk left / right | Search+[ / Search+] |
| Move window to the desk left / right | Search+Shift+[ / ] |
| Desk 1–8 | Search+Shift+1…8, in the "improved desks shortcuts" set only |
| Cycle windows | Alt+Tab |
| Launch shelf item 1–8 | Alt+1…8 *(unverified on current builds)* |

- **The Shortcuts app** (chromeOS 123, *secondary*) adds up to 5 combos to an
  **existing** action. It can't create actions. 88 actions are editable and
  101 locked. Maximize, minimize, fullscreen, float, snap, the layout menu,
  move to display and the desk-left/right actions are editable; desk-by-number
  and Alt+Tab are not.
- **Desks**: 8 by default, 16 behind device feature management
  (`kDesksUpperLimit`). There is **no "move window to desk N"** shortcut; a
  TODO in the source says so.
- **Unlaunched tiling**: `kTilingWindowResize` resizes a window toward an edge
  in ½ → ⅓ → ¼ steps on Search+Ctrl+, . ; /, and `kWindowSplitting` splits by
  dragging one window onto another. Both are off by default; whether
  `chrome://flags` lists them is *(unverified)*.

### 2.5 chrometile shows the ceiling

[chrometile](https://github.com/brockgr/chrometile) (MV3, v0.13, last commit
2026-10-13) is the best existing extension, and it hits every limit above:

- **Layouts**: Tall, Wide, Columns and Ultrawide (a centered main column).
  Split in 5% steps, a main-window count and a margin, all per display.
- **Permissions**: `storage`, `system.display`, `tabs` (for a URL deny list).
- **Keys**: 20 commands, only 2 with suggested keys, none global.
- **No workspaces, no dim, no clocks.**
- **Code issues, found by reading it**:
  - Window order and the float list live only in memory, so they're lost when
    the service worker sleeps.
  - Listeners are registered after two promises. An event that wakes the
    worker can be missed, so the first key after idle may do nothing
    *(inferred, not tested)*.
  - `moveToDisplay` calls `unshift` on the wrong `this`.
  - Every window on every desk tiles into one grid, since it can't see desks.

The other attempts are older and dead:
[Quilt](https://github.com/MrViolets/Quilt) (MV3, 2023),
[chromewm](https://github.com/JayGoldberg/chromewm) (MV2, 2018, with
workspaces), croutonwm and chrome-o-tile. MV2 no longer runs on chromeOS 133
and later.

## 3. Decisions

### 3.1 A new extension, with chrometile until it's ready

chrometile proves the mechanism, but it isn't a base to build on:

- **Most of tileco is what chrometile lacks**: workspaces, saved state, the
  dim, clocks, attention and app keys. The workspace state machine (§6.1)
  is a different core from chrometile's one window list per display.
  chrometile is about 600 lines, 496 of them in `src/background.js`, so a
  fork would keep the idea and little of the code.
- **Its foundations would be rewritten anyway**: state only in memory, late
  listener registration, and no notion of desks (§2.5).
- **tileco's logic must be testable on its own** (§17) and portable to tidal
  (§20.4). chrometile mixes layout logic with `chrome.*` calls.
- **The license doesn't decide it.** chrometile is Apache-2.0, like tileco,
  so borrowing a piece only needs credit, which tileco's README gives.

**Meanwhile, use chrometile.** It works today and is maintained: its last
commit is 2026-10-13, and it merges outside contributions. It gives the
Chromebook basic tiling until tileco reaches M3, when tileco replaces it. They
can't run together, since both would move the same windows.

**Send chrometile two fixes**, each a small PR. They help its users now and
cost tileco little:

1. **`moveToDisplay`** (`src/background.js` 411–425) calls
   `this.window_ids.unshift` from a plain function, where `this` is the
   global object, not a display. `window_ids` lives on each display's
   object, so the call throws inside the `windows.update` callback. The
   window moves, but it isn't put first in the destination's list, the
   retile never runs, and the promise never settles. The fix is
   `allDisplays[index].window_ids.unshift(...)`, then the retile.
2. **Late listener registration.** Its listeners are added inside
   `isChromebook().then(getSettings().then(...))`. MV3 delivers the event
   that wakes a sleeping worker only to listeners registered synchronously
   at the top level, so the first key or window event after idle can be
   lost *(inferred from the code, not tested)*. The fix registers every
   listener at the top level, and has each one wait for the settings
   before acting.

Both are from reading chrometile at `af8e367`. Each PR should reproduce the
problem first: a unit test for `moveToDisplay`, and for the listeners,
letting the worker go idle and then pressing a key.

Contributing the rest of tileco to chrometile instead would change its whole
design, likely more than its maintainer wants. Asking costs nothing, but
tileco doesn't wait on the answer.

### 3.2 tileco owns the workspaces; native desks stay at one

Extensions can't see desks (§2.3), so a tiler running across desks tiles the
windows of every desk together. That's chrometile's bug. tileco therefore keeps
its own nine workspaces and **switches by minimizing** the windows of the
workspace you leave and restoring those of the one you enter (§6). This is
how chromewm did it.

- **For**: the layout, order, master count and focus are exact per
  workspace, persist across restarts, and every tide workspace key works.
- **Against**: the switch shows the minimize animation. Android and Linux
  windows can't be minimized by tileco, so they stay visible on every workspace.
  Overview (and Alt+Tab, *unverified*) list minimized windows from other
  workspaces too.
- **The alternative**, native desks, has real animations and keys that work
  over every app. But tileco would lose track of which window is where after
  any native desk switch, and there's no key to send a window to desk N.
  It's [open question 1](#18-open-questions).

### 3.3 Search is Super

The tide key map moves to Search, the key in Super's place on a Chromebook
and the one tide taps for the launcher. Where the OS takes a Search combo,
the native action is usually the same one tide binds (Search+L locks,
tapping Search opens the launcher). The rest of the conflicts are in §7.2.
**Alt+Shift** is the fallback modifier for anything Search can't carry,
which is chrometile's choice too.

### 3.4 Native features, configured from a checklist

The lock, launcher, notifications, screenshots, screen-share picker, dark
mode, keyboard layout and idle policy are chromeOS's, and no extension can
replace them. tileco's options page has a **setup checklist**: the Settings
and Shortcuts-app changes that suit anyone using tileco, each one with the
page to open and how to check it's done. Personal ones (a keyboard layout,
Caps Lock, the shelf's apps, a mouse) stay out of it; they're recorded in
§9.3, §11 and §19.2. chromeOS settings can't be
scripted, so the list is the mechanism, and tileco checks what it can
(command bindings, through `chrome.commands.getAll`).

### 3.5 Web apps are installed PWAs, one per site

tide runs Gmail, Calendar, Chat, Meet and YouTube Music as Chrome `--app=URL`
windows. chromeOS has no command line, so they become **installed web
apps**. Those are listed (`type: "app"`), tileable, and launchable from a
key. Each is one site per window, which tide's attention rules
already assume (§10.3).

### 3.6 The off-ramp: run tide

Everything tileco can't reach (Android and Linux windows, global keys, the
bar) needs the OS replaced. On a Chromebook that means
third-party UEFI firmware (MrChromebox) and a normal distro running tide,
giving up verified boot, chromeOS updates and Google's security guarantees,
with some risk of bricking *(unverified for any specific model)*.
[crouton](https://github.com/dnschneid/crouton) is end of life (2024-12-31)
and broken from chromeOS 111. tileco doesn't pursue either, but the spec
records the line so nobody rediscovers it.

## 4. Feature map

Status: **yes** = tileco or chromeOS meets the tide or KDE behavior;
**partial** = close, with the gap named; **no** = not reachable without the
off-ramp.

| tide / KDE | On chromeOS | Status |
|---|---|---|
| Tile, three-column, two columns + stack, monocle (tide §6.1) | tileco layouts over Chrome and web app windows (§5) | **partial**: not Android or Linux windows |
| Lone window 80% on ultrawide, 100% otherwise | tileco, per display, from `workArea` aspect | **yes** |
| Layout per workspace | tileco state per workspace (§6) | **yes** |
| 9 workspaces, Search+1…9 / Shift (KDE, tide §6.6) | tileco workspaces by minimize (§3.2) | **partial**: keys need a Chrome window focused; Android/Linux windows on every workspace |
| One workspace per monitor from a shared pool (tide §6.5) | tileco: nine shared workspaces, one showing per display (§6.1) | **partial**, same caveats |
| Dim inactive, 0.07 (tide §6.2; KDE 0.15) | an overlay injected into the page of each unfocused window (§10.1) | **partial**: page only, not tab strip or title bar; not over `chrome://` pages |
| No borders, no gaps | chromeOS draws its own frames; tileco margin 0 | **partial** |
| Maximize, fullscreen, restore (tide §6.3) | native Alt+=, fullscreen key, rebound to Search+Up/Shift+Up/Down in the Shortcuts app | **yes** |
| Dialogs float, centered on parent (tide §6.4) | popups and dialogs untiled by type and rule (§5.4) | **yes** for Chrome; the OS places native dialogs |
| Focus follows mouse (KDE `FocusFollowsMouse`) | chromeOS's `chrome://flags/#focus-follows-cursor`, from the setup checklist (§10.2) | **partial**: a flag, off by default, which Chrome can drop |
| Nothing steals focus (tide §14) | chromeOS activation rules; tileco never focuses unasked | **partial**: the OS decides for apps |
| Super+Tab to the window wanting attention (tide §14.3) | tileco's attention list from title-count watchers (§10.3) | **partial**: chosen sites only |
| Full-width bar, workspaces, urgency (tide §7) | no top bar on busy workspaces; shelf + toolbar badge + full-screen dashboard and home page with tide's bar (§6.2, §8) | **partial** |
| Tray, network, volume, Bluetooth, battery | chromeOS status area on the shelf | **yes**, native |
| SYD / LAX / NYC / LON clocks beside local (tide §7.3) | dashboard and home page: zones, strips, DST, scrubbing (§8.2) | **partial**: one key away, not always on screen |
| Launcher on a Super tap (tide §8) | chromeOS launcher on a Search tap | **yes**, native, without quick actions |
| App keys (KDE `setup-kde`, tide `hyprland.lua`) | tileco commands that open or focus web apps and profiles (§9) | **partial**: from a Chrome window only; Linux apps by shelf slot |
| Two and three Chrome profiles (`browser2`, `browser3`) | a second chromeOS account, or a Chrome profile if the build has them (§9.2) | **partial** |
| Notifications, history, DND (tide §9) | chromeOS notification center and Do Not Disturb | **yes**, native, without auto-DND while sharing *(unverified)* |
| Idle timeline: dim 2:30, lock 5:00, off 5:30, suspend 30:00 (tide §10) | chromeOS power settings; keep-awake toggle by `chrome.power` | **partial**: OS timings, not tide's |
| Lock = login, short hostname | chromeOS lock screen | **partial**: no hostname |
| Screenshots of window, screen, region (tide §13) | chromeOS screen capture | **yes**, native, saved to Downloads and copied |
| Meet sharing of a window or screen (tide §12) | Chrome's picker on chromeOS | **partial**: no 16:9 slice of an ultrawide |
| Automatic light and dark (tide §15) | chromeOS Auto dark mode, sunset to sunrise *(unverified)* | **partial**: sun schedule, not 07:00–19:00 |
| US Dvorak (KDE `kxkbrc`) | chromeOS US Dvorak input | **yes** |
| Mouse: fastest speed, adaptive accel, left-handed, wheel 3× (conf `hyprland.lua`) | Settings › Mouse, per device, five steps each (§19.2) | **partial**: coarse steps; finer only through `gesture_prop` |
| Caps Lock as Compose | Caps Lock remaps to Search, Ctrl, Alt, Esc and others; no Compose | **no** |
| kitty, Ubuntu Mono, shell config | Crostini with `conf` and `setup` inside (§12) | **yes** inside Linux; its windows untiled |

## 5. Windows and layouts

### 5.1 Which windows tile

A window tiles when **all** of these hold:

- `type` is `normal` or `app`, or it's an app popup tileco opened itself
  (§9.1), tracked by window ID;
- `state` is `normal`;
- it isn't on tileco's float list;
- it doesn't match a float rule (§5.4).

Maximized, fullscreen and minimized windows are left alone and don't count
toward the lone-window rule, as in tide.

### 5.2 Layouts

The four tide layouts, with tide's numbers:

- **Tile** `[]=`: master on the left at `mfact` 0.55, the stack on the right.
  Default where the work area's aspect is under 2.1.
- **Three-column** `|M|`: the master centered at 50%, stacks either side;
  two windows split 50/50. Default at 2.1 and over.
- **Two columns + stack** `||=`: two masters, the stack on the right.
- **Monocle** `[M]`: every window fills the work area. Only the focused one
  is in front, so the others sit behind it rather than being minimized.

The rest is tide's §6.1:

- `mfact` moves ±0.025 per key.
- The master count is per workspace and per layout.
- New windows join the end of the stack.
- A lone window is 80% wide and centered at aspect 2.1 and over, 100%
  otherwise; both numbers are per-display settings.

Geometry is a pure function from (work area, layout, settings, window
count) to rectangles, kept free of `chrome.*` so it tests in Node (§17).
tide's Lua layout is the reference; the two share test fixtures (§15).

### 5.3 Applying it

- tileco retiles on `onCreated`, `onRemoved`, `onFocusChanged`,
  `onBoundsChanged`, `system.display.onDisplayChanged` and every layout key.
  It debounces 50 ms after the last event, since one window open fires
  several.
- After `windows.update`, tileco reads the bounds back and stores the
  difference per window type: the frame's offset. The next layout subtracts
  it, so tiles meet without gaps or overlaps.
- **A drag is a request.** When `onBoundsChanged` reports a move tileco didn't
  make, the window takes the tile nearest its center (swapping with that
  tile's window). If the center is on another display, the window first
  moves to the workspace showing there (§6.1). A resize of a tiled window sets `mfact`. That's
  Krohnkite's behavior.
  - **Built:** the resize. tileco keeps where it put each tiled window.
    When a tiled window's width has changed on the same display and work
    area, the edge that moved sets the workspace's `mfact`, for the
    layout it's in: the share that puts that edge where you left it,
    between 5% and 95%, as the keys keep it. The rest retile to match.
  - Tile and two columns: the master/stack border, from either side.
    Three columns: either edge of the master, or a stack's inner edge.
  - A screen edge, a lone window, monocle, and tile with no master have
    no share to move, so that resize is put back.
  - A width changed with the work area (the shelf hiding, say), a
    floating window, or a window back from maximized isn't read as a
    drag.
  - The move-to-swap above isn't built: a window dragged within its
    display goes back to its tile. A window dragged to native snap or float is left
  floating until it's tiled again with `Search+Shift+F`.
- Margin is 0, per tide. A setting allows chrometile's 2 px.

### 5.4 What floats

- `popup` windows: OAuth sign-ins, Chrome's "Save as" sheets, extension
  popups, and tileco's home window (§6.2). tileco's own app popups (§9.1) are
  the one exception.
- `devtools`.
- **Always-on-top windows**: Document picture-in-picture and always-on-top
  popups, which report `normal` with `alwaysOnTop` (§2.1). They refuse
  minimizing, so tileco doesn't track them at all: they stay where they are,
  on every workspace. Chrometile's Meet PiP URL rule covers any that don't.
- **Except Secure Shell**: its terminals open as `popup` windows, so tileco
  tiles popups whose tab is on Secure Shell's extension origin, like its own
  app popups (§6.4).
- **Chrome Remote Desktop** and the other URL rules chrometile ships, as a
  user-editable list.
- Anything you float with `Search+Shift+F`, remembered by window ID and
  persisted.

Native dialogs (file chooser, print) aren't Chrome windows. The OS places
them over their parent, which is what tide's §6.4 asks for.

## 6. Workspaces

### 6.1 Model

- Nine workspaces, numbered 1–9, shared across displays, as in tide
  (§6.5). Each display shows one at a time.
- Each workspace stores, in `chrome.storage.local` (§14.2):
  - its windows in tile order;
  - its layout, `mfact` and master count;
  - its focused window.
- Each window belongs to exactly one workspace, and carries one flag:
  **minimized by you**, set when it's minimized while its workspace is
  showing.
- A new window joins the workspace showing on the display it opens on.

**One rule decides what's on screen.** A window is shown if and only if its
workspace is showing on some display and you haven't minimized it.

- Every operation below changes only the state: which workspace each
  display shows, and which workspace each window belongs to.
- Then one **reconcile** step makes the screen match the rule. It restores
  the windows that should show, in tile order, and only then minimizes the
  ones that shouldn't, so the screen never goes empty in between. Then it
  retiles each display.
- Nothing minimizes or restores a window any other way. That's what keeps
  the cases consistent, including two displays and windows you minimized
  yourself.

| Operation | State change | Focus |
|---|---|---|
| **Show N** (`Search+N`) on display D | D shows N. If N was showing on another display, that display takes D's old workspace (a swap, as in tide). | N's stored window |
| **Send** a window to N (`Search+Shift+N`) | The window moves to the end of N's stack. If N is showing on any display, the window appears there at once; if not, it's hidden. | stays put, as in tide |
| **Activate** a window: a tab from the launcher (§9.4), `Search+Tab` (§10.3) | If its workspace isn't showing, show it on the focused display, as Show N. Clear the window's minimized-by-you flag. | that window |
| **Moved to another display** by you: the native `Search+Alt+M`, or a drag ending with the window's center on another display, seen as an `onBoundsChanged` tileco didn't cause | The window joins the end of the stack of the workspace showing on that display. | that window |
| **Minimize** by you | Set the flag. | chromeOS picks |
| **Restore** by you: any un-minimize tileco didn't cause, from the shelf or Alt+Tab | Clear the window's minimized-by-you flag. If its workspace is hidden, this is Activate, so the workspace comes with it. | that window |

### 6.2 Empty workspaces get a home page

Keys work only while a Chrome window has focus (§2.2), so an empty
workspace would strand you: no window, no keys. tileco opens its **home
page** there instead: an extension page in a `popup` window, opened on that
display and then made full screen. It shows:

- tide's bar across the top: workspaces, layout, the workspace number and
  the clocks (§8.1);
- the launcher (§9.4), focused on its **Launch** scope, ready to type;
- every zone's day, the next clock change and a month calendar (§8.2).

Full screen is the point: a `popup` window otherwise carries chromeOS's
caption bar and possibly a read-only address strip above tileco's own bar,
which no extension can remove. While the page shows, the shelf is hidden.

The home page takes the keys and doesn't tile. It closes when a real window
arrives, and is never counted as one. If chromeOS shows its "hold Esc to
exit full screen" bubble when it opens is *(unverified)* for extension
windows.

### 6.3 Where it can't reach

- **Android and Linux windows** stay visible on every workspace and aren't
  tiled. tileco's work area is still the display's, so they overlap tiles.
  Most people will keep them on the native snap keys.
- **Overview** shows every window, minimized ones included *(unverified)*.
- **Native desks**: the checklist removes all but one, so a stray
  `Search+]` has nowhere to go. A desk-aware design is open question 1.

### 6.4 What won't play nice

Beyond Android and Linux apps, from Chromium's and Secure Shell's source
*(each unverified on a device)*:

| Thing | What happens | What to do |
|---|---|---|
| **Secure Shell**, from its toolbar popup | A `popup` window. Tiled by tileco's Secure Shell rule (§5.4); tileco's keys work. | Fine as is. |
| **Secure Shell**, from "New session" (Ctrl+Shift+N) | An app popup: tiled, but the terminal swallows every Ctrl, Alt and Search combo, so tileco's keys go dead while it has focus. | Open connections from the toolbar popup or as tabs, or add pass-through keybindings in Secure Shell's options. |
| **Secure Shell**, Shift-click or as a tab | A normal window or tab: tiles, keys work. | Fine. |
| **chromeOS's system apps** (Files, Settings, Camera) | Report as `app`, so they tile like web apps, with the page-first keys of §2.2. | Fine; expect the odd key to be eaten. |
| **The Terminal system app** | The same terminal as Secure Shell: it tiles, and tileco's keys go dead in it. | Use Secure Shell from its popup, or Crostini's terminal (§12). |
| **Document picture-in-picture** (a call's pop-out) | Always on top, refuses minimizing; tileco leaves it alone on every workspace. | Fine; it floats over everything, as it should. |
| **Video picture-in-picture** | Invisible to tileco; floats over everything. | Fine. |
| **Chrome Apps** (the old `chrome.app.window` kind) | Invisible to other extensions: untiled, on every workspace. | Use the web app instead. |
| **Steam, Parallels** | VM windows, invisible like Linux apps: untiled, on every workspace, keys dead while focused. | Keep them full screen, or on native desks you don't switch. |
| **Incognito windows** | Invisible unless tileco is allowed in Incognito: untiled, on every workspace. | Allow tileco in Incognito at `chrome://extensions`. |
| **A second signed-in user, or Guest** | That user's windows are invisible: tileco can't manage them. | One user per session. |
| **Full-screen video** | tileco leaves full-screen windows alone (§5.1). | Fine. |
| **Extension popups, the side panel** | Not windows; unaffected. | Fine. |

A window that refuses a state change (a locked full-screen kiosk window, say)
is logged and skipped, so it can't stop the rest of a workspace switch.
tileco then stops managing it, like an always-on-top window, so it isn't read
as a window you restored by hand on the next event.

## 7. Keys

### 7.1 The map

Bound by tileco, unless the column says the Shortcuts app:

| Keys | Action | Bound by |
|---|---|---|
| tap Search | launcher | native |
| `Search+L` | lock | native |
| `Search+1…9` / `Search+Shift+1…9` | go to / send to workspace | tileco |
| `Search+Page Up` / `Page Down` (tide: `Super+Left` / `Right`) | previous / next workspace | tileco (Search+arrows are Home/End and Page Up/Down; §7.2) |
| `Search+Shift+Page Up` / `Page Down` | send to previous / next workspace | tileco |
| `Search+J` / `K`, with Shift | focus / move down and up the stack | tileco |
| `Search+Space` | the dashboard: tileco's bar and launcher, full screen (§8.1) | tileco |
| `Search+Shift+M` (tide: `Super+Return`) | swap with master | tileco |
| `Search+N` / `Search+H` (tide: `Super+\` / `Super+/`) | grow / shrink master | tileco |
| `Search+I` / `Search+D` (tide: `Super+=` / `Super+-`) | add / remove a master, dwm's letters | tileco (Search+D after removing dictation's shortcut; §7.2) |
| `Search+.` / `Search+,` | next / previous layout | tileco |
| `Search+O` (tide: ``Super+` ``) | toggle monocle | tileco |
| `Search+Up` / `Search+Shift+Up` / `Search+Down` | maximize / fullscreen / restore | Shortcuts app (Search+Up is Page Up today; §7.2) |
| `Search+Shift+F` | toggle floating | tileco |
| `Ctrl+Shift+W` (tide: `Super+Backspace`) | close window | native Chrome |
| `Search+Tab` | next window wanting attention, else the last window | tileco |
| `Search+Shift+N` | notification center | Shortcuts app, if the action is editable *(unverified)* |
| `Search+S` | toggle keep awake (§11), as the bar's cup does | tileco, once select to speak is removed (§7.2) |
| `Search+Alt+M` | move to other display | native |
| app letters (§9) | open or focus the app | tileco |

That's about 50 tileco commands. Four ship with suggested keys: `Search+Tab`,
because the shortcuts page can't capture Tab (§19.1), so a manifest
suggestion is the only way to bind it, and then the three used most,
`Search+J`, `Search+K` and `Search+Space` for the dashboard. If chromeOS already owns
`Search+Tab`, the suggestion is dropped at install *(unverified)*, and
attention moves to a key the page can capture. You bind the rest once at
`chrome://extensions/shortcuts`. The checklist (§3.4)
lists every unbound command and opens that page.

The five keys the Commands API can't carry (§2.2) move to the nearest
supported combo. Shift with `.` and `,` reads as `>` and `<` for grow and
shrink. `Search+Space` opens the dashboard, tileco's own launcher, as it
opens a launcher on other desktops, so swap-with-master moves from Return
to `Search+Shift+M`, M for master. Close falls back to Chrome's own window
close.

### 7.2 Conflicts to settle in M2

chromeOS uses Search as its remapping key, and some tide combos land on
those remaps. Each must be checked on a device, and the answer goes in this
table:

| Combo | chromeOS default | Plan |
|---|---|---|
| Search+Left / Right, and with Shift | Home / End, and Shift to select to the beginning or end of the line, remapped before Chrome sees them, so `chrome://extensions/shortcuts` refuses Search+Right and Search+Shift+Right ("include Ctrl, Alt, or Search") | the Shortcuts app lists them as the beginning and end of line under Text, but can't edit them; so Search+Page Down / Page Up, which the shortcuts page accepts, step the workspaces |
| Search+Up / Down | Page Up / Down, at the keyboard level: the Shortcuts app doesn't list them, and the shortcuts page refuses them the same way | Search+Page Up / Page Down for the workspace steps |
| Search+1…= | F1–F12 when "top row as function keys" is off *(unverified on current builds)* | turn the setting off; else Alt+Shift+1…9 |
| Search+Shift+G | Snap Group | unbind in the Shortcuts app, freeing it for the third profile |
| Search+Shift+D | minimize Snap Group | keep; tileco doesn't use it (remove a master is Search+D) |
| Search+Space | none known *(unverified)* | keep |
| Search+Shift+Space | emoji picker | removable; tileco doesn't use it (monocle is Search+O) |
| Search+C | calendar panel | remove it in the Shortcuts app (Device), freeing it for app 1 |
| Search+M | microphone mute | remove it in the Shortcuts app (Device), freeing it for app 3 |
| Search+X | picture-in-picture | keep; tileco doesn't use it |
| Search+F | Quick Insert | remove it in the Shortcuts app, freeing it for the second profile (§9.1) |
| Search+V | clipboard history | keep; tileco doesn't use it |
| Search+Backspace | Delete, locked | keep; tileco doesn't use it |
| Search+Z, Search+Alt+F | layout menu, float | keep; they don't clash |
| Search+Alt+M | move the window to another display | keep; tileco follows the move (§6.1) |
| Search+/ and Search+= on Dvorak (Search+[ and ] on QWERTY) | the desk to the left and right | keep; with one desk (§6.3) they do nothing, and tileco doesn't use them |
| Search+Shift+A | assign the window to all desks | keep; tileco doesn't use it |
| Search+D | dictation | remove it in the Shortcuts app, under Accessibility, to use Search+D |
| Search+S | select to speak | remove it in the Shortcuts app, under Accessibility, for keep awake, as tide's and tilemo's `Super+S` *(untried: it may be locked)* |
| Search+I | none | free; tileco's add-a-master key |

The Shortcuts app's settings are in Settings › Keyboard and inputs ›
View keyboard shortcuts; Calendar and microphone mute (under Device), the emoji picker and
Quick Insert are editable there; Search+Left / Right are listed under Text but locked. A padlock marks a shortcut that can't be changed; an editable one shows a pencil on hover. chromeOS takes its own shortcuts before Chrome sees them, so a
tileco key on one does nothing until it's removed there.

Whatever moves to Alt+Shift moves as a set, so the map stays learnable.

### 7.3 Keys tileco can bind

Chrome binds an extension command only to a letter, a digit, Comma, Period,
Space, Tab, an arrow, Insert, Delete, Home, End, Page Up or Page Down, with
Search, Ctrl or Alt, and optionally Shift (`ui/base/accelerators/command.cc`).
So tide's `\` `/` `=` `-` `` ` `` and Return can't be tileco keys at all.

The rule for choosing (maintainer, 2026-10-24): an action used often gets
Search and one key, no other modifier; Shift means moving the window (to a
workspace, along the stack), or marks a rare action like floating. T stays
reserved for the terminal.

This is every Search combo, from tileco's manifest and from trying them on a
Chromebook. **OS, removable** means chromeOS has it and the Shortcuts app
(§7.2) can take it off; **OS, locked** means it can't; a blank is untried.
Search+Alt and Search+Ctrl are allowed too, and untried unless listed.

| Key | Search+key | Search+Shift+key | Search+Alt+key |
|---|---|---|---|
| A | | OS: assign to all desks | |
| B | | | |
| C | tileco: app 1 (Calendar); OS calendar panel, removable | tileco: app 2 (Chat) | |
| D | tileco: remove a master; OS dictation, removable (Accessibility) | OS: minimize Snap Group (§7.2) | |
| E | | | |
| F | OS: Quick Insert, removable; tileco planned: second profile (§9.1) | tileco: toggle floating | OS: float |
| G | tileco: browser | OS: Snap Group; tileco planned: third profile | |
| H | tileco: shrink master; OS Explore app, removable | | |
| I | tileco: add a master | | |
| J | tileco: focus next | tileco: move down the stack | |
| K | tileco: focus previous | tileco: move up the stack | |
| L | OS: lock, editable, kept | | |
| M | tileco: app 3 (Meet); OS microphone mute, removable | tileco: swap with master | OS: move to other display |
| N | tileco: grow master | OS: notification center *(unverified)* | |
| O | tileco: monocle | | |
| P | | | |
| Q | | | |
| R | | | |
| S | tileco: keep awake; OS select to speak, removable *(untried)* | | |
| T | reserved: the terminal (§1) | | |
| U | | | |
| V | OS: clipboard history | | |
| W | | | |
| X | OS: picture-in-picture | | |
| Y | tileco: app 4 (YouTube Music) | | |
| Z | OS: window layout menu | | |
| 1–9 | tileco: go to workspace | tileco: send to workspace | |
| 0 | | | |
| Comma | tileco: previous layout | | |
| Period | tileco: next layout | | |
| Space | tileco: dashboard | OS: emoji picker, removable | |
| Tab | tileco: attention | | |
| Left / Right | OS, locked: Home / End | OS, locked: select to line start / end | |
| Up / Down | OS, locked: Page Up / Page Down | OS, locked | |
| Page Up / Down | tileco: previous / next workspace | tileco: send to previous / next workspace | |
| Home / End | | | |
| Insert / Delete | | | |

Search+Ctrl+S opens the Shortcuts app itself, and Search+Esc the task manager (Esc can't be a tileco key anyway). Search+S, Search+V, Search+X and Search+Z may be removable too: whether the
Shortcuts app shows them with a padlock is untried.

## 8. Status, bar and clocks

### 8.1 No top bar

tide's bar can't be drawn: the shelf goes bottom, left or right, never top,
and an extension window has a caption and can't reserve space. A
**bar window** (a short popup that tileco tiles around) was considered and
rejected: it would have a title bar, take focus when clicked, and appear in
Alt+Tab and Overview.

Instead:

- **The shelf** at the bottom, as chromeOS puts it, holds the status area:
  network, volume, Bluetooth, battery, notifications and the local clock.
  That's tide's right-hand side, native.
- **tileco's toolbar icon** shows the current workspace number as its badge,
  amber when another workspace holds a window wanting attention. The icon
  is on every browser window's toolbar and pinned, and is absent in web app
  windows, which have no toolbar.
- **tileco's dashboard**, from `Search+Space` or the toolbar icon, is the home
  page's sibling (§6.2), full screen over the focused display: tide's bar on
  top (workspaces in tide's style — current, occupied, urgent, empty — the
  layout symbol, keep awake's cup (§11) and the clocks) and the launcher (§9.4), opening on its
  **Tabs** scope for switching. It closes once you choose, on Esc, when you
  click away, or on its key again. It doesn't use Chrome's action popup,
  which is small, anchored to the toolbar and refused where there's no
  toolbar, as in web app windows ("Browser window has no toolbar",
  `extension_action_api.cc` `OpenPopupInBrowser`). If chromeOS's full-screen
  bubble shows on every open, the dashboard falls back to a large centered
  window *(unverified)*.
- **No dead clicks in the bar.** Each workspace chip's click target reaches
  the bar's top and bottom and halfway to the next chip, the first to the
  bar's left edge. The clocks are one target, every zone's name and time
  and the gaps between them, the bar's height and out to its right edge.
  The launcher's scope chips meet halfway too. Under the pointer, an
  item's whole target shows as a rounded rect a shade darker than the bar
  in light, lighter in dark (`--hover`), as if half pressed: a chip with
  the space around it, the clocks as one row. The rounding is drawn, not
  hit-tested, so it leaves no dead corners. tilemo's bar shares this
  stylesheet. Neither bar has an appearance (dark mode) button.

### 8.2 Clocks

tide's clock rules, in the bar of the dashboard and the home page, with the detail under it:

- `SF`, `NYC`, `LON` and local, 24-hour, tabular figures.
- Labels are fixed place names, not CLDR names.
- A zone matching the local zone ID is hidden.
- A different day shows `−1` / `+1`.
- Each zone has a 24-hour day/night/working-hours strip.
- The next DST change is named.
- A month calendar with ISO week numbers, Monday first, marks today and
  steps by month. It opens on today's month each time the detail does.
- Scrolling scrubs time in 15-minute steps.
- `Intl.DateTimeFormat` with `timeZoneName: "short"` gives the abbreviation.
  CLDR gives `GMT+1` for London in en-US, so tileco keeps tide's
  tzdata-abbreviation table instead.
- Settings: the same `{zone, label}` list as tide's `clocks.json`, synced
  (§13).

## 9. Launcher and app keys

### 9.1 Web apps

Each letter **opens a new window** of its app on the current workspace,
even when one is already open, as tide's and KDE's keys launch the app
(maintainer, 2026-10-24). Getting back to an open window is the launcher's
Tabs scope (§9.4) or `Search+Tab` (§10.3):

| Key | App | How |
|---|---|---|
| `Search+G` | browser | §9.1, browser windows |
| `Search+F` | browser, second profile | §9.2 |
| `Search+Shift+G` | browser, third profile | §9.2 |
| `Search+C` | Google Calendar | installed web app |
| `Search+Shift+C` | Google Chat | installed web app |
| `Search+M` | Google Meet | installed web app |
| `Search+Y` | YouTube Music | installed web app |
| *unassigned* | IRC | installed web app, or the Linux client by shelf slot; Search+I went to add a master (§7.1) |

- **The four app keys are slots.** Chrome fixes an extension's commands in
  its manifest, so `app-calendar`, `app-chat`, `app-meet` and `app-music`
  are named for their defaults, and the options page gives each any website
  (a name and an address), or none, which turns the key off.
- **Browser windows**, for `Search+G`: a new `type: "normal"` window, with
  `windows.create({})`. Profiles (`Search+F`, `Search+Shift+G`) follow
  §9.2.
- **Open**: `chrome.management.launchApp(id)` with the installed app's ID.
  Whether it opens web apps, rather than only legacy Chrome Apps, is
  *(unverified)*. If it doesn't, tileco opens the URL with
  `windows.create({url, type: "popup"})`, which is a frameless-ish app
  window, but not the installed app. tileco records that window's ID (in
  `chrome.storage`, §14.2) as the app's, so it tiles like an app window
  (§5.1). Other popups still float.
- The app list is a setting: letter, name, URL, app ID.

### 9.2 Profiles

`browser2` and `browser3` run Chrome with separate `--user-data-dir`s.
chromeOS has one Chrome profile per signed-in account. The choices are:

- **A second chromeOS account**, switched with Ctrl+Alt+, and .
  *(unverified)*. Its windows are invisible to tileco in the first account.
- **Chrome profiles inside the session**: reportedly gone with Lacros in
  M128 *(secondary:
  [Chrome Unboxed](https://chromeunboxed.com/lacros-is-gone-so-google-should-bring-account-switching-to-the-chromeos-browser/))*.
- **Linux Chrome in Crostini**, with `browser2`'s and `browser3`'s
  `--user-data-dir`s unchanged. They're real profiles, but Linux windows
  that tileco can't tile (§12).
- **Incognito or Guest** for throwaway use.

tileco binds the keys to whichever works, decided in M3.

### 9.3 Linux apps and the terminal

An extension can't start a Linux app. The keys that run Linux apps (`T`
terminal, `W` terminal on the workstation, `E` files, `N` notepad, `R`
remote desktop, `B` headphones) use the **shelf**: pinned
in a fixed order, by hand (not a checklist item, as it's personal), and **Alt+1…8** launches shelf item N *(unverified on
current builds)*. If the Shortcuts app lets "launch shelf item N" take an
extra combo, `Search+T` and the rest map there; that's
*(unverified)* and is checked in M2.

### 9.4 The launcher

The native launcher stays: tap Search, type, Enter. It searches apps,
files, settings and the web. What's missing from tide §8:

- **Quick actions**: screenshot, lock and so on are native keys instead.
- **Launcher scripts**: tileco's commands appear in it only as the extension
  itself.

tileco adds its own launcher on top, on the home page (§6.2) and the
dashboard (§8.1), for what the native one doesn't do: switching among open
tabs and running tileco's commands.

- **Two scopes**, switched by their chips or Tab: **Launch** (the app keys'
  apps and tileco's commands, each with its key) and **Tabs** (every open tab
  but tileco's own, with its workspace). The home page opens on Launch, the
  dashboard on Tabs. Without the `tabs` permission (§14.1) the dashboard
  opens on Launch too, and Tabs offers "Allow tab search".
- **Fuzzy matching:** every query letter in order, with word starts and runs
  scoring higher, so "gc" finds Google Calendar. A tab matches by title,
  by the name of the app whose site it's on (so "calendar" finds Calendar's
  tabs), and, for less, by host. Ties go to the most recently used (`tab.lastAccessed`).
- **Empty query:** tabs most recent first; apps before commands.
- **Nothing in scope:** a query that matches nothing in its scope searches
  both, so a tab still turns up from Launch.
- **Enter** goes there: a tab comes forward with its window and workspace
  (§6.1 Activate); an app or command runs as its key would, so an app
  opens a new window (§9.1). Arrows choose,
  Esc clears, then closes the dashboard.
- **The footer** names only the keys that work in the scope you're in, as
  tide's switcher footer does: Enter to run on Launch, to go there on
  Tabs, and to allow tab search on Tabs without it, where there's one row
  and so no arrows; Tab names the scope it switches to.

It only opens from a Chrome window or an empty workspace (§2.2): over an
Android or Linux app, tap Search for the native launcher instead.

## 10. Focus cue, focus and attention

### 10.1 The dim

- tileco injects a content script into the visible tab of every **unfocused**
  tiled window. It adds a full-page overlay at 10% black, ignoring the
  pointer, at the top of the stacking order. That's stronger than tide's
  0.07 Hyprland dim, matching the 10–15% of other desktops; the options
  page sets the strength, from 2% to 50% (§13).
- The focused window's overlay goes the instant focus arrives.
- No dim when the workspace has one visible window, over fullscreen video,
  or in PiP, as in tide §6.2.
- **It covers the page only.** The tab strip, toolbar and the web app title
  bar stay undimmed. `chrome://` pages, the Web Store and the PDF viewer
  can't be injected, so they never dim.
- **It costs the "read and change all your data on all websites" permission**
  (`<all_urls>` host access plus `scripting`). That's the warning users
  rightly fear. So the dim is **optional**, off by default, and requested
  at runtime when you turn it on under Extras in the settings (§13).

### 10.2 Focus

- **Focus follows mouse is a chromeOS flag**, `#focus-follows-cursor`
  (`features::kFocusFollowsCursor`, "sloppyfocus"). It's off by default;
  on, the window under the pointer takes focus without a click and isn't
  raised. Chromium 158's `about_flags.cc` still lists it for chromeOS, with
  `expiry_milestone` 200 in `flag-metadata.json`. tileco can't turn a flag on,
  so the setup checklist links to it (§3.4). It works on a Chromebook with
  Chrome windows. Whether it reaches Android and Linux windows is
  *(unverified)*.
- tileco never focuses a window you didn't ask for. It focuses only on its
  own keys, a workspace switch, or a close (the next window in the stack).
- Whether a new window takes focus is chromeOS's call. Chrome windows you
  open do; tide's "a window from another app opens dimmed and urgent" has
  no equivalent.

### 10.3 Attention

Chrome on chromeOS doesn't raise urgency for web notifications, and tileco
can't see other sites' notifications. tide's §14.4 derives attention from
notifications; tileco derives it from **page titles** instead:

- Gmail, Chat and Calendar put an unread count in the title, like
  `Chat (3)`. A content script on the allowed sites, and only those,
  reads the title and tells tileco when the count goes up.
- tileco marks the window: the badge goes amber (§8.1), the workspace is
  marked in the bar, and `windows.update({drawAttention: true})` flashes
  its shelf icon.
- `Search+Tab` activates the most recent mark (§6.1); again goes to the next, as in
  tide §14.3. With nothing marked, it goes to the last window you were in.
- A mark clears when the window is focused.
- The sites are a setting, **Unread counts**, with Gmail, Chat and
  Calendar to start with. Each needs its own access, asked for on the
  options page, without the all-sites warning. tileco registers the title
  script for each allowed site at runtime
  (`scripting.registerContentScripts`). Grants are per Chromebook while
  settings sync, so a site added elsewhere waits for its access here.

## 11. The rest of the desktop

All native, set from the checklist (§3.4). tileco owns none of it.

- **Notifications**: the chromeOS notification center keeps history and has
  Do Not Disturb. Chrome web notifications show there with the site.
  Automatic DND while presenting is *(unverified)*; if chromeOS doesn't,
  tileco doesn't either.
- **Idle and lock**:
  - Settings › Power picks what happens when idle (sleep, display off, or
    keep on) on charger and on battery. The display-off and lock delays are
    fixed by the OS *(unverified)*, so tide's 2:30 / 5:00 / 5:30 / 30:00
    timeline is approximated, not matched.
  - "Lock when sleeping" on, as tide locks before sleep.
  - **Keep awake** is tileco's: `Search+S`, a click on the cup on the
    bar of the dashboard and the home page, or the launcher's Toggle keep
    awake, calls `chrome.power.requestKeepAwake("display")` until you turn
    it off, as tide's does. Meet already keeps the screen on by itself.
    - The cup is a cup of coffee, tide's and tilemo's icon: faint while
      off, in the accent color while on. Hovering it says "Keeping awake"
      or "Not keeping awake", tide's words, and so does the toolbar
      button's tooltip after each toggle.
    - tide's OSD has no equivalent, so `Search+S` itself shows nothing
      more: an extension's own notification would cost the
      `notifications` permission's install warning.
    - It lasts the browser session, in `storage.session`. A browser
      restart, a login, drops Chrome's request and empties that store
      together, so it's never left on across a login, as in tide.
      Reloading or updating tileco does both too.
    - tide's **presenter mode** (`Super+P`) isn't here: it's keep awake
      plus Do not disturb, and an extension can't reach chromeOS's Do not
      disturb, so it would be keep awake under another name. tide's mic
      hold has no equivalent either; Meet keeps the screen on itself.
- **Screenshots**: Ctrl+Show windows for the screen, Ctrl+Shift+Show
  windows for the capture tool's window and region modes. Shots are copied
  to the clipboard and saved to Downloads, as tide saves to
  `~/Pictures/Screenshots`; the save folder is a setting. The Shortcuts
  app adds `Print`-style combos if the keyboard has one.
- **Screen sharing**: Meet's picker offers a tab, a window or the whole
  screen. tide's 16:9 slice of an ultrawide has no native equivalent;
  sharing a window is the workaround, as tide's default on an ultrawide.
- **Theme**: Personalization › Dark mode › Auto follows sunset and sunrise.
  Chrome and web apps follow it. tide's fixed 07:00–19:00 schedule isn't
  offered *(unverified)*.
- **Keyboard**: US Dvorak; Caps Lock remapped to Escape or Ctrl (there's
  no Compose); key repeat in Settings.
- **Mouse**: Settings › Mouse, per device: swap primary button,
  speed 5 with acceleration on, and "Controlled scrolling" with scroll
  speed 5. §19.2 has the numbers and the finer route.
- **Fonts**: Ubuntu Mono inside Linux. chromeOS UI fonts aren't settable.

## 12. Linux apps (Crostini)

Crostini runs kitty, the shell config and the terminal tools, so `conf` and
`setup` apply there like on any Debian machine.

- Each Linux window is its own chromeOS window, managed by the OS and
  invisible to tileco. They get native snap and float, not tiling.
- **Nested tiling, as an option**: sway (or cage running kitty) inside one
  Sommelier window would tile Linux windows among themselves *(unverified:
  no report found of sway nested under Sommelier)*. The outer window is
  still a Linux window, invisible to tileco, so it doesn't join tileco's layouts
  or workspaces. It's placed with native snap or float, or kept
  fullscreen. It's worth trying only if Linux apps become the main work.
  Baguette, the containerless Crostini that is default for new installs from
  M147 *(secondary)*, lists graphics acceleration among things no longer
  supported, so a nested compositor may be slow.
- `setup` has a Crostini mode in `scripts` (§15, A.5): the packages, kitty and
  conf, without a desktop session.

## 13. Settings

- One **options page**, in the style of tide's settings panel, with pages
  for layouts, workspaces, keys (with the checklist), apps, clocks, dim and
  attention.
- Every change applies live; no reload.
- **Shared vs per-machine**, as tide's §16.1: `chrome.storage.sync` holds
  the shared settings (apps, clocks, keys, layouts), and
  `chrome.storage.local` holds per-machine overrides (lone-window width per
  display, ultrawide threshold). Objects merge key by key; lists replace
  whole.
- A bad value is an error on the options page naming the setting, and the
  last good value stays.
- Import and export as JSON, in the same shape as tide's
  `~/.config/tide/*.json`, so one clocks list and one layouts file serve
  both.
- **Built so far:** the clocks page (zones, labels, cities and order, and
  each zone's daytime and working hours), the apps page (each app key's
  name and address, beside the key Chrome has bound), the keys checklist
  (every command, the key this spec gives it and the key Chrome has bound,
  the unbound ones first, with a button to `chrome://extensions/shortcuts`;
  a command on another key counts as done), the setup checklist (the
  chromeOS settings in §3.4, each with how to set it and, where it has
  one, a button to its `chrome://os-settings` page; you tick them off, as
  chromeOS can't be read, and the ticks stay in `storage.local`), the
  extra sites watched for
  attention (§10.3), the dim's strength (2% to 50%,
  repainting what's already dimmed), this Chromebook's
  layouts (the ultrawide threshold and the lone-window widths, kept in
  `storage.local`), this Chromebook's mouse wheel step, for the login
  reminder (§19.2), and import, export and reset of the shared settings.
  `src/settings.js` checks every value, and the dashboard and home page pick
  up a change at once through `storage.onChanged`; tileco reads its settings
  on each step. The workspaces page sets the layout a workspace starts in,
  on an ultrawide and on any other display, and each layout's main share
  and main-window count, under tide's names (`defaultMode`, `modes`). A
  change reaches every workspace and replaces what the keys set there, as
  in tide.

## 14. The extension

### 14.1 Manifest

- MV3, service worker background, minimum Chrome version set to the M2
  device's.
- Permissions: `storage`, `system.display`, `scripting` and `power` (keep
  awake, §11), none with an install warning, so tiling and workspaces need
  nothing sensitive. (`management` for installed apps, if §9.1 holds,
  would join them.)
- Optional, each asked for from a click under **Extras** at the top of the
  settings, which a new install opens once. The dashboard also shows a
  card offering the extras still off, with an Allow button each, until
  you dismiss it (kept in `storage.local`). Turning unread counts for
  Gmail, Chat and Calendar off takes them out of the list, since
  all-sites access for dimming keeps their access:
  - `tabs`, for tab search (§9.4), matching windows after a restart
    (§14.2) and recognizing Secure Shell's popups (§6.4). Without it,
    those popups float and a restart loses workspaces.
  - Each unread-count site's own origin (§10.3). Gmail, Chat and Calendar
    are one Allow.
  - `<all_urls>`, for dimming inactive windows (§10.1).

### 14.2 Living with the service worker

- **Every listener is registered synchronously at the top of the worker**,
  before any `await`, so the event that wakes a sleeping worker is handled.
  This is the fix for chrometile's likely first-key bug.
- **State goes to storage on every change**: workspaces, tile order, float
  list, attention marks. Use `chrome.storage.session` for what dies with the
  browser and `chrome.storage.local` for what survives a restart.
- On wake, tileco reconciles stored state with `windows.getAll`: unknown
  windows join the current workspace; vanished ones are dropped.
- Window IDs change across a browser restart. tileco stores each window's tab
  URLs with its place, refreshed as pages load, and knows a restart when none of the stored IDs
  exist; closing windows one by one never looks like that, since each sync
  forgets the closed ones. Each new window then takes the place of the old
  one it shares the most URLs with (closest fit first, each used once): its
  workspace, place in the stack and float. Chrome's restored minimized
  states aren't read as your doing; tileco just puts the screen back. A
  window it can't match joins the workspace showing on its display, as any
  new window does.
- Chrome may bring the windows back over several events, so old windows
  nothing has matched yet wait for later ones to match, even when the first
  to come back matches none of them, until your first
  command says the restore is over. Each joins the end of its workspace's
  stack.
- The worker can wake before Chrome has restored any window. With no window
  at all, the old ones wait too, unless this browser session has already had
  a window: then you closed them all, and nothing waits. A flag in
  `chrome.storage.session`, which a browser restart empties, tells the two
  apart.

### 14.3 Cost and reliability

- **Dollars**: none to run. Publishing to the Web Store takes a one-time
  $5 developer registration *(secondary)*.
- **Latency**: no network calls. Each key is a few `chrome.windows` calls;
  a workspace switch is one minimize and one restore per window plus the OS
  animation.
- **Failure modes**:
  - A Chrome update could change how bounds or minimize behave; CI can't
    catch that, so M2's device checks are re-run on each chromeOS major.
  - chromeOS's Android-based successor, Googlebook OS, is already
    shipping on new laptops (§20). chromeOS itself is reported to continue
    for enterprise and education, with updates through 2034
    *(secondary)*.
- **If tileco is off or crashes**, windows stay where they are and the native
  keys still work. Nothing it does is needed to use the machine.

### 14.4 On a managed work machine

The target is a work machine, so admin policy decides parts of this before
any code does. None of these policy names or behaviors has been checked
against the policy list yet *(unverified)*; M2 reads the machine's
`chrome://policy` first.

- **Installing tileco**: it comes from the Web Store (§14.5), so what matters
  is whether policy blocks Web Store extensions, or allows only a list. If
  so, the admin has to add tileco's ID.
- **The dim** (§10.1) needs all-sites access, which policy can withhold from
  extensions.
- **Linux** (§12, Appendix A) can be turned off by policy, and so can USB
  passthrough and port forwarding.
- **The Shortcuts app and keyboard settings** may be locked.
- **The `#gesture-properties-dbus-service` flag** (§19.2) can't be set
  where policy blocks `chrome://flags`.

### 14.5 Distribution

tileco ships on the **Chrome Web Store**; loading it unpacked is for
development only. That shapes the design *(Web Store policy, secondary)*:

- **One purpose**: window management. The clocks, keep-awake and attention
  belong to it as the desktop around the tiles; the listing says so.
- **Every permission is justified in the listing** (PUBLISHING.md):
  `system.display` for layout, `scripting` for unread counts and dimming,
  `power` for keep awake, and, optional and asked for at runtime, `tabs`, each unread-count site,
  and all sites for dimming (§14.1). So the install shows no warning, and
  review stays simpler.
- **No remote code** and no network calls, which MV3 requires anyway.
- Updates go through Web Store review, so a fix after a chromeOS change
  takes days, not minutes. Keep a tested build ready before each chromeOS
  major (§14.3).

tidal would ship on the **Play Store** (§20.4).

## 15. Where things live

| Repo | Gets |
|---|---|
| **tileco** (this) | The spec. The extension: worker, layout geometry, workspaces, the full-screen dashboard and home page with the launcher, options page with the checklist, attention and dim content scripts. Its tests. |
| **tide** | Nothing changes. Its layout fixtures (window counts → rectangles) are the reference tileco's geometry tests are checked against, copied with a note of the commit. |
| **conf** | The shared `clocks.json` and layouts settings, if tileco imports them (§13). Crostini needs nothing new: the Debian path already covers it. |
| **scripts** | `setup` detects Crostini (`/dev/.cros_milestone` or `/opt/google/cros-containers`, *(unverified on a device)*) and skips the desktop: no KDE, no tide, no display manager (A.5). |

## 16. Milestones

| # | Milestone | Done when |
|---|---|---|
| **M1** | This spec | agreed; open questions answered |
| **M2** | Device checks + layouts | every *(unverified)* claim in §2, §7.2, §9 and §11 is checked on a Chromebook, with the chromeOS version, and this spec updated. The four layouts and the lone-window rule tile Chrome and web app windows on the laptop panel and on an ultrawide. Frame offsets are measured and tiles meet. State survives the worker sleeping and a browser restart. |
| **M3** | Workspaces + keys | nine workspaces switch and send on one and two displays, with the home window on empty ones. Every key in §7.1 is bound or listed by the checklist. App keys open a new window of each web app and profile. |
| **M4** | Dashboard, clocks, attention | the dashboard shows workspaces and urgency from live state, the clocks follow tide's rules across a DST fixture, and a Chat message marks its window and `Search+Tab` goes there. |
| **M5** | Dim + settings | the optional dim works and is off without the permission. The options page edits everything live, syncs, and imports tide's JSON. |
| **M6** | Linux | `setup` runs in Crostini; the nested-sway experiment is tried and written up, keep or drop. |

## 17. Testing

- **Pure logic in plain JavaScript modules**, run by `node --test` in CI, as
  tide does: layout geometry, workspace state transitions, settings merge
  and validation, clock labels and DST, attention title parsing.
- **Geometry fixtures** from tide's layout tests, so the two desktops tile
  the same way for the same windows.
- **A `chrome.*` fake** for the worker: windows with IDs, types, states and
  bounds, and events, so switching, sending, reconciliation after a
  restart, and a worker woken by a command are tested without a browser.
  The fake's bounds can be off by a frame, to test the offset correction.
- **Playwright with Chromium** loads the unpacked extension on Linux for
  what the fake can't show: the dashboard and home page, options page and content scripts.
  Window management on Linux Chromium differs from chromeOS, so those
  results don't stand in for M2's device checks.
  - `test/smoke.js`, run by `make smoke` and CI's `smoke` job, checks that
    the worker starts, that the options page renders every section and
    saves a setting and a checklist tick, and that the home page and
    dashboard render the bar, clocks, launcher and calendar, all with no
    page errors. Content scripts aren't covered yet.
  - Playwright is tileco's one dependency, a pinned dev dependency for tests
    only; the extension still loads `src/` as it is. CI caches npm and
    Chromium, and mikelward/npm-update batches its updates weekly.
- `make lint` checks that every script parses, the pages' own included,
  which no node test imports.
- No test sleeps; events are driven in order by the fake.

## 18. Open questions

1. **Workspaces: tileco's (minimize) or native desks?** §3.2 recommends tileco's,
   for exact per-workspace tiling and tide's keys, at the cost of the
   minimize animation and Android/Linux windows showing everywhere.
   Native desks give OS animations and keys that work over every app, but
   tileco can't see them, so it would tile every desk's windows on a display
   together: per-desk tiling breaks. A hybrid that guesses each window's
   desk from focus changes would go wrong on any native desk move, with
   nothing to correct it. So it's tileco's own workspaces, unless M2 shows the
   minimize animation can't be lived with.
2. **Is the dim worth the all-sites permission?** §10.1 makes it optional,
   off by default.
3. **Fork chrometile or start fresh?** §3.1 recommends fresh, using
   chrometile until M3 and sending it two fixes.
4. **How much of the off-ramp (§3.6) should this repo document**, given the
   tide spec already covers the desktop it would run?
5. **The moved keys** (§7.1): settled on a Chromebook (maintainer,
   2026-10-24) as Search+H / N, Search+I / D and Search+O, by §7.3's rule.
   `Search+Space` for the dashboard is the one left from the first guess.
   An upstream patch could restore `Search+Return` only (§19.1).
6. **Googlebook**: the target is a work machine. Accessibility services
   and sideloading aren't ruled out; adb is unknown. That decides whether
   tidal (§20.4) could re-tile, or only place apps at launch. The same
   machine's chromeOS policy (§14.4) decides whether tileco loads at all.

## 19. Upstream patches and workarounds

Where a limit is in Chromium code rather than in policy, a patch could lift
it. Each subsection says what it would take and whether it's worth trying.
None of tileco's milestones depends on one landing.

### 19.1 More keys for extension commands

**The ask.** tide binds `Super+Return`, `Super+\`, `Super+/`, `Super+=`,
`Super+-`, ``Super+` `` and `Super+Backspace`, and no extension can
bind any of them (§2.2). Comma and period already work, which is why §7.1
uses them.

**Where the limit is** (Chromium `main` at `a3f88457`):

- `ui/base/accelerators/command.cc`:
  - `ParseImpl` turns `"Search+Shift+Period"` into an accelerator. It
    accepts a single character, but then keeps only A–Z and 0–9, plus a
    fixed list of named keys: Comma, Period, the arrows, Insert, Delete,
    Home, End, PageUp, PageDown, Space, Tab and the media keys.
  - `Command::AcceleratorToString` is a hand-written `switch` over the same
    keys, going the other way. Anything else becomes `""`.
  - `HasValidModifierCombination` requires a modifier, refuses Shift
    alone, and refuses Ctrl+Alt "because of AltGr" (the only reason the
    code gives anywhere).
- `ui/base/accelerators/command_constants.h` holds the token strings.
- `extensions/common/command.cc` wraps the parser. A manifest with an
  unknown key **fails to install**.
- `chrome/browser/extensions/commands/command_service.cc` saves a user's
  binding as `"<platform>:" + AcceleratorToString(...)`. So the two
  directions must change together, or a save writes a broken pref.
- The shortcuts page, `chrome://extensions/shortcuts`, uses the shared
  `ui/webui/resources/cr_components/cr_shortcut_input/` widget.
  `cr_shortcut_util.ts` has its own `Key` enum of the same keys, as
  `keyCode` numbers, and `isValidKeyCode` rejects the rest. It never
  captures Tab (it lets Tab move focus), and `onKeyUp_` ignores Enter.
- **Matching has no further filter.**
  `chrome/browser/ui/views/extensions/extension_keybinding_registry_views.cc`
  registers the accelerator with the `FocusManager` at high priority, by
  key code and modifiers. Once one parses, `VKEY_RETURN` or `VKEY_OEM_2`
  (slash) would fire.

**Why the limit exists.** No design note, bug or CL found states it. The
history couldn't be read (shallow clone; the Chromium Gerrit, issue tracker
and docs sites were blocked from this sandbox). The likely reason is
**keyboard layout**:

- `VKEY_OEM_*` punctuation codes follow what the layout types.
- The shortcuts page draws the US glyph whatever the layout
  (`DomCodeToUsLayoutCharacter`).
- On Dvorak, which you use, `/`, `=`, `-` and `\` sit on different keys
  than on QWERTY. `Slash` would bind the Dvorak `/` key, and display as
  whatever US key is in that position.
- Comma and Period are the most layout-stable punctuation, which fits
  them being the two let in.

**Prior art.** Firefox allows F1–F12 in `suggested_key`, and since
Firefox 135 lets users assign F13–F19, but likewise no punctuation beyond
comma and period *(secondary, MDN)*. No Chromium request or attempt was
found *(the tracker was unreachable, so this is weak evidence)*.

**A patch** is about 6–8 files plus tests, 1–2 days of careful work:

1. One `{token, VKEY}` table in `command.cc`, used by both `ParseImpl` and
   `AcceleratorToString`, replacing the duplicated `if` chain and `switch`.
   New tokens named after `KeyboardEvent.code` (`Enter`, `Backspace`,
   `F1`–`F12`, `Slash`, `Backslash`, `Equal`, `Minus`, `Backquote`).
2. Tests in `ui/base/accelerators/command_unittest.cc` and
   `extensions/common/command_unittest.cc`.
3. `cr_shortcut_util.ts`: the new key codes, behind an opt-in property so
   the widget's other user (the settings page's omnibox shortcut) doesn't
   change. `cr_shortcut_input.ts`: take Enter on keydown. Their WebUI
   tests.
4. Names for F2, F3, F5, F7–F10 and F12 in `ui/strings/ui_strings.grd`,
   since `accelerator.cc` `KeyCodeToName` lacks them.
5. The `commands.json` docs, and the "Supported keys" list on
   developer.chrome.com.

**What reviewers would push back on:**

- **Layout**, for the punctuation keys, as above. Making them safe means
  matching by physical key (`DomCode`) or by character. That's a bigger,
  cross-platform design change, not a token-list edit.
- **Stealing keys from pages.** Extension accelerators beat the page:
  Ctrl+/ comments code in web editors, Ctrl+Enter submits, Ctrl+Backspace
  deletes a word.
- **Older Chrome.** A manifest using a new token won't install on a Chrome
  that predates it, so developers would declare it per platform or not at
  all. That matters less to tileco: a user-set binding is a pref, not a
  manifest key.
- **Shared code.** The widget and `ui::Command` have non-extension callers,
  including the autofill shortcut in
  `chrome/browser/renderer_preferences_util.cc`.

**Verdict:**

| Keys | Odds | Why |
|---|---|---|
| F1–F12 | fair | Firefox parity, layout-independent. On a Chromebook, F-keys are Search+top row, so it doesn't help tileco much. |
| Enter, Backspace | fair | Layout-independent. Needs the Enter fix in the widget. Gives tileco `Search+Return` back. |
| `\` `/` `=` `-` `` ` `` | low | Layout-dependent. Only with a positional-matching design, which would be a project in itself. |

**Recommendation.** Not on tileco's critical path. If anything, file a
Chromium issue for Enter and Backspace with tileco as the use case, and offer
the CL if a reviewer in `ui/base/accelerators/OWNERS` is open to it. Don't
attempt the punctuation keys. Meanwhile §7.1's combos stand, and the key
map is open to better choices (open question 5).

### 19.2 Mouse speed, acceleration and scroll speed

**What the setup asks for** (conf `config/hypr/hyprland.lua` 536–555 and
`config/hypr/scripts/apply-input.sh`):

- Pointer `sensitivity = 1.0`, libinput's fastest, with
  `accel_profile = "adaptive"`. The comment says flat and custom curves
  "felt wrong on a real session".
- Every mouse left-handed.
- Every mouse wheel at `scroll_factor = 3`, three times libinput's
  default. kitty adds `wheel_scroll_multiplier 5.0` on top.
- Touchpads: natural scrolling, tap to click, disable while typing.

**What chromeOS offers.** The settings are per device
(`ash/public/mojom/input_device_settings.mojom`, `MouseSettings`), set in
Settings › Mouse
(`chrome/browser/resources/ash/settings/device_page/per_device_mouse_subsection.ts`):

- swap primary button;
- cursor acceleration, on or off;
- pointer speed, **five steps** (`ticks = [1, 2, 3, 4, 5]`), default 3;
- reverse scrolling;
- "Controlled scrolling", which turns scroll acceleration off;
- scroll speed, five steps, **only while Controlled scrolling is on**.

Chrome writes them to the input stack as libgestures properties
(`ui/events/ozone/evdev/input_device_factory_evdev.cc` 329–366). The
curves are in libgestures, read here from an AOSP mirror of it
(`platform.external.libchrome-gestures`) and assumed to match chromeOS's
copy *(unverified)*:

- **Pointer, acceleration on**: five fixed curves
  (`kMaxAccelCurves = 5`, `accel_filter_interpreter.h`).
- **Pointer, acceleration off**: one slope per step,
  `{2, 4, 8, 16, 24}` (`accel_filter_interpreter.cc` 132). Each step
  doubles the speed, so there's nothing between them.
- **Wheel, Controlled scrolling on**: a fixed offset per notch,
  `{20, 36, 72, 112, 164}` (`mouse_interpreter.cc` 239).
- **Wheel, acceleration on** (the default): the speed slider is ignored.
  The offset per notch follows a curve in wheel velocity, small when slow,
  large when spun.

**What maps.** Speed 5 with acceleration on is the nearest to
`sensitivity 1.0` adaptive. Controlled scrolling at speed 5 gives 164 per
notch against 72 at the middle step. That's 2.3× the middle step,
close to the 3× target, if you accept losing the faster spin.
Left-handed is the button swap. Touchpad natural scrolling is native. The
finer steps and the exact 3× aren't offered in Settings.

**Finer than Settings**, most practical first:

1. **A mouse that stores its DPI.** libgestures assumes 1000 counts per
   inch (`Mouse CPI`), so a mouse sending more moves the pointer that much
   faster at every speed step. It's the one fix that survives reboots,
   needs no flag or developer mode, and reaches Android and Linux windows
   too. Some office mice, such as Logitech's M510, are fixed at 1000;
   Solaar (`solaar show`) lists `ADJUSTABLE DPI` on a Logitech mouse that
   can change it. Gaming mice keep it in onboard memory: set it once with
   Solaar, libratbag or the maker's app, on any machine.
2. **`gesture_prop` in crosh.** Tried on a Chromebook, in normal mode,
   with a Logitech M510:
   - It needs `chrome://flags/#gesture-properties-dbus-service`
     (`kGesturePropertiesDBusService`, off by default) and a restart.
     Then crosh's `gesture_prop` works without developer mode.
   - `gesture_prop devices` lists each input device's ID;
     `gesture_prop list <id>` its properties; `get <id> "<name>"` a
     value. `set` takes D-Bus typed values, such as
     `array:double:200,0,0,0,0` or `array:boolean:false`; a bare `3` is
     refused as badly formed.
   - crosh runs only the first line of a paste, so each command goes in
     on its own.
   - The wheel, with Controlled scrolling off:
     - `Mouse Scroll Accel Curve` is five polynomial coefficients in wheel
       speed, `10.374, 0.41773, 0.025737, 8.0428e-05, -9.1149e-07` by
       default. Its first term is the step per click.
     - It has no effect while `Mouse High Resolution Scrolling` is on,
       which it is by default, even on a wheel without high-resolution
       steps. Set that to `false` first.
     - A flat curve, `200,0,0,0,0`, gives every click the same, much
       longer step, with no acceleration; 200 suited the tester. Tripling
       all five coefficients only tripled the accelerated curve.
     - `Scroll Y Out Scale` (2.5 by default) didn't change wheel
       scrolling; it seems to be for the touchpad.
   - The pointer: `Mouse CPI` (default 1000), lower is faster in
     continuous steps; and `Mouse Pointer Accel Curve`, with
     `Use Custom Mouse Pointer Accel Curve`. Neither has been tried.
   - Chrome writes `Mouse Scroll Acceleration` and
     `Mouse Scroll Sensitivity` from Settings, but not the curve or the
     high-resolution switch.
   - **It's per device, and nothing re-applies it.** Whether a value
     survives a reboot, resume, replug, or a change in Settings is
     *(unverified)*. A device's ID may change between boots.
   - **tileco's reminder.** No extension can run crosh, so with a wheel
     step set on the options page (`wheelStep`, per Chromebook, off by
     default), tileco opens `src/mouse.html` at each login
     (`runtime.onStartup`). It shows `gesture_prop devices`, a box for the
     mouse's ID (the last one used filled in), and the two lines for that
     ID and step, each with a Copy button. The options page can open it
     any time, say after a replug.
3. **Developer mode**, with rootfs verification off: a file in
   `/etc/gesture/` (read at startup, `gesture_property_provider.cc`)
   makes the same properties stick. It costs verified boot, and updates
   overwrite the rootfs. That's the off-ramp (§3.6), not tileco.
4. **Web pages only**: extensions can rescale wheel events in pages, not
   in the shell or Linux apps. That's a poor fit.
5. **Linux apps**: exo converts chromeOS's offset to Wayland axis units
   (`components/exo/wayland/wayland_pointer_delegate.cc`). Sommelier has
   no scroll-scale option (`vm_tools/sommelier/sommelier-seat.cc`), so
   per-app multipliers, like kitty's, are the tool.

**No extension API or policy** reaches these. `settingsPrivate` is for
component extensions, and its allowlist has no mouse prefs. The only
mouse policy is the primary-button swap.

**A patch** would span two repos:

- libgestures, for more curves or a continuous value;
- Chromium, for the slider ticks, mojom ranges, clamps, metrics that
  assume 1–5, and tests.

A cheaper version is a "flat speed" and a "scroll multiplier" that map
onto `Mouse CPI` and the scroll curve. Either way it's 1–2 weeks of work
plus review across ash settings, ozone and gestures, and an outside patch
is unlikely to land. The five steps are a product choice by the chromeOS
peripherals team, though a flag or an accessibility framing would help.
**And it wouldn't reach this Chromebook** until it shipped, since a
patched Chrome needs developer mode and a custom image. No existing
request was found *(issue tracker unreachable)*.

**Recommendation.** Use Settings: speed 5, acceleration on, button swap,
Controlled scrolling at 5. Try `gesture_prop` once, to see whether
`Mouse Scroll Accel Curve` ×3 feels like home and whether it survives a
reboot, and record the result in M2. Don't patch.

## 20. Googlebook OS (tidal)

chromeOS's successor, codenamed Aluminium, is Android-based. If tileco ever
follows it, the port is **tidal**. This section records what that OS
allows, so tileco's core is built to carry over. Checked 2026-10-23. The
Android sites, news sites and Google hosts were mostly unreachable from
the sandbox, so most dates here are *(secondary)*.

### 20.1 Status

- **Timeline** *(secondary)*:
  - Google announced the chromeOS and Android merger in 2025.
  - It announced the **Googlebook** laptop brand on 2026-05-12, with Acer,
    ASUS, Dell, HP and Lenovo.
  - It named the OS **Googlebook OS** in September 2026.
  - Laptops went on sale in the US in early October 2026.
- developer.android.com lists Googlebook as a device category: existing
  Android apps "will work on Googlebook"
  ([verified](https://developer.android.com/googlebook)).
- It's reported to be based on Android 17 *(secondary)*.
- **Existing Chromebooks**: "many" newer ones, mostly commercial models,
  will be able to switch, with no list yet. chromeOS continues for
  enterprise and education, with updates through 2034 *(secondary)*.

### 20.2 What it offers natively

From AOSP `android16-qpr1-release`, on the GitHub mirror; Android 17 source
isn't public yet:

- **Snapping, not tiling**: snap left or right half, maximize, minimize,
  move to the next display. WM Shell's `windowdecor/tiling` is a two-window
  pair with a divider. There's no master/stack and no automatic layout.
- **Desks**, switched by key, with a basic UI *(secondary)*.
- **Shortcuts**: you can rebind system actions in Settings, as long as each
  includes the G key *(secondary)*. Apps can't add their own; the API needs
  `MANAGE_KEY_GESTURES`, a signature permission.

### 20.3 What a third-party app can do

| Need | Possible? | How | Caveats |
|---|---|---|---|
| List every window with its bounds | yes | `AccessibilityService.getWindowsOnAllDisplays()` | Play makes apps declare accessibility use. Android 17's opt-in Advanced Protection blocks services not marked as accessibility tools *(secondary)*. |
| **Global keys** | likely | accessibility `onKeyEvent` with key filtering, which sees keys before apps and before the system's key gestures (AOSP `KeyboardInterceptor`) | Not tried on a Googlebook. This is what chromeOS lacks (§2.2). |
| Place a window when launching it | yes | `ActivityOptions.setLaunchBounds()` | Launch time only; the system may adjust. |
| Move or resize another app's running window, public API | **no** | none. Android 17's `AppTask.moveTaskTo` moves only the caller's own tasks, and needs a role only the default browser gets. | none |
| Move or resize it through Shizuku or adb | yes | `IActivityTaskManager.resizeTask`, `setTaskWindowingMode`; the shell user holds `MANAGE_ACTIVITY_TASKS` | Hidden APIs that break between releases. Shizuku needs re-arming over wireless debugging after each reboot. Enterprise policy can disable adb, which ends it. |
| A bar | overlay only | an overlay window or a home app | The window decorations, taskbar and desks belong to SystemUI. |
| Chrome extensions | yes | Googlebook's Chrome runs extensions *(secondary)*. Chromium builds `commands` and `windows` for desktop Android (`chrome/browser/extensions/api/BUILD.gn`). | Still only Chrome's windows, and still no global commands. Changing bounds needs Chrome to be the default browser and the window to be freeform (`windows_api.cc`). |
| Linux GUI apps | not yet | The Terminal app's Debian VM is CLI-only today. GUI apps and GPU are planned *(secondary)*. | none |

**Prior art.**
[Aypex/android-tiling-wm](https://github.com/Aypex/android-tiling-wm)
(Apache-2.0, v0.1.0) tiles with Shizuku plus accessibility events: master
and stack, rows, monocle. It reports working on Android 17 on a Pixel, after
two breakages. It has no workspaces and no keyboard control yet.

### 20.4 What it means for tileco

- **tidal could tile every app**, not just Chrome's, and catch keys
  globally. That's more than tileco can ever do on chromeOS. The price is
  Shizuku: developer options, re-arming after each reboot, and hidden APIs
  that move every release.
- **It ships on the Play Store.** That means declaring the accessibility
  use and passing Play's review of it, including the 2026 rule against
  apps that act autonomously *(secondary)*. Apps that use Shizuku are on
  Play today *(unverified)*, but Play could still object to the hidden
  APIs. The accessibility-only tier (global keys, placing apps at launch)
  is the safer listing; the Shizuku tier is opt-in inside it.
- **A managed laptop is the deciding question.** If policy disables
  developer options or adb, tidal falls back to accessibility only: global
  keys, and placing apps at launch, but no re-tiling of running windows.
- **The shared core is cheap insurance.** tileco's geometry, workspace state
  machine (§6.1), settings schema and key-map model are already specified
  free of `chrome.*` (§5.2, §17). tidal would reuse them unchanged behind an
  accessibility service and a Shizuku layer. So tileco does nothing for
  Googlebook now beyond keeping that line clean.
- **Upstream is a poor bet.** AOSP has developed in private since 2025, and
  publishes source twice a year *(secondary)*. A WM Shell patch would land
  on code months stale. Not worth trying.
- **The Chromium key patch** (§19.1) still applies to both, since the
  commands code is shared with desktop Android. But tidal's accessibility
  keys make it matter less there. It stays optional.

## Appendix A: the rest of the setup

Everything else in `mikelward/conf` and `mikelward/scripts`, and what
chromeOS can do with it. The desktop pieces are in §4; this is the rest.

- **Crostini**: works inside Linux on chromeOS.
- **Native**: chromeOS has its own equivalent.
- **Partial** or **no**: the gap is named.

Unmarked claims come from reading the configs and scripts.
*(unverified)* marks chromeOS behavior not yet checked on a device.

### A.1 Works in Crostini

| What | Notes |
|---|---|
| Shells and prompt: zsh, bash, fish, nushell, Elvish, mesh, ksh (`shrc`, `shrc.vcs`, `config/{fish,nushell,elvish,mesh}`), the `vcs` binary | The Terminal app opens the container user's login shell, so `chsh` to zsh works *(unverified)*. crosh isn't a real shell; not a target. |
| `env`, `config/environment.d` | The container runs a systemd user manager (garcon runs under it), so apps from the launcher should get the environment *(unverified)*. |
| readline and tool rc files (`inputrc`, `editrc`, `exrc`, `nanorc`, `gdbinit`, `screenrc`, `muttrc`, …) | Affect Linux apps only. |
| kitty, sakura | kitty needs OpenGL 3.3. Classic Crostini has virgl where the board supports it. Baguette drops GPU support, so kitty would render on the CPU through llvmpipe *(unverified)*. kitty's auto light/dark likely doesn't see chromeOS's dark mode *(unverified)*. |
| vim, nvim, helix, emacs, Sublime Text; `codeedit`, `idea`, `makemakefile`, `precommit` | GUI editors run as their own chromeOS windows. `homepkg` handles aarch64 for ARM Chromebooks. |
| tmux, shpool, `sessionlib` and the session scripts | `setup`'s systemd user unit works. Sessions outlive a closed Terminal window but not a chromeOS reboot or a Linux shutdown *(unverified)*. |
| git, hg, jj and their config; `gitbackup`, `confinst`, `confdist`, `homepkg`, `package` | The container's `$HOME` is separate from chromeOS's files. Share through "Linux files" or a shared folder. |
| atuin, lf, fzf, zoxide, rg, fd, bat, delta, gh, uv; the small utilities (`args`, `clocks`, `filter`, `total`, …) | `diskspace` and `diskuse` report the VM's disk, not chromeOS's. `mailifnotempty` needs an MTA. |
| ssh config, `set-ssh-alias`, `terminal_on`, `terminal_on_workstation` | ssh-agent works per container. |
| Agent config (`conf/claude`, `conf/gemini`, `conf/agents`) | The CLIs run in Linux. |

### A.2 Native on chromeOS instead

| What | chromeOS has |
|---|---|
| `bluetooth-connect` | Quick Settings › Bluetooth. The container has no Bluetooth stack. |
| `vol`, `playpause`, `media` | Media and volume keys, Quick Settings. pactl in the container moves only its own stream. |
| `pulseprofile.py`, `pa.py` | The Quick Settings audio output and input picker. |
| `connect`, `showconn` (nmcli) | Settings › Network. The container has its own virtual network. |
| `external_monitors_only`, `monitor-hotplug.sh` | Settings › Displays, and docked mode with the lid closed *(unverified)*. |
| `left`, `right` (button swap) | Settings › Mouse › Swap primary button, per device (§19.2). |
| `lock-screensaver`, `screensaver`, `xsecurelockrc` | The lock screen and screen saver. |
| `devilspie`, `moveto`, `snap` | Desks and snapping, or tileco. |
| `gmail`, `google-calendar`, `google-chat`, `google-meet`, `music`, `discord`, `remote-desktop` | Installed web apps (§3.5, §9.1). |
| `home` | The Files app. |

### A.3 Partial

| What | Gap |
|---|---|
| US Dvorak with Caps Lock as Compose (`setup` `configure_keyboard`, `dvorak`, `dvorak.kmap`) | Dvorak is native. There's no Compose key anywhere in chromeOS *(unverified)*. In Crostini, `setxkbmap compose:caps` affects only X apps, and may map them differently from Wayland apps *(unverified)*. |
| espanso | Its Wayland backend needs evdev and uinput, which Crostini doesn't expose. Its X11 backend could expand inside X apps only *(unverified)*. Text-expander extensions work only in web pages. |
| `xbindkeys`, `xmodmaprc`, `imwheelrc`, `Xdefaults`, `kev` | X apps under Xwayland only, while one has focus. |
| `chrome` and `browser1`–`3` run from Linux | They start a Linux Chrome, if one is installed. To send plain links to the chromeOS browser instead, point `BROWSER` at `garcon-url-handler` *(secondary)*. `--app=` can't go that way. |
| `pidcat`, adb | adb reaches chromeOS's own Android from Crostini once ADB debugging is on in Settings › Linux, which may need a powerwash *(secondary)*. A USB phone needs per-device USB passthrough. |
| `chrome-remote-desktop-session` | Controlling other machines works. Hosting from a consumer Chromebook is Remote Support codes only; unattended access is an admin policy *(secondary)*. |

### A.4 Not possible

| What | Why |
|---|---|
| sway, Hyprland, i3, qtile, xmonad, wingo; waybar, polybar, xmobar, dunst, swaync, fuzzel, swaylock, compton, uwsm, tide | Linux windows are guests of chromeOS's window manager. A WM can only run nested in one window (§12). |
| `xinitrc`, `xsession`, `xsessionrc` | There's no X session to start. |
| `ddcinput` | No i2c in the container, and no DDC control in chromeOS *(unverified)*. |
| `amethyst.yml`, `setup-macos`, karabiner | macOS only. chromeOS's per-keyboard modifier remapping covers the basic swaps. |

### A.5 `setup` in Crostini

`setup` doesn't know about Crostini today. Line numbers are from
`mikelward/scripts` `main` on 2026-10-23.

- `detect_os` (695–713) sees apt and picks `debian`. Sommelier sets
  `DISPLAY` and `WAYLAND_DISPLAY`, so `have_display` (720–728) turns the
  GUI on.
- `install_packages` (978–996) then installs KDE and Plasma with their
  recommends: gigabytes on a default Linux disk of about 10 GB, possibly
  pulling in sddm, which can't run in the container *(unverified)*.
- `setup-kde` runs against a session that doesn't exist. `--tide` would
  try to install Hyprland and greetd.
- `configure_keyboard` (2169–2215) writes `/etc/default/keyboard`, which
  does nothing with no VT. Its `setxkbmap … dvorak compose:caps` affects
  X apps only.
- `keep_display_gpu_awake` (2283–2330) finds no matching GPU and does
  nothing, but shouldn't run.
- `MIN_DISK_GB=15` (125) would quietly force the minimal profile and skip
  helix, jj and nushell.
- `gpasswd -a "$USER" root` (2486–2492) isn't needed; the Crostini user
  already has sudo *(unverified)*.
- What works: fonts, kitty, the shpool unit (1394–1455), `make -C root
  install`.

**The Crostini mode** (mikelward/scripts#306, merged 2026-10-24) does
these:

- detects Crostini (`/dev/.cros_milestone` or
  `/opt/google/cros-containers`, *(unverified on a device, and for
  Baguette)*), on Debian only;
- keeps kitty and fonts, but skips KDE, `setup-kde`, tide, the keyboard
  config, the GPU rule and the root group, printing what to set in chromeOS
  Settings instead;
- explains the disk-size cutoff, pointing at Settings › About chromeOS ›
  Linux development environment › Disk size;
- comes with `setup_test` cases.

Still to do, in that repo's `TODO.md`:

- set `BROWSER` to `garcon-url-handler`, and teach `chrome` to hand plain
  URLs to the chromeOS browser;
- warn on Baguette that kitty will render on the CPU.

## Sources

Checked 2026-10-23:

- Chromium `main` at `a3f88457` (major 158), via the
  [GitHub mirror](https://github.com/chromium/chromium):
  `chrome/common/extensions/api/windows.json`,
  `chrome/browser/extensions/browser_extension_window_controller.cc`,
  `chrome/browser/extensions/api/tabs/windows_util.cc`,
  `extensions/common/api/system_display.webidl`,
  `extensions/common/api/commands/commands_handler.cc`,
  `ui/base/accelerators/command.cc`,
  `chrome/browser/extensions/extension_commands_global_registry.cc`,
  `ui/base/ime/ash/input_method_ash.cc`,
  `chrome/common/extensions/api/_permission_features.json`,
  `extensions/common/api/_manifest_features.json`,
  `chromeos/ash/experiences/extensions/common/api/_permission_features.json`,
  `ash/public/cpp/accelerators.h`,
  `ash/webui/shortcut_customization_ui/backend/accelerator_layout_table.cc`,
  `ash/constants/ash_features.cc`,
  `ash/wm/tile_group/window_tiling_controller.h`,
  `chrome/common/chrome_features.cc`
- For §19: `ui/base/accelerators/command_constants.h`,
  `extensions/common/command.cc`,
  `chrome/browser/extensions/commands/command_service.cc`,
  `ui/webui/resources/cr_components/cr_shortcut_input/`,
  `chrome/browser/ui/views/extensions/extension_keybinding_registry_views.cc`,
  `ash/public/mojom/input_device_settings.mojom`,
  `chrome/browser/resources/ash/settings/device_page/per_device_mouse_subsection.ts`,
  `ui/events/ozone/evdev/input_device_factory_evdev.cc`,
  `components/exo/wayland/wayland_pointer_delegate.cc`
- libgestures via the AOSP mirror
  [platform.external.libchrome-gestures](https://github.com/msft-mirror-aosp/platform.external.libchrome-gestures):
  `accel_filter_interpreter.{h,cc}`, `mouse_interpreter.cc`;
  ChromiumOS platform2: `vm_tools/sommelier/sommelier-seat.cc`,
  `crosh/crosh` (`gesture_prop`)
- [chrometile](https://github.com/brockgr/chrometile) at `af8e367`
  (2026-10-13)
- [Quilt](https://github.com/MrViolets/Quilt),
  [chromewm](https://github.com/JayGoldberg/chromewm),
  [virtualdesktops-extension](https://github.com/google/virtualdesktops-extension)
- [crouton](https://github.com/dnschneid/crouton) README and commit
  `59e36db` (end of life, 2024-12-31)
- *(secondary)* [chromeOS developer news](https://developers.google.com/chromeos/app-development/develop/news)
  for Baguette; [Chromebook keyboard shortcuts](https://support.google.com/chromebook/answer/183101);
  [9to5Google on Lacros](https://9to5google.com/2024/07/12/chromeos-lacros-ending/);
  [Aluminium OS](https://en.wikipedia.org/wiki/Aluminium_OS)
- tide's [SPEC.md](https://github.com/mikelward/tide/blob/main/SPEC.md) and
  `mikelward/scripts`' `setup-kde` for the behavior being matched
