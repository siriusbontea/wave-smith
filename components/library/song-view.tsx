/**
 * components/library/song-view.tsx — full song view (spec §9.3).
 * Waveform, metadata editor, plain lyrics, downloads, stems, delete.
 */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Pause, Play, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { CoverArt } from "@/components/cover-art";
import { SectionEditor } from "@/components/library/section-editor";
import { Waveform } from "@/components/waveform";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  deleteSong,
  fetchHealth,
  fetchJobs,
  fetchSong,
  forgeMidi,
  forgeStems,
  patchSong,
  type JobView,
  type MidiView,
  type SongView,
} from "@/lib/client/api";
import { NOTES_SETUP, PARTS_SETUP } from "@/lib/setup-hints";
import { usePlayer } from "@/lib/audio/store";
import { reportActionError } from "@/lib/client/report-error";
import { useHeldSubmit } from "@/lib/client/use-held-submit";
import { formatDate, formatTime } from "@/lib/format";

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;
const MIDI_SOURCES = ["master", "vocals", "drums", "bass", "other"] as const;
type MidiSource = (typeof MIDI_SOURCES)[number];

function JobProgress({ job, label }: { job: JobView; label: string }) {
  const pct = Math.round((job.progress ?? 0) * 100);
  return (
    <div className="mt-3 flex flex-col gap-1.5" data-testid={`${label}-job-progress`}>
      {job.status === "queued" ? (
        <p className="text-sm text-muted-foreground">Queued — waiting for other jobs to finish…</p>
      ) : (
        <>
          <div className="flex items-center justify-between gap-4 text-sm">
            <span className="truncate text-muted-foreground">{job.stage ?? "Working…"}</span>
            <span className="shrink-0 tabular-nums">{pct}%</span>
          </div>
          <div
            className="h-1.5 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
          </div>
          {pct < 20 ? (
            <p className="text-xs text-muted-foreground">
              CPU work — progress updates in bursts; long songs can take a few minutes.
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

export function SongView({ id }: { id: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: song, isLoading } = useQuery({
    queryKey: ["song", id],
    queryFn: ({ signal }) => fetchSong(id, signal),
  });
  const { data: jobs } = useQuery({
    queryKey: ["jobs"],
    queryFn: ({ signal }) => fetchJobs(signal),
    refetchInterval: (q) => {
      const active = q.state.data?.some((j) => j.status === "queued" || j.status === "running");
      return active ? 1000 : false;
    },
  });

  const { current, isPlaying, load, toggle, setRate, playbackRate } = usePlayer();
  const held = useHeldSubmit();
  const { data: health } = useQuery({
    queryKey: ["health"],
    queryFn: ({ signal }) => fetchHealth(signal),
    staleTime: 15_000,
  });
  const [title, setTitle] = useState("");
  const [lyrics, setLyrics] = useState("");
  const [bpm, setBpm] = useState("");
  const [keyScale, setKeyScale] = useState("");
  const [timeSig, setTimeSig] = useState<string>("");
  const [midiSource, setMidiSource] = useState<MidiSource>("master");
  const [formSongId, setFormSongId] = useState<string | null>(null);
  // Reset the editor when the route loads a different song. Doing this during
  // render (not in an effect) keeps unsaved edits if the same song refetches.
  if (song && song.id !== formSongId) {
    setFormSongId(song.id);
    setTitle(song.title);
    setLyrics(song.lyrics ?? "");
    setBpm(song.bpm != null ? String(song.bpm) : "");
    setKeyScale(song.keyScale ?? "");
    setTimeSig(song.timeSignature ?? "");
  }

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

  const dirty = Boolean(
    song &&
      (title !== song.title ||
        lyrics !== (song.lyrics ?? "") ||
        bpm !== (song.bpm != null ? String(song.bpm) : "") ||
        keyScale !== (song.keyScale ?? "") ||
        timeSig !== (song.timeSignature ?? "")),
  );
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const onClick = (event: MouseEvent) => {
      const anchor = (event.target as HTMLElement | null)?.closest("a");
      if (!anchor || anchor.hasAttribute("download") || anchor.target === "_blank") return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin || url.pathname === window.location.pathname) return;
      if (!window.confirm("You have unsaved changes. Leave without saving?")) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty]);

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
    mutationFn: (idempotencyKey: string) => forgeStems(id, idempotencyKey),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ["jobs"] });
      if (result.merged) {
        toast("Already started", { description: "That click was already queued." });
        return;
      }
      toast.success("Splitting the song", {
        description: health?.mockEngine
          ? "Demo mode saves copies of the full song, not a real split."
          : "This may take a few minutes. Playback can continue.",
      });
    },
    onError: (err) => reportActionError("Could not split the song", err),
  });

  const stemsJob = jobs?.find(
    (j) =>
      j.type === "stems" &&
      j.songId === id &&
      (j.status === "queued" || j.status === "running"),
  );
  const stemsReady = (song?.stems?.length ?? 0) === 4;

  const refreshedStemsJobRef = useRef<string | null>(null);
  useEffect(() => {
    const done = jobs?.find(
      (j) =>
        j.type === "stems" &&
        j.status === "succeeded" &&
        j.songId === id,
    );
    if (!done || refreshedStemsJobRef.current === done.id) return;
    refreshedStemsJobRef.current = done.id;
    void queryClient.invalidateQueries({ queryKey: ["song", id] });
  }, [jobs, id, queryClient]);

  const midiMutation = useMutation({
    mutationFn: (input: { source: MidiSource; idempotencyKey: string }) =>
      forgeMidi(id, input.source, input.idempotencyKey),
    onSuccess: (result) => {
      void queryClient.invalidateQueries({ queryKey: ["jobs"] });
      if (result.merged) {
        toast("Already started", { description: "That click was already queued." });
        return;
      }
      toast.success("Notes queued", {
        description: health?.mockEngine
          ? "Demo mode saves a sample notes file. It is not this song."
          : "This can take a minute. Playback can continue.",
      });
    },
    onError: (err) => reportActionError("Could not make the notes file", err),
  });

  const midiJob = jobs?.find(
    (j) =>
      j.type === "midi" &&
      j.songId === id &&
      (j.status === "queued" || j.status === "running"),
  );

  const refreshedMidiJobRef = useRef<string | null>(null);
  useEffect(() => {
    const done = jobs?.find(
      (j) => j.type === "midi" && j.status === "succeeded" && j.songId === id,
    );
    if (!done || refreshedMidiJobRef.current === done.id) return;
    refreshedMidiJobRef.current = done.id;
    void queryClient.invalidateQueries({ queryKey: ["song", id] });
  }, [jobs, id, queryClient]);

  const midiBySource = new Map((song?.midi ?? []).map((m) => [m.source, m]));
  const midiSourceOptions: MidiSource[] = stemsReady
    ? [...MIDI_SOURCES]
    : ["master"];

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
            {health?.mockEngine ? " · sample clip" : ""}
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
            {song.audioPath.toLowerCase().endsWith(".mp3") ? (
              <Button variant="outline" asChild>
                <a href={`/api/songs/${song.id}/download?format=mp3`} download data-testid="download-mp3">
                  <Download className="size-4" /> Download MP3
                </a>
              </Button>
            ) : (
              <>
                <Button variant="outline" asChild>
                  <a href={`/api/songs/${song.id}/download?format=wav`} download data-testid="download-wav">
                    <Download className="size-4" /> Download WAV
                  </a>
                </Button>
                <Button variant="outline" asChild>
                  <a href={`/api/songs/${song.id}/download?format=mp3`} download data-testid="download-mp3">
                    <Download className="size-4" /> Download MP3
                  </a>
                </Button>
              </>
            )}
          </div>
        </div>
      </div>

      <Waveform songId={song.id} />

      <SectionEditor
        key={song.id}
        songId={song.id}
        durationS={song.durationS}
        lyrics={lyrics}
        timings={song.lyricTimings ?? null}
        onLyricsChange={setLyrics}
        lyricsDirty={lyrics !== (song.lyrics ?? "")}
        onSaveLyrics={() => saveMutation.mutate()}
      />

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
            dir="auto"
            onChange={(e) => setLyrics(e.target.value)}
            rows={8}
            className="font-mono text-sm"
          />
          {song.lrc ? (
            <p className="text-xs text-muted-foreground">
              {song.lyricTimings?.source === "aligned"
                ? "Word timings are saved with this song."
                : song.lyricTimings?.source === "mock"
                  ? "Rough estimates are saved with this song. They are not measured times."
                  : "Line times are saved with this song."}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">
              No word timings yet. Use Time the lyrics in Sections.
            </p>
          )}
        </div>
        <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
          Save changes
        </Button>
      </section>

      <section className="rounded-xl border bg-card p-4" data-testid="stems-section">
        <h2 className="font-medium">Parts of the song</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {health?.mockEngine
            ? "Demo copies: each part is the full song, not a real split."
            : "Split the song into voice, drums, bass, and everything else."}
        </p>
        <details className="mt-1 text-sm text-muted-foreground">
          <summary className="cursor-pointer">How it works</summary>
          <p className="mt-1">A tool on this computer splits the song. It can take a few minutes.</p>
          <p className="mt-1">Setup command: {PARTS_SETUP}</p>
        </details>
        {stemsJob ? <JobProgress job={stemsJob} label="stems" /> : null}
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
            <Button variant="outline" asChild>
              <a href={`/api/songs/${song.id}/stems/download`} download data-testid="download-stems-zip">
                <Download className="size-4" /> Download parts
              </a>
            </Button>
          </div>
        ) : (
          <Button
            className="mt-4"
            data-testid="generate-stems"
            onClick={() => {
              void held
                .run("stems", (key) => stemsMutation.mutateAsync(key))
                .catch((err) => reportActionError("Could not split the song", err));
            }}
            disabled={stemsMutation.isPending || held.busy || !!stemsJob}
          >
            {stemsJob ? "Splitting…" : "Split into parts"}
          </Button>
        )}
      </section>

      <section className="rounded-xl border bg-card p-4" data-testid="midi-section">
        <h2 className="font-medium">Notes file</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {health?.mockEngine
            ? "Demo sample: this notes file is not a transcription of this song."
            : "Turn the audio into a rough music-notation file."}
        </p>
        <details className="mt-1 text-sm text-muted-foreground">
          <summary className="cursor-pointer">How it works</summary>
          <p className="mt-1">A tool on this computer guesses the notes. The file is saved with the song.</p>
          <p className="mt-1">Setup command: {NOTES_SETUP}</p>
        </details>
        {midiJob ? (
          <JobProgress
            job={midiJob}
            label="midi"
          />
        ) : null}
        {midiJob?.midiSource && midiJob.midiSource !== midiSource ? (
          <p className="mt-2 text-xs text-muted-foreground">
            Making notes from <span className="capitalize">{midiJob.midiSource === "master" ? "the full song" : midiJob.midiSource}</span>…
          </p>
        ) : null}
        {(song.midi?.length ?? 0) > 0 ? (
          <ul className="mt-4 flex flex-col gap-2">
            {song.midi!.map((m: MidiView) => (
              <li key={m.id} className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
                <div className="min-w-0">
                  <span className="capitalize text-sm">{m.source === "master" ? "Full mix" : m.source}</span>
                  <p className="truncate font-mono text-xs text-muted-foreground">{m.path}</p>
                </div>
                <Button variant="outline" size="sm" asChild>
                  <a href={`/api/audio/${m.path}`} download data-testid={`download-midi-${m.source}`}>
                    <Download className="size-4" /> Download notes
                  </a>
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Select value={midiSource} onValueChange={(v) => setMidiSource(v as MidiSource)}>
            <SelectTrigger className="w-36" aria-label="Which audio to turn into notes" data-testid="midi-source-select">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {midiSourceOptions.map((s) => (
                <SelectItem key={s} value={s}>
                  {s === "master" ? "Full mix" : s.charAt(0).toUpperCase() + s.slice(1)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            data-testid="generate-midi"
            onClick={() => {
              void held
                .run(`notes-${midiSource}`, (key) =>
                  midiMutation.mutateAsync({ source: midiSource, idempotencyKey: key }),
                )
                .catch((err) => reportActionError("Could not make the notes file", err));
            }}
            disabled={midiMutation.isPending || held.busy || !!midiJob}
          >
            {midiJob && midiJob.midiSource === midiSource
              ? "Making notes…"
              : midiJob
                ? "Making notes from another part…"
                : midiBySource.get(midiSource)
                  ? "Make the notes again"
                  : "Make a notes file"}
          </Button>
        </div>
      </section>

      <div className="flex items-center justify-between border-t pt-6">
        <Link href="/library" className="inline-flex min-h-6 items-center text-sm text-muted-foreground hover:text-foreground">
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
