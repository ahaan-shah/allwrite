// GFM tables: shown as a real table when the cursor is outside, raw text when it is inside.
// Block widgets that span lines must come from a StateField, not a ViewPlugin.

import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'
import { type EditorState, type Range, StateField } from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView, WidgetType } from '@codemirror/view'

export type Align = '' | 'left' | 'center' | 'right'

export interface Table {
  head: string[]
  align: Align[]
  rows: string[][]
}

/** Split one table row into cells. Pipes inside backticks or escaped with \ do not split. */
export function splitRow(line: string): string[] {
  let s = line.trim()
  if (s.startsWith('|')) s = s.slice(1)
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1)
  const cells: string[] = []
  let cur = ''
  let tick = 0
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (ch === '\\' && s[i + 1] === '|') {
      cur += '|'
      i++
    } else if (ch === '`') {
      let n = 1
      while (s[i + n] === '`') n++
      tick = tick === 0 ? n : tick === n ? 0 : tick
      cur += '`'.repeat(n)
      i += n - 1
    } else if (ch === '|' && tick === 0) {
      cells.push(cur.trim())
      cur = ''
    } else cur += ch
  }
  cells.push(cur.trim())
  return cells
}

export function parseTable(text: string): Table | null {
  const lines = text.split('\n').filter((l) => l.trim())
  if (lines.length < 2) return null
  const head = splitRow(lines[0])
  const delim = splitRow(lines[1])
  if (!delim.every((d) => /^:?-+:?$/.test(d))) return null
  const align = delim.map((d): Align => (d.startsWith(':') && d.endsWith(':') ? 'center' : d.endsWith(':') ? 'right' : d.startsWith(':') ? 'left' : ''))
  const rows = lines.slice(2).map(splitRow)
  return { head, align, rows }
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** A small inline Markdown renderer for table cells: code, bold, italic, strike, links. */
export function renderInline(src: string): string {
  const codes: string[] = []
  let s = src.replace(/(`+)(.+?)\1/g, (_, __, code: string) => {
    codes.push(`<code class="cm-inline-code">${esc(code.trim())}</code>`)
    return `\u0000${codes.length - 1}\u0000`
  })
  s = esc(s)
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;[^&]*&quot;)?\)/g, (_, text: string, url: string) => `<span class="cm-link" data-url="${url}">${text}</span>`)
  s = s.replace(/\*\*(.+?)\*\*|__(.+?)__/g, (_, a, b) => `<strong>${a ?? b}</strong>`)
  s = s.replace(/(^|[^*\w])\*(?!\s)(.+?)\*(?!\w)|(^|\W)_(?!\s)(.+?)_(?!\w)/g, (_, p1, a, p2, b) => `${p1 ?? p2}<em>${a ?? b}</em>`)
  s = s.replace(/~~(.+?)~~/g, '<del>$1</del>')
  s = s.replace(/\\([\\`*_{}[\]()#+\-.!|~])/g, '$1')
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => codes[Number(i)])
}

export class TableWidget extends WidgetType {
  constructor(readonly source: string, readonly table: Table) {
    super()
  }

  eq(o: TableWidget): boolean {
    return o.source === this.source
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('div')
    wrap.className = 'cm-table-widget'
    const t = this.table
    const cols = Math.max(t.head.length, ...t.rows.map((r) => r.length))
    const cell = (tag: 'th' | 'td', text: string | undefined, i: number) => {
      const align = t.align[i] ? ` style="text-align:${t.align[i]}"` : ''
      return `<${tag}${align}>${renderInline(text ?? '')}</${tag}>`
    }
    const row = (cells: string[], tag: 'th' | 'td') => `<tr>${Array.from({ length: cols }, (_, i) => cell(tag, cells[i], i)).join('')}</tr>`
    wrap.innerHTML = `<table><thead>${row(t.head, 'th')}</thead><tbody>${t.rows.map((r) => row(r, 'td')).join('')}</tbody></table>`
    wrap.addEventListener('mousedown', (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.target as HTMLElement).closest('.cm-link')) return // live preview opens it
      e.preventDefault()
      // Clicking the table reveals its source, with the cursor at the end of the clicked row.
      const from = view.posAtDOM(wrap)
      const tr = (e.target as HTMLElement).closest('tr')
      const rowIndex = tr ? [...wrap.querySelectorAll('tr')].indexOf(tr) : 0
      const lineNo = view.state.doc.lineAt(from).number + (rowIndex === 0 ? 0 : rowIndex + 1)
      const line = view.state.doc.line(Math.min(lineNo, view.state.doc.lines))
      view.dispatch({ selection: { anchor: line.to } })
      view.focus()
    })
    return wrap
  }

  ignoreEvent(e: Event): boolean {
    // Let the editor see Ctrl+click so live preview can open links; everything else is ours.
    return !(e instanceof MouseEvent && (e.ctrlKey || e.metaKey))
  }
}

export function tableDecorations(state: EditorState): Range<Decoration>[] {
  const out: Range<Decoration>[] = []
  const tree = ensureSyntaxTree(state, state.doc.length, 25) ?? syntaxTree(state)
  const sel = state.selection.ranges
  tree.iterate({
    enter(ref) {
      if (ref.name !== 'Table') return ref.name === 'Document' || ref.name === 'Blockquote' || ref.name.endsWith('List') || ref.name === 'ListItem'
      const from = state.doc.lineAt(ref.from).from
      const to = state.doc.lineAt(ref.to).to
      if (sel.some((r) => r.from <= to && r.to >= from)) return false
      const source = state.sliceDoc(from, to)
      // Tables inside quotes or lists keep their raw form.
      if (/^\s*>/.test(source) || ref.from !== from) return false
      const table = parseTable(source)
      if (table) out.push(Decoration.replace({ widget: new TableWidget(source, table), block: true, kind: 'table' }).range(from, to))
      return false
    },
  })
  return out
}

export const tables = StateField.define<DecorationSet>({
  create: (state) => Decoration.set(tableDecorations(state)),
  update(deco, tr) {
    if (tr.docChanged || tr.selection || syntaxTree(tr.startState) !== syntaxTree(tr.state)) return Decoration.set(tableDecorations(tr.state))
    return deco
  },
  provide: (f) => EditorView.decorations.from(f),
})
