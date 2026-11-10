/**
 * lib/grok/secrets.ts — where the optional xAI key lives.
 *
 * Order: XAI_API_KEY in the environment, then a gitignored file under DATA_DIR
 * (data/xai-api-key). The key is never written to SQLite, logs, or API responses.
 */
import fs from "node:fs";
import path from "node:path";
import { env } from "@/lib/env";

export type GrokKeySource = "env" | "file" | "none";

export function grokKeyFilePath(): string {
  return path.join(env.dataDir, "xai-api-key");
}

export function readGrokApiKey(): { key: string | null; source: GrokKeySource } {
  const fromEnv = process.env.XAI_API_KEY?.trim();
  if (fromEnv) return { key: fromEnv, source: "env" };
  try {
    const file = grokKeyFilePath();
    if (!fs.existsSync(file)) return { key: null, source: "none" };
    const text = fs.readFileSync(file, "utf8").trim();
    if (!text) return { key: null, source: "none" };
    return { key: text, source: "file" };
  } catch {
    return { key: null, source: "none" };
  }
}

/** Write the key with mode 0600. Does not unset an environment variable. */
export function saveGrokApiKey(key: string): void {
  const trimmed = key.trim();
  if (!trimmed) {
    clearGrokApiKeyFile();
    return;
  }
  const file = grokKeyFilePath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${trimmed}\n`, { mode: 0o600 });
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    // chmod is best-effort; the file is still under the gitignored data dir.
  }
}

export function clearGrokApiKeyFile(): void {
  fs.rmSync(grokKeyFilePath(), { force: true });
}
