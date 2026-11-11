#!/usr/bin/env bash
# scripts/wavesmith-login.sh — LaunchAgent entry. No secrets live in this file.
# It opens the menu bar app and starts the server. .env stays in the checkout.
set -euo pipefail

SOURCE="${BASH_SOURCE[0]}"
while [[ -L "$SOURCE" ]]; do
  DIR="$(cd "$(dirname "$SOURCE")" && pwd)"
  SOURCE="$(readlink "$SOURCE")"
  [[ "$SOURCE" != /* ]] && SOURCE="$DIR/$SOURCE"
done
ROOT="$(cd "$(dirname "$SOURCE")/.." && pwd)"

export PATH="${HOME}/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${PATH}"
if [[ -d /opt/homebrew/opt/python@3.12/bin ]]; then
  export PATH="/opt/homebrew/opt/python@3.12/bin:${PATH}"
fi
if [[ -x /opt/homebrew/opt/node@22/bin/node ]]; then
  export PATH="/opt/homebrew/opt/node@22/bin:${PATH}"
elif [[ -x /usr/local/opt/node@22/bin/node ]]; then
  export PATH="/usr/local/opt/node@22/bin:${PATH}"
fi

if [[ -d "${HOME}/Applications/Wavesmith.app" ]]; then
  open -g "${HOME}/Applications/Wavesmith.app" || true
fi

exec "$ROOT/scripts/wavesmith" start --no-open
