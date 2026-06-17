/**
 * lib/client/api.ts — typed fetch helpers + response shapes for client
 * components. These types mirror the route handlers' JSON exactly; routes are
 * the source of truth (covered by tests/routes.test.ts).
 */

export interface JobView {
  id: string;
  type: "generate" | "stems" | "midi";
  status: "queued" | "running" | "succeeded" | "failed";
  progress: number | null;
  stage: string | null;
  error: string | null;
  /** Set at enqueue for stems/midi jobs; set on success for generate jobs. */
  songId: string | null;
  /** Present for midi jobs while queued/running (from job payload). */
  midiSource?: "master" | "vocals" | "drums" | "bass" | "other" | null;
  result:
    | { songIds: string[]; variationGroupId: string }
    | { stemIds: string[]; songId: string }
    | { midiId: string; songId: string; source: string }
    | null;
  createdAt: number;
  startedAt: number | null;
  finishedAt: number | null;
}

export interface HealthView {
  app: string;
  db: string;
  mockEngine: boolean;
  engine: {
    state: "offline" | "starting" | "ready";
    modelsInitialized: boolean;
    llmInitialized: boolean;
    loadedModel: string | null;
    loadedLmModel: string | null;
  };
  lyrics: { available: boolean; model: string };
}

export interface EnhanceView {
  caption: string;
  lyrics: string;
  bpm: number | null;
  keyScale: string;
  timeSignature: string;
  durationS: number | null;
  vocalLanguage: string;
}

/** Song DTO returned by /api/songs — mirrors lib/songs/queries.SongDTO. */
export interface SongView {
  id: string;
  title: string;
  prompt: string;
  lyrics: string | null;
  tags: string[];
  bpm: number | null;
  keyScale: string | null;
  timeSignature: string | null;
  durationS: number | null;
  seed: string | null;
  model: string;
  variationGroupId: string;
  audioPath: string;
  lrc: string | null;
  qualityScore: number | null;
  artSeed: string;
  favorite: boolean;
  createdAt: number;
  stems?: StemView[];
  midi?: MidiView[];
}

export interface MidiView {
  id: string;
  source: "master" | "vocals" | "drums" | "bass" | "other";
  path: string;
  createdAt: number;
}

export interface StemView {
  id: string;
  stemName: "vocals" | "drums" | "bass" | "other";
  path: string;
  createdAt: number;
}

export interface SongPatch {
  title?: string;
  lyrics?: string | null;
  tags?: string[];
  bpm?: number | null;
  keyScale?: string | null;
  timeSignature?: "2" | "3" | "4" | "6" | null;
  favorite?: boolean;
}

/** TanStack Query cancels in-flight polls; treat as benign, not a user error. */
export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

async function jsonOrThrow<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => null)) as
    | (T & { error?: string; issues?: Array<{ path: Array<string | number>; message: string }> })
    | null;
  if (!res.ok) {
    // Surface the first zod issue so validation failures are actionable
    // ("bpm: expected number to be <=300", not just "Invalid request").
    const issue = body?.issues?.[0];
    const detail = issue ? `${issue.path.join(".")}: ${issue.message}` : body?.error;
    if (res.status === 404) {
      throw new Error(
        detail ??
          "Wavesmith API not found — the app server may not be running. Start it with scripts/dev.sh (or pnpm dev).",
      );
    }
    throw new Error(detail ?? `Request failed (${res.status})`);
  }
  return body as T;
}

export async function fetchJobs(signal?: AbortSignal): Promise<JobView[]> {
  const res = await fetch("/api/jobs", { cache: "no-store", signal });
  return (await jsonOrThrow<{ jobs: JobView[] }>(res)).jobs;
}

export async function fetchHealth(signal?: AbortSignal): Promise<HealthView> {
  const res = await fetch("/api/health", { cache: "no-store", signal });
  return jsonOrThrow<HealthView>(res);
}

export interface ForgeParams {
  prompt: string;
  lyrics?: string;
  instrumental?: boolean;
  durationS?: number;
  bpm?: number;
  keyScale?: string;
  timeSignature?: "2" | "3" | "4" | "6";
  variations?: number;
  seed?: number;
}

export async function forge(params: ForgeParams): Promise<{ jobId: string }> {
  const res = await fetch("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  return jsonOrThrow<{ jobId: string }>(res);
}

export async function generateLyrics(params: {
  prompt: string;
  tags?: string[];
  explicit?: boolean;
}): Promise<string> {
  const res = await fetch("/api/lyrics", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  return (await jsonOrThrow<{ lyrics: string }>(res)).lyrics;
}

export async function enhance(params: {
  prompt: string;
  lyrics?: string;
  durationS?: number;
  bpm?: number;
  keyScale?: string;
  timeSignature?: "2" | "3" | "4" | "6";
}): Promise<EnhanceView> {
  const res = await fetch("/api/enhance", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  return jsonOrThrow<EnhanceView>(res);
}

export async function fetchSongs(signal?: AbortSignal): Promise<SongView[]> {
  const res = await fetch("/api/songs", { cache: "no-store", signal });
  return (await jsonOrThrow<{ songs: SongView[] }>(res)).songs;
}

export async function fetchSong(id: string, signal?: AbortSignal): Promise<SongView> {
  const res = await fetch(`/api/songs/${id}`, { cache: "no-store", signal });
  return jsonOrThrow<SongView>(res);
}

export async function patchSong(id: string, patch: SongPatch): Promise<SongView> {
  const res = await fetch(`/api/songs/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  return jsonOrThrow<SongView>(res);
}

export async function deleteSong(id: string): Promise<void> {
  const res = await fetch(`/api/songs/${id}`, { method: "DELETE" });
  await jsonOrThrow<{ deleted: string }>(res);
}

export async function importLibrary(json: unknown): Promise<{ imported: number; missingAudio: number }> {
  const res = await fetch("/api/library/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(json),
  });
  return jsonOrThrow<{ imported: number; missingAudio: number }>(res);
}

export async function forgeStems(songId: string): Promise<{ jobId: string }> {
  const res = await fetch(`/api/songs/${songId}/stems`, { method: "POST" });
  return jsonOrThrow<{ jobId: string }>(res);
}

export async function forgeMidi(
  songId: string,
  source: "master" | "vocals" | "drums" | "bass" | "other",
): Promise<{ jobId: string }> {
  const res = await fetch(`/api/songs/${songId}/midi`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source }),
  });
  return jsonOrThrow<{ jobId: string }>(res);
}
