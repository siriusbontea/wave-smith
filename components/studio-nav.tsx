/**
 * components/studio-nav.tsx — Create, then the song editor (inside Library),
 * then the library. One nav so the path stays obvious.
 */
"use client";

import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { usePlayer } from "@/lib/audio/store";
import { fetchHealth } from "@/lib/client/api";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/", label: "Create", current: (path: string) => path === "/" },
  { href: "/library", label: "Library", current: (path: string) => path.startsWith("/library") },
  { href: "/settings", label: "Settings", current: (path: string) => path.startsWith("/settings") },
] as const;

/** Room for the sticky mini-player so the last controls are not covered. */
export function PageFrame({ children }: { children: ReactNode }) {
  const current = usePlayer((s) => s.current);
  return <div className={cn("flex flex-1 flex-col", current && "pb-24")}>{children}</div>;
}

export function StudioNav() {
  const pathname = usePathname();
  const { data: health } = useQuery({
    queryKey: ["health"],
    queryFn: ({ signal }) => fetchHealth(signal),
    staleTime: 15_000,
  });
  return (
    <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 sm:h-14 sm:gap-4 sm:px-4">
        <Link href="/" className="text-lg font-semibold tracking-tight">
          Wavesmith
        </Link>
        <nav aria-label="Create, edit, and library" className="flex min-w-0 flex-wrap items-center gap-1">
          {LINKS.map((link) => {
            const active = link.current(pathname);
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-6 items-center rounded-md px-2 py-1.5 text-sm sm:px-3",
                  active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2">
          {health?.phone?.listening ? (
            <Link
              href="/settings"
              className="shrink-0 rounded-full bg-muted px-2 py-1 text-xs font-medium"
              data-testid="phone-on"
            >
              Phone on
            </Link>
          ) : null}
          {health == null ? (
            <span className="inline-flex min-h-6 shrink-0" data-testid="studio-status" />
          ) : health.mockEngine ? (
            <p
              className="max-w-full shrink-0 rounded-full bg-amber-950 px-2 py-1 text-xs font-semibold text-white dark:bg-amber-100 dark:text-amber-950"
              data-testid="demo-badge"
              title="Demo mode: sample audio, not generated"
            >
              <span className="sm:hidden">Demo</span>
              <span className="hidden sm:inline">Demo mode: sample audio, not generated</span>
            </p>
          ) : (
            <p className="hidden text-xs text-muted-foreground sm:block">On this computer</p>
          )}
        </div>
      </div>
    </header>
  );
}
