# Wavesmith — One-Shot Build Specification

**Target agent:** Claude Code (Fable 5) · **Target machine:** macOS, Apple Silicon · **Mode:** fully autonomous one-shot

> **How to use this file:** Place it in an empty directory and tell Claude Code:
> *"Read wavesmith-claude-code-spec.md and execute it completely."*

---

## 0. Agent Operating Contract

These rules govern how you work. They override habit.

1. **Build in the workspace.** Create real files, run real commands, verify real output. Never dump code into chat as the deliverable.
2. **Work milestone by milestone (§12).** Each milestone ends with its verification gate *passing* before you proceed. Commit at each milestone with a conventional commit message.
3. **Ground truth beats this spec.** Where this spec and the engine's actual documentation/behavior disagree on API mechanics, the engine wins. Record every divergence in `docs/DECISIONS.md`.
4. **Never stall, never ask.** You have full autonomy. When a decision is needed, make the call a senior engineer would make and log it in `docs/DECISIONS.md` with one line of rationale.
5. **Escape hatch protocol.** If an external dependency fails (download, install, API mismatch), do not death-spiral. Stub the failing piece behind its existing interface so the app stays runnable, log it in `docs/ESCAPE_HATCHES.md` with exactly what a human must do to finish, and move on.
6. **Honesty in artifacts.** README claims must reflect what you measured and verified on *this machine* — never upstream marketing numbers, never untested instructions presented as tested.
7. **Under time/context pressure,** follow the cut order in §13. A smaller app that works end-to-end beats a complete app that doesn't run.

---

## 1. Product

**Wavesmith** is a local-first, open-source AI music studio: a Suno-style workflow — describe a song, get full tracks with vocals, build a library, pull stems — running 100% on the user's machine. No accounts, no cloud, no telemetry. MIT licensed.

Design feel: dark, modern music-studio aesthetic. Intuitive first, powerful second — a new user should produce a song within a minute of the app being ready, without reading docs.

**This build targets macOS on Apple Silicon as the verified platform.** Linux/CUDA support is documented (not built or tested) per §11.

### 1.1 Explicit non-goals for this build (do not implement)

Cover/Repaint/Extend editing · LoRA training UI · voice-to-prompt · any external-LLM use beyond the optional lyrics writer in §6.2 · Redis or any message broker · Docker on macOS · auth/multi-user · cloud sync · sharing/community features · PWA/service worker · IndexedDB caching · FFmpeg.wasm · Howler.js · image-model cover art · Turborepo/monorepo tooling.

Several of these are designed-for-later; see §14.

---

## 2. The Engine: ACE-Step 1.5 (verified facts + your obligations)

The music engine is **ACE-Step 1.5** — `https://github.com/ace-step/ACE-Step-1.5` (MIT). Facts verified against its README as of June 2026:

- Generates full songs (vocals, lyrics, structure), 10 seconds to 10 minutes, 50+ languages, with batch generation up to 8 takes per call.
- Has a built-in LM planner (fine-tuned Qwen3) that does query rewriting, lyric generation, and metadata synthesis ("Simple Mode"). It is safety-tuned, so it may sanitize or refuse explicit lyric requests — M0 must test this, and must separately confirm that **user-supplied explicit lyrics pass through to the rendered vocals unmodified**. The optional lyrics LLM (§6.2) exists precisely for what the built-in planner declines.
- Native metadata conditioning: duration, BPM, key/scale, time signature.
- Ships an official **REST API server** (`acestep-api`, default port 8001, async task model) and a Python API. **You will use the REST API server, run natively via its macOS launch path (MLX backend). Do not use Gradio, do not write a custom PyTorch inference path.**
- May expose LRC (timestamped lyrics) generation and automatic quality scoring — verify.
- Model variants matter: the default speed/quality variant is `acestep-v15-turbo`. The `Extract` (track separation), `Lego`, and `Complete` (extend) capabilities are **only supported by `acestep-v15-base`** — which is why stems in this app use Demucs (§7) and editing features are deferred (§14).
- Model weights **auto-download on first run** (multiple GB). The app must surface this honestly (§9.1).
- Requires Python 3.11–3.12, installed via `uv`.

