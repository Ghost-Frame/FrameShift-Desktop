import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "export",
  // Keep Next.js tracing scoped to this self-contained desktop workspace.
  outputFileTracingRoot: __dirname,
  // Disable image optimization for static export
  images: {
    unoptimized: true,
  },
  // Tauri expects static files -- no trailing slash needed for file:// protocol
  trailingSlash: true,
};

export default nextConfig;
