/**
 * lib/client/intent.ts — one idempotency key per click.
 *
 * A second call inside the window reuses the key (a double-click). A later
 * call mints a new key, so forging the same prompt again is a new song.
 */

export const DOUBLE_CLICK_WINDOW_MS = 600;

export function nextIntent(
  previous: { key: string; at: number } | null,
  now: number,
  mint: () => string = () => crypto.randomUUID(),
  windowMs = DOUBLE_CLICK_WINDOW_MS,
): { key: string; at: number; reused: boolean } {
  if (previous && now - previous.at >= 0 && now - previous.at < windowMs) {
    return { key: previous.key, at: previous.at, reused: true };
  }
  return { key: mint(), at: now, reused: false };
}
