import { describe, expect, it } from 'vitest'
import { all, get, register, run, unregister } from '../src/commands'
import { bulletLine, headingLine, quoteLine, taskLine } from '../src/editor/format'
import { resolveImage } from '../src/editor/images'
import { modeFor } from '../src/editor/languages'
import { fontStack, quickPicks } from '../src/fonts'
import { buildKeymap, comboFromEvent, keysFor, normalizeCombo } from '../src/keymap'
import { computeVars, contrast, ensureContrast, mix } from '../src/theme'
import { filterItems, fuzzyScore } from '../src/ui/palette'
import { countWords, readingTime } from '../src/ui/statusbar'

describe('command registry', () => {
  it('registers, runs and unregisters', () => {
    let n = 0
    register({ id: 't:a', label: 'A', keys: 'Ctrl+B', run: () => n++ }, { id: 't:b', label: 'B', run: () => { throw new Error('x') } })
    expect(get('t:a')?.label).toBe('A')
    expect(run('t:a')).toBe(true)
    expect(n).toBe(1)
    expect(run('t:b')).toBe(true) // errors are contained
    expect(run('nope')).toBe(false)
    expect(all().length).toBe(2)
    unregister('t:')
    expect(all().length).toBe(0)
  })
})

describe('keymap', () => {
  it('normalizes combos', () => {
    expect(normalizeCombo('ctrl+shift+s')).toBe('Ctrl+Shift+S')
    expect(normalizeCombo('Shift+Ctrl+S')).toBe('Ctrl+Shift+S')
    expect(normalizeCombo('Mod+,')).toBe('Ctrl+,')
    expect(normalizeCombo('Ctrl++')).toBe('Ctrl+=')
    expect(normalizeCombo('ctrl+alt+f5')).toBe('Ctrl+Alt+F5')
    expect(normalizeCombo('')).toBe('')
  })

  it('reads combos from keyboard events', () => {
    const ev = (o: Partial<Parameters<typeof comboFromEvent>[0]>) => comboFromEvent({ ctrlKey: false, shiftKey: false, altKey: false, key: '', code: '', ...o })
    expect(ev({ ctrlKey: true, key: 's', code: 'KeyS' })).toBe('Ctrl+S')
    expect(ev({ ctrlKey: true, shiftKey: true, key: '*', code: 'Digit8' })).toBe('Ctrl+Shift+8')
    expect(ev({ ctrlKey: true, shiftKey: true, key: '>', code: 'Period' })).toBe('Ctrl+Shift+.')
    expect(ev({ ctrlKey: true, key: '=', code: 'Equal' })).toBe('Ctrl+=')
    expect(ev({ ctrlKey: true, shiftKey: true, key: '+', code: 'Equal' })).toBe('Ctrl+Shift+=')
    expect(ev({ ctrlKey: true, key: '`', code: 'Backquote' })).toBe('Ctrl+`')
    expect(ev({ ctrlKey: true, key: 'Control', code: 'ControlLeft' })).toBe('')
    expect(ev({ key: 'F5', code: 'F5' })).toBe('F5')
  })

  it('applies user overrides', () => {
    const cmds = [
      { id: 'bold', label: 'Bold', keys: 'Ctrl+B', run: () => {} },
      { id: 'save', label: 'Save', keys: 'Ctrl+S', run: () => {} },
      { id: 'nokeys', label: 'None', run: () => {} },
    ]
    const map = buildKeymap(cmds, { bold: 'ctrl+shift+b', nokeys: 'Ctrl+S', ghost: 'Ctrl+G' })
    expect(map.get('Ctrl+Shift+B')).toBe('bold')
    expect(map.has('Ctrl+B')).toBe(false)
    expect(map.get('Ctrl+S')).toBe('nokeys') // override wins the conflict
    expect(map.has('Ctrl+G')).toBe(false)
    expect(keysFor(cmds[0], { bold: 'ctrl+shift+b' })).toBe('Ctrl+Shift+B')
  })
})

describe('theme contrast', () => {
  it('computes contrast ratios', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 0)
    expect(contrast('#777777', '#777777')).toBeCloseTo(1, 5)
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080')
  })

  it('nudges low-contrast colors until readable', () => {
    expect(ensureContrast('#ffffff', '#000000', 4.5)).toBe('#ffffff') // already fine: untouched
    const onDark = ensureContrast('#222233', '#101018', 4.5)
    expect(contrast(onDark, '#101018')).toBeGreaterThanOrEqual(4.5)
    const onLight = ensureContrast('#eeeedd', '#ffffff', 4.5)
    expect(contrast(onLight, '#ffffff')).toBeGreaterThanOrEqual(4.5)
  })

  it('produces readable variables for a hostile palette', () => {
    const bg = '#1a1a1a'
    const vars = computeVars({
      source: 'pywal', dark: true, bg, fg: '#333333', cursor: '#1b1b1b', muted: '#202020',
      accent: '#1c1c2c', heading: '#221a1a', colors: Array(16).fill('#1e1e1e'),
    })
    expect(contrast(vars['--fg'], bg)).toBeGreaterThanOrEqual(7)
    expect(contrast(vars['--accent'], bg)).toBeGreaterThanOrEqual(4.5)
    expect(contrast(vars['--muted'], bg)).toBeGreaterThanOrEqual(3.2)
    expect(contrast(vars['--c3'], bg)).toBeGreaterThanOrEqual(4.5)
    expect(vars['--bg']).toBe(bg)
  })
})

