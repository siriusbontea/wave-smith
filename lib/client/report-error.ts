/**
 * lib/client/report-error.ts — one toast when a click fails.
 *
 * The mutation's onError and the caller's catch both see the same error.
 * The first report wins so the phone is not told twice.
 */
import { toast } from "sonner";
import { isAbortError } from "@/lib/client/api";

const reported = new WeakSet<object>();

export function reportActionError(title: string, err: unknown): void {
  if (isAbortError(err)) return;
  if (typeof err === "object" && err !== null) {
    if (reported.has(err)) return;
    reported.add(err);
  }
  const description = err instanceof Error && err.message ? err.message : "Try again.";
  toast.error(title, { description });
}
