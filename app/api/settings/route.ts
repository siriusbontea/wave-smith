/**
 * GET  /api/settings — read app settings + storage stats.
 * PATCH /api/settings — update user preferences (theme, onboarding flag).
 */
import fs from "node:fs";
import { NextResponse } from "next/server";
import { z } from "zod";
import { env } from "@/lib/env";
import {
  getConnectionMode,
  getLyricsPolicy,
  setConnectionMode,
  setLyricsPolicy,
} from "@/lib/grok/mode";
import { clearGrokApiKeyFile, readGrokApiKey, saveGrokApiKey } from "@/lib/grok/secrets";
import { listSettings, setSetting } from "@/lib/settings/queries";
import { getEngineClient } from "@/lib/engine";
import { BASE_DIT_MODEL, baseModelOnDisk } from "@/lib/engine/base-model";
import { getLyricsClient } from "@/lib/lyrics";
import { authorizeWrite, classifyRequest, rejectedResponse } from "@/lib/phone/access";

export const dynamic = "force-dynamic";

function dirSizeBytes(dir: string): number {
  let total = 0;
  if (!fs.existsSync(dir)) return 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = `${dir}/${entry.name}`;
    if (entry.isDirectory()) total += dirSizeBytes(p);
    else total += fs.statSync(p).size;
  }
  return total;
}

export async function GET(req: Request) {
  const kind = classifyRequest(req);
  const denied = rejectedResponse(kind);
  if (denied) return denied;
  const viaPhone = kind === "phone";
  const engine = await getEngineClient()
    .health()
    .catch(() => ({
      state: "offline" as const,
      modelsInitialized: false,
      llmInitialized: false,
      loadedModel: null,
      loadedLmModel: null,
    }));
  const lyricsAvailable = await getLyricsClient().available().catch(() => false);
  const settings = listSettings();
  const grokKey = readGrokApiKey();
  return NextResponse.json({
    settings,
    client: viaPhone ? "phone" : "mac",
    connection: {
      mode: getConnectionMode(),
      lyricsPolicy: getLyricsPolicy(),
      grokConfigured: grokKey.key != null,
      grokKeySource: grokKey.source,
      grokModel: env.XAI_MODEL,
    },
    paths: viaPhone
      ? null
      : {
          dataDir: env.dataDir,
          audioDir: env.audioDir,
          engineDir: env.ENGINE_DIR,
        },
    storage: {
      audioBytes: dirSizeBytes(env.audioDir),
      dbBytes: fs.existsSync(env.dbPath) ? fs.statSync(env.dbPath).size : 0,
    },
    engine,
    lyrics: { available: lyricsAvailable, model: env.LYRICS_MODEL },
    mockEngine: env.MOCK_ENGINE,
    extend: {
      model: BASE_DIT_MODEL,
      ready: env.MOCK_ENGINE || baseModelOnDisk(),
    },
    // Null until this computer has a measured forge. README numbers are from one Mac.
    measuredGenerationS: null as number | null,
  });
}

const PatchSchema = z
  .object({
    theme: z.enum(["dark", "light", "system"]).optional(),
    onboardingComplete: z.boolean().optional(),
    connectionMode: z.enum(["local", "grok"]).optional(),
    lyricsPolicy: z.enum(["standard", "unrestricted"]).optional(),
    /** Stored only in the gitignored data dir. Empty string clears the file. */
    xaiApiKey: z.string().max(500).optional(),
    clearXaiApiKey: z.boolean().optional(),
  })
  .strict();

export async function PATCH(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Malformed JSON body" }, { status: 400 });
  }
  const parsed = PatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", issues: parsed.error.issues }, { status: 400 });
  }
  const kind = classifyRequest(req);
  const write = authorizeWrite(req, kind);
  if (!write.ok) return NextResponse.json({ error: write.error }, { status: write.status });
  if (kind === "phone") {
    return NextResponse.json(
      { error: "Change this on the computer. A phone cannot switch on Grok or edit these settings." },
      { status: 403 },
    );
  }
  if (parsed.data.theme !== undefined) setSetting("theme", parsed.data.theme);
  if (parsed.data.onboardingComplete !== undefined) {
    setSetting("onboarding_complete", parsed.data.onboardingComplete ? "1" : "0");
  }
  if (parsed.data.connectionMode !== undefined) setConnectionMode(parsed.data.connectionMode);
  if (parsed.data.lyricsPolicy !== undefined) setLyricsPolicy(parsed.data.lyricsPolicy);
  if (parsed.data.clearXaiApiKey) clearGrokApiKeyFile();
  if (parsed.data.xaiApiKey !== undefined) saveGrokApiKey(parsed.data.xaiApiKey);
  return NextResponse.json({ ok: true });
}
