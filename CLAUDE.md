# allwrite

Minimal live-preview Markdown / text / code editor for Linux (Hyprland + pywal).
Rust + Tauri 2 (system WebKitGTK) + CodeMirror 6, plain TypeScript, no UI framework.
`PLAN.md` is the spec: goals, feature tables, keybinds, phases. Read it before changing behavior.

## Priorities

1. **Low RAM** (target under 100 MB total PSS across `allwrite` + `WebKitWebProcess` + `WebKitNetworkProcess`) and 0% idle CPU.
   No polling or idle timers: everything is inotify / D-Bus signal / DOM event driven. One-shot debounce timers after user input are fine.
2. The file on disk is always the plain text the user typed. Live preview is decorations only; never reformat the document.
3. Every action is a command in the registry (`src/commands.ts`, defined in `src/actions.ts`). Buttons, keybinds and the palette all run commands; do not wire behavior anywhere else.

## Do not disturb the desktop

The user works on this machine while sessions run. **Never open the app on their current workspace or grab their screen.** On 2026-11-15 they allowed test launches on **Hyprland workspace 9** (they work on 1); confirm that still holds before relying on it in a new session.

- `scripts/run-ws9.sh [VAR=value ...] [-- file]` starts the release build on workspace 9 without switching to it (`hl.exec_cmd(cmd, { workspace = "9 silent" })`). Hyprland here uses the Lua API (`hyprctl eval`); the old `hyprctl dispatch exec "[rules] cmd"` syntax fails.
- Dev hooks in the real app (cost nothing when unset): `ALLWRITE_SNAPSHOT=/path/out.png` writes a PNG of the page after `ALLWRITE_SNAPSHOT_DELAY` ms (default 3000); `ALLWRITE_EVAL='<js>'` runs JS in the page halfway through that delay. `window.allwrite` is the app state (`allwrite.view` is the CodeMirror view); synthetic `keydown` events on `window` trigger commands.
- `scripts/preview-headless.sh out.png 'file=test.md&cursor=420&keys=Ctrl+P&type=font' 900x760` renders the built frontend in headless Chromium with a mocked backend (`tests/harness/mock.js`), no window at all. Needs `npm run build`. Hash options: `file` (test.md or a file in tests/harness/), `cursor`, `scroll`, `keys` (combos separated by `;`), `type`. Chromium is not WebKit: it did not catch the lazy-image bug below.
- Always `pkill -x allwrite` when done and check `hyprctl activeworkspace` is still the user's.

## Commands

```
npm run build                      # typecheck + bundle frontend into dist/
npm test                           # vitest (tests/*.test.ts)
(cd src-tauri && cargo test --release)
npx tauri build --no-bundle        # release binary: src-tauri/target/release/allwrite (embeds dist/)
npx tauri dev                      # dev mode with hot reload (opens a window)
scripts/measure.sh                 # PSS of a running allwrite + its WebKit processes
scripts/install.sh [--default]     # per-user install into ~/.local
```

Reuse the release profile for tests (`cargo test --release`) so the dependency build is shared.

## Layout

```
src/                 frontend
  main.ts            bootstrap, global key handler, backend events, drag-drop, close guard
  actions.ts         all command definitions      commands.ts  registry      keymap.ts  combo strings + overrides
  doc.ts             open/save/reload, dirty state, config updates           state.ts   shared state + event bus
  theme.ts           palette -> CSS variables, contrast check                fonts.ts   font slots -> CSS variables
  editor/setup.ts    CodeMirror extensions per mode (markdown | text | code), highlight style, chrome theme
  editor/livePreview.ts   the core: buildDecorations(state, visibleRanges) + ViewPlugin
  editor/images.ts   image widget, path resolution, paste      widgets.ts  bullet / hr / checkbox
  editor/format.ts   bold, headings, lists...                   languages.ts  mode by file name, lazy language load
  ui/                topbar, statusbar, palette (also the generic picker), settings, overlay (modal/banner/toast), icons
src-tauri/src/
  main.rs            Tauri commands, watcher thread, lean env + WebKit tuning, snapshot/eval dev hooks
  gpu_guard.rs       keeps WebKit from waking a suspended GPU (exports __open_2, see build.rs)
  files.rs           read, atomic write, image import, recent files
  theme.rs           pywal -> portal -> built-in palette        config.rs  config.toml        fonts.rs  fc-list
tests/               vitest; tests/harness/ is the headless preview mock
packaging/           .desktop + PKGBUILD
```

