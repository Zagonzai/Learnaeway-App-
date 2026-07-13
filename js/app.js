/* ==========================================================================
   Learnæway PWA — app shell
   Views: home (deck outline + tabs) and learning screens (swipe navigation).
   Persistence: localStorage (progress, likes, bookmarks, notes, settings).
   Audio is a v2 hook — placeholders only, no playback wired in v1.
   ========================================================================== */
(function () {
  "use strict";

  const DATA = window.COURSE_DATA;

  /* ---------------- flatten course into navigable lists ---------------- */

  const screens = [];          // ordered flat list of every screen
  const screenIndex = {};      // id -> index into screens[]
  DATA.modules.forEach((mod, mi) => {
    mod.sections.forEach((sec, si) => {
      sec.subsections.forEach((sub, bi) => {
        sub.screens.forEach((scr, ki) => {
          screenIndex[scr.id] = screens.length;
          screens.push({ scr, sub, sec, mod, mi, si, bi, ki });
        });
      });
    });
  });

  /* ---------------- persistent store ---------------- */

  const KEY = "learnaeway.v1";
  const store = load();
  if (!store.checklist) store.checklist = {};   // daily trading checklist ticks
  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* corrupted store — start fresh */ }
    return {
      visited: {},           // screenId -> true
      liked: {},             // screenId -> true
      saved: {},             // screenId -> true (bookmarks)
      notes: {},             // screenId -> text
      lastScreen: null,
      settings: { sound: true, textSize: "M", name: "" },
    };
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) { /* quota */ }
  }

  /* ---------------- state ---------------- */

  const state = {
    view: "home",            // 'home' | 'screen'
    homeTab: "sections",     // 'sections' | 'liked' | 'saved'
    homeModule: 0,           // module index shown on home
    expanded: null,          // section id expanded into subsection deck
    current: 0,              // index into screens[] for learning view
    slideDir: 0,             // -1 back, +1 forward (animation)
  };

  /* ---------------- els ---------------- */

  const $ = (id) => document.getElementById(id);
  const cardScroll = $("cardScroll");
  const cardFooter = $("cardFooter");
  const barTitle = $("barTitle");
  const progressFill = $("progressFill");
  const progressLabel = $("progressLabel");
  const overlay = $("overlay");
  const overlayPanel = $("overlayPanel");

  /* ---------------- inline SVG icons (notes / bookmark / heart / close)
     icon-notes, icon-bookmark, icon-heart were not exported in the asset
     zip (open item in the spec) — substituted with matching SVGs. -------- */

  const SVG = {
    bookmark: '<svg viewBox="0 0 24 24"><path class="ico" d="M6 3h12a1 1 0 0 1 1 1v17l-7-4.5L5 21V4a1 1 0 0 1 1-1z"/></svg>',
    heart: '<svg viewBox="0 0 24 24"><path class="ico" d="M12 21s-7.5-4.7-9.7-9.2C.8 8.6 2.7 5 6.2 5c2.2 0 3.6 1.2 4.4 2.5l1.4 2 1.4-2C14.2 6.2 15.6 5 17.8 5c3.5 0 5.4 3.6 3.9 6.8C19.5 16.3 12 21 12 21z"/></svg>',
    notes: '<svg viewBox="0 0 24 24"><rect class="ico" x="5" y="4" width="14" height="17" rx="2.5"/><path class="ico" d="M9 2.5v3M15 2.5v3M8.5 10h7M8.5 13.5h7M8.5 17h4.5"/></svg>',
    checklist: '<svg viewBox="0 0 24 24"><rect class="ico" x="5" y="4" width="14" height="17" rx="2.5"/><path class="ico" d="M9 2.5v3M15 2.5v3M8.2 10.6l1.6 1.6 3.2-3.2M8.2 16.4l1.6 1.6 3.2-3.2M15.2 11.4h1.4M15.2 17.2h1.4"/></svg>',
  };

  /* Daily trading checklist — a static discipline tool checked off before a
     trade. Completely separate from course progress. Rules distilled from
     the course's Daily Trading Checklist and Trading Psychology sections. */
  const CHECKLIST_ITEMS = [
    "I am well-rested, calm, and emotionally ready to trade",
    "I have checked the economic calendar for news and reports",
    "I know which market sessions and opening times are in play",
    "I have marked higher-timeframe support and resistance levels",
    "I have identified the trend and set my directional bias",
    "My setup matches my strategy — I am not forcing a trade",
    "My stop loss, position size, and max daily loss are defined",
    "The reward-to-risk ratio justifies taking this trade",
    "I am not trading out of boredom, FOMO, or revenge",
    "I accept that this trade can lose, and I am okay with that",
  ];

  /* ---------------- progress helpers ---------------- */

  function subProgress(sub) {
    const done = sub.screens.filter((s) => store.visited[s.id]).length;
    return { done, total: sub.screens.length, pct: sub.screens.length ? Math.round((100 * done) / sub.screens.length) : 0 };
  }
  function secProgress(sec) {
    let done = 0, total = 0;
    sec.subsections.forEach((sub) => sub.screens.forEach((s) => { total++; if (store.visited[s.id]) done++; }));
    return { done, total, pct: total ? Math.round((100 * done) / total) : 0 };
  }
  function overallProgress() {
    const total = screens.length;
    const done = screens.filter((e) => store.visited[e.scr.id]).length;
    return { done, total, pct: total ? Math.round((100 * done) / total) : 0 };
  }


  /* ---------------- rendering: learning screen ---------------- */

  function esc(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // paragraphs shaped like "Term — definition" get teal-term styling
  function bodyHTML(paras) {
    return paras.map((p) => {
      const m = p.match(/^(.{2,60}?) — (.+)$/s);
      if (m) return `<p class="term"><strong>${esc(m[1])}</strong> — ${esc(m[2])}</p>`;
      return `<p>${esc(p)}</p>`;
    }).join("");
  }

  // hand-drawn SVG diagrams for visual screens (reference style: screenshots)
  function diagramFor(entry) {
    const sub = entry.sub.id;
    if (sub.includes("anatomy-of-a-candlestick") && entry.ki === 0) return CANDLE_ANATOMY_SVG;
    if (sub.includes("different-types-of-charts")) return CANDLE_RUN_SVG;
    return "";
  }

  const CANDLE_ANATOMY_SVG = `
  <div class="diagram" aria-label="Candlestick anatomy diagram">
  <svg viewBox="0 0 340 260">
    <defs>
      <linearGradient id="gGreen" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#2FE6C2"/><stop offset="1" stop-color="#0e8f77"/>
      </linearGradient>
      <linearGradient id="gRed" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#ff5470"/><stop offset="1" stop-color="#c40f3a"/>
      </linearGradient>
    </defs>
    <!-- bullish candle -->
    <line x1="60" y1="18" x2="60" y2="242" stroke="#2FE6C2" stroke-width="3"/>
    <rect x="36" y="66" width="48" height="128" rx="7" fill="url(#gGreen)" stroke="#9ffbe9" stroke-width="1.5"/>
    <!-- bearish candle -->
    <line x1="280" y1="18" x2="280" y2="242" stroke="#ff5470" stroke-width="3"/>
    <rect x="256" y="66" width="48" height="128" rx="7" fill="url(#gRed)" stroke="#ffb3c4" stroke-width="1.5"/>
    <!-- wick labels -->
    <text x="170" y="30" fill="#EAF6FF" font-size="15" font-weight="700" text-anchor="middle">Wick</text>
    <line x1="78" y1="25" x2="140" y2="25" stroke="#FF3D9A" stroke-width="2" marker-start="url(#aL)"/>
    <line x1="200" y1="25" x2="262" y2="25" stroke="#FF3D9A" stroke-width="2"/>
    <polygon points="78,25 88,20 88,30" fill="#FF3D9A"/>
    <polygon points="262,25 252,20 252,30" fill="#FF3D9A"/>
    <text x="170" y="236" fill="#EAF6FF" font-size="15" font-weight="700" text-anchor="middle">Wick</text>
    <line x1="78" y1="231" x2="140" y2="231" stroke="#FF3D9A" stroke-width="2"/>
    <line x1="200" y1="231" x2="262" y2="231" stroke="#FF3D9A" stroke-width="2"/>
    <polygon points="78,231 88,226 88,236" fill="#FF3D9A"/>
    <polygon points="262,231 252,226 252,236" fill="#FF3D9A"/>
    <!-- body labels -->
    <text x="170" y="115" fill="#BFE9FF" font-size="12" text-anchor="middle">Body: open to close</text>
    <text x="170" y="133" fill="#BFE9FF" font-size="12" text-anchor="middle">Wicks: highest and</text>
    <text x="170" y="151" fill="#BFE9FF" font-size="12" text-anchor="middle">lowest price reached</text>
  </svg></div>`;

  const CANDLE_RUN_SVG = `
  <div class="diagram" aria-label="Candlestick chart example">
  <svg viewBox="0 0 340 150">
    ${[
      [12, 60, 26, "r"], [34, 74, 34, "r"], [56, 96, 18, "g"], [78, 84, 30, "g"],
      [100, 62, 40, "g"], [122, 46, 30, "g"], [144, 38, 18, "r"], [166, 44, 26, "r"],
      [188, 58, 20, "g"], [210, 52, 34, "r"], [232, 74, 42, "r"], [254, 98, 22, "r"],
      [276, 108, 18, "g"], [298, 100, 24, "g"], [320, 88, 20, "g"],
    ].map(([x, y, h, c]) => {
      const col = c === "g" ? "#2FE6C2" : "#ff5470";
      return `<line x1="${x + 7}" y1="${y - 14}" x2="${x + 7}" y2="${y + h + 14}" stroke="${col}" stroke-width="2"/>
              <rect x="${x}" y="${y}" width="14" height="${h}" rx="3" fill="${col}" opacity="0.92"/>`;
    }).join("")}
  </svg></div>`;

  function renderScreen() {
    stopAudio();
    const entry = screens[state.current];
    const { scr, sub, sec } = entry;
    const p = subProgress(sub);

    // mark visited (progress) — completing the subsection earns a smile
    const before = p.done;
    if (!store.visited[scr.id]) {
      store.visited[scr.id] = true;
      store.lastScreen = scr.id;
      save();
      const after = subProgress(sub);
    } else {
      store.lastScreen = scr.id;
      save();
    }

    barTitle.textContent = sec.title;
    const pos = entry.ki + 1;
    progressLabel.textContent = `${pos} of ${sub.screens.length}`;
    progressFill.style.width = `${Math.round((100 * pos) / sub.screens.length)}%`;

    const anim = state.slideDir > 0 ? "slide-in-left" : state.slideDir < 0 ? "slide-in-right" : "";
    cardScroll.innerHTML = `
      <div class="${anim}">
        <!-- AUDIO: ${scr.audio} -->
        <img class="card-logo" src="assets/logo/logo-symbol-v2@3x.png" alt="">
        <h1 class="screen-headline">${esc(scr.headline)}</h1>
        ${scr.subhead ? `<h2 class="screen-subhead">${esc(scr.subhead)}</h2>` : ""}
        ${diagramFor(entry)}
        <div class="screen-body">${bodyHTML(scr.body)}</div>
        ${scr.list ? `<ol class="screen-list">${scr.list.map((it) => `<li>${esc(it)}</li>`).join("")}</ol>` : ""}
        ${scr.listClose ? `<div class="screen-body">${bodyHTML([].concat(scr.listClose))}</div>` : ""}
      </div>`;
    cardScroll.scrollTop = 0;
    cardFooter.style.display = "";
    syncMarks();
  }

  function syncMarks() {
    const entry = state.view === "screen" ? screens[state.current] : null;
    const id = entry ? entry.scr.id : null;
    $("btnHeart").classList.toggle("on-magenta", id && !!store.liked[id]);
  }

  /* ---------------- rendering: home / outline ---------------- */

  function renderHome() {
    const mod = DATA.modules[state.homeModule];
    const ov = overallProgress();

    barTitle.textContent = "Learnæway's Path to Trading Course";
    progressLabel.textContent = `${ov.pct}%`;
    progressFill.style.width = `${ov.pct}%`;

    let body = "";
    if (state.homeTab === "sections") {
      body = mod.sections.map((sec) => {
        const p = secProgress(sec);
        const expanded = state.expanded === sec.id;
        let row = `
          <div class="deck">
            <div class="deck-peek p3"></div><div class="deck-peek p2"></div><div class="deck-peek p1"></div>
            <button class="section-row" data-sec="${sec.id}">
              <span class="sec-title">${esc(sec.title)}</span>
              <span class="pct-badge ${p.pct === 100 ? "done" : ""}" style="--pct:${p.pct}">${p.pct}%</span>
            </button>
          </div>`;
        if (expanded) {
          row += `
          <div class="subsection-panel">
            <img class="panel-logo" src="assets/logo/logo-symbol-v2@3x.png" alt="">
            ${sec.subsections.map((sub) => {
              const sp = subProgress(sub);
              return `
              <button class="subsection-row" data-sub="${sub.id}">
                <span class="sub-title">${esc(sub.title)}</span>
                <span class="pct-badge ${sp.pct === 100 ? "done" : ""}" style="--pct:${sp.pct}">${sp.pct}%</span>
              </button>`;
            }).join("")}
          </div>`;
        }
        return row;
      }).join("");
    } else if (state.homeTab === "liked") {
      const groups = {};
      screens.forEach((e) => {
        if (store.liked[e.scr.id]) (groups[e.sec.id] = groups[e.sec.id] || { sec: e.sec, items: [] }).items.push(e);
      });
      const keys = Object.keys(groups);
      if (!keys.length) {
        body = `<div class="liked-empty">No liked screens yet.<br>
          Tap the heart on any learning screen to like it.</div>`;
      } else {
        body = keys.map((k) => {
          const g = groups[k];
          return `
            <div class="liked-group-title">${esc(g.sec.title)} (${g.items.length} liked)</div>
            ${g.items.map((e) => `
              <button class="liked-row" data-screen="${e.scr.id}">
                <span class="liked-label">${esc(e.scr.subhead || e.sub.title)}
                  <span class="liked-sub">Screen ${e.ki + 1} of ${e.sub.screens.length}</span>
                </span>
                ${SVG.heart.replace('class="ico"', 'class="ico" style="fill:#FF3D9A;stroke:#FF3D9A"')}
              </button>`).join("")}`;
        }).join("");
      }
    } else {
      // Notes tab: every note across the course, tap to jump to its page
      const ids = Object.keys(store.notes)
        .filter((k) => store.notes[k] && store.notes[k].trim() && screenIndex[k] !== undefined);
      if (!ids.length) {
        body = `<div class="liked-empty">No notes yet.<br>
          Open any lesson and tap the notes icon in the footer to write one.</div>`;
      } else {
        body = ids.map((k) => {
          const e = screens[screenIndex[k]];
          return `
            <button class="liked-row" data-screen="${k}">
              <span class="liked-label">${esc(e.sec.title)} · Screen ${e.ki + 1} of ${e.sub.screens.length}
                <span class="liked-sub">${esc(store.notes[k].slice(0, 90))}</span>
              </span>
              ${SVG.notes.replace('class="ico"', 'class="ico" style="stroke:#2FE6C2"')}
            </button>`;
        }).join("");
      }
    }

    cardScroll.innerHTML = `
      <div class="home-head">
        <img class="home-logo" src="assets/logo/logo-symbol-v2@3x.png" alt="">
        <div class="home-module-title">Sections · Module ${mod.num} of ${DATA.modules.length}</div>
        <div class="home-module-tagline">${esc(mod.tagline)}</div>
      </div>
      <div class="home-tabs">
        <button class="home-tab ${state.homeTab === "sections" ? "active" : ""}" data-tab="sections">All Sections</button>
        <button class="home-tab ${state.homeTab === "liked" ? "active" : ""}" data-tab="liked">Liked</button>
        <button class="home-tab ${state.homeTab === "notes" ? "active" : ""}" data-tab="notes">Notes</button>
      </div>
      ${state.homeTab === "sections" ? `
      <div class="home-tabs">
        ${DATA.modules.map((m, i) => `<button class="home-tab ${i === state.homeModule ? "active" : ""}" data-mod="${i}">Module ${m.num}</button>`).join("")}
      </div>
      ${continueHTML()}` : ""}
      ${body}`;
    cardFooter.style.display = "none";
    syncMarks();
  }

  // progress saves automatically (store.lastScreen updates on every screen
  // view) — Continue reopens the course at the last page reached.
  function continueHTML() {
    const id = store.lastScreen;
    if (!id || screenIndex[id] === undefined) return "";
    const e = screens[screenIndex[id]];
    return `
      <button class="continue-row" data-screen="${id}">
        <span class="cont-label">Continue</span>
        <span class="cont-where">${esc(e.sec.title)} · Screen ${e.ki + 1} of ${e.sub.screens.length}</span>
        <span class="cont-arrow">›</span>
      </button>`;
  }

  function render() {
    $("cardOuter").classList.toggle("outline-bg", state.view === "home");
    if (state.view === "home") renderHome();
    else renderScreen();
  }

  /* ---------------- navigation ---------------- */

  function gotoScreenId(id) {
    const idx = screenIndex[id];
    if (idx === undefined) return;
    state.view = "screen";
    state.current = idx;
    state.slideDir = 0;
    closeOverlay();
    render();
  }

  function step(dir) {
    if (state.view !== "screen") return;
    const next = state.current + dir;
    if (next < 0 || next >= screens.length) return;
    state.current = next;
    state.slideDir = dir;
    render();
  }

  function goHome() {
    stopAudio();
    state.view = "home";
    state.slideDir = 0;
    closeOverlay();
    render();
  }

  /* ---------------- swipe (min 40px horizontal, learning screens only) -- */

  let touchX = null, touchY = null;
  const cardOuter = $("cardOuter");
  cardOuter.addEventListener("touchstart", (e) => {
    touchX = e.touches[0].clientX;
    touchY = e.touches[0].clientY;
  }, { passive: true });
  cardOuter.addEventListener("touchend", (e) => {
    if (touchX === null || state.view !== "screen") { touchX = touchY = null; return; }
    const dx = e.changedTouches[0].clientX - touchX;
    const dy = e.changedTouches[0].clientY - touchY;
    touchX = touchY = null;
    if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy) * 1.2) return; // avoid accidental triggers
    step(dx < 0 ? 1 : -1); // swipe left -> next, swipe right -> previous
  }, { passive: true });

  // desktop convenience
  document.addEventListener("keydown", (e) => {
    if (overlay.classList.contains("hidden") === false) return;
    if (e.key === "ArrowRight") step(1);
    if (e.key === "ArrowLeft") step(-1);
  });

  /* ---------------- overlays ---------------- */

  function openOverlay(html) {
    overlayPanel.innerHTML = `<div class="panel-inner">${html}</div>`;
    overlay.classList.remove("hidden");
  }
  function closeOverlay() {
    overlay.classList.add("hidden");
  }
  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeOverlay(); });

  function panelHead(title) {
    return `<div class="panel-head"><div class="panel-title">${esc(title)}</div>
      <button class="panel-close" data-close>✕</button></div>`;
  }

  /* menu drawer — full section/subsection navigation (same as All Sections) */
  function openMenu() {
    const html = panelHead("Course Menu") + DATA.modules.map((mod) => `
      <div class="menu-module">
        <div class="menu-module-title">Module ${mod.num} — ${esc(mod.tagline)}</div>
        ${mod.sections.map((sec) => {
          const p = secProgress(sec);
          const cur = state.view === "screen" && screens[state.current].sec.id === sec.id;
          return `<button class="menu-item ${cur ? "current" : ""}" data-menu-sec="${sec.id}" data-mod-idx="${DATA.modules.indexOf(mod)}">
            ${esc(sec.title)}<span class="mi-pct">${p.pct}%</span></button>`;
        }).join("")}
      </div>`).join("") +
      `<button class="menu-logout" data-logout>Log Out</button>`;
    openOverlay(html);
  }

  /* settings */
  function openSettings() {
    const s = store.settings;
    const html = panelHead("Settings") + `
      <div class="set-group">
        <div class="set-label">Audio narration (default)</div>
        <div class="set-options">
          <button class="set-opt ${s.sound ? "active" : ""}" data-set-sound="1">On</button>
          <button class="set-opt ${!s.sound ? "active" : ""}" data-set-sound="0">Off</button>
        </div>
      </div>
      <div class="set-group">
        <div class="set-label">Text size</div>
        <div class="set-options">
          ${["S", "M", "L"].map((t) => `<button class="set-opt ${s.textSize === t ? "active" : ""}" data-set-size="${t}">${t}</button>`).join("")}
        </div>
      </div>
      <div class="set-group">
        <div class="set-label">Account</div>
        <input class="set-input" id="setName" placeholder="Your name" value="${esc(s.name || "")}" maxlength="40">
      </div>
      <button class="btn-primary" data-close>Done</button>
      <button class="btn-secondary" data-reset-progress>Reset course progress</button>`;
    openOverlay(html);
  }

  function applyTextSize() {
    const map = { S: 0.9, M: 1, L: 1.14 };
    document.documentElement.style.setProperty("--fs", map[store.settings.textSize] || 1);
  }

  /* profile */
  function openProfile() {
    const ov = overallProgress();
    const counts = {
      liked: Object.keys(store.liked).length,
      saved: Object.keys(store.saved).length,
      notes: Object.keys(store.notes).filter((k) => store.notes[k] && store.notes[k].trim()).length,
    };
    const noteItems = Object.keys(store.notes)
      .filter((k) => store.notes[k] && store.notes[k].trim() && screenIndex[k] !== undefined)
      .map((k) => {
        const e = screens[screenIndex[k]];
        return `<div class="note-item">
          <div class="note-where">${esc(e.sec.title)} · Screen ${e.ki + 1}</div>
          <div class="note-text">${esc(store.notes[k])}</div>
        </div>`;
      }).join("");
    const html = panelHead(store.settings.name ? `${store.settings.name}'s Profile` : "Your Profile") + `
      <div class="profile-stat-grid">
        <div class="profile-stat"><div class="num">${ov.pct}%</div><div class="lbl">Course complete</div></div>
        <div class="profile-stat"><div class="num">${ov.done}</div><div class="lbl">Screens viewed</div></div>
        <div class="profile-stat"><div class="num">${counts.liked}</div><div class="lbl">Liked</div></div>
        <div class="profile-stat"><div class="num">${counts.saved}</div><div class="lbl">Saved</div></div>
      </div>
      ${noteItems ? `<div class="set-label" style="margin-top:18px">Your notes (${counts.notes})</div>${noteItems}` : ""}
      <button class="btn-primary" data-close>Close</button>`;
    openOverlay(html);
  }

  /* notes — per-screen editor on learning screens, browsable list elsewhere.
     Saves are keyed to the screen id captured at open time, so a note can
     never be dropped because the view state changed underneath the modal. */
  function openNotes() {
    if (state.view !== "screen") { openNotesList(); return; }
    const entry = screens[state.current];
    const existing = store.notes[entry.scr.id] || "";
    const html = panelHead("Notes") + `
      <div class="set-label">${esc(entry.sec.title)} · Screen ${entry.ki + 1} of ${entry.sub.screens.length}</div>
      <textarea class="notes-area" id="noteText" placeholder="Write a note for this screen…">${esc(existing)}</textarea>
      <div class="notes-hint">Notes are stored on this device and are also visible from your profile.</div>
      <button class="btn-primary" data-save-note="${entry.scr.id}">Save note</button>
      <button class="btn-secondary" data-notes-list>All notes</button>`;
    openOverlay(html);
    setTimeout(() => { const t = $("noteText"); if (t) t.focus(); }, 60);
  }

  function openNotesList() {
    const ids = Object.keys(store.notes)
      .filter((k) => store.notes[k] && store.notes[k].trim() && screenIndex[k] !== undefined);
    const items = ids.map((k) => {
      const e = screens[screenIndex[k]];
      return `<button class="menu-item" data-screen="${k}">
        <span>${esc(e.sec.title)} · Screen ${e.ki + 1}
          <span class="liked-sub">${esc(store.notes[k].slice(0, 90))}</span>
        </span></button>`;
    }).join("");
    const html = panelHead("Your Notes") + (items ||
      `<div class="liked-empty">No notes yet.<br>Open any learning screen and tap the notes icon in the top bar to write one.</div>`);
    openOverlay(html);
  }

  /* ask Æway — placeholder conversation entry point (v2) */
  function openAsk() {
    const html = panelHead("Ask Æway") + `
      <div class="liked-empty">Voice + chat with Æway is coming in v2.<br><br>
      For now, keep swiping — every screen you complete builds toward the full course.</div>
      <button class="btn-primary" data-close>Got it</button>`;
    openOverlay(html);
  }

  /* ---------------- marks: bookmark & heart ---------------- */

  function toggleLike() {
    if (state.view !== "screen") return;
    const id = screens[state.current].scr.id;
    if (store.liked[id]) delete store.liked[id];
    else store.liked[id] = true;
    save();
    syncMarks();
  }

  /* daily trading checklist overlay */
  function openChecklist() {
    const done = CHECKLIST_ITEMS.filter((_, i) => store.checklist[i]).length;
    const html = panelHead("Daily Trading Checklist") + `
      <div class="notes-hint" style="margin:0 0 12px">Run through this before entering any trade.
        Checked ${done} of ${CHECKLIST_ITEMS.length}. This is a discipline tool — it does not affect course progress.</div>
      ${CHECKLIST_ITEMS.map((item, i) => `
        <button class="check-row ${store.checklist[i] ? "done" : ""}" data-check="${i}">
          <span class="check-box">${store.checklist[i] ? "✓" : ""}</span>
          <span class="check-label">${esc(item)}</span>
        </button>`).join("")}
      <button class="btn-secondary" data-check-reset>Reset checklist</button>
      <button class="btn-primary" data-close>Done</button>`;
    openOverlay(html);
  }

  /* ---------------- narration audio (real playback where a track exists) --- */

  /* Narration player. audioSrc may be a single file or a list of parts —
     parts play back-to-back automatically as one seamless track (used by
     Why This Comes First, recorded in two takes). */
  let audioEl = null;
  let audioQueue = [];
  let audioQueueKey = null;
  let audioIndex = 0;
  let playing = false;
  function setPlayIcon(on) {
    $("playImg").src = on ? "assets/buttons-icon/btn-pause@2x.png" : "assets/buttons-icon/btn-play@2x.png";
  }
  function currentAudioSrc() {
    return state.view === "screen" ? screens[state.current].scr.audioSrc || null : null;
  }
  function loadTrack(i) {
    if (audioEl) audioEl.pause();
    audioIndex = i;
    audioEl = new Audio(audioQueue[i]);
    audioEl.muted = !store.settings.sound;
    audioEl.addEventListener("ended", () => {
      if (audioIndex + 1 < audioQueue.length) {
        loadTrack(audioIndex + 1);          // next part auto-starts seamlessly
        audioEl.play().catch(() => {});
      } else {
        playing = false;
        setPlayIcon(false);
      }
    });
  }
  function ensureAudio(src) {
    const tracks = [].concat(src);
    const key = tracks.join("|");
    if (audioQueueKey !== key || !audioEl) {
      audioQueue = tracks;
      audioQueueKey = key;
      loadTrack(0);
    }
    return audioEl;
  }
  function stopAudio() {
    if (audioEl) { audioEl.pause(); audioEl = null; }
    audioQueue = [];
    audioQueueKey = null;
    audioIndex = 0;
    playing = false;
    setPlayIcon(false);
  }
  $("btnPlay").addEventListener("click", () => {
    const src = currentAudioSrc();
    if (src) {
      const a = ensureAudio(src);
      if (playing) { a.pause(); playing = false; }
      else { a.play().catch(() => {}); playing = true; }
    } else {
      playing = !playing;    // no narration on this screen yet — visual toggle only
    }
    setPlayIcon(playing);
  });
  $("btnReplay").addEventListener("click", () => {
    const src = currentAudioSrc();
    if (!src) return;
    ensureAudio(src);
    loadTrack(0);
    audioEl.currentTime = 0;
    audioEl.play().catch(() => {});
    playing = true;
    setPlayIcon(true);
  });
  $("btnVolume").addEventListener("click", () => {
    store.settings.sound = !store.settings.sound;
    save();
    syncVolume();
  });
  function syncVolume() {
    $("volumeImg").src = store.settings.sound
      ? "assets/buttons-icon/btn-volume-on@2x.png"
      : "assets/buttons-icon/btn-volume-off@2x.png";
    if (audioEl) audioEl.muted = !store.settings.sound;
  }
  $("btnAskAeway").addEventListener("click", openAsk);

  /* ---------------- static buttons ---------------- */

  $("btnMenu").addEventListener("click", openMenu);
  $("btnSettings").addEventListener("click", openSettings);
  $("btnProfile").addEventListener("click", openProfile);
  $("btnHeart").addEventListener("click", toggleLike);
  $("btnChecklist").innerHTML = SVG.checklist;
  $("btnNotes").innerHTML = SVG.notes;
  $("btnHeart").innerHTML = SVG.heart;
  $("btnChecklist").addEventListener("click", openChecklist);
  $("btnNotes").addEventListener("click", openNotes);

  function openComingSoon(kind) {
    const meta = kind === "video"
      ? { icon: "assets/nav-icons/icon-video-play@2x.png", title: "Video Lessons",
          body: "Video-based learning content is coming soon. Every section will get companion video walkthroughs here." }
      : { icon: "assets/nav-icons/icon-knowledge-test-lightning@2x.png", title: "Knowledge Test",
          body: "Pattern-recognition quizzes and knowledge checks are coming soon. You'll be able to test yourself on every section you complete." };
    openOverlay(panelHead(meta.title) + `
      <div class="liked-empty">
        <img src="${meta.icon}" alt="" style="width:88px;display:block;margin:0 auto 14px;filter:drop-shadow(0 0 12px rgba(61,223,255,.4))">
        ${meta.body}
      </div>
      <button class="btn-primary" data-close>Got it</button>`);
  }
  $("navVideo").addEventListener("click", () => openComingSoon("video"));
  $("navQuiz").addEventListener("click", () => openComingSoon("quiz"));
  $("navHome").addEventListener("click", () => {
    state.homeTab = "sections";   // Home always lands on the outline + Continue
    goHome();
    const el = $("navHome");
    el.classList.add("glow-cyan");
    setTimeout(() => el.classList.remove("glow-cyan"), 600);
  });

  /* ---------------- delegated clicks (rendered content + overlays) ------ */

  document.addEventListener("click", (e) => {
    const t = e.target.closest("[data-tab],[data-mod],[data-sec],[data-sub],[data-screen],[data-close],[data-menu-sec],[data-set-sound],[data-set-size],[data-save-note],[data-notes-list],[data-logout],[data-check],[data-check-reset],[data-reset-progress]");
    if (!t) return;

    if (t.dataset.tab) { state.homeTab = t.dataset.tab; render(); }
    else if (t.dataset.mod !== undefined) { state.homeModule = +t.dataset.mod; state.expanded = null; render(); }
    else if (t.dataset.sec) { state.expanded = state.expanded === t.dataset.sec ? null : t.dataset.sec; render(); }
    else if (t.dataset.sub) {
      // jump to screen 1 of the subsection (or resume first unvisited)
      for (const mod of DATA.modules) for (const sec of mod.sections) for (const sub of sec.subsections) {
        if (sub.id === t.dataset.sub) { gotoScreenId(sub.screens[0].id); return; }
      }
    }
    else if (t.dataset.screen) gotoScreenId(t.dataset.screen);
    else if (t.dataset.menuSec) {
      // open section from menu drawer: first screen of its first subsection
      for (const mod of DATA.modules) for (const sec of mod.sections) {
        if (sec.id === t.dataset.menuSec && sec.subsections.length) {
          gotoScreenId(sec.subsections[0].screens[0].id);
          return;
        }
      }
    }
    else if (t.dataset.setSound !== undefined) { store.settings.sound = t.dataset.setSound === "1"; save(); syncVolume(); openSettings(); }
    else if (t.dataset.setSize) { store.settings.textSize = t.dataset.setSize; save(); applyTextSize(); openSettings(); }
    else if (t.hasAttribute("data-save-note")) {
      const txt = $("noteText");
      const id = t.getAttribute("data-save-note");
      if (txt && id && screenIndex[id] !== undefined) {
        store.notes[id] = txt.value;
        save();
      }
      closeOverlay();
    }
    else if (t.hasAttribute("data-notes-list")) openNotesList();
    else if (t.dataset.check !== undefined) {
      const i = +t.dataset.check;
      if (store.checklist[i]) delete store.checklist[i];
      else store.checklist[i] = true;
      save();
      openChecklist();
    }
    else if (t.hasAttribute("data-check-reset")) {
      store.checklist = {};
      save();
      openChecklist();
    }
    else if (t.hasAttribute("data-logout")) {
      stopAudio();
      store.authSeen = false;
      save();
      closeOverlay();
      setAuthMode("login");
      showAuthStep();
      $("authScreen").classList.remove("hidden");
    }
    else if (t.hasAttribute("data-reset-progress")) {
      if (confirm("Reset all course progress? Likes, saves and notes are kept.")) {
        store.visited = {};
        store.lastScreen = null;
        save();
        closeOverlay();
        render();
      }
    }
    else if (t.hasAttribute("data-close")) {
      const name = $("setName");
      if (name) { store.settings.name = name.value.trim(); save(); }
      closeOverlay();
    }
  });

  /* ---------------- auth screen (UI only — Firebase wiring is a follow-up) */

  const authScreen = $("authScreen");
  const authForm = $("authForm");
  let authMode = "login";

  const AUTH_FIELDS = {
    login: [
      { name: "email", type: "email", placeholder: "Email" },
      { name: "password", type: "password", placeholder: "Password" },
    ],
    signup: [
      { name: "name", type: "text", placeholder: "Name" },
      { name: "email", type: "email", placeholder: "Email" },
      { name: "phone", type: "tel", placeholder: "Phone Number" },
      { name: "password", type: "password", placeholder: "Password" },
    ],
  };

  function renderAuthForm() {
    const label = authMode === "login" ? "Log In" : "Sign Up";
    authForm.innerHTML =
      AUTH_FIELDS[authMode].map((f) =>
        `<input class="g-pill auth-input" name="${f.name}" type="${f.type}" placeholder="${f.placeholder}" autocomplete="off">`
      ).join("") +
      `<button type="submit" class="g-pill auth-submit">${label}</button>`;
  }

  function setAuthMode(mode) {
    authMode = mode;
    $("authTabLogin").classList.toggle("active", mode === "login");
    $("authTabSignup").classList.toggle("active", mode === "signup");
    $("authTabLogin").setAttribute("aria-selected", mode === "login");
    $("authTabSignup").setAttribute("aria-selected", mode === "signup");
    renderAuthForm();
  }

  $("authTabLogin").addEventListener("click", () => setAuthMode("login"));
  $("authTabSignup").addEventListener("click", () => setAuthMode("signup"));

  authForm.addEventListener("submit", (e) => {
    e.preventDefault();
    // Placeholder until Firebase auth is connected.
    console.log(`[auth] ${authMode} submitted — authentication coming soon (no backend yet)`);
    const btn = authForm.querySelector(".auth-submit");
    if (btn) { btn.textContent = "Coming Soon"; btn.classList.add("pending"); }
    setTimeout(() => {
      store.authSeen = true;
      save();
      authScreen.classList.add("hidden");
    }, 1100);
  });

  /* Step 1 access gate: name/email/phone are captured on every attempt;
     the passcode is the gatekeeper. Attempts are logged locally and, when
     LEARNAEWAY_CONFIG.attemptsWebhookUrl is set, POSTed to that webhook
     (e.g. Zapier -> Google Sheet). */
  const CFG = window.LEARNAEWAY_CONFIG || {};
  function showAuthStep() {
    $("gateStep").classList.toggle("hidden", !!store.gatePassed);
    $("loginStep").classList.toggle("hidden", !store.gatePassed);
  }
  function logGateAttempt(attempt) {
    if (!store.gateAttempts) store.gateAttempts = [];
    store.gateAttempts.push(attempt);
    if (store.gateAttempts.length > 100) store.gateAttempts = store.gateAttempts.slice(-100);
    save();
    if (CFG.attemptsWebhookUrl) {
      try {
        fetch(CFG.attemptsWebhookUrl, {
          method: "POST",
          mode: "no-cors",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(attempt),
        }).catch(() => {});
      } catch (e) { /* webhook unreachable — attempt is still in localStorage */ }
    }
  }
  $("gateForm").addEventListener("submit", (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    const ok = (f.get("passcode") || "").trim() === String(CFG.accessPasscode || "");
    logGateAttempt({
      firstName: (f.get("firstName") || "").trim(),
      lastName: (f.get("lastName") || "").trim(),
      email: (f.get("email") || "").trim(),
      phone: (f.get("phone") || "").trim(),
      timestamp: new Date().toISOString(),
      passcodeCorrect: ok,
    });
    if (ok) {
      store.gatePassed = true;
      save();
      $("gateError").classList.add("hidden");
      showAuthStep();
    } else {
      $("gateError").classList.remove("hidden");
    }
  });

  if (!store.authSeen) {
    renderAuthForm();
    showAuthStep();
    authScreen.classList.remove("hidden");
  }

  /* ---------------- boot ---------------- */

  // iOS (especially standalone/home-screen mode) can under-report dvh, leaving
  // a dead band under the bottom nav — size the app off measured innerHeight.
  function syncViewportHeight() {
    document.documentElement.style.setProperty("--vhpx", window.innerHeight + "px");
  }
  syncViewportHeight();
  window.addEventListener("resize", syncViewportHeight);
  window.addEventListener("orientationchange", syncViewportHeight);
  if (window.visualViewport) window.visualViewport.addEventListener("resize", syncViewportHeight);

  applyTextSize();
  syncVolume();
  render();

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => { /* offline support unavailable */ });
    });
  }
})();
