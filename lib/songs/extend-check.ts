/**
 * lib/songs/extend-check.ts — did an extend job actually get longer?
 *
 * Extend runs task_type=complete on acestep-v15-base. v0.1.8 sizes that task
 * to the uploaded audio, so the queue pads a silent tail first. If the file
 * (or, in demo mode, the engine's reported duration) still did not grow, the
 * job fails instead of saving the original mix as an extension.
 */

export const EXTEND_LENGTH_ERROR =
  "The song was not extended. The base model Complete task finished, but the audio was not longer than the original, so this extend was discarded. The original song is unchanged.";

export function extendGrew(input: {
  /** Demo/tests trust the mock's reported duration — the demo clip is never really longer. */
  mockEngine: boolean;
  targetDurationS: number;
  reportedDurationS: number | null;
  probedDurationS: number | null;
}): boolean {
  const observed = input.mockEngine
    ? input.reportedDurationS
    : (input.probedDurationS ?? input.reportedDurationS);
  if (observed == null || !Number.isFinite(observed)) return false;
  // One second of slack for encoder padding and rounding.
  return observed + 0.25 >= input.targetDurationS - 1;
}
