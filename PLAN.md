# allwrite — Build Plan

A minimal, fast and good-looking text and Markdown editor for Linux (Hyprland + pywal).
You edit directly in the rendered Markdown: there are no separate edit and preview modes.

> Stack decision: **Rust + Tauri 2 + CodeMirror 6.** A native GTK4 version was considered (~50 MB RAM)
> and rejected. Tauri gives the most polished look with the least custom drawing code; the cost is more RAM (§3).

---

## 1. Goals and non-goals

**Goals (priority order)**
1. **Low RAM, low CPU.** Under ~120 MB total, near 0% CPU when idle, opens in under 0.5 s. (Apostrophe uses 300–400 MB.)
2. **Edit inside the rendered Markdown.** Formatting renders as you type, and the raw syntax shows only on the line or element your cursor is on, like Obsidian or Typora.
3. **Images in Markdown.** Local images (relative or absolute paths) and remote ones are shown inline. You can paste or drag-and-drop an image to add it.
4. **Follows the system palette live.** When pywal changes colors, allwrite updates instantly with no restart.
5. **Everything has a keybind and a button.** Both run the same command.
6. **Font selection** from the command palette and from a small settings panel.
7. **Plain text, Markdown, and code** with decent syntax highlighting (code is lower priority).
8. **Sleek and minimal UI.**

**Non-goals for v1** (keep it basic): tabs, file-tree sidebar, plugins, sync, PDF export, math or Mermaid.

---

## 2. Stack

| Layer | Choice | Why |
|---|---|---|
| App shell | **Tauri 2** (Rust) | Small native binary; uses the system's WebKitGTK, so no bundled Chromium |
| Editor | **CodeMirror 6** | Fast and only renders what's on screen. Live preview is built from "decorations" on top of the raw Markdown, so the file on disk always stays plain `.md` |
| Frontend | **Plain TypeScript + Vite**, no framework | No React or Vue overhead; smaller bundle and less RAM |
| Markdown parsing | `@codemirror/lang-markdown` (Lezer, GFM) | Parses incrementally as you type and comes with CodeMirror |
| Code highlighting | `@codemirror/language-data` | Each language loads only when a file needs it |
| Theme source | pywal `~/.cache/wal/colors.json` + XDG portal | Matches your setup (Hyprland + pywal) |
| File watching | `notify` crate (inotify) | Event-based with no polling, so it uses no CPU when idle |

Why CodeMirror live preview rather than a "true WYSIWYG" editor (ProseMirror/TipTap/Milkdown):
those editors convert Markdown into an internal document and back, which can quietly reformat your
files. CodeMirror edits the actual text, so what's saved is exactly what you typed.

---

## 3. RAM reality check (decision gate)

Tauri on Linux runs WebKitGTK, which starts a separate web process. A small Tauri app typically uses
**~80–150 MB total**: well under Apostrophe, but above the ~50 MB a native GTK4 app could reach.

Reference measurements on this machine (memory each process actually uses, PSS):
GNOME Text Editor (GTK4) 95 MB with the GPU renderer, 53 MB with the cairo renderer.

**Phase 0 measures this before we build anything else.** We measure total PSS across
`allwrite` + `WebKitWebProcess` + `WebKitNetworkProcess`:

- ≤ 120 MB → continue.
- 120–150 MB → apply the tweaks in §9, then measure again.
- \> 150 MB → stop and revisit the stack together.

---

## 4. Project layout