## Things that are easy to get wrong

- **Non-async Tauri commands run on the GTK main thread.** A blocked or deadlocked command freezes the window. Never hold a `Mutex` guard across a call that locks again; note that a guard created inside a struct literal or call expression lives until the end of that whole statement (this caused a startup hang once, in `init`).
- The watcher ignores our own saves by comparing content hashes (`Doc.hash`), so set the hash before writing.
- Live preview only walks `view.visibleRanges`. Each decoration carries `spec.kind` so tests can assert on it. The image widget is identical whether the syntax is hidden or shown, so the image does not reload when the cursor enters.
- Editor colors are CSS variables inside the CodeMirror theme and highlight style, so a palette change is just `applyTheme()`; no editor reconfiguration.
- CodeMirror's base theme beats plain stylesheet rules for its own classes; put those overrides in the `chrome` theme in `editor/setup.ts`, and keep `styles.css` for our own classes.
- Key combos are matched from `event.code` for digits and punctuation (so `Ctrl+Shift+8` works) and from `event.key` for letters.
- Local images load through the asset protocol. The document's folder is allowed when a file opens; absolute paths elsewhere go through the `allow_image` command (image extensions only). The CSP in `tauri.conf.json` must keep `asset:` in `img-src`.
- Permissions for window APIs used from JS live in `src-tauri/capabilities/default.json`; a new `@tauri-apps/api` call usually needs an entry there.

## Deviations from PLAN.md

- Portal fallback uses gio D-Bus from the `gtk` crate (already linked) instead of `zbus`, and is only set up when pywal's `colors.json` is absent.
- Fonts come from `fc-list` rather than linking fontconfig.
- Top bar: one heading button (opens a picker); Save As, Replace and zoom are keys + palette only.
- No hanging indent for wrapped list items yet; tables are shown raw in the code font.

## Memory and startup (measured 2026-11-15, 1426x761 window at scale 2, test.md)

| Configuration | Total PSS |
|---|---|
| Tauri defaults | ~300 MB |
| Current build (lean env in `main.rs`) | **~170-180 MB** (allwrite ~50, WebKitWebProcess ~100, WebKitNetworkProcess ~20) |

Cold start to titled window: ~330 ms. Idle CPU: 3 ticks in 20 s.

**The sub-100 MB goal is not met and is not reachable on WebKitGTK**: what remains is WebKit/JSC code pages (~75 MB), two full-window software backing stores at scale 2 (~35-40 MB) and heaps. PLAN.md section 3 says to revisit the stack above 150 MB; that decision is the user's (the alternative it names is native GTK4, ~50 MB).

What the lean setup does (`LEAN_ENV` + `gpu_guard.rs`; `ALLWRITE_GPU=1` turns all of it off):
- Software rendering, no EGL: otherwise both processes load the NVIDIA + Mesa/LLVM driver stacks (~80 MB).
- `JSC_useJIT=0` (~40 MB) and `Malloc=1` (~20 MB).
- `gpu_guard.rs`: WebKit opens every `/dev/dri/card*` at page load; on this hybrid laptop that woke the sleeping NVIDIA GPU and blocked startup for ~2.2 s on every launch after the GPU had gone back to sleep. The binary exports its own `__open_2` that refuses DRM nodes whose device is runtime-suspended. If startup gets slow again, check `/sys/bus/pci/devices/0000:01:00.0/power/runtime_status` before and after a launch.
- These variables are removed from the environment of `xdg-open` so browsers do not inherit them.

## Status

Phases 1-5 of PLAN.md are implemented. Verified in the real WebKitGTK app on 2026-11-15: rendering, local / absolute / remote images, external-change reload, save through IPC (atomic write, no false "changed on disk"), palette with key hints, font listing, recent files, startup time, idle CPU, RAM.
**Not yet exercised in the real app:** native open/save dialogs, image paste and drag-drop, pywal live recolor (needs a wallpaper change), portal fallback, autosave, close-with-unsaved prompt.

Known WebKitGTK quirks: `loading="lazy"` images never loaded, so image widgets load eagerly. The user's AT-SPI registry fails to start (harmless warnings on stderr).

## Git

Local repository only, branch `main`. Commit after each working change.
