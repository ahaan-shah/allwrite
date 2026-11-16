// Only the icons we use are imported, so only those end up in the bundle.

import {
  Bold, Code, Command, Eye, FilePlus, FolderOpen, Heading, Image, Italic, Link, List, ListOrdered, ListTodo,
  Maximize, Redo2, Save, Search, Settings, SquareCode, Strikethrough, Table, TableOfContents, TextQuote, Undo2, createElement,
} from 'lucide'

const ICONS = {
  new: FilePlus, open: FolderOpen, save: Save, bold: Bold, italic: Italic, strike: Strikethrough,
  code: Code, heading: Heading, link: Link, image: Image, list: List, task: ListTodo,
  quote: TextQuote, ordered: ListOrdered, codeblock: SquareCode, table: Table, outline: TableOfContents, search: Search, source: Eye, focus: Maximize, palette: Command, settings: Settings,
  undo: Undo2, redo: Redo2,
} as const

export type IconName = keyof typeof ICONS

export function icon(name: string): SVGElement | null {
  const node = ICONS[name as IconName]
  if (!node) return null
  return createElement(node, { width: 17, height: 17, 'stroke-width': 1.75 })
}
