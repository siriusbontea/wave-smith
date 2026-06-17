/**
 * lib/songs/queries.ts — typed song read/write helpers shared by the song
 * API routes. Keeps SQL in one place and shapes a client-friendly DTO
 * (tags parsed from JSON, booleans normalized).
 */
import fs from "node:fs";
import path from "node:path";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { env } from "@/lib/env";
import type { Song, Stem, MidiTrack } from "@/db/schema";

export interface SongDTO {
  id: string;
  title: string;
  prompt: string;
  lyrics: string | null;
  tags: string[];
  bpm: number | null;
  keyScale: string | null;
  timeSignature: string | null;
  durationS: number | null;
  seed: string | null;
  model: string;
  variationGroupId: string;
  audioPath: string;
  lrc: string | null;
  qualityScore: number | null;
  artSeed: string;
  favorite: boolean;
  createdAt: number;
}

export function toDTO(row: Song): SongDTO {
  let tags: string[] = [];
  try {
    const parsed: unknown = JSON.parse(row.tags);
    if (Array.isArray(parsed)) tags = parsed.filter((t): t is string => typeof t === "string");
  } catch {
    /* leave empty */
  }
  return { ...row, tags, favorite: row.favorite };
}

export function listSongs(): SongDTO[] {
  return db
    .select()
    .from(schema.songs)
    .orderBy(desc(schema.songs.createdAt))
    .all()
    .map(toDTO);
}

export interface StemDTO {
  id: string;
  stemName: "vocals" | "drums" | "bass" | "other";
  path: string;
  createdAt: number;
}

export interface MidiDTO {
  id: string;
  source: "master" | "vocals" | "drums" | "bass" | "other";
  path: string;
  createdAt: number;
}

export interface SongWithStemsDTO extends SongDTO {
  stems: StemDTO[];
}

export interface SongDetailDTO extends SongWithStemsDTO {
  midi: MidiDTO[];
}

function toStemDTO(row: Stem): StemDTO {
  return {
    id: row.id,
    stemName: row.stemName,
    path: row.path,
    createdAt: row.createdAt,
  };
}

function toMidiDTO(row: MidiTrack): MidiDTO {
  return {
    id: row.id,
    source: row.source,
    path: row.path,
    createdAt: row.createdAt,
  };
}

export function listStemsForSong(songId: string): StemDTO[] {
  return db
    .select()
    .from(schema.stems)
    .where(eq(schema.stems.songId, songId))
    .all()
    .map(toStemDTO);
}

export function listMidiForSong(songId: string): MidiDTO[] {
  return db
    .select()
    .from(schema.midiTracks)
    .where(eq(schema.midiTracks.songId, songId))
    .all()
    .map(toMidiDTO);
}

export function getSong(id: string): SongDTO | null {
  const row = db.select().from(schema.songs).where(eq(schema.songs.id, id)).get();
  return row ? toDTO(row) : null;
}

export function getSongWithStems(id: string): SongWithStemsDTO | null {
  const song = getSong(id);
  if (!song) return null;
  return { ...song, stems: listStemsForSong(id) };
}

export function getSongDetail(id: string): SongDetailDTO | null {
  const song = getSongWithStems(id);
  if (!song) return null;
  return { ...song, midi: listMidiForSong(id) };
}

export interface SongPatch {
  title?: string;
  lyrics?: string | null;
  tags?: string[];
  bpm?: number | null;
  keyScale?: string | null;
  timeSignature?: string | null;
  favorite?: boolean;
}

export function updateSong(id: string, patch: SongPatch): SongDTO | null {
  const set: Partial<Song> = {};
  if (patch.title !== undefined) set.title = patch.title;
  if (patch.lyrics !== undefined) set.lyrics = patch.lyrics;
  if (patch.tags !== undefined) set.tags = JSON.stringify(patch.tags);
  if (patch.bpm !== undefined) set.bpm = patch.bpm;
  if (patch.keyScale !== undefined) set.keyScale = patch.keyScale;
  if (patch.timeSignature !== undefined) set.timeSignature = patch.timeSignature;
  if (patch.favorite !== undefined) set.favorite = patch.favorite;
  if (Object.keys(set).length === 0) return getSong(id);
  db.update(schema.songs).set(set).where(eq(schema.songs.id, id)).run();
  return getSong(id);
}

/** Delete the row (stems/midi cascade via FK) and remove the on-disk audio dir. */
export function deleteSong(id: string): boolean {
  const song = getSong(id);
  if (!song) return false;
  db.delete(schema.songs).where(eq(schema.songs.id, id)).run();
  const songDir = path.resolve(env.audioDir, path.dirname(song.audioPath));
  if (songDir.startsWith(env.audioDir + path.sep)) {
    fs.rmSync(songDir, { recursive: true, force: true });
  }
  return true;
}

/** Absolute master-audio path for a song, confined to the audio dir. */
export function songAudioAbsPath(song: SongDTO): string | null {
  const abs = path.resolve(env.audioDir, song.audioPath);
  if (abs !== env.audioDir && !abs.startsWith(env.audioDir + path.sep)) return null;
  return abs;
}
