/**
 * lib/songs/extend-check.ts — did an extend job actually get longer?
 *
 * Turbo has no `complete` task (ENGINE_NOTES §5). Extend is a repaint whose
 * window runs past the source duration. If the file (or, in demo mode, the
 * engine's reported duration) didn't grow, the job must fail instead of
 * presenting the original mix as an extension.
 */

export const EXTEND_LENGTH_ERROR =
  "The song was not extended. This build's ACE-Step turbo model can repaint a section, but lengthening audio is the base-only Complete task (acestep-v15-base), which is not loaded. The turbo repaint kept the original length, so this extend was discarded.";

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
