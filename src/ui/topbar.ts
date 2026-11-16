// Slim top bar: undo/redo + filename + unsaved dot on the left, command buttons on the right.

import { get, run } from '../commands'
import { keysFor } from '../keymap'
import { app, on } from '../state'
import { icon } from './icons'

// '|' is a separator; the 'fmt' group only shows for Markdown files.
const LEFT: Array<{ group: string; ids: string[] }> = [{ group: 'history', ids: ['undo', 'redo'] }]
const LAYOUT: Array<{ group: string; ids: string[] }> = [
  { group: 'file', ids: ['new', 'open', 'save'] },
  { group: 'fmt', ids: ['heading', 'bold', 'italic', 'strike', 'code', 'link'] },
  { group: 'block', ids: ['bullet', 'ordered', 'task', 'quote', 'codeblock', 'table', 'image'] },
  { group: 'view', ids: ['outline', 'find', 'source', 'focus'] },
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

  const byId = new Map<string, HTMLButtonElement>()
  const makeBar = (layout: typeof LAYOUT): HTMLElement => {
    const buttons = document.createElement('div')
    buttons.className = 'buttons'
    for (const { group, ids } of layout) {
      const g = document.createElement('div')
      g.className = `group group-${group}`
      for (const id of ids) {
        const cmd = get(id)
        const svg = cmd?.icon ? icon(cmd.icon) : null
        if (!cmd || !svg) continue
        const b = document.createElement('button')
        b.className = 'icon-btn'
        b.dataset.cmd = id
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
    return buttons
  }
  const left = makeBar(LEFT)
  left.classList.add('left')
  bar.append(left, title, makeBar(LAYOUT))
  initTooltips(bar)

  const tooltips = () => {
    for (const [id, b] of byId) {
      const cmd = get(id)!
      const keys = keysFor(cmd, app.config.keys)
      b.dataset.tip = keys ? `${cmd.label.replace(/…$/, '')} (${keys})` : cmd.label
    }
  }
  const refresh = () => {
    name.textContent = app.doc.name
    name.classList.toggle('untitled', !app.doc.path)
    name.dataset.tip = app.doc.path || 'Not saved yet'
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

/** Themed tooltips for elements with data-tip (native title tooltips ignore the app theme). */
function initTooltips(root: HTMLElement): void {
  const tip = document.createElement('div')
  tip.id = 'tooltip'
  tip.hidden = true
  document.body.appendChild(tip)
  let timer = 0
  let target: HTMLElement | null = null
  const hide = () => {
    clearTimeout(timer)
    target = null
    tip.hidden = true
  }
  const show = (el: HTMLElement) => {
    const text = el.dataset.tip
    if (!text || target !== el) return
    tip.textContent = text
    tip.hidden = false
    const r = el.getBoundingClientRect()
    const w = tip.offsetWidth
    const x = Math.max(6, Math.min(r.left + r.width / 2 - w / 2, window.innerWidth - w - 6))
    tip.style.left = `${x}px`
    tip.style.top = `${r.bottom + 6}px`
  }
  root.addEventListener('mouseover', (e) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-tip]')
    if (el === target) return
    const wasShown = !tip.hidden
    hide()
    if (!el) return
    target = el
    // Moving between buttons while a tip is up switches instantly.
    if (wasShown) show(el)
    else timer = window.setTimeout(() => show(el), 450)
  })
  root.addEventListener('mouseleave', hide)
  root.addEventListener('mousedown', hide)
  window.addEventListener('blur', hide)
}
