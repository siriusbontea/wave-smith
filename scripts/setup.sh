#!/usr/bin/env bash
# scripts/setup.sh — idempotent environment setup for Wavesmith (macOS / Apple Silicon).
# Re-running is always safe: every step checks completeness (not mere existence)
# before acting, or is itself idempotent.
#
# Steps: toolchain checks → engine clone+pin → engine deps (uv sync) → model
# weights → demucs → app deps → .env → db migrate → optional Ollama notes.
# Optional steps (Ollama) are non-fatal: they warn and continue.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENGINE_TAG="v0.1.8"
ENGINE_COMMIT="dce621408bee8c31b4fcf4811682eb9359e1bc94" # M0-verified (ENGINE_NOTES.md)
ENGINE_REPO="https://github.com/ace-step/ACE-Step-1.5"
LYRICS_MODEL_DEFAULT="dolphin3:8b"

ok()   { printf '✅ %s\n' "$1"; }
fail() { printf '❌ %s\n' "$1"; exit 1; }
warn() { printf '⚠️  %s\n' "$1"; }

# ── 1. Toolchain ─────────────────────────────────────────────────────────────
command -v brew >/dev/null || fail "Homebrew missing — install from https://brew.sh"
ok "Homebrew $(brew --version | head -1 | awk '{print $2}')"

command -v node >/dev/null || fail "Node missing — brew install node (spec targets Node 22 LTS; Node 26 verified working)"
ok "Node $(node --version)"

command -v pnpm >/dev/null || fail "pnpm missing — brew install pnpm"
ok "pnpm $(pnpm --version)"

if ! command -v uv >/dev/null; then
  echo "Installing uv..."
  brew install uv || fail "uv install failed"
fi
ok "uv $(uv --version | awk '{print $2}')"

command -v ffmpeg >/dev/null || { echo "Installing ffmpeg..."; brew install ffmpeg || fail "ffmpeg install failed"; }
ok "ffmpeg $(ffmpeg -version 2>/dev/null | head -1 | awk '{print $3}')"

# ── 2. .env (early: later steps read DATA_DIR / ENGINE_DIR from it) ──────────
if [[ ! -f "$ROOT/.env" ]]; then
  cp "$ROOT/.env.example" "$ROOT/.env"
  ok ".env created from .env.example"
else
  ok ".env present"
fi
set -a
# shellcheck disable=SC1091
source "$ROOT/.env"
set +a
ENGINE_DIR="${ENGINE_DIR:-$ROOT/engine/ACE-Step-1.5}"

# ── 3. Engine: clone + pin ───────────────────────────────────────────────────
if [[ ! -d "$ENGINE_DIR/.git" ]]; then
  echo "Cloning engine ($ENGINE_TAG)..."
  git clone --branch "$ENGINE_TAG" --depth 1 "$ENGINE_REPO" "$ENGINE_DIR" || fail "engine clone failed"
fi
PINNED="$(git -C "$ENGINE_DIR" describe --tags 2>/dev/null || echo unknown)"
ACTUAL_COMMIT="$(git -C "$ENGINE_DIR" rev-parse HEAD 2>/dev/null || echo unknown)"
[[ "$PINNED" == "$ENGINE_TAG" ]] || warn "engine at '$PINNED', expected $ENGINE_TAG"
[[ "$ACTUAL_COMMIT" == "$ENGINE_COMMIT" ]] || \
  warn "engine commit $ACTUAL_COMMIT drifted from M0-verified $ENGINE_COMMIT — the verified contract in docs/ENGINE_NOTES.md may not apply"
ok "Engine pinned at $PINNED ($ACTUAL_COMMIT)"

# ── 4. Engine deps (uv sync is itself the idempotent check: ~1 s when satisfied) ──
[[ -d "$ENGINE_DIR/.venv" ]] || echo "Installing engine dependencies (uv sync — several minutes, ~1.2 GB)..."
(cd "$ENGINE_DIR" && unset VIRTUAL_ENV && uv sync) || fail "uv sync failed"
ok "Engine deps in sync"

# ── 5. Model weights (~9.4 GB on first run) ──────────────────────────────────
WEIGHTS_OK=1
for f in "acestep-v15-turbo/model.safetensors" "acestep-5Hz-lm-1.7B/model.safetensors" \
         "Qwen3-Embedding-0.6B/model.safetensors" "vae/diffusion_pytorch_model.safetensors"; do
  [[ -f "$ENGINE_DIR/checkpoints/$f" ]] || WEIGHTS_OK=0
