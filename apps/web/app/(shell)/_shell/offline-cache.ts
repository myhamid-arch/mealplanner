// The message the service worker (public/sw.js) handles by deleting every cache. Sign-out
// (1.4.6) calls clearOfflineCache() so a shared device keeps no household plan (SPEC-Q-7).
export const CLEAR_OFFLINE_CACHE = "mise:clear-offline-cache";

export async function clearOfflineCache(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  const registrations = await navigator.serviceWorker.getRegistrations();
  for (const registration of registrations) {
    registration.active?.postMessage({ type: CLEAR_OFFLINE_CACHE });
  }
  // A page without an active worker can still hold caches from an earlier one.
  if ("caches" in globalThis) {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter((key) => key.startsWith("mise-")).map((key) => caches.delete(key)),
    );
  }
}
