import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import "@ghost-frame/theme/style.css";
import "./globals.css";
import "./editorial.css";
import "./signal-modes.css";
import { DesktopShell } from "@/components/DesktopShell";
import { SignalEnvironment } from "@/components/SignalEnvironment";

// Self-hosts the restrained interface face in the static desktop export.
const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

// Self-hosts workspace notation without requiring a runtime network request.
const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["500"],
  display: "swap",
});

// Describes this application surface to browsers and operating-system shells.
export const metadata: Metadata = {
  title: "FrameShift",
  description: "Project-aware personas for coding agents",
};

// Wraps every desktop route in the shared project-aware application shell.
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${plexSans.variable} ${plexMono.variable}`}>
      <head>
        <meta name="color-scheme" content="dark" />
      </head>
      <body>
        <SignalEnvironment />
        <DesktopShell>{children}</DesktopShell>
      </body>
    </html>
  );
}
