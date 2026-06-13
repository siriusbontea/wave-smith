/**
 * components/library/song-view.tsx — full song view (spec §9.3).
 * Waveform, metadata editor, plain lyrics, downloads, stems, delete.
 */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Pause, Play, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { CoverArt } from "@/components/cover-art";
import { Waveform } from "@/components/waveform";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  deleteSong,
  fetchJobs,
  fetchSong,
  forgeStems,
  patchSong,
  type SongView,
} from "@/lib/client/api";
import { usePlayer } from "@/lib/audio/store";
import { formatDate, formatTime } from "@/lib/format";

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

export function SongView({ id }: { id: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: song, isLoading } = useQuery({ queryKey: ["song", id], queryFn: () => fetchSong(id) });
  const { data: jobs } = useQuery({
    queryKey: ["jobs"],
    queryFn: fetchJobs,
    refetchInterval: (q) => {
      const active = q.state.data?.some((j) => j.status === "queued" || j.status === "running");
      return active ? 1000 : false;
    },
  });

  const { current, isPlaying, load, toggle, setRate, playbackRate } = usePlayer();
  const [title, setTitle] = useState("");
  const [lyrics, setLyrics] = useState("");
  const [bpm, setBpm] = useState("");
  const [keyScale, setKeyScale] = useState("");
  const [timeSig, setTimeSig] = useState<string>("");

  useEffect(() => {
    if (!song) return;
    setTitle(song.title);
    setLyrics(song.lyrics ?? "");
    setBpm(song.bpm != null ? String(song.bpm) : "");
    setKeyScale(song.keyScale ?? "");
    setTimeSig(song.timeSignature ?? "");
  }, [song]);

  // Stage this song in the shared player without autoplay (waveform binds here).
  useEffect(() => {
    if (!song) return;
    load(
      {
        id: song.id,
        title: song.title,
        artSeed: song.artSeed,
        audioPath: song.audioPath,
        durationS: song.durationS,
      },
      false,
    );
  }, [song, load]);

  const saveMutation = useMutation({
    mutationFn: () =>
      patchSong(id, {
        title: title.trim() || song!.title,
        lyrics: lyrics.trim() ? lyrics : null,
        bpm: bpm ? Number(bpm) : null,
        keyScale: keyScale || null,
        timeSignature: (timeSig as "2" | "3" | "4" | "6") || null,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["song", id] });
      void queryClient.invalidateQueries({ queryKey: ["songs"] });
      toast.success("Saved");
    },
    onError: (err) => toast.error("Save failed", { description: err.message }),
  });

  const deleteMutation = useMutation({
    mutationFn: () => deleteSong(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["songs"] });
      router.push("/library");
      toast.success("Song deleted");
    },
    onError: (err) => toast.error("Delete failed", { description: err.message }),
  });

  const stemsMutation = useMutation({
    mutationFn: () => forgeStems(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["jobs"] });
      toast.success("Stem separation queued", {
        description: "This may take a few minutes on CPU.",
      });
    },
    onError: (err) => toast.error("Could not start stems", { description: err.message }),
  });

  const stemsJob = jobs?.find(
    (j) =>
      j.type === "stems" &&
      j.result &&
      "songId" in j.result &&
      j.result.songId === id &&
      (j.status === "queued" || j.status === "running"),
  );
  const stemsReady = (song?.stems?.length ?? 0) === 4;

  useEffect(() => {
    const succeeded = jobs?.some(
      (j) =>
        j.type === "stems" &&
        j.status === "succeeded" &&
        j.result &&
        "songId" in j.result &&
        j.result.songId === id,
    );
    if (succeeded) void queryClient.invalidateQueries({ queryKey: ["song", id] });
  }, [jobs, id, queryClient]);

  if (isLoading || !song) {
    return <p className="py-16 text-center text-muted-foreground">{isLoading ? "Loading…" : "Song not found."}</p>;
  }

  const isCurrent = current?.id === song.id;

  return (
    <div className="flex flex-col gap-8" data-testid="song-view">
      <div className="flex flex-wrap items-start gap-6">
        <CoverArt seed={song.artSeed} className="size-40 shrink-0 rounded-xl" />
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">{song.title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {song.durationS ? formatTime(song.durationS) : "—"} · {formatDate(song.createdAt)}
            {song.bpm ? ` · ${song.bpm} bpm` : ""}
            {song.keyScale ? ` · ${song.keyScale}` : ""}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              data-testid="song-play"
              onClick={() => (isCurrent ? toggle() : load({
                id: song.id,
                title: song.title,
                artSeed: song.artSeed,
                audioPath: song.audioPath,
                durationS: song.durationS,
              }, true))}
            >
              {isCurrent && isPlaying ? <Pause className="size-4" /> : <Play className="size-4" />}
              {isCurrent && isPlaying ? "Pause" : "Play"}
            </Button>
            <a href={`/api/songs/${song.id}/download?format=wav`} download>
              <Button variant="outline" data-testid="download-wav">
                <Download className="size-4" /> WAV
              </Button>
            </a>
            <a href={`/api/songs/${song.id}/download?format=mp3`} download>
              <Button variant="outline" data-testid="download-mp3">
                <Download className="size-4" /> MP3
              </Button>
            </a>
          </div>
        </div>
      </div>

      <Waveform songId={song.id} />

      <div className="flex items-center gap-4">
        <Label className="shrink-0 text-sm">Speed</Label>
        <Select
          value={String(playbackRate)}
          onValueChange={(v) => setRate(Number(v))}
        >
          <SelectTrigger className="w-28" aria-label="Playback speed">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SPEEDS.map((s) => (
              <SelectItem key={s} value={String(s)}>
                {s}×
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <section className="grid gap-4 rounded-xl border bg-card p-4">
        <h2 className="font-medium">Metadata</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="title">Title</Label>
            <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="bpm">BPM</Label>
            <Input id="bpm" type="number" value={bpm} onChange={(e) => setBpm(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="key">Key / scale</Label>
            <Input id="key" value={keyScale} onChange={(e) => setKeyScale(e.target.value)} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="time">Time signature</Label>
            <Select value={timeSig || "none"} onValueChange={(v) => setTimeSig(v === "none" ? "" : v)}>
              <SelectTrigger id="time"><SelectValue placeholder="—" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">—</SelectItem>
                {(["2", "3", "4", "6"] as const).map((t) => (
                  <SelectItem key={t} value={t}>{t}/4</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="lyrics">Lyrics</Label>
          <Textarea
            id="lyrics"
            data-testid="song-lyrics"
            value={lyrics}
            onChange={(e) => setLyrics(e.target.value)}
            rows={8}
            className="font-mono text-sm"
          />
          {song.lrc ? (
            <p className="text-xs text-muted-foreground">Synced lyrics available (LRC).</p>
          ) : null}
        </div>
        <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
          Save changes
        </Button>
      </section>

      <section className="rounded-xl border bg-card p-4" data-testid="stems-section">
        <h2 className="font-medium">Stems</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Separate into vocals, drums, bass, and other (Demucs on CPU — may take a few minutes).
        </p>
        {stemsReady ? (
          <div className="mt-4 flex flex-col gap-3">
            <div className="grid gap-2 sm:grid-cols-2">
              {song.stems!.map((stem) => (
                <div key={stem.id} className="flex items-center justify-between rounded-lg border px-3 py-2">
                  <span className="capitalize text-sm">{stem.stemName}</span>
                  <audio controls preload="none" src={`/api/audio/${stem.path}`} className="h-8 max-w-[200px]" />
                </div>
              ))}
            </div>
            <a href={`/api/songs/${song.id}/stems/download`} download>
              <Button variant="outline" data-testid="download-stems-zip">
                <Download className="size-4" /> Download stems ZIP
              </Button>
            </a>
          </div>
        ) : (
          <Button
            className="mt-4"
            data-testid="generate-stems"
            onClick={() => stemsMutation.mutate()}
            disabled={stemsMutation.isPending || !!stemsJob}
          >
            {stemsJob
              ? `Separating… ${Math.round((stemsJob.progress ?? 0) * 100)}%`
              : "Generate stems"}
          </Button>
        )}
      </section>

      <div className="flex items-center justify-between border-t pt-6">
        <Link href="/library" className="text-sm text-muted-foreground hover:text-foreground">
          ← Back to library
        </Link>
        <Button
          variant="destructive"
          size="sm"
          data-testid="delete-song"
          onClick={() => {
            if (window.confirm(`Delete "${song.title}"? This cannot be undone.`)) {
              deleteMutation.mutate();
            }
          }}
        >
          <Trash2 className="size-4" /> Delete
        </Button>
      </div>
    </div>
  );
}
