#!/usr/bin/env bash
# scripts/install.sh — one command for a Mac.
# Safe to re-run. Each step says what it is doing.
# The body is inside main and runs only from the last line, so a short download does nothing.
# The only remote script this runs is the official Homebrew installer, pinned to a commit.
#
# Homebrew pin: 7986efac25016e41eed7e471666140c06f9d97cf
# When that installer changes, look up the new commit at
# https://github.com/Homebrew/install/commits/master and update the SHA below
# in the same edit as the curl line.
set -euo pipefail

DEST=""
progress=""

# WAVESMITH_DF_BEGIN
# Available is the field before the Capacity percentage, so a filesystem name
# with a space does not shift the column. df -P keeps one line per filesystem.
free_kb_from_df() {
  awk '
    NR > 1 {
      for (i = NF; i >= 1; i--) {
        if ($i ~ /^[0-9]+%$/) {
          if (i > 1) print $(i - 1)
          exit
        }
      }
    }
  '
}
# WAVESMITH_DF_END

cleanup() {
  local status=$?
  if [[ -n "${progress:-}" && -n "${DEST:-}" && -x "$DEST/scripts/mark-setup-stopped.sh" ]]; then
    "$DEST/scripts/mark-setup-stopped.sh" "$progress" || true
  fi
  # A failed setup leaves the page up so the browser can show the next step.
  # Success closes that temporary page. The progress file stays either way.
  if [[ "$status" -eq 0 && -n "${DEST:-}" && -x "$DEST/scripts/setup-ui.sh" ]]; then
    "$DEST/scripts/setup-ui.sh" stop >/dev/null 2>&1 || true
  elif [[ "$status" -ne 0 ]]; then
    printf '   Setup did not finish. If a browser window is open, it says what to do next. Your songs stay put.\n' >&2
  fi
}