done
if [[ $WEIGHTS_OK -eq 0 ]]; then
  echo "Downloading model weights (~10 GB, one time — this is the long step)..."
  (cd "$ENGINE_DIR" && unset VIRTUAL_ENV && uv run acestep-download) || \
    fail "model download failed — if it stalls, see the direct-download fallback in docs/DECISIONS.md"
fi
ok "Model weights present"

# ── 6. Demucs (stems, M5) — pinned: demucs 4.0.1 needs torchaudio<2.9 (load/save APIs) ──
if ! demucs --help >/dev/null 2>&1; then
  echo "Installing demucs (pinned, Python 3.12 + soundfile for WAV I/O)..."
  uv tool install --python 3.12 --with "torchaudio<2.9" --with soundfile demucs==4.0.1 || \
    warn "demucs install failed — stems will be unavailable until installed"
fi
# Re-run with --force when demucs exists but lacks soundfile (torchaudio save fails on macOS).
if demucs --help >/dev/null 2>&1; then
  DEMUCS_PY="${HOME}/.local/share/uv/tools/demucs/bin/python3.12"
  if [[ -x "$DEMUCS_PY" ]] && ! "$DEMUCS_PY" -c "import soundfile" >/dev/null 2>&1; then
    echo "Upgrading demucs tool env (adding soundfile)..."
    uv tool install --force --python 3.12 --with "torchaudio<2.9" --with soundfile demucs==4.0.1 || \
      warn "demucs soundfile upgrade failed"
  fi
fi
if demucs --help >/dev/null 2>&1; then ok "demucs available"; else warn "demucs not available (stems disabled)"; fi

# ── 6b. Basic Pitch (approximate MIDI transcription) ──
if ! basic-pitch --help >/dev/null 2>&1; then
  echo "Installing basic-pitch (ONNX backend, pinned scipy/setuptools)..."
  uv tool install --python 3.12 --with "setuptools<81" --with onnxruntime --with "scipy==1.11.4" "basic-pitch[onnx]" || \
    warn "basic-pitch install failed — MIDI export disabled until installed"
fi
if basic-pitch --help >/dev/null 2>&1; then
  BP_PY="${HOME}/.local/share/uv/tools/basic-pitch/bin/python3.12"
  if [[ -x "$BP_PY" ]] && ! "$BP_PY" -c "import onnxruntime, scipy.signal; assert hasattr(scipy.signal,'gaussian')" >/dev/null 2>&1; then
    echo "Upgrading basic-pitch tool env (ONNX + scipy pin)..."
    uv tool install --force --python 3.12 --with "setuptools<81" --with onnxruntime --with "scipy==1.11.4" "basic-pitch[onnx]" || \
      warn "basic-pitch upgrade failed"
  fi
  ok "basic-pitch available"
else
  warn "basic-pitch not available (MIDI disabled)"
fi

# ── 7. App deps + database ───────────────────────────────────────────────────
(cd "$ROOT" && pnpm install) || fail "pnpm install failed"
ok "App dependencies installed"

# DATA_DIR may be relative (resolved against the repo root, matching drizzle-kit).
(cd "$ROOT" && mkdir -p "${DATA_DIR:-./data}")
MIGRATE_OUT="$( (cd "$ROOT" && pnpm db:migrate) 2>&1 )" || {
  printf '%s\n' "$MIGRATE_OUT"
  fail "db migrate failed"
}
ok "Database migrated"

# ── 8. Optional: Ollama lyrics LLM (non-fatal; instructions only) ────────────
# Deliberately does NOT install Ollama or pull ~5 GB unprompted (DECISIONS.md).
if ! command -v ollama >/dev/null; then
  warn "Ollama not installed — skipping lyrics LLM (optional). brew install ollama to enable."
else
  if ollama list >/dev/null 2>&1; then
    LYRICS_MODEL_WANTED="${LYRICS_MODEL:-$LYRICS_MODEL_DEFAULT}"
    if ollama list 2>/dev/null | awk '{print $1}' | grep -q "^${LYRICS_MODEL_WANTED}$"; then
      ok "Ollama + $LYRICS_MODEL_WANTED ready"
    else
      warn "Lyrics model $LYRICS_MODEL_WANTED not pulled."
      warn "Either run: ollama pull $LYRICS_MODEL_WANTED"
      warn "or point LYRICS_MODEL in .env at a model you already have (ollama list)."
    fi
  else
    warn "Ollama installed but not running — start it to enable the lyrics LLM."
  fi
fi

echo
ok "Setup complete. Run scripts/dev.sh to start Wavesmith."
