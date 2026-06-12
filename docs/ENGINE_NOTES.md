# ENGINE_NOTES.md — ACE-Step 1.5 verified contract (M0 output)

**Pin:** `ace-step/ACE-Step-1.5` tag **v0.1.8**, commit `dce621408bee8c31b4fcf4811682eb9359e1bc94` (== origin HEAD at clone time, 2026-06-12). Cloned to `engine/ACE-Step-1.5` with a tag-only fetch refspec (side effect: the launcher's update-check can never find a newer origin ref, so it can't prompt or move the pin).

**How this file was produced:** 10-agent source-mapping workflow over the pinned tree (5 area readers + 5 adversarial verifiers, every claim re-derived with file:line evidence; raw outputs in `docs/m0-raw/*.json`), followed by live verification on this machine (M2 Max, 32 GB, macOS 26.5.1). Where docs and source disagreed, source won; where source and live behavior could disagree, live behavior was tested.

---

## 1. Install & launch (verified path)

- Deps: `uv sync` in the engine dir → `.venv` (1.2 GB; torch 2.10.0 arm64, mlx, transformers 4.57.6). Python constraint `>=3.11,<3.13`.
- Models: `uv run acestep-download` pre-fetches the main bundle `ACE-Step/Ace-Step1.5` → `engine/ACE-Step-1.5/checkpoints/` (~10 GB: `acestep-v15-turbo` DiT ~4.7 GB, `acestep-5Hz-lm-1.7B` ~3.4 GB, `Qwen3-Embedding-0.6B` ~1.2 GB, `vae` ~0.33 GB). **Always pre-download via this CLI** — the API server's own "is it downloaded?" check accepts any non-empty dir (`api/model_download.py:100`) and can be fooled by partial downloads; the CLI requires actual weight files.
- **Launch (what our scripts do):** bypass `start_api_server_macos.sh` and run the server directly — the launcher adds an interactive update-check prompt and a pip self-repair step, both wrong for unattended use:
  ```bash
  cd engine/ACE-Step-1.5 && \
  ACESTEP_LM_BACKEND=mlx TOKENIZERS_PARALLELISM=false \
  uv run acestep-api --host 127.0.0.1 --port 8001
  ```
- The server hard-pins `workers=1` (in-memory queue/store). Do not parallelize it.
- `--api-key` is a **silent no-op** via the console script (module imports before the flag lands in env — `api_server.py:357`). If auth is ever wanted: set `ACESTEP_API_KEY` env. For this localhost-only app we run keyless. Note even with a key, `POST /v1/chat/completions` and `GET /v1/models` are unauthenticated.
- Engine `.env` (repo root) is auto-loaded with `override=False` (real env wins).

## 2. Readiness & warm-up protocol (drives our first-run UX)

