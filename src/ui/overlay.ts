// Modal layer (palette, settings, confirm), the file-changed banner, and toasts.

import { app } from '../state'

const overlay = () => document.getElementById('overlay')!
let closeCurrent: (() => void) | null = null

export function overlayOpen(): boolean {
  return closeCurrent !== null
}

/** Show `el` in the modal layer. Escape or a click on the backdrop closes it. */
export function openOverlay(el: HTMLElement, onClose?: () => void): () => void {
  closeOverlay()
  const root = overlay()
  root.replaceChildren(el)
  root.hidden = false
  const close = () => {
    if (closeCurrent !== close) return
    closeCurrent = null
    root.hidden = true
    root.replaceChildren()
    onClose?.()
    app.view?.focus()
  }
  closeCurrent = close
  return close
}

export function closeOverlay(): void {
  closeCurrent?.()
}

export function initOverlay(): void {
  const root = overlay()
  root.addEventListener('mousedown', (e) => {
    if (e.target === root) closeOverlay()
  })
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      closeOverlay()
    }
  })
}

function button(label: string, primary = false): HTMLButtonElement {
  const b = document.createElement('button')
  b.className = primary ? 'btn primary' : 'btn'
  b.textContent = label
  return b
}

/** Ask with a set of buttons; resolves to the chosen value, or null when dismissed. */
export function ask<T extends string>(message: string, choices: Array<{ label: string; value: T; primary?: boolean }>): Promise<T | null> {
  return new Promise((resolve) => {
    const box = document.createElement('div')
    box.className = 'dialog'
    const p = document.createElement('p')
    p.textContent = message
    const row = document.createElement('div')
    row.className = 'dialog-buttons'
    let result: T | null = null
    const close = openOverlay(box, () => resolve(result))
    for (const c of choices) {
      const b = button(c.label, c.primary)
      b.onclick = () => {
        result = c.value
        close()
      }
      row.appendChild(b)
    }
    box.append(p, row)
    ;(row.querySelector('.primary') as HTMLElement | null)?.focus()
  })
}

export function showBanner(message: string, actions: Array<{ label: string; run: () => void }>): void {
  const el = document.getElementById('banner')!
  const text = document.createElement('span')
  text.textContent = message
  el.replaceChildren(text)
  for (const a of actions) {
    const b = button(a.label)
    b.onclick = () => {
      hideBanner()
      a.run()
    }
    el.appendChild(b)
  }
  el.hidden = false
}

export function hideBanner(): void {
  document.getElementById('banner')!.hidden = true
}

let toastTimer = 0
export function toast(message: string): void {
  const el = document.getElementById('toast')!
  el.textContent = message
  el.hidden = false
  clearTimeout(toastTimer)
  toastTimer = window.setTimeout(() => (el.hidden = true), 3500)
}
