// Only the icons we use are imported, so only those end up in the bundle.

import {
  Bold, Code, Command, Eye, FilePlus, FolderOpen, Heading, Image, Italic, Link, List, ListTodo,
  Maximize, Save, Search, Settings, Strikethrough, TextQuote, createElement,
} from 'lucide'

const ICONS = {
  new: FilePlus, open: FolderOpen, save: Save, bold: Bold, italic: Italic, strike: Strikethrough,
  code: Code, heading: Heading, link: Link, image: Image, list: List, task: ListTodo,
  quote: TextQuote, search: Search, source: Eye, focus: Maximize, palette: Command, settings: Settings,
} as const

export type IconName = keyof typeof ICONS

export function icon(name: string): SVGElement | null {
  const node = ICONS[name as IconName]
  if (!node) return null
  return createElement(node, { width: 15, height: 15, 'stroke-width': 1.75 })
}
