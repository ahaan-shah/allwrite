// Keyboard shortcut cheat sheet (Ctrl+/): every bound command, grouped, with the user's overrides applied.

import { all, get } from '../commands'
import { keysFor } from '../keymap'
import { app } from '../state'
import { openOverlay } from './overlay'

// Two columns of roughly equal height (one column on narrow windows).
const LEFT: Array<{ title: string; ids: string[] }> = [
  { title: 'File', ids: ['new', 'open', 'save', 'save-as', 'quit'] },
  { title: 'Edit', ids: ['undo', 'redo', 'find', 'replace', 'paste-image'] },
  { title: 'Format', ids: ['bold', 'italic', 'strike', 'code', 'link', 'h1', 'h2', 'h3', 'normal'] },
  { title: 'Navigate', ids: ['outline', 'goto-line'] },
]
const RIGHT: Array<{ title: string; ids: string[] }> = [
  { title: 'Blocks', ids: ['bullet', 'ordered', 'task', 'quote', 'codeblock', 'image'] },
  { title: 'View', ids: ['source', 'focus', 'line-numbers', 'zoom-in', 'zoom-out', 'zoom-reset'] },
  { title: 'App', ids: ['palette', 'settings', 'shortcuts'] },
]

/** Built into the editor itself rather than the command registry. */
const EDITOR_KEYS: Array<[string, string]> = [
  ['Redo (alternative)', 'Ctrl+Y'],
  ['Indent / outdent', 'Tab / Shift+Tab'],
  ['Move line up / down', 'Alt+↑ / ↓'],
  ['Copy line up / down', 'Shift+Alt+↑ / ↓'],
  ['Select next match', 'Ctrl+D'],
  ['Select all', 'Ctrl+A'],
  ['Close panel', 'Escape'],
]

/** "Ctrl+Shift+S" -> <kbd>Ctrl</kbd><kbd>Shift</kbd><kbd>S</kbd>; " / " separates alternatives. */
function keyChips(combo: string): HTMLElement {
  const wrap = document.createElement('span')
  wrap.className = 'keys'
  combo.split(' / ').forEach((alt, i) => {
    if (i) {
      const or = document.createElement('span')
      or.className = 'keys-or'
      or.textContent = '/'
      wrap.appendChild(or)
    }
    // "Ctrl++" style combos never occur here (normalizeCombo turns plus into "="), so split is safe.
    for (const part of alt.split('+')) {
      const k = document.createElement('kbd')
      k.textContent = part
      wrap.appendChild(k)
    }
  })
  return wrap
}

function section(title: string, rows: Array<[string, string]>): HTMLElement | null {
  if (!rows.length) return null
  const s = document.createElement('section')
  const h = document.createElement('h3')
  h.textContent = title
  s.appendChild(h)
  for (const [label, keys] of rows) {
    const r = document.createElement('div')
    r.className = 'shortcut'
    const l = document.createElement('span')
    l.textContent = label
    r.append(l, keyChips(keys))
    s.appendChild(r)
  }
  return s
}

export function openShortcuts(): void {
  const overrides = app.config.keys
  const listed = new Set<string>()
  const rows = (ids: string[]): Array<[string, string]> =>
    ids.flatMap((id) => {
      const c = get(id)
      const keys = c ? keysFor(c, overrides) : ''
      if (!c || !keys) return []
      listed.add(id)
      return [[c.label.replace(/…$/, ''), keys] as [string, string]]
    })

  const column = (sections: Array<HTMLElement | null>) => {
    const col = document.createElement('div')
    col.className = 'shortcuts-col'
    col.append(...sections.filter((s): s is HTMLElement => s !== null))
    return col
  }
  const left = column(LEFT.map((g) => section(g.title, rows(g.ids))))
  const right = RIGHT.map((g) => section(g.title, rows(g.ids)))
  // Anything bound (including through config.toml) that the groups above do not name.
  const other = all().filter((c) => !c.hidden && !listed.has(c.id)).map((c) => c.id)
  right.push(section('Other', rows(other)), section('Editor', EDITOR_KEYS))

  const panel = document.createElement('div')
  panel.className = 'shortcuts'
  panel.tabIndex = -1 // focusable, so Escape and scrolling work without clicking first
  const title = document.createElement('h2')
  title.textContent = 'Keyboard shortcuts'
  const grid = document.createElement('div')
  grid.className = 'shortcuts-grid'
  grid.append(left, column(right))
  const note = document.createElement('p')
  note.className = 'settings-note'
  note.textContent = 'Rebind any command under [keys] in ~/.config/allwrite/config.toml.'
  panel.append(title, grid, note)
  openOverlay(panel)
  panel.focus()
}
