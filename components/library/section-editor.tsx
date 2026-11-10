/**
 * components/library/section-editor.tsx — Suno-style section timeline.
 *
 * Shows estimated sections (no LRC from the engine) with a regenerate action,
 * plus extend. Regenerate is a real turbo repaint. Extend asks turbo to
 * continue past the end and fails closed if the audio doesn't get longer.
 * Vocal-only swap is not offered — turbo repaint rewrites the whole range.
 */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { editSong, fetchJobs, type JobView } from "@/lib/client/api";
import { formatTime } from "@/lib/format";
import { parseLyricSections, replaceSectionBody } from "@/lib/songs/sections";

export function SectionEditor({
  songId,
  durationS,
  lyrics,
  onLyricsChange,
}: {
  songId: string;
  durationS: number | null;
  lyrics: string;
  onLyricsChange: (next: string) => void;
}) {
  const queryClient = useQueryClient();
  const [extendS, setExtendS] = useState(15);
  const [extendText, setExtendText] = useState("[outro]\n");
  const sections = useMemo(
    () => parseLyricSections(lyrics, durationS ?? 0),
    [lyrics, durationS],
  );

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

  const busy = editMutation.isPending || !!active;
  const canEdit = durationS != null && durationS > 0 && !busy;

  return (
    <section className="rounded-xl border bg-card p-4" data-testid="section-timeline">
      <h2 className="font-medium">Sections</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Regenerate rewrites one time range and keeps the rest. Times are estimated from the lyric
        tags — the engine does not return word timings. This is not a vocal-only swap.
      </p>
      {durationS == null ? (
        <p className="mt-3 text-sm text-destructive" role="status">
          This song has no duration yet, so sections cannot be placed.
        </p>
      ) : null}
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
          Continue past the end with the local turbo model. If it cannot lengthen the audio, the job
          fails and the original is kept. The base-model Complete task is not loaded.
        </p>
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
          disabled={!canEdit}
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
  const name = job.editKind === "extend" ? "Extend" : "Section";
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
