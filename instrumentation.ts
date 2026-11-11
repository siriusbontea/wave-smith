/**
 * instrumentation.ts — Next.js server-boot hook (spec §8 names this file).
 *
 * Constructs the queue singleton at process start, which runs boot recovery
 * immediately: jobs left "queued" by a previous run resume, orphaned "running"
 * jobs are failed honestly. Without this, recovery would wait for the first
 * API hit — a restarted server with a queued forge would sit idle until
 * someone opened the UI.
 *
 * Also opens the phone gateway when that setting was left on. Home Wi-Fi mode
 * does not survive this boot. The Next server itself still binds 127.0.0.1.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { installPeerStamp } = await import("@/lib/phone/peer-stamp");
  installPeerStamp();
  const { ensureGatewaySecret } = await import("@/lib/phone/secret");
  ensureGatewaySecret();
  const { getQueue } = await import("@/lib/queue");
  getQueue();
  const { beginPhoneProcess } = await import("@/lib/phone/bind");
  beginPhoneProcess();
  const { phoneAccessEnabled } = await import("@/lib/phone/store");
  const { phoneGatewayError, phoneGatewayListening, syncPhoneGateway } = await import("@/lib/phone/gateway");
  void (async () => {
    for (let attempt = 0; attempt < 30; attempt++) {
      if (!process.env.PORT) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        continue;
      }
      await syncPhoneGateway();
      if (!phoneAccessEnabled() || phoneGatewayListening()) return;
      const reason = phoneGatewayError() ?? "";
      if (!reason.includes("Couldn't reach Wavesmith")) return;
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  })();
}
