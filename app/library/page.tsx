/**
 * Library page (spec §9.3) — grid/list, search, favorites, export/import.
 * Playback uses the single global player (mini-player in the root layout).
 */
import { LibraryView } from "@/components/library/library-view";

export const dynamic = "force-dynamic";

export default function LibraryPage() {
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">Library</h1>
      <div className="mt-6">
        <LibraryView />
      </div>
    </main>
  );
}
