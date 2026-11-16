// Live preview: hide Markdown syntax and style the text, except where the cursor is.
// Only the visible part of the document is walked.

import { ensureSyntaxTree, syntaxTree } from '@codemirror/language'
import type { EditorState, Range } from '@codemirror/state'
import { Decoration, type DecorationSet, type EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view'
import type { SyntaxNode } from '@lezer/common'
import { ImageWidget, imageCtx } from './images'
import { BulletWidget, CheckboxWidget, FenceWidget, HrWidget } from './widgets'

const hideDeco = Decoration.replace({ kind: 'hide' })
const bulletDecos = [0, 1, 2].map((level) => Decoration.replace({ widget: new BulletWidget(level), kind: 'bullet' }))
const escaped = Decoration.mark({ class: 'cm-escaped', kind: 'escaped' })
const hrDeco = Decoration.replace({ widget: new HrWidget(), kind: 'hr' })
const inlineCode = Decoration.mark({ class: 'cm-inline-code', kind: 'code' })
const listNum = Decoration.mark({ class: 'cm-list-num', kind: 'num' })
const taskDone = Decoration.mark({ class: 'cm-task-done', kind: 'done' })

const lineCache = new Map<string, Decoration>()
function lineDeco(cls: string): Decoration {
  let d = lineCache.get(cls)
  if (!d) lineCache.set(cls, (d = Decoration.line({ class: cls, kind: 'line' })))
  return d
}

function children(node: SyntaxNode, name: string): SyntaxNode[] {
  const out: SyntaxNode[] = []
  for (let c = node.firstChild; c; c = c.nextSibling) if (c.name === name) out.push(c)
  return out
}

export interface Span {
  from: number
  to: number
}

/**
 * Decorations for the given visible ranges. Each decoration's `spec.kind` says what it does
 * ('hide', 'line', 'link', 'image', ...) so the logic can be tested without a DOM.
 */
export function buildDecorations(state: EditorState, visible: readonly Span[]): Range<Decoration>[] {
  const out: Range<Decoration>[] = []
  const doc = state.doc
  const sel = state.selection.ranges
  const touches = (from: number, to: number) => sel.some((r) => r.from <= to && r.to >= from)
  const lineActive = (pos: number) => {
    const l = doc.lineAt(pos)
    return touches(l.from, l.to)
  }
  const hide = (from: number, to: number) => {
    if (to > from) out.push(hideDeco.range(from, to))
  }
  const seen = new Set<string>()
  const lineSeen = new Set<string>()
  const addLine = (pos: number, cls: string) => {
    const key = pos + cls
    if (lineSeen.has(key)) return
    lineSeen.add(key)
    out.push(lineDeco(cls).range(pos))
  }

  const end = visible.reduce((m, r) => Math.max(m, r.to), 0)
  const tree = ensureSyntaxTree(state, end, 30) ?? syntaxTree(state)

  for (const { from, to } of visible) {
    /** Add a class to every visible line of a block node. */
    const blockLines = (node: Span, cls: string, edges: boolean) => {
      const first = doc.lineAt(node.from).number
      const last = doc.lineAt(Math.max(node.from, node.to)).number
      const a = Math.max(first, doc.lineAt(from).number)
      const b = Math.min(last, doc.lineAt(Math.min(to, doc.length)).number)
      for (let n = a; n <= b; n++) {
        const l = doc.line(n)
        addLine(l.from, cls + (edges && n === first ? ` ${cls}-first` : '') + (edges && n === last ? ` ${cls}-last` : ''))
      }
    }

    tree.iterate({
      from,
      to,
      enter(ref) {
        const name = ref.name
        if (name === 'Document' || name === 'Paragraph') return
        const key = name + '@' + ref.from
        if (seen.has(key)) return false
        seen.add(key)
        const node = ref.node

        const atx = /^ATXHeading(\d)$/.exec(name)
        if (atx) {
          const line = doc.lineAt(ref.from)
          addLine(line.from, `cm-h cm-h${atx[1]}`)
          if (!touches(line.from, line.to)) {
            for (const m of children(node, 'HeaderMark')) {
              if (m.from === ref.from) {
                // leading #'s and the space after them
                hide(m.from, doc.sliceString(m.to, m.to + 1) === ' ' ? m.to + 1 : m.to)
              } else {
                hide(m.from, m.to)
              }
            }
          }
          return
        }

        switch (name) {
          case 'SetextHeading1':
          case 'SetextHeading2': {
            const mark = node.getChild('HeaderMark')
            const lastText = mark ? doc.lineAt(mark.from).number - 1 : doc.lineAt(ref.to).number
            for (let n = doc.lineAt(ref.from).number; n <= lastText; n++) {
              addLine(doc.line(n).from, `cm-h cm-h${name.endsWith('1') ? 1 : 2}`)
            }
            return
          }

          case 'Blockquote':
            blockLines(ref, 'cm-quote', false)
            return

          case 'QuoteMark':
            if (!lineActive(ref.from)) {
              hide(ref.from, doc.sliceString(ref.to, ref.to + 1) === ' ' ? ref.to + 1 : ref.to)
            }
            return

          case 'ListMark': {
            const item = node.parent
            const list = item?.parent
            if (list?.name === 'OrderedList') {
              out.push(listNum.range(ref.from, ref.to))
              return
            }
            if (lineActive(ref.from)) return
            const task = item?.getChild('Task')
            if (task && doc.lineAt(task.from).number === doc.lineAt(ref.from).number) {
              hide(ref.from, task.from) // the checkbox stands in for the bullet
            } else if (ref.to > ref.from) {
              let depth = 0
              for (let p = list?.parent; p; p = p.parent) if (p.name === 'BulletList' || p.name === 'OrderedList') depth++
              out.push(bulletDecos[depth % 3].range(ref.from, ref.to))
            }
            return
          }

          case 'Task': {
            const marker = node.getChild('TaskMarker')
            if (marker && /\[[xX]\]/.test(doc.sliceString(marker.from, marker.to))) {
              const gap = /^\s*/.exec(doc.sliceString(marker.to, ref.to))![0].length
              if (ref.to > marker.to + gap) out.push(taskDone.range(marker.to + gap, ref.to))
            }
            return
          }

          case 'TaskMarker':
            if (!lineActive(ref.from)) {
              const checked = /\[[xX]\]/.test(doc.sliceString(ref.from, ref.to))
              out.push(Decoration.replace({ widget: new CheckboxWidget(checked), kind: 'checkbox' }).range(ref.from, ref.to))
            }
            return

          case 'HorizontalRule':
            if (!lineActive(ref.from) && ref.to > ref.from) out.push(hrDeco.range(ref.from, ref.to))
            return

          case 'FencedCode': {
            blockLines(ref, 'cm-codeblock', true)
            if (!touches(ref.from, ref.to)) {
              // Away from the cursor the fences give way to a small language label.
              const first = doc.lineAt(ref.from)
              const last = doc.lineAt(ref.to)
              const info = node.getChild('CodeInfo')
              const lang = info ? doc.sliceString(info.from, info.to) : ''
              if (first.to > first.from) {
                out.push(Decoration.replace({ widget: new FenceWidget(lang), kind: 'fence' }).range(first.from, first.to))
              }
              if (last.number > first.number && /^\s*(`{3,}|~{3,})\s*$/.test(last.text)) hide(last.from, last.to)
            }
            return false
          }

          case 'CodeBlock':
            blockLines(ref, 'cm-codeblock', true)
            return false

          case 'Table':
            // Rendered as a widget by tables.ts when the cursor is elsewhere.
            blockLines(ref, 'cm-table', false)
            return false

          case 'Emphasis':
          case 'StrongEmphasis':
          case 'Strikethrough':
            if (!touches(ref.from, ref.to)) {
              const markName = name === 'Strikethrough' ? 'StrikethroughMark' : 'EmphasisMark'
              for (const m of children(node, markName)) hide(m.from, m.to)
            }
            return

          case 'InlineCode': {
            const marks = children(node, 'CodeMark')
            if (!touches(ref.from, ref.to)) for (const m of marks) hide(m.from, m.to)
            out.push(inlineCode.range(ref.from, ref.to))
            return
          }

          case 'Escape':
            if (!touches(ref.from, ref.to)) {
              hide(ref.from, ref.from + 1)
              if (ref.to > ref.from + 1) out.push(escaped.range(ref.from + 1, ref.to))
            }
            return

          case 'Link': {
            const marks = children(node, 'LinkMark')
            const url = node.getChild('URL')
            if (!url || marks.length < 2) return // reference-style: leave as typed
            const textFrom = marks[0].to
            const textTo = marks[1].from
            if (textTo > textFrom) {
              out.push(linkMark(doc.sliceString(url.from, url.to)).range(textFrom, textTo))
            }
            if (!touches(ref.from, ref.to) && textTo > textFrom) {
              hide(marks[0].from, marks[0].to)
              hide(marks[1].from, ref.to)
            }
            return
          }

          case 'Autolink': {
            if (!touches(ref.from, ref.to)) for (const m of children(node, 'LinkMark')) hide(m.from, m.to)
            return
          }

          case 'URL': {
            // Bare URLs and <autolinks>; URLs inside [text](url) are handled by 'Link'.
            const parent = node.parent?.name
            if (parent === 'Link' || parent === 'Image') return
            if (ref.to > ref.from) out.push(linkMark(doc.sliceString(ref.from, ref.to)).range(ref.from, ref.to))
            return
          }

          case 'Image': {
            const marks = children(node, 'LinkMark')
            const url = node.getChild('URL')
            if (!url || marks.length < 2) return false
            const alt = doc.sliceString(marks[0].to, marks[1].from)
            if (!touches(ref.from, ref.to)) hide(ref.from, ref.to)
            // The same widget in both states, so the image stays put when the cursor enters.
            out.push(
              Decoration.widget({
                widget: new ImageWidget(doc.sliceString(url.from, url.to), alt, imageCtx.dir, imageCtx.remote),
                side: 1,
                kind: 'image',
              }).range(ref.to),
            )
            return false
          }
        }
      },
    })
  }
  return out
}

const linkCache = new Map<string, Decoration>()
function linkMark(url: string): Decoration {
  let d = linkCache.get(url)
  if (!d) {
    if (linkCache.size > 500) linkCache.clear()
    let href = url.startsWith('<') && url.endsWith('>') ? url.slice(1, -1) : url
    if (/^www\./i.test(href)) href = 'https://' + href
    d = Decoration.mark({ class: 'cm-link', attributes: { 'data-url': href, title: `${href}\nCtrl+click to open` }, kind: 'link', url: href })
    linkCache.set(url, d)
  }
  return d
}

function build(view: EditorView): DecorationSet {
  return Decoration.set(buildDecorations(view.state, view.visibleRanges), true)
}

export function livePreview(openUrl: (url: string) => void) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet
      constructor(view: EditorView) {
        this.decorations = build(view)
      }
      update(u: ViewUpdate) {
        if (u.docChanged || u.viewportChanged || u.selectionSet || syntaxTree(u.startState) !== syntaxTree(u.state)) {
          this.decorations = build(u.view)
        }
      }
    },
    {
      decorations: (v) => v.decorations,
      eventHandlers: {
        mousedown(e: MouseEvent) {
          if (!(e.ctrlKey || e.metaKey) || e.button !== 0) return false
          const link = (e.target as HTMLElement).closest?.('.cm-link') as HTMLElement | null
          const url = link?.dataset.url
          if (!url) return false
          e.preventDefault()
          openUrl(url)
          return true
        },
      },
    },
  )
}
