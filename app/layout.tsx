/**
 * Root layout — theme class on <html> is owned by next-themes (Providers);
 * suppressHydrationWarning avoids a benign class/style mismatch on first paint.
 * time by next/font and self-hosted from .next afterward — no runtime
 * font requests, which keeps the local-first promise.
 */
import type { Metadata } from "next";
import "./globals.css";
import { Geist } from "next/font/google";
import { cn } from "@/lib/utils";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

export const metadata: Metadata = {
  title: "Wavesmith",
  description:
    "Local-first AI music studio — describe a song, get full tracks with vocals. 100% on your machine.",
};

import Link from "next/link";
import { Providers } from "@/components/providers";
import { StatusBanner } from "@/components/status-banner";
import { MiniPlayer } from "@/components/mini-player";
import { KeyboardPlayer } from "@/components/keyboard-player";
import { OnboardingTour } from "@/components/onboarding-tour";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={cn("h-full antialiased", "font-sans", geist.variable)}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground">
        <Providers>
          <StatusBanner />
          <header className="flex items-center justify-between border-b px-4 py-3">
            <Link href="/" className="text-lg font-semibold tracking-tight">
              Wavesmith
            </Link>
            <nav className="flex gap-4 text-sm">
              <Link href="/" className="text-muted-foreground hover:text-foreground">
                Create
              </Link>
              <Link href="/library" className="text-muted-foreground hover:text-foreground">
                Library
              </Link>
              <Link href="/settings" className="text-muted-foreground hover:text-foreground">
                Settings
              </Link>
            </nav>
          </header>
          <div className="flex flex-1 flex-col">{children}</div>
          <MiniPlayer />
          <KeyboardPlayer />
          <OnboardingTour />
        </Providers>
      </body>
    </html>
  );
}