**Critical:** This spec deliberately does **not** specify the engine's endpoint paths, request schemas, or response shapes, because those must come from the source, not from memory. Phase 0 (§12, M0) requires you to read the engine's actual docs and record the verified contract before writing any client code. Performance on Apple Silicon is unknown until you measure it — publish measured numbers only.

---

## 3. Architecture (locked)

Two long-running processes — plus an optional third (Ollama) for uncensored lyric writing.

```
┌────────────────────────────┐      HTTP (localhost)      ┌──────────────────────────────┐
│  Wavesmith (Next.js 16)    │ ─────────────────────────▶ │  ACE-Step 1.5 REST API       │
│  UI + route handlers       │ ◀───────────────────────── │  (official server, native    │
│  + job queue + SQLite      │      async task polling     │   macOS / MLX, port 8001)    │
└────────────────────────────┘                            └──────────────────────────────┘
        │
        ├── SQLite (better-sqlite3 + Drizzle) — library, jobs, settings
        ├── ./data/audio — generated WAV/MP3 + stems on disk
        ├── child_process → demucs CLI (stems), ffmpeg (encode/zip)
        └── HTTP → Ollama (OPTIONAL, localhost:11434) — uncensored lyrics LLM (§6.2)
```

- **No separate backend service.** Next.js route handlers are the API; the queue worker is an in-process singleton (§8).
- **The engine is an external pinned dependency,** cloned to `./engine/ACE-Step-1.5` (gitignored), pinned to its most recent release tag — record tag + commit in `docs/ENGINE_NOTES.md`.
- **One audio playback owner** in the browser: a single global `HTMLAudioElement` managed by a Zustand store. wavesurfer.js v7 attaches in MediaElement mode for waveform views. No second audio engine, ever — this is how double-playback bugs are prevented.
- **Realtime feedback via polling:** TanStack Query with ~1s `refetchInterval` while any job is active. Generation completes in seconds-to-minutes; polling is robust and sufficient. (SSE is a documented post-MVP upgrade, §14.)
- **Server-side media tooling:** real `ffmpeg` (Homebrew) for MP3 encoding and stems ZIP packaging. Stems via `demucs` CLI (§7).

### 3.1 Stack (pin these majors; resolve exact versions at install time and record them in DECISIONS.md)

Next.js 16 (App Router) · React 19 · TypeScript (strict) · Node 22 LTS · pnpm · Tailwind CSS v4 · shadcn/ui · Zustand · TanStack Query v5 · wavesurfer.js v7 · Motion (the framer-motion successor) · Drizzle ORM + better-sqlite3 · zod (validate every route handler input) · Vitest + React Testing Library · Playwright (smoke only) · Ollama (optional; local lyrics LLM, §6.2) · `uv` + Python 3.12 (engine + demucs only) · ffmpeg via Homebrew.

> Rationale for resolving versions at install time: a spec that hard-pins exact versions goes stale and forces the agent to fight its own scaffolding. Pin majors, record what you actually installed.

---

## 4. Repository Layout

