#!/usr/bin/env bash
# scripts/setup-ui.sh — temporary page while setup.sh is downloading models.
# start | stop. The dev server binds 127.0.0.1 only and is not the production app.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ACTION="${1:-start}"
PORT="${PORT:-3000}"
if [[ "$(uname -s)" == "Darwin" ]]; then
  STATE="${WAVESMITH_STATE_DIR:-${HOME}/Library/Application Support/Wavesmith}"
else
  STATE="${WAVESMITH_STATE_DIR:-${XDG_STATE_HOME:-${HOME}/.local/state}/wavesmith}"
fi
PIDFILE="$STATE/setup-ui.pid"
LOG="$STATE/setup-ui.log"

stop_ui() {
  if [[ -f "$PIDFILE" ]]; then
    local pid
    pid="$(cat "$PIDFILE")"
    if [[ -n "$pid" ]]; then
      kill -TERM -- -"$pid" 2>/dev/null || kill -TERM "$pid" 2>/dev/null || true
    fi
    rm -f "$PIDFILE"
  fi
}

if [[ "$ACTION" == "stop" ]]; then
  stop_ui
  exit 0
fi

mkdir -p "$STATE"
if [[ -f "$PIDFILE" ]]; then
  old="$(cat "$PIDFILE")"
  if [[ -n "$old" ]] && kill -0 "$old" 2>/dev/null; then
    printf 'Setup screen is already running.\n'
    exit 0
  fi
fi

cd "$ROOT"
set -m
nohup pnpm dev --hostname 127.0.0.1 --port "$PORT" >"$LOG" 2>&1 &
echo $! >"$PIDFILE"
disown || true
printf 'Setup screen starting at http://127.0.0.1:%s\n' "$PORT"
