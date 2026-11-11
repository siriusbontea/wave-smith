/**
 * lib/phone/recheck-note.ts — the Check again toast.
 *
 * The text comes from the refresh result. A closed door is never reported
 * as still connected.
 */

export function recheckNote(status: { listening: boolean; urls: string[] }): string {
  if (!status.listening) return "Checked — no change, Tailscale still not found";
  const raw = status.urls[0];
  if (!raw) return "Still connected";
  try {
    return `Still connected at ${new URL(raw).hostname}`;
  } catch {
    return "Still connected";
  }
}
