/**
 * db/schema.ts — Drizzle schema for Wavesmith's SQLite database.
 *
 * Four tables (spec §5, implemented exactly):
 *   songs    — one row per generated take; takes from one Forge click share a
 *              variation_group_id. `quality_score` stays null (Gradio-only).
 *              `lrc` and `lyric_timings` are filled by the local aligner when it
 *              runs; the engine REST API still does not return them. See ENGINE_NOTES §7.
 *   jobs     — queue persistence; survives app restarts. The in-process queue
 *              re-enqueues `queued` rows on boot and fails orphaned `running` rows.
 *   stems    — one row per Demucs-separated track (vocals|drums|bass|other).
 *   midi_tracks — one row per transcribed MIDI export (master or per-stem source).
 *   settings — key/value store for app settings.
 */
import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

export const songs = sqliteTable("songs", {
  id: text("id").primaryKey(), // uuid
  title: text("title").notNull(), // LM-derived or user-edited
  prompt: text("prompt").notNull(), // the original user description
  lyrics: text("lyrics"),
  tags: text("tags").notNull().default("[]"), // JSON array of strings
  bpm: integer("bpm"),
  keyScale: text("key_scale"),
  timeSignature: text("time_signature"),
  durationS: real("duration_s"),
  seed: text("seed"), // explicit per-take seed (string; engine accepts int or string)
  model: text("model").notNull(), // engine DiT variant used (e.g. acestep-v15-turbo)
  variationGroupId: text("variation_group_id").notNull(), // groups takes from one Forge click
  audioPath: text("audio_path").notNull(), // relative to DATA_DIR/audio
  lrc: text("lrc"), // line-timed LRC from the local aligner; null until a timing job succeeds
  /** JSON LyricTimings (word + line). Null → the editor estimates cuts from tags. */
  lyricTimings: text("lyric_timings"),
  qualityScore: real("quality_score"), // engine REST API does not provide (M0); stays null
  artSeed: text("art_seed").notNull(), // drives deterministic procedural cover art
  favorite: integer("favorite", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at").notNull(), // epoch ms
  /** Source song when this row is a section repaint or an extend. Null for a fresh forge. */
  parentSongId: text("parent_song_id"),
  /** "repaint" rewrites a time range; "extend" continues with the base model's complete task. */
  editKind: text("edit_kind", { enum: ["repaint", "extend"] }),
});

export const jobs = sqliteTable("jobs", {
  id: text("id").primaryKey(), // uuid
  type: text("type", { enum: ["generate", "stems", "midi", "align"] }).notNull(),
  status: text("status", {
    enum: ["queued", "running", "succeeded", "failed"],
  }).notNull(),
  payload: text("payload").notNull(), // JSON: full request params
  result: text("result"), // JSON
  error: text("error"),
  progress: real("progress"), // 0..1 — engine reports fine-grained progress (M0-verified)
  songId: text("song_id"), // set for stems jobs / on generate success (first take)
  createdAt: integer("created_at").notNull(), // epoch ms
  startedAt: integer("started_at"),
  finishedAt: integer("finished_at"),
});

export const stems = sqliteTable("stems", {
  id: text("id").primaryKey(), // uuid
  songId: text("song_id")
    .notNull()
    .references(() => songs.id, { onDelete: "cascade" }),
  stemName: text("stem_name", {
    enum: ["vocals", "drums", "bass", "other"],
  }).notNull(),
  path: text("path").notNull(), // relative to DATA_DIR/audio
  createdAt: integer("created_at").notNull(), // epoch ms
});

export const MIDI_SOURCES = ["master", "vocals", "drums", "bass", "other"] as const;

export const midiTracks = sqliteTable("midi_tracks", {
  id: text("id").primaryKey(), // uuid
  songId: text("song_id")
    .notNull()
    .references(() => songs.id, { onDelete: "cascade" }),
  source: text("source", { enum: MIDI_SOURCES }).notNull(),
  path: text("path").notNull(), // relative to DATA_DIR/audio
  createdAt: integer("created_at").notNull(), // epoch ms
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

/** A phone that scanned a pairing code. The raw token is only in the phone's cookie. */
export const phoneDevices = sqliteTable("phone_devices", {
  id: text("id").primaryKey(),
  label: text("label").notNull(),
  tokenHash: text("token_hash").notNull(),
  createdAt: integer("created_at").notNull(),
  lastSeenAt: integer("last_seen_at"),
});

/** One unused pairing code. Shown on the Mac until a phone redeems it. */
export const phoneInvites = sqliteTable("phone_invites", {
  id: text("id").primaryKey(),
  code: text("code").notNull(),
  createdAt: integer("created_at").notNull(),
});

export type Song = typeof songs.$inferSelect;
export type NewSong = typeof songs.$inferInsert;
export type Job = typeof jobs.$inferSelect;
export type NewJob = typeof jobs.$inferInsert;
export type Stem = typeof stems.$inferSelect;
export type NewStem = typeof stems.$inferInsert;
export type MidiTrack = typeof midiTracks.$inferSelect;
export type NewMidiTrack = typeof midiTracks.$inferInsert;
