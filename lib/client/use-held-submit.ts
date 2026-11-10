/**
 * lib/client/use-held-submit.ts — one click, one job.
 *
 * A second call for the same action inside a short window reuses the click
 * key and does not start another request. The button stays disabled until
 * that job id shows up in /api/jobs, including when the job has already
 * finished. A later click gets a new key.
 */
"use client";

import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { nextIntent } from "@/lib/client/intent";
import { fetchJobs } from "@/lib/client/api";

export function useHeldSubmit() {
  const intents = useRef(new Map<string, { key: string; at: number }>());
  const [posting, setPosting] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const { data: jobs } = useQuery({
    queryKey: ["jobs"],
    queryFn: ({ signal }) => fetchJobs(signal),
    refetchInterval: (query) => {
      const rows = query.state.data ?? [];
      const waiting = posting || (pendingId != null && !rows.some((job) => job.id === pendingId));
      if (waiting) return 400;
      const active = rows.some((job) => job.status === "queued" || job.status === "running");
      return active ? 1000 : false;
    },
  });

  const arrived = Boolean(pendingId && jobs?.some((job) => job.id === pendingId));
  const busy = (posting || pendingId != null) && !arrived;

  async function run<T extends { jobId: string }>(
    action: string,
    start: (idempotencyKey: string) => Promise<T>,
  ): Promise<T | undefined> {
    const previous = intents.current.get(action) ?? null;
    const decision = nextIntent(previous, Date.now());
    if (decision.reused) return undefined;
    intents.current.set(action, { key: decision.key, at: decision.at });
    setPosting(true);
    setPendingId(null);
    try {
      const result = await start(decision.key);
      setPendingId(result.jobId);
      setPosting(false);
      return result;
    } catch (err) {
      setPosting(false);
      setPendingId(null);
      throw err;
    }
  }

  return { busy, run };
}
