/**
 * lib/phone/store.ts — phone access flag, one-time invites, paired devices.
 *
 * The pairing code is stored so the Mac can keep showing it. It is deleted
 * the moment a phone redeems it. Device rows store a hash, not the cookie.
 */
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getSetting, setSetting } from "@/lib/settings/queries";
import {
  hashDeviceToken,
  mintDeviceToken,
  mintPairCode,
  pairCodesMatch,
} from "@/lib/phone/codes";

export const PHONE_ACCESS_KEY = "phone_access";
const TOUCH_INTERVAL_MS = 60_000;

export function phoneAccessEnabled(): boolean {
  return getSetting(PHONE_ACCESS_KEY) === "1";
}

export function setPhoneAccessEnabled(on: boolean): void {
  setSetting(PHONE_ACCESS_KEY, on ? "1" : "0");
  if (!on) clearInvites();
}

export interface PhoneInvite {
  code: string;
  createdAt: number;
}

export function currentInvite(): PhoneInvite | null {
  const row = db.select().from(schema.phoneInvites).all()[0];
  if (!row) return null;
  return { code: row.code, createdAt: row.createdAt };
}

/** Replace any unused code. Old QR codes stop working. */
export function rotateInvite(): PhoneInvite {
  clearInvites();
  const code = mintPairCode();
  const createdAt = Date.now();
  db.insert(schema.phoneInvites).values({ id: randomUUID(), code, createdAt }).run();
  return { code, createdAt };
}

export function ensureInvite(): PhoneInvite {
  return currentInvite() ?? rotateInvite();
}

function clearInvites(): void {
  db.delete(schema.phoneInvites).run();
}

export interface PhoneDevice {
  id: string;
  label: string;
  createdAt: number;
  lastSeenAt: number | null;
}

export function listDevices(): PhoneDevice[] {
  return db
    .select()
    .from(schema.phoneDevices)
    .all()
    .map((row) => ({
      id: row.id,
      label: row.label,
      createdAt: row.createdAt,
      lastSeenAt: row.lastSeenAt,
    }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Redeem a pairing code. Returns the raw cookie token once, or null when the
 * code does not match the invite on this computer.
 */
export function redeemInvite(code: string, label: string): { token: string; deviceId: string } | null {
  const invite = currentInvite();
  if (!invite || !pairCodesMatch(invite.code, code)) return null;
  const token = mintDeviceToken();
  const deviceId = randomUUID();
  const now = Date.now();
  db.insert(schema.phoneDevices)
    .values({
      id: deviceId,
      label,
      tokenHash: hashDeviceToken(token),
      createdAt: now,
      lastSeenAt: now,
    })
    .run();
  clearInvites();
  return { token, deviceId };
}

export function deviceForToken(token: string | undefined): PhoneDevice | null {
  if (!token) return null;
  const hash = hashDeviceToken(token);
  const row = db.select().from(schema.phoneDevices).where(eq(schema.phoneDevices.tokenHash, hash)).get();
  if (!row) return null;
  return {
    id: row.id,
    label: row.label,
    createdAt: row.createdAt,
    lastSeenAt: row.lastSeenAt,
  };
}

export function touchDevice(token: string | undefined): void {
  const device = deviceForToken(token);
  if (!device) return;
  const now = Date.now();
  if (device.lastSeenAt != null && now - device.lastSeenAt < TOUCH_INTERVAL_MS) return;
  db.update(schema.phoneDevices)
    .set({ lastSeenAt: now })
    .where(eq(schema.phoneDevices.id, device.id))
    .run();
}

export function revokeDevice(id: string): boolean {
  const result = db.delete(schema.phoneDevices).where(eq(schema.phoneDevices.id, id)).run();
  return result.changes > 0;
}
