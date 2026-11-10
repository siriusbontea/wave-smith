/**
 * Click identity: a double-click reuses one key, a later click does not.
 * The queue merges only that shared key, and only inside the short window.
 */
import { describe, expect, it } from "vitest";
import { nextIntent } from "@/lib/client/intent";
import { IDEMPOTENCY_WINDOW_MS, matchesIdempotencyKey } from "@/lib/queue/idempotency";

describe("nextIntent", () => {
  it("reuses the key for a double-click and mints a new one later", () => {
    let n = 0;
    const mint = () => `key-${++n}`;
    const first = nextIntent(null, 1_000, mint);
    expect(first.reused).toBe(false);
    const second = nextIntent({ key: first.key, at: first.at }, 1_120, mint);
    expect(second.reused).toBe(true);
    expect(second.key).toBe(first.key);
    const later = nextIntent({ key: first.key, at: first.at }, 1_000 + 700, mint);
    expect(later.reused).toBe(false);
    expect(later.key).not.toBe(first.key);
  });
});

describe("matchesIdempotencyKey", () => {
  it("matches only the same key inside the window", () => {
    expect(matchesIdempotencyKey("click-1", "click-1", 120)).toBe(true);
    expect(matchesIdempotencyKey("click-1", "click-2", 120)).toBe(false);
    expect(matchesIdempotencyKey(undefined, "click-1", 120)).toBe(false);
    expect(matchesIdempotencyKey("click-1", "click-1", IDEMPOTENCY_WINDOW_MS + 1)).toBe(false);
  });
});