```
allwrite/
├── PLAN.md
├── logos/                     # existing SVGs → app icon
├── package.json, vite.config.ts, tsconfig.json
├── index.html
├── src/                       # frontend (TypeScript)
│   ├── main.ts                # bootstrap: load file, config, theme, editor, UI
│   ├── commands.ts            # single command registry (id, label, keys, run)
│   ├── keymap.ts              # default keybinds + user overrides
│   ├── theme.ts               # receives palette → sets CSS variables
│   ├── fonts.ts               # font list, apply font settings
│   ├── editor/
│   │   ├── setup.ts           # CodeMirror config per file type
│   │   ├── livePreview.ts     # hide syntax / style Markdown (core feature)
│   │   ├── images.ts          # inline image widgets, paste/drop
│   │   ├── widgets.ts         # checkbox, hr, bullet widgets
│   │   └── languages.ts       # extension → language, lazy loaded
│   ├── ui/
│   │   ├── topbar.ts          # filename, dirty dot, buttons
│   │   ├── statusbar.ts       # words, chars, reading time, line:col
│   │   ├── palette.ts         # Ctrl+P command palette
│   │   └── settings.ts        # Ctrl+, settings panel (fonts etc.)
│   └── styles.css             # all colors and fonts via CSS variables
└── src-tauri/                 # backend (Rust)
    ├── Cargo.toml
    ├── tauri.conf.json
    └── src/
        ├── main.rs            # CLI args, window, plugin setup
        ├── files.rs           # read / atomic write / watch open file / save pasted images
        ├── theme.rs           # pywal + portal reading and watching → emits "theme-changed"
        ├── fonts.rs           # list installed font families (fontconfig)
        └── config.rs          # ~/.config/allwrite/config.toml
```

---

## 5. Core features in detail

### 5.1 Editing inside the rendered Markdown (live preview)
A CodeMirror `ViewPlugin` walks the Markdown syntax tree **only for the part of the document on screen**
and applies decorations:

| Element | When the cursor is away | When the cursor is on it |
|---|---|---|
| `# Heading` | `#` hidden, large heading style | `#` shown, dimmed |
| `**bold**`, `*italic*`, `~~strike~~`, `` `code` `` | markers hidden, text styled | markers shown, dimmed |
| `[text](url)` | only "text" shown, styled as a link (Ctrl+click opens) | full syntax shown |
| `- item` / `1. item` | bullet widget / number | raw shown |
| `- [ ] task` | clickable checkbox (toggles the text) | raw shown |
| `> quote` | left bar + indent | `>` shown |
| `---` | horizontal rule widget | raw shown |
| ```` ```lang ```` fences | rounded code block, fences dimmed, code highlighted | fence shown |
| `![alt](img.png)` | **image rendered** (see 5.2) | syntax shown **and** image stays visible below |

The rule "show the raw syntax only where the cursor is" means you never have to switch modes.
An optional **source mode** toggle (`Ctrl+E`) shows the raw text for the whole file.

### 5.2 Images
- Relative paths are resolved against the open file's folder. They load through Tauri's asset protocol,
  which is allowed **only for that folder** while the file is open.
- Remote `https://` images are allowed (can be switched off in config).
- `loading="lazy"` and `decoding="async"`, and images are capped to the editor width. Because CodeMirror only
  renders what's on screen, images you've scrolled past are dropped from the page, which keeps RAM low.
- **Paste** a screenshot or **drag-drop** a file → it's saved to `<doc folder>/assets/<timestamp>.png` → `![](assets/<timestamp>.png)` is inserted.
- A broken path shows a small "image not found" placeholder.

### 5.3 File types
| Type | Behavior |
|---|---|
| `.md`, `.markdown` | live preview + images |
| `.txt` / unknown | plain text, prose font, soft wrap |
| code (`.rs`, `.py`, `.js`, …) | syntax highlighting (lazy loaded), code font, line numbers |

Large-file guard: files over ~5 MB open with live preview off. Files that aren't valid UTF-8 open read-only with a notice.

### 5.4 Fonts
- **Two font slots:** *Text font* (prose/Markdown) and *Code font* (code blocks, code files),
  plus size, line height and column width.
- **Command palette:** type `font` → `Text font: Inter`, `Text font: Serif`, `Code font: JetBrains Mono`, …
  Picking one applies instantly.
