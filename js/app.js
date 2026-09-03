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
  if (!store.beforeTrade) store.beforeTrade = {};       // Before Trade Stage 1 picks
  if (!store.beforeTradeLog) store.beforeTradeLog = {}; // YYYY-MM-DD -> submitted Stage 1
  if (!store.journalImport) store.journalImport = {};   // account -> YYYY-MM-DD -> day totals
  if (!store.journalManual) store.journalManual = {};   // account -> YYYY-MM-DD -> [manual trades]
  if (!store.journalAccounts) store.journalAccounts = [];  // user-added brokerage accounts
  if (!store.journalActive) store.journalActive = "__all";   // "__all" = combined view
  if (!store.propLedger) store.propLedger = {};         // prop account -> [evaluation/reset/payout]
  if (!store.journalTrades) store.journalTrades = {};   // account -> [per-trade records]
  if (!store.journalOpen) store.journalOpen = {};       // account -> [positions still open]
  if (!store.dayProgress) store.dayProgress = {};       // YYYY-MM-DD -> { afterTrade, reviewCard }
  if (!store.journalBatches) store.journalBatches = {}; // account -> [one record per CSV import]
  /* The profile record. `name`/`email`/`phone` were already written at sign-up
     and are left alone; everything else is new. All of it is local — see the
     Profile screen for what has to change once accounts are real. */
  if (!store.profile) store.profile = {};
  {
    const p = store.profile;
    if (p.firstName === undefined) p.firstName = (p.name || "").split(" ")[0] || "";
    if (p.lastName === undefined) p.lastName = (p.name || "").split(" ").slice(1).join(" ");
    if (p.username === undefined) p.username = "";
    if (p.location === undefined) p.location = "";
    if (p.bio === undefined) p.bio = "";
    if (!Array.isArray(p.markets)) p.markets = [];
    if (p.tradingSince === undefined) p.tradingSince = "";
    if (p.investingSince === undefined) p.investingSince = "";
    if (!p.links) p.links = {};
    if (!Array.isArray(p.requestsSent)) p.requestsSent = [];
    if (!Array.isArray(p.connections)) p.connections = [];
  }
  if (store.profilePhoto === undefined) store.profilePhoto = "";  // data: URL, "" = use the default icon
  if (!store.pickaeway) store.pickaeway = {           // Reward Battle record
    rewardBalance: 0, wins: 0, losses: 0, draws: 0, accuracy: 0, speed: 0,
  };
  /* Trades used to be anonymous and untagged. The day view has to say which
     came from a CSV and which were typed in, and delete either, so both need
     an id and a source. A record is manual when the account's manual ledger
     holds an entry for the same day and amount (matched off one-for-one so a
     day with two identical manual trades tags both); everything else on an
     account that has imported before belongs to a stand-in batch for whatever
     was imported before this version. */
  let tagged = false;
  function jtId() { return `jt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`; }
  Object.keys(store.journalTrades || {}).forEach((acctId) => {
    const legacyDays = Object.keys(store.journalImport[acctId] || {});
    let legacyBatch = null;
    // one manual entry can only account for one trade record
    const pool = {};
    Object.keys(store.journalManual[acctId] || {}).forEach((day) => {
      pool[day] = (store.journalManual[acctId][day] || []).map((e) => e.pnl);
    });
    (store.journalTrades[acctId] || []).forEach((t) => {
      if (!t.id) { t.id = jtId(); tagged = true; }
      if (t.source) return;
      const hit = (pool[t.date] || []).indexOf(t.pnl);
      if (hit >= 0) { pool[t.date].splice(hit, 1); t.source = "manual"; }
      else if (legacyDays.length) {
        if (!legacyBatch) {
          legacyBatch = `batch-legacy-${acctId}`;
          const list = store.journalBatches[acctId] || (store.journalBatches[acctId] = []);
          if (!list.some((b) => b.id === legacyBatch)) {
            list.push({ id: legacyBatch, broker: "CSV", file: "", at: "", days: legacyDays.slice(), trades: 0 });
          }
        }
        t.source = "import";
        t.batch = legacyBatch;
      } else t.source = "manual";
      tagged = true;
    });
    const b = (store.journalBatches[acctId] || []).find((x) => x.id === legacyBatch);
    if (b) b.trades = (store.journalTrades[acctId] || []).filter((t) => t.batch === legacyBatch).length;
  });
  // manual ledger entries need naming too, so one can be deleted on its own
  Object.keys(store.journalManual || {}).forEach((acctId) => {
    Object.keys(store.journalManual[acctId] || {}).forEach((day) => {
      (store.journalManual[acctId][day] || []).forEach((e) => {
        if (!e.id) { e.id = jtId(); tagged = true; }
      });
    });
  });

  // sessions were renamed: Asian -> Asia, London -> Europe
  const SESSION_RENAME = { asian: "asia", london: "europe" };
  let sessionsRenamed = false;
  if (store.beforeTrade && SESSION_RENAME[store.beforeTrade.session]) {
    store.beforeTrade.session = SESSION_RENAME[store.beforeTrade.session];
    sessionsRenamed = true;
  }
  Object.keys(store.beforeTradeLog || {}).forEach((day) => {
    const a = store.beforeTradeLog[day] && store.beforeTradeLog[day].answers;
    if (a && SESSION_RENAME[a.session]) { a.session = SESSION_RENAME[a.session]; sessionsRenamed = true; }
  });
  // ledger entries used to be anonymous positions in an array; edit and delete
  // need to name one, so backfill an id on anything written before that
  let stamped = false;
  Object.keys(store.propLedger || {}).forEach((acctId) => {
    (store.propLedger[acctId] || []).forEach((e, i) => {
      if (!e.id) { e.id = `pfe-${acctId}-${i}-${Date.now().toString(36)}`; stamped = true; }
    });
  });
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
  if (renamed || stamped || sessionsRenamed || tagged) { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) { /* quota */ } }
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
      profile: Object.assign({
        name: store.settings.name || "",
        email: (window.FB && FB.user() ? FB.user().email : "") || "",
        phone: "",
      }, store.profile || {}),
      lastScreen: store.lastScreen || "",
      visited: store.visited || {},
      liked: store.liked || {},
      notes: store.notes || {},
      checklist: store.checklist || {},
      videosWatched: store.videosWatched || {},
      checkinLog: store.checkinLog || {},
      beforeTradeLog: store.beforeTradeLog || {},
      journalImport: store.journalImport || {},
      journalManual: store.journalManual || {},
      journalAccounts: store.journalAccounts || [],
      propLedger: store.propLedger || {},
      journalTrades: store.journalTrades || {},
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
    for (const k of ["visited", "liked", "checklist", "notes", "videosWatched", "checkinLog", "beforeTradeLog", "journalImport", "journalManual"]) {
      store[k] = Object.assign({}, cloud[k] || {}, store[k] || {});
    }
    if (!store.lastScreen && cloud.lastScreen) store.lastScreen = cloud.lastScreen;
    if (cloud.profile && !store.profile) store.profile = cloud.profile;
    if (cloud.settings && cloud.settings.name && !store.settings.name) store.settings.name = cloud.settings.name;
    save();
    return true;
  }

  /* ---------------- state ---------------- */

  /* Declared up here, not beside the desktop strip code that also uses it:
     showAuthStep() consults it during module setup, which is well before that
     section runs, and a `const` further down would still be in its dead zone. */
  const DESKTOP_MQ = "(min-width: 1200px)";

  /* Up here for the same reason: the header video is wired during module setup
     and asks for sound immediately, which reaches the mute button's painter —
     declared much further down, where a `const` would still be in its dead
     zone. See the hero sound section for what these do. */
  const VOL_ON = "assets/buttons-icon/speaker-on@2x.png";
  const VOL_OFF = "assets/buttons-icon/speaker-muted@2x.png";
  let heroSoundWanted = false;   // what the listener last asked for

  const state = {
    view: "home",            // 'home' | 'screen' | 'videos' | 'checkin' | 'beforetrade'
                             // | 'journal' | 'pickaeway' | 'buildmatch' | 'match' | 'result' | 'replay'
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
    journalMonth: 0,         // months offset from the current month
    journalSection: "calendar",   // calendar | total | net | recent
    journalRange: "1M",
    journalPicker: null,     // null | 'list' | 'add' | 'edit' | 'delete' (inline)
    journalPickerId: null,   // account being edited/deleted inside the panel
    journalDay: null,        // 'YYYY-MM-DD' — day view open in place of the calendar
    journalDelete: null,     // { kind:'manual'|'batch', id, acctId, label, count, days }
    journalReplace: null,    // { batchId, acctId } — CSV picker open to replace a batch
    profileMode: "view",     // 'view' (what others would see) | 'edit'
    profileNotice: null,     // { kind, text } — transient line under a Connect action
    profileCodeDraft: "",    // what's typed in the connect-code box, kept across renders
    checkinResult: null,     // { go, noCount } — result shown in place of the rows
    btResult: false,         // Before Trade Stage 1 summary shown in place of the rows
    btStage2: false,         // Stage 2 placeholder shown in place of that summary
    rtExpand: true,          // round history open on the result/replay screens
    propOpen: false,         // prop firm P&L pill expanded (collapsed by default)
    propMode: null,          // null | 'add' | 'edit' | 'delete' inside that pill
    propEntryId: null,       // ledger entry being edited or deleted
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
    { id: "physically",    label: "Are you Physically ready?" },
    { id: "mentally",      label: "Are you Mentally ready?" },
    { id: "emotionally",   label: "Are you Emotionally ready?" },
    { id: "distraction",   label: "Are you Distraction-Free Today?" },
    { id: "economic-news", label: "Have you checked today's economic news?" },
    { id: "market-awareness", label: "Are you aware of Current Market Conditions?" },
    { id: "ready-to-trade", label: "Are you ready to trade?" },
  ];

  /* Placeholders until the icon artwork lands — see the layout prompt.
     Only Before Trade has a screen behind it so far; the other three are still
     inert, so they render as plain markers rather than buttons. */
  const CHECKIN_ACTIONS = [
    { label: "Start Day", icon: "cat-start-day" },
    { label: "Before Trade", icon: "cat-before-trade", go: "bt-open" },
    { label: "After Trade", icon: "cat-after-trade" },
    { label: "Discipline Streak", icon: "cat-discipline-streak" },
  ];

  /* Before Trade — Stage 1: Chart Read. Same one-tap-per-row shape as the
     Start Day checklist, but the rows carry two or three named answers instead
     of a fixed Yes/No, and the two "mark it" rows carry a single confirmation.
     Stage 2 (strategy selection) is being built separately. */
  const BT1_ITEMS = [
    { id: "session", label: "Trading session", cols: 3, opts: [
      ["asia", "Asia"], ["europe", "Europe"], ["ny", "New York"]] },
    { id: "pdh", label: "Mark previous day high", cols: 1, opts: [["marked", "Marked"]] },
    { id: "pdl", label: "Mark previous day low", cols: 1, opts: [["marked", "Marked"]] },
    { id: "htf", label: "Current market structure (HTF)", cols: 2, opts: [
      ["bullish", "Bullish"], ["bearish", "Bearish"]] },
    { id: "ltf", label: "Current lower timeframe structure", cols: 3, opts: [
      ["uptrend", "Uptrend"], ["downtrend", "Downtrend"], ["consolidation", "Consolidation"]] },
  ];
  /* short forms for the summary — the full option labels are too long once
     five of them are stacked in a key/value list */
  const BT1_SHORT = {
    session: "Session", pdh: "Previous day high", pdl: "Previous day low",
    htf: "Market structure (HTF)", ltf: "Lower timeframe",
  };
  function bt1OptLabel(item, val) {
    const hit = item.opts.find((o) => o[0] === val);
    return hit ? hit[1] : "—";
  }

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
    // quotes escaped too: several call sites drop user-typed text (survey
    // "Other" answers, the settings name field) into a value="${esc(x)}"
    // attribute, and an unescaped " there breaks out of the attribute.
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
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
    /* Only when the track itself changes. This used to stop unconditionally,
       which meant any re-render of the screen you were already on — picking a
       grid item, a cloud merge landing, anything that reaches render() — cut
       the narration off mid-sentence. Same screen, same track: leave it be. */
    const nextKey = [].concat(currentAudioSrc() || []).join("|");
    if (nextKey !== audioQueueKey) stopAudio();
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
    // narration that survived this render still owns the buttons: the card body
    // was just rewritten, so any play icon inside it is back at its default
    setPlayIcon(playing);
    setNarrating(playing);
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
  let clockTimer = null;      // one ticking clock for the whole app


  /* The submit result takes over the question area of the card itself — the
     seven rows and the submit button are swapped out for it, so there is no
     overlay and the user stays on the same bordered card. */
  function checkinResultHTML(res) {
    return `<div class="ci-result ci-result-inline ${res.go ? "go" : "stop"}">
      <div class="ci-result-title">${res.go ? "Start Trade Day" : "Not a Trade Day"}</div>
      <div class="ci-result-body">${res.go
        ? `${res.noCount} of ${CHECKIN_ITEMS.length} marked No — you're clear to trade. Next is the pre-market checklist, which applies whichever session you trade.`
        : `${res.noCount} of ${CHECKIN_ITEMS.length} marked No. Three or more says today isn't the day. Protect the account and come back tomorrow.`}</div>
      ${res.go
        ? `<button class="btn-primary" data-ci-before>Continue to Before Trade</button>`
        : `<button class="btn-primary" data-ci-exit>Back to Home</button>`}
    </div>`;
  }

  /* Rebuilding a checklist in place — answering a row, expanding something —
     must leave the reader where they were. Only arriving at the screen starts
     at the top. Same mechanism the journal uses. */
  let ciKeepScroll = false;
  let ciScrollTop = 0;
  function renderChecklistInPlace(fn) {
    ciScrollTop = cardScroll.scrollTop;
    ciKeepScroll = true;
    fn();
  }

  /* Start Day stays on its result for the rest of the calendar day: the
     answers are already logged, so the state is rebuilt from that log rather
     than held in memory, and it survives navigating away and back. */
  function checkinResultFor(dayKey) {
    const rec = (store.checkinLog || {})[dayKey];
    if (!rec || !rec.answers) return null;
    const noCount = CHECKIN_ITEMS.filter((it) => rec.answers[it.id] === "no").length;
    return { go: noCount < 3, noCount };
  }

  function renderCheckin() {
    barTitle.textContent = "Trade Day Checkin";
    paintStreak();
    const res = state.checkinResult || checkinResultFor(todayKey());
    cardScroll.innerHTML = `
      ${res ? checkinResultHTML(res) : `
      <h1 class="ci-heading">Check List Before Trading Day</h1>
      <div class="ci-list">
        ${CHECKIN_ITEMS.map((it) => `
          <div class="ci-row ${store.checklist[it.id] === "yes" ? "yes" : store.checklist[it.id] === "no" ? "no" : ""}">
            <button class="ci-half ci-yes" data-ci="${it.id}" data-ci-val="yes"
                    aria-label="${esc(it.label)} — yes" aria-pressed="${store.checklist[it.id] === "yes"}">YES</button>
            <span class="ci-label">${esc(it.label)}</span>
            <button class="ci-half ci-no" data-ci="${it.id}" data-ci-val="no"
                    aria-label="${esc(it.label)} — no" aria-pressed="${store.checklist[it.id] === "no"}">NO</button>
          </div>`).join("")}
      </div>
      ${(() => {
        const ready = CHECKIN_ITEMS.every((it) => store.checklist[it.id]);
        const sent = store.checkinLog[todayKey()];
        return `<button class="ci-submit${ready ? "" : " off"}"
          ${ready ? "" : "disabled"} data-ci-submit>${sent ? "Submitted" : "Submit"}</button>`;
      })()}`}
      ${checkinActionsHTML()}`;
    // the result stretches to fill the space the rows left behind, so it sits
    // centred in the card rather than clinging to the top of it
    cardScroll.classList.toggle("ci-resulting", !!res);
    cardScroll.scrollTop = ciKeepScroll ? ciScrollTop : 0;
    ciKeepScroll = false;
    cardFooter.style.display = "none";
  }

  /* the four section orbs, shared by both checklist screens. The ones with no
     screen yet stay spans so nothing looks tappable that isn't. */
  function checkinActionsHTML() {
    return `
      <div class="ci-actions">
        ${CHECKIN_ACTIONS.map((a) => {
          const orb = `<span class="ci-orb" aria-hidden="true">
              <img src="assets/nav-icons/${a.icon}@2x.png" alt=""></span>`;
          return `<div class="ci-action">
            ${a.go ? `<button class="ci-orb-btn" data-${a.go} aria-label="${esc(a.label)}">${orb}</button>` : orb}
            <span class="ci-action-label">${esc(a.label)}</span>
          </div>`;
        }).join("")}
      </div>`;
  }

  function openCheckin() {
    stopAudio();
    state.view = "checkin";
    state.slideDir = 0;
    // once today's check-in is submitted the screen belongs to the result, so
    // coming back lands there; the questions return on the next calendar day
    state.checkinResult = checkinResultFor(todayKey());
    closeOverlay();
    render();
  }

  /* ---------------- Before Trade — Stage 1: Chart Read ----------------
     Five one-tap rows. Submit is dead until all five are answered, and once
     sent the rows are swapped for the summary inside the same card — same
     treatment as the Start Day result, no overlay. */

  function bt1Answered() {
    return BT1_ITEMS.every((it) => store.beforeTrade[it.id]);
  }

  function bt1RowsHTML() {
    return `
      <h1 class="ci-heading">Before Trade · Stage 1</h1>
      <div class="bt-sub">Chart Read</div>
      <div class="bt-list">
        ${BT1_ITEMS.map((it) => {
          const picked = store.beforeTrade[it.id];
          return `<div class="bt-row${picked ? " done" : ""}">
            <div class="bt-q">${esc(it.label)}</div>
            <div class="bt-opts bt-opts-${it.cols}">
              ${it.opts.map(([v, label]) => `
                <button class="bt-opt${picked === v ? " on" : ""}" data-bt="${it.id}" data-bt-val="${v}"
                        aria-pressed="${picked === v}">${esc(label)}</button>`).join("")}
            </div>
          </div>`;
        }).join("")}
      </div>
      ${(() => {
        const ready = bt1Answered();
        const sent = store.beforeTradeLog[todayKey()];
        return `<button class="ci-submit${ready ? "" : " off"}"
          ${ready ? "" : "disabled"} data-bt-submit>${sent ? "Submitted" : "Submit"}</button>`;
      })()}`;
  }

  function bt1ResultHTML() {
    const a = (store.beforeTradeLog[todayKey()] || {}).answers || store.beforeTrade;
    return `<div class="ci-result ci-result-inline go">
      <div class="ci-result-title">Stage 1 Complete</div>
      <div class="ci-result-body">Chart read logged. Here's what you marked.</div>
      <div class="bt-summary">
        ${BT1_ITEMS.map((it) => `
          <div class="bt-sum-row">
            <span class="bt-sum-k">${esc(BT1_SHORT[it.id])}</span>
            <span class="bt-sum-v">${esc(bt1OptLabel(it, a[it.id]))}</span>
          </div>`).join("")}
      </div>
      <button class="btn-primary" data-bt-stage2>Continue to Stage 2</button>
    </div>`;
  }

  /* Stage 2 is a separate build; until it lands this takes over the same
     content area rather than opening anything over the top of it. */
  function bt1Stage2HTML() {
    return `<div class="ci-result ci-result-inline">
      <div class="ci-result-title soon">Stage 2</div>
      <div class="ci-result-body">Strategy selection and its follow-up questions are
        being built separately. Your Stage 1 chart read is saved for today.</div>
      <button class="btn-primary" data-bt-back>Back to Stage 1</button>
      <button class="btn-secondary" data-bt-exit>Back to Check-In</button>
    </div>`;
  }

  function renderBeforeTrade() {
    barTitle.textContent = "Before Trade";
    paintStreak();
    const body = state.btStage2 ? bt1Stage2HTML()
      : state.btResult ? bt1ResultHTML()
      : bt1RowsHTML();
    cardScroll.innerHTML = body + checkinActionsHTML();
    cardScroll.classList.toggle("ci-resulting", !!(state.btResult || state.btStage2));
    cardScroll.scrollTop = ciKeepScroll ? ciScrollTop : 0;
    ciKeepScroll = false;
    cardFooter.style.display = "none";
  }

  function openBeforeTrade() {
    stopAudio();
    state.view = "beforetrade";
    state.slideDir = 0;
    // arriving always lands on the questions, never a stale summary
    state.btResult = false;
    state.btStage2 = false;
    closeOverlay();
    render();
  }

  /* ---------------- Pickæway (Reward Battle) ----------------
     The Cool Down Game's home screen. Stats come from store.pickaeway and
     read zero until matches are actually played; Build Match sets a battle up
     and Match Replay reopens the last one. */

  function dayKeyOf(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  /* The four sections a full trading day is made of. Each one fills its own
     dot the moment it is submitted, and stays filled for the rest of that
     calendar day — nothing here resets mid-day. Start Day and Before Trade
     read their own submitted logs; the two that have no screen yet read
     store.dayProgress, which is the hook they will write to when built. */
  const DAY_SECTIONS = [
    { id: "startDay", label: "Start Day", done: (k) => !!(store.checkinLog || {})[k] },
    { id: "beforeTrade", label: "Before Trade", done: (k) => !!(store.beforeTradeLog || {})[k] },
    { id: "afterTrade", label: "After Trade", done: (k) => !!(store.dayProgress[k] || {}).afterTrade },
    { id: "reviewCard", label: "Review Streak Report Card", done: (k) => !!(store.dayProgress[k] || {}).reviewCard },
  ];

  function sectionsDone(dayKey) {
    return DAY_SECTIONS.filter((s) => s.done(dayKey)).length;
  }
  /* all four sections submitted — a full discipline streak day */
  function dayComplete(dayKey) {
    return sectionsDone(dayKey) === DAY_SECTIONS.length;
  }

  /* Consecutive fully-completed days, counting back from today. Today not
     being finished yet doesn't break the run — the day isn't over. */
  function disciplineStreak() {
    const d = new Date();
    if (!dayComplete(dayKeyOf(d))) d.setDate(d.getDate() - 1);
    let n = 0;
    while (dayComplete(dayKeyOf(d))) { n++; d.setDate(d.getDate() - 1); }
    return n;
  }

  /* The hour in New York, whatever the device's own timezone and whether or
     not the US is on daylight saving. */
  function easternHour(d) {
    const h = parseInt(d.toLocaleString("en-US", {
      timeZone: "America/New_York", hour: "numeric", hour12: false }), 10);
    return isNaN(h) ? d.getUTCHours() : h % 24;
  }

  /* Three sessions, by New York time. New York opens at 7am Eastern so the
     premarket counts as part of it; Europe runs from the London open to that;
     everything else is Asia. */
  function currentSession() {
    const h = easternHour(new Date());
    if (h >= 7 && h < 17) return "NEW YORK";
    if (h >= 3 && h < 7) return "EUROPE";
    return "ASIA";
  }

  /* Four circles in the Trade Day Check-In bar, one per section, filled as
     each is completed today — left to right, Start through End. Filled uses
     the delivered disc; the rest keep the thin outline ring. */
  function paintStreak() {
    const key = todayKey();
    const el = $("checkinStreak");
    if (!el) return;
    const dots = DAY_SECTIONS.map((sec) =>
      `<span class="streak-dot${sec.done(key) ? " on" : ""}" title="${esc(sec.label)}"></span>`).join("");
    el.innerHTML = `<span class="streak-cap">Start</span>${dots}<span class="streak-cap">End</span>`;
    el.setAttribute("aria-label",
      `Today's sections: ${sectionsDone(key)} of ${DAY_SECTIONS.length} complete — ${
        DAY_SECTIONS.map((s) => `${s.label} ${s.done(key) ? "done" : "not done"}`).join(", ")}`);
  }

  /* session · time · date, painted onto the header video */
  function paintWaveClock() {
    const now = new Date();
    $("wcSessionName").textContent = currentSession();
    $("wcTime").textContent = now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", second: "2-digit" });
    $("wcDate").textContent = now.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }).toUpperCase();
  }

  function pickStats() {
    const p = store.pickaeway;
    const played = (p.wins || 0) + (p.losses || 0) + (p.draws || 0);
    return {
      reward: (p.rewardBalance || 0).toFixed(2),
      record: `${p.wins || 0}-${p.losses || 0}-${p.draws || 0}`,
      winRate: played ? `${Math.round((p.wins / played) * 100)}%` : "—",
      accuracy: played ? `${Math.round(p.accuracy || 0)}%` : "—",
      matches: String(played),
      speed: played ? `${(p.speed || 0).toFixed(1)}s` : "—",
    };
  }

  function renderPickaeway() {
    const s = pickStats();
    barTitle.textContent = "Gameæway";
    const pickName = document.querySelector("#pickBar .pick-name");
    if (pickName) pickName.textContent = "Cool Down Game";
    cardScroll.innerHTML = `
      <div class="pk-reward">
        <div class="pk-cap">Reward Balance</div>
        <div class="pk-big">${s.reward}</div>
        <div class="pk-note">lifetime points earned in Reward Battle</div>
      </div>
      <div class="pk-row pk-row-2">
        <div class="pk-stat"><div class="pk-cap">Record</div><div class="pk-val">${s.record}</div></div>
        <div class="pk-stat"><div class="pk-cap">Win Rate</div><div class="pk-val teal">${s.winRate}</div></div>
      </div>
      <div class="pk-row pk-row-3">
        <div class="pk-stat"><div class="pk-cap">Avg Accuracy</div><div class="pk-val">${s.accuracy}</div></div>
        <div class="pk-stat pk-mid"><div class="pk-cap">Matches</div><div class="pk-val">${s.matches}</div></div>
        <div class="pk-stat"><div class="pk-cap">Avg Speed</div><div class="pk-val">${s.speed}</div></div>
      </div>
      <div class="pk-actions">
        <button class="pk-replay" data-pk-replay aria-label="Match Replay">
          <img src="assets/nav-icons/icon-match-replay@2x.png" alt="">
        </button>
        <div class="pk-replay-label">Match Replay</div>
        <button class="pk-build" data-pk-build><span class="pk-plus">+</span> Build Match</button>
      </div>`;
    cardScroll.scrollTop = 0;
    cardFooter.style.display = "none";
  }

  /* ---------------- Build Match ----------------
     Picks the settings for a Reward Battle round, then hands them straight to
     the match engine below. Every figure on the screen is a setting or derived
     from one. */

  const BM_INSTRUMENTS = ["ES", "NQ", "YM", "RTY"];
  const BM_TIMEFRAMES = [1, 2, 3, 5];
  const BM_CANDLES = [3, 5, 7, 9, 15];
  const BM_BANKROLL = 100;

  /* Each timeframe runs its candles in real time at its own compressed pace,
     and gets its own pair of reaction windows — a 5-minute candle gives you
     longer to read it than a 1-minute one. Match duration is candleDuration
     multiplied by the candle count, so the lobby figure is exactly the time
     the match takes. */
  const BM_TF_SPEC = {
    1: { id: "1m", candleDuration: 20, hard: 10, easy: 15 },
    2: { id: "2m", candleDuration: 35, hard: 15, easy: 30 },
    3: { id: "3m", candleDuration: 50, hard: 30, easy: 45 },
    5: { id: "5m", candleDuration: 65, hard: 35, easy: 60 },
  };
  function bmSpec(s) { return BM_TF_SPEC[s.timeframe] || BM_TF_SPEC[1]; }
  function bmWindow(s) { return bmSpec(s)[s.difficulty]; }
  function bmDuration(s) { return bmSpec(s).candleDuration * s.candles; }

  function bmSettings() {
    const b = store.buildMatch || {};
    return {
      instrument: BM_INSTRUMENTS.indexOf(b.instrument) >= 0 ? b.instrument : "ES",
      timeframe: BM_TIMEFRAMES.indexOf(b.timeframe) >= 0 ? b.timeframe : 1,
      candles: BM_CANDLES.indexOf(b.candles) >= 0 ? b.candles : 3,
      difficulty: b.difficulty === "easy" ? "easy" : "hard",
    };
  }

  function bmSet(key, value) {
    store.buildMatch = Object.assign(bmSettings(), { [key]: value });
    save();
    renderBuildMatch();
  }

  function durationLabel(secs) {
    return `${Math.floor(secs / 60)}m ${secs % 60}s`;
  }

  function bmOverview(s) {
    return [
      { v: s.instrument, l: "Instrument" },
      { v: `${s.timeframe}m`, l: "Time Frame" },
      { v: String(s.candles), l: "Candles" },
      { v: `${bmWindow(s)}s`, l: "Reaction Window" },
      { v: s.difficulty.toUpperCase(), l: "Difficulty" },
      { v: `${bmSpec(s).candleDuration}s`, l: "Per Candle" },
    ];
  }

  function renderBuildMatch() {
    const s = bmSettings();
    barTitle.textContent = "Pickæway";
    const pickName = document.querySelector("#pickBar .pick-name");
    if (pickName) pickName.textContent = "Build Match";
    cardScroll.innerHTML = `
      <div class="bm-stats">
        <div class="bm-stat bm-stat-dur">
          <div class="bm-cap">Match Duration</div>
          <div class="bm-val">${durationLabel(bmDuration(s))}</div>
        </div>
        <div class="bm-stat bm-stat-bank">
          <div class="bm-cap">Bank Roll</div>
          <div class="bm-val">${plainMoney(BM_BANKROLL)}
            <span class="bm-bankicon" aria-hidden="true">
              <svg viewBox="0 0 24 18"><rect x="1.2" y="1.2" width="21.6" height="15.6" rx="4"
                fill="none" stroke="currentColor" stroke-width="1.6"/>
                <circle cx="12" cy="9" r="3.4" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>
            </span>
          </div>
        </div>
      </div>
      <div class="bm-reward"><span class="bm-reward-tag">Reward</span></div>

      <div class="bm-label">Instrument</div>
      <div class="bm-row bm-row-4">
        ${BM_INSTRUMENTS.map((x) => `
          <button class="bm-circle ${s.instrument === x ? "on" : ""}" data-bmins="${x}">${x}</button>`).join("")}
      </div>

      <div class="bm-label">Timeframe</div>
      <div class="bm-row bm-row-4">
        ${BM_TIMEFRAMES.map((x) => `
          <button class="bm-rect ${s.timeframe === x ? "on" : ""}" data-bmtf="${x}">${x} MIN</button>`).join("")}
      </div>

      <div class="bm-label">Candles</div>
      <div class="bm-row bm-row-5">
        ${BM_CANDLES.map((x) => `
          <button class="bm-rect ${s.candles === x ? "on" : ""}" data-bmcd="${x}">${x}</button>`).join("")}
      </div>

      <div class="bm-diff">
        <button class="bm-rect bm-diff-btn hard ${s.difficulty === "hard" ? "on" : ""}" data-bmdiff="hard">
          <span class="bm-diff-name">Hard</span><span class="bm-diff-secs">${bmSpec(s).hard}s</span>
        </button>
        <span class="bm-diff-mid">To React</span>
        <button class="bm-rect bm-diff-btn easy ${s.difficulty === "easy" ? "on" : ""}" data-bmdiff="easy">
          <span class="bm-diff-secs">${bmSpec(s).easy}s</span><span class="bm-diff-name">Easy</span>
        </button>
      </div>

      <div class="bm-rule" aria-hidden="true"></div>
      <div class="bm-label">Match Overview</div>
      <div class="bm-overview">
        ${bmOverview(s).map((o) => `
          <div class="bm-badge">
            <span class="bm-badge-box"><span class="bm-badge-val">${esc(o.v)}</span></span>
            <span class="bm-badge-lbl">${esc(o.l)}</span>
          </div>`).join("")}
      </div>

      <button class="bm-start" data-bmstart>Start Match</button>
      <div class="bm-note">Matched only against players with the exact same settings</div>`;
    cardScroll.scrollTop = 0;
    cardFooter.style.display = "none";
  }

  function openBuildMatch() {
    stopAudio();
    state.view = "buildmatch";
    state.slideDir = 0;
    closeOverlay();
    render();
  }

  function openPickaeway() {
    stopAudio();
    state.view = "pickaeway";
    state.slideDir = 0;
    closeOverlay();
    render();
  }

  /* ==================== Pickæway match engine ====================
     Runs the battle behind Build Match and the replay behind Match Replay.

     Everything downstream of the two generators below consumes a flat array of
     30-second OHLC bars ({open,high,low,close,green}) and never asks where the
     bars came from — swapping in real historical prices means replacing the
     bodies of genSession30s() and genTradingDay() and nothing else. */

  /* ─── SWAP TARGETS: the only two functions producing synthetic prices ─── */

  const MK_BASE_PRICES = { ES: 5280, NQ: 18420, YM: 39800, RTY: 2080 };
  const MK_VOLATILITY = { ES: 8, NQ: 25, YM: 60, RTY: 6 };

  function genCandle(prev, inst) {
    const vol = MK_VOLATILITY[inst] || 10;
    const open = prev + (Math.random() - 0.5) * vol * 0.2;
    const close = open + (Math.random() - 0.47) * vol * 1.2;
    return {
      open: +open.toFixed(2),
      high: +(Math.max(open, close) + Math.random() * vol * 0.5).toFixed(2),
      low: +(Math.min(open, close) - Math.random() * vol * 0.5).toFixed(2),
      close: +close.toFixed(2),
      green: close >= open,
    };
  }

  /* the intraday tape a match is played against: n consecutive 30s bars */
  function genSession30s(inst, n = 500) {
    let p = MK_BASE_PRICES[inst] || 5000;
    return Array.from({ length: n }, () => {
      const c = genCandle(p, inst);
      p = c.close;
      return c;
    });
  }

  /* a full 9:30–4:00 session as 390 one-minute bars, used by the replay chart.
     Volatility is pushed up around the open and into the close. */
  function genTradingDay(inst) {
    let p = MK_BASE_PRICES[inst] || 5000;
    const vol = MK_VOLATILITY[inst] || 10;
    return Array.from({ length: 390 }, (_, i) => {
      const volMult = i < 30 ? 1.4 : i > 350 ? 1.2 : 0.8 + Math.random() * 0.4;
      const open = p + (Math.random() - 0.5) * vol * 0.15;
      const close = open + (Math.random() - 0.48) * vol * volMult;
      const high = Math.max(open, close) + Math.random() * vol * 0.4 * volMult;
      const low = Math.min(open, close) - Math.random() * vol * 0.4 * volMult;
      p = close;
      return {
        open: +open.toFixed(2), high: +high.toFixed(2),
        low: +low.toFixed(2), close: +close.toFixed(2), green: close >= open,
      };
    });
  }

  /* ─── END SWAP TARGETS ───────────────────────────────────────────────── */

  const MK_BARS_30S = { "1m": 2, "2m": 4, "3m": 6, "5m": 10 };
  const MK_BARS_1M = { "1m": 1, "2m": 2, "3m": 3, "5m": 5 };

  /* rolls a bar array up into bigger candles, `size` bars at a time */
  function mkGroup(bars, size) {
    const out = [];
    for (let i = 0; i < bars.length; i += size) {
      const g = bars.slice(i, i + size);
      if (!g.length) continue;
      out.push({
        open: g[0].open,
        high: Math.max.apply(null, g.map((c) => c.high)),
        low: Math.min.apply(null, g.map((c) => c.low)),
        close: g[g.length - 1].close,
        green: g[g.length - 1].close >= g[0].open,
      });
    }
    return out;
  }
  function mkAggregate(bars30s, tfId) { return mkGroup(bars30s, MK_BARS_30S[tfId] || 2); }
  function mkAggregateReview(bars1m, tfId) { return mkGroup(bars1m, MK_BARS_1M[tfId] || 1); }

  const MK_RISKS = [5, 10, 15, 20, 25, 30];
  const MK_RRS = [
    { label: "1:1", m: 1 }, { label: "1:2", m: 2 },
    { label: "1:4", m: 4 }, { label: "1:6", m: 6 },
  ];

  /* ---- two-axis scoring: max 2.00 points a round ---- */

  /* Speed Tier — how much of the reaction window you spent, correct only */
  function calcSpeedPoints(secondsUsed, windowSecs) {
    const pctUsed = secondsUsed / windowSecs;
    if (pctUsed <= 0.20) return 1.0;
    if (pctUsed <= 0.40) return 0.75;
    if (pctUsed <= 0.60) return 0.5;
    if (pctUsed <= 0.80) return 0.25;
    return 0.1;
  }
  /* Commitment Order — full point for calling it first, half for calling it second */
  function calcOrderPoints(isCorrect, reactedFirst) {
    if (!isCorrect) return 0;
    return reactedFirst ? 1.0 : 0.5;
  }
  function calcRoundPoints(isCorrect, secondsUsed, windowSecs, missed, reactedFirst) {
    if (missed || !isCorrect) return 0;
    return calcOrderPoints(isCorrect, reactedFirst) + calcSpeedPoints(secondsUsed, windowSecs);
  }

  /* the opponent: leans slightly with the last three candles, everything else
     is a coin toss inside the same choices the player has */
  function aiReact(candles, windowSecs) {
    const bull = candles.slice(-3).filter((c) => c.green).length;
    const green = bull >= 2 ? Math.random() < 0.65 : Math.random() > 0.65;
    return {
      direction: green ? "green" : "red",
      rrIdx: Math.floor(Math.random() * MK_RRS.length),
      risk: MK_RISKS[Math.floor(Math.random() * MK_RISKS.length)],
      reactionSecs: +(1 + Math.random() * windowSecs * 0.8).toFixed(1),
    };
  }

  /* points, then bankroll, then correct calls, then total reaction time */
  function computeWinner(pPts, aPts, pB, aB, log) {
    const pC = log.filter((r) => r.playerCorrect).length;
    const aC = log.filter((r) => r.aiCorrect).length;
    const pS = log.reduce((a, r) => a + r.playerReactionSecs, 0);
    const aS = log.reduce((a, r) => a + r.aiReactionSecs, 0);
    if (pPts > aPts) return { winner: "player", reason: "points" };
    if (aPts > pPts) return { winner: "opponent", reason: "points" };
    if (pB > aB) return { winner: "player", reason: "bankroll" };
    if (aB > pB) return { winner: "opponent", reason: "bankroll" };
    if (pC > aC) return { winner: "player", reason: "accuracy" };
    if (aC > pC) return { winner: "opponent", reason: "accuracy" };
    if (pS < aS) return { winner: "player", reason: "speed" };
    if (aS < pS) return { winner: "opponent", reason: "speed" };
    return { winner: "tie", reason: "tie" };
  }

  /* ---------------- live match state ----------------
     One rAF loop drives the clock and the forming candle. The DOM is only
     rebuilt when the round or the phase changes; every frame in between just
     repaints the canvas and rewrites the countdown, so taps never land on a
     node that is about to be replaced. */

  const MK_HISTORY = 40;          // candles of context before the first round
  const MK_RESOLVE_HOLD = 1500;   // ms the resolved round stays on screen

  const mk = {
    on: false,
    s: null, spec: null, win: 0, dur: 0,
    tf: [], rounds: 0, round: 0,
    phase: "reacting",            // 'reacting' | 'closing' | 'resolved'
    t0: 0, elapsed: 0,
    pick: null, risk: 10, rrIdx: 1, lockedAt: null,
    ai: null,
    bankP: 0, bankA: 0, ptsP: 0, ptsA: 0,
    log: [], expand: false,
    animClose: 0, animHi: 0, animLo: 0, seed: 0,
    raf: null, hold: null,
  };

  function mkActive() { return mk.tf[MK_HISTORY + mk.round]; }

  /* bankrolls can go under water, and "$-40.00" reads badly */
  function mkBank(n) {
    return (n < 0 ? "-$" : "$") + Math.abs(n).toLocaleString("en-US",
      { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function startMatch() {
    const s = bmSettings();
    const spec = bmSpec(s);
    mkAbort();
    const need = (MK_HISTORY + s.candles + 2) * (MK_BARS_30S[spec.id] || 2);
    mk.on = true;
    mk.s = s;
    mk.spec = spec;
    mk.win = bmWindow(s);
    mk.dur = spec.candleDuration;
    mk.tf = mkAggregate(genSession30s(s.instrument, need), spec.id);
    mk.rounds = s.candles;
    mk.round = 0;
    mk.bankP = BM_BANKROLL;
    mk.bankA = BM_BANKROLL;
    mk.ptsP = 0;
    mk.ptsA = 0;
    mk.log = [];
    mk.expand = false;
    mk.risk = 10;
    mk.rrIdx = 1;
    stopAudio();
    state.view = "match";
    state.slideDir = 0;
    closeOverlay();
    mkBeginRound();
    render();
  }

  function mkBeginRound() {
    const c = mkActive();
    mk.phase = "reacting";
    mk.pick = null;
    mk.lockedAt = null;
    mk.t0 = performance.now();
    mk.elapsed = 0;
    mk.seed = Math.random() * 100;
    mk.animClose = c.open;
    mk.animHi = c.open;
    mk.animLo = c.open;
    mk.ai = aiReact(mk.tf.slice(0, MK_HISTORY + mk.round), mk.win);
    cancelAnimationFrame(mk.raf);
    mk.raf = requestAnimationFrame(mkLoop);
  }

  function mkAbort() {
    mk.on = false;
    cancelAnimationFrame(mk.raf);
    clearTimeout(mk.hold);
    mk.raf = null;
    mk.hold = null;
  }

  function mkLoop() {
    if (!mk.on || state.view !== "match") return;
    mk.elapsed = (performance.now() - mk.t0) / 1000;

    if (mk.phase !== "resolved") {
      // unbiased oscillation around the open — the forming candle never leaks
      // which way it is going to close
      const c = mkActive();
      const amp = (Math.max(Math.abs(c.high - c.low), 0.01)) * 0.35;
      mk.animClose = c.open
        + Math.sin(mk.elapsed * 1.7 + mk.seed) * amp
        + Math.sin(mk.elapsed * 4.3 + mk.seed * 2) * amp * 0.4;
      mk.animHi = Math.max(mk.animHi, mk.animClose);
      mk.animLo = Math.min(mk.animLo, mk.animClose);
    }

    if (mk.phase === "reacting" && mk.elapsed >= mk.win) {
      mk.phase = "closing";
      renderMatch();
    } else if (mk.phase === "closing" && mk.elapsed >= mk.dur) {
      mkResolve();
      return;
    } else {
      mkPaintClock();
      mkPaintChart();
    }
    mk.raf = requestAnimationFrame(mkLoop);
  }

  function mkLock(dir) {
    if (mk.phase !== "reacting" || mk.pick) return;
    mk.pick = dir;
    mk.lockedAt = Math.min(+mk.elapsed.toFixed(1), mk.win);
    renderMatch();
  }

  function mkResolve() {
    const c = mkActive();
    const actualDir = c.green ? "green" : "red";
    const missed = !mk.pick;
    const pSecs = missed ? mk.win : mk.lockedAt;
    const pFirst = !missed && pSecs < mk.ai.reactionSecs;
    const aFirst = missed || mk.ai.reactionSecs <= pSecs;
    const pCorrect = !missed && mk.pick === actualDir;
    const aCorrect = mk.ai.direction === actualDir;
    const pPts = calcRoundPoints(pCorrect, pSecs, mk.win, missed, pFirst);
    const aPts = calcRoundPoints(aCorrect, mk.ai.reactionSecs, mk.win, false, aFirst);

    // a missed round costs nothing — it is the same as not taking the trade
    if (!missed) mk.bankP += pCorrect ? mk.risk * MK_RRS[mk.rrIdx].m : -mk.risk;
    mk.bankA += aCorrect ? mk.ai.risk * MK_RRS[mk.ai.rrIdx].m : -mk.ai.risk;
    mk.ptsP += pPts;
    mk.ptsA += aPts;

    mk.log.push({
      round: mk.round + 1,
      actualDir,
      playerDir: missed ? "missed" : mk.pick,
      playerRisk: mk.risk, playerRRIdx: mk.rrIdx,
      playerCorrect: pCorrect, playerReactionSecs: pSecs,
      playerReactedFirst: pFirst, playerPoints: pPts,
      aiDir: mk.ai.direction,
      aiRisk: mk.ai.risk, aiRRIdx: mk.ai.rrIdx,
      aiCorrect: aCorrect, aiReactionSecs: mk.ai.reactionSecs,
      aiReactedFirst: aFirst, aiPoints: aPts,
    });

    mk.phase = "resolved";
    mk.animClose = c.close;
    renderMatch();
    mk.hold = setTimeout(() => {
      if (!mk.on) return;
      mk.round++;
      if (mk.round >= mk.rounds) finishMatch();
      else { mkBeginRound(); renderMatch(); }
    }, MK_RESOLVE_HOLD);
  }

  function finishMatch() {
    const res = computeWinner(mk.ptsP, mk.ptsA, mk.bankP, mk.bankA, mk.log);
    const correct = mk.log.filter((r) => r.playerCorrect).length;
    const snap = {
      inst: mk.s.instrument,
      tfId: mk.spec.id,
      tfMin: mk.s.timeframe,
      candleDuration: mk.spec.candleDuration,
      win: mk.win,
      difficulty: mk.s.difficulty,
      totalRounds: mk.rounds,
      log: mk.log.slice(),
      ptsP: mk.ptsP, ptsA: mk.ptsA,
      bankP: mk.bankP, bankA: mk.bankA,
      winner: res.winner, reason: res.reason,
      accuracy: Math.round((correct / mk.rounds) * 100),
      avgSpeed: +(mk.log.reduce((a, r) => a + r.playerReactionSecs, 0) / mk.rounds).toFixed(1),
      at: new Date().toISOString(),
      day: genTradingDay(mk.s.instrument),
    };

    const p = store.pickaeway;
    if (res.winner === "player") p.wins = (p.wins || 0) + 1;
    else if (res.winner === "opponent") p.losses = (p.losses || 0) + 1;
    else p.draws = (p.draws || 0) + 1;
    const played = (p.wins || 0) + (p.losses || 0) + (p.draws || 0);
    // running averages over every match ever played
    p.accuracy = ((p.accuracy || 0) * (played - 1) + snap.accuracy) / played;
    p.speed = ((p.speed || 0) * (played - 1) + snap.avgSpeed) / played;
    p.rewardBalance = +((p.rewardBalance || 0) + mk.ptsP).toFixed(2);
    p.lastMatch = snap;
    save();

    mkAbort();
    state.view = "result";
    state.slideDir = 0;
    render();
  }

  /* ---------------- chart painting ---------------- */

  const MK_GREEN = "#2FE6C2";
  const MK_RED = "#FF6B3D";
  const MK_GRID = "rgba(120,150,180,.16)";

  function mkCanvasCtx(cv, cssW, cssH) {
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(Math.round(cssW * dpr), 1);
    const h = Math.max(Math.round(cssH * dpr), 1);
    if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
    const ctx = cv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    return ctx;
  }

  function mkScale(candles, top, height) {
    const ps = candles.reduce((a, c) => a.concat([c.high, c.low]), []);
    const min = Math.min.apply(null, ps);
    const max = Math.max.apply(null, ps);
    const pad = (max - min) * 0.08 || 0.5;
    const lo = min - pad, hi = max + pad, range = (hi - lo) || 1;
    return (p) => top + ((hi - p) / range) * height;
  }

  function mkDrawCandle(ctx, c, x, w, toY) {
    ctx.strokeStyle = ctx.fillStyle = c.green ? MK_GREEN : MK_RED;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, toY(c.high));
    ctx.lineTo(x, toY(c.low));
    ctx.stroke();
    const top = toY(Math.max(c.open, c.close));
    const h = Math.max(toY(Math.min(c.open, c.close)) - top, 1.5);
    ctx.fillRect(x - w / 2, top, w, h);
  }

  /* the battle chart: ~40 candles of context with the forming candle sitting
     at 82% across, so new candles walk in from the right */
  function mkPaintChart() {
    const cv = $("mkChart");
    if (!cv || !mk.tf.length) return;
    const W = cv.clientWidth || 340;
    const H = 200;
    const ctx = mkCanvasCtx(cv, W, H);
    const PAD = 10;
    const SLOT = Math.max(W / MK_HISTORY, 6);
    const CW = SLOT * 0.66;

    const end = MK_HISTORY + mk.round;
    const hist = mk.tf.slice(Math.max(0, end - (MK_HISTORY - 1)), end);
    const c = mkActive();
    const live = mk.phase === "resolved" ? c : {
      open: c.open, close: mk.animClose,
      high: Math.max(mk.animHi, c.open), low: Math.min(mk.animLo, c.open),
      green: mk.animClose >= c.open,
    };
    const toY = mkScale(hist.concat([live]), PAD, H - PAD * 2 - 12);

    ctx.strokeStyle = MK_GRID;
    ctx.lineWidth = 1;
    [0.25, 0.5, 0.75].forEach((f) => {
      const y = Math.round(PAD + f * (H - PAD * 2 - 12)) + 0.5;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    });

    const activeX = W * 0.82;
    hist.forEach((h, i) => {
      const x = activeX - (hist.length - i) * SLOT;
      if (x > -SLOT) mkDrawCandle(ctx, h, x, CW, toY);
    });

    // active slot: soft band, pulsing dashed outline and the REACT tag
    ctx.fillStyle = "rgba(47,230,194,.05)";
    ctx.fillRect(activeX - SLOT / 2, 0, SLOT, H - 12);
    mkDrawCandle(ctx, live, activeX, CW, toY);
    if (mk.phase !== "resolved") {
      const top = toY(Math.max(live.open, live.close));
      const h = Math.max(toY(Math.min(live.open, live.close)) - top, 1.5);
      const pulse = 0.45 + 0.35 * Math.abs(Math.sin(mk.elapsed * 2.6));
      ctx.save();
      ctx.setLineDash([3, 2]);
      ctx.lineWidth = 1;
      ctx.strokeStyle = `rgba(47,230,194,${pulse.toFixed(2)})`;
      ctx.strokeRect(activeX - CW / 2 - 2.5, top - 2.5, CW + 5, h + 5);
      ctx.restore();
      ctx.fillStyle = "rgba(47,230,194,.55)";
      ctx.font = "700 8px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(mk.phase === "reacting" ? "REACT" : "CLOSING", activeX, H - 3);
    }
    // your locked call rides above the candle until the round resolves
    if (mk.pick && mk.phase !== "resolved") {
      ctx.fillStyle = mk.pick === "green" ? MK_GREEN : MK_RED;
      ctx.font = "700 11px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(mk.pick === "green" ? "▲" : "▼", activeX, 12);
    }
  }

  function mkPaintClock() {
    const el = $("mkClock");
    if (!el) return;
    const left = mk.phase === "reacting"
      ? Math.max(mk.win - mk.elapsed, 0)
      : Math.max(mk.dur - mk.elapsed, 0);
    el.textContent = left.toFixed(1) + "s";
    const fill = $("mkClockFill");
    if (fill) {
      const span = mk.phase === "reacting" ? mk.win : mk.dur - mk.win;
      const done = mk.phase === "reacting" ? mk.elapsed : mk.elapsed - mk.win;
      fill.style.width = `${Math.max(0, Math.min(1, 1 - done / span)) * 100}%`;
    }
  }

  /* ---------------- match screen ---------------- */

  function mkChipRow(list, sel, attr, fmt) {
    return list.map((v, i) => `
      <button class="mk-chip ${sel === i ? "on" : ""}" data-${attr}="${i}">${fmt(v)}</button>`).join("");
  }

  function mkControlsHTML() {
    if (mk.phase === "resolved") {
      const r = mk.log[mk.log.length - 1];
      const cls = r.playerDir === "missed" ? "miss" : (r.playerCorrect ? "win" : "loss");
      const label = r.playerDir === "missed" ? "Missed"
        : (r.playerCorrect ? "Correct" : "Wrong");
      const pnl = r.playerDir === "missed" ? 0
        : (r.playerCorrect ? r.playerRisk * MK_RRS[r.playerRRIdx].m : -r.playerRisk);
      return `
        <div class="mk-resolved ${cls}">
          <div class="mk-resolved-head">${label}</div>
          <div class="mk-resolved-sub">
            Candle closed ${r.actualDir === "green" ? "green ▲" : "red ▼"} ·
            ${pnl === 0 ? "$0" : money(pnl)} · +${r.playerPoints.toFixed(2)} pts
          </div>
        </div>`;
    }
    if (mk.phase === "closing") {
      return `
        <div class="mk-waiting">
          <div class="mk-waiting-head">Candle closing</div>
          <div class="mk-waiting-sub">${mk.pick
            ? `Locked ${mk.pick === "green" ? "Green ▲" : "Red ▼"} at ${mk.lockedAt}s · ${plainMoney(mk.risk)} at ${MK_RRS[mk.rrIdx].label}`
            : "No call made — this round scores nothing and costs nothing"}</div>
        </div>`;
    }
    if (mk.pick) {
      return `
        <div class="mk-waiting locked">
          <div class="mk-waiting-head">Locked in ${mk.pick === "green" ? "Green ▲" : "Red ▼"}</div>
          <div class="mk-waiting-sub">${mk.lockedAt}s · ${plainMoney(mk.risk)} at ${MK_RRS[mk.rrIdx].label}
            · ${plainMoney(mk.risk * MK_RRS[mk.rrIdx].m)} to win</div>
        </div>`;
    }
    return `
      <div class="mk-calls">
        <button class="mk-call green" data-mkpick="green"><span>▲</span> Green</button>
        <button class="mk-call red" data-mkpick="red"><span>▼</span> Red</button>
      </div>
      <div class="bm-label">Risk</div>
      <div class="mk-row mk-row-6">${mkChipRow(MK_RISKS, MK_RISKS.indexOf(mk.risk), "mkrisk", (v) => "$" + v)}</div>
      <div class="bm-label">Risk : Reward</div>
      <div class="mk-row mk-row-4">${mkChipRow(MK_RRS, mk.rrIdx, "mkrr", (v) => v.label)}</div>`;
  }

  function mkScoreHTML() {
    return `
      <div class="mk-score">
        <div class="mk-side you">
          <div class="mk-side-cap">You</div>
          <div class="mk-side-pts">${mk.ptsP.toFixed(2)}</div>
          <div class="mk-side-bank">${mkBank(mk.bankP)}</div>
        </div>
        <div class="mk-vs">VS</div>
        <div class="mk-side opp">
          <div class="mk-side-cap">Opponent</div>
          <div class="mk-side-pts">${mk.ptsA.toFixed(2)}</div>
          <div class="mk-side-bank">${mkBank(mk.bankA)}</div>
        </div>
      </div>`;
  }

  function renderMatch() {
    if (state.view !== "match") return;
    const pickName = document.querySelector("#pickBar .pick-name");
    if (pickName) pickName.textContent = "Reward Battle";
    barTitle.textContent = "Pickæway";
    const phaseLabel = mk.phase === "reacting" ? "React now"
      : mk.phase === "closing" ? "Candle forming" : "Round result";
    cardScroll.innerHTML = `
      <div class="mk-head">
        <div class="mk-round">Round ${mk.round + 1} / ${mk.rounds}</div>
        <div class="mk-meta">${esc(mk.s.instrument)} · ${mk.s.timeframe}m · ${mk.s.difficulty.toUpperCase()}</div>
      </div>
      ${mkScoreHTML()}
      <div class="mk-chart-wrap"><canvas id="mkChart" class="mk-chart" height="200"></canvas></div>
      <div class="mk-clock-row">
        <span class="mk-phase ${mk.phase}">${phaseLabel}</span>
        <span class="mk-clock" id="mkClock">0.0s</span>
      </div>
      <div class="mk-clock-bar"><span id="mkClockFill"></span></div>
      ${mkControlsHTML()}
      ${roundTableHTML(mk.log, mk.expand)}`;
    mkPaintClock();
    mkPaintChart();
    cardFooter.style.display = "none";
  }

  /* ---------------- round history table ----------------
     Collapsed it shows the last round only; expanded, every round. Totals
     appear once there is more than one round to total. */

  function rtArrow(dir) {
    if (dir === "green") return `<span class="rt-up">▲</span>`;
    if (dir === "red") return `<span class="rt-dn">▼</span>`;
    return `<span class="rt-miss">MISS</span>`;
  }

  function roundTableHTML(log, expanded) {
    if (!log.length) return "";
    const totP = log.reduce((a, r) => a + r.playerReactionSecs, 0);
    const totA = log.reduce((a, r) => a + r.aiReactionSecs, 0);
    const totPP = log.reduce((a, r) => a + r.playerPoints, 0);
    const totAP = log.reduce((a, r) => a + r.aiPoints, 0);
    const rows = expanded ? log : log.slice(-1);
    return `
      <div class="rt">
        <button class="rt-head" data-mkexpand>
          <span class="rt-title">Round History${!expanded && log.length > 1 ? ` <em>· last round</em>` : ""}</span>
          <span class="rt-toggle">${expanded ? "Collapse" : `Show all ${log.length}`}
            <span class="rt-caret${expanded ? " up" : ""}">▾</span></span>
        </button>
        <div class="rt-body">
          <div class="rt-cols">
            <span class="rt-you">You</span><span class="rt-mid">Result</span><span class="rt-opp">Opponent</span>
          </div>
          ${rows.map((r) => {
            const miss = r.playerDir === "missed";
            const pCh = miss ? 0 : (r.playerCorrect ? r.playerRisk * MK_RRS[r.playerRRIdx].m : -r.playerRisk);
            const aCh = r.aiCorrect ? r.aiRisk * MK_RRS[r.aiRRIdx].m : -r.aiRisk;
            const pCls = miss ? "n" : (r.playerCorrect ? "g" : "r");
            const aCls = r.aiCorrect ? "g" : "r";
            const pFast = !miss && r.playerReactionSecs < r.aiReactionSecs;
            return `
            <div class="rt-row">
              <div class="rt-grid">
                <div class="rt-cell">${rtArrow(r.playerDir)}</div>
                <div class="rt-cell ${pFast ? "fast" : ""}">${r.playerReactionSecs}s${pFast ? " ⚡" : ""}</div>
                <div class="rt-cell ${pCls}">${miss ? "$0" : money(pCh)}</div>
                <div class="rt-cell ${pCls}">${miss ? "MISS" : (r.playerCorrect ? "RIGHT" : "WRONG")}</div>
                <div class="rt-cell">${rtArrow(r.actualDir)}</div>
                <div class="rt-cell ${aCls}">${r.aiCorrect ? "RIGHT" : "WRONG"}</div>
                <div class="rt-cell ${aCls}">${money(aCh)}</div>
                <div class="rt-cell ${!pFast ? "fast" : ""}">${r.aiReactionSecs}s${!pFast ? " ⚡" : ""}</div>
                <div class="rt-cell">${rtArrow(r.aiDir)}</div>
              </div>
              <div class="rt-pts">
                <span class="${r.playerPoints > 0 ? "on" : ""}">+${r.playerPoints.toFixed(2)} pts${r.playerCorrect ? ` · ${r.playerReactedFirst ? "1st" : "2nd"}` : ""}</span>
                <span class="rt-no">round ${r.round}</span>
                <span class="${r.aiPoints > 0 ? "on" : ""}">${r.aiCorrect ? `${r.aiReactedFirst ? "1st" : "2nd"} · ` : ""}+${r.aiPoints.toFixed(2)} pts</span>
              </div>
            </div>`;
          }).join("")}
          ${log.length > 1 ? `
          <div class="rt-tot">
            <span class="${totP < totA ? "on" : ""}">${totP.toFixed(1)}s${totP < totA ? " ⚡" : ""}</span>
            <span class="rt-no">Total Speed</span>
            <span class="${totA < totP ? "on" : ""}">${totA.toFixed(1)}s${totA < totP ? " ⚡" : ""}</span>
          </div>
          <div class="rt-tot big">
            <span class="${totPP >= totAP ? "on" : ""}">${totPP.toFixed(2)}</span>
            <span class="rt-no">Total Points</span>
            <span class="${totAP >= totPP ? "on" : ""}">${totAP.toFixed(2)}</span>
          </div>` : ""}
        </div>
      </div>`;
  }

  /* ---------------- match result ---------------- */

  function renderResult() {
    const m = store.pickaeway.lastMatch;
    if (!m) { openPickaeway(); return; }
    const pickName = document.querySelector("#pickBar .pick-name");
    if (pickName) pickName.textContent = "Match Result";
    barTitle.textContent = "Pickæway";
    const REASON = {
      points: "on total points", bankroll: "on bankroll",
      accuracy: "on correct calls", speed: "on reaction speed", tie: "dead level",
    };
    const head = m.winner === "player" ? "You win" : m.winner === "opponent" ? "Opponent wins" : "Draw";
    const correct = m.log.filter((r) => r.playerCorrect).length;
    cardScroll.innerHTML = `
      <div class="mk-result ${m.winner}">
        <div class="mk-result-cap">${esc(REASON[m.reason] || "")}</div>
        <div class="mk-result-head">${head}</div>
        <div class="mk-result-score">${m.ptsP.toFixed(2)} <em>–</em> ${m.ptsA.toFixed(2)}</div>
        <div class="mk-result-sub">points</div>
      </div>
      <div class="pk-row pk-row-3">
        <div class="pk-stat"><div class="pk-cap">Bankroll</div><div class="pk-val">${mkBank(m.bankP)}</div></div>
        <div class="pk-stat pk-mid"><div class="pk-cap">Accuracy</div><div class="pk-val">${correct}/${m.totalRounds}</div></div>
        <div class="pk-stat"><div class="pk-cap">Avg Speed</div><div class="pk-val">${m.avgSpeed}s</div></div>
      </div>
      <div class="bm-rule" aria-hidden="true"></div>
      <div class="bm-label">Match Overview</div>
      <div class="bm-overview">
        ${[{ v: m.inst, l: "Instrument" }, { v: `${m.tfMin}m`, l: "Time Frame" },
           { v: String(m.totalRounds), l: "Candles" }, { v: `${m.win}s`, l: "Reaction Window" },
           { v: m.difficulty.toUpperCase(), l: "Difficulty" }, { v: `${m.candleDuration}s`, l: "Per Candle" }]
          .map((o) => `
          <div class="bm-badge">
            <span class="bm-badge-box"><span class="bm-badge-val">${esc(o.v)}</span></span>
            <span class="bm-badge-lbl">${esc(o.l)}</span>
          </div>`).join("")}
      </div>
      ${roundTableHTML(m.log, state.rtExpand)}
      <button class="bm-start" data-mkreplay>Match Replay</button>
      <button class="mk-secondary" data-mkrematch>Rematch</button>
      <button class="mk-secondary" data-mkdone>Done</button>`;
    cardScroll.scrollTop = 0;
    cardFooter.style.display = "none";
  }

  /* ---------------- match replay ----------------
     The full session the match sat inside — 390 one-minute candles, rolled up
     to whichever timeframe is selected. The candles you reacted to are boxed
     and tappable; tapping one opens that round's detail inline under the
     chart. Drag the track at the right to zoom. */

  const RV_TFS = ["1m", "2m", "3m", "5m"];
  const RV_ZOOMS = [40, 30, 20, 10];
  const RV_H = 220;
  const RV_IND = 24;
  const RV_PAD = 12;
  const RV_LEAD = 10;

  const rv = { tf: "1m", zoom: 0, sel: null, day: [], snap: null, drag: null };

  function rvSlotW() {
    const wrap = $("rvScroll");
    const w = (wrap ? wrap.clientWidth : 320) || 320;
    return Math.max(w / RV_ZOOMS[rv.zoom], 8);
  }
  function rvCandles() { return mkAggregateReview(rv.day, rv.tf); }
  /* which aggregated candle each round's reaction landed in */
  function rvRoundIdxs() {
    if (!rv.snap) return [];
    const size = MK_BARS_1M[rv.tf] || 1;
    return rv.snap.log.map((_, i) => Math.floor((MK_HISTORY + i * rv.snap.tfMin) / size));
  }

  function mkPaintReplay() {
    const cv = $("rvChart");
    if (!cv) return;
    const candles = rvCandles();
    if (!candles.length) return;
    const SLOT = rvSlotW();
    const CW = SLOT * 0.62;
    const W = candles.length * SLOT + RV_LEAD * 2;
    cv.style.width = W + "px";
    const ctx = mkCanvasCtx(cv, W, RV_H);
    const drawH = RV_H - RV_PAD * 2 - RV_IND;
    const toY = mkScale(candles, RV_PAD, drawH);
    const rounds = rvRoundIdxs();

    ctx.strokeStyle = MK_GRID;
    ctx.lineWidth = 1;
    [0.25, 0.5, 0.75].forEach((f) => {
      const y = Math.round(RV_PAD + f * drawH) + 0.5;
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    });

    const size = MK_BARS_1M[rv.tf] || 1;
    ctx.font = "9px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    [[0, "9:30"], [30, "10:00"], [90, "11:00"], [150, "12:00"],
     [210, "1:00"], [270, "2:00"], [330, "3:00"], [389, "4:00"]].forEach(([min, label]) => {
      const x = Math.floor(min / size) * SLOT + SLOT / 2 + RV_LEAD;
      ctx.save();
      ctx.strokeStyle = "rgba(120,150,180,.22)";
      ctx.setLineDash([3, 4]);
      ctx.beginPath(); ctx.moveTo(x, RV_PAD); ctx.lineTo(x, RV_PAD + drawH); ctx.stroke();
      ctx.restore();
      ctx.fillStyle = "#6E86A0";
      ctx.fillText(label, x, RV_PAD + drawH + 3);
    });

    candles.forEach((c, i) => {
      const x = i * SLOT + SLOT / 2 + RV_LEAD;
      const ri = rounds.indexOf(i);
      if (ri >= 0) {
        ctx.fillStyle = rv.sel === ri ? "rgba(47,230,194,.16)" : "rgba(47,230,194,.06)";
        ctx.fillRect(i * SLOT + RV_LEAD, 0, SLOT, RV_H - RV_IND);
        ctx.strokeStyle = rv.sel === ri ? "rgba(47,230,194,.85)" : "rgba(47,230,194,.32)";
        ctx.lineWidth = 1.5;
        ctx.strokeRect(i * SLOT + RV_LEAD + 0.75, 0.75, SLOT - 1.5, RV_H - RV_IND - 1.5);
      }
      mkDrawCandle(ctx, c, x, CW, toY);
      if (ri >= 0) {
        const dir = rv.snap.log[ri].playerDir;
        ctx.fillStyle = dir === "missed" ? "#7D93AC" : dir === "green" ? MK_GREEN : MK_RED;
        ctx.font = `700 ${Math.max(SLOT * 0.5, 9).toFixed(0)}px system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(dir === "missed" ? "?" : dir === "green" ? "▲" : "▼", x, RV_H - RV_IND / 2);
      }
    });
  }

  function rvDetailHTML() {
    if (rv.sel === null || !rv.snap) {
      return `<div class="rv-hint">Tap a boxed candle to open that round · drag the track to zoom</div>`;
    }
    const r = rv.snap.log[rv.sel];
    const miss = r.playerDir === "missed";
    const pnl = miss ? 0 : (r.playerCorrect ? r.playerRisk * MK_RRS[r.playerRRIdx].m : -r.playerRisk);
    const cls = miss ? "n" : (r.playerCorrect ? "g" : "r");
    return `
      <div class="rv-detail ${cls}">
        <div class="rv-detail-head">
          <span>Round ${r.round}</span>
          <span class="rv-detail-res">${miss ? "Missed" : (r.playerCorrect ? "Right" : "Wrong")}</span>
        </div>
        <div class="rv-detail-grid">
          <div><span>Your call</span><b>${miss ? "—" : (r.playerDir === "green" ? "Green ▲" : "Red ▼")}</b></div>
          <div><span>Candle</span><b>${r.actualDir === "green" ? "Green ▲" : "Red ▼"}</b></div>
          <div><span>Risk</span><b>${miss ? "—" : plainMoney(r.playerRisk)}</b></div>
          <div><span>R:R</span><b>${miss ? "—" : MK_RRS[r.playerRRIdx].label}</b></div>
          <div><span>P&amp;L</span><b class="${cls}">${miss ? "$0" : money(pnl)}</b></div>
          <div><span>Reaction</span><b>${miss ? "—" : r.playerReactionSecs + "s"}</b></div>
          <div><span>Points</span><b>+${r.playerPoints.toFixed(2)}</b></div>
          <div><span>Order</span><b>${miss ? "—" : (r.playerReactedFirst ? "1st" : "2nd")}</b></div>
        </div>
      </div>`;
  }

  function renderReplay() {
    const m = store.pickaeway.lastMatch;
    if (!m) { openPickaeway(); return; }
    if (rv.snap !== m) { rv.snap = m; rv.day = m.day || genTradingDay(m.inst); rv.sel = null; rv.zoom = 0; }
    const pickName = document.querySelector("#pickBar .pick-name");
    if (pickName) pickName.textContent = "Match Replay";
    barTitle.textContent = "Pickæway";
    const thumbTop = (rv.zoom / (RV_ZOOMS.length - 1)) * (RV_H - 44);
    cardScroll.innerHTML = `
      <div class="mk-head">
        <div class="mk-round">${esc(m.inst)} · ${new Date(m.at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</div>
        <div class="mk-meta">${m.totalRounds} rounds · ${m.log.filter((r) => r.playerCorrect).length} correct</div>
      </div>
      <div class="mk-row mk-row-4 rv-tfs">
        ${RV_TFS.map((t) => `<button class="mk-chip ${rv.tf === t ? "on" : ""}" data-rvtf="${t}">${t.toUpperCase()}</button>`).join("")}
      </div>
      <div class="rv-stage">
        <div class="rv-scroll" id="rvScroll"><canvas id="rvChart" class="rv-chart" height="${RV_H}"></canvas></div>
        <div class="rv-zoom" id="rvZoom" title="Drag to zoom">
          <span class="rv-thumb" style="top:${thumbTop}px"></span>
        </div>
      </div>
      <div class="rv-zoom-lbl">${RV_ZOOMS[rv.zoom]} candles</div>
      ${rvDetailHTML()}
      ${roundTableHTML(m.log, state.rtExpand)}
      <button class="mk-secondary" data-mkdone>Done</button>`;
    cardScroll.scrollTop = 0;
    cardFooter.style.display = "none";
    requestAnimationFrame(() => {
      mkPaintReplay();
      wireReplay();
      rvCenterOnMatch();
    });
  }

  /* park the view over the stretch of the day the match was played on */
  function rvCenterOnMatch() {
    const el = $("rvScroll");
    if (!el || !rv.snap) return;
    const idxs = rvRoundIdxs();
    if (!idxs.length) return;
    const mid = (idxs[0] + idxs[idxs.length - 1]) / 2;
    el.scrollLeft = Math.max(0, mid * rvSlotW() + RV_LEAD - el.clientWidth / 2);
  }

  function rvSetZoom(next, anchorSlot) {
    const z = Math.max(0, Math.min(RV_ZOOMS.length - 1, next));
    if (z === rv.zoom) return;
    rv.zoom = z;
    const el = $("rvScroll");
    mkPaintReplay();
    const thumb = document.querySelector("#rvZoom .rv-thumb");
    if (thumb) thumb.style.top = `${(rv.zoom / (RV_ZOOMS.length - 1)) * (RV_H - 44)}px`;
    const lbl = document.querySelector(".rv-zoom-lbl");
    if (lbl) lbl.textContent = `${RV_ZOOMS[rv.zoom]} candles`;
    if (el && anchorSlot != null) {
      el.scrollLeft = Math.max(0, anchorSlot * rvSlotW() + RV_LEAD - el.clientWidth / 2);
    }
  }

  function wireReplay() {
    const cv = $("rvChart");
    const scroll = $("rvScroll");
    const zoom = $("rvZoom");
    if (cv) cv.addEventListener("click", (e) => {
      const rect = cv.getBoundingClientRect();
      const idx = Math.floor((e.clientX - rect.left - RV_LEAD) / rvSlotW());
      const ri = rvRoundIdxs().indexOf(idx);
      rv.sel = ri >= 0 ? (rv.sel === ri ? null : ri) : null;
      mkPaintReplay();
      const box = document.querySelector(".rv-detail, .rv-hint");
      if (box) box.outerHTML = rvDetailHTML();
    });
    if (zoom) {
      const anchor = () => {
        if (!scroll) return 0;
        return (scroll.scrollLeft + scroll.clientWidth / 2 - RV_LEAD) / rvSlotW();
      };
      zoom.addEventListener("pointerdown", (e) => {
        zoom.setPointerCapture(e.pointerId);
        rv.drag = { y: e.clientY, z: rv.zoom, a: anchor() };
      });
      zoom.addEventListener("pointermove", (e) => {
        if (!rv.drag) return;
        e.preventDefault();
        rvSetZoom(rv.drag.z + Math.round((e.clientY - rv.drag.y) / 36), rv.drag.a);
      });
      const end = () => { rv.drag = null; };
      zoom.addEventListener("pointerup", end);
      zoom.addEventListener("pointercancel", end);
    }
  }

  function openReplay() {
    if (!store.pickaeway.lastMatch) return false;
    stopAudio();
    state.view = "replay";
    state.slideDir = 0;
    closeOverlay();
    render();
    return true;
  }

  /* ---------------- profile photo ----------------
     Stored as a data: URL in the same localStorage record as everything else,
     so it survives reloads without any backend. Downscaled hard before it is
     saved — a phone photo straight off the camera would blow the ~5MB quota
     the whole store shares. */

  const PHOTO_PX = 240;

  function syncProfilePhoto() {
    const url = store.profilePhoto;
    const img = $("dockProfileImg");
    img.src = url || "assets/nav-icons/icon-user@2x.png";
    $("navProfile").classList.toggle("has-photo", !!url);
    document.querySelectorAll(".bar-icon img[data-profile-img]").forEach((el) => {
      el.src = url || "assets/nav-icons/icon-user@2x.png";
    });
  }

  function readProfilePhoto(file) {
    if (!file || !/^image\//.test(file.type)) return;
    const reader = new FileReader();
    reader.onload = () => openPhotoCrop(String(reader.result));
    reader.readAsDataURL(file);
  }

  /* ---------------- circular crop ----------------
     The picked image is laid over a square stage and can be dragged and
     zoomed; the circle drawn on top is exactly the stage inscribed, so
     saving the square and displaying it round gives what was framed.
     Scale is clamped so the image always covers the stage — pan can never
     expose a gap at the edge of the circle. */

  const CROP_STAGE = 260;      // CSS px, matches .crop-stage
  const crop = { url: "", w: 0, h: 0, base: 1, zoom: 1, x: 0, y: 0 };

  function cropScale() { return crop.base * crop.zoom; }

  /* keep the image covering the stage after any pan or zoom */
  function clampCrop() {
    const s = cropScale();
    const minX = CROP_STAGE - crop.w * s, minY = CROP_STAGE - crop.h * s;
    crop.x = Math.min(0, Math.max(minX, crop.x));
    crop.y = Math.min(0, Math.max(minY, crop.y));
  }

  function paintCrop() {
    const img = document.getElementById("cropImg");
    if (!img) return;
    const s = cropScale();
    img.style.width = `${crop.w * s}px`;
    img.style.height = `${crop.h * s}px`;
    img.style.transform = `translate(${crop.x}px, ${crop.y}px)`;
  }

  function openPhotoCrop(url) {
    const probe = new Image();
    probe.onload = () => {
      crop.url = url;
      crop.w = probe.naturalWidth;
      crop.h = probe.naturalHeight;
      crop.base = Math.max(CROP_STAGE / crop.w, CROP_STAGE / crop.h);   // cover
      crop.zoom = 1;
      // start centred
      crop.x = (CROP_STAGE - crop.w * crop.base) / 2;
      crop.y = (CROP_STAGE - crop.h * crop.base) / 2;
      openOverlay(panelHead("Position Your Photo") + `
        <div class="crop-wrap">
          <div class="crop-stage" id="cropStage">
            <img id="cropImg" src="${esc(url)}" alt="" draggable="false">
            <div class="crop-mask" aria-hidden="true"></div>
          </div>
        </div>
        <div class="crop-hint">Drag to reposition · pinch or use the slider to zoom</div>
        <input class="crop-zoom" id="cropZoom" type="range" min="1" max="3" step="0.01" value="1"
               aria-label="Zoom">
        <button class="btn-primary" data-crop-save>Use Photo</button>
        <button class="btn-secondary" data-close>Cancel</button>`);
      wireCrop();
      paintCrop();
    };
    probe.onerror = () => {
      openOverlay(panelHead("Couldn't read that file") + `
        <div class="liked-empty">That image couldn't be opened. Try a JPG or PNG.</div>
        <button class="btn-primary" data-close>OK</button>`);
    };
    probe.src = url;
  }

  function wireCrop() {
    const stage = document.getElementById("cropStage");
    const zoom = document.getElementById("cropZoom");
    if (!stage) return;
    const pts = new Map();
    let pinchStart = 0, zoomStart = 1, last = null;

    const dist = () => {
      const [a, b] = [...pts.values()];
      return Math.hypot(a.x - b.x, a.y - b.y);
    };

    stage.addEventListener("pointerdown", (e) => {
      stage.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2) { pinchStart = dist(); zoomStart = crop.zoom; }
      else last = { x: e.clientX, y: e.clientY };
      e.preventDefault();
    });

    stage.addEventListener("pointermove", (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size >= 2) {
        // pinch: zoom about the stage centre
        const ratio = dist() / (pinchStart || 1);
        const next = Math.min(3, Math.max(1, zoomStart * ratio));
        zoomAbout(next, CROP_STAGE / 2, CROP_STAGE / 2);
        zoom.value = String(next);
      } else if (last) {
        crop.x += e.clientX - last.x;
        crop.y += e.clientY - last.y;
        last = { x: e.clientX, y: e.clientY };
        clampCrop();
        paintCrop();
      }
      e.preventDefault();
    });

    const release = (e) => {
      pts.delete(e.pointerId);
      if (pts.size < 2) pinchStart = 0;
      last = pts.size === 1 ? { ...[...pts.values()][0] } : null;
    };
    stage.addEventListener("pointerup", release);
    stage.addEventListener("pointercancel", release);

    zoom.addEventListener("input", () => zoomAbout(+zoom.value, CROP_STAGE / 2, CROP_STAGE / 2));
  }

  /* zoom keeping the stage point (ax, ay) pinned, so the framing doesn't jump */
  function zoomAbout(next, ax, ay) {
    const before = cropScale();
    crop.zoom = next;
    const after = cropScale();
    crop.x = ax - (ax - crop.x) * (after / before);
    crop.y = ay - (ay - crop.y) * (after / before);
    clampCrop();
    paintCrop();
  }

  function savePhotoCrop() {
    const img = document.getElementById("cropImg");
    if (!img) return;
    const s = cropScale();
    const cv = document.createElement("canvas");
    cv.width = cv.height = PHOTO_PX;
    const ctx = cv.getContext("2d");
    // the stage maps back to this square of the source image
    const sx = -crop.x / s, sy = -crop.y / s, side = CROP_STAGE / s;
    ctx.drawImage(img, sx, sy, side, side, 0, 0, PHOTO_PX, PHOTO_PX);
    try {
      store.profilePhoto = cv.toDataURL("image/jpeg", 0.82);
      save();
      syncProfilePhoto();
      closeOverlay();
      // both screens paint the photo themselves and need it repainted
      if (state.view === "pickaeway" || state.view === "profile") render();
    } catch (e) {
      // quota is the realistic failure here — the store is shared
      openOverlay(panelHead("Couldn't save") + `
        <div class="liked-empty">There wasn't room to store that photo. Try a smaller image.</div>
        <button class="btn-primary" data-close>OK</button>`);
    }
  }

  /* ==================== Gameæway ====================
     The hub in front of the two games. Pickæway is the reactive candlestick
     battle that was already here; Pointæway is the card game below. The dock's
     battle slot lands here rather than in either game. */

  const GAMES = [
    { id: "pickaeway", name: "Pickæway", tag: "1v1 Reactive Battle",
      blurb: "Read the candles as they print and call the next move before your opponent does.",
      icon: "assets/nav-icons/icon-match-replay@2x.png" },
    { id: "pointaeway", name: "Pointæway", tag: "1v1 Card Game",
      blurb: "Bull against Bear. Play a candle, reveal together, and push the print 25 points your way.",
      icon: "assets/nav-icons/icon-knowledge-test-lightning@2x.png" },
  ];

  function renderGames() {
    barTitle.textContent = "Gameæway";
    const pickName = document.querySelector("#pickBar .pick-name");
    if (pickName) pickName.textContent = "Cool Down Game";
    cardScroll.innerHTML = `
      <div class="gs-head">Pick your game</div>
      <div class="gs-list">
        ${GAMES.map((g) => `
          <button class="gs-card" data-game="${g.id}">
            <span class="gs-icon"><img src="${esc(g.icon)}" alt=""></span>
            <span class="gs-text">
              <span class="gs-name">${esc(g.name)}</span>
              <span class="gs-tag">${esc(g.tag)}</span>
              <span class="gs-blurb">${esc(g.blurb)}</span>
            </span>
          </button>`).join("")}
      </div>`;
    cardScroll.scrollTop = 0;
    cardFooter.style.display = "none";
  }

  function openGames() {
    stopAudio();
    state.view = "games";
    state.slideDir = 0;
    closeOverlay();
    render();
  }

  /* ==================== Pointæway ====================
     A 1v1 card game, ported from the reference prototype. Bull and Bear each
     hold a deck of candlestick-strength cards; both play one card a round and
     reveal together. The stronger card takes the round and drags a shared
     candle — a track from -25 to +25 — that many points its way. First side to
     the end of the track wins.

     The port keeps three things from the reference deliberately, each of which
     was a bug there once:

       - resolveRound() is pure. It reads the two cards and the candle and
         returns a description of what should happen; pwApplyResult() is the
         only thing that changes state. Keeping the two apart is what makes the
         round logic testable at all.
       - pwApplyResult() draws against local copies of the decks ("bags") and
         commits once at the end. The reference hit a bug where multi-card
         effects — FOMO drawing two, a hand refilling — read stale
         deck state between draws and handed out the same card repeatedly.
         Vanilla JS would not batch the way React did, but the pattern is worth
         keeping: one commit means one place where the decks can go wrong.
       - A special card's own fields never share a name with the engine's. The
         reference briefly spread these objects in an order that let a card's
         own classification overwrite the engine's `kind`, which silently broke
         every special in the deck; the card's own is `effect`. */

  /* The two decks are not recolours of each other. The same candle means
     different things depending on which way the market is read, so each side
     has its own names — and two shapes appear on both sides at opposite
     values: small body high with a long lower wick is the bull's 4-point
     Hammer and the bear's 1-point Hanging Man; small body low with a long
     upper wick is the bull's 1-point Inverted Hammer and the bear's 4-point
     Shooting Star. Name, shape and points therefore have to be looked up
     together, per side — there is no shared shape-to-points mapping. */
  const PW_TIERS_BY_SIDE = {
    bull: [
      { type: "Bullish Marubozu",     pts: 5, body: 0.92, up: 0.02, down: 0.02 },
      { type: "Hammer",               pts: 4, body: 0.28, up: 0.06, down: 0.58 },
      { type: "Standard",             pts: 3, body: 0.46, up: 0.22, down: 0.22 },
      { type: "Bullish Spinning Top", pts: 2, body: 0.18, up: 0.36, down: 0.36 },
      { type: "Inverted Hammer",      pts: 1, body: 0.28, up: 0.58, down: 0.06 },
    ],
    bear: [
      { type: "Bearish Marubozu",     pts: 5, body: 0.92, up: 0.02, down: 0.02 },
      { type: "Shooting Star",        pts: 4, body: 0.28, up: 0.58, down: 0.06 },
      { type: "Standard",             pts: 3, body: 0.46, up: 0.22, down: 0.22 },
      { type: "Bearish Spinning Top", pts: 2, body: 0.18, up: 0.36, down: 0.36 },
      { type: "Hanging Man",          pts: 1, body: 0.28, up: 0.06, down: 0.58 },
    ],
  };
  const pwTiers = (side) => PW_TIERS_BY_SIDE[side] || PW_TIERS_BY_SIDE.bull;

  /* The ten wilds, v1. `effect` is what the engine switches on; `cls` is only
     what the card shows. Three of them read the opponent's revealed card and
     score off it — Stop Loss at its value, Momentum at double, Market News
     doubling whatever wins — so they are resolved with both cards in hand
     rather than as standalone effects. Discipline is not resolved here at all:
     it is a peek, and the card that scores is the one chosen after it. */
  const PW_SPECIALS = [
    { type: "Volatility Spike", cls: "A", effect: "zero", keepsOther: true,
      desc: "The candle snaps back to 0. Nobody scores." },
    { type: "Canceled Order",   cls: "A", effect: "cancel",
      desc: "Cancels their card — but scores nothing itself. Total wash, both discarded." },
    { type: "Liquidated",       cls: "A", effect: "liquidate", swing: 5,
      desc: "Destroys their card. You take the round, +5 your way." },
    { type: "FOMO",             cls: "A", effect: "fomo", extra: 2, keepsOther: true,
      desc: "Draw 2 more cards from your deck. The round is a wash." },
    { type: "Stop Loss",        cls: "A", effect: "absorb", mult: 1,
      desc: "Their card scores for YOU instead, at its own value. Their attack, your protection." },
    { type: "Market News",      cls: "A", effect: "double",
      desc: "Doubles the value of whatever wins the round." },
    { type: "Reversal",         cls: "A", effect: "flip", keepsOther: true,
      desc: "Flips the candle to the same distance the other side of 0." },
    { type: "Take Profit",      cls: "A", effect: "absorb", mult: 1, doubleUp: true,
      desc: "Take their profit: their card scores for YOU at its value. Hold its match and you can double it." },
    { type: "Momentum",         cls: "A", effect: "absorb", mult: 2,
      desc: "Their card scores DOUBLE for YOU instead of its value for them." },
    { type: "Discipline",       cls: "D", effect: "peek",
      desc: "See their card first, then pick a numbered card from your hand to answer it." },
  ];

  const PW_CLASS_A = PW_SPECIALS.filter((s) => s.cls === "A").map((s) => s.type);
  const PW_SPEC = {};
  PW_SPECIALS.forEach((s) => { PW_SPEC[s.type] = s; });
  const PW_HAND_SIZE = 6;
  const PW_TIER_COPIES = 5;      // per tier, per side
  const PW_TARGET = 25;
  const PW_REVEAL_MS = 700;
  /* One full turn of the random side picker. Two faces per turn, so a face is
     up for 160ms — well inside the spread of a human reaction, which is why
     stopping on the side you want is not something you can do on purpose. */
  const PW_SPIN_MS = 320;
  /* And how long the frozen card stays up before the match starts. Short
     enough to read as immediate, long enough to actually see what you drew —
     with no beat at all you would land in the match not knowing why. */
  const PW_SPIN_SETTLE_MS = 700;

  let pwUid = 0;
  const pwId = () => `pw${pwUid++}`;

  /* the whole game, in one place, so leaving the screen can drop it cleanly */
  let pw = null;
  let pwTimer = null;
  let pwSpinRaf = null;

  function pwBuildTierDeck(side) {
    const cards = [];
    pwTiers(side).forEach((t) => {
      for (let i = 0; i < PW_TIER_COPIES; i++) {
        cards.push({ id: pwId(), side, kind: "tier", type: t.type, pts: t.pts, visual: t });
      }
    });
    return cards;
  }
  /* the engine's own `kind` is written last on purpose — see the note above */
  function pwBuildSpecialDeck() {
    return PW_SPECIALS.map((s) => Object.assign({}, s, { id: pwId(), side: "special", kind: "special" }));
  }

  function pwShuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  const pwSign = (side) => (side === "bull" ? 1 : -1);
  const pwClamp = (v) => Math.max(-PW_TARGET, Math.min(PW_TARGET, v));
  const pwSigned = (n) => (n > 0 ? `+${n}` : String(n));
  // keyed by the tier names of one side, since the two decks no longer share any
  function pwEmptyCounts(side) {
    const c = {};
    pwTiers(side).forEach((t) => { c[t.type] = 0; });
    return c;
  }
  /* What a card is worth in a plain comparison. Nothing alters the other
     card's value any more — Fear was the only card that did, and Take Profit
     replaced it. */
  function pwEffPts(card) {
    return card.pts;
  }

  /* ---- the pure part: what the round does, without doing any of it ---- */
  function pwResolveRound(pCard, aCard, playerSide, aiSide, candle) {
    const log = [];
    const r = {
      candleDelta: 0, outcome: "wash",
      pDrawOwn: 1, aDrawOwn: 1, pExtraOwn: 0, aExtraOwn: 0,
      pReturnCard: false, aReturnCard: false,
      pDiscard: false, aDiscard: false,
      loserNeedsChoice: null, log,
    };

    const pIsA = pCard.kind === "special" && PW_CLASS_A.indexOf(pCard.type) >= 0;
    const aIsA = aCard.kind === "special" && PW_CLASS_A.indexOf(aCard.type) >= 0;

    /* Discipline never reaches here as a played card — it is a peek, and the
       card chosen after it is what arrives. The one exception is both players
       playing it at once, which cancels out: neither gets to answer the other. */
    if (pCard.type === "Discipline" && aCard.type === "Discipline") {
      r.outcome = "wash";
      r.pDiscard = true;
      r.aDiscard = true;
      log.push("Both hold their discipline — neither commits. The round is a wash.");
      return r;
    }

    /* What one Class-A does, given the card it was played against. Three of
       them score off that card, so the opponent's card is an input here rather
       than something resolved separately. Returns the candle delta from the
       owner's point of view plus who, if anyone, took the round. */
    function classAEffect(card, owner, ownerSide, otherCard, otherSide) {
      const spec = PW_SPEC[card.type] || {};
      const otherPts = otherCard && otherCard.kind === "tier" ? otherCard.pts : null;
      switch (spec.effect) {
        case "zero":
          return { delta: -candle, extra: 0, outcome: "wash" };
        case "flip":
          return { delta: -2 * candle, extra: 0, outcome: "wash" };
        case "fomo":
          return { delta: 0, extra: spec.extra, outcome: "wash" };
        case "cancel":
          // voids their card and scores nothing of its own: a total wash
          return { delta: 0, extra: 0, outcome: "wash" };
        case "liquidate":
          return { delta: pwSign(ownerSide) * spec.swing, extra: 0, outcome: owner };
        case "absorb":
          /* Stop Loss at face value, Momentum at double: their numbered card
             scores in the owner's direction instead of their own. Against
             anything without a number there is nothing to absorb. */
          if (otherPts == null) return { delta: 0, extra: 0, outcome: "wash" };
          return { delta: pwSign(ownerSide) * otherPts * spec.mult, extra: 0, outcome: owner };
        case "double": {
          /* Market News doubles whatever wins the round. It carries no value of
             its own, so the other card is what wins — at twice its worth. */
          if (otherPts == null) return { delta: 0, extra: 0, outcome: "wash" };
          const them = owner === "player" ? "ai" : "player";
          return { delta: pwSign(otherSide) * otherPts * 2, extra: 0, outcome: them };
        }
        default:
          return { delta: 0, extra: 0, outcome: "wash" };
      }
    }

    // one Class-A special against the other player's card
    function oneClassA(card, owner, ownerSide, otherCard, otherSide) {
      const eff = classAEffect(card, owner, ownerSide, otherCard, otherSide);
      const spec = PW_SPEC[card.type] || {};
      log.push(`${owner === "player" ? "You play" : "Opponent plays"} ${card.type} — ${card.desc}`);
      r.candleDelta = eff.delta;
      r.outcome = eff.outcome;
      if (owner === "player") r.pExtraOwn = eff.extra; else r.aExtraOwn = eff.extra;

      /* Only the effects that leave the other card alone give it back. A card
         that was destroyed, cancelled or scored off has been spent. */
      if (spec.keepsOther && otherCard.kind === "tier") {
        if (owner === "player") r.aReturnCard = true; else r.pReturnCard = true;
      }
      // whoever lost the round replaces their card from a pile of their choosing
      if (eff.outcome === "player") { r.aDrawOwn = 0; r.loserNeedsChoice = "ai"; }
      else if (eff.outcome === "ai") { r.pDrawOwn = 0; r.loserNeedsChoice = "player"; }
      return r;
    }

    if (pIsA && !aIsA) return oneClassA(pCard, "player", playerSide, aCard, aiSide);
    if (aIsA && !pIsA) return oneClassA(aCard, "ai", aiSide, pCard, playerSide);

    /* Both played a Class-A. Neither has a number for the other to read, so
       any effect that scores off the opponent's card finds nothing; what is
       left is the candle effects, which stack. */
    if (pIsA && aIsA) {
      const e1 = classAEffect(pCard, "player", playerSide, aCard, aiSide);
      const e2 = classAEffect(aCard, "ai", aiSide, pCard, playerSide);
      r.candleDelta = e1.delta + e2.delta;
      r.pExtraOwn = e1.extra; r.aExtraOwn = e2.extra;
      r.outcome = "wash";
      log.push(`You play ${pCard.type} — ${pCard.desc}`);
      log.push(`Opponent plays ${aCard.type} — ${aCard.desc}`);
      return r;
    }

    // plain comparison
    const pPts = pwEffPts(pCard);
    const aPts = pwEffPts(aCard);
    const pLabel = `${pCard.type} (${pPts})`;
    const aLabel = `${aCard.type} (${aPts})`;

    if (pPts === aPts) {
      /* Equal points is a wash and both cards are spent — discarded outright,
         not returned to a hand and not put back under either deck. Any equal
         total ties, whether or not the two cards share a name. */
      r.outcome = "wash";
      r.pDiscard = true;
      r.aDiscard = true;
      log.push(`You play ${pLabel}, opponent plays ${aLabel} — a wash. Both cards are discarded.`);
    } else if (pPts > aPts) {
      r.outcome = "player";
      r.candleDelta = pwSign(playerSide) * pPts;
      r.loserNeedsChoice = "ai";
      log.push(`You play ${pLabel}, opponent plays ${aLabel} — you win the round, ${pwSigned(r.candleDelta)}.`);
    } else {
      r.outcome = "ai";
      r.candleDelta = pwSign(aiSide) * aPts;
      r.loserNeedsChoice = "player";
      log.push(`Opponent plays ${aLabel}, you play ${pLabel} — opponent wins the round, ${pwSigned(r.candleDelta)}.`);
    }
    return r;
  }

  /* ---- the AI ---- */
  function pwAiChooseCard(hand) {
    const specials = hand.filter((c) => c.kind === "special");
    const behind = pwSign(pw.aiSide) * pw.candle < -6;
    if (specials.length && (behind || Math.random() < 0.2)) {
      return specials[Math.floor(Math.random() * specials.length)];
    }
    const normals = hand.filter((c) => c.kind === "tier");
    const pool = normals.length ? normals : hand;
    if (Math.random() < 0.4) {
      return pool.reduce((best, c) => (c.pts > best.pts ? c : best), pool[0]);
    }
    return pool[Math.floor(Math.random() * pool.length)];
  }
  /* A card in hand that matches the one just revealed. The spec asks for the
     same tier NAME and the same point value — but the two decks stopped
     sharing names when the tiers were split per side, so a name match can only
     ever be Standard against Standard and the option would almost never
     appear. Matching on value keeps the rule playable and means the same
     thing: equal points is the equal rank. Tighten `pwCardsMatch` to compare
     type as well if the literal reading is wanted. */
  function pwCardsMatch(a, b) {
    return a.kind === "tier" && b.kind === "tier" && a.pts === b.pts;
  }
  function pwTakeProfitMatch(hand, theirCard) {
    if (!theirCard || theirCard.kind !== "tier") return null;
    return hand.find((c) => pwCardsMatch(c, theirCard)) || null;
  }

  /* Cheapest card that beats what the peek showed, else the weakest held. */
  function pwAiAnswerPeek(playerCard) {
    const numbered = pw.aiHand.filter((c) => c.kind === "tier");
    if (!numbered.length) return null;
    const target = playerCard.kind === "tier" ? playerCard.pts : 0;
    const winners = numbered.filter((c) => c.pts > target).sort((x, y) => x.pts - y.pts);
    if (winners.length) return winners[0];
    return numbered.slice().sort((x, y) => x.pts - y.pts)[0];
  }

  function pwAiDrawSource(specialCount) {
    if (specialCount === 0) return "own";
    const behind = pwSign(pw.aiSide) * pw.candle < -3;
    return behind || Math.random() < 0.35 ? "special" : "own";
  }

  /* ---- state ---- */
  function pwNewGame() {
    return {
      phase: "setup", playerSide: null, aiSide: null, candle: 0,
      bull: [], bear: [], special: [],
      playerHand: [], aiHand: [], playerPlayed: null, aiPlayed: null,
      round: 1, log: [], winner: null, pendingCandle: 0, pending: null,
      showLegend: false, seen: {},
      discipline: null,     // a peek in progress: the Discipline card and theirs
      tp: null,             // a Take Profit waiting on the double-up answer
      aiDoubledUp: null,    // the card the AI spent doubling its own Take Profit
      flipped: {},          // wild card ids currently showing their effect text
      flipAnim: null,       // the one card that just turned, for a single render
      showSeen: false,      // the opponent's per-tier breakdown, on demand
      spin: null,           // the random side picker, while it is turning
    };
  }

  function pwStart(side) {
    const other = side === "bull" ? "bear" : "bull";
    const bull = pwShuffle(pwBuildTierDeck("bull"));
    const bear = pwShuffle(pwBuildTierDeck("bear"));
    const special = pwShuffle(pwBuildSpecialDeck());
    const mine = side === "bull" ? bull : bear;
    const theirs = side === "bull" ? bear : bull;
    Object.assign(pw, pwNewGame(), {
      playerSide: side, aiSide: other,
      bull, bear, special,
      playerHand: mine.splice(0, PW_HAND_SIZE),
      aiHand: theirs.splice(0, PW_HAND_SIZE),
      seen: pwEmptyCounts(other),      // the opponent's tiers, by their own names
      log: [`Sides set — you are ${side === "bull" ? "Bull" : "Bear"}. Decks shuffled. Opening print: 0.`],
      phase: "selecting",
    });
    renderPointaeway();
  }

  /* ---- picking a side at random ----

     One card turning on its Y axis, Bull on one face and Bear on the other, so
     the side that is up is a fact about the rotation rather than a thing we
     decide separately and then animate. That matters: STOP is specified to
     take whichever side is showing at that instant, and the only way to keep
     that promise is for the two to be the same number. So the angle is a pure
     function of elapsed time, the frame loop spends it on `transform`, and
     STOP reads it back from the same function — never from the DOM, which
     could be a frame behind, and never from a fresh coin toss, which would be
     a different answer than the one on screen.

     Deliberately not a CSS animation: reading an in-flight animation's angle
     back out means parsing a computed matrix, and a paused or reduced-motion
     animation would leave STOP freezing on a card that was never turning. */

  const pwSpinFace = (deg) => (Math.cos((deg * Math.PI) / 180) >= 0 ? "bull" : "bear");

  function pwSpinAngle() {
    const s = pw.spin;
    if (!s) return 0;
    return s.a0 + ((performance.now() - s.t0) / PW_SPIN_MS) * 360;
  }

  function pwSpinCancel() {
    if (pwSpinRaf != null) { cancelAnimationFrame(pwSpinRaf); pwSpinRaf = null; }
  }

  function pwSpinTick() {
    pwSpinRaf = requestAnimationFrame(pwSpinTick);
    /* looked up every frame rather than held: any re-render of the setup screen
       (opening the wild card legend, say) replaces the node, and a held
       reference would go on turning a card that is no longer on the page */
    const el = document.getElementById("pwFlipper");
    if (!el || !pw || !pw.spin || pw.spin.stopped) { pwSpinCancel(); return; }
    el.style.transform = `rotateY(${pwSpinAngle().toFixed(2)}deg)`;
  }

  function pwSpinStart() {
    if (!pw || pw.phase !== "setup" || pw.spin) return;
    // a random starting angle so the first face up is not always Bull
    pw.spin = { t0: performance.now(), a0: Math.random() * 360, stopped: false, side: null };
    renderPointaeway();
    pwSpinTick();
  }

  function pwSpinStop() {
    if (!pw || !pw.spin || pw.spin.stopped) return;
    const side = pwSpinFace(pwSpinAngle());
    pwSpinCancel();
    pw.spin.stopped = true;
    pw.spin.side = side;
    renderPointaeway();
    // through pwTimer so that leaving the screen mid-settle cancels it
    pwTimer = setTimeout(() => { pwTimer = null; pwStart(side); }, PW_SPIN_SETTLE_MS);
  }

  const pwOwnDeck = (side) => (side === "bull" ? pw.bull : pw.bear);

  function pwPlay(cardId) {
    if (pw.phase !== "selecting") return;
    const card = pw.playerHand.find((c) => c.id === cardId);
    if (!card) return;
    let aCard = pwAiChooseCard(pw.aiHand);
    pw.playerHand = pw.playerHand.filter((c) => c.id !== card.id);
    pw.aiHand = pw.aiHand.filter((c) => c.id !== aCard.id);
    /* The AI's Discipline resolves here and now: the player's card is already
       chosen, so the peek has nothing to wait for. It answers with the cheapest
       card that beats what it sees, and with its weakest if nothing does —
       spending no more than the round is worth. */
    /* The AI's Take Profit doubles itself when it can: more points its way is
       a straight gain, and the card it spends was going to be spent anyway. */
    if (aCard.type === "Take Profit") {
      const m = pwTakeProfitMatch(pw.aiHand, card);
      if (m) {
        pw.aiHand = pw.aiHand.filter((c) => c.id !== m.id);
        pw.aiDoubledUp = m;
      }
    }
    if (aCard.type === "Discipline") {
      const answer = pwAiAnswerPeek(card);
      if (answer) {
        pw.aiHand = pw.aiHand.filter((c) => c.id !== answer.id);
        pw.log = [`Opponent plays Discipline, reads your card, and answers with ${answer.type}.`].concat(pw.log);
        aCard = answer;
      } else {
        pw.log = ["Opponent plays Discipline but holds nothing numbered to answer with."].concat(pw.log);
      }
    }
    pw.playerPlayed = card;
    pw.aiPlayed = aCard;
    /* Discipline is a peek, not a play. Their card is revealed now and the
       real answer is chosen against it — which means this one case genuinely
       breaks simultaneous reveal, deliberately. */
    if (card.type === "Discipline") {
      pw.playerPlayed = null;          // Discipline itself never reaches the table
      pw.aiPlayed = aCard;
      pw.discipline = { card, aCard };
      if (!pw.playerHand.some((c) => c.kind === "tier")) {
        // nothing numbered left to answer with: the peek is spent for nothing
        pw.log = ["You play Discipline, but hold no numbered card to answer with — the round is a wash."].concat(pw.log);
        pw.discipline = null;
        pw.phase = "resolving";
        renderPointaeway();
        pwTimer = setTimeout(() => {
          pwTimer = null;
          pwApplyResult(pwDisciplineWash(card, aCard), card, aCard);
        }, PW_REVEAL_MS);
        return;
      }
      pw.phase = "discipline-pick";
      renderPointaeway();
      return;
    }

    pw.phase = "resolving";
    /* The round is decided the moment both cards are down; the delay is only
       so the reveal can be seen. Holding the outcome here rather than in the
       timer's closure means leaving the screen mid-reveal can still settle the
       round instead of stranding the match in "resolving" with nothing
       clickable on it. */
    pw.pending = { result: pwResolveRound(card, aCard, pw.playerSide, pw.aiSide, pw.candle), card, aCard };
    renderPointaeway();
    pwTimer = setTimeout(() => { pwTimer = null; pwCommitPending(false); }, PW_REVEAL_MS);
  }

  /* A Discipline that cannot be answered: both cards are spent, nobody scores. */
  function pwDisciplineWash(pCard, aCard) {
    return {
      candleDelta: 0, outcome: "wash",
      pDrawOwn: 1, aDrawOwn: 1, pExtraOwn: 0, aExtraOwn: 0,
      pReturnCard: false, aReturnCard: false,
      pDiscard: true, aDiscard: true,
      loserNeedsChoice: null, log: [],
    };
  }

  /* The answer to a peeked card. Discipline is discarded and the chosen card is
     what actually plays, resolved as any normal round would be. */
  function pwDisciplineAnswer(cardId) {
    if (pw.phase !== "discipline-pick" || !pw.discipline) return;
    const card = pw.playerHand.find((c) => c.id === cardId);
    if (!card || card.kind !== "tier") return;      // wilds cannot answer a peek
    const { aCard } = pw.discipline;
    pw.discipline = null;
    pw.playerHand = pw.playerHand.filter((c) => c.id !== card.id);
    pw.playerPlayed = card;
    pw.phase = "resolving";
    pw.pending = { result: pwResolveRound(card, aCard, pw.playerSide, pw.aiSide, pw.candle), card, aCard };
    renderPointaeway();
    pwTimer = setTimeout(() => { pwTimer = null; pwCommitPending(false); }, PW_REVEAL_MS);
  }

  function pwCommitPending(silent) {
    if (!pw || !pw.pending) return;
    const { result, card, aCard } = pw.pending;
    pw.pending = null;

    // the AI's double-up was decided when it played; fold it in now
    if (pw.aiDoubledUp) {
      result.candleDelta *= 2;
      pw.log = [`Opponent doubles up with a matching ${pw.aiDoubledUp.type}.`].concat(pw.log);
      pw.aiDoubledUp = null;
    }

    /* The player's Take Profit stops here to ask. Leaving the screen settles
       the round instead, which passes — the safe half of the choice, since it
       keeps the card in hand. */
    if (card.type === "Take Profit" && !silent) {
      const match = pwTakeProfitMatch(pw.playerHand, aCard);
      if (match) {
        pw.tp = { result, card, aCard, match };
        pw.phase = "takeprofit-choice";
        renderPointaeway();
        return;
      }
    }
    pwApplyResult(result, card, aCard, silent);
  }

  function pwTakeProfitChoose(doubleUp) {
    if (pw.phase !== "takeprofit-choice" || !pw.tp) return;
    const { result, card, aCard, match } = pw.tp;
    pw.tp = null;
    if (doubleUp) {
      result.candleDelta *= 2;
      // the matching card is spent: discarded, not returned and not recycled
      pw.playerHand = pw.playerHand.filter((c) => c.id !== match.id);
      pw.log = [`You double up with your matching ${match.type} — ${pwSigned(result.candleDelta)}.`].concat(pw.log);
    } else {
      pw.log = ["You pass on doubling up — your matching card stays in hand."].concat(pw.log);
    }
    pw.phase = "resolving";
    pwApplyResult(result, card, aCard, false);
  }

  /* Local bags, one commit. Everything that draws does so against these
     copies; pw's own decks are only replaced once, at the end. */
  function pwApplyResult(result, pCard, aCard, silent) {
    const newCandle = pwClamp(pw.candle + result.candleDelta);
    pw.log = result.log.concat(pw.log);

    /* An opponent tier card, once seen, is known for the rest of the match —
       but only five of each exist, so the tally stops there. A card can still
       be revealed more than once: a Class-A wash hands the untouched card back
       to its owner's hand to be played again. Counting those repeats is what
       pushed the tally past five into 6/5 and 7/5. Past five the tier is fully
       accounted for and another reveal carries no new information. */
    if (aCard.kind === "tier") {
      pw.seen[aCard.type] = Math.min(PW_TIER_COPIES, (pw.seen[aCard.type] || 0) + 1);
    }

    const bags = { bull: pw.bull.slice(), bear: pw.bear.slice(), special: pw.special.slice() };
    const draw = (source, side) => {
      const deck = bags[source === "special" ? "special" : side];
      return deck && deck.length ? deck.shift() : null;
    };

    let pHand = pw.playerHand.slice();
    let aHand = pw.aiHand.slice();

    if (result.pReturnCard) pHand.push(pCard);
    if (result.aReturnCard) aHand.push(aCard);
    /* Discarded cards leave play. They were already out of their owner's hand
       when they were played, so there is nothing to do but not put them back —
       which is exactly what a tie now means. */

    for (let i = 0; i < result.aExtraOwn; i++) { const c = draw("own", pw.aiSide); if (c) aHand.push(c); }
    for (let i = 0; i < result.pExtraOwn; i++) { const c = draw("own", pw.playerSide); if (c) pHand.push(c); }

    // the winner's replacement is automatic; the loser gets the choice
    if (result.loserNeedsChoice !== "ai" && result.aDrawOwn > 0) {
      const c = draw("own", pw.aiSide); if (c) aHand.push(c);
    }
    if (result.loserNeedsChoice === "ai") {
      const src = pwAiDrawSource(bags.special.length);
      const c = draw(src, pw.aiSide);
      if (c) {
        aHand.push(c);
        pw.log = [`Opponent draws from ${src === "special" ? "the wild pile" : "their own deck"}.`].concat(pw.log);
      }
    }

    /* Nothing to choose between when both piles are empty: skip the screen and
       let the round finish with no replacement drawn, which is what either
       button would have done. The depletion check downstream is unchanged. */
    const nothingToDraw = bags[pw.playerSide].length === 0 && bags.special.length === 0;
    if (result.loserNeedsChoice === "player" && !nothingToDraw) {
      // commit what is settled and stop for the player's choice of pile
      pw.candle = newCandle;
      pw.bull = bags.bull; pw.bear = bags.bear; pw.special = bags.special;
      pw.playerHand = pHand; pw.aiHand = aHand;
      pw.pendingCandle = newCandle;
      pw.phase = "draw-choice";
      if (!silent) renderPointaeway();
      return;
    }

    if (result.pDrawOwn > 0) { const c = draw("own", pw.playerSide); if (c) pHand.push(c); }

    pw.candle = newCandle;
    pw.bull = bags.bull; pw.bear = bags.bear; pw.special = bags.special;
    pw.playerHand = pHand; pw.aiHand = aHand;
    pwFinishRound(newCandle, silent);
  }

  function pwChooseDraw(source) {
    if (pw.phase !== "draw-choice") return;
    const bags = { bull: pw.bull.slice(), bear: pw.bear.slice(), special: pw.special.slice() };
    const deck = bags[source === "special" ? "special" : pw.playerSide];
    const c = deck && deck.length ? deck.shift() : null;
    if (c) {
      pw.playerHand = pw.playerHand.concat([c]);
      pw.log = [`You draw from ${source === "special" ? "the wild pile" : "your own deck"}.`].concat(pw.log);
    } else {
      pw.log = ["Nothing left in that pile."].concat(pw.log);
    }
    pw.bull = bags.bull; pw.bear = bags.bear; pw.special = bags.special;
    pwFinishRound(pw.pendingCandle);
  }

  /* Win checks, in the documented order: the track first, then depletion —
     which looks only at a player's hand and their OWN deck, never the wild
     pile. An exact 0 at depletion is a Doji, and a draw. */
  function pwFinishRound(finalCandle, silent) {
    const done = (w) => { pw.winner = w; pw.phase = "gameover"; if (!silent) renderPointaeway(); };
    if (finalCandle >= PW_TARGET) return done("bull");
    if (finalCandle <= -PW_TARGET) return done("bear");
    const playerOut = pw.playerHand.length === 0 && pwOwnDeck(pw.playerSide).length === 0;
    const aiOut = pw.aiHand.length === 0 && pwOwnDeck(pw.aiSide).length === 0;
    if (playerOut || aiOut) return done(finalCandle === 0 ? "draw" : finalCandle > 0 ? "bull" : "bear");
    /* The played cards stay where they are — win, loss or wash alike. They are
       the round that just happened, and clearing them the instant it resolves
       leaves nothing to read in the gap before the next one. The next play
       replaces them. */
    pw.round++;
    pw.phase = "selecting";
    if (!silent) renderPointaeway();
  }

  /* Leaving the screen stops the reveal timer, but the round it was waiting on
     is already decided — so settle it rather than drop it, or coming back would
     find the match stuck in "resolving" with nothing on it to click. */
  function pwAbort() {
    if (pwTimer) { clearTimeout(pwTimer); pwTimer = null; }
    /* a side picker left turning is dropped, not settled: nothing has been
       chosen yet, and a frame loop repainting a screen nobody is on is exactly
       what this function exists to stop */
    pwSpinCancel();
    if (pw && pw.spin) pw.spin = null;
    pwCommitPending(true);
  }

  /* ---- drawing ---- */

  /* The icon is the tier's real shape: body and wick lengths come straight
     from the tier data, so a Hammer reads as a hammer at 30px. */
  function pwCandleSvg(visual, side, size) {
    const cls = side === "bull" ? "pw-c-bull" : side === "bear" ? "pw-c-bear" : "pw-c-wild";
    if (!visual) {
      return `<svg class="${cls}" width="${size}" height="${size}" viewBox="0 0 40 40" aria-hidden="true">
        <polyline points="4,24 12,10 18,28 24,6 30,22 36,14" fill="none"
          stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    }
    const h = size, w = size * 0.42, cx = size / 2;
    const bodyH = Math.max(2, visual.body * h * 0.9);
    const upH = visual.up * h * 0.9;
    const downH = visual.down * h * 0.9;
    const top = (h - bodyH) / 2;
    return `<svg class="${cls}" width="${size}" height="${h}" aria-hidden="true">
      <line x1="${cx}" y1="${top - upH}" x2="${cx}" y2="${top}" stroke="currentColor" stroke-width="2"/>
      <line x1="${cx}" y1="${top + bodyH}" x2="${cx}" y2="${top + bodyH + downH}" stroke="currentColor" stroke-width="2"/>
      <rect x="${cx - w / 2}" y="${top}" width="${w}" height="${bodyH}" fill="currentColor" rx="1.5"/></svg>`;
  }

  /* How many of that tier the player still holds anywhere they can reach it —
     deck plus hand, the card itself included. Five exist; play two and never
     get them back and this reads 3. Counting both places rather than tracking
     "played" keeps it right through a tie, which puts a card back. */
  function pwTierLeft(type) {
    let n = 0;
    const count = (c) => { if (c.kind === "tier" && c.type === type) n++; };
    pwOwnDeck(pw.playerSide).forEach(count);
    pw.playerHand.forEach(count);
    return n;
  }

  function pwCardHTML(card, opts) {
    const o = opts || {};
    const special = card.side === "special";
    const sideCls = card.side === "bull" ? "bull" : card.side === "bear" ? "bear" : "wild";
    const pts = special ? (card.cls === "B" ? card.pts : null) : card.pts;
    const clickable = o.play || o.answer;
    const tag = clickable ? "button" : "div";
    const attrs = o.play ? ` type="button" data-pw-play="${esc(card.id)}"`
                : o.answer ? ` type="button" data-pw-answer="${esc(card.id)}"` : "";
    /* Deck depth for this tier, on the player's own hand cards only — they
       already know their own deck. Nothing to show on a wild, which has no
       tier, or on the opponent's slot. */
    const left = o.depth && card.kind === "tier" ? pwTierLeft(card.type) : null;
    const size = o.small ? " sm" : "";
    const anim = pw.flipAnim === card.id ? " flipping" : "";

    /* A wild's whole point is its effect, and the face has no room for it — so
       it turns over. In hand the body still plays the card in one tap and a
       corner mark does the turning, because a card that had to be turned over
       and back before it could be played would be worse than not explaining
       itself. A played wild has nothing else to do, so the whole face turns. */
    if (special && pw.flipped[card.id]) {
      return `<button type="button" class="pw-card wild back${size}${anim}" data-pw-flip="${esc(card.id)}">
        <span class="pw-back-name">${esc(card.type)}</span>
        <span class="pw-back-desc">${esc(card.desc)}</span>
        <span class="pw-back-hint">tap to turn back</span>
      </button>`;
    }
    const flipMark = special
      ? (o.play
          /* A plain span, not a nested button: a button may not contain
             interactive content, and the card face itself is the play button.
             The same effect text is on the setup screen's legend for anyone
             who cannot reach this by tap. */
          ? `<span class="pw-card-flip" data-pw-flip="${esc(card.id)}"
                   title="What does ${esc(card.type)} do?">?</span>`
          : "")
      : "";
    const wholeFaceFlips = special && !o.play;
    const ftag = wholeFaceFlips ? "button" : tag;
    const fattrs = wholeFaceFlips ? ` type="button" data-pw-flip="${esc(card.id)}"` : attrs;
    return `<${ftag} class="pw-card ${sideCls}${size}${anim}${o.dim ? " dim" : ""}"${fattrs}>
      ${left != null ? `<span class="pw-card-left" title="${left} of this candle left in your deck">${left}</span>` : ""}
      ${flipMark}
      <span class="pw-card-side">${special ? "WILD" : card.side.toUpperCase()}</span>
      <span class="pw-card-icon">${pwCandleSvg(card.visual, card.side, o.small ? 26 : 32)}</span>
      <span class="pw-card-foot">
        <span class="pw-card-name">${esc(card.type)}</span>
        ${pts != null ? `<span class="pw-card-pts">${pts}</span>` : ""}
      </span>
    </${ftag}>`;
  }

  /* The hand is always two rows, whatever it holds. A fixed column count would
     spill onto a third row and start the screen scrolling, which this layout
     exists to avoid — and hands do grow: FOMO adds two, and two FOMOs in a
     match can leave ten cards down there. Columns follow the count instead, so
     six cards sit wide and comfortable and twelve still fit in the same band. */
  function pwHandCols(n) {
    return Math.min(6, Math.max(3, Math.ceil(n / 2)));
  }

  function pwTrackHTML() {
    const c = pw.candle;
    const pct = Math.min(1, Math.abs(c) / PW_TARGET);
    const tone = c === 0 ? "flat" : c > 0 ? "bull" : "bear";
    /* The fill grows from the midline toward whichever side is ahead. Its size
       goes out as a custom property and its direction as a class, so the CSS
       can spend it on height when the track is upright and on width when the
       narrow layout lays it on its side — the same number either way. */
    const style = `--pw-fill:${(pct * 50).toFixed(2)}%`;
    return `
      <div class="pw-track-panel">
        <div class="pw-track-val ${tone}">${c > 0 ? "+" : ""}${c}</div>
        <div class="pw-track-row">
          <div class="pw-track-end top">+${PW_TARGET}</div>
          <div class="pw-track">
            <div class="pw-track-mid">OPEN</div>
            <div class="pw-track-fill ${tone} ${c >= 0 ? "up" : "down"}" style="${style}"></div>
          </div>
          <div class="pw-track-end bot">−${PW_TARGET}</div>
        </div>
      </div>`;
  }

  /* the two faces of the picker. Same classes as a real card face, so the teal
     and red are the deck's own, not a second set that could drift from it */
  function pwSpinFaceHTML(side) {
    return `<div class="pw-flip-face pw-card ${side}">
      <span class="pw-card-side">${side.toUpperCase()}</span>
      <span class="pw-card-icon">${pwCandleSvg(pwTiers(side)[0], side, 32)}</span>
      <span class="pw-card-foot"><span class="pw-card-name">Trade as
        ${side === "bull" ? "Bull" : "Bear"}</span></span>
    </div>`;
  }

  function pwSpinHTML() {
    const s = pw.spin;
    if (!s) {
      return `<div class="pw-random">
        <button class="pw-ghost pw-random-go" data-pw-random>Pick my side for me</button>
      </div>`;
    }
    /* frozen face-on rather than at whatever angle it stopped at — the card is
       the answer now, and it should be square to the reader. The side it lands
       square on is the one pwSpinStop already read off the live angle. */
    const style = s.stopped
      ? ` style="transform: rotateY(${s.side === "bull" ? 0 : 180}deg)"` : "";
    return `<div class="pw-random spinning">
      <div class="pw-flip-wrap">
        <div class="pw-flipper${s.stopped ? " locked" : ""}" id="pwFlipper"${style}>
          ${pwSpinFaceHTML("bull")}
          ${pwSpinFaceHTML("bear")}
        </div>
      </div>
      ${s.stopped
        ? `<div class="pw-random-lock ${s.side}" role="status">You trade as
             ${s.side === "bull" ? "Bull" : "Bear"}</div>`
        : `<button class="pw-stop" data-pw-stop
             aria-label="Stop on the side showing now"><span>STOP</span></button>`}
    </div>`;
  }

  function pwLegendHTML() {
    return `<div class="pw-legend">
      ${PW_SPECIALS.map((s) => `<div class="pw-legend-row">
        <span class="pw-legend-name">${esc(s.type)}</span> ${esc(s.desc)}</div>`).join("")}
    </div>`;
  }

  function renderPointaeway() {
    barTitle.textContent = "Pointæway";
    const pickName = document.querySelector("#pickBar .pick-name");
    if (pickName) pickName.textContent = "Cool Down Game";
    cardFooter.style.display = "none";

    if (pw.phase === "setup") {
      cardScroll.innerHTML = `
        <div class="pw-setup">
          <div class="pw-kicker">Pointæway</div>
          <div class="pw-lede">Draw, choose, reveal. Every round the candle moves —
            first side to push it ${PW_TARGET} points their way wins the day.
            Pick your side to shuffle in.</div>
          <div class="pw-sides">
            <button class="pw-side bull" data-pw-side="bull">
              ${pwCandleSvg(pwTiers("bull")[0], "bull", 42)}<span>Trade as Bull</span></button>
            <button class="pw-side bear" data-pw-side="bear">
              ${pwCandleSvg(pwTiers("bear")[0], "bear", 42)}<span>Trade as Bear</span></button>
          </div>
          <button class="pw-ghost" data-pw-legend>${pw.showLegend ? "Hide wild cards" : "How wild cards work"}</button>
          ${pw.showLegend ? pwLegendHTML() : ""}
          ${pwSpinHTML()}
        </div>`;
      /* The picker sits below the legend button, which on a 667pt screen puts
         it under the fold — and STOP is a timing button, so it has to be on
         screen the moment it exists, not something to go looking for. Setting
         innerHTML above has already dropped the scroll to 0, so this is a
         restore as much as a scroll: it runs on the freeze re-render too, and
         the card stays exactly where the player was watching it. */
      cardScroll.scrollTop = pw.spin ? cardScroll.scrollHeight : 0;
      /* the turn survives a re-render — the node it was driving has just been
         replaced, so pick the new one up */
      if (pw.spin && !pw.spin.stopped && pwSpinRaf == null) pwSpinTick();
      return;
    }

    if (pw.phase === "gameover") {
      const label = pw.winner === "draw" ? "Doji — Draw"
        : pw.winner === "bull" ? "Bulls Win" : "Bears Win";
      const tone = pw.winner === "draw" ? "flat" : pw.winner;
      cardScroll.innerHTML = `
        <div class="pw-over">
          <div class="pw-kicker">Round ${pw.round} · Final print ${pw.candle > 0 ? "+" : ""}${pw.candle}</div>
          <div class="pw-over-title ${tone}">${label}</div>
          <button class="btn-primary" data-pw-again>Play again</button>
        </div>`;
      cardScroll.scrollTop = 0;
      return;
    }

    const ownCount = pwOwnDeck(pw.playerSide).length;
    const choosing = pw.phase === "draw-choice";
    const peeking = pw.phase === "discipline-pick";
    const doubling = pw.phase === "takeprofit-choice";
    /* Everything the match needs, in one screenful and in reading order: the
       two played cards with the meter between them, the two running totals,
       then your hand. The round log, the stat pills and the per-tier deck
       panels are all gone — the cards on the table say what happened, the bar
       says what is left, and each card carries its own tier's depth.
       The draw choice takes the hand's place rather than adding a row: there
       is nothing to play while it is up, so nothing is lost and the view stays
       inside one screen. */
    cardScroll.innerHTML = `
      <div class="pw-arena">
        <div class="pw-slot">
          <div class="pw-slot-cap">Opponent
            <span class="pw-slot-deck">${pwOwnDeck(pw.aiSide).length}</span>
          </div>
          ${pw.aiPlayed ? pwCardHTML(pw.aiPlayed, {}) : `<div class="pw-empty"></div>`}
        </div>
        ${pwTrackHTML()}
        <div class="pw-slot">
          <div class="pw-slot-cap">You</div>
          ${pw.playerPlayed ? pwCardHTML(pw.playerPlayed, {}) : `<div class="pw-empty"></div>`}
        </div>
      </div>

      <div class="pw-bar">
        <span class="pw-bar-stat"><b>${ownCount}</b> deck</span>
        <span class="pw-bar-sep"></span>
        <span class="pw-bar-stat wild"><b>${pw.special.length}</b> wild</span>
        <button class="pw-bar-seen${pw.showSeen ? " on" : ""}" data-pw-seen
                aria-pressed="${pw.showSeen}" aria-label="What the opponent has played">Seen</button>
        <button class="pw-bar-restart" data-pw-restart aria-label="Restart match">Restart</button>
      </div>

      ${pw.showSeen ? `
      <div class="pw-seen">
        <div class="pw-seen-cap">Opponent has played</div>
        ${pwTiers(pw.aiSide).map((t) => {
          const n = pw.seen[t.type] || 0;
          return `<div class="pw-seen-row${n ? " on" : ""}">
            <span>${esc(t.type)}</span>
            <span class="pw-seen-n ${pw.aiSide}">${n}/${PW_TIER_COPIES}</span>
          </div>`;
        }).join("")}
        <button class="pw-ghost" data-pw-seen>Close</button>
      </div>` : doubling ? `
      <div class="pw-choice">
        <div class="pw-choice-cap">You hold a matching ${esc(pw.tp.match.type)}
          — play it too and double what you take?</div>
        <div class="pw-choice-btns">
          <button class="pw-choice-btn wild" data-pw-tp="double">Double up
            (${pwSigned(pw.tp.result.candleDelta * 2)})</button>
          <button class="pw-choice-btn ${pw.playerSide}" data-pw-tp="pass">Pass
            (${pwSigned(pw.tp.result.candleDelta)})</button>
        </div>
      </div>` : choosing ? `
      <div class="pw-choice">
        <div class="pw-choice-cap">You lost that round. Draw from —</div>
        <div class="pw-choice-btns">
          <button class="pw-choice-btn ${pw.playerSide}" data-pw-draw="own"
            ${ownCount === 0 ? "disabled" : ""}>Your deck (${ownCount})</button>
          <button class="pw-choice-btn wild" data-pw-draw="special"
            ${pw.special.length === 0 ? "disabled" : ""}>Wild pile (${pw.special.length})</button>
        </div>
      </div>` : `
      ${peeking ? `<div class="pw-peek-cap">Their card is up — answer it with a numbered card.</div>` : ""}
      <div class="pw-hand${peeking ? " peeking" : ""}" style="--pw-cols:${pwHandCols(pw.playerHand.length)}">
        ${pw.playerHand.length
          ? pw.playerHand.map((c) => pwCardHTML(c, {
              play: pw.phase === "selecting",
              answer: peeking && c.kind === "tier",
              dim: peeking && c.kind !== "tier",
              small: true, depth: true })).join("")
          : `<div class="pw-hand-empty">Empty — nothing left to play.</div>`}
      </div>`}`;
    pw.flipAnim = null;      // the turn animation plays once, on the render after the tap
    cardScroll.scrollTop = 0;
  }

  function openPointaeway() {
    stopAudio();
    if (!pw) pw = pwNewGame();
    state.view = "pointaeway";
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
    /* A UTF-8 BOM ahead of the header row would ride along on the first column
       name — TopstepX writes one, and "﻿Id" matches nothing. */
    if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
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
    const iQty = head.indexOf("qty");
    const iBought = head.indexOf("boughtTimestamp");
    if (iPnl < 0 || iSold < 0) throw new Error("That doesn't look like a Tradovate export — no pnl / soldTimestamp columns.");
    const trades = [];
    for (let r = 1; r < rows.length; r++) {
      // a trade belongs to the day it was CLOSED — some open one day, close the next
      const day = mdyToDayKey(rows[r][iSold]);
      if (!day) continue;
      // Tradovate has no side column: a position opened before it was closed
      // is a long, one closed before it was opened is a short
      const bought = rows[r][iBought] || "", sold = rows[r][iSold] || "";
      trades.push({
        day, pnl: parseParenMoney(rows[r][iPnl]), symbol: (rows[r][iSym] || "").trim(),
        qty: (rows[r][iQty] || "").trim(),
        side: bought && sold && new Date(bought) > new Date(sold) ? "Short" : "Long",
      });
    }
    return trades;
  }

  /* ---------------- Robinhood Activity Report ----------------
     Columns: Activity Date, Process Date, Settle Date, Instrument, Description,
     Trans Code, Quantity, Price, Amount.

     Unlike Tradovate this is an account statement, not a trade blotter: cash
     events, corporate actions and option legs all share the file, and a
     completed option trade is spread across two rows that have to be paired
     up. */

  /* "$63.34" -> 63.34 · "($114.03)" -> -114.03 · "$3,081.48" -> 3081.48 */
  function parseRhMoney(v) {
    const str = String(v == null ? "" : v).trim();
    if (!str) return 0;
    const n = parseFloat(str.replace(/[$,\s()]/g, "")) || 0;
    return str.indexOf("(") >= 0 ? -n : n;
  }

  /* Cash and corporate-action rows. None of these is an execution:
       CDIV cash dividend · SLIP stock lending income · ACH cash transfer
       OEXP option expiry (no fill price) · SXCH spin-off / exchange */
  const RH_SKIP_CODES = ["CDIV", "SLIP", "ACH", "OEXP", "SXCH"];
  const RH_OPEN_CODES = { BTO: "Long", STO: "Short" };
  const RH_CLOSE_CODES = { STC: "Long", BTC: "Short" };
  /* Dividend reinvestment buys are funded by a dividend, not a decision, so
     they are noise in a trading journal. Flip this to true to keep them. */
  const RH_INCLUDE_DRIP = false;

  /* "AAPL 1/17/2025 Call $200.00" -> the contract that row belongs to */
  function parseRhContract(instrument, description) {
    const m = String(description == null ? "" : description)
      .match(/(\d{1,2}\/\d{1,2}\/\d{2,4})\s+(Call|Put)\s+\$?([\d,]+(?:\.\d+)?)/i);
    if (!m) return null;
    const exp = mdyToDayKey(m[1]) || m[1];
    const type = m[2].toLowerCase() === "call" ? "Call" : "Put";
    const strike = parseFloat(m[3].replace(/,/g, "")) || 0;
    const sym = (instrument || "").trim();
    return {
      key: `${sym}|${exp}|${strike}|${type}`,
      label: `${sym} ${m[1]} ${strike}${type[0]}`,
      underlying: sym, exp, strike, type,
    };
  }

  function rhNum(v) {
    const n = parseFloat(String(v == null ? "" : v).replace(/[^0-9.\-]/g, ""));
    return isNaN(n) ? 0 : n;
  }

  /* FIFO within a contract: the oldest open pairs off against the oldest
     close. Quantities need not line up, so an open lot can be consumed by
     several closes and vice versa; the Amount is pro-rated across the matched
     quantity rather than recomputed from price, because Robinhood has already
     netted fees into it. */
  function fifoMatchOptions(legs) {
    const groups = {};
    legs.forEach((l) => (groups[l.contract.key] || (groups[l.contract.key] = [])).push(l));
    const trades = [], open = [];
    let orphanCloses = 0;
    Object.keys(groups).forEach((k) => {
      const list = groups[k].slice().sort((a, b) =>
        (a.day < b.day ? -1 : a.day > b.day ? 1 : a.row - b.row));
      const lots = [];
      list.forEach((leg) => {
        if (leg.opening) { lots.push({ leg, left: leg.qty }); return; }
        let need = leg.qty;
        while (need > 1e-9 && lots.length) {
          const lot = lots[0];
          const take = Math.min(need, lot.left);
          const entryAmt = lot.leg.qty ? lot.leg.amount * (take / lot.leg.qty) : 0;
          const exitAmt = leg.qty ? leg.amount * (take / leg.qty) : 0;
          trades.push({
            // a trade belongs to the day it was closed, as with Tradovate
            day: leg.day,
            openDay: lot.leg.day,
            pnl: Math.round((entryAmt + exitAmt) * 100) / 100,
            symbol: leg.contract.label,
            qty: String(Math.round(take * 1e6) / 1e6),
            side: RH_CLOSE_CODES[leg.code] || "Long",
            entry: lot.leg.price,
            exit: leg.price,
            kind: "option",
          });
          lot.left -= take;
          need -= take;
          if (lot.left <= 1e-9) lots.shift();
        }
        // a close whose open predates the export window: no entry price and no
        // way to compute P&L, so it is reported rather than guessed at
        if (need > 1e-9) orphanCloses++;
      });
      lots.forEach((lot) => open.push({
        symbol: lot.leg.contract.label,
        side: RH_OPEN_CODES[lot.leg.code] || "Long",
        qty: Math.round(lot.left * 1e6) / 1e6,
        day: lot.leg.day,
        price: lot.leg.price,
      }));
    });
    return { trades, open, orphanCloses };
  }

  function parseRobinhoodExport(rows) {
    const head = rows[0].map((h) => h.trim());
    const col = (name) => head.indexOf(name);
    const iDate = col("Activity Date"), iInst = col("Instrument"), iDesc = col("Description");
    const iCode = col("Trans Code"), iQty = col("Quantity"), iPrice = col("Price"), iAmt = col("Amount");
    if (iDate < 0 || iCode < 0 || iAmt < 0) {
      throw new Error("That doesn't look like a Robinhood activity report — no Activity Date / Trans Code / Amount columns.");
    }

    // a dividend reinvestment lands as a fractional Buy on the same instrument
    // and day as the cash dividend that paid for it
    const cdiv = {};
    for (let r = 1; r < rows.length; r++) {
      if ((rows[r][iCode] || "").trim() !== "CDIV") continue;
      const d = mdyToDayKey(rows[r][iDate]);
      if (d) cdiv[`${(rows[r][iInst] || "").trim()}|${d}`] = true;
    }
    const isDrip = (inst, day, code, desc, qty) =>
      code === "DRIP"
      || /dividend\s*re-?invest/i.test(desc)
      || (code === "Buy" && cdiv[`${inst}|${day}`] && Math.abs(qty - Math.round(qty)) > 1e-9);

    const optionLegs = [], stock = [];
    let skipped = 0, drip = 0;

    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      const code = (row[iCode] || "").trim();
      const day = mdyToDayKey(row[iDate]);
      // the trailing disclaimer has no date and no transaction code
      if (!day || !code) { skipped++; continue; }
      if (RH_SKIP_CODES.indexOf(code) >= 0) { skipped++; continue; }

      const inst = (row[iInst] || "").trim();
      const desc = iDesc >= 0 ? (row[iDesc] || "") : "";
      const qty = Math.abs(rhNum(row[iQty]));
      const amount = parseRhMoney(row[iAmt]);
      const price = iPrice >= 0 ? parseRhMoney(row[iPrice]) : 0;

      if (isDrip(inst, day, code, desc, qty)) {
        drip++;
        if (!RH_INCLUDE_DRIP) { skipped++; continue; }
      }

      const opening = Object.prototype.hasOwnProperty.call(RH_OPEN_CODES, code);
      const closing = Object.prototype.hasOwnProperty.call(RH_CLOSE_CODES, code);
      if (opening || closing) {
        const contract = parseRhContract(inst, desc);
        // an option code with an unreadable description can't be paired to
        // anything, so it is counted out rather than mis-grouped
        if (!contract) { skipped++; continue; }
        optionLegs.push({ row: r, code, day, qty, price, amount, contract, opening });
        continue;
      }

      // shares: each row stands on its own, no pairing
      if (code === "Buy" || code === "Sell") {
        stock.push({
          day, pnl: amount, symbol: inst || (desc || "").trim(),
          qty: String(qty), side: code, entry: price, kind: "stock",
        });
        continue;
      }
      skipped++;   // anything else this file carries is not a trade
    }

    const matched = fifoMatchOptions(optionLegs);
    return {
      trades: matched.trades.concat(stock),
      open: matched.open,
      skipped, drip, orphanCloses: matched.orphanCloses,
      skippedNote: "dividends, transfers, expiries, corporate actions",
    };
  }

  /* ---------------- TopstepX trade export ----------------
     Columns: Id, ContractName, EnteredAt, ExitedAt, EntryPrice, ExitPrice,
     Fees, PnL, Size, Type, TradeDay, TradeDuration, Commissions.

     The simplest of the three by far: every row is already a finished trade,
     with both fills and a net P&L that TopstepX worked out itself. So there is
     no FIFO pass here — no opens to carry, no closes to pair, nothing left
     over. One row in, one trade out. */

  /* Blank is a real value in this file, not a fault: Commissions was added to
     the export partway through the date range, so older rows carry nothing
     there. Everything absent or unreadable reads as zero. */
  function parseTsxNumber(v) {
    const str = String(v == null ? "" : v).trim();
    if (!str) return 0;
    const n = parseFloat(str.replace(/[$,\s()]/g, ""));
    if (!isFinite(n)) return 0;
    return str.indexOf("(") >= 0 ? -Math.abs(n) : n;
  }

  /* The date a timestamp names IN ITS OWN ZONE. These stamps carry an explicit
     offset that moves with daylight saving ("...T22:13:05-04:00"), and the
     whole point is to read them as written rather than as the browser's local
     time — new Date(...).getDate() would re-render a 10pm Eastern trade in
     whatever zone the phone is in and hand back the wrong day. The leading
     date portion is already the local date at that offset, so take it as is.
     Also accepts a plain MM/DD/YYYY, which is how some exports write TradeDay. */
  function offsetDayKey(ts) {
    const str = String(ts == null ? "" : ts).trim();
    const iso = str.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
    return mdyToDayKey(str);
  }

  /* "NQM5" -> NQ · "MNQU6" -> MNQ · "ESU6" -> ES. The root is what groups and
     displays; the month code and year identify one specific contract, so the
     full name is kept alongside it rather than thrown away. Some feeds prefix
     the name ("CON.F.US.MNQ.M25"), so that is unwrapped first. A name that
     doesn't fit the pattern is used whole — better a raw symbol than none. */
  const TSX_MONTH_CODES = "FGHJKMNQUVXZ";
  function tsxRootSymbol(contractName) {
    let s = String(contractName == null ? "" : contractName).trim().toUpperCase();
    if (!s) return "";
    if (s.indexOf(".") >= 0) {
      // CON.F.US.MNQ.M25 -> the last part that is neither the month code nor a
      // routing token is the root
      const parts = s.split(".").filter(Boolean);
      const root = parts.find((p, i) => i >= 3 && /^[A-Z]{1,4}$/.test(p));
      if (root) return root;
      s = parts[parts.length - 1] || s;
    }
    const m = s.match(/^([A-Z]{1,4})([FGHJKMNQUVXZ])(\d{1,2})$/);
    return m && TSX_MONTH_CODES.indexOf(m[2]) >= 0 ? m[1] : s;
  }

  function parseTopstepxExport(rows) {
    const head = rows[0].map((h) => h.trim());
    const col = (name) => head.indexOf(name);
    const iContract = col("ContractName"), iPnl = col("PnL"), iDay = col("TradeDay");
    const iIn = col("EnteredAt"), iOut = col("ExitedAt");
    const iEntry = col("EntryPrice"), iExit = col("ExitPrice");
    const iFees = col("Fees"), iComm = col("Commissions");
    const iSize = col("Size"), iType = col("Type"), iDur = col("TradeDuration");
    if (iContract < 0 || iPnl < 0 || iDay < 0) {
      throw new Error("That doesn't look like a TopstepX export — no ContractName / PnL / TradeDay columns.");
    }

    const trades = [];
    let skipped = 0;
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      const contract = (row[iContract] || "").trim();
      /* TradeDay is TopstepX's own session date, and it is the one to place the
         trade on: futures sessions run overnight, so a fill entered at 10pm
         Eastern belongs to the NEXT day's session and TradeDay already says so.
         Reading the date off EnteredAt instead would split a session at
         midnight. EnteredAt is only the fallback for a row missing TradeDay. */
      const day = offsetDayKey(row[iDay]) || (iIn >= 0 ? offsetDayKey(row[iIn]) : null);
      if (!day || !contract) { skipped++; continue; }

      const type = (iType >= 0 ? row[iType] || "" : "").trim();
      const t = {
        day,
        // PnL is TopstepX's own net figure and the source of truth — it is not
        // recomputed from the fills, and fees are not subtracted from it again
        pnl: parseTsxNumber(row[iPnl]),
        symbol: tsxRootSymbol(contract),
        contract,
        qty: (iSize >= 0 ? row[iSize] || "" : "").trim(),
        side: /^short$/i.test(type) ? "Short" : "Long",
        entry: iEntry >= 0 ? parseTsxNumber(row[iEntry]) : 0,
        exit: iExit >= 0 ? parseTsxNumber(row[iExit]) : 0,
        // kept as written, offset and all, so nothing is re-zoned on the way in
        enteredAt: (iIn >= 0 ? row[iIn] || "" : "").trim(),
        exitedAt: (iOut >= 0 ? row[iOut] || "" : "").trim(),
        // hh:mm:ss.fraction, straight from the file — derivable from the two
        // stamps, but there is no reason to recompute what is already here
        duration: (iDur >= 0 ? row[iDur] || "" : "").trim(),
        // the two cost columns as one figure, rounded to cents rather than left
        // as whatever adding two floats produced
        fees: Math.round((parseTsxNumber(iFees >= 0 ? row[iFees] : 0)
                        + parseTsxNumber(iComm >= 0 ? row[iComm] : 0)) * 100) / 100,
        kind: "futures",
      };
      trades.push(t);
    }
    // a blank tail row, or anything without the two fields a trade needs
    return { trades, skipped, skippedNote: "no trade day or contract name" };
  }

  const BROKER_PARSERS = [
    { id: "tradovate", label: "Tradovate", parse: parseTradovateExport,
      detect: (head) => head.indexOf("soldTimestamp") >= 0 && head.indexOf("buyFillId") >= 0 },
    { id: "robinhood", label: "Robinhood", parse: parseRobinhoodExport,
      detect: (head) => head.indexOf("Trans Code") >= 0 && head.indexOf("Activity Date") >= 0 },
    { id: "topstepx", label: "TopstepX", parse: parseTopstepxExport,
      detect: (head) => head.indexOf("ContractName") >= 0 && head.indexOf("TradeDay") >= 0 },
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

  function importCsvText(text, fileName, replaceBatchId) {
    const rows = parseCsv(text);
    if (rows.length < 2) throw new Error("That file has no rows to import.");
    const head = rows[0].map((h) => h.trim());
    const broker = BROKER_PARSERS.find((b) => b.detect(head)) || BROKER_PARSERS[0];
    // a parser may return a bare trade list, or a report carrying open
    // positions and counts of what it left out
    const parsed = broker.parse(rows);
    const report = Array.isArray(parsed) ? { trades: parsed } : parsed;
    const trades = report.trades || [];
    if (!trades.length) {
      throw new Error(report.open && report.open.length
        ? "No completed trades in that file — every position in it is still open."
        : "No trades found in that file.");
    }
    const days = aggregateTrades(trades);
    // import wins over sample/manual figures for the days it covers — it's the
    // real broker record. Change here if manual entry should take precedence.
    const account = activeAccount();
    if (!account) {
      throw new Error((store.journalAccounts || []).length
        ? "Select a single account before importing — the combined view can't receive trades."
        : "Add an account before importing trades.");
    }
    // A replacement drops the batch it supersedes first, but only now that the
    // file has parsed cleanly — a bad file must never cost the user the import
    // they already had.
    if (replaceBatchId) deleteImportBatch(account.id, replaceBatchId);
    const acct = store.journalImport[account.id] || (store.journalImport[account.id] = {});
    Object.keys(days).forEach((k) => { acct[k] = days[k]; });
    const batch = {
      id: `batch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      broker: broker.label, file: fileName || "", at: new Date().toISOString(),
      days: Object.keys(days).sort(), trades: trades.length,
    };
    (store.journalBatches[account.id] || (store.journalBatches[account.id] = [])).push(batch);
    // the calendar needs day totals; the P&L views need each trade
    addTradeRecords(account.id, trades.map((t) => {
      const rec = {
        id: jtId(), source: "import", batch: batch.id,
        date: t.day, symbol: t.symbol || "", side: t.side || "Long", qty: t.qty || "", pnl: t.pnl,
      };
      /* Detail a parser worked out but the common shape has no room for — the
         specific futures contract behind a root symbol, the fills, how long the
         trade was held. Carried only when a parser actually produced it, so
         records from the other brokers keep exactly the shape they had. */
      ["contract", "entry", "exit", "enteredAt", "exitedAt", "duration", "fees"].forEach((k) => {
        if (t[k] !== undefined && t[k] !== "" && t[k] !== null) rec[k] = t[k];
      });
      return rec;
    }));
    // positions with no closing leg are not trades — they are held, so they are
    // kept apart from the P&L record. Re-importing replaces the account's list
    // rather than stacking duplicates on it.
    if (report.open) store.journalOpen[account.id] = report.open;
    save();
    return {
      broker: broker.label, trades: trades.length, days: Object.keys(days).sort(),
      open: (report.open || []).length, skipped: report.skipped || 0,
      drip: report.drip || 0, orphanCloses: report.orphanCloses || 0,
      skippedNote: report.skippedNote || "",
      replaced: !!replaceBatchId,
    };
  }

  /* ---------------- accounts ----------------
     Users add their own brokerage accounts; nothing is hardcoded and every
     new account starts at the balance they enter with an empty calendar.
     Personal Account / Prop Firms stays the higher-level category filter —
     each added account belongs to one of them. */

  const JOURNAL_SECTIONS = [
    { id: "calendar", label: "Month Cal", icon: "stat-month-cal" },
    { id: "total", label: "Total P&L", icon: "stat-total-pnl" },
    { id: "net", label: "Net P&L", icon: "stat-net-pnl" },
    { id: "recent", label: "Recent Trade", icon: "stat-recent-trade" },
  ];
  function statRowHTML() {
    return `<div class="j-stat-row">
      ${JOURNAL_SECTIONS.map((sec) => `
        <button class="j-stat-btn ${state.journalSection === sec.id ? "on" : ""}" data-jsection="${sec.id}">
          <span class="ci-orb" aria-hidden="true">${sec.icon
            ? `<img src="assets/nav-icons/${sec.icon}@2x.png" alt="">` : ""}</span>
          <span class="ci-action-label">${esc(sec.label)}</span>
        </button>`).join("")}
    </div>`;
  }
  /* The delivered logo set, with the category each brand belongs to taken from
     the "Live"/"Prop" suffix on its filename. MetaTrader has no logo but is
     kept on the list so accounts already created under it don't fall back to
     "Other" on edit. */
  const BROKERS = [
    { name: "Robinhood",           category: "personal", logo: "robinhood" },
    { name: "Webull",              category: "personal", logo: "webull" },
    { name: "NinjaTrader",         category: "personal", logo: "ninjatrader" },
    { name: "Tradovate",           category: "personal", logo: "tradovate" },
    { name: "Coinbase",            category: "personal", logo: "coinbase" },
    { name: "Public",              category: "personal", logo: "public" },
    { name: "Interactive Brokers", category: "personal", logo: "interactive-brokers" },
    { name: "ThinkorSwim",         category: "personal", logo: "thinkorswim" },
    { name: "TastyTrade",          category: "personal", logo: "tastytrade" },
    { name: "Topstep",             category: "prop",     logo: "topstep" },
    { name: "Take Profit Trader",  category: "prop",     logo: "take-profit-trader" },
    { name: "Tradeify",            category: "prop",     logo: "tradeify" },
    { name: "Apex Trader Funding", category: "prop",     logo: "apex" },
    { name: "Lucid",               category: "prop",     logo: "lucid" },
    { name: "My Funded Future",    category: "prop",     logo: "my-funded-future" },
    { name: "MetaTrader",          category: "personal", logo: "" },
  ];
  const PLATFORMS = BROKERS.map((b) => b.name);

  /* Match a stored platform string to its logo. Compared on letters only, so
     spelling drift between the asset filenames, the picker and anything a user
     typed by hand still lands on the right brand — "Think or Swim",
     "ThinkorSwim" and "thinkorswim" are all the same key. */
  function brandKey(s) { return String(s || "").toLowerCase().replace(/[^a-z]/g, ""); }
  const LOGO_BY_KEY = {};
  BROKERS.forEach((b) => { if (b.logo) LOGO_BY_KEY[brandKey(b.name)] = b.logo; });
  // spellings seen in the delivered artwork and in earlier builds
  Object.assign(LOGO_BY_KEY, {
    tradeovate: "tradovate",
    apex: "apex",
    interactivebroker: "interactive-brokers",
    tastytrades: "tastytrade",
    topstepx: "topstep",
  });
  function logoFor(platform) {
    const slug = LOGO_BY_KEY[brandKey(platform)];
    return slug ? `assets/logos/${slug}@2x.png` : "";
  }

  function accountsIn(category) {
    return (store.journalAccounts || []).filter((a) => a.category === category);
  }
  /* the combined view is the default; a specific account can be selected to
     see its balance and calendar on its own */
  function isCombined() {
    return store.journalActive === "__all" || !activeAccount();
  }
  function activeAccount() {
    return (store.journalAccounts || []).find((a) => a.id === store.journalActive) || null;
  }
  /* Which accounts the current scope covers. The combined view now follows the
     Personal Account / Prop Firms toggle, so every figure on screen — balance,
     calendar, charts and trade list — belongs to the category being shown.
     (Earlier this summed every account regardless of tab, which meant the Prop
     tab could show personal trades.) */
  function scopeAccounts() {
    const a = activeAccount();
    return a ? [a] : accountsIn(state.journalTab);
  }
  function accountLabel(a) {
    return a.nickname ? `${a.platform} · ${a.nickname}` : a.platform;
  }

  /* every realised trade on the account, imported or manual */
  function accountRealised(id) {
    let sum = 0;
    const imp = (store.journalImport[id] || {});
    Object.keys(imp).forEach((k) => { sum += imp[k].pnl; });
    const man = (store.journalManual[id] || {});
    Object.keys(man).forEach((k) => man[k].forEach((t) => { sum += t.pnl; }));
    return sum;
  }
  /* starting balance, plus every deposit/withdrawal, plus realised P&L */
  function accountBalance(a) {
    const ledger = (a.ledger || []).reduce((t, e) => t + e.amount, 0);
    return Math.round((a.start + ledger + accountRealised(a.id)) * 100) / 100;
  }

  /* ---------------- trade records ----------------
     The calendar only needs day totals, but the Total P&L, Net P&L and Recent
     Trades views need each trade, so both the CSV import and manual entry now
     keep a per-trade record alongside the day aggregation. */

  const RANGES = [
    { id: "1W", label: "1W", days: 7 },
    { id: "1M", label: "1M", days: 30 },
    { id: "3M", label: "3M", days: 90 },
    { id: "6M", label: "6M", days: 180 },
    { id: "1Y", label: "1Y", days: 365 },
    { id: "ALL", label: "All", days: 0 },
  ];

  function addTradeRecords(accountId, records) {
    const list = store.journalTrades[accountId] || (store.journalTrades[accountId] = []);
    records.forEach((r) => list.push(r));
  }

  /* ---------------- deleting what a day holds ----------------
     Trades live in two places by design: journalTrades carries every trade for
     the P&L views, while the calendar reads day totals from journalImport
     (imports) or journalManual (typed in). A delete has to leave both
     consistent, so the day totals for anything touched are rebuilt from what
     survives rather than patched. */

  function rebuildImportDays(accountId, dayKeys) {
    const acct = store.journalImport[accountId] || (store.journalImport[accountId] = {});
    const trades = store.journalTrades[accountId] || [];
    dayKeys.forEach((k) => {
      const left = trades.filter((t) => t.source === "import" && t.date === k);
      if (!left.length) { delete acct[k]; return; }
      acct[k] = left.reduce((a, t) => {
        a.pnl += t.pnl; a.trades++;
        if (t.pnl > 0) a.wins++; else if (t.pnl < 0) a.losses++; else a.flat++;
        return a;
      }, { pnl: 0, trades: 0, wins: 0, losses: 0, flat: 0 });
      acct[k].pnl = Math.round(acct[k].pnl * 100) / 100;
    });
  }

  /* every trade that came in on one CSV, and the day totals it wrote */
  function deleteImportBatch(accountId, batchId) {
    const list = store.journalTrades[accountId] || [];
    const touched = {};
    store.journalTrades[accountId] = list.filter((t) => {
      if (t.batch !== batchId) return true;
      touched[t.date] = true;
      return false;
    });
    const rec = (store.journalBatches[accountId] || []).find((b) => b.id === batchId);
    // a legacy batch predates per-trade tagging, so fall back to its own day list
    (rec && rec.days ? rec.days : []).forEach((k) => { touched[k] = true; });
    rebuildImportDays(accountId, Object.keys(touched));
    store.journalBatches[accountId] = (store.journalBatches[accountId] || []).filter((b) => b.id !== batchId);
  }

  function deleteManualTrade(accountId, entryId, day) {
    const man = store.journalManual[accountId] || {};
    if (man[day]) {
      man[day] = man[day].filter((e) => e.id !== entryId);
      if (!man[day].length) delete man[day];
    }
    store.journalTrades[accountId] = (store.journalTrades[accountId] || [])
      .filter((t) => t.id !== entryId);
  }

  /* every trade across the accounts in scope, newest first, within the range */
  function scopeTrades(accts, rangeId) {
    const range = RANGES.find((r) => r.id === rangeId) || RANGES[1];
    let cutoff = null;
    if (range.days) {
      const d = new Date();
      d.setDate(d.getDate() - range.days);
      cutoff = dayKey(d.getFullYear(), d.getMonth(), d.getDate());
    }
    const out = [];
    accts.forEach((a) => (store.journalTrades[a.id] || []).forEach((t) => {
      if (!cutoff || t.date >= cutoff) out.push(t);
    }));
    return out.sort((x, y) => (x.date < y.date ? 1 : x.date > y.date ? -1 : 0));
  }

  function tradeStats(trades) {
    return trades.reduce((s, t) => {
      s.net += t.pnl;
      if (t.pnl > 0) { s.gross += t.pnl; s.wins++; }
      else if (t.pnl < 0) { s.loss += t.pnl; s.losses++; }
      else s.flat++;
      return s;
    }, { net: 0, gross: 0, loss: 0, wins: 0, losses: 0, flat: 0 });
  }

  function rangePicker() {
    return `<select class="j-range" data-jrange>
      ${RANGES.map((r) => `<option value="${r.id}"${state.journalRange === r.id ? " selected" : ""}>${r.label}</option>`).join("")}
    </select>`;
  }

  /* cumulative P&L as an inline area chart — no library, no external request */
  function cumulativeChart(trades) {
    const asc = trades.slice().reverse();
    if (!asc.length) return `<div class="j-chart-empty">No trades in this range yet.</div>`;
    let run = 0;
    const pts = asc.map((t) => { run += t.pnl; return run; });
    const W = 300, H = 120, pad = 4;
    const lo = Math.min(0, ...pts), hi = Math.max(0, ...pts);
    const span = (hi - lo) || 1;
    const x = (i) => pad + (pts.length === 1 ? (W - pad * 2) / 2 : (i * (W - pad * 2)) / (pts.length - 1));
    const y = (v) => H - pad - ((v - lo) / span) * (H - pad * 2);
    const line = pts.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
    const area = `${line} L${x(pts.length - 1).toFixed(1)},${y(lo).toFixed(1)} L${x(0).toFixed(1)},${y(lo).toFixed(1)} Z`;
    const up = run >= 0;
    return `
      <svg class="j-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img"
           aria-label="Cumulative profit and loss, ending ${money(Math.round(run * 100) / 100, true)}">
        <defs>
          <linearGradient id="pnlFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="${up ? "#2FE6C2" : "#FF3D9A"}" stop-opacity=".38"/>
            <stop offset="100%" stop-color="${up ? "#2FE6C2" : "#FF3D9A"}" stop-opacity="0"/>
          </linearGradient>
        </defs>
        ${lo < 0 && hi > 0 ? `<line class="j-chart-zero" x1="0" y1="${y(0).toFixed(1)}" x2="${W}" y2="${y(0).toFixed(1)}"/>` : ""}
        <path d="${area}" fill="url(#pnlFill)"/>
        <path d="${line}" fill="none" stroke="${up ? "#2FE6C2" : "#FF3D9A"}" stroke-width="2"
              stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
      </svg>`;
  }

  function sectionHTML(scope) {
    const trades = scopeTrades(scope, state.journalRange);
    const st = tradeStats(trades);
    const round = (n) => Math.round(n * 100) / 100;

    if (state.journalSection === "total") {
      return `<div class="j-panel">
        <div class="j-panel-head"><span class="j-panel-title">Cumulative P&amp;L</span>${rangePicker()}</div>
        <div class="j-panel-net ${st.net < 0 ? "neg" : "pos"}">${money(round(st.net), true)}</div>
        ${cumulativeChart(trades)}
        <div class="j-panel-foot">${trades.length} trade${trades.length === 1 ? "" : "s"} in this range</div>
      </div>`;
    }
    if (state.journalSection === "net") {
      const pct = (n) => (st.wins + st.losses ? Math.round((1000 * n) / (st.wins + st.losses)) / 10 : 0);
      return `<div class="j-panel">
        <div class="j-panel-head"><span class="j-panel-title">Net P&amp;L</span>${rangePicker()}</div>
        <div class="j-panel-net ${st.net < 0 ? "neg" : "pos"}">${money(round(st.net), true)}</div>
        <div class="j-net-grid">
          <div class="j-net-cell"><span class="j-net-k">Gross Profit</span>
            <span class="j-net-v pos">${money(round(st.gross), true)}</span></div>
          <div class="j-net-mid"><span class="j-net-k">Total Trades</span>
            <span class="j-net-total">${trades.length}</span></div>
          <div class="j-net-cell right"><span class="j-net-k">Gross Loss</span>
            <span class="j-net-v neg">${money(round(st.loss), true)}</span></div>
          <div class="j-net-cell"><span class="j-net-k">Winning Trades</span>
            <span class="j-net-v pos">${st.wins} (${pct(st.wins)}%)</span></div>
          <div class="j-net-cell right"><span class="j-net-k">Losing Trades</span>
            <span class="j-net-v neg">${st.losses} (${pct(st.losses)}%)</span></div>
        </div>
      </div>`;
    }
    // recent trades
    const shown = state.journalAllTrades ? trades : trades.slice(0, 8);
    return `<div class="j-panel">
      <div class="j-panel-head"><span class="j-panel-title">Recent Trades</span>
        ${trades.length > 8 ? `<button class="j-viewall" data-jviewall>${state.journalAllTrades ? "Show Less" : "View All"}</button>` : ""}</div>
      ${trades.length ? `
        <div class="j-tt">
          <div class="j-tt-head"><span>Date</span><span>Symbol</span><span>Side</span><span>Qty</span><span>Result</span><span>P&amp;L</span></div>
          ${shown.map((t) => {
            const win = t.pnl > 0;
            return `<div class="j-tt-row">
              <span>${esc((t.date || "").slice(5))}</span>
              <span class="j-tt-sym">${esc(t.symbol || "—")}</span>
              <span><span class="j-pill ${t.side === "Short" ? "short" : "long"}">${esc(t.side || "Long")}</span></span>
              <span>${t.qty || "—"}</span>
              <span><span class="j-pill ${win ? "win" : "loss"}">${win ? "Win" : "Loss"}</span></span>
              <span class="${t.pnl < 0 ? "neg" : "pos"}">${money(round(t.pnl))}</span>
            </div>`;
          }).join("")}
        </div>` : `<div class="j-chart-empty">No trades in this range yet.</div>`}
    </div>`;
  }

  /* ---------------- prop firm net P&L ----------------
     Evaluations and resets are money out, payouts are money in. This is a
     spend-vs-earned view of the prop firm business and is deliberately kept
     out of accountBalance(): a challenge balance is simulated, whereas these
     are real dollars. Manual entry only — bank linking (Plaid-style
     auto-detection of evaluations, resets and payouts) is a possible later
     phase, not built here. */

  const PROP_KINDS = [
    { id: "evaluation", label: "Evaluation", out: true },
    { id: "reset", label: "Reset", out: true },
    { id: "payout", label: "Payout", out: false },
  ];

  function propTotals(id) {
    return (store.propLedger[id] || []).reduce((t, e) => {
      if (e.kind === "payout") t.earned += e.amount; else t.spent += e.amount;
      return t;
    }, { spent: 0, earned: 0 });
  }
  let pfSeq = 0;
  function propEntryId() { return `pfe-${Date.now().toString(36)}-${(pfSeq++).toString(36)}`; }

  function propKindLabel(kind) {
    return (PROP_KINDS.find((k) => k.id === kind) || {}).label || kind;
  }

  /* Which prop accounts the summary covers: the one picked in the Select
     Account dropdown, or every prop account when "All" is selected. The firm
     selector is that same dropdown — the prop section doesn't get one of its
     own. */
  function propSelected() {
    const a = activeAccount();
    return (!isCombined() && a && a.category === "prop") ? a : null;
  }
  function propScope() {
    const one = propSelected();
    return one ? [one] : accountsIn("prop");
  }
  function propScopeLabel() {
    const one = propSelected();
    return one ? accountLabel(one) : "All Prop Firms";
  }

  /* every entry in scope, newest first, each carrying the account it belongs to */
  function propEntries(scope) {
    const rows = [];
    scope.forEach((a) => {
      (store.propLedger[a.id] || []).forEach((e) => rows.push({ e, acct: a }));
    });
    return rows.sort((x, y) => (y.e.date || "").localeCompare(x.e.date || ""));
  }

  function propScopeTotals(scope) {
    return scope.reduce((t, a) => {
      const x = propTotals(a.id);
      t.spent += x.spent; t.earned += x.earned;
      return t;
    }, { spent: 0, earned: 0 });
  }

  /* find an entry by id across every prop account */
  function propFind(entryId) {
    const ids = Object.keys(store.propLedger || {});
    for (const acctId of ids) {
      const list = store.propLedger[acctId] || [];
      const i = list.findIndex((e) => e.id === entryId);
      if (i >= 0) return { acctId, index: i, entry: list[i] };
    }
    return null;
  }

  /* ---- the collapsed summary ----
     One full-width pill under the Live/Prop row carrying the P&L for whatever
     the account dropdown has selected. The pill is the expand control: the
     itemised entries live inside it and stay collapsed until it is tapped. */

  function propSummaryHTML() {
    if (state.journalTab !== "prop") return "";
    const scope = propScope();
    const t = propScopeTotals(scope);
    const net = Math.round((t.earned - t.spent) * 100) / 100;
    const open = !!state.propOpen;
    return `
      <div class="pf-summary">
        <button class="pf-pill ${open ? "open" : ""}" data-pfpill
                aria-expanded="${open ? "true" : "false"}">
          <span class="pf-pill-lbl">${esc(propScopeLabel())}</span>
          <span class="pf-pill-val ${net < 0 ? "neg" : "pos"}">${money(net, true)}</span>
          <span class="pf-pill-caret" aria-hidden="true">
            <img src="assets/nav-icons/icon-chevron-down@2x.png" alt="">
          </span>
        </button>
        ${open ? `<div class="pf-panel">${propPanelHTML(scope, t, net)}</div>` : ""}
      </div>`;
  }

  function propPanelHTML(scope, t, net) {
    if (state.propMode === "add" || state.propMode === "edit") return propFormHTML();
    if (state.propMode === "delete") return propDeleteHTML();
    const rows = propEntries(scope);
    const many = !propSelected();   // combined view names the firm on every row
    return `
      <div class="pf-split">
        <span><span class="pf-k">Spent</span><span class="pf-v neg">${plainMoney(t.spent)}</span></span>
        <span><span class="pf-k">Earned</span><span class="pf-v pos">${plainMoney(t.earned)}</span></span>
        <span><span class="pf-k">Net</span><span class="pf-v ${net < 0 ? "neg" : "pos"}">${money(net, true)}</span></span>
      </div>
      ${scope.length ? "" : `<div class="pf-empty">Add a prop firm account to start logging
        evaluations, resets and payouts.</div>`}
      ${rows.length ? `<div class="pf-list">
        ${rows.map(({ e, acct }) => `
          <div class="pf-item">
            <button class="pf-item-main" data-pfedit="${esc(e.id)}">
              <span class="pf-item-txt">
                <span class="pf-item-kind ${esc(e.kind)}">${esc(propKindLabel(e.kind))}</span>
                <span class="pf-item-meta">${esc(propDateLabel(e.date))}${
                  many ? " · " + esc(accountLabel(acct)) : (e.firm ? " · " + esc(e.firm) : "")}</span>
              </span>
              <span class="pf-item-amt ${e.kind === "payout" ? "pos" : "neg"}">${
                e.kind === "payout" ? "+" : "-"}${plainMoney(e.amount)}</span>
            </button>
            <button class="pf-item-del" data-pfdel="${esc(e.id)}"
                    aria-label="Delete this entry"></button>
          </div>`).join("")}
      </div>` : (scope.length ? `<div class="pf-empty">Nothing logged yet — evaluations and resets
        count as spend, payouts as income.</div>` : "")}
      ${scope.length ? `<button class="pf-add" data-pfadd>Log Evaluation / Reset / Payout</button>` : ""}`;
  }

  /* "2026-03-04" reads as a date, not a key, once it is in a list */
  function propDateLabel(iso) {
    const p = String(iso || "").split("-");
    if (p.length !== 3) return iso || "";
    const d = new Date(+p[0], +p[1] - 1, +p[2]);
    if (isNaN(d)) return iso;
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  }

  /* One form for both logging and editing — an edit is the same fields with
     the entry's values already in them. Inline inside the panel rather than an
     overlay, matching the account selector. */
  function propFormHTML() {
    const accts = accountsIn("prop");
    const editing = state.propMode === "edit";
    const found = editing ? propFind(state.propEntryId) : null;
    if (editing && !found) return "";
    const e = found ? found.entry : null;
    const preId = found ? found.acctId
      : ((activeAccount() && activeAccount().category === "prop" ? activeAccount().id : "")
         || (accts[0] && accts[0].id) || "");
    return `
      <div class="pf-form-head">${editing ? "Edit Entry" : "Log Entry"}</div>
      <form id="pfForm" autocomplete="off" novalidate>
        <label class="mt-label">Prop firm
          <select class="mt-input" name="account">
            ${accts.map((a) => `<option value="${esc(a.id)}"${a.id === preId ? " selected" : ""}>${esc(accountLabel(a))}</option>`).join("")}
          </select>
        </label>
        <label class="mt-label">Type
          <select class="mt-input" name="kind">
            ${PROP_KINDS.map((k) => `<option value="${k.id}"${e && e.kind === k.id ? " selected" : ""}>${k.label}${k.out ? " (spend)" : " (income)"}</option>`).join("")}
          </select>
        </label>
        <label class="mt-label">Firm name
          <input class="mt-input" name="firm" type="text" value="${esc(e ? (e.firm || "") : (accts.find((a) => a.id === preId) || {}).platform || "")}"
                 placeholder="Lucid, Apex, Topstep…"></label>
        <label class="mt-label">Amount ($)
          <input class="mt-input" name="amount" type="text" inputmode="decimal"
                 value="${e ? esc(e.amount.toFixed(2)) : ""}" placeholder="0.00"></label>
        <label class="mt-label">Date
          <input class="mt-input mt-date" name="date" type="date" value="${esc(e ? e.date : todayKey())}"></label>
        <div id="pfError" class="gate-error hidden"></div>
        <button type="button" class="ad-save" data-pfsave>${editing ? "Save Changes" : "Log It"}</button>
        <button type="button" class="ad-back" data-pfcancel>Cancel</button>
      </form>`;
  }

  function propDeleteHTML() {
    const found = propFind(state.propEntryId);
    if (!found) return "";
    const e = found.entry;
    return `
      <div class="pf-form-head">Delete Entry</div>
      <div class="ad-confirm">Delete the ${esc(propKindLabel(e.kind).toLowerCase())} of
        <b>${plainMoney(e.amount)}</b> on <b>${esc(propDateLabel(e.date))}</b>?<br>
        The firm and combined totals update straight away. This can't be undone.</div>
      <button class="ad-danger" data-pfdelok="${esc(e.id)}">Delete Entry</button>
      <button class="ad-back" data-pfcancel>Cancel</button>`;
  }

  /* the panel's mode, re-rendered without losing the reader's scroll position */
  function setPropMode(mode, entryId) {
    state.propMode = mode || null;
    state.propEntryId = entryId || null;
    renderJournalInPlace();
  }

  function savePropEntry() {
    const f = $("pfForm");
    const err = $("pfError");
    const get = (n) => (new FormData(f).get(n) || "").toString().trim();
    const amount = parseFloat(get("amount").replace(/[^0-9.]/g, ""));
    if (isNaN(amount) || amount <= 0) { err.textContent = "Enter an amount."; err.classList.remove("hidden"); return; }
    const acctId = get("account");
    if (!acctId) { err.textContent = "Pick a prop firm."; err.classList.remove("hidden"); return; }
    const fields = {
      kind: get("kind") || "evaluation",
      firm: get("firm"),
      amount: Math.round(amount * 100) / 100,
      date: get("date") || todayKey(),
    };
    const found = state.propMode === "edit" ? propFind(state.propEntryId) : null;
    if (found) {
      const moved = found.acctId !== acctId;
      const updated = Object.assign({}, found.entry, fields);
      if (moved) {
        // changing the firm moves the entry between ledgers so both totals move
        store.propLedger[found.acctId].splice(found.index, 1);
        (store.propLedger[acctId] || (store.propLedger[acctId] = [])).push(updated);
      } else {
        store.propLedger[acctId][found.index] = updated;
      }
    } else {
      const list = store.propLedger[acctId] || (store.propLedger[acctId] = []);
      list.push(Object.assign({ id: propEntryId() }, fields));
    }
    save();
    state.journalTab = "prop";
    state.propOpen = true;
    setPropMode(null);
  }

  function deletePropEntry(entryId) {
    const found = propFind(entryId);
    if (!found) { setPropMode(null); return; }
    store.propLedger[found.acctId].splice(found.index, 1);
    save();
    setPropMode(null);
  }

  /* On a new entry the firm name trails whichever prop firm is picked, until
     the user types their own — then it is left alone. Editing never overwrites
     what is already there. */
  function wirePropForm() {
    const f = $("pfForm");
    if (!f) return;
    const sel = f.querySelector('[name="account"]');
    const firm = f.querySelector('[name="firm"]');
    if (!sel || !firm) return;
    let touched = state.propMode === "edit";
    firm.addEventListener("input", () => { touched = true; });
    sel.addEventListener("change", () => {
      if (touched) return;
      const a = (store.journalAccounts || []).find((x) => x.id === sel.value);
      if (a) firm.value = a.platform;
    });
  }

  function journalDate() {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth() + state.journalMonth, 1);
  }
  function monthOffsetFor(y, m) {
    const now = new Date();
    return (y - now.getFullYear()) * 12 + (m - now.getMonth());
  }
  function dayKey(y, m, d) {
    return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }

  /* A day holds only what the user imported or logged — there is no generated
     data any more, so an untouched day is simply blank and every new account
     starts at zero. */
  /* ---------------- day view ----------------
     Tapping a day on the calendar opens what that day is actually made of.
     Typed-in trades can be deleted one at a time; imported ones are shown
     grouped under the CSV that brought them, read-only, because correcting an
     import means re-importing a corrected file rather than hand-editing rows
     the broker produced. */

  function dayEntries(accts, key) {
    const manual = [], imported = {};
    accts.forEach((a) => {
      ((store.journalManual[a.id] || {})[key] || []).forEach((e) => {
        manual.push({ acct: a, entry: e });
      });
      (store.journalTrades[a.id] || []).forEach((t) => {
        if (t.source !== "import" || t.date !== key) return;
        const bid = t.batch || "__untagged";
        (imported[bid] || (imported[bid] = { acct: a, batch: null, trades: [] })).trades.push(t);
      });
      (store.journalBatches[a.id] || []).forEach((b) => {
        if (imported[b.id]) imported[b.id].batch = b;
      });
    });
    return { manual, batches: Object.keys(imported).map((k) => Object.assign({ id: k }, imported[k])) };
  }

  function dayLabel(key) {
    const p = String(key || "").split("-");
    if (p.length !== 3) return key || "";
    return new Date(+p[0], +p[1] - 1, +p[2])
      .toLocaleDateString("en-US", { weekday: "short", month: "long", day: "numeric", year: "numeric" });
  }

  function dayViewHTML(accts, key) {
    const { manual, batches } = dayEntries(accts, key);
    const info = (() => {
      const p = key.split("-");
      return scopeDay(accts, +p[0], +p[1] - 1, +p[2]);
    })();
    const total = info ? info.pnl : 0;
    const many = accts.length > 1;

    if (state.journalDelete) {
      const d = state.journalDelete;
      return `<div class="jd">
        ${jdHeadHTML(key, total, info)}
        <div class="pf-form-head">${d.kind === "batch" ? "Delete Import" : "Delete Trade"}</div>
        <div class="ad-confirm">${d.kind === "batch"
          ? `Delete every trade that came in on <b>${esc(d.label)}</b>?<br>
             ${d.count} trade${d.count === 1 ? "" : "s"} across ${d.days} day${d.days === 1 ? "" : "s"}
             go with it, and those day totals go back to whatever else is logged.`
          : `Delete <b>${esc(d.label)}</b>?<br>This trade is removed from the day and from your P&amp;L.`}
          This can't be undone.</div>
        <button class="ad-danger" data-jdelok>Delete</button>
        <button class="ad-back" data-jdelcancel>Cancel</button>
      </div>`;
    }

    return `<div class="jd">
      ${jdHeadHTML(key, total, info)}
      ${!manual.length && !batches.length
        ? `<div class="pf-empty">Nothing logged on this day.</div>` : ""}

      ${manual.length ? `
        <div class="jd-sec">
          <div class="jd-sec-head"><span>Manually Entered</span><span class="jd-tag manual">Manual</span></div>
          ${manual.map(({ acct, entry }) => `
            <div class="pf-item">
              <div class="pf-item-main jd-static">
                <span class="pf-item-txt">
                  <span class="pf-item-kind">${esc(entry.asset || entry.platform || "Trade")}</span>
                  <span class="pf-item-meta">${many ? esc(accountLabel(acct)) + " · " : ""}${
                    entry.entry || entry.exit ? `in ${esc(entry.entry || "—")} · out ${esc(entry.exit || "—")}` : "typed in"}</span>
                </span>
                <span class="pf-item-amt ${entry.pnl < 0 ? "neg" : "pos"}">${money(entry.pnl, true)}</span>
              </div>
              <button class="pf-item-del" data-jdelmanual="${esc(entry.id || "")}"
                      data-jdelacctid="${esc(acct.id)}" aria-label="Delete this trade"></button>
            </div>`).join("")}
        </div>` : ""}

      ${batches.map((b) => {
        const label = b.batch
          ? `${b.batch.broker}${b.batch.file ? " · " + b.batch.file : ""}`
          : "Imported CSV";
        const when = b.batch && b.batch.at
          ? new Date(b.batch.at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
          : "";
        return `
        <div class="jd-sec">
          <div class="jd-sec-head">
            <span>${esc(label)}</span><span class="jd-tag imported">Imported</span>
          </div>
          <div class="jd-batch-meta">${when ? `Imported ${esc(when)} · ` : ""}${
            b.batch ? `${b.batch.trades} trade${b.batch.trades === 1 ? "" : "s"} in this file` : "from an earlier import"}
            <br>Imported trades aren't edited here — re-upload a corrected file instead.</div>
          ${b.trades.map((t) => `
            <div class="pf-item">
              <div class="pf-item-main jd-static">
                <span class="pf-item-txt">
                  <span class="pf-item-kind">${esc(t.symbol || "Trade")}</span>
                  <span class="pf-item-meta">${many ? esc(accountLabel(b.acct)) + " · " : ""}${
                    /* the contract month, where the parser knew it — NQ says
                       what was traded, NQM5 says which contract */
                    t.contract && t.contract !== t.symbol ? esc(t.contract) + " · " : ""}${esc(t.side || "")}${
                    t.qty ? " · " + esc(String(t.qty)) : ""}</span>
                </span>
                <span class="pf-item-amt ${t.pnl < 0 ? "neg" : "pos"}">${money(t.pnl, true)}</span>
              </div>
            </div>`).join("")}
          <div class="jd-batch-acts">
            <button class="jd-act" data-jreplace="${esc(b.id)}" data-jdelacctid="${esc(b.acct.id)}">Re-upload / Replace CSV</button>
            <button class="jd-act danger" data-jdelbatch="${esc(b.id)}" data-jdelacctid="${esc(b.acct.id)}">Delete Import</button>
          </div>
        </div>`;
      }).join("")}
    </div>`;
  }

  function jdHeadHTML(key, total, info) {
    return `
      <div class="jd-head">
        <button class="jd-back" data-jdayback aria-label="Back to the calendar">‹</button>
        <div class="jd-title">
          <span class="jd-date">${esc(dayLabel(key))}</span>
          <span class="jd-total ${total < 0 ? "neg" : "pos"}">${info ? money(total, true) : "No trades"}</span>
        </div>
      </div>`;
  }

  /* Imported day totals and typed-in trades add together. This used to let an
     import shadow any manual trade on the same day, which the day view makes
     plainly wrong: it lists both but the header only counted one. */
  function journalDay(id, y, m, d) {
    const key = dayKey(y, m, d);
    const imp = (store.journalImport[id] || {})[key];
    const man = ((store.journalManual[id] || {})[key] || []);
    if (!imp && !man.length) return null;
    const t = man.reduce((a, x) => {
      a.pnl += x.pnl;
      if (x.pnl > 0) a.wins++; else if (x.pnl < 0) a.losses++;
      return a;
    }, imp ? { pnl: imp.pnl, wins: imp.wins, losses: imp.losses } : { pnl: 0, wins: 0, losses: 0 });
    return { pnl: Math.round(t.pnl * 100) / 100, wins: t.wins, losses: t.losses };
  }

  /* the same day across every account in scope, added together */
  function scopeDay(accts, y, m, d) {
    let hit = false;
    const t = accts.reduce((a, acc) => {
      const info = journalDay(acc.id, y, m, d);
      if (info) { hit = true; a.pnl += info.pnl; a.wins += info.wins; a.losses += info.losses; }
      return a;
    }, { pnl: 0, wins: 0, losses: 0 });
    return hit ? { pnl: Math.round(t.pnl * 100) / 100, wins: t.wins, losses: t.losses } : null;
  }
  function scopeBalance(accts) {
    return Math.round(accts.reduce((t, a) => t + accountBalance(a), 0) * 100) / 100;
  }

  function money(n, cents) {
    const v = Math.abs(n).toLocaleString("en-US", cents
      ? { minimumFractionDigits: 2, maximumFractionDigits: 2 } : { maximumFractionDigits: 0 });
    return (n < 0 ? "-$" : "+$") + v;
  }
  function plainMoney(n) {
    return "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  /* declared above renderJournal on purpose: it reads these, and a `let`
     further down the file would still be in its dead zone if anything ever
     renders the journal during module setup */
  let journalKeepScroll = false;
  let journalScrollTop = 0;

  /* re-render the journal without yanking the page back to the top: anything
     that expands or collapses in place has to leave the reader where they are */
  function renderJournalInPlace() {
    journalScrollTop = cardScroll.scrollTop;
    journalKeepScroll = true;
    renderJournal();
  }

  function renderJournal() {
    const all = store.journalAccounts || [];
    const acct = activeAccount();
    const scope = scopeAccounts();
    const catName = state.journalTab === "personal" ? "Live" : "Prop";
    barTitle.textContent = acct ? `${accountLabel(acct)} Journal` : `All ${catName} Accounts Journal`;

    const balance = scopeBalance(scope);
    const today = new Date();
    const todayInfo = scope.length
      ? scopeDay(scope, today.getFullYear(), today.getMonth(), today.getDate()) : null;
    const change = todayInfo ? todayInfo.pnl : 0;
    const pct = balance - change !== 0 ? Math.round((10000 * change) / (balance - change)) / 100 : 0;
    $("journalSummary").innerHTML = `
      <span class="j-broker">${esc(acct ? acct.platform
        : (scope.length ? `All ${scope.length} ${catName.toLowerCase()}` : "No accounts"))}</span>
      <span class="j-balance">${plainMoney(balance)}</span>
      <span class="j-change">
        <span class="j-change-label">Daily Change</span>
        <span class="${change < 0 ? "neg" : "pos"}">${money(change, true)} (${pct}%)</span>
      </span>`;

    /* Live Account · chevron · Prop Account, one line. The account list that
       used to sit inline under these pills now opens as the Select Account
       sheet from the chevron in the middle. */
    const tabs = `
      <div class="j-selector">
        <button class="j-acct-pill ${state.journalTab === "personal" ? "on" : ""}" data-jtab="personal">Live Account</button>
        <button class="j-drop ${state.journalPicker ? "open" : ""}" data-jpicktoggle
                aria-label="Select account" aria-expanded="${state.journalPicker ? "true" : "false"}">
          <img src="assets/nav-icons/icon-chevron-down@2x.png" alt="">
        </button>
        <button class="j-acct-pill ${state.journalTab === "prop" ? "on" : ""}" data-jtab="prop">Prop Account</button>
      </div>`;
    // expands in place between the pills and the calendar, pushing everything
    // below it further down the page
    const picker = accountPanelHTML();

    const propCard = propSummaryHTML();
    if (!scope.length) {
      cardScroll.innerHTML = tabs + picker + propCard + `
        <div class="liked-empty">No accounts yet.<br>
          Add one to start logging trades — it begins at the balance you enter, with an empty
          calendar. Everything here is typed in by you; nothing connects to a real broker.</div>`;
      cardScroll.scrollTop = journalKeepScroll ? journalScrollTop : 0;
      journalKeepScroll = false;
      fillAcctForm();
      wirePropForm();
      cardFooter.style.display = "none";
      return;
    }

    const base = journalDate();
    const y = base.getFullYear(), m = base.getMonth();
    const monthName = base.toLocaleDateString("en-US", { month: "long", year: "numeric" });
    const first = new Date(y, m, 1);
    const start = new Date(y, m, 1 - first.getDay());
    const cells = [];
    let total = 0, wins = 0, losses = 0;
    for (let i = 0; i < 42; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      const inMonth = d.getMonth() === m && d.getFullYear() === y;
      const info = inMonth ? scopeDay(scope, y, m, d.getDate()) : null;
      if (info) { total += info.pnl; wins += info.wins; losses += info.losses; }
      cells.push({ d, inMonth, pnl: info ? info.pnl : null });
    }
    while (cells.length > 35 && cells.slice(-7).every((c) => !c.inMonth)) cells.length -= 7;

    const weekTotal = (row) => cells.slice(row * 7, row * 7 + 7)
      .reduce((a, c) => a + (c.inMonth && c.pnl !== null ? c.pnl : 0), 0);

    let grid = "";
    for (let r = 0; r < cells.length / 7; r++) {
      for (let c = 0; c < 7; c++) {
        const cell = cells[r * 7 + c];
        if (!cell.inMonth) { grid += `<div class="j-day out">${cell.d.getDate()}</div>`; continue; }
        if (c === 6) {
          const wt = weekTotal(r);
          grid += `<div class="j-day j-week ${wt < 0 ? "loss" : wt > 0 ? "profit" : ""}">
            <span class="j-week-label">Total</span>
            <span class="j-date">${cell.d.getDate()}</span>
            <span class="j-pnl ${wt < 0 ? "neg" : "pos"}">${money(wt)}</span></div>`;
          continue;
        }
        const cls = cell.pnl === null ? "" : (cell.pnl < 0 ? "loss real" : cell.pnl > 0 ? "profit real" : "real");
        const dk = dayKey(cell.d.getFullYear(), cell.d.getMonth(), cell.d.getDate());
        grid += `<button class="j-day ${cls}" data-jday="${dk}">
          <span class="j-date">${cell.d.getDate()}</span>
          ${cell.pnl === null ? "" : `<span class="j-pnl ${cell.pnl < 0 ? "neg" : "pos"}">${money(cell.pnl)}</span>`}
        </button>`;
      }
    }

    const decided = wins + losses;   // break-even trades sit out of the denominator
    const winRate = decided ? Math.round((1000 * wins) / decided) / 10 : 0;
    const calendarHTML = `
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
      </div>`;

    const middle = state.journalDay ? dayViewHTML(scope, state.journalDay)
      : state.journalSection === "calendar" ? calendarHTML : sectionHTML(scope);
    cardScroll.innerHTML = tabs + picker + propCard + middle + `
      <div class="j-add-wrap">
        <button class="j-add" data-jadd aria-label="Add a trade"></button>
        <span class="j-add-label">Add Trade</span>
      </div>
      <input id="jCsvFile" class="j-file" type="file" accept=".csv,text/csv">
      <button class="j-cash" data-jcash>Deposit / Withdraw</button>
      ${statRowHTML()}`;
    // Opening the journal starts at the top, but re-rendering it in place —
    // expanding the account panel, switching modes inside it — must not yank
    // the page back to the top under the user's finger.
    cardScroll.scrollTop = journalKeepScroll ? journalScrollTop : 0;
    journalKeepScroll = false;
    fillAcctForm();
    wirePropForm();
    cardFooter.style.display = "none";
  }

  /* ---- add an account ---- */
  /* ---------------- Select Account: inline dropdown ----------------
     Expands in place under the Live/Prop pills and pushes the calendar and
     everything below it down the page — deliberately not an overlay. Nothing
     in this app floats over a blurred backdrop any more.

     state.journalPicker is the panel's mode:
       null | "list" | "add" | "edit" | "delete"
     with state.journalPickerId naming the account being edited or deleted. */

  function acctDayChange(a) {
    const t = new Date();
    const info = scopeDay([a], t.getFullYear(), t.getMonth(), t.getDate());
    return info ? info.pnl : 0;
  }

  /* The logo box: the delivered frame is the container's background and the
     brand mark is a separate <img> laid inside it, composited at render time
     rather than pre-flattened. object-fit:contain is what keeps Top Step (very
     wide) and TastyTrade (square) both undistorted inside the same square. */
  function logoBoxHTML(platform) {
    const src = logoFor(platform);
    return `<span class="ad-logo" aria-hidden="true">${src
      ? `<img src="${esc(src)}" alt="">`
      : `<span class="ad-logo-txt">${esc((platform || "?").slice(0, 1).toUpperCase())}</span>`}</span>`;
  }

  /* whole dollars in the dropdown, matching the reference — the exact figure
     to the cent is always on the bar above */
  function dropMoney(n) {
    return (n < 0 ? "-$" : "$") + Math.round(Math.abs(n)).toLocaleString("en-US");
  }

  function acctRowHTML(a, selected) {
    return `<button class="ad-row ${selected ? "on" : ""}" data-jacct="${esc(a.id)}">
      ${logoBoxHTML(a.platform)}
      <span class="ad-id">
        <span class="ad-name"><span class="ad-nametext">${esc(accountLabel(a))}</span>${
          selected ? `<span class="ad-current">Current</span>` : ""}</span>
        <span class="ad-kind">${a.category === "prop" ? "Prop Account" : "Live Account"}</span>
      </span>
      <span class="ad-bal">${dropMoney(accountBalance(a))}</span>
      <span class="ad-check" aria-hidden="true"></span>
    </button>`;
  }

  /* The whole inline panel, in whichever mode it is currently in. Returns ""
     when closed, so the journal simply has nothing between the pills and the
     calendar and the page collapses back up. */
  function accountPanelHTML() {
    if (!state.journalPicker) return "";
    const mode = state.journalPicker;
    const list = accountsIn(state.journalTab);
    const inner = mode === "add" ? acctFormHTML(null)
      : mode === "edit" ? acctEditHTML(list)
      : mode === "delete" ? acctDeleteHTML(list)
      : acctListHTML(list);
    return `<div class="ad-panel" id="acctPanel">${inner}</div>`;
  }

  function acctListHTML(list) {
    const catName = state.journalTab === "personal" ? "Live" : "Prop";
    const acct = activeAccount();
    const linked = isCombined() && list.length > 0;
    return `
      <div class="ad-head">
        <span class="ad-title">Select Account</span>
        <button class="ad-linkall ${linked ? "on" : ""}" data-jlinkall
                ${list.length ? "" : "disabled"}>
          <span>${linked ? "Unlink All" : "Link All"}</span>
          <span class="ad-linkicon" aria-hidden="true"></span>
        </button>
      </div>
      <div class="ad-list">
        ${list.length ? `
          <button class="ad-row ad-all ${linked ? "on" : ""}" data-jacct="__all">
            <span class="ad-logo ad-logo-all" aria-hidden="true"><span class="ad-logo-txt">∑</span></span>
            <span class="ad-id">
              <span class="ad-name"><span class="ad-nametext">All ${esc(catName)} Accounts</span>${
                linked ? `<span class="ad-current">Current</span>` : ""}</span>
              <span class="ad-kind">${list.length} account${list.length === 1 ? "" : "s"} combined</span>
            </span>
            <span class="ad-bal">${dropMoney(scopeBalance(list))}</span>
            <span class="ad-check" aria-hidden="true"></span>
          </button>` : ""}
        ${list.map((a) => acctRowHTML(a, !!acct && a.id === acct.id)).join("")}
        ${list.length ? "" : `<div class="ad-empty">No ${esc(catName.toLowerCase())} accounts yet — add one below.</div>`}
      </div>
      ${acctActionsHTML(list.length)}`;
  }

  function acctActionsHTML(count) {
    const off = count ? "" : " off";
    const dis = count ? "" : " disabled";
    return `<div class="ad-actions">
      <button class="ad-act ad-act-add" data-jaddacct aria-label="Add account"></button>
      <button class="ad-act ad-act-edit${off}"${dis} data-jeditlist aria-label="Edit accounts"></button>
      <button class="ad-act ad-act-del${off}"${dis} data-jdellist aria-label="Delete accounts"></button>
      <button class="ad-act ad-act-close" data-jpickclose aria-label="Close account selector"></button>
    </div>`;
  }

  function acctEditHTML(list) {
    if (state.journalPickerId) {
      const a = (store.journalAccounts || []).find((x) => x.id === state.journalPickerId);
      if (a) return acctFormHTML(a);
    }
    return `
      <div class="ad-head"><span class="ad-title">Edit Accounts</span></div>
      <div class="ad-note">Pick the account to edit.</div>
      <div class="ad-list">
        ${list.map((a) => `
          <button class="ad-row" data-jeditacct="${esc(a.id)}">
            ${logoBoxHTML(a.platform)}
            <span class="ad-id">
              <span class="ad-name"><span class="ad-nametext">${esc(accountLabel(a))}</span></span>
              <span class="ad-kind">${plainMoney(accountBalance(a))}</span>
            </span>
            <span class="ad-go">Edit</span>
          </button>`).join("")}
      </div>
      <button class="ad-back" data-jpick>Back</button>`;
  }

  function acctDeleteHTML(list) {
    if (state.journalPickerId) {
      const a = (store.journalAccounts || []).find((x) => x.id === state.journalPickerId);
      if (a) return `
        <div class="ad-head"><span class="ad-title">Delete Account</span></div>
        <div class="ad-confirm">Delete <b>${esc(accountLabel(a))}</b>?<br>
          Its trades, imports and cash ledger go with it. This can't be undone.</div>
        <button class="ad-danger" data-jdelconfirm="${esc(a.id)}">Delete Account</button>
        <button class="ad-back" data-jdellist>Cancel</button>`;
    }
    return `
      <div class="ad-head"><span class="ad-title">Delete Accounts</span></div>
      <div class="ad-note">Removing an account also removes its trades, imports and cash ledger.</div>
      <div class="ad-list">
        ${list.map((a) => `
          <button class="ad-row" data-jdelacct="${esc(a.id)}">
            ${logoBoxHTML(a.platform)}
            <span class="ad-id">
              <span class="ad-name"><span class="ad-nametext">${esc(accountLabel(a))}</span></span>
              <span class="ad-kind">${plainMoney(accountBalance(a))}</span>
            </span>
            <span class="ad-go danger">Delete</span>
          </button>`).join("")}
      </div>
      <button class="ad-back" data-jpick>Back</button>`;
  }

  /* One form for both add and edit — `a` null means add. */
  function acctFormHTML(a) {
    const known = a ? PLATFORMS.indexOf(a.platform) >= 0 : true;
    const cat = a ? a.category : state.journalTab;
    return `
      <div class="ad-head"><span class="ad-title">${a ? "Edit Account" : "Add Account"}</span></div>
      <div class="ad-note">Manual tracking only — you type the name and the balance.
        Nothing links to a real brokerage.</div>
      <form id="acctForm" autocomplete="off" novalidate ${a ? `data-edit="${esc(a.id)}"` : ""}>
        <label class="mt-label">Platform
          <select class="mt-input" name="platform">
            ${BROKERS.map((b) => `<option value="${esc(b.name)}" ${a && b.name === a.platform ? "selected" : ""}>${esc(b.name)}</option>`).join("")}
            <option value="__custom" ${a && !known ? "selected" : ""}>Other (type it in)</option>
          </select>
        </label>
        <label class="mt-label mt-custom ${a && !known ? "" : "hidden"}">Platform name
          <input class="mt-input" name="custom" type="text" placeholder="Your platform"></label>
        <label class="mt-label">Nickname (optional)
          <input class="mt-input" name="nickname" type="text" placeholder="Main Account, Swing Account…"></label>
        <label class="mt-label">Starting balance ($)
          <input class="mt-input" name="start" type="text" inputmode="decimal" placeholder="0.00"></label>
        <label class="mt-label">Category
          <select class="mt-input" name="category">
            <option value="personal" ${cat === "personal" ? "selected" : ""}>Live Account</option>
            <option value="prop" ${cat === "prop" ? "selected" : ""}>Prop Account</option>
          </select>
        </label>
        ${a ? `<div class="ad-note">Starting balance is what the account opened at — trades and
          cash moves are added on top, so editing it shifts the balance by the difference and
          leaves the history alone.</div>` : ""}
        <div id="acctError" class="gate-error hidden"></div>
        <button type="button" class="ad-save" data-${a ? "jsaveedit" : "jsaveacct"}>${a ? "Save Changes" : "Add Account"}</button>
        <button type="button" class="ad-back" data-${a ? "jeditlist" : "jpick"}>Cancel</button>
      </form>`;
  }

  /* Values that came from the user go in as properties after the markup is
     live, never interpolated into a value="..." attribute. */
  function fillAcctForm() {
    const f = $("acctForm");
    if (!f || !f.dataset.edit) return;
    const a = (store.journalAccounts || []).find((x) => x.id === f.dataset.edit);
    if (!a) return;
    if (PLATFORMS.indexOf(a.platform) < 0) f.querySelector('[name="custom"]').value = a.platform;
    f.querySelector('[name="nickname"]').value = a.nickname || "";
    f.querySelector('[name="start"]').value = a.start;
  }

  function setPicker(mode, id) {
    journalScrollTop = cardScroll.scrollTop;
    journalKeepScroll = true;
    // a confirm step names one account's trade; changing accounts voids it
    state.journalDelete = null;
    state.journalPicker = mode;
    state.journalPickerId = id || null;
    renderJournal();
  }

  function saveEditedAccount() {
    const f = $("acctForm");
    if (!f) return;
    const a = (store.journalAccounts || []).find((x) => x.id === f.dataset.edit);
    if (!a) return;
    const get = (n) => (new FormData(f).get(n) || "").toString().trim();
    const err = $("acctError");
    const platform = get("platform") === "__custom" ? get("custom") : get("platform");
    if (!platform) { err.textContent = "Name the platform."; err.classList.remove("hidden"); return; }
    const startRaw = get("start").replace(/[^0-9.\-]/g, "");
    const start = startRaw === "" ? 0 : parseFloat(startRaw);
    if (isNaN(start)) { err.textContent = "Starting balance must be a number."; err.classList.remove("hidden"); return; }
    a.platform = platform;
    a.nickname = get("nickname");
    a.start = Math.round(start * 100) / 100;
    a.category = get("category") || "personal";
    state.journalTab = a.category;      // follow it if the category changed
    save();
    setPicker("list");
  }

  function deleteAccount(id) {
    store.journalAccounts = (store.journalAccounts || []).filter((a) => a.id !== id);
    delete store.journalImport[id];
    delete store.journalManual[id];
    delete store.journalTrades[id];
    delete store.propLedger[id];
    if (store.journalActive === id) store.journalActive = "__all";
    save();
    setPicker("list");
  }

  function saveAccount() {
    const f = $("acctForm");
    const get = (n) => (new FormData(f).get(n) || "").toString().trim();
    const err = $("acctError");
    const platform = get("platform") === "__custom" ? get("custom") : get("platform");
    if (!platform) { err.textContent = "Name the platform."; err.classList.remove("hidden"); return; }
    const startRaw = get("start").replace(/[^0-9.\-]/g, "");
    const start = startRaw === "" ? 0 : parseFloat(startRaw);
    if (isNaN(start)) { err.textContent = "Starting balance must be a number."; err.classList.remove("hidden"); return; }
    const id = "acct-" + Date.now().toString(36);
    if (!store.journalAccounts) store.journalAccounts = [];
    store.journalAccounts.push({
      id, platform, nickname: get("nickname"), category: get("category") || "personal",
      start: Math.round(start * 100) / 100, ledger: [], addedAt: new Date().toISOString(),
    });
    store.journalActive = id;
    state.journalTab = get("category") || "personal";
    save();
    setPicker("list");
  }

  /* ---- deposits and withdrawals ---- */
  function openCashFlow() {
    const a = activeAccount();
    if (!a) {
      openOverlay(panelHead("Deposit / Withdraw") + `
        <div class="liked-empty">Pick a single account first — deposits and withdrawals
          belong to one account, not the combined view.</div>
        <button class="btn-primary" data-close>Got it</button>`);
      return;
    }
    const log = (a.ledger || []).slice().reverse().slice(0, 8);
    openOverlay(panelHead("Deposit / Withdraw") + `
      <div class="notes-hint" style="margin:0 0 12px">${esc(accountLabel(a))} — balance ${plainMoney(accountBalance(a))}</div>
      <form id="cashForm" autocomplete="off" novalidate>
        <label class="mt-label">Type
          <select class="mt-input" name="type">
            <option value="deposit">Deposit</option>
            <option value="withdrawal">Withdrawal</option>
          </select>
        </label>
        <label class="mt-label">Amount ($)
          <input class="mt-input" name="amount" type="text" inputmode="decimal" placeholder="0.00"></label>
        <label class="mt-label">Date
          <input class="mt-input mt-date" name="date" type="date" value="${todayKey()}"></label>
        <div id="cashError" class="gate-error hidden"></div>
        <button type="button" class="btn-primary" data-jsavecash>Log It</button>
      </form>
      ${log.length ? `<div class="liked-group-title">Recent</div>
        ${log.map((e) => `<div class="j-ledger">
          <span>${esc(e.date)} · ${e.amount < 0 ? "Withdrawal" : "Deposit"}</span>
          <span class="${e.amount < 0 ? "neg" : "pos"}">${money(e.amount, true)}</span>
        </div>`).join("")}` : ""}`);
  }

  function saveCashFlow() {
    const a = activeAccount();
    const f = $("cashForm");
    const err = $("cashError");
    const get = (n) => (new FormData(f).get(n) || "").toString().trim();
    const amt = parseFloat(get("amount").replace(/[^0-9.]/g, ""));
    if (isNaN(amt) || amt <= 0) { err.textContent = "Enter an amount."; err.classList.remove("hidden"); return; }
    const signed = get("type") === "withdrawal" ? -amt : amt;
    a.ledger = a.ledger || [];
    a.ledger.push({ date: get("date") || todayKey(), amount: Math.round(signed * 100) / 100, type: get("type") });
    save();
    closeOverlay();
    renderJournal();
  }

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
    const account = activeAccount();
    if (!account) {
      err.textContent = (store.journalAccounts || []).length
        ? "Pick a single account first — trades can't go into the combined view."
        : "Add an account first.";
      err.classList.remove("hidden");
      return;
    }
    const acct = store.journalManual[account.id] || (store.journalManual[account.id] = {});
    const pnl = Math.round(amount * 100) / 100;
    const entryId = jtId();
    (acct[day] || (acct[day] = [])).push({
      id: entryId,
      platform: val("platform"), asset: val("asset"),
      entry: val("entry"), exit: val("exit"),
      pnl, loggedAt: new Date().toISOString(),
    });
    // a winner with exit above entry is a long, as is a loser with exit below
    const en = parseFloat(val("entry")), ex = parseFloat(val("exit"));
    const side = (!isNaN(en) && !isNaN(ex) && en !== ex)
      ? (((ex > en) === (pnl >= 0)) ? "Long" : "Short") : "Long";
    addTradeRecords(account.id, [{
      id: entryId, source: "manual",
      date: day, symbol: val("asset"), side, qty: "", pnl,
    }]);
    save();
    const d = day.split("-");
    state.journalMonth = monthOffsetFor(+d[0], +d[1] - 1);
    renderJournal();
    openOverlay(panelHead("Trade Saved") + `
      <div class="liked-empty">${money(Math.round(amount * 100) / 100, true)}
        logged for ${new Date(+d[0], +d[1] - 1, +d[2]).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}.</div>
      <button class="btn-primary" data-close>Done</button>`);
  }

  /* Delegated on document so it survives every re-render of the journal —
     the file input is recreated each time renderJournal() runs. */
  document.addEventListener("change", (e) => {
    if (e.target && e.target.classList && e.target.classList.contains("j-range")) {
      state.journalRange = e.target.value;
      renderJournal();
      return;
    }
    // the account form lives inside a panel that re-renders, so this can't be
    // a listener bound at build time the way it was on the old overlay
    if (e.target && e.target.name === "platform" && e.target.closest("#acctForm")) {
      const custom = e.target.closest("#acctForm").querySelector(".mt-custom");
      if (custom) custom.classList.toggle("hidden", e.target.value !== "__custom");
      return;
    }
    if (!e.target || e.target.id !== "jCsvFile" || !e.target.files || !e.target.files[0]) return;
    const input = e.target;
    const reader = new FileReader();
    reader.onload = () => {
      let res;
      const repl = state.journalReplace;
      state.journalReplace = null;
      try {
        res = importCsvText(String(reader.result),
          (input.files[0] && input.files[0].name) || "",
          repl && repl.batchId);
      } catch (err) {
        openOverlay(panelHead("Import Failed") + `
          <div class="liked-empty">${esc(err.message || "Could not read that file.")}</div>
          <button class="btn-primary" data-close>Close</button>`);
        input.value = "";
        return;
      }
      // jump to the month the trades landed in, so the change is visible
      const last = res.days[res.days.length - 1].split("-");
      state.journalMonth = monthOffsetFor(+last[0], +last[1] - 1);
      renderJournal();
      const span = res.days.length === 1
        ? new Date(+last[0], +last[1] - 1, +last[2]).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
        : `${res.days.length} days`;
      // an account statement carries plenty that isn't a trade; say what was
      // left out rather than silently dropping it
      const notes = [];
      if (res.open) notes.push(`${res.open} position${res.open === 1 ? "" : "s"} still open — held back from the P&amp;L record.`);
      if (res.drip) notes.push(`${res.drip} dividend reinvestment buy${res.drip === 1 ? "" : "s"} skipped as noise.`);
      if (res.orphanCloses) notes.push(`${res.orphanCloses} closing leg${res.orphanCloses === 1 ? "" : "s"} had no opening row in this file, so no P&amp;L could be worked out for ${res.orphanCloses === 1 ? "it" : "them"}.`);
      if (res.skipped) notes.push(`${res.skipped} non-trade row${res.skipped === 1 ? "" : "s"} ignored${res.skippedNote ? ` (${esc(res.skippedNote)})` : ""}.`);
      openOverlay(panelHead(res.replaced ? "Import Replaced" : "Import Complete") + `
        <div class="liked-empty">${res.trades} ${res.broker} trade${res.trades === 1 ? "" : "s"}
          imported across ${span}.${res.replaced ? "<br>The import it replaces has been removed." : ""}<br>Day totals on the calendar now use the broker record.
          ${notes.length ? `<br><br>${notes.join("<br>")}` : ""}</div>
        <button class="btn-primary" data-close>Done</button>`);
      input.value = "";
    };
    reader.onerror = () => { input.value = ""; };
    reader.readAsText(input.files[0]);
  });

  function openJournal() {
    stopAudio();
    state.view = "journal";
    state.slideDir = 0;
    state.journalDay = null;
    state.journalDelete = null;
    closeOverlay();
    render();
  }

  /* Start Day and Before Trade are the same section: same bar, same dock slot */
  function inChecklist() {
    return state.view === "checkin" || state.view === "beforetrade";
  }

  /* every Gameæway view — the selector and both games — shares the same bar
     and the same dock slot */
  const PK_VIEWS = ["games", "pickaeway", "buildmatch", "match", "result", "replay", "pointaeway"];
  function inPickaeway() { return PK_VIEWS.indexOf(state.view) >= 0; }

  /* ring behind whichever dock icon matches the section you're in */
  function syncDockActive() {
    $("navCheckin").classList.toggle("active", inChecklist());
    $("navAdd").classList.toggle("active", state.view === "journal");
    $("navBattle").classList.toggle("active", inPickaeway());
    $("navPlay").classList.toggle("active", state.view === "videos");
    $("navProfile").classList.toggle("active", state.view === "profile");
  }

  /* each of these views swaps its own bar in for the progress bar */
  function syncCheckinChrome() {
    const on = inChecklist();
    const jr = state.view === "journal";
    const pk = inPickaeway();
    const pr = state.view === "profile";
    checkinBar.classList.toggle("hidden", !on);
    $("journalBar").classList.toggle("hidden", !jr);
    $("pickBar").classList.toggle("hidden", !pk);
    $("profileBar").classList.toggle("hidden", !pr);
    document.querySelectorAll(".bar")[1].classList.toggle("hidden", on || jr || pk || pr);
    // date/time runs on every screen, so the timer is never torn down; only
    // Check-In needs its streak repainted as the run changes
    if (on) paintStreak();
  }

  function render() {
    // navigating anywhere other than the library closes the player
    if (state.videoId && state.view !== "videos") tearDownPlayer();
    // leaving mid-match forfeits it: stop the clock rather than leave a rAF
    // loop repainting a canvas that is no longer on screen
    if (state.view !== "match" && mk.on) mkAbort();
    if (state.view !== "pointaeway") pwAbort();
    const listy = state.view === "home" || state.view === "videos"
      || inChecklist() || state.view === "journal" || state.view === "profile" || inPickaeway();
    $("cardOuter").classList.toggle("outline-bg", listy);
    if (!inChecklist()) cardScroll.classList.remove("ci-resulting");
    syncCheckinChrome();
    syncDockActive();
    if (state.view === "home") renderHome();
    else if (state.view === "videos") renderVideos();
    else if (state.view === "checkin") renderCheckin();
    else if (state.view === "beforetrade") renderBeforeTrade();
    else if (state.view === "journal") renderJournal();
    else if (state.view === "games") renderGames();
    else if (state.view === "pickaeway") renderPickaeway();
    else if (state.view === "pointaeway") renderPointaeway();
    else if (state.view === "buildmatch") renderBuildMatch();
    else if (state.view === "match") renderMatch();
    else if (state.view === "result") renderResult();
    else if (state.view === "replay") renderReplay();
    else if (state.view === "profile") renderProfile();
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
        <div class="set-label">Profile photo</div>
        <div class="set-photo">
          <span class="set-photo-ring">
            <img src="${store.profilePhoto || "assets/nav-icons/icon-user@2x.png"}"
                 class="${store.profilePhoto ? "shot" : ""}" alt="">
          </span>
          <div class="set-photo-btns">
            <button class="set-opt" data-photo-pick>${store.profilePhoto ? "Change Photo" : "Upload Profile Photo"}</button>
            ${store.profilePhoto ? `<button class="set-opt" data-photo-clear>Remove</button>` : ""}
          </div>
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
  /* ==================== Profile screen ====================
     Two modes: `view` renders the profile the way another trader would see it
     — only the links that are filled in, only the markets that are picked —
     with the owner's own controls (Edit Profile, and the Connect section)
     appended below it. `edit` swaps the same sections for their fields.

     NOTHING HERE TALKS TO A BACKEND. Every value lives in store.profile in
     localStorage and the connect code is generated on this device, so two
     phones would happily mint the same one. What has to change when real
     accounts exist is marked ==> BACKEND below. */

  const PROFILE_BIO_MAX = 140;

  const MARKET_FOCUS = [
    { id: "stocks", label: "Stocks" },
    { id: "options", label: "Options" },
    { id: "futures", label: "Futures" },
    { id: "crypto", label: "Crypto" },
    { id: "prop", label: "Prop Firm" },
    { id: "prediction", label: "Prediction" },
    { id: "binary", label: "Binary Options" },
  ];

  const PROFILE_LINKS = [
    { id: "x", label: "X", placeholder: "@handle or link" },
    { id: "instagram", label: "Instagram", placeholder: "@handle or link" },
    { id: "linkedin", label: "LinkedIn", placeholder: "linkedin.com/in/…" },
    { id: "youtube", label: "YouTube", placeholder: "@channel or link" },
    { id: "discord", label: "Discord", placeholder: "username or invite" },
    { id: "website", label: "Website", placeholder: "yoursite.com" },
  ];

  /* Ambiguous characters left out so a code can be read down a phone line */
  const CONNECT_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const CONNECT_RE = /^AEW-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/;

  /* ==> BACKEND: the code has to be issued by the server and unique across all
     users. Generating it here means it is only unique on this device. */
  function connectCode() {
    const p = store.profile;
    if (!p.connectCode) {
      let c = "";
      for (let i = 0; i < 6; i++) c += CONNECT_ALPHABET[Math.floor(Math.random() * CONNECT_ALPHABET.length)];
      p.connectCode = `AEW-${c}`;
      save();
    }
    return p.connectCode;
  }

  /* accepts "aew-ab12cd", "AB12CD" or with stray spaces; returns the canonical
     form, or "" when it isn't a code at all */
  function normaliseConnectCode(raw) {
    let v = String(raw == null ? "" : raw).toUpperCase().replace(/[\s_]/g, "");
    if (v.indexOf("AEW-") !== 0) v = `AEW-${v.replace(/^AEW/, "")}`;
    return CONNECT_RE.test(v) ? v : "";
  }

  function profileName() {
    const p = store.profile;
    const n = `${p.firstName || ""} ${p.lastName || ""}`.trim();
    return n || store.settings.name || "Your Profile";
  }

  function profileYears() {
    const now = new Date().getFullYear();
    const out = [];
    for (let y = now; y >= now - 60; y--) out.push(String(y));
    return out;
  }

  function marketLabel(id) {
    const m = MARKET_FOCUS.find((x) => x.id === id);
    return m ? m.label : id;
  }

  /* a link's display text: a bare handle stays a handle, a URL loses its
     scheme and trailing slash so the row doesn't wrap */
  function linkText(value) {
    return String(value || "").trim()
      .replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/$/, "");
  }
  function linkHref(id, value) {
    const v = String(value || "").trim();
    if (/^https?:\/\//i.test(v)) return v;
    if (v.indexOf("@") === 0) {
      const handle = v.slice(1);
      if (id === "x") return `https://x.com/${handle}`;
      if (id === "instagram") return `https://instagram.com/${handle}`;
      if (id === "youtube") return `https://youtube.com/@${handle}`;
    }
    if (id === "discord") return "";        // usernames aren't addressable
    return `https://${v}`;
  }

  /* ---------------- view mode ---------------- */

  function profileHeaderHTML() {
    const p = store.profile;
    return `
      <div class="pr-head">
        <button class="pr-photo" data-photo-pick aria-label="Change profile picture">
          <img src="${store.profilePhoto || "assets/nav-icons/icon-user@2x.png"}"
               class="${store.profilePhoto ? "shot" : ""}" alt="">
          <span class="pr-photo-edit" aria-hidden="true">Edit</span>
        </button>
        <div class="pr-name">${esc(profileName())}</div>
        ${p.username ? `<div class="pr-user">@${esc(p.username)}</div>` : ""}
        ${p.location ? `<div class="pr-loc">${esc(p.location)}</div>` : ""}
        ${p.bio ? `<div class="pr-bio">${esc(p.bio)}</div>` : ""}
      </div>`;
  }

  function profileViewHTML() {
    const p = store.profile;
    const links = PROFILE_LINKS.filter((l) => (p.links[l.id] || "").trim());
    return `
      ${profileHeaderHTML()}

      <div class="pr-sec">
        <div class="pr-sec-head">Market Focus</div>
        ${p.markets.length
          ? `<div class="pr-tags">${p.markets.map((m) =>
              `<span class="pr-tag">${esc(marketLabel(m))}</span>`).join("")}</div>`
          : `<div class="pr-empty">No markets picked yet.</div>`}
      </div>

      <div class="pr-sec">
        <div class="pr-sec-head">Experience</div>
        ${p.tradingSince || p.investingSince ? `
          <div class="pr-facts">
            ${p.tradingSince ? `<div class="pr-fact"><span>Trading since</span><b>${esc(p.tradingSince)}</b></div>` : ""}
            ${p.investingSince ? `<div class="pr-fact"><span>Investing since</span><b>${esc(p.investingSince)}</b></div>` : ""}
          </div>` : `<div class="pr-empty">No years set yet.</div>`}
      </div>

      <div class="pr-sec">
        <div class="pr-sec-head">Links</div>
        ${links.length ? `<div class="pr-links">
          ${links.map((l) => {
            const href = linkHref(l.id, p.links[l.id]);
            const inner = `<span class="pr-link-k">${esc(l.label)}</span>
              <span class="pr-link-v">${esc(linkText(p.links[l.id]))}</span>`;
            // an unaddressable handle still shows, it just isn't a link
            return href
              ? `<a class="pr-link" href="${esc(href)}" target="_blank" rel="noopener noreferrer">${inner}</a>`
              : `<span class="pr-link">${inner}</span>`;
          }).join("")}
        </div>` : `<div class="pr-empty">No links added yet.</div>`}
      </div>

      <div class="pr-owner">
        <div class="pr-owner-note">Only visible to you</div>
        <button class="ad-save" data-pr-edit>Edit Profile</button>
        ${profileConnectHTML()}
      </div>`;
  }

  /* ---------------- connect ----------------
     ==> BACKEND: sending a request has to POST to the server, which resolves
     the code to a user, records a pending request and notifies them. Right now
     the code is only checked for shape and the request is pushed onto a local
     list, so nothing reaches anybody. */
  function profileConnectHTML() {
    const p = store.profile;
    const n = state.profileNotice;
    return `
      <div class="pr-sec pr-connect">
        <div class="pr-sec-head">Connect</div>
        <div class="pr-code-cap">Your connect code</div>
        <div class="pr-code" id="prCode">${esc(connectCode())}</div>
        <button class="pr-code-btn" data-pr-share>${
          navigator.share ? "Share Code" : "Copy Code"}</button>

        <div class="pr-code-sub">Have someone else's code? Send them a request.</div>
        <input class="mt-input pr-code-input" id="prCodeInput" type="text"
               inputmode="latin" autocapitalize="characters" autocomplete="off" spellcheck="false"
               maxlength="10" placeholder="AEW-XXXXXX" value="${esc(state.profileCodeDraft || "")}">
        <button class="ad-save" data-pr-request>Send Request</button>
        ${n ? `<div class="pr-notice ${esc(n.kind)}">${esc(n.text)}</div>` : ""}
        ${p.requestsSent.length ? `
          <div class="pr-sent-head">Requests sent</div>
          ${p.requestsSent.map((r) => `
            <div class="pr-sent">
              <span>${esc(r.code)}</span>
              <span class="pr-sent-state">Pending</span>
            </div>`).join("")}` : ""}
        <div class="pr-stub">Not wired up yet — requests are held on this device
          only and reach nobody until accounts are live.</div>
      </div>`;
  }

  /* ---------------- edit mode ---------------- */

  function profileEditHTML() {
    const p = store.profile;
    const years = profileYears();
    const left = PROFILE_BIO_MAX - (p.bio || "").length;
    return `
      ${profileHeaderHTML()}
      <form id="prForm" autocomplete="off" novalidate>
        <div class="pr-sec">
          <div class="pr-sec-head">Header</div>
          <div class="mt-row">
            <label class="mt-label">First name
              <input class="mt-input" name="firstName" type="text" value="${esc(p.firstName)}"></label>
            <label class="mt-label">Last name
              <input class="mt-input" name="lastName" type="text" value="${esc(p.lastName)}"></label>
          </div>
          <label class="mt-label">Username
            <input class="mt-input" name="username" type="text" placeholder="without the @" value="${esc(p.username)}"></label>
          <label class="mt-label">State / Country
            <input class="mt-input" name="location" type="text" placeholder="Texas, USA" value="${esc(p.location)}"></label>
          <label class="mt-label">Bio
            <textarea class="mt-input pr-bio-input" name="bio" id="prBio"
                      maxlength="${PROFILE_BIO_MAX}" rows="3">${esc(p.bio)}</textarea>
            <span class="pr-count ${left <= 20 ? "low" : ""}" id="prBioCount">${left} left</span>
          </label>
        </div>

        <div class="pr-sec">
          <div class="pr-sec-head">Market Focus</div>
          <div class="pr-checks">
            ${MARKET_FOCUS.map((m) => `
              <button type="button" class="bt-opt${p.markets.indexOf(m.id) >= 0 ? " on" : ""}"
                      data-pr-market="${m.id}"
                      aria-pressed="${p.markets.indexOf(m.id) >= 0}">${esc(m.label)}</button>`).join("")}
          </div>
        </div>

        <div class="pr-sec">
          <div class="pr-sec-head">Experience</div>
          <label class="mt-label">Trading since
            <select class="mt-input" name="tradingSince">
              <option value="">—</option>
              ${years.map((y) => `<option value="${y}"${p.tradingSince === y ? " selected" : ""}>${y}</option>`).join("")}
            </select>
          </label>
          <label class="mt-label">Investing since <span class="pr-opt">optional</span>
            <select class="mt-input" name="investingSince">
              <option value="">Skip</option>
              ${years.map((y) => `<option value="${y}"${p.investingSince === y ? " selected" : ""}>${y}</option>`).join("")}
            </select>
          </label>
        </div>

        <div class="pr-sec">
          <div class="pr-sec-head">Links</div>
          <div class="pr-sec-note">Leave a field empty and it stays off your profile.</div>
          ${PROFILE_LINKS.map((l) => `
            <label class="mt-label">${esc(l.label)}
              <input class="mt-input" name="link_${l.id}" type="text"
                     placeholder="${esc(l.placeholder)}" value="${esc(p.links[l.id] || "")}"></label>`).join("")}
        </div>

        <button type="button" class="ad-save" data-pr-save>Save Profile</button>
        <button type="button" class="ad-back" data-pr-cancel>Cancel</button>
      </form>`;
  }

  function renderProfile() {
    barTitle.textContent = "Learnæway";
    const nameEl = $("profileBarName");
    if (nameEl) nameEl.textContent = state.profileMode === "edit" ? "Edit Profile" : profileName();
    cardScroll.innerHTML = state.profileMode === "edit" ? profileEditHTML() : profileViewHTML();
    cardScroll.scrollTop = prKeepScroll ? prScrollTop : 0;
    prKeepScroll = false;
    cardFooter.style.display = "none";
    wireProfileForm();
  }

  let prKeepScroll = false;
  let prScrollTop = 0;
  function renderProfileInPlace() {
    prScrollTop = cardScroll.scrollTop;
    prKeepScroll = true;
    renderProfile();
  }

  /* the bio counter updates as it is typed, without re-rendering the field out
     from under the cursor */
  function wireProfileForm() {
    const bio = $("prBio");
    const count = $("prBioCount");
    if (bio && count) {
      bio.addEventListener("input", () => {
        const left = PROFILE_BIO_MAX - bio.value.length;
        count.textContent = `${left} left`;
        count.classList.toggle("low", left <= 20);
      });
    }
  }

  /* the form's own fields are the source of truth while editing: a market
     toggle re-renders, so whatever is typed has to be carried across */
  function readProfileForm() {
    const f = $("prForm");
    if (!f) return;
    const get = (n) => { const el = f.querySelector(`[name="${n}"]`); return el ? el.value.trim() : ""; };
    const p = store.profile;
    p.firstName = get("firstName");
    p.lastName = get("lastName");
    p.username = get("username").replace(/^@/, "");
    p.location = get("location");
    p.bio = get("bio").slice(0, PROFILE_BIO_MAX);
    p.tradingSince = get("tradingSince");
    p.investingSince = get("investingSince");
    PROFILE_LINKS.forEach((l) => { p.links[l.id] = get(`link_${l.id}`); });
    // the display name the rest of the app already uses
    const full = `${p.firstName} ${p.lastName}`.trim();
    p.name = full;
    if (full) store.settings.name = full;
  }

  /* Share sheet where the device has one, clipboard otherwise, and a manual
     select as the last resort — clipboard writes need a secure context and
     silently reject in a few embedded browsers. */
  function shareConnectCode(btn) {
    const code = connectCode();
    const done = (text) => {
      state.profileNotice = { kind: "ok", text };
      renderProfileInPlace();
    };
    if (navigator.share) {
      navigator.share({ title: "My Learnæway connect code", text: code })
        .then(() => done("Code shared."))
        .catch(() => { /* dismissed — say nothing */ });
      return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(code)
        .then(() => done("Code copied."))
        .catch(() => selectConnectCode());
      return;
    }
    selectConnectCode();
  }

  function selectConnectCode() {
    const el = $("prCode");
    if (!el) return;
    const r = document.createRange();
    r.selectNodeContents(el);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
    state.profileNotice = { kind: "warn", text: "Copy isn't available here — the code is selected for you." };
    renderProfileInPlace();
  }

  /* ==> BACKEND: this is where the request has to go to the server. Today it
     only checks the code's shape and records it locally, so the other person
     never hears about it. Sending to a real service also needs: rejecting a
     code that doesn't belong to anyone, rejecting your own code (checked
     below, but only against this device's), and de-duplicating a request that
     is already pending on the server rather than only in this list. */
  function sendConnectRequest() {
    const input = $("prCodeInput");
    if (!input) return;
    const raw = input.value;
    state.profileCodeDraft = raw;
    const code = normaliseConnectCode(raw);
    const notice = (kind, text) => {
      state.profileNotice = { kind, text };
      renderProfileInPlace();
    };
    if (!raw.trim()) return notice("err", "Enter a code first.");
    if (!code) return notice("err", "That isn't a valid code. They look like AEW-4KP7XQ.");
    if (code === connectCode()) return notice("err", "That's your own code.");
    if (store.profile.requestsSent.some((r) => r.code === code)) {
      return notice("warn", `A request to ${code} is already pending.`);
    }
    store.profile.requestsSent.push({ code, at: new Date().toISOString(), state: "pending" });
    save();
    state.profileCodeDraft = "";
    notice("ok", `Request sent to ${code}.`);
  }

  function openProfile() {
    stopAudio();
    state.view = "profile";
    state.slideDir = 0;
    state.profileMode = "view";
    state.profileNotice = null;
    closeOverlay();
    render();
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
    const a = audioEl = new Audio(audioQueue[i]);
    a.muted = !store.settings.sound;
    a.addEventListener("ended", () => {
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
    /* Nothing in this app pauses the narration except the controls right below,
       and those clear `playing` first. So a pause arriving while `playing` is
       still true came from outside the app — a phone handing its audio session
       to another element on the page, which is exactly what a looping video does
       every time it wraps. Take the session back instead of going quiet.
       Guarded on identity so a track we deliberately discarded stays discarded. */
    a.addEventListener("pause", () => {
      if (a !== audioEl || !playing || a.ended) return;
      a.play().catch(() => {});
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
  /* Deliberately scoped to this one Audio object: it must never reach for the
     header clip, or any other media on the page. `playing` is cleared before the
     element is dropped so the pause listener above lets it go quietly. */
  function stopAudio() {
    playing = false;
    if (audioEl) { audioEl.pause(); audioEl = null; }
    audioQueue = [];
    audioQueueKey = null;
    audioIndex = 0;
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
  $("navBattle").addEventListener("click", openGames);
  $("navProfile").addEventListener("click", openProfile);
  $("btnPickHome").addEventListener("click", () => { state.homeTab = "sections"; goHome(); });
  $("btnProfileHome").addEventListener("click", () => { state.homeTab = "sections"; goHome(); });
  $("btnProfileEdit").addEventListener("click", () => {
    if (state.view !== "profile") return;
    if (state.profileMode === "edit") readProfileForm();
    state.profileMode = state.profileMode === "edit" ? "view" : "edit";
    state.profileNotice = null;
    renderProfile();
  });
  $("btnPickProfile").addEventListener("click", openProfile);
  $("photoInput").addEventListener("change", (e) => {
    readProfilePhoto(e.target.files && e.target.files[0]);
    e.target.value = "";     // same file twice in a row still fires change
  });

  /* ---------------- delegated clicks (rendered content + overlays) ------ */

  document.addEventListener("click", (e) => {
    const t = e.target.closest("[data-tab],[data-mod],[data-sec],[data-sub],[data-screen],[data-close],[data-menu-sec],[data-set-sound],[data-set-size],[data-save-note],[data-notes-list],[data-logout],[data-reset-progress],[data-vcat],[data-vid],[data-vback],[data-vfull],[data-grid],[data-grid-back],[data-grid-play],[data-ci],[data-ci-submit],[data-ci-before],[data-ci-exit],[data-bt],[data-bt-submit],[data-bt-stage2],[data-bt-back],[data-bt-exit],[data-bt-open],[data-jtab],[data-jmonth],[data-jadd],[data-jimport],[data-jmanual],[data-jsave],[data-jacct],[data-jaddacct],[data-jsaveacct],[data-jcash],[data-jsavecash],[data-pfsave],[data-pfpill],[data-pfadd],[data-pfedit],[data-pfdel],[data-pfdelok],[data-pfcancel],[data-jsection],[data-jviewall],[data-jday],[data-jdayback],[data-jdelmanual],[data-jdelbatch],[data-jreplace],[data-jdelok],[data-jdelcancel],[data-photo-pick],[data-photo-clear],[data-pr-edit],[data-pr-save],[data-pr-cancel],[data-pr-market],[data-pr-share],[data-pr-request],[data-pk-replay],[data-pk-build],[data-game],[data-pw-side],[data-pw-random],[data-pw-stop],[data-pw-play],[data-pw-draw],[data-pw-legend],[data-pw-restart],[data-pw-again],[data-pw-flip],[data-pw-seen],[data-pw-answer],[data-pw-tp],[data-crop-save],[data-jpick],[data-jeditlist],[data-jdellist],[data-jeditacct],[data-jdelacct],[data-jdelconfirm],[data-jsaveedit],[data-jpicktoggle],[data-jpickclose],[data-jlinkall],[data-bmins],[data-bmtf],[data-bmcd],[data-bmdiff],[data-bmstart],[data-mkpick],[data-mkrisk],[data-mkrr],[data-mkexpand],[data-mkreplay],[data-mkrematch],[data-mkdone],[data-rvtf]");
    if (!t) return;

    if (t.dataset.jtab) {
      state.journalTab = t.dataset.jtab;
      // a selected account from the other category would leave the header
      // showing figures the picker below doesn't list — fall back to combined
      const sel = activeAccount();
      if (sel && sel.category !== state.journalTab) { store.journalActive = "__all"; save(); }
      renderJournal();
    }
    else if (t.dataset.jmonth) { state.journalMonth += +t.dataset.jmonth; renderJournal(); }
    else if (t.hasAttribute("data-jimport")) { closeOverlay(); $("jCsvFile").click(); }
    else if (t.hasAttribute("data-jmanual")) openManualTrade();
    else if (t.dataset.jacct) {
      store.journalActive = t.dataset.jacct;
      const sel = activeAccount();
      if (sel) state.journalTab = sel.category;
      save();
      // the panel stays open with the tick moved onto the chosen row: closing
      // it here used to throw the reader back up the page mid-selection
      setPicker("list");
    }
    // the chevron toggles: tapping it again closes the panel it opened
    else if (t.hasAttribute("data-jpicktoggle")) setPicker(state.journalPicker ? null : "list");
    else if (t.hasAttribute("data-jpick")) setPicker("list");
    else if (t.hasAttribute("data-jpickclose")) setPicker(null);
    else if (t.hasAttribute("data-jeditlist")) setPicker("edit");
    else if (t.hasAttribute("data-jdellist")) setPicker("delete");
    else if (t.dataset.jeditacct) setPicker("edit", t.dataset.jeditacct);
    else if (t.dataset.jdelacct) setPicker("delete", t.dataset.jdelacct);
    else if (t.dataset.jdelconfirm) deleteAccount(t.dataset.jdelconfirm);
    else if (t.hasAttribute("data-jsaveedit")) saveEditedAccount();
    else if (t.hasAttribute("data-jaddacct")) setPicker("add");
    else if (t.hasAttribute("data-jlinkall")) {
      // Link All puts every account in the category into the combined view;
      // Unlink All drops back to a single account so per-account figures return
      const list = accountsIn(state.journalTab);
      store.journalActive = (isCombined() && list.length) ? list[0].id : "__all";
      save();
      journalScrollTop = cardScroll.scrollTop;
      journalKeepScroll = true;
      renderJournal();
    }
    else if (t.hasAttribute("data-jsaveacct")) saveAccount();
    else if (t.hasAttribute("data-jcash")) openCashFlow();
    else if (t.dataset.jsection) {
      state.journalSection = t.dataset.jsection;
      state.journalAllTrades = false;
      state.journalDay = null;
      state.journalDelete = null;
      renderJournal();
    }
    else if (t.hasAttribute("data-jviewall")) { state.journalAllTrades = !state.journalAllTrades; renderJournal(); }
    else if (t.dataset.jday) {
      state.journalDay = t.dataset.jday;
      state.journalDelete = null;
      renderJournal();
    }
    else if (t.hasAttribute("data-jdayback")) {
      // the confirm step backs out to the day it belongs to, not the calendar
      if (state.journalDelete) state.journalDelete = null;
      else state.journalDay = null;
      renderJournal();
    }
    else if (t.hasAttribute("data-jdelcancel")) { state.journalDelete = null; renderJournalInPlace(); }
    else if (t.dataset.jdelmanual) {
      const acctId = t.dataset.jdelacctid;
      const entry = ((store.journalManual[acctId] || {})[state.journalDay] || [])
        .find((e) => e.id === t.dataset.jdelmanual);
      state.journalDelete = {
        kind: "manual", id: t.dataset.jdelmanual, acctId,
        label: (entry && (entry.asset || entry.platform)) || "this trade",
      };
      renderJournalInPlace();
    }
    else if (t.dataset.jdelbatch) {
      const acctId = t.dataset.jdelacctid;
      const b = (store.journalBatches[acctId] || []).find((x) => x.id === t.dataset.jdelbatch);
      state.journalDelete = {
        kind: "batch", id: t.dataset.jdelbatch, acctId,
        label: b ? `${b.broker}${b.file ? " · " + b.file : ""}` : "this import",
        count: b ? b.trades : (store.journalTrades[acctId] || []).filter((x) => x.batch === t.dataset.jdelbatch).length,
        days: b && b.days ? b.days.length : 1,
      };
      renderJournalInPlace();
    }
    else if (t.hasAttribute("data-jdelok")) {
      const d = state.journalDelete;
      if (d) {
        if (d.kind === "batch") deleteImportBatch(d.acctId, d.id);
        else deleteManualTrade(d.acctId, d.id, state.journalDay);
        save();
      }
      state.journalDelete = null;
      renderJournal();
    }
    else if (t.dataset.jreplace) {
      // the old batch is only dropped once the replacement has parsed cleanly
      state.journalReplace = { batchId: t.dataset.jreplace, acctId: t.dataset.jdelacctid };
      $("jCsvFile").click();
    }
    else if (t.hasAttribute("data-pfpill")) {
      // the pill is the expand control; collapsing it also drops any open form
      state.propOpen = !state.propOpen;
      state.propMode = null;
      state.propEntryId = null;
      renderJournalInPlace();
    }
    else if (t.hasAttribute("data-pfadd")) setPropMode("add");
    else if (t.dataset.pfedit) setPropMode("edit", t.dataset.pfedit);
    else if (t.dataset.pfdel) setPropMode("delete", t.dataset.pfdel);
    else if (t.dataset.pfdelok) deletePropEntry(t.dataset.pfdelok);
    else if (t.hasAttribute("data-pfcancel")) setPropMode(null);
    else if (t.hasAttribute("data-pfsave")) savePropEntry();
    else if (t.hasAttribute("data-jsavecash")) saveCashFlow();
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
      renderChecklistInPlace(renderCheckin);
    }
    else if (t.hasAttribute("data-ci-before") || t.hasAttribute("data-bt-open")) openBeforeTrade();
    else if (t.dataset.bt) {
      const id = t.dataset.bt, val = t.dataset.btVal;
      // tapping the chosen answer clears it, same as the Start Day rows
      if (store.beforeTrade[id] === val) delete store.beforeTrade[id];
      else store.beforeTrade[id] = val;
      save();
      renderChecklistInPlace(renderBeforeTrade);
    }
    else if (t.hasAttribute("data-bt-submit")) {
      if (!bt1Answered()) return;
      const answers = {};
      BT1_ITEMS.forEach((it) => { answers[it.id] = store.beforeTrade[it.id]; });
      store.beforeTradeLog[todayKey()] = { answers, submittedAt: new Date().toISOString() };
      save();
      state.btResult = true;
      renderBeforeTrade();
    }
    else if (t.hasAttribute("data-bt-stage2")) { state.btStage2 = true; renderBeforeTrade(); }
    else if (t.hasAttribute("data-bt-back")) { state.btStage2 = false; renderBeforeTrade(); }
    else if (t.hasAttribute("data-bt-exit")) openCheckin();
    else if (t.hasAttribute("data-pr-edit")) {
      state.profileMode = "edit";
      state.profileNotice = null;
      renderProfile();
    }
    else if (t.hasAttribute("data-pr-cancel")) {
      // nothing typed since the last save is kept — the fields are re-read
      // from the stored record on the way back in
      state.profileMode = "view";
      renderProfile();
    }
    else if (t.hasAttribute("data-pr-save")) {
      readProfileForm();
      save();
      syncProfilePhoto();
      state.profileMode = "view";
      renderProfile();
    }
    else if (t.dataset.prMarket) {
      // keep whatever is half-typed in the other fields across the re-render
      readProfileForm();
      const id = t.dataset.prMarket;
      const at = store.profile.markets.indexOf(id);
      if (at >= 0) store.profile.markets.splice(at, 1);
      else store.profile.markets.push(id);
      save();
      renderProfileInPlace();
    }
    else if (t.hasAttribute("data-pr-share")) shareConnectCode(t);
    else if (t.hasAttribute("data-pr-request")) sendConnectRequest();
    else if (t.hasAttribute("data-photo-pick")) $("photoInput").click();
    else if (t.hasAttribute("data-crop-save")) savePhotoCrop();
    else if (t.hasAttribute("data-photo-clear")) {
      store.profilePhoto = "";
      save();
      syncProfilePhoto();
      if (state.view === "profile") renderProfile(); else openSettings();
    }
    else if (t.hasAttribute("data-game")) {
      if (t.getAttribute("data-game") === "pointaeway") openPointaeway();
      else openPickaeway();
    }
    else if (t.hasAttribute("data-pw-side")) pwStart(t.getAttribute("data-pw-side"));
    else if (t.hasAttribute("data-pw-random")) pwSpinStart();
    else if (t.hasAttribute("data-pw-stop")) pwSpinStop();
    else if (t.hasAttribute("data-pw-play")) pwPlay(t.getAttribute("data-pw-play"));
    else if (t.hasAttribute("data-pw-answer")) pwDisciplineAnswer(t.getAttribute("data-pw-answer"));
    else if (t.hasAttribute("data-pw-tp")) pwTakeProfitChoose(t.getAttribute("data-pw-tp") === "double");
    else if (t.hasAttribute("data-pw-draw")) pwChooseDraw(t.getAttribute("data-pw-draw"));
    else if (t.hasAttribute("data-pw-flip")) {
      const id = t.getAttribute("data-pw-flip");
      if (pw.flipped[id]) delete pw.flipped[id]; else pw.flipped[id] = true;
      pw.flipAnim = id;
      renderPointaeway();
    }
    else if (t.hasAttribute("data-pw-seen")) { pw.showSeen = !pw.showSeen; renderPointaeway(); }
    else if (t.hasAttribute("data-pw-legend")) { pw.showLegend = !pw.showLegend; renderPointaeway(); }
    else if (t.hasAttribute("data-pw-restart") || t.hasAttribute("data-pw-again")) {
      pwAbort(); pw = pwNewGame(); renderPointaeway();
    }
    else if (t.hasAttribute("data-pk-build")) openBuildMatch();
    else if (t.hasAttribute("data-pk-replay")) {
      if (!openReplay()) {
        openOverlay(panelHead("Match Replay") + `
          <div class="liked-empty">No matches played yet. Once you've battled, every round is
            replayable here.</div>
          <button class="btn-primary" data-close>Got it</button>`);
      }
    }
    else if (t.dataset.bmins) bmSet("instrument", t.dataset.bmins);
    else if (t.dataset.bmtf) bmSet("timeframe", +t.dataset.bmtf);
    else if (t.dataset.bmcd) bmSet("candles", +t.dataset.bmcd);
    else if (t.dataset.bmdiff) bmSet("difficulty", t.dataset.bmdiff);
    else if (t.hasAttribute("data-bmstart")) startMatch();
    else if (t.dataset.mkpick) mkLock(t.dataset.mkpick);
    else if (t.dataset.mkrisk) { mk.risk = MK_RISKS[+t.dataset.mkrisk]; renderMatch(); }
    else if (t.dataset.mkrr) { mk.rrIdx = +t.dataset.mkrr; renderMatch(); }
    else if (t.hasAttribute("data-mkexpand")) {
      if (state.view === "match") { mk.expand = !mk.expand; renderMatch(); }
      else {
        // swap the table in place rather than re-rendering: a full render would
        // reset the replay chart's scroll position out from under the tap
        state.rtExpand = !state.rtExpand;
        const box = t.closest(".rt");
        const m = store.pickaeway.lastMatch;
        if (box && m) box.outerHTML = roundTableHTML(m.log, state.rtExpand);
      }
    }
    else if (t.hasAttribute("data-mkreplay")) openReplay();
    else if (t.hasAttribute("data-mkrematch")) openBuildMatch();
    else if (t.hasAttribute("data-mkdone")) openPickaeway();
    else if (t.dataset.rvtf) { rv.tf = t.dataset.rvtf; rv.sel = null; renderReplay(); }
    else if (t.hasAttribute("data-ci-exit")) { closeOverlay(); state.checkinResult = null; state.homeTab = "sections"; goHome(); }
    else if (t.hasAttribute("data-ci-submit")) {
      if (!CHECKIN_ITEMS.every((it) => store.checklist[it.id])) return;
      const answers = {};
      CHECKIN_ITEMS.forEach((it) => { answers[it.id] = store.checklist[it.id]; });
      store.checkinLog[todayKey()] = { answers, submittedAt: new Date().toISOString() };
      save();
      // three or more "No" answers across the seven rows calls the day off.
      // "Are you ready to trade?" is just one of the seven now, not an override.
      const noCount = CHECKIN_ITEMS.filter((it) => answers[it.id] === "no").length;
      state.checkinResult = { go: noCount < 3, noCount };
      renderCheckin();
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

  document.addEventListener("click", (e) => {
    const t = e.target.closest("[data-intro]");
    if (!t) return;
    setAuthMode(t.dataset.intro === "signup" ? "signup" : "login");
    setIntroStage("form");
  });

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
      stopAuthVideo();          // nothing left to watch behind a hidden screen
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
  /* ---------------- desktop pre-login flow ----------------
     Desktop shows an intro video first, then a Sign Up / Log In CTA, and only
     then the login form. Mobile is unchanged: the form is still the default
     there, so introStage is only ever consulted past the breakpoint.

     The intro asset has not been delivered yet. Rather than block the flow on
     it, a missing or unplayable file resolves straight to the CTA — so the
     page works today, and dropping the file in at either INTRO_SOURCES path
     turns state 1 on with no further change. */
  /* Both formats, like the header video: a browser built without proprietary
     codecs cannot decode the H.264 mp4 and needs the webm fallback. Offering
     only one silently drops such a browser straight to the CTA. */
  const INTRO_SOURCES = [
    ["assets/video/intro.mp4", "video/mp4"],
    ["assets/video/intro.webm", "video/webm"],
  ];
  let introStage = "video";        // 'video' | 'cta' | 'form'
  let introWired = false;

  function introDesktop() { return window.matchMedia(DESKTOP_MQ).matches; }

  function setIntroStage(stage) {
    introStage = stage;
    showAuthStep();
  }

  function wireIntroVideo() {
    if (introWired) return;
    introWired = true;
    const v = $("introVideo");
    // muted is set as a property as well as an attribute: the attribute alone
    // is not always enough for autoplay policy
    v.muted = true;
    v.addEventListener("loadeddata", () => {
      if (introStage === "video") v.classList.remove("hidden");
    });
    v.addEventListener("ended", () => setIntroStage("cta"));
    v.addEventListener("error", () => setIntroStage("cta"));
    v.innerHTML = INTRO_SOURCES
      .map(([src, type]) => `<source src="${src}" type="${type}">`).join("");
    /* A <video> with <source> children does NOT fire error on the element when
       the sources fail — each <source> errors instead — so the element-level
       handler above never sees a missing asset. Count the source failures, and
       keep a timer as a backstop for a source that hangs rather than fails. */
    let dead = 0;
    v.querySelectorAll("source").forEach((sourceEl) => {
      sourceEl.addEventListener("error", () => {
        if (++dead >= INTRO_SOURCES.length && introStage === "video") setIntroStage("cta");
      });
    });
    setTimeout(() => {
      if (introStage === "video" && v.readyState < 3) setIntroStage("cta");
    }, 5000);
    v.load();
    v.play().catch(() => setIntroStage("cta"));   // autoplay refused -> show the CTA
  }

  /* steps: access gate -> questionnaire -> (desktop: intro video -> CTA) -> login */
  function showAuthStep() {
    const onGate = !store.gatePassed;
    const onSurvey = !onGate && !store.surveyDone;
    const past = !onGate && !onSurvey;
    const onIntro = past && introDesktop() && introStage !== "form";
    if (onSurvey && !surveyRendered) { surveyStep = 0; renderSurveyStep(); surveyRendered = true; }
    $("gateStep").classList.toggle("hidden", !onGate);
    $("surveyStep").classList.toggle("hidden", !onSurvey);
    $("introStep").classList.toggle("hidden", !onIntro);
    $("loginStep").classList.toggle("hidden", !past || onIntro);
    // the Log In shortcut sits in the dock slot through every pre-login state
    $("introDock").classList.toggle("hidden", !(past && introDesktop()));
    $("introVideo").classList.toggle("hidden", !(onIntro && introStage === "video"));
    $("introCta").classList.toggle("hidden", !(onIntro && introStage === "cta"));
    if (onIntro && introStage === "video") wireIntroVideo();
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
  // 0 = intro panel; 1..SURVEY.length = that question (1-based, matches the
  // "Question X of 12" copy). Not persisted — a reload restarts at the intro,
  // same as the old form restarted blank on reload.
  let surveyStep = 0;
  // qid -> final answer, in the exact shape collectSurvey() used to produce
  // (string for text/date/single, array for multi) — unchanged so the
  // Firestore payload this feeds is unchanged.
  const surveyAnswers = {};

  function renderSurveyStep() {
    if (surveyStep === 0) {
      surveyForm.innerHTML = `
        <div class="sv-intro-title">Welcome to Learnæway</div>
        <div class="sv-intro">A few questions — this helps us build the right app for you.
          It takes about a minute.</div>
        <button type="button" class="g-pill auth-submit" data-sv-start>Get Started</button>`;
      return;
    }
    const i = surveyStep - 1;
    const q = SURVEY[i];
    const total = SURVEY.length;
    const isLast = i === total - 1;
    const pct = Math.round((100 * (i + 1)) / total);
    surveyForm.innerHTML = `
      <div class="sv-progress-track">
        <div class="sv-progress-fill" style="width:${pct}%"></div>
        <span class="sv-progress-label">Question ${i + 1} of ${total}</span>
      </div>
      ${surveyQuestionHTML(q)}
      <div id="surveyError" class="gate-error hidden"></div>
      <div class="sv-nav">
        <button type="button" class="g-pill sv-back" data-sv-back>Back</button>
        <button type="button" class="g-pill auth-submit sv-next off" data-sv-next disabled>${isLast ? "Continue" : "Next"}</button>
      </div>`;
    // Prior values are set via the .value property, not an HTML attribute —
    // property assignment can't be broken out of by any character the user
    // typed (a quote, an angle bracket), unlike interpolating into a
    // value="..." string, which is why this happens as a second pass instead
    // of inside surveyQuestionHTML's template literal.
    const val = surveyAnswers[q.id];
    if ((q.type === "text" || q.type === "date") && val) {
      surveyForm.querySelector(`[name="${q.id}"]`).value = val;
    } else if (q.other) {
      const storedArr = q.type === "multi" ? (Array.isArray(val) ? val : []) : (val ? [val] : []);
      const otherEntry = storedArr.find((v) => typeof v === "string" && v.indexOf("Other: ") === 0);
      if (otherEntry) surveyForm.querySelector(`[name="${q.id}__other"]`).value = otherEntry.slice(7);
    }
    updateSurveyNextState(q);
  }

  function surveyQuestionHTML(q) {
    const label = `<div class="sv-label">${esc(q.q)}` +
      (q.type === "multi" ? `<span class="sv-multi">select all that apply</span>` : "") +
      `</div>`;
    if (q.type === "text" || q.type === "date") {
      const ph = q.placeholder ? ` placeholder="${esc(q.placeholder)}"` : "";
      const cls = q.type === "date" ? "sv-input sv-date" : "sv-input";
      return `<div class="sv-q" data-q="${q.id}" data-qtype="${q.type}">${label}
        <input class="g-pill auth-input ${cls}" name="${q.id}" type="${q.type === "date" ? "date" : "text"}"${ph} autocomplete="off"></div>`;
    }
    // stored answer may be a raw option string, "Other", or "Other: <text>"
    const stored = surveyAnswers[q.id];
    const storedArr = q.type === "multi" ? (Array.isArray(stored) ? stored : []) : (stored ? [stored] : []);
    const otherEntry = storedArr.find((v) => v === "Other" || (typeof v === "string" && v.indexOf("Other: ") === 0));
    const otherVal = otherEntry && otherEntry.indexOf("Other: ") === 0 ? otherEntry.slice(7) : "";
    const chips = q.options.map((o) =>
      `<button type="button" class="sv-opt ${storedArr.includes(o) ? "on" : ""}" data-sv-opt data-val="${esc(o)}">${esc(o)}</button>`).join("");
    const otherChip = q.other
      ? `<button type="button" class="sv-opt ${otherEntry ? "on" : ""}" data-sv-opt data-other="1" data-val="Other">Other</button>` : "";
    const otherInput = q.other
      ? `<input class="auth-input sv-other ${otherEntry ? "" : "hidden"}" name="${q.id}__other" type="text" placeholder="Tell us more" autocomplete="off">` : "";
    return `<div class="sv-q" data-q="${q.id}" data-qtype="${q.type}">${label}
      <div class="sv-opts">${chips}${otherChip}</div>${otherInput}</div>`;
  }

  function updateSurveyNextState(q) {
    const btn = surveyForm.querySelector("[data-sv-next]");
    const wrap = surveyForm.querySelector(`.sv-q[data-q="${q.id}"]`);
    if (!btn || !wrap) return;
    const answered = q.type === "text" || q.type === "date"
      ? !!(wrap.querySelector(`[name="${q.id}"]`).value || "").trim()
      : wrap.querySelectorAll("[data-sv-opt].on").length > 0;
    btn.disabled = !answered;
    btn.classList.toggle("off", !answered);
  }

  /* mirrors the old collectSurvey(), just scoped to the one question on
     screen right now instead of the whole form */
  function captureSurveyAnswer(q) {
    const wrap = surveyForm.querySelector(`.sv-q[data-q="${q.id}"]`);
    if (!wrap) return;
    if (q.type === "text" || q.type === "date") {
      surveyAnswers[q.id] = (wrap.querySelector(`[name="${q.id}"]`).value || "").trim();
      return;
    }
    const otherInput = wrap.querySelector(".sv-other");
    const otherTxt = otherInput && !otherInput.classList.contains("hidden")
      ? otherInput.value.trim() : "";
    const picked = Array.from(wrap.querySelectorAll("[data-sv-opt].on"))
      .map((b) => (b.hasAttribute("data-other") && otherTxt ? `Other: ${otherTxt}` : b.dataset.val));
    surveyAnswers[q.id] = q.type === "multi" ? picked : (picked[0] || "");
  }

  surveyForm.addEventListener("click", (e) => {
    if (e.target.closest("[data-sv-start]")) { surveyStep = 1; renderSurveyStep(); return; }

    if (e.target.closest("[data-sv-back]")) {
      captureSurveyAnswer(SURVEY[surveyStep - 1]);
      surveyStep -= 1;   // from question 1 this returns to the intro panel
      renderSurveyStep();
      return;
    }

    if (e.target.closest("[data-sv-next]")) {
      const btn = e.target.closest("[data-sv-next]");
      if (btn.disabled) return;
      const q = SURVEY[surveyStep - 1];
      captureSurveyAnswer(q);
      if (surveyStep < SURVEY.length) { surveyStep += 1; renderSurveyStep(); }
      else submitSurvey(btn);
      return;
    }

    const optBtn = e.target.closest("[data-sv-opt]");
    if (optBtn) {
      const wrap = optBtn.closest(".sv-q");
      if (wrap.dataset.qtype === "single") {
        wrap.querySelectorAll("[data-sv-opt]").forEach((b) => b.classList.toggle("on", b === optBtn));
      } else {
        optBtn.classList.toggle("on");
      }
      const otherBtn = wrap.querySelector('[data-other="1"]');
      const otherInput = wrap.querySelector(".sv-other");
      if (otherInput) {
        const show = !!otherBtn && otherBtn.classList.contains("on");
        otherInput.classList.toggle("hidden", !show);
        if (show) otherInput.focus();
      }
      updateSurveyNextState(SURVEY[surveyStep - 1]);
    }
  });

  // live-update Next as the user types (text/date questions, and the
  // free-text "Other" box on choice questions)
  surveyForm.addEventListener("input", (e) => {
    if (surveyStep === 0 || !e.target.matches(".sv-input, .sv-other")) return;
    updateSurveyNextState(SURVEY[surveyStep - 1]);
  });

  // Enter in a text/date question advances, same convenience the old
  // single-page form got for free from being a real <form> with a submit
  // button; there's no submit button now, so this replaces it deliberately.
  surveyForm.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || !e.target.matches(".sv-input")) return;
    e.preventDefault();
    const btn = surveyForm.querySelector("[data-sv-next]");
    if (btn && !btn.disabled) btn.click();
  });

  async function submitSurvey(btn) {
    const identity = store.gateIdentity || {};
    store.survey = Object.assign({}, surveyAnswers, { submittedAt: new Date().toISOString() });
    store.surveyDone = true;
    save();     // answers are safe locally regardless of what the network does below
    btn.disabled = true;
    btn.classList.add("pending");
    btn.textContent = "Saving…";
    if (window.FB && identity.email) {
      // saveLead() already resolves false instead of throwing on a fast
      // network failure, but a connection that hangs rather than fails
      // (a stalled request, a dead proxy) leaves this awaiting forever with
      // no error to catch — and the user's answers are already saved
      // locally at this point, so nothing downstream is actually worth
      // blocking Continue on. Race it against a timeout so the flow always
      // reaches Login.
      await Promise.race([
        FB.saveLead(identity.email, {
          survey: surveyAnswers,
          surveyCompletedAt: store.survey.submittedAt,
        }),
        new Promise((resolve) => setTimeout(resolve, 6000)),
      ]);
    }
    showAuthStep();
  }

  /* The gate's own copy of the header clip. Its source is attached on the way
     in and the element is stopped on the way out, so once the user is through
     the gate there is no second decoder running on a screen nobody can see.
     Silent throughout: the hero sound button does not reach this one. */
  function startAuthVideo() {
    const v = $("authVideo");
    if (!v || v.querySelector("source")) return;
    v.addEventListener("error", () => v.classList.add("hidden"));  // still shows through
    const src = document.createElement("source");
    src.src = "assets/video/header-loop.mp4";
    src.type = "video/mp4";
    v.appendChild(src);
    v.muted = true;
    v.load();
    v.play().catch(() => {});
  }
  function stopAuthVideo() {
    const v = $("authVideo");
    if (v) v.pause();
  }

  if (!store.authSeen) {
    renderAuthForm();
    showAuthStep();
    authScreen.classList.remove("hidden");
    startAuthVideo();
  }

  /* ---------------- boot ---------------- */

  /* How tall the app column is.

     Three sources, and the largest wins. Every one of them is bounded by the
     web view, so the largest can never be bigger than the view itself — which
     is the whole difference from screen.height, which IS the display and once
     put the dock below the visible area where overflow:hidden cut it in half.
     Do not add that one back.

     The largest rather than innerHeight alone because any single source can
     come back short, and a short answer leaves the column standing above the
     bottom of the view with a band of the manifest's background_color showing
     under the dock on every screen — the reported symptom.

     Measured again after the first paint as well: iOS settles the standalone
     view over the launch image, and the figure available at boot can be the
     pre-settle one with no resize event afterwards to correct it. */
  function viewportHeight() {
    const vv = window.visualViewport;
    return Math.max(
      window.innerHeight || 0,
      document.documentElement.clientHeight || 0,
      vv ? vv.height || 0 : 0
    );
  }
  function syncViewportHeight() {
    const h = viewportHeight();
    if (h > 0) document.documentElement.style.setProperty("--vhpx", h + "px");
  }
  syncViewportHeight();
  // the settling ticks: cheap, and the only thing that catches a stale boot value
  [60, 300, 1000].forEach((ms) => setTimeout(syncViewportHeight, ms));
  window.addEventListener("pageshow", syncViewportHeight);
  window.addEventListener("resize", syncViewportHeight);
  // the battle chart repaints every animation frame; the replay chart is
  // static, so it needs a nudge when the viewport changes width
  window.addEventListener("resize", () => { if (state.view === "replay") mkPaintReplay(); });
  window.addEventListener("orientationchange", syncViewportHeight);

  /* ---- on-device viewport readout ----
     Five quick taps on the clock. Nothing in the layout can be checked from
     a screenshot alone: the dock sits where the column ends, and the column
     is as tall as iOS says the viewport is — which, on a home-screen install,
     has not matched the screen. This puts the numbers the column is built
     from on the screen next to the result, plus two fixed stripes: the one
     at bottom:0 lands wherever the browser believes the bottom of the
     viewport is, so if it stops short of the physical edge, the band under it
     is outside the page and no CSS can reach it. Tap the panel to close. */
  let diagTaps = 0, diagTapAt = 0;
  function diagText() {
    const cs = getComputedStyle(document.documentElement);
    const app = document.querySelector(".app");
    const dock = $("dock");
    const r = (el) => el ? el.getBoundingClientRect() : null;
    const a = r(app), d = r(dock);
    const vv = window.visualViewport;
    const one = (v) => (v == null ? "?" : Math.round(v * 10) / 10);
    return [
      `standalone ${matchMedia("(display-mode: standalone)").matches} · navigator.standalone ${!!navigator.standalone}`,
      `innerHeight ${one(innerHeight)} · clientHeight ${one(document.documentElement.clientHeight)}`,
      `visualViewport ${vv ? one(vv.height) + " @" + one(vv.offsetTop) : "none"} · screen ${one(screen.height)}`,
      `--sat ${cs.getPropertyValue("--sat").trim() || "?"} · --sab ${cs.getPropertyValue("--sab").trim() || "?"} · --vhpx ${cs.getPropertyValue("--vhpx").trim() || "unset"}`,
      `app ${a ? one(a.top) + "→" + one(a.bottom) + " (h " + one(a.height) + ")" : "?"} · dock bottom ${d ? one(d.bottom) : "?"}`,
      `innerWidth ${one(innerWidth)} · dpr ${devicePixelRatio}`,
    ].join("\n");
  }
  function diagShow() {
    let p = $("vhDiag");
    if (!p) {
      p = document.createElement("pre");
      p.id = "vhDiag";
      p.setAttribute("role", "status");
      document.body.appendChild(p);
      ["top", "bottom"].forEach((side) => {
        const s = document.createElement("div");
        s.className = "vh-diag-stripe " + side;
        s.dataset.side = side;
        s.textContent = side === "top" ? "fixed top:0" : "fixed bottom:0";
        document.body.appendChild(s);
      });
      p.addEventListener("click", diagHide);
    }
    p.textContent = diagText();
  }
  function diagHide() {
    ["vhDiag"].forEach((id) => { const el = $(id); if (el) el.remove(); });
    document.querySelectorAll(".vh-diag-stripe").forEach((el) => el.remove());
  }
  const waveClock = $("waveClock");
  if (waveClock) waveClock.addEventListener("click", () => {
    const now = Date.now();
    diagTaps = now - diagTapAt < 600 ? diagTaps + 1 : 1;
    diagTapAt = now;
    if (diagTaps >= 5) { diagTaps = 0; diagShow(); }
  });
  window.addEventListener("resize", () => { if ($("vhDiag")) diagShow(); });
  if (window.visualViewport) window.visualViewport.addEventListener("resize", syncViewportHeight);

  /* Keyboard handling for the login/gate screen: iOS keeps window.innerHeight
     full while the keyboard + QuickType bar are up, so the focused field can
     hide behind them. Shrink the auth screen to visualViewport.height and
     scroll the active input into view. */
  const vv = window.visualViewport;
  let kbFocused = null;
  /* Desktop has no on-screen keyboard, and this handling actively harms it:
     scrollIntoView() scrolls the nearest scrollable ancestor, and .app is
     overflow:hidden — which is still programmatically scrollable — so focusing
     the password field scrolled the whole centre column, header video and all.
     Measured 0 -> 38 -> 108px of .app scrollTop before this guard. */
  const isTouchLayout = () => !window.matchMedia(DESKTOP_MQ).matches;
  function applyKbHeight() {
    if (!kbFocused || !vv) return;
    authScreen.style.setProperty("--kbvh", Math.round(vv.height) + "px");
  }
  function scrollFocusedIntoView() {
    if (kbFocused) kbFocused.scrollIntoView({ block: "center", behavior: "smooth" });
  }
  authScreen.addEventListener("focusin", (e) => {
    if (!isTouchLayout()) return;
    if (!e.target.classList || !e.target.classList.contains("auth-input")) return;
    kbFocused = e.target;
    authScreen.classList.add("kb-open");
    applyKbHeight();
    // wait for the keyboard + toolbar to finish animating in, then reveal
    setTimeout(() => { applyKbHeight(); scrollFocusedIntoView(); }, 320);
  });
  authScreen.addEventListener("focusout", (e) => {
    if (!isTouchLayout()) return;
    if (!e.target.classList || !e.target.classList.contains("auth-input")) return;
    setTimeout(() => {
      if (authScreen.contains(document.activeElement) &&
          document.activeElement.classList.contains("auth-input")) return;
      kbFocused = null;
      authScreen.classList.remove("kb-open");
    }, 60);
  });
  if (vv) vv.addEventListener("resize", () => {
    if (!isTouchLayout()) return;
    applyKbHeight(); scrollFocusedIntoView();
  });

  const waveVideo = $("waveVideo");
  if (waveVideo) {
    waveVideo.addEventListener("error", () => $("headerZone").classList.add("video-broken"));
    watchHeroAudio(waveVideo);
    /* The source is attached here rather than in the markup because this clip
       is for the phone: on desktop the header is hidden behind the banner, and
       a <source> in the HTML would have the browser download 1.6MB for an
       element nobody can see. Attached on the way back under the breakpoint
       too, in case the window was widened first. */
    attachHeaderSource();
    window.matchMedia(DESKTOP_MQ).addEventListener("change", attachHeaderSource);
  }

  /* ---------------- desktop banner ----------------
     One video, the same clip the phone plays in its header, running the full
     width of row 1 — from the left edge of the left panel to the right edge of
     the right panel — behind the app column and the two side columns.

     It replaces a four-layer composition (a tiled floor, two flanking overlays
     and a centre clip, all kept frame-aligned by a drift correcting sync loop)
     that read as a cluster over the centre column rather than as one strip.
     None of that machinery is needed for a single element: it loops itself,
     and there is nothing left for it to stay in step with.

     Built in JS rather than markup so a phone never creates a second decoder
     for a clip its own header is already playing. The clock, the mute button
     and the gear sit above it untouched — this is only the layer underneath. */

  let dtBannerVideo = null;   // the desktop hero, and the one that carries sound

  function buildDesktopBanner() {
    const banner = $("dtBanner");
    if (!banner || dtBannerVideo) return;
    // the app's own header video is hidden at this width — stop it rather than
    // leave a second decoder running on a clip nobody can see
    if (waveVideo) { waveVideo.pause(); waveVideo.removeAttribute("autoplay"); }
    /* H.264 only — the clip has no WebM twin, and offering a source that isn't
       there costs a 404 on every desktop load. */
    banner.innerHTML = `<video class="dtb-video" muted loop playsinline webkit-playsinline preload="auto">
      <source src="assets/video/header-loop.mp4" type="video/mp4">
    </video>`;
    const v = banner.querySelector("video");
    v.muted = true;                     // as a property too: the attribute
    v.play().catch(() => {});           // alone doesn't satisfy autoplay policy
    dtBannerVideo = v;
    watchHeroAudio(v);
    tryUnmuted(v);
    syncMuteButton();
  }

  /* Autoplay can still be lost to a backgrounded tab or a stalled decode, and
     nothing else is watching this element now that the sync loop is gone. */
  function keepBannerPlaying() {
    if (dtBannerVideo && dtBannerVideo.paused) dtBannerVideo.play().catch(() => {});
  }

  /* ---------------- hero sound ----------------
     One control for whichever video is the hero at this width: the header clip
     on a phone, the banner's centre layer on desktop.

     Sound on by default, but a browser will refuse an unmuted autoplay without
     a prior gesture — iOS always, desktop Chrome unless the site has earned
     enough engagement. So: try unmuted, and fall back to muted playback rather
     than to no playback at all. Either way the button is painted from the
     element's own .muted, never from what we hoped it would be, and it repaints
     on volumechange so it cannot drift out of step with reality. */

  function heroVideo() {
    return window.matchMedia(DESKTOP_MQ).matches ? dtBannerVideo : waveVideo;
  }

  function syncMuteButton() {
    const btn = $("hdrMute");
    if (!btn) return;
    const v = heroVideo();
    const img = btn.querySelector("img");
    // no hero yet (the banner is still building) reads as silent
    const muted = !v || v.muted;
    if (img) img.src = muted ? VOL_OFF : VOL_ON;
    btn.setAttribute("aria-pressed", muted ? "false" : "true");
    btn.setAttribute("aria-label", muted ? "Turn sound on" : "Turn sound off");
  }

  /* Attempt sound, settle for silence. Called once per video that can carry
     audio, and again from the button, which is a real gesture and so usually
     succeeds where the load-time attempt did not. */
  function tryUnmuted(v) {
    if (!v) return Promise.resolve(false);
    /* The wish is recorded here and only unrecorded if the browser refuses.
       It must NOT be read back off v.muted once play() settles: the listener can
       tap the button while that promise is still pending, and deriving the wish
       from the element then would file their tap as our own. */
    heroSoundWanted = true;
    v.muted = false;
    return Promise.resolve(v.play())
      .then(() => { syncMuteButton(); return !v.muted; })
      .catch(() => {
        heroSoundWanted = false;      // refused — remember it, don't keep asking
        v.muted = true;
        return Promise.resolve(v.play()).catch(() => {}).then(() => { syncMuteButton(); return false; });
      });
  }

  function toggleHeroSound() {
    const v = heroVideo();
    if (!v) return;
    if (v.muted) { heroSoundWanted = true; tryUnmuted(v); }
    else { heroSoundWanted = false; v.muted = true; syncMuteButton(); }
  }

  /* ---------------- background vs foreground audio ----------------
     The two are independent, in both directions. The header clip is ambience
     that loops forever; the narration is the content. Neither one is allowed to
     mute, pause or restart the other:

       - nothing here ever touches the narration element. The only thing that
         mutes the clip is the listener's own tap on the button, recorded in
         heroSoundWanted;
       - the clip's loop-restart is the element's own business. It carries no
         handler and reaches nothing outside itself — a wrap is a seek within
         one <video>, and no code in this file listens for it;
       - the one way a loop could ever have reached the narration is the phone
         handing its audio session to whichever element asserted it last, which
         a wrap does. The narration takes it straight back: see the pause
         listener in loadTrack(). It resumes in place, so there is no restart
         and no gap.

     An earlier build ducked the clip while narration played. That kept the two
     off each other but cost the background audio, which is meant to keep
     playing throughout — so the duck is gone and both sources run at once. */

  /* the button is a view of the element's state, so watch the element */
  function watchHeroAudio(v) {
    if (!v) return;
    ["volumechange", "play", "pause", "loadedmetadata"].forEach((e) =>
      v.addEventListener(e, syncMuteButton));
  }

  function attachHeaderSource() {
    if (!waveVideo || window.matchMedia(DESKTOP_MQ).matches) return;
    if (waveVideo.querySelector("source")) return;
    const src = document.createElement("source");
    src.src = "assets/video/header-loop.mp4";
    src.type = "video/mp4";
    waveVideo.appendChild(src);
    waveVideo.load();
    // sound on if the browser allows it, muted playback if not — never silence
    // and a stopped video
    tryUnmuted(waveVideo);
  }

  function syncDesktopChrome() {
    if (window.matchMedia(DESKTOP_MQ).matches) buildDesktopBanner();
    // crossing the breakpoint changes which pre-login step applies
    if (!store.authSeen) showAuthStep();
  }
  syncDesktopChrome();
  window.matchMedia(DESKTOP_MQ).addEventListener("change", syncDesktopChrome);
  setInterval(keepBannerPlaying, 1000);
  $("hdrMute").addEventListener("click", toggleHeroSound);
  // crossing the breakpoint changes which video the button speaks for
  window.matchMedia(DESKTOP_MQ).addEventListener("change", syncMuteButton);

  applyTextSize();
  syncVolume();
  syncProfilePhoto();
  // the header clock runs on every screen, so it starts once and never stops
  paintWaveClock();
  clockTimer = setInterval(paintWaveClock, 1000);
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
