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
  // backfill keys that may be missing on stores written by older versions
  if (!store.checklist) store.checklist = {};   // daily trading checklist ticks
  if (!store.visited) store.visited = {};
  if (!store.liked) store.liked = {};
  if (!store.notes) store.notes = {};
  if (!store.settings) store.settings = { sound: true, textSize: "M", name: "" };
  if (!store.videosWatched) store.videosWatched = {};   // videoId -> true
  if (!store.checkinLog) store.checkinLog = {};         // YYYY-MM-DD -> submitted answers
  if (!store.journalImport) store.journalImport = {};   // account -> YYYY-MM-DD -> day totals
  if (!store.journalManual) store.journalManual = {};   // account -> YYYY-MM-DD -> [manual trades]
  // "Daily Bias" was renamed to "Market Awareness" — carry answers already
  // recorded under the old id, including inside submitted day logs
  let renamed = false;
  if (store.checklist && store.checklist["daily-bias"]) {
    store.checklist["market-awareness"] = store.checklist["daily-bias"];
    delete store.checklist["daily-bias"];
    renamed = true;
  }
  Object.keys(store.checkinLog || {}).forEach((day) => {
    const a = store.checkinLog[day] && store.checkinLog[day].answers;
    if (a && a["daily-bias"]) { a["market-awareness"] = a["daily-bias"]; delete a["daily-bias"]; renamed = true; }
  });
  // written straight out rather than through save(): the cloud-sync timer it
  // touches is declared further down and would still be in its dead zone here
  if (renamed) { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) { /* quota */ } }
  function todayKey() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
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
    pushCloudSoon();   // mirrors progress/notes to Firestore when signed in
  }

  /* ---------------- Firestore sync (per authenticated user) ---------------- */

  let cloudTimer = null;
  function cloudPayload() {
    return {
      profile: store.profile || { name: store.settings.name || "", email: (window.FB && FB.user() ? FB.user().email : "") || "", phone: "" },
      lastScreen: store.lastScreen || "",
      visited: store.visited || {},
      liked: store.liked || {},
      notes: store.notes || {},
      checklist: store.checklist || {},
      videosWatched: store.videosWatched || {},
      checkinLog: store.checkinLog || {},
      journalImport: store.journalImport || {},
      journalManual: store.journalManual || {},
      settings: store.settings || {},
      updatedAt: new Date().toISOString(),
    };
  }
  function pushCloudSoon() {
    if (!window.FB || !FB.user()) return;
    clearTimeout(cloudTimer);
    cloudTimer = setTimeout(() => { FB.saveUserDoc(cloudPayload()); }, 2500);
  }
  async function pullCloudAndMerge() {
    if (!window.FB || !FB.user()) return false;
    const cloud = await FB.loadUserDoc();
    if (!cloud) return false;
    // union maps (local device stays authoritative for its own recent edits)
    for (const k of ["visited", "liked", "checklist", "notes", "videosWatched", "checkinLog", "journalImport", "journalManual"]) {
      store[k] = Object.assign({}, cloud[k] || {}, store[k] || {});
    }
    if (!store.lastScreen && cloud.lastScreen) store.lastScreen = cloud.lastScreen;
    if (cloud.profile && !store.profile) store.profile = cloud.profile;
    if (cloud.settings && cloud.settings.name && !store.settings.name) store.settings.name = cloud.settings.name;
    save();
    return true;
  }

  /* ---------------- state ---------------- */

  const state = {
    view: "home",            // 'home' | 'screen' | 'videos' | 'checkin' | 'journal'
    homeTab: "sections",     // 'sections' | 'liked' | 'saved'
    homeModule: 0,           // module index shown on home
    expanded: null,          // section id expanded into subsection deck
    current: 0,              // index into screens[] for learning view
    slideDir: 0,             // -1 back, +1 forward (animation)
    videoCat: null,          // video category expanded in the library
    videoId: null,           // video in the full-screen player (null = closed)
    videoScroll: 0,          // library scroll position, restored on back
    gridItem: null,          // open item on a word-grid screen (null = list)
    journalTab: "personal",  // 'personal' | 'prop'
    journalMonth: 0,         // months offset from the sample month
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

  /* Trade Day Check-In — the pre-session discipline pass. Replaces the old
     10-item checklist overlay. Keyed by id (not index) so it can't collide
     with ticks written by that earlier version. */
  const CHECKIN_ITEMS = [
    { id: "physically",    label: "Physically" },
    { id: "mentally",      label: "Mentally" },
    { id: "emotionally",   label: "Emotionally" },
    { id: "distraction",   label: "Distraction" },
    { id: "economic-news", label: "Economic News" },
    { id: "market-awareness", label: "Market Awareness" },
    { id: "ready-to-trade", label: "Are you ready to trade?" },
  ];

  /* Placeholders until the icon artwork lands — see the layout prompt. */
  const CHECKIN_ACTIONS = ["Start Day", "Before Trade", "After Trade", "Discipline Streak"];

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

  /* Word-grid screens (Individual Financial Markets / Participants): a list
     of pill buttons that open a centred detail view with its own narration.
     Reuses .btn-primary so the pill art matches the rest of the app. */

  function gridItemById(scr, id) {
    return (scr.grid || []).find((g) => g.id === id) || null;
  }

  function gridHTML(scr) {
    const open = state.gridItem ? gridItemById(scr, state.gridItem) : null;
    if (open) {
      return `
        <button class="grid-back" data-grid-back>‹ Back to the list</button>
        <h2 class="grid-title">${esc(open.name)}</h2>
        <div class="grid-body">${bodyHTML(open.body)}</div>
        ${open.audioSrc
          ? `<button class="grid-play" data-grid-play aria-label="Play narration for ${esc(open.name)}">
               <img class="grid-play-img" src="assets/buttons-icon/btn-play@2x.png" alt="">
             </button>`
          : `<div class="grid-soon">Narration for this one is coming soon.</div>`}`;
    }
    return `
      <div class="grid-list">
        ${scr.grid.map((g) =>
          `<button class="btn-primary grid-pill" data-grid="${esc(g.id)}">${esc(g.name)}</button>`).join("")}
      </div>`;
  }

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
        ${scr.grid ? gridHTML(scr) : `
        ${diagramFor(entry)}
        <div class="screen-body">${bodyHTML(scr.body)}</div>
        ${scr.list ? `<ol class="screen-list">${scr.list.map((it) => `<li>${esc(it)}</li>`).join("")}</ol>` : ""}
        ${scr.listClose ? `<div class="screen-body">${bodyHTML([].concat(scr.listClose))}</div>` : ""}`}
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

  /* ---------------- rendering: video library ----------------
     Metadata lives in the Firestore `videos` collection (title, youtubeId,
     category, order), with data/videos.json as the offline fallback and seed
     source. Categories render as collapsible sections, matching the section
     deck on Home; Welcome is always pinned first. */

  const CATEGORY_FIRST = "Welcome";
  const thumbUrl = (yid) => `https://i.ytimg.com/vi/${yid}/mqdefault.jpg`;

  let videoCatalog = null;      // sorted [{id,title,youtubeId,category,order}]
  let videoLoading = false;

  async function loadVideos() {
    if (videoCatalog || videoLoading) return videoCatalog;
    videoLoading = true;
    let list = window.FB ? await FB.listVideos() : null;
    if (!list || !list.length) {
      try {
        const res = await fetch("data/videos.json", { cache: "no-cache" });
        list = ((await res.json()) || {}).videos || [];
      } catch (e) {
        list = [];
      }
    }
    videoCatalog = list
      .filter((v) => v && v.youtubeId && v.title)
      .sort((a, b) => (a.order || 0) - (b.order || 0));
    videoLoading = false;
    return videoCatalog;
  }

  /* group into categories, ordered by their lowest `order` value */
  function videoCategories() {
    const groups = new Map();
    (videoCatalog || []).forEach((v) => {
      const name = v.category || "Other";
      if (!groups.has(name)) groups.set(name, { name, items: [], min: Infinity });
      const g = groups.get(name);
      g.items.push(v);
      g.min = Math.min(g.min, v.order === undefined ? Infinity : v.order);
    });
    return Array.from(groups.values()).sort((a, b) => {
      if (a.name === CATEGORY_FIRST) return -1;
      if (b.name === CATEGORY_FIRST) return 1;
      return a.min - b.min;
    });
  }

  function videoById(id) {
    return (videoCatalog || []).find((v) => v.id === id) || null;
  }

  function videoCardHTML(v) {
    const watched = !!store.videosWatched[v.id];
    return `
      <button class="video-row${watched ? " watched" : ""}" data-vid="${esc(v.id)}">
        <span class="v-thumb">
          <img src="${thumbUrl(v.youtubeId)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
          <span class="v-play"></span>
        </span>
        <span class="v-meta">
          <span class="v-title">${esc(v.title)}</span>
          <span class="v-tag">${esc(v.category || "Other")}${watched ? " · Watched" : ""}</span>
        </span>
      </button>`;
  }

  function renderVideos() {
    barTitle.textContent = "Æway Video Library";

    if (!videoCatalog) {
      progressLabel.textContent = "…";
      progressFill.style.width = "0%";
      cardScroll.innerHTML = `
        <div class="home-head">
          <img class="home-logo" src="assets/logo/logo-symbol-v2@3x.png" alt="">
          <div class="home-module-title">Videos</div>
        </div>
        <div class="liked-empty">Loading videos…</div>`;
      cardFooter.style.display = "none";
      return;
    }

    const cats = videoCategories();
    const total = videoCatalog.length;
    const seen = videoCatalog.filter((v) => store.videosWatched[v.id]).length;
    progressLabel.textContent = `${seen} of ${total} watched`;
    progressFill.style.width = `${total ? Math.round((100 * seen) / total) : 0}%`;

    const body = total
      ? cats.map((g) => {
          const expanded = state.videoCat === g.name;
          const gSeen = g.items.filter((v) => store.videosWatched[v.id]).length;
          return `
            <div class="deck">
              <div class="deck-peek p3"></div><div class="deck-peek p2"></div><div class="deck-peek p1"></div>
              <button class="section-row" data-vcat="${esc(g.name)}">
                <span class="sec-title">${esc(g.name)}</span>
                <span class="pct-badge ${gSeen === g.items.length ? "done" : ""}" style="--pct:${Math.round((100 * gSeen) / g.items.length)}">${g.items.length}</span>
              </button>
            </div>
            ${expanded ? `<div class="subsection-panel video-panel">
              ${g.items.map(videoCardHTML).join("")}
            </div>` : ""}`;
        }).join("")
      : `<div class="liked-empty">No videos yet.<br>Add documents to the Firestore <b>videos</b> collection to populate this library.</div>`;

    cardScroll.innerHTML = `
      <div class="home-head">
        <img class="home-logo" src="assets/logo/logo-symbol-v2@3x.png" alt="">
        <div class="home-module-title">Videos · ${cats.length} categories</div>
        <div class="home-module-tagline">Watch, learn, and come back to the lessons any time.</div>
      </div>
      ${body}`;
    cardScroll.scrollTop = state.videoScroll || 0;
    cardFooter.style.display = "none";
  }

  /* Full-screen vertical player. The library stays mounted in the card
     underneath, so closing the player is instant and lands back on the same
     category, at the same scroll position. The iframe only exists while the
     layer is open — tearing it out is what stops playback. */

  const playerEl = $("videoPlayer");

  function shelfCardHTML(v) {
    return `
      <button class="vp-card${store.videosWatched[v.id] ? " watched" : ""}" data-vid="${esc(v.id)}">
        <span class="v-thumb">
          <img src="${thumbUrl(v.youtubeId)}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">
          <span class="v-play"></span>
        </span>
        <span class="v-title">${esc(v.title)}</span>
      </button>`;
  }

  function renderPlayerLayer() {
    const v = videoById(state.videoId);
    if (!v) { closePlayer(); return; }
    const more = (videoCatalog || []).filter((x) => x.category === v.category && x.id !== v.id);

    playerEl.innerHTML = `
      <div class="vp-bar">
        <button class="vp-close" data-vback aria-label="Back to the video library"><span>‹</span></button>
        <span class="vp-heading">
          <span class="vp-cat">${esc(v.category || "Video")}</span>
          <span class="vp-name">${esc(v.title)}</span>
        </span>
        ${CAN_FULLSCREEN
          ? `<button class="vp-expand" data-vfull aria-label="Expand to fullscreen"><span></span></button>`
          : ""}
      </div>
      <div class="vp-stage">
        <div class="vp-video">
          <iframe
            class="vp-frame"
            src="https://www.youtube.com/embed/${encodeURIComponent(v.youtubeId)}?playsinline=1&fs=1"
            title="${esc(v.title)}"
            frameborder="0"
            allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen"
            allowfullscreen></iframe>
          <div class="vp-swipe"></div>
          ${CAN_FULLSCREEN
            ? `<button class="vp-fsexit" data-vfull aria-label="Exit fullscreen"><span>✕</span></button>`
            : ""}
        </div>
      </div>
      ${more.length ? `
        <div class="vp-more">
          <div class="vp-more-title">More in ${esc(v.category)}</div>
          <div class="vp-shelf">${more.map(shelfCardHTML).join("")}</div>
        </div>` : ""}`;
    playerEl.classList.remove("hidden");
  }

  function tearDownPlayer() {
    if (document.fullscreenElement) { try { document.exitFullscreen(); } catch (e) { /* already out */ } }
    clearTimeout(vpYieldTimer);
    playerEl.classList.add("hidden");
    playerEl.innerHTML = "";   // removing the iframe stops playback
    state.videoId = null;
  }

  /* Swipe right anywhere on the player to exit, same path as the back button.
     Touch events raised inside the YouTube iframe never reach us — it's
     cross-origin — so .vp-swipe is a transparent capture layer over the
     video. It deliberately stops short of the bottom control strip, leaving
     YouTube's scrub bar, timeline and buttons directly touchable, so a swipe
     can't turn into a seek. Taps that land on the capture layer are forwarded
     to the player as play/pause over the iframe postMessage API. */

  const SWIPE_MIN = 60;      // horizontal travel needed to count as a swipe
  const SWIPE_RATIO = 1.4;   // ...and how much more horizontal than vertical
  const TAP_SLOP = 12;       // movement below this is a tap, not a drag
  const YIELD_MS = 6000;     // how long the capture layer stands down after a tap
  let vpTouch = null;
  let vpYieldTimer = null;

  /* The Fullscreen API only exists on some platforms — notably NOT iPhone
     Safari, which refuses it on anything but a <video>. Where it's missing we
     hide our own expand button and rely on YouTube's, inside the iframe. */
  const CAN_FULLSCREEN = !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);

  function vpToggleFullscreen() {
    const box = playerEl.querySelector(".vp-video");
    if (!box) return;
    if (document.fullscreenElement || document.webkitFullscreenElement) {
      (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      return;
    }
    const req = box.requestFullscreen || box.webkitRequestFullscreen;
    if (req) { try { Promise.resolve(req.call(box)).catch(() => {}); } catch (e) { /* refused */ } }
  }

  /* Hand the video's touches back to YouTube for a few seconds. The capture
     layer has to sit over the iframe for swipe-anywhere to work at all, but
     that same coverage hides YouTube's own controls — including its
     fullscreen button, which on iPhone is the only way into fullscreen. So a
     tap stands the layer down; it re-arms once the user stops interacting. */
  function vpYield() {
    const layer = playerEl.querySelector(".vp-swipe");
    if (!layer) return;
    layer.classList.add("yielded");
    clearTimeout(vpYieldTimer);
    vpYieldTimer = setTimeout(() => {
      const l = playerEl.querySelector(".vp-swipe");
      if (l) l.classList.remove("yielded");
    }, YIELD_MS);
  }

  playerEl.addEventListener("touchstart", (e) => {
    // the shelf scrolls horizontally; its own gestures are not exit gestures
    if (e.target.closest(".vp-shelf")) { vpTouch = null; return; }
    const t = e.touches[0];
    vpTouch = { x: t.clientX, y: t.clientY, overlay: !!e.target.closest(".vp-swipe") };
  }, { passive: true });

  playerEl.addEventListener("touchend", (e) => {
    const s = vpTouch;
    vpTouch = null;
    if (!s) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - s.x;
    const dy = t.clientY - s.y;
    if (dx > SWIPE_MIN && Math.abs(dx) > Math.abs(dy) * SWIPE_RATIO) { closePlayer(); return; }
    // a tap means the user wants the player itself — stand down so the next
    // touch reaches YouTube's controls (play/pause, scrub, fullscreen)
    if (s.overlay && Math.abs(dx) < TAP_SLOP && Math.abs(dy) < TAP_SLOP) vpYield();
  }, { passive: true });

  function closePlayer() {
    tearDownPlayer();
    renderVideos();                              // pick up newly-watched marks
    cardScroll.scrollTop = state.videoScroll || 0;
  }

  function openVideos() {
    stopAudio();
    state.view = "videos";
    state.slideDir = 0;
    closeOverlay();
    render();
    if (!videoCatalog) {
      loadVideos().then(() => { if (state.view === "videos") render(); });
    }
  }

  function playVideo(id) {
    if (!state.videoId) state.videoScroll = cardScroll.scrollTop;   // opening, not switching
    state.videoId = id;
    if (!store.videosWatched[id]) { store.videosWatched[id] = true; save(); }
    renderPlayerLayer();
  }

  /* ---------------- Trade Day Check-In ---------------- */

  const checkinBar = $("checkinBar");
  let clockTimer = null;

  function paintClock() {
    const now = new Date();
    const date = now.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
    const time = now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" });
    $("checkinClock").innerHTML = `<span class="ci-date">${date}</span><span class="ci-time">${time}</span>`;
  }

  function renderCheckin() {
    barTitle.textContent = "Trade Day Checkin";
    paintClock();
    cardScroll.innerHTML = `
      <h1 class="ci-heading">Check List Before Trading Day</h1>
      <div class="ci-list">
        ${CHECKIN_ITEMS.map((it) => `
          <div class="ci-row ${store.checklist[it.id] === "yes" ? "yes" : store.checklist[it.id] === "no" ? "no" : ""}">
            <button class="ci-half ci-yes" data-ci="${it.id}" data-ci-val="yes"
                    aria-label="${esc(it.label)} — yes" aria-pressed="${store.checklist[it.id] === "yes"}"></button>
            <span class="ci-label">${esc(it.label)}</span>
            <button class="ci-half ci-no" data-ci="${it.id}" data-ci-val="no"
                    aria-label="${esc(it.label)} — no" aria-pressed="${store.checklist[it.id] === "no"}"></button>
          </div>`).join("")}
      </div>
      ${(() => {
        const ready = CHECKIN_ITEMS.every((it) => store.checklist[it.id]);
        const sent = store.checkinLog[todayKey()];
        return `<button class="ci-submit${ready ? "" : " off"}"
          ${ready ? "" : "disabled"} data-ci-submit>${sent ? "Submitted" : "Submit"}</button>`;
      })()}
      <div class="ci-actions">
        ${CHECKIN_ACTIONS.map((label) => `
          <div class="ci-action">
            <span class="ci-orb" aria-hidden="true"></span>
            <span class="ci-action-label">${esc(label)}</span>
          </div>`).join("")}
      </div>`;
    cardScroll.scrollTop = 0;
    cardFooter.style.display = "none";
  }

  function openCheckin() {
    stopAudio();
    state.view = "checkin";
    state.slideDir = 0;
    closeOverlay();
    render();
  }

  /* ---------------- Trade Journal ----------------
     PHASE 1: LAYOUT ONLY. The numbers below are deterministic samples so the
     calendar looks plausible and stable while navigating months. Manual trade
     entry, live broker/balance sync and per-account storage are a later phase;
     the "+" and the four stat circles are placeholders. */

  /* ---------------- broker export import ----------------
     Each broker gets its own parse function that normalises rows into
     { day: "YYYY-MM-DD", pnl: Number, symbol }. Everything downstream — day
     aggregation, the calendar, the month stats — is broker-agnostic, so adding
     Robinhood or another format later means writing one more
     parse<Broker>Export() and registering it below. */

  function parseCsv(text) {
    const rows = [];
    let row = [], cell = "", quoted = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (quoted) {
        if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false; }
        else cell += c;
      } else if (c === '"') quoted = true;
      else if (c === ",") { row.push(cell); cell = ""; }
      else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
      else if (c !== "\r") cell += c;
    }
    if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
    return rows.filter((r) => r.some((c) => c.trim() !== ""));
  }

  /* Tradovate writes losses in parentheses with no minus: "$(360.00)" */
  function parseParenMoney(v) {
    const str = String(v == null ? "" : v).trim();
    const n = parseFloat(str.replace(/[^0-9.]/g, "")) || 0;
    return str.indexOf("(") >= 0 ? -n : n;
  }

  /* MM/DD/YYYY HH:MM:SS -> YYYY-MM-DD */
  function mdyToDayKey(ts) {
    const m = String(ts == null ? "" : ts).trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    return m ? `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}` : null;
  }

  function parseTradovateExport(rows) {
    const head = rows[0].map((h) => h.trim());
    const iPnl = head.indexOf("pnl");
    const iSold = head.indexOf("soldTimestamp");
    const iSym = head.indexOf("symbol");
    if (iPnl < 0 || iSold < 0) throw new Error("That doesn't look like a Tradovate export — no pnl / soldTimestamp columns.");
    const trades = [];
    for (let r = 1; r < rows.length; r++) {
      // a trade belongs to the day it was CLOSED — some open one day, close the next
      const day = mdyToDayKey(rows[r][iSold]);
      if (!day) continue;
      trades.push({ day, pnl: parseParenMoney(rows[r][iPnl]), symbol: (rows[r][iSym] || "").trim() });
    }
    return trades;
  }

  const BROKER_PARSERS = [
    { id: "tradovate", label: "Tradovate", parse: parseTradovateExport,
      detect: (head) => head.indexOf("soldTimestamp") >= 0 && head.indexOf("buyFillId") >= 0 },
  ];

  /* broker-agnostic: normalised trades -> per-day totals */
  function aggregateTrades(trades) {
    const days = {};
    trades.forEach((t) => {
      const d = days[t.day] || (days[t.day] = { pnl: 0, trades: 0, wins: 0, losses: 0, flat: 0 });
      d.pnl += t.pnl;
      d.trades++;
      if (t.pnl > 0) d.wins++; else if (t.pnl < 0) d.losses++; else d.flat++;
    });
    Object.keys(days).forEach((k) => { days[k].pnl = Math.round(days[k].pnl * 100) / 100; });
    return days;
  }

  function importCsvText(text) {
    const rows = parseCsv(text);
    if (rows.length < 2) throw new Error("That file has no rows to import.");
    const head = rows[0].map((h) => h.trim());
    const broker = BROKER_PARSERS.find((b) => b.detect(head)) || BROKER_PARSERS[0];
    const trades = broker.parse(rows);
    if (!trades.length) throw new Error("No trades found in that file.");
    const days = aggregateTrades(trades);
    // import wins over sample/manual figures for the days it covers — it's the
    // real broker record. Change here if manual entry should take precedence.
    const acct = store.journalImport[state.journalTab] || (store.journalImport[state.journalTab] = {});
    Object.keys(days).forEach((k) => { acct[k] = days[k]; });
    save();
    return { broker: broker.label, trades: trades.length, days: Object.keys(days).sort() };
  }

  const JOURNAL_ACCOUNTS = {
    personal: { title: "Personal Account Trade Journal", broker: "Interactive Brokers",
                balance: 24750.68, change: 623.45, pct: 2.58 },
    prop:     { title: "Prop Firms Trade Journal", broker: "Apex Trader Funding",
                balance: 51200.00, change: -318.20, pct: -0.62 },
  };
  const JOURNAL_STATS = ["Month Cal", "Total P&L", "Net P&L", "Recent Trade"];
  const SAMPLE_MONTH = { y: 2025, m: 4 };   // May 2025, as in the reference

  function journalDate() {
    return new Date(SAMPLE_MONTH.y, SAMPLE_MONTH.m + state.journalMonth, 1);
  }

  /* sample P&L: weekdays only, ~63% winners, stable for a given day + account */
  function samplePnl(tab, y, m, d) {
    const dow = new Date(y, m, d).getDay();
    if (dow === 0 || dow === 6) return null;              // no weekend trading
    let x = (y * 10000 + (m + 1) * 100 + d) * (tab === "prop" ? 7919 : 6151);
    x = Math.imul(x ^ (x >>> 13), 1274126177);
    x = (x ^ (x >>> 16)) >>> 0;
    if (x % 9 === 0) return null;                         // a few flat days
    const mag = 80 + (x % 620);
    return x % 100 < 63 ? mag : -Math.round(mag * 0.62);
  }

  function dayKey(y, m, d) {
    return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }

  /* True once a month holds any imported day. Sample figures are then dropped
     for the whole month: mixing invented P&L into a month that has a real
     broker record would make the month total and win rate wrong. Extends the
     "import is the source of truth" rule from the day to the month — remove
     this check if sample days should persist alongside imports. */
  function monthHasImport(y, m) {
    const prefix = `${y}-${String(m + 1).padStart(2, "0")}-`;
    const has = (map) => Object.keys(map || {}).some((k) => k.indexOf(prefix) === 0);
    return has(store.journalImport[state.journalTab]) || has(store.journalManual[state.journalTab]);
  }

  /* imported broker data for a day, else the Phase-1 sample. Sample days count
     as a single win or loss so the win rate uses one formula throughout. */
  function journalDay(y, m, d, imported) {
    const key = dayKey(y, m, d);
    const imp = (store.journalImport[state.journalTab] || {})[key];
    if (imp) return { pnl: imp.pnl, wins: imp.wins, losses: imp.losses, real: true };
    const man = (store.journalManual[state.journalTab] || {})[key];
    if (man && man.length) {
      const t = man.reduce((a, x) => {
        a.pnl += x.pnl;
        if (x.pnl > 0) a.wins++; else if (x.pnl < 0) a.losses++;
        return a;
      }, { pnl: 0, wins: 0, losses: 0 });
      return { pnl: Math.round(t.pnl * 100) / 100, wins: t.wins, losses: t.losses, real: true };
    }
    if (imported) return null;                 // real month — no invented days
    const p = samplePnl(state.journalTab, y, m, d);
    if (p === null) return null;
    return { pnl: p, wins: p > 0 ? 1 : 0, losses: p < 0 ? 1 : 0, real: false };
  }

  function money(n, cents) {
    const v = Math.abs(n).toLocaleString("en-US", cents
      ? { minimumFractionDigits: 2, maximumFractionDigits: 2 } : { maximumFractionDigits: 0 });
    return (n < 0 ? "-$" : "+$") + v;
  }

  function renderJournal() {
    const acct = JOURNAL_ACCOUNTS[state.journalTab];
    barTitle.textContent = acct.title;
    $("journalSummary").innerHTML = `
      <span class="j-broker">${esc(acct.broker)}</span>
      <span class="j-balance">$${acct.balance.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
      <span class="j-change">
        <span class="j-change-label">Daily Change</span>
        <span class="${acct.change < 0 ? "neg" : "pos"}">${money(acct.change, true)} (${acct.pct}%)</span>
      </span>`;

    const base = journalDate();
    const y = base.getFullYear(), m = base.getMonth();
    const monthName = base.toLocaleDateString("en-US", { month: "long", year: "numeric" });
    const daysIn = new Date(y, m + 1, 0).getDate();

    // grid starts on the Sunday on or before the 1st
    const first = new Date(y, m, 1);
    const start = new Date(y, m, 1 - first.getDay());
    const cells = [];
    const realMonth = monthHasImport(y, m);
    let total = 0, wins = 0, losses = 0, traded = 0;
    for (let i = 0; i < 42; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      const inMonth = d.getMonth() === m && d.getFullYear() === y;
      const info = inMonth ? journalDay(y, m, d.getDate(), realMonth) : null;
      const pnl = info ? info.pnl : null;
      if (info) { total += info.pnl; wins += info.wins; losses += info.losses; traded++; }
      cells.push({ d, inMonth, pnl, real: !!(info && info.real) });
      if (i >= 34 && d.getDate() >= daysIn && d.getMonth() === m) { /* keep filling to row end */ }
    }
    // trim trailing all-outside rows
    while (cells.length > 35 && cells.slice(-7).every((c) => !c.inMonth)) cells.length -= 7;

    const weekTotal = (row) => cells.slice(row * 7, row * 7 + 7)
      .reduce((a, c) => a + (c.inMonth && c.pnl !== null ? c.pnl : 0), 0);

    const rows = cells.length / 7;
    let grid = "";
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < 7; c++) {
        const cell = cells[r * 7 + c];
        const isSat = c === 6;
        if (!cell.inMonth) { grid += `<div class="j-day out">${cell.d.getDate()}</div>`; continue; }
        if (isSat) {
          const wt = weekTotal(r);
          grid += `<div class="j-day j-week ${wt < 0 ? "loss" : "profit"}">
            <span class="j-week-label">Total</span>
            <span class="j-date">${cell.d.getDate()}</span>
            <span class="j-pnl ${wt < 0 ? "neg" : "pos"}">${money(wt)}</span></div>`;
          continue;
        }
        const cls = (cell.pnl === null ? "flat" : cell.pnl < 0 ? "loss" : "profit") + (cell.real ? " real" : "");
        grid += `<div class="j-day ${cls}">
          <span class="j-date">${cell.d.getDate()}</span>
          ${cell.pnl === null ? "" : `<span class="j-pnl ${cell.pnl < 0 ? "neg" : "pos"}">${money(cell.pnl)}</span>`}
        </div>`;
      }
    }

    // break-even trades sit out of the denominator
    const decided = wins + losses;
    const winRate = decided ? Math.round((1000 * wins) / decided) / 10 : 0;
    cardScroll.innerHTML = `
      <div class="j-tabs">
        ${Object.keys(JOURNAL_ACCOUNTS).map((k) => `
          <button class="home-tab ${state.journalTab === k ? "active" : ""}" data-jtab="${k}">${
            k === "personal" ? "Personal Account" : "Prop Firms"}</button>`).join("")}
      </div>
      <div class="j-cal">
        <div class="j-cal-head">
          <div class="j-month">
            <span>${esc(monthName)}</span>
            <button class="j-nav" data-jmonth="-1" aria-label="Previous month">‹</button>
            <button class="j-nav" data-jmonth="1" aria-label="Next month">›</button>
          </div>
          <div class="j-cal-stats">
            <span><span class="j-stat-label">Total P&amp;L</span>
              <span class="j-stat-val ${total < 0 ? "neg" : "pos"}">${money(total)}</span></span>
            <span><span class="j-stat-label">Win Rate</span>
              <span class="j-stat-val cyan">${winRate}%</span></span>
          </div>
        </div>
        <div class="j-dow">${["SUN","MON","TUE","WED","THU","FRI","SAT"].map((d) => `<span>${d}</span>`).join("")}</div>
        <div class="j-grid">${grid}</div>
      </div>
      <button class="j-add" data-jadd aria-label="Add a trade"></button>
      <input id="jCsvFile" class="j-file" type="file" accept=".csv,text/csv">
      <div class="j-stat-row">
        ${JOURNAL_STATS.map((label) => `
          <div class="j-stat-btn">
            <span class="ci-orb" aria-hidden="true"></span>
            <span class="ci-action-label">${esc(label)}</span>
          </div>`).join("")}
      </div>`;
    cardScroll.scrollTop = 0;
    cardFooter.style.display = "none";
  }

  /* delegated on document so it survives every re-render of the journal */
  document.addEventListener("change", (e) => {
    if (!e.target || e.target.id !== "jCsvFile" || !e.target.files || !e.target.files[0]) return;
    const input = e.target;
    const reader = new FileReader();
    reader.onload = () => {
      let res;
      try {
        res = importCsvText(String(reader.result));
      } catch (err) {
        openOverlay(panelHead("Import Failed") + `
          <div class="liked-empty">${esc(err.message || "Could not read that file.")}</div>
          <button class="btn-primary" data-close>Close</button>`);
        input.value = "";
        return;
      }
      // jump to the month the trades landed in, so the change is visible
      const last = res.days[res.days.length - 1].split("-");
      state.journalMonth = (+last[0] - SAMPLE_MONTH.y) * 12 + (+last[1] - 1 - SAMPLE_MONTH.m);
      renderJournal();
      const span = res.days.length === 1
        ? new Date(+last[0], +last[1] - 1, +last[2]).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
        : `${res.days.length} days`;
      openOverlay(panelHead("Import Complete") + `
        <div class="liked-empty">${res.trades} ${res.broker} trade${res.trades === 1 ? "" : "s"}
          imported across ${span}.<br>Day totals on the calendar now use the broker record.</div>
        <button class="btn-primary" data-close>Done</button>`);
      input.value = "";
    };
    reader.onerror = () => { input.value = ""; };
    reader.readAsText(input.files[0]);
  });

  /* Manual trade entry. Feeds the same day-level aggregation as the CSV
     import, so a manually logged trade lands on the calendar exactly like an
     imported one. A CSV import still wins for any day it covers. */
  function openManualTrade() {
    const today = todayKey();
    openOverlay(panelHead("Manually Enter Trade") + `
      <form id="manualTradeForm" autocomplete="off" novalidate>
        <label class="mt-label">Platform<input class="mt-input" name="platform" type="text" placeholder="Tradovate, IBKR…"></label>
        <label class="mt-label">Asset<input class="mt-input" name="asset" type="text" placeholder="MNQU6, ES, AAPL…"></label>
        <div class="mt-row">
          <label class="mt-label">Entry price<input class="mt-input" name="entry" type="text" inputmode="decimal" placeholder="0.00"></label>
          <label class="mt-label">Exit price<input class="mt-input" name="exit" type="text" inputmode="decimal" placeholder="0.00"></label>
        </div>
        <label class="mt-label">Amount won or lost ($)
          <input class="mt-input" id="mtAmount" name="amount" type="text" inputmode="text" placeholder="-125.50 for a loss">
        </label>
        <div class="mt-label">Date<input class="mt-input mt-date" name="day" type="date" value="${today}"></div>
        <div class="mt-result" id="mtResult">Result follows the amount you enter</div>
        <div id="mtError" class="gate-error hidden"></div>
        <button type="button" class="btn-primary" data-jsave>Save Trade</button>
      </form>`);
    const amt = $("mtAmount");
    const paint = () => {
      const n = parseFloat(String(amt.value).replace(/[^0-9.\-]/g, ""));
      const el = $("mtResult");
      if (!amt.value.trim() || isNaN(n)) { el.className = "mt-result"; el.textContent = "Result follows the amount you enter"; return; }
      el.className = "mt-result " + (n > 0 ? "win" : n < 0 ? "loss" : "flat");
      el.textContent = n > 0 ? "WIN" : n < 0 ? "LOSS" : "BREAK EVEN";
    };
    amt.addEventListener("input", paint);
    paint();
  }

  function saveManualTrade() {
    const f = $("manualTradeForm");
    const err = $("mtError");
    const val = (n) => (new FormData(f).get(n) || "").toString().trim();
    const amount = parseFloat(val("amount").replace(/[^0-9.\-]/g, ""));
    const day = val("day");
    if (isNaN(amount)) { err.textContent = "Enter the amount won or lost."; err.classList.remove("hidden"); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) { err.textContent = "Pick a date for the trade."; err.classList.remove("hidden"); return; }
    const acct = store.journalManual[state.journalTab] || (store.journalManual[state.journalTab] = {});
    (acct[day] || (acct[day] = [])).push({
      platform: val("platform"), asset: val("asset"),
      entry: val("entry"), exit: val("exit"),
      pnl: Math.round(amount * 100) / 100, loggedAt: new Date().toISOString(),
    });
    save();
    const d = day.split("-");
    state.journalMonth = (+d[0] - SAMPLE_MONTH.y) * 12 + (+d[1] - 1 - SAMPLE_MONTH.m);
    renderJournal();
    openOverlay(panelHead("Trade Saved") + `
      <div class="liked-empty">${money(Math.round(amount * 100) / 100, true)}
        logged for ${new Date(+d[0], +d[1] - 1, +d[2]).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}.</div>
      <button class="btn-primary" data-close>Done</button>`);
  }

  function openJournal() {
    stopAudio();
    state.view = "journal";
    state.slideDir = 0;
    closeOverlay();
    render();
  }

  /* ring behind whichever dock icon matches the section you're in */
  function syncDockActive() {
    $("navCheckin").classList.toggle("active", state.view === "checkin");
    $("navAdd").classList.toggle("active", state.view === "journal");
    $("navPlay").classList.toggle("active", state.view === "videos");
  }

  /* the check-in view swaps in its own date/time bar and dock */
  function syncCheckinChrome() {
    const on = state.view === "checkin";
    const jr = state.view === "journal";
    checkinBar.classList.toggle("hidden", !on);
    $("journalBar").classList.toggle("hidden", !jr);
    document.querySelectorAll(".bar")[1].classList.toggle("hidden", on || jr);
    clearInterval(clockTimer);
    if (on) clockTimer = setInterval(paintClock, 1000);
  }

  function render() {
    // navigating anywhere other than the library closes the player
    if (state.videoId && state.view !== "videos") tearDownPlayer();
    const listy = state.view === "home" || state.view === "videos"
      || state.view === "checkin" || state.view === "journal";
    $("cardOuter").classList.toggle("outline-bg", listy);
    syncCheckinChrome();
    syncDockActive();
    if (state.view === "home") renderHome();
    else if (state.view === "videos") renderVideos();
    else if (state.view === "checkin") renderCheckin();
    else if (state.view === "journal") renderJournal();
    else renderScreen();
  }

  /* ---------------- navigation ---------------- */

  function gotoScreenId(id) {
    const idx = screenIndex[id];
    if (idx === undefined) return;
    state.view = "screen";
    state.current = idx;
    state.gridItem = null;
    state.slideDir = 0;
    closeOverlay();
    render();
  }

  function step(dir) {
    if (state.view !== "screen") return;
    const next = state.current + dir;
    if (next < 0 || next >= screens.length) return;
    state.current = next;
    state.gridItem = null;
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
      </div>`).join("");
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
      <button class="btn-secondary" data-reset-progress>Reset course progress</button>
      <button class="btn-secondary" data-logout>Log Out</button>`;
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
    const src = on ? "assets/buttons-icon/btn-pause@2x.png" : "assets/buttons-icon/btn-play@2x.png";
    $("playImg").src = src;
    const inline = document.querySelector(".grid-play-img");
    if (inline) inline.src = src;
  }
  function currentAudioSrc() {
    if (state.view !== "screen") return null;
    const scr = screens[state.current].scr;
    if (scr.grid && state.gridItem) {
      const it = gridItemById(scr, state.gridItem);
      return (it && it.audioSrc) || null;
    }
    return scr.audioSrc || null;
  }
  // header pulse tracks real narration only — not the no-audio visual toggle
  function setNarrating(on) {
    $("headerZone").classList.toggle("narrating", on && !!currentAudioSrc());
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
        setPlayIcon(true);
        setNarrating(true);                 // header keeps pulsing through the seam
      } else {
        playing = false;
        setPlayIcon(false);
        setNarrating(false);
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
    setNarrating(false);
  }
  function togglePlay() {
    const src = currentAudioSrc();
    if (src) {
      const a = ensureAudio(src);
      if (playing) { a.pause(); playing = false; }
      else { a.play().catch(() => {}); playing = true; }
    } else {
      playing = !playing;    // no narration on this screen yet — visual toggle only
    }
    setPlayIcon(playing);
    setNarrating(playing);
  }
  $("btnPlay").addEventListener("click", togglePlay);
  $("btnReplay").addEventListener("click", () => {
    const src = currentAudioSrc();
    if (!src) return;
    ensureAudio(src);
    loadTrack(0);
    audioEl.currentTime = 0;
    audioEl.play().catch(() => {});
    playing = true;
    setPlayIcon(true);
    setNarrating(true);
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
  $("btnNotes").innerHTML = SVG.notes;
  $("btnHeart").innerHTML = SVG.heart;
  $("btnNotes").addEventListener("click", openNotes);

  $("navPlay").addEventListener("click", () => {
    openVideos();
    const el = $("navPlay");
    el.classList.add("glow-cyan");
    setTimeout(() => el.classList.remove("glow-cyan"), 600);
  });
  $("navCheckin").addEventListener("click", openCheckin);
  $("btnBarHome").addEventListener("click", () => { state.homeTab = "sections"; goHome(); });
  $("btnCheckinHome").addEventListener("click", () => { state.homeTab = "sections"; goHome(); });
  $("btnCheckinProfile").addEventListener("click", openProfile);
  $("navAdd").addEventListener("click", openJournal);
  $("btnJournalHome").addEventListener("click", () => { state.homeTab = "sections"; goHome(); });
  $("btnJournalProfile").addEventListener("click", openProfile);

  /* ---------------- delegated clicks (rendered content + overlays) ------ */

  document.addEventListener("click", (e) => {
    const t = e.target.closest("[data-tab],[data-mod],[data-sec],[data-sub],[data-screen],[data-close],[data-menu-sec],[data-set-sound],[data-set-size],[data-save-note],[data-notes-list],[data-logout],[data-reset-progress],[data-vcat],[data-vid],[data-vback],[data-vfull],[data-grid],[data-grid-back],[data-grid-play],[data-ci],[data-ci-submit],[data-ci-before],[data-ci-exit],[data-jtab],[data-jmonth],[data-jadd],[data-jimport],[data-jmanual],[data-jsave]");
    if (!t) return;

    if (t.dataset.jtab) { state.journalTab = t.dataset.jtab; renderJournal(); }
    else if (t.dataset.jmonth) { state.journalMonth += +t.dataset.jmonth; renderJournal(); }
    else if (t.hasAttribute("data-jimport")) { closeOverlay(); $("jCsvFile").click(); }
    else if (t.hasAttribute("data-jmanual")) openManualTrade();
    else if (t.hasAttribute("data-jsave")) saveManualTrade();
    else if (t.hasAttribute("data-jadd")) {
      openOverlay(panelHead("Add a Trade") + `
        <div class="notes-hint" style="margin:0 0 14px">How would you like to add trades?</div>
        <button class="btn-primary" data-jimport>Import Broker CSV</button>
        <button class="btn-secondary" data-jmanual>Manually Enter Trade</button>`);
    }
    else if (t.dataset.ci) {
      const id = t.dataset.ci, val = t.dataset.ciVal;
      // tapping the chosen side clears it; the other side switches the answer
      if (store.checklist[id] === val) delete store.checklist[id];
      else store.checklist[id] = val;
      save();
      renderCheckin();
    }
    else if (t.hasAttribute("data-ci-before")) {
      closeOverlay();
      // Before Trade has no screen yet — this is the hand-off point for it
      openOverlay(panelHead("Before Trade") + `
        <div class="liked-empty">The pre-market checklist is coming soon. It runs
          before the open and applies whichever session you trade — Asian, London
          or New York.</div>
        <button class="btn-primary" data-close>Got it</button>`);
    }
    else if (t.hasAttribute("data-ci-exit")) { closeOverlay(); state.homeTab = "sections"; goHome(); }
    else if (t.hasAttribute("data-ci-submit")) {
      if (!CHECKIN_ITEMS.every((it) => store.checklist[it.id])) return;
      const answers = {};
      CHECKIN_ITEMS.forEach((it) => { answers[it.id] = store.checklist[it.id]; });
      store.checkinLog[todayKey()] = { answers, submittedAt: new Date().toISOString() };
      save();
      renderCheckin();
      // three or more "No" answers across the seven rows calls the day off.
      // "Are you ready to trade?" is just one of the seven now, not an override.
      const noCount = CHECKIN_ITEMS.filter((it) => answers[it.id] === "no").length;
      const go = noCount < 3;
      openOverlay(`<div class="ci-result ${go ? "go" : "stop"}">
        <div class="ci-result-title">${go ? "Start Trade Day" : "Not a Trade Day"}</div>
        <div class="ci-result-body">${go
          ? `${noCount} of ${CHECKIN_ITEMS.length} marked No — you're clear to trade. Next is the pre-market checklist, which applies whichever session you trade.`
          : `${noCount} of ${CHECKIN_ITEMS.length} marked No. Three or more says today isn't the day. Protect the account and come back tomorrow.`}</div>
        ${go
          ? `<button class="btn-primary" data-ci-before>Continue to Before Trade</button>`
          : `<button class="btn-primary" data-ci-exit>Back to Home</button>`}
      </div>`);
    }
    else if (t.dataset.grid) { state.gridItem = t.dataset.grid; render(); }
    else if (t.hasAttribute("data-grid-back")) { state.gridItem = null; render(); }
    else if (t.hasAttribute("data-grid-play")) togglePlay();
    else if (t.dataset.vcat) { state.videoCat = state.videoCat === t.dataset.vcat ? null : t.dataset.vcat; render(); }
    else if (t.dataset.vid) playVideo(t.dataset.vid);
    else if (t.hasAttribute("data-vback")) closePlayer();
    else if (t.hasAttribute("data-vfull")) vpToggleFullscreen();
    else if (t.dataset.tab) { state.homeTab = t.dataset.tab; render(); }
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
    else if (t.hasAttribute("data-logout")) {
      stopAudio();
      if (window.FB) FB.signOut();
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
      `<div id="authError" class="gate-error hidden"></div>` +
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

  authForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(authForm);
    const email = (f.get("email") || "").trim();
    const password = f.get("password") || "";
    const btn = authForm.querySelector(".auth-submit");
    const err = $("authError");
    err.classList.add("hidden");
    btn.disabled = true;
    btn.classList.add("pending");
    btn.textContent = authMode === "login" ? "Signing In…" : "Creating Account…";
    try {
      if (authMode === "login") {
        await FB.signIn(email, password);
      } else {
        await FB.signUp(email, password);
        const name = (f.get("name") || "").trim();
        store.profile = { name, email, phone: (f.get("phone") || "").trim() };
        if (name) store.settings.name = name;
      }
      store.authSeen = true;
      save();
      await pullCloudAndMerge();   // resume progress/notes from other devices
      authScreen.classList.add("hidden");
      render();
    } catch (ex) {
      err.textContent = ex.message || "Sign-in failed — please try again.";
      err.classList.remove("hidden");
    } finally {
      btn.disabled = false;
      btn.classList.remove("pending");
      btn.textContent = authMode === "login" ? "Log In" : "Sign Up";
    }
  });

  /* Step 1 access gate: name/email/phone are captured on every attempt;
     the passcode is the gatekeeper. Attempts are logged locally and, when
     LEARNAEWAY_CONFIG.attemptsWebhookUrl is set, POSTed to that webhook
     (e.g. Zapier -> Google Sheet). */
  const CFG = window.LEARNAEWAY_CONFIG || {};
  /* three steps: access gate -> intake questionnaire -> login */
  function showAuthStep() {
    const onGate = !store.gatePassed;
    const onSurvey = !onGate && !store.surveyDone;
    if (onSurvey && !surveyRendered) renderSurvey();
    $("gateStep").classList.toggle("hidden", !onGate);
    $("surveyStep").classList.toggle("hidden", !onSurvey);
    $("loginStep").classList.toggle("hidden", onGate || onSurvey);
  }
  function logGateAttempt(attempt) {
    if (!store.gateAttempts) store.gateAttempts = [];
    store.gateAttempts.push(attempt);
    if (store.gateAttempts.length > 100) store.gateAttempts = store.gateAttempts.slice(-100);
    save();
    if (window.FB) FB.logGateAttempt(attempt);
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
    const identity = {
      firstName: (f.get("firstName") || "").trim(),
      lastName: (f.get("lastName") || "").trim(),
      email: (f.get("email") || "").trim(),
      phone: (f.get("phone") || "").trim(),
    };
    logGateAttempt(Object.assign({}, identity, {
      timestamp: new Date().toISOString(),
      passcodeCorrect: ok,
    }));
    if (ok) {
      store.gatePassed = true;
      store.gateIdentity = identity;   // join key for the questionnaire below
      save();
      $("gateError").classList.add("hidden");
      // open the lead record the questionnaire answers will merge onto
      if (window.FB && identity.email) {
        FB.saveLead(identity.email, Object.assign({}, identity, {
          gatePassedAt: new Date().toISOString(),
        }));
      }
      showAuthStep();
    } else {
      $("gateError").classList.remove("hidden");
    }
  });

  /* ---------------- step 1.5: beta intake questionnaire ----------------
     Replaces the standalone Google Form. Answers are stored locally and
     merged onto leads/{emailSlug} in Firestore, the same record the access
     gate above created — joined on the email entered at the gate. */

  const SURVEY = [
    { id: "location", type: "text", q: "Location", placeholder: "City, State" },
    { id: "knowledge", type: "single", q: "Current financial knowledge", other: true,
      options: [
        "No knowledge of markets/investing",
        "Know the basics, need structure",
        "Understand markets, trade occasionally",
        "Active trader wanting community & accountability",
      ] },
    { id: "goals", type: "multi", q: "Primary financial goal", other: true,
      options: [
        "Build long-term wealth",
        "Learn to trade",
        "Create a second income stream",
        "Replace current job income",
        "Protect family with insurance & savings",
        "Start or grow a business",
        "Invest in real estate",
        "Understand money management better",
      ] },
    { id: "pillars", type: "multi", q: "Which of the Six Pillars are you working on", other: true,
      options: [
        "Pillar 1 - Earned Income",
        "Pillar 2 - Protection",
        "Pillar 3 - Tax-Advantaged Accounts",
        "Pillar 4 - Business Ownership",
        "Pillar 5 - Real Estate",
        "Pillar 6 - Market Investing & Trading",
        "None yet, just starting",
      ] },
    { id: "priceMonthly", type: "single", q: "What would you pay per month for a guided step-by-step app", other: true,
      options: ["Free only", "$5-10", "$10-25", "$25-50", "$50+", "One-time fee instead"] },
    { id: "retention", type: "multi", q: "What makes you actually use an app consistently", other: true,
      options: [
        "Short lessons under 60 sec",
        "A personal AI guide",
        "Progress tracking",
        "Community",
        "Real applicable strategies",
        "Live market updates",
      ] },
    { id: "experience", type: "multi", q: "Experience with", other: true,
      options: ["Stocks", "Options", "Futures", "Forex", "Crypto", "None of the above"] },
    { id: "riskUnderstanding", type: "single", q: "Do you understand the risks of trading",
      options: [
        "Yes, understand and prepared",
        "General understanding, want clarity",
        "No, don't fully understand yet",
      ] },
    { id: "dailyTime", type: "single", q: "Time you can dedicate daily",
      options: ["15-30 min", "30-60 min", "1-2 hrs", "2+ hrs"] },
    { id: "readiness", type: "single", q: "When are you ready to start",
      options: ["Right now", "Within 30 days", "Within 3 months", "Just exploring"] },
    { id: "targetStartDate", type: "date", q: "Target start date" },
    { id: "contact", type: "multi", q: "How can we connect with you",
      options: [
        "Follow @aeway.co on Instagram",
        "Email updates",
        "Text updates",
        "Notify me at launch",
      ] },
  ];

  const surveyForm = $("surveyForm");
  let surveyRendered = false;

  function renderSurvey() {
    surveyForm.innerHTML = SURVEY.map((q, i) => {
      const label = `<div class="sv-label"><span class="sv-num">${i + 1}</span><span>${esc(q.q)}` +
        (q.type === "multi" ? `<span class="sv-multi">select all that apply</span>` : "") +
        `</span></div>`;
      if (q.type === "text" || q.type === "date") {
        const ph = q.placeholder ? ` placeholder="${esc(q.placeholder)}"` : "";
        const cls = q.type === "date" ? "sv-input sv-date" : "sv-input";
        return `<div class="sv-q" data-q="${q.id}" data-qtype="${q.type}">${label}
          <input class="g-pill auth-input ${cls}" name="${q.id}" type="${q.type === "date" ? "date" : "text"}"${ph} autocomplete="off"></div>`;
      }
      const chips = q.options.map((o) =>
        `<button type="button" class="sv-opt" data-sv-opt data-val="${esc(o)}">${esc(o)}</button>`).join("");
      const otherChip = q.other
        ? `<button type="button" class="sv-opt" data-sv-opt data-other="1" data-val="Other">Other</button>` : "";
      const otherInput = q.other
        ? `<input class="auth-input sv-other hidden" name="${q.id}__other" type="text" placeholder="Tell us more" autocomplete="off">` : "";
      return `<div class="sv-q" data-q="${q.id}" data-qtype="${q.type}">${label}
        <div class="sv-opts">${chips}${otherChip}</div>${otherInput}</div>`;
    }).join("") +
      `<div id="surveyError" class="gate-error hidden"></div>
       <button type="submit" class="g-pill auth-submit">Continue</button>`;
    surveyRendered = true;
  }

  surveyForm.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-sv-opt]");
    if (!btn) return;
    const wrap = btn.closest(".sv-q");
    if (wrap.dataset.qtype === "single") {
      wrap.querySelectorAll("[data-sv-opt]").forEach((b) => b.classList.toggle("on", b === btn));
    } else {
      btn.classList.toggle("on");
    }
    const otherBtn = wrap.querySelector('[data-other="1"]');
    const otherInput = wrap.querySelector(".sv-other");
    if (otherInput) {
      const show = !!otherBtn && otherBtn.classList.contains("on");
      otherInput.classList.toggle("hidden", !show);
      if (show) otherInput.focus();
    }
  });

  function collectSurvey() {
    const out = {};
    SURVEY.forEach((q) => {
      const wrap = surveyForm.querySelector(`.sv-q[data-q="${q.id}"]`);
      if (q.type === "text" || q.type === "date") {
        out[q.id] = (wrap.querySelector(`[name="${q.id}"]`).value || "").trim();
        return;
      }
      const otherInput = wrap.querySelector(".sv-other");
      const otherTxt = otherInput && !otherInput.classList.contains("hidden")
        ? otherInput.value.trim() : "";
      const picked = Array.from(wrap.querySelectorAll("[data-sv-opt].on"))
        .map((b) => (b.hasAttribute("data-other") && otherTxt ? `Other: ${otherTxt}` : b.dataset.val));
      out[q.id] = q.type === "multi" ? picked : (picked[0] || "");
    });
    return out;
  }

  surveyForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = surveyForm.querySelector(".auth-submit");
    const answers = collectSurvey();
    const identity = store.gateIdentity || {};
    store.survey = Object.assign({}, answers, { submittedAt: new Date().toISOString() });
    store.surveyDone = true;
    save();
    btn.disabled = true;
    btn.classList.add("pending");
    btn.textContent = "Saving…";
    if (window.FB && identity.email) {
      await FB.saveLead(identity.email, {
        survey: answers,
        surveyCompletedAt: store.survey.submittedAt,
      });
    }
    btn.disabled = false;
    btn.classList.remove("pending");
    btn.textContent = "Continue";
    showAuthStep();
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

  /* Keyboard handling for the login/gate screen: iOS keeps window.innerHeight
     full while the keyboard + QuickType bar are up, so the focused field can
     hide behind them. Shrink the auth screen to visualViewport.height and
     scroll the active input into view. */
  const vv = window.visualViewport;
  let kbFocused = null;
  function applyKbHeight() {
    if (!kbFocused || !vv) return;
    authScreen.style.setProperty("--kbvh", Math.round(vv.height) + "px");
  }
  function scrollFocusedIntoView() {
    if (kbFocused) kbFocused.scrollIntoView({ block: "center", behavior: "smooth" });
  }
  authScreen.addEventListener("focusin", (e) => {
    if (!e.target.classList || !e.target.classList.contains("auth-input")) return;
    kbFocused = e.target;
    authScreen.classList.add("kb-open");
    applyKbHeight();
    // wait for the keyboard + toolbar to finish animating in, then reveal
    setTimeout(() => { applyKbHeight(); scrollFocusedIntoView(); }, 320);
  });
  authScreen.addEventListener("focusout", (e) => {
    if (!e.target.classList || !e.target.classList.contains("auth-input")) return;
    setTimeout(() => {
      if (authScreen.contains(document.activeElement) &&
          document.activeElement.classList.contains("auth-input")) return;
      kbFocused = null;
      authScreen.classList.remove("kb-open");
    }, 60);
  });
  if (vv) vv.addEventListener("resize", () => { applyKbHeight(); scrollFocusedIntoView(); });

  const waveVideo = $("waveVideo");
  if (waveVideo) {
    waveVideo.addEventListener("error", () => $("headerZone").classList.add("video-broken"));
    waveVideo.play().catch(() => { /* autoplay blocked — poster image shows until a user gesture */ });
  }

  applyTextSize();
  syncVolume();
  render();

  if (window.FB && FB.user() && store.authSeen) {
    pullCloudAndMerge().then((merged) => { if (merged && state.view === "home") render(); });
  }

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => { /* offline support unavailable */ });
    });
  }
})();
