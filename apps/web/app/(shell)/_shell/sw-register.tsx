"use client";

import { useEffect } from "react";

/**
 * Registers public/sw.js (ARC-8 phase A) in production builds. Development skips it so hot
 * reload is never served from the worker's cache.
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .catch((error: unknown) => {
        // Offline support is an enhancement; the app works without it.
        console.warn("Service worker registration failed", error);
      });
  }, []);
  return null;
}
