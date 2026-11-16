// Every user action, registered once. See commands.ts.

import { redo, undo } from '@codemirror/commands'
import { gotoLine, openSearchPanel } from '@codemirror/search'
import { EditorView } from '@codemirror/view'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { register, run } from './commands'
import { ensureFonts, guard, newFile, openFile, reloadFromDisk, save, saveAs, toggleSource, updateConfig } from './doc'
import { bulletLine, headingLine, insertCodeBlock, insertLink, insertRule, insertTable, mapLines, orderedList, quoteLine, taskLine, toggleInline } from './editor/format'
import { imageExt, imageFile, imagePaths, insertImageMarkdown } from './editor/images'
import { quickPicks } from './fonts'
import { app } from './state'
import { toast } from './ui/overlay'
import { type Item, openPalette, openPicker } from './ui/palette'
import { openSettings } from './ui/settings'

const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif']

function md(fn: () => void): () => void {
  return () => {
    if (app.doc.mode !== 'markdown') return toast('Formatting commands work in Markdown files')
    if (app.doc.readonly) return
    fn()
  }
}

export function openUrl(url: string): void {
  invoke('open_url', { url }).catch((e) => toast(String(e)))
}

/** Images live next to the document, so an untitled document is saved first. */
async function ensureSaved(): Promise<boolean> {
  if (app.doc.path) return true
  if (app.doc.mode !== 'markdown') return false
  toast('Choose where to save this document — images are stored next to it')
  return saveAs()
}

export async function addImage(src: string, pos?: number): Promise<void> {
  if (!(await ensureSaved())) return
  try {
    insertImageMarkdown(app.view, await invoke<string>('import_image', { src }), pos)
  } catch (e) {
    toast(String(e))
  }
}

/** Save an image's bytes (from a paste or drop) into assets/ and link it. */
async function addImageBytes(file: File, pos?: number): Promise<void> {
  const ext = imageExt(file.type)
  if (!ext) return
  const buf = await file.arrayBuffer() // read before any dialog: the clipboard data does not survive it
  if (!(await ensureSaved())) return
  try {
    insertImageMarkdown(app.view, await invoke<string>('save_image', new Uint8Array(buf), { headers: { ext } }), pos)
  } catch (e) {
    toast(String(e))
  }
}

/** Ask the backend to read the system clipboard (WebKitGTK does not always pass images to the page). */
async function pasteImageFromSystem(quiet: boolean): Promise<boolean> {
  if (!(await ensureSaved())) return false
  try {
    const rels = await invoke<string[]>('paste_image')
    if (!rels.length) {
      if (!quiet) toast('No image on the clipboard')
      return false
    }
    for (const rel of rels) insertImageMarkdown(app.view, rel)
    return true
  } catch (e) {
    toast(String(e))
    return false
  }
}

const URL_RE = /^(https?:\/\/|mailto:|www\.)\S+$/i

/** Editor paste handler: images, copied image files, and URLs pasted over a selection. */
export function onPaste(e: ClipboardEvent, view: EditorView): boolean {
  if (app.doc.mode !== 'markdown' || app.doc.readonly) return false
  const cd = e.clipboardData
  const text = cd?.getData('text/plain') ?? ''
  const uris = cd?.getData('text/uri-list') ?? ''
  const file = cd ? imageFile(cd) : null
  // An image wins unless real text came with it (a browser "Copy image" also puts its URL in text).
  if (file && (!text.trim() || URL_RE.test(text.trim()) || imagePaths(text).length)) {
    e.preventDefault()
    void addImageBytes(file)
    return true
  }
  const paths = imagePaths(uris || text)
  if (paths.length) {
    e.preventDefault()
    void (async () => {
      for (const p of paths) await addImage(p)
    })()
    return true
  }
  const sel = view.state.selection.main
  const url = text.trim()
  if (!sel.empty && URL_RE.test(url) && !view.state.sliceDoc(sel.from, sel.to).includes('\n')) {
    // Pasting a link over selected words makes them a link.
    e.preventDefault()
    const label = view.state.sliceDoc(sel.from, sel.to)
    const insert = `[${label}](${url.startsWith('www.') ? 'https://' + url : url})`
    view.dispatch({ changes: { from: sel.from, to: sel.to, insert }, selection: { anchor: sel.from + insert.length }, userEvent: 'input.paste' })
    return true
  }
  if (!text && !uris) {
    // Nothing the page can see: probably an image WebKit did not expose. Ask the system.
    e.preventDefault()
    void pasteImageFromSystem(true)
    return true
  }
  return false
}

async function pickImage(): Promise<void> {
  if (!(await ensureSaved())) return
  const picked = await openDialog({ multiple: false, defaultPath: app.doc.dir, filters: [{ name: 'Images', extensions: IMAGE_EXTS }] })
  if (typeof picked === 'string') await addImage(picked)
  app.view.focus()
}

