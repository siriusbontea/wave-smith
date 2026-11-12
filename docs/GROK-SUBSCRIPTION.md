# Grok subscription (via Grok Build)

Wavesmith can draft lyrics with the Grok subscription you already pay for. It does that by running the Grok Build CLI on your Mac. The song is still forged locally.

This is a third connection mode. **Local only** stays the default. **Grok hybrid** still uses `XAI_API_KEY` and is unchanged.

## What it does

Settings → Connection → **Grok subscription (via Grok Build)**, or set `WAVESMITH_CONNECTION_MODE=grok-subscription` in `.env`. When that variable is set, it overrides the menu.

**Write with Grok** asks the CLI for lyrics, a structure, a tempo, a key, and style tags. Forge still uses ACE-Step on this computer.

Each call runs the real `grok` binary (not a shell function) with tools turned off, one turn, no web search, no plan mode, and no subagents. The prompt is a file in a fresh temporary directory that is deleted afterwards (`--prompt-file` on grok 1.0.77). The environment passed to the CLI is `PATH`, `HOME`, and `LANG`. `XAI_API_KEY` is not passed through.

The songwriter instructions go on `--system-prompt-override`. That CLI has no flag that reads the override from a file (`--rules` only appends a string), so Wavesmith refuses an override longer than 32 KiB. A normal songwriter prompt is far below that. Stdout is expected to be one JSON object. If a log line appears first, Wavesmith uses the last complete top-level object and still discards a reply that is not finished lyrics.

On a timeout, Wavesmith signals the process group and the child it spawned, then a follow-up SIGKILL. That follow-up is cancelled when the child exits, so a reused pid is not signalled. A grandchild that calls `setsid` leaves the group and is not tracked. Tools are off, so a normal call should not start one.

Wavesmith does not read, copy, or log `~/.grok/auth.json`. The CLI uses that file itself because `HOME` is set. There is no OAuth flow in Wavesmith.

## Setup

1. Install [Grok Build](https://x.ai/cli) and open Terminal.
2. Run `grok login` and finish the sign-in in the browser.
3. In Wavesmith, choose **Grok subscription (via Grok Build)**.

Wavesmith looks for the binary at `GROK_BIN` if you set it, then `~/.grok/bin/grok`, `/opt/homebrew/bin/grok`, `/usr/local/bin/grok`, and `~/.local/bin/grok`. `GROK_BIN` must be an absolute path, or start with `~/` (your home). A relative path such as `grok` or `./grok` is refused and the usual locations are not searched. `grok --version` must look like `grok 1` or newer. On a checked Mac the binary was `~/.grok/bin/grok`.

`wavesmith doctor` reports whether that binary is installed. It does not sign in and it does not spend usage. `wavesmith doctor --deep` sends one short probe. A probe that returns token counts is included in the Settings usage counter. A signed-out probe that exits before JSON is not. If you are signed out, the fix is `grok login`. A long stderr log does not hide that sign-in error.

## Usage pool

Calls count against the same weekly pool as Grok and Grok Build. The CLI adds a large prompt of its own before your lyrics request (on the order of 13–15k input tokens, about $0.03 of metered equivalent on a measured `grok 1.0.77`). Settings shows requests, tokens, and `total_cost_usd` for today and for this Wavesmith session. Those numbers stay on this computer. They include lyrics calls and a successful `doctor --deep` probe. Writes are serialized so two overlapping calls both count.

Optional: `GROK_BUILD_MODEL` (omit it to let the CLI pick its default, which is `grok-4.7` on `grok 1.0.77`), `GROK_BUILD_TIMEOUT_MS` (default 120000), and `GROK_BUILD_CONCURRENCY` (1 or 2, default 1).

## Privacy

The prompt and the songwriter instructions are sent to xAI through the official CLI, as your own client. xAI documents this headless mode for integrations. You still have to follow xAI's terms. Audio generation does not go to xAI.

**Unrestricted lyrics** keeps this path off, the same way it keeps the API-key hybrid off. A hosted model may refuse. The local writer and the engine still receive your text unchanged.

## If it fails

Wavesmith shows the error and, when Ollama is running, writes the lyrics locally instead. It does not switch over to the API key.

| What you see | What to do |
|--------------|------------|
| CLI was not found | Install Grok Build, or set `GROK_BIN` to an absolute path or `~/...`. |
| Not signed in | Open Terminal and run `grok login`. |
| Took too long | The call is stopped at `GROK_BUILD_TIMEOUT_MS`. Try again, or raise that value. |
| Did not return JSON, or stopped early | The reply is discarded. Use the local writer or try again. |

## Not in this version

An OpenAI-compatible provider aimed at a local Hermes API server (often `http://127.0.0.1:8642/v1`) is not built. If it is added later, the URL has to be loopback-only and the bearer key has to stay in the same kind of gitignored file as the xAI key. Hermes's server exposes a full agent with terminal access, so it is not a drop-in lyrics endpoint.
