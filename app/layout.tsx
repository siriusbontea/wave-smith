/**
 * Root layout — theme class on <html> is owned by next-themes (Providers);
 * suppressHydrationWarning avoids a benign class/style mismatch on first paint.
 * time by next/font and self-hosted from .next afterward — no runtime
 * font requests, which keeps the local-first promise.
 */
import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Geist } from "next/font/google";
import { cn } from "@/lib/utils";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});

export const metadata: Metadata = {
  title: "Wavesmith",
  description:
    "Local-first AI music studio — describe a song, get full tracks with vocals. 100% on your machine.",
  applicationName: "Wavesmith",
  appleWebApp: {
    capable: true,
    title: "Wavesmith",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#1c1917",
};

import { Providers } from "@/components/providers";
import { SetupGate } from "@/components/setup-gate";
import { StatusBanner } from "@/components/status-banner";
import { MiniPlayer } from "@/components/mini-player";
import { KeyboardPlayer } from "@/components/keyboard-player";
import { OnboardingTour } from "@/components/onboarding-tour";
import { PageFrame, StudioNav } from "@/components/studio-nav";

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
          <SetupGate>
            <StatusBanner />
            <StudioNav />
            <PageFrame>{children}</PageFrame>
            <MiniPlayer />
            <KeyboardPlayer />
            <OnboardingTour />
          </SetupGate>
        </Providers>
      </body>
    </html>
  );
}
