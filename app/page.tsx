/**
 * Placeholder home page (M1 skeleton). The Create page (spec §9.2) replaces
 * this in M3 — this exists so the skeleton builds, renders the dark theme,
 * and proves the app boots end-to-end.
 */
export default function Home() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-4xl font-semibold tracking-tight">Wavesmith</h1>
      <p className="text-muted-foreground">
        Local-first AI music studio — skeleton build (M1)
      </p>
    </main>
  );
}
