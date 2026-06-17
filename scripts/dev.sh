#!/usr/bin/env bash
# scripts/dev.sh — start the engine + Next.js dev server concurrently with
# prefixed logs. Ctrl-C (or SIGTERM from a supervisor) stops both, including
# grandchildren. Both servers bind 127.0.0.1 ONLY — Wavesmith is local-first
# and must never listen on LAN interfaces (also a prerequisite for the Tauri
# wrap, spec §14).
#
# The engine is launched directly via `uv run acestep-api` — NOT via the
# upstream start_api_server_macos.sh, which adds an interactive update-check
# prompt and a pip self-repair step (wrong for unattended use; M0 decision).
set -uo pipefail
set -m # job control: each background job gets its own process group (cleanup relies on this)

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# uv-installed CLIs (demucs) live here; GUI-launched shells often omit it.
export PATH="${HOME}/.local/bin:${PATH}"

# .env is the single config surface (.env.example documents it). Sourcing with
# set -a exports everything — ACESTEP_* passthroughs reach the engine launch.
if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi

ENGINE_DIR="${ENGINE_DIR:-$ROOT/engine/ACE-Step-1.5}"
APP_PORT="${PORT:-3000}"
# Pin the LM the engine loads — without this, an un-pre-warmed lazy init would
# silently pick the 0.6B model (ENGINE_NOTES §2/§8).
ENGINE_INIT_LM_MODEL="${ENGINE_INIT_LM_MODEL:-acestep-5Hz-lm-1.7B}"

if [[ ! -d "$ENGINE_DIR/.venv" ]]; then
  echo "Engine not set up — run scripts/setup.sh first." >&2
  exit 1
fi

cleanup() {
  trap '' INT TERM
  echo
  echo "[dev] shutting down..."
  # Negative PIDs kill each job's entire process group (uv/python, node, sed).
  [[ -n "${ENGINE_PID:-}" ]] && kill -TERM -- -"$ENGINE_PID" 2>/dev/null
  [[ -n "${APP_PID:-}" ]] && kill -TERM -- -"$APP_PID" 2>/dev/null
  wait 2>/dev/null
  exit 0
}
trap cleanup INT TERM

# ── Engine (MLX backend, localhost only) ─────────────────────────────────────
(
  cd "$ENGINE_DIR"
  unset VIRTUAL_ENV
  ACESTEP_LM_BACKEND=mlx \
    ACESTEP_LM_MODEL_PATH="$ENGINE_INIT_LM_MODEL" \
    TOKENIZERS_PARALLELISM=false \
    uv run acestep-api --host 127.0.0.1 --port 8001 2>&1 | sed 's/^/[engine] /'
) &
ENGINE_PID=$!

# ── App ──────────────────────────────────────────────────────────────────────
(
  cd "$ROOT"
  pnpm dev --hostname 127.0.0.1 --port "$APP_PORT" 2>&1 | sed 's/^/[app]    /'
) &
APP_PID=$!

echo "[dev] engine → http://127.0.0.1:8001  |  app → http://127.0.0.1:$APP_PORT"
echo "[dev] engine loads models on first use (~45 s with weights on disk; the app pre-warms it)"
wait
