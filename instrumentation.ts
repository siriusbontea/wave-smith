/**
 * instrumentation.ts — Next.js server-boot hook (spec §8 names this file).
 *
 * Constructs the queue singleton at process start, which runs boot recovery
 * immediately: jobs left "queued" by a previous run resume, orphaned "running"
 * jobs are failed honestly. Without this, recovery would wait for the first
 * API hit — a restarted server with a queued forge would sit idle until
 * someone opened the UI.
 *
 * Also opens the phone gateway when that setting was left on. The Next server
 * itself still binds 127.0.0.1.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { getQueue } = await import("@/lib/queue");
  getQueue();
  const { syncPhoneGateway } = await import("@/lib/phone/gateway");
  await syncPhoneGateway();
}
