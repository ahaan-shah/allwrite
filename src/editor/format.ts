// Markdown formatting commands. They edit the plain text; live preview does the rest.

import { EditorSelection, type ChangeSpec } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'

/** Wrap or unwrap each selection range in an inline marker such as ** or `. */
export function toggleInline(view: EditorView, mark: string): void {
  const { state } = view
  const n = mark.length
  // `*` must not be confused with one half of `**`.
  const lone = (s: string, atEnd: boolean) => {
    if (mark !== '*') return true
    const stars = atEnd ? /\*+$/.exec(s)?.[0].length ?? 0 : /^\*+/.exec(s)?.[0].length ?? 0
    return stars % 2 === 1
  }
  view.dispatch(
    state.changeByRange((range) => {
      const { from, to } = range
      const before = state.sliceDoc(Math.max(0, from - 3), from)
      const after = state.sliceDoc(to, to + 3)
      if (before.endsWith(mark) && after.startsWith(mark) && lone(before, true) && lone(after, false)) {
        return {
          changes: [{ from: from - n, to: from }, { from: to, to: to + n }],
          range: EditorSelection.range(from - n, to - n),
        }
      }
      const inner = state.sliceDoc(from, to)
      if (inner.length >= 2 * n && inner.startsWith(mark) && inner.endsWith(mark) && lone(inner, false) && lone(inner, true)) {
        return {
          changes: [{ from, to: from + n }, { from: to - n, to }],
          range: EditorSelection.range(from, to - 2 * n),
        }
      }
      return {
        changes: [{ from, insert: mark }, { from: to, insert: mark }],
        range: EditorSelection.range(from + n, to + n),
      }
    }),
  )
  view.focus()
}

export function headingLine(text: string, level: number): string {
  const m = /^(\s{0,3})(#{1,6})(\s+|$)/.exec(text)
  const indent = m ? m[1] : ''
  const body = m ? text.slice(m[0].length) : text
  if (level === 0 || (m && m[2].length === level)) return indent + body
  return indent + '#'.repeat(level) + ' ' + body
}

const LIST_PREFIX = /^(\s*)(?:[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+)?/

export function bulletLine(text: string): string {
  if (/^\s*[-*+]\s+(?!\[[ xX]\]\s)/.test(text)) return text.replace(/^(\s*)[-*+]\s+/, '$1')
  return text.replace(LIST_PREFIX, '$1- ')
}

export function taskLine(text: string): string {
  if (/^\s*[-*+]\s+\[[ xX]\]\s/.test(text)) return text.replace(/^(\s*)[-*+]\s+\[[ xX]\]\s+/, '$1')
  return text.replace(LIST_PREFIX, '$1- [ ] ')
}

export function quoteLine(text: string): string {
  return /^\s*>/.test(text) ? text.replace(/^(\s*)>\s?/, '$1') : '> ' + text
}

/** Apply a per-line transform to every line touched by the selection. */
export function mapLines(view: EditorView, fn: (text: string) => string): void {
  const { state } = view
  const changes: ChangeSpec[] = []
  const seen = new Set<number>()
  for (const r of state.selection.ranges) {
    const last = state.doc.lineAt(r.to).number
    for (let n = state.doc.lineAt(r.from).number; n <= last; n++) {
      if (seen.has(n)) continue
      seen.add(n)
      const line = state.doc.line(n)
      // Skip blank lines inside a multi-line selection.
      if (!line.text.trim() && seen.size > 1) continue
      const next = fn(line.text)
      if (next !== line.text) changes.push({ from: line.from, to: line.to, insert: next })
    }
  }
  if (changes.length) {
    const cs = state.changes(changes)
    view.dispatch({ changes: cs, selection: state.selection.map(cs, 1) })
  }
  view.focus()
}

export function insertLink(view: EditorView): void {
  const { state } = view
  view.dispatch(
    state.changeByRange((range) => {
      const text = state.sliceDoc(range.from, range.to)
      if (/^(https?:\/\/|www\.)\S+$/.test(text)) {
        // A selected URL becomes the target; the cursor goes in the label.
        return { changes: { from: range.from, to: range.to, insert: `[](${text})` }, range: EditorSelection.cursor(range.from + 1) }
      }
      const insert = `[${text}]()`
      return { changes: { from: range.from, to: range.to, insert }, range: EditorSelection.cursor(range.from + insert.length - 1) }
    }),
  )
  view.focus()
}

export function orderedLine(text: string, index: number): string {
  if (/^\s*\d+[.)]\s+/.test(text)) return text.replace(/^(\s*)\d+[.)]\s+/, '$1')
  return text.replace(LIST_PREFIX, `$1${index}. `)
}

/** Number every non-blank selected line 1, 2, 3… (or remove the numbers again). */
export function orderedList(view: EditorView): void {
  let i = 0
  mapLines(view, (t) => orderedLine(t, ++i))
}

/**
 * Insert a block on its own lines at the cursor, with a blank line before and after when needed.
 * `cursorAt` is the offset inside `block` where the cursor goes (default: end).
 */
export function insertBlock(view: EditorView, block: string, cursorAt = block.length): void {
  const { state } = view
  const r = state.selection.main
  const startLine = state.doc.lineAt(r.from)
  const endLine = state.doc.lineAt(r.to)
  // Replace a blank line in place; otherwise go after the current line.
  const blank = r.empty && !startLine.text.trim()
  const from = blank ? startLine.from : endLine.to
  const to = blank ? startLine.to : endLine.to
  const prev = blank ? (startLine.number > 1 ? state.doc.line(startLine.number - 1).text : '') : endLine.text
  const next = endLine.number < state.doc.lines ? state.doc.line(endLine.number + 1).text : ''
  const before = blank ? (prev.trim() ? '\n' : '') : prev.trim() ? '\n\n' : '\n'
  const after = next.trim() ? '\n' : ''
  const insert = before + block + after
  view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + before.length + cursorAt }, scrollIntoView: true, userEvent: 'input' })
  view.focus()
}

export function insertCodeBlock(view: EditorView): void {
  const { state } = view
  const r = state.selection.main
  if (!r.empty) {
    // Wrap the selected lines in a fence.
    const a = state.doc.lineAt(r.from), b = state.doc.lineAt(r.to)
    const insert = '```\n' + state.sliceDoc(a.from, b.to) + '\n```'
    view.dispatch({ changes: { from: a.from, to: b.to, insert }, selection: { anchor: a.from + 3 }, userEvent: 'input' })
    view.focus()
    return
  }
  insertBlock(view, '```\n\n```', 3)
}

export function insertTable(view: EditorView): void {
  insertBlock(view, '| Column | Column |\n| ------ | ------ |\n|        |        |', 2)
}

export function insertRule(view: EditorView): void {
  insertBlock(view, '---\n')
}