- **Lazy load is the default** (`ACESTEP_NO_INIT` defaults *true*): server boots instantly, `models_initialized:false`.
- **Trap:** lazy init on the first job runs synchronously **on the event loop** — `/health` *hangs* (doesn't error) for the whole download+load, and the job sits at `status 0, progress 0`.
- **Correct pre-warm (what our app does at startup):**
  1. `GET /health` (no auth) → `data.models_initialized === false`
  2. `POST /v1/init` with `{"init_llm": true, "lm_model_path": "acestep-5Hz-lm-1.7B"}` — runs in a thread executor, so `/health` stays responsive. **Empty-body `/v1/init` is a trap:** it loads only the DiT, marks `_initialized=true`, and the LM later lazy-loads as **0.6B** (not 1.7B) on first need.
  3. Poll `GET /health` until `models_initialized && llm_initialized`.
- **Readiness = `models_initialized` only.** `loaded_model` echoes the *configured* name (`acestep-v15-turbo`) even before anything loads. `status` is always `"ok"`.
- No download-progress endpoint exists. During warm-up the only signal is elapsed time (our UI shows indeterminate state + elapsed, per spec §9.1).
- If LM init fails once, it is **never retried** (`_llm_init_error` sticks): LM features silently degrade until `POST /v1/reinitialize` or restart. Our health check surfaces `llm_initialized` separately.

## 3. Core REST contract (the subset Wavesmith uses)

Envelope on success: `{data, code: 200, error: null, timestamp: <ms>, extra: null}`. Transport errors are FastAPI `{detail}` with real HTTP codes (400/401/415/429/503/504); **some business errors return HTTP 200 with envelope `code: 400|500`** (`/v1/init`, `/format_input`, `/v1/create_sample`) — the client must check both.

### POST /release_task — create generation job
JSON body; the fields we use (REST defaults in parens):
- `prompt` (alias `caption`) — music description. **Rewritten by the LM by default** (`use_cot_caption: true`); send `use_cot_caption: false` for verbatim captions.
- `lyrics` ("") — **passes verbatim into DiT conditioning** (see §6). Empty / `[inst]` / `[instrumental]` ⇒ instrumental.
- `sample_query` + `sample_mode` — Simple-Mode: LM invents caption/lyrics/metas from a description.
- `use_format` (false) — LM-enhance provided caption+lyrics (the async flavor of `/format_input`).
- `bpm` (null), `key_scale` ("", e.g. `"F# minor"`, 70 valid combos), `time_signature` ("", valid `"2"|"3"|"4"|"6"`), `vocal_language` ("en", 50 codes + `unknown`), `audio_duration` (null ⇒ auto; engine range 10–600 s; LM-stage tier clamp; **DiT-only path has NO upper clamp** — we clamp client-side).
- `batch_size` (**null ⇒ 2 takes**) — one call yields N takes. **No server-side max on MPS** (the VRAM batch-reduce guard is a no-op on mps) — we clamp to 1–4 client-side.
- `seed` / `use_random_seed` (true) — **reproducibility requires `use_random_seed:false` + explicit comma-separated per-take seeds**; with `use_random_seed:true` the reported `seed_value` does NOT match the seeds actually used. Wavesmith rolls its own per-take seeds.
- `audio_format` ("mp3") — `flac|mp3|opus|aac|wav|wav32`; **invalid values silently fall back to flac**. mp3 is fixed 128k/48kHz. We request `wav` masters and do our own ffmpeg mp3 encode.
- `inference_steps` (8 — correct for turbo), `guidance_scale` (7.0 — **forced to 1.0 on turbo**, irrelevant for us), `thinking` (false — LM audio-codes mode; off for MVP).
- `task_type` ("text2music") — turbo supports `text2music|repaint|cover|cover-nofsq` only.
- **Dead fields (accepted, ignored — do not surface):** `timesteps`, `lm_repetition_penalty`, `constrained_decoding`, `is_format_caption`, `use_tiled_decode`, `allow_lm_batch`.
- Response: `{task_id, status:"queued", queue_position}`. `429 {detail:"Server busy: queue is full"}` at 200 pending (also leaks an orphan "queued" store record — ignore the returned task_id on 429).
- Errors: invalid Literal values (e.g. bad `lm_backend`) surface as **HTTP 500**, not 422.

### POST /query_result — poll
Body `{task_id_list: [<id>...]}` → per task `{task_id, status: 0|1|2, result: <JSON-encoded STRING of an array>, progress_text}`.
- `status`: 0 = queued|running, 1 = succeeded, 2 = failed (or stale-running > 3600 s).
- Running: `result[0] = {progress: 0..1, stage, ...}` (updates ≥1% / stage change / 0.5 s).
- Success: **one element per take** — `{file: "/v1/audio?path=<urlencoded abs path>", prompt (final caption), lyrics (final), metas: {bpm, duration, genres, keyscale, timesignature, ...}, seed_value: "s1,s2", generation_info, lm_model, dit_model}`. Two shapes exist: the rich one comes from a 7-day disk cache; the store-fallback omits `generation_info|seed_value|lm_model|dit_model` and has a field-name bug (`prompt` always "", `lyrics` = original) — treat those fields as optional, prefer our own request params as source of truth.
- **Failure carries no error text** in the normal (cache) path — just `stage:"failed"`. `progress_text` is a process-global last-log-line (can interleave jobs); useful as a hint, not authoritative. Our jobs table stores a generic engine-failure message + `progress_text` snapshot.
- **Unknown/expired task_id ⇒ `{result:"[]", status:0}`** — indistinguishable from queued. Client must apply its own poll timeout (> `ACESTEP_GENERATION_TIMEOUT` 600 s).
- Retention: store purges finished jobs after 24 h; disk cache 7 days. **Download audio promptly** — our queue moves files into `data/audio/` on success.

### GET /v1/audio?path=… — fetch audio bytes
Path must be inside the engine's temp audio dir (else 403). Serves whole-file `FileResponse`. Our server downloads from here once and serves the library from our own disk afterward.

### GET /health — see §2. GET /v1/stats — `{jobs:{...}, queue_size, queue_maxsize, avg_job_seconds}` (rolling mean, last 50; useful for ETA display).

### GET /v1/model_inventory — variant inventory `{models:[{name, is_default, is_loaded, supported_task_types}], lm_models, ...}`. **Do not use `GET /v1/models`** — it is shadowed by an unauthenticated OpenRouter-format route. Note `supported_task_types` only reflects `is_turbo`; sft models over-report. Pure-base-only rule for extract/lego/complete.

### POST /format_input — the "Enhance" backend (synchronous)
`{prompt, lyrics, temperature: 0.85, param_obj: {duration, bpm, key, time_signature, language}}` → `{caption, lyrics, bpm, key_scale, time_signature, duration, vocal_language}`. 503 `detail:"LLM not initialized..."` when LM disabled; LM generation failures come back **HTTP 200 with envelope code 500**.

### POST /v1/create_sample — Simple-Mode plan (synchronous)
`{query, instrumental, vocal_language, temperature}` → `{caption, lyrics, bpm, keyscale, duration, timesignature, vocal_language}`. Same 503/envelope-500 semantics. **Caveat:** both sync LM endpoints lazy-init from env only — they'd attempt the `vllm` backend default if `ACESTEP_LM_BACKEND` is unset (harmless here: vllm-on-MPS auto-redirects to MLX, and our scripts always set `mlx`). Serialize Enhance calls client-side (shared LLMHandler, no queue).

### Output files
Written to `<engine>/.cache/acestep/tmp/api_audio/<uuid>.<ext>` (override root: `ACESTEP_TMPDIR`). Filename is a **deterministic SHA-256 UUID of the full params** (incl. seed + format) — identical request ⇒ identical filename (idempotency key; also why our app must copy files out rather than assume uniqueness). `raw_audio_paths` in results carries the absolute paths (same host ⇒ we can copy directly instead of HTTP download).

## 4. Status / progress model (client mapping)

| Engine | Wavesmith job |
|---|---|
| submit → `{task_id, queue_position}` | `queued` |
| poll status 0 + `result[0].progress/stage` | `running` (progress 0–1) |
| poll status 1, N elements | `succeeded` → N `songs` rows |
| poll status 2 | `failed` (no engine error text — use generic message + `progress_text` hint) |
| status 0 + `result:"[]"` beyond timeout | `failed` (expired/unknown) |

## 5. Model variants & capability matrix (why stems = Demucs)

Main bundle ships **`acestep-v15-turbo`** (default; 8 steps, no CFG). Optional: `base`/`sft` (CFG, 50 steps), `turbo-shift1/3`, `turbo-continuous`, XL 4B variants, LMs 0.6B/4B. Capabilities: turbo & sft → `text2music/cover/cover-nofsq/repaint`; **extract/lego/complete need pure `base`** — not loaded in this app (spec §7: stems via Demucs; §14 documents the variant-switch path). Per-request `model` selects among up to 3 pre-configured slots (`ACESTEP_CONFIG_PATH`/`2`/`3`); unknown names **silently fall back to primary**.

## 6. Lyrics & content policy (Definition-of-Done #5 evidence)

**Code-verified:** user-supplied `lyrics` flow verbatim `req.lyrics → GenerationParams.lyrics → dit_input_lyrics` with no rewrite/filter path (sole transform: `"# Languages\n{lang}\n\n# Lyric\n{lyrics}<|endoftext|>"` wrapper + 2048-token truncation). Opt-in rewrites only: `use_format`, `sample_mode`. Grep across the engine for moderation/refusal/profanity logic: **nothing exists**; constrained decoding is structural (yaml/BPM/duration/keyscale FSM), not lexical. The caption (not lyrics) is LM-rewritten by default via `use_cot_caption`.

**Live tests on this machine (engine running, MLX, 2026-06-12):**
- **Explicit user-supplied lyrics → render: PASSED.** 25 s punk track with heavy profanity submitted as user lyrics; job succeeded in ~35 s with no refusal/sanitization, lyrics echoed byte-verbatim in the result (`data/m0-evidence/explicit_test.wav` — human listening confirms final vocal content).
- **Built-in LM probe (`/v1/create_sample`, explicit lyric request): NO refusal, NO sanitization observed.** The 1.7B planner wrote profanity-laden lyrics on request (21.5 s). The spec's "safety-tuned, may refuse" assumption did not reproduce in M0 probes — recorded as measured behavior, not a guarantee. **Artifact warning:** LM plan lyrics can contain stray `<|audio_code_NNNNN|>` tokens — the client must strip `/<\|audio_code_\d+\|>/g` from plan output.
- `/format_input` (Enhance): works, 3.6 s — returned enriched caption + bpm/key/duration/time-signature for a 5-word prompt.

## 7. LRC + quality score: NOT in the REST API

LRC (timestamped lyrics) and PMI quality scoring exist **only in the Gradio UI layer** (`acestep/ui/gradio/...`); no REST request param, no response field, on any endpoint. **Consequences for Wavesmith:** `songs.lrc` and `songs.quality_score` stay null; synced-lyrics view falls back to plain lyrics; quality badge hidden. (Post-MVP option: port the alignment scorer, spec §14.)

## 8. Apple Silicon runtime (this machine)

- MPS detected; MLX engaged for DiT decode, VAE (chunk 512 auto on ≤36 GB), and LM (`mlx-lm`, Qwen3). PyTorch-side dtype is float32 on MPS. No offload/quantization/compile (forced off on MPS).
- Memory tier: reported ≈ 75% of 32 GB ≈ 24 GB → tier6b-ish; we pin `ACESTEP_LM_MODEL_PATH=acestep-5Hz-lm-1.7B` rather than trusting auto-pick. LM-stage duration clamp at this tier: 480 s.
- On MPS, **cover/cover-nofsq tasks unload the LM** to free memory; next LM-needing request pays re-init. (Not relevant to MVP text2music.)
- Weights in memory ≈ 9.6 GB total — comfortable beside Next.js + Demucs (and a small Ollama model if used non-concurrently).
- Env knobs that matter here: `ACESTEP_LM_BACKEND=mlx`, `ACESTEP_INIT_LLM=auto`, `ACESTEP_NO_INIT` (leave default lazy + `/v1/init` pre-warm), `ACESTEP_MLX_VAE_CHUNK`, `ACESTEP_SAVE_MEMORY`, `ACESTEP_GENERATION_TIMEOUT` (default 600 s — raise if long renders exceed it), `ACESTEP_TMPDIR`. **Do not set `ACESTEP_CHECKPOINTS_DIR`** (inconsistently honored by the API server path → double-download risk).

## 9. Measured performance (THIS machine — M2 Max 32 GB, MLX, 2026-06-12)

| Scenario | Engine-reported | Wall (submit → success) |
|---|---|---|
| Server cold boot → fully ready (`/v1/init` incl. LM 1.7B, weights on disk) | — | **44 s** (`/health` responsive throughout) |
| text2music 30 s song, **batch 2**, vocals, turbo/8 steps | 44.8 s (22.4 s/song; LM CoT 3.5 s + DiT 41.3 s) | ~73 s |
| text2music 25 s song, batch 1, vocals | — | ~35 s |
| text2music **180 s** song, batch 1, instrumental | **29.7 s** (LM 1.7 s + DiT 28.1 s) | ~45 s |
| `/format_input` (Enhance) | — | 3.6 s |
| `/v1/create_sample` (full LM plan incl. lyrics) | — | 21.5 s |

Takeaways: batch count dominates cost far more than duration; song-length scaling is mild (180 s ≈ 30 s engine time at batch 1). Progress reporting is genuinely fine-grained (~1%/tick during DiT; coarse jumps at decode 0.8 → prepare 0.99 → done). Output `wav` verified: **16-bit PCM, 48 kHz, stereo, exact requested duration** (so `wav` is a fine master; `wav32` = float32 if ever needed). Distinct seeds produced distinct audio (md5-different takes); engine echoes `seed_value` as sent.

## 10. Open items deferred to later milestones

- ~~`wav` bit depth~~ → **verified: 16-bit PCM 48 kHz stereo** (ffprobe, M0). `wav` is the master + download format; mp3 derived via our ffmpeg.
- Reference-audio upload (multipart `ref_audio`) exists at the REST layer (source-verified) — UI exposure deferred per spec §9.2; not live-tested in M0.
- Batch semantics chosen: **one engine call with `batch_size=N`** per forge (N=1–4), not N serial calls — single queue slot, per-take seeds, one `variation_group_id`.
- M0 gate evidence: `data/m0-evidence/` — `take_0.wav`/`take_1.wav` (synthwave, batch-2 distinct takes), `explicit_test.wav` (lyrics passthrough), `orchestral_180s.wav` (long render). Gitignored; listen to confirm vocal content.
