/**
 * components/mini-player.tsx — the persistent bottom bar (spec §9.5).
 * Spotify-style: art, title, play/pause, seek, elapsed/total. Lives in the
 * root layout so it persists across navigation, powered by the single global
 * audio element (lib/audio/store.ts). Hidden until something is loaded.
 */
"use client";

import { Pause, Play } from "lucide-react";
import Link from "next/link";
import { CoverArt } from "@/components/cover-art";
import { Slider } from "@/components/ui/slider";
import { usePlayer } from "@/lib/audio/store";
import { formatTime } from "@/lib/format";

export function MiniPlayer() {
  const { current, isPlaying, currentTime, duration, toggle, seek } = usePlayer();
  if (!current) return null;

  const total = duration || current.durationS || 0;

  return (
    <div
      data-testid="mini-player"
      className="sticky bottom-0 z-20 flex items-center gap-4 border-t bg-card/95 px-4 py-2 backdrop-blur"
    >
      <Link href={`/library/${current.id}`} className="flex min-w-0 items-center gap-3">
        <CoverArt seed={current.artSeed} className="size-11 shrink-0 rounded" />
        <span className="truncate text-sm font-medium">{current.title}</span>
      </Link>

      <button
        type="button"
        onClick={toggle}
        aria-label={isPlaying ? "Pause" : "Play"}
        className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"
      >
        {isPlaying ? <Pause className="size-4" /> : <Play className="size-4 translate-x-0.5" />}
      </button>

      <div className="flex flex-1 items-center gap-2 text-xs tabular-nums text-muted-foreground">
        <span>{formatTime(currentTime)}</span>
        <Slider
          aria-label="Seek"
          value={[total ? (currentTime / total) * 100 : 0]}
          max={100}
          step={0.1}
          onValueChange={([v]) => seek(((v ?? 0) / 100) * total)}
          className="flex-1"
        />
        <span>{formatTime(total)}</span>
      </div>
    </div>
  );
}
