// Bootstrap: config, theme, editor, UI, then the file from the command line.

import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { addImage, openUrl, registerActions } from './actions'
import { all, run } from './commands'
import { guard, onEditorUpdate, onFileChanged, openFile, showFile } from './doc'
import { createEditor } from './editor/setup'
import { applyFonts } from './fonts'
import { buildKeymap, comboFromEvent } from './keymap'
import { app, on } from './state'
import { applyTheme } from './theme'
import type { Config, OpenedFile, Theme } from './types'
import { closeOverlay, initOverlay, overlayOpen, toast } from './ui/overlay'
import { initStatusbar } from './ui/statusbar'
import { initTopbar } from './ui/topbar'

interface Init {
  config: Config
  theme: Theme
  file: OpenedFile | null
  error: string | null
}

const IMAGE = /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i

async function main(): Promise<void> {
  const init = await invoke<Init>('init')
  app.config = init.config
  applyTheme(init.theme)
  applyFonts(app.config.font)

  registerActions()
  app.view = createEditor(document.getElementById('editor')!, {
    onUpdate: onEditorUpdate,
    openUrl,
    onError: toast,
  })
  ;(window as unknown as { allwrite: typeof app }).allwrite = app // handle for debugging and the test harness
  initOverlay()
  initTopbar()
  initStatusbar()
  showFile(init.file)
  if (init.error) toast(init.error)

  // One global key handler: every binding runs a command from the registry.
  let keymap = buildKeymap(all(), app.config.keys)
  on('config', () => (keymap = buildKeymap(all(), app.config.keys)))
  window.addEventListener(
    'keydown',
    (e) => {
      const combo = comboFromEvent(e)
      const id = combo && keymap.get(combo)
      if (!id) return
      if (overlayOpen()) {
        // While a panel is open, its own toggle key closes it; other bindings wait.
        if (id === 'palette' || id === 'settings') {
          e.preventDefault()
          closeOverlay()
        }
        return
      }
      e.preventDefault()
      e.stopPropagation()
      run(id)
    },
    true,
  )

  // Bars fade while typing and come back when the mouse moves.
  window.addEventListener('mousemove', () => {
    if (document.body.classList.contains('typing')) document.body.classList.remove('typing')
  })
  window.addEventListener('contextmenu', (e) => {
    if (!(e.target as HTMLElement).closest?.('.cm-content, input')) e.preventDefault()
  })

  const win = getCurrentWindow()
  on('doc', () => void win.setTitle(`${app.doc.dirty ? '• ' : ''}${app.doc.name} — allwrite`))
  void win.setTitle(`${app.doc.name} — allwrite`)

  await listen<Theme>('theme-changed', (e) => applyTheme(e.payload))
  await listen<string>('file-changed', (e) => onFileChanged(e.payload))
  await win.onCloseRequested(async (e) => {
    if (!app.doc.dirty) return
    e.preventDefault()
    if (await guard()) await win.destroy()
  })
  await getCurrentWebview().onDragDropEvent((e) => {
    if (e.payload.type !== 'drop') return
    const scale = window.devicePixelRatio || 1
    const pos = app.view.posAtCoords({ x: e.payload.position.x / scale, y: e.payload.position.y / scale }) ?? undefined
    const images = e.payload.paths.filter((p) => IMAGE.test(p))
    if (images.length && app.doc.mode === 'markdown') {
      void (async () => {
        for (const p of images) await addImage(p, pos)
      })()
    } else if (e.payload.paths[0]) {
      void openFile(e.payload.paths[0])
    }
  })
}

main().catch((e) => {
  console.error(e)
  document.body.textContent = `allwrite failed to start: ${e}`
})
