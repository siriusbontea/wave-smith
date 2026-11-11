/**
 * GET /api/setup — first-run progress for the browser.
 * While scripts/setup.sh is downloading models, the page shows this instead
 * of an engine error. A missing file means setup is not running.
 */
import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { readSetupStatus } from "@/lib/setup/status";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(readSetupStatus(env.dataDir));
}
