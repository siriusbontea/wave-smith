/**
 * lib/client/api.ts — typed fetch helpers + response shapes for client
 * components. These types mirror the route handlers' JSON exactly; routes are
 * the source of truth (covered by tests/routes.test.ts).
 */

export interface JobView {
  id: string;
  type: "generate" | "stems";
  status: "queued" | "running" | "succeeded" | "failed";
  progress: number | null;
  stage: string | null;
  error: string | null;
  result: { songIds: string[]; variationGroupId: string } | null;
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

async function jsonOrThrow<T>(res: Response): Promise<T> {
  const body = (await res.json().catch(() => null)) as
    | (T & { error?: string; issues?: Array<{ path: Array<string | number>; message: string }> })
    | null;
  if (!res.ok) {
    // Surface the first zod issue so validation failures are actionable
    // ("bpm: expected number to be <=300", not just "Invalid request").
    const issue = body?.issues?.[0];
    const detail = issue ? `${issue.path.join(".")}: ${issue.message}` : body?.error;
    throw new Error(detail ?? `Request failed (${res.status})`);
  }
  return body as T;
}

export async function fetchJobs(): Promise<JobView[]> {
  const res = await fetch("/api/jobs", { cache: "no-store" });
  return (await jsonOrThrow<{ jobs: JobView[] }>(res)).jobs;
}

export async function fetchHealth(): Promise<HealthView> {
  const res = await fetch("/api/health", { cache: "no-store" });
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
