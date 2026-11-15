// Command palette, also reused as a generic searchable picker (fonts, recent files, headings).

import { all } from '../commands'
import { keysFor } from '../keymap'
import { app } from '../state'
import { openOverlay } from './overlay'

export interface Item {
  label: string
  hint?: string
  run: () => unknown
}

/** Subsequence match; higher is better, -1 is no match. */
export function fuzzyScore(query: string, text: string): number {
  if (!query) return 0
  const q = query.toLowerCase(), t = text.toLowerCase()
  const idx = t.indexOf(q)
  if (idx >= 0) return 1000 - idx - (t.length - q.length) * 0.01 + (idx === 0 || /\W/.test(t[idx - 1]) ? 50 : 0)
  let score = 0, ti = 0, streak = 0
  for (const ch of q) {
    if (ch === ' ') continue
    const found = t.indexOf(ch, ti)
    if (found < 0) return -1
    streak = found === ti ? streak + 1 : 0
    score += 1 + streak * 2 + (found === 0 || /\W/.test(t[found - 1]) ? 4 : 0) - (found - ti) * 0.05
    ti = found + 1
  }
  return score
}

export function filterItems<T extends { label: string }>(items: T[], query: string, limit = 60): T[] {
  if (!query.trim()) return items.slice(0, limit)
  return items
    .map((item, i) => ({ item, i, s: fuzzyScore(query.trim(), item.label) }))
    .filter((x) => x.s >= 0)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .slice(0, limit)
    .map((x) => x.item)
}

export function openPicker(items: Item[], placeholder: string): void {
  const box = document.createElement('div')
  box.className = 'palette'
  const input = document.createElement('input')
  input.type = 'text'
  input.placeholder = placeholder
  input.spellcheck = false
  const list = document.createElement('div')
  list.className = 'palette-list'
  box.append(input, list)

  let shown: Item[] = []
  let active = 0
  const close = openOverlay(box)

  const choose = (item: Item | undefined) => {
    if (!item) return
    close()
    item.run()
  }
  const setActive = (i: number) => {
    list.children[active]?.classList.remove('active')
    active = Math.max(0, Math.min(shown.length - 1, i))
    const el = list.children[active] as HTMLElement | undefined
    el?.classList.add('active')
    el?.scrollIntoView({ block: 'nearest' })
  }
  const render = () => {
    shown = filterItems(items, input.value)
    list.replaceChildren(
      ...shown.map((item, i) => {
        const row = document.createElement('div')
        row.className = 'palette-item'
        const label = document.createElement('span')
        label.textContent = item.label
        row.appendChild(label)
        if (item.hint) {
          const hint = document.createElement('kbd')
          hint.textContent = item.hint
          row.appendChild(hint)
        }
        row.onmousedown = (e) => {
          e.preventDefault()
          choose(shown[i])
        }
        return row
      }),
    )
    if (!shown.length) {
      const empty = document.createElement('div')
      empty.className = 'palette-empty'
      empty.textContent = 'No matches'
      list.appendChild(empty)
    }
    active = 0
    setActive(0)
  }

  input.addEventListener('input', render)
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || (e.ctrlKey && e.key === 'n')) (e.preventDefault(), setActive(active + 1))
    else if (e.key === 'ArrowUp' || (e.ctrlKey && e.key === 'p')) (e.preventDefault(), setActive(active - 1))
    else if (e.key === 'PageDown') (e.preventDefault(), setActive(active + 8))
    else if (e.key === 'PageUp') (e.preventDefault(), setActive(active - 8))
    else if (e.key === 'Enter') (e.preventDefault(), choose(shown[active]))
  })
  render()
  input.focus()
}

export function openPalette(extra: Item[] = []): void {
  const items: Item[] = all()
    .filter((c) => !c.hidden)
    .map((c) => ({ label: c.label, hint: keysFor(c, app.config.keys), run: c.run }))
  openPicker([...items, ...extra], 'Type a command…')
}
