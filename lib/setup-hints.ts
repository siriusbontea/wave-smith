/**
 * lib/setup-hints.ts — shell steps shown behind a details toggle.
 *
 * Kept out of the CLI modules so client components can render the command
 * without pulling in node:child_process.
 */

export const BASE_MODEL_SETUP =
  "Run ./scripts/setup.sh, or from the engine folder: uv run acestep-download -m acestep-v15-base.";

export const ALIGNER_SETUP =
  "Run ./scripts/setup.sh (it creates .venv-align), or set ALIGN_PYTHON to a Python that has stable-ts installed.";

export const PARTS_SETUP =
  'Run ./scripts/setup.sh — or: uv tool install --python 3.12 --with "torchaudio<2.9" --with soundfile demucs==4.0.1';

export const NOTES_SETUP =
  'Run ./scripts/setup.sh — or: uv tool install --python 3.12 --with "setuptools<81" --with onnxruntime --with "scipy==1.11.4" "basic-pitch[onnx]"';
