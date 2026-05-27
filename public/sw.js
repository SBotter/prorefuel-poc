// Minimal service worker — enables PWA installability on Chrome/Android/Desktop.
// No caching strategy: all requests pass through to the network as normal.
// This solely satisfies the browser's "has a service worker" requirement for
// the "Add to Home Screen" / install prompt to appear.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (e) => e.respondWith(fetch(e.request)));
