// CodeMirror configuration per file type.

import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { HighlightStyle, bracketMatching, indentOnInput, syntaxHighlighting } from '@codemirror/language'
import { highlightSelectionMatches, search, searchKeymap } from '@codemirror/search'
import { Compartment, EditorState, type Extension } from '@codemirror/state'
import { EditorView, drawSelection, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers, type ViewUpdate } from '@codemirror/view'
import { tags as t } from '@lezer/highlight'
import type { Mode } from '../types'
import { imagePaste } from './images'
import { languages, loadLanguage } from './languages'
import { livePreview } from './livePreview'

// Colors are CSS variables, so a palette change needs no editor reconfiguration.
const highlight = HighlightStyle.define([
  { tag: t.heading, fontWeight: '700', color: 'var(--heading)' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.link, color: 'var(--accent)' },
  { tag: t.url, color: 'var(--muted)' },
  { tag: t.monospace, fontFamily: 'var(--font-code)', fontSize: '0.9em' },
  { tag: t.quote, color: 'var(--quote-fg)' },
  { tag: [t.processingInstruction, t.contentSeparator, t.meta], color: 'var(--muted)' },
  { tag: t.labelName, color: 'var(--muted)' },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: 'var(--muted)', fontStyle: 'italic' },
  { tag: [t.keyword, t.controlKeyword, t.operatorKeyword, t.definitionKeyword, t.moduleKeyword, t.modifier], color: 'var(--c5)' },
  { tag: [t.string, t.special(t.string), t.character, t.regexp], color: 'var(--c2)' },
  { tag: [t.number, t.bool, t.null, t.atom, t.escape], color: 'var(--c3)' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName], color: 'var(--c4)' },
  { tag: [t.typeName, t.className, t.namespace, t.tagName], color: 'var(--c6)' },
  { tag: [t.attributeName, t.propertyName, t.self, t.constant(t.variableName)], color: 'var(--c1)' },
  { tag: [t.operator, t.punctuation, t.bracket], color: 'var(--punct)' },
  { tag: t.invalid, color: 'var(--c1)' },
])

const chrome = EditorView.theme({
  '&': { height: '100%', color: 'var(--fg)', backgroundColor: 'transparent' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { fontFamily: 'var(--font-text)', lineHeight: 'var(--line-height)', overflowX: 'auto' },
  '.cm-content': { caretColor: 'var(--cursor)', padding: '40px 0 45vh' },
  '.cm-line': { padding: '0 28px' },
  '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--cursor)', borderLeftWidth: '2px' },
  '.cm-selectionBackground': { backgroundColor: 'var(--hover)' },
  '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': { backgroundColor: 'var(--selection)' },
  '.cm-selectionMatch': { backgroundColor: 'var(--hover)' },
  '.cm-searchMatch': { backgroundColor: 'color-mix(in srgb, var(--c3) 30%, transparent)', outline: 'none', borderRadius: '2px' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'color-mix(in srgb, var(--accent) 55%, transparent)' },
  '.cm-activeLine': { backgroundColor: 'transparent' },
  '.cm-gutters': { backgroundColor: 'transparent', color: 'var(--muted)', border: 'none', fontFamily: 'var(--font-code)', fontSize: '0.85em' },
  '.cm-activeLineGutter': { backgroundColor: 'transparent', color: 'var(--fg)' },
  '.cm-lineNumbers .cm-gutterElement': { padding: '0 10px 0 16px' },
  '.cm-panels': { backgroundColor: 'var(--panel)', color: 'var(--fg)' },
  '.cm-panels.cm-panels-top': { borderBottom: '1px solid var(--border)' },
  '.cm-panels.cm-panels-bottom': { borderTop: '1px solid var(--border)' },
  '.cm-matchingBracket, .cm-nonmatchingBracket': { backgroundColor: 'var(--hover)', outline: 'none' },
})

const modeC = new Compartment()
const langC = new Compartment()
const readOnlyC = new Compartment()

export interface EditorHooks {
  onUpdate: (u: ViewUpdate) => void
  openUrl: (url: string) => void
  onError: (msg: string) => void
}

let hooks: EditorHooks
let loadToken = 0

function modeExtensions(mode: Mode, live: boolean): Extension {
  if (mode === 'markdown') {
    return [
      markdown({ base: markdownLanguage, codeLanguages: languages }),
      EditorView.lineWrapping,
      EditorView.editorAttributes.of({ class: live ? 'mode-prose mode-live' : 'mode-prose mode-source' }),
      live ? livePreview(hooks.openUrl) : [],
      imagePaste(hooks.onError),
    ]
  }
  if (mode === 'text') {
    return [EditorView.lineWrapping, EditorView.editorAttributes.of({ class: 'mode-prose mode-text' })]
  }
  return [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightActiveLine(),
    bracketMatching(),
    indentOnInput(),
    EditorView.editorAttributes.of({ class: 'mode-code' }),
  ]
}

export function createEditor(parent: HTMLElement, h: EditorHooks): EditorView {
  hooks = h
  return new EditorView({ parent })
}

export interface DocOptions {
  content: string
  name: string
  mode: Mode
  live: boolean
  readonly: boolean
}

/** Replace the editor state with a fresh document (new history, new mode). */
export function showDocument(view: EditorView, o: DocOptions): void {
  const token = ++loadToken
  view.setState(
    EditorState.create({
      doc: o.content,
      extensions: [
        history(),
        drawSelection(),
        EditorState.allowMultipleSelections.of(true),
        search({ top: true }),
        highlightSelectionMatches({ minSelectionLength: 2 }),
        keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
        syntaxHighlighting(highlight),
        chrome,
        modeC.of(modeExtensions(o.mode, o.live)),
        langC.of([]),
        readOnlyC.of(EditorState.readOnly.of(o.readonly)),
        EditorView.updateListener.of((u) => hooks.onUpdate(u)),
      ],
    }),
  )
  if (o.mode === 'code') {
    loadLanguage(o.name).then(
      (lang) => {
        if (lang && token === loadToken) view.dispatch({ effects: langC.reconfigure(lang) })
      },
      () => {},
    )
  }
}

/** Switch live preview on or off without touching the document or history. */
export function setLive(view: EditorView, mode: Mode, live: boolean): void {
  view.dispatch({ effects: modeC.reconfigure(modeExtensions(mode, live)) })
}
