# Linux / CUDA — UNTESTED

> **This document was not built or verified on Linux.** It exists so contributors on NVIDIA hardware can attempt a manual setup. Do not present these steps as tested.

## Overview

Wavesmith targets macOS + Apple Silicon. On Linux you would need:

1. **ACE-Step 1.5** — clone to `engine/ACE-Step-1.5`, checkout pin in `docs/ENGINE_NOTES.md`, run via the engine's CUDA launch path (see upstream README; not the macOS MLX path).
2. **Node 22+** and **pnpm** — `pnpm install`, `pnpm build`, bind the app to `127.0.0.1` only.
3. **Python 3.12 + uv** — engine deps and Demucs (`uv tool install` per `scripts/setup.sh`).
4. **ffmpeg** — system package.
5. **NVIDIA drivers + CUDA** — required for reasonable generation latency; CPU-only is not documented here.

## Engine

- Use the upstream CUDA inference entrypoints documented in ACE-Step 1.5 — **not** `acestep-api` with `ACESTEP_LM_BACKEND=mlx`.
- Pre-download weights with `acestep-download` inside the engine directory.
- Record any API differences in `docs/DECISIONS.md` if you get it working.

## GPU in Docker

Upstream may ship Docker assets. On Linux, `nvidia-container-toolkit` is typically required for GPU passthrough. **No docker-compose is provided in this repo** — the macOS build agent cannot verify GPU containers.

## App

```bash
cp .env.example .env
# ENGINE_URL=http://127.0.0.1:8001
./scripts/setup.sh   # may need manual fixes on Linux
./scripts/dev.sh
```

## When it works

If you succeed, please open a PR with measured generation times and exact versions — marketing numbers are not accepted in the README.
