/**
 * Root layout — dark studio theme is the default and only theme for now
 * (a light toggle arrives with Settings, M6). Geist is fetched once at build
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={cn("dark h-full antialiased", "font-sans", geist.variable)}>
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
            </nav>
          </header>
          {children}
        </Providers>
      </body>
    </html>
  );
}
