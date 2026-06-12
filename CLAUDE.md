# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Current state

This repo currently contains only `wavesmith-claude-code-spec.md` — the authoritative one-shot build specification. The application has **not been built yet**. When implementing, follow the milestone order and verification gates in §12 of the spec; that document overrides habit where they conflict. Build real files and run real commands — never deliver code in chat.

## What Wavesmith is

A local-first, open-source AI music studio (Suno-style): describe a song → get full tracks with vocals → build a library → pull stems. Runs 100% locally, no accounts/cloud/telemetry, MIT licensed. Verified platform is **macOS on Apple Silicon**; Linux/CUDA is documented-only (`docs/LINUX_CUDA.md`), never built or tested here.

## Architecture (locked — do not redesign)

Two long-running processes plus an optional third:

- **Wavesmith app** — Next.js 16 (App Router), React 19, TypeScript strict. Route handlers *are* the API; there is no separate backend service. SQLite (better-sqlite3 + Drizzle) for library/jobs/settings.
- **ACE-Step 1.5 REST API** — the music engine, run natively via its macOS/MLX launch path (default port 8001, async task model). Cloned to `./engine/ACE-Step-1.5` (gitignored), pinned to a release tag recorded in `docs/ENGINE_NOTES.md`. Use the REST server only — never Gradio, never a custom PyTorch path. Default model variant: `acestep-v15-turbo`.
- **Ollama (optional)** — local uncensored lyrics LLM at `localhost:11434` (default model Dolphin 3.0 8B class). Feature degrades gracefully when absent; never block any flow on it.

Key invariants:
- **One audio playback owner** in the browser: a single global `HTMLAudioElement` in a Zustand store; wavesurfer.js v7 attaches in MediaElement mode. Never add a second audio engine — this prevents double-playback bugs.
- **Job queue is an in-process singleton** in the Next.js server, cached on `globalThis` so HMR never spawns duplicate workers. Concurrency 1 toward the engine. Jobs persist to the `jobs` table; on boot, re-enqueue `queued` and fail orphaned `running` jobs.
- **Realtime feedback via polling** — TanStack Query with ~1s `refetchInterval` while a job is active. (SSE is post-MVP.)
- **Audio is served through a route handler with HTTP Range support** (206 responses) — seeking depends on it; validate paths against directory traversal.
- **Stems use Demucs CLI** (`htdemucs`, 4 stems), not the engine — engine separation needs the `base` variant while the app runs `turbo`.
- App server binds to `127.0.0.1` only — local-first, never LAN.

## The engine seam (why everything is testable)

All engine-touching logic lives behind the `EngineClient` interface (`lib/engine/`), with two adapters: `AceStepClient` (real, written only after M0) and `MockEngineClient` (selected by `MOCK_ENGINE=1`). Lyrics work mirrors this with `LyricsClient` (`lib/lyrics/`): `OllamaLyricsClient` + `MockLyricsClient`. **Tests must never require the engine or a GPU** — they run in mock mode.

Wavesmith applies **no content filtering to lyrics**. User-supplied explicit lyrics must pass through to the engine unmodified; the lyrics LLM seam exists precisely for content the engine's safety-tuned built-in planner declines.

## Commands

The build defines these scripts (see spec §10); resolve exact tool versions at install time and record them in `docs/DECISIONS.md`:

- `scripts/setup.sh` — idempotent setup: checks Homebrew/Node 22/pnpm/uv/Python 3.12/ffmpeg, clones+pins the engine, runs its `uv sync`, installs demucs, `pnpm install`, DB migrate, copies `.env.example`→`.env`. Optional Ollama provisioning is non-fatal.
- `scripts/dev.sh` — starts the engine + `next dev` concurrently with prefixed logs.
- `scripts/start.sh` — production build + start.
- `scripts/smoke.sh` — end-to-end against the *real* engine (M7).
- `pnpm build` — must be clean; `tsc` strict must be clean.
- `pnpm test` — Vitest + React Testing Library; **must pass with no engine running** (mock mode).
- Playwright — smoke tests only, run in mock mode.

## Conventions

- TypeScript strict, no `any`; zod-validate every route handler input.
- Every non-trivial module opens with a header comment stating its role and data flow; inline comments explain *why*, not *what*.
- Commit once per milestone (M0–M7) with conventional commit messages.
- Log every judgment call in `docs/DECISIONS.md` (one line each); stub failing external deps behind their interface and record in `docs/ESCAPE_HATCHES.md`.
- README claims must reflect numbers measured on *this machine* — never upstream marketing figures.
- Under time/context pressure, cut from the top of spec §13. Never cut: generate→library→play loop, persistence, Range playback, stems, unmodified lyric passthrough, first-run honesty states, the mock engine seam.

## Data model

Four SQLite tables via Drizzle (spec §5, implement exactly): `songs` (one row per take, grouped by `variation_group_id`), `jobs` (persistent queue), `stems` (one row per separated track), `settings` (key/value). Some fields (`lrc`, `quality_score`, `progress`) depend on engine capabilities verified in M0.
