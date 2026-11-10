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

    // Theme tokens are oklch() values. hsl(var(--token)) never resolved, so the
    // wave was invisible. Canvas fillStyle accepts the computed oklch string.
    const colors = () => {
      const style = getComputedStyle(document.documentElement);
      return {
        waveColor: style.getPropertyValue("--muted-foreground").trim(),
        progressColor: style.getPropertyValue("--primary").trim(),
        cursorColor: style.getPropertyValue("--foreground").trim(),
      };
    };
    const ws = WaveSurfer.create({
      container: el,
      media,
      height: 96,
      ...colors(),
      barWidth: 2,
      barGap: 1,
      barRadius: 2,
      normalize: true,
      interact: true,
    });
    wsRef.current = ws;
    const theme = new MutationObserver(() => {
      ws.setOptions(colors());
    });
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

    return () => {
      theme.disconnect();
      ws.destroy();
      wsRef.current = null;
    };
  }, []);

  // Re-bind when a different song loads into the shared element.
  useEffect(() => {
    const ws = wsRef.current;
    const media = playerAudio();
    if (!ws || !media || current?.id !== songId) return;
    void ws.load(`/api/audio/${current.audioPath}`).catch((err: unknown) => {
      // wavesurfer aborts an in-flight peak fetch when load() is called again.
      if (!(err instanceof DOMException && err.name === "AbortError")) {
        console.warn("[waveform] load failed", err);
      }
    });
  }, [current?.id, songId, current?.audioPath]);

  return (
    <div
      ref={containerRef}
      data-testid="waveform"
      className="w-full rounded-lg border bg-card/50 px-2 py-3"
      aria-label="Waveform"
    />
  );
}
