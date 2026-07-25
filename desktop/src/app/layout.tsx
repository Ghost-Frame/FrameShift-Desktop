import type { Metadata } from "next";
import "@ghost-frame/theme/style.css";
import "./globals.css";
import { DesktopShell } from "@/components/DesktopShell";

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
    <html lang="en">
      <head>
        <meta name="color-scheme" content="dark" />
      </head>
      <body>
        <DesktopShell>{children}</DesktopShell>
      </body>
    </html>
  );
}
