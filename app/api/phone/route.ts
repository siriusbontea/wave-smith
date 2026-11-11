/**
 * GET  /api/phone — status for Settings. Pairing secrets stay off the phone.
 * POST /api/phone — turn access on or off, mint a code, or forget a phone.
 * Only the computer may change this.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizeWrite, classifyRequest, rejectedResponse } from "@/lib/phone/access";
import { setLanOptIn } from "@/lib/phone/bind";
import { syncPhoneGateway } from "@/lib/phone/gateway";
import { phoneStatus } from "@/lib/phone/status";
import {
  ensureInvite,
  renameDevice,
  revokeAllDevices,
  revokeDevice,
  rotateInvite,
  setPhoneAccessEnabled,
} from "@/lib/phone/store";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const kind = classifyRequest(req);
  const denied = rejectedResponse(kind);
  if (denied) return denied;
  if (kind === "mac") await syncPhoneGateway();
  return NextResponse.json(await phoneStatus(kind === "phone"));
}

const PostSchema = z
  .object({
    action: z.enum(["enable", "disable", "rotate", "revoke", "revoke-all", "rename", "lan-on", "lan-off"]),
    deviceId: z.string().min(1).max(80).optional(),
    name: z.string().min(1).max(40).optional(),
  })
  .strict();

export async function POST(req: Request) {
  const kind = classifyRequest(req);
  const write = authorizeWrite(req, kind);
  if (!write.ok) return NextResponse.json({ error: write.error }, { status: write.status });
  if (kind === "phone") {
    return NextResponse.json({ error: "Use the computer to change phone access." }, { status: 403 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Malformed JSON body" }, { status: 400 });
  }
  const parsed = PostSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request", issues: parsed.error.issues }, { status: 400 });
  }
  const { action, deviceId, name } = parsed.data;
  if (action === "enable") {
    setPhoneAccessEnabled(true);
    ensureInvite();
    await syncPhoneGateway();
  } else if (action === "disable") {
    setLanOptIn(false);
    setPhoneAccessEnabled(false);
    await syncPhoneGateway();
  } else if (action === "rotate") {
    rotateInvite();
  } else if (action === "revoke-all") {
    revokeAllDevices();
  } else if (action === "lan-on") {
    setLanOptIn(true);
    await syncPhoneGateway();
  } else if (action === "lan-off") {
    setLanOptIn(false);
    await syncPhoneGateway();
  } else if (action === "rename") {
    if (!deviceId || !name || !renameDevice(deviceId, name)) {
      return NextResponse.json({ error: "That phone is not paired." }, { status: 404 });
    }
  } else if (!deviceId || !revokeDevice(deviceId)) {
    return NextResponse.json({ error: "That phone is not paired." }, { status: 404 });
  }
  return NextResponse.json(await phoneStatus(false));
}
