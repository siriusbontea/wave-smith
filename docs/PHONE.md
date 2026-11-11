# Use Wavesmith from a phone

The computer still makes the music. A phone on the same Wi-Fi can open Wavesmith in Safari, start songs, listen, edit, and download. This is off until you turn it on.

The Next.js app stays on `127.0.0.1:3000`. ACE-Step stays on `127.0.0.1:8001`. Ollama, if you use it, stays on `127.0.0.1:11434`. None of those open onto the Wi-Fi. While phone access is on, Wavesmith also listens on `0.0.0.0:8787` (or `PHONE_PORT`) and forwards to the app only after a phone has paired.

## On the computer

1. Open **http://127.0.0.1:3000/settings**.
2. Under **Use from a phone**, choose **Turn on**.
3. A code and a QR appear. The header shows **Phone on** so you can see it is listening.
4. To stop, choose **Turn off**. Phones can no longer connect. Paired phones are remembered for the next time you turn it on.
5. **Remove** drops one phone. **New code** throws away the QR that is on screen. Codes already used do not work again.

## On the phone

1. Join the same Wi-Fi as the computer.
2. Open the camera and scan the code. Or open the address shown under the code and type it.
3. You can then create, queue, play, seek, extend, and download. If the phone sleeps, the computer keeps working. Open Wavesmith again and the queue is up to date.
4. In Safari, use Share → **Add to Home Screen**. It opens like an app. It is still this computer serving the page, not a copy of the models on the phone.

## What a phone cannot do

- Reach ACE-Step, Ollama, or any other program on the computer except through Wavesmith.
- See or change the xAI key. The key stays in a file on the computer and is never included in a response.

## Away from home

Do **not** forward port 8787 on your router, and do not put Wavesmith on the public internet. The pairing hop on your Wi-Fi is ordinary HTTP, so someone else on that Wi-Fi who can watch the traffic could copy a session. A one-time code and **Remove** are the controls you have at home.

If you need the phone away from that Wi-Fi, install [Tailscale](https://tailscale.com) on the computer and the phone, turn phone access on, and open the `100.x` address Tailscale gives the computer (it shows up in the address list when Tailscale is connected). Tailscale encrypts that path. Still do not publish the port.

## Tradeoff

Binding every interface only while the setting is on keeps the default as local-only. Pairing is a shared secret on the screen, not an account. That is enough for a home Wi-Fi and a non-developer setup. It is not a substitute for TLS on a hostile network.
