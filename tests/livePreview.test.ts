import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { EditorState } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { buildDecorations } from '../src/editor/livePreview'

function decos(doc: string, cursor: number, visible = [{ from: 0, to: doc.length }]) {
  const state = EditorState.create({ doc, selection: { anchor: cursor }, extensions: [markdown({ base: markdownLanguage })] })
  return buildDecorations(state, visible).map((r) => ({
    from: r.from,
    to: r.to,
    kind: r.value.spec.kind as string,
    cls: r.value.spec.class as string | undefined,
    text: doc.slice(r.from, r.to),
    spec: r.value.spec,
  }))
}
const hidden = (doc: string, cursor: number) => decos(doc, cursor).filter((d) => d.kind === 'hide').map((d) => d.text)
const kinds = (doc: string, cursor: number) => decos(doc, cursor).map((d) => d.kind)
const far = (doc: string) => doc.length // cursor on the trailing "end" line

describe('live preview decorations', () => {
  it('hides heading marks away from the cursor and shows them on the line', () => {
    const doc = '# Title\n\nend'
    expect(hidden(doc, far(doc))).toEqual(['# '])
    expect(hidden(doc, 3)).toEqual([])
    const line = decos(doc, far(doc)).find((d) => d.kind === 'line')!
    expect(line.cls).toBe('cm-h cm-h1')
    expect(line.from).toBe(0)
    // the heading style stays even when the marks are revealed
    expect(decos(doc, 3).some((d) => d.cls === 'cm-h cm-h1')).toBe(true)
  })

  it('handles heading levels and closing marks', () => {
    const doc = '### Three ###\n\nend'
    expect(hidden(doc, far(doc))).toEqual(['### ', '###'])
    expect(decos(doc, far(doc))[0].cls).toBe('cm-h cm-h3')
  })

  it('hides inline markers only when the cursor is outside the element', () => {
    const doc = 'a **bold** and *it* and ~~no~~ and `code`\n\nend'
    expect(hidden(doc, far(doc))).toEqual(['**', '**', '*', '*', '~~', '~~', '`', '`'])
    // cursor inside "bold": its markers show, the others stay hidden
    expect(hidden(doc, 5)).toEqual(['*', '*', '~~', '~~', '`', '`'])
    // cursor at the very edge of the element still counts as touching
    expect(hidden(doc, 2)).toEqual(['*', '*', '~~', '~~', '`', '`'])
  })

  it('renders links as their text', () => {
    const doc = 'see [the site](https://example.com "t") now\n\nend'
    expect(hidden(doc, far(doc))).toEqual(['[', '](https://example.com "t")'])
    const link = decos(doc, far(doc)).find((d) => d.kind === 'link')!
    expect(link.text).toBe('the site')
    expect(link.spec.url).toBe('https://example.com')
    expect(hidden(doc, 8)).toEqual([])
    // still a link (Ctrl+click) while the syntax is shown
    expect(decos(doc, 8).filter((d) => d.kind === 'link')).toHaveLength(1)
  })

  it('leaves reference-style links alone and links bare URLs', () => {
    expect(hidden('a [ref][1] b\n\n[1]: https://x.y\n\nend', 0).length).toBe(0)
    const doc = 'go to https://example.com/x now\n\nend'
    const link = decos(doc, far(doc)).find((d) => d.kind === 'link')!
    expect(link.text).toBe('https://example.com/x')
  })

  it('replaces bullets, keeps ordered numbers, reveals on the cursor line', () => {
    const doc = '- one\n- two\n\n1. first\n\nend'
    const d = decos(doc, far(doc))
    expect(d.filter((x) => x.kind === 'bullet').map((x) => x.from)).toEqual([0, 6])
    expect(d.filter((x) => x.kind === 'num').map((x) => x.text)).toEqual(['1.'])
    expect(decos(doc, 2).filter((x) => x.kind === 'bullet').map((x) => x.from)).toEqual([6])
  })

  it('turns task markers into checkboxes', () => {
    const doc = '- [ ] todo\n- [x] done\n\nend'
    const d = decos(doc, far(doc))
    const boxes = d.filter((x) => x.kind === 'checkbox')
    expect(boxes.map((x) => x.text)).toEqual(['[ ]', '[x]'])
    expect(boxes.map((x) => x.spec.widget.checked)).toEqual([false, true])
    expect(d.filter((x) => x.kind === 'hide').map((x) => x.text)).toEqual(['- ', '- '])
    expect(d.filter((x) => x.kind === 'done').map((x) => x.text)).toEqual(['done'])
    expect(d.some((x) => x.kind === 'bullet')).toBe(false)
    // on the cursor line the raw text shows
    expect(decos(doc, 4).filter((x) => x.kind === 'checkbox').map((x) => x.text)).toEqual(['[x]'])
  })

  it('styles quotes and hides the marker', () => {
    const doc = '> quoted\n> more\n\nend'
    const d = decos(doc, far(doc))
    expect(d.filter((x) => x.cls === 'cm-quote').map((x) => x.from)).toEqual([0, 9])
    expect(hidden(doc, far(doc))).toEqual(['> ', '> '])
    expect(hidden(doc, 3)).toEqual(['> '])
  })

  it('replaces horizontal rules', () => {
    const doc = 'a\n\n---\n\nend'
    expect(kinds(doc, far(doc))).toContain('hr')
    expect(kinds(doc, 4)).not.toContain('hr')
  })

  it('marks fenced code lines and does not hide anything inside', () => {
    const doc = '```js\nconst a = "**x**"\n```\n\nend'
    const d = decos(doc, far(doc))
    expect(d.filter((x) => x.kind === 'line').map((x) => x.cls)).toEqual([
      'cm-codeblock cm-codeblock-first',
      'cm-codeblock',
      'cm-codeblock cm-codeblock-last',
    ])
    expect(d.some((x) => x.kind === 'hide')).toBe(false)
  })

  it('shows images, hiding the syntax unless the cursor is on it', () => {
    const doc = 'x\n\n![alt text](pics/a.png)\n\nend'
    const away = decos(doc, far(doc))
    const img = away.find((x) => x.kind === 'image')!
    expect(img.spec.widget.url).toBe('pics/a.png')
    expect(img.spec.widget.alt).toBe('alt text')
    expect(away.filter((x) => x.kind === 'hide').map((x) => x.text)).toEqual(['![alt text](pics/a.png)'])
    const on = decos(doc, 6)
    expect(on.some((x) => x.kind === 'hide')).toBe(false)
    expect(on.filter((x) => x.kind === 'image')).toHaveLength(1) // image stays visible
  })

  it('only decorates the visible range', () => {
    const doc = '# One\n\n**a**\n\n# Two\n\nend'
    const second = doc.indexOf('# Two')
    const d = decos(doc, far(doc), [{ from: second, to: second + 5 }])
    expect(d.filter((x) => x.kind === 'line').map((x) => x.from)).toEqual([second])
    expect(d.filter((x) => x.kind === 'hide').map((x) => x.from)).toEqual([second])
  })

  it('reveals syntax for every cursor of a multi-selection and for range selections', () => {
    const doc = '**a** **b**\n\nend'
    const state = EditorState.create({
      doc,
      selection: { anchor: 0, head: 11 },
      extensions: [markdown({ base: markdownLanguage })],
    })
    const d = buildDecorations(state, [{ from: 0, to: doc.length }])
    expect(d.filter((r) => r.value.spec.kind === 'hide')).toHaveLength(0)
  })

  it('hides escape backslashes', () => {
    const doc = 'a \\* b\n\nend'
    expect(hidden(doc, far(doc))).toEqual(['\\'])
  })
})
