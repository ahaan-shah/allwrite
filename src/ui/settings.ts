// Settings panel (Ctrl+,): fonts, size, spacing, and the two app toggles.

import { pickFont } from '../actions'
import { updateConfig } from '../doc'
import { app } from '../state'
import { openOverlay } from './overlay'

function row(label: string, control: HTMLElement): HTMLElement {
  const r = document.createElement('label')
  r.className = 'setting'
  const l = document.createElement('span')
  l.textContent = label
  r.append(l, control)
  return r
}

function fontButton(slot: 'text' | 'code'): HTMLElement {
  const b = document.createElement('button')
  b.className = 'btn font-pick'
  b.textContent = app.config.font[slot]
  b.style.fontFamily = `var(--font-${slot})`
  b.onclick = (e) => {
    e.preventDefault()
    void pickFont(slot) // replaces this panel; the choice applies instantly
  }
  return b
}

function slider(min: number, max: number, step: number, value: number, fmt: (v: number) => string, set: (v: number) => void): HTMLElement {
  const wrap = document.createElement('span')
  wrap.className = 'slider'
  const input = document.createElement('input')
  input.type = 'range'
  input.min = String(min)
  input.max = String(max)
  input.step = String(step)
  input.value = String(value)
  const out = document.createElement('output')
  out.textContent = fmt(value)
  input.oninput = () => {
    const v = Number(input.value)
    out.textContent = fmt(v)
    set(v)
  }
  wrap.append(input, out)
  return wrap
}

function stepper(value: number, min: number, max: number, set: (v: number) => void): HTMLElement {
  const wrap = document.createElement('span')
  wrap.className = 'stepper'
  const out = document.createElement('output')
  out.textContent = String(value)
  const mk = (text: string, d: number) => {
    const b = document.createElement('button')
    b.className = 'btn'
    b.textContent = text
    b.onclick = (e) => {
      e.preventDefault()
      value = Math.max(min, Math.min(max, value + d))
      out.textContent = String(value)
      set(value)
    }
    return b
  }
  wrap.append(mk('−', -1), out, mk('+', 1))
  return wrap
}

function toggle(value: boolean, set: (v: boolean) => void): HTMLElement {
  const input = document.createElement('input')
  input.type = 'checkbox'
  input.checked = value
  input.onchange = () => set(input.checked)
  return input
}

export function openSettings(): void {
  const f = app.config.font
  const panel = document.createElement('div')
  panel.className = 'settings'
  const title = document.createElement('h2')
  title.textContent = 'Settings'
  panel.append(
    title,
    row('Text font', fontButton('text')),
    row('Code font', fontButton('code')),
    row('Size', stepper(f.size, 9, 40, (v) => updateConfig((c) => (c.font.size = v)))),
    row('Line height', slider(1.2, 2.2, 0.05, f.line_height, (v) => v.toFixed(2), (v) => updateConfig((c) => (c.font.line_height = Math.round(v * 100) / 100)))),
    row('Column width', slider(40, 140, 2, f.column_width, (v) => `${v} ch`, (v) => updateConfig((c) => (c.font.column_width = v)))),
    row('Autosave', toggle(app.config.app.autosave, (v) => updateConfig((c) => (c.app.autosave = v)))),
    row('Remote images', toggle(app.config.app.remote_images, (v) => updateConfig((c) => (c.app.remote_images = v)))),
  )
  const note = document.createElement('p')
  note.className = 'settings-note'
  note.textContent = 'Saved to ~/.config/allwrite/config.toml. Colors follow pywal.'
  panel.appendChild(note)
  openOverlay(panel)
  ;(panel.querySelector('button') as HTMLElement | null)?.focus()
}
