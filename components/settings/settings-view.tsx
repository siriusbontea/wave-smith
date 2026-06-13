/**
 * Settings page client UI (spec §9.5).
 */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTheme } from "next-themes";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { forge } from "@/lib/client/api";

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
  measuredGenerationS: number;
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

  const testForge = useMutation({
    mutationFn: () => forge({ prompt: "short test jingle for health check", variations: 1, durationS: 10 }),
    onSuccess: () => {
      toast.success("Test generation queued — watch the queue on Create.");
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
            <dt className="text-muted-foreground">Measured gen time</dt>
            <dd>~{data.measuredGenerationS}s per 30s song (batch 2, this machine)</dd>
          </div>
          {data.mockEngine && (
            <p className="text-xs text-amber-400">MOCK_ENGINE=1 — demo mode active.</p>
          )}
        </dl>
        <Button
          className="mt-4"
          variant="outline"
          data-testid="test-generation"
          onClick={() => testForge.mutate()}
          disabled={testForge.isPending}
        >
          Run test generation
        </Button>
      </section>

      <section className="rounded-xl border bg-card p-4">
        <h2 className="font-medium">Lyrics LLM (Ollama)</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {data.lyrics.available
            ? `Connected — model ${data.lyrics.model}`
            : "Not available — Generate Lyrics is hidden until Ollama is running."}
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
