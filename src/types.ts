export interface FontCfg {
  text: string
  code: string
  size: number
  line_height: number
  column_width: number
}

export interface Config {
  font: FontCfg
  app: { autosave: boolean; remote_images: boolean }
  keys: Record<string, string>
  theme: Record<string, string>
}

export interface Theme {
  source: string
  dark: boolean
  bg: string
  fg: string
  cursor: string
  muted: string
  accent: string
  heading: string
  colors: string[]
}

export interface OpenedFile {
  path: string
  name: string
  dir: string
  content: string
  readonly: boolean
  exists: boolean
}

export type Mode = 'markdown' | 'text' | 'code'
