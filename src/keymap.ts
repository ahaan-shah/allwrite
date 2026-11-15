// Key combos as strings ("Ctrl+Shift+S"), default bindings plus user overrides from config.

import type { Command } from './commands'

export interface KeyLike {
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  metaKey?: boolean
  key: string
  code: string
}

const CODE_NAMES: Record<string, string> = {
  Equal: '=', Minus: '-', Comma: ',', Period: '.', Slash: '/', Backquote: '`',
  Semicolon: ';', Quote: "'", BracketLeft: '[', BracketRight: ']', Backslash: '\\',
  Space: 'Space', Enter: 'Enter', Escape: 'Escape', Tab: 'Tab', Backspace: 'Backspace',
  NumpadAdd: '=', NumpadSubtract: '-',
}

const ALIASES: Record<string, string> = {
  control: 'Ctrl', ctrl: 'Ctrl', mod: 'Ctrl', cmd: 'Ctrl', shift: 'Shift', alt: 'Alt',
  plus: '=', '+': '=', esc: 'Escape', return: 'Enter', space: 'Space',
}

/** Canonical form: modifiers in Ctrl, Alt, Shift order, key upper-cased. */
export function normalizeCombo(combo: string): string {
  let ctrl = false, alt = false, shift = false, key = ''
  // "Ctrl++" means the plus key
  const parts = combo.trim().replace(/\+\+$/, '+plus').split('+').map((p) => p.trim()).filter(Boolean)
  for (const part of parts) {
    const p = ALIASES[part.toLowerCase()] ?? part
    if (p === 'Ctrl') ctrl = true
    else if (p === 'Alt') alt = true
    else if (p === 'Shift') shift = true
    else key = p.length === 1 ? p.toUpperCase() : p[0].toUpperCase() + p.slice(1)
  }
  if (!key) return ''
  return (ctrl ? 'Ctrl+' : '') + (alt ? 'Alt+' : '') + (shift ? 'Shift+' : '') + key
}

/** Combo for a keyboard event, or '' for bare modifier presses. */
export function comboFromEvent(e: KeyLike): string {
  let key = ''
  if (/^[a-zA-Z]$/.test(e.key)) key = e.key.toUpperCase() // respects the keyboard layout
  else if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3)
  else if (/^Digit\d$/.test(e.code)) key = e.code.slice(5)
  else if (/^Numpad\d$/.test(e.code)) key = e.code.slice(6)
  else if (CODE_NAMES[e.code]) key = CODE_NAMES[e.code]
  else if (['Control', 'Shift', 'Alt', 'Meta', 'AltGraph'].includes(e.key)) return ''
  else key = e.key.length === 1 ? e.key.toUpperCase() : e.key
  if (!key) return ''
  return (e.ctrlKey || e.metaKey ? 'Ctrl+' : '') + (e.altKey ? 'Alt+' : '') + (e.shiftKey ? 'Shift+' : '') + key
}

/** combo -> command id, with user overrides replacing a command's default binding. */
export function buildKeymap(commands: Command[], overrides: Record<string, string> = {}): Map<string, string> {
  const map = new Map<string, string>()
  for (const c of commands) {
    const combo = normalizeCombo(overrides[c.id] ?? c.keys ?? '')
    if (combo) map.set(combo, c.id)
  }
  // Overrides win when two commands end up on the same combo.
  for (const [id, keys] of Object.entries(overrides)) {
    const combo = normalizeCombo(keys)
    if (combo && commands.some((c) => c.id === id)) map.set(combo, id)
  }
  return map
}

/** The combo currently bound to a command (for tooltips and the palette). */
export function keysFor(cmd: Command, overrides: Record<string, string> = {}): string {
  return normalizeCombo(overrides[cmd.id] ?? cmd.keys ?? '')
}
