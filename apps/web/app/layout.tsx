import type { Metadata } from "next";
import { DM_Mono, DM_Sans, Syne } from "next/font/google";
import { Providers } from "./providers";
import "./globals.css";

// Design system fonts (.ai/knowledge/technical/frontend/design-system.md "Typography") —
// self-hosted via next/font (no runtime request to Google Fonts, no layout-shift flash).
// tailwind.config.ts's font-display/font-body/font-mono utilities point at these CSS variables.
const syne = Syne({ subsets: ["latin"], variable: "--font-syne", weight: ["600", "700", "800"] });
const dmSans = DM_Sans({ subsets: ["latin"], variable: "--font-dm-sans" });
const dmMono = DM_Mono({ subsets: ["latin"], variable: "--font-dm-mono", weight: ["400", "500"] });

export const metadata: Metadata = {
  title: "CodeIQ",
  description: "AI code review for every pull request.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${syne.variable} ${dmSans.variable} ${dmMono.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
