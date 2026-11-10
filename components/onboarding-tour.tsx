/**
 * components/onboarding-tour.tsx — skippable 4-step tour on first launch.
 * A real modal: focus stays inside, Escape closes, Next opens the page it describes.
 */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { fetchHealth } from "@/lib/client/api";

interface SettingsView {
  settings: Record<string, string>;
}

async function fetchSettings(): Promise<SettingsView> {
  const res = await fetch("/api/settings", { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to load settings");
  return res.json() as Promise<SettingsView>;
}

async function completeOnboarding(): Promise<void> {
  await fetch("/api/settings", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ onboardingComplete: true }),
  });
}

const STEPS = [
  {
    title: "Create",
    body: "Describe the song you want on the Create page. Pick a preset or write your own.",
    path: "/",
  },
  {
    title: "Forge",
    body: "Hit Forge to queue the song. It is made on this computer.",
    demoBody: "Hit Forge to walk through the steps. Demo mode plays a short sample. It does not generate music.",
    path: "/",
  },
  {
    title: "Library",
    body: "Finished songs land in your Library. Open one to play it, change a section, or make it longer.",
    path: "/library",
  },
  {
    title: "Player",
    body: "Use the bar at the bottom to play and skip around. Space plays and pauses when you are not typing or on a button.",
    path: "/library",
  },
] as const;

function focusable(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])")].filter(
    (el) => !el.hasAttribute("disabled"),
  );
}

export function OnboardingTour() {
  const pathname = usePathname();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ["settings"], queryFn: fetchSettings });
  const { data: health } = useQuery({
    queryKey: ["health"],
    queryFn: ({ signal }) => fetchHealth(signal),
    staleTime: 15_000,
  });
  const [step, setStep] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);

  const doneMutation = useMutation({
    mutationFn: completeOnboarding,
    onSuccess: () => {
      setDismissed(true);
      void queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
  });

  const open = !dismissed && data?.settings.onboarding_complete !== "1" && data != null;

  useEffect(() => {
    if (!open) return;
    const root = dialogRef.current;
    if (!root) return;
    focusable(root)[0]?.focus();
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        doneMutation.mutate();
        return;
      }
      if (event.key !== "Tab" || !root) return;
      const items = focusable(root);
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, step, doneMutation]);

  if (!open) return null;

  const current = STEPS[step]!;
  const body = "demoBody" in current && health?.mockEngine ? current.demoBody : current.body;

  function go(nextStep: number) {
    const target = STEPS[nextStep];
    if (target && pathname !== target.path) router.push(target.path);
    setStep(nextStep);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center">
      <Card
        ref={dialogRef}
        className="w-full max-w-md p-6 shadow-xl"
        data-testid="onboarding-tour"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
      >
        <p className="text-xs font-medium text-muted-foreground">
          Step {step + 1} of {STEPS.length}
        </p>
        <h2 id="tour-title" className="mt-1 text-lg font-semibold">{current.title}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{body}</p>
        <div className="mt-6 flex justify-between gap-2">
          <Button
            variant="ghost"
            data-testid="tour-skip"
            onClick={() => doneMutation.mutate()}
          >
            Skip tour
          </Button>
          <div className="flex gap-2">
            {step > 0 && (
              <Button variant="outline" onClick={() => go(step - 1)}>
                Back
              </Button>
            )}
            {step < STEPS.length - 1 ? (
              <Button data-testid="tour-next" onClick={() => go(step + 1)}>
                Next
              </Button>
            ) : (
              <Button data-testid="tour-finish" onClick={() => doneMutation.mutate()}>
                Got it
              </Button>
            )}
          </div>
        </div>
      </Card>
    </div>
  );
}
