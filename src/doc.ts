// The open document: new / open / save / reload, dirty tracking, config updates.

import { Transaction } from '@codemirror/state'
import type { ViewUpdate } from '@codemirror/view'
import { invoke } from '@tauri-apps/api/core'
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog'
import { imageCtx } from './editor/images'
import { modeFor } from './editor/languages'
import { setLive, showDocument } from './editor/setup'
import { applyFonts } from './fonts'
import { app, emit } from './state'
import type { Config, OpenedFile } from './types'
import { ask, hideBanner, showBanner, toast } from './ui/overlay'

const LARGE = 5_000_000

export function showFile(f: OpenedFile | null): void {
  const content = f?.content ?? ''
  const large = content.length > LARGE
  app.doc = {
    path: f?.path ?? '',
    name: f?.name ?? 'Untitled',
    dir: f?.dir ?? '',
    mode: modeFor(f?.name ?? ''),
    dirty: false,
    readonly: f?.readonly ?? false,
    crlf: content.includes('\r\n'),
    large,
  }
  imageCtx.dir = app.doc.dir
  imageCtx.remote = app.config.app.remote_images
  showDocument(app.view, {
    content,
    name: app.doc.name,
    mode: app.doc.mode,
    live: !app.sourceMode && !large,
    readonly: app.doc.readonly,
  })
  app.saved = app.view.state.doc
  hideBanner()
  emit('doc')
  emit('mode')
  emit('cursor')
  app.view.focus()
  if (app.doc.readonly) toast('Not valid UTF-8 — opened read-only')
  else if (large && app.doc.mode === 'markdown') toast('Large file — live preview is off')
}

let autosaveTimer = 0

export function onEditorUpdate(u: ViewUpdate): void {
  if (u.docChanged) {
    const saved = app.saved
    const dirty = !saved || u.state.doc.length !== saved.length || !u.state.doc.eq(saved)
    if (dirty !== app.doc.dirty) {
      app.doc.dirty = dirty
      emit('doc')
    }
    if (u.transactions.some((t) => t.isUserEvent('input') || t.isUserEvent('delete'))) {
      document.body.classList.add('typing')
    }
    if (dirty && app.config.app.autosave && app.doc.path && !app.doc.readonly) {
      clearTimeout(autosaveTimer)
      autosaveTimer = window.setTimeout(() => void save(), 1200)
    }
  }
  if (u.docChanged || u.selectionSet) emit('cursor')
}

/** Returns true when it is fine to replace the current document. */
export async function guard(): Promise<boolean> {
  if (!app.doc.dirty) return true
  const r = await ask(`Save changes to ${app.doc.name}?`, [
    { label: 'Save', value: 'save', primary: true },
    { label: 'Discard', value: 'discard' },
    { label: 'Cancel', value: 'cancel' },
  ])
  if (r === 'save') return save()
  return r === 'discard'
}

export async function newFile(): Promise<void> {
  if (!(await guard())) return
  await invoke('close_file')
  showFile(null)
}

export async function openFile(path?: string): Promise<void> {
  if (!(await guard())) return
  if (!path) {
    const picked = await openDialog({ multiple: false, directory: false, defaultPath: app.doc.dir || undefined })
    if (typeof picked !== 'string') return
    path = picked
  }
  try {
    showFile(await invoke<OpenedFile>('read_file', { path }))
  } catch (e) {
    toast(String(e))
  }
}

async function writeTo(path: string): Promise<boolean> {
  const doc = app.view.state.doc
  const content = doc.sliceString(0, doc.length, app.doc.crlf ? '\r\n' : '\n')
  try {
    const f = await invoke<OpenedFile>('write_file', { path, content })
    const renamed = f.path !== app.doc.path
    app.saved = doc
    app.doc.path = f.path
    app.doc.name = f.name
    app.doc.dir = f.dir
    app.doc.dirty = !app.view.state.doc.eq(doc)
    imageCtx.dir = f.dir
    if (renamed) {
      const mode = modeFor(f.name)
      if (mode !== app.doc.mode) {
        // The file type changed: rebuild the editor for the new mode.
        const sel = app.view.state.selection
        app.doc.mode = mode
        showDocument(app.view, { content: doc.toString(), name: f.name, mode, live: !app.sourceMode && !app.doc.large, readonly: false })
        app.saved = app.view.state.doc
        app.doc.dirty = false
        app.view.dispatch({ selection: sel })
        emit('mode')
      } else {
        refreshLive() // images now resolve against the new folder
      }
    }
    hideBanner()
    emit('doc')
    return true
  } catch (e) {
    toast(`Could not save: ${e}`)
    return false
  }
}

export async function save(): Promise<boolean> {
  if (app.doc.readonly) {
    toast('This file is read-only (not valid UTF-8). Use Save As.')
    return false
  }
  if (!app.doc.path) return saveAs()
  return writeTo(app.doc.path)
}

export async function saveAs(): Promise<boolean> {
  const suggested = app.doc.path || (app.doc.dir ? `${app.doc.dir}/untitled.md` : 'untitled.md')
  const path = await saveDialog({ defaultPath: suggested })
  if (!path) return false
  app.doc.readonly = false
  return writeTo(path)
}

/** Replace the buffer with what is on disk, keeping the cursor where it was. */
export async function reloadFromDisk(): Promise<void> {
  if (!app.doc.path) return
  try {
    const f = await invoke<OpenedFile>('read_file', { path: app.doc.path })
    const view = app.view
    const head = Math.min(view.state.selection.main.head, f.content.replace(/\r\n/g, '\n').length)
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: f.content },
      selection: { anchor: head },
      annotations: Transaction.addToHistory.of(false),
    })
    app.saved = view.state.doc
    app.doc.dirty = false
    app.doc.crlf = f.content.includes('\r\n')
    hideBanner()
    emit('doc')
  } catch (e) {
    toast(String(e))
  }
}

export function onFileChanged(path: string): void {
  if (path !== app.doc.path) return
  if (!app.doc.dirty) void reloadFromDisk()
  else {
    showBanner(`${app.doc.name} changed on disk.`, [
      { label: 'Reload', run: () => void reloadFromDisk() },
      { label: 'Keep mine', run: () => {} },
    ])
  }
}

export function refreshLive(): void {
  setLive(app.view, app.doc.mode, !app.sourceMode && !app.doc.large)
}

export function toggleSource(): void {
  app.sourceMode = !app.sourceMode
  refreshLive()
  emit('mode')
  app.view.focus()
}

// ---- config ----

let configTimer = 0

export function updateConfig(change: (c: Config) => void): void {
  change(app.config)
  applyFonts(app.config.font)
  if (imageCtx.remote !== app.config.app.remote_images) {
    imageCtx.remote = app.config.app.remote_images
    refreshLive()
  }
  emit('config')
  clearTimeout(configTimer)
  configTimer = window.setTimeout(() => {
    invoke('set_config', { config: app.config }).catch((e) => toast(`Could not save settings: ${e}`))
  }, 300)
}

export async function ensureFonts(): Promise<string[]> {
  if (!app.fonts) app.fonts = await invoke<string[]>('list_fonts').catch(() => [])
  return app.fonts
}
