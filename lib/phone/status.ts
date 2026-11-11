/**
 * lib/phone/status.ts — what Settings shows for phone access.
 *
 * The pairing code and QR are for the computer screen only. A request that
 * already came from a phone does not receive them.
 */
import QRCode from "qrcode";
import { lanOptIn, localLanAddresses } from "@/lib/phone/bind";
import {
  phoneGatewayError,
  phoneGatewayHost,
  phoneGatewayListening,
  phoneGatewayMode,
  phoneListenPort,
} from "@/lib/phone/gateway";
import { ensureInvite, listDevices, phoneAccessEnabled, type PhoneDevice } from "@/lib/phone/store";

export interface PhoneStatus {
  enabled: boolean;
  listening: boolean;
  error: string | null;
  port: number;
  mode: "off" | "tailscale" | "lan";
  lan: boolean;
  urls: string[];
  invite: { code: string; url: string | null; qrSvg: string | null; expiresAt: number } | null;
  devices: PhoneDevice[];
  via: "mac" | "phone";
}

function originFor(host: string, port: number): string {
  const shown = host.includes(":") ? `[${host}]` : host;
  return `http://${shown}:${port}`;
}

export async function phoneStatus(forPhone: boolean): Promise<PhoneStatus> {
  const enabled = phoneAccessEnabled();
  const port = phoneListenPort();
  const mode = enabled ? phoneGatewayMode() : "off";
  const host = phoneGatewayHost();
  const listening = enabled && phoneGatewayListening();
  let urls: string[] = [];
  if (!forPhone && listening) {
    if (mode === "tailscale" && host) urls = [originFor(host, port)];
    else if (mode === "lan") urls = localLanAddresses().map((address) => originFor(address, port));
  }
  const invite = !forPhone && listening ? ensureInvite() : null;
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
    listening,
    error: enabled ? phoneGatewayError() : null,
    port,
    mode,
    lan: lanOptIn(),
    urls,
    invite:
      invite == null
        ? null
        : { code: invite.code, url: pairUrl, qrSvg, expiresAt: invite.expiresAt },
    devices: forPhone ? [] : listDevices(),
    via: forPhone ? "phone" : "mac",
  };
}
