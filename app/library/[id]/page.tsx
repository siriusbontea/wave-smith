/**
 * Song view route — /library/[id] (spec §9.3).
 */
import { SongView } from "@/components/library/song-view";

export const dynamic = "force-dynamic";

export default async function SongPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-8">
      <SongView id={id} />
    </main>
  );
}