```
wavesmith/
├── app/                      # Next.js App Router: routes + route handlers (api/)
├── components/               # UI components (shadcn/ui based)
├── lib/
│   ├── engine/               # EngineClient interface + real adapter + mock (§6)
│   ├── lyrics/               # LyricsClient interface + Ollama adapter + mock (§6.2)
│   ├── queue/                # in-process job queue singleton (§8)
│   ├── db/                   # drizzle client, queries
│   ├── audio/                # global player store, waveform helpers
│   └── art/                  # deterministic procedural cover art (§9.4)
├── db/                       # drizzle schema + migrations
├── public/                   # static assets, bundled demo sample (§6.1)
├── data/                     # runtime: sqlite db, generated audio   [gitignored]
├── engine/                   # ACE-Step-1.5 clone                    [gitignored]
├── scripts/                  # setup.sh, dev.sh, start.sh, smoke.sh
├── docs/
│   ├── ENGINE_NOTES.md       # verified engine API contract (M0 output)
│   ├── DECISIONS.md          # every judgment call, one line each
│   ├── ESCAPE_HATCHES.md     # anything stubbed + how to finish it
│   └── LINUX_CUDA.md         # documented-not-tested Linux path (§11)
├── CLAUDE.md                 # conventions + commands for future agent sessions
├── README.md
├── .env.example              # every var commented
└── LICENSE                   # MIT
```

---

## 5. Data Model (SQLite via Drizzle — implement exactly, extend only if the engine forces it)

```ts
// songs — one row per generated take
songs {
  id: text (uuid, pk)
  title: text                    // LM-derived or user-edited
  prompt: text                   // the original user description
  lyrics: text | null
  tags: text (json array)
  bpm: integer | null
  key_scale: text | null
  time_signature: text | null
  duration_s: real | null
  seed: text | null
  model: text                    // engine DiT variant used
  variation_group_id: text       // groups takes from one Forge click
  audio_path: text               // relative to data/audio
  lrc: text | null               // timestamped lyrics if engine provides (verify in M0)
  quality_score: real | null     // if engine provides (verify in M0)
  art_seed: text                 // drives deterministic cover art
  favorite: integer (bool, default 0)
  created_at: integer (epoch ms)
}

// jobs — queue persistence; survives restarts
jobs {
  id: text (uuid, pk)
  type: text                     // 'generate' | 'stems'
  status: text                   // 'queued' | 'running' | 'succeeded' | 'failed'
  payload: text (json)           // full request params
  result: text (json) | null
  error: text | null
  progress: real | null          // 0..1 if the engine reports it (verify in M0)
  song_id: text | null           // set for stems jobs / on generate success
  created_at / started_at / finished_at: integer | null
}

// stems — one row per separated track
stems { id, song_id (fk), stem_name /* vocals|drums|bass|other */, path, created_at }

// settings — key/value
settings { key: text (pk), value: text }
```

---

## 6. Engine Client (the seam that makes everything testable)

Define a TypeScript interface **owned by this app**, then implement two adapters:

```ts
// lib/engine/types.ts — every method documented with WHY it exists
interface EngineClient {
  health(): Promise<EngineHealth>          // includes model-download / warming state if exposed
  generate(req: GenerateRequest): Promise<{ taskId: string }>
  getTask(taskId: string): Promise<EngineTaskStatus>   // status, progress?, result paths
  // Add methods only as ENGINE_NOTES.md justifies (e.g. fetching the LM's plan, model info)
}
```

- **`AceStepClient`** — the real adapter, written *only after* M0, mapping this interface onto the verified REST contract in `docs/ENGINE_NOTES.md`.
- **`MockEngineClient`** — instant canned responses using a bundled sample clip. Selected when `MOCK_ENGINE=1`.

### 6.1 Mock/demo mode (required)

`MOCK_ENGINE=1` swaps in `MockEngineClient` server-side. It powers: (a) the entire unit test suite with no engine or GPU, (b) Playwright smoke tests, (c) a documented "demo mode" so users can tour the UI before installing the engine. During M2, generate one short real clip, encode a ~10s MP3 from it, and commit it to `public/` as the mock's audio.

### 6.2 Lyrics LLM (optional): uncensored lyric writing

Wavesmith applies **no content filtering to lyrics** — explicit language and adult themes are the user's call, the same as in any DAW or text editor. Because the engine's built-in planner is safety-tuned (per §2 / M0 findings), AI lyric writing goes through a second seam:

