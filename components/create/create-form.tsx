/**
 * components/create/create-form.tsx — the Create composer.
 *
 * One screen a non-technical user can finish without docs: describe the song,
 * optionally set lyrics, language, style, and instrumental, then Forge.
 * Simple/Advanced tabs stay so duration, variations, and the finer controls
 * (BPM, key, seed, Enhance) remain reachable. Generate Lyrics follows the
 * connection setting: local Ollama by default, Grok only in hybrid mode.
 *
 * Style tags have no engine field: they're appended to the prompt.
 */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type KeyboardEvent } from "react";
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
  type LyricsResult,
} from "@/lib/client/api";
import { VOCAL_LANGUAGES, VOCAL_LANGUAGE_LABELS, type VocalLanguage } from "@/lib/lyrics/language";

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

const LANGUAGE_OPTIONS: VocalLanguage[] = [...VOCAL_LANGUAGES].sort((a, b) =>
  VOCAL_LANGUAGE_LABELS[a].localeCompare(VOCAL_LANGUAGE_LABELS[b]),
);

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
    queryFn: ({ signal }) => fetchHealth(signal),
    refetchInterval: 3000,
    retry: 2,
  });

  const [prompt, setPrompt] = useState("");
  const [instrumental, setInstrumental] = useState(false);
  const [duration, setDuration] = useState<string>("auto");
  const [variations, setVariations] = useState(2);
  const [lyrics, setLyrics] = useState("");
  const [styleTags, setStyleTags] = useState("");
  const [vocalLanguage, setVocalLanguage] = useState<string>("auto");
  const [bpm, setBpm] = useState("");
  const [keyScale, setKeyScale] = useState<string>("auto");
  const [timeSignature, setTimeSignature] = useState<string>("auto");
  const [seed, setSeed] = useState("");
  const [explicitLyrics, setExplicitLyrics] = useState(false);
  const [planNote, setPlanNote] = useState<string | null>(null);
  const [lyricsNotice, setLyricsNotice] = useState<string | null>(null);

  const forgeMutation = useMutation({
    mutationFn: forge,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["jobs"] });
      toast("Forging…", { description: "Track progress in the queue below. Audio stays on this Mac." });
    },
    onError: (err) => toast.error("Couldn't start the forge", { description: err.message }),
  });

  const lyricsMutation = useMutation({
    mutationFn: generateLyrics,
    onSuccess: (result: LyricsResult) => {
      setLyrics(result.lyrics);
      setLyricsNotice(result.notice);
      if (result.plan) {
        const bits = [
          result.plan.structure || null,
          result.plan.bpm ? `${result.plan.bpm} bpm` : null,
          result.plan.keyScale,
        ].filter(Boolean);
        setPlanNote(bits.length ? `Plan from Grok: ${bits.join(" · ")}` : "Grok drafted the lyrics. Audio still forges locally.");
        if (!bpm.trim() && result.plan.bpm) setBpm(String(result.plan.bpm));
        if (keyScale === "auto" && result.plan.keyScale) {
          const normalized = normalizeKeyScale(result.plan.keyScale);
          if (KEY_SCALES.includes(normalized)) setKeyScale(normalized);
        }
        if (timeSignature === "auto" && result.plan.timeSignature) {
          setTimeSignature(result.plan.timeSignature);
        }
        if (!styleTags.trim() && result.plan.styleTags.length) {
          setStyleTags(result.plan.styleTags.join(", "));
        }
      } else {
        setPlanNote(null);
      }
      if (result.notice) {
        toast("Lyrics", { description: result.notice });
      } else if (result.source === "grok") {
        toast.success("Lyrics ready", { description: "Grok drafted the words. Forge still runs locally." });
      }
    },
    onError: (err) => toast.error("Lyric writing failed", { description: err.message }),
  });

  const enhanceMutation = useMutation({
    mutationFn: enhance,
    onSuccess: (plan) => {
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
    if (!instrumental && vocalLanguage !== "auto") params.vocalLanguage = vocalLanguage;
    return params;
  }

  const canForge = prompt.trim().length > 0 && !forgeMutation.isPending && !healthError;
  const connection = health?.connection;
  const grokReady =
    connection?.mode === "grok" &&
    connection.lyricsPolicy !== "unrestricted" &&
    connection.grokConfigured;
  const lyricsAvailable = (health?.lyrics.available ?? false) || grokReady;
  const enhanceReady =
    health?.mockEngine ||
    (health?.engine.state === "ready" && health.engine.llmInitialized);

  function onForgeKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && canForge) {
      event.preventDefault();
      forgeMutation.mutate(buildParams());
    }
  }

  return (
    <div className="flex w-full flex-col gap-5">
      <div className="rounded-2xl border bg-card p-4 shadow-sm sm:p-5">
        <Label htmlFor="prompt-input" className="text-sm font-medium">
          Describe your song
        </Label>
        <Textarea
          id="prompt-input"
          data-testid="prompt-input"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={onForgeKey}
          placeholder="A late-night drive song, warm bass, soft vocals…"
          rows={4}
          className="mt-2 resize-none text-base"
          aria-describedby="prompt-hint"
        />
        <p id="prompt-hint" className="mt-2 text-xs text-muted-foreground">
          Write it like you would tell a friend. Press ⌘/Ctrl+Enter to forge. Audio is made on this computer.
        </p>

        <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Song presets">
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

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div className="flex items-center gap-2 sm:col-span-2">
            <Switch
              id="instrumental"
              checked={instrumental}
              onCheckedChange={setInstrumental}
              aria-describedby="instrumental-hint"
            />
            <Label htmlFor="instrumental">Instrumental</Label>
            <span id="instrumental-hint" className="text-xs text-muted-foreground">
              {instrumental ? "No vocals." : "Vocals on."}
            </span>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="vocal-language">Language</Label>
            <Select value={vocalLanguage} onValueChange={setVocalLanguage} disabled={instrumental}>
              <SelectTrigger id="vocal-language" data-testid="vocal-language">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-64">
                <SelectItem value="auto">Auto — detect from the lyrics</SelectItem>
                {LANGUAGE_OPTIONS.map((code) => (
                  <SelectItem key={code} value={code}>
                    {VOCAL_LANGUAGE_LABELS[code]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="style-tags">Style</Label>
            <Input
              id="style-tags"
              data-testid="style-tags"
              value={styleTags}
              onChange={(e) => setStyleTags(e.target.value)}
              placeholder="shoegaze, dreamy, soft drums"
            />
          </div>
        </div>

        <div className="mt-5 flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Label htmlFor="lyrics">Lyrics</Label>
            <div className="flex flex-wrap items-center gap-2">
              {lyricsAvailable && (
                <>
                  <div className="flex items-center gap-1.5">
                    <Switch id="explicit" checked={explicitLyrics} onCheckedChange={setExplicitLyrics} />
                    <Label htmlFor="explicit" className="text-xs text-muted-foreground">
                      Explicit
                    </Label>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    data-testid="generate-lyrics"
                    disabled={!prompt.trim() || lyricsMutation.isPending || enhanceMutation.isPending || instrumental}
                    onClick={() =>
                      lyricsMutation.mutate({
                        prompt,
                        tags: styleTags
                          ? styleTags
                              .split(",")
                              .map((t) => t.trim().slice(0, 40))
                              .filter(Boolean)
                              .slice(0, 10)
                          : [],
                        explicit: explicitLyrics,
                        language: vocalLanguage === "auto" ? undefined : vocalLanguage,
                      })
                    }
                  >
                    {lyricsMutation.isPending ? "Writing…" : grokReady ? "Write with Grok" : "Generate lyrics"}
                  </Button>
                </>
              )}
              <Tooltip>
                <TooltipTrigger asChild>
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
                </TooltipTrigger>
                <TooltipContent>Ask the local engine to fill in style, tempo, and key.</TooltipContent>
              </Tooltip>
            </div>
          </div>
          <Textarea
            id="lyrics"
            data-testid="lyrics-input"
            value={lyrics}
            onChange={(e) => setLyrics(e.target.value)}
            placeholder={
              instrumental
                ? "Instrumental — no lyrics"
                : "[verse]\nYour lyrics, passed to the engine exactly as written…"
            }
            rows={8}
            disabled={instrumental}
            className="font-mono text-sm"
          />
          {planNote ? <p className="text-xs text-muted-foreground">{planNote}</p> : null}
          {lyricsNotice ? (
            <p className="text-xs text-muted-foreground" role="status">
              {lyricsNotice}
            </p>
          ) : null}
          {connection?.lyricsPolicy === "unrestricted" && connection.mode === "grok" ? (
            <p className="text-xs text-muted-foreground">
              Unrestricted lyrics stays on this machine — Grok is not used.
            </p>
          ) : connection?.mode === "grok" && !connection.grokConfigured ? (
            <p className="text-xs text-muted-foreground">
              Grok hybrid is on, but no key is set. Lyrics stay local until you add one in Settings.
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              Leave lyrics empty and Forge will write them locally. Your text is sent as-is — Wavesmith does not filter it.
            </p>
          )}
        </div>
      </div>

      <Tabs defaultValue="simple">
        <TabsList>
          <TabsTrigger value="simple">Simple</TabsTrigger>
          <TabsTrigger value="advanced" data-testid="advanced-tab">
            Advanced
          </TabsTrigger>
        </TabsList>

        <TabsContent value="simple" className="flex flex-col gap-4 pt-2">
          <DurationAndVariations
            duration={duration}
            setDuration={setDuration}
            variations={variations}
            setVariations={setVariations}
            durationId="duration-simple"
            variationsId="variations-label-simple"
          />
        </TabsContent>

        <TabsContent value="advanced" className="flex flex-col gap-4 pt-2">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="bpm">BPM</Label>
              <Input
                id="bpm"
                type="number"
                min={30}
                max={300}
                value={bpm}
                placeholder="Auto"
                onChange={(e) => setBpm(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="key-scale">Key</Label>
              <Select value={keyScale} onValueChange={setKeyScale}>
                <SelectTrigger id="key-scale">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="max-h-64">
                  <SelectItem value="auto">Auto</SelectItem>
                  {KEY_SCALES.map((k) => (
                    <SelectItem key={k} value={k}>
                      {k}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="time-signature">Time signature</Label>
              <Select value={timeSignature} onValueChange={setTimeSignature}>
                <SelectTrigger id="time-signature">
                  <SelectValue />
                </SelectTrigger>
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
              <Input
                id="seed"
                type="number"
                min={0}
                value={seed}
                placeholder="Random"
                onChange={(e) => setSeed(e.target.value)}
              />
            </div>
          </div>
          <DurationAndVariations
            duration={duration}
            setDuration={setDuration}
            variations={variations}
            setVariations={setVariations}
            durationId="duration-advanced"
            variationsId="variations-label-advanced"
          />
        </TabsContent>
      </Tabs>

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

function DurationAndVariations({
  duration,
  setDuration,
  variations,
  setVariations,
  durationId,
  variationsId,
}: {
  duration: string;
  setDuration: (v: string) => void;
  variations: number;
  setVariations: (n: number) => void;
  durationId: string;
  variationsId: string;
}) {
  return (
    <div className="grid grid-cols-2 gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={durationId}>Length</Label>
        <Select value={duration} onValueChange={setDuration}>
          <SelectTrigger id={durationId}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DURATIONS.map((d) => (
              <SelectItem key={d.value} value={d.value}>
                {d.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label id={variationsId}>Variations</Label>
        <div className="flex gap-1" role="group" aria-labelledby={variationsId}>
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
  );
}

function nearestDuration(s: number): number {
  const options = [30, 60, 120, 180, 300];
  return options.reduce((best, o) => (Math.abs(o - s) < Math.abs(best - s) ? o : best));
}
