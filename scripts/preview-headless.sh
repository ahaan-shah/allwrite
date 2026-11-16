#!/bin/bash
# Render the built frontend in headless Chromium with a mocked backend and save a screenshot.
# Nothing appears on screen. Needs `npm run build` first.
# Usage: scripts/preview-headless.sh <out.png> ['file=test.md&cursor=40&keys=Ctrl+P'] [WxH]
# Hash options also include after=<combos pressed after type> and hover=<top-bar command id>.
set -e
here=$(cd "$(dirname "$0")/.." && pwd)
out=${1:?output png}; hash=${2:-file=test.md}; size=${3:-900x760}
tmp=$(mktemp -d "${TMPDIR:-/tmp}/allwrite-preview.XXXXXX")
trap 'kill $server 2>/dev/null; rm -rf "$tmp"' EXIT
cp -r "$here/dist/." "$tmp/"
mkdir -p "$tmp/doc" && cp -r "$here/logos" "$tmp/doc/"
python3 - "$here" "$tmp" <<'PY'
import json, os, sys
here, tmp = sys.argv[1:]
wal = os.path.expanduser('~/.cache/wal/colors.json')
if os.path.exists(wal):
    w = json.load(open(wal)); c = [w['colors'][f'color{i}'] for i in range(16)]; s = w['special']
    theme = dict(source='pywal', dark=True, bg=s['background'], fg=s['foreground'], cursor=s['cursor'], muted=c[8], accent=c[4], heading=s['foreground'], colors=c)
else:
    c = ["#1b1d23","#e06c75","#98c379","#e5c07b","#61afef","#c678dd","#56b6c2","#c8ccd4","#636b7a"]*2
    theme = dict(source='builtin', dark=True, bg=c[0], fg='#d7dae0', cursor='#d7dae0', muted=c[8], accent=c[4], heading='#d7dae0', colors=c[:16])
files = {}
for name in os.listdir(os.path.join(here, 'tests', 'harness')) + ['test.md']:
    p = os.path.join(here, name) if name == 'test.md' else os.path.join(here, 'tests', 'harness', name)
    if os.path.isfile(p) and not name.endswith('.js'):
        files[name] = open(p).read()
config = dict(font=dict(text='Inter', code='JetBrains Mono', size=16, line_height=1.6, column_width=72), app=dict(autosave=False, remote_images=True, line_numbers=False), keys={}, theme={})
mock = open(os.path.join(here, 'tests', 'harness', 'mock.js')).read()
html = open(os.path.join(tmp, 'index.html')).read()
inject = '<script>window.__MOCK__=' + json.dumps(dict(theme=theme, files=files, config=config)).replace('</', '<\\/') + ';</script><script>' + mock + '</script>'
open(os.path.join(tmp, 'index.html'), 'w').write(html.replace('<head>', '<head>' + inject, 1))
PY
port=$((20000 + RANDOM % 20000))
python3 -m http.server "$port" --bind 127.0.0.1 --directory "$tmp" >/dev/null 2>&1 &
server=$!
sleep 0.4
# Chromium needs a short TMPDIR for its singleton socket.
TMPDIR="${XDG_RUNTIME_DIR:-/tmp}" chromium --headless=new --disable-gpu --no-first-run --hide-scrollbars --user-data-dir="$tmp/profile" \
  --window-size="${size/x/,}" --virtual-time-budget=5000 --screenshot="$out" \
  "http://127.0.0.1:$port/index.html#$hash" >"$tmp/chromium.log" 2>&1 || { tail -5 "$tmp/chromium.log"; exit 1; }
echo "wrote $out"
