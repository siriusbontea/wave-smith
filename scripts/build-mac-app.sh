#!/usr/bin/env bash
# scripts/build-mac-app.sh — unsigned menu bar app in ~/Applications.
# macOS only. The first launch needs a right-click Open (see the README).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$ROOT/macos/WavesmithMenuBar"
DEST="${WAVESMITH_APP_DEST:-${HOME}/Applications/Wavesmith.app}"

if [[ "$(uname -s)" != "Darwin" ]]; then
  printf 'The menu bar app is built on a Mac.\n'
  exit 1
fi
if ! command -v swiftc >/dev/null 2>&1; then
  printf 'swiftc is missing.\nFix: xcode-select --install\nThen run scripts/build-mac-app.sh again.\n'
  exit 1
fi

mkdir -p "${DEST}/Contents/MacOS" "${DEST}/Contents/Resources"
cp "$SRC/Info.plist" "${DEST}/Contents/Info.plist"
swiftc -O -o "${DEST}/Contents/MacOS/Wavesmith" "$SRC/main.swift" -framework Cocoa
chmod +x "${DEST}/Contents/MacOS/Wavesmith"
printf 'Installed %s\n' "$DEST"
printf 'The first time you open it: right-click Wavesmith, choose Open, then Open.\n'
