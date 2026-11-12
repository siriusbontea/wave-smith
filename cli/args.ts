/**
 * cli/args.ts — wavesmith's command line.
 * One command, then flags. Unknown words are a usage error, not a guess.
 */

export const USAGE = `Wavesmith runs on this Mac. The app stays on http://127.0.0.1:3000.

  wavesmith start                 Start the app and the music engine, then open the browser
  wavesmith stop                  Stop Wavesmith
  wavesmith status                Say whether it is running
  wavesmith open                  Open http://127.0.0.1:3000
  wavesmith update                Download updates and keep your songs and settings
  wavesmith doctor                Check this Mac and print a fix for each problem
  wavesmith doctor --deep         Also ask Grok Build if it is signed in (uses a little of the pool)
  wavesmith logs                  Show the recent log (-f follows it)
  wavesmith uninstall             Remove the app. Asks before deleting songs or models
  wavesmith login on              Start now, and again each time you log in
  wavesmith login off             Leave launch at login off
  wavesmith login status          Print on or off

  wavesmith start --no-open       Start without opening the browser
  wavesmith uninstall --delete-data --delete-weights
                                  Also delete songs or the downloaded models
`;

const COMMANDS = [
  "start",
  "stop",
  "status",
  "open",
  "update",
  "doctor",
  "logs",
  "uninstall",
  "login",
  "help",
] as const;

export type Command = (typeof COMMANDS)[number];

export interface Flags {
  noOpen: boolean;
  foreground: boolean;
  follow: boolean;
  deleteData: boolean;
  deleteWeights: boolean;
  deep: boolean;
}

export type ParseResult =
  | { ok: true; command: Command; flags: Flags; rest: string[] }
  | { ok: false; exitCode: number; message: string };

function isCommand(value: string): value is Command {
  return (COMMANDS as readonly string[]).includes(value);
}

export function parseArgs(argv: readonly string[]): ParseResult {
  const [command, ...rest] = argv;
  if (!command || command === "help" || command === "-h" || command === "--help") {
    return { ok: false, exitCode: command ? 0 : 1, message: USAGE };
  }
  if (!isCommand(command)) {
    return { ok: false, exitCode: 1, message: `Unknown command: ${command}\n\n${USAGE}` };
  }
  const flags: Flags = {
    noOpen: false,
    foreground: false,
    follow: false,
    deleteData: false,
    deleteWeights: false,
    deep: false,
  };
  const positionals: string[] = [];
  for (const arg of rest) {
    if (arg === "--no-open") flags.noOpen = true;
    else if (arg === "--foreground") flags.foreground = true;
    else if (arg === "-f" || arg === "--follow") flags.follow = true;
    else if (arg === "--delete-data") flags.deleteData = true;
    else if (arg === "--delete-weights") flags.deleteWeights = true;
    else if (arg === "--deep") {
      if (command !== "doctor") {
        return { ok: false, exitCode: 1, message: `Unknown option: ${arg}\n\n${USAGE}` };
      }
      flags.deep = true;
    } else if (arg.startsWith("-")) {
      return { ok: false, exitCode: 1, message: `Unknown option: ${arg}\n\n${USAGE}` };
    } else positionals.push(arg);
  }
  return { ok: true, command, flags, rest: positionals };
}
