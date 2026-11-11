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
import { reportActionError } from "@/lib/client/report-error";
import { useHeldSubmit } from "@/lib/client/use-held-submit";
import { formatTime } from "@/lib/format";
import { detectLyricsLanguage, VOCAL_LANGUAGE_LABELS, VOCAL_LANGUAGES, type VocalLanguage } from "@/lib/lyrics/language";
import { ALIGNER_SETUP } from "@/lib/setup-hints";
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
  lyricsDirty,
  onSaveLyrics,
}: {
  songId: string;
  durationS: number | null;
  lyrics: string;
  timings: LyricTimings | null;
  onLyricsChange: (next: string) => void;
  lyricsDirty?: boolean;
  onSaveLyrics?: () => void;
}) {
  const queryClient = useQueryClient();
  const [extendS, setExtendS] = useState(15);
  const [extendText, setExtendText] = useState("");
  const [language, setLanguage] = useState<VocalLanguage>(() => {
    const detected = detectLyricsLanguage(lyrics);
    return detected.kind === "single" ? detected.language : "en";
  });
  const [showAllLines, setShowAllLines] = useState(false);
  const [dismissedEdit, setDismissedEdit] = useState<string | null>(null);
  const [knownEditIds, setKnownEditIds] = useState<Set<string> | null>(null);
  const held = useHeldSubmit();
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
  const finished = [...(jobs ?? [])]
    .filter(
      (j) =>
        j.status === "succeeded" &&
        j.result != null &&
        "parentSongId" in j.result &&
        j.result.parentSongId === songId,
    )
    .sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0))[0];

  const editMutation = useMutation({
    mutationFn: (body: Parameters<typeof editSong>[1]) => editSong(songId, body),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ["jobs"] });
      if (result.merged) {
        toast("Already started", { description: "That click was already queued." });
        return;
      }
      toast("Edit queued", {
        description: health?.mockEngine
          ? "Demo mode does not change the audio. Nothing new is saved."
          : "A new song is saved when it finishes. The original stays.",
      });
    },
    onError: (err) => reportActionError("Couldn't start the edit", err),
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
  if (jobs && knownEditIds === null) {
    setKnownEditIds(
      new Set(jobs.filter((job) => job.status === "succeeded" || job.status === "failed").map((job) => job.id)),
    );
  }
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
      } else {
        toast.error("Couldn't time the lyrics", { description: job.error ?? "The aligner did not finish." });
      }
    }
  }, [jobs, songId, queryClient]);

  const alignMutation = useMutation({
    mutationFn: (idempotencyKey: string) => alignLyrics(songId, language, idempotencyKey),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ["jobs"] });
      if (result.merged) {
        toast("Already started", { description: "That click was already queued." });
        return;
      }
      toast("Timing lyrics", { description: "Section cuts update when the alignment finishes." });
    },
    onError: (err) => reportActionError("Couldn't time the lyrics", err),
  });

  const busy = editMutation.isPending || held.busy || !!active || alignMutation.isPending || !!alignJob;
  const canEdit = durationS != null && durationS > 0 && !busy;
  const timingNote =
    timeline.source === "aligned"
      ? "Cuts follow the timed vocal."
      : timeline.source === "mock"
        ? "These times are a rough estimate, not a real alignment."
        : "Cuts are estimated from the lyric tags until you time the lyrics.";
  const freshEdit =
    finished && knownEditIds && !knownEditIds.has(finished.id) && dismissedEdit !== finished.id
      ? finished
      : null;

  return (
    <section className="rounded-xl border bg-card p-4" data-testid="section-timeline">
      <h2 className="font-medium">Sections</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Rewrite one part of the song and keep the rest. {timingNote}
      </p>
      <details className="mt-2 text-sm text-muted-foreground">
        <summary className="cursor-pointer">How it works</summary>
        <p className="mt-1">
          Regenerate rewrites that time range, music and voice together. It does not swap only the voice.
        </p>
      </details>
      {lyricsDirty && onSaveLyrics ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" onClick={onSaveLyrics}>
            Save lyrics
          </Button>
          <p className="text-xs text-muted-foreground">These lyric edits are not saved yet.</p>
        </div>
      ) : null}
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
          onClick={() => {
            void held
              .run("align", (key) => alignMutation.mutateAsync(key))
              .catch((err) => reportActionError("Couldn't time the lyrics", err));
          }}
        >
          {alignJob ? "Timing lyrics…" : "Time the lyrics"}
        </Button>
      </div>
      <details className="mt-2 text-sm text-muted-foreground">
        <summary className="cursor-pointer">If timing is not set up</summary>
        <p className="mt-1">{ALIGNER_SETUP}</p>
      </details>
      {alignJob ? <EditProgress job={alignJob} /> : null}
      {active ? <EditProgress job={active} /> : null}
      {freshEdit?.result && "demoUnchanged" in freshEdit.result && freshEdit.result.demoUnchanged ? (
        <p className="mt-3 flex flex-wrap items-center gap-2 text-sm" role="status">
          Demo mode did not change the audio. Nothing new was saved.
          <button type="button" className="min-h-6 underline" onClick={() => setDismissedEdit(freshEdit.id)}>
            Dismiss
          </button>
        </p>
      ) : freshEdit?.result && "songIds" in freshEdit.result && freshEdit.result.songIds[0] ? (
        <p className="mt-3 flex flex-wrap items-center gap-2 text-sm" role="status">
          Edit saved.{" "}
          <Link
            href={`/library/${freshEdit.result.songIds[0]}`}
            className="inline-flex min-h-6 items-center underline underline-offset-2"
          >
            Open the new version
          </Link>
          <button type="button" className="min-h-6 underline" onClick={() => setDismissedEdit(freshEdit.id)}>
            Dismiss
          </button>
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
            {timeline.source === "mock" ? (
              <p id={`estimate-${section.index}`} className="sr-only">
                These word times are estimates, not measured.
              </p>
            ) : null}
            {section.lines && section.lines.length > 0 ? (
              <ul className="mt-2 flex flex-col gap-1" dir="auto">
                {(showAllLines ? section.lines : section.lines.slice(0, 6)).map((line) => (
                  <li key={`${line.startS}-${line.text}`} className="text-xs text-muted-foreground" dir="auto">
                    <span className="tabular-nums">{formatTime(line.startS)}</span>
                    <span className="ms-2 text-foreground">{line.text}</span>
                    {line.words.length > 1 ? (
                      <span
                        className="mt-1 flex flex-wrap gap-1"
                        dir="auto"
                        aria-describedby={timeline.source === "mock" ? `estimate-${section.index}` : undefined}
                      >
                        {line.words.map((word, wordIndex) => (
                          <span
                            key={`${word.startS}-${wordIndex}`}
                            dir="auto"
                            className={
                              timeline.source === "mock"
                                ? "rounded border border-dashed border-muted-foreground/60 px-1.5 py-0.5"
                                : "rounded bg-muted px-1.5 py-0.5"
                            }
                            title={
                              timeline.source === "mock"
                                ? "Estimate, not a measured time"
                                : `${formatTime(word.startS)}–${formatTime(word.endS)}`
                            }
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
            {section.lines && section.lines.length > 6 ? (
              <button
                type="button"
                className="mt-2 min-h-6 text-xs underline"
                onClick={() => setShowAllLines((v) => !v)}
              >
                {showAllLines ? "Show fewer lines" : `Show the rest (${section.lines.length - 6} lines)`}
              </button>
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
              dir="auto"
              onChange={(e) => onLyricsChange(replaceSectionBody(lyrics, section.index, e.target.value))}
            />
            <Button
              className="mt-2"
              size="sm"
              variant="outline"
              data-testid={`regenerate-section-${section.index}`}
              disabled={!canEdit}
              aria-label={`Regenerate ${section.label}`}
              onClick={() => {
                void held
                  .run(`repaint-${section.index}`, (key) =>
                    editMutation.mutateAsync({
                      action: "repaint",
                      lyrics,
                      startS: section.startS,
                      endS: section.endS,
                      sectionLabel: section.label,
                      vocalLanguage: language,
                      idempotencyKey: key,
                    }),
                  )
                  .catch((err) => reportActionError("Couldn't start the edit", err));
              }}
            >
              Regenerate {section.label}
            </Button>
          </li>
        ))}
      </ol>

      <div className="mt-5 border-t pt-4" data-testid="extend-panel">
        <h3 className="text-sm font-medium">Make it longer</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Add 15 or 30 more seconds onto the end.
        </p>
        <details className="mt-2 text-sm text-muted-foreground">
          <summary className="cursor-pointer">How it works</summary>
          <p className="mt-1">
            This uses a larger model, then switches back. It is slower than making a new song. If the
            new file is not longer, nothing is saved.
          </p>
        </details>
        {health && !baseReady ? (
          <div className="mt-2 text-sm" role="status">
            <p>Making it longer needs an extra download. Ask whoever set up Wavesmith to finish setup.</p>
            <details className="mt-1 text-muted-foreground">
              <summary className="cursor-pointer">Setup command</summary>
              <p className="mt-1">
                {health.extend?.hint ??
                  "Run ./scripts/setup.sh, or from the engine folder: uv run acestep-download -m acestep-v15-base."}
              </p>
            </details>
          </div>
        ) : null}
        <fieldset disabled={!baseReady} className={baseReady ? "mt-3" : "mt-3 opacity-60"}>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Seconds to add">
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
            New words at the end (optional)
          </Label>
          <Textarea
            id="extend-lyrics"
            value={extendText}
            onChange={(e) => setExtendText(e.target.value)}
            placeholder={"[outro]\nOne more line"}
            rows={3}
            dir="auto"
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
              void held
                .run("extend", (key) =>
                  editMutation.mutateAsync({
                    action: "extend",
                    lyrics: next,
                    extendS,
                    sectionLabel: "extended",
                    vocalLanguage: language,
                    idempotencyKey: key,
                  }),
                )
                .catch((err) => reportActionError("Couldn't start the edit", err));
            }}
          >
            Make it longer
          </Button>
        </fieldset>
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
