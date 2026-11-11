/**
 * lib/client/intent.ts — one idempotency key per click.
 *
 * A second call inside the window reuses the key (a double-click). A later
 * call mints a new key, so forging the same prompt again is a new song.
 */

export const DOUBLE_CLICK_WINDOW_MS = 600;

/**
 * v4 UUID from getRandomValues. crypto.randomUUID is missing on plain HTTP
 * pages that are not localhost, which is how a phone opens Wavesmith.
 */
export function mintId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function nextIntent(
  previous: { key: string; at: number } | null,
  now: number,
  mint: () => string = mintId,
  windowMs = DOUBLE_CLICK_WINDOW_MS,
): { key: string; at: number; reused: boolean } {
  if (previous && now - previous.at >= 0 && now - previous.at < windowMs) {
    return { key: previous.key, at: previous.at, reused: true };
  }
  return { key: mint(), at: now, reused: false };
}
