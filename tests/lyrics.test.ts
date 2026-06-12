/**
 * Lyrics seam tests: output hygiene (thinking-model blocks, label prefixes),
 * availability matching, and the mock's structure-tag format.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { MockLyricsClient } from "@/lib/lyrics/mock";
import { OllamaLyricsClient, cleanLyricsOutput } from "@/lib/lyrics/ollama";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("cleanLyricsOutput", () => {
  it("strips qwen3-style <think> blocks", () => {
    const raw = "<think>\nplanning the song...\n</think>\n[verse]\nReal line";
    expect(cleanLyricsOutput(raw)).toBe("[verse]\nReal line");
  });

  it("strips a Lyrics: label prefix", () => {
    expect(cleanLyricsOutput("Lyrics:\n[verse]\nHello")).toBe("[verse]\nHello");
  });

  it("leaves clean output untouched", () => {
    const clean = "[verse]\nLine one\n[chorus]\nLine two";
    expect(cleanLyricsOutput(clean)).toBe(clean);
  });

  it("handles a missing OPENING think tag (template ate it)", () => {
    expect(cleanLyricsOutput("planning the song...</think>\n[verse]\nReal line")).toBe(
      "[verse]\nReal line",
    );
  });

  it("throws on an unclosed think block (token budget hit mid-thought)", () => {
    expect(() => cleanLyricsOutput("<think>endless reasoning never closes")).toThrow(
      /truncated/i,
    );
  });

  it("throws on empty output rather than returning blank lyrics", () => {
    expect(() => cleanLyricsOutput("<think>only thoughts</think>   ")).toThrow(/empty/i);
  });
});

describe("OllamaLyricsClient.available", () => {
  function stubTags(models: string[]) {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ models: models.map((name) => ({ name })) }), {
          status: 200,
        }),
      ),
    );
  }

  it("matches the exact configured tag", async () => {
    stubTags(["qwen3:8b", "nomic-embed-text:latest"]);
    const client = new OllamaLyricsClient("http://localhost:9", "qwen3:8b");
    expect(await client.available()).toBe(true);
  });

  it("matches a bare name against :latest", async () => {
    stubTags(["dolphin3:latest"]);
    const client = new OllamaLyricsClient("http://localhost:9", "dolphin3");
    expect(await client.available()).toBe(true);
  });

  it("returns false when the model is missing or Ollama is down", async () => {
    stubTags(["other:7b"]);
    expect(
      await new OllamaLyricsClient("http://localhost:9", "qwen3:8b").available(),
    ).toBe(false);
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    expect(
      await new OllamaLyricsClient("http://localhost:9", "qwen3:8b").available(),
    ).toBe(false);
  });
});

describe("OllamaLyricsClient.generateLyrics", () => {
  it("sends the songwriter system prompt and cleans the response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            message: { content: "<think>hmm</think>\n[verse]\nGenerated line" },
          }),
          { status: 200 },
        ),
      ),
    );
    const client = new OllamaLyricsClient("http://localhost:9", "test-model");
    const lyrics = await client.generateLyrics({
      prompt: "a song about rain",
      tags: ["lofi"],
      explicit: true,
    });
    expect(lyrics).toBe("[verse]\nGenerated line");

    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.model).toBe("test-model");
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[0].content).toMatch(/songwriter/i);
    expect(body.messages[0].content).toMatch(/no censoring/i);
    expect(body.messages[1].content).toContain("a song about rain");
    expect(body.messages[1].content).toMatch(/explicit content is requested/i);
  });
});

describe("MockLyricsClient", () => {
  it("is always available and returns structure-tagged lyrics", async () => {
    const client = new MockLyricsClient();
    expect(await client.available()).toBe(true);
    const lyrics = await client.generateLyrics({ prompt: "test song" });
    expect(lyrics).toContain("[verse]");
    expect(lyrics).toContain("[chorus]");
  });
});
