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

  if (view === "list") {
    return (
      <Link
        href={`/library/${song.id}`}
        data-testid="song-item"
        className="flex items-center gap-3 rounded-lg border bg-card px-3 py-2 hover:bg-accent/40"
      >
        <div className="relative shrink-0">
          <CoverArt seed={song.artSeed} className="size-12 rounded" />
        </div>
        {PlayButton}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{song.title}</p>
          <p className="truncate text-xs text-muted-foreground">
            {song.durationS ? formatTime(song.durationS) : "—"} · {formatDate(song.createdAt)}
            {song.bpm ? ` · ${song.bpm} bpm` : ""}
          </p>
        </div>
        {FavButton}
      </Link>
    );
  }

  return (
    <Link
      href={`/library/${song.id}`}
      data-testid="song-item"
      className="group flex flex-col gap-2 rounded-xl border bg-card p-3 hover:bg-accent/40"
    >
      <div className="relative aspect-square overflow-hidden rounded-lg">
        <CoverArt seed={song.artSeed} className="size-full" />
        <div className="absolute bottom-2 right-2 opacity-0 transition-opacity group-hover:opacity-100">
          {PlayButton}
        </div>
      </div>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{song.title}</p>
          <p className="truncate text-xs text-muted-foreground">
            {song.durationS ? formatTime(song.durationS) : "—"} · {formatDate(song.createdAt)}
          </p>
        </div>
        {FavButton}
      </div>
    </Link>
  );
}
