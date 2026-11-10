/**
 * Settings page client UI (spec §9.5).
 */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { forge } from "@/lib/client/api";
import { useHeldSubmit } from "@/lib/client/use-held-submit";

interface SettingsResponse {
  settings: Record<string, string>;
  paths: { dataDir: string; audioDir: string; engineDir: string };
  storage: { audioBytes: number; dbBytes: number };
  engine: {
    state: string;
    modelsInitialized: boolean;
    llmInitialized: boolean;
    loadedModel: string | null;
    loadedLmModel: string | null;
  };
  lyrics: { available: boolean; model: string };
  mockEngine: boolean;
  measuredGenerationS: number | null;
  extend?: { model: string; ready: boolean };
  connection?: {
    mode: "local" | "grok";
    lyricsPolicy: "standard" | "unrestricted";
    grokConfigured: boolean;
    grokKeySource: "env" | "file" | "none";
    grokModel: string;
  };
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

async function fetchSettings(): Promise<SettingsResponse> {
  const res = await fetch("/api/settings", { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to load settings");
  return res.json() as Promise<SettingsResponse>;
}

async function patchSettings(body: Record<string, unknown>): Promise<void> {
  const res = await fetch("/api/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("Failed to save settings");
}

export function SettingsView() {
  const { theme, setTheme } = useTheme();
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["settings"],
    queryFn: fetchSettings,
    refetchInterval: 5000,
  });

  const themeMutation = useMutation({
    mutationFn: (t: string) => patchSettings({ theme: t }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["settings"] }),
  });

  const [keyDraft, setKeyDraft] = useState("");
  const held = useHeldSubmit();

  const connectionMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => patchSettings(body),
    onSuccess: () => {
      setKeyDraft("");
      void queryClient.invalidateQueries({ queryKey: ["settings"] });
      void queryClient.invalidateQueries({ queryKey: ["health"] });
      toast.success("Saved");
    },
    onError: (err) => toast.error("Couldn't save", { description: err.message }),
  });

  const testForge = useMutation({
    mutationFn: (idempotencyKey: string) =>
      forge({
        prompt: "short test jingle for health check",
        variations: 1,
        durationS: 10,
        idempotencyKey,
      }),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ["jobs"] });
      toast.success(result.merged ? "Already started" : "Test generation queued — watch the queue on Create.");
    },
    onError: (err) => toast.error("Test forge failed", { description: err.message }),
  });

  if (isLoading || !data) {
    return <p className="py-16 text-center text-muted-foreground">Loading settings…</p>;
  }

  return (
    <div className="flex flex-col gap-8" data-testid="settings-page">
      <section className="rounded-xl border bg-card p-4">
        <h2 className="font-medium">Engine</h2>
        <dl className="mt-3 grid gap-2 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Status</dt>
            <dd className="capitalize">{data.engine.state}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Model</dt>
            <dd>{data.engine.loadedModel ?? "—"}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">LM</dt>
            <dd>{data.engine.loadedLmModel ?? "—"}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Extend model</dt>
            <dd>
              {data.mockEngine
                ? `${data.extend?.model ?? "acestep-v15-base"} (demo — weights not loaded)`
                : data.extend?.ready
                  ? `${data.extend.model} on disk`
                  : `${data.extend?.model ?? "acestep-v15-base"} not downloaded`}
            </dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Measured gen time</dt>
            <dd>
              {data.measuredGenerationS == null
                ? "Not measured on this computer"
                : `~${data.measuredGenerationS}s per 30s song`}
            </dd>
          </div>
        </dl>
        {data.mockEngine ? (
          <p className="mt-3 text-sm text-amber-950 dark:text-amber-100" role="status">
            Demo mode is on. Songs are a sample clip, not music this computer generated.
          </p>
        ) : null}
        <Button
          className="mt-4"
          variant="outline"
          data-testid="test-generation"
          onClick={() => {
            void held.run("test", (key) => testForge.mutateAsync(key)).catch(() => undefined);
          }}
          disabled={testForge.isPending || held.busy}
        >
          Run test generation
        </Button>
      </section>

      <section className="rounded-xl border bg-card p-4" data-testid="connection-settings">
        <h2 className="font-medium">Connection</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Local only is the default and works with no network and no key. Grok hybrid can draft
          lyrics and a tempo, key, and structure. The song itself is still forged here.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="connection-mode">Mode</Label>
            <Select
              value={data.connection?.mode ?? "local"}
              onValueChange={(v) => connectionMutation.mutate({ connectionMode: v })}
            >
              <SelectTrigger id="connection-mode" data-testid="connection-mode">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="local">Local only</SelectItem>
                <SelectItem value="grok">Grok hybrid</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="lyrics-policy">Lyrics</Label>
            <Select
              value={data.connection?.lyricsPolicy ?? "standard"}
              onValueChange={(v) => connectionMutation.mutate({ lyricsPolicy: v })}
            >
              <SelectTrigger id="lyrics-policy" data-testid="lyrics-policy">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="standard">Standard</SelectItem>
                <SelectItem value="unrestricted">Unrestricted (local only)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        {data.connection?.lyricsPolicy === "unrestricted" ? (
          <p className="mt-3 text-sm text-muted-foreground" role="status">
            Unrestricted keeps Grok out of the path, even if hybrid is selected. Your lyrics go to
            the local engine as written. Wavesmith does not add a content filter.
          </p>
        ) : null}
        {data.connection?.mode === "grok" && !data.connection.grokConfigured ? (
          <p className="mt-3 text-sm" role="status">
            No key yet, so lyrics stay on this computer.
          </p>
        ) : null}
        <div className="mt-4 grid gap-1.5">
          <Label htmlFor="xai-key">xAI API key</Label>
          <p className="text-xs text-muted-foreground">
            {data.connection?.grokKeySource === "env"
              ? "Using XAI_API_KEY from the environment. A key saved here is ignored until that variable is unset."
              : data.connection?.grokConfigured
                ? "A key is saved on this computer (data/xai-api-key). It is never shown again."
                : "Optional. Leave empty to stay fully offline. Not stored in git."}
            {data.connection?.grokModel ? ` Model: ${data.connection.grokModel}.` : ""}
          </p>
          <div className="flex flex-wrap gap-2">
            <Input
              id="xai-key"
              type="password"
              autoComplete="off"
              value={keyDraft}
              onChange={(e) => setKeyDraft(e.target.value)}
              placeholder={data.connection?.grokConfigured ? "Replace saved key" : "Paste key"}
              className="max-w-sm"
            />
            <Button
              variant="outline"
              disabled={!keyDraft.trim() || connectionMutation.isPending}
              onClick={() => connectionMutation.mutate({ xaiApiKey: keyDraft.trim() })}
            >
              Save key
            </Button>
            {data.connection?.grokKeySource === "file" ? (
              <Button
                variant="ghost"
                disabled={connectionMutation.isPending}
                onClick={() => connectionMutation.mutate({ clearXaiApiKey: true })}
              >
                Remove saved key
              </Button>
            ) : null}
          </div>
        </div>
      </section>

      <section className="rounded-xl border bg-card p-4">
        <h2 className="font-medium">Lyrics LLM (Ollama)</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {data.mockEngine
            ? "Demo writer. Ollama is not connected."
            : data.lyrics.available
              ? `Connected — model ${data.lyrics.model}`
              : "Not available — Generate lyrics stays hidden until Ollama is running."}
        </p>
      </section>

      <section className="rounded-xl border bg-card p-4">
        <h2 className="font-medium">Appearance</h2>
        <div className="mt-3 flex items-center gap-3">
          <Label htmlFor="theme">Theme</Label>
          <Select
            value={theme ?? "dark"}
            onValueChange={(v) => {
              setTheme(v);
              themeMutation.mutate(v);
            }}
          >
            <SelectTrigger id="theme" className="w-36" data-testid="theme-select">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="dark">Dark</SelectItem>
              <SelectItem value="light">Light</SelectItem>
              <SelectItem value="system">System</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </section>

      <section className="rounded-xl border bg-card p-4">
        <h2 className="font-medium">Storage</h2>
        <dl className="mt-3 grid gap-2 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Data directory</dt>
            <dd className="truncate font-mono text-xs">{data.paths.dataDir}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Audio directory</dt>
            <dd className="truncate font-mono text-xs">{data.paths.audioDir}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Audio on disk</dt>
            <dd>{formatBytes(data.storage.audioBytes)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-muted-foreground">Database</dt>
            <dd>{formatBytes(data.storage.dbBytes)}</dd>
          </div>
        </dl>
        <div className="mt-4 flex gap-2">
          <a href="/api/library/export" download>
            <Button variant="outline" size="sm">Export library</Button>
          </a>
        </div>
      </section>

      <section className="rounded-xl border border-destructive/40 bg-card p-4">
        <h2 className="font-medium text-destructive">Danger zone</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Delete individual songs from the song view. Export your library JSON before making bulk changes.
        </p>
      </section>
    </div>
  );
}
