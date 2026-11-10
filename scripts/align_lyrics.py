#!/usr/bin/env python3
"""Align known lyrics to a local audio file. JSON on stdout.

stable-ts forced-aligns the text with a Whisper checkpoint (default "base").
The first run downloads that checkpoint into the Whisper cache; later runs
stay offline. Structure tags such as [chorus] are dropped — they are not sung.
"""
from __future__ import annotations

import json
import os
import sys


def sung_lines(text: str) -> list[str]:
    lines: list[str] = []
    for raw in text.replace("\r\n", "\n").split("\n"):
        stripped = raw.strip()
        if not stripped:
            continue
        if stripped.startswith("[") and stripped.endswith("]") and "\n" not in stripped:
            continue
        lines.append(stripped)
    return lines


def main() -> int:
    if len(sys.argv) != 4:
        print("usage: align_lyrics.py <audio> <lyrics.txt> <language>", file=sys.stderr)
        return 2
    audio, lyrics_path, language = sys.argv[1:]
    with open(lyrics_path, encoding="utf-8") as handle:
        text = handle.read()
    lines = sung_lines(text)
    if not lines:
        json.dump({"lines": []}, sys.stdout)
        return 0
    try:
        import stable_whisper
    except ImportError:
        print(
            "stable-ts is not installed. Run ./scripts/setup.sh to create .venv-align.",
            file=sys.stderr,
        )
        return 2

    model_name = os.environ.get("ALIGN_WHISPER_MODEL", "base") or "base"
    # CPU keeps this off the engine's MPS memory. Slow, and local.
    model = stable_whisper.load_model(model_name, device="cpu")
    result = model.align(
        audio,
        "\n".join(lines),
        language=language or "en",
        original_split=True,
        regroup=False,
        verbose=None,
    )
    out_lines = []
    for seg in result.segments:
        words = []
        for word in seg.words or []:
            token = (word.word or "").strip()
            if not token:
                continue
            words.append({"text": token, "start": float(word.start), "end": float(word.end)})
        if not words:
            continue
        out_lines.append({"text": (seg.text or "").strip() or " ".join(w["text"] for w in words), "words": words})
    json.dump({"lines": out_lines}, sys.stdout)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except SystemExit:
        raise
    except Exception as exc:  # noqa: BLE001 — surface a single line to the job error
        print(f"alignment failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
