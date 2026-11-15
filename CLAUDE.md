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

The user works on this machine while sessions run. **Never launch the app window on their workspace or take screen grabs** unless they ask in that message. Use instead:

- `scripts/preview-headless.sh out.png 'file=test.md&cursor=420&keys=Ctrl+P&type=font' 900x760` renders the built frontend in headless Chromium with a mocked backend (`tests/harness/mock.js`). Needs `npm run build` first. Hash options: `file` (test.md or a file in tests/harness/), `cursor`, `scroll`, `keys` (combos separated by `;`), `type`.
- `ALLWRITE_SNAPSHOT=/path/out.png allwrite file.md` makes the real app write a PNG of its page after `ALLWRITE_SNAPSHOT_DELAY` ms (default 3000). The window still opens, so only use it when the user is fine with that.
- Hyprland here uses the Lua config API (`hl.*`, `hyprctl eval`); old `hyprctl dispatch exec "[rules] cmd"` syntax does not work.

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
  main.rs            Tauri commands, watcher thread, WebKit memory tuning, snapshot dev hook
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

## Status

Phases 1–5 of PLAN.md are implemented. Unit tests pass (Rust + vitest) and the frontend is verified in headless Chromium.
**Not yet verified in the real WebKitGTK app:** total RAM (run `scripts/measure.sh`), startup time, pywal live switch, native dialogs, image paste and drag-drop. Update this section once they are.

## Git

Local repository only, branch `main`. Commit after each working change.
