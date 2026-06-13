/**
 * components/create/create-form.tsx — the Create page form (spec §9.2).
 *
 * Two tabs share one form state:
 *   Simple   — prompt, instrumental, duration, variations. The engine's LM
 *              plans lyrics/tags/structure under the hood (tooltip says so).
 *   Advanced — lyrics editor (+ Generate Lyrics via the local LLM when
 *              available, + Enhance via the engine LM), style tags, BPM,
 *              key/scale, time signature, seed.
 *
 * Forge → POST /api/generate → the QueueStrip below tracks progress.
 * Style tags have no engine field (M0): they're appended to the prompt.
 */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  enhance,
  fetchHealth,
  forge,
  generateLyrics,
  type ForgeParams,
} from "@/lib/client/api";

/** Six one-click presets (spec §9.2). */
const PRESETS = [
  { label: "Chill lo-fi sunset", prompt: "chill lo-fi hip hop, warm dusty samples, mellow sunset mood, soft vinyl crackle" },
  { label: "Hyperpop banger", prompt: "hyperpop banger, glitchy synths, pitched vocals, explosive drops, frenetic energy" },
  { label: "Epic orchestral trailer", prompt: "epic orchestral trailer music, soaring strings, thunderous percussion, brass swells, cinematic" },
  { label: "90s boom-bap", prompt: "90s boom-bap hip hop, dusty drum breaks, jazzy piano loop, head-nodding groove" },
  { label: "Synthwave night drive", prompt: "dreamy synthwave night drive, analog synths, steady beat, retro 80s atmosphere" },
  { label: "Acoustic folk ballad", prompt: "acoustic folk ballad, warm fingerpicked guitar, gentle voice, intimate and tender" },
] as const;

const DURATIONS = [
  { value: "auto", label: "Auto" },
  { value: "30", label: "30 seconds" },
  { value: "60", label: "1 minute" },
  { value: "120", label: "2 minutes" },
  { value: "180", label: "3 minutes" },
  { value: "300", label: "5 minutes" },
] as const;

/** Selectable keys: note × ASCII accidental × mode (42 entries). The engine's
 *  full vocabulary also accepts Unicode ♯/♭ (70 total, M0) — plans coming back
 *  from the LM are normalized to ASCII so they always match this list. */
const KEY_SCALES = (() => {
  const notes = ["A", "B", "C", "D", "E", "F", "G"];
  const accidentals = ["", "#", "b"];
  const out: string[] = [];
  for (const n of notes) for (const a of accidentals) for (const m of ["major", "minor"]) out.push(`${n}${a} ${m}`);
  return out;
})();

/** "E♭ major" → "Eb major" (the engine LM emits Unicode accidentals, M0). */
function normalizeKeyScale(k: string): string {
  return k.replace("♯", "#").replace("♭", "b");
}

/** Clamp helpers: never let free-text input or LM plans 400 the strict API. */
function clampInt(raw: string | number, min: number, max: number): number | undefined {
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n)) return undefined;
  return Math.min(max, Math.max(min, n));
}

