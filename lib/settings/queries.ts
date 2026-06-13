/**
 * lib/settings/queries.ts — key/value settings helpers (spec §5).
 */
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";

export function getSetting(key: string): string | null {
  const row = db.select().from(schema.settings).where(eq(schema.settings.key, key)).get();
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  const existing = db.select().from(schema.settings).where(eq(schema.settings.key, key)).get();
  if (existing) {
    db.update(schema.settings).set({ value }).where(eq(schema.settings.key, key)).run();
  } else {
    db.insert(schema.settings).values({ key, value }).run();
  }
}

export function deleteSetting(key: string): void {
  db.delete(schema.settings).where(eq(schema.settings.key, key)).run();
}

export function listSettings(): Record<string, string> {
  const rows = db.select().from(schema.settings).all();
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}
