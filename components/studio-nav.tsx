/**
 * components/studio-nav.tsx — Create, then the song editor (inside Library),
 * then the library. One nav so the path stays obvious.
 */
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { usePlayer } from "@/lib/audio/store";
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
  return (
    <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-4 px-4">
        <Link href="/" className="text-lg font-semibold tracking-tight">
          Wavesmith
        </Link>
        <nav aria-label="Create, edit, and library" className="flex items-center gap-1">
          {LINKS.map((link) => {
            const active = link.current(pathname);
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm",
                  active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
        <p className="ml-auto hidden text-xs text-muted-foreground sm:block">Local studio</p>
      </div>
    </header>
  );
}
