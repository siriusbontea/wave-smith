/**
 * lib/client/use-held-submit.ts — one click, one job.
 *
 * isPending clears when the enqueue POST returns, which is faster than the
 * jobs list refetch. A second click in that gap used to queue a twin. The
 * button stays disabled until that job id shows up in /api/jobs.
 */
"use client";

import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { fetchJobs } from "@/lib/client/api";

export function useHeldSubmit() {
  const lock = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [holding, setHolding] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const { data: jobs } = useQuery({
    queryKey: ["jobs"],
    queryFn: ({ signal }) => fetchJobs(signal),
    refetchInterval: (query) =>
      (query.state.data ?? []).some((job) => job.status === "queued" || job.status === "running")
        ? 1000
        : false,
  });

  const arrived = Boolean(pendingId && jobs?.some((job) => job.id === pendingId));
  const busy = holding && !arrived;

  function releaseLater() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      lock.current = false;
      setHolding(false);
      setPendingId(null);
    }, 8000);
  }

  async function run<T extends { jobId: string }>(start: () => Promise<T>): Promise<T | undefined> {
    if (lock.current && !arrived) return undefined;
    lock.current = true;
    setHolding(true);
    setPendingId(null);
    releaseLater();
    try {
      const result = await start();
      setPendingId(result.jobId);
      return result;
    } catch (err) {
      lock.current = false;
      setHolding(false);
      if (timer.current) clearTimeout(timer.current);
      throw err;
    }
  }

  return { busy, run };
}
