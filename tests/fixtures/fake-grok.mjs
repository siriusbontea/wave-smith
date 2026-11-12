#!/usr/bin/env node
/**
 * Stand-in for the Grok Build CLI. Tests set tests/fixtures/mode.txt.
 * It records the argv it actually received and never reads a Grok auth file.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

if (process.argv.includes("--version")) {
  process.stdout.write("grok 1.0.77\n");
  process.exit(0);
}

const modePath = path.join(here, "mode.txt");
const mode = fs.existsSync(modePath) ? fs.readFileSync(modePath, "utf8").trim() : "success";
let parent = "";
try {
  parent = fs.readFileSync(`/proc/${process.ppid}/cmdline`, "utf8").replaceAll("\0", " ");
} catch {
  parent = "";
}
const record = {
  argv: process.argv.slice(2),
  env: process.env,
  parent,
  cwd: process.cwd(),
};
fs.writeFileSync(path.join(process.cwd(), "argv.json"), JSON.stringify(record));
fs.appendFileSync(path.join(here, "calls.log"), `${Date.now()}\n`);

const lyric = JSON.stringify({
  lyrics: "[verse]\nHello from the subscription\n[chorus]\nStill forged here",
  sections: ["verse", "chorus"],
  bpm: 120,
  keyScale: "A minor",
  timeSignature: "4",
  styleTags: ["pop"],
  structure: "verse-chorus",
});

if (mode === "hang") {
  setInterval(() => {}, 1_000);
} else if (mode === "slow") {
  setTimeout(() => {
    process.stdout.write(success(lyric));
    process.exit(0);
  }, 200);
} else if (mode === "huge") {
  const chunk = Buffer.alloc(256 * 1024, 0x78);
  let sent = 0;
  const more = () => {
    if (sent >= 3 * 1024 * 1024) {
      process.exit(0);
      return;
    }
    sent += chunk.length;
    if (process.stdout.write(chunk)) more();
    else process.stdout.once("drain", more);
  };
  more();
} else if (mode === "malformed") {
  process.stdout.write("this is not json");
  process.exit(0);
} else if (mode === "nonzero") {
  process.stderr.write("model backend failed\n");
  process.exit(3);
} else if (mode === "unauthenticated") {
  process.stderr.write("You are not authenticated.\n");
  process.exit(1);
} else if (mode === "empty") {
  process.stdout.write(success("  "));
  process.exit(0);
} else if (mode === "late-auth") {
  process.stderr.write("x".repeat(80 * 1024));
  process.stderr.write("You are not authenticated.\n");
  process.stderr.write("y".repeat(80 * 1024));
  process.exit(1);
} else if (mode === "banner") {
  process.stdout.write("warning: model warm\n");
  process.stdout.write(success(lyric));
  process.exit(0);
} else if (mode === "banner-broken") {
  process.stdout.write('{"text":"ok","stopReason":"end_turn"}{not json}');
  process.exit(0);
} else if (mode === "stopped") {
  process.stdout.write(
    JSON.stringify({
      text: lyric,
      stopReason: "max_turns",
      usage: { input_tokens: 10, output_tokens: 1, total_tokens: 11 },
      total_cost_usd: 0,
    }),
  );
  process.exit(0);
} else {
  process.stdout.write(success(lyric));
  process.exit(0);
}

function success(text) {
  return JSON.stringify({
    text,
    stopReason: "end_turn",
    sessionId: "sess",
    requestId: "req",
    cwd: process.cwd(),
    usage: {
      input_tokens: 14000,
      cache_read_input_tokens: 0,
      output_tokens: 80,
      reasoning_tokens: 0,
      total_tokens: 14080,
    },
    num_turns: 1,
    total_cost_usd: 0.0275,
    modelUsage: { "grok-4.7": { output_tokens: 80 } },
  });
}
