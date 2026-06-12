/**
 * instrumentation.ts — Next.js server-boot hook (spec §8 names this file).
 *
 * Constructs the queue singleton at process start, which runs boot recovery
 * immediately: jobs left "queued" by a previous run resume, orphaned "running"
 * jobs are failed honestly. Without this, recovery would wait for the first
 * API hit — a restarted server with a queued forge would sit idle until
 * someone opened the UI.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { getQueue } = await import("@/lib/queue");
    getQueue();
  }
}