export async function pickFont(slot: 'text' | 'code'): Promise<void> {
  const fonts = await ensureFonts()
  const quick = quickPicks(slot, fonts)
  const names = [...quick, ...fonts.filter((f) => !quick.includes(f))]
  openPicker(
    names.map((name) => ({
      label: name,
      hint: name === app.config.font[slot] ? 'current' : undefined,
      run: () => updateConfig((c) => (c.font[slot] = name)),
    })),
    slot === 'text' ? 'Text font…' : 'Code font…',
  )
}

async function pickRecent(): Promise<void> {
  const recent = await invoke<string[]>('recent_files')
  if (!recent.length) return toast('No recent files')
  openPicker(recent.map((p) => ({ label: p, run: () => openFile(p) })), 'Open recent…')
}

async function showPalette(): Promise<void> {
  const [fonts, recent] = await Promise.all([ensureFonts(), invoke<string[]>('recent_files').catch(() => [])])
  const extra: Item[] = []
  for (const slot of ['text', 'code'] as const) {
    for (const name of quickPicks(slot, fonts)) {
      extra.push({ label: `${slot === 'text' ? 'Text' : 'Code'} font: ${name}`, run: () => updateConfig((c) => (c.font[slot] = name)) })
    }
  }
  for (const p of recent) if (p !== app.doc.path) extra.push({ label: `Recent: ${p}`, run: () => openFile(p) })
  openPalette(extra)
}