```ts
// lib/lyrics/types.ts
interface LyricsClient {
  available(): Promise<boolean>                        // Ollama reachable + model pulled?
  generateLyrics(brief: LyricsBrief): Promise<string>  // brief: prompt, genre/mood tags,
}                                                      //   explicit flag, structure hints, language
```

- **`OllamaLyricsClient`** — talks to a user-run Ollama instance at `LYRICS_LLM_URL` (default `http://localhost:11434`), model from `LYRICS_MODEL`. **Default model: the Dolphin 3.0 8B class** — uncensored, instruction-steerable, ~5 GB, which leaves headroom beside the engine on this 32 GB machine. Verify the exact current Ollama tag at build time (likely `dolphin3:8b`) and record it. Document **Cydonia 24B** (TheDrummer; Mistral Small base, creative-writing-tuned) in the README and `.env.example` comments as the quality upgrade for ≥48 GB machines or non-concurrent use.
- **`MockLyricsClient`** — canned structured lyrics for tests and demo mode.
- **System prompt requirements:** professional songwriter persona; output *only* lyrics using the engine's verified structure-tag format from ENGINE_NOTES.md (verse/chorus markers etc.); honor genre, mood, and language from the brief; when the explicit flag is set, write explicit content plainly — no censoring, no asterisks, no refusal or disclaimer text in the output. Temperature ≈ 0.85–0.95.
- **Graceful absence:** when `available()` is false, hide the Generate Lyrics button; everything else works. Never block any flow on Ollama.
- Generated lyrics land in the Advanced lyrics editor for the user to edit, then go to the engine as **user-supplied lyrics**. If M0 shows the engine LM rewrites supplied lyrics, use whatever strict/verbatim-lyrics option the API offers and record the finding.

---

## 7. Stems: Demucs (not the engine — here's why)

ACE-Step's native track separation (`Extract`) is only supported by the `base` DiT variant, while this app defaults to `turbo` for speed and quality. Rather than load a second multi-GB model variant, stems are produced by **Demucs (`htdemucs`, 4 stems: vocals/drums/bass/other)** invoked as a CLI subprocess in a `stems` job. Demucs is variant-independent, pip/uv-installable, and verifiable on this machine.

- Install via `uv` in setup (§10). Run on CPU by default on macOS (use MPS only if you verify it works here); a song may take a few minutes — the UI must set that expectation on the button.
- Output: 4 WAVs in `data/audio/<song_id>/stems/`, rows in `stems`, plus a ZIP assembled with ffmpeg/zip for one-click download.
- **Escape clause:** if M0 proves the engine's REST API exposes separation that works with the loaded turbo model, you may use it instead of Demucs — record the choice and evidence in DECISIONS.md.

---

## 8. Job Queue (in-process, persistent, boring on purpose)

- A module-level singleton in the Next.js server process. Use the `globalThis` caching pattern so dev-mode HMR never spawns duplicate workers (same trick as a shared DB client). Initialize lazily on first API hit or via `instrumentation.ts`.
- **Concurrency 1** toward the engine (one GPU, serial generation). Stems jobs may run concurrently with generation only if you verify resource contention is acceptable; otherwise same lane.
- Jobs persist to the `jobs` table. On boot, re-enqueue anything left `queued` and mark orphaned `running` jobs `failed` with a clear error.
- A `generate` request for N variations: consult ENGINE_NOTES.md to decide one batched engine call vs. N serial calls; either way produce N `songs` rows sharing a `variation_group_id`.
- On success: write song row(s), move/normalize audio into `data/audio/`, derive title/tags/lyrics from engine output where available.

---

## 9. App Surface & UX

Four areas — **Create**, **Library**, **Song view**, **Settings** — plus a persistent mini-player. Dark theme default. Motion for transitions, skeleton loaders, designed empty states ("Forge your first song"), keyboard space = play/pause **with a focus guard** (never fires while typing in any input/textarea), visible focus rings, ARIA labels, mobile-responsive layout.

