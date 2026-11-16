// Palette from Rust -> CSS variables. Includes the contrast check.

import type { Theme } from './types'

type RGB = [number, number, number]

export function parseHex(hex: string): RGB {
  const h = hex.replace('#', '')
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const n = parseInt(full, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function toHex([r, g, b]: RGB): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')
  return '#' + c(r) + c(g) + c(b)
}

/** Mix `a` toward `b` by t (0..1). */
export function mix(a: string, b: string, t: number): string {
  const x = parseHex(a), y = parseHex(b)
  return toHex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t])
}

export function luminance(hex: string): number {
  const [r, g, b] = parseHex(hex).map((v) => {
    const s = v / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** WCAG contrast ratio, 1..21. */
export function contrast(a: string, b: string): number {
  const la = luminance(a), lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** Nudge `color` away from `bg` (toward white or black) until it reaches `min` contrast. */
export function ensureContrast(color: string, bg: string, min: number): string {
  if (contrast(color, bg) >= min) return color
  const target = luminance(bg) < 0.5 ? '#ffffff' : '#000000'
  for (let t = 0.08; t <= 1.0001; t += 0.08) {
    const c = mix(color, target, t)
    if (contrast(c, bg) >= min) return c
  }
  return target
}

export function computeVars(t: Theme): Record<string, string> {
  const bg = t.bg
  const fg = ensureContrast(t.fg, bg, 7)
  const accent = ensureContrast(t.accent, bg, 4.5)
  const dark = luminance(bg) < 0.5
  // Headings and bold text sit a step brighter (darker on light themes) than body text.
  const strong = mix(fg, dark ? '#ffffff' : '#000000', 0.35)
  const vars: Record<string, string> = {
    '--bg': bg,
    '--fg': fg,
    '--cursor': ensureContrast(t.cursor, bg, 3),
    '--muted': ensureContrast(t.muted, bg, 3.2),
    '--accent': accent,
    '--heading': t.heading.toLowerCase() === t.fg.toLowerCase() ? strong : ensureContrast(t.heading, bg, 4.5),
    '--strong': strong,
    '--code-bg': mix(bg, fg, 0.06),
    '--hover': mix(bg, fg, 0.1),
    '--border': mix(bg, fg, 0.14),
    '--panel': mix(bg, fg, 0.035),
    '--shadow': dark ? 'rgb(0 0 0 / 0.45)' : 'rgb(0 0 0 / 0.14)',
    '--selection': mix(bg, accent, 0.32),
  }
  for (let i = 1; i <= 6; i++) vars[`--c${i}`] = ensureContrast(t.colors[i] ?? fg, bg, 4.5)
  return vars
}

export function applyTheme(t: Theme): void {
  const root = document.documentElement
  for (const [k, v] of Object.entries(computeVars(t))) root.style.setProperty(k, v)
  root.style.colorScheme = t.dark ? 'dark' : 'light'
  root.dataset.themeSource = t.source
}
