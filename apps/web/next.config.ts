import type { NextConfig } from "next";

// Headers for the PWA files (ARC-8 phase A, leaf-1.4.2 ADR-3). The service worker must never be
// served from an HTTP cache, or a fixed worker would not reach installed clients.
const nextConfig: NextConfig = {
  poweredByHeader: false,
  headers() {
    return Promise.resolve([
      {
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
        ],
      },
      {
        source: "/manifest.webmanifest",
        headers: [
          { key: "Content-Type", value: "application/manifest+json; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache" },
        ],
      },
    ]);
  },
};

export default nextConfig;
