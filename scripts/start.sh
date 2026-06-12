#!/usr/bin/env bash
# scripts/start.sh — production build + start (engine + app), localhost only.
# Same process supervision as dev.sh but with `next build && next start`.
set -uo pipefail
set -m # job control: each background job gets its own process group (cleanup relies on this)

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi

ENGINE_DIR="${ENGINE_DIR:-$ROOT/engine/ACE-Step-1.5}"
APP_PORT="${PORT:-3000}"
ENGINE_INIT_LM_MODEL="${ENGINE_INIT_LM_MODEL:-acestep-5Hz-lm-1.7B}"

if [[ ! -d "$ENGINE_DIR/.venv" ]]; then
  echo "Engine not set up — run scripts/setup.sh first." >&2
  exit 1
fi

echo "[start] building app..."
(cd "$ROOT" && pnpm build) || exit 1

cleanup() {
  trap '' INT TERM
  echo
  echo "[start] shutting down..."
  [[ -n "${ENGINE_PID:-}" ]] && kill -TERM -- -"$ENGINE_PID" 2>/dev/null
  [[ -n "${APP_PID:-}" ]] && kill -TERM -- -"$APP_PID" 2>/dev/null
  wait 2>/dev/null
  exit 0
}
trap cleanup INT TERM

(
  cd "$ENGINE_DIR"
  unset VIRTUAL_ENV
  ACESTEP_LM_BACKEND=mlx \
    ACESTEP_LM_MODEL_PATH="$ENGINE_INIT_LM_MODEL" \
    TOKENIZERS_PARALLELISM=false \
    uv run acestep-api --host 127.0.0.1 --port 8001 2>&1 | sed 's/^/[engine] /'
) &
ENGINE_PID=$!

(
  cd "$ROOT"
  pnpm start --hostname 127.0.0.1 --port "$APP_PORT" 2>&1 | sed 's/^/[app]    /'
) &
APP_PID=$!

echo "[start] engine → http://127.0.0.1:8001  |  app → http://127.0.0.1:$APP_PORT"
wait
