/**
 * components/create/queue-strip.tsx — the inline queue strip (spec §9.2).
 *
 * Polls GET /api/jobs at 1 s while any job is active, 5 s otherwise (spec §3:
 * polling, not SSE). Shows queued position, running progress + stage, and
 * terminal results. Fires a toast exactly once per completion by tracking
 * which terminal job ids have already been announced.
 */
"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { fetchJobs, type JobView } from "@/lib/client/api";

const ACTIVE = new Set(["queued", "running"]);

export function QueueStrip() {
  const { data: jobs } = useQuery({
    queryKey: ["jobs"],
    queryFn: fetchJobs,
    refetchInterval: (query) =>
      (query.state.data ?? []).some((j) => ACTIVE.has(j.status)) ? 1000 : 5000,
  });

  // Toast once per finished job. Seeded lazily with the first fetch so a page
  // load doesn't re-announce history.
  const announcedRef = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!jobs) return;
    if (announcedRef.current === null) {
      announcedRef.current = new Set(
        jobs.filter((j) => !ACTIVE.has(j.status)).map((j) => j.id),
      );
      return;
    }
    for (const job of jobs) {
      if (ACTIVE.has(job.status) || announcedRef.current.has(job.id)) continue;
      announcedRef.current.add(job.id);
      if (job.status === "succeeded") {
        if (job.type === "generate" && job.result && "songIds" in job.result) {
          const count = job.result.songIds.length;
          toast.success(`Forged ${count} ${count === 1 ? "take" : "takes"}`, {
            action: { label: "Open in Library", onClick: () => (window.location.href = "/library") },
          });
        } else if (job.type === "stems") {
          toast.success("Stems ready");
        }
      } else {
        toast.error("Forge failed", { description: job.error ?? undefined });
      }
    }
  }, [jobs]);

  // Pure display rule (no clock math in render): every active job, plus the
  // two most recent finished ones for context. /api/jobs is already newest-first.
  const all = jobs ?? [];
  const visible = [
    ...all.filter((j) => ACTIVE.has(j.status)),
    ...all.filter((j) => !ACTIVE.has(j.status)).slice(0, 2),
  ];
  if (visible.length === 0) return null;

  // Queue positions in RUN order (worker drains oldest-first; the API returns
  // newest-first) — without the sort, the next job to run would show the
  // highest position.
  const queuedIds = all
    .filter((j) => j.status === "queued")
    .sort((a, b) => a.createdAt - b.createdAt)
    .map((j) => j.id);

  return (
    <div data-testid="queue-strip" className="flex flex-col gap-2">
      {visible.map((job) => (
        <JobRow key={job.id} job={job} queuePosition={queuedIds.indexOf(job.id) + 1} />
      ))}
    </div>
  );
}

function JobRow({ job, queuePosition }: { job: JobView; queuePosition: number }) {
  const pct = Math.round((job.progress ?? 0) * 100);
  return (
    <div
      data-testid={`job-${job.status}`}
      className="rounded-lg border bg-card px-4 py-3 text-sm"
    >
      {job.status === "queued" && (
        <span className="text-muted-foreground">Queued (position {queuePosition})…</span>
      )}
      {job.status === "running" && (
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between gap-4">
            <span className="truncate text-muted-foreground">{job.stage ?? "Working…"}</span>
            <span className="tabular-nums">{pct}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-muted" role="progressbar"
            aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
          </div>
        </div>
      )}
      {job.status === "succeeded" && job.type === "generate" && job.result && "songIds" in job.result && (
        <span>
          Done — {job.result.songIds.length}{" "}
          {job.result.songIds.length === 1 ? "take" : "takes"}.{" "}
          <Link href="/library" className="underline underline-offset-2">
            Open in Library
          </Link>
        </span>
      )}
      {job.status === "succeeded" && job.type === "stems" && (
        <span>Stems separated — open the song to download.</span>
      )}
      {job.status === "failed" && (
        <span className="text-destructive">{job.error ?? "Forge failed"}</span>
      )}
    </div>
  );
}
