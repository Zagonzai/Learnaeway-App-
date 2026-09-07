/* Learnæway — dock chrome for iPhone home-screen
 * Keeps --vhpx honest in standalone so the app column fills the webview.
 * (No dock minimize — dock stays fully visible above the safe-area fill.)
 */
(function () {
  "use strict";

  function isStandalone() {
    return !!(window.navigator.standalone) ||
      window.matchMedia("(display-mode: standalone)").matches;
  }

  function syncViewportHeight() {
    const vv = window.visualViewport;
    let h = Math.max(
      window.innerHeight || 0,
      document.documentElement.clientHeight || 0,
      vv ? (vv.height || 0) + (vv.offsetTop || 0) : 0
    );
    if (isStandalone() && h > 0) {
      const body = document.body.getBoundingClientRect();
      if (body && body.height > h) h = body.height;
    }
    if (h > 0) document.documentElement.style.setProperty("--vhpx", h + "px");
  }

  syncViewportHeight();
  [50, 250, 800, 2000].forEach((ms) => setTimeout(syncViewportHeight, ms));
  window.addEventListener("resize", syncViewportHeight);
  window.addEventListener("orientationchange", syncViewportHeight);
  window.addEventListener("pageshow", syncViewportHeight);
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", syncViewportHeight);
    window.visualViewport.addEventListener("scroll", syncViewportHeight);
  }
})();
