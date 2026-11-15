// Slim status bar: words · characters · reading time · line:col.

import type { Text } from '@codemirror/state'
import { app, on } from '../state'

export function countWords(text: string): number {
  return text.match(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu)?.length ?? 0
}

export function readingTime(words: number): string {
  if (words === 0) return '0 min'
  const min = words / 230
  return min < 1 ? '< 1 min' : `${Math.round(min)} min`
}

export function initStatusbar(): void {
  const bar = document.getElementById('statusbar')!
  const left = document.createElement('span')
  const stats = document.createElement('span')
  const pos = document.createElement('span')
  left.className = 'status-left'
  bar.append(left, stats, pos)

  let counted: Text | null = null
  let timer = 0
  const count = () => {
    const doc = app.view.state.doc
    if (doc === counted) return
    counted = doc
    const chars = doc.length
    if (app.doc.mode === 'code') {
      stats.textContent = `${doc.lines.toLocaleString()} lines · ${chars.toLocaleString()} chars`
      return
    }
    // Counting words in a huge file on every pause is not worth it.
    if (chars > 2_000_000) {
      stats.textContent = `${chars.toLocaleString()} chars`
      return
    }
    const words = countWords(doc.toString())
    stats.textContent = `${words.toLocaleString()} words · ${chars.toLocaleString()} chars · ${readingTime(words)}`
  }

  on('cursor', () => {
    const state = app.view.state
    const head = state.selection.main.head
    const line = state.doc.lineAt(head)
    pos.textContent = `${line.number}:${head - line.from + 1}`
    if (state.doc !== counted) {
      clearTimeout(timer)
      timer = window.setTimeout(count, 250)
    }
  })
  const flags = () => {
    const f: string[] = []
    if (app.doc.readonly) f.push('read-only')
    if (app.doc.mode === 'markdown' && (app.sourceMode || app.doc.large)) f.push('source')
    left.textContent = f.join(' · ')
    count()
  }
  on('doc', flags)
  on('mode', flags)
}
