/**
 * lib/client/api.ts — typed fetch helpers + response shapes for client
 * components. These types mirror the route handlers' JSON exactly; routes are
 * the source of truth (covered by tests/routes.test.ts).
 */

export interface JobView {
  id: string;
  type: "generate" | "stems" | "midi" | "align";
  /** Forge, Stems, MIDI, Section, or Extend. */
  label?: string;
  editKind?: "repaint" | "extend" | null;
  status: "queued" | "running" | "succeeded" | "failed";
  progress: number | null;
  stage: string | null;
  error: string | null;
  /** Set at enqueue for stems/midi jobs; set on success for generate jobs. */
  songId: string | null;
  /** Present for midi jobs while queued/running (from job payload). */
  midiSource?: "master" | "vocals" | "drums" | "bass" | "other" | null;
  result:
    | {
        songIds: string[];
        variationGroupId: string;
        parentSongId?: string;
        editKind?: "repaint" | "extend";
        demoUnchanged?: boolean;
        message?: string;
      }
    | { stemIds: string[]; songId: string }
    | { midiId: string; songId: string; source: string }
    | { songId: string; source: "aligned" | "mock" }
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
  connection?: {
    mode: "local" | "grok";
    lyricsPolicy: "standard" | "unrestricted";
    grokConfigured: boolean;
    grokKeySource: "env" | "file" | "none";
  };
  extend?: {
    model: string;
    ready: boolean;
    hint: string;
  };
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
  parentSongId?: string | null;
  editKind?: "repaint" | "extend" | null;
  lyricTimings?: {
    source: "aligned" | "mock";
    lines: Array<{
      text: string;
      startS: number;
      endS: number;
      words: Array<{ text: string; startS: number; endS: number }>;
    }>;
  } | null;
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

/** Map a dead connection to a sentence a kid can use. */
async function request(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch (err) {
    if (isAbortError(err)) throw err;
    throw new Error("Couldn't reach Wavesmith. Is it still running?");
  }
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
  const res = await request("/api/jobs", { cache: "no-store", signal });
  return (await jsonOrThrow<{ jobs: JobView[] }>(res)).jobs;
}

export async function fetchHealth(signal?: AbortSignal): Promise<HealthView> {
  const res = await request("/api/health", { cache: "no-store", signal });
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
  vocalLanguage?: string;
}

export async function forge(params: ForgeParams): Promise<{ jobId: string }> {
  const res = await request("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  return jsonOrThrow<{ jobId: string }>(res);
}

export interface LyricsResult {
  lyrics: string;
  source: "grok" | "local";
  notice: string | null;
  plan: {
    lyrics: string;
    sections: string[];
    bpm: number | null;
    keyScale: string | null;
    timeSignature: "2" | "3" | "4" | "6" | null;
    styleTags: string[];
    structure: string;
  } | null;
}

export async function generateLyrics(params: {
  prompt: string;
  tags?: string[];
  explicit?: boolean;
  language?: string;
  structureHints?: string;
}): Promise<LyricsResult> {
  const res = await request("/api/lyrics", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  return jsonOrThrow<LyricsResult>(res);
}

export async function alignLyrics(
  songId: string,
  vocalLanguage: string,
): Promise<{ jobId: string }> {
  const res = await request(`/api/songs/${songId}/align`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ vocalLanguage }),
  });
  return jsonOrThrow<{ jobId: string }>(res);
}

export async function editSong(
  songId: string,
  body: {
    action: "repaint" | "extend";
    lyrics: string;
    startS?: number;
    endS?: number;
    extendS?: number;
    sectionLabel?: string;
    vocalLanguage?: string;
  },
): Promise<{ jobId: string }> {
  const res = await request(`/api/songs/${songId}/edit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return jsonOrThrow<{ jobId: string }>(res);
}

export async function enhance(params: {
  prompt: string;
  lyrics?: string;
  durationS?: number;
  bpm?: number;
  keyScale?: string;
  timeSignature?: "2" | "3" | "4" | "6";
}): Promise<EnhanceView> {
  const res = await request("/api/enhance", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  return jsonOrThrow<EnhanceView>(res);
}

export async function fetchSongs(signal?: AbortSignal): Promise<SongView[]> {
  const res = await request("/api/songs", { cache: "no-store", signal });
  return (await jsonOrThrow<{ songs: SongView[] }>(res)).songs;
}

export async function fetchSong(id: string, signal?: AbortSignal): Promise<SongView> {
  const res = await request(`/api/songs/${id}`, { cache: "no-store", signal });
  return jsonOrThrow<SongView>(res);
}

export async function patchSong(id: string, patch: SongPatch): Promise<SongView> {
  const res = await request(`/api/songs/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  return jsonOrThrow<SongView>(res);
}

export async function deleteSong(id: string): Promise<void> {
  const res = await request(`/api/songs/${id}`, { method: "DELETE" });
  await jsonOrThrow<{ deleted: string }>(res);
}

export async function importLibrary(json: unknown): Promise<{ imported: number; missingAudio: number }> {
  const res = await request("/api/library/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(json),
  });
  return jsonOrThrow<{ imported: number; missingAudio: number }>(res);
}

export async function forgeStems(songId: string): Promise<{ jobId: string }> {
  const res = await request(`/api/songs/${songId}/stems`, { method: "POST" });
  return jsonOrThrow<{ jobId: string }>(res);
}

export async function forgeMidi(
  songId: string,
  source: "master" | "vocals" | "drums" | "bass" | "other",
): Promise<{ jobId: string }> {
  const res = await request(`/api/songs/${songId}/midi`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source }),
  });
  return jsonOrThrow<{ jobId: string }>(res);
}
