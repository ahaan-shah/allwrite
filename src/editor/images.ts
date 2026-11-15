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

/** Paste handler: an image on the clipboard is saved to assets/ and linked. */
export function imagePaste(onError: (msg: string) => void) {
  return EditorView.domEventHandlers({
    paste(event, view) {
      const cd = event.clipboardData
      if (!cd) return false
      // Prefer text when the clipboard has both (e.g. copied from a web page).
      if (cd.getData('text/plain')) return false
      let file: File | null = null
      for (const item of cd.items) {
        if (item.kind === 'file' && EXT[item.type]) {
          file = item.getAsFile()
          if (file) break
        }
      }
      if (!file) return false
      event.preventDefault()
      const ext = EXT[file.type]
      file
        .arrayBuffer()
        .then((buf) => invoke<string>('save_image', new Uint8Array(buf), { headers: { ext } }))
        .then((rel) => insertImageMarkdown(view, rel))
        .catch((e) => onError(String(e)))
      return true
    },
  })
}
