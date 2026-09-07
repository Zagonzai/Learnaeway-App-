/* Learnæway — dock chrome for iPhone home-screen
 * 1) Keeps --vhpx honest in standalone
 * 2) Minimizes the bottom pill on scroll-down so the main card can use more of the screen
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
    /* In standalone, a short reading leaves a black band under the dock.
       Prefer the largest webview-bounded figure; never use raw screen.height
       (that overshoots and clips the dock). */
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

  function bindDockMinimize() {
    const app = document.querySelector(".app");
    const scroller = document.getElementById("cardScroll");
    if (!app || !scroller) return;

    let lastY = 0;
    let ticking = false;

    function apply() {
      ticking = false;
      const y = scroller.scrollTop;
      const max = scroller.scrollHeight - scroller.clientHeight;
      if (max < 40) {
        app.classList.remove("dock-min");
        lastY = y;
        return;
      }
      const goingDown = y > lastY + 6;
      const goingUp = y < lastY - 6;
      if (y < 24) app.classList.remove("dock-min");
      else if (goingDown && y > 48) app.classList.add("dock-min");
      else if (goingUp) app.classList.remove("dock-min");
      lastY = y;
    }

    scroller.addEventListener("scroll", () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(apply);
      }
    }, { passive: true });

    /* Tap the minimized dock peek to expand again */
    const dock = document.getElementById("dock");
    if (dock) {
      dock.addEventListener("click", () => {
        if (app.classList.contains("dock-min")) app.classList.remove("dock-min");
      }, true);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindDockMinimize);
  } else {
    bindDockMinimize();
  }
})();
