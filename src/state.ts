// Shared app state and a tiny event bus.

import type { EditorView } from '@codemirror/view'
import type { Text } from '@codemirror/state'
import type { Config, Mode } from './types'

export interface DocInfo {
  path: string // '' for an unsaved new file
  name: string
  dir: string
  mode: Mode
  dirty: boolean
  readonly: boolean
  crlf: boolean
  /** Live preview forced off (large file). */
  large: boolean
}

export const app = {
  view: null as unknown as EditorView,
  config: null as unknown as Config,
  doc: { path: '', name: 'Untitled', dir: '', mode: 'markdown', dirty: false, readonly: false, crlf: false, large: false } as DocInfo,
  saved: null as Text | null,
  sourceMode: false,
  fonts: null as string[] | null,
}

type Topic = 'doc' | 'config' | 'cursor' | 'mode'
const listeners = new Map<Topic, Array<() => void>>()

export function on(topic: Topic, fn: () => void): void {
  const l = listeners.get(topic) ?? []
  l.push(fn)
  listeners.set(topic, l)
}

export function emit(topic: Topic): void {
  for (const fn of listeners.get(topic) ?? []) fn()
}
