/**
 * lib/queue/idempotency.ts — merge only a repeated click, not a new intent.
 *
 * The same idempotency key inside a short window is one gesture (a double
 * click or a retried POST). A new key is a new job, even when the prompt,
 * song, and language match an in-flight row.
 */

export const IDEMPOTENCY_WINDOW_MS = 60_000;

export function matchesIdempotencyKey(
  existingKey: string | undefined,
  incomingKey: string | undefined,
  ageMs: number,
  windowMs = IDEMPOTENCY_WINDOW_MS,
): boolean {
  if (!incomingKey || !existingKey || incomingKey !== existingKey) return false;
  return ageMs >= 0 && ageMs <= windowMs;
}

export function readIdempotencyKey(payload: string): string | undefined {
  try {
    const parsed = JSON.parse(payload) as { idempotencyKey?: unknown };
    return typeof parsed.idempotencyKey === "string" && parsed.idempotencyKey.length > 0
      ? parsed.idempotencyKey
      : undefined;
  } catch {
    return undefined;
  }
}
