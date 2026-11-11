/**
 * lib/phone/status.ts — what Settings shows for phone access.
 *
 * The pairing code and QR are for the computer screen only. A request that
 * already came from a phone does not receive them.
 */
import os from "node:os";
import QRCode from "qrcode";
import {
  phoneGatewayError,
  phoneGatewayListening,
  phoneListenPort,
} from "@/lib/phone/gateway";
import { currentInvite, listDevices, phoneAccessEnabled, type PhoneDevice } from "@/lib/phone/store";

export interface PhoneStatus {
  enabled: boolean;
  listening: boolean;
  error: string | null;
  port: number;
  urls: string[];
  invite: { code: string; url: string | null; qrSvg: string | null } | null;
  devices: PhoneDevice[];
  via: "mac" | "phone";
}

function rankAddress(address: string): number {
  if (address.startsWith("192.168.") || address.startsWith("10.")) return 0;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(address)) return 0;
  return 1;
}

export function lanBaseUrls(port: number): string[] {
  const found: string[] = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      const family = entry.family as string | number;
      if (entry.internal || (family !== "IPv4" && family !== 4)) continue;
      found.push(`http://${entry.address}:${port}`);
    }
  }
  return found.sort((a, b) => rankAddress(new URL(a).hostname) - rankAddress(new URL(b).hostname));
}

export async function phoneStatus(forPhone: boolean): Promise<PhoneStatus> {
  const enabled = phoneAccessEnabled();
  const port = phoneListenPort();
  const urls = lanBaseUrls(port);
  const invite = enabled && !forPhone ? currentInvite() : null;
  let pairUrl: string | null = null;
  let qrSvg: string | null = null;
  if (invite && urls[0]) {
    pairUrl = `${urls[0]}/pair?code=${encodeURIComponent(invite.code)}`;
    qrSvg = await QRCode.toString(pairUrl, {
      type: "svg",
      margin: 1,
      color: { dark: "#1c1917", light: "#fafaf9" },
    });
  }
  return {
    enabled,
    listening: enabled && phoneGatewayListening(),
    error: enabled ? phoneGatewayError() : null,
    port,
    urls: forPhone ? [] : urls,
    invite:
      invite == null
        ? null
        : { code: invite.code, url: pairUrl, qrSvg },
    devices: forPhone ? [] : listDevices(),
    via: forPhone ? "phone" : "mac",
  };
}