- **Settings panel** (gear button, `Ctrl+,`): font dropdowns (searchable list of **all installed fonts**, which Rust
  reads from fontconfig), a size control, and line height and width sliders.
- Curated quick picks at the top (only fonts that are installed are shown): Inter, JetBrains Mono, IBM Plex Sans/Serif,
  Noto Serif, Literata, iA Writer Quattro/Duo, plus generic **Serif / Sans / Monospace**.
  (JetBrains Mono is already installed; Inter is `pacman -S inter-font` if wanted.)
- Fonts are applied through CSS variables (`--font-text`, `--font-code`) and saved to `config.toml` immediately.

### 5.5 Commands, keybinds and buttons
A single **command registry** is the only place actions are defined. Toolbar buttons, keybinds
and the command palette all call the same command, so they can't drift apart.

| Action | Keys | Button |
|---|---|---|
| New / Open / Save / Save As | `Ctrl+N` / `Ctrl+O` / `Ctrl+S` / `Ctrl+Shift+S` | ✓ |
| Command palette | `Ctrl+P` | ✓ |
| Settings (fonts etc.) | `Ctrl+,` | ✓ |
| Find / Replace | `Ctrl+F` / `Ctrl+H` | ✓ |
| Bold / Italic / Strike / Inline code | `Ctrl+B` / `Ctrl+I` / `Ctrl+Shift+X` / ``Ctrl+` `` | ✓ |
| Heading 1–3 / normal text | `Ctrl+1..3` / `Ctrl+0` | ✓ |
| Link / Image | `Ctrl+K` / `Ctrl+Shift+I` | ✓ |
| Bullet list / Task list / Quote | `Ctrl+Shift+8` / `Ctrl+Shift+T` / `Ctrl+Shift+.` | ✓ |
| Toggle source mode | `Ctrl+E` | ✓ |
| Focus mode (hide bars) | `Ctrl+Shift+F` | ✓ |
| Zoom in / out / reset | `Ctrl+=` / `Ctrl+-` / `Ctrl+Shift+0` | — |
| Quit (asks if unsaved) | `Ctrl+Q` | — |

### 5.6 UI (sleek and minimal)
- **No window decorations** (Hyprland tiles it anyway).
- **Slim top bar** (~32 px): filename + unsaved dot on the left. Icon buttons on the right
  (open, save, B / I / H / link / image, source mode, palette, settings). It fades while typing and comes back on mouse move.
- **Slim status bar**: words · characters · reading time · line:col.
- The text column is centered (~72 characters, configurable) with generous line height.
- Line-based SVG icons (Lucide, only the ~15 we use are bundled).
- Gentle 120 ms transitions only. No animations while you type.

### 5.7 System palette integration (pywal, live)
Rust `theme.rs`:
1. **pywal:** read `~/.cache/wal/colors.json` and watch it with inotify, debounced ~100 ms.
2. **Fallback: XDG desktop portal** (`org.freedesktop.appearance` → `color-scheme` + `accent-color`),
   subscribed to `SettingChanged`.
3. **Last resort:** built-in light and dark palettes.

Rust emits a `theme-changed` event → `theme.ts` sets CSS variables → the whole UI recolors instantly.

| CSS variable | pywal key |
|---|---|
| `--bg` | `special.background` |
| `--fg` | `special.foreground` |
| `--cursor` | `special.cursor` |
| `--muted` (dimmed syntax, UI) | `color8` |
| `--accent` (links, selection, buttons) | `color4` |
| `--heading` | `color6` |
| `--code-bg` | bg mixed 6% toward fg |
| code highlighting | `color1`–`color6` |

A contrast check nudges `--accent` and `--muted` lighter or darker so text stays readable with any wallpaper.

### 5.8 Files and safety
- `allwrite file.md` opens a file from the terminal. A `.desktop` file registers allwrite for `text/markdown` and `text/plain` (`xdg-mime default`).
- **Atomic save** (write to a temp file, then rename).
- Watches the open file: reloads silently if you have no unsaved edits. Otherwise a banner offers "Reload / Keep mine".
- Asks before closing with unsaved changes. Optional autosave (off by default). Recent files appear in the palette.

### 5.9 Config file (`~/.config/allwrite/config.toml`)
```toml
[font]
text = "Inter"
code = "JetBrains Mono"
size = 16
line_height = 1.6
column_width = 72

