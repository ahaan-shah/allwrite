// Font slots -> CSS variables.

import type { FontCfg } from './types'

export const CURATED_TEXT = ['Inter', 'IBM Plex Sans', 'IBM Plex Serif', 'Noto Serif', 'Literata', 'iA Writer Quattro S', 'iA Writer Duo S']
export const CURATED_CODE = ['JetBrains Mono', 'IBM Plex Mono', 'Fira Code', 'iA Writer Mono S']
export const GENERIC: Record<string, string> = { Sans: 'sans-serif', Serif: 'serif', Monospace: 'monospace' }

/** CSS font-family value for a configured name. */
export function fontStack(name: string, slot: 'text' | 'code'): string {
  const fallback = slot === 'code' ? 'monospace' : 'sans-serif'
  const generic = GENERIC[name] ?? (Object.values(GENERIC).includes(name) ? name : undefined)
  if (generic) return generic
  return `"${name.replace(/["\\]/g, '')}", ${fallback}`
}

export function applyFonts(f: FontCfg): void {
  const s = document.documentElement.style
  s.setProperty('--font-text', fontStack(f.text, 'text'))
  s.setProperty('--font-code', fontStack(f.code, 'code'))
  s.setProperty('--font-size', `${f.size}px`)
  s.setProperty('--line-height', String(f.line_height))
  s.setProperty('--col', String(f.column_width))
}

/** Quick picks for a slot: curated fonts that are installed, then the generic families. */
export function quickPicks(slot: 'text' | 'code', installed: string[]): string[] {
  const have = new Set(installed.map((f) => f.toLowerCase()))
  const curated = (slot === 'text' ? CURATED_TEXT : CURATED_CODE).filter((f) => have.has(f.toLowerCase()))
  return [...curated, ...(slot === 'text' ? ['Sans', 'Serif'] : []), 'Monospace']
}
