// The message the service worker (public/sw.js) handles by deleting the kept pages (the Today
// plan and cook sheet). Sign-out (1.4.6) calls clearOfflineCache() so a shared device keeps no
// household plan (SPEC-Q-7).
export const CLEAR_OFFLINE_CACHE = "mise:clear-offline-cache";

/**
 * Deletes the pages kept for offline reading, directly and through the active worker. Self-
 * contained (no module references) so tests can run it in the page as it is.
 */
export async function clearOfflineCache(): Promise<void> {
  if ("caches" in globalThis) {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((key) => key.startsWith("mise-pages-")).map((key) => caches.delete(key)),
    );
  }
  if ("serviceWorker" in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    for (const registration of registrations) {
      registration.active?.postMessage({ type: "mise:clear-offline-cache" });
    }
  }
}
