// Slim top bar: filename + unsaved dot on the left, command buttons on the right.

import { get, run } from '../commands'
import { keysFor } from '../keymap'
import { app, on } from '../state'
import { icon } from './icons'

// '|' is a separator; the 'fmt' group only shows for Markdown files.
const LAYOUT: Array<{ group: string; ids: string[] }> = [
  { group: 'file', ids: ['new', 'open', 'save'] },
  { group: 'fmt', ids: ['bold', 'italic', 'strike', 'code', 'heading', 'link', 'image', 'bullet', 'task', 'quote'] },
  { group: 'view', ids: ['find', 'source', 'focus'] },
  { group: 'app', ids: ['palette', 'settings'] },
]

export function initTopbar(): void {
  const bar = document.getElementById('topbar')!
  const title = document.createElement('div')
  title.className = 'title'
  title.setAttribute('data-tauri-drag-region', '')
  const dot = document.createElement('span')
  dot.className = 'dirty-dot'
  const name = document.createElement('span')
  name.className = 'filename'
  name.setAttribute('data-tauri-drag-region', '')
  title.append(name, dot)

  const buttons = document.createElement('div')
  buttons.className = 'buttons'
  const byId = new Map<string, HTMLButtonElement>()
  for (const { group, ids } of LAYOUT) {
    const g = document.createElement('div')
    g.className = `group group-${group}`
    for (const id of ids) {
      const cmd = get(id)
      const svg = cmd?.icon ? icon(cmd.icon) : null
      if (!cmd || !svg) continue
      const b = document.createElement('button')
      b.className = 'icon-btn'
      b.appendChild(svg)
      b.setAttribute('aria-label', cmd.label)
      // Keep focus (and the selection) in the editor.
      b.onmousedown = (e) => e.preventDefault()
      b.onclick = () => run(id)
      byId.set(id, b)
      g.appendChild(b)
    }
    buttons.appendChild(g)
  }
  bar.append(title, buttons)

  const tooltips = () => {
    for (const [id, b] of byId) {
      const cmd = get(id)!
      const keys = keysFor(cmd, app.config.keys)
      b.title = keys ? `${cmd.label.replace(/…$/, '')} (${keys})` : cmd.label
    }
  }
  const refresh = () => {
    name.textContent = app.doc.name
    name.title = app.doc.path || 'Not saved yet'
    dot.classList.toggle('on', app.doc.dirty)
    document.body.dataset.mode = app.doc.mode
    byId.get('source')?.classList.toggle('active', app.sourceMode)
  }
  on('doc', refresh)
  on('mode', refresh)
  on('config', tooltips)
  tooltips()
  refresh()
}
