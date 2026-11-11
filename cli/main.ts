/**
 * cli/main.ts — `wavesmith`.
 * `__supervise` is the background process. Every other word is a command.
 */

import { realIo } from "./real-io.ts";
import { run } from "./run.ts";
import { supervise } from "./supervise.ts";

const argv = process.argv.slice(2);
if (argv[0] === "__supervise") {
  await supervise({ noOpen: process.env.WAVESMITH_NO_OPEN === "1" });
} else {
  const code = await run(argv, realIo());
  process.exit(code);
}
