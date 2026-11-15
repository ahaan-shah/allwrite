// Every user action, registered once. See commands.ts.

import { openSearchPanel } from '@codemirror/search'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { register, run } from './commands'
import { ensureFonts, guard, newFile, openFile, reloadFromDisk, save, saveAs, toggleSource, updateConfig } from './doc'
import { bulletLine, headingLine, insertLink, mapLines, quoteLine, taskLine, toggleInline } from './editor/format'
import { insertImageMarkdown } from './editor/images'
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

export async function addImage(src: string, pos?: number): Promise<void> {
  if (!app.doc.path) return toast('Save the document first, so the image has a folder to live in')
  try {
    insertImageMarkdown(app.view, await invoke<string>('import_image', { src }), pos)
  } catch (e) {
    toast(String(e))
  }
}

async function pickImage(): Promise<void> {
  if (!app.doc.path) return toast('Save the document first, so the image has a folder to live in')
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
    { id: 'quit', label: 'Quit', keys: 'Ctrl+Q', run: async () => { if (await guard()) await getCurrentWindow().destroy() } },
  )
}
