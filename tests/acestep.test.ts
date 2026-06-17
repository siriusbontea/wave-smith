/**
 * AceStepClient contract tests against stubbed fetch — the parsing rules here
 * mirror docs/ENGINE_NOTES.md §3 exactly (envelope, JSON-encoded result string,
 * status ints, rich cache shape vs slim store shape, no-error failures).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { AceStepClient } from "@/lib/engine/acestep";
import { EngineLmUnavailableError, stripLmArtifacts } from "@/lib/engine/types";

const BASE = "http://127.0.0.1:9999";

function envelope(data: unknown, code = 200, error: string | null = null) {
  return { data, code, error, timestamp: Date.now(), extra: null };
}

function stubFetchOnce(body: unknown, init: { status?: number } = {}) {
  const res = new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { "Content-Type": "application/json" },
  });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(res));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AceStepClient.getTask", () => {
  const client = new AceStepClient(BASE);

  it("parses the rich cache-shape success (one element per take)", async () => {
    const resultArray = [
      {
        file: "/v1/audio?path=%2Ftmp%2Fapi_audio%2Fabc.wav",
        wave: "",
        status: 1,
        prompt: "final caption",
        lyrics: "[verse]\nfinal lyrics",
        metas: { bpm: 100, duration: 30.0, keyscale: "C# major", timesignature: "4" },
        seed_value: "42,1337",
        lm_model: "acestep-5Hz-lm-1.7B",
        dit_model: "acestep-v15-turbo",
        progress: 1.0,
        stage: "succeeded",
      },
      {
        file: "/v1/audio?path=%2Ftmp%2Fapi_audio%2Fdef.wav",
        status: 1,
        metas: {},
      },
    ];
    stubFetchOnce(
      envelope([{ task_id: "t1", status: 1, result: JSON.stringify(resultArray) }]),
    );
    const status = await client.getTask("t1");
    expect(status.state).toBe("succeeded");
    expect(status.takes).toHaveLength(2);
    expect(status.takes[0]).toMatchObject({
      fileExt: "wav",
      finalPrompt: "final caption",
      bpm: 100,
      durationS: 30,
      keyScale: "C# major",
      seed: "42", // per-take: position 0 of the batch-joined seed_value
      ditModel: "acestep-v15-turbo",
    });
    // Slim second element: rich fields null, never undefined crashes.
    expect(status.takes[1]!.finalPrompt).toBeNull();
    expect(status.takes[1]!.bpm).toBeNull();
  });

  it('treats "N/A" metadata as null (engine scrubbing rule)', async () => {
    const resultArray = [
      {
        file: "/v1/audio?path=%2Ftmp%2Fx.wav",
        status: 1,
        metas: { bpm: "N/A", duration: 30, keyscale: "N/A", timesignature: "4" },
      },
    ];
    stubFetchOnce(
      envelope([{ task_id: "t", status: 1, result: JSON.stringify(resultArray) }]),
    );
    const status = await client.getTask("t");
    expect(status.takes[0]!.bpm).toBeNull();
    expect(status.takes[0]!.keyScale).toBeNull();
    expect(status.takes[0]!.timeSignature).toBe("4");
  });

  it("reports running with progress + stage from result[0]", async () => {
    const resultArray = [
      { file: "", status: 0, progress: 0.62, stage: "Generating music (batch size: 2)..." },
    ];
    stubFetchOnce(
      envelope([{ task_id: "t", status: 0, result: JSON.stringify(resultArray) }]),
    );
    const status = await client.getTask("t");
    expect(status.state).toBe("running");
    expect(status.progress).toBeCloseTo(0.62);
    expect(status.stage).toContain("Generating");
  });

  it("maps status 2 with no error text to a synthesized failure message (ENGINE_NOTES §3)", async () => {
    const resultArray = [{ file: "", status: 2, progress: 0.0, stage: "failed" }];
    stubFetchOnce(
      envelope([
        {
          task_id: "t",
          status: 2,
          result: JSON.stringify(resultArray),
          progress_text: "RuntimeError: out of memory",
        },
      ]),
    );
    const status = await client.getTask("t");
    expect(status.state).toBe("failed");
    expect(status.error).toContain("out of memory");
  });

  it("maps status 2 with NO progress_text to the exact synthesized message", async () => {
    const resultArray = [{ file: "", status: 2, stage: "failed" }];
    stubFetchOnce(
      envelope([{ task_id: "t", status: 2, result: JSON.stringify(resultArray) }]),
    );
    const status = await client.getTask("t");
    expect(status.state).toBe("failed");
    expect(status.error).toBe("Engine generation failed");
  });

  it("surfaces the store-fallback traceback's last line when present", async () => {
    const resultArray = [
      { file: "", status: 2, stage: "failed", error: "Traceback...\nValueError: bad input" },
    ];
    stubFetchOnce(
      envelope([{ task_id: "t", status: 2, result: JSON.stringify(resultArray) }]),
    );
    const status = await client.getTask("t");
    expect(status.error).toContain("ValueError: bad input");
  });

  it("maps status 1 with zero downloadable takes to FAILED (phantom-success guard)", async () => {
    // Engine-side audio save failures report success with file:"" elements.
    const resultArray = [{ file: "", status: 1 }];
    stubFetchOnce(
      envelope([{ task_id: "t", status: 1, result: JSON.stringify(resultArray) }]),
    );
    const status = await client.getTask("t");
    expect(status.state).toBe("failed");
    expect(status.error).toContain("no audio files");
  });

  it("splits the batch-joined seed_value into per-take seeds", async () => {
    const resultArray = [
      { file: "/v1/audio?path=%2Fa.wav", status: 1, seed_value: "42,1337" },
      { file: "/v1/audio?path=%2Fb.wav", status: 1, seed_value: "42,1337" },
    ];
    stubFetchOnce(
      envelope([{ task_id: "t", status: 1, result: JSON.stringify(resultArray) }]),
    );
    const status = await client.getTask("t");
    expect(status.takes[0]!.seed).toBe("42");
    expect(status.takes[1]!.seed).toBe("1337");
  });

  it("unknown/expired task ids look queued (caller owns the timeout)", async () => {
    stubFetchOnce(envelope([{ task_id: "nope", status: 0, result: "[]" }]));
    const status = await client.getTask("nope");
    expect(status.state).toBe("queued");
    expect(status.progress).toBe(0);
  });
});

describe("AceStepClient.generate", () => {
  it("emits sample_mode + sample_query for Simple Mode requests", async () => {
    stubFetchOnce(envelope({ task_id: "t", status: "queued", queue_position: 1 }));
    const client = new AceStepClient(BASE);
    await client.generate({
      prompt: "an upbeat song about rain",
      lyrics: "",
      simpleMode: true,
      batchSize: 1,
      seeds: [1],
    });
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.sample_mode).toBe(true);
    expect(body.sample_query).toBe("an upbeat song about rain");
  });

  it("omits sample fields for normal (lyrics-supplied) requests", async () => {
    stubFetchOnce(envelope({ task_id: "t", status: "queued", queue_position: 1 }));
    const client = new AceStepClient(BASE);
    await client.generate({ prompt: "p", lyrics: "[verse]\nx", batchSize: 1, seeds: [1] });
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.sample_mode).toBeUndefined();
    expect(body.sample_query).toBeUndefined();
  });

  it("sends explicit comma-joined seeds, wav format, clamped batch", async () => {
    stubFetchOnce(envelope({ task_id: "task-9", status: "queued", queue_position: 1 }));
    const client = new AceStepClient(BASE);
    const { taskId } = await client.generate({
      prompt: "p",
      lyrics: "l",
      batchSize: 9, // clamps to 4
      seeds: [1, 2, 3, 4, 5],
      durationS: 9999, // clamps to 600
    });
    expect(taskId).toBe("task-9");
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.batch_size).toBe(4);
    expect(body.seed).toBe("1,2,3,4");
    expect(body.use_random_seed).toBe(false);
    expect(body.audio_format).toBe("wav");
    expect(body.audio_duration).toBe(600);
    expect(body.vocal_language).toBe("unknown");
  });

  it("locks vocal language when requested", async () => {
    stubFetchOnce(envelope({ task_id: "t", status: "queued", queue_position: 1 }));
    const client = new AceStepClient(BASE);
    await client.generate({
      prompt: "p",
      lyrics: "[verse]\nПривет",
      vocalLanguage: "ru",
      lockVocalLanguage: true,
      batchSize: 1,
      seeds: [1],
    });
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.vocal_language).toBe("ru");
    expect(body.use_cot_language).toBe(false);
  });

  it("defaults Simple Mode vocal language to en", async () => {
    stubFetchOnce(envelope({ task_id: "t", status: "queued", queue_position: 1 }));
    const client = new AceStepClient(BASE);
    await client.generate({
      prompt: "upbeat pop",
      lyrics: "",
      simpleMode: true,
      batchSize: 1,
      seeds: [1],
    });
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.vocal_language).toBe("en");
    expect(body.use_cot_language).toBeUndefined();
  });
});

describe("AceStepClient.enhance", () => {
  it("throws EngineLmUnavailableError on HTTP 503", async () => {
    stubFetchOnce({ detail: "LLM not initialized" }, { status: 503 });
    const client = new AceStepClient(BASE);
    await expect(client.enhance({ prompt: "p", lyrics: "" })).rejects.toBeInstanceOf(
      EngineLmUnavailableError,
    );
  });

  it("throws on HTTP-200-but-envelope-500 (LM generation failure)", async () => {
    stubFetchOnce(envelope(null, 500, "format failed"));
    const client = new AceStepClient(BASE);
    await expect(client.enhance({ prompt: "p", lyrics: "" })).rejects.toThrow(/format failed/);
  });

  it("strips LM token artifacts from the plan output (M0 finding)", async () => {
    stubFetchOnce(
      envelope({
        caption: "clean caption",
        lyrics: "line one<|audio_code_61104|> and two<|endoftext|>",
        bpm: 90,
        key_scale: "E minor",
        time_signature: "4",
        duration: 120,
        vocal_language: "en",
      }),
    );
    const client = new AceStepClient(BASE);
    const result = await client.enhance({ prompt: "p", lyrics: "" });
    expect(result.lyrics).toBe("line one and two");
  });
});

describe("AceStepClient.health", () => {
  it("maps models_initialized=false to starting", async () => {
    stubFetchOnce(
      envelope({
        status: "ok",
        models_initialized: false,
        llm_initialized: false,
        loaded_model: "acestep-v15-turbo",
      }),
    );
    const client = new AceStepClient(BASE);
    const h = await client.health();
    expect(h.state).toBe("starting");
    // loaded_model echoes config even before load — never treat as readiness.
    expect(h.loadedModel).toBe("acestep-v15-turbo");
  });

  it("maps connection failure to offline", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("fetch failed")));
    const client = new AceStepClient(BASE);
    const h = await client.health();
    expect(h.state).toBe("offline");
  });

  it("maps a hung /health (TimeoutError) to starting — the lazy-init trap", async () => {
    const timeoutErr = new DOMException("timed out", "TimeoutError");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(timeoutErr));
    const client = new AceStepClient(BASE);
    const h = await client.health();
    expect(h.state).toBe("starting");
  });
});

describe("stripLmArtifacts", () => {
  it("removes audio-code tokens and endoftext markers", () => {
    expect(stripLmArtifacts("a<|audio_code_1|>b<|audio_code_63999|>c<|endoftext|>")).toBe("abc");
    expect(stripLmArtifacts("untouched lyrics")).toBe("untouched lyrics");
  });
});