export function CreateForm() {
  const queryClient = useQueryClient();
  const { data: health, isError: healthError } = useQuery({
    queryKey: ["health"],
    queryFn: fetchHealth,
    refetchInterval: 3000,
    retry: 2,
  });

  // Shared form state (both tabs read/write the same forge payload).
  const [prompt, setPrompt] = useState("");
  const [instrumental, setInstrumental] = useState(false);
  const [duration, setDuration] = useState<string>("auto");
  const [variations, setVariations] = useState(2);
  const [lyrics, setLyrics] = useState("");
  const [styleTags, setStyleTags] = useState("");
  const [bpm, setBpm] = useState("");
  const [keyScale, setKeyScale] = useState<string>("auto");
  const [timeSignature, setTimeSignature] = useState<string>("auto");
  const [seed, setSeed] = useState("");
  const [explicitLyrics, setExplicitLyrics] = useState(false);

  const forgeMutation = useMutation({
    mutationFn: forge,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["jobs"] });
      toast("Forging…", { description: "Track progress in the queue below." });
    },
    onError: (err) => toast.error("Couldn't start the forge", { description: err.message }),
  });

  const lyricsMutation = useMutation({
    mutationFn: generateLyrics,
    onSuccess: (text) => setLyrics(text),
    onError: (err) => toast.error("Lyric generation failed", { description: err.message }),
  });

  const enhanceMutation = useMutation({
    mutationFn: enhance,
    onSuccess: (plan) => {
      // Populate the Advanced fields with the LM's plan for editing (spec §9.2)
      // — but never clobber values the user already chose: only fill fields
      // that are still on auto/empty.
      setPrompt(plan.caption || prompt);
      if (!instrumental && plan.lyrics) setLyrics(plan.lyrics);
      if (!bpm.trim() && plan.bpm) {
        const clamped = clampInt(plan.bpm, 30, 300);
        if (clamped !== undefined) setBpm(String(clamped));
      }
      if (keyScale === "auto" && plan.keyScale) {
        const normalized = normalizeKeyScale(plan.keyScale);
        if (KEY_SCALES.includes(normalized)) setKeyScale(normalized);
      }
      if (timeSignature === "auto" && ["2", "3", "4", "6"].includes(plan.timeSignature)) {
        setTimeSignature(plan.timeSignature);
      }
      if (duration === "auto" && plan.durationS) {
        setDuration(String(nearestDuration(plan.durationS)));
      }
      toast("Enhanced", { description: "The plan is in the fields — edit anything, then Forge." });
    },
    onError: (err) => toast.error("Enhance failed", { description: err.message }),
  });

  function buildParams(): ForgeParams {
    // Normalize everything the strict server schema would reject: free-text
    // numbers get rounded+clamped, the combined prompt is capped at 2000.
    const fullPrompt = (
      styleTags.trim() ? `${prompt.trim()}, ${styleTags.trim()}` : prompt.trim()
    ).slice(0, 2000);
    const params: ForgeParams = { prompt: fullPrompt, instrumental, variations };
    if (!instrumental && lyrics.trim()) params.lyrics = lyrics.slice(0, 10_000);
    if (duration !== "auto") params.durationS = Number(duration);
    if (bpm.trim()) {
      const v = clampInt(bpm, 30, 300);
      if (v !== undefined) params.bpm = v;
    }
    if (keyScale !== "auto") params.keyScale = keyScale;
    if (timeSignature !== "auto") params.timeSignature = timeSignature as ForgeParams["timeSignature"];
    if (seed.trim()) {
      const v = clampInt(seed, 0, 0xffffffff);
      if (v !== undefined) params.seed = v;
    }
    return params;
  }

  const canForge = prompt.trim().length > 0 && !forgeMutation.isPending && !healthError;
  const lyricsAvailable = health?.lyrics.available ?? false;
  // Enhance needs the engine LM specifically — a "ready" engine whose LM init
  // failed would 503 forever (ENGINE_NOTES §2: LM init is never retried).
  const enhanceReady =
    health?.mockEngine ||
    (health?.engine.state === "ready" && health.engine.llmInitialized);

  return (
    <div className="flex w-full max-w-2xl flex-col gap-6">
      {/* Hero prompt */}
      <Textarea
        data-testid="prompt-input"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="Describe the song you want…"
        rows={3}
        className="resize-none text-base"
      />

      {/* Presets */}
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <Button
            key={p.label}
            variant="secondary"
            size="sm"
            data-testid="preset"
            onClick={() => setPrompt(p.prompt)}
          >
            {p.label}
          </Button>
        ))}
      </div>

      <Tabs defaultValue="simple">
        <TabsList>
          <TabsTrigger value="simple">Simple</TabsTrigger>
          <TabsTrigger value="advanced" data-testid="advanced-tab">Advanced</TabsTrigger>
        </TabsList>

        {/* ── Simple ── */}
        <TabsContent value="simple" className="flex flex-col gap-4 pt-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="flex items-center gap-2">
                <Switch id="instrumental" checked={instrumental} onCheckedChange={setInstrumental} />
                <Label htmlFor="instrumental">Instrumental</Label>
              </div>
            </TooltipTrigger>
            <TooltipContent>
              Leave off for vocals — the engine writes lyrics and structure for you.
            </TooltipContent>
          </Tooltip>
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="duration-simple">Duration</Label>
              <Select value={duration} onValueChange={setDuration}>
                <SelectTrigger id="duration-simple"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DURATIONS.map((d) => (
                    <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label id="variations-label-simple">Variations</Label>
              <div className="flex gap-1" role="group" aria-labelledby="variations-label-simple">
                {[1, 2, 3, 4].map((n) => (
                  <Button
                    key={n}
                    variant={variations === n ? "default" : "outline"}
                    size="sm"
                    className="flex-1"
                    aria-pressed={variations === n}
                    onClick={() => setVariations(n)}
                  >
                    {n}
                  </Button>
                ))}
              </div>
            </div>
          </div>
        </TabsContent>

        {/* ── Advanced ── */}
        <TabsContent value="advanced" className="flex flex-col gap-4 pt-2">
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="lyrics">Lyrics</Label>
              <div className="flex items-center gap-3">
                {lyricsAvailable && (
                  <>
                    <div className="flex items-center gap-1.5">
                      <Switch id="explicit" checked={explicitLyrics} onCheckedChange={setExplicitLyrics} />
                      <Label htmlFor="explicit" className="text-xs text-muted-foreground">Explicit</Label>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      data-testid="generate-lyrics"
                      // Mutually exclusive with Enhance: both write the lyrics
                      // editor and both drive an LM on shared machine resources.
                      disabled={!prompt.trim() || lyricsMutation.isPending || enhanceMutation.isPending}
                      onClick={() =>
                        lyricsMutation.mutate({
                          prompt,
                          // Clamp to the route schema (≤10 tags, ≤40 chars each).
                          tags: styleTags
                            ? styleTags
                                .split(",")
                                .map((t) => t.trim().slice(0, 40))
                                .filter(Boolean)
                                .slice(0, 10)
                            : [],
                          explicit: explicitLyrics,
                        })
                      }
                    >
                      {lyricsMutation.isPending ? "Writing…" : "Generate Lyrics"}
                    </Button>
                  </>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  data-testid="enhance"
                  disabled={
                    !prompt.trim() || !enhanceReady || enhanceMutation.isPending || lyricsMutation.isPending
                  }
                  onClick={() =>
                    enhanceMutation.mutate({
                      prompt,
                      lyrics: instrumental ? "" : lyrics,
                      // Pass the user's constraints — the LM honors provided
                      // values (M0: "user-provided values win" in the CoT).
                      ...(bpm.trim() && clampInt(bpm, 30, 300) !== undefined
                        ? { bpm: clampInt(bpm, 30, 300) }
                        : {}),
                      ...(keyScale !== "auto" ? { keyScale } : {}),
                      ...(duration !== "auto" ? { durationS: Number(duration) } : {}),
                      ...(timeSignature !== "auto"
                        ? { timeSignature: timeSignature as "2" | "3" | "4" | "6" }
                        : {}),
                    })
                  }
                >
                  {enhanceMutation.isPending ? "Enhancing…" : "Enhance"}
                </Button>
              </div>
            </div>
            <Textarea
              id="lyrics"
              data-testid="lyrics-input"
              value={lyrics}
              onChange={(e) => setLyrics(e.target.value)}
              placeholder={instrumental ? "Instrumental — no lyrics" : "[verse]\nYour lyrics, passed to the engine exactly as written…"}
              rows={8}
              disabled={instrumental}
              className="font-mono text-sm"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="style-tags">Style tags</Label>
            <Input
              id="style-tags"
              value={styleTags}
              onChange={(e) => setStyleTags(e.target.value)}
              placeholder="e.g. shoegaze, dreamy, female vocals"
            />
          </div>

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="bpm">BPM</Label>
              <Input id="bpm" type="number" min={30} max={300} value={bpm} placeholder="Auto"
                onChange={(e) => setBpm(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="key-scale">Key</Label>
              <Select value={keyScale} onValueChange={setKeyScale}>
                <SelectTrigger id="key-scale"><SelectValue /></SelectTrigger>
                <SelectContent className="max-h-64">
                  <SelectItem value="auto">Auto</SelectItem>
                  {KEY_SCALES.map((k) => (
                    <SelectItem key={k} value={k}>{k}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="time-signature">Time signature</Label>
              <Select value={timeSignature} onValueChange={setTimeSignature}>
                <SelectTrigger id="time-signature"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Auto</SelectItem>
                  <SelectItem value="2">2/4</SelectItem>
                  <SelectItem value="3">3/4</SelectItem>
                  <SelectItem value="4">4/4</SelectItem>
                  <SelectItem value="6">6/8</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="seed">Seed</Label>
              <Input id="seed" type="number" min={0} value={seed} placeholder="Random"
                onChange={(e) => setSeed(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="duration-advanced">Duration</Label>
              <Select value={duration} onValueChange={setDuration}>
                <SelectTrigger id="duration-advanced"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DURATIONS.map((d) => (
                    <SelectItem key={d.value} value={d.value}>{d.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label id="variations-label-advanced">Variations</Label>
              <div className="flex gap-1" role="group" aria-labelledby="variations-label-advanced">
                {[1, 2, 3, 4].map((n) => (
                  <Button key={n} variant={variations === n ? "default" : "outline"} size="sm"
                    className="flex-1" aria-pressed={variations === n} onClick={() => setVariations(n)}>
                    {n}
                  </Button>
                ))}
              </div>
            </div>
          </div>
        </TabsContent>
      </Tabs>

      {/* Forge */}
      {healthError && (
        <p className="text-center text-sm text-destructive" data-testid="app-unreachable">
          Cannot reach the Wavesmith API — run <code className="rounded bg-muted px-1">./scripts/dev.sh</code>{" "}
          and open <code className="rounded bg-muted px-1">http://127.0.0.1:3000</code>.
        </p>
      )}
      <Button
        size="lg"
        data-testid="forge"
        className="h-12 text-base font-semibold"
        disabled={!canForge}
        onClick={() => forgeMutation.mutate(buildParams())}
      >
        {forgeMutation.isPending ? "Starting…" : "Forge"}
      </Button>
    </div>
  );
}

function nearestDuration(s: number): number {
  const options = [30, 60, 120, 180, 300];
  return options.reduce((best, o) => (Math.abs(o - s) < Math.abs(best - s) ? o : best));
}
