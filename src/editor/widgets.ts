// Small inline widgets used by live preview.

import { EditorView, WidgetType } from '@codemirror/view'

const BULLETS = ['•', '◦', '▪']

/** A list bullet; nested lists cycle through three glyphs. */
export class BulletWidget extends WidgetType {
  constructor(readonly level: number) {
    super()
  }
  eq(other: BulletWidget): boolean {
    return other.level === this.level
  }
  toDOM(): HTMLElement {
    const s = document.createElement('span')
    s.className = 'cm-bullet'
    s.textContent = BULLETS[this.level % BULLETS.length]
    return s
  }
}

/** Stands in for an opening code fence: just the language name, small and dim. */
export class FenceWidget extends WidgetType {
  constructor(readonly lang: string) {
    super()
  }
  eq(other: FenceWidget): boolean {
    return other.lang === this.lang
  }
  toDOM(): HTMLElement {
    const s = document.createElement('span')
    s.className = 'cm-fence-label'
    s.textContent = this.lang
    return s
  }
  ignoreEvent(): boolean {
    return false
  }
}

export class HrWidget extends WidgetType {
  eq(): boolean {
    return true
  }
  toDOM(): HTMLElement {
    const s = document.createElement('span')
    s.className = 'cm-hr'
    return s
  }
}

export class CheckboxWidget extends WidgetType {
  constructor(readonly checked: boolean) {
    super()
  }
  eq(other: CheckboxWidget): boolean {
    return other.checked === this.checked
  }
  toDOM(view: EditorView): HTMLElement {
    const box = document.createElement('span')
    box.className = this.checked ? 'cm-checkbox checked' : 'cm-checkbox'
    box.setAttribute('role', 'checkbox')
    box.setAttribute('aria-checked', String(this.checked))
    box.addEventListener('mousedown', (e) => {
      e.preventDefault()
      const pos = view.posAtDOM(box)
      const text = view.state.sliceDoc(pos, pos + 3)
      if (!/^\[[ xX]\]$/.test(text)) return
      view.dispatch({ changes: { from: pos + 1, to: pos + 2, insert: text[1] === ' ' ? 'x' : ' ' } })
    })
    return box
  }
  ignoreEvent(): boolean {
    return true
  }
}