/** Jump to a heading: a picker over every ATX / setext heading in the document. */
function outline(): void {
  const doc = app.view.state.doc
  const items: Item[] = []
  let fence = false
  for (let n = 1; n <= doc.lines; n++) {
    const text = doc.line(n).text
    if (/^\s{0,3}(```|~~~)/.test(text)) fence = !fence
    if (fence) continue
    const m = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(text)
    let level = 0, title = ''
    if (m) (level = m[1].length), (title = m[2])
    else if (n > 1 && /^\s{0,3}(=+|-+)\s*$/.test(text) && doc.line(n - 1).text.trim() && !/^\s{0,3}([-*+]\s|#|>)/.test(doc.line(n - 1).text)) {
      level = text.includes('=') ? 1 : 2
      title = doc.line(n - 1).text.trim()
    }
    if (!level) continue
    const line = m ? n : n - 1
    items.push({
      label: '\u2003'.repeat(level - 1) + (title || '(empty heading)'),
      hint: 'H' + level,
      run: () => {
        const pos = doc.line(line).from
        app.view.dispatch({ selection: { anchor: doc.line(line).to }, effects: EditorView.scrollIntoView(pos, { y: 'start', yMargin: 40 }) })
      },
    })
  }
  if (!items.length) return toast('No headings in this document')
  openPicker(items, 'Go to heading…', { limit: 500 })
}

function zoom(delta: number): void {
  updateConfig((c) => (c.font.size = delta === 0 ? 16 : Math.max(9, Math.min(40, c.font.size + delta))))
}

export function registerActions(): void {
  const v = () => app.view
  register(
    { id: 'new', label: 'New file', keys: 'Ctrl+N', icon: 'new', run: newFile },
    { id: 'open', label: 'Open file…', keys: 'Ctrl+O', icon: 'open', run: () => openFile() },
    { id: 'open-recent', label: 'Open recent…', run: pickRecent },
    { id: 'save', label: 'Save', keys: 'Ctrl+S', icon: 'save', run: save },
    { id: 'save-as', label: 'Save as…', keys: 'Ctrl+Shift+S', run: saveAs },
    { id: 'reload', label: 'Reload from disk', run: async () => { if (await guard()) await reloadFromDisk() } },

    { id: 'undo', label: 'Undo', keys: 'Ctrl+Z', icon: 'undo', run: () => undo(v()) },
    { id: 'redo', label: 'Redo', keys: 'Ctrl+Shift+Z', icon: 'redo', run: () => redo(v()) },

    { id: 'bold', label: 'Bold', keys: 'Ctrl+B', icon: 'bold', run: md(() => toggleInline(v(), '**')) },
    { id: 'italic', label: 'Italic', keys: 'Ctrl+I', icon: 'italic', run: md(() => toggleInline(v(), '*')) },
    { id: 'strike', label: 'Strikethrough', keys: 'Ctrl+Shift+X', icon: 'strike', run: md(() => toggleInline(v(), '~~')) },
    { id: 'code', label: 'Inline code', keys: 'Ctrl+`', icon: 'code', run: md(() => toggleInline(v(), '`')) },
    { id: 'h1', label: 'Heading 1', keys: 'Ctrl+1', run: md(() => mapLines(v(), (t) => headingLine(t, 1))) },
    { id: 'h2', label: 'Heading 2', keys: 'Ctrl+2', run: md(() => mapLines(v(), (t) => headingLine(t, 2))) },
    { id: 'h3', label: 'Heading 3', keys: 'Ctrl+3', run: md(() => mapLines(v(), (t) => headingLine(t, 3))) },
    { id: 'normal', label: 'Normal text', keys: 'Ctrl+0', run: md(() => mapLines(v(), (t) => headingLine(t, 0))) },
    {
      id: 'heading', label: 'Heading…', icon: 'heading', hidden: true,
      run: md(() =>
        openPicker(
          [['Heading 1', 'h1'], ['Heading 2', 'h2'], ['Heading 3', 'h3'], ['Normal text', 'normal']].map(([label, id]) => ({ label, run: () => run(id) })),
          'Heading level…',
        ),
      ),
    },
    { id: 'ordered', label: 'Numbered list', keys: 'Ctrl+Shift+7', icon: 'ordered', run: md(() => orderedList(v())) },
    { id: 'codeblock', label: 'Code block', keys: 'Ctrl+Alt+C', icon: 'codeblock', run: md(() => insertCodeBlock(v())) },
    { id: 'table', label: 'Insert table', icon: 'table', run: md(() => insertTable(v())) },
    { id: 'rule', label: 'Horizontal rule', run: md(() => insertRule(v())) },
    { id: 'paste-image', label: 'Paste image from clipboard', keys: 'Ctrl+Shift+V', run: md(() => void pasteImageFromSystem(false)) },
    { id: 'outline', label: 'Go to heading…', keys: 'Ctrl+Shift+O', icon: 'outline', run: md(outline) },
    { id: 'goto-line', label: 'Go to line…', keys: 'Ctrl+Alt+G', run: () => gotoLine(v()) },
    { id: 'link', label: 'Insert link', keys: 'Ctrl+K', icon: 'link', run: md(() => insertLink(v())) },
    { id: 'image', label: 'Insert image…', keys: 'Ctrl+Shift+I', icon: 'image', run: md(() => void pickImage()) },
    { id: 'bullet', label: 'Bullet list', keys: 'Ctrl+Shift+8', icon: 'list', run: md(() => mapLines(v(), bulletLine)) },
    { id: 'task', label: 'Task list', keys: 'Ctrl+Shift+T', icon: 'task', run: md(() => mapLines(v(), taskLine)) },
    { id: 'quote', label: 'Quote', keys: 'Ctrl+Shift+.', icon: 'quote', run: md(() => mapLines(v(), quoteLine)) },

    { id: 'find', label: 'Find', keys: 'Ctrl+F', icon: 'search', run: () => openSearchPanel(v()) },
    {
      id: 'replace', label: 'Replace', keys: 'Ctrl+H',
      run: () => {
        openSearchPanel(v())
        ;(v().dom.querySelector('.cm-search input[name=replace]') as HTMLElement | null)?.focus()
      },
    },
    { id: 'source', label: 'Toggle source mode', keys: 'Ctrl+E', icon: 'source', run: toggleSource },
    {
      id: 'focus', label: 'Toggle focus mode', keys: 'Ctrl+Shift+F', icon: 'focus',
      run: () => {
        document.body.classList.toggle('focus-mode')
        v().focus()
      },
    },
    { id: 'palette', label: 'Command palette', keys: 'Ctrl+P', icon: 'palette', hidden: true, run: showPalette },
    { id: 'settings', label: 'Settings', keys: 'Ctrl+,', icon: 'settings', run: openSettings },
    { id: 'text-font', label: 'Text font: choose…', run: () => pickFont('text') },
    { id: 'code-font', label: 'Code font: choose…', run: () => pickFont('code') },
    { id: 'zoom-in', label: 'Zoom in', keys: 'Ctrl+=', run: () => zoom(1) },
    { id: 'zoom-out', label: 'Zoom out', keys: 'Ctrl+-', run: () => zoom(-1) },
    { id: 'zoom-reset', label: 'Reset zoom', keys: 'Ctrl+Shift+0', run: () => zoom(0) },
    {
      id: 'autosave', label: 'Toggle autosave',
      run: () => {
        updateConfig((c) => (c.app.autosave = !c.app.autosave))
        toast(`Autosave ${app.config.app.autosave ? 'on' : 'off'}`)
      },
    },
    {
      id: 'line-numbers', label: 'Toggle line numbers', keys: 'Ctrl+Alt+L',
      run: () => {
        updateConfig((c) => (c.app.line_numbers = !c.app.line_numbers))
        toast(app.doc.mode === 'code' ? 'Code files always show line numbers' : `Line numbers ${app.config.app.line_numbers ? 'on' : 'off'}`)
      },
    },
    { id: 'quit', label: 'Quit', keys: 'Ctrl+Q', run: async () => { if (await guard()) await getCurrentWindow().destroy() } },
  )
}
