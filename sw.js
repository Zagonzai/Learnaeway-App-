/* Learnæway service worker.
 * Content that can change (HTML/CSS/JS/course data) is network-first so
 * deploys show up immediately; only falls back to cache when offline.
 * Heavy binary assets (images) are cache-first since they rarely change.
 */
const CACHE = "learnaeway-v2";

const SHELL = [
  "./",
  "./index.html",
  "./css/style.css",
  "./js/app.js",
  "./data/course-data.js",
  "./manifest.webmanifest",
  "./assets/logo/logo-symbol@3x.png",
  "./assets/logo/logo-wordmark@3x.png",
  "./assets/avatars/avatar-eyes-open@2x.png",
  "./assets/avatars/avatar-eyes-open-mouth-open@2x.png",
  "./assets/avatars/avatar-eyes-open-mouth-smile@2x.png",
  "./assets/backgrounds/wave-header@2x.png",
  "./assets/buttons-icon/btn-ask-aeway@2x.png",
  "./assets/buttons-icon/btn-play@2x.png",
  "./assets/buttons-icon/btn-pause@2x.png",
  "./assets/buttons-icon/btn-volume-on@2x.png",
  "./assets/buttons-icon/btn-volume-off@2x.png",
  "./assets/buttons-icon/btn-replay@2x.png",
  "./assets/nav-icons/icon-home@2x.png",
  "./assets/nav-icons/icon-layer@2x.png",
  "./assets/nav-icons/icon-menu@2x.png",
  "./assets/nav-icons/icon-settings@2x.png",
  "./assets/nav-icons/icon-user@2x.png",
  "./assets/pwa/icon-192.png",
  "./assets/pwa/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const CACHE_FIRST = /\/assets\//;

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return;

  if (CACHE_FIRST.test(url.pathname)) {
    e.respondWith(
      caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
        if (res.ok) caches.open(CACHE).then((c) => c.put(e.request, res.clone()));
        return res;
      }))
    );
    return;
  }

  // network-first: always serve the latest deploy when online
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) caches.open(CACHE).then((c) => c.put(e.request, res.clone()));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
