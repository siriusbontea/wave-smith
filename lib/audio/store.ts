/**
 * lib/audio/store.ts — the single audio playback owner (spec §3).
 *
 * One global HTMLAudioElement, created lazily in the browser and managed by a
 * Zustand store. The mini-player drives it directly; the song-view waveform
 * (wavesurfer v7) attaches in MediaElement mode to THIS SAME element via
 * playerAudio(). There is never a second audio engine — this is how
 * double-playback bugs are prevented.
 *
 * The store is a module singleton, so playback survives client-side route
 * navigation (the mini-player lives in the root layout and keeps playing).
 */
"use client";

import { create } from "zustand";

export interface PlayerSong {
  id: string;
  title: string;
  artSeed: string;
  audioPath: string; // relative to DATA_DIR/audio; served at /api/audio/<path>
  durationS: number | null;
}

interface PlayerState {
  current: PlayerSong | null;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  playbackRate: number;
  /** Load a song into the shared element. autoplay=false just stages it
   *  (e.g. so the song-view waveform can bind without starting playback). */
  load: (song: PlayerSong, autoplay?: boolean) => void;
  /** Play if loading a new song; toggle if it's already current. */
  playSong: (song: PlayerSong) => void;
  toggle: () => void;
  seek: (seconds: number) => void;
  setRate: (rate: number) => void;
}

let audio: HTMLAudioElement | null = null;

/** The shared element, created + wired once (browser only). Exposed for
 *  wavesurfer's `media` option so the waveform shares this exact element. */
export function playerAudio(): HTMLAudioElement | null {
  return audio;
}

function ensureAudio(set: (p: Partial<PlayerState>) => void): HTMLAudioElement {
  if (audio) return audio;
  const el = new Audio();
  el.preload = "metadata";
  el.addEventListener("timeupdate", () => set({ currentTime: el.currentTime }));
  el.addEventListener("durationchange", () =>
    set({ duration: Number.isFinite(el.duration) ? el.duration : 0 }),
  );
  el.addEventListener("play", () => set({ isPlaying: true }));
  el.addEventListener("pause", () => set({ isPlaying: false }));
  el.addEventListener("ended", () => set({ isPlaying: false, currentTime: 0 }));
  audio = el;
  return el;
}

function safePlay(el: HTMLAudioElement): void {
  // play() rejects with AbortError when interrupted (e.g. rapid toggle) — benign.
  void el.play().catch((err: unknown) => {
    if (!isAbortError(err)) console.warn("[player] play failed", err);
  });
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

export const usePlayer = create<PlayerState>((set, get) => ({
  current: null,
  isPlaying: false,
  currentTime: 0,
  duration: 0,
  playbackRate: 1,

  load: (song, autoplay = false) => {
    const el = ensureAudio(set);
    if (get().current?.id !== song.id) {
      el.src = `/api/audio/${song.audioPath}`;
      el.playbackRate = get().playbackRate;
      set({ current: song, currentTime: 0, duration: song.durationS ?? 0 });
    }
    if (autoplay) safePlay(el);
  },

  playSong: (song) => {
    if (get().current?.id === song.id) {
      get().toggle();
      return;
    }
    get().load(song, true);
  },

  toggle: () => {
    const el = audio;
    if (!el || !get().current) return;
    if (el.paused) safePlay(el);
    else el.pause();
  },

  seek: (seconds) => {
    const el = audio;
    if (!el) return;
    el.currentTime = seconds;
    set({ currentTime: seconds });
  },

  setRate: (rate) => {
    if (audio) audio.playbackRate = rate;
    set({ playbackRate: rate });
  },
}));
