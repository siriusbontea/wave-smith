#!/usr/bin/env bash
# scripts/install.sh — one command for a Mac.
# Safe to re-run. Each step says what it is doing.
# The only remote script this pipes is the official Homebrew installer.
set -euo pipefail

step() { printf '\n==> %s\n' "$1"; }
note() { printf '   %s\n' "$1"; }
fail() { printf '❌ %s\n' "$1" >&2; exit 1; }

DEST=""
cleanup() {
  if [[ -n "${DEST:-}" && -x "$DEST/scripts/setup-ui.sh" ]]; then
    "$DEST/scripts/setup-ui.sh" stop >/dev/null 2>&1 || true
  fi
}
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
  NONINTERACTIVE=1 /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
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

step "Checking Node.js 22 or newer"
if ! command -v node >/dev/null 2>&1; then
  step "Installing Node.js 22"
  brew install node@22
  brew link --overwrite --force node@22
else
  major="$(node -p 'process.versions.node.split(".")[0]')"
  if [[ "$major" -lt 22 ]]; then
    step "Installing Node.js 22 (this Mac has Node ${major})"
    brew install node@22
    brew link --overwrite --force node@22
  else
    note "Node $(node --version)"
  fi
fi

ensure_pkg pnpm pnpm
ensure_pkg uv uv
ensure_pkg ffmpeg ffmpeg
ensure_pkg git git

if ! command -v python3.12 >/dev/null 2>&1; then
  step "Installing Python 3.12"
  brew install python@3.12
fi
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
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  if [[ -f "$script_dir/setup.sh" && -d "$(dirname "$script_dir")/.git" ]]; then
    DEST="$(cd "$script_dir/.." && pwd)"
  fi
fi
DEST="${DEST:-${WAVESMITH_HOME:-${HOME}/Wavesmith}}"
repo="${WAVESMITH_REPO:-https://github.com/siriusbontea/wave-smith.git}"

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

step "Putting the wavesmith command on your PATH"
mkdir -p "${HOME}/.local/bin"
ln -sfn "$DEST/scripts/wavesmith" "${HOME}/.local/bin/wavesmith"
chmod +x \
  "$DEST/scripts/wavesmith" \
  "$DEST/scripts/install.sh" \
  "$DEST/scripts/setup.sh" \
  "$DEST/scripts/setup-ui.sh" \
  "$DEST/scripts/wavesmith-login.sh" \
  "$DEST/scripts/build-mac-app.sh"
marker="# Wavesmith"
# The profile must keep this literal so it expands in the user's later shells.
# shellcheck disable=SC2016
snippet='export PATH="$HOME/.local/bin:$PATH"'
for profile in "${HOME}/.zprofile" "${HOME}/.bash_profile"; do
  if [[ -f "$profile" ]] && grep -q "$marker" "$profile"; then
    note "PATH already mentions Wavesmith in ${profile}"
  else
    printf '\n%s\n%s\n' "$marker" "$snippet" >>"$profile"
    note "Added ~/.local/bin to ${profile}"
  fi
done
export PATH="${HOME}/.local/bin:${PATH}"

state="${HOME}/Library/Application Support/Wavesmith"
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
port="${PORT:-3000}"
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
  ready=0
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
