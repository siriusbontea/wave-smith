/**
 * components/library/song-card.tsx — one song in the library grid/list.
 * Cover art, title, tags, duration/date, favorite toggle, and a play button
 * that drives the single global player. Clicking the card opens the song view.
 */
"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Heart, Pause, Play } from "lucide-react";
import Link from "next/link";
import { CoverArt } from "@/components/cover-art";
import { patchSong, type SongView } from "@/lib/client/api";
import { usePlayer } from "@/lib/audio/store";
import { formatDate, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export function SongCard({ song, view }: { song: SongView; view: "grid" | "list" }) {
  const { current, isPlaying, playSong } = usePlayer();
  const queryClient = useQueryClient();
  const isCurrent = current?.id === song.id;

  const favMutation = useMutation({
    mutationFn: () => patchSong(song.id, { favorite: !song.favorite }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["songs"] }),
  });

  const take = song.title.match(/^(.*) \(take (\d+)\)$/);
  const displayTitle = take?.[1] ?? song.title;
  const takeLabel = take ? `Take ${take[2]}` : null;

  const playerSong = {
    id: song.id,
    title: song.title,
    artSeed: song.artSeed,
    audioPath: song.audioPath,
    durationS: song.durationS,
  };

  const PlayButton = (
    <button
      type="button"
      data-testid="play-button"
      onClick={(e) => {
        e.preventDefault();
        playSong(playerSong);
      }}
      aria-label={isCurrent && isPlaying ? `Pause ${song.title}` : `Play ${song.title}`}
      className="flex size-10 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg"
    >
      {isCurrent && isPlaying ? <Pause className="size-4" /> : <Play className="size-4 translate-x-0.5" />}
    </button>
  );

  const FavButton = (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        favMutation.mutate();
      }}
      aria-label={song.favorite ? "Remove favorite" : "Add favorite"}
      aria-pressed={song.favorite}
      className="text-muted-foreground hover:text-foreground"
    >
      <Heart className={cn("size-4", song.favorite && "fill-current text-red-400")} />
    </button>
  );

  const meta = (
    <p className="truncate text-xs text-muted-foreground">
      {song.durationS ? formatTime(song.durationS) : "—"} · {formatDate(song.createdAt)}
      {song.bpm ? ` · ${song.bpm} bpm` : ""}
      {song.editKind === "repaint" ? " · section edit" : song.editKind === "extend" ? " · extended" : ""}
    </p>
  );

  if (view === "list") {
    return (
      <div
        className="flex items-center gap-3 rounded-lg border bg-card px-3 py-2 hover:bg-accent/40"
      >
        <CoverArt seed={song.artSeed} className="size-12 shrink-0 rounded" />
        {PlayButton}
        <Link href={`/library/${song.id}`} data-testid="song-item" className="min-w-0 flex-1">
          <p className="flex items-center gap-2 text-sm font-medium">
            <span className="truncate">{displayTitle}</span>
            {takeLabel ? (
              <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs">{takeLabel}</span>
            ) : null}
          </p>
          {meta}
        </Link>
        {FavButton}
      </div>
    );
  }

  return (
    <div className="group relative flex flex-col gap-2 rounded-xl border bg-card p-3 hover:bg-accent/40">
      <Link href={`/library/${song.id}`} data-testid="song-item" className="flex min-w-0 flex-col gap-2">
        <div className="relative aspect-square overflow-hidden rounded-lg">
          <CoverArt seed={song.artSeed} className="size-full" />
        </div>
        <div className="min-w-0 pe-6">
          <p className="flex items-center gap-2 text-sm font-medium">
            <span className="truncate">{displayTitle}</span>
            {takeLabel ? (
              <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs">{takeLabel}</span>
            ) : null}
          </p>
          {meta}
        </div>
      </Link>
      <div className="absolute right-5 top-5 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
        {PlayButton}
      </div>
      <div className="absolute bottom-3 right-3">{FavButton}</div>
    </div>
  );
}