[app]
autosave = false
remote_images = true

[keys]                 # optional overrides
bold = "Ctrl+B"

[theme]                # optional pywal mapping overrides
accent = "color4"
```

---

## 6. Phases

| # | Phase | Delivers | Done when |
|---|---|---|---|
| 0 | **Spike & measure** | Tauri + Vite + bare CodeMirror window | RAM / startup measured against §3 gate |
| 1 | **Basic editor** | open/save/new, CLI arg, plain text, unsaved state, close guard, command registry, keybinds, top bar, status bar, palette | Usable as a daily plain-text editor |
| 2 | **Theme + fonts** | pywal + portal live updates, contrast check, settings panel, font commands, config file | `wal -i <img>` recolors instantly; fonts switch from palette |
| 3 | **Live preview** | everything in the §5.1 table except images | Can write a full note without seeing raw syntax |
| 4 | **Images** | inline images, paste/drop to `assets/`, remote images | Screenshot paste works end to end |
| 5 | **Code + polish** | lazy language highlighting, find/replace, focus mode, zoom, recent files, icon, `.desktop`, PKGBUILD | Set as default `.md` app |
| later | optional | inline tables, math (KaTeX), tabs, export | — |

RAM and idle CPU are measured at the end of **every** phase.

---

## 7. Testing
- **Rust:** unit tests for pywal parsing and mapping, atomic save, path resolution, config parsing, font listing.
- **Frontend:** Vitest tests for live-preview decoration logic (given a document and cursor position, which ranges are
  hidden or styled), the command registry, and the contrast check.
- **Manual checklist per phase:** `test.md` with every element + local/remote/broken images, a large
  text file, a code file, a non-UTF-8 file, a pywal switch.

---

## 8. Dependencies (kept small)
- Rust: `tauri`, `serde`, `serde_json`, `notify`, `zbus` (portal), `toml`, `dirs`.
- JS: `@codemirror/{state,view,commands,search,language,lang-markdown,language-data}`,
  `@lezer/highlight`, `lucide` (only the icons we use), `vite`, `typescript`, `vitest` (dev).
- System (already installed): `webkit2gtk-4.1`, `xdg-desktop-portal`.

---

## 9. Performance checklist
- No UI framework; initial JS bundle target **< 300 KB gzipped**. Code languages load only when needed.
- Live-preview decorations only cover the visible part of the document and update incrementally.
- No timers or polling. All watching is inotify / D-Bus signal based → **0% CPU when idle**.
- Rust release profile: `lto = true`, `opt-level = "s"`, `codegen-units = 1`, `strip = true`, `panic = "abort"`.
- Single window, single webview. No network access unless a remote image is in the document.
- Measure total PSS (from `/proc/<pid>/smaps_rollup`) across allwrite + WebKit processes, and `pidstat` while idle and while typing.
- If needed: turn off unused WebKit features, and use `WEBKIT_DISABLE_DMABUF_RENDERER=1` only if rendering glitches show up.

---

## 10. Decisions
- Stack: Rust + Tauri 2 + CodeMirror 6.
- Fonts: user-selectable (§5.4); default Inter if installed, else Sans.
- pywal mapping: accepted as in §5.7.
- App icon: blue logo (`logos/markdown-reader-blue.svg`).
- Build deviations from this plan (see CLAUDE.md): the portal fallback uses GTK's own gio D-Bus instead of `zbus`;
  fonts are listed with `fc-list`; the top bar groups headings under one button and leaves Save As / Replace to
  keys and the palette.
