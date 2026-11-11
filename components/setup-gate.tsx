/**
 * components/setup-gate.tsx — the first-run screen.
 * Shown only while setup says it is still running. Any other state keeps the studio.
 */
"use client";

import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { formatEta, type SetupView } from "@/lib/setup/progress";

async function fetchSetup(signal: AbortSignal): Promise<SetupView> {
  const res = await fetch("/api/setup", { cache: "no-store", signal });
  if (!res.ok) throw new Error("setup");
  return res.json() as Promise<SetupView>;
}

export function useSetupStatus() {
  return useQuery({
    queryKey: ["setup"],
    queryFn: ({ signal }) => fetchSetup(signal),
    refetchInterval: (query) => (query.state.data?.running ? 2000 : 10000),
    retry: false,
  });
}

export function SetupGate({ children }: { children: ReactNode }) {
  const { data } = useSetupStatus();
  if (data?.running) return <SetupScreen status={data} />;
  return children;
}

function SetupScreen({ status }: { status: SetupView }) {
  const eta = formatEta(status.etaSeconds);
  const percent = status.percent;
  return (
    <main
      data-testid="setup-screen"
      className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center gap-6 px-6 py-16"
    >
      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Setup</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">Setting up Wavesmith</h1>
        <p className="mt-2 text-sm text-muted-foreground">{status.message}</p>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
        {percent == null ? (
          <div className="h-full w-1/3 animate-pulse rounded-full bg-foreground/70" />
        ) : (
          <div className="h-full rounded-full bg-foreground/80" style={{ width: `${percent}%` }} />
        )}
      </div>
      <p className="text-sm" role="status">
        {percent == null ? "Working…" : `${percent}%`}
        {eta ? <span className="text-muted-foreground"> · {eta}</span> : null}
      </p>
      <p className="text-sm text-muted-foreground">
        Leave this window open. The download continues on this Mac, and this page updates on its own.
      </p>
    </main>
  );
}
