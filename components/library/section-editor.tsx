/**
 * components/library/section-editor.tsx — section timeline.
 *
 * Regenerate is a turbo repaint of one time range. Extend loads the base
 * model and runs complete, then restores turbo. Cuts follow stored word
 * timings when they still match the lyrics, and tag estimates otherwise.
 * Vocal-only swap is not offered — repaint rewrites the whole range.
 */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { alignLyrics, editSong, fetchHealth, fetchJobs, type JobView } from "@/lib/client/api";
import { formatTime } from "@/lib/format";
import { VOCAL_LANGUAGE_LABELS, VOCAL_LANGUAGES, type VocalLanguage } from "@/lib/lyrics/language";
import type { LyricTimings } from "@/lib/lyrics/timings";
import { replaceSectionBody, sectionsForTimeline } from "@/lib/songs/sections";

const LANGUAGE_OPTIONS: VocalLanguage[] = [...VOCAL_LANGUAGES].sort((a, b) =>
  VOCAL_LANGUAGE_LABELS[a].localeCompare(VOCAL_LANGUAGE_LABELS[b]),
);

export function SectionEditor({
  songId,
  durationS,
  lyrics,
  timings,
  onLyricsChange,
}: {
  songId: string;
  durationS: number | null;
  lyrics: string;
  timings: LyricTimings | null;
  onLyricsChange: (next: string) => void;
}) {
  const queryClient = useQueryClient();
  const [extendS, setExtendS] = useState(15);
  const [extendText, setExtendText] = useState("[outro]\n");
  const [language, setLanguage] = useState<VocalLanguage>("en");
  const timeline = useMemo(
    () => sectionsForTimeline(lyrics, durationS ?? 0, timings),
    [lyrics, durationS, timings],
  );
  const sections = timeline.sections;

  const { data: jobs } = useQuery({
    queryKey: ["jobs"],
    queryFn: ({ signal }) => fetchJobs(signal),
    refetchInterval: (q) => {
      const active = q.state.data?.some((j) => j.status === "queued" || j.status === "running");
      return active ? 1000 : false;
    },
  });

  const active = jobs?.find(
    (j) =>
      j.songId === songId &&
      (j.status === "queued" || j.status === "running") &&
      (j.editKind === "repaint" || j.editKind === "extend"),
  );
  const finished = jobs?.find(
    (j) =>
      j.status === "succeeded" &&
      j.result != null &&
      "parentSongId" in j.result &&
      j.result.parentSongId === songId &&
      j.result.songIds[0],
  );

  const editMutation = useMutation({
    mutationFn: editSong.bind(null, songId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["jobs"] });
      toast("Edit queued", { description: "A new song is saved when it finishes. The original stays." });
    },
    onError: (err) => toast.error("Couldn't start the edit", { description: err.message }),
  });

  const { data: health } = useQuery({
    queryKey: ["health"],
    queryFn: ({ signal }) => fetchHealth(signal),
    staleTime: 15_000,
  });
  const baseReady = health?.extend?.ready ?? health?.mockEngine ?? false;

  const alignJob = jobs?.find(
    (j) => j.songId === songId && j.type === "align" && (j.status === "queued" || j.status === "running"),
  );
  const seenAlign = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!jobs) return;
    if (seenAlign.current === null) {
      seenAlign.current = new Set(jobs.map((j) => j.id));
      return;
    }
    for (const job of jobs) {
      if (job.type !== "align" || job.songId !== songId || seenAlign.current.has(job.id)) continue;
      if (job.status !== "succeeded" && job.status !== "failed") continue;
      seenAlign.current.add(job.id);
      if (job.status === "succeeded") {
        void queryClient.invalidateQueries({ queryKey: ["song", songId] });
      }
    }
  }, [jobs, songId, queryClient]);

  const alignMutation = useMutation({
    mutationFn: () => alignLyrics(songId, language),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["jobs"] });
      toast("Timing lyrics", { description: "Section cuts update when the alignment finishes." });
    },
    onError: (err) => toast.error("Couldn't time the lyrics", { description: err.message }),
  });

  const busy = editMutation.isPending || !!active || alignMutation.isPending || !!alignJob;
  const canEdit = durationS != null && durationS > 0 && !busy;
  const timingNote =
    timeline.source === "aligned"
      ? "Cuts follow the timed vocal. Regenerate uses those times."
      : timeline.source === "mock"
        ? "Demo timings only — they are not a real alignment. A local aligner runs when it is installed."
        : "Cuts are estimated from lyric tags. Time the lyrics to place them on the vocal.";

  return (
    <section className="rounded-xl border bg-card p-4" data-testid="section-timeline">
      <h2 className="font-medium">Sections</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Regenerate rewrites one time range and keeps the rest. {timingNote} This is not a vocal-only swap.
      </p>
      {durationS == null ? (
        <p className="mt-3 text-sm text-destructive" role="status">
          This song has no duration yet, so sections cannot be placed.
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <div className="grid gap-1">
          <Label htmlFor="align-language" className="text-xs">Vocal language</Label>
          <Select value={language} onValueChange={(value) => setLanguage(value as VocalLanguage)}>
            <SelectTrigger id="align-language" className="w-44" aria-label="Language for lyric timing">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LANGUAGE_OPTIONS.map((code) => (
                <SelectItem key={code} value={code}>
                  {VOCAL_LANGUAGE_LABELS[code]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          data-testid="align-lyrics"
          disabled={busy || !lyrics.trim()}
          onClick={() => alignMutation.mutate()}
        >
          {alignJob ? "Timing lyrics…" : "Time the lyrics"}
        </Button>
      </div>
      {alignJob ? <EditProgress job={alignJob} /> : null}
      {active ? <EditProgress job={active} /> : null}
      {finished?.result && "songIds" in finished.result ? (
        <p className="mt-3 text-sm" role="status">
          Edit saved.{" "}
          <Link href={`/library/${finished.result.songIds[0]}`} className="underline underline-offset-2">
            Open the new version
          </Link>
        </p>
      ) : null}

      <ol className="mt-4 flex flex-col gap-3">
        {sections.map((section) => (
          <li key={`${section.index}-${section.label}`} className="rounded-lg border p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm font-medium">{section.label}</p>
              <p className="text-xs tabular-nums text-muted-foreground">
                {formatTime(section.startS)} – {formatTime(section.endS)}
              </p>
            </div>
            {section.synthetic ? (
              <p className="mt-1 text-xs text-muted-foreground">
                No [verse] / [chorus] tags yet, so this rewrites the middle and keeps the intro and ending.
              </p>
            ) : null}
            {section.lines && section.lines.length > 0 ? (
              <ul className="mt-2 flex flex-col gap-1">
                {section.lines.map((line) => (
                  <li key={`${line.startS}-${line.text}`} className="text-xs text-muted-foreground">
                    <span className="tabular-nums">{formatTime(line.startS)}</span>
                    <span className="ml-2 text-foreground">{line.text}</span>
                    {line.words.length > 0 ? (
                      <span className="mt-1 flex flex-wrap gap-1">
                        {line.words.map((word, wordIndex) => (
                          <span
                            key={`${word.startS}-${wordIndex}`}
                            className="rounded bg-muted px-1.5 py-0.5"
                            title={`${formatTime(word.startS)}–${formatTime(word.endS)}`}
                          >
                            {word.text}
                          </span>
                        ))}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
            <div
              className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"
              aria-hidden
            >
              <div
                className="h-full bg-primary/80"
                style={{
                  marginLeft: `${durationS ? (section.startS / durationS) * 100 : 0}%`,
                  width: `${durationS ? Math.max(4, ((section.endS - section.startS) / durationS) * 100) : 100}%`,
                }}
              />
            </div>
            <Label htmlFor={`section-${section.index}`} className="mt-3 block text-xs">
              Lyrics in this section
            </Label>
            <Textarea
              id={`section-${section.index}`}
              value={section.body}
              rows={4}
              className="mt-1 font-mono text-sm"
              onChange={(e) => onLyricsChange(replaceSectionBody(lyrics, section.index, e.target.value))}
            />
            <Button
              className="mt-2"
              size="sm"
              variant="outline"
              data-testid={`regenerate-section-${section.index}`}
              disabled={!canEdit}
              aria-label={`Regenerate ${section.label}`}
              onClick={() =>
                editMutation.mutate({
                  action: "repaint",
                  lyrics,
                  startS: section.startS,
                  endS: section.endS,
                  sectionLabel: section.label,
                })
              }
            >
              Regenerate {section.label}
            </Button>
          </li>
        ))}
      </ol>

      <div className="mt-5 border-t pt-4" data-testid="extend-panel">
        <h3 className="text-sm font-medium">Extend</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Continue with the base model Complete task. Turbo is unloaded for this job so both models
          are not in memory, then loaded again. About 50 steps, so it is slower than a normal forge.
          If the new file is not longer, the job fails and the original stays.
        </p>
        {health && !baseReady ? (
          <p className="mt-2 text-sm text-destructive" role="status">
            {health.extend?.hint ??
              "The base model is not downloaded. Run ./scripts/setup.sh, or from the engine folder: uv run acestep-download -m acestep-v15-base."}
          </p>
        ) : null}
        <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Seconds to add">
          {[15, 30].map((n) => (
            <Button
              key={n}
              type="button"
              size="sm"
              variant={extendS === n ? "default" : "outline"}
              aria-pressed={extendS === n}
              onClick={() => setExtendS(n)}
            >
              +{n}s
            </Button>
          ))}
        </div>
        <Label htmlFor="extend-lyrics" className="mt-3 block text-xs">
          New section (appended)
        </Label>
        <Textarea
          id="extend-lyrics"
          value={extendText}
          onChange={(e) => setExtendText(e.target.value)}
          rows={3}
          className="mt-1 font-mono text-sm"
        />
        <Button
          className="mt-2"
          size="sm"
          data-testid="extend-song"
          disabled={!canEdit || !baseReady}
          onClick={() => {
            const extra = extendText.trim();
            const next = lyrics.trim() && extra ? `${lyrics.trim()}\n${extra}` : lyrics.trim() || extra;
            editMutation.mutate({
              action: "extend",
              lyrics: next,
              extendS,
              sectionLabel: "extended",
            });
          }}
        >
          Extend song
        </Button>
      </div>
    </section>
  );
}

function EditProgress({ job }: { job: JobView }) {
  const pct = Math.round((job.progress ?? 0) * 100);
  const name = job.type === "align" ? "Lyrics" : job.editKind === "extend" ? "Extend" : "Section";
  return (
    <div className="mt-3" data-testid="edit-job-progress">
      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">
          {job.status === "queued" ? `${name} queued…` : (job.stage ?? `${name} running…`)}
        </span>
        <span className="tabular-nums">{pct}%</span>
      </div>
      <div
        className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${name} progress`}
      >
        <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
