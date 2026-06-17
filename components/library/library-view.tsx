/**
 * components/library/library-view.tsx — the Library page body (spec §9.3).
 * Grid/list toggle, search + tag filter, favorites filter, variation grouping
 * (takes from one Forge click cluster together), export/import. Polls /api/songs
 * so a forge in progress shows up when it lands.
 */
"use client";

import { useQuery } from "@tanstack/react-query";
import { Grid2x2, List, Upload } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { SongCard } from "@/components/library/song-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fetchSongs, importLibrary, type SongView } from "@/lib/client/api";
import { cn } from "@/lib/utils";

export function LibraryView() {
  const { data: songs, refetch } = useQuery({
    queryKey: ["songs"],
    queryFn: ({ signal }) => fetchSongs(signal),
  });
  const [view, setView] = useState<"grid" | "list">("grid");
  const [search, setSearch] = useState("");
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const allTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of songs ?? []) for (const t of s.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20).map(([t]) => t);
  }, [songs]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (songs ?? []).filter((s) => {
      if (favoritesOnly && !s.favorite) return false;
      if (activeTag && !s.tags.includes(activeTag)) return false;
      if (q && !s.title.toLowerCase().includes(q) && !s.prompt.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [songs, search, activeTag, favoritesOnly]);

  // Group by variationGroupId, preserving newest-first order of first appearance.
  const groups = useMemo(() => {
    const map = new Map<string, SongView[]>();
    for (const s of filtered) {
      const arr = map.get(s.variationGroupId);
      if (arr) arr.push(s);
      else map.set(s.variationGroupId, [s]);
    }
    return [...map.values()];
  }, [filtered]);

  async function onImportFile(file: File) {
    try {
      const json: unknown = JSON.parse(await file.text());
      const { imported, missingAudio } = await importLibrary(json);
      await refetch();
      toast.success(`Imported ${imported} songs`, {
        description: missingAudio ? `${missingAudio} have no audio on disk yet.` : undefined,
      });
    } catch (err) {
      toast.error("Import failed", { description: err instanceof Error ? err.message : undefined });
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          data-testid="library-search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search title or prompt…"
          className="h-9 max-w-xs"
        />
        <Button
          variant={favoritesOnly ? "default" : "outline"}
          size="sm"
          onClick={() => setFavoritesOnly((v) => !v)}
          aria-pressed={favoritesOnly}
        >
          Favorites
        </Button>
        <div className="ml-auto flex items-center gap-2">
          <a href="/api/library/export" download>
            <Button variant="outline" size="sm">Export</Button>
          </a>
          <Button variant="outline" size="sm" onClick={() => fileInput.current?.click()}>
            <Upload className="size-4" /> Import
          </Button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onImportFile(f);
              e.target.value = "";
            }}
          />
          <div className="flex rounded-md border">
            <button
              type="button"
              onClick={() => setView("grid")}
              aria-label="Grid view"
              aria-pressed={view === "grid"}
              className={cn("p-2", view === "grid" && "bg-accent")}
            >
              <Grid2x2 className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => setView("list")}
              aria-label="List view"
              aria-pressed={view === "list"}
              className={cn("p-2", view === "list" && "bg-accent")}
            >
              <List className="size-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Tag filter */}
      {allTags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {allTags.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setActiveTag((cur) => (cur === t ? null : t))}
              aria-pressed={activeTag === t}
              className={cn(
                "rounded-full border px-2.5 py-0.5 text-xs",
                activeTag === t ? "bg-primary text-primary-foreground" : "text-muted-foreground",
              )}
            >
              {t}
            </button>
          ))}
        </div>
      )}

      {/* Content */}
      {!songs ? (
        <p className="py-16 text-center text-muted-foreground">Loading…</p>
      ) : groups.length === 0 ? (
        <div className="py-16 text-center text-muted-foreground" data-testid="library-empty">
          {songs.length === 0 ? (
            <>Nothing here yet — <a href="/" className="underline">forge your first song</a>.</>
          ) : (
            "No songs match your filters."
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {groups.map((group) => (
            <div key={group[0]!.variationGroupId} className="flex flex-col gap-2">
              {group.length > 1 && (
                <p className="text-xs font-medium text-muted-foreground">
                  {group.length} variations
                </p>
              )}
              <div
                className={cn(
                  view === "grid"
                    ? "grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4"
                    : "flex flex-col gap-2",
                )}
              >
                {group.map((song) => (
                  <SongCard key={song.id} song={song} view={view} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
