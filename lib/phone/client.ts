/**
 * lib/phone/client.ts — did this request come through the phone gateway?
 *
 * The gateway overwrites this header after it has checked the pairing cookie.
 * The Next app itself only listens on 127.0.0.1, so a missing header means
 * the browser is on this computer.
 */
export const PHONE_CLIENT_HEADER = "x-wavesmith-client";

export function isPhoneClient(req: Request): boolean {
  return req.headers.get(PHONE_CLIENT_HEADER) === "phone";
}
