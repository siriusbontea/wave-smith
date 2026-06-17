/**
 * components/status-banner.tsx — the first-run honesty banner (spec §9.1).
 * Three states from /api/health: offline → how to start; starting → the
 * one-time model download/warm-up message with elapsed time; ready → hidden.
 */
"use client";

import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { fetchHealth } from "@/lib/client/api";

export function StatusBanner() {
  const { data, isError, isLoading } = useQuery({
    queryKey: ["health"],
    queryFn: ({ signal }) => fetchHealth(signal),
    refetchInterval: 3000,
    retry: 2,
  });
  const state = data?.engine.state;

  // Elapsed-time display for the indeterminate "starting" state. All clock
  // reads and state updates happen asynchronously inside the effect (render
  // purity + no sync setState in effects).
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (state !== "starting") return;
    const startedAt = Date.now();
    const update = () => setElapsed(Math.floor((Date.now() - startedAt) / 1000));
    const t0 = setTimeout(update, 0); // async initial tick (resets any stale value)
    const t = setInterval(update, 1000);
    return () => {
      clearTimeout(t0);
      clearInterval(t);
    };
  }, [state]);

  if (isError) {
    return (
      <div role="status" className="border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-sm">
        <span className="font-medium">Wavesmith app not reachable.</span> The API returned an error
        (often because only the engine is running, or the dev server stopped). Run{" "}
        <code className="rounded bg-muted px-1 py-0.5">./scripts/dev.sh</code> and open{" "}
        <code className="rounded bg-muted px-1 py-0.5">http://127.0.0.1:3000</code>.
      </div>
    );
  }

  if (isLoading || !data || state === "ready") return null;

  if (state === "offline") {
    return (
      <div role="status" className="border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-sm">
        <span className="font-medium">Engine offline.</span> Start Wavesmith with{" "}
        <code className="rounded bg-muted px-1 py-0.5">scripts/dev.sh</code> — see the README for
        first-time setup.
      </div>
    );
  }

  return (
    <div role="status" className="border-b border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm">
      <span className="font-medium">Engine starting…</span> First run downloads several GB of
      model weights — this happens once. Warm-up takes about a minute with weights on disk.
      <span className="text-muted-foreground"> ({elapsed}s elapsed)</span>
      {elapsed >= 90 ? (
        <span className="mt-1 block text-muted-foreground">
          Models load on your first <strong>Forge</strong> — stem separation uses Demucs separately
          and does not need the engine. If Forge also fails, restart{" "}
          <code className="rounded bg-muted px-1 py-0.5">./scripts/dev.sh</code>.
        </span>
      ) : null}
    </div>
  );
}
