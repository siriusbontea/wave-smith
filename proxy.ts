/**
 * proxy.ts — fail closed unless the caller is the Mac or a paired phone.
 *
 * The Mac is a loopback TCP peer with a loopback Host and no proxy headers.
 * A phone is the gateway secret, which client input cannot forge. Writes also
 * need JSON and a custom header, and a Mac write needs a localhost Origin.
 */
import { NextResponse, type NextRequest } from "next/server";
import { authorizeWrite, classifyRequest } from "@/lib/phone/access";

export function proxy(req: NextRequest) {
  const decision = authorizeWrite(req, classifyRequest(req));
  if (!decision.ok) {
    return NextResponse.json({ error: decision.error }, { status: decision.status });
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
