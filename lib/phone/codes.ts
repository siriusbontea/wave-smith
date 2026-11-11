/**
 * lib/phone/codes.ts — pairing codes and device tokens.
 *
 * The code is what the Mac shows (and the QR encodes). It is single-use.
 * The token is a separate secret stored only in the phone's cookie; the
 * database keeps a hash.
 */
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function mintPairCode(): string {
  const bytes = randomBytes(8);
  let raw = "";
  for (let i = 0; i < 8; i++) raw += ALPHABET[bytes[i]! % ALPHABET.length];
  return `${raw.slice(0, 4)}-${raw.slice(4)}`;
}

export function normalizePairCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function pairCodesMatch(a: string, b: string): boolean {
  const left = Buffer.from(normalizePairCode(a));
  const right = Buffer.from(normalizePairCode(b));
  if (left.length === 0 || left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function mintDeviceToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashDeviceToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export const PHONE_COOKIE = "ws_device";

export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [rawKey, ...rest] = part.trim().split("=");
    if (rawKey === name) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

export function deviceCookie(token: string): string {
  return `${PHONE_COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=31536000`;
}

export function deviceLabel(userAgent: string | undefined): string {
  const ua = userAgent ?? "";
  if (/iPhone/i.test(ua)) return "iPhone";
  if (/iPad/i.test(ua)) return "iPad";
  if (/Android/i.test(ua)) return "Android";
  if (/Mobile/i.test(ua)) return "Phone";
  return "Browser";
}
