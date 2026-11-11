/**
 * GET  /api/phone — status for Settings. Pairing secrets stay off the phone.
 * POST /api/phone — turn access on or off, mint a new code, or revoke a device.
 * Only the computer (not a paired phone) may change this.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { isPhoneClient } from "@/lib/phone/client";
import { syncPhoneGateway } from "@/lib/phone/gateway";
import { phoneStatus } from "@/lib/phone/status";
import {
  ensureInvite,
  revokeDevice,
  rotateInvite,
  setPhoneAccessEnabled,
} from "@/lib/phone/store";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  return NextResponse.json(await phoneStatus(isPhoneClient(req)));
}

const PostSchema = z
  .object({
    action: z.enum(["enable", "disable", "rotate", "revoke"]),
    deviceId: z.string().min(1).max(80).optional(),
  })
  .strict();

export async function POST(req: Request) {
  if (isPhoneClient(req)) {
    return NextResponse.json(
      { error: "Use the computer to change phone access." },
      { status: 403 },
    );
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
  if (parsed.data.action === "enable") {
    setPhoneAccessEnabled(true);
    ensureInvite();
    await syncPhoneGateway();
  } else if (parsed.data.action === "disable") {
    setPhoneAccessEnabled(false);
    await syncPhoneGateway();
  } else if (parsed.data.action === "rotate") {
    rotateInvite();
  } else if (parsed.data.deviceId) {
    revokeDevice(parsed.data.deviceId);
  } else {
    return NextResponse.json({ error: "Choose a phone to remove." }, { status: 400 });
  }
  return NextResponse.json(await phoneStatus(false));
}
