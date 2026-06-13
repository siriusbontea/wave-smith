/**
 * components/onboarding-tour.tsx — skippable 4-step tour on first launch (spec §9.5, M6).
 * Persisted in settings.onboarding_complete so it shows once.
 */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

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
    body: "Describe the song you want on the Create page — pick a preset or write your own prompt.",
    path: "/",
  },
  {
    title: "Forge",
    body: "Hit Forge to queue generation. Wavesmith forges full tracks with vocals, entirely on your machine.",
    path: "/",
  },
  {
    title: "Library",
    body: "Finished songs land in your Library — grouped variations, cover art, favorites, and search.",
    path: "/library",
  },
  {
    title: "Player",
    body: "Use the mini-player at the bottom to play and seek anywhere. Press Space to toggle (when not typing).",
    path: "/library",
  },
] as const;

export function OnboardingTour() {
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const { data } = useQuery({ queryKey: ["settings"], queryFn: fetchSettings });
  const [step, setStep] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  const doneMutation = useMutation({
    mutationFn: completeOnboarding,
    onSuccess: () => {
      setDismissed(true);
      void queryClient.invalidateQueries({ queryKey: ["settings"] });
    },
  });

  if (dismissed || data?.settings.onboarding_complete === "1") return null;

  const current = STEPS[step]!;
  const onPath = pathname === current.path || (current.path === "/" && pathname === "/");

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center"
      data-testid="onboarding-tour"
      role="dialog"
      aria-label="Welcome tour"
    >
      <Card className="w-full max-w-md p-6 shadow-xl">
        <p className="text-xs font-medium text-muted-foreground">
          Step {step + 1} of {STEPS.length}
        </p>
        <h2 className="mt-1 text-lg font-semibold">{current.title}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{current.body}</p>
        {!onPath && (
          <p className="mt-2 text-xs text-amber-400">
            Open the {current.title} page to continue, or skip the tour.
          </p>
        )}
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
              <Button variant="outline" onClick={() => setStep((s) => s - 1)}>
                Back
              </Button>
            )}
            {step < STEPS.length - 1 ? (
              <Button data-testid="tour-next" onClick={() => setStep((s) => s + 1)} disabled={!onPath}>
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
