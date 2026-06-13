# Wavesmith

Local-first AI music studio — describe a song, get full tracks with vocals, build a library, pull stems. Runs on your machine. No accounts, no cloud, no telemetry.

**Verified platform:** macOS on Apple Silicon (M2 class, 32 GB RAM). Linux/CUDA is [documented but untested](docs/LINUX_CUDA.md).

## Quickstart

```bash
./scripts/setup.sh   # once: toolchain, engine, models, demucs, pnpm install
./scripts/dev.sh     # engine + Next.js on http://127.0.0.1:3000
```

**Honest timing (measured on this machine, see `docs/ENGINE_NOTES.md`):**

- Minutes to a running app after setup (model weights are ~10 GB — downloaded once).
- First engine warm-up: ~44 s cold boot.
- Generation: ~22.4 s per 30 s song when forging 2 variations (batch).
- Stem separation (Demucs on CPU): a few minutes per song — the UI says so.

Tour the UI without the engine: set `MOCK_ENGINE=1` in `.env`.

## What you can do

1. **Create** — describe a song (Simple or Advanced), optional lyrics via Ollama, Forge 1–4 variations.
2. **Library** — grid/list, procedural cover art, favorites, search, export/import JSON metadata.
3. **Play** — single global player + waveform; seek works (HTTP Range on `/api/audio`).
4. **Stems** — Demucs `htdemucs` → vocals / drums / bass / other + ZIP download.
5. **Settings** — engine health, storage paths, theme, test generation.

## Scripts

| Script | Purpose |
|--------|---------|
| `scripts/setup.sh` | Idempotent environment setup |
| `scripts/dev.sh` | Engine + `next dev` with prefixed logs |
| `scripts/start.sh` | Production build + start |
| `scripts/smoke.sh` | E2E against the **real** engine (M7 gate) |

## Tests

```bash
MOCK_ENGINE=1 pnpm test          # Vitest — no GPU
MOCK_ENGINE=1 pnpm test:e2e      # Playwright smoke
```

## Architecture

- **Next.js 16** — UI + API route handlers + in-process job queue + SQLite (Drizzle).
- **ACE-Step 1.5** — music engine via REST (`engine/ACE-Step-1.5`, pinned v0.1.8).
- **Ollama (optional)** — uncensored lyrics LLM; degrades gracefully when absent.
- **Demucs** — stem separation (variant-independent; turbo model stays loaded).

See `CLAUDE.md` and `docs/ENGINE_NOTES.md` for agent/human conventions and the verified engine contract.

## Responsible use

Wavesmith wraps [ACE-Step 1.5](https://github.com/ace-step/ACE-Step-1.5) (MIT). Use generated music responsibly; respect copyright and likeness rights. The app applies **no content filtering** to user-supplied lyrics — that is intentional for a local DAW-style tool.

## Roadmap (post-MVP)

Cover/Repaint/Extend (needs `base` variant), engine-native stems, LoRA UI, voice-to-prompt, SSE job updates, Tauri desktop wrap — see spec §14 in `wavesmith-claude-code-spec.md`.

## License

MIT — see [LICENSE](LICENSE).
