#!/usr/bin/env bash
# scripts/mark-setup-stopped.sh — remember that setup stopped, for the browser.
# A file that already says failed is left alone. A finished file is left alone.
# The installer calls this from its EXIT trap, after the setup page may be gone.
set -euo pipefail

file="${1:-}"
[[ -n "$file" && -f "$file" ]] || exit 0

PROGRESS_OUT="$file" node << 'NODE'
const fs = require("node:fs");
const file = process.env.PROGRESS_OUT;
let body;
try {
  body = JSON.parse(fs.readFileSync(file, "utf8"));
} catch {
  process.exit(0);
}
if (!body || body.running !== true) process.exit(0);
if (body.phase === "failed" || body.phase === "done") process.exit(0);
body.running = false;
body.phase = "stopped";
body.percent = null;
body.etaSeconds = null;
body.message = "Setup stopped before it finished.";
body.updatedAt = new Date().toISOString();
const tmp = `${file}.tmp`;
fs.writeFileSync(tmp, JSON.stringify(body));
fs.renameSync(tmp, file);
NODE
