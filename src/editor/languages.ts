// File name -> editing mode, and lazy language loading for code files.

import { LanguageDescription, type LanguageSupport } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import type { Mode } from '../types'

export { languages }

const MARKDOWN = /\.(md|markdown|mdown|mkd)$/i
const TEXT = /\.(txt|text|log)$/i

export function modeFor(name: string): Mode {
  if (!name || MARKDOWN.test(name)) return 'markdown'
  if (TEXT.test(name)) return 'text'
  return LanguageDescription.matchFilename(languages, name) ? 'code' : 'text'
}

/** Loads the language chunk on demand; resolves to null for unknown files. */
export function loadLanguage(name: string): Promise<LanguageSupport | null> {
  const desc = LanguageDescription.matchFilename(languages, name)
  return desc ? desc.load() : Promise.resolve(null)
}
