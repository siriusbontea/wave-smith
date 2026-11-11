# Use Wavesmith from a phone

The computer makes the music. The phone just opens the page. This is off until you turn it on.

The safe way is Tailscale. The phone and the computer join a private network that encrypts the traffic. Home Wi-Fi is a separate choice, and it is not the default.

The Wavesmith app stays on `127.0.0.1:3000`. The music engine stays on `127.0.0.1:8001`. Ollama, if you use it, stays on `127.0.0.1:11434`. None of those open onto the network. `pnpm dev` and `pnpm start` bind the app to `127.0.0.1` too, same as `./scripts/dev.sh` and `./scripts/start.sh`.

While phone access is on, Wavesmith also listens on port **8787** (`PHONE_PORT`). By default that listen is only the computer's Tailscale address (`100.x.y.z`, or the Tailscale IPv6 address starting with `fd7a:115c:a1e0:`). If Tailscale is not running, the door stays closed and Settings says so.

## On the computer and the phone

1. Install [Tailscale](https://tailscale.com) on the Mac and on the iPhone.
2. Sign in to the **same** Tailscale account on both.
3. On the Mac, open **http://127.0.0.1:3000/settings**.
4. Under **Use from a phone**, choose **Turn on**. The header shows **Phone on** only when the door is open. If Tailscale is not signed in, Settings says so and the door stays closed.
5. On the iPhone, open the camera and scan the code. The page asks you to tap **Pair**. You can also type the code. It looks like `ABCD-EFGH`.
6. In Safari, tap Share → **Add to Home Screen**.

A code works for **10 minutes**, then a new one shows up. **New code** throws the current one away. After a phone pairs, a new code stays on screen so you can pair another phone.

If the phone sleeps, the computer keeps working. Open Wavesmith again and the queue is up to date.

This works with `./scripts/dev.sh` and with `./scripts/start.sh`.

## Turn off, Remove, and Remove all

- **Turn off** closes the door **and forgets every paired phone**. Turning it on later needs a new scan.
- **Remove** forgets one phone. The others stay paired, and the door stays open.
- **Remove all** forgets every phone and leaves the door open.
- A phone that has not been used for **30 days** is forgotten. Each visit refreshes that 30 days.

Each phone shows its name, when it paired, when it was last seen, and its address. **Rename** is there so two iPhones are not identical. A toast appears on the computer when a new phone pairs.

## What a phone cannot do

- Reach the music engine, Ollama, or anything except through Wavesmith.
- See or change the xAI key.
- Turn on Grok, change the lyrics setting, change the theme stored on the computer, or import a library file. Do those on the computer.

The phone can still create songs, play them, edit them, and download them.

## Home Wi-Fi (advanced)

Under **Home Wi-Fi** in Settings, **Also allow this Wi-Fi** listens on every network the computer is on (`0.0.0.0:8787`). The page is ordinary HTTP, so someone else on that Wi-Fi who can watch the traffic could copy a session. The code is still required, it still expires in 10 minutes, and **Remove** still works.

That choice lasts until you quit Wavesmith. A restart does **not** turn Wi-Fi mode back on. If phone access is still on, the next start checks for Tailscale again. No Tailscale address means the door stays closed.

## Do not publish this

Do not forward port 8787 or port 3000 on your router.

Do not run **Tailscale Funnel**. Funnel puts the page on the public internet.

Do not point `tailscale serve` at port **3000**. That skips pairing, because it reaches the app itself. Wavesmith refuses requests that look like a proxy in front of port 3000. If you use `tailscale serve`, point it at port **8787** (the phone door). Pairing still applies there. Do not use Funnel.

## Wrong codes

A wrong code waits a short moment, then you can try again. The wait does not keep growing forever, and the **right** code still works during the wait. The message tells you to check the code on the computer. It does not tell you to scan a new one, because a new code would not skip the wait. If `tailscale serve` sits in front of port 8787, every phone looks like the same address, so they share that short wait. The right code still works.
