import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorState } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { describe, expect, it } from 'vitest'
import { insertBlock, insertCodeBlock, orderedLine } from '../src/editor/format'
import { imagePaths } from '../src/editor/images'
import { buildDecorations } from '../src/editor/livePreview'
import { parseTable, renderInline, splitRow, tableDecorations } from '../src/editor/tables'

const md = (doc: string, cursor: number) =>
  EditorState.create({ doc, selection: { anchor: cursor }, extensions: [markdown({ base: markdownLanguage })] })

describe('tables', () => {
  it('splits rows, honouring escaped pipes and code spans', () => {
    expect(splitRow('| a | b |')).toEqual(['a', 'b'])
    expect(splitRow('a | `x|y` | c\\|d')).toEqual(['a', '`x|y`', 'c|d'])
  })

  it('parses alignment and rows', () => {
    const t = parseTable('| A | B | C |\n|:--|:-:|--:|\n| 1 | 2 | 3 |')!
    expect(t.head).toEqual(['A', 'B', 'C'])
    expect(t.align).toEqual(['left', 'center', 'right'])
    expect(t.rows).toEqual([['1', '2', '3']])
    expect(parseTable('| A |\n| x |')).toBeNull()
  })

  it('renders inline markdown safely', () => {
    expect(renderInline('**b** and `<i>` <script>')).toBe('<strong>b</strong> and <code class="cm-inline-code">&lt;i&gt;</code> &lt;script&gt;')
    expect(renderInline('[x](https://a.b)')).toBe('<span class="cm-link" data-url="https://a.b">x</span>')
  })

  it('shows a widget away from the cursor and the raw text on it', () => {
    const doc = 'text\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\nend'
    expect(tableDecorations(md(doc, doc.length)).map((r) => r.value.spec.kind)).toEqual(['table'])
    expect(tableDecorations(md(doc, doc.indexOf('1')))).toEqual([])
  })
})

describe('live preview additions', () => {
  it('replaces fences with a language label away from the cursor', () => {
    const doc = '```js\nlet a\n```\n\nend'
    const away = buildDecorations(md(doc, doc.length), [{ from: 0, to: doc.length }]).map((r) => r.value.spec.kind)
    expect(away.filter((k) => k === 'fence')).toHaveLength(1)
    expect(away.filter((k) => k === 'hide')).toHaveLength(1)
    const on = buildDecorations(md(doc, 7), [{ from: 0, to: doc.length }]).map((r) => r.value.spec.kind)
    expect(on).not.toContain('fence')
  })

  it('cycles bullet glyphs by nesting depth', () => {
    const doc = '- a\n  - b\n\nend'
    const bullets = buildDecorations(md(doc, doc.length), [{ from: 0, to: doc.length }]).filter((r) => r.value.spec.kind === 'bullet')
    expect(bullets.map((r) => (r.value.spec.widget as { level: number }).level)).toEqual([0, 1])
  })
})

describe('formatting helpers', () => {
  it('numbers and un-numbers lines', () => {
    expect(orderedLine('item', 3)).toBe('3. item')
    expect(orderedLine('- item', 1)).toBe('1. item')
    expect(orderedLine('2. item', 1)).toBe('item')
  })

  // Just enough of a view for the formatting helpers (no DOM in the test runner).
  const view = (doc: string, anchor: number, head = anchor) => {
    const v = {
      state: EditorState.create({ doc, selection: { anchor, head } }),
      dispatch(spec: object) {
        v.state = v.state.update(spec).state
      },
      focus() {},
    }
    return v as unknown as EditorView
  }

  it('inserts blocks on their own lines', () => {
    const v = view('para', 2)
    insertBlock(v, 'X')
    expect(v.state.doc.toString()).toBe('para\n\nX')
    const w = view('a\n\nb', 2)
    insertBlock(w, 'X')
    expect(w.state.doc.toString()).toBe('a\n\nX\n\nb')
  })

  it('wraps selected lines in a code fence', () => {
    const v = view('one\ntwo', 0, 7)
    insertCodeBlock(v)
    expect(v.state.doc.toString()).toBe('```\none\ntwo\n```')
  })
})

describe('pasted paths', () => {
  it('accepts image file URIs and paths only', () => {
    expect(imagePaths('file:///home/a/My%20Shot.png\r\n')).toEqual(['/home/a/My Shot.png'])
    expect(imagePaths('/tmp/a.jpg\n/tmp/b.webp')).toEqual(['/tmp/a.jpg', '/tmp/b.webp'])
    expect(imagePaths('/tmp/a.txt')).toEqual([])
    expect(imagePaths('hello world.png')).toEqual([])
  })
})