describe('formatting', () => {
  it('sets and toggles headings', () => {
    expect(headingLine('Title', 2)).toBe('## Title')
    expect(headingLine('# Title', 3)).toBe('### Title')
    expect(headingLine('## Title', 2)).toBe('Title')
    expect(headingLine('### Title', 0)).toBe('Title')
    expect(headingLine('#hashtag', 1)).toBe('# #hashtag')
  })

  it('toggles list, task and quote prefixes', () => {
    expect(bulletLine('item')).toBe('- item')
    expect(bulletLine('- item')).toBe('item')
    expect(bulletLine('  1. item')).toBe('  - item')
    expect(bulletLine('- [ ] item')).toBe('- item')
    expect(taskLine('item')).toBe('- [ ] item')
    expect(taskLine('- item')).toBe('- [ ] item')
    expect(taskLine('- [x] item')).toBe('item')
    expect(quoteLine('text')).toBe('> text')
    expect(quoteLine('> text')).toBe('text')
  })
})

describe('image paths', () => {
  const dir = '/home/u/notes'
  it('resolves relative, absolute and remote', () => {
    expect(resolveImage('assets/a.png', dir)).toEqual({ kind: 'local', path: '/home/u/notes/assets/a.png', inDocDir: true })
    expect(resolveImage('./a%20b.png', dir)).toEqual({ kind: 'local', path: '/home/u/notes/a b.png', inDocDir: true })
    expect(resolveImage('<my pic.png>', dir)).toEqual({ kind: 'local', path: '/home/u/notes/my pic.png', inDocDir: true })
    expect(resolveImage('../pics/a.png', dir)).toEqual({ kind: 'local', path: '/home/u/pics/a.png', inDocDir: false })
    expect(resolveImage('/tmp/a.png', dir)).toEqual({ kind: 'local', path: '/tmp/a.png', inDocDir: false })
    expect(resolveImage('file:///tmp/a.png', dir)).toEqual({ kind: 'local', path: '/tmp/a.png', inDocDir: false })
    expect(resolveImage('https://x.y/a.png', dir)).toEqual({ kind: 'remote', src: 'https://x.y/a.png' })
    expect(resolveImage('https://x.y/a.png', dir, false)).toEqual({ kind: 'blocked' })
    expect(resolveImage('a.png', '')).toEqual({ kind: 'none' })
    expect(resolveImage('javascript:alert(1)', dir)).toEqual({ kind: 'none' })
    expect(resolveImage('/home/u/notes-other/a.png', dir)).toMatchObject({ inDocDir: false })
  })
})

describe('misc', () => {
  it('picks a mode per file name', () => {
    expect(modeFor('a.md')).toBe('markdown')
    expect(modeFor('A.MARKDOWN')).toBe('markdown')
    expect(modeFor('')).toBe('markdown')
    expect(modeFor('notes.txt')).toBe('text')
    expect(modeFor('unknown.xyz123')).toBe('text')
    expect(modeFor('main.rs')).toBe('code')
    expect(modeFor('x.py')).toBe('code')
  })

  it('builds font stacks and quick picks', () => {
    expect(fontStack('Inter', 'text')).toBe('"Inter", sans-serif')
    expect(fontStack('Serif', 'text')).toBe('serif')
    expect(fontStack('JetBrains Mono', 'code')).toBe('"JetBrains Mono", monospace')
    expect(quickPicks('text', ['inter', 'Noto Serif', 'Other'])).toEqual(['Inter', 'Noto Serif', 'Sans', 'Serif', 'Monospace'])
    expect(quickPicks('code', [])).toEqual(['Monospace'])
  })

  it('fuzzy-filters palette items', () => {
    expect(fuzzyScore('xyz', 'Bold')).toBe(-1)
    const items = ['Save as…', 'Save', 'Toggle source mode', 'Text font: Inter'].map((label) => ({ label }))
    expect(filterItems(items, 'save').map((i) => i.label)).toEqual(['Save', 'Save as…'])
    expect(filterItems(items, 'tsm')[0].label).toBe('Toggle source mode')
    expect(filterItems(items, 'font')[0].label).toBe('Text font: Inter')
    expect(filterItems(items, '').length).toBe(4)
  })

  it('counts words and reading time', () => {
    expect(countWords("Hello, world — it's a well-known fact. 42")).toBe(7)
    expect(countWords('')).toBe(0)
    expect(readingTime(0)).toBe('0 min')
    expect(readingTime(100)).toBe('< 1 min')
    expect(readingTime(690)).toBe('3 min')
  })
})
