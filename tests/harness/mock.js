// Stand-in for the Tauri backend so the built frontend can run in a plain (headless) browser.
// Used by scripts/preview-headless.sh. Options come from the URL hash, e.g.
//   #file=test.md&cursor=40&keys=Ctrl+P;Ctrl+B&type=font
// `numbers=1` turns on line numbers; `after` = combos pressed after `type`; `hover` = a top-bar command id to hover (shows its tooltip).
;(() => {
  const opts = Object.fromEntries(new URLSearchParams(location.hash.slice(1)))
  const data = window.__MOCK__
  if (opts.numbers) data.config.app.line_numbers = true
  const calls = (window.__CALLS__ = [])
  let cb = 0
  const handlers = {
    init: () => ({ config: data.config, theme: data.theme, file: opts.file ? file(opts.file) : null, error: null }),
    read_file: (a) => file(a.path.split('/').pop()),
    write_file: (a) => ({ path: a.path, name: a.path.split('/').pop(), dir: '/doc', content: '', readonly: false, exists: true }),
    list_fonts: () => ['Inter', 'JetBrains Mono', 'Noto Serif', 'Literata', 'DejaVu Sans', 'Fira Code'],
    recent_files: () => ['/doc/test.md', '/doc/notes/todo.md'],
    get_theme: () => data.theme,
  }
  function file(name) {
    const content = data.files[name]
    return { path: '/doc/' + name, name, dir: '/doc', content: content ?? '', readonly: false, exists: content !== undefined }
  }
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' } },
    transformCallback: (fn) => {
      const id = ++cb
      window['_' + id] = fn
      return id
    },
    unregisterCallback: () => {},
    convertFileSrc: (path) => path, // /doc/... is served by the preview server
    invoke: async (cmd, args) => {
      calls.push([cmd, args])
      return handlers[cmd] ? handlers[cmd](args || {}) : null
    },
  }
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} }

  const key = (combo) => {
    const parts = combo.split('+')
    const k = parts.pop()
    const code = /^[A-Za-z]$/.test(k) ? 'Key' + k.toUpperCase() : /^\d$/.test(k) ? 'Digit' + k : { ',': 'Comma', '.': 'Period', '=': 'Equal', '-': 'Minus', '`': 'Backquote' }[k] || k
    const init = { key: k.length === 1 ? k.toLowerCase() : k, code, ctrlKey: parts.includes('Ctrl'), shiftKey: parts.includes('Shift'), altKey: parts.includes('Alt'), bubbles: true, cancelable: true }
    ;(document.activeElement || document.body).dispatchEvent(new KeyboardEvent('keydown', init))
  }
  window.addEventListener('load', () => {
    setTimeout(() => {
      const view = window.allwrite && window.allwrite.view
      if (view && opts.cursor) view.dispatch({ selection: { anchor: Number(opts.cursor) }, scrollIntoView: true })
      if (view && opts.scroll) view.scrollDOM.scrollTop = Number(opts.scroll)
      // combos are separated by ';' (a '+' in a URL query decodes to a space, so undo that)
      for (const combo of (opts.keys || '').split(';').filter(Boolean)) key(combo.replace(/ /g, '+'))
      if (opts.type) {
        setTimeout(() => {
          const el = document.activeElement
          if (el && el.tagName === 'INPUT') {
            el.value = opts.type
            el.dispatchEvent(new Event('input', { bubbles: true }))
          } else if (view) {
            view.dispatch(view.state.replaceSelection(opts.type))
          }
          for (const combo of (opts.after || '').split(';').filter(Boolean)) key(combo.replace(/ /g, '+'))
        }, 150)
      }
      if (opts.hover) {
        const b = document.querySelector(`#topbar [data-cmd="${opts.hover}"]`)
        if (b) b.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }))
      }
      if (opts.width) document.documentElement.style.width = opts.width
    }, 400)
  })
})()
