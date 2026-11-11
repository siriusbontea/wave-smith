/**
 * lib/phone/store.ts — phone access flag, short-lived invites, paired devices.
 *
 * Turn off deletes every device. A pairing code lasts ten minutes. A device
 * cookie lasts 30 days from the last time that phone was used.
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
export const INVITE_TTL_MS = 10 * 60_000;
export const DEVICE_IDLE_MS = 30 * 24 * 60 * 60 * 1000;
const TOUCH_INTERVAL_MS = 60_000;

export function phoneAccessEnabled(): boolean {
  return getSetting(PHONE_ACCESS_KEY) === "1";
}

export function setPhoneAccessEnabled(on: boolean): void {
  setSetting(PHONE_ACCESS_KEY, on ? "1" : "0");
  if (!on) {
    clearInvites();
    revokeAllDevices();
  }
}

export interface PhoneInvite {
  code: string;
  createdAt: number;
  expiresAt: number;
}

function toInvite(row: { code: string; createdAt: number }): PhoneInvite {
  return { code: row.code, createdAt: row.createdAt, expiresAt: row.createdAt + INVITE_TTL_MS };
}

export function inviteCurrent(invite: PhoneInvite, now = Date.now()): boolean {
  return now - invite.createdAt < INVITE_TTL_MS;
}

export function currentInvite(now = Date.now()): PhoneInvite | null {
  const row = db.select().from(schema.phoneInvites).all()[0];
  if (!row) return null;
  const invite = toInvite(row);
  if (!inviteCurrent(invite, now)) {
    clearInvites();
    return null;
  }
  return invite;
}

/** Replace any unused code. Old QR codes stop working. */
export function rotateInvite(): PhoneInvite {
  clearInvites();
  const code = mintPairCode();
  const createdAt = Date.now();
  db.insert(schema.phoneInvites).values({ id: randomUUID(), code, createdAt }).run();
  return toInvite({ code, createdAt });
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
  lastAddress: string | null;
  userAgent: string | null;
}

function mapDevice(row: typeof schema.phoneDevices.$inferSelect): PhoneDevice {
  return {
    id: row.id,
    label: row.label,
    createdAt: row.createdAt,
    lastSeenAt: row.lastSeenAt,
    lastAddress: row.lastAddress,
    userAgent: row.userAgent,
  };
}

export function listDevices(): PhoneDevice[] {
  return db
    .select()
    .from(schema.phoneDevices)
    .all()
    .map(mapDevice)
    .sort((a, b) => b.createdAt - a.createdAt);
}

export interface RedeemInput {
  code: string;
  label: string;
  address: string;
  userAgent: string;
}

/**
 * Redeem a pairing code. Returns the raw cookie token once, or null when the
 * code does not match or has expired. A fresh code is minted so the Mac can
 * pair another phone without turning access off.
 */
export function redeemInvite(input: RedeemInput): { token: string; deviceId: string } | null {
  const invite = currentInvite();
  if (!invite || !pairCodesMatch(invite.code, input.code)) return null;
  const token = mintDeviceToken();
  const deviceId = randomUUID();
  const now = Date.now();
  db.insert(schema.phoneDevices)
    .values({
      id: deviceId,
      label: input.label,
      tokenHash: hashDeviceToken(token),
      createdAt: now,
      lastSeenAt: now,
      lastAddress: input.address,
      userAgent: input.userAgent.slice(0, 200),
    })
    .run();
  rotateInvite();
  return { token, deviceId };
}

function expiredIdle(row: { lastSeenAt: number | null }, now: number): boolean {
  if (row.lastSeenAt == null) return false;
  return now - row.lastSeenAt > DEVICE_IDLE_MS;
}

export function deviceForToken(token: string | undefined): PhoneDevice | null {
  if (!token) return null;
  const hash = hashDeviceToken(token);
  const row = db.select().from(schema.phoneDevices).where(eq(schema.phoneDevices.tokenHash, hash)).get();
  if (!row) return null;
  if (expiredIdle(row, Date.now())) {
    db.delete(schema.phoneDevices).where(eq(schema.phoneDevices.id, row.id)).run();
    return null;
  }
  return mapDevice(row);
}

/** Returns true when the sliding cookie should be refreshed. */
export function touchDevice(token: string | undefined, address?: string): boolean {
  const device = deviceForToken(token);
  if (!device) return false;
  const now = Date.now();
  const addressChanged = address != null && address !== device.lastAddress;
  if (
    !addressChanged &&
    device.lastSeenAt != null &&
    now - device.lastSeenAt < TOUCH_INTERVAL_MS
  ) {
    return false;
  }
  db.update(schema.phoneDevices)
    .set({ lastSeenAt: now, lastAddress: address ?? device.lastAddress })
    .where(eq(schema.phoneDevices.id, device.id))
    .run();
  return true;
}

export function revokeDevice(id: string): boolean {
  const result = db.delete(schema.phoneDevices).where(eq(schema.phoneDevices.id, id)).run();
  return result.changes > 0;
}

export function revokeAllDevices(): number {
  const result = db.delete(schema.phoneDevices).run();
  return result.changes;
}

export function renameDevice(id: string, label: string): boolean {
  const name = label.trim().slice(0, 40);
  if (!name) return false;
  const result = db.update(schema.phoneDevices).set({ label: name }).where(eq(schema.phoneDevices.id, id)).run();
  return result.changes > 0;
}
