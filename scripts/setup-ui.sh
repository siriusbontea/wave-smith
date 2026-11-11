#!/usr/bin/env bash
# scripts/setup-ui.sh — temporary page while setup.sh is downloading models.
# start | stop. The dev server binds 127.0.0.1 only and is not the production app.
# A pid file is trusted only when the command and the start time still match.
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

process_started() {
  ps -o lstart= -p "$1" 2>/dev/null | sed 's/^[[:space:]]*//;s/[[:space:]]*$//'
}

process_command() {
  ps -o command= -p "$1" 2>/dev/null | sed 's/^[[:space:]]*//;s/[[:space:]]*$//'
}

# A reused pid, or a pid we did not start, does not match. Do not signal it.
is_ours() {
  local pid="$1" started="$2" recorded="$3"
  [[ "$pid" =~ ^[0-9]+$ ]] || return 1
  [[ -n "$started" && -n "$recorded" ]] || return 1
  local now_started now_cmd
  now_started="$(process_started "$pid")"
  now_cmd="$(process_command "$pid")"
  [[ -n "$now_started" && "$now_started" == "$started" ]] || return 1
  [[ "$now_cmd" == *pnpm* && "$now_cmd" == *dev* ]] || return 1
  if [[ "$now_cmd" == "$recorded" ]]; then
    return 0
  fi
  # pnpm may re-exec and keep the same start time. The new command still has to be our dev server.
  [[ "$recorded" == *pnpm* && "$recorded" == *dev* ]]
}

read_record() {
  PID_VALUE=""
  STARTED_VALUE=""
  COMMAND_VALUE=""
  [[ -f "$PIDFILE" ]] || return 1
  PID_VALUE="$(sed -n '1p' "$PIDFILE")"
  STARTED_VALUE="$(sed -n '2p' "$PIDFILE")"
  COMMAND_VALUE="$(sed -n '3p' "$PIDFILE")"
}

write_pid() {
  local pid="$1"
  local started="" command="" tries=0
  while [[ "$tries" -lt 5 ]]; do
    tries=$((tries + 1))
    started="$(process_started "$pid")"
    command="$(process_command "$pid")"
    if [[ -n "$started" && -n "$command" ]]; then
      break
    fi
    sleep 0.1
  done
  local tmp
  tmp="$(mktemp "${PIDFILE}.XXXXXX")"
  printf '%s\n%s\n%s\n' "$pid" "$started" "$command" >"$tmp"
  mv "$tmp" "$PIDFILE"
}

stop_ui() {
  if read_record && is_ours "$PID_VALUE" "$STARTED_VALUE" "$COMMAND_VALUE"; then
    kill -TERM -- -"$PID_VALUE" 2>/dev/null || kill -TERM "$PID_VALUE" 2>/dev/null || true
  fi
  rm -f "$PIDFILE"
}

if [[ "$ACTION" == "stop" ]]; then
  stop_ui
  exit 0
fi

mkdir -p "$STATE"
if read_record && is_ours "$PID_VALUE" "$STARTED_VALUE" "$COMMAND_VALUE"; then
  printf 'Setup screen is already running.\n'
  exit 0
fi
rm -f "$PIDFILE"

cd "$ROOT"
set -m
nohup pnpm dev --hostname 127.0.0.1 --port "$PORT" >"$LOG" 2>&1 &
write_pid "$!"
disown || true
printf 'Setup screen starting at http://127.0.0.1:%s\n' "$PORT"