### 9.1 First-run honesty (required behavior)

A persistent status banner driven by `/api/health` with three states:

1. **Engine offline** → short instructions ("run `scripts/dev.sh`" / link to README).
2. **Engine starting / downloading models** → clear copy: *"First run downloads several GB of model weights — this happens once."* Show progress if the engine exposes it; otherwise an indeterminate state with elapsed time.
3. **Ready** → banner disappears.

The README's quickstart must state honestly: *minutes to a running app; first song after a one-time model download; generation takes ~X on this hardware* — where X is the number **you measured** in M0.

### 9.2 Create page

- Hero prompt box ("Describe the song you want…"), 6 one-click presets (e.g., chill lo-fi sunset, hyperpop banger, epic orchestral trailer, 90s boom-bap, synthwave night drive, acoustic folk ballad).
- **Simple tab:** prompt + instrumental toggle + duration + variation count (1–4, default 2). The engine's LM plans lyrics/tags/structure — say so in a tooltip.
- **Advanced tab (collapsed by default):** lyrics editor, style/tags field, BPM, key/scale, time signature, duration, seed, reference-audio upload *(include reference audio only if M0 confirms the REST API accepts it; otherwise defer to §14 and log it)*.
- **Generate Lyrics button** (Advanced tab; visible only when the lyrics LLM is available, §6.2): sends the prompt, tags, and an explicit-content toggle to the LyricsClient and inserts the result into the lyrics editor for the user to refine before forging.
- **Enhance button:** if M0 shows the LM's rewrite/plan can be fetched as a distinct step, Enhance populates the Advanced fields with the generated plan for the user to edit before forging. If the API only rewrites internally, **omit the button** (the engine still enhances under the hood) and log the decision.
- Big "Forge" button → enqueues; inline queue strip shows position/status/progress with toasts on completion ("Open in Library").

### 9.3 Library & Song view

- Grid/list toggle; cards show procedural cover art, title, tags, duration, date, quality badge (if available), favorite toggle; search + tag filter.
- Variations from one forge are visually grouped.
- Song view (route or modal): full waveform (wavesurfer), play/seek, playback speed, metadata editor, **synced lyrics** highlighting the current line when `lrc` exists (plain lyrics otherwise), downloads (WAV, MP3 via ffmpeg, Stems ZIP), Stems section (generate → progress → per-stem mini-players + ZIP), delete with confirm.
- Library export/import as JSON (metadata; audio stays on disk).

### 9.4 Procedural cover art

Deterministic from `art_seed` (hash of id+title+tags): seeded 2–3 color gradient + simple geometric overlay rendered to canvas. No image model. Same seed must always render identical art (unit-tested).

### 9.5 Mini-player & Settings

- Spotify-style fixed bottom bar: art, title, play/pause, seek, elapsed/total; persists across navigation; powered by the single global audio element.
- Settings: engine URL + live health, engine/model info (as exposed), measured generation time, "Run test generation" button, lyrics LLM controls (endpoint, model name, live status, test button), theme toggle (dark default), storage paths + disk usage, library export/import, danger zone (clear library).
- Onboarding: a skippable 4-step tour on first launch (Create → Forge → Library → Player) + `?` tooltips on every Advanced field. (Contextual pro-tip cards: post-MVP.)

### 9.6 Audio serving

Serve files from `data/audio/` through a route handler **with HTTP Range support** — seeking in the player depends on it and it's a verification gate. Validate paths against directory traversal.

---

## 10. Setup, Scripts, Config