main() {
  step() { printf '\n==> %s\n' "$1"; }
  note() { printf '   %s\n' "$1"; }
  fail() { printf '❌ %s\n' "$1" >&2; exit 1; }

  trap cleanup EXIT

  if [[ "$(uname -s)" != "Darwin" ]]; then
    fail "This installer is for a Mac. On Linux, clone the repo and run scripts/setup.sh. See docs/LINUX_CUDA.md."
  fi

  step "Checking Homebrew"
  if ! command -v brew >/dev/null 2>&1; then
    if [[ -x /opt/homebrew/bin/brew ]]; then
      # shellcheck disable=SC1091
      eval "$(/opt/homebrew/bin/brew shellenv)"
    elif [[ -x /usr/local/bin/brew ]]; then
      # shellcheck disable=SC1091
      eval "$(/usr/local/bin/brew shellenv)"
    fi
  fi
  if ! command -v brew >/dev/null 2>&1; then
    step "Installing Homebrew from the official installer"
    # Pinned commit, not HEAD. See the note at the top of this file.
    local homebrew_sha="7986efac25016e41eed7e471666140c06f9d97cf"
    NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL --proto '=https' --tlsv1.2 "https://raw.githubusercontent.com/Homebrew/install/${homebrew_sha}/install.sh")"
    if [[ -x /opt/homebrew/bin/brew ]]; then
      # shellcheck disable=SC1091
      eval "$(/opt/homebrew/bin/brew shellenv)"
    elif [[ -x /usr/local/bin/brew ]]; then
      # shellcheck disable=SC1091
      eval "$(/usr/local/bin/brew shellenv)"
    fi
  fi
  command -v brew >/dev/null 2>&1 || fail "Homebrew is still missing."
  note "Homebrew $(brew --version | head -1)"

  ensure_pkg() {
    local cmd="$1"
    local pkg="$2"
    if command -v "$cmd" >/dev/null 2>&1; then
      note "$cmd is already installed"
    else
      step "Installing $pkg"
      brew install "$pkg"
    fi
  }

  prepend_node22() {
    local prefix=""
    if command -v brew >/dev/null 2>&1; then
      prefix="$(brew --prefix node@22 2>/dev/null || true)"
    fi
    if [[ -z "$prefix" || ! -d "$prefix/bin" ]]; then
      if [[ -d /opt/homebrew/opt/node@22/bin ]]; then
        prefix="/opt/homebrew/opt/node@22"
      elif [[ -d /usr/local/opt/node@22/bin ]]; then
        prefix="/usr/local/opt/node@22"
      fi
    fi
    if [[ -n "$prefix" && -d "$prefix/bin" ]]; then
      export PATH="${prefix}/bin:${PATH}"
    fi
  }

  step "Checking Node.js 22 or newer"
  if ! command -v node >/dev/null 2>&1; then
    step "Installing Node.js 22"
    brew install node@22
    prepend_node22
    if ! command -v node >/dev/null 2>&1; then
      brew link node@22 || fail "Node.js 22 installed, but the node command is still missing. Open a new Terminal window and run the installer again."
    fi
  else
    local major
    major="$(node -p 'process.versions.node.split(".")[0]')"
    if [[ "$major" -lt 22 ]]; then
      step "Installing Node.js 22 (this Mac has Node ${major}). Your other Node stays in place."
      brew install node@22
      prepend_node22
    else
      note "Node $(node --version)"
    fi
  fi
  prepend_node22
  if command -v node >/dev/null 2>&1; then
    local node_major
    node_major="$(node -p 'process.versions.node.split(".")[0]')"
    if [[ "$node_major" -lt 22 ]]; then
      fail "Wavesmith still sees Node ${node_major}. Node 22 is installed beside it. Open a new Terminal window and run the installer again."
    fi
    note "Using Node $(node --version)"
  fi

  ensure_pkg pnpm pnpm
  ensure_pkg uv uv
  ensure_pkg ffmpeg ffmpeg
  ensure_pkg git git

  if ! command -v python3.12 >/dev/null 2>&1; then
    step "Installing Python 3.12"
    brew install python@3.12
  fi
  local pyprefix
  pyprefix="$(brew --prefix python@3.12 2>/dev/null || true)"
  if [[ -n "$pyprefix" && -d "$pyprefix/bin" ]]; then
    export PATH="${pyprefix}/bin:${PATH}"
  fi
  if command -v python3.12 >/dev/null 2>&1; then
    note "$(python3.12 --version)"
  else
    note "python3.12 is not on PATH yet. uv can still fetch Python 3.12 during setup."
  fi

  if [[ -z "${WAVESMITH_HOME:-}" && -n "${BASH_SOURCE[0]:-}" && -f "${BASH_SOURCE[0]}" ]]; then
    local script_dir
    script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    if [[ -f "$script_dir/setup.sh" && -d "$(dirname "$script_dir")/.git" ]]; then
      DEST="$(cd "$script_dir/.." && pwd)"
    fi
  fi
  DEST="${DEST:-${WAVESMITH_HOME:-${HOME}/Wavesmith}}"
  local repo="${WAVESMITH_REPO:-https://github.com/siriusbontea/wave-smith.git}"

  if [[ -d "$DEST/.git" ]]; then
    step "Updating ${DEST}"
    if [[ -n "$(git -C "$DEST" status --porcelain)" ]]; then
      note "This checkout has local changes. Leaving those files as they are."
    else
      git -C "$DEST" pull --ff-only || note "Could not fast-forward. Continuing with this checkout."
    fi
  elif [[ -e "$DEST" ]]; then
    fail "${DEST} exists and is not a Wavesmith checkout. Move it aside and run the installer again."
  else
    step "Cloning Wavesmith into ${DEST}"
    git clone "$repo" "$DEST"
  fi

  local weights="$DEST/engine/ACE-Step-1.5/checkpoints/acestep-v15-turbo/model.safetensors"
  local need_gb=25
  if [[ -f "$weights" ]]; then
    need_gb=5
  fi
  local free_kb
  free_kb="$(df -Pk "$DEST" | free_kb_from_df)"
  if [[ ! "$free_kb" =~ ^[0-9]+$ ]]; then
    fail "Could not check free disk space in ${DEST}. Free about ${need_gb} GB, then run the installer again."
  fi
  local need_kb=$((need_gb * 1024 * 1024))
  if [[ "$free_kb" -lt "$need_kb" ]]; then
    local free_gb=$((free_kb / 1024 / 1024))
    fail "This Mac has about ${free_gb} GB free in ${DEST}. Wavesmith needs about ${need_gb} GB. Free some space, then run the installer again."
  fi
  note "About $((free_kb / 1024 / 1024)) GB free"

  step "Putting the wavesmith command on your PATH"
  mkdir -p "${HOME}/.local/bin"
  ln -sfn "$DEST/scripts/wavesmith" "${HOME}/.local/bin/wavesmith"
  chmod +x \
    "$DEST/scripts/wavesmith" \
    "$DEST/scripts/install.sh" \
    "$DEST/scripts/setup.sh" \
    "$DEST/scripts/setup-ui.sh" \
    "$DEST/scripts/mark-setup-stopped.sh" \
    "$DEST/scripts/wavesmith-login.sh" \
    "$DEST/scripts/build-mac-app.sh"
  local marker="# Wavesmith"
  # The profile must keep this literal so it expands in the user's later shells.
  # shellcheck disable=SC2016
  local snippet='export PATH="$HOME/.local/bin:$PATH"'
  local profile
  for profile in "${HOME}/.zprofile" "${HOME}/.bash_profile"; do
    if [[ -f "$profile" ]] && grep -q "$marker" "$profile"; then
      note "PATH already mentions Wavesmith in ${profile}"
    else
      printf '\n%s\n%s\n' "$marker" "$snippet" >>"$profile"
      note "Added ~/.local/bin to ${profile}"
    fi
  done
  export PATH="${HOME}/.local/bin:${PATH}"

  local state="${HOME}/Library/Application Support/Wavesmith"
  mkdir -p "$state"
  printf '%s\n' "$DEST" >"$state/root"

  step "Installing the app dependencies"
  if [[ ! -f "$DEST/.env" ]]; then
    cp "$DEST/.env.example" "$DEST/.env"
    note "Created .env from .env.example"
  else
    note ".env is already there and was left unchanged"
  fi
  (cd "$DEST" && pnpm install)

  step "Opening the setup screen"
  local port="${PORT:-3000}"
  mkdir -p "$DEST/data"
  progress="$DEST/data/setup-progress.json"
  node -e '
