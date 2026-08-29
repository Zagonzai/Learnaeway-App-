/* Learnæway service worker.
 * Content that can change (HTML/CSS/JS/course data) is network-first so
 * deploys show up immediately; only falls back to cache when offline.
 * Heavy binary assets (images) are cache-first since they rarely change.
 */
const CACHE = "learnaeway-v73";

const SHELL = [
  "./",
  "./index.html",
  "./css/style.css",
  "./js/app.js",
  "./js/config.js",
  "./js/firebase.js",
  "./data/course-data.js",
  "./data/videos.json",
  "./manifest.webmanifest",
  "./assets/logo/logo-symbol-v2@3x.png",
  "./assets/logo/logo-wordmark@3x.png",
  "./assets/backgrounds/wave-header@2x.png",
  /* one clip for both layouts now: the phone's header and the desktop banner
     play the same file, so precaching it covers both */
  "./assets/video/header-loop.mp4",
  "./assets/backgrounds/app-background-card-v2@2x.png",
  "./assets/backgrounds/login-screen-background@2x.png",
  "./assets/bars/background-bar-pill@2x.png",
  "./assets/backgrounds/background-card-gridpattern@2x.png",
  "./assets/backgrounds/background-card-plain@2x.png",
  "./assets/bars/info-bar@2x.png",
  "./assets/nav-icons/icon-video-play@2x.png",
  "./assets/nav-icons/icon-knowledge-test-lightning@2x.png",
  "./assets/buttons-pill/button-pill-standard@2x.png",
  "./assets/buttons-pill/button-gradient-blue@2x.png",
  "./assets/buttons-pill/button-gradient-pink@2x.png",
  "./assets/buttons-pill/button-gradient-long@2x.png",
  "./assets/buttons-pill/button-start-match@2x.png",
  "./assets/buttons-icon/btn-ask-aeway-v2@2x.png",
  "./assets/buttons-icon/btn-play@2x.png",
  "./assets/buttons-icon/btn-pause@2x.png",
  "./assets/buttons-icon/speaker-on@2x.png",
  "./assets/buttons-icon/speaker-muted@2x.png",
  /* the footer's narration toggle is a different control and keeps its own */
  "./assets/buttons-icon/btn-volume-on@2x.png",
  "./assets/buttons-icon/btn-volume-off@2x.png",
  "./assets/buttons-icon/btn-replay@2x.png",
  "./assets/nav-icons/icon-home@2x.png",
  "./assets/nav-icons/icon-trade-day@2x.png",
  "./assets/nav-icons/icon-trade-journal@2x.png",
  "./assets/bars/checkin-row-plate@2x.png",
  "./assets/buttons-icon/checkin-status-ring@2x.png",
  "./assets/buttons-icon/checkin-yes-no-toggle@2x.png",
  "./assets/buttons-icon/label-button@2x.png",
  "./assets/buttons-icon/profile-ring@2x.png",
  "./assets/buttons-icon/streak-filled@2x.png",
  "./assets/buttons-icon/plus-button@2x.png",
  "./assets/nav-icons/cat-start-day@2x.png",
  "./assets/nav-icons/cat-before-trade@2x.png",
  "./assets/nav-icons/cat-after-trade@2x.png",
  "./assets/nav-icons/cat-discipline-streak@2x.png",
  "./assets/nav-icons/icon-match-replay@2x.png",
  "./assets/nav-icons/icon-dock-match-replay@2x.png",
  "./assets/nav-icons/icon-chevron-down@2x.png",
  "./assets/desktop/bar@2x.png",
  "./assets/desktop/square@2x.png",
  "./assets/desktop/chart@2x.png",
  "./assets/desktop/wide@2x.png",
  "./assets/dropdown/panel@2x.png",
  "./assets/dropdown/logo-box@2x.png",
  "./assets/dropdown/check-on@2x.png",
  "./assets/dropdown/check-off@2x.png",
  "./assets/dropdown/link-all@2x.png",
  "./assets/dropdown/unlink-all@2x.png",
  "./assets/dropdown/btn-add@2x.png",
  "./assets/dropdown/btn-edit@2x.png",
  "./assets/dropdown/btn-delete@2x.png",
  "./assets/dropdown/btn-close@2x.png",
  "./assets/nav-icons/stat-month-cal@2x.png",
  "./assets/nav-icons/stat-total-pnl@2x.png",
  "./assets/nav-icons/stat-net-pnl@2x.png",
  "./assets/nav-icons/stat-recent-trade@2x.png",
  "./assets/buttons-icon/icon-button-frame@2x.png",
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