- **`scripts/setup.sh`** — idempotent; re-running is always safe. Checks/instructs: Homebrew, Node 22, pnpm, `uv`, Python 3.12, ffmpeg. Clones the engine to `./engine/ACE-Step-1.5`, checks out the pinned release tag, runs its `uv sync`. Installs demucs via `uv`. `pnpm install`, DB migrate, copy `.env.example → .env` if absent. **Optional lyrics-LLM provisioning:** install Ollama via Homebrew if absent and pull the default lyrics model; any failure in this step is **non-fatal** (warn and continue — the feature degrades gracefully). Clear ✅/❌ output per step.
- **`scripts/dev.sh`** — starts the engine via its official macOS launch path and `next dev`, concurrently, with prefixed logs. **`scripts/start.sh`** — production build + start. Both bind the app server to `127.0.0.1` only — this is a local-first app serving a personal library and must never listen on LAN interfaces (this is also a prerequisite for the Tauri wrap, §14).
- **`scripts/smoke.sh`** — end-to-end against the *real* engine: health → short generation → poll → file exists → Range request returns 206 → row in DB. Used in M7.
- **`.env.example`** — every variable commented: `ENGINE_URL`, `ENGINE_DIR`, `DATA_DIR`, `PORT`, `MOCK_ENGINE`, `LYRICS_LLM_URL`, `LYRICS_MODEL`, plus engine config passthroughs that M0 shows matter on Apple Silicon.

---

## 11. Linux/CUDA: document, don't build

Write `docs/LINUX_CUDA.md`: manual steps for Linux + NVIDIA (engine via its CUDA launch path or its own Docker assets, nvidia-container-toolkit pointer, app via Node). Mark it **UNTESTED** prominently. Do **not** author a docker-compose for this build — Docker can't reach the GPU on this Mac, so you cannot verify it, and unverifiable infrastructure is how one-shots die. (Compose for Linux: §14.)

---

## 12. Milestones & Verification Gates (build in this order)

**M0 — Ground truth.** Clone + pin engine; read its README, macOS install doc, REST API doc, inference doc. Start it. Make one real generation via `curl`. Write `docs/ENGINE_NOTES.md`: verified endpoints + request/response schemas, async task shape, progress reporting (or absence), Simple-Mode/LM-plan mechanics, metadata params, batch behavior, reference-audio support, output formats/locations, LRC + quality-score availability, **explicit-lyrics behavior** (generate once with user-supplied profane lyrics and confirm the vocals render them unmodified; probe the built-in LM with an explicit lyric request and record whether it sanitizes or refuses; note any strict/verbatim-lyrics API option), Apple Silicon model/LM configuration chosen, measured generation time.
*Gate: a real song file exists, generated via the REST API; ENGINE_NOTES.md is complete.*

**M1 — Skeleton.** Next.js app, Tailwind/shadcn, Drizzle schema + migrations, `/api/health`, setup/dev scripts.
*Gate: `pnpm build` clean; `tsc` strict clean; `/api/health` reports engine state correctly with engine up and down.*

**M2 — Engine client + lyrics client + queue + generate API.** Engine and lyrics adapters (real + mock for each), queue singleton, `POST /api/generate`, `GET /api/jobs`, song persistence, audio serving with Range. Bundle the demo clip (§6.1).
*Gate: unit tests pass with `MOCK_ENGINE=1`; a real `curl` generate → playable file + correct rows; Range request returns 206; lyric generation verified live if Ollama is present, else via mock (log in DECISIONS).*

**M3 — Create page + queue UI.**
*Gate: full forge flow from the browser produces variations in the library; Generate Lyrics inserts editable lyrics (live or mock); Playwright smoke (mock mode) passes for the create flow.*

**M4 — Library + players + song view.** Grid/list, art, mini-player, waveform, synced lyrics (if LRC), downloads, metadata editing.
*Gate: play + seek verified on real files; library survives an app restart; Playwright smoke covers library → play.*

**M5 — Stems.** Demucs job type, stems UI, ZIP download.
*Gate: a real generated song separates into 4 playable stems + a downloadable ZIP.*

**M6 — Settings, onboarding, polish.** Settings page, tour, tooltips, empty states, skeletons, a11y + keyboard pass, responsive check.
*Gate: keyboard space-toggle works with focus guard; tour shows once and is skippable.*

