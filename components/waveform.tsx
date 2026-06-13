/**
 * components/waveform.tsx — full waveform for the song view (spec §9.3).
 * wavesurfer v7 in MediaElement mode attaches to the single global
 * HTMLAudioElement (lib/audio/store.ts) so the mini-player and waveform
 * never double-play.
 */
"use client";

import { useEffect, useRef } from "react";
import WaveSurfer from "wavesurfer.js";
import { playerAudio, usePlayer } from "@/lib/audio/store";

export function Waveform({ songId }: { songId: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WaveSurfer | null>(null);
  const { current } = usePlayer();

  useEffect(() => {
    const el = containerRef.current;
    const media = playerAudio();
    if (!el || !media) return;

    const ws = WaveSurfer.create({
      container: el,
      media,
      height: 96,
      waveColor: "hsl(var(--muted-foreground) / 0.4)",
      progressColor: "hsl(var(--primary))",
      cursorColor: "hsl(var(--foreground))",
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      normalize: true,
      interact: true,
    });
    wsRef.current = ws;

    return () => {
      ws.destroy();
      wsRef.current = null;
    };
  }, []);

  // Re-bind when a different song loads into the shared element.
  useEffect(() => {
    const ws = wsRef.current;
    const media = playerAudio();
    if (!ws || !media || current?.id !== songId) return;
    void ws.load(`/api/audio/${current.audioPath}`);
  }, [current?.id, songId]);

  return (
    <div
      ref={containerRef}
      data-testid="waveform"
      className="w-full rounded-lg border bg-card/50 px-2 py-3"
      aria-label="Waveform"
    />
  );
}
