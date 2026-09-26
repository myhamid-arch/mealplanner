import "@fontsource-variable/fraunces/opsz.css";
import "@fontsource/nunito/400.css";
import "@fontsource/nunito/600.css";
import "@fontsource/nunito/700.css";
import "@fontsource/nunito/800.css";
import "@fontsource/jetbrains-mono/500.css";
import "./globals.css";

import { tokensToCss } from "@mealplanner/ui-tokens/css";
import { colors } from "@mealplanner/ui-tokens/tokens";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { ServiceWorkerRegistration } from "./(shell)/_shell/sw-register";

// "Mise" is the mockups' placeholder product name (R2-UX-6).
export const metadata: Metadata = {
  title: { default: "Mise", template: "%s · Mise" },
  description: "Family meal planning with per-person macros.",
  applicationName: "Mise",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icons/icon.svg", type: "image/svg+xml" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180" }],
  },
  appleWebApp: { capable: true, title: "Mise", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: colors.light.paper },
    { media: "(prefers-color-scheme: dark)", color: colors.dark.paper },
  ],
};

const TOKEN_CSS = tokensToCss();

export default function RootLayout({ children }: { readonly children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Generated from the token source; no user input reaches it. */}
        <style id="mise-tokens" dangerouslySetInnerHTML={{ __html: TOKEN_CSS }} />
      </head>
      <body>
        {children}
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
