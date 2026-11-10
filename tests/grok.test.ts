/**
 * Grok hybrid lyrics: plan parsing, and the route's fallback when the key is
 * missing, the call fails, the model refuses, or unrestricted mode is on.
 * Offline local lyrics stay the default. No network.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as lyricsPOST } from "@/app/api/lyrics/route";
import { setConnectionMode, setLyricsPolicy } from "@/lib/grok/mode";
import { buildGrokMessages, parseGrokPlan, GrokRefusalError } from "@/lib/grok/plan";

function lyricsRequest(body: unknown): Request {
  return new Request("http://localhost/api/lyrics", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

afterEach(() => {
  delete process.env.XAI_API_KEY;
  setConnectionMode("local");
  setLyricsPolicy("standard");
  vi.unstubAllGlobals();
});

describe("parseGrokPlan", () => {
  it("reads a JSON plan and keeps the language request in the prompt", () => {
    const messages = buildGrokMessages({ prompt: "a lullaby", language: "es" });
    expect(messages[1]!.content).toContain("es");
    expect(messages[0]!.content).toContain("Spanish");
    const plan = parseGrokPlan(
      "```json\n" +
        JSON.stringify({
          lyrics: "[verse]\nDuerme\n[chorus]\nYa",
          sections: ["verse", "chorus"],
          bpm: 72,
          keyScale: "D major",
          timeSignature: "4/4",
          styleTags: ["lullaby"],
          structure: "verse-chorus",
        }) +
        "\n```",
    );
    expect(plan.lyrics).toContain("[chorus]");
    expect(plan.bpm).toBe(72);
    expect(plan.timeSignature).toBe("4");
    expect(plan.keyScale).toBe("D major");
  });

  it("treats a refusal as a refusal, not as lyrics", () => {
    expect(() => parseGrokPlan("I can't help with that request.")).toThrow(GrokRefusalError);
  });
});

describe("POST /api/lyrics", () => {
  it("stays local when hybrid is off, even if a key is set", async () => {
    process.env.XAI_API_KEY = "secret";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = await lyricsPOST(lyricsRequest({ prompt: "offline song" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { source: string; lyrics: string; notice: string | null };
    expect(body.source).toBe("local");
    expect(body.lyrics).toContain("[verse]");
    expect(body.notice).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses Grok in hybrid mode and passes the language", async () => {
    process.env.XAI_API_KEY = "secret";
    setConnectionMode("grok");
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  lyrics: "[verse]\nДождь\n[chorus]\nИди",
                  bpm: 90,
                  keyScale: "A minor",
                  timeSignature: "4",
                  styleTags: ["ballad"],
                  structure: "verse-chorus",
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const res = await lyricsPOST(lyricsRequest({ prompt: "rain", language: "ru" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      source: string;
      lyrics: string;
      plan: { bpm: number };
    };
    expect(body.source).toBe("grok");
    expect(body.lyrics).toContain("Дождь");
    expect(body.plan.bpm).toBe(90);
    const sent = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string) as {
      messages: Array<{ content: string }>;
    };
    expect(sent.messages.some((m) => m.content.includes("Russian"))).toBe(true);
    expect(String((fetchMock.mock.calls[0]![1] as RequestInit).headers)).not.toMatch(/secret/);
  });

  it("falls back to local lyrics when Grok refuses", async () => {
    process.env.XAI_API_KEY = "secret";
    setConnectionMode("grok");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({ choices: [{ message: { content: "I can't write that." } }] }),
          { status: 200 },
        ),
      ),
    );
    const res = await lyricsPOST(lyricsRequest({ prompt: "a frank song", explicit: true }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { source: string; notice: string; lyrics: string };
    expect(body.source).toBe("local");
    expect(body.notice).toMatch(/declined/i);
    expect(body.lyrics).toContain("[verse]");
  });

  it("does not call Grok in unrestricted mode", async () => {
    process.env.XAI_API_KEY = "secret";
    setConnectionMode("grok");
    setLyricsPolicy("unrestricted");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const res = await lyricsPOST(lyricsRequest({ prompt: "local words" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { source: string; notice: string };
    expect(body.source).toBe("local");
    expect(body.notice).toMatch(/Unrestricted/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back when hybrid is on and the key is missing", async () => {
    setConnectionMode("grok");
    const res = await lyricsPOST(lyricsRequest({ prompt: "no key" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { source: string; notice: string };
    expect(body.source).toBe("local");
    expect(body.notice).toMatch(/no API key/i);
  });
});