const fs = require("node:fs");
const body = {
  running: true,
  phase: "setup",
  percent: null,
  etaSeconds: null,
  message: "Installing the music engine. The first download is about 10 GB.",
  updatedAt: new Date().toISOString(),
};
fs.writeFileSync(process.argv[1], JSON.stringify(body));
' "$progress"

  if "$DEST/scripts/setup-ui.sh" start; then
    local ready=0
    local _
    for _ in $(seq 1 90); do
      if curl -fsS "http://127.0.0.1:${port}/api/health" >/dev/null 2>&1; then
        ready=1
        break
      fi
      sleep 1
    done
    if [[ "$ready" -eq 1 ]]; then
      note "Progress is on screen at http://127.0.0.1:${port}"
      open "http://127.0.0.1:${port}" || true
    else
      note "The page is not up yet. This terminal still shows each step."
    fi
  else
    note "The setup screen did not start. Setup will continue in this terminal."
  fi

  step "Downloading models and finishing setup (safe to re-run)"
  "$DEST/scripts/setup.sh"

  step "Closing the setup screen"
  "$DEST/scripts/setup-ui.sh" stop || true

  step "Building the menu bar app"
  if "$DEST/scripts/build-mac-app.sh"; then
    note "Wavesmith.app is in ~/Applications"
  else
    note "The menu bar app was not built. The wavesmith command still works."
  fi

  step "Building the production app"
  (cd "$DEST" && pnpm build)

  printf '\nWavesmith is installed.\n'
  printf 'Start it with:\n\n'
  printf '  wavesmith start\n\n'
  printf 'That opens http://127.0.0.1:3000 when the app is ready.\n'
  printf 'Open a new Terminal window if the wavesmith command is not found yet.\n'
  printf 'The menu bar app is unsigned. The first time, right-click Wavesmith in Applications, choose Open, then Open.\n'
}

main "$@"
