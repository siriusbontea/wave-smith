/**
 * lib/grok/client.ts — optional xAI chat call for lyrics and a song plan.
 *
 * Audio generation never goes through this client. Offline, a missing key,
 * an HTTP error, or a refusal are thrown so the lyrics route can fall back
 * to the local LyricsClient. Unrestricted mode does not construct a call.
 */
import { env } from "@/lib/env";
import type { LyricsBrief } from "@/lib/lyrics/types";
import { buildGrokMessages, GrokUnconfiguredError, parseGrokPlan, type SongPlan } from "./plan";
import { readGrokApiKey } from "./secrets";

export class GrokClient {
  constructor(
    private readonly baseUrl: string = env.XAI_API_BASE,
    private readonly model: string = env.XAI_MODEL,
  ) {}

  configured(): boolean {
    return readGrokApiKey().key != null;
  }

  async planLyrics(brief: LyricsBrief): Promise<SongPlan> {
    const key = readGrokApiKey().key;
    if (!key) throw new GrokUnconfiguredError();

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model: this.model,
          temperature: 0.85,
          messages: buildGrokMessages(brief),
        }),
        signal: AbortSignal.timeout(60_000),
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : "network error";
      throw new Error(`Couldn't reach Grok (${reason})`);
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(`Grok HTTP ${res.status}: ${detail.slice(0, 200)}`);
    }

    const body = (await res.json()) as {
      choices?: Array<{ message?: { content?: string | null } }>;
    };
    const content = body.choices?.[0]?.message?.content ?? "";
    return parseGrokPlan(content);
  }
}
