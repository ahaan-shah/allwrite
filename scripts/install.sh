#!/bin/bash
# Per-user install (no root): binary, icon and .desktop entry under ~/.local.
# Pass --default to also make allwrite the default app for Markdown files.
set -e
here=$(cd "$(dirname "$0")/.." && pwd)
bin="$here/src-tauri/target/release/allwrite"
[ -x "$bin" ] || { echo "Build first: npx tauri build --no-bundle"; exit 1; }
install -Dm755 "$bin" "$HOME/.local/bin/allwrite"
install -Dm644 "$here/packaging/allwrite.desktop" "$HOME/.local/share/applications/allwrite.desktop"
install -Dm644 "$here/logos/markdown-reader-blue.svg" "$HOME/.local/share/icons/hicolor/scalable/apps/allwrite.svg"
update-desktop-database "$HOME/.local/share/applications" 2>/dev/null || true
if [ "$1" = "--default" ]; then
  xdg-mime default allwrite.desktop text/markdown
  echo "allwrite is now the default for text/markdown"
fi
echo "Installed to ~/.local/bin/allwrite"
