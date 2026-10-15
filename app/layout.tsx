import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import { GameSearch } from "@/components/GameSearch";
import { RegionSelect } from "@/components/RegionSelect";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "PlayRadar — find your next PC game",
  description:
    "Chat to discover Steam and Epic games, watch a spoiler-free video, and get price-drop alerts that show the actual price.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} flex min-h-screen flex-col font-sans antialiased`}>
        <header className="border-b border-border">
          <nav className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
            <Link href="/" className="shrink-0 text-lg font-semibold tracking-tight">
              Play<span className="text-accent">Radar</span>
            </Link>
            <GameSearch />
            <RegionSelect />
          </nav>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6">{children}</main>
        <footer className="border-t border-border text-xs text-muted">
          <div className="mx-auto max-w-6xl space-y-1 px-4 py-4">
            <p>
              Prices may be outdated; always check the store before buying. PlayRadar is not affiliated with Valve,
              Steam, Epic Games or the Epic Games Store, and doesn&apos;t sell games.
            </p>
            <p>
              Game data from <a className="underline" href="https://www.igdb.com">IGDB</a>. Prices from{" "}
              <a className="underline" href="https://isthereanydeal.com">IsThereAnyDeal</a>. Videos from YouTube.{" "}
              <Link className="underline" href="/privacy">Privacy</Link> ·{" "}
              <Link className="underline" href="/terms">Terms</Link>
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
