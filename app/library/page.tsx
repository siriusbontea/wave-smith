/**
 * Library page (spec §9.3) — grid/list, search, favorites, export/import.
 * Playback uses the single global player (mini-player in the root layout).
 */
import { LibraryView } from "@/components/library/library-view";

export const dynamic = "force-dynamic";

export default function LibraryPage() {
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Library</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">Your songs</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Play anything here. Open a song to change a section, make it longer, or split it into parts.
      </p>
      <div className="mt-6">
        <LibraryView />
      </div>
    </main>
  );
}