**M7 — Hardening + docs.** Full test suite, `smoke.sh` against the real engine, README accuracy pass (measured numbers only), `CLAUDE.md` (architecture summary, commands, conventions), LINUX_CUDA.md, MIT LICENSE, upstream responsible-use note in README, final commit.
*Gate: Definition of Done (below) is fully checked.*

### Definition of Done

1. `scripts/setup.sh` completes idempotently on a clean run.
2. `scripts/dev.sh` boots both processes; health goes green.
3. Browser flow: prompt → Forge → playable song(s) in Library; seek works.
4. Default forge yields 2 grouped variations.
5. A forged song renders user-supplied explicit lyrics unmodified; with Ollama present, Generate Lyrics writes explicit lyrics verbatim into the editor — without it, the button hides and nothing breaks.
6. Library persists across restart; export/import round-trips.
7. Stems produce 4 playable tracks + ZIP on a real song.
8. `pnpm test` green with **no engine running**.
9. `pnpm build` + strict `tsc` clean.
10. Playwright smoke green in mock mode.
11. `scripts/smoke.sh` green against the real engine.
12. README honest and complete; CLAUDE.md, ENGINE_NOTES.md, DECISIONS.md, ESCAPE_HATCHES.md exist (the last may be empty — ideally it is).
13. Git history shows one commit per milestone.

---

## 13. Cut Order (only under pressure; cut from the top)

1. Onboarding tour modal (keep tooltips)
2. Playback speed control
3. List-view toggle (keep grid)
4. Synced-lyric highlighting (still store/display plain lyrics)
5. Library export/import
6. Procedural-art patterns (fall back to seeded solid gradients)
7. Playwright smoke (keep Vitest + smoke.sh)
8. Ollama lyric-generation UI (keep the LyricsClient seam and the manual explicit-lyrics path)

**Never cut:** the generate → library → play loop, persistence, Range-supported playback, stems, unmodified lyric passthrough to vocals, first-run honesty states, the mock engine seam.

---

## 14. Post-MVP Appendix (document in README's roadmap; do not build)

- **Cover / Repaint / Extend** — requires the `base` DiT variant; design note: per-model capability flags gate these buttons, settings allows variant switching.
- **Engine-native stem separation** as a Demucs alternative when running `base`.
- LoRA training UI (engine supports one-click LoRA upstream).
- Voice-to-prompt via local Whisper (MediaRecorder → server transcription; the browser Web Speech API is cloud-backed in Chrome and violates the local-first promise — never use it).
- Extending the lyrics-LLM seam (§6.2) to chat-style features: describe-this-song, tag suggestions, title brainstorming.
- SSE job updates replacing polling; docker-compose for Linux/CUDA; shareable links.
- **Tauri 2 desktop wrap — the committed v2 path.** Architecture: the Tauri shell supervises the Next.js server (Node sidecar) and the Python engine as child processes, points its webview at the local server, and shows the window once `/api/health` goes green; distribute as a signed + notarized DMG. The MVP is deliberately shaped for this already: env-resolved paths (`DATA_DIR` moves to `~/Library/Application Support/Wavesmith` when packaged), a readiness endpoint, and localhost-only binding. Do not move backend logic into Rust — the wrap is a supervisor, not a rewrite.

---

## 15. Code Quality Requirements

- TypeScript strict; no `any`; zod-validate every route handler input.
- **Self-documenting code with robust comments on reasoning, logic, and flow**: every non-trivial module opens with a header comment stating its role and how data flows through it; inline comments explain *why*, not *what*. Write for the next agent or human who extends this.
- All engine-touching logic behind `EngineClient`; tests never require the engine or a GPU.
- Errors are first-class UX: failed jobs show actionable messages (engine offline vs. generation failure vs. disk full), with retry where sensible.
- Naming and structure obvious enough that `CLAUDE.md` plus the tree explains the system in one screen.
