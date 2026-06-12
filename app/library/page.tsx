/**
 * Library page — M3 STUB. Lists forged songs from the database so the forge
 * flow has a visible destination ("Open in Library"). M4 replaces this with
 * the real grid/list, cover art, players, and song view.
 */
import { desc } from "drizzle-orm";
import { db, schema } from "@/lib/db";

export const dynamic = "force-dynamic";

export default function LibraryPage() {
  const songs = db
    .select()
    .from(schema.songs)
    .orderBy(desc(schema.songs.createdAt))
    .limit(100)
    .all();

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Library</h1>
      {songs.length === 0 ? (
        <p className="mt-6 text-muted-foreground">
          Nothing here yet — forge your first song on the Create page.
        </p>
      ) : (
        <ul className="mt-6 flex flex-col gap-2" data-testid="song-list">
          {songs.map((song) => (
            <li
              key={song.id}
              data-testid="song-item"
              className="flex items-center justify-between rounded-lg border bg-card px-4 py-3"
            >
              <div className="min-w-0">
                <p className="truncate font-medium">{song.title}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {song.model} · {song.durationS ? `${Math.round(song.durationS)}s` : "—"}
                  {song.bpm ? ` · ${song.bpm} bpm` : ""}
                  {song.keyScale ? ` · ${song.keyScale}` : ""}
                </p>
              </div>
              {/* M4 DELETES this element entirely (single-global-player invariant,
                  spec §3) — do not wrap or extend it. */}
              <audio
                controls
                preload="none"
                src={`/api/audio/${song.audioPath}`}
                aria-label={`Play ${song.title}`}
                className="h-8"
              />
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
