/**
 * lib/env.ts — server-side environment configuration, zod-validated once at import.
 *
 * Every variable is documented in .env.example. Defaults match the local-first
 * deployment: engine on 127.0.0.1:8001, data under ./data, real engine (no mock).
 * Import this module only from server code (route handlers, lib/) — never from
 * client components.
 */
import { z } from "zod";
import path from "node:path";

const EnvSchema = z.object({
  /** Base URL of the ACE-Step REST API server. Trailing slashes are stripped —
   *  client code concatenates paths, and `//health` 404s on FastAPI. */
  ENGINE_URL: z
    .string()
    .url()
    .default("http://127.0.0.1:8001")
    .transform((u) => u.replace(/\/+$/, "")),
  /** Path to the engine checkout (used by scripts, surfaced in Settings). */
  ENGINE_DIR: z.string().default("./engine/ACE-Step-1.5"),
  /** LM the engine should load on warm-up (POST /v1/init). M0: pin 1.7B. */
  ENGINE_INIT_LM_MODEL: z.string().default("acestep-5Hz-lm-1.7B"),
  /** Runtime data root: sqlite db + generated audio live here. */
  DATA_DIR: z.string().default("./data"),
  /** Swap in MockEngineClient (tests, demo mode). "1" enables. */
  MOCK_ENGINE: z
    .string()
    .default("0")
    .transform((v) => v === "1" || v.toLowerCase() === "true"),
  /** Ollama endpoint for the optional uncensored lyrics LLM (spec §6.2). */
  LYRICS_LLM_URL: z
    .string()
    .url()
    .default("http://localhost:11434")
    .transform((u) => u.replace(/\/+$/, "")),
  /** Ollama model tag for lyric writing. */
  LYRICS_MODEL: z.string().default("dolphin3:8b"),
  /** Absolute path to the demucs CLI (optional; auto-detected from uv/Homebrew PATH). */
  DEMUCS_BIN: z.string().optional(),
  /** Absolute path to the basic-pitch CLI (optional; auto-detected like demucs). */
  BASIC_PITCH_BIN: z.string().optional(),
});

// Empty-string env vars (e.g. `ENGINE_URL=` in a .env) must mean "unset" —
// otherwise they bypass zod defaults and crash every server module at import.
const rawEnv = Object.fromEntries(
  Object.entries(process.env).filter(([, v]) => v !== ""),
);
const parsed = EnvSchema.parse(rawEnv);

export const env = {
  ...parsed,
  /** Absolute DATA_DIR (sqlite + audio paths are derived from this). */
  dataDir: path.resolve(parsed.DATA_DIR),
  /** Absolute path to the sqlite database file. */
  dbPath: path.resolve(parsed.DATA_DIR, "wavesmith.db"),
  /** Absolute path to the generated-audio directory. */
  audioDir: path.resolve(parsed.DATA_DIR, "audio"),
};
