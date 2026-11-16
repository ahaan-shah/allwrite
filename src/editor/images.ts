// Inline image widgets, plus pasting images into the document.

import { EditorView, WidgetType } from '@codemirror/view'
import { convertFileSrc, invoke } from '@tauri-apps/api/core'

/** Set by the app whenever a document is shown. */
export const imageCtx = { dir: '', remote: true }

export type ImageRef =
  | { kind: 'remote'; src: string }
  | { kind: 'data'; src: string }
  | { kind: 'local'; path: string; inDocDir: boolean }
  | { kind: 'blocked' }
  | { kind: 'none' }

export function normalizePath(path: string): string {
  const out: string[] = []
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') out.pop()
    else out.push(part)
  }
  return '/' + out.join('/')
}

/** Work out where a Markdown image URL points, relative to the document's folder. */
export function resolveImage(url: string, docDir: string, allowRemote = true): ImageRef {
  let u = url.trim()
  if (u.startsWith('<') && u.endsWith('>')) u = u.slice(1, -1)
  if (!u) return { kind: 'none' }
  if (/^https?:\/\//i.test(u)) return allowRemote ? { kind: 'remote', src: u } : { kind: 'blocked' }
  if (/^data:image\//i.test(u)) return { kind: 'data', src: u }
  if (/^file:\/\//i.test(u)) u = u.replace(/^file:\/\/(localhost)?/i, '')
  else if (/^[a-z][a-z0-9+.-]*:/i.test(u)) return { kind: 'none' }
  u = u.replace(/[?#].*$/, '')
  try {
    u = decodeURIComponent(u)
  } catch {
    /* keep as typed */
  }
  if (u.startsWith('/')) {
    const path = normalizePath(u)
    return { kind: 'local', path, inDocDir: !!docDir && path.startsWith(docDir.replace(/\/$/, '') + '/') }
  }
  if (!docDir) return { kind: 'none' }
  const path = normalizePath(docDir + '/' + u)
  return { kind: 'local', path, inDocDir: path.startsWith(docDir.replace(/\/$/, '') + '/') }
}

export class ImageWidget extends WidgetType {
  constructor(readonly url: string, readonly alt: string, readonly dir: string, readonly remote: boolean) {
    super()
  }

  eq(o: ImageWidget): boolean {
    return o.url === this.url && o.alt === this.alt && o.dir === this.dir && o.remote === this.remote
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement('span')
    wrap.className = 'cm-image'
    const fail = (msg: string) => {
      const ph = document.createElement('span')
      ph.className = 'cm-image-missing'
      ph.textContent = msg
      wrap.replaceChildren(ph)
      view.requestMeasure()
    }
    const ref = resolveImage(this.url, this.dir, this.remote)
    if (ref.kind === 'none') return fail(`image not found: ${this.url || '(no path)'}`), wrap
    if (ref.kind === 'blocked') return fail('remote images are turned off'), wrap

    const img = document.createElement('img')
    // No loading="lazy": WebKitGTK was seen never to start those loads. CodeMirror only
    // creates widgets for the visible part of the document, which is lazy enough.
    img.decoding = 'async'
    img.alt = this.alt
    img.draggable = false
    img.onload = () => view.requestMeasure()
    img.onerror = () => fail(`image not found: ${this.url}`)
    wrap.appendChild(img)
    if (ref.kind === 'local') {
      const path = ref.path
      if (ref.inDocDir) img.src = convertFileSrc(path)
      else
        invoke('allow_image', { path }).then(
          () => (img.src = convertFileSrc(path)),
          () => fail(`image not found: ${this.url}`),
        )
    } else {
      img.src = ref.src
    }
    return wrap
  }

  ignoreEvent(): boolean {
    return false
  }
}

const EXT: Record<string, string> = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp',
  'image/svg+xml': 'svg', 'image/bmp': 'bmp', 'image/avif': 'avif',
}

export function insertImageMarkdown(view: EditorView, rel: string, pos?: number): void {
  const at = pos ?? view.state.selection.main.from
  const to = pos ?? view.state.selection.main.to
  const text = `![](${rel.includes(' ') ? `<${rel}>` : rel})`
  view.dispatch({ changes: { from: at, to, insert: text }, selection: { anchor: at + text.length }, userEvent: 'input.paste' })
}

/** An image file on the clipboard or in a drop, if there is one. */
export function imageFile(dt: DataTransfer): File | null {
  for (const item of dt.items) {
    if (item.kind === 'file' && EXT[item.type]) {
      const f = item.getAsFile()
      if (f) return f
    }
  }
  for (const f of dt.files) if (EXT[f.type]) return f
  return null
}

export function imageExt(type: string): string | undefined {
  return EXT[type]
}

/** Local image paths in a text/uri-list or plain-text paste (a file copied in a file manager). */
export function imagePaths(text: string): string[] {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
  if (!lines.length) return []
  const paths: string[] = []
  for (const l of lines) {
    let p = l
    if (/^file:\/\//i.test(p)) {
      try {
        p = decodeURIComponent(p.replace(/^file:\/\/(localhost)?/i, ''))
      } catch {
        return []
      }
    }
    if (!p.startsWith('/') || !/\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(p)) return []
    paths.push(p)
  }
  return paths
}
