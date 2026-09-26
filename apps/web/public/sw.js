/* global self, caches, fetch, Response */
// Service worker, PWA phase A (ARC-8; leaf-1.4.2 ADR-3).
// - Precaches the offline page, the manifest and the icons.
// - /_next/static/**: cache-first (content-hashed, immutable).
// - Pages under OFFLINE_READ_PATHS (the Today plan and the cook sheet): network-first; the last
//   good response is kept so they can be read offline.
// - Any other page: network, falling back to /offline.
// - Never cached: non-GET requests, /api/**, other origins.
// - The message { type: "mise:clear-offline-cache" } deletes every cache (sign-out).

const VERSION = "v1";
const SHELL_CACHE = `mise-shell-${VERSION}`;
const STATIC_CACHE = `mise-static-${VERSION}`;
const PAGES_CACHE = `mise-pages-${VERSION}`;
const CURRENT = new Set([SHELL_CACHE, STATIC_CACHE, PAGES_CACHE]);

const OFFLINE_URL = "/offline";
const PRECACHE = [
  OFFLINE_URL,
  "/manifest.webmanifest",
  "/icons/icon.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
  "/icons/apple-touch-icon.png",
];
const OFFLINE_READ_PATHS = ["/today", "/kitchen"];
const CLEAR_MESSAGE = "mise:clear-offline-cache";

function isUnder(pathname, prefix) {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("mise-") && !CURRENT.has(key))
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === CLEAR_MESSAGE) {
    event.waitUntil(
      caches
        .keys()
        .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
        .then(() => caches.open(SHELL_CACHE))
        .then((cache) => cache.addAll(PRECACHE)),
    );
  }
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(STATIC_CACHE);
    await cache.put(request, response.clone());
  }
  return response;
}

async function networkFirstPage(request) {
  const cache = await caches.open(PAGES_CACHE);
  try {
    const response = await fetch(request);
    // Keep only complete, same-origin HTML pages (not redirects to sign-in or errors).
    if (response.ok && !response.redirected && response.type === "basic") {
      await cache.put(request.url, response.clone());
    }
    return response;
  } catch {
    const cached = await cache.match(request.url);
    return cached || offlineFallback();
  }
}

async function networkOrOffline(request) {
  try {
    return await fetch(request);
  } catch {
    return offlineFallback();
  }
}

async function offlineFallback() {
  const cached = await caches.match(OFFLINE_URL);
  return (
    cached ||
    new Response("You're offline.", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    })
  );
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (isUnder(url.pathname, "/api")) return;

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(request));
    return;
  }
  if (request.mode === "navigate") {
    const offlineRead = OFFLINE_READ_PATHS.some((path) => isUnder(url.pathname, path));
    event.respondWith(offlineRead ? networkFirstPage(request) : networkOrOffline(request));
  }
});
