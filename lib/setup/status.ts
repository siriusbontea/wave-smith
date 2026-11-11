/**
 * lib/setup/status.ts — read the setup progress file for the web UI.
 */

import fs from "node:fs";
import path from "node:path";
import { interpretSetup, type SetupView } from "@/lib/setup/progress";

export function readSetupStatus(dataDir: string): SetupView {
  try {
    return interpretSetup(fs.readFileSync(path.join(dataDir, "setup-progress.json"), "utf8"));
  } catch {
    return interpretSetup(null);
  }
}
