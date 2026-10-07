/* ==========================================================================
   Learnæway PWA — app shell
   Views: home (deck outline + tabs) and learning screens (swipe navigation).
   Persistence: localStorage + Firestore sync when signed in (see Phase 1).
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
  /* ÆWAY play points, on stores written before the market existed */
  if (typeof store.awPoints !== "number") store.awPoints = 10000;
  if (!store.awOpen) store.awOpen = {};
  if (!store.awDone) store.awDone = [];
  if (!store.videosWatched) store.videosWatched = {};   // videoId -> true
  if (!store.checkinLog) store.checkinLog = {};         // YYYY-MM-DD -> submitted answers
  if (!store.beforeTrade) store.beforeTrade = {};       // Before Trade Stage 1 picks
  if (!store.beforeTradeLog) store.beforeTradeLog = {}; // YYYY-MM-DD -> submitted Stage 1
  if (!store.afterTrade) store.afterTrade = {};         // After Trade picks, before submit
  if (!store.afterTradeLog) store.afterTradeLog = {};   // YYYY-MM-DD -> [one entry per trade]
  if (!store.journalImport) store.journalImport = {};   // account -> YYYY-MM-DD -> day totals
  if (!store.journalManual) store.journalManual = {};   // account -> YYYY-MM-DD -> [manual trades]
  if (!store.journalAccounts) store.journalAccounts = [];  // user-added brokerage accounts
  if (!store.watchlist) store.watchlist = ["ES", "NQ", "CL", "GC", "BTC"];
  if (store.chartMode !== "normal" && store.chartMode !== "aeway") store.chartMode = "aeway";
  if (store.dcChartMode !== "normal" && store.dcChartMode !== "aeway") store.dcChartMode = "aeway";
  if (!Array.isArray(store.patterns)) store.patterns = [];   // saved chart patterns, local only
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
    /* requestsSent and connections were the connect-code feature's local
       lists. connections.js keeps both on the server now, so an old profile
       carrying them is simply left alone — nothing reads them. */
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
  /* After Trade grew from one submission a day to one per trade taken, so a
     day's value is a list. Anything the single-entry build wrote is a bare
     { answers, submittedAt } and gets wrapped rather than dropped. */
  let atListed = false;
  Object.keys(store.afterTradeLog || {}).forEach((day) => {
    const v = store.afterTradeLog[day];
    if (v && !Array.isArray(v)) { store.afterTradeLog[day] = v.answers ? [v] : []; atListed = true; }
  });
  // written straight out rather than through save(): the cloud-sync timer it
  // touches is declared further down and would still be in its dead zone here
  if (renamed || stamped || sessionsRenamed || tagged || atListed) { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) { /* quota */ } }
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
      /* Pointæway's record. The counters are kept apart from the list on
         purpose: the list is capped so a long-running store cannot grow
         without end, and totals taken from a capped list would start going
         down. These only ever go up. */
      pwStats: { played: 0, won: 0, lost: 0, drawn: 0, bull: 0, bear: 0 },
      pwHistory: [],
      /* ÆWAY play points. Device-only — see the note on awSave(). */
      awPoints: 10000,
      awOpen: {},            // one open prediction per timeframe
      awDone: [],            // settled predictions, newest first
      awAdmin: null,         // the admin page's editable assumptions
    };
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) { /* quota */ }
    pushCloudSoon();   // mirrors progress/notes to Firestore when signed in
  }

  /* ---------------- Firestore sync (per authenticated user) ----------------
     Phase 1: mirror profile + course/journal state to users/{uid}.
     Merge rules on pull: map-like keys are unioned (local wins on key collision
     for the same id — recent local edits stay authoritative); scalar/profile
     fields fill from cloud when local is empty; arrays prefer the longer or
     local-if-present copy. Profile photo (data URL) is NOT synced — too large
     for a Firestore document; use Storage in a follow-up. */

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
      saved: store.saved || {},
      notes: store.notes || {},
      checklist: store.checklist || {},
      videosWatched: store.videosWatched || {},
      checkinLog: store.checkinLog || {},
      beforeTrade: store.beforeTrade || {},
      beforeTradeLog: store.beforeTradeLog || {},
      afterTrade: store.afterTrade || {},
      afterTradeLog: store.afterTradeLog || {},
      journalImport: store.journalImport || {},
      journalManual: store.journalManual || {},
      journalAccounts: store.journalAccounts || [],
      journalBatches: store.journalBatches || {},
      journalTrades: store.journalTrades || {},
      journalOpen: store.journalOpen || {},
      journalActive: store.journalActive || "__all",
      propLedger: store.propLedger || {},
      dayProgress: store.dayProgress || {},
      watchlist: store.watchlist || [],
      pickaeway: store.pickaeway || {},
      settings: store.settings || {},
      updatedAt: new Date().toISOString(),
    };
  }
  function pushCloudSoon() {
    if (!window.FB || !FB.user()) return;
    clearTimeout(cloudTimer);
    cloudTimer = setTimeout(() => { FB.saveUserDoc(cloudPayload()); }, 2500);
  }
  function mergeProfile(local, cloud) {
    if (!cloud) return local || {};
    if (!local) return Object.assign({}, cloud);
    const out = Object.assign({}, cloud, local);
    out.links = Object.assign({}, cloud.links || {}, local.links || {});
    out.markets = (local.markets && local.markets.length) ? local.markets : (cloud.markets || []);
    for (const k of ["firstName", "lastName", "username", "location", "bio",
                     "tradingSince", "investingSince", "name", "email", "phone"]) {
      if (!out[k] && cloud[k]) out[k] = cloud[k];
    }
    return out;
  }
  async function pullCloudAndMerge() {
    if (!window.FB || !FB.user()) return false;
    const cloud = await FB.loadUserDoc();
    if (!cloud) return false;
    const mapKeys = [
      "visited", "liked", "saved", "checklist", "notes", "videosWatched",
      "checkinLog", "beforeTradeLog", "afterTradeLog", "journalImport", "journalManual",
      "journalBatches", "journalTrades", "journalOpen", "propLedger", "dayProgress",
    ];
    for (const k of mapKeys) {
      store[k] = Object.assign({}, cloud[k] || {}, store[k] || {});
    }
    if (!store.lastScreen && cloud.lastScreen) store.lastScreen = cloud.lastScreen;
    if (cloud.beforeTrade && Object.keys(store.beforeTrade || {}).length === 0) {
      store.beforeTrade = cloud.beforeTrade;
    }
    if (cloud.afterTrade && Object.keys(store.afterTrade || {}).length === 0) {
      store.afterTrade = cloud.afterTrade;
    }
    if (Array.isArray(cloud.journalAccounts) && !(store.journalAccounts || []).length) {
      store.journalAccounts = cloud.journalAccounts.slice();
    }
    if (Array.isArray(cloud.watchlist) && cloud.watchlist.length) {
      store.watchlist = store.watchlist && store.watchlist.length ? store.watchlist : cloud.watchlist.slice();
    }
    if (cloud.pickaeway) {
      store.pickaeway = Object.assign({}, cloud.pickaeway, store.pickaeway || {});
    }
    if (cloud.journalActive && store.journalActive === "__all") {
      store.journalActive = cloud.journalActive;
    }
    store.profile = mergeProfile(store.profile, cloud.profile);
    if (cloud.settings) {
      store.settings = Object.assign({}, cloud.settings, store.settings || {});
      if (cloud.settings.name && !store.settings.name) store.settings.name = cloud.settings.name;
    }
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
    /* which inline center panel is up, if any: "tools" (hamburger) or
       "settings" (gear). One slot, so the two can never both be open. */
    panel: null,
    tpTab: "chart",          // which of the hamburger's sections
    /* which chart both surfaces are showing: "aeway" is the story engine's
       own tape — no instrument, no prices, candles printing live — and
       "normal" is the real-instrument chart with its axes and drawings.
       One per chart, because each chart carries its own toggle and the two
       are otherwise independent of each other — different instrument, own
       timeframe, own drawings, own view window. Restored from the store. */
    tpMode: store.chartMode,
    dcMode: store.dcChartMode,
    /* ---- the ÆWAY market screen ---- */
    awTf: "5m",              // which timeframe the chart and the calls run on
    awFrom: null,            // leftmost bar; null means "follow the newest"
    awSpan: 64,              // how many candles are across — this is the zoom
    awFollow: true,          // sticking to the newest candle
    awCross: null,           // the crosshair, while a finger is held down
    awMenu: false,           // the timeframe dropdown
    awView: null,            // null, "history" or "admin"
    awNote: "",              // what the screen says back after an action
    awProject: false,        // the admin's 1,000,000-player projection
    awAdminOk: false,        // the passcode was accepted this session
    awAdminAsk: false,       // the passcode box, after a long press on the tag
    awResetAsk: false,       // the "start again from 10,000?" confirmation
    tpMenu: null,            // which of the phone chart's two dropdowns is open
    tpPat: false,            // the saved-pattern list, expanded inline
    tpPatOpen: null,         // a saved pattern id, when one is being looked at
    tpSym: null,             // charted symbol; falls back to the watchlist's first
    tpTf: "5m",              // chart timeframe
    tpFrom: null,            // left edge of the window, in bars; null = the right edge
    tpSpan: 60,              // how many bars are on screen — this is the zoom
    tpQuery: "",             // the watchlist search box
    /* the desktop right/bottom panels: their own view window, so panning the
       chart there does not move the hamburger's copy of it */
    dcSym: "ES",
    dcTf: "5m",
    dcFrom: null,            // null = the newest bars, same as the mobile chart
    dcSpan: 90,
    dcTool: "cursor",        // 'cursor' | 'line' | 'box' | 'fib'
    dcDraw: [],              // finished drawings, in chart space
    dcDraft: null,           // the one being dragged out
    dcSel: null,             // index into dcDraw
    dcQuery: "",             // the bottom panel's ticker search
    dcPat: false,            // the saved-pattern list under the desktop chart
    /* the same three tools on the phone's chart, with their own state */
    tpPractice: null,        // the two-axis practice session, when one is running
    tpTool: "cursor",
    tpDraw: [],
    tpDraft: null,
    tpSel: null,
    tpDate: null,            // the calendar's day, YYYY-MM-DD; null means today
    view: "home",            // 'home' | 'screen' | 'videos' | 'checkin' | 'beforetrade'
                             // | 'aftertrade' | 'streak'
                             // | 'journal' | 'pickaeway' | 'buildmatch' | 'match' | 'result' | 'replay'
                             // | 'aehome' — the Æway hub the bar-2 home icon opens
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
    btDetail: false,         // Before Trade's completed recap expanded
    atOpen: {},              // After Trade: which entries have their recap open
    atAdding: false,         // logging another After Trade entry over today's list
    dsMonth: 0,              // Discipline Streak calendar, months from this one
    dsDay: null,             // 'YYYY-MM-DD' — a past day's scorecard, null = today
    dsOpen: {},              // which scorecard rows have their detail showing
    journalDay: null,        // 'YYYY-MM-DD' — day view open in place of the calendar
    journalDelete: null,     // { kind:'manual'|'batch', id, acctId, label, count, days }
    journalReplace: null,    // { batchId, acctId } — CSV picker open to replace a batch
    profileMode: "view",     // 'view' (what others would see) | 'edit'
    profileNotice: null,     // { kind, text } — transient line under a Connect action
    contentsFrom: null,      // the page Course Contents was opened from
    connQuery: "",           // what's typed in the Connections lookup, kept across renders
    onlineReconnectErr: null,// why the last Æway Online reconnect was refused
    checkinResult: null,     // { go, noCount } — result shown in place of the rows
    /* Review Answers: the seven rows come back over an already-submitted
       result, filled in with what was logged. Cleared on the way out of the
       screen — leaving without resubmitting is what keeps the logged answers,
       so coming back has to land on the result again. */
    checkinReview: false,
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
    { id: "physically", icon: "ico-01-physical",
      label: "Are you physically ready?", sub: "Rested • No fatigue • Good energy" },
    { id: "mentally", icon: "ico-02-mental",
      label: "Are you mentally ready?", sub: "Focused • Clear mind • Present" },
    { id: "emotionally", icon: "ico-03-emotional",
      label: "Are you emotionally ready?", sub: "Calm • Patient • No revenge trading" },
    { id: "distraction", icon: "ico-04-distraction",
      label: "Are you distraction-free today?", sub: "No unnecessary interruptions" },
    { id: "economic-news", icon: "ico-05-news",
      label: "Have you checked today's economic news?", sub: "Aware of key events and data" },
    { id: "market-awareness", icon: "ico-06-market",
      label: "Are you aware of current market conditions?", sub: "Trend • Volatility • Key levels" },
    { id: "ready-to-trade", icon: "ico-07-ready",
      label: "Are you ready to trade?", sub: "Plan set • Risk defined • Let's go" },
  ];

  /* short forms for the scorecard — the rows are questions, and seven of them
     stacked as questions reads as an interrogation rather than a recap */
  const CHECKIN_SHORT = {
    physically: "Physically ready", mentally: "Mentally ready",
    emotionally: "Emotionally ready", distraction: "Distraction-free",
    "economic-news": "Checked the news", "market-awareness": "Market conditions",
    "ready-to-trade": "Ready to trade",
  };

  /* Placeholders until the icon artwork lands — see the layout prompt.
     All four have a screen behind them now, so all four are buttons. */
  const CHECKIN_ACTIONS = [
    { label: "Start Day", icon: "cat-start-day" },
    { label: "Before Trade", icon: "cat-before-trade", go: "bt-open" },
    { label: "After Trade", icon: "cat-after-trade", go: "at-open" },
    { label: "Discipline Streak", icon: "cat-discipline-streak", go: "ds-open" },
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
  /* Stage 2 opens on one question: which strategy is being traded. Single
     select — the answer is which one, so a second tap moves the choice rather
     than adding to it. Each will grow its own follow-up questions in a later
     pass; BT2_STRATS is where those hang off. */
  const BT2_STRATS = [
    { id: "orb",         label: "ORB" },
    { id: "amd",         label: "AMD" },
    { id: "trend",       label: "Trend" },
    { id: "trendbreak",  label: "Trend Break" },
    { id: "imbalance",   label: "Candle Imbalance Fill" },
    { id: "reversal",    label: "Reversal Pattern" },
    { id: "continuation", label: "Continuation Pattern" },
    { id: "fib",         label: "Fib Discount" },
    { id: "emacross",    label: "EMA Cross" },
  ];
  const bt2Label = (id) => (BT2_STRATS.find((x) => x.id === id) || {}).label || "—";

  /* After Trade — the third daily section. Same one-tap-per-row shape as
     Before Trade Stage 1, and deliberately about process rather than numbers:
     the Trade Journal already holds entry, exit, instrument and P&L, so
     nothing here asks for them again. */
  const AT_ITEMS = [
    { id: "plan", label: "Did you follow your plan?", cols: 2, opts: [
      ["yes", "Yes"], ["no", "No"]] },
    { id: "outcome", label: "Trade outcome", cols: 3, opts: [
      ["win", "Win"], ["loss", "Loss"], ["breakeven", "Breakeven"]] },
    { id: "exit", label: "Exit reason", cols: 2, opts: [
      ["target", "Target hit"], ["stop", "Stop hit"],
      ["manual", "Manual exit"], ["time", "Time ran out"]] },
    { id: "state", label: "State during the trade", cols: 2, opts: [
      ["calm", "Calm"], ["anxious", "Anxious"],
      ["impulsive", "Impulsive"], ["confident", "Confident"]] },
    { id: "again", label: "Would you take this trade again?", cols: 2, opts: [
      ["yes", "Yes"], ["no", "No"]] },
  ];
  /* short forms for the summary, the same reason Stage 1 carries its own */
  const AT_SHORT = {
    plan: "Followed plan", outcome: "Outcome", exit: "Exit reason",
    state: "State", again: "Take it again",
  };

  /* shared by both checklists: the label an option id stands for */
  function optLabel(item, val) {
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
        ${/* The way out of the one-screen-at-a-time walk: the whole course as a
              list, one tap away from every lesson. The mark keeps the middle —
              the spacer on the left is what holds it there while the button
              sits beside it. */""}
        <div class="screen-head">
          <span class="screen-head-pad" aria-hidden="true"></span>
          <img class="card-logo" src="assets/logo/logo-symbol-v2@3x.png" alt="">
          <button type="button" class="lesson-nav" data-contents
                  aria-label="Course contents — jump to any page">
            <img src="assets/nav-icons/icon-lesson-nav.png" alt="">
          </button>
        </div>
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
      <button class="btn-secondary" data-ci-review>Review Answers</button>
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
    const res = state.checkinReview ? null : (state.checkinResult || checkinResultFor(todayKey()));
    cardScroll.innerHTML = `
      ${res ? checkinResultHTML(res) : `
      <h1 class="ci-heading">Check List Before Trading Day</h1>
      <div class="ci-list">
        ${CHECKIN_ITEMS.map((it, i) => {
          const ans = store.checklist[it.id];
          return `
          <div class="ci-row${ans ? " on" : ""}">
            <div class="ci-row-in">
              <span class="ci-num">${String(i + 1).padStart(2, "0")}</span>
              <img class="ci-ico" src="assets/checkin/${it.icon}@2x.png" alt="" aria-hidden="true">
              <span class="ci-text">
                <b>${esc(it.label)}</b>
                <small>${esc(it.sub)}</small>
              </span>
              <span class="ci-btns">
                <button class="ci-btn ci-yes${ans === "yes" ? " on" : ""}"
                        data-ci="${it.id}" data-ci-val="yes"
                        aria-label="${esc(it.label)} — yes" aria-pressed="${ans === "yes"}"></button>
                <button class="ci-btn ci-no${ans === "no" ? " on" : ""}"
                        data-ci="${it.id}" data-ci-val="no"
                        aria-label="${esc(it.label)} — no" aria-pressed="${ans === "no"}"></button>
              </span>
            </div>
          </div>`;
        }).join("")}
      </div>
      ${(() => {
        const ready = CHECKIN_ITEMS.every((it) => store.checklist[it.id]);
        return `<button class="ci-submit${ready ? "" : " off"}"
          ${ready ? "" : "disabled"} data-ci-submit>${state.checkinReview ? "Resubmit" : "Submit"}</button>`;
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

  /* A completed section shows its headline and nothing else until it is
     asked. Same disclosure shape the prop-firm summary pill uses: the label
     is the tap target and the caret turns over when the recap is showing. */
  function ciExpandHTML(label, open, attr, big) {
    return `<button class="ci-expand${big ? " ci-expand-lg" : ""}${open ? " open" : ""}" ${attr}
            aria-expanded="${open ? "true" : "false"}">
      <span class="ci-expand-lbl">${esc(label)}</span>
      <span class="ci-expand-caret" aria-hidden="true">
        <img src="assets/nav-icons/icon-chevron-down@2x.png" alt=""></span>
    </button>`;
  }

  function bt1SummaryHTML(a) {
    return `<div class="bt-summary">
      ${BT1_ITEMS.map((it) => `
        <div class="bt-sum-row">
          <span class="bt-sum-k">${esc(BT1_SHORT[it.id])}</span>
          <span class="bt-sum-v">${esc(optLabel(it, a[it.id]))}</span>
        </div>`).join("")}
    </div>`;
  }

  function bt1ResultHTML() {
    const a = (store.beforeTradeLog[todayKey()] || {}).answers || store.beforeTrade;
    const open = !!state.btDetail;
    return `<div class="ci-result ci-result-inline go">
      ${ciExpandHTML("Pre-Trade Check Complete", open, "data-bt-detail", true)}
      ${open ? bt1SummaryHTML(a) : ""}
      <button class="btn-primary" data-bt-stage2>Continue to Stage 2</button>
    </div>`;
  }

  /* Stage 2, step 1: which strategy. Same shape as a Stage 1 row — the
     question in the label pill, the answers as tap-to-select pills under it —
     so the two stages read as one checklist rather than two screens that
     happen to follow each other. */
  function bt2SelectHTML() {
    const picked = store.beforeTrade.strategy;
    return `
      <h1 class="ci-heading">Before Trade · Stage 2</h1>
      <div class="bt-sub">Strategy</div>
      <div class="bt-list">
        <div class="bt-row${picked ? " done" : ""}">
          <div class="bt-q">Which strategy are you trading?</div>
          <div class="bt-opts bt-opts-2">
            ${BT2_STRATS.map((x) => `
              <button class="bt-opt${picked === x.id ? " on" : ""}"
                      data-bt2="${x.id}" aria-pressed="${picked === x.id}">${esc(x.label)}</button>`).join("")}
          </div>
        </div>
      </div>
      <button class="ci-submit${picked ? "" : " off"}"
        ${picked ? "" : "disabled"} data-bt2-continue>Continue</button>
      <button class="btn-secondary" data-bt-back>Back to Stage 1</button>`;
  }

  /* ==> PLACEHOLDER — STRATEGY FOLLOW-UPS GO HERE.
     Each of the nine strategies gets its own set of questions in a later pass.
     When they land, this is the branch that gets replaced: switch on
     store.beforeTrade.strategy and render that strategy's rows the way
     bt1RowsHTML renders Stage 1's, with their own submit. Nothing below this
     comment is meant to survive that build except the exits. */
  function bt2SoonHTML() {
    const picked = store.beforeTrade.strategy;
    return `<div class="ci-result ci-result-inline">
      <div class="ci-result-title soon">${esc(bt2Label(picked))}</div>
      <div class="ci-result-body">Strategy selected. Its follow-up questions are
        being built separately — your Stage 1 chart read and this pick are saved
        for today.</div>
      <button class="btn-primary" data-bt2-change>Pick a different strategy</button>
      <button class="btn-secondary" data-bt-exit>Back to Check-In</button>
    </div>`;
  }

  function bt1Stage2HTML() {
    return state.btStrategyDone ? bt2SoonHTML() : bt2SelectHTML();
  }

  function renderBeforeTrade() {
    barTitle.textContent = "Before Trade";
    paintStreak();
    /* A stage submitted today belongs to its summary for the rest of the day.
       Today's log is what says so — arriving used to clear an in-memory flag
       and hand back the blank questions, which lost the summary the moment
       the reader stepped off the screen. */
    const showResult = state.btResult || !!(store.beforeTradeLog[todayKey()] || {}).answers;
    const body = state.btStage2 ? bt1Stage2HTML()
      : showResult ? bt1ResultHTML()
      : bt1RowsHTML();
    cardScroll.innerHTML = body + checkinActionsHTML();
    /* ci-resulting centres a result in the card. Stage 2's selector is a
       question screen, not a result, so it only applies once the strategy has
       been picked and the placeholder is showing. */
    cardScroll.classList.toggle("ci-resulting",
      !!(showResult && !state.btStage2) || !!(state.btStage2 && state.btStrategyDone));
    cardScroll.scrollTop = ciKeepScroll ? ciScrollTop : 0;
    ciKeepScroll = false;
    cardFooter.style.display = "none";
  }

  function openBeforeTrade() {
    stopAudio();
    state.view = "beforetrade";
    state.slideDir = 0;
    // the renderer reads today's log, so arriving lands on whichever of the
    // two the day is actually in, and always on the collapsed headline
    state.btResult = false;
    state.btDetail = false;
    state.btStage2 = false;
    state.btStrategyDone = false;
    closeOverlay();
    render();
  }

  /* ---------------- After Trade ----------------
     Five one-tap rows, then a summary in place of them. Persistence follows
     Start Day rather than Before Trade: the submitted state is read straight
     back out of today's log, so navigating away and returning lands on the
     summary and the questions only come back when the calendar day does.
     There is no in-memory flag to fall out of step with the log. */

  function atAnswered() {
    return AT_ITEMS.every((it) => store.afterTrade[it.id]);
  }
  /* the one reader for a day's trades. A store written before After Trade
     went multi-entry still holds a bare record, so it is read as a list of
     one rather than being trusted to already be an array. */
  function atEntries(dayKey) {
    const v = (store.afterTradeLog || {})[dayKey];
    if (Array.isArray(v)) return v;
    return v && v.answers ? [v] : [];
  }

  function atRowsHTML(more) {
    return `
      <h1 class="ci-heading">After Trade</h1>
      <div class="bt-sub">${more ? "Another Trade" : "Process Review"}</div>
      <div class="bt-list">
        ${AT_ITEMS.map((it) => {
          const picked = store.afterTrade[it.id];
          return `<div class="bt-row${picked ? " done" : ""}">
            <div class="bt-q">${esc(it.label)}</div>
            <div class="bt-opts bt-opts-${it.cols}">
              ${it.opts.map(([v, label]) => `
                <button class="bt-opt${picked === v ? " on" : ""}" data-at="${it.id}" data-at-val="${v}"
                        aria-pressed="${picked === v}">${esc(label)}</button>`).join("")}
            </div>
          </div>`;
        }).join("")}
      </div>
      ${(() => {
        const ready = atAnswered();
        return `<button class="ci-submit${ready ? "" : " off"}"
          ${ready ? "" : "disabled"} data-at-submit>Submit</button>`;
      })()}
      ${more ? `<button class="btn-secondary" data-at-cancel>Cancel</button>` : ""}`;
  }

  /* One submitted trade. The caption only appears once there is more than one,
     so a single-trade day reads as one entry rather than "Trade 1 of 1".
     `toggle` is what separates the After Trade screen, where each entry
     collapses to its own headline and opens on its own, from the Discipline
     Streak scorecard, whose whole job is showing the answers. */
  function atEntryHTML(entry, i, total, toggle) {
    const rows = `<div class="bt-summary">
      ${AT_ITEMS.map((it) => `
        <div class="bt-sum-row">
          <span class="bt-sum-k">${esc(AT_SHORT[it.id])}</span>
          <span class="bt-sum-v">${esc(optLabel(it, (entry.answers || {})[it.id]))}</span>
        </div>`).join("")}
    </div>`;
    const cap = total > 1 ? `<div class="ds-entry-cap">Trade ${i + 1}</div>` : "";
    if (!toggle) return `<div class="ds-entry">${cap}${rows}</div>`;
    const open = !!state.atOpen[i];
    return `<div class="ds-entry">
      ${cap}
      ${ciExpandHTML("Trade Logged", open, `data-at-detail="${i}"`)}
      ${open ? rows : ""}
    </div>`;
  }

  /* every trade logged today, stacked, with the journal's own add button
     under them — a day can hold as many of these as it took trades. */
  function atResultHTML() {
    const list = atEntries(todayKey());
    return `<div class="ci-result ci-result-inline ci-result-stack go">
      <div class="ci-result-title">After Trade Complete</div>
      <div class="ci-result-body">${list.length > 1
        ? `${list.length} trades logged today.`
        : "Logged for today."}</div>
      <div class="ds-entries">${list.map((e, i) => atEntryHTML(e, i, list.length, true)).join("")}</div>
      <div class="j-add-wrap at-add">
        <button class="j-add" data-at-add aria-label="Add another trade"></button>
        <span class="j-add-label">Add another trade</span>
      </div>
      <button class="btn-secondary" data-at-exit>Back to Check-In</button>
    </div>`;
  }

  function renderAfterTrade() {
    barTitle.textContent = "After Trade";
    paintStreak();
    const list = atEntries(todayKey());
    const form = state.atAdding || list.length === 0;
    cardScroll.innerHTML = (form ? atRowsHTML(list.length > 0) : atResultHTML())
      + checkinActionsHTML();
    cardScroll.classList.toggle("ci-resulting", !form);
    cardScroll.scrollTop = ciKeepScroll ? ciScrollTop : 0;
    ciKeepScroll = false;
    cardFooter.style.display = "none";
  }

  function openAfterTrade() {
    stopAudio();
    state.view = "aftertrade";
    state.slideDir = 0;
    // arriving lands on the day's trades, collapsed, never mid-way through
    // adding one
    state.atAdding = false;
    state.atOpen = {};
    closeOverlay();
    render();
  }

  /* ---------------- Discipline Streak ----------------
     Today's scorecard, and a calendar back through every day already logged.
     Nothing here writes a checklist answer — it only reads the three logs,
     each already keyed by date, so a past day reads exactly as it did on the
     day. The only thing it does write is the review itself: opening the
     scorecard on a day whose other three sections are done is what completes
     "Review Streak Report Card", the fourth dot. Without that the dot has
     nothing that could ever fill it. */

  function dsMarkReviewed(key) {
    const others = DAY_SECTIONS.filter((x) => x.id !== "reviewCard");
    if (!others.every((x) => x.done(key))) return;
    const rec = store.dayProgress[key] || (store.dayProgress[key] = {});
    if (rec.reviewCard) return;
    rec.reviewCard = true;
    save();
  }

  /* One row of the scorecard: a caption, a headline, and the section's own
     detail underneath once it is opened. A section with nothing logged is the
     same row shape with nothing to open, so the stack keeps its rhythm
     whether the day is finished or barely started. */
  function dsRowHTML(cap, label, id, detail, sub) {
    const head = detail
      ? ciExpandHTML(label, !!state.dsOpen[id], `data-ds-detail="${esc(id)}"`)
      : `<div class="ci-expand ci-expand-off">
           <span class="ci-expand-lbl">Not completed yet</span>
         </div>`;
    return `<div class="ds-row">
      <div class="ds-card-cap">${esc(cap)}${sub ? ` · ${esc(sub)}` : ""}</div>
      ${head}
      ${detail && state.dsOpen[id] ? detail : ""}
    </div>`;
  }

  function dsSumHTML(rows) {
    return `<div class="bt-summary">
      ${rows.map(([k, v]) => `
        <div class="bt-sum-row">
          <span class="bt-sum-k">${esc(k)}</span>
          <span class="bt-sum-v">${esc(v)}</span>
        </div>`).join("")}
    </div>`;
  }

  /* Start Day's headline is its own verdict, so a day that was called off
     says so here rather than claiming it started. */
  function dsStartDayRow(key) {
    const rec = (store.checkinLog || {})[key];
    if (!rec || !rec.answers) return dsRowHTML("Start Day", "", "start", null);
    const noCount = CHECKIN_ITEMS.filter((it) => rec.answers[it.id] === "no").length;
    const label = noCount < 3 ? "Start Trade Day" : "Not a Trade Day";
    const detail = `<div class="ds-note">${noCount} of ${CHECKIN_ITEMS.length} marked No</div>
      ${dsSumHTML(CHECKIN_ITEMS.map((it) => [CHECKIN_SHORT[it.id],
        rec.answers[it.id] === "yes" ? "Yes" : rec.answers[it.id] === "no" ? "No" : "—"]))}`;
    return dsRowHTML("Start Day", label, "start", detail);
  }

  function dsBeforeTradeRow(key) {
    const rec = (store.beforeTradeLog || {})[key];
    if (!rec || !rec.answers) return dsRowHTML("Before Trade", "", "before", null);
    return dsRowHTML("Before Trade", "Pre-Trade Check Complete", "before",
      dsSumHTML(BT1_ITEMS.map((it) => [BT1_SHORT[it.id], optLabel(it, rec.answers[it.id])])));
  }

  /* one row per trade taken, in the order they were submitted */
  function dsAfterTradeRows(key) {
    const list = atEntries(key);
    if (!list.length) return dsRowHTML("After Trade", "", "at", null);
    return list.map((e, i) => dsRowHTML("After Trade", "Trade Logged", `at${i}`,
      dsSumHTML(AT_ITEMS.map((it) => [AT_SHORT[it.id], optLabel(it, (e.answers || {})[it.id])])),
      list.length > 1 ? `Trade ${i + 1}` : "")).join("");
  }

  /* the day's headline: what was done, said the way a coach would say it */
  function dsHeadHTML(key, isToday) {
    const done = sectionsDone(key), total = DAY_SECTIONS.length;
    const when = isToday ? "today" : "that day";
    const title = done === total ? "Staying disciplined"
      : done === 0 ? "Nothing logged yet"
      : `${done} of ${total} complete`;
    const body = done === total
      ? `Every section logged ${when}. That is what a discipline day looks like.`
      : done === 0
        ? (isToday ? "Start with the Start Day checklist and work down." : "No sections were logged on this day.")
        : (isToday ? "Good start — keep going and finish the day out." : `${total - done} of the four went unlogged.`);
    return `<div class="ds-head ${done === total ? "full" : ""}">${esc(title)}</div>
      <div class="ds-sub">${esc(body)}</div>`;
  }

  function dsScorecardHTML(key, isToday) {
    return `
      ${dsHeadHTML(key, isToday)}
      <div class="ds-rows">
        ${dsStartDayRow(key)}
        ${dsBeforeTradeRow(key)}
        ${dsAfterTradeRows(key)}
      </div>`;
  }

  /* Same calendar the journal uses — month header, nav arrows, day grid — with
     the day's section count where the journal puts P&L. All seven columns are
     real days here; the journal spends its last one on a week total. */
  function dsCalendarHTML() {
    const base = new Date();
    base.setDate(1);
    base.setMonth(base.getMonth() + state.dsMonth);
    const y = base.getFullYear(), m = base.getMonth();
    const monthName = base.toLocaleDateString("en-US", { month: "long", year: "numeric" });
    const first = new Date(y, m, 1);
    const start = new Date(y, m, 1 - first.getDay());
    const today = todayKey();
    const cells = [];
    let fullDays = 0, loggedDays = 0;
    for (let i = 0; i < 42; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      const inMonth = d.getMonth() === m && d.getFullYear() === y;
      const dk = dayKey(d.getFullYear(), d.getMonth(), d.getDate());
      const n = inMonth ? sectionsDone(dk) : 0;
      if (inMonth && n) { loggedDays++; if (n === DAY_SECTIONS.length) fullDays++; }
      cells.push({ d, dk, inMonth, n, future: dk > today });
    }
    while (cells.length > 35 && cells.slice(-7).every((c) => !c.inMonth)) cells.length -= 7;

    const grid = cells.map((c) => {
      if (!c.inMonth) return `<div class="j-day out">${c.d.getDate()}</div>`;
      if (c.future) return `<div class="j-day out">${c.d.getDate()}</div>`;
      const cls = c.n === DAY_SECTIONS.length ? "ds-full" : c.n ? "ds-part" : "";
      return `<button class="j-day ${cls}" data-ds-day="${c.dk}">
        <span class="j-date">${c.d.getDate()}</span>
        ${c.n ? `<span class="ds-day-n">${c.n}/${DAY_SECTIONS.length}</span>` : ""}
      </button>`;
    }).join("");

    return `
      <div class="j-cal ds-cal">
        <div class="j-cal-head">
          <div class="j-month">
            <span>${esc(monthName)}</span>
            <button class="j-nav" data-ds-month="-1" aria-label="Previous month">‹</button>
            <button class="j-nav" data-ds-month="1" aria-label="Next month">›</button>
          </div>
          <div class="j-cal-stats">
            <span><span class="j-stat-label">Full</span>
              <span class="j-stat-val cyan">${fullDays}</span></span>
            <span><span class="j-stat-label">Logged</span>
              <span class="j-stat-val cyan">${loggedDays}</span></span>
          </div>
        </div>
        <div class="j-dow">${["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"].map((d) => `<span>${d}</span>`).join("")}</div>
        <div class="j-grid">${grid}</div>
      </div>`;
  }

  function dsDayLabel(key) {
    const [y, m, d] = key.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString("en-US",
      { weekday: "long", month: "long", day: "numeric" });
  }

  function renderStreak() {
    barTitle.textContent = "Discipline Streak";
    paintStreak();
    const past = state.dsDay;
    const key = past || todayKey();
    const streak = disciplineStreak();
    const body = past
      ? `<button class="jd-back" data-ds-back aria-label="Back to the calendar">‹</button>
         <h1 class="ci-heading">${esc(dsDayLabel(past))}</h1>
         ${dsScorecardHTML(past, false)}`
      : `<h1 class="ci-heading">Today's Scorecard</h1>
         <div class="bt-sub">${streak} day${streak === 1 ? "" : "s"} in a row</div>
         ${dsScorecardHTML(key, true)}
         ${dsCalendarHTML()}`;
    cardScroll.innerHTML = body + checkinActionsHTML();
    cardScroll.classList.remove("ci-resulting");
    cardScroll.scrollTop = ciKeepScroll ? ciScrollTop : 0;
    ciKeepScroll = false;
    cardFooter.style.display = "none";
  }

  function openStreak() {
    stopAudio();
    state.view = "streak";
    state.slideDir = 0;
    state.dsDay = null;
    state.dsMonth = 0;
    state.dsOpen = {};
    dsMarkReviewed(todayKey());
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
     read their own submitted logs; the one that has no screen yet reads
     store.dayProgress, which is the hook it will write to when built. */
  const DAY_SECTIONS = [
    { id: "startDay", label: "Start Day", done: (k) => !!(store.checkinLog || {})[k] },
    { id: "beforeTrade", label: "Before Trade", done: (k) => !!(store.beforeTradeLog || {})[k] },
    { id: "afterTrade", label: "After Trade", done: (k) => atEntries(k).length > 0 },
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

  /* ---------------- Pickæway lobby and stake ----------------
     Two screens before a match: what you are watching, then what it costs.
     This replaces the old timeframe/reaction-window lobby and the per-round
     risk chips that used to live inside the match — the stake is now set once
     for the whole match and split across its prints, so nothing about it can
     change once the match is running. */

  const BM_INSTRUMENTS = [
    { id: "ES",  name: "E-mini S&P" },
    { id: "NQ",  name: "Nasdaq 100" },
    { id: "YM",  name: "Dow Jones" },
    { id: "RTY", name: "Russell 2000" },
  ];
  const BM_COOLDOWNS = [2, 3, 5, 10, 15];          // the whole match clock, in minutes
  const BM_CANDLES = [5, 10, 15, 20, 25, 30, 35, 40];
  /* The lock window is a print's share of the match clock divided by this, so
     a bigger factor is less time to call. Easy leaves most of the print's life
     to read it; hard takes all but a sliver. */
  const BM_DIFFS = [
    { id: "easy",   label: "Easy",   sub: "More time to read the close", factor: 1.2 },
    { id: "medium", label: "Medium", sub: "Keep it moving",              factor: 1.6 },
    { id: "hard",   label: "Hard",   sub: "Snap calls, no linger",       factor: 2.4 },
  ];
  const BM_RISKS = [1, 2, 4, 5, 10, 20];           // dollars, for the whole match
  /* n:2n — the tier number is the multiple of the base unit put at risk, and
     twice that is what the print pays. */
  const BM_TIERS = [1, 2, 3, 4];
  const BM_BANKROLL = 100;

  const bmInstrument = (id) => BM_INSTRUMENTS.find((x) => x.id === id) || BM_INSTRUMENTS[0];
  const bmDiff = (id) => BM_DIFFS.find((x) => x.id === id) || BM_DIFFS[1];

  function bmSettings() {
    const b = store.buildMatch || {};
    const has = (list, v) => list.some((x) => (x.id !== undefined ? x.id : x) === v);
    return {
      instrument: has(BM_INSTRUMENTS, b.instrument) ? b.instrument : "ES",
      cooldown: BM_COOLDOWNS.indexOf(b.cooldown) >= 0 ? b.cooldown : 5,
      candles: BM_CANDLES.indexOf(b.candles) >= 0 ? b.candles : 10,
      difficulty: has(BM_DIFFS, b.difficulty) ? b.difficulty : "medium",
      risk: BM_RISKS.indexOf(b.risk) >= 0 ? b.risk : 5,
      tier: BM_TIERS.indexOf(b.tier) >= 0 ? b.tier : 2,
    };
  }

  function bmSet(key, value) {
    store.buildMatch = Object.assign(bmSettings(), { [key]: value });
    save();
    if (state.view === "stake") renderStake(); else renderBuildMatch();
  }

  /* Every derived number in one place, so the lobby, the stake screen and the
     match itself cannot disagree about what the match is. */
  function bmDerived(s) {
    const clockSecs = s.cooldown * 60;
    const perPrint = clockSecs / s.candles;
    // never less than a second to call, however tight the settings get
    const lock = Math.max(1, perPrint / bmDiff(s.difficulty).factor);
    const baseUnit = s.risk / s.candles;
    return {
      clockSecs, perPrint,
      lock: Math.round(lock * 10) / 10,

      baseUnit,
      riskPerCandle: baseUnit * s.tier,
      winPerCandle: baseUnit * s.tier * 2,
      allRight: baseUnit * s.tier * 2 * s.candles,
      allWrong: baseUnit * s.tier * s.candles,
    };
  }

  /* Round the whole thing to seconds BEFORE splitting: rounding the minutes and
     the remainder independently turns 119.9999s into "1m 60s" / "1:60". */
  function durationLabel(secs) {
    const t = Math.round(secs);
    return `${Math.floor(t / 60)}m ${t % 60}s`;
  }
  const clockLabel = (secs) => {
    const t = Math.round(secs);
    return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`;
  };
  const bmMoney = (n) => "$" + n.toFixed(2);

  function bmPillRow(list, current, attr, label, cols) {
    return `<div class="bm-row bm-row-${cols}">
      ${list.map((x) => {
        const v = x.id !== undefined ? x.id : x;
        return `<button class="bm-rect ${current === v ? "on" : ""}" data-${attr}="${esc(String(v))}"
          aria-pressed="${current === v}">${esc(label(x))}</button>`;
      }).join("")}
    </div>`;
  }

  function renderBuildMatch() {
    const s = bmSettings();
    const d = bmDerived(s);
    const ins = bmInstrument(s.instrument);
    barTitle.textContent = "Pickæway";
    const pickName = document.querySelector("#pickBar .pick-name");
    if (pickName) pickName.textContent = "Build Match";
    /* Everything on this screen has to fit one view without scrolling, so the
       helper paragraphs under each section are gone and the overview is a
       plain stack of three lines rather than a stat grid. */
    cardScroll.innerHTML = `
      <div class="bm-lobby">
        <div class="bm-label">Instrument<span class="bm-ins-name">${esc(ins.id)} — ${esc(ins.name)}</span></div>
        ${bmPillRow(BM_INSTRUMENTS, s.instrument, "bmins", (x) => x.id, 4)}

        <div class="bm-label">Cooldown</div>
        ${bmPillRow(BM_COOLDOWNS, s.cooldown, "bmcool", (x) => `${x} min`, 5)}

        <div class="bm-label">Candles to call</div>
        ${bmPillRow(BM_CANDLES, s.candles, "bmcd", (x) => String(x), 8)}

        <div class="bm-label">Difficulty</div>
        <div class="bm-diffs">
          ${BM_DIFFS.map((x) => `
            <button class="bm-diff-card${s.difficulty === x.id ? " on" : ""}" data-bmdiff="${x.id}"
                    aria-pressed="${s.difficulty === x.id}">
              <span class="bm-diff-t">${esc(x.label)}</span>
              <span class="bm-diff-s">${esc(x.sub)}</span>
            </button>`).join("")}
        </div>

        <div class="bm-label">Match Overview</div>
        <div class="bm-sum">
          <div class="bm-sum-line"><span>Match clock</span><b>${clockLabel(d.clockSecs)}</b></div>
          <div class="bm-sum-line"><span>Candles</span><b>${s.candles}</b></div>
          <div class="bm-sum-line"><span>Time per candle</span><b>${d.lock.toFixed(1)}s</b></div>
        </div>

        <button class="bm-start" data-bmstake>Set Risk</button>
      </div>`;
    cardScroll.scrollTop = bmKeepScroll ? bmScrollTop : 0;
    bmKeepScroll = false;
    cardFooter.style.display = "none";
  }

  /* Changing a setting rebuilds the whole screen, and the reader should stay
     where they were rather than being thrown back to the top — the same
     mechanism the checklists and the journal use. */
  let bmKeepScroll = false, bmScrollTop = 0;
  function bmRenderInPlace(fn) {
    bmScrollTop = cardScroll.scrollTop;
    bmKeepScroll = true;
    fn();
  }

  function renderStake() {
    const s = bmSettings();
    const d = bmDerived(s);
    barTitle.textContent = "Pickæway";
    const pickName = document.querySelector("#pickBar .pick-name");
    if (pickName) pickName.textContent = "Set Risk";
    /* One view, no scrolling, so the lobby recap and the plain-language line
       under the split are both gone — the numbers say it. */
    cardScroll.innerHTML = `
      <div class="bm-lobby">
        <div class="bm-bank">
          <div class="bm-bank-cap">Balance</div>
          <div class="bm-bank-val">${plainMoney(BM_BANKROLL)}</div>
        </div>

        <div class="bm-label">Risk this match</div>
        ${bmPillRow(BM_RISKS, s.risk, "bmrisk", (x) => "$" + x, 6)}

        <div class="bm-label">Reward</div>
        ${bmPillRow(BM_TIERS, s.tier, "bmtier", (x) => `${x}:${x * 2}`, 4)}

        <div class="bm-label">Split across ${s.candles} candles</div>
        <div class="bm-split">
          <div class="bm-split-math">
            <span>${bmMoney(s.risk)} ÷ ${s.candles}</span>
            <b>${bmMoney(d.baseUnit)}</b>
            <span>base unit</span>
          </div>
          <div class="bm-sum-grid">
            <div class="bm-sum-cell"><b class="down">${bmMoney(d.riskPerCandle)}</b><span>Per candle risk</span></div>
            <div class="bm-sum-cell"><b class="up">${bmMoney(d.winPerCandle)}</b><span>Per candle win</span></div>
            <div class="bm-sum-cell"><b class="up">+${bmMoney(d.allRight)}</b><span>All correct</span></div>
            <div class="bm-sum-cell"><b class="down">−${bmMoney(d.allWrong)}</b><span>All wrong</span></div>
          </div>
        </div>

        <button class="bm-start" data-bmstart>Start match</button>
        <button class="btn-secondary" data-bmback>Back</button>
      </div>`;
    cardScroll.scrollTop = bmKeepScroll ? bmScrollTop : 0;
    bmKeepScroll = false;
    cardFooter.style.display = "none";
  }

  function openStake() {
    stopAudio();
    state.view = "stake";
    state.slideDir = 0;
    state.panel = null;
    closeOverlay();
    render();
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
    const d = bmDerived(s);
    mkAbort();
    /* The chart is still aggregated from 30-second bars; a candle's length now
       comes from the match clock rather than from a fixed timeframe, so the
       nearest aggregation to that length is what the chart is built from. */
    const spec = mkSpecForPrint(d.perPrint);
    const need = (MK_HISTORY + s.candles + 2) * (MK_BARS_30S[spec.id] || 2);
    mk.on = true;
    mk.s = s;
    mk.d = d;
    mk.spec = spec;
    mk.win = d.lock;                 // seconds to lock this print
    mk.dur = d.perPrint;             // how long the print lives
    mk.tf = mkAggregate(genSession30s(s.instrument, need), spec.id);
    mk.rounds = s.candles;
    mk.round = 0;
    mk.bankP = BM_BANKROLL;
    mk.bankA = BM_BANKROLL;
    mk.ptsP = 0;
    mk.ptsA = 0;
    mk.log = [];
    mk.expand = false;
    /* Fixed for the match. The stake screen already split it across the
       candles, so there is nothing left to choose once the match is running —
       which is why the in-match risk and R:R chips are gone. */
    mk.risk = d.riskPerCandle;
    mk.win$ = d.winPerCandle;
    stopAudio();
    state.view = "match";
    state.slideDir = 0;
    closeOverlay();
    mkBeginRound();
    render();
  }

  /* The chart aggregates 30s bars into prints. Pick the aggregation closest to
     how long a print actually lives, so a 3-second print is not drawn from
     5-minute bars and a 3-minute one is not drawn from 1-minute bars. */
  function mkSpecForPrint(secs) {
    const opts = [
      { id: "1m", at: 60 }, { id: "2m", at: 120 },
      { id: "3m", at: 180 }, { id: "5m", at: 300 },
    ];
    let best = opts[0];
    opts.forEach((o) => {
      if (Math.abs(o.at - secs) < Math.abs(best.at - secs)) best = o;
    });
    return best;
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

    /* A missed print is flat: no win, no loss, no change to the bankroll —
       the same as not taking the trade. A called one settles at the per-print
       amounts the stake screen fixed for the whole match. */
    if (!missed) mk.bankP += pCorrect ? mk.win$ : -mk.risk;
    mk.bankA += aCorrect ? mk.ai.risk * MK_RRS[mk.ai.rrIdx].m : -mk.ai.risk;
    mk.ptsP += pPts;
    mk.ptsA += aPts;

    mk.log.push({
      round: mk.round + 1,
      actualDir,
      playerDir: missed ? "missed" : mk.pick,
      playerRisk: mk.risk, playerWin: mk.win$,
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
      /* The lobby has no timeframe any more — a print's length comes from the
         match clock. tfMin is still the minutes the chart aggregates at, which
         is what the replay needs to line a round up with a candle, and it now
         comes from the aggregation the print length chose. */
      tfMin: mk.spec.at / 60,
      candleDuration: mk.dur,
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

  /* What is left of the whole match, not of this candle. Every candle owns an
     equal share of the match clock, so the rounds already closed have spent
     theirs in full and the live one has spent what it has elapsed. The pause
     between rounds is deliberately not counted: the clock the lobby promised
     is the candles' time, and counting the gaps would make it run past the
     figure the player picked. */
  function mkMatchLeft() {
    const spent = mk.round * mk.dur + Math.min(mk.elapsed, mk.dur);
    return Math.max(0, mk.d.clockSecs - spent);
  }

  function mkPaintClock() {
    const m = $("mkMatchClock");
    if (m) m.textContent = clockLabel(mkMatchLeft());
    const mf = $("mkMatchFill");
    if (mf) mf.style.width = `${Math.max(0, Math.min(1, mkMatchLeft() / mk.d.clockSecs)) * 100}%`;

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
        : (r.playerCorrect ? r.playerWin : -r.playerRisk);
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
            ? `Locked ${mk.pick === "green" ? "Green ▲" : "Red ▼"} at ${mk.lockedAt}s · ${bmMoney(mk.risk)} to win ${bmMoney(mk.win$)}`
            : "No call made — this round scores nothing and costs nothing"}</div>
        </div>`;
    }
    if (mk.pick) {
      return `
        <div class="mk-waiting locked">
          <div class="mk-waiting-head">Locked in ${mk.pick === "green" ? "Green ▲" : "Red ▼"}</div>
          <div class="mk-waiting-sub">${mk.lockedAt}s · risking ${bmMoney(mk.risk)}
            · ${bmMoney(mk.win$)} to win</div>
        </div>`;
    }
    /* No risk or R:R chips any more. Both were set once on the stake screen
       and split across the prints, so there is nothing here to choose — only
       a reminder of what this print is worth. */
    return `
      <div class="mk-calls">
        <button class="mk-call green" data-mkpick="green"><span>▲</span> Green</button>
        <button class="mk-call red" data-mkpick="red"><span>▼</span> Red</button>
      </div>
      <div class="mk-stake">
        <span>Risking <b class="down">${bmMoney(mk.risk)}</b></span>
        <span>To win <b class="up">${bmMoney(mk.win$)}</b></span>
      </div>`;
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
    /* The candle countdown belongs to the candle that is still forming. Once
       it has resolved there is nothing left to call on it, so the row goes
       and only the match clock keeps running. */
    const live = mk.phase !== "resolved";
    cardScroll.innerHTML = `
      <div class="mk-head">
        <div class="mk-round">Round ${mk.round + 1} / ${mk.rounds}</div>
        <div class="mk-meta">${esc(mk.s.instrument)} · ${mk.s.candles} candles · ${mk.s.difficulty.toUpperCase()}</div>
      </div>
      <div class="mk-topline">
        <div class="mk-balance">
          <span class="mk-balance-cap">Balance</span>
          <span class="mk-balance-val ${mk.bankP > BM_BANKROLL ? "up" : mk.bankP < BM_BANKROLL ? "down" : ""}"
                id="mkBalance">${mkBank(mk.bankP)}</span>
        </div>
        <div class="mk-matchclock">
          <span class="mk-balance-cap">Match</span>
          <span class="mk-matchclock-val" id="mkMatchClock">${clockLabel(mk.d.clockSecs)}</span>
        </div>
      </div>
      <div class="mk-clock-bar match"><span id="mkMatchFill"></span></div>
      ${mkScoreHTML()}
      <div class="mk-chart-wrap"><canvas id="mkChart" class="mk-chart" height="200"></canvas></div>
      ${live ? `
        <div class="mk-clock-row">
          <span class="mk-phase ${mk.phase}">${phaseLabel}</span>
          <span class="mk-clock" id="mkClock">0.0s</span>
        </div>
        <div class="mk-clock-bar"><span id="mkClockFill"></span></div>`
        : `<div class="mk-clock-row"><span class="mk-phase resolved">${phaseLabel}</span></div>`}
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
            const pCh = miss ? 0 : (r.playerCorrect ? r.playerWin : -r.playerRisk);
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
        ${[{ v: m.inst, l: "Instrument" }, { v: String(m.totalRounds), l: "Candles" },
           { v: `${m.win}s`, l: "Time Per Candle" },
           { v: m.difficulty.toUpperCase(), l: "Difficulty" },
           { v: `${Math.round(m.candleDuration)}s`, l: "Candle Life" }]
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
    const pnl = miss ? 0 : (r.playerCorrect ? r.playerWin : -r.playerRisk);
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
          <div><span>Stake</span><b>${miss ? "—" : bmMoney(r.playerRisk) + " → " + bmMoney(r.playerWin)}</b></div>
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
      /* ==> ONLINE: the account's photo is this one too (profiles.js) */
      profileOnlinePhotoSync(store.profilePhoto);
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
    /* Each game's own mark. Pickæway and Pointæway used to borrow the replay
       and knowledge-test glyphs; icon-match-replay is still what the Match
       Replay button on the Pickæway home screen draws, so it stayed where it
       was rather than being repainted. */
    /* All three carry a scene now. Each one's art is its game — the reacher
       going for a candle, the two animals with the VS between them, the pack
       running the clock down — so the picture stands in for the title row and
       the icon rides at the head of the line underneath. */
    { id: "pickaeway", name: "Pickæway", tag: "You vs. You",
      blurb: "Read the candles as they print and call the next move before the print dies.",
      icon: "assets/nav-icons/icon-game-pickaeway@2x.png",
      art: "assets/games/banner-pickaeway.jpg" },
    { id: "pointaeway", name: "Pointæway", tag: "1v1 Card Game",
      blurb: "Bull against Bear. Play a candle, reveal together, and push the print 25 points your way.",
      icon: "assets/nav-icons/icon-game-pointaeway@2x.png",
      art: "assets/pointaeway/selection-banner.jpg" },
    { id: "placeaway", name: "Placæway", tag: "Solo Speed Run",
      blurb: "The whole pattern prints at once. Place every candle in order against the clock.",
      icon: "assets/nav-icons/icon-dock-match-replay@2x.png",
      art: "assets/games/banner-placeaway.jpg" },
  ];

  function renderGames() {
    barTitle.textContent = "Gameæway";
    const pickName = document.querySelector("#pickBar .pick-name");
    if (pickName) pickName.textContent = "Cool Down Game";
    cardScroll.innerHTML = `
      <div class="gs-head">Pick your game</div>
      <div class="gs-list">
        ${GAMES.map((g) => g.art ? `
          <button class="gs-card gs-card-art" data-game="${g.id}">
            <span class="gs-scene" style="background-image:url('${esc(g.art)}')">
              <span class="gs-name">${esc(g.name)}</span>
              <span class="gs-tag">${esc(g.tag)}</span>
            </span>
            ${/* the entry's title row is the scene, so its icon rides at the
                  head of the line below it — the same left column the other
                  two entries put theirs in */""}
            <span class="gs-foot">
              <span class="gs-icon sm"><img src="${esc(g.icon)}" alt=""></span>
              <span class="gs-blurb">${esc(g.blurb)}</span>
            </span>
            <span class="gs-chev" aria-hidden="true">›</span>
          </button>` : `
          <button class="gs-card" data-game="${g.id}">
            <span class="gs-icon"><img src="${esc(g.icon)}" alt=""></span>
            <span class="gs-text">
              <span class="gs-name">${esc(g.name)}</span>
              <span class="gs-tag">${esc(g.tag)}</span>
              <span class="gs-blurb">${esc(g.blurb)}</span>
            </span>
            <span class="gs-chev" aria-hidden="true">›</span>
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

     ==> The rules are not in this file. They are in js/pw-rules.js, and they
     moved there so that the market simulator plays the game the app plays
     rather than a copy of it: ten thousand bots a day resolving rounds through
     a second implementation would be two games the moment one of them was
     corrected and the other was not. Nothing about the rules changed in the
     move. What is below is the screen's half — the board, the hand, the result,
     the history — plus a short list of names that bind this file's old call
     sites onto the one engine.

     The port keeps three things from the reference deliberately, each of which
     was a bug there once, and all three are now the module's:

       - resolveRound() is pure. It reads the two cards and the candle and
         returns a description of what should happen; applyResult() is the
         only thing that changes state. Keeping the two apart is what makes the
         round logic testable at all — and it is why a headless bot can play
         through exactly this code.
       - applyResult() draws against local copies of the decks ("bags") and
         commits once at the end. The reference hit a bug where multi-card
         effects — FOMO drawing two, a hand refilling — read stale
         deck state between draws and handed out the same card repeatedly.
         Vanilla JS would not batch the way React did, but the pattern is worth
         keeping: one commit means one place where the decks can go wrong.
       - A special card's own fields never share a name with the engine's. The
         reference briefly spread these objects in an order that let a card's
         own classification overwrite the engine's `kind`, which silently broke
         every special in the deck; the card's own is `effect`.

     The engine needs to be told which match it is talking about. In this file
     there is only ever one, and it is `pw` — so every binding below is the
     same function it always was with `pw` filled in. */
  const R = window.PWRules;

  /* the whole game, in one place, so leaving the screen can drop it cleanly */
  let pw = null;
  let pwTimer = null;
  let pwRollTimer = null;   // the side randomiser's flicker
  let pwRolling = false;

  /* ---- the engine, under the names this file has always called it ----
     Tables and pure helpers pass straight through. Anything that needs to know
     which match it is looking at is handed `pw`, and that is the whole of the
     binding: there is no logic on this page, and every name on the left is the
     same function it was before the rules moved into their own file. */
  const PW_TIERS_BY_SIDE   = R.TIERS_BY_SIDE;
  const PW_SPECIALS        = R.SPECIALS;
  const PW_SPECIALS_SHOWN  = R.SPECIALS_SHOWN;
  const PW_SUBSTITUTES     = R.SUBSTITUTES;
  const PW_CLASS_A         = R.CLASS_A;
  const PW_SPEC            = R.SPEC;
  const PW_POINTS          = R.POINTS;
  const PW_POINT_RULES     = R.POINT_RULES;
  const PW_SPEC_COLOURS    = R.SPEC_COLOURS;
  const PW_SPEC_PER_COLOUR = R.SPEC_PER_COLOUR;
  const PW_DEFAULT_SETTINGS = R.DEFAULT_SETTINGS;
  const PW_STRONG_REPLAY   = R.STRONG_REPLAY;
  const PW_SPECIAL_ART     = R.SPECIAL_ART;
  const PW_TARGET          = R.TARGET;        // the default, and what an unstarted screen shows
  const PW_TIER_COPIES     = R.TIER_COPIES;   // one deck's worth at the default size

  const pwTiers            = R.tiers;
  const pwSettings         = R.settings;
  const pwId               = R.id;
  const pwBuildTierDeck    = R.buildTierDeck;
  const pwPickSpecialTypes = R.pickSpecialTypes;
  const pwBuildSpecialDeck = R.buildSpecialDeck;
  const pwShuffle          = R.shuffle;
  const pwSign             = R.sign;
  const pwSigned           = R.signed;
  const pwEmptyCounts      = R.emptyCounts;
  const pwEffPts           = R.effPts;
  const pwCardLabel        = R.cardLabel;
  const pwCardsMatch       = R.cardsMatch;
  const pwTakeProfitMatch  = R.takeProfitMatch;
  const pwWorthReplaying   = R.worthReplaying;
  const pwResolveRound     = R.resolveRound;
  const pwDisciplineWash   = R.disciplineWash;
  const pwSubLog           = R.subLog;
  const pwNewGame          = R.newGame;

  /* and the ones that read or move the match on screen */
  const pwRules   = () => R.rules(pw);
  const pwTarget  = () => R.target(pw);
  const pwCopies  = () => R.copies(pw);
  const pwClamp   = (v, target) => R.clamp(pw, v, target);
  const pwOwnDeck = (side) => R.ownDeck(pw, side);
  /* why a card can be in a hand and unplayable: see pwBlocked in js/pw-rules.js */
  const pwBlocked = (card, who) => R.blocked(pw, card, who);
  const pwSubstitute = (card, who) => R.substitute(pw, card, who);
  const pwPlayable = (hand, who) => R.playable(pw, hand, who);
  const pwFullyOut = (hand, side) => R.fullyOut(pw, hand, side);
  const pwTopUp = (hand, side, who) => R.topUp(pw, hand, side, who);
  const pwRecordLast = (pCard, aCard) => R.recordLast(pw, pCard, aCard);
  const pwAiChooseCard = (hand) => R.aiChooseCard(pw, hand);
  const pwAiAnswerPeek = (playerCard) => R.aiAnswerPeek(pw, playerCard);
  const pwAiDrawSource = (specialCount) => R.aiDrawSource(pw, specialCount);
  const pwPlay = (cardId) => R.play(pw, cardId);
  const pwDisciplineAnswer = (cardId) => R.disciplineAnswer(pw, cardId);
  const pwCommitPending = (silent) => R.commitPending(pw, silent);
  const pwTakeProfitChoose = (doubleUp) => R.takeProfitChoose(pw, doubleUp);
  const pwApplyResult = (result, pCard, aCard, silent) =>
    R.applyResult(pw, result, pCard, aCard, silent);
  const pwChooseDraw = (source) => R.chooseDraw(pw, source);
  const pwFinishRound = (finalCandle, silent) => R.finishRound(pw, finalCandle, silent);

  /* the reveal beat, which is this file's and not the engine's */
  const PW_REVEAL_MS = 700;

  /* A dealt match, folded onto the object the screen already holds — the engine
     builds it, this keeps it, and the only thing added here is the repaint. */
  function pwStart(side, settings) {
    Object.assign(pw, R.deal(side, settings));
    renderPointaeway();
  }

  /* ---- picking a side at random ----

     The two cards are already on the screen, so the randomiser flickers
     between them rather than standing a third object in front of them: it
     lights one, then the other, faster than a decision, slowing as it goes,
     and lands on the side it picked before the first flash. The side is
     chosen up front — this is a randomiser being shown, not a race being run,
     and there is no STOP to keep a promise to any more.

     The lighting is done on the nodes rather than through a re-render: the
     screen would otherwise be rebuilt fifteen times in a second, and the two
     card images would be replaced under the animation each time. */

  const PW_ROLL_STEPS = 15;
  const PW_ROLL_FAST_MS = 55;
  const PW_ROLL_EASE_MS = 165;    // how much slower the last flash is
  const PW_ROLL_SETTLE_MS = 620;  // the beat on the winner before the match

  function pwRollCancel() {
    if (pwRollTimer) { clearTimeout(pwRollTimer); pwRollTimer = null; }
    pwRolling = false;
    document.querySelectorAll(".pw-pick.lit, .pw-pick.won")
      .forEach((e) => e.classList.remove("lit", "won"));
  }

  function pwRollStart() {
    if (!pw || pw.phase !== "setup" || pwRolling) return;
    const side = Math.random() < 0.5 ? "bull" : "bear";
    const pick = (sd) => document.querySelector(`.pw-pick[data-pw-side="${sd}"]`);
    const bull = pick("bull"), bear = pick("bear");
    if (!bull || !bear) { pwStart(side); return; }        // nothing to flicker

    const light = (sd) => {
      bull.classList.toggle("lit", sd === "bull");
      bear.classList.toggle("lit", sd === "bear");
    };
    const land = () => {
      pwRollTimer = null;
      pwRolling = false;
      const w = pick(side);
      if (w) { w.classList.remove("lit"); w.classList.add("won"); }
      pwTimer = setTimeout(() => { pwTimer = null; pwStart(side); }, PW_ROLL_SETTLE_MS);
    };

    /* someone who has asked for less movement gets the answer, not the show */
    const still = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (still) { pwRolling = true; light(side); land(); return; }

    pwRolling = true;
    const other = side === "bull" ? "bear" : "bull";
    const last = PW_ROLL_STEPS - 1;
    let i = 0;
    const step = () => {
      /* the parity is worked backwards from the end so the final flash is the
         side that was drawn, however many steps there are */
      light((last - i) % 2 === 0 ? side : other);
      if (i === last) return land();
      const t = i / last;
      pwRollTimer = setTimeout(step, PW_ROLL_FAST_MS + PW_ROLL_EASE_MS * Math.pow(t, 2.4));
      i++;
    };
    step();
  }

  /* ---- the three things the engine will not do itself ----

     It repaints nothing, files nothing and waits for nothing, because a bot on
     a server has no screen, no match history and no reveal to watch. Those are
     this file's, so this file hands them over — and the reveal is the one that
     matters: the round is already decided when the hook is called, and all the
     timer buys is the beat in which the opponent's card turns over. A headless
     match settles it immediately instead, which is the same game played
     faster. */
  R.hooks.render = () => renderPointaeway();
  R.hooks.recordMatch = (g, winner) => pwRecordMatch(winner);
  R.hooks.reveal = (g, settle) => {
    pwTimer = setTimeout(() => { pwTimer = null; settle(); }, PW_REVEAL_MS);
  };

  /* Leaving the screen stops the reveal timer, but the round it was waiting on
     is already decided — so settle it rather than drop it, or coming back would
     find the match stuck in "resolving" with nothing on it to click. */
  function pwAbort() {
    if (pwTimer) { clearTimeout(pwTimer); pwTimer = null; }
    /* a randomiser left flickering is dropped, not landed: nothing has been
       chosen yet, and a timer repainting a screen nobody is on is exactly what
       this function exists to stop */
    pwRollCancel();
    pwCommitPending(true);
    /* the live 1v1 too: leaving the screen mid-match forfeits it, the same
       bargain Pickæway's match makes, and a queue entry is withdrawn */
    pwOnlineLeave();
  }

  /* ---- drawing ---- */

  function pwTierLeft(type) {
    let n = 0;
    const count = (c) => { if (c.kind === "tier" && c.type === type) n++; };
    pwOwnDeck(pw.playerSide).forEach(count);
    pw.playerHand.forEach(count);
    return n;
  }

  /* The illustrated deck. Every face is a finished card — frame, art, name and
     strength are all in the pixels — so nothing here draws a card; it picks
     the right file and gets out of the way. The names are the engine's own,
     which is why the bear's two look-alike ranks had to be settled against the
     art first: the number on the face is not something markup can override. */
  const PW_ART = "assets/pointaeway/cards/";
  const PW_RESULT_ART = "assets/pointaeway/result/";
  const PW_TIER_ART = {
    bull: {
      "Bullish Marubozu": "bull-marubozu-str5",
      "Bullish Hammer": "bull-hammer-str4",
      "Bullish Standard": "bull-standard-str3",
      "Bullish Spinning Top": "bull-spinning-top-str2",
      "Bullish Weak Rejection": "bull-weak-rejection-str1",
      "Bullish Null": "bull-null-str0",
    },
    bear: {
      "Bearish Marubozu": "bear-marubozu-str5",
      "Bearish Shooting Star": "bear-shooting-star-str4",
      "Bearish Standard": "bear-standard-str3",
      "Bearish Spinning Top": "bear-spinning-top-str2",
      "Bearish Weak Rejection": "bear-weak-rejection-str1",
      "Bearish Null": "bear-null-str0",
    },
  };
  function pwArtFile(card) {
    /* a card may name its own face: a YOLO total is a number card of its
       owner's side, so nothing in the tier tables has a picture for it */
    const n = card.art ? card.art
      : card.side === "special"
        ? PW_SPECIAL_ART[card.type]
        : (PW_TIER_ART[card.side] || {})[card.type];
    /* WebP, not the PNG beside it. The faces are the same pictures at the
       same 307x460 — padded to an exact 2:3 while they were re-encoded, so
       the shape the card CSS states is now the shape of the file as well —
       and the set went from 2.75MB to 0.99MB with nothing visible lost. The
       PNGs stay in the repository as the source they are. */
    return n ? `${PW_ART}${n}.webp` : null;
  }
  /* The face is a picture, so everything it says has to be said again here or
     it is said to no one. */
  function pwCardAlt(card) {
    if (card.yolo) {
      return `YOLO, ${card.yolo.map((c) => `${c.type} ${c.pts}`).join(" plus ")}`
        + `, combined strength ${card.pts}.`;
    }
    return card.side === "special"
      ? `Special card, ${card.type}. ${card.desc}`
      : `${card.side === "bull" ? "Bull" : "Bear"} card, ${card.type}, strength ${card.pts}.`;
  }

  function pwCardHTML(card, opts) {
    const o = opts || {};
    const special = card.side === "special";
    const sideCls = special ? "wild" : card.side;
    const clickable = o.play || o.answer || o.online;
    const tag = clickable ? "button" : "div";
    const attrs = o.play ? ` type="button" data-pw-play="${esc(card.id)}"`
                : o.answer ? ` type="button" data-pw-answer="${esc(card.id)}"`
                /* the online hand plays through its own handler: the local one
                   would resolve the round against the local deck */
                : o.online ? ` type="button" data-pw-online-card="${esc(card.id)}"${o.disabled ? " disabled" : ""}`
                : "";
    /* Deck depth for this tier, on the player's own hand cards only — they
       already know their own deck. Nothing to show on a wild, which has no
       tier, or on the opponent's slot. It rides bottom-right: the art keeps
       its own strength badge in the top-left corner. */
    /* an online hand counts its own copies off the room's deck, so the badge
       takes a number there; locally it is read off the local deck */
    const left = o.left != null ? o.left
      : o.depth && card.kind === "tier" ? pwTierLeft(card.type) : null;
    const size = o.small ? " sm" : "";
    const anim = pw.flipAnim === card.id ? " flipping" : "";
    const art = pwArtFile(card);
    /* why a card cannot be played, said in the card's own tooltip and in its
       label — a dimmed card with no reason on it is a bug report waiting to
       be filed */
    const note = o.note ? ` title="${esc(o.note)}"` : "";

    /* A wild used to turn over to explain itself, because the drawn face had
       nowhere to put its effect. The illustrated face prints the effect, so
       there is nothing left to turn: the card says what it does while it is
       being chosen, and View Specials holds them all in one list. */
    return `<${tag} class="pw-card ${sideCls}${size}${anim}${o.dim ? " dim" : ""}"${attrs}${note}>
      ${art
        ? `<img class="pw-card-art" src="${art}" alt="${esc(pwCardAlt(card))}${o.note ? " " + esc(o.note) : ""}"
                draggable="false" decoding="async">`
        : `<span class="pw-card-alt">${esc(card.type)}</span>`}
      ${left != null
        ? `<span class="pw-card-left" title="${left} of this candle left in your deck"
                 aria-label="${left} left in your deck">×${left}</span>`
        : ""}
    </${tag}>`;
  }

  /* ---- the record ----
     What the hub is built on. Written once, the moment a match ends, from the
     only two things that decide it: which side the player took and who won.
     The list is capped; the counters are not — see the note in load(). */
  const PW_HISTORY_MAX = 60;

  /* ---- how many matches the hub lists ----
     It was three, chosen when Play Local sat under the box and the room was
     tight. With that button gone the box grew and three rows left half of it
     empty, so the number is measured instead of picked: the list is laid out,
     its height is divided by a row, and if that is not what was drawn the hub
     is drawn once more with the right number. It settles in one step, because
     the box's height comes from the column it is in and not from its rows. */
  let pwHistRows = 6;

  /* ---- Play Local, off the hub ----
     Asked for as "hide it, keep the code", so this is the whole of it: the
     button is not drawn, and the screen behind it, its handler, its note and
     its place in the router are untouched. One word turns it back on. */
  const PW_SHOW_LOCAL = false;

  function pwRecord() {
    if (!store.pwStats) store.pwStats = { played: 0, won: 0, lost: 0, drawn: 0, bull: 0, bear: 0 };
    if (!Array.isArray(store.pwHistory)) store.pwHistory = [];
    return store.pwStats;
  }

  /* ---- a match, small enough to keep sixty of them ----
     The replay needs the two cards of every round, and a card object carries
     a name, a kind, an effect and — on a wild — a sentence of prose. Sixty
     matches of those would be most of a phone's localStorage for this app
     alone. Nothing about a card has to be stored, though: a candle is decided
     by its side and its strength and a wild by which of the twelve it is, so
     round keeps two short codes and the pair is rebuilt from the same tables
     the decks are built from. About thirty bytes a round rather than four
     hundred. */
  function pwEncCard(c) {
    if (!c) return "";
    if (c.side === "special") return "S" + PW_SPECIALS.findIndex((s) => s.type === c.type);
    /* A YOLO total is a number card of its side with a Power no tier has —
       6, 9, 10 — so it cannot be written as one and read back as one. It gets
       a letter of its own. */
    if (c.type === "YOLO") return (c.side === "bull" ? "Y" : "y") + c.pts;
    return (c.side === "bull" ? "U" : "D") + c.pts;
  }
  function pwDecCard(code) {
    if (typeof code !== "string" || !code) return null;
    if (code.charAt(0) === "Y" || code.charAt(0) === "y") {
      const side = code.charAt(0) === "Y" ? "bull" : "bear";
      return { id: "sv", side, kind: "tier", type: "YOLO",
               pts: Number(code.slice(1)) || 0, art: PW_SPECIAL_ART["YOLO"] };
    }
    if (code.charAt(0) === "S") {
      const s = PW_SPECIALS[Number(code.slice(1))];
      return s ? Object.assign({}, s, { id: "sv", side: "special", kind: "special" }) : null;
    }
    const side = code.charAt(0) === "U" ? "bull" : "bear";
    const pts = Number(code.slice(1));
    const t = pwTiers(side).find((x) => x.pts === pts);
    return t ? { id: "sv", side, kind: "tier", type: t.type, pts: t.pts } : null;
  }
  const pwEncChart = (chart) => (chart || []).map((r) => ({
    r: r.round, o: r.open, c: r.close, y: pwEncCard(r.you), p: pwEncCard(r.opp),
  }));
  function pwDecChart(enc) {
    if (!Array.isArray(enc)) return [];
    return enc
      .map((e) => ({ round: e.r, open: e.o, close: e.c, you: pwDecCard(e.y), opp: pwDecCard(e.p) }))
      .filter((r) => r.you && r.opp);
  }

  function pwRecordMatch(winner) {
    const st = pwRecord();
    const side = pw.playerSide;
    const result = winner === "draw" ? "draw" : winner === side ? "win" : "loss";
    st.played++;
    if (result === "win") st.won++;
    else if (result === "loss") st.lost++;
    else st.drawn++;
    if (side === "bull") st.bull++; else if (side === "bear") st.bear++;
    /* the print as the player reads it: their own side's direction is the
       positive one, so a bear winning by ten shows as +10 and not as −10 */
    const pts = side === "bear" ? -pw.candle : pw.candle;
    store.pwHistory.unshift({
      t: Date.now(), side, opp: "computer", result, pts, rounds: pw.round,
      /* the match itself, not just its scoreline: this is what the hub's
         history rows open, and it is the same shape the live result screen's
         replay draws from */
      chart: pwEncChart(pw.chart),
    });
    if (store.pwHistory.length > PW_HISTORY_MAX) store.pwHistory.length = PW_HISTORY_MAX;
    save();
  }

  /* ---- the hub ----
     Pointæway's front door: the record, the recent matches, and the two ways
     into a game. Start Match hands over to the side picker, which is the
     screen that was the front door before this one.

     Every frame on it — the tiles, the history rows, the two pills — is a
     delivered picture nine-sliced rather than stretched, so a tile that is
     taller than it is wide and a row that is six times wider than the file
     both keep the corner radius and the lit stroke they were drawn with. */
  const PW_HUB = "assets/pointaeway/hub/";

  const PW_HUB_STATS = [
    { k: "played", ico: "ico-played", cap: "Total Matches Played", tile: 1, tone: "" },
    { k: "won",    ico: "ico-won",    cap: "Total Matches Won",    tile: 2, tone: "win" },
    { k: "lost",   ico: "ico-lost",   cap: "Total Matches Lost",   tile: 3, tone: "loss" },
    { k: "bull",   ico: "ico-bull",   cap: "Times as Bull",        tile: 4, tone: "bull" },
    { k: "bear",   ico: "ico-bear",   cap: "Times as Bear",        tile: 5, tone: "bear" },
  ];

  /* "Sep 15, 1:02 AM" — the same shape the reference prints */
  function pwHubWhen(t) {
    const d = new Date(t);
    const date = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const time = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    return `${date}, ${time}`;
  }

  const pwHasReplay = (m) => Array.isArray(m && m.chart) && m.chart.length > 0;

  /* A row is a button when there is a match behind it to open, and a plain row
     when there is not — which is every match played before matches were kept.
     Those still count in the record and still print their scoreline; there is
     simply nothing to walk back through, and a control that opens nothing is
     worse than no control. */
  function pwHubRowHTML(m) {
    const win = m.result === "win";
    const tone = m.result === "draw" ? "flat" : win ? "win" : "loss";
    const label = m.result === "draw" ? "Draw" : win ? "Win" : "Loss";
    const open = pwHasReplay(m);
    const tag = open ? "button" : "div";
    const attrs = open
      ? ` type="button" data-pw-hub-open="${m.t}"` +
        ` aria-label="${esc(label)} as ${m.side === "bull" ? "Bull" : "Bear"},` +
        ` ${pwSigned(m.pts)}, ${esc(pwHubWhen(m.t))}. Open the replay."`
      : "";
    return `
      <${tag} class="pw-hrow${open ? " open" : ""}"${attrs}>
        <span class="pw-hrow-ico">
          <img src="${PW_HUB}ico-${m.side === "bull" ? "bull" : "bear"}.png" alt="">
        </span>
        <span class="pw-hrow-opp">vs ${m.opp === "friend" ? "Friend" : "Computer"}</span>
        <span class="pw-hrow-side">${m.side === "bull" ? "Bull" : "Bear"}</span>
        <span class="pw-hrow-res ${tone}">${label}</span>
        <span class="pw-hrow-pts ${tone}">${pwSigned(m.pts)}</span>
        <span class="pw-hrow-when">${esc(pwHubWhen(m.t))}</span>
      </${tag}>`;
  }

  /* ---- a match off the record ----
     The result of a finished match and the chart that made it, on a screen of
     its own reached from the hub's history. The chart and the round reveal are
     the same two components the live result screen uses — they take the rounds
     as an argument, so neither of them knows whether the match ended a second
     ago or last week. */
  function pwSavedHTML() {
    const m = (store.pwHistory || []).find((x) => x.t === pw.savedT);
    if (!m) {
      return `<div class="pw-saved">
        <div class="pw-lib-head">
          <button type="button" class="pw-hub-back" data-pw-saved-back
                  aria-label="Back to Match Hub">
            <img src="assets/nav-icons/icon-arrow-back@2x.png" alt="">
          </button>
          <span class="pw-lib-title">Match Replay</span>
        </div>
        <div class="pw-chart-empty">That match is no longer on the record.</div>
      </div>`;
    }
    const rows = pwDecChart(m.chart);
    const tone = m.result === "draw" ? "flat" : m.result === "win" ? "win" : "loss";
    const label = m.result === "draw" ? "Draw" : m.result === "win" ? "Win" : "Loss";
    return `
      <div class="pw-saved">
        <div class="pw-lib-head">
          <button type="button" class="pw-hub-back" data-pw-saved-back
                  aria-label="Back to Match Hub">
            <img src="assets/nav-icons/icon-arrow-back@2x.png" alt="">
          </button>
          <span class="pw-lib-title">Match Replay</span>
        </div>

        <div class="pw-saved-head">
          <span class="pw-saved-res ${tone}">${label}</span>
          <span class="pw-saved-meta">
            as ${m.side === "bull" ? "Bull" : "Bear"} ·
            vs ${m.opp === "friend" ? "Friend" : "Computer"} ·
            ${rows.length || m.rounds || 0} round${(rows.length || m.rounds) === 1 ? "" : "s"}
          </span>
          <span class="pw-saved-pts ${tone}">${pwSigned(m.pts)}</span>
          <span class="pw-saved-when">${esc(pwHubWhen(m.t))}</span>
        </div>

        ${pwMatchChartHTML(rows)}
      </div>`;
  }

  /* ==================== the performance chart ====================
     Every finished match is one candle on the player's own chart, and the
     chart is of the player rather than of the market: a Bear who wins by ten
     has gone UP ten. The record already stores it that way — pwRecordMatch
     writes `pts` flipped for a Bear — and the rounds inside the replay are
     stored the way the board drew them, so those are the ones that have to be
     turned around here.

     Where the round-by-round numbers come from: every match row carries
     `chart`, the encoded replay, and each entry in it has the print at the
     open and the close of that round (`o` and `c`). Reading the closes in
     order gives the whole walk of the match, and with the sign flipped for a
     Bear it is the walk from the player's side. The high and the low of the
     candle are the best and worst that walk ever got to, including the 0 it
     started at — which is what makes `high >= max(open, close)` true rather
     than hoped for.

     A worked example, the brief's: a Bear two matches in, opening at +30,
     who goes 15 the wrong way and comes back to win by 10. The stored print
     runs 0, +9, +15, +4, −10 (positive is Bull's way). From the Bear's side
     that is 0, −9, −15, −4, +10. So open 30, close 40, high 40, low 15 — a
     green candle with a long lower wick and no upper one.

     Older matches, recorded before replays were stored, keep their body: open
     to close, no wicks. They are not dropped. */
  function pwMatchWalk(m) {
    /* the print after each round, from this player's side */
    if (!Array.isArray(m && m.chart) || !m.chart.length) return null;
    const sign = m.side === "bear" ? -1 : 1;
    const out = [0];
    m.chart.forEach((e) => {
      const v = Number(e && e.c);
      if (Number.isFinite(v)) out.push(sign * v);
    });
    return out.length > 1 ? out : null;
  }

  /* one candle, given where the last one closed */
  function pwCandleOf(m, open) {
    const pts = Number(m.pts) || 0;
    const close = open + pts;
    const walk = pwMatchWalk(m);
    const hi = walk ? open + Math.max.apply(null, walk) : Math.max(open, close);
    const lo = walk ? open + Math.min.apply(null, walk) : Math.min(open, close);
    return {
      t: m.t, side: m.side, opp: m.opp || "computer", result: m.result, pts,
      o: open, c: close,
      /* belt and braces: a replay that disagrees with the scoreline — an
         online match whose last round was never written — still may not
         produce a wick that is inside its own body */
      h: Math.max(hi, open, close), l: Math.min(lo, open, close),
      body: !walk,
      replay: pwHasReplay(m),
    };
  }

  /* The chain, newest last. Filtering rebuilds it: each shown candle opens
     where the previous SHOWN one closed, so "as Bull" reads as a chart of the
     player's Bull matches and not as one with gaps in it. */
  function pwPerfCandles(side, opp) {
    const all = (store.pwHistory || []).filter((m) =>
      (side === "all" || m.side === side) &&
      (opp === "all" || (opp === "online" ? m.opp === "friend" : m.opp !== "friend")));
    const out = [];
    let open = 0;
    for (let i = all.length - 1; i >= 0; i--) {     // the store is newest-first
      const c = pwCandleOf(all[i], open);
      out.push(c);
      open = c.c;
    }
    return out;
  }

  /* ---- the cache ----
     Recomputing sixty matches is not expensive, but it is done on every pan
     and every scrub frame if it is not held, so it is held: keyed by the
     filters and by what the record looked like when it was built. A finished
     match changes the key by its own timestamp, so the next read rebuilds
     once and nothing has to remember to clear anything. */
  let pwPerfCache = { key: "", list: [] };
  function pwPerfList(side, opp) {
    const all = store.pwHistory || [];
    const key = `${side}|${opp}|${all.length}|${all.length ? all[0].t : 0}`;
    if (pwPerfCache.key !== key) pwPerfCache = { key, list: pwPerfCandles(side, opp) };
    return pwPerfCache.list;
  }

  /* ---- the chart's own screen furniture ----
     Two rows of chips, the running total, and the plot. The plot is drawn
     from JavaScript rather than from this template: a pan or a pinch moves
     sixty boxes and must not rebuild the hub around them. */
  /* [key, the word in the menu, the word on the button] */
  const PW_PERF_SIDES = [["all", "All", "All"], ["bull", "As Bull", "Bull"], ["bear", "As Bear", "Bear"]];
  const PW_PERF_OPPS = [["all", "All", "All"], ["computer", "vs Computer", "CPU"], ["online", "Online", "Online"]];

  function pwPerfHTML() {
    const list = pwPerfList(pw.perf.side, pw.perf.opp);
    /* The two filters, as the chart menus the day chart already has: same
       button, same caret, same open panel, same cyan for the choice that is
       made — .tp-menu-* is that style, reused rather than copied. They stand
       inside the plot's top-left corner, which is where the two rows of pills
       they replace used to take a fifth of the chart's height. */
    const menu = (items, now, kind, label) => {
      const open = pw.perf.menu === kind;
      const set = now !== "all";
      return `
        <div class="tp-menu-wrap">
          <button type="button" class="tp-menu-btn${set || open ? " on" : ""}"
                  data-pw-perf-menu="${kind}" aria-expanded="${open}"
                  aria-label="${esc(label)}">
            <span>${esc((items.find((x) => x[0] === now) || items[0])[2])}</span><i></i>
          </button>
          ${open ? `<div class="tp-menu" role="menu">
            ${items.map(([k, name]) => `
              <button type="button" class="tp-menu-item${now === k ? " on" : ""}"
                      role="menuitemradio" aria-checked="${now === k}"
                      data-pw-perf-${kind}="${k}">${esc(name)}</button>`).join("")}
          </div>` : ""}
        </div>`;
    };
    const menus = `
      <div class="pw-perf-menus">
        ${menu(PW_PERF_SIDES, pw.perf.side, "side", "Which side to chart")}
        ${menu(PW_PERF_OPPS, pw.perf.opp, "opp", "Which opponent to chart")}
      </div>`;

    if (!(store.pwHistory || []).length) {
      return `
        <div class="pw-perf empty">
          <div class="pw-perf-none">
            <span>Play your first match to start your chart.</span>
            <button type="button" class="pw-hub-pill start wide" data-pw-hub-start>
              <span class="pw-hub-pill-t">Start Match</span>
              <span class="pw-hub-pill-s">Play against computer</span>
            </button>
          </div>
        </div>`;
    }

    const last = list.length ? list[list.length - 1].c : 0;
    const ten = list.length > 10 ? last - list[list.length - 11].c : last;
    return `
      <div class="pw-perf">
        <div class="pw-perf-total">
          <b class="${last > 0 ? "up" : last < 0 ? "down" : ""}">${pwSigned(last)}</b>
          <i>${list.length} match${list.length === 1 ? "" : "es"}</i>
          <span class="${ten > 0 ? "up" : ten < 0 ? "down" : ""}">
            ${pwSigned(ten)} <em>last ${Math.min(10, list.length)}</em></span>
        </div>
        <div class="pw-perf-plot" data-pw-perf-plot>
          ${menus}
          <div class="pw-perf-y" aria-hidden="true"></div>
          <div class="pw-perf-zero" aria-hidden="true"></div>
          <div class="pw-perf-cands"></div>
          <div class="pw-perf-x" aria-hidden="true"></div>
          <div class="pw-perf-tip" hidden></div>
          ${list.length ? "" : `<div class="pw-perf-none"><span>No matches with these filters.</span></div>`}
        </div>
      </div>`;
  }

  /* ---- drawing the plot ----
     The candles are made once per list and then only moved: a pan writes six
     numbers per candle and touches nothing else, which is what keeps the
     chart still under a finger that is reading it.

     The window is `from` and `count` — which candle is at the left edge and
     how many are across — and everything else follows from the two. A column
     is never wider than PW_PERF_MAXCOL, so four matches are four candles at
     their proper width on the left rather than four slabs stretched across
     the box, and never narrower than a hairline. */
  const PW_PERF_MINCOLS = 6;
  const PW_PERF_MAXCOL = 46;

  function pwPerfView(n) {
    const p = pw.perf;
    if (!n) return { from: 0, count: 0 };
    if (!p.count) { p.count = Math.min(n, 14); p.from = n - p.count; }  // opens on the newest
    p.count = Math.max(3, Math.min(p.count, Math.max(3, n)));
    p.from = Math.max(0, Math.min(p.from, n - p.count));
    return { from: p.from, count: p.count };
  }

  function pwPerfEnsure() {
    const plot = document.querySelector("[data-pw-perf-plot]");
    if (!plot) return null;
    const host = plot.querySelector(".pw-perf-cands");
    const list = pwPerfList(pw.perf.side, pw.perf.opp);
    if (host.getAttribute("data-key") !== pwPerfCache.key) {
      host.innerHTML = list.map((c, i) => {
        const tone = c.result === "draw" ? "flat" : c.result === "win" ? "win" : "loss";
        return `<button type="button" class="pw-cand ${tone}${c.body ? " bodyonly" : ""}"
                        data-pw-cand="${i}"
                        aria-label="${esc(pwPerfSay(c))}">
          <span class="pw-cand-wick"></span><span class="pw-cand-body"></span>
        </button>`;
      }).join("");
      host.setAttribute("data-key", pwPerfCache.key);
    }
    return { plot, host, list };
  }

  const pwPerfSay = (c) =>
    `${c.result === "draw" ? "Draw" : c.result === "win" ? "Win" : "Loss"} as `
    + `${c.side === "bull" ? "Bull" : "Bear"} vs ${c.opp === "friend" ? "a friend" : "the computer"}, `
    + `${pwSigned(c.pts)}, total ${pwSigned(c.c)}, ${pwHubWhen(c.t)}`;

  function pwPerfLayout() {
    const g = pwPerfEnsure();
    if (!g) return;
    const { plot, host, list } = g;
    const { from, count } = pwPerfView(list.length);
    const W = host.clientWidth, H = host.clientHeight;
    if (!W || !H || !list.length) return;

    const cols = Math.max(count, PW_PERF_MINCOLS);
    const colW = Math.min(W / cols, PW_PERF_MAXCOL);
    /* the scale is the window's own, so a flat stretch of the record is read
       at the scale of that stretch rather than squashed by one big match */
    let hi = -Infinity, lo = Infinity;
    for (let i = from; i < from + count && i < list.length; i++) {
      hi = Math.max(hi, list[i].h); lo = Math.min(lo, list[i].l);
    }
    if (!Number.isFinite(hi)) { hi = 1; lo = -1; }
    const pad = Math.max((hi - lo) * 0.12, 2);
    hi += pad; lo -= pad;
    const y = (v) => ((hi - v) / (hi - lo)) * H;

    [...host.children].forEach((el, i) => {
      const c = list[i];
      const on = i >= from && i < from + count;
      el.hidden = !on;
      if (!on) return;
      const x = (i - from) * colW;
      el.style.left = x.toFixed(1) + "px";
      el.style.width = colW.toFixed(1) + "px";
      const top = y(c.h), bot = y(c.l);
      const bTop = y(Math.max(c.o, c.c)), bBot = y(Math.min(c.o, c.c));
      const wick = el.firstElementChild, body = el.lastElementChild;
      wick.style.top = top.toFixed(1) + "px";
      wick.style.height = Math.max(bot - top, 1).toFixed(1) + "px";
      body.style.top = bTop.toFixed(1) + "px";
      body.style.height = Math.max(bBot - bTop, 1.5).toFixed(1) + "px";
      el.classList.toggle("on", pw.perf.sel === i);
    });

    /* the other axis: which match each column is. They thin out as the window
       widens — at sixty candles there is no room for sixty numbers and no
       reason for them, since the one that matters is the one under the finger
       and that is in the label. */
    const xs = plot.querySelector(".pw-perf-x");
    if (xs) {
      const every = Math.max(1, Math.ceil(34 / colW));
      let out = "";
      for (let i = from; i < from + count && i < list.length; i++) {
        if ((list.length - 1 - i) % every !== 0 && i !== list.length - 1) continue;
        out += `<i style="left:${((i - from) * colW + colW / 2).toFixed(1)}px">${i + 1}</i>`;
      }
      xs.innerHTML = out;
    }

    /* the axis: the window's ends and the zero line if it is in view */
    const ax = plot.querySelector(".pw-perf-y");
    if (ax) {
      const ticks = [hi - pad / 2, (hi + lo) / 2, lo + pad / 2];
      ax.innerHTML = ticks.map((v) =>
        `<i style="top:${y(v).toFixed(1)}px">${pwSigned(Math.round(v))}</i>`).join("");
    }
    const zero = plot.querySelector(".pw-perf-zero");
    if (zero) {
      const inView = 0 <= hi && 0 >= lo;
      zero.hidden = !inView;
      if (inView) zero.style.top = y(0).toFixed(1) + "px";
    }
    pwPerfTip();
  }

  /* the label that follows a scrub; nothing while nothing is selected */
  function pwPerfTip() {
    const plot = document.querySelector("[data-pw-perf-plot]");
    const tip = plot && plot.querySelector(".pw-perf-tip");
    if (!tip) return;
    const list = pwPerfList(pw.perf.side, pw.perf.opp);
    const c = pw.perf.sel != null ? list[pw.perf.sel] : null;
    if (!c) { tip.hidden = true; return; }
    const tone = c.result === "draw" ? "flat" : c.result === "win" ? "win" : "loss";
    tip.hidden = false;
    /* Where it stands. Three corners are available — the fourth is the
       filters' — and the one it takes is the first that does not land on the
       candle it is describing. Measured rather than guessed from which half
       the finger is in: a tall candle near the middle reaches the top-right
       box even though it is on the left. */
    const el = plot.querySelector(`[data-pw-cand="${pw.perf.sel}"]`);
    const pr = plot.getBoundingClientRect();
    tip.classList.remove("low", "lowright");
    const drawn = el && (() => {
      const w = el.firstElementChild.getBoundingClientRect();
      const b = el.lastElementChild.getBoundingClientRect();
      return { l: Math.min(w.left, b.left) - pr.left, r: Math.max(w.right, b.right) - pr.left,
               t: Math.min(w.top, b.top) - pr.top, b: Math.max(w.bottom, b.bottom) - pr.top };
    })();
    if (drawn) {
      const tr = tip.getBoundingClientRect();
      const tw = tr.width, th = tr.height;
      const PL = 8, PR = pr.width - 40, PT = 8, PB = pr.height - 16;
      const clear = (x, y) => !(x + tw < drawn.l || x > drawn.r || y + th < drawn.t || y > drawn.b);
      if (clear(PR - tw, PT)) {                       // top-right, the default
        if (!clear(PL, PB - th)) tip.classList.add("low");          // bottom-left
        else tip.classList.add("lowright");                         // bottom-right
      }
    }
    tip.innerHTML = `
      <b class="${tone}">${c.result === "draw" ? "Draw" : c.result === "win" ? "Win" : "Loss"}</b>
      <span>as ${c.side === "bull" ? "Bull" : "Bear"} · ${c.opp === "friend" ? "Online" : "vs Computer"}</span>
      <span>${esc(pwHubWhen(c.t))}</span>
      <i>O ${pwSigned(c.o)} · H ${pwSigned(c.h)} · L ${pwSigned(c.l)} · C ${pwSigned(c.c)}</i>`;
  }

  /* ---- the finger on the chart ----
     One finger reads: it snaps to the candle under it, labels it, and pushes
     the window along when it reaches an edge — which is how a one-handed pan
     happens without taking the gesture away from the scrub. Two fingers move
     and scale the window. A clean tap, which is a press that never travelled,
     opens that match's replay; a drag never does. */
  let pwPerfGrab = null;

  function pwPerfIndexAt(clientX) {
    const g = pwPerfEnsure();
    if (!g) return null;
    const list = g.list;
    const { from, count } = pwPerfView(list.length);
    const r = g.host.getBoundingClientRect();
    const cols = Math.max(count, PW_PERF_MINCOLS);
    const colW = Math.min(r.width / cols, PW_PERF_MAXCOL);
    const i = from + Math.floor((clientX - r.left) / colW);
    return Math.max(from, Math.min(from + count - 1, Math.min(list.length - 1, i)));
  }

  function pwPerfSelect(i) {
    if (i == null || pw.perf.sel === i) return false;
    pw.perf.sel = i;
    const host = document.querySelector(".pw-perf-cands");
    if (host) [...host.children].forEach((el, n) => el.classList.toggle("on", n === i));
    pwPerfTip();
    return true;
  }

  /* one finger past the edge drags the window with it */
  function pwPerfNudge(i) {
    const list = pwPerfList(pw.perf.side, pw.perf.opp);
    const { from, count } = pwPerfView(list.length);
    let moved = false;
    if (i <= from && from > 0) { pw.perf.from = from - 1; moved = true; }
    else if (i >= from + count - 1 && from + count < list.length) { pw.perf.from = from + 1; moved = true; }
    if (moved) pwPerfLayout();
    return moved;
  }

  function pwPerfDown(e) {
    const plot = e.target.closest && e.target.closest("[data-pw-perf-plot]");
    if (!plot) return;
    /* The two filter menus stand inside the plot, so a press on one of them is
       a press on a button and not the beginning of a scrub. A press elsewhere
       while one is open is the press that dismisses it — the listener below
       does that — and must not also start a scrub on a chart that is about to
       be drawn again. */
    if (e.target.closest(".pw-perf-menus") || pw.perf.menu) return;
    if (pwPerfGrab && pwPerfGrab.b == null && e.pointerId !== pwPerfGrab.a) {
      /* the second finger: from here it is a pinch, and the tap is off */
      pwPerfGrab.b = e.pointerId;
      pwPerfGrab.bx = e.clientX;
      pwPerfGrab.moved = true;
      pwPerfGrab.span0 = Math.abs(pwPerfGrab.bx - pwPerfGrab.ax);
      pwPerfGrab.count0 = pw.perf.count;
      pwPerfGrab.from0 = pw.perf.from;
      return;
    }
    if (pwPerfGrab) return;
    pwPerfGrab = { a: e.pointerId, b: null, ax: e.clientX, x0: e.clientX, moved: false, plot };
  }

  function pwPerfMove(e) {
    if (!pwPerfGrab) return;
    const G = pwPerfGrab;
    if (e.pointerId === G.a) G.ax = e.clientX;
    else if (e.pointerId === G.b) G.bx = e.clientX;
    else return;
    if (e.cancelable) e.preventDefault();

    const list = pwPerfList(pw.perf.side, pw.perf.opp);
    if (G.b != null) {
      /* two fingers: the span sets how many candles are across, and the pair's
         middle carries the window with it */
      const span = Math.max(Math.abs(G.bx - G.ax), 10);
      const scale = span / Math.max(G.span0, 10);
      const count = Math.max(3, Math.min(list.length, Math.round(G.count0 / scale)));
      const mid = (G.ax + G.bx) / 2;
      const r = G.plot.getBoundingClientRect();
      const at = Math.max(0, Math.min(1, (mid - r.left) / Math.max(r.width, 1)));
      const anchor = G.from0 + at * G.count0;
      pw.perf.count = count;
      pw.perf.from = Math.round(anchor - at * count);
      pwPerfLayout();
      return;
    }
    if (Math.abs(e.clientX - G.x0) > 6) G.moved = true;
    const i = pwPerfIndexAt(e.clientX);
    if (!pwPerfNudge(i)) pwPerfSelect(i);
    else pwPerfSelect(pwPerfIndexAt(e.clientX));
    if (!G.captured) { try { G.plot.setPointerCapture(G.a); G.captured = true; } catch (err) {} }
  }

  function pwPerfUp(e) {
    if (!pwPerfGrab) return;
    const G = pwPerfGrab;
    if (e.pointerId === G.b) { G.b = null; return; }
    if (e.pointerId !== G.a) return;
    pwPerfGrab = null;
    if (G.captured) { try { G.plot.releasePointerCapture(e.pointerId); } catch (err) {} }
    if (G.moved) return;                       // a drag opens nothing
    const i = pwPerfIndexAt(e.clientX);
    const list = pwPerfList(pw.perf.side, pw.perf.opp);
    const c = list[i];
    if (!c) return;
    pwPerfSelect(i);
    if (!c.replay) return;                     // nothing to open on an old record
    pw.savedT = c.t; pw.showRound = null; pw.phase = "saved";
    renderPointaeway();
  }

  function pwHubHTML() {
    const st = pwRecord();
    const all = store.pwHistory;
    /* Three rather than five, since the two reference buttons went in under
       the match row: the hub has to fit one viewport and the history is the
       part of it that can give. View All still opens the whole record. */
    const shown = pw.hubAll ? all : all.slice(0, pwHistRows);
    return `
      <div class="pw-hub">
        ${/* The banner IS the header: the title and the strapline that used to
              sit beside it are gone, so it takes the middle. The way back to
              the three games sits in the corner it leaves free — the app's own
              back arrow, not a second one drawn for this screen. */""}
        <div class="pw-hub-head">
          <button type="button" class="pw-hub-back" data-pw-hub-back
                  aria-label="Back to Pick your game">
            <img src="assets/nav-icons/icon-arrow-back@2x.png" alt="">
          </button>
          <img class="pw-hub-banner" src="${PW_HUB}banner.png" alt="Bull versus Bear"
               draggable="false">
        </div>

        ${/* somebody has challenged this player: answered here, at the top of
              the game's own front door, rather than over whatever screen they
              happened to be on */""}
        ${inboxHTML()}

        <div class="pw-hub-stats">
          ${PW_HUB_STATS.map((s) => `
            <div class="pw-stat t${s.tile}">
              <img class="pw-stat-ico" src="${PW_HUB}${s.ico}.png" alt="">
              <span class="pw-stat-cap">${esc(s.cap)}</span>
              <span class="pw-stat-n ${s.tone}">${st[s.k] || 0}</span>
            </div>`).join("")}
        </div>

        <div class="pw-hist${pw.perf.on ? " charted" : ""}">
          <div class="pw-hist-head">
            <span class="pw-hist-title">Match History</span>
            ${!pw.perf.on && all.length > pwHistRows ? `
            <button type="button" class="pw-hist-all" data-pw-hub-all>
              <span>${pw.hubAll ? "Show Less" : "View All"}</span>
              <img src="${PW_HUB}ico-chevron.png" alt="">
            </button>` : ""}
            ${/* the one addition to the row: the same candle glyph the live
                  chart is opened with in a match */""}
            <button type="button" class="pw-perf-btn${pw.perf.on ? " on" : ""}"
                    data-pw-perf aria-pressed="${pw.perf.on}"
                    aria-label="${pw.perf.on ? "Hide the performance chart" : "Show the performance chart"}">
              ${PW_CHART_SVG}
            </button>
          </div>
          ${pw.perf.on
            ? pwPerfHTML()
            : shown.length
              ? `<div class="pw-hist-list">${shown.map(pwHubRowHTML).join("")}</div>`
              : `<div class="pw-hist-none">No matches yet — your first one lands here.</div>`}
        </div>

        <div class="pw-hub-acts">
          <button type="button" class="pw-hub-pill start" data-pw-hub-start>
            <span class="pw-hub-pill-t">Start Match</span>
            <span class="pw-hub-pill-s">Play against computer</span>
          </button>
          ${/* Play Online, renamed and given a screen: the queue is not a
                lobby of strangers any more but a lobby of two, opened by a
                code the host sends. Challenge a Player is gone — it was the
                same errand done by looking somebody up, and this replaces it. */""}
          <button type="button" class="pw-hub-pill find" data-pw-hub-create>
            <span class="pw-hub-pill-t">Create Match</span>
            <span class="pw-hub-pill-s">Set the rules · play a friend</span>
          </button>
        </div>
        ${/* Play Local is off the hub for now, by the switch above: the screen,
              its handler and its note are all still here and turning it back
              on is one word. The row it sat in is simply not drawn, so the
              space it had goes back to the match history rather than being
              left as a gap. */""}
        ${PW_SHOW_LOCAL ? `
        <button type="button" class="pw-hub-pill chal" data-pw-hub-local>
          <span class="pw-hub-pill-t">Play Local</span>
          <span class="pw-hub-pill-s">With a physical deck</span>
        </button>` : ""}
        ${/* the two reference screens, directly under the match buttons and
              shorter than them, because that is what they are: the way to read
              the rules rather than the way to start a game */""}
        <div class="pw-hub-acts second">
          <button type="button" class="pw-hub-pill mini" data-pw-howto>
            <span class="pw-hub-pill-t">How to Play</span>
          </button>
          <button type="button" class="pw-hub-pill mini" data-pw-library="hub">
            <span class="pw-hub-pill-t">Card Library</span>
          </button>
        </div>
        ${pw.localNote ? `<div class="pw-on-msg pw-local-note" role="status">
          <b>Physical cards coming soon.</b></div>` : ""}
        <button type="button" class="pw-hub-link" data-pw-hub-history>
          Online match history <span aria-hidden="true">›</span>
        </button>
      </div>`;
  }

  /* ==================== Pointæway Online ====================
     The live 1v1 on Firestore, through the four backend modules in js/online/
     and nothing else. This section is the UI around them; the rules, the
     matchmaking and the commit-reveal live in the modules and are not
     duplicated here.

     ==> INTEGRATION POINTS, all reached through window.AEWAY_ONLINE (see
         js/online/bridge.js):
       requireUser()                 — who is playing; throws when nobody is
       getProfile(uid)               — name and photo to enter the queue with
       quickMatch(me, {game})        — {promise, cancel}; resolves with a roomId
       watchRoom(roomId, cb)         — every change to the room, live
       playRound(roomId, uid, card)  — commit → wait → reveal → resolve
       forfeitRoom(roomId, uid)      — the other player wins by default
       recordMatchResult(uid, outcome, xp) — lifetime stats, once per room
       getMatchHistory(uid)          — past rooms, newest first

     The bridge is a module script and loads after this file. online() may
     therefore be null for a moment at boot, and stays null for good when the
     CDN cannot be reached — which is what "offline" means to this screen. */
  const ONLINE_GAME = "pointaway";
  const ONLINE_XP = { win: 25, draw: 10, loss: 5 };
  const ONLINE_ROUNDS_TO_WIN = 5;       // mirrors the module's "first to 5"

  function online() { return window.AEWAY_ONLINE || null; }
  function onlineReady(ms) {
    if (online()) return Promise.resolve(online());
    return new Promise((resolve) => {
      let t = null;
      const done = () => { clearTimeout(t); window.removeEventListener("aeway-online-ready", done); resolve(online()); };
      t = setTimeout(done, ms || 8000);
      window.addEventListener("aeway-online-ready", done, { once: true });
    });
  }

  /* The module's card is {side, power 1..5}. The five powers are the five
     strengths of the local deck, so the faces the player already knows are
     the faces they pick from here — power 5 is the Marubozu, 1 the Weak
     Rejection — and pwCardHTML draws them. */
  function pwOnlineCard(side, power) {
    const t = pwTiers(side).find((x) => x.pts === power);
    return { id: `on-${side}-${power}`, side, kind: "tier", type: t ? t.type : side, pts: power };
  }

  /* ==================== the online board ====================
     An online match is the same board as a single-player one — the deck, the
     wild and opponent counts, the print, the two cards on the table, the hand
     and the specials sheet — and not a second, smaller game.

     Everything on it is a pure function of the room document. The room holds
     the round number, the candles printed so far, and inside each candle the
     card both players played. From those three, and nothing else, this
     computes: which side each player is on, what order their deck comes out
     in, what is left in it, what is in their hand, and where the print
     stands. Two phones running this over the same document therefore draw the
     same board, and a reload draws the board it left.

     ==> WHAT THE MODULE CANNOT CARRY, and why the board says so:
       · A move is {side, power 1..5}. A wild has no power and printCandle
         only sums powers, so a wild sent over the wire would resolve as a
         zero and do nothing. Online decks are candle cards only and the Wild
         count reads 0 — which is the truth, not a placeholder. View Specials
         still opens, because it is a reference sheet.
       · The room has no deck or hand field, so the deck below is the client's
         reading of the room rather than something the module enforces. It is
         deterministic, so both sides agree; it is not anti-cheat. The module's
         own anti-cheat is the commit-reveal in pointaway.js, which covers the
         thing that matters — neither player can see the other's card first.
       · The module ends a match at five round wins. The print is the room's
         own close, counted from the opening 100, so it can pass ±25 while the
         match runs on. The gauge pins at the ends and the number stays exact;
         making ±25 the finish line would mean rewriting pointaway.js. */

  const PW_ON_PLAYABLE = [5, 4, 3, 2, 1];   // the powers a move can carry

  /* What the room says the match is. Read from the room rather than from the
     host's screen, so both clients agree and a reload agrees with itself —
     and read defensively, because today no room carries this field at all:
     until room creation stores it (see the note above), every online match
     resolves to the 25-point default on both phones, which is the shape the
     module's own deck and win condition already assume. The moment the field
     lands, this picks it up with nothing here to change. */
  function pwOnSettings(room) {
    /* room.settings first, for the day room creation stores it. Until then
       the code the room was opened under is in room.game, and it carries the
       same two numbers — so both clients read the same match either way. */
    if (room && room.settings) return pwSettings(room.settings);
    return pwSettings(pwCodeSettings(pwGameCode(room && room.game)));
  }

  /* players[0] is bull, players[1] bear. The room doc fixes the order when it
     is created, both clients read the same array, and neither can drift. */
  function pwOnSide(room, uid) {
    return (room.players || [])[0] === uid ? "bull" : "bear";
  }

  /* One deck order per player per room, from a hash of the two ids — so the
     hand is the same on both phones and the same after a reload, without a
     byte of it going to Firestore. */
  function pwOnHash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function pwOnOrder(roomId, uid, side, copies) {
    const n = copies || PW_TIER_COPIES;
    const cards = [];
    pwTiers(side).forEach((t) => {
      if (!PW_ON_PLAYABLE.includes(t.pts)) return;     // the Null card is not dealt
      for (let i = 0; i < n; i++) {
        cards.push({ id: `on-${uid}-${t.pts}-${i}`, side, kind: "tier", type: t.type, pts: t.pts });
      }
    });
    let s = pwOnHash(`${roomId}:${uid}`) || 1;
    const rnd = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
    for (let i = cards.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      const t = cards[i]; cards[i] = cards[j]; cards[j] = t;
    }
    return cards;
  }

  /* what one player holds and has left, after the rounds the room has printed */
  function pwOnSeat(room, uid) {
    const set = pwOnSettings(room);
    const side = pwOnSide(room, uid);
    const order = pwOnOrder(room.id, uid, side, set.copies);
    const played = (room.candles || [])
      .map((k) => (k && k.cards ? k.cards[uid] : null))
      .filter(Boolean);
    /* A played card leaves the deck for good — matched on strength, which is
       all a move carries and all that separates two cards of one side. What
       is left, in order, is then the hand and the rest face down. Taking the
       hand off the remainder rather than off a running count is what keeps it
       the right size even if a move arrives that this client never dealt:
       the module accepts any {side, power}, so the board must not be able to
       drift when one does. */
    const left = order.slice();
    played.forEach((c) => {
      const i = left.findIndex((h) => h.pts === Number(c.power));
      if (i >= 0) left.splice(i, 1);
    });
    const hand = left.slice(0, Math.min(set.hand, left.length));
    const rest = left.slice(hand.length);
    return { uid, side, hand, rest, deck: rest.length, played };
  }

  /* the whole board, from the room and who is reading it */
  function pwOnlineBoard(room, meUid) {
    if (!room || !meUid) return null;
    const oppUid = (room.players || []).find((p) => p !== meUid) || "";
    const me = pwOnSeat(room, meUid);
    const opp = pwOnSeat(room, oppUid);
    const candles = room.candles || [];
    const last = candles[candles.length - 1] || null;
    /* the print, as the room counts it: every candle opens where the last one
       closed and the first opens at 100, so the move away from 100 is the
       running total both players are pulling on. Bull up, bear down — the
       same direction the local meter reads. */
    const print = last ? Math.round(Number(last.close) - 100) : 0;
    /* the two cards of the round just printed stay on the table until this
       player commits to the next one */
    const table = last ? {
      me: last.cards && last.cards[meUid] ? pwOnlineCard(me.side, Number(last.cards[meUid].power)) : null,
      opp: last.cards && last.cards[oppUid] ? pwOnlineCard(opp.side, Number(last.cards[oppUid].power)) : null,
      round: last.round,
    } : { me: null, opp: null, round: 0 };
    /* what the opponent has spent, by name — the local board's Seen panel,
       and online it is a fact rather than a memory */
    const seen = {};
    pwTiers(opp.side).forEach((t) => { seen[t.type] = 0; });
    opp.played.forEach((c) => {
      const t = pwTiers(opp.side).find((x) => x.pts === Number(c.power));
      if (t) seen[t.type] = (seen[t.type] || 0) + 1;
    });
    return { me, opp, oppUid, print, table, seen, candles, last };
  }

  /* how many of this candle this player still holds, hand and deck together —
     the ×N badge the local board puts in the corner of its own cards */
  function pwOnLeft(board, card) {
    if (!board) return null;
    const same = (c) => c.pts === card.pts;
    return board.me.hand.filter(same).length + board.me.rest.filter(same).length;
  }

  /* ---- the match code ----
     Six characters: four random, then the two settings as digits — the point
     target's place in PW_POINTS, and how many specials per colour. So the
     code IS the settings, and the friend who types it in can be shown the
     match's shape before joining without a lookup, and both clients derive
     the same deck from it with nothing stored anywhere.

     It is also the queue key. quickMatch filters the lobby on an exact game
     string, so `pointaway#KQTZ43` is a lobby of two: the host and whoever
     types that code. Nobody else can be matched into it, and a code with one
     character wrong is simply a different empty lobby rather than a match
     played under settings the two players disagree about.

     The body's alphabet has no digits and none of the letters that are read
     as digits, so the two that carry meaning are never mistaken for the four
     that do not. */
  const PW_CODE_BODY = "ACDEFGHJKLMNPQRTUVWXY";
  const PW_CODE_RE = /^[ACDEFGHJKLMNPQRTUVWXY]{4}[1-4][0-3]$/;

  function pwMakeCode(settings) {
    const set = pwSettings(settings);
    let body = "";
    for (let i = 0; i < 4; i++) {
      body += PW_CODE_BODY[Math.floor(Math.random() * PW_CODE_BODY.length)];
    }
    return `${body}${PW_POINTS.indexOf(set.points) + 1}${set.perColour}`;
  }
  function pwCleanCode(text) {
    return String(text || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
  }
  /* the settings a code carries, or null when it is not a code at all */
  function pwCodeSettings(code) {
    const c = pwCleanCode(code);
    if (!PW_CODE_RE.test(c)) return null;
    return pwSettings({ points: PW_POINTS[Number(c[4]) - 1], perColour: Number(c[5]) });
  }
  const pwGameKey = (code) => (code ? `${ONLINE_GAME}#${pwCleanCode(code)}` : ONLINE_GAME);
  function pwGameCode(game) {
    const g = String(game || "");
    const i = g.indexOf("#");
    return i >= 0 ? g.slice(i + 1) : "";
  }

  /* how a match's shape reads on screen */
  function pwSettingsLabel(set) {
    const s = pwSettings(set);
    const spec = s.perColour === 0 ? "No specials"
      : s.perColour === 3 ? "All specials"
      : `${s.perColour} special${s.perColour === 1 ? "" : "s"} per colour`;
    return `First to ${s.points} · ${spec}`;
  }

  function pwOnlineNew() {
    return {
      stage: "auth",      // auth | finding | match
      me: null,           // {uid, displayName, photoURL} as entered into the queue
      profile: null,
      mm: null,           // the quickMatch handle, so Cancel can reach it
      roomId: null,
      room: null,
      unsub: null,
      waiting: false,     // our card is committed, the opponent's is not
      picked: null,       // the card we committed this round
      board: null,        // the board read off the room — see pwOnlineBoard
      showSeen: false,    // the panel listing what the opponent has spent
      showSpecials: false,// the wilds, as a reference sheet
      showChart: false,   // the live print, above the board
      err: null,          // offline | signin | profile | matchmaking | <message>
      timedOut: false,    // playRound's 60s wait expired
      confirmForfeit: false,
      recorded: false,
      history: null,      // the rooms getMatchHistory returned, or null
      histOpen: null,     // which of them is expanded
      chal: null,         // a challenge being addressed, sent, or waited on
      create: null,       // the Create Match screen's own state
      code: null,         // the match code this room was opened under
    };
  }
  function pwCreateNew() {
    return {
      step: "setup",                              // setup | join | preview
      settings: Object.assign({}, PW_DEFAULT_SETTINGS),
      joinCode: "",
      joinSettings: null,
      err: null,
    };
  }

  /* everything the online flow holds, dropped: the queue entry, the room
     subscription, and — while a match is live — the match itself */
  function pwOnlineLeave() {
    const o = pw && pw.online;
    if (!o) return;
    const api = online();
    if (o.mm) { try { o.mm.cancel(); } catch (e) { /* already stopped */ } }
    if (o.unsub) { try { o.unsub(); } catch (e) { /* already gone */ } }
    /* a challenge still out there is withdrawn rather than left ringing on
       somebody else's phone for five minutes */
    if (o.chal) {
      pwChalDrop();
      if (api && o.chal.inviteId && o.chal.step === "waiting") {
        api.cancelInvite(o.chal.inviteId).catch(() => {});
      }
    }
    if (api && o.roomId && o.room && o.room.status === "active" && o.me) {
      api.forfeitRoom(o.roomId, o.me.uid).catch(() => {});
    }
    pw.online = null;
    /* the game object outlives the screen — openPointaeway keeps it — so a
       phase that only makes sense with a live flow behind it has to go with
       the flow, or coming back to the game would try to draw a room that no
       longer exists */
    if (pw.phase === "finding" || pw.phase === "online"
        || pw.phase === "onlinehistory" || pw.phase === "challenge"
        || pw.phase === "create") pw.phase = "hub";
  }

  async function pwOnlineStart(code) {
    pwOnlineLeave();
    pw.online = pwOnlineNew();
    pw.online.code = pwCleanCode(code) || null;
    pw.phase = "finding";
    renderPointaeway();
    const o = pw.online;
    const api = await onlineReady();
    if (pw.online !== o) return;                       // left while waiting
    if (!api) { o.err = "offline"; renderPointaeway(); return; }
    let user;
    try { user = await api.requireUser(); } catch (e) { user = null; }
    if (pw.online !== o) return;
    if (!user) { o.err = "signin"; renderPointaeway(); return; }
    let profile;
    try { profile = await api.getProfile(user.uid); } catch (e) { profile = null; }
    if (pw.online !== o) return;
    if (!profile) { o.err = "profile"; renderPointaeway(); return; }
    o.profile = profile;
    o.me = {
      uid: user.uid,
      displayName: profile.displayName || profileName() || "Trader",
      photoURL: profile.photoURL || store.profilePhoto || "",
    };
    o.stage = "finding";
    renderPointaeway();
    const mm = api.quickMatch(o.me, { game: pwGameKey(o.code) });
    o.mm = mm;
    let roomId = null;
    try { roomId = await mm.promise; } catch (e) { roomId = null; }
    if (pw.online !== o || o.mm !== mm) return;        // cancelled
    if (!roomId) { o.err = "matchmaking"; o.mm = null; renderPointaeway(); return; }
    o.mm = null;
    pwOnlineEnter(roomId);
  }

  function pwOnlineEnter(roomId) {
    const api = online();
    const o = pw.online;
    o.roomId = roomId;
    o.stage = "match";
    o.room = null;
    pw.phase = "online";
    renderPointaeway();
    o.unsub = api.watchRoom(roomId, (room) => {
      if (pw.online !== o) return;
      const prev = o.room;
      o.room = room;
      /* the round advanced: the candle for the last one has printed, and the
         pick is open again */
      if (!prev || room.round !== prev.round) { o.waiting = false; o.picked = null; o.timedOut = false; }
      if (room.status === "finished") { o.waiting = false; pwOnlineRecord(room); }
      renderPointaeway();
    });
  }

  /* A card is played out of the hand the board derived, so what goes over the
     wire is the move the module understands — {side, power} — and what stays
     here is which of the five copies it was. */
  async function pwOnlinePlayCard(cardId) {
    const o = pw.online;
    if (!o || !o.board) return;
    const card = o.board.me.hand.find((c) => c.id === cardId);
    if (!card) return;
    pwOnlinePlay(card.side, card.pts);
  }

  async function pwOnlinePlay(side, power) {
    const api = online();
    const o = pw.online;
    if (!api || !o || !o.room || o.room.status !== "active" || o.waiting) return;
    o.waiting = true;
    o.picked = { side, power };
    o.showSeen = false;
    o.showSpecials = false;
    o.err = null;
    o.timedOut = false;
    renderPointaeway();
    try {
      await api.playRound(o.roomId, o.me.uid, { side, power });
    } catch (e) {
      if (pw.online !== o) return;
      if (/timed out/i.test(e && e.message || "")) o.timedOut = true;
      else if (!/already committed/i.test(e && e.message || "")) o.err = (e && e.message) || "That move did not go through.";
      o.waiting = false;
      renderPointaeway();
    }
    /* the happy path needs nothing here: watchRoom sees the candle print and
       clears `waiting` itself */
  }

  /* ==> INTEGRATION: recordMatchResult, once per room. Guarded twice — on the
     live object, and in the store — so a re-render, a second snapshot of the
     finished room, or a reload onto the same room cannot count it again. */
  function pwOnlineRecord(room) {
    const o = pw.online;
    if (!o || o.recorded || !o.me) return;
    o.recorded = true;
    if (!store.pwOnlineRecorded) store.pwOnlineRecorded = {};
    if (store.pwOnlineRecorded[room.id]) return;
    store.pwOnlineRecorded[room.id] = 1;
    const keys = Object.keys(store.pwOnlineRecorded);
    if (keys.length > 100) keys.slice(0, keys.length - 100).forEach((k) => { delete store.pwOnlineRecorded[k]; });
    save();
    const outcome = !room.winner ? "draw" : room.winner === o.me.uid ? "win" : "loss";
    const api = online();
    if (api) api.recordMatchResult(o.me.uid, outcome, ONLINE_XP[outcome]).catch(() => {});
  }

  /* the opponent's sixty seconds ran out. The room is stuck on our commit and
     the module has no way to resume the wait, so the way on is out: the
     absent player is the one who left, and forfeitRoom is told so. */
  async function pwOnlineTimeoutLeave() {
    const api = online();
    const o = pw.online;
    if (!api || !o || !o.room) return;
    const opp = (o.room.players || []).find((p) => p !== o.me.uid);
    if (opp && o.room.status === "active") {
      try { await api.forfeitRoom(o.roomId, opp); } catch (e) { /* best effort */ }
    }
    if (pw.online !== o) return;
    o.room = null;                  // nothing left to forfeit on the way out
    pwOnlineStart();
  }

  async function pwOnlineForfeit() {
    const api = online();
    const o = pw.online;
    if (!api || !o || !o.room || o.room.status !== "active") return;
    o.confirmForfeit = false;
    try { await api.forfeitRoom(o.roomId, o.me.uid); } catch (e) { if (pw.online === o) { o.err = "That did not go through — check your connection."; renderPointaeway(); } }
    /* watchRoom delivers the finished room and the banner with it */
  }

  async function pwOnlineHistoryOpen() {
    pwOnlineLeave();
    pw.online = pwOnlineNew();
    pw.online.stage = "history";
    pw.phase = "onlinehistory";
    renderPointaeway();
    const o = pw.online;
    const api = await onlineReady();
    if (pw.online !== o) return;
    if (!api) { o.err = "offline"; renderPointaeway(); return; }
    let user;
    try { user = await api.requireUser(); } catch (e) { user = null; }
    if (pw.online !== o) return;
    if (!user) { o.err = "signin"; renderPointaeway(); return; }
    o.me = { uid: user.uid };
    try { o.history = await api.getMatchHistory(user.uid); }
    catch (e) { o.err = "That list could not be loaded — check your connection."; }
    if (pw.online !== o) return;
    renderPointaeway();
  }

  /* ---- pieces ---- */

  const pwOnlineAvatar = (info, cls) => `
    <span class="pw-on-ava ${cls || ""}">
      <img src="${esc((info && info.photoURL) || "assets/nav-icons/icon-user@2x.png")}"
           class="${info && info.photoURL ? "shot" : ""}" alt="" draggable="false">
    </span>`;

  /* The room's candles, as SVG. The module prints them around 100 rather than
     on the local game's −25..+25 track, so the scale is the run's own low
     and high, padded, and the width is one column per round however many
     there are. Green when the close is above the open, red otherwise, a doji
     grey. */
  function pwOnlineChartSVG(candles, opts) {
    const o = opts || {};
    const W = 300, H = o.h || 120, PADX = 8, PADY = 8;
    const rows = Array.isArray(candles) ? candles : [];
    if (!rows.length) {
      return `<svg class="pw-on-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
        <line x1="${PADX}" y1="${H / 2}" x2="${W - PADX}" y2="${H / 2}" class="pw-on-open"/>
      </svg>`;
    }
    let lo = Infinity, hi = -Infinity;
    rows.forEach((c) => {
      lo = Math.min(lo, c.low != null ? c.low : Math.min(c.open, c.close));
      hi = Math.max(hi, c.high != null ? c.high : Math.max(c.open, c.close));
    });
    const first = rows[0].open;
    lo = Math.min(lo, first); hi = Math.max(hi, first);
    if (hi - lo < 4) { hi += 2; lo -= 2; }
    const y = (v) => PADY + ((hi - v) / (hi - lo)) * (H - PADY * 2);
    const col = (W - PADX * 2) / Math.max(rows.length, 8);
    const bw = Math.max(2, Math.min(14, col * 0.62));
    const bars = rows.map((c, i) => {
      const cx = PADX + col * i + col / 2;
      const top = y(Math.max(c.open, c.close)), bot = y(Math.min(c.open, c.close));
      const tone = c.close > c.open ? "bull" : c.close < c.open ? "bear" : "flat";
      const h = Math.max(1.2, bot - top);
      return `<line x1="${cx.toFixed(1)}" y1="${y(c.high != null ? c.high : Math.max(c.open, c.close)).toFixed(1)}"
                    x2="${cx.toFixed(1)}" y2="${y(c.low != null ? c.low : Math.min(c.open, c.close)).toFixed(1)}"
                    class="pw-on-wick ${tone}"/>
              <rect x="${(cx - bw / 2).toFixed(1)}" y="${top.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}"
                    rx="1" class="pw-on-body ${tone}"/>`;
    }).join("");
    return `<svg class="pw-on-svg" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
      <line x1="${PADX}" y1="${y(first).toFixed(1)}" x2="${W - PADX}" y2="${y(first).toFixed(1)}" class="pw-on-open"/>
      ${bars}
    </svg>`;
  }

  function pwOnlineErrorHTML(o) {
    const back = `<button type="button" class="pw-over-pill" data-pw-online-back>
        <img src="assets/nav-icons/icon-home@2x.png" alt=""><span>Back to Hub</span></button>`;
    const retry = `<button type="button" class="pw-over-pill on" data-pw-online-retry><span>Try Again</span></button>`;
    if (o.err === "offline") return `
      <div class="pw-on-msg">
        <b>You're offline</b>
        <span>Playing online needs a connection. The computer is always ready — Start Match plays it.</span>
      </div>
      <div class="pw-over-row">${retry}${back}</div>`;
    if (o.err === "signin") {
      /* signed into the app but not into Æway Online — a password, not a
         sign-up. See onlineAuthState. */
      if (onlineAuthState() === "reconnect") return `
        ${onlineReconnectHTML("Pw")}
        <div class="pw-over-row">${back}</div>`;
      return `
      <div class="pw-on-msg">
        <b>Sign in to play online</b>
        <span>Your account has to be signed in on this device for live matches and your online profile.</span>
      </div>
      <div class="pw-over-row">
        <button type="button" class="pw-over-pill on" data-pw-online-signin><span>Sign In</span></button>
        ${back}
      </div>`;
    }
    if (o.err === "profile") return `
      <div class="pw-on-msg"><b>Couldn't load your profile</b><span>Check your connection and try again.</span></div>
      <div class="pw-over-row">${retry}${back}</div>`;
    if (o.err === "matchmaking") return `
      <div class="pw-on-msg"><b>Couldn't join the queue</b><span>Check your connection and try again.</span></div>
      <div class="pw-over-row">${retry}${back}</div>`;
    return `
      <div class="pw-on-msg"><b>Something went wrong</b><span>${esc(o.err)}</span></div>
      <div class="pw-over-row">${retry}${back}</div>`;
  }

  /* ==================== Create Match ====================
     One player sets the match up, gets a code, and sends it. The other types
     it in, sees what they are joining, and joins. Both then sit in the same
     private lobby until they meet.

     The settings are locked the moment the code exists: they are IN the code,
     so there is nothing left to change once it has been sent — and the joiner
     is shown them before committing rather than after. */
  function pwCreateOpen() {
    pwOnlineLeave();
    pw.online = pwOnlineNew();
    pw.online.create = pwCreateNew();
    pw.phase = "create";
    renderPointaeway();
  }

  function pwCreateSet(key, value) {
    const c = pw && pw.online && pw.online.create;
    if (!c || c.step !== "setup") return;
    c.settings[key] = value;
    renderPointaeway();
  }

  function pwCreateGo() {
    const c = pw && pw.online && pw.online.create;
    if (!c) return;
    pwOnlineStart(pwMakeCode(c.settings));
  }

  function pwCreateJoinOpen() {
    const c = pw && pw.online && pw.online.create;
    if (!c) return;
    c.step = "join"; c.err = null; c.joinSettings = null;
    renderPointaeway();
    const inp = $("pwJoinInput");
    if (inp) inp.focus({ preventScroll: true });
  }

  function pwCreateJoinRead() {
    const c = pw && pw.online && pw.online.create;
    const inp = $("pwJoinInput");
    if (c && inp) c.joinCode = pwCleanCode(inp.value);
  }

  /* No round trip: the code says what the match is, so the settings can be
     shown the moment it is typed rather than after joining and finding out. */
  function pwCreateJoinCheck() {
    const c = pw && pw.online && pw.online.create;
    if (!c) return;
    pwCreateJoinRead();
    const set = pwCodeSettings(c.joinCode);
    if (!set) {
      c.err = c.joinCode.length < 6
        ? "A match code is six characters — check it and try again."
        : "That isn't a match code. Check the letters and numbers and try again.";
      c.joinSettings = null;
      renderPointaeway();
      return;
    }
    c.err = null; c.joinSettings = set; c.step = "preview";
    renderPointaeway();
  }

  /* the code, out of the app and into whatever the phone uses to send it */
  function pwShareCode(useShare) {
    const o = pw && pw.online;
    const code = o && o.code;
    if (!code) return;
    const done = (text) => { o.codeNotice = text; renderPointaeway(); };
    const msg = `Play me on Pointæway — match code ${code}`;
    if (useShare && navigator.share) {
      navigator.share({ title: "Pointæway match", text: msg })
        .then(() => done("Code shared."))
        .catch(() => { /* dismissed — say nothing */ });
      return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(code)
        .then(() => done("Code copied."))
        .catch(() => done(`Your code is ${code}`));
      return;
    }
    done(`Your code is ${code}`);
  }

  function pwCreateJoinGo() {
    const c = pw && pw.online && pw.online.create;
    if (!c || !c.joinSettings) return;
    pwOnlineStart(c.joinCode);
  }

  const PW_SPEC_CHOICES = [
    { v: 0, t: "Not playable",  s: "No special cards in the match" },
    { v: 1, t: "1 of each colour", s: "One from each colour, picked at random" },
    { v: 2, t: "2 of each colour", s: "Two from each colour, picked at random" },
    { v: 3, t: "All 3 of each colour", s: "Every special card that exists" },
  ];

  function pwCreateHTML() {
    const o = pw.online;
    const c = o.create || pwCreateNew();
    const head = `
      <div class="pw-lib-head">
        <button type="button" class="pw-hub-back" data-pw-online-back aria-label="Back to Match Hub">
          <img src="assets/nav-icons/icon-arrow-back@2x.png" alt="">
        </button>
        <span class="pw-lib-title">${c.step === "setup" ? "Create Match" : "Join a Match"}</span>
      </div>`;

    if (c.step === "join" || c.step === "preview") {
      const set = c.joinSettings;
      return `
        <div class="pw-on pw-create">${head}
          <div class="pw-chal-intro">Enter the code your friend sent you. You'll see the match's settings before you join.</div>
          <label class="mt-label" for="pwJoinInput">Match code</label>
          <input class="mt-input pw-chal-input" id="pwJoinInput" type="text"
                 inputmode="latin" autocapitalize="characters" autocomplete="off" spellcheck="false"
                 maxlength="6" placeholder="KQTZ43" value="${esc(c.joinCode || "")}">
          <button type="button" class="btn-primary pw-chal-go" data-pw-create-check>Check Code</button>
          ${c.err ? `<div class="pw-on-err" role="alert">${esc(c.err)}</div>` : ""}
          ${set ? `
            <div class="pw-cm-preview">
              <div class="pw-cm-cap">This match</div>
              ${pwCreateSummaryHTML(set)}
              <div class="pw-cm-lock">These settings are set by the host and can't be changed once you're both in.</div>
              <button type="button" class="pw-over-pill on" data-pw-create-join><span>Join Match</span></button>
            </div>` : ""}
          <button type="button" class="pw-hub-link" data-pw-create-back>
            Create a match instead <span aria-hidden="true">›</span>
          </button>
        </div>`;
    }

    const set = pwSettings(c.settings);
    return `
      <div class="pw-on pw-create">${head}
        <div class="pw-chal-intro">Set the match up, then send the code to whoever you want to play.</div>

        <div class="pw-cm-group">
          <div class="pw-cm-cap">Match points</div>
          <div class="pw-cm-sub">How far the print has to travel to win — and how big the decks and hands are.</div>
          <div class="pw-cm-opts pts">
            ${PW_POINTS.map((n) => {
              const r = PW_POINT_RULES[n];
              return `<button type="button" class="pw-cm-opt${set.points === n ? " on" : ""}"
                        data-pw-create-points="${n}" aria-pressed="${set.points === n}">
                <span class="pw-cm-opt-t">${n}</span>
                <span class="pw-cm-opt-s">${r.copies}× each card · ${r.hand} in hand</span>
              </button>`;
            }).join("")}
          </div>
        </div>

        <div class="pw-cm-group">
          <div class="pw-cm-cap">Specialty cards</div>
          <div class="pw-cm-sub">The wilds come in colours of three. Pick how many of each colour are in play.</div>
          <div class="pw-cm-opts spec">
            ${PW_SPEC_CHOICES.map((x) => `
              <button type="button" class="pw-cm-opt wide${set.perColour === x.v ? " on" : ""}"
                      data-pw-create-spec="${x.v}" aria-pressed="${set.perColour === x.v}">
                <span class="pw-cm-opt-t">${esc(x.t)}</span>
                <span class="pw-cm-opt-s">${esc(x.s)}</span>
              </button>`).join("")}
          </div>
          ${set.perColour ? `<div class="pw-cm-note">${esc(pwSpecCountNote(set.perColour))}</div>` : ""}
        </div>

        <button type="button" class="pw-over-pill on pw-cm-go" data-pw-create-go><span>Create Match</span></button>
        <button type="button" class="pw-hub-link" data-pw-create-joinopen>
          Have a code? Join a match <span aria-hidden="true">›</span>
        </button>
      </div>`;
  }

  /* what "n of each colour" actually comes to, white being short two cards */
  function pwSpecCountNote(per) {
    const total = PW_SPEC_COLOURS.reduce((n, c) => n + Math.min(per, c.cards.length), 0);
    const short = PW_SPEC_COLOURS.filter((c) => c.cards.length < per);
    return `${total} special card${total === 1 ? "" : "s"} in the match`
      + (short.length ? ` — ${short.map((c) => c.name.toLowerCase()).join(" and ")} has fewer than ${per} so far.` : ".");
  }

  function pwCreateSummaryHTML(set) {
    const s = pwSettings(set);
    const spec = PW_SPEC_CHOICES.find((x) => x.v === s.perColour) || PW_SPEC_CHOICES[3];
    return `
      <div class="pw-cm-sum">
        <div class="pw-cm-sum-row"><span>Match points</span><b>${s.points}</b></div>
        <div class="pw-cm-sum-row"><span>Copies of each card</span><b>${s.copies} per side</b></div>
        <div class="pw-cm-sum-row"><span>Starting hand</span><b>${s.hand} cards</b></div>
        <div class="pw-cm-sum-row"><span>Specialty cards</span><b>${esc(spec.t)}</b></div>
      </div>`;
  }

  function pwFindingHTML() {
    const o = pw.online;
    const head = `
      <div class="pw-lib-head">
        <button type="button" class="pw-hub-back" data-pw-online-back aria-label="Back to Match Hub">
          <img src="assets/nav-icons/icon-arrow-back@2x.png" alt="">
        </button>
        <span class="pw-lib-title">${o.code ? "Match Created" : "Play Online"}</span>
      </div>`;
    if (o.err) return `<div class="pw-on pw-finding">${head}${pwOnlineErrorHTML(o)}</div>`;
    const me = o.me || { displayName: profileName(), photoURL: store.profilePhoto };
    const set = pwCodeSettings(o.code);
    return `
      <div class="pw-on pw-finding">
        ${head}
        <div class="pw-finding-body">
          ${o.code ? `
            <div class="pw-cm-code-wrap">
              <div class="pw-cm-cap">Send this code</div>
              <div class="pw-cm-code" id="pwMatchCode">${esc(o.code)}</div>
              <div class="pw-cm-code-acts">
                <button type="button" class="pw-over-pill" data-pw-code-copy><span>Copy</span></button>
                <button type="button" class="pw-over-pill" data-pw-code-share><span>Share</span></button>
              </div>
              ${o.codeNotice ? `<div class="pw-cm-note" role="status">${esc(o.codeNotice)}</div>` : ""}
            </div>` : `
            ${pwOnlineAvatar(me, "lg")}
            <div class="pw-finding-name">${esc(me.displayName || "Trader")}</div>`}
          <div class="pw-spinner" aria-hidden="true"></div>
          <div class="pw-finding-cap" role="status">
            ${o.stage === "auth" ? "Getting you ready…"
              : o.code ? "Waiting for your opponent…" : "Finding opponent…"}
          </div>
          <div class="pw-finding-sub">${set
            ? esc(pwSettingsLabel(set))
            : `Pointæway 1v1 · first to ${ONLINE_ROUNDS_TO_WIN} rounds`}</div>
        </div>
        <button type="button" class="pw-over-pill pw-finding-cancel" data-pw-online-cancel>
          <span>Cancel</span>
        </button>
      </div>`;
  }

  function pwOnlineHTML() {
    const o = pw.online;
    const room = o.room;
    const head = `
      <div class="pw-lib-head">
        <button type="button" class="pw-hub-back" data-pw-online-back aria-label="Back to Match Hub">
          <img src="assets/nav-icons/icon-arrow-back@2x.png" alt="">
        </button>
        <span class="pw-lib-title">Pointæway Online</span>
      </div>`;
    if (!room) {
      return `<div class="pw-on">${head}
        <div class="pw-finding-body"><div class="pw-spinner" aria-hidden="true"></div>
        <div class="pw-finding-cap" role="status">Opening the room…</div></div></div>`;
    }
    const meId = o.me.uid;
    const oppId = (room.players || []).find((p) => p !== meId) || "";
    const info = room.playerInfo || {};
    const meInfo = Object.assign({ displayName: o.me.displayName, photoURL: o.me.photoURL }, info[meId] || {});
    const oppInfo = info[oppId] || { displayName: "Opponent", photoURL: "" };
    const scores = room.scores || {};
    const myScore = scores[meId] || 0, oppScore = scores[oppId] || 0;
    const finished = room.status === "finished";
    const candles = room.candles || [];
    const last = candles[candles.length - 1];

    const player = (inf, score, cls, tag) => `
      <div class="pw-on-player ${cls}">
        ${pwOnlineAvatar(inf, "")}
        <span class="pw-on-pname">${esc(inf.displayName || "Trader")}</span>
        <span class="pw-on-ptag">${tag}</span>
        <b class="pw-on-score">${score}</b>
      </div>`;

    let body = null;
    if (finished) {
      const outcome = !room.winner ? "draw" : room.winner === meId ? "win" : "loss";
      const line = outcome === "win" ? "You won" : outcome === "loss" ? "You lost" : "Draw";
      body = `
        <div class="pw-on-banner ${outcome}">
          <b>${line}</b>
          <span>${myScore} – ${oppScore} · ${candles.length} round${candles.length === 1 ? "" : "s"}</span>
        </div>
        <div class="pw-over-row">
          <button type="button" class="pw-over-pill on" data-pw-online-again><span>Play Again</span></button>
          <button type="button" class="pw-over-pill" data-pw-online-back>
            <img src="assets/nav-icons/icon-home@2x.png" alt=""><span>Back to Hub</span>
          </button>
        </div>`;
    } else if (o.timedOut) {
      body = `
        <div class="pw-on-msg">
          <b>Opponent timed out</b>
          <span>They didn't play a card in time. Leave this match and find another opponent.</span>
        </div>
        <div class="pw-over-row">
          <button type="button" class="pw-over-pill on" data-pw-online-rematch><span>Find New Opponent</span></button>
          <button type="button" class="pw-over-pill" data-pw-online-back>
            <img src="assets/nav-icons/icon-home@2x.png" alt=""><span>Back to Hub</span>
          </button>
        </div>`;
    }

    /* the finished and timed-out states are a result screen, so they keep the
       chart and the two ways out. A live match is the board. */
    if (body) {
      return `
        <div class="pw-on">
          ${head}
          <div class="pw-on-head">
            ${player(meInfo, myScore, "me", "You")}
            <span class="pw-on-vs" aria-hidden="true">VS</span>
            ${player(oppInfo, oppScore, "opp", "Opp")}
          </div>
          <div class="pw-on-chart">
            ${pwOnlineChartSVG(candles)}
            <div class="pw-on-chartcap">
              <span>${candles.length ? `${candles.length} candle${candles.length === 1 ? "" : "s"}` : "No candles yet"}</span>
              <span>${last ? `last close ${Number(last.close).toFixed(0)}` : `first to ${ONLINE_ROUNDS_TO_WIN}`}</span>
            </div>
          </div>
          ${body}
        </div>`;
    }

    return pwOnlineBoardHTML(o, room, meInfo, oppInfo, myScore, oppScore, head, player);
  }

  /* ---- the live board ----
     The same table a single-player match is played on: what is left to draw
     from, their seat, the meter both sides are pulling on, your seat, then
     your hand. The only things it adds are the two names and the round-win
     score, because online there is somebody to name. */
  function pwOnlineBoardHTML(o, room, meInfo, oppInfo, myScore, oppScore, _head, player) {
    const b = pwOnlineBoard(room, o.me.uid);
    o.board = b;                                  // the tap handler reads it back
    const canPlay = room.status === "active" && !o.waiting;
    const picked = o.picked ? pwOnlineCard(b.me.side, o.picked.power) : null;
    /* your seat holds the card you have committed this round; once the round
       prints, it holds what you actually played until you commit the next */
    const mine = picked || b.table.me;
    const theirs = o.waiting ? null : b.table.opp;
    const youHint = o.waiting ? "Locked in" : canPlay ? "Tap a card to play" : "…";
    const oppHint = o.waiting
      ? "Waiting for theirs…"
      : theirs ? `${b.opp.side} · ${b.opp.deck} left` : "Awaiting play…";

    return `
      <div class="pw-on pw-on-board">
        ${/* The board's header is one row, not two. A local match spends
              nothing on chrome above the counts, and the online one has two
              names and two scores to fit as well — so the title line goes,
              the way back moves into the row with the players, and the VS
              between them goes with it. On a 320×568 phone those two rows
              are the difference between the board sitting in one view and
              not, and the whole point of this screen is that it is the same
              board. */""}
        <div class="pw-on-head tight">
          <button type="button" class="pw-on-back" data-pw-online-back
                  aria-label="Back to Match Hub">
            <img src="assets/nav-icons/icon-arrow-back@2x.png" alt="">
          </button>
          ${player(meInfo, myScore, "me", "You")}
          ${/* the two round-win scores meet in the middle of this row, so
                something has to stand between them */""}
          <span class="pw-on-split" aria-hidden="true"></span>
          ${player(oppInfo, oppScore, "opp", "Opp")}
        </div>

        <div class="pw-counts">
          <span class="pw-count"><b>${b.me.deck}</b><i>Deck</i></span>
          ${/* a wild cannot cross the wire — see the note on pwOnlineBoard —
                so online the pile is empty, and the chip says so rather than
                being left off the board */""}
          <span class="pw-count wild"><b>0</b><i>Wild</i></span>
          <span class="pw-count opp"><b>${b.opp.hand.length}</b><i>Opp</i></span>
          ${pwChartToggleHTML(o.showChart, "data-pw-online-chart")}
          <span class="pw-counts-gap"></span>
          <button type="button" class="pw-count-btn${o.showSeen ? " on" : ""}" data-pw-online-seen
                  aria-pressed="${!!o.showSeen}"
                  aria-label="What the opponent has played">Seen</button>
          <button type="button" class="pw-count-btn" data-pw-online-forfeit
                  aria-label="Forfeit this match">Forfeit</button>
        </div>

        <div class="pw-field">
          <div class="pw-arena">
            <div class="pw-seat you">
              <span class="pw-seat-tag you">You</span>
              <div class="pw-seat-slot${mine ? " filled" : ""}">
                ${mine ? pwCardHTML(mine, {}) : pwBackHTML(b.me.side)}
              </div>
              <span class="pw-seat-cap">${esc(youHint)}</span>
            </div>
            ${pwPrintHTML(b.print)}
            <div class="pw-seat opp">
              <span class="pw-seat-tag opp">Opp</span>
              <div class="pw-seat-slot${theirs ? " filled" : ""}">
                ${theirs ? pwCardHTML(theirs, {}) : pwBackHTML(b.opp.side)}
              </div>
              <span class="pw-seat-cap">${esc(oppHint)}</span>
            </div>
          </div>
        </div>

        <div class="pw-handhead">
          <span class="pw-hand-cap">Your Hand <b>(${b.me.hand.length})</b></span>
          <button type="button" class="pw-specials-btn${o.showSpecials ? " on" : ""}"
                  data-pw-online-specials aria-expanded="${!!o.showSpecials}" aria-controls="pwSheet">
            <span class="pw-specials-ico" aria-hidden="true"></span>
            <span>View Specials</span>
          </button>
        </div>

        ${o.err ? `<div class="pw-on-err" role="alert">${esc(o.err)}</div>` : ""}

        ${o.showSpecials ? pwSpecialsSheetHTML() : o.showSeen ? `
        <div class="pw-seen">
          <div class="pw-seen-cap">Opponent has played</div>
          ${pwTiers(b.opp.side).filter((t) => t.pts > 0).map((t) => {
            const n = b.seen[t.type] || 0;
            return `<div class="pw-seen-row${n ? " on" : ""}">
              <span>${esc(t.type)}</span>
              <span class="pw-seen-n ${b.opp.side}">${n}/${pwCopies()}</span>
            </div>`;
          }).join("")}
          <button class="pw-ghost" data-pw-online-seen>Close</button>
        </div>` : o.confirmForfeit ? `
        <div class="pw-choice">
          <div class="pw-choice-cap">Forfeit this match? Your opponent takes the win.</div>
          <div class="pw-choice-btns">
            <button class="pw-choice-btn wild" data-pw-online-forfeit-yes>Forfeit</button>
            <button class="pw-choice-btn ${b.me.side}" data-pw-online-forfeit-no>Keep playing</button>
          </div>
        </div>` : `
        <div class="pw-hand">
          ${b.me.hand.length
            ? b.me.hand.map((c) => pwCardHTML(c, {
                online: true, disabled: !canPlay, dim: !canPlay, left: pwOnLeft(b, c) })).join("")
            : `<div class="pw-hand-empty">Empty — nothing left to play.</div>`}
        </div>`}
      </div>`;
  }

  function pwOnlineHistoryHTML() {
    const o = pw.online;
    const head = `
      <div class="pw-lib-head">
        <button type="button" class="pw-hub-back" data-pw-online-back aria-label="Back to Match Hub">
          <img src="assets/nav-icons/icon-arrow-back@2x.png" alt="">
        </button>
        <span class="pw-lib-title">Online History</span>
      </div>`;
    if (o.err) return `<div class="pw-on pw-oh">${head}${pwOnlineErrorHTML(o)}</div>`;
    if (!o.history) return `<div class="pw-on pw-oh">${head}
      <div class="pw-finding-body"><div class="pw-spinner sm" aria-hidden="true"></div>
      <div class="pw-finding-cap" role="status">Loading your matches…</div></div></div>`;
    if (!o.history.length) return `<div class="pw-on pw-oh">${head}
      <div class="pw-hist-none">No online matches yet — your first one lands here.</div></div>`;
    const meId = o.me.uid;
    const rows = o.history.map((room) => {
      const oppId = (room.players || []).find((p) => p !== meId) || "";
      const opp = (room.playerInfo || {})[oppId] || { displayName: "Opponent", photoURL: "" };
      const scores = room.scores || {};
      const mine = scores[meId] || 0, theirs = scores[oppId] || 0;
      const outcome = room.status !== "finished" ? "live"
        : !room.winner ? "draw" : room.winner === meId ? "win" : "loss";
      const label = { win: "Win", loss: "Loss", draw: "Draw", live: "In progress" }[outcome];
      const when = room.createdAt && room.createdAt.seconds ? pwHubWhen(room.createdAt.seconds * 1000) : "";
      const open = o.histOpen === room.id;
      return `
        <div class="pw-oh-row${open ? " open" : ""}">
          <button type="button" class="pw-oh-btn" data-pw-oh-open="${esc(room.id)}" aria-expanded="${open}">
            ${pwOnlineAvatar(opp, "")}
            <span class="pw-oh-opp">vs ${esc(opp.displayName || "Opponent")}</span>
            <span class="pw-oh-res ${outcome}">${label}</span>
            <span class="pw-oh-score ${outcome}">${mine}–${theirs}</span>
            <span class="pw-oh-when">${esc(when)}</span>
          </button>
          ${open ? `<div class="pw-oh-chart">${pwOnlineChartSVG(room.candles, { h: 110 })}
            <div class="pw-on-chartcap"><span>${(room.candles || []).length} candles</span><span>${esc(label)}</span></div>
          </div>` : ""}
          ${/* ==> invites.js: a past opponent is somebody you already meant to
                play, so this skips the lookup and sends straight to them */""}
          ${oppId ? `<div class="pw-oh-foot">
            <button type="button" class="pw-oh-rematch" data-pw-oh-rematch="${esc(room.id)}">
              Rematch <span aria-hidden="true">›</span>
            </button>
          </div>` : ""}
        </div>`;
    }).join("");
    return `<div class="pw-on pw-oh">${head}<div class="pw-oh-list">${rows}</div></div>`;
  }

  /* ==================== Challenges ====================
     The second way into a live room, beside quickMatch: you name the player.
     There is deliberately no directory here — no browsing, no prefix search,
     no leaderboard — because the backend deliberately does not support one.
     A challenge is sent two ways only: an invite code or an exact display
     name typed in, or a past opponent tapped in the match history.

     ==> INTEGRATION POINTS (invites.js, through window.AEWAY_ONLINE):
       lookupPlayer(input, selfUid)        — a code or an exact name; never a partial list
       sendMatchInvite(me, target, {game}) — inviteId; expires in INVITE_TTL_MS
       watchInvite(inviteId, cb)           — the sender's side: accepted/declined/cancelled
       watchIncomingInvites(uid, cb)       — the recipient's inbox, live, expired hidden
       acceptInvite(inviteId, me)          — makes the room quickMatch would have made
       declineInvite(inviteId) / cancelInvite(inviteId)
     The room acceptInvite creates is the same shape quickMatch creates, so
     the match screen takes it unchanged — pwOnlineEnter is the same call. */

  /* who is playing, resolved once and shared by every path that needs a
     {uid, displayName, photoURL} to hand a module */
  let aewayMe = null;
  /* ---- the two sessions, and the gap between them ----
     The app signs in over Firebase's REST API and keeps that session itself;
     the modular SDK behind js/online/ keeps a second one, and the mirror in
     the login handler is what makes them the same account. An account that
     signed in BEFORE that mirror existed therefore has the first session and
     not the second — and every online feature then finds nobody and does
     nothing, quietly, while the app plainly says the user is signed in. That
     is not a state to leave unexplained, so it has a name of its own:

       "ok"        both sessions, everything works
       "reconnect" signed into the app, not into Æway Online — one password
                   away from working, and the screens say so
       "signin"    not signed into the app at all
       "offline"   the bridge never loaded (no CDN, or no connection)

     There is no way to hand the REST session's token to the SDK from the
     client, so the fix is a sign-in, not a token swap. */
  function onlineAuthState() {
    const api = online();
    if (!api) return "offline";
    const appUser = window.FB && FB.user();
    if (api.currentUser && api.currentUser()) return "ok";
    return appUser ? "reconnect" : "signin";
  }

  const onlineAppEmail = () => (window.FB && FB.user() && FB.user().email) || "";

  /* the shared block every screen shows when the two sessions have drifted */
  function onlineReconnectHTML(idSuffix) {
    const id = `onRe${idSuffix || ""}`;
    return `
      <div class="on-reconnect">
        <b>Reconnect to Æway Online</b>
        <span>You're signed in to the app, but live play, challenges,
          connections and messages each keep their own session and this device
          hasn't opened one yet. Your password opens it — once.</span>
        <div class="on-reconnect-mail">${esc(onlineAppEmail() || "your account")}</div>
        <input class="mt-input" id="${id}" type="password" autocomplete="current-password"
               placeholder="Password" aria-label="Password">
        <button type="button" class="ad-save" data-online-reconnect="${id}">Reconnect</button>
        ${state.onlineReconnectErr ? `<div class="pw-on-err" role="alert">${esc(state.onlineReconnectErr)}</div>` : ""}
      </div>`;
  }

  async function onlineReconnect(inputId) {
    const api = online();
    const input = $(inputId);
    if (!api || !input) return;
    const password = input.value;
    const email = onlineAppEmail();
    if (!email) { state.onlineReconnectErr = "Sign in to the app first."; rerenderOnlineScreens(); return; }
    if (!password) { state.onlineReconnectErr = "Enter your password."; rerenderOnlineScreens(); return; }
    state.onlineReconnectErr = null;
    input.disabled = true;
    try { await api.signIn(email, password); }
    catch (e) {
      input.disabled = false;
      state.onlineReconnectErr = "That didn't sign in. Check the password and try again.";
      rerenderOnlineScreens();
      return;
    }
    aewayMe = null;
    inboxStart();
    connectionsStart();
    rerenderOnlineScreens(true);
  }

  /* whichever online screen is up, re-run from the top now that there is a
     session behind it */
  function rerenderOnlineScreens(reload) {
    if (state.view === "profile") { if (reload) profileOnlineLoad(true); else renderProfileOnlineInPlace(); }
    else if (state.view === "connections") { if (reload) connectionsLoad(true); else renderConnections(); }
    else if (state.view === "pointaeway" && pw) {
      if (reload && pw.online) {
        if (pw.phase === "onlinehistory") pwOnlineHistoryOpen();
        else if (pw.phase === "create") pwCreateOpen();
        else if (pw.phase === "finding") pwOnlineStart(pw.online && pw.online.code);
        else renderPointaeway();
      } else renderPointaeway();
    }
  }

  async function aewayIdentity(force) {
    const api = online();
    if (!api) return null;
    if (aewayMe && !force) return aewayMe;
    let user;
    try { user = await api.requireUser(); } catch (e) { return null; }
    let p = null;
    try { p = await api.getProfile(user.uid); } catch (e) { p = null; }
    aewayMe = {
      uid: user.uid,
      displayName: (p && p.displayName) || profileName() || "Trader",
      photoURL: (p && p.photoURL) || store.profilePhoto || "",
      inviteCode: (p && p.inviteCode) || "",
    };
    return aewayMe;
  }

  /* ---- the inbox ----
     App-wide rather than per-screen: a challenge can land while its recipient
     is anywhere, and the dock's Gameæway slot is where the app already points
     at the games. Started once the bridge is up and somebody is signed in,
     stopped on sign-out. */
  const inbox = { unsub: null, uid: null, list: [], busy: null, err: null,
                  hidden: null };   // the one the bar was dismissed for

  function inboxCount() { return inbox.list.length; }

  function syncInboxBadge() {
    const btn = $("navBattle");
    if (!btn) return;
    const n = inboxCount();
    let dot = btn.querySelector(".dock-badge");
    if (!n) { if (dot) dot.remove(); btn.removeAttribute("data-badge"); return; }
    if (!dot) {
      dot = document.createElement("span");
      dot.className = "dock-badge";
      btn.appendChild(dot);
    }
    dot.textContent = n > 9 ? "9+" : String(n);
    btn.setAttribute("data-badge", String(n));
    btn.setAttribute("aria-label",
      `Gameæway — choose a game. ${n} challenge${n === 1 ? "" : "s"} waiting.`);
  }

  /* ---- the bar at the top of whatever screen you are on ----
     A dock badge says a challenge is waiting; it does not say who from, and
     it cannot be answered. Since the recipient may be anywhere in the app
     when one lands, the newest challenge also draws itself into the card's
     own header strip, above the current screen, with Accept and Decline on
     it. It is part of the card, not a layer over it. */
  function syncChallengeBar() {
    const bar = $("chalBar");
    if (!bar) return;
    const inv = inbox.list.find((v) => v.id !== inbox.hidden);
    /* the hub already lists every challenge in full, so the bar stands down
       there rather than saying the same thing twice */
    const onHub = state.view === "pointaeway" && pw && pw.phase === "hub";
    if (!inv || onHub) { bar.hidden = true; bar.innerHTML = ""; return; }
    const busy = inbox.busy === inv.id;
    const more = inbox.list.length - 1;
    bar.hidden = false;
    bar.innerHTML = `
      <span class="chal-bar-dot" aria-hidden="true"></span>
      <span class="chal-bar-text">
        <b>${esc(inv.fromName || "A trader")}</b>
        <i>challenged you to Pointæway${more > 0 ? ` · ${more} more waiting` : ""}</i>
      </span>
      ${busy
        ? `<span class="pw-spinner sm" aria-hidden="true"></span>`
        : `<button type="button" class="chal-bar-btn yes" data-pw-inv-accept="${esc(inv.id)}">Accept</button>
           <button type="button" class="chal-bar-btn" data-pw-inv-decline="${esc(inv.id)}">Decline</button>
           <button type="button" class="chal-bar-x" data-chal-bar-hide="${esc(inv.id)}"
                   aria-label="Hide this for now">×</button>`}`;
  }

  /* everything that changes when the list does, in one place, so no caller
     has to remember the three */
  function syncInbox() {
    syncInboxBadge();
    syncChallengeBar();
    if (state.view === "pointaeway" && pw && pw.phase === "hub") renderPointaeway();
  }

  async function inboxStart() {
    const api = await onlineReady();
    if (!api || !api.watchIncomingInvites) return;
    const me = await aewayIdentity();
    if (!me) return;
    if (inbox.unsub && inbox.uid === me.uid) return;      // already watching this account
    inboxStop();
    inbox.uid = me.uid;
    inbox.unsub = api.watchIncomingInvites(me.uid, (list) => {
      inbox.list = Array.isArray(list) ? list : [];
      if (inbox.hidden && !inbox.list.some((v) => v.id === inbox.hidden)) inbox.hidden = null;
      syncInbox();
    });
  }
  function inboxStop() {
    if (inbox.unsub) { try { inbox.unsub(); } catch (e) { /* gone */ } }
    inbox.unsub = null; inbox.uid = null; inbox.list = []; inbox.busy = null; inbox.hidden = null;
    syncInbox();
  }

  /* Accept lands in the room the module just made — the same room shape
     quickMatch makes, so the match screen needs nothing new. */
  async function inboxAccept(inviteId) {
    const api = online();
    if (!api || inbox.busy) return;
    inbox.busy = inviteId;
    syncInbox();
    const me = await aewayIdentity();
    if (!me) { inbox.busy = null; syncInbox(); return; }
    let roomId = null;
    try { roomId = await api.acceptInvite(inviteId, me); }
    catch (e) {
      inbox.busy = null;
      inbox.err = (e && e.message) || "That challenge is no longer available.";
      syncInbox();
      return;
    }
    inbox.busy = null; inbox.err = null;
    if (!roomId) return;
    openPointaeway();
    pwOnlineLeave();
    pw.online = pwOnlineNew();
    pw.online.me = me;
    pwOnlineEnter(roomId);
  }

  async function inboxDecline(inviteId) {
    const api = online();
    if (!api || inbox.busy) return;
    inbox.busy = inviteId;
    syncInbox();
    try { await api.declineInvite(inviteId); } catch (e) { /* it will fall out of the inbox anyway */ }
    inbox.busy = null;
    /* watchIncomingInvites drops it from the list and repaints */
    syncInbox();
  }

  function inboxHTML() {
    if (!inbox.list.length && !inbox.err) return "";
    if (inbox.err) {
      return `<div class="pw-inbox"><div class="pw-inbox-err" role="alert">${esc(inbox.err)}</div></div>`;
    }
    return `
      <div class="pw-inbox">
        <div class="pw-inbox-head">
          <span class="pw-inbox-title">Challenges</span>
          <span class="pw-inbox-n">${inbox.list.length}</span>
        </div>
        ${inbox.list.map((inv) => {
          const busy = inbox.busy === inv.id;
          return `
          <div class="pw-inv">
            ${pwOnlineAvatar({ photoURL: inv.fromPhoto }, "")}
            <span class="pw-inv-name"><b>${esc(inv.fromName || "A trader")}</b><i>challenged you</i></span>
            ${busy
              ? `<span class="pw-inv-busy"><span class="pw-spinner sm" aria-hidden="true"></span></span>`
              : `<button type="button" class="pw-inv-act yes" data-pw-inv-accept="${esc(inv.id)}">Accept</button>
                 <button type="button" class="pw-inv-act" data-pw-inv-decline="${esc(inv.id)}">Decline</button>`}
          </div>`;
        }).join("")}
      </div>`;
  }

  /* ---- the challenge screen ----
     One input, then whoever it resolved to, then the wait. Each of those is a
     step of the same screen rather than three screens: the whole thing is one
     errand and backing out of it means backing out of all of it. */
  function pwChalNew() {
    return { step: "input", query: "", results: null, target: null,
             inviteId: null, unsub: null, timer: null, err: null, busy: false };
  }

  function pwChalDrop() {
    const o = pw && pw.online;
    const c = o && o.chal;
    if (!c) return;
    if (c.unsub) { try { c.unsub(); } catch (e) { /* gone */ } c.unsub = null; }
    if (c.timer) { clearTimeout(c.timer); c.timer = null; }
  }

  /* Challenge a Player is gone — Create Match replaces it, and a code you
     send beats looking somebody up by name. What is left of this section is
     the one door that still needs it: Rematch, on a row in the online match
     history, which challenges a past opponent directly and never went through
     the lookup. So the send, the wait and the three ways a wait can end stay;
     the screen that found a stranger by name does not. */
  async function pwChallengeSend(target) {
    const api = online();
    const o = pw && pw.online;
    const c = o && o.chal;
    if (!api || !c || c.busy) return;
    c.busy = true; c.err = null; c.target = target; c.step = "sending";
    renderPointaeway();
    let id = null;
    try { id = await api.sendMatchInvite(o.me, target, { game: ONLINE_GAME }); }
    catch (e) {
      if (pw.online !== o) return;
      c.busy = false; c.step = "results";
      c.err = (e && e.message) || "That challenge didn't send — check your connection.";
      renderPointaeway(); return;
    }
    if (pw.online !== o) { try { api.cancelInvite(id); } catch (e) { /* best effort */ } return; }
    c.busy = false; c.inviteId = id; c.step = "waiting";
    renderPointaeway();
    /* the sender's side of the handshake */
    c.unsub = api.watchInvite(id, (inv) => {
      if (pw.online !== o || c.inviteId !== id) return;
      if (inv.status === "accepted" && inv.roomId) {
        pwChalDrop();
        pwOnlineEnter(inv.roomId);
      } else if (inv.status === "declined") {
        pwChalDrop(); c.step = "declined"; renderPointaeway();
      } else if (inv.status === "cancelled") {
        pwChalDrop(); c.step = "cancelled"; renderPointaeway();
      }
    });
    /* An invite expires after five minutes and nothing writes to it when it
       does — there is no status change for the listener to see — so the wait
       is ended here instead. */
    const ttl = api.INVITE_TTL_MS || 5 * 60 * 1000;
    c.timer = setTimeout(() => {
      if (pw.online !== o || c.inviteId !== id || c.step !== "waiting") return;
      pwChalDrop();
      try { api.cancelInvite(id); } catch (e) { /* best effort */ }
      c.step = "expired";
      renderPointaeway();
    }, ttl);
  }

  async function pwChallengeCancel() {
    const api = online();
    const o = pw && pw.online;
    const c = o && o.chal;
    if (!c) return;
    const id = c.inviteId;
    pwChalDrop();
    if (api && id) { try { await api.cancelInvite(id); } catch (e) { /* best effort */ } }
    if (pw.online !== o) return;
    c.inviteId = null; c.step = c.results && c.results.length ? "results" : "input";
    renderPointaeway();
  }

  /* a past opponent, challenged straight from the history row */
  async function pwChallengeRematch(uid, name, photo) {
    const api = await onlineReady();
    if (!api) return;
    const me = await aewayIdentity();
    if (!me) return;
    pwOnlineLeave();
    pw.online = pwOnlineNew();
    pw.online.me = me;
    pw.online.chal = pwChalNew();
    pw.phase = "challenge";
    renderPointaeway();
    pwChallengeSend({ uid, displayName: name, photoURL: photo });
  }

  function pwChallengeHTML() {
    const o = pw.online;
    const c = o.chal;
    const head = `
      <div class="pw-lib-head">
        <button type="button" class="pw-hub-back" data-pw-online-back aria-label="Back to Match Hub">
          <img src="assets/nav-icons/icon-arrow-back@2x.png" alt="">
        </button>
        <span class="pw-lib-title">Rematch</span>
      </div>`;
    if (o.err) return `<div class="pw-on pw-chal">${head}${pwOnlineErrorHTML(o)}</div>`;
    if (!c || !o.me) {
      return `<div class="pw-on pw-chal">${head}
        <div class="pw-finding-body"><div class="pw-spinner sm" aria-hidden="true"></div>
        <div class="pw-finding-cap" role="status">Getting you ready…</div></div></div>`;
    }
    const back = `<button type="button" class="pw-over-pill" data-pw-online-back>
        <img src="assets/nav-icons/icon-home@2x.png" alt=""><span>Back to Hub</span></button>`;

    if (c.step === "waiting" || c.step === "sending") {
      const t = c.target || {};
      return `
        <div class="pw-on pw-chal">${head}
          <div class="pw-finding-body">
            ${pwOnlineAvatar(t, "lg")}
            <div class="pw-finding-name">${esc(t.displayName || "Trader")}</div>
            <div class="pw-spinner" aria-hidden="true"></div>
            <div class="pw-finding-cap" role="status">
              ${c.step === "sending" ? "Sending…" : `Waiting for ${esc(t.displayName || "them")}…`}
            </div>
            <div class="pw-finding-sub">The challenge expires in five minutes.</div>
          </div>
          ${c.step === "waiting"
            ? `<button type="button" class="pw-over-pill pw-finding-cancel" data-pw-chal-cancel><span>Cancel</span></button>`
            : ""}
        </div>`;
    }
    if (c.step === "declined" || c.step === "expired" || c.step === "cancelled") {
      const t = c.target || {};
      const msg = c.step === "declined"
        ? { b: "They declined", s: `${esc(t.displayName || "They")} turned down this challenge.` }
        : c.step === "expired"
          ? { b: "Challenge expired", s: "Five minutes passed with no answer. Send it again, or play the computer." }
          : { b: "Challenge cancelled", s: "That challenge was withdrawn." };
      return `
        <div class="pw-on pw-chal">${head}
          <div class="pw-on-msg"><b>${msg.b}</b><span>${msg.s}</span></div>
          <div class="pw-over-row">${back}</div>
        </div>`;
    }
    /* nothing else lands here: a rematch goes straight to "sending" */
    return `
      <div class="pw-on pw-chal">${head}
        <div class="pw-on-msg"><b>Nothing to rematch</b>
          <span>Open a past match from the online history and rematch from there.</span></div>
        <div class="pw-over-row">${back}</div>
      </div>`;
  }

  /* ---- the result screen ----
     One view: who won and by how much, the character that won it, and the
     three ways out. The character art is the finished piece with its baked-in
     headline, badge and caption erased — every one of those is a line this
     screen renders itself, because the round number and the figure change
     every match and a picture cannot. What is left on the art is the scene
     and the BULL MODE / BEAR MODE wordmark, which nothing here repeats. */

  /* Each finished piece, whole and as delivered: the headline, the tagline,
     the FINAL PRINT label and the caption are all in the pixels, and the app
     renders none of them. What it adds is the round line above, and — on a
     win — the figure and the meter, dropped into the hole the art leaves under
     its own FINAL PRINT label. `slot` is that hole as percentages of the art,
     measured off the delivered files; the draw piece paints its own meter at
     0, so it has no slot and takes no overlay. `w`/`h` are the files' own
     proportions, which is how the slot stays on the art at any size. */
  const PW_OVER_ART = {
    bull: { file: "bull-wins", w: 900, h: 1011, slot: { l: 75.5, t: 30.0, w: 24.5, h: 49.5 } },
    bear: { file: "bear-wins", w: 900, h: 1049, slot: { l: 75.5, t: 29.5, w: 24.5, h: 48.5 } },
    draw: { file: "draw",      w: 900, h: 596,  slot: null },
  };

  /* a laurel branch, one side; mirrored for the other with a transform */
  const PW_LAUREL = `
    <svg viewBox="0 0 28 90" aria-hidden="true">
      <path d="M22 4 C6 26 6 64 22 86" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
      ${[12, 26, 40, 54, 68].map((y) => `
        <ellipse cx="11" cy="${y}" rx="3.2" ry="7" transform="rotate(-38 11 ${y})" fill="currentColor"/>
        <ellipse cx="20" cy="${y + 7}" rx="3.2" ry="7" transform="rotate(38 20 ${y + 7})" fill="currentColor"/>`).join("")}
    </svg>`;

  function pwOverHTML() {
    const tone = pw.winner;                       // bull | bear | draw
    const art = PW_OVER_ART[tone];
    const slot = art.slot;
    const overlay = slot ? `
          <div class="pw-over-slot"
               style="left:${slot.l}%;top:${slot.t}%;width:${slot.w}%;height:${slot.h}%">
            <span class="pw-laurel l">${PW_LAUREL}</span>
            <span class="pw-laurel r">${PW_LAUREL}</span>
            ${pwTrackHTML()}
          </div>` : "";
    return `
      <div class="pw-over ${tone}">
        <div class="pw-over-kicker">Round ${pw.round} · Final Print</div>

        ${pw.showMatch ? pwMatchChartHTML() : `
        <div class="pw-over-stage">
          <div class="pw-over-art" style="--ar:${art.w} / ${art.h}">
            <img src="${PW_RESULT_ART}${art.file}.png" alt="" draggable="false">
            ${overlay}
          </div>
        </div>`}

        <button type="button" class="pw-over-again" data-pw-again>
          Play Again <span aria-hidden="true">›</span>
        </button>
        <div class="pw-over-row">
          <button type="button" class="pw-over-pill${pw.showMatch ? " on" : ""}" data-pw-match
                  aria-pressed="${pw.showMatch}">
            <img src="assets/nav-icons/icon-dock-match-replay@2x.png" alt="">
            <span>${pw.showMatch ? "Hide Match" : "View Match"}</span>
          </button>
          <button type="button" class="pw-over-pill" data-pw-home>
            <img src="assets/nav-icons/icon-home@2x.png" alt="">
            <span>Back to Home</span>
          </button>
        </div>
        <div class="pw-over-foot">Same game. A brighter tomorrow.</div>
      </div>`;
  }

  /* ---- the match, as a chart ----
     Every round is one candle: it opens where the print stood when the round
     began and closes where it stood when the round ended, so a round won is a
     body in that side's colour and a wash is a doji. Drawn as plain elements
     rather than SVG — a body and a wick each, positioned as percentages of the
     same -25..+25 scale the track uses, so the chart and the meter agree.

     Under it, one chip per round in the same order and the same colour, and
     both are the same control: tapping either the candle or its chip opens
     that round's reveal, and tapping it again closes it. They line up because
     they are two flex rows inside one scroller with the same per-column basis
     — column n of the chart is column n of the row, at every round count. */

  /* what a round's colour says: a wild on the table is the thing that happened
     that round, whichever way the print then moved */
  function pwRoundTone(r) {
    if (r.you.side === "special" || r.opp.side === "special") return "wild";
    return r.close === r.open ? "flat" : r.close > r.open ? "bull" : "bear";
  }

  /* Takes the rounds rather than reading them: the live result screen hands it
     the match just played, the hub hands it one off the record, and neither
     knows the other exists. */
  function pwMatchChartHTML(chart, opts) {
    const o = opts || {};
    const rows = chart || pw.chart;
    if (!rows.length) {
      return `<div class="pw-chart-empty">${esc(o.empty || "No rounds to replay.")}</div>`;
    }
    const span = pwTarget() * 2;                 // the finish line, either side
    const pct = (v) => ((pwTarget() - v) / span) * 100;   // 0% is the top
    const open = pw.showRound;

    const bars = rows.map((r) => {
      const hi = Math.max(r.open, r.close), lo = Math.min(r.open, r.close);
      const top = pct(hi), bot = pct(lo);
      /* a doji still needs to be visible, so it keeps a hairline body */
      const h = Math.max(bot - top, 0.9);
      const tone = r.close === r.open ? "flat" : r.close > r.open ? "bull" : "bear";
      return `<button type="button" class="pw-cndl ${tone}${open === r.round ? " on" : ""}"
                      style="--t:${top.toFixed(2)}%;--h:${h.toFixed(2)}%"
                      data-pw-round="${r.round}" aria-pressed="${open === r.round}"
                      aria-label="Round ${r.round}, ${pwSigned(r.open)} to ${pwSigned(r.close)}"
                      title="Round ${r.round}: ${pwSigned(r.open)} → ${pwSigned(r.close)}"></button>`;
    }).join("");

    /* Past twenty rounds a column is too narrow to carry its own number, so
       the numbers thin to every fifth (plus the first and the last, which are
       the two anyone looks for). The chip itself stays: it is the tap target
       and it still carries the round's colour. */
    const dense = rows.length <= 20;
    const chips = rows.map((r, i) => {
      const tone = pwRoundTone(r);
      const label = dense || r.round % 5 === 0 || i === 0 || i === rows.length - 1;
      return `<button type="button" class="pw-chip ${tone}${open === r.round ? " on" : ""}"
                      data-pw-round="${r.round}" aria-pressed="${open === r.round}"
                      aria-label="Round ${r.round} cards">
        <span class="pw-chip-face">${tone === "wild"
          ? `<i class="pw-chip-wild"></i>`
          : `<i class="pw-chip-candle"></i>`}</span>
        <span class="pw-chip-n">${label ? r.round : ""}</span>
      </button>`;
    }).join("");

    const sel = open != null ? rows.find((r) => r.round === open) : null;
    /* what the chart on screen is drawn from, for the scrubber below: only one
       is ever on screen, and it needs the rounds without knowing which screen
       handed them over */
    pwChartShown = rows;
    return `
      <div class="pw-chart">
        <div class="pw-chart-head">
          <span>${esc(o.title || "Match Replay")}</span>
          <span class="pw-chart-n">${rows.length} round${rows.length === 1 ? "" : "s"}</span>
        </div>
        ${/* the axis and the row's caption stay put; only the columns scroll,
              and they scroll as one so a candle never drifts off its chip */""}
        <div class="pw-chart-body">
          <div class="pw-chart-axis">
            <div class="pw-chart-ends">
              <span>+${pwTarget()}</span><span>OPEN</span><span>−${pwTarget()}</span>
            </div>
            <div class="pw-chart-rowcap">Cards<br>Played</div>
          </div>
          <div class="pw-chart-track" style="--pw-cols:${rows.length}">
            <div class="pw-chart-plot"><div class="pw-chart-bars">${bars}</div></div>
            <div class="pw-chip-row${dense ? "" : " sparse"}">${chips}</div>
          </div>
        </div>
        ${sel ? pwRevealHTML(sel) : ""}
      </div>`;
  }

  /* ==================== scrubbing the replay ====================
     Tapping a candle opens its round, and that has not changed. Holding and
     dragging now moves the selection with the finger: the nearest candle to
     wherever the finger is wins, the reveal underneath follows it live, and
     letting go leaves the last one open.

     Two things make it feel like scrubbing rather than like a list of taps.

     The first is that a move repaints two things and not the screen: the
     class on the candle and its chip, and the reveal panel's innerHTML. A
     renderPointaeway() per candle would rebuild the chart under the finger
     thirty times a second, and the chart is the one thing that must not move
     while it is being read.

     The second is that the drag is not allowed to be anything else. The plot
     takes the pointer with setPointerCapture, so the gesture stays ours after
     it leaves the box, and the chart area is touch-action: none, so the panel
     underneath does not scroll and the page does not swipe while a finger is
     travelling across it. */
  let pwChartShown = [];
  let pwScrub = null;
  let pwScrubbedAt = 0;

  const pwScrubCandles = () =>
    Array.prototype.slice.call(document.querySelectorAll(".pw-chart-bars .pw-cndl"));

  /* the nearest candle to an x, which is also the whole of the edge rule:
     past either end the nearest one is the end one */
  function pwScrubRoundAt(x) {
    let best = null, bestD = Infinity;
    pwScrubCandles().forEach((el) => {
      const r = el.getBoundingClientRect();
      const d = x < r.left ? r.left - x : x > r.right ? x - r.right : 0;
      if (d < bestD) { bestD = d; best = el; }
    });
    return best ? Number(best.getAttribute("data-pw-round")) : null;
  }

  /* select a round without redrawing the screen. Returns whether it moved,
     which is what the haptic tick is for. */
  function pwScrubSelect(n) {
    if (n == null || pw.showRound === n) return false;
    pw.showRound = n;
    document.querySelectorAll("[data-pw-round]").forEach((el) => {
      const on = Number(el.getAttribute("data-pw-round")) === n;
      el.classList.toggle("on", on);
      el.setAttribute("aria-pressed", String(on));
    });
    const chart = document.querySelector(".pw-chart");
    const row = pwChartShown.find((r) => r.round === n);
    if (chart && row) {
      const old = chart.querySelector(".pw-reveal");
      if (old) old.outerHTML = pwRevealHTML(row);
      else chart.insertAdjacentHTML("beforeend", pwRevealHTML(row));
      /* the one layout class the reveal owns, kept in step so a scrub ends in
         the same state a tap would have left behind */
      cardScroll.classList.add("pw-revealing");
    }
    return true;
  }

  function pwScrubDown(e) {
    const host = e.target.closest && e.target.closest(".pw-chart-plot, .pw-chip-row");
    if (!host || !pwScrubCandles().length) return;
    /* No selection and no capture yet: an unmoved press is still a tap, and a
       tap on the open round still closes it. Capture retargets the click that
       follows to whatever took the pointer, so taking it here would mean the
       click never names the candle it landed on. */
    pwScrub = { id: e.pointerId, moved: false, host };
  }
  function pwScrubMove(e) {
    if (!pwScrub || e.pointerId !== pwScrub.id) return;
    const n = pwScrubRoundAt(e.clientX);
    if (n == null) return;
    /* now it is a drag, so the gesture is ours until it ends — including the
       part of it that happens outside the plot */
    if (!pwScrub.moved) {
      try { pwScrub.host.setPointerCapture(e.pointerId); } catch (err) {}
    }
    pwScrub.moved = true;
    if (e.cancelable) e.preventDefault();
    if (pwScrubSelect(n) && navigator.vibrate) { try { navigator.vibrate(5); } catch (err) {} }
  }
  function pwScrubUp(e) {
    if (!pwScrub || e.pointerId !== pwScrub.id) return;
    const was = pwScrub;
    pwScrub = null;
    try { was.host.releasePointerCapture(e.pointerId); } catch (err) {}
    /* a drag ends with the last candle open, so the click that follows it
       must not toggle that same round shut again */
    if (was.moved) pwScrubbedAt = Date.now();
  }

  /* ---- the live chart module ----
     The same component the finished match is read back on, opened over the
     board while the match is still being played: one more candle appears each
     time a round resolves, and tapping one opens that round the way the
     replay does. It is a panel above the counts row, and the button that
     opens it sits in that row beside Seen.

     It is the replay chart and not a second chart drawn for this screen — so
     it takes the rounds the same way, and everything about how a candle and a
     chip are drawn is decided in one place.

     ==> the online board hands it rounds built from the room's candles, which
     print around 100 rather than on the −25..+25 track; pwOnlineChartRows
     moves them onto it. */
  const PW_CHART_SVG =
    `<svg viewBox="0 0 22 16" fill="none" aria-hidden="true" class="pw-chart-ico">
       <path d="M4 3.5v9M4 5.5h0" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
       <rect x="2.4" y="5.5" width="3.2" height="5" rx="1" fill="currentColor"/>
       <path d="M11 1.5v13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
       <rect x="9.4" y="4" width="3.2" height="7" rx="1" fill="currentColor" opacity=".55"/>
       <path d="M18 4v9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
       <rect x="16.4" y="6.5" width="3.2" height="4.5" rx="1" fill="currentColor"/>
     </svg>`;

  /* the button that opens and closes it, for whichever board is asking */
  function pwChartToggleHTML(on, attr) {
    return `<button type="button" class="pw-count-btn pw-chart-btn${on ? " on" : ""}"
              ${attr} aria-pressed="${!!on}"
              aria-label="${on ? "Hide the live chart" : "Show the live chart"}">
      ${PW_CHART_SVG}
    </button>`;
  }

  function pwLiveChartHTML(rows) {
    return `<div class="pw-live">${pwMatchChartHTML(rows, {
      title: "Live Print",
      empty: "The print appears here as rounds resolve.",
    })}</div>`;
  }

  /* ---- the panel it lives in ----
     Its own container in the app's column, between the bars and the content
     card, wearing the same 9-slice frame the card does. It is not a row of
     the board: the board's panel starts fresh below it and is exactly what it
     was before this feature existed.

     Which match it is drawing — local or online — is decided here rather than
     by either board, so both toggles drive one panel. */
  function pwChartRows() {
    if (state.view !== "pointaeway" || !pw) return null;
    const o = pw.online;
    if (pw.phase === "online") {
      if (!o || !o.showChart || !o.room || o.room.status !== "active" || o.timedOut) return null;
      return pwOnlineChartRows(pwOnlineBoard(o.room, o.me.uid));
    }
    if (pw.phase === "selecting" || pw.phase === "draw-choice"
        || pw.phase === "discipline-pick" || pw.phase === "takeprofit-choice") {
      return pw.showChart ? (pw.chart || []) : null;
    }
    return null;
  }

  function syncChartPanel() {
    const outer = $("chartOuter");
    const panel = $("chartPanel");
    const app = document.querySelector(".app");
    if (!outer || !panel || !app) return;
    const rows = pwChartRows();
    if (!rows) {
      if (!outer.hidden) { outer.hidden = true; panel.innerHTML = ""; }
      app.classList.remove("chart-open");
      return;
    }
    /* the panel stands where the video header and the two title pills stand,
       so they step aside for exactly as long as it is up. Its height is their
       height, in CSS, which is why the card below never moves. */
    app.classList.add("chart-open");
    outer.hidden = false;
    panel.innerHTML = pwLiveChartHTML(rows);
  }

  /* the room's candles as chart rounds. They open and close around 100, so
     both are moved onto the −25..+25 track the component draws, and clamped
     to it — the module's win condition is five round wins, so a print can run
     past the end of the track while the match goes on. */
  function pwOnlineChartRows(board) {
    if (!board) return [];
    return (board.candles || []).map((c) => ({
      round: c.round,
      open: pwClamp(Math.round(Number(c.open) - 100)),
      close: pwClamp(Math.round(Number(c.close) - 100)),
      you: pwOnlineCard(board.me.side,
        Number((c.cards && c.cards[board.me.uid] || {}).power) || 0),
      opp: pwOnlineCard(board.opp.side,
        Number((c.cards && c.cards[board.oppUid] || {}).power) || 0),
    }));
  }

  /* ---- one round, opened up ----
     The pair that made that round's print, in the same order and the same
     component the table itself uses — the seats on the match screen are YOU on
     the left and OPP on the right, and this keeps that so the replay reads as
     the round being played again rather than as a different object. */
  function pwRevealHTML(r) {
    const delta = r.close - r.open;
    const tone = delta === 0 ? "flat" : delta > 0 ? "bull" : "bear";
    /* the tags sit BESIDE the cards, not above them: this panel has to share a
       phone screen with the chart it belongs to, and a line of its own for
       YOU and OPP is a line the chart loses */
    const side = (card) => `
      <div class="pw-reveal-side">
        <div class="pw-reveal-card">${pwCardHTML(card, { small: true })}</div>
        <span class="pw-reveal-name">${esc(card.type)}</span>
      </div>`;
    return `
      <div class="pw-reveal">
        <div class="pw-reveal-head">
          <span class="pw-reveal-title">Round ${r.round} Reveal</span>
          ${/* item 5 asks for the round's net print; the mockup does not show
                it, so it rides here as a small chip rather than a line */""}
          <span class="pw-reveal-delta ${tone}">${pwSigned(delta)}</span>
          <button type="button" class="pw-reveal-x" data-pw-round-close
                  aria-label="Close the reveal">×</button>
        </div>
        <div class="pw-reveal-row">
          <span class="pw-reveal-tag you">You</span>
          ${side(r.you)}
          <span class="pw-reveal-vs" aria-hidden="true">VS</span>
          ${side(r.opp)}
          <span class="pw-reveal-tag opp">Opp</span>
        </div>
        <div class="pw-reveal-cap">These cards created this print</div>
      </div>`;
  }

  /* What the seat says when the card in the slot is not the card that was
     played. The slot shows what is fighting — that is the whole point of both
     cards — so the one that stepped aside says so underneath, in the line the
     seat's caption would otherwise have used. Over the card it sat on the
     face's own name plate, which is the one place on a card that cannot be
     covered. */
  /* What stands in the slot. Normally the card; after a YOLO, the two cards it
     flipped, fanned, with the total they add up to — because the total is the
     thing that fights and neither card alone explains it. */
  function pwSlotCardHTML(card, note) {
    const flips = (note && note.kind === "yolo" && note.flips) || (card && card.yolo);
    if (!flips || flips.length < 2) return pwCardHTML(card, {});
    return `<span class="pw-yolo-fan">
      ${flips.map((c, i) => `<span class="pw-yolo-card i${i}">${pwCardHTML(c, {})}</span>`).join("")}
      <span class="pw-yolo-total ${esc(card.side)}">= ${card.pts}</span>
    </span>`;
  }

  function pwSubBadgeHTML(note) {
    if (!note) return "";
    /* a YOLO says the sum it drew rather than the name of the total, which is
       its own name again and tells nobody anything */
    const line = note.kind === "yolo"
      ? `${(note.flips || []).map((c) => c.pts).join(" + ")} = ${note.to.pts}`
      : `copying ${note.to.type}`;
    return `<span class="pw-sub-badge ${note.kind}">
      <b>${esc(note.from.type)}</b>
      <i>${esc(line)}</i>
    </span>`;
  }

  function pwTrackHTML() {
    const c = pw.candle;
    const pct = Math.min(1, Math.abs(c) / pwTarget());
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
          <div class="pw-track-end top">+${pwTarget()}</div>
          <div class="pw-track">
            <div class="pw-track-mid">OPEN</div>
            <div class="pw-track-fill ${tone} ${c >= 0 ? "up" : "down"}" style="${style}"></div>
          </div>
          <div class="pw-track-end bot">−${pwTarget()}</div>
        </div>
      </div>`;
  }


  /* ---- the match screen's own pieces ----
     There is no card back in the art set, so it is built here rather than
     drawn: the app's own plate, the side's animal behind it, the wordmark
     across it. Same for the flanks and the empty slot's watermark, all three
     cut from the card illustrations so nothing on this screen is in a
     different hand from the deck. */
  /* The card back is finished artwork now — frame, character and ground all
     in the picture — so nothing is drawn around it or over it. Each side has
     its own, and a seat shows the back of whoever sits in it. */
  const pwBackFile = (side) =>
    `assets/pointaeway/back-${side === "bear" ? "bear" : "bull"}.webp`;
  function pwBackHTML(side) {
    const sd = side === "bear" ? "bear" : "bull";
    /* WebP, and padded to the same 2:3 as the faces: these two were 400KB
       each as PNGs, on a screen that shows both of them at once. */
    return `<img class="pw-back ${sd}" src="${pwBackFile(sd)}"
                 alt="" draggable="false" decoding="async">`;
  }

  /* The meter, upright: +25 at the top, −25 at the bottom, the print in the
     middle. It used to carry a written target either side; the two played
     cards stand there now, which says the same thing and says it about this
     round rather than about the rules. */
  function pwPrintHTML(value) {
    /* the online board reads its print off the room rather than off the local
       game, so the meter takes a number; with none it is the local one */
    const c = value == null ? pw.candle : value;
    const pct = Math.min(1, Math.abs(c) / pwTarget());
    const tone = c === 0 ? "flat" : c > 0 ? "bull" : "bear";
    return `<div class="pw-print">
      <div class="pw-print-gauge">
        <div class="pw-print-fill ${tone} ${c >= 0 ? "up" : "down"}"
             style="--pw-fill:${(pct * 50).toFixed(2)}%"></div>
        ${/* the two ends ride inside the gauge rather than above and below it:
              stacked outside they cost thirty-odd pixels, and this screen has
              none to spend */""}
        <span class="pw-print-end top">+${pwTarget()}</span>
        <span class="pw-print-end bot">−${pwTarget()}</span>
        <div class="pw-print-read">
          <span class="pw-print-val ${tone}" data-pw-candle="${c}">${c > 0 ? "+" : ""}${c}</span>
          <span class="pw-print-cap">The Print</span>
        </div>
      </div>
    </div>`;
  }

  /* One row where there used to be three: your card, the meter, theirs.
     The left seat is also the drop target — the card you are dragging is
     going to the place it will sit, which is the whole reason the separate
     "your turn" slot below the meter could go. */
  function pwArenaHTML(canPlay, peeking) {
    const aiDeck = pwOwnDeck(pw.aiSide).length;
    const youHint = pw.playerPlayed ? "On the table"
      : peeking ? "Answer with a number"
      : canPlay ? "Drag or tap a card" : "…";
    return `<div class="pw-arena">
      <div class="pw-seat you">
        <span class="pw-seat-tag you">You</span>
        <div class="pw-seat-slot${pw.playerPlayed ? " filled" : ""}${
          pw.sub && pw.sub.player ? " sub" : ""}" data-pw-drop>
          ${pw.playerPlayed
            ? pwSlotCardHTML(pw.playerPlayed, pw.sub && pw.sub.player)
            : pwBackHTML(pw.playerSide)}
        </div>
        ${pw.sub && pw.sub.player
          ? pwSubBadgeHTML(pw.sub.player)
          : `<span class="pw-seat-cap">${esc(youHint)}</span>`}
      </div>
      ${pwPrintHTML()}
      <div class="pw-seat opp">
        <span class="pw-seat-tag opp">Opp</span>
        <div class="pw-seat-slot${pw.aiPlayed ? " filled" : ""}${
          pw.sub && pw.sub.ai ? " sub" : ""}">
          ${pw.aiPlayed
            ? pwSlotCardHTML(pw.aiPlayed, pw.sub && pw.sub.ai)
            : pwBackHTML(pw.aiSide)}
        </div>
        ${pw.sub && pw.sub.ai
          ? pwSubBadgeHTML(pw.sub.ai)
          : `<span class="pw-seat-cap">${pw.aiPlayed
              ? `${esc(pw.aiSide)} · ${aiDeck} left` : "Awaiting play…"}</span>`}
      </div>
    </div>`;
  }

  /* The wilds and what each does, in one list. It expands in place under
     the button — nothing in this app opens over a dimmed screen. */
  /* The reference sheet, cut to the match. A match can now be dealt one or
     two wilds of each colour instead of all of them, and a sheet listing ten
     cards nine of which cannot appear is worse than no sheet — so when the
     match knows which it drew, those are the ones it shows. Outside a match
     the sheet is the full reference it has always been. */
  function pwSpecialsSheetHTML() {
    const only = pw && pw.specialTypes;
    const list = only ? PW_SPECIALS_SHOWN.filter((s) => only.indexOf(s.type) >= 0)
                      : PW_SPECIALS_SHOWN;
    return `<div class="pw-sheet" id="pwSheet">
      <div class="pw-sheet-cap">
        <span>Special cards${only && only.length !== PW_SPECIALS.length
          ? ` · ${list.length} in this match` : ""}</span>
        <button type="button" class="pw-sheet-x" data-pw-specials aria-label="Close">Close</button>
      </div>
      <div class="pw-sheet-rows">
        ${list.length ? list.map((s) => {
          const art = PW_SPECIAL_ART[s.type];
          return `<div class="pw-sheet-row">
            ${art ? `<img class="pw-sheet-art" src="${PW_ART}${art}.png" alt="" draggable="false">` : ""}
            <div class="pw-sheet-text">
              <span class="pw-sheet-name">${esc(s.type)}</span>
              <span class="pw-sheet-desc">${esc(s.desc)}</span>
            </div>
          </div>`;
        }).join("")
        : `<div class="pw-sheet-none">No special cards in this match.</div>`}
      </div>
    </div>`;
  }

  /* ---- the way in ----
     The four things worth knowing before a first match. Three of the icons
     came with the art; the fourth did not — the file named for it holds the
     wordmark instead — so the stacked deck is drawn here in the same weight
     and colour as its neighbours rather than left out.

     The deck's count is the deck's own: five copies of each of five candles a
     side is fifty, and the wild pile is ten. */
  const PW_DECK_SVG =
    `<svg class="pw-feat-svg" viewBox="0 0 34 34" fill="none" aria-hidden="true">
       <rect x="4.5" y="8.5" width="17" height="22" rx="3.2" stroke="currentColor"
             stroke-width="2.1" opacity=".55"/>
       <rect x="11.5" y="4.5" width="17" height="22" rx="3.2" stroke="currentColor"
             stroke-width="2.1"/>
     </svg>`;
  const PW_INTRO = "assets/pointaeway/intro/";
  /* read off the match rather than typed in: the deck is 12 candles times
     however many copies this match deals, the wild pile is however many
     specials exist, and the finish line is whatever the host picked */
  const pwFeats = () => [
    { art: null,       title: "Build Your Deck",
      sub: `${12 * pwCopies()} Candle Cards · ${PW_SPECIALS.length} Effect Cards` },
    { art: "ico-wild", title: "Play Wild Cards",     sub: "Turn the tide with strategy" },
    { art: "ico-25",   title: `First to ${pwTarget()} Wins`, sub: "Every card makes a move" },
    { art: "ico-learn",title: "Learn While You Play",sub: "Master candles through action" },
  ];

  function pwIntroHTML() {
    return `
      <div class="pw-intro">
        ${/* The way back to the record. Start Match used to be a one-way door:
              once a player was here the hub was gone until a match had been
              played and finished. It is the same arrow the hub itself uses to
              leave, in the same corner, so the pre-match flow reads as a
              stack that can be walked back rather than a chute. */""}
        <div class="pw-intro-head">
          <button type="button" class="pw-hub-back" data-pw-setup-back
                  aria-label="Back to Match Hub">
            <img src="assets/nav-icons/icon-arrow-back@2x.png" alt="">
          </button>
          <img class="pw-wordmark" src="${PW_INTRO}wordmark.png" alt="Pointæway">
        </div>
        <img class="pw-subtitle" src="${PW_INTRO}subtitle.png" alt="Candle card battle">
        <p class="pw-tagline">Draw, choose, reveal. Every round the candle moves —
          first side to push it ${pwTarget()} points their way wins the day.</p>

        <div class="pw-rule"><span>Pick your side</span></div>

        ${/* each card is one finished picture — art, name, target and its own
              button are all in it, so the picture is the button */""}
        <div class="pw-picks">
          <button type="button" class="pw-pick" data-pw-side="bull">
            <img src="${PW_INTRO}card-bull.png" alt="Trade as Bull — push up to +${pwTarget()}">
          </button>
          <button type="button" class="pw-pick" data-pw-side="bear">
            <img src="${PW_INTRO}card-bear.png" alt="Trade as Bear — push down to −${pwTarget()}">
          </button>
        </div>

        <div class="pw-feats">
          ${pwFeats().map((f) => `<div class="pw-feat">
            <span class="pw-feat-ico">${f.art
              ? `<img src="${PW_INTRO}${f.art}.png" alt="">` : PW_DECK_SVG}</span>
            <b class="pw-feat-title">${esc(f.title)}</b>
            <span class="pw-feat-sub">${esc(f.sub)}</span>
          </div>`).join("")}
        </div>

        ${/* the app's own pill, not a one-off: this is the same control the
              rest of Æway uses, with the set's dice on it */""}
        <button type="button" class="g-pill pw-random-btn" data-pw-random>
          <img src="${PW_INTRO}ico-dice.png" alt="">
          <span>Pick My Side for Me</span>
        </button>

        ${/* Built live rather than dropped in as the finished pill. The pill
              that came with the art has "How Wild Cards Work" baked into it,
              which is neither what this control says nor what it now does —
              it opens the whole library, wilds and candles both — and a
              picture of one label cannot say another. The circled i is the
              only part of that pill worth keeping, so it rides here on its
              own next to live text. */""}
        <button type="button" class="pw-wilds-btn" data-pw-library>
          <img src="${PW_INTRO}ico-info.png" alt="">
          <span>View All Cards</span>
        </button>
      </div>`;
  }

  /* ---- the card library ----
     A screen, not a list that unrolls under the picker: the player leaves the
     side they were choosing, browses, and comes back to it untouched. Which is
     why the picker's state is not rebuilt on the way back — nothing about it
     was thrown away.

     The three tiles came with their own buttons baked in ("I'M BULL", "I'M
     BEAR", "SPECIAL EFFECT") from their first life as side-select cards, and
     on this screen those words are wrong: nobody is picking a side here. The
     art is used whole and unaltered anyway — re-lettering it needs new art,
     not a crop — and the live caption under each tile carries the real label,
     which is also the button's accessible name. */
  const PW_LIB = "assets/pointaeway/library/";
  /* the counts are the running match's, since a 10-point match holds two of
     each candle rather than five — outside a match they read as the default */
  const pwLibSets = () => {
    const wilds = (pw && pw.specialTypes) || PW_SPECIALS.map((s) => s.type);
    /* The tab says what the tab holds. How many of each are dealt is the
       match's business, not the Library's — it is 30 only at 25 points, and
       a tab that says so while a 15-point match is being set up is wrong. */
    return [
      { k: "bull",    name: "Bull Cards",    sub: "6 candles" },
      { k: "bear",    name: "Bear Cards",    sub: "6 candles" },
      { k: "special", name: "Special Cards", sub: `${wilds.length} effect${wilds.length === 1 ? "" : "s"} · 1 each` },
    ];
  };

  /* ---- what a tab holds ----
     Built from PW_TIERS_BY_SIDE and PW_SPECIALS every time it is asked for,
     never copied: the Library says what the game says because it is reading
     the same two tables the decks are built from. Change a card's text in one
     place and the Library changes with it. */
  function pwLibCards(set) {
    if (set === "special") {
      /* in the order the grid lays them out: down each colour's column */
      return PW_SPECIALS_SHOWN.map((sp) => ({
        key: `special:${sp.type}`,
        card: Object.assign({}, sp, { id: `lib-${sp.type}`, side: "special", kind: "special" }),
        name: sp.type,
        meta: "Special",
        text: sp.desc,
      }));
    }
    const sd = set === "bear" ? "bear" : "bull";
    return pwTiers(sd).map((t) => ({
      key: `${sd}:${t.type}`,
      card: { id: `lib-${t.type}`, side: sd, kind: "tier", type: t.type, pts: t.pts },
      name: t.type,
      meta: `Power ${t.pts}`,
      text: (t.pts === 0
        ? "Moves the print nowhere."
        : `Moves the print ${t.pts} ${sd === "bull" ? "up" : "down"}, ${sd === "bull" ? "+" : "−"}${t.pts} your way.`)
        + ` ${pwCopies()} in a deck.`,
    }));
  }

  /* ==================== How to Play ====================
     Eight pages, one rule each, one viewport each. Built as a screen rather
     than as the delivered poster: the poster is 1024x1536 of small type, and
     on a phone it is either a scroll or a pinch, and this app does neither.
     Its content is the source; its layout is not.

     The poster also numbers its own sections twice — "2. 1. LOCK IN",
     "3. 2. REVEAL" — which is a bug in the artwork. These are numbered once.

     Card art comes from the game's own tables, so the pictures a player is
     taught with are the pictures they will be dealt. */
  const pwTierCard = (side, pts) => {
    const t = pwTiers(side).find((x) => x.pts === pts);
    return { id: `ht-${side}-${pts}`, side, kind: "tier", type: t.type, pts: t.pts };
  };
  const pwSpecCard = (type) =>
    Object.assign({}, PW_SPEC[type], { id: `ht-${type}`, side: "special", kind: "special" });
  /* ---- the one way a card is drawn off the table ----
     .pw-cardfit is the rule (see the comment on it in style.css): the face
     keeps its 2:3 shape and takes the smaller of the room it is given across
     and down. Everything outside gameplay goes through here — How to Play,
     the Library's grid, the open card — so there is one place to change if
     the shape of a card ever changes. */
  const pwFitHTML = (card, opts) =>
    `<span class="pw-cardfit">${pwCardHTML(card, opts || {})}</span>`;

  /* ---- the faces, before the screen that needs them ----
     loading="lazy" was wrong here and it cost a card: inside a pager, the
     page being drawn is new DOM, and an engine is entitled to decide a lazy
     image in it is not needed yet — which is how page 4 appeared with one
     card on it. The pager and the Library's open tab load eagerly now, and
     the whole set is fetched and decoded the moment either screen is opened,
     so a card is never the thing being waited for. It is twenty-six small
     WebPs, about a megabyte, and the service worker keeps them.

     Also started once, quietly, a few seconds after the hub settles: by the
     time anybody taps How to Play it is already done. */
  const pwArtDone = Object.create(null);
  function pwPreloadArt() {
    const urls = [];
    ["bull", "bear"].forEach((sd) => {
      pwTiers(sd).forEach((t) => urls.push(pwArtFile({ side: sd, kind: "tier", type: t.type })));
      urls.push(pwBackFile(sd));
    });
    PW_SPECIALS.forEach((s) => urls.push(pwArtFile({ side: "special", type: s.type })));
    urls.filter(Boolean).forEach((u) => {
      if (pwArtDone[u]) return;
      pwArtDone[u] = true;
      const img = new Image();
      img.decoding = "async";
      img.src = u;
      /* decode as well as fetch: a fetched-but-undecoded picture still has a
         frame to wait for, and that frame is the one the card is missing in */
      if (img.decode) img.decode().catch(() => {});
    });
  }
  /* and the frame comes off the moment the picture is there. load does not
     bubble, so this listens on the way down, once, for every card drawn
     anywhere in the app. */
  document.addEventListener("load", (e) => {
    const el = e.target;
    if (el && el.classList && (el.classList.contains("pw-card-art") || el.classList.contains("pw-back"))) {
      el.classList.add("ready");
    }
  }, true);

  /* ---- the two pills on the hub ----
     Start Match and Create Match are nine-slices: border-style: solid plus a
     border-image. A border-image that does not load leaves the border to be
     drawn solid in the inherited colour, which here is the text's near-white
     — a 43px white frame round a dark label, which is what Create Match
     turned into on the phone. Nothing in CSS can ask whether a border-image
     arrived, so this asks for the two files itself: if either refuses, the
     stylesheet's painted version takes over, and asking also warms the cache
     the stylesheet is about to read. */
  /* The measurement behind pwHistRows, on the hub it has just drawn.
     Deferred a frame, and taken again a moment later: --vhpx is measured at
     boot and again as the standalone view settles, so the first layout a
     freshly opened hub gets is not always the one it keeps. Both passes are
     no-ops when the answer has not changed. */
  function pwMeasureHistRows() {
    if (!pw || pw.phase !== "hub" || pw.hubAll) return;
    const list = cardScroll.querySelector(".pw-hist-list");
    const row = list && list.querySelector(".pw-hrow");
    if (!row) return;
    const gap = 4;                                   // .pw-hist-list's own gap
    const rh = row.getBoundingClientRect().height + gap;
    if (rh <= gap) return;
    /* rounded rather than floored: the box is a fixed height whatever goes
       in it, so stopping a row short of filling it leaves exactly the empty
       strip this is here to remove. Half a row over, the list scrolls by a
       few pixels, which it is already built to do. */
    const fits = Math.max(1, Math.round((list.clientHeight + gap) / rh));
    if (fits !== pwHistRows) { pwHistRows = fits; renderPointaeway(); }
  }
  function pwFitHistRows() {
    requestAnimationFrame(pwMeasureHistRows);
    setTimeout(pwMeasureHistRows, 400);
    /* and once more after the last of --vhpx's settling ticks at 1000ms: that
       one changes the height of the box without firing a resize, so a count
       taken before it is a count of a box that no longer exists */
    setTimeout(pwMeasureHistRows, 1200);
  }
  window.addEventListener("resize", () => {
    if (!pw || pw.phase !== "hub") return;
    if (pw.perf.on) pwPerfLayout();
    else pwFitHistRows();
  });

  function pwGuardPillArt() {
    ["pill-start", "pill-find"].forEach((n) => {
      const img = new Image();
      img.onerror = () => document.documentElement.classList.add("no-pill-art");
      img.src = `assets/pointaeway/hub/${n}.png`;
    });
  }

  let pwArtIdle = false;
  function pwPreloadArtSoon() {
    if (pwArtIdle) return;
    pwArtIdle = true;
    const go = () => pwPreloadArt();
    if (window.requestIdleCallback) requestIdleCallback(go, { timeout: 6000 });
    else setTimeout(go, 3000);
  }

  function pwHowToPages() {
    const t = pwTarget();
    return [
      { title: "The Goal", body: `
        <div class="pw-ht-goal">
          <div class="pw-ht-arrow bull"><b>+${t}</b><span>BULL</span></div>
          <div class="pw-ht-print"><i>0</i><span>THE PRINT</span></div>
          <div class="pw-ht-arrow bear"><b>−${t}</b><span>BEAR</span></div>
        </div>`,
        text: `The Print starts at 0. Bull pushes it up, Bear pushes it down. The first side to reach the match target wins: +${t} for Bull or −${t} for Bear. Shorter matches can use 10, 15 or 20.` },

      { title: "Lock In", body: `
        <div class="pw-ht-cards two">
          <span class="pw-cardfit">${pwBackHTML("bull")}</span>
          <span class="pw-cardfit">${pwBackHTML("bear")}</span>
        </div>
        <div class="pw-ht-cap pw-ht-tags"><span class="bull">BULL</span><span class="bear">BEAR</span></div>`,
        text: "Both players pick one card from their hand and lock it in face-down." },

      { title: "Reveal", body: `
        <div class="pw-ht-cards two">
          ${pwFitHTML(pwTierCard("bull", 4))}
          ${pwFitHTML(pwTierCard("bear", 2))}
        </div>
        ${/* the caption slot every pair page carries, empty here: it is what
              keeps the cards the same size on a page with a line under them
              and a page without one */""}
        <div class="pw-ht-cap"></div>`,
        text: "Both cards are revealed at the same time." },

      { title: "Win the Round", body: `
        <div class="pw-ht-cards two win">
          ${pwFitHTML(pwTierCard("bull", 5))}
          ${pwFitHTML(pwTierCard("bear", 2))}
        </div>
        <div class="pw-ht-cap pw-ht-delta bull">+5 → the Print</div>`,
        text: "The stronger card wins the round and pushes the Print its full strength toward its side." },

      { title: "If It Ties", body: `
        <div class="pw-ht-cards two">
          ${pwFitHTML(pwTierCard("bull", 3))}
          ${pwFitHTML(pwTierCard("bear", 3))}
        </div>
        <div class="pw-ht-cap pw-ht-delta flat">The Print does not move</div>`,
        text: "If the cards tie, the Print does not move and both cards go to the discard pile." },

      { title: "Draw a New Card", body: `
        <div class="pw-ht-piles">
          <div class="pw-ht-pile"><span class="pw-ht-stack ${esc(pw.playerSide || "bull")}"></span><i>Own deck</i></div>
          <div class="pw-ht-pile"><span class="pw-ht-stack wild"></span><i>Wild pile</i></div>
        </div>`,
        text: "The player who lost the round draws a new card, choosing from their own deck or the wild pile." },

      /* Six tiers, strongest first, three across and two down. It was a
         column of rungs with the names elided to "Mar…" and "Ha…", which is
         the one thing a page about which card beats which cannot do. The
         faces come from the same table the Library reads, so a picture here
         can only be missing if it is missing there too. */
      { title: "Card Strength", body: `
        <div class="pw-ht-ladder">
          ${[5, 4, 3, 2, 1, 0].map((n) => `
            <div class="pw-ht-tier">
              ${pwFitHTML(pwTierCard("bull", n))}
              <span class="pw-ht-tname">
                <b>${esc(pwTiers("bull").find((x) => x.pts === n).type.replace("Bullish ", "")
                  + (n === 4 ? " / Shooting Star" : ""))}</b>
                <i>${n}</i>
              </span>
            </div>`).join("")}
        </div>`,
        text: "Marubozu (5) beats Hammer or Shooting Star (4), then Standard (3), Spinning Top (2), Weak Rejection (1) and Null (0)." },

      { title: "Special Cards & Match End", body: `
        <div class="pw-ht-cards two">
          ${pwFitHTML(pwSpecCard("Volatility Spike"))}
          ${pwFitHTML(pwSpecCard("Market News"))}
        </div>`,
        /* tightened from the first draft of this page: it is the only page
           carrying two rules and a button, and every line of it is a line the
           two cards above do not get on a short screen */
        text: "Special cards bend the rules, so read each one before you play it. The match ends when a player has no point cards left in hand or deck, and the Print decides it.",
        link: true },
    ];
  }

  function pwHowToHTML() {
    const pages = pwHowToPages();
    const i = Math.max(0, Math.min(pages.length - 1, pw.htPage || 0));
    const p = pages[i];
    return `
      <div class="pw-ht" data-pw-ht-swipe>
        <div class="pw-lib-head">
          <button type="button" class="pw-hub-back" data-pw-ht-close aria-label="Back to Pointæway">
            <img src="assets/nav-icons/icon-arrow-back@2x.png" alt="">
          </button>
          <span class="pw-lib-title">How to Play</span>
        </div>
        <div class="pw-ht-page">
          <div class="pw-ht-step">${i + 1} of ${pages.length}</div>
          <h3 class="pw-ht-title">${esc(p.title)}</h3>
          <div class="pw-ht-art">${p.body}</div>
          <p class="pw-ht-text">${esc(p.text)}</p>
          ${p.link ? `<button type="button" class="pw-over-pill on pw-ht-link" data-pw-library="howto">
            <span>See all cards → Card Library</span></button>` : ""}
        </div>
        <div class="pw-ht-nav">
          <button type="button" class="pw-ht-arrowbtn" data-pw-ht-step="-1"
                  aria-label="Previous page"${i === 0 ? " disabled" : ""}>‹</button>
          <div class="pw-ht-dots">
            ${pages.map((_, n) => `<button type="button" class="${n === i ? "on" : ""}"
              data-pw-ht-go="${n}" aria-label="Page ${n + 1}"></button>`).join("")}
          </div>
          <button type="button" class="pw-ht-arrowbtn" data-pw-ht-step="1"
                  aria-label="Next page"${i === pages.length - 1 ? " disabled" : ""}>›</button>
        </div>
      </div>`;
  }

  function pwHowToStep(d) {
    const n = (pw.htPage || 0) + d;
    if (n < 0 || n >= pwHowToPages().length) return;
    pw.htPage = n;
    renderPointaeway();
  }

  /* ---- moving through the library ----
     The grid opens a card, the card's two arrows and a swipe move along the
     tab it came from, and the way back is the tab. State rather than DOM: the
     screen is small enough to draw again and there is nothing mid-animation to
     preserve. */
  function pwLibOpenCard(n) {
    pw.libCard = n;
    renderPointaeway();
  }
  function pwLibStep(d) {
    const cards = pwLibCards(pw.libSet);
    if (pw.libCard == null) return;
    const n = pw.libCard + d;
    if (n < 0 || n >= cards.length) return;
    pw.libCard = n;
    renderPointaeway();
  }

  /* ---- the Card Library ----
     Three tabs and a grid, and the grid is sized by the box rather than the
     box by the grid: the cells share whatever height is left and the faces
     scale into them, so twelve specials fit one viewport on a 375x667 screen
     the same way six candles fit one on a 390x844. Nothing scrolls and nothing
     has to be paged — the "page it rather than scroll it" case never arrives,
     because the grid cannot outgrow its own box.

     Tapping a card opens it full size with its name, its Power or its effect
     text, and the way to the next one either side. */
  function pwLibraryHTML() {
    const sets = pwLibSets();
    const open = sets.some((s) => s.k === pw.libSet) ? pw.libSet : "bull";
    const set = sets.find((s) => s.k === open);
    const cards = pwLibCards(open);

    if (pw.libCard != null) {
      const i = Math.max(0, Math.min(cards.length - 1, pw.libCard));
      const c = cards[i];
      return `
        <div class="pw-lib pw-lib-detail" data-pw-lib-swipe>
          <div class="pw-lib-head">
            <button type="button" class="pw-hub-back" data-pw-lib-close
                    aria-label="Back to the Card Library">
              <img src="assets/nav-icons/icon-arrow-back@2x.png" alt="">
            </button>
            <span class="pw-lib-title">${esc(c.name)}</span>
          </div>
          <div class="pw-lib-big">
            <button type="button" class="pw-lib-step prev" data-pw-lib-step="-1"
                    aria-label="Previous card"${i === 0 ? " disabled" : ""}>‹</button>
            <div class="pw-lib-bigcard pw-cardfit">${pwCardHTML(c.card, {})}</div>
            <button type="button" class="pw-lib-step next" data-pw-lib-step="1"
                    aria-label="Next card"${i === cards.length - 1 ? " disabled" : ""}>›</button>
          </div>
          <div class="pw-lib-info">
            <span class="pw-lib-meta ${esc(open)}">${esc(c.meta)}</span>
            <span class="pw-lib-detail-name">${esc(c.name)}</span>
            <span class="pw-lib-detail-text">${esc(c.text)}</span>
          </div>
          <div class="pw-lib-dots" aria-hidden="true">
            ${cards.map((_, n) => `<i class="${n === i ? "on" : ""}"></i>`).join("")}
          </div>
        </div>`;
    }

    return `
      <div class="pw-lib">
        <div class="pw-lib-head">
          <button type="button" class="pw-hub-back" data-pw-lib-back
                  aria-label="Back">
            <img src="assets/nav-icons/icon-arrow-back@2x.png" alt="">
          </button>
          <span class="pw-lib-title">Card Library</span>
        </div>

        <div class="pw-lib-tabs" role="tablist">
          ${sets.map((x) => `
            <button type="button" class="pw-lib-tab ${x.k}${open === x.k ? " on" : ""}"
                    role="tab" aria-selected="${open === x.k}" data-pw-lib-set="${x.k}">
              <b>${esc(x.name.replace(/ Cards$/, ""))}</b>
              <i>${esc(x.sub)}</i>
            </button>`).join("")}
        </div>

        <div class="pw-lib-grid ${esc(open)}"
             style="--pw-lg-cols:${cards.length > 6 ? 4 : 3};--pw-lg-rows:${
               Math.ceil(cards.length / (cards.length > 6 ? 4 : 3))}">
          ${cards.map((c, n) => `
            <button type="button" class="pw-lib-cell pw-cardfit" data-pw-lib-card="${n}"
                    aria-label="${esc(c.name)}, ${esc(c.meta)}">
              ${pwCardHTML(c.card, { small: true })}
            </button>`).join("")}
        </div>
        <div class="pw-lib-foot">${esc(set.name)} · tap a card to read it</div>
      </div>`;
  }

  function renderPointaeway() {
    barTitle.textContent = "Pointæway";
    const pickName = document.querySelector("#pickBar .pick-name");
    if (pickName) pickName.textContent = "Cool Down Game";
    cardFooter.style.display = "none";
    /* the phase decides whether the challenge bar and the chart panel belong
       here, and this screen repaints itself without going through render() */
    syncChallengeBar();
    syncChartPanel();

    cardScroll.classList.remove("pw-playing", "pw-introing", "pw-overing",
                                "pw-revealing", "pw-savedscreen", "pw-fixed");
    /* The performance chart asks the header and the two title bars to stand
       down while it is up. It does NOT hide the header: what it folds it to
       is the pill the app already folds it to, which keeps the hamburger, the
       grabber and the speaker on screen and keeps everything below the safe
       area. Hiding the whole zone put the panel under the clock and the
       Dynamic Island.

       Driven from the phase so that leaving the hub — into a match, or into
       the replay a candle opens — puts them back on its own, and done once on
       the way in rather than on every render, so that expanding the header by
       hand while the chart is up is allowed: the chart simply gets less room
       and redraws into it. */
    pwPerfHead(pw.phase === "hub" && pw.perf.on);
    if (pw.phase === "hub") {
      cardScroll.classList.add("pw-fixed");
      cardScroll.innerHTML = pwHubHTML();
      cardScroll.scrollTop = 0;
      /* the two reference screens are one tap from here, so their faces are
         fetched while the hub is being looked at rather than when it is */
      pwPreloadArtSoon();
      pwGuardPillArt();
      if (pw.perf.on) {
        /* the plot is drawn from the box it ended up in, so it is drawn after
           the box exists rather than inside the template that makes it */
        requestAnimationFrame(pwPerfLayout);
        setTimeout(pwPerfLayout, 320);
      } else {
        pwFitHistRows();
      }
      return;
    }
    /* The one screen here that is allowed to be longer than a view: ten wild
       faces and their effects do not fit one, and a list that is read rather
       than acted on is the one place scrolling is the right answer. */
    if (pw.phase === "library") {
      cardScroll.classList.add("pw-fixed");
      cardScroll.innerHTML = pwLibraryHTML();
      cardScroll.scrollTop = 0;
      return;
    }
    /* the live 1v1: the queue, the room, and the record of past rooms. All
       three are ordinary scrollers — the room screen is two rows of five
       cards under a chart and a header, and on a short phone that is more
       than a view. */
    if (pw.phase === "finding") { cardScroll.innerHTML = pwFindingHTML(); cardScroll.scrollTop = 0; return; }
    if (pw.phase === "online") {
      /* a live match is the same fixed-height column a local one is — the
         board has to sit in one view, and the hand scrolls sideways inside
         it. A finished match is a result screen and scrolls normally. */
      const o = pw.online;
      const live = !!(o && o.room && o.room.status === "active" && !o.timedOut);
      cardScroll.classList.toggle("pw-playing", live);
      /* the hand keeps its sideways position across the live re-renders that
         every room change causes */
      const keep = cardScroll.scrollTop;
      cardScroll.innerHTML = pwOnlineHTML();
      cardScroll.scrollTop = live ? 0 : keep;
      return;
    }
    if (pw.phase === "onlinehistory") {
      const keep = cardScroll.scrollTop;
      cardScroll.innerHTML = pwOnlineHistoryHTML();
      cardScroll.scrollTop = keep;
      return;
    }
    if (pw.phase === "challenge") {
      /* the typed code survives the re-render that follows every lookup */
      const keep = cardScroll.scrollTop;
      cardScroll.innerHTML = pwChallengeHTML();
      cardScroll.scrollTop = keep;
      return;
    }
    if (pw.phase === "create") {
      const keep = cardScroll.scrollTop;
      cardScroll.innerHTML = pwCreateHTML();
      cardScroll.scrollTop = keep;
      return;
    }
    /* both of these are fixed-height screens: one page, no scroll, by rule */
    if (pw.phase === "howto") {
      cardScroll.classList.add("pw-fixed");
      cardScroll.innerHTML = pwHowToHTML();
      cardScroll.scrollTop = 0;
      return;
    }
    /* A finished match read back off the record. Unlike the library this one
       is a fixed-height column: the chart and the round under it are the whole
       screen, and they split what the two header lines leave between them
       rather than stacking at their natural height and leaving the bottom half
       of the card empty. */
    if (pw.phase === "saved") {
      cardScroll.classList.add("pw-savedscreen");
      cardScroll.innerHTML = pwSavedHTML();
      cardScroll.scrollTop = 0;
      return;
    }
    if (pw.phase === "setup") {
      /* the whole way in has to sit in one view, so the scroller becomes a
         fixed-height column here too and the two cards take up the slack */
      cardScroll.classList.add("pw-introing");
      cardScroll.innerHTML = pwIntroHTML();
      cardScroll.scrollTop = 0;
      return;
    }

    if (pw.phase === "gameover") {
      /* the same bargain the intro and the table strike: the scroller becomes
         a fixed-height column and the scene takes what the rows above and
         below leave, so the whole result sits in one view */
      cardScroll.classList.add("pw-overing");
      /* the one state that may need more than a view: see .pw-revealing */
      cardScroll.classList.toggle("pw-revealing", pw.showRound != null);
      cardScroll.innerHTML = pwOverHTML();
      cardScroll.scrollTop = 0;
      return;
    }

    const ownCount = pwOwnDeck(pw.playerSide).length;
    const choosing = pw.phase === "draw-choice";
    const peeking = pw.phase === "discipline-pick";
    const doubling = pw.phase === "takeprofit-choice";
    /* The table, top to bottom: what is left to draw from, their side of it,
       the meter both sides are pulling on, your side of it, then your hand.
       The two animals stand behind the whole thing rather than in it — they
       are the room, not a row.

       The four things that interrupt a turn — the opponent's breakdown, the
       double-up question, the draw choice, and answering a peek — all take
       the hand's place rather than adding a row. There is nothing to play
       while any of them is up, so nothing is lost by the swap. */
    const canPlay = pw.phase === "selecting";
    /* the same bargain Placeæway strikes: the scroller becomes a fixed-height
       flex column, the arena takes what the rows above and below leave, and
       nothing scrolls vertically */
    cardScroll.classList.remove("pw-introing");
    cardScroll.classList.add("pw-playing");
    /* The live print is a panel of its own, and it stands where the video
       header stands rather than taking anything from this card — see
       syncChartPanel. So there is nothing for the board to give up, and
       nothing here changes when it opens. */
    cardScroll.innerHTML = `
      <div class="pw-counts">
          <span class="pw-count"><b>${ownCount}</b><i>Deck</i></span>
          <span class="pw-count wild"><b>${pw.special.length}</b><i>Wild</i></span>
          ${/* their hand, as a number and nothing else. It used to be a stack
                of card backs in a box of its own, which is a lot of screen to
                spend saying "six" */""}
          <span class="pw-count opp"><b>${pw.aiHand.length}</b><i>Opp</i></span>
          ${pwChartToggleHTML(pw.showChart, "data-pw-chart")}
          <span class="pw-counts-gap"></span>
          <button type="button" class="pw-count-btn${pw.showSeen ? " on" : ""}" data-pw-seen
                  aria-pressed="${pw.showSeen}"
                  aria-label="What the opponent has played">Seen</button>
          <button type="button" class="pw-count-btn" data-pw-restart
                aria-label="Restart match">Restart <span aria-hidden="true">⟳</span></button>
      </div>

      ${/* The two animals that used to stand behind the table are gone. They
            were decoration under the seats and the meter, and the board reads
            cleaner without them — the cards on the table are the picture. */""}
      <div class="pw-field">
        ${pwArenaHTML(canPlay, peeking)}
      </div>

      ${/* The hand's header row carries the way into the wilds, so it is
            on screen without going looking for it. Below it, whichever of the
            five things belongs in the hand's place right now. */""}
      <div class="pw-handhead">
        <span class="pw-hand-cap">Your Hand <b>(${pw.playerHand.length})</b></span>
        <button type="button" class="pw-specials-btn${pw.showSpecials ? " on" : ""}"
                data-pw-specials aria-expanded="${pw.showSpecials}" aria-controls="pwSheet">
          <span class="pw-specials-ico" aria-hidden="true"></span>
          <span>View Specials</span>
        </button>
      </div>

      ${pw.showSpecials ? pwSpecialsSheetHTML() : pw.showSeen ? `
      <div class="pw-seen">
        <div class="pw-seen-cap">Opponent has played</div>
        ${pwTiers(pw.aiSide).map((t) => {
          const n = pw.seen[t.type] || 0;
          return `<div class="pw-seen-row${n ? " on" : ""}">
            <span>${esc(t.type)}</span>
            <span class="pw-seen-n ${pw.aiSide}">${n}/${pwCopies()}</span>
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
      <div class="pw-hand${peeking ? " peeking" : ""}">
        ${pw.playerHand.length
          ? pw.playerHand.map((c) => {
              const why = pwBlocked(c, "player");
              return pwCardHTML(c, {
                play: canPlay && !why,
                answer: peeking && c.kind === "tier",
                dim: (peeking && c.kind !== "tier") || !!why,
                note: why,
                depth: true });
            }).join("")
          : `<div class="pw-hand-empty">Empty — nothing left to play.</div>`}
      </div>`}`;
    pw.flipAnim = null;      // the turn animation plays once, on the render after the tap
    cardScroll.scrollTop = 0;
  }

  /* ---- dragging a card onto the slot ----
     The hand is a row that scrolls sideways, so the press cannot simply become
     a drag: it is only a drag once it has travelled further up the screen than
     along it, and a press that runs along the row is handed straight back so
     the row scrolls as it always did. A tap is untouched — the click reaches
     the dispatcher and plays the card — and only a drag that actually moved
     swallows the click that follows it. */
  const PW_DRAG_SLOP = 9;
  let pwDrag = null;
  let pwAteClick = false;

  const pwDropSlot = () => document.querySelector("[data-pw-drop]");

  function pwDragStop(commit) {
    if (!pwDrag) return;
    const d = pwDrag;
    pwDrag = null;
    if (d.ghost) d.ghost.remove();
    if (d.el) d.el.classList.remove("dragging");
    const slot = pwDropSlot();
    if (slot) slot.classList.remove("over");
    if (!d.moved) return;
    pwAteClick = true;                  // a drag is not also a tap
    if (commit && d.over) pwPlay(d.id);
  }

  function pwDragMove(e) {
    if (!pwDrag) return;
    const d = pwDrag;
    const dx = e.clientX - d.x0, dy = e.clientY - d.y0;
    if (!d.moved) {
      /* Which gesture this is, decided on travel rather than on the first
         sample. The slot is always above the hand, so lifting the card is the
         thing that means "play" — and it cannot be "whichever axis leads",
         because the card at the left end of the row reaches the slot on a path
         that is mostly sideways. So: any real upward travel is a drag, and
         only a flat run along the row is handed back to the scroller. */
      if (dy > -PW_DRAG_SLOP) {
        if (Math.abs(dx) > PW_DRAG_SLOP * 2) { pwDragStop(false); return; }
        return;                                   // not yet either one
      }
      d.moved = true;
      const r = d.el.getBoundingClientRect();
      d.w = r.width; d.h = r.height;
      const g = d.el.cloneNode(true);
      g.className = "pw-card pw-ghost " + d.el.className.replace("pw-card", "").trim();
      g.style.width = `${r.width}px`;
      g.style.height = `${r.height}px`;
      g.removeAttribute("data-pw-play");
      document.body.appendChild(g);
      d.ghost = g;
      d.el.classList.add("dragging");
    }
    if (e.cancelable) e.preventDefault();      // stop the row scrolling under it
    d.ghost.style.transform =
      `translate(${e.clientX - d.w / 2}px, ${e.clientY - d.h / 2}px) scale(1.04)`;
    const slot = pwDropSlot();
    const s = slot && slot.getBoundingClientRect();
    d.over = !!s && e.clientX >= s.left && e.clientX <= s.right
                 && e.clientY >= s.top  && e.clientY <= s.bottom;
    if (slot) slot.classList.toggle("over", d.over);
  }

  cardScroll.addEventListener("pointerdown", (e) => {
    if (state.view !== "pointaeway" || !pw || pw.phase !== "selecting") return;
    if (e.button != null && e.button !== 0) return;
    const el = e.target.closest(".pw-card[data-pw-play]");
    if (!el) return;
    pwDrag = { el, id: el.getAttribute("data-pw-play"),
               x0: e.clientX, y0: e.clientY, moved: false, over: false };
  });
  window.addEventListener("pointermove", pwDragMove, { passive: false });
  window.addEventListener("pointerup", () => pwDragStop(true));
  window.addEventListener("pointercancel", () => pwDragStop(false));
  /* capture, so it lands before the document-level dispatcher gets it */
  cardScroll.addEventListener("click", (e) => {
    if (!pwAteClick) return;
    pwAteClick = false;
    e.stopPropagation();
    e.preventDefault();
  }, true);

  function openPointaeway() {
    stopAudio();
    if (!pw) pw = pwNewGame();
    state.view = "pointaeway";
    state.slideDir = 0;
    closeOverlay();
    render();
  }

  /* ---------------- Placeæway ----------------
     The third Gameæway game. The whole pattern prints at once and you place
     every candle in order, Green or Red, against the clock.

     Game logic — the seeded RNG, the series generator, the scoring, the round
     flow — is carried over from the reference build unchanged; only the
     chrome is the app's. The two things worth knowing before editing:

     1. Candles are positioned in PERCENT of the chart box, never pixels. The
        same render call has to look right in a tall box mid-round and in the
        short one left over once the results panel opens under it. Percent is
        what makes one function serve both; pixel math would need re-measuring
        on every layout change and would be wrong for a frame either way.
     2. Nothing scrolls vertically. While a round is up, cardScroll becomes a
        flex column with overflow hidden and the chart takes `flex: 1 1 auto`,
        so it absorbs whatever the fixed rows above and below leave. */

  const PA_ROUNDS = 3;
  const PA_COUNTS = [10, 20, 30, 40];
  const PA_COL_W = 14;       // candle column, px — the band and the scroll share it
  const PA_COL_GAP = 3;
  /* Local only, on purpose and for now: there are no accounts or backend yet,
     so history is per-device. SWAP POINT — once real accounts exist this
     should move to per-account sync alongside the rest of the store, and this
     key becomes a migration source rather than the record. */
  const PA_HISTORY_KEY = "placeaway_history";

  let pa = null;
  let paTick = null;

  /* Reaction's three paces, and what they make the round worth beating. */
  const PA_DIFFS = [
    { id: "easy",   label: "Easy",   ms: 1500 },
    { id: "medium", label: "Medium", ms: 1000 },
    { id: "hard",   label: "Hard",   ms: 500 },
  ];
  const paDiff = (id) => PA_DIFFS.find((d) => d.id === id) || PA_DIFFS[1];
  const paTargetMs = () => pa.count * paDiff(pa.diff).ms;
  /* A round nobody is playing has to end sometime. Three times the window is
     far past any deviation worth distinguishing, and stopping there records
     the elapsed time it actually took rather than letting an abandoned round
     run the clock forever. */
  const PA_RX_CAP = 3;

  function paNewGame() {
    return {
      mode: null,            // null = the mode selector | "speed" | "reaction"
      screen: "setup",       // setup | ready | game
      count: PA_COUNTS[0],
      seed: paRandomSeed(),
      rng: null,
      roundIdx: 0,
      candles: [],
      nextIndex: 0,
      startTime: 0,
      elapsed: 0,
      ended: false,
      wrong: 0,
      times: [], wrongs: [], series: [],
      reviewIdx: null,       // which round the finished-match tabs are showing
      saved: false,
      showHowTo: false,
      showHistory: false,
      historyOpen: null,     // index of the expanded saved match
      historyRound: 0,       // which round of it is on the chart
      confirmClear: false,
      saveFailed: false,
      copied: null,          // the seed whose button is showing "Copied ✓"
      // reaction only
      diff: "medium",
      printed: 0,            // candles revealed so far; the player calls up to it
      metro: null,           // the print schedule, one timeout at a time
      targets: [],           // each round's window, so results can show both
    };
  }

  /* Share sheet where the device has one, clipboard otherwise — the same order
     the profile's connect code uses. The button says so itself rather than
     through a notice, since there is one per seed and a shared notice could
     not say which. Cleared on the next render that is not a copy. */
  let paCopyTimer = null;
  function paCopySeed(seed) {
    const done = () => {
      pa.copied = seed;
      renderPlaceaway();
      if (paCopyTimer) clearTimeout(paCopyTimer);
      paCopyTimer = setTimeout(() => {
        if (pa && pa.copied === seed) { pa.copied = null; renderPlaceaway(); }
      }, 2000);
    };
    if (navigator.share) {
      navigator.share({ title: "Placæway match code", text: seed })
        .then(done).catch(() => { /* dismissed — say nothing */ });
      return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(seed).then(done).catch(() => {
        /* clipboard writes need a secure context and reject silently in a few
           embedded browsers; the seed is on screen to read either way */
        pa.copied = null; renderPlaceaway();
      });
      return;
    }
    pa.copied = null;
    renderPlaceaway();
  }

  /* ---- seeded RNG, exactly as the reference: same seed, same match ---- */
  function paXmur3(str) {
    let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    return function () {
      h = Math.imul(h ^ (h >>> 16), 2246822507);
      h = Math.imul(h ^ (h >>> 13), 3266489909);
      h ^= h >>> 16;
      return h >>> 0;
    };
  }
  function paMulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const paMakeRng = (seed) => paMulberry32(paXmur3(seed)());
  const paRandomSeed = () => Math.random().toString(36).slice(2, 8).toUpperCase();
  const paFmt = (ms) => (ms / 1000).toFixed(2) + "s";
  const paRandInt = (min, max, r) => Math.floor(min + r() * (max - min + 1));

  /* Impulse and consolidation, alternating. Straight from the reference — the
     shape of the series is the game, so it is copied rather than rewritten. */
  function paGenerateSeries(n, r) {
    const trendDir = r() < 0.5 ? 1 : -1;
    const baseStep = 4;
    let price = 100;
    const out = [];
    let phase = r() < 0.8 ? "impulse" : "consolidation";

    while (out.length < n) {
      const remaining = n - out.length;
      let len = phase === "impulse" ? paRandInt(2, 4, r) : paRandInt(3, 6, r);
      len = Math.min(len, remaining);
      for (let k = 0; k < len; k++) {
        const open = price;
        let drift, noiseAmp, wickAmp;
        if (phase === "impulse") {
          drift = trendDir * baseStep * (0.75 + r() * 0.45);
          noiseAmp = baseStep * 0.35;
          wickAmp = baseStep * 0.35;
        } else {
          drift = (r() - 0.5) * 2 * baseStep * 0.35;
          noiseAmp = baseStep * 0.55;
          wickAmp = baseStep * 0.7;
        }
        const noise = (r() - 0.5) * 2 * noiseAmp;
        let close = open + drift + noise;
        if (Math.abs(close - open) < 0.4) close = open + (close >= open ? 1 : -1) * 0.6;
        const high = Math.max(open, close) + r() * wickAmp;
        const low = Math.min(open, close) - r() * wickAmp;
        out.push({ open, close, high, low, dir: close > open ? "up" : "down" });
        price = close;
        if (out.length >= n) break;
      }
      phase = phase === "impulse" ? "consolidation" : "impulse";
    }
    return out;
  }

  /* The chart, in percent. `pct` maps a price into 0-100 down the box with a
     10% margin top and bottom, so the tallest wick never touches the edge. */
  function paChartHTML(list, opts) {
    const o = opts || {};
    const gMax = Math.max.apply(null, list.map((c) => c.high));
    const gMin = Math.min.apply(null, list.map((c) => c.low));
    const range = Math.max(1, gMax - gMin);
    const PAD = 10, USABLE = 100 - PAD * 2;
    const pct = (v) => PAD + USABLE - ((v - gMin) / range) * USABLE;

    /* The scale comes from the whole series even when only part of it is on
       screen: sizing to what has printed so far would rescale the chart on
       every tick and make settled candles jump. */
    const cols = list.map((c, i) => {
      const wickTop = pct(c.high);
      const wickH = Math.max(0.6, pct(c.low) - wickTop);
      const bodyTop = pct(Math.max(c.open, c.close));
      const bodyH = Math.max(1.2, pct(Math.min(c.open, c.close)) - bodyTop);
      const done = o.allDone || (o.doneUpTo != null && i < o.doneUpTo);
      const pending = o.printedUpTo != null && i >= o.printedUpTo;
      return `<div class="pa-col ${c.dir}${i % 5 === 0 ? " grid" : ""}${done ? " done" : ""}${pending ? " pending" : ""}"
                   ${o.idPrefix ? `id="${o.idPrefix}${i}"` : ""}>
        <span class="pa-wick" style="top:${wickTop.toFixed(2)}%;height:${wickH.toFixed(2)}%"></span>
        <span class="pa-body" style="top:${bodyTop.toFixed(2)}%;height:${bodyH.toFixed(2)}%"></span>
        <span class="pa-mark${done ? " done" : ""}"></span>
      </div>`;
    }).join("");

    const band = o.interactive
      ? `<div class="pa-band" id="paBand" style="transform:translateX(${
          (o.doneUpTo || 0) * (PA_COL_W + PA_COL_GAP)}px)"></div>`
      : "";
    return `<div class="pa-track">${band}${cols}</div>`;
  }

  const paTotalMs = () => pa.times.reduce((a, b) => a + b, 0);
  const paTotalWrong = () => pa.wrongs.reduce((a, b) => a + b, 0);

  function paLoadHistory() {
    try { return JSON.parse(localStorage.getItem(PA_HISTORY_KEY) || "[]"); }
    catch (e) { return []; }
  }
  function paSaveHistory(list) {
    try { localStorage.setItem(PA_HISTORY_KEY, JSON.stringify(list)); return true; }
    catch (e) { return false; }
  }

  /* ---- flow ---- */

  function paStartMatch() {
    const seed = pa.mode === "reaction" ? pa.seed
      : ((pa.seed || paRandomSeed()).trim().toUpperCase() || paRandomSeed());
    Object.assign(pa, {
      seed, rng: pa.mode === "reaction" ? null : paMakeRng(seed), roundIdx: 0,
      times: [], wrongs: [], series: [], targets: [], reviewIdx: null, saved: false,
      saveFailed: false, showHowTo: false, showHistory: false,
      screen: "ready",
    });
    renderPlaceaway();
  }

  function paStartRound() {
    pa.candles = paGenerateSeries(pa.count, pa.rng);
    pa.nextIndex = 0;
    pa.ended = false;
    pa.wrong = 0;
    pa.elapsed = 0;
    pa.reviewIdx = null;
    pa.screen = "game";
    renderPlaceaway();
    /* after the paint, so the clock starts when the pattern is actually up —
       the reference makes the same promise in its "Reveal & start" copy */
    pa.startTime = performance.now();
    paStopTick();
    paTick = setInterval(paUpdateClock, 30);
  }

  function paStopTick() { if (paTick) { clearInterval(paTick); paTick = null; } }

  /* The clock is the only thing that repaints per tick, so it writes to its
     own node rather than going through a render — 33 renders a second would
     rebuild the whole chart and lose the smooth scroll. */
  function paUpdateClock() {
    if (!pa || pa.ended) return;
    pa.elapsed = performance.now() - pa.startTime;
    const el = document.getElementById("paClock");
    if (el) el.textContent = paFmt(pa.elapsed);
  }

  /* The tap has to land the instant a finger touches, because the elapsed
     time between the reveal and this call IS the score. A click listener on
     mobile waits for the browser to finish translating touch into click —
     tens of milliseconds, sometimes more, added to every single tap and so to
     every time the game records. pointerdown fires on contact instead.

     The click path below stays as the fallback for keyboards, assistive tech
     and synthetic clicks, which never emit a pointerdown. paPointerTapAt keeps
     the two from both firing for one finger: preventDefault on pointerdown
     already suppresses the compatibility click in every browser we target,
     and this is the belt to that pair of braces. It lapses on its own so a
     stray pointerdown with no click behind it cannot swallow a later tap. */
  let paPointerTapAt = 0;
  cardScroll.addEventListener("pointerdown", (e) => {
    const t = e.target.closest("[data-pa-tap]");
    if (!t) return;
    e.preventDefault();
    paPointerTapAt = performance.now();
    paTap(t.getAttribute("data-pa-tap"));
  });

  /* The replay chart's scrubber. On the document, not on the card panel: the
     same chart is drawn in three places — the live panel above the board, the
     result screen and a saved match off the hub — and only two of them are
     inside cardScroll. Move and up go on the window, because a drag that
     leaves the plot is still the same drag. */
  document.addEventListener("pointerdown", pwScrubDown);
  window.addEventListener("pointermove", pwScrubMove, { passive: false });
  window.addEventListener("pointerup", pwScrubUp);
  window.addEventListener("pointercancel", pwScrubUp);

  /* and the performance chart's, which is the same shape of thing: one finger
     reads, two fingers move, and a press that never travelled opens a match */
  /* and the ÆWAY chart's: one finger pans, a held finger raises the crosshair
     and scrubs with it, two fingers pinch the span */
  /* the admin page's two editable assumptions, saved as they are typed */
  document.addEventListener("change", (e) => {
    const el = e.target.closest && e.target.closest("[data-aw-ass]");
    if (!el) return;
    const k = el.getAttribute("data-aw-ass");
    const n = Number(el.value);
    if (!Number.isFinite(n) || n < 0) return;
    store.awAdmin = Object.assign({}, store.awAdmin || {}, { [k]: n });
    awSave();
    render();
  });

  document.addEventListener("pointerdown", awDown);
  window.addEventListener("pointermove", awMove, { passive: false });
  window.addEventListener("pointerup", awUp);
  window.addEventListener("pointercancel", awUp);

  /* The way into the admin page: a long press on the "Simulated market" tag,
     then a passcode. Long rather than a tap so that a tester who reads the tag
     and prods it finds nothing — see awIsAdmin() for what the passcode is and
     is not. */
  let awSimHold = null;
  document.addEventListener("pointerdown", (e) => {
    if (!e.target.closest || !e.target.closest("[data-aw-sim]")) return;
    clearTimeout(awSimHold);
    awSimHold = setTimeout(awAdminAsk, 1500);
  });
  const awSimOff = () => { clearTimeout(awSimHold); awSimHold = null; };
  window.addEventListener("pointerup", awSimOff);
  window.addEventListener("pointercancel", awSimOff);
  window.addEventListener("pointermove", (e) => {
    if (awSimHold && (Math.abs(e.movementX || 0) > 4 || Math.abs(e.movementY || 0) > 4)) awSimOff();
  }, { passive: true });

  document.addEventListener("pointerdown", pwPerfDown);
  /* anywhere else on the screen closes an open filter menu */
  document.addEventListener("pointerdown", (e) => {
    if (!pw || !pw.perf || !pw.perf.menu) return;
    if (e.target.closest && e.target.closest(".pw-perf-menus")) return;
    pw.perf.menu = null;
    renderPointaeway();
  });
  window.addEventListener("pointermove", pwPerfMove, { passive: false });
  window.addEventListener("pointerup", pwPerfUp);
  window.addEventListener("pointercancel", pwPerfUp);

  function paTap(dir) {
    if (!pa) return;
    if (pa.mode === "reaction") return rxTap(dir);
    if (pa.screen !== "game" || pa.ended) return;
    const i = pa.nextIndex;
    if (i >= pa.count) return;

    if (pa.candles[i].dir !== dir) {
      // a wrong tap costs time, never the round: shake and stay put
      pa.wrong++;
      paShake(dir);
      return;
    }

    /* Touch the two nodes that changed rather than re-rendering: a full render
       between taps would rebuild the chart mid-run and fight the scroll. */
    const col = document.getElementById("paC" + i);
    if (col) { col.classList.add("done"); col.querySelector(".pa-mark").classList.add("done"); }
    pa.nextIndex++;

    const prog = document.getElementById("paProgress");
    if (prog) prog.textContent = `${pa.nextIndex} / ${pa.count}`;
    const fill = document.getElementById("paFill");
    if (fill) fill.style.width = (pa.nextIndex / pa.count * 100) + "%";

    if (pa.nextIndex < pa.count) {
      const band = document.getElementById("paBand");
      if (band) band.style.transform =
        `translateX(${pa.nextIndex * (PA_COL_W + PA_COL_GAP)}px)`;
      const next = document.getElementById("paC" + pa.nextIndex);
      if (next) next.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
    } else {
      paFinishRound();
    }
  }

  function paFinishRound() {
    pa.ended = true;
    paStopTick();
    pa.times.push(performance.now() - pa.startTime);
    pa.wrongs.push(pa.wrong);
    pa.series.push(pa.candles.slice());
    // the finished match opens on its last round, the one just played
    if (pa.times.length >= PA_ROUNDS) pa.reviewIdx = PA_ROUNDS - 1;
    renderPlaceaway();
  }

  function paNextRound() {
    pa.roundIdx++;
    pa.screen = "ready";
    renderPlaceaway();
  }

  function paSaveMatch() {
    const list = paLoadHistory();
    list.unshift({
      seed: pa.seed,
      candleCount: pa.count,
      savedAt: new Date().toISOString(),
      rounds: pa.series.map((c, i) => ({ candles: c, timeMs: pa.times[i], wrong: pa.wrongs[i] })),
    });
    while (list.length > 30) list.pop();
    if (paSaveHistory(list)) { pa.saved = true; pa.saveFailed = false; }
    else pa.saveFailed = true;
    renderPlaceaway();
  }

  /* ---- Reaction ----
     Candles print on a metronome and the player calls each one as it lands.
     What is being scored is not speed but precision: the round has a window —
     the candle count times the interval — and the score is how far the actual
     finish lands from it, early counting exactly as much as late.

     The print advances on the tick OR on a correct call, whichever comes
     first, which is what lets a fast player pull the round in under its window
     and a hesitant one run past it. A correct call reschedules the metronome,
     so the next print is a fresh interval away either way. */

  function rxSchedule() {
    if (pa.metro) clearTimeout(pa.metro);
    pa.metro = setTimeout(() => { pa.metro = null; rxPrint(); }, paDiff(pa.diff).ms);
  }

  /* Reveals one more candle. The whole series is already in the DOM with the
     unprinted ones hidden, so a print is a class removal rather than a render
     — a render here would rebuild the chart under the player mid-round. */
  function rxPrint() {
    if (!pa || pa.screen !== "game" || pa.ended) return;
    if (pa.printed >= pa.count) return;      // nothing left; the schedule stops
    const col = document.getElementById("paC" + pa.printed);
    if (col) col.classList.remove("pending");
    pa.printed++;
    if (pa.printed < pa.count) rxSchedule();
  }

  function rxStopMetro() { if (pa && pa.metro) { clearTimeout(pa.metro); pa.metro = null; } }

  function rxStartRound() {
    pa.candles = paGenerateSeries(pa.count, Math.random);
    pa.nextIndex = 0;
    pa.printed = 0;
    pa.ended = false;
    pa.wrong = 0;
    pa.elapsed = 0;
    pa.reviewIdx = null;
    pa.screen = "game";
    renderPlaceaway();
    pa.startTime = performance.now();
    paStopTick();
    paTick = setInterval(rxClock, 30);
    rxPrint();          // the first candle lands immediately, then the metronome
  }

  /* Same job as paUpdateClock, plus the cap that ends a round nobody is
     playing rather than leaving the interval running on a dead screen. */
  function rxClock() {
    if (!pa || pa.ended) return;
    pa.elapsed = performance.now() - pa.startTime;
    const el = document.getElementById("paClock");
    if (el) el.textContent = paFmt(pa.elapsed);
    const dev = document.getElementById("paDev");
    if (dev) {
      const d = pa.elapsed - paTargetMs();
      dev.textContent = (d >= 0 ? "+" : "−") + paFmt(Math.abs(d));
      dev.className = "pa-stat-val " + (Math.abs(d) <= paTargetMs() * 0.05 ? "on" : "off");
    }
    if (pa.elapsed > paTargetMs() * PA_RX_CAP) rxFinishRound();
  }

  function rxTap(dir) {
    if (!pa || pa.screen !== "game" || pa.ended) return;
    const i = pa.nextIndex;
    if (i >= pa.count) return;
    // you cannot call a candle that has not printed yet
    if (i >= pa.printed) { paShake(dir); return; }

    if (pa.candles[i].dir !== dir) { pa.wrong++; paShake(dir); return; }

    const col = document.getElementById("paC" + i);
    if (col) { col.classList.add("done"); col.querySelector(".pa-mark").classList.add("done"); }
    pa.nextIndex++;

    const prog = document.getElementById("paProgress");
    if (prog) prog.textContent = `${pa.nextIndex} / ${pa.count}`;
    const fill = document.getElementById("paFill");
    if (fill) fill.style.width = (pa.nextIndex / pa.count * 100) + "%";

    if (pa.nextIndex >= pa.count) { rxFinishRound(); return; }

    // a correct call prints the next one now, and resets the metronome with it
    rxPrint();
    if (pa.printed < pa.count) rxSchedule();

    const band = document.getElementById("paBand");
    if (band) band.style.transform = `translateX(${pa.nextIndex * (PA_COL_W + PA_COL_GAP)}px)`;
    /* centred on the candle being called rather than the newest printed: when
       the metronome has run ahead, the newest is not the one that needs
       reading, and scrolling to it would take the live one off screen */
    const next = document.getElementById("paC" + pa.nextIndex);
    if (next) next.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  }

  function rxFinishRound() {
    if (pa.ended) return;
    pa.ended = true;
    paStopTick();
    rxStopMetro();
    pa.times.push(performance.now() - pa.startTime);
    pa.wrongs.push(pa.wrong);
    pa.series.push(pa.candles.slice());
    pa.targets.push(paTargetMs());
    // the rest of the pattern is shown on the result, not left half-hidden
    pa.printed = pa.count;
    if (pa.times.length >= PA_ROUNDS) pa.reviewIdx = PA_ROUNDS - 1;
    renderPlaceaway();
  }

  function paShake(dir) {
    const btn = document.getElementById(dir === "up" ? "paTapUp" : "paTapDown");
    if (!btn) return;
    btn.classList.remove("shake");
    void btn.offsetWidth;
    btn.classList.add("shake");
    setTimeout(() => btn.classList.remove("shake"), 300);
  }

  function paAbort() {
    paStopTick();
    rxStopMetro();
    /* cardScroll is shared with every other screen, and pa-playing makes it a
       flex column with overflow hidden. Only renderPlaceaway sets it, so
       leaving mid-round by the dock would carry it out of the game and leave
       the journal — the whole app — unable to scroll. Taken off here, which
       runs on every render that is not this view. */
    cardScroll.classList.remove("pa-playing", "pw-playing", "pw-introing", "pw-savedscreen");
    /* An abandoned round is not a result — it never reaches times[], so the
       match is simply dropped. Coming back lands on setup. */
    if (pa && pa.screen === "game" && !pa.ended) {
      const { mode, count, diff } = pa;
      pa = paNewGame();
      Object.assign(pa, { mode, count, diff });   // back to that mode's setup
    }
  }

  function openPlaceaway() {
    stopAudio();
    if (!pa) pa = paNewGame();
    state.view = "placeaway";
    state.slideDir = 0;
    closeOverlay();
    render();
  }

  /* The seed field is a real input, so what the player typed lives in the DOM
     and not in `pa` until something asks for it. Every button that causes a
     re-render reads it back first, or typing a seed and then changing the
     candle count would silently throw the seed away. */
  function paReadSeed() {
    const el = document.getElementById("paSeed");
    if (el) pa.seed = el.value.trim().toUpperCase();
  }
  // the count selector is shared, so both modes' setups reach paReadSeed

  const PA_HOWTO = [
    "Each round shows the <b>full candle pattern at once</b> — nothing prints gradually.",
    "Tap <b class=\"pa-c-up\">GREEN</b> or <b class=\"pa-c-down\">RED</b> to place every candle, left to right, as fast as you can.",
    "A wrong tap won't fail you — you just can't advance until you tap the right one, and the clock keeps running.",
    "A match is <b>3 rounds</b>, 3 different patterns. Lowest total time across all 3 wins.",
    "Same <b>seed</b> = identical patterns. Share yours so someone else races the exact same match, then compare times.",
  ];

  function paHistoryHTML() {
    const list = paLoadHistory();
    if (!list.length) {
      return `<div class="pa-empty">No saved matches yet — finish a match and
        tap “Save match” to build your history.</div>`;
    }
    const rows = list.map((m, i) => {
      const total = m.rounds.reduce((a, r) => a + r.timeMs, 0);
      const d = new Date(m.savedAt);
      const when = d.toLocaleDateString(undefined, { month: "short", day: "numeric" })
        + " · " + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
      const open = pa.historyOpen === i;
      const detail = open ? (() => {
        const ri = Math.min(pa.historyRound, m.rounds.length - 1);
        const wrong = m.rounds.reduce((a, r) => a + r.wrong, 0);
        return `<div class="pa-hd">
          <div class="pa-tabs">
            ${m.rounds.map((r, k) => `
              <button class="pa-tab${k === ri ? " on" : ""}" data-pa-hround="${k}">
                <span class="pa-tab-n">R${k + 1}</span>
                <span class="pa-tab-t">${paFmt(r.timeMs)}</span></button>`).join("")}
          </div>
          <div class="pa-chart pa-chart-sm">${paChartHTML(m.rounds[ri].candles, { allDone: true })}</div>
          <div class="pa-mini">
            <div class="pa-mini-cell"><b>${paFmt(total)}</b><span>Total</span></div>
            <div class="pa-mini-cell"><b>${paFmt(total / m.rounds.length)}</b><span>Avg / round</span></div>
            <div class="pa-mini-cell"><b>${wrong}</b><span>Wrong taps</span></div>
          </div>
          <div class="pa-seedline">
            <span>Seed <b>${esc(m.seed)}</b><span class="pa-seed-tail"> — paste it into Match seed to run it again</span></span>
            <button class="pa-copy${pa.copied === m.seed ? " done" : ""}" data-pa-copy="${esc(m.seed)}">
              ${pa.copied === m.seed ? "Copied ✓" : (navigator.share ? "Share code" : "Copy code")}</button>
          </div>
        </div>` ; })() : "";
      /* The copy button is a sibling of the row, not inside it: a button may
         not contain another button, and the row is itself the expand control. */
      return `<div class="pa-hitem${open ? " open" : ""}">
        <div class="pa-hhead">
          <button class="pa-hrow" data-pa-hopen="${i}">
            <span class="pa-hseed">${esc(m.seed)}</span>
            <span class="pa-htime">${paFmt(total)}</span>
            <span class="pa-hmeta">${m.candleCount} candles · ${esc(when)}</span>
          </button>
          <button class="pa-copy${pa.copied === m.seed ? " done" : ""}" data-pa-copy="${esc(m.seed)}"
            aria-label="Copy seed ${esc(m.seed)}">${pa.copied === m.seed ? "Copied ✓" : "Copy code"}</button>
        </div>
        ${detail}
      </div>`;
    }).join("");
    return `<div class="pa-hlist">${rows}</div>
      ${pa.confirmClear
        ? `<div class="pa-confirm">
             <span>Clear all saved matches? This cannot be undone.</span>
             <div class="pa-confirm-btns">
               <button class="pa-ghost danger" data-pa-clearok>Clear</button>
               <button class="pa-ghost" data-pa-clearcancel>Keep</button>
             </div>
           </div>`
        : `<button class="pa-ghost" data-pa-clear>Clear history</button>`}`;
  }

  const PA_MODES = [
    { id: "reaction", name: "Reaction", tag: "Precision", 
      blurb: "Candles print on a fixed clock. Land as close as you can to the match window." },
    { id: "speed", name: "Speed Match", tag: "Time attack",
      blurb: "The pattern's already printed. Place it as fast as you can." },
  ];

  /* Same card component as the Gameæway selector one level up, so choosing a
     mode reads as the same kind of choice as choosing a game. */
  function paHomeHTML() {
    return `
      <div class="gs-head">Pick your mode</div>
      <div class="gs-list">
        ${PA_MODES.map((m) => `
          <button class="gs-card" data-pa-mode="${m.id}">
            <span class="gs-text">
              <span class="gs-name">${esc(m.name)}</span>
              <span class="gs-tag">${esc(m.tag)}</span>
              <span class="gs-blurb">${esc(m.blurb)}</span>
            </span>
          </button>`).join("")}
      </div>`;
  }

  const PA_RX_HOWTO = [
    "Candles print on their own, one at a time, at the pace you pick — the pattern is not shown up front.",
    "Tap <b class=\"pa-c-up\">GREEN</b> or <b class=\"pa-c-down\">RED</b> to call each candle as it lands. A wrong tap costs you time, not the round.",
    "Calling one correctly prints the next straight away, so tapping quickly pulls the round in ahead of its window.",
    "The window is the candle count times the interval. Finishing early counts against you exactly as much as finishing late.",
    "Three rounds. Early and late cancel out across them, so the match is judged on your total against the total window.",
  ];

  function paRxSetupHTML() {
    const d = paDiff(pa.diff);
    const per = pa.count * d.ms;
    return `
      <div class="pa-setup">
        <div class="pa-lede">Call each candle as it prints. Not fastest — closest:
          land the round on its window, from either side.</div>

        <div class="bm-label">Pace</div>
        <div class="bm-row bm-row-3">
          ${PA_DIFFS.map((x) => `
            <button class="bm-rect ${pa.diff === x.id ? "on" : ""}" data-pa-diff="${x.id}">
              ${x.label}<span class="pa-diff-ms">${(x.ms / 1000).toFixed(2)}s</span></button>`).join("")}
        </div>

        <div class="bm-label">Candles per round</div>
        <div class="bm-row bm-row-4">
          ${PA_COUNTS.map((n) => `
            <button class="bm-rect ${pa.count === n ? "on" : ""}" data-pa-count="${n}">${n}</button>`).join("")}
        </div>

        <div class="pa-window">
          <div class="pa-window-row">${pa.count} × ${(d.ms / 1000).toFixed(2)}s per candle
            = <b>${paFmt(per)}</b> a round</div>
          <div class="pa-window-row sub">Match window <b>${paFmt(per * PA_ROUNDS)}</b>
            across ${PA_ROUNDS} rounds</div>
        </div>

        <button class="btn-primary" data-pa-start>Start match</button>

        <div class="pa-links">
          <button class="pa-ghost${pa.showHowTo ? " on" : ""}" data-pa-howto>
            ${pa.showHowTo ? "Hide how to play" : "How to play"}</button>
          <button class="pa-ghost" data-pa-back>Modes</button>
        </div>
        ${pa.showHowTo ? `<ol class="pa-howto">
          ${PA_RX_HOWTO.map((t) => `<li>${t}</li>`).join("")}</ol>` : ""}
      </div>`;
  }

  function paSetupHTML() {
    return `
      <div class="pa-setup">
        <div class="pa-lede">The pattern is already printed. Place every candle
          in order, as fast as you can — three rounds, lowest total time wins.</div>

        <div class="bm-label">Candles per round</div>
        <div class="bm-row bm-row-4">
          ${PA_COUNTS.map((n) => `
            <button class="bm-rect ${pa.count === n ? "on" : ""}" data-pa-count="${n}">${n}</button>`).join("")}
        </div>

        <div class="bm-label">Match seed</div>
        <div class="pa-seed-row">
          <input class="pa-seed" id="paSeed" type="text" maxlength="12" autocomplete="off"
                 autocapitalize="characters" spellcheck="false"
                 aria-label="Match seed" value="${esc(pa.seed)}">
          <button class="pa-dice" data-pa-dice aria-label="Random seed">⟳</button>
        </div>
        <div class="pa-hint">Same seed, same three patterns — share it to race someone.</div>

        <button class="btn-primary" data-pa-start>Start match</button>

        <div class="pa-links">
          <button class="pa-ghost${pa.showHowTo ? " on" : ""}" data-pa-howto>
            ${pa.showHowTo ? "Hide how to play" : "How to play"}</button>
          <button class="pa-ghost${pa.showHistory ? " on" : ""}" data-pa-history>
            ${pa.showHistory ? "Hide history" : "History"}</button>
          <button class="pa-ghost" data-pa-back>Modes</button>
        </div>

        ${pa.showHowTo ? `<ol class="pa-howto">
          ${PA_HOWTO.map((t) => `<li>${t}</li>`).join("")}</ol>` : ""}
        ${pa.showHistory ? paHistoryHTML() : ""}
      </div>`;
  }

  function paReadyHTML() {
    return `
      <div class="pa-ready">
        <div class="pa-kicker">Round ${pa.roundIdx + 1} of ${PA_ROUNDS}</div>
        <div class="pa-ready-head">${pa.mode === "reaction"
          ? "The tape starts on tap" : "Pattern reveals on tap"}</div>
        <button class="btn-primary" data-pa-reveal>${pa.mode === "reaction"
          ? "Start the tape" : "Reveal &amp; start"}</button>
        <div class="pa-hint">${pa.mode === "reaction"
          ? `Window ${paFmt(paTargetMs())} — land as close to it as you can.`
          : "The clock starts the instant it appears."}</div>
      </div>`;
  }

  /* The round result and the match result both render UNDER the finished
     chart, in the space the tap buttons were using. The pattern you just
     placed stays on screen the whole time — that is the payoff, and sending it
     to its own screen would take it away at exactly the wrong moment. */
  const paSigned = (ms) => (ms >= 0 ? "+" : "−") + paFmt(Math.abs(ms));

  /* Reaction's results are read against the window, not against the clock, so
     every figure is a deviation. Round deviations are signed and the match
     deviation is their sum, not the sum of their sizes — the spec is explicit
     that an early round is allowed to pay for a late one. */
  function paRxResultHTML() {
    const done = pa.times.length;
    const isFinal = done >= PA_ROUNDS;
    if (!isFinal) {
      const ms = pa.times[done - 1], target = pa.targets[done - 1];
      const dev = ms - target;
      const near = Math.abs(dev) <= target * 0.05;
      return `<div class="pa-result">
        <div class="pa-kicker">Round ${done} · window ${paFmt(target)}</div>
        <div class="pa-time ${near ? "on" : "off"}">${paSigned(dev)}</div>
        <div class="pa-hint">${paFmt(ms)} — ${dev >= 0 ? "late" : "early"}${
          pa.wrongs[done - 1] ? `, ${pa.wrongs[done - 1]} wrong tap${pa.wrongs[done - 1] === 1 ? "" : "s"}` : ""}</div>
        <button class="btn-primary" data-pa-next>Next round</button>
      </div>`;
    }
    const total = paTotalMs();
    const window = pa.targets.reduce((a, b) => a + b, 0);
    const dev = total - window;
    const off = Math.abs(dev) / window;
    const head = off <= 0.03 ? { t: "Locked to the tape", c: "up" }
      : off <= 0.10 ? { t: "In sync", c: "mid" }
      : { t: "Off the pace", c: "flat" };
    return `<div class="pa-result">
      <div class="pa-head ${head.c}">${head.t}</div>
      <div class="pa-tabs">
        ${pa.times.map((ms, i) => `
          <button class="pa-tab${i === pa.reviewIdx ? " on" : ""}" data-pa-round="${i}">
            <span class="pa-tab-n">R${i + 1}</span>
            <span class="pa-tab-t">${paSigned(ms - pa.targets[i])}</span></button>`).join("")}
      </div>
      <div class="pa-mini">
        <div class="pa-mini-cell"><b>${paFmt(total)}</b><span>Your time</span></div>
        <div class="pa-mini-cell"><b>${paFmt(window)}</b><span>Match window</span></div>
        <div class="pa-mini-cell"><b>${paSigned(dev)}</b><span>Deviation</span></div>
      </div>
      <div class="pa-seedline"><span>${paTotalWrong()} wrong tap${paTotalWrong() === 1 ? "" : "s"}
        · ${paDiff(pa.diff).label} pace, ${pa.count} candles</span></div>
      <div class="pa-btn-row">
        <button class="pa-ghost" data-pa-new>New match</button>
      </div>
    </div>`;
  }

  function paResultHTML() {
    if (pa.mode === "reaction") return paRxResultHTML();
    const done = pa.times.length;
    const isFinal = done >= PA_ROUNDS;
    if (!isFinal) {
      const ms = pa.times[done - 1], wrong = pa.wrongs[done - 1];
      return `<div class="pa-result">
        <div class="pa-kicker">Round ${done} complete</div>
        <div class="pa-time">${paFmt(ms)}</div>
        <div class="pa-hint">${wrong} wrong tap${wrong === 1 ? "" : "s"}</div>
        <button class="btn-primary" data-pa-next>Next round</button>
      </div>`;
    }
    const total = paTotalMs(), avg = total / PA_ROUNDS;
    const perCandle = avg / pa.count;
    const head = perCandle <= 350 ? { t: "Blazing match", c: "up" }
      : perCandle <= 600 ? { t: "Strong pace", c: "mid" }
      : { t: "Match complete", c: "flat" };
    return `<div class="pa-result">
      <div class="pa-head ${head.c}">${head.t}</div>
      <div class="pa-tabs">
        ${pa.times.map((ms, i) => `
          <button class="pa-tab${i === pa.reviewIdx ? " on" : ""}" data-pa-round="${i}">
            <span class="pa-tab-n">R${i + 1}</span>
            <span class="pa-tab-t">${paFmt(ms)}</span></button>`).join("")}
      </div>
      <div class="pa-mini">
        <div class="pa-mini-cell"><b>${paFmt(total)}</b><span>Total</span></div>
        <div class="pa-mini-cell"><b>${paFmt(avg)}</b><span>Avg / round</span></div>
        <div class="pa-mini-cell"><b>${paTotalWrong()}</b><span>Wrong taps</span></div>
      </div>
      <div class="pa-seedline">
        <span>Seed <b>${esc(pa.seed)}</b><span class="pa-seed-tail"> — share to run this exact match</span></span>
        <button class="pa-copy${pa.copied === pa.seed ? " done" : ""}" data-pa-copy="${esc(pa.seed)}">
          ${pa.copied === pa.seed ? "Copied ✓" : (navigator.share ? "Share code" : "Copy code")}</button>
      </div>
      ${pa.saveFailed ? `<div class="pa-hint pa-warn">Could not save — this browser
        is blocking local storage for the app.</div>` : ""}
      <div class="pa-btn-row">
        <button class="pa-ghost${pa.saved ? " done" : ""}" data-pa-save
          ${pa.saved ? "disabled" : ""}>${pa.saved ? "Saved ✓" : "Save match"}</button>
        <button class="pa-ghost" data-pa-new>New match</button>
      </div>
    </div>`;
  }

  function renderPlaceaway() {
    barTitle.textContent = "Gameæway";
    const pickName = document.querySelector("#pickBar .pick-name");
    if (pickName) pickName.textContent = "Cool Down Game";
    cardFooter.style.display = "none";

    const playing = pa.screen === "game";
    /* The no-scroll switch. Only while a round is on screen: setup and the
       ready card are short enough to sit in the ordinary scroller, and the
       history list genuinely can be longer than the card. */
    cardScroll.classList.toggle("pa-playing", playing);

    if (!playing) {
      cardScroll.innerHTML = !pa.mode ? paHomeHTML()
        : pa.screen === "ready" ? paReadyHTML()
        : pa.mode === "reaction" ? paRxSetupHTML()
        : paSetupHTML();
      cardScroll.scrollTop = 0;
      return;
    }

    // which pattern the chart is showing: the live one, or a round being reviewed
    const reviewing = pa.reviewIdx != null && pa.series[pa.reviewIdx];
    const list = reviewing ? pa.series[pa.reviewIdx] : pa.candles;
    const shownMs = reviewing ? pa.times[pa.reviewIdx] : pa.elapsed;
    const placed = reviewing ? list.length : pa.nextIndex;
    const label = reviewing
      ? `Round ${pa.reviewIdx + 1} — review`
      : `Round ${pa.roundIdx + 1} of ${PA_ROUNDS}`;

    cardScroll.innerHTML = `
      <div class="pa-game">
        <div class="pa-stats">
          <div class="pa-stat">
            <span class="pa-stat-cap">${esc(label)}</span>
            <span class="pa-stat-val" id="paClock">${paFmt(shownMs)}</span>
          </div>
          ${pa.mode === "reaction" && !reviewing ? `
          <div class="pa-stat mid">
            <span class="pa-stat-cap">vs ${paFmt(paTargetMs())}</span>
            <span class="pa-stat-val on" id="paDev">${paSigned(shownMs - paTargetMs())}</span>
          </div>` : ""}
          <div class="pa-stat right">
            <span class="pa-stat-cap">${pa.mode === "reaction" ? "Called" : "Placed"}</span>
            <span class="pa-stat-val" id="paProgress">${placed} / ${list.length}</span>
          </div>
        </div>
        <div class="pa-bar">
          <div class="pa-bar-fill" id="paFill"
               style="width:${(placed / Math.max(1, list.length) * 100).toFixed(1)}%"></div>
        </div>
        <div class="pa-chart" id="paChart">
          ${paChartHTML(list, pa.ended
            ? { allDone: true }
            : { interactive: true, idPrefix: "paC", doneUpTo: pa.nextIndex,
                printedUpTo: pa.mode === "reaction" ? pa.printed : null })}
        </div>
        ${pa.ended ? paResultHTML() : `
          <div class="pa-taps">
            <button class="pa-tap up" id="paTapUp" data-pa-tap="up">
              <span class="pa-tap-arrow">▲</span>GREEN</button>
            <button class="pa-tap down" id="paTapDown" data-pa-tap="down">
              <span class="pa-tap-arrow">▼</span>RED</button>
          </div>`}
      </div>`;
    cardScroll.scrollTop = 0;
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
      ${statRowHTML()}
      ${journalNotesHTML()}`;
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
    journalNotesLoad();
  }

  /* ==================== Trade Notes — synced ====================
     A note and a screenshot per trade, kept on the account rather than on
     the phone, so the same list is on every device the account signs in on.

     This is NOT the journal's ledger. The accounts, the imports, the manual
     trades and the calendar they add up to are structured records, and they
     already follow the account through saveUserDoc. journal.js keeps a
     different thing — free text and a picture — and that is exactly what the
     manual-trade form has never had a place for. So it sits under the ledger
     as its own feed, newest first, the way the module returns it.

     ==> INTEGRATION POINTS (journal.js, through window.AEWAY_ONLINE):
       getJournalEntries(uid)                       — the feed, on opening the journal
       saveJournalEntry(uid, {text, imageFile, entryId}) — new, or edit when entryId is set;
                                                      imageFile is downscaled by the module
       deleteJournalEntry(uid, entryId)
     Entries carry no day of their own — the module's shape is text, image and
     the server's timestamps — so they are dated by when they were written. */
  const JNOTE_MAX = 1000;

  function jnotes() {
    if (!state.jnotes) {
      state.jnotes = { status: "idle", uid: null, entries: null, composer: null,
                       confirmDel: null, open: null, notice: null, saving: false };
    }
    return state.jnotes;
  }

  async function journalNotesLoad(force) {
    const jn = jnotes();
    if (jn.status === "ready" && !force) { journalNotesPaint(); return; }
    jn.status = "loading"; jn.notice = null;
    journalNotesPaint();
    const api = await onlineReady();
    if (state.view !== "journal") return;
    if (!api || !api.getJournalEntries) { jn.status = "offline"; journalNotesPaint(); return; }
    let user;
    try { user = await api.requireUser(); } catch (e) { user = null; }
    if (state.view !== "journal") return;
    if (!user) { jn.status = "signin"; journalNotesPaint(); return; }
    jn.uid = user.uid;
    try { jn.entries = await api.getJournalEntries(user.uid); jn.status = "ready"; }
    catch (e) { jn.status = "error"; }
    if (state.view === "journal") journalNotesPaint();
  }

  /* the composer's picture is a File until it is saved — the module takes a
     File and does its own downscaling — and an object URL for the preview */
  function journalNotesDropPreview() {
    const c = jnotes().composer;
    if (c && c.preview) { try { URL.revokeObjectURL(c.preview); } catch (e) { /* gone */ } c.preview = null; }
  }
  function journalNotesOpenComposer(entry) {
    const jn = jnotes();
    journalNotesDropPreview();
    jn.composer = {
      entryId: entry ? entry.id : null,
      text: entry ? (entry.text || "") : "",
      file: null, preview: null,
      keepImage: !!(entry && entry.tradeImage),   // editing: the saved picture stays unless replaced
    };
    jn.confirmDel = null; jn.notice = null;
    journalNotesPaint();
    const ta = $("jnoteText");
    if (ta) { ta.focus({ preventScroll: false }); }
  }
  function journalNotesReadComposer() {
    const c = jnotes().composer;
    const ta = $("jnoteText");
    if (c && ta) c.text = ta.value.slice(0, JNOTE_MAX);
  }
  function journalNotesSetImage(file) {
    const jn = jnotes();
    if (!jn.composer) return;
    journalNotesReadComposer();
    journalNotesDropPreview();
    if (file && /^image\//.test(file.type)) {
      jn.composer.file = file;
      jn.composer.preview = URL.createObjectURL(file);
      jn.composer.keepImage = false;
    }
    journalNotesPaint();
  }

  async function journalNotesSave() {
    const jn = jnotes();
    const api = online();
    const c = jn.composer;
    if (!api || !c || jn.status !== "ready" || jn.saving) return;
    journalNotesReadComposer();
    const text = c.text.trim();
    if (!text && !c.file && !c.keepImage) {
      jn.notice = { kind: "err", text: "Write a note or attach a screenshot first." };
      journalNotesPaint(); return;
    }
    jn.saving = true; jn.notice = null;
    journalNotesPaint();
    try {
      await api.saveJournalEntry(jn.uid, { text, imageFile: c.file, entryId: c.entryId });
      /* read back rather than patched in: the timestamps are the server's */
      jn.entries = await api.getJournalEntries(jn.uid);
      journalNotesDropPreview();
      jn.composer = null;
      jn.notice = { kind: "ok", text: c.entryId ? "Note updated." : "Saved — it's on every device you sign in on." };
    } catch (e) {
      jn.notice = { kind: "err", text: "Couldn't save — check your connection and try again." };
    }
    jn.saving = false;
    if (state.view === "journal") journalNotesPaint();
  }

  async function journalNotesDelete(id) {
    const jn = jnotes();
    const api = online();
    if (!api || jn.status !== "ready") return;
    jn.confirmDel = null;
    try {
      await api.deleteJournalEntry(jn.uid, id);
      jn.entries = (jn.entries || []).filter((e) => e.id !== id);
      if (jn.open === id) jn.open = null;
      jn.notice = { kind: "ok", text: "Note deleted." };
    } catch (e) {
      jn.notice = { kind: "err", text: "Couldn't delete — check your connection." };
    }
    if (state.view === "journal") journalNotesPaint();
  }

  /* the feed is repainted on its own so the ledger above it — and the scroll
     position — stay put; the whole journal re-renders on its own schedule */
  function journalNotesPaint() {
    const host = document.getElementById("jNotes");
    if (host && state.view === "journal") host.outerHTML = journalNotesHTML();
  }

  function journalNoteWhen(e) {
    const s = e.createdAt && e.createdAt.seconds;
    return s ? pwHubWhen(s * 1000) : "Just now";
  }

  function journalNotesHTML() {
    const jn = jnotes();
    const wrap = (inner) => `
      <div class="jn" id="jNotes">
        <div class="jn-head">
          <span class="jn-title">Trade Notes</span>
          <span class="jn-sub">Synced to your account</span>
          ${jn.status === "ready" && !jn.composer
            ? `<button type="button" class="jn-add" data-jnote-new>+ Note</button>` : ""}
        </div>${inner}</div>`;
    if (jn.status === "idle" || jn.status === "loading") {
      return wrap(`<div class="jn-line"><span class="pw-spinner sm" aria-hidden="true"></span> Loading your notes…</div>`);
    }
    if (jn.status === "offline") {
      return wrap(`<div class="jn-line">You're offline. Your notes and screenshots show when you're back on a connection.</div>
        <button type="button" class="ad-back" data-jnote-retry>Try Again</button>`);
    }
    if (jn.status === "signin") {
      return wrap(`<div class="jn-line">Sign in to keep trade notes and screenshots on your account, on every device.</div>
        <button type="button" class="ad-save" data-jnote-signin>Sign In</button>`);
    }
    if (jn.status === "error") {
      return wrap(`<div class="jn-line">Couldn't load your notes.</div>
        <button type="button" class="ad-back" data-jnote-retry>Try Again</button>`);
    }
    const c = jn.composer;
    const n = jn.notice;
    const composer = c ? `
      <div class="jn-composer">
        <textarea class="mt-input jn-text" id="jnoteText" rows="3" maxlength="${JNOTE_MAX}"
                  placeholder="What happened on this trade? Setup, entry, exit, what you'd do differently…">${esc(c.text)}</textarea>
        ${c.preview
          ? `<div class="jn-pic"><img src="${esc(c.preview)}" alt="Screenshot to attach">
               <button type="button" class="jn-pic-x" data-jnote-img-clear aria-label="Remove screenshot">×</button></div>`
          : c.keepImage
            ? `<div class="jn-line small">Keeps the saved screenshot — attach a new one to replace it.</div>` : ""}
        <div class="jn-row">
          <button type="button" class="btn-secondary jn-attach" data-jnote-img>
            ${c.preview || c.keepImage ? "Replace Screenshot" : "Attach Screenshot"}</button>
          <button type="button" class="btn-primary jn-save" data-jnote-save${jn.saving ? " disabled" : ""}>
            ${jn.saving ? "Saving…" : c.entryId ? "Update Note" : "Save Note"}</button>
        </div>
        <button type="button" class="jn-cancel" data-jnote-cancel>Cancel</button>
      </div>` : "";
    const list = (jn.entries || []);
    const rows = list.length ? list.map((e) => {
      const open = jn.open === e.id;
      const ask = jn.confirmDel === e.id;
      return `
        <div class="jn-note${open ? " open" : ""}">
          ${e.tradeImage ? `
            <button type="button" class="jn-thumb" data-jnote-open="${esc(e.id)}"
                    aria-expanded="${open}" aria-label="${open ? "Shrink" : "Show"} the screenshot">
              <img src="${esc(e.tradeImage)}" alt="Trade screenshot" draggable="false">
            </button>` : ""}
          <div class="jn-body">
            ${e.text ? `<div class="jn-note-text">${esc(e.text)}</div>` : `<div class="jn-note-text muted">Screenshot only</div>`}
            <div class="jn-meta">
              <span class="jn-when">${esc(journalNoteWhen(e))}</span>
              ${ask ? `
                <span class="jn-ask">Delete this note?</span>
                <button type="button" class="jn-act danger" data-jnote-del-yes="${esc(e.id)}">Delete</button>
                <button type="button" class="jn-act" data-jnote-del-no>Keep</button>` : `
                <button type="button" class="jn-act" data-jnote-edit="${esc(e.id)}">Edit</button>
                <button type="button" class="jn-act" data-jnote-del="${esc(e.id)}">Delete</button>`}
            </div>
          </div>
        </div>`;
    }).join("") : (c ? "" : `<div class="jn-line">No notes yet. Add one after a trade — a line on what happened, and the chart if you have it.</div>`);
    return wrap(`${composer}${n ? `<div class="pr-notice ${esc(n.kind)}">${esc(n.text)}</div>` : ""}<div class="jn-list">${rows}</div>`);
  }

  /* The daily sections are one section as far as the chrome is concerned:
     same bar, same dock slot */
  function inChecklist() {
    return state.view === "checkin" || state.view === "beforetrade"
      || state.view === "aftertrade" || state.view === "streak";
  }

  /* every Gameæway view — the selector and both games — shares the same bar
     and the same dock slot */
  const PK_VIEWS = ["games", "pickaeway", "buildmatch", "stake", "match", "result", "replay", "pointaeway", "placeaway"];
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
    /* Connections is a room off the profile, so it wears the profile's bar
       rather than the progress bar every other screen falls back to */
    const pr = state.view === "profile" || state.view === "connections";
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
    if (state.view !== "placeaway") paAbort();
    /* walking away from a review is how the logged answers are kept: the
       working set may hold an abandoned edit, so the flag has to go with the
       screen or coming back would show the rows instead of the result */
    if (state.view !== "checkin") state.checkinReview = false;
    const listy = state.view === "home" || state.view === "videos"
      || inChecklist() || state.view === "journal" || state.view === "profile" || inPickaeway();
    $("cardOuter").classList.toggle("outline-bg", listy);
    if (!inChecklist()) cardScroll.classList.remove("ci-resulting");
    syncCheckinChrome();
    syncDockActive();
    /* The panel owns the middle of the screen while it is open. It renders
       after the view so the view's own bar title and chrome are still set —
       only the body is taken over, and closing the panel puts the view back
       without it having to re-run anything. */
    if (state.view === "home") renderHome();
    else if (state.view === "videos") renderVideos();
    else if (state.view === "checkin") renderCheckin();
    else if (state.view === "beforetrade") renderBeforeTrade();
    else if (state.view === "aftertrade") renderAfterTrade();
    else if (state.view === "streak") renderStreak();
    else if (state.view === "journal") renderJournal();
    else if (state.view === "aehome") renderAeHome();
    else if (state.view === "games") renderGames();
    else if (state.view === "placeaway") renderPlaceaway();
    else if (state.view === "pickaeway") renderPickaeway();
    else if (state.view === "pointaeway") renderPointaeway();
    else if (state.view === "buildmatch") renderBuildMatch();
    else if (state.view === "stake") renderStake();
    else if (state.view === "match") renderMatch();
    else if (state.view === "result") renderResult();
    else if (state.view === "replay") renderReplay();
    else if (state.view === "profile") renderProfile();
    else if (state.view === "connections") renderConnections();
    else if (state.view === "contents") renderContents();
    else renderScreen();

    /* Last, so it takes the body over from whatever just wrote it. The view
       keeps its bars and its footer state; only cardScroll changes hands. */
    /* A panel sits over the view it was opened on. Navigating anywhere — the
       dock, a tile, a bar icon — is leaving that view, so the panel goes with
       it rather than hanging over the new screen. */
    if (state.panel && state.panelView !== state.view) { state.panel = null; state.panelView = null; }
    cardScroll.classList.toggle("has-panel", !!state.panel);
    $("btnChart").classList.toggle("on", state.panel === "tools");
    $("btnSettings").classList.toggle("on", state.panel === "settings");
    if (state.panel) {
      stopAudio();
      cardFooter.style.display = "none";
      cardScroll.classList.remove("pa-playing", "pw-playing", "pw-introing", "pw-savedscreen", "ci-resulting");
      /* The ÆWAY chart is the one panel that has to fill the height rather than
         sit at its natural size: its plot is whatever is left after the head
         and the calls, and a chart that chose its own height would either
         overflow the screen or waste it. Everything else keeps the layout it
         had, which is what the class is for. */
      const awFill = state.panel === "tools" && (state.tpTab || "chart") === "chart" &&
        state.tpMode === "aeway" && !state.awView && !state.tpPractice && !state.tpPatOpen;
      cardScroll.innerHTML = `<div class="ip-panel${awFill ? " aw-fill" : ""}">
        <div class="ip-head">
          <span class="ip-title">${state.panel === "settings" ? "Settings" : "Tools"}</span>
          <button class="ip-close" data-panel-close aria-label="Close">✕</button>
        </div>
        ${state.panel === "settings" ? settingsPanelHTML() : toolsPanelHTML()}
      </div>`;
      cardScroll.scrollTop = 0;
    }

    /* ---- the ÆWAY chart's own life ----
       It is the only screen in the app with a clock in it, so it is started and
       stopped by whether it is on screen rather than by a route: the canvas it
       paints into is either in the document or it is not. */
    /* The recording is fetched the first time an ÆWAY screen is drawn, and the
       canvas only exists once it has arrived — so the boot cannot wait for the
       canvas to appear, or neither would ever happen. It hangs off the head
       instead, which is on the screen from the first paint. */
    if (document.querySelector(".aw-head, #awCmp")) awBoot();
    if (document.querySelector(".aw-canvas")) {
      awStart();
      requestAnimationFrame(() => { awPaint(); awPaintPanel(); });
    } else {
      awStop();
      if (document.getElementById("awCmp")) requestAnimationFrame(awPaintCompare);
    }

    /* ==> invites.js: the bar stands down on the one screen that lists every
       challenge in full, and stands up everywhere else, so it has to be
       settled after the view is decided rather than when a challenge lands */
    syncChallengeBar();
    /* the live print belongs to one screen only, so every other one takes it
       down on the way in */
    syncChartPanel();
  }

  /* ==================== Course Contents ====================
     Every section and every page of the course, in the order they are taught,
     on one screen a lesson is one tap from. Before this the only way from one
     page to another was the next arrow, one screen at a time, or the long way
     back through the home outline.

     It is a screen rather than a layer over one: nothing in this app opens on
     a dimmed background, and 221 rows is a scroll, not a popup. The page it
     was opened from is marked, and the list arrives already scrolled to it —
     with a list this long, opening at the top would be the same problem in a
     different shape. */

  function openContents() {
    stopAudio();
    state.contentsFrom = state.view === "screen" ? state.current : null;
    state.view = "contents";
    state.slideDir = 0;
    closeOverlay();
    render();
    /* the page it came from, brought into view rather than looked for */
    const here = cardScroll.querySelector(".ct-row.here");
    if (here) {
      const top = here.offsetTop - Math.round(cardScroll.clientHeight / 2) + here.offsetHeight;
      cardScroll.scrollTop = Math.max(0, top);
    }
  }

  function closeContents() {
    state.view = "screen";
    state.slideDir = 0;
    render();
  }

  function renderContents() {
    barTitle.textContent = "Course Contents";
    const ov = overallProgress();
    progressLabel.textContent = `${ov.pct}%`;
    progressFill.style.width = `${ov.pct}%`;
    cardFooter.style.display = "none";

    const hereId = state.contentsFrom != null && screens[state.contentsFrom]
      ? screens[state.contentsFrom].scr.id : null;

    /* the flat list already holds every page in teaching order with its
       module, section and subsection on it, so the grouping is a walk rather
       than a second traversal of the data */
    let html = "";
    let mod = null, sec = null;
    screens.forEach((e, i) => {
      if (e.mod !== mod) {
        mod = e.mod; sec = null;
        html += `<div class="ct-mod">Module ${e.mi + 1}<i>${esc(mod.title)}</i></div>`;
      }
      if (e.sec !== sec) {
        sec = e.sec;
        const p = secProgress(sec);
        html += `
          <div class="ct-sec">
            <span class="ct-sec-title">${esc(sec.title)}</span>
            <span class="pct-badge ${p.pct === 100 ? "done" : ""}" style="--pct:${p.pct}">${p.pct}%</span>
          </div>`;
      }
      /* what to call a page: its own subhead where it has one, the
         subsection's title where it does not, and the headline as the last
         resort — the first page of a section carries no subhead at all */
      const label = e.scr.subhead || e.sub.title || e.scr.headline;
      const many = e.sub.screens.length > 1;
      const here = e.scr.id === hereId;
      html += `
        <button type="button" class="ct-row${here ? " here" : ""}${store.visited[e.scr.id] ? " seen" : ""}"
                data-screen="${esc(e.scr.id)}"${here ? ' aria-current="page"' : ""}>
          <span class="ct-n">${i + 1}</span>
          <span class="ct-label">${esc(label)}${many
            ? `<i>Page ${e.ki + 1} of ${e.sub.screens.length}</i>` : ""}</span>
          <span class="ct-go" aria-hidden="true">${here ? "●" : "›"}</span>
        </button>`;
    });

    cardScroll.innerHTML = `
      <div class="ct">
        <div class="pw-lib-head">
          <button type="button" class="pw-hub-back" data-contents-back
                  aria-label="Back to the lesson">
            <img src="assets/nav-icons/icon-arrow-back@2x.png" alt="">
          </button>
          <span class="pw-lib-title">Course Contents</span>
        </div>
        <div class="ct-cap">${screens.length} pages · tap any one to jump straight to it</div>
        ${html}
      </div>`;
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

  /* ---------------- the Æway home page ----------------
     A hub, not a screen with content of its own: everything on it is either a
     real number the app already holds or a way into somewhere else. The
     snapshot reads the same sources the Check-In bar and the Journal read, so
     it cannot drift from them. */

  /* Every trade the journal knows about, imported or typed. */
  function aeAllTrades() {
    const out = [];
    (store.journalAccounts || []).forEach((a) => {
      (store.journalTrades[a.id] || []).forEach((t) => out.push(t));
      Object.keys((store.journalManual || {})[a.id] || {}).forEach((day) => {
        ((store.journalManual[a.id] || {})[day] || []).forEach((e) =>
          out.push({ date: day, pnl: Number(e.pnl) || 0 }));
      });
    });
    return out;
  }

  /* The next session boundary in New York hours: 3am Europe, 7am New York,
     5pm Asia — the same three the header clock names. */
  function aeNextSession() {
    const h = easternHour(new Date());
    const marks = [[3, "Europe"], [7, "New York"], [17, "Asia"]];
    for (const [at, name] of marks) if (h < at) return { name, at };
    return { name: "Europe", at: 3, tomorrow: true };
  }

  function aeHomeHTML() {
    const streak = disciplineStreak();
    const doneToday = sectionsDone(todayKey());
    const trades = aeAllTrades();
    const key = todayKey();
    const today = trades.filter((t) => t.date === key).reduce((a, t) => a + (Number(t.pnl) || 0), 0);
    const all = trades.reduce((a, t) => a + (Number(t.pnl) || 0), 0);
    const nx = aeNextSession();
    const prog = overallProgress();
    const entry = screens[state.current];
    const lesson = entry ? entry.scr.title || entry.sec.title : null;

    const TILES = [
      { id: "journal", label: "Trade Journal", icon: "assets/nav-icons/icon-trade-journal@2x.png" },
      { id: "checkin", label: "Trade Day Check-In", icon: "assets/nav-icons/icon-trade-day@2x.png" },
      /* the same controller the dock's fourth slot took, and the same short
         word: the ascending bars mean chart access now, everywhere */
      { id: "games", label: "Game", icon: "assets/nav-icons/icon-dock-games@2x.png" },
      { id: "learn", label: "Learn", icon: "assets/nav-icons/icon-learn@2x.png" },
    ];

    return `
      ${/* Featured Connection stood here and is gone: it was a slot waiting
            for a curation feature that is not being built, so what it actually
            showed every visitor was a line saying so. store.featured is left
            alone — nothing writes it, and dropping it from the store would
            rewrite every saved profile for no gain. */""}
      <div class="ae-home">
        <div class="ae-cap">Today</div>
        <div class="ae-snap">
          <div class="ae-snap-cell">
            <b class="${streak > 0 ? "on" : ""}">${streak}</b>
            <span>Day streak</span>
          </div>
          <div class="ae-snap-cell">
            <b class="${today > 0 ? "up" : today < 0 ? "down" : ""}">${trades.length ? money(today) : "—"}</b>
            <span>P&amp;L today</span>
          </div>
          <div class="ae-snap-cell">
            <b class="${all > 0 ? "up" : all < 0 ? "down" : ""}">${trades.length ? money(all) : "—"}</b>
            <span>All time</span>
          </div>
        </div>
        <div class="ae-line">
          <span>Check-In</span><b>${doneToday} of ${DAY_SECTIONS.length} done today</b>
        </div>
        <div class="ae-line">
          <span>Next session</span><b>${esc(nx.name)} at ${nx.at > 12 ? nx.at - 12 : nx.at}${
            nx.at >= 12 ? "pm" : "am"} ET${nx.tomorrow ? " tomorrow" : ""}</b>
        </div>

        <button class="ae-resume" data-ae-go="resume">
          <span class="ae-resume-cap">Continue where you left off</span>
          <span class="ae-resume-name">${esc(lesson || "Start the course")}</span>
          <span class="ae-resume-sub">${prog.done} of ${prog.total} screens · ${prog.pct}%</span>
        </button>

        <div class="ae-cap">Jump in</div>
        <div class="ae-tiles">
          ${TILES.map((t) => `
            <button class="ae-tile" data-ae-go="${t.id}">
              <img src="${t.icon}" alt="">
              <span>${esc(t.label)}</span>
            </button>`).join("")}
        </div>
      </div>`;
  }

  function renderAeHome() {
    barTitle.textContent = "Æway";
    cardFooter.style.display = "none";
    cardScroll.innerHTML = aeHomeHTML();
    cardScroll.scrollTop = 0;
  }

  function openAeHome() {
    stopAudio();
    state.view = "aehome";
    state.slideDir = 0;
    state.panel = null;
    closeOverlay();
    render();
  }

  /* ---------------- the hamburger's four sections ----------------

     WHAT IS REAL AND WHAT IS NOT. The brief said this content already existed
     as desktop panels to surface here. It does not: .dt-panel-square,
     -chart and -wide are decorative 9-slice frames with no content — app.js
     never writes into them, which is why this had to be built rather than
     moved. So each section below is real UI, and the ones with no data source
     yet say so on screen rather than pretending:

       Practice chart   — real. Seeded candles, a timeframe switch, a moving
                          average and a tap-placed level. Nothing to connect.
       MarketWatch      — SAMPLE PRICES. Deterministic per instrument per day
                          so the list is stable rather than flickering, but no
                          feed is wired. ==> BACKEND
       Plan             — reads store.plan, which nothing sets yet, so it shows
                          the free tier. ==> BACKEND for real billing.
       Economic calendar— SAMPLE EVENTS on this week's real dates. ==> BACKEND

     The Trade Journal already ships on the same footing and says so, so this
     is the app's existing convention rather than a new one. */

  const TP_TABS = [
    { id: "chart", label: "Chart" },
    { id: "watch", label: "Watchlist" },
    { id: "cal", label: "Calendar" },
  ];

  /* Eight intraday timeframes. `vol` scales the move per bar so a 1-minute
     chart is visibly quieter than a 4-hour one — the same series generator
     with a different step, which is what makes switching feel like a real
     timeframe change rather than a reshuffle. */
  const TP_TFS = [
    { id: "1m",  label: "1m",  vol: 0.35, min: 1 },
    { id: "2m",  label: "2m",  vol: 0.45, min: 2 },
    { id: "3m",  label: "3m",  vol: 0.55, min: 3 },
    { id: "5m",  label: "5m",  vol: 0.7,  min: 5 },
    { id: "15m", label: "15m", vol: 1.0,  min: 15 },
    { id: "30m", label: "30m", vol: 1.3,  min: 30 },
    { id: "1h",  label: "1h",  vol: 1.7,  min: 60 },
    { id: "4h",  label: "4h",  vol: 2.4,  min: 240 },
    { id: "1D",  label: "1D",  vol: 3.6,  min: 1440 },
  ];

  /* The instrument universe the search looks through. No feed behind it, so
     this list IS the market as far as the app is concerned. ==> BACKEND */
  const TP_UNIVERSE = [
    { sym: "ES",   name: "E-mini S&P 500",   base: 5480 },
    { sym: "NQ",   name: "E-mini Nasdaq",    base: 19240 },
    { sym: "YM",   name: "E-mini Dow",       base: 40120 },
    { sym: "RTY",  name: "E-mini Russell",   base: 2140 },
    { sym: "CL",   name: "Crude Oil",        base: 78.4 },
    { sym: "NG",   name: "Natural Gas",      base: 2.61 },
    { sym: "GC",   name: "Gold",             base: 2412 },
    { sym: "SI",   name: "Silver",           base: 28.6 },
    { sym: "HG",   name: "Copper",           base: 4.28 },
    { sym: "ZB",   name: "30Y T-Bond",       base: 118.2 },
    { sym: "ZN",   name: "10Y T-Note",       base: 110.4 },
    { sym: "6E",   name: "Euro FX",          base: 1.084 },
    { sym: "6J",   name: "Japanese Yen",     base: 0.00642 },
    { sym: "6B",   name: "British Pound",    base: 1.271 },
    { sym: "6A",   name: "Australian Dollar", base: 0.664 },
    { sym: "6C",   name: "Canadian Dollar",  base: 0.731 },
    { sym: "EURUSD", name: "Euro / Dollar",  base: 1.0843 },
    { sym: "GBPUSD", name: "Pound / Dollar", base: 1.2712 },
    { sym: "USDJPY", name: "Dollar / Yen",   base: 155.8 },
    { sym: "AUDUSD", name: "Aussie / Dollar", base: 0.6641 },
    { sym: "USDCAD", name: "Dollar / Loonie", base: 1.3684 },
    { sym: "XAUUSD", name: "Gold Spot",      base: 2412 },
    { sym: "BTC",  name: "Bitcoin",          base: 64150 },
    { sym: "ETH",  name: "Ethereum",         base: 3412 },
    { sym: "SOL",  name: "Solana",           base: 148.2 },
    { sym: "AAPL", name: "Apple",            base: 214.3 },
    { sym: "MSFT", name: "Microsoft",        base: 428.6 },
    { sym: "NVDA", name: "NVIDIA",           base: 124.8 },
    { sym: "TSLA", name: "Tesla",            base: 248.5 },
    { sym: "AMZN", name: "Amazon",           base: 186.4 },
    { sym: "META", name: "Meta",             base: 502.1 },
    { sym: "GOOGL", name: "Alphabet",        base: 178.9 },
    { sym: "SPY",  name: "S&P 500 ETF",      base: 546.2 },
    { sym: "QQQ",  name: "Nasdaq 100 ETF",   base: 472.8 },
    { sym: "IWM",  name: "Russell 2000 ETF", base: 213.4 },
  ];
  const TP_UNI = {};
  TP_UNIVERSE.forEach((r) => { TP_UNI[r.sym] = r; });

  /* Names an economic calendar draws from. Which of them land on a given day
     comes from the date itself, so any date the user navigates to has a
     stable, plausible set rather than an empty page. ==> BACKEND */
  const TP_EVENT_POOL = [
    { cur: "USD", imp: 3, name: "Non-Farm Payrolls" },
    { cur: "USD", imp: 3, name: "CPI m/m" },
    { cur: "USD", imp: 3, name: "FOMC Rate Decision" },
    { cur: "USD", imp: 3, name: "Retail Sales m/m" },
    { cur: "USD", imp: 2, name: "ISM Services PMI" },
    { cur: "USD", imp: 2, name: "Unemployment Claims" },
    { cur: "USD", imp: 2, name: "Crude Oil Inventories" },
    { cur: "USD", imp: 1, name: "Consumer Sentiment" },
    { cur: "EUR", imp: 3, name: "ECB Rate Decision" },
    { cur: "EUR", imp: 2, name: "ECB Economic Bulletin" },
    { cur: "EUR", imp: 2, name: "German Ifo Business Climate" },
    { cur: "EUR", imp: 1, name: "Trade Balance" },
    { cur: "GBP", imp: 3, name: "BoE Rate Decision" },
    { cur: "GBP", imp: 2, name: "GDP m/m" },
    { cur: "JPY", imp: 2, name: "BoJ Summary of Opinions" },
    { cur: "JPY", imp: 1, name: "Tokyo Core CPI" },
    { cur: "AUD", imp: 2, name: "RBA Rate Statement" },
    { cur: "CAD", imp: 2, name: "Employment Change" },
  ];
  const TP_EVENT_TIMES = ["02:00", "04:00", "07:00", "08:30", "10:00", "12:30", "14:00", "23:50"];

  /* One number per instrument per day, from the symbol and the date. Stable
     while the app is open and across a reload, which a Math.random() would
     not be — a watchlist that reshuffles on every render reads as broken
     rather than as a placeholder. */
  function tpQuote(row, dayKey) {
    let h = 2166136261;
    for (const ch of row.sym + dayKey) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    const r = ((h >>> 0) % 10000) / 10000;
    const pct = (r - 0.5) * 2 * 1.8;                 // ±1.8%
    const last = row.base * (1 + pct / 100);
    return { last: tpFmtPx(last, row.base), pct };
  }
  const tpFmtPx = (v, base) =>
    v.toFixed(base < 0.1 ? 5 : base < 10 ? 4 : base < 200 ? 2 : base < 5000 ? 2 : 0);

  const tpWatchlist = () => (store.watchlist && store.watchlist.length ? store.watchlist : ["ES"]);
  const tpSymbol = () => {
    const list = tpWatchlist();
    return list.indexOf(state.tpSym) >= 0 ? state.tpSym : list[0];
  };

  /* ---- the chart's data ----
     A long series per symbol and timeframe, generated once and kept, so
     panning and zooming move a window over the same bars instead of drawing
     new ones — a chart whose history changed as you scrolled back would not
     be a chart. */
  /* ==================== STORY ENGINE ====================
     The practice chart is not a random walk any more. A story is a chain of
     phase primitives, each one a small parameterised generator that reliably
     reads as its own type while never printing the same twice. Ten of them,
     which is the whole vocabulary the chart teaches.

     The composed sequence — the primitives, their parameters and the seed —
     is the story's code. It exists so a story can be reproduced and audited.
     It is deliberately not rendered anywhere a user can reach: the chart
     shows candles and nothing else. ==> seStoryCode / seLogStory. */

  const SE_PRIMS = [
    { id: "range",         label: "Range Set" },
    { id: "breakout",      label: "Breakout" },
    { id: "fakeout",       label: "Fakeout" },
    { id: "retrace",       label: "Retracement" },
    { id: "rejectsoft",    label: "Rejection (soft)" },
    { id: "rejecthard",    label: "Rejection (hard)" },
    { id: "retest",        label: "Retest" },
    { id: "continuation",  label: "Continuation" },
    { id: "reversal",      label: "Reversal" },
    { id: "consolidation", label: "Consolidation" },
  ];
  const SE_LABEL = {};
  SE_PRIMS.forEach((p) => { SE_LABEL[p.id] = p.label; });

  /* What can plausibly follow what. A fakeout wants a reversal after it, a
     breakout wants a retest or a continuation, a retracement wants to be
     rejected. The weights are what stop every story reading the same. */
  const SE_NEXT = {
    range:         [["breakout", 5], ["fakeout", 3], ["consolidation", 2]],
    breakout:      [["retest", 4], ["continuation", 4], ["fakeout", 2], ["retrace", 2]],
    fakeout:       [["reversal", 5], ["retrace", 3], ["rejecthard", 2]],
    retrace:       [["rejecthard", 4], ["rejectsoft", 3], ["continuation", 2], ["retest", 2]],
    rejectsoft:    [["retrace", 3], ["continuation", 3], ["consolidation", 2]],
    rejecthard:    [["continuation", 5], ["breakout", 3], ["retrace", 2]],
    retest:        [["rejecthard", 4], ["continuation", 4], ["rejectsoft", 2], ["fakeout", 1]],
    continuation:  [["retrace", 4], ["consolidation", 3], ["reversal", 2], ["breakout", 2]],
    reversal:      [["continuation", 4], ["retrace", 3], ["retest", 2]],
    consolidation: [["breakout", 4], ["fakeout", 3], ["continuation", 2], ["range", 1]],
  };

  function sePick(list, r) {
    const total = list.reduce((a, x) => a + x[1], 0);
    let t = r() * total;
    for (const [id, w] of list) { t -= w; if (t <= 0) return id; }
    return list[list.length - 1][0];
  }
  const seInt = (lo, hi, r) => Math.floor(lo + r() * (hi - lo + 1));

  /* One candle, from wherever price is to wherever this primitive wants it.
     `wick` is the primitive's own noisiness; clarity scales it down for a
     reader who has not been taught much yet. */
  function seCandle(ctx, close, wick, r) {
    const open = ctx.price;
    const w = ctx.step * wick;
    const high = Math.max(open, close) + w * (0.25 + r() * 0.85);
    const low = Math.min(open, close) - w * (0.25 + r() * 0.85);
    ctx.price = close;
    ctx.hi = Math.max(ctx.hi, high);
    ctx.lo = Math.min(ctx.lo, low);
    const c = { open, close, high, low, dir: close > open ? "up" : "down" };
    ctx.out.push(c);
    return c;
  }

  /* Every primitive takes the same context and returns the parameters it
     chose, which is what the story code is made of. `c` is clarity: 1 is a
     textbook signature, 0 is as messy as real price gets. */
  const SE_BUILD = {
    range(ctx, r, c) {
      const n = seInt(4, 7, r);
      const half = ctx.step * (1.1 + r() * 0.7);
      const mid = ctx.price;
      for (let i = 0; i < n; i++) {
        const t = (r() - 0.5) * 2;
        seCandle(ctx, mid + t * half, 0.5 + (1 - c) * 0.8, r);
      }
      ctx.rangeHi = mid + half; ctx.rangeLo = mid - half;
      ctx.ref = ctx.price > mid ? ctx.rangeHi : ctx.rangeLo;
      return { n, half: +(half / ctx.step).toFixed(2) };
    },
    breakout(ctx, r, c) {
      const n = seInt(3, 5, r);
      const dir = ctx.dir = ctx.rangeHi != null && r() < 0.5 ? -1 : (ctx.dir || 1);
      const level = dir > 0 ? (ctx.rangeHi != null ? ctx.rangeHi : ctx.price) : (ctx.rangeLo != null ? ctx.rangeLo : ctx.price);
      ctx.ref = level;
      const mag = (1.4 + r() * 1.1) * (0.7 + c * 0.6);
      for (let i = 0; i < n; i++) {
        seCandle(ctx, ctx.price + dir * ctx.step * mag * (0.8 + r() * 0.5),
          0.35 + (1 - c) * 0.7, r);
      }
      ctx.broke = level;
      return { n, dir, mag: +mag.toFixed(2) };
    },
    fakeout(ctx, r, c) {
      const n = seInt(3, 5, r);
      const dir = ctx.dir || 1;
      const level = ctx.ref != null ? ctx.ref : ctx.price;
      /* out past the level, then straight back through it */
      const push = seInt(1, 2, r);
      for (let i = 0; i < push; i++) {
        seCandle(ctx, ctx.price + dir * ctx.step * (0.9 + r() * 0.7), 0.6 + (1 - c) * 0.8, r);
      }
      for (let i = push; i < n; i++) {
        const back = level - dir * ctx.step * (0.5 + r() * 0.9) * ((i - push + 1) / (n - push));
        seCandle(ctx, back, 0.5 + (1 - c) * 0.7, r);
      }
      ctx.dir = -dir;
      ctx.ref = level;
      return { n, dir, push };
    },
    retrace(ctx, r, c) {
      const n = seInt(3, 6, r);
      /* toward a fraction of the leg just travelled — 50% unless the roll
         says otherwise, which is what makes a fib discount recognisable */
      const frac = [0.382, 0.5, 0.5, 0.618][seInt(0, 3, r)];
      const from = ctx.legFrom != null ? ctx.legFrom : ctx.price;
      const target = ctx.price + (from - ctx.price) * frac;
      for (let i = 0; i < n; i++) {
        const t = (i + 1) / n;
        seCandle(ctx, ctx.price + (target - ctx.price) * t / (1 - (i / n) * 0.5),
          0.45 + (1 - c) * 0.7, r);
      }
      ctx.ref = target;
      return { n, frac };
    },
    rejectsoft(ctx, r, c) {
      const n = seInt(2, 4, r);
      const away = ctx.dir || -1;
      for (let i = 0; i < n; i++) {
        seCandle(ctx, ctx.price - away * ctx.step * (0.25 + r() * 0.4), 0.7 + (1 - c) * 0.6, r);
      }
      return { n };
    },
    rejecthard(ctx, r, c) {
      const n = seInt(2, 4, r);
      const away = -(ctx.dir || 1);
      /* the tell is the wick: a long one into the level, then a body away */
      seCandle(ctx, ctx.price + away * ctx.step * 0.2, 1.8 + (1 - c) * 0.9, r);
      for (let i = 1; i < n; i++) {
        seCandle(ctx, ctx.price + away * ctx.step * (1.2 + r() * 0.9) * (0.7 + c * 0.6),
          0.3 + (1 - c) * 0.6, r);
      }
      ctx.dir = away;
      ctx.legFrom = ctx.price;
      return { n, dir: away };
    },
    retest(ctx, r, c) {
      const n = seInt(3, 5, r);
      const level = ctx.broke != null ? ctx.broke : ctx.ref != null ? ctx.ref : ctx.price;
      for (let i = 0; i < n; i++) {
        const t = (i + 1) / n;
        seCandle(ctx, ctx.price + (level - ctx.price) * t * 0.9, 0.5 + (1 - c) * 0.7, r);
      }
      ctx.ref = level;
      return { n, level: +(level).toFixed(2) };
    },
    continuation(ctx, r, c) {
      const n = seInt(4, 7, r);
      const dir = ctx.dir || 1;
      ctx.legFrom = ctx.price;
      const mag = (0.9 + r() * 0.8) * (0.75 + c * 0.5);
      for (let i = 0; i < n; i++) {
        /* a pause candle now and then, more of them the messier it gets */
        const pause = r() > 0.55 + c * 0.3;
        seCandle(ctx, ctx.price + dir * ctx.step * mag * (pause ? 0.15 : 0.8 + r() * 0.6),
          0.4 + (1 - c) * 0.7, r);
      }
      return { n, dir, mag: +mag.toFixed(2) };
    },
    reversal(ctx, r, c) {
      const n = seInt(4, 7, r);
      const dir = ctx.dir || 1;
      const stall = Math.max(1, Math.round(n * 0.4));
      for (let i = 0; i < stall; i++) {
        seCandle(ctx, ctx.price + dir * ctx.step * (0.1 + r() * 0.25), 1.2 + (1 - c) * 0.8, r);
      }
      ctx.dir = -dir;
      ctx.legFrom = ctx.price;
      for (let i = stall; i < n; i++) {
        seCandle(ctx, ctx.price - dir * ctx.step * (0.8 + r() * 0.8) * (0.75 + c * 0.5),
          0.4 + (1 - c) * 0.6, r);
      }
      return { n, from: dir, stall };
    },
    consolidation(ctx, r, c) {
      const n = seInt(4, 7, r);
      const half = ctx.step * (0.35 + r() * 0.3);
      const mid = ctx.price;
      for (let i = 0; i < n; i++) {
        seCandle(ctx, mid + (r() - 0.5) * 2 * half, 0.6 + (1 - c) * 0.7, r);
      }
      ctx.rangeHi = mid + half; ctx.rangeLo = mid - half;
      return { n, half: +(half / ctx.step).toFixed(2) };
    },
  };

  /* How clean a story reads, from how much of the course has been visited.
     A reader at the start gets textbook signatures; one who has been through
     it gets something closer to what price actually looks like. */
  function seClarity() {
    const pct = overallProgress().pct;
    return Math.max(0.15, Math.min(1, 1 - pct / 100 * 0.85));
  }

  /* Which named strategy a composed sequence reads as — the same nine the
     Before Trade checklist names. Deliberately strict: the tag is only worth
     anything if it means the story really is that shape, so the rules run on
     ADJACENT steps rather than "appears somewhere later", and a story that
     does not clearly match any of them is left untagged. */
  function seStrategy(seq) {
    const ids = seq.map((s) => s.id);
    const run = (...want) => {
      for (let i = 0; i + want.length <= ids.length; i++) {
        if (want.every((w, k) => ids[i + k] === w)) return i;
      }
      return -1;
    };
    const count = (x) => ids.filter((y) => y === x).length;
    const rejection = (i) => ids[i] === "rejecthard" || ids[i] === "rejectsoft";

    /* the opening range taken out and reclaimed */
    if (run("range", "breakout", "fakeout") >= 0
     || run("range", "breakout", "retest") >= 0) return "orb";
    /* accumulate, manipulate, distribute */
    if (run("consolidation", "fakeout") >= 0 || run("range", "fakeout") >= 0) {
      if (ids.indexOf("continuation") > ids.indexOf("fakeout")) return "amd";
    }
    /* a discount into a level that then holds */
    const rt = seq.findIndex((x, i) => x.id === "retrace" && x.p.frac >= 0.5 && rejection(i + 1));
    if (rt >= 0) return "fib";
    /* the broken level retested and carried on from */
    if (run("breakout", "retest", "continuation") >= 0) return "continuation";
    /* the imbalance left by an impulse, filled, then carried on */
    if (run("continuation", "retrace", "continuation") >= 0) return "imbalance";
    /* the trend giving out and the other side taking over */
    if (run("reversal", "continuation") >= 0) return "emacross";
    if (run("fakeout", "reversal") >= 0) return "reversal";
    if (run("continuation", "reversal") >= 0) return "trendbreak";
    /* one direction, repeatedly, with nothing turning it */
    if (count("continuation") >= 3 && !count("reversal")) return "trend";
    return null;
  }

  /* the code: sequence, parameters and seed, enough to rebuild the story */
  function seStoryCode(story) {
    return story.seq.map((s) => {
      const p = s.p || {};
      const bits = Object.keys(p).map((k) => `${k}=${p[k]}`).join(",");
      return bits ? `${s.id}[${bits}]` : s.id;
    }).join(">") + `@${story.seed}~c${story.clarity.toFixed(2)}`;
  }

  const SE_LEN = 30;                    // candles per story
  /* the pairing is a setting, not an assumption: a later build can run the
     same composer at 30 candles of 5 minutes without touching the engine */
  const SE_SPEC = { candles: SE_LEN, tfId: "1m" };

  function seBuildStory(seed, clarity, len) {
    const r = paMakeRng(seed);
    const target = len || SE_SPEC.candles;
    const ctx = { price: 0, step: 1, dir: r() < 0.5 ? 1 : -1, out: [],
      hi: -Infinity, lo: Infinity, ref: null, rangeHi: null, rangeLo: null,
      broke: null, legFrom: null };
    const seq = [];
    /* an opening range is the commonest way a session starts, not the only
       one — a story that joins a move already running is just as real */
    let id = sePick([["range", 5], ["consolidation", 3], ["continuation", 2]], r);
    while (ctx.out.length < target) {
      const before = ctx.out.length;
      const p = SE_BUILD[id](ctx, r, clarity);
      seq.push({ id, p, at: before, len: ctx.out.length - before });
      id = sePick(SE_NEXT[id], r);
    }
    ctx.out.length = target;            // the last primitive may overshoot
    const story = { seq, clarity, seed, candles: ctx.out };
    story.strategy = seStrategy(seq);
    story.code = seStoryCode(story);
    return story;
  }

  /* ---- backend-only story log ----
     Admin/audit visibility, per item 8. Kept small and local, and mirrored to
     the backend when there is a session to mirror it under. Nothing here is
     read by any user-facing screen. */
  const SE_LOG_MAX = 40;
  function seLogStory(story, sym, tfId) {
    if (!store.storyLog) store.storyLog = [];
    const rec = { at: new Date().toISOString(), sym, tf: tfId,
      code: story.code, strategy: story.strategy, clarity: +story.clarity.toFixed(2) };
    store.storyLog.push(rec);
    if (store.storyLog.length > SE_LOG_MAX) store.storyLog.splice(0, store.storyLog.length - SE_LOG_MAX);
    try { if (window.FB && FB.logStory) FB.logStory(rec); } catch (e) { /* audit is best effort */ }
  }

  const TP_BARS = 420;
  const tpCache = {};
  /* A new story every 30 minutes: the bucket is part of the seed, so the
     chart rolls over on its own without anything having to poll it. */
  const SE_ROTATE_MS = 30 * 60 * 1000;
  const seBucket = () => Math.floor(Date.now() / SE_ROTATE_MS);
  /* the composed sequences behind the cached series, for the admin hook and
     for the practice loop's questions. Never rendered on a user screen.
     Declared above tpSeries, which writes to it — a const below its own
     reader is a dead zone waiting for the first caller that runs early. */
  const tpStories = {};

  /* The chart is a run of stories laid end to end rather than one long random
     walk, so every stretch of it is something with a name. The prices are the
     instrument's own; the engine works in steps and is scaled onto them here. */
  function tpSeries(sym, tfId) {
    const bucket = seBucket();
    const key = sym + "|" + tfId + "|" + bucket;
    if (tpCache[key]) return tpCache[key];
    const tf = TP_TFS.find((t) => t.id === tfId) || TP_TFS[3];
    const row = TP_UNI[sym] || TP_UNIVERSE[0];
    const step = row.base * 0.0016 * tf.vol;
    const clarity = seClarity();
    const out = [];
    const stories = [];
    let price = row.base;
    let n = 0;
    while (out.length < TP_BARS) {
      const story = seBuildStory(`${sym}|${tfId}|${bucket}|${n}`, clarity);
      stories.push(story);
      /* the engine's candles are in steps around zero; place them on top of
         wherever the last story left the price */
      for (const c of story.candles) {
        if (out.length >= TP_BARS) break;
        out.push({
          open: price + c.open * step,
          close: price + c.close * step,
          high: price + c.high * step,
          low: price + c.low * step,
          dir: c.dir,
        });
      }
      price += (story.candles[story.candles.length - 1].close) * step;
      n++;
    }
    tpCache[key] = out;
    /* only the newest one is worth auditing — the rest are history it was
       built on top of */
    seLogStory(stories[stories.length - 1], sym, tfId);
    tpStories[key] = stories;
    return out;
  }
  function tpStoryAt(sym, tfId, globalIdx) {
    const list = tpStories[sym + "|" + tfId + "|" + seBucket()];
    if (!list) return null;
    let at = 0;
    for (const st of list) {
      if (globalIdx < at + st.candles.length) return { story: st, offset: globalIdx - at };
      at += st.candles.length;
    }
    return null;
  }
  /* the phase a given bar belongs to — the answer the practice loop marks
     against, and the only place the sequence is consulted at all */
  function tpPhaseAt(sym, tfId, globalIdx) {
    const hit = tpStoryAt(sym, tfId, globalIdx);
    if (!hit) return null;
    for (const s of hit.story.seq) {
      if (hit.offset >= s.at && hit.offset < s.at + s.len) return s.id;
    }
    return hit.story.seq[hit.story.seq.length - 1].id;
  }

  /* ==================== ÆWAY: the market, the chart, the calls ====================

     The ÆWAY chart is a live market moved only by Pointæway match results. A
     Bull winning a match takes the price up and a Bear winning takes it down,
     and nothing else touches it — a prediction never moves the price, it only
     reads it.

     Three files sit under this one and this one owns none of their work:

       js/aeway-codec.js   the recording's file format, shared with the recorder
       js/aeway-market.js  the data source: the recording today, a live feed
                           later, behind one switch. Also the playback clock.
       js/aeway-chart.js   the canvas painter and its geometry

     What is here is the screen: the markup, the state, the gestures and the
     predictions — the same things every other screen in this file owns.

     ==> THE MARKET IS A RECORDING. Ninety days of the ten-thousand-bot market
     were simulated offline and are played back against the real clock, so every
     phone shows the same chart at the same moment without a server to agree
     with. It is labelled on screen as a simulated market, because it is one. */

  const AW = () => window.AewayMarket;
  const AWC = () => window.AewayChart;

  const AW_TARGET = 200;        // what a full-candle prediction pays on a normal candle
  const AW_RATE_BARS = 12;      // how many candles the rate's average looks back over
  const AW_LOCK_MS = 15000;     // entries close this long before the candle does
  const AW_START_POINTS = 10000;
  const AW_HOLD_MS = 400;       // press and hold this long for the crosshair
  const AW_SLOP = 8;            // a drag this far is a pan rather than a hold
  const AW_SPAN_MIN = 24, AW_SPAN_MAX = 220, AW_SPAN_DEF = 64;
  const AW_HISTORY_MAX = 60;

  /* ---- the balance ----
     Play points, kept on the device.

     ==> AND KEPT ON THE DEVICE ON PURPOSE. The brief asks for the balance in
     Firestore if that can be done inside the free Spark allowance, and to say
     so if it cannot. It cannot be guaranteed: Spark allows twenty thousand
     document writes a day across the whole project, and a tester holding
     predictions on all five timeframes settles five of them every five
     minutes — fourteen hundred writes a day each, before the course, the
     journal and the notes have written anything. A dozen testers would spend
     the allowance by lunchtime, and the first thing to break would be the
     journal rather than the chart.

     So predictions never touch the cloud: they use awSave(), which writes
     localStorage and deliberately does not call pushCloudSoon(). The cost is
     that a tester who reinstalls starts again — which is what the Reset balance
     button in Settings does anyway — and the fix is the same move the brief
     already requires before points are ever worth anything: settle on a
     server. */
  function awSave() {
    try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) { /* quota */ }
  }
  const awPoints = () => (typeof store.awPoints === "number" ? store.awPoints : AW_START_POINTS);

  /* ---- is this an administrator ----
     Two ways in, both client-side, both distribution keys rather than secrets —
     the same footing as the beta access passcode this app already ships with,
     and said out loud for the same reason. The admin page shows no money and no
     user data; what it shows is the simulator's own report.

       LEARNAEWAY_CONFIG.adminEmails   the signed-in account's email, if listed
       LEARNAEWAY_CONFIG.adminPasscode typed into the prompt behind a long press
                                       on the "Simulated market" tag

     A tester who never does either sees no trace of it. */
  const awCfg = () => (window.LEARNAEWAY_CONFIG || {});
  function awIsAdmin() {
    if (state.awAdminOk) return true;
    const list = awCfg().adminEmails || [];
    const email = (window.FB && FB.user() && FB.user().email) || "";
    return !!email && list.some((e) => String(e).toLowerCase() === email.toLowerCase());
  }

  /* ---------------- boot ---------------- */

  let awReady = false, awFailed = null, awTimer = null, awRaf = 0;

  function awBoot() {
    if (awReady || !AW()) return;
    AW().ready().then(() => {
      awReady = true; awFailed = null;
      awSettleDue();
      if (document.querySelector(".aw-head, #awCmp")) render();
    }).catch((e) => {
      awFailed = String(e && e.message || e);
      if (document.querySelector(".aw-head, #awCmp")) render();
    });
  }

  /* The chart is only alive while it is on screen: one timer, started when the
     screen renders and stopped when it does not. A phone that leaves the tab
     open on the chart should not be repainting a canvas nobody is looking at,
     and a prediction that settles while the app is closed settles when it
     opens, because the recording is deterministic and the answer is the same
     whenever it is asked. */
  function awStart() {
    if (awTimer) return;
    awTimer = setInterval(awFrame, 1000);
  }
  function awStop() {
    awReadWas = "";
    if (awTimer) { clearInterval(awTimer); awTimer = null; }
    if (awRaf) { cancelAnimationFrame(awRaf); awRaf = 0; }
  }

  /* one second of market time: settle what is due, repaint the forming candle,
     move the countdown on */
  function awFrame() {
    if (!awBoxes().length) { awStop(); return; }
    const settled = awSettleDue();
    awPaintSoon();
    awPaintPanel();
    if (settled) render();
  }

  function awPaintSoon() {
    if (awRaf) return;
    awRaf = requestAnimationFrame(() => { awRaf = 0; awPaint(); });
  }

  /* ---------------- the view ---------------- */

  const awTf = () => (AW() ? AW().tfOf(state.awTf) : { id: "5m", k: 1, min: 5 });

  /* The chart's window, clamped to what exists. `from` is a bar index on the
     current timeframe; null means "follow the newest", which is where the chart
     opens and where the jump button puts it back. */
  function awWindow() {
    const tf = state.awTf;
    const last = AW().liveBar(tf);
    const first = AW().firstBar(tf);
    let span = Math.max(AW_SPAN_MIN, Math.min(AW_SPAN_MAX, Math.round(state.awSpan || AW_SPAN_DEF)));
    span = Math.min(span, Math.max(AW_SPAN_MIN, last - first + 1));
    /* the newest candle sits a little in from the right edge, the way every
       chart in the world leaves room for the price to keep going */
    const gap = Math.max(1, Math.round(span * 0.06));
    /* and that position is also as far right as the chart will go. Letting the
       window run past it looked like a bug rather than like freedom: zooming
       out would leave the candles bunched against the left edge with a third of
       the plot empty, because the window had grown rightwards into a future
       that has nothing in it. */
    const rightmost = last - span + 1 + gap;
    let from = state.awFollow || state.awFrom == null ? rightmost : state.awFrom;
    from = Math.max(first, Math.min(rightmost, Math.round(from)));
    state.awSpan = span;
    if (!state.awFollow) state.awFrom = from;
    return { tf, from, span, first, last };
  }

  function awView() {
    const w = awWindow();
    const bars = AW().bars(w.tf, w.from, w.span);
    /* The readout sits over the plot, so the plot has to start under it —
       measured rather than guessed, because it is two lines at one text size
       and three at another, and a candle drawn behind it is a candle nobody
       can read. */
    return {
      tf: w.tf, from: w.from, span: w.span, bars,
      cross: state.awCross,
      scale: awScale(),
      fontScale: awFontScale(),
      padTop: 0,          // set per box in awPaint: they are different widths
      window: w,
    };
  }

  /* the admin's projection: everything that is a count or a volume, ×100 */
  const awScale = () => (state.awProject && awIsAdmin() ? 100 : 1);
  function awFontScale() {
    const v = getComputedStyle(document.documentElement).getPropertyValue("--fs");
    const n = parseFloat(v);
    return Number.isFinite(n) && n > 0 ? n : 1;
  }

  /* ---- one paint is one paint ----
     The first version of this did three things on every frame that it only
     needed to do when something changed, and a pan came out at 28ms a frame —
     half the speed a phone needs. All three were the same mistake, which is
     doing work on the frame rather than on the change:

       - it asked the data source to load the window and painted again when that
         resolved. The days are already in memory during a pan, so the promise
         resolved immediately and every single frame painted twice.
       - it wrote the readout's innerHTML whether or not the readout had
         changed, which during a pan it usually has not.
       - it measured the readout's height to find where the plot starts, and a
         measurement straight after an innerHTML write is a forced layout.

     So the fetch only repaints when it actually brought something back, the
     readout is only written when its markup differs, and the height is measured
     only when it was. */
  let awReadWas = "";

  /* Every ÆWAY surface in the document, because on a wide screen there can be
     two of them: the phone's Tools panel and the desktop layout's own chart
     panel draw the same screen, and giving them element ids would have meant
     the second one silently never painting. They share one view — the same
     market at the same moment — and differ only in how much room they have. */
  const awBoxes = () => document.querySelectorAll(".aw-box");

  function awPaint() {
    const boxes = awBoxes();
    if (!boxes.length || !awReady) return;
    /* Tight first, then the readout, then the chart. A short plot cannot carry a
       three-line readout and a chart as well — at 375×667 with the header open
       the whole box is 125 pixels — so the readout folds to one line below a
       threshold, and the open, high and low go. Set on the box rather than in a
       media query, because what is short here is the plot and not the phone:
       the same phone with its header folded has room, and the desktop panel has
       a great deal more.
       The order matters because folding the readout changes its height, and the
       height is what tells the chart where to start. Measuring before the fold
       would leave the plot a line of gap it does not need until the next time
       the readout happens to change. */
    boxes.forEach((box) => {
      const cv = box.querySelector(".aw-canvas");
      if (!cv) return;
      const was = box.classList.contains("tight");
      const now = cv.clientHeight < 180;
      if (was !== now) { box.classList.toggle("tight", now); delete box.dataset.awPad; }
    });
    const v = awView();
    awPaintRead(v);
    boxes.forEach((box) => {
      const cv = box.querySelector(".aw-canvas");
      if (!cv) return;
      AWC().paint(cv, Object.assign({}, v, { padTop: Number(box.dataset.awPad) || 0 }));
    });
    const was = AW().version();
    AW().needBars(v.tf, v.from, v.span).then(() => {
      if (AW().version() === was || !awBoxes().length) return;
      awPaint();
    }).catch(() => {});
  }

  /* ---------------- the readout ---------------- */

  const awNum = (n) => Math.round(n).toLocaleString("en-US");
  const awPts = (n) => awNum(n * awScale());

  /* the bar the readout is describing: whatever the crosshair is on, or the
     newest one */
  function awReadBar(v) {
    if (v.cross && v.cross.bar) return v.cross.bar;
    return v.bars.length ? v.bars[v.bars.length - 1] : null;
  }

  function awReadHTML(v) {
    const b = awReadBar(v);
    if (!b) return `<span class="aw-read-dim">waiting for the market…</span>`;
    /* the market's clock, not the device's — see the note in js/aeway-chart.js */
    const when = new Date(b.t).toLocaleTimeString("en-US",
      { timeZone: AWC().TZ, hour: "numeric", minute: "2-digit" });
    const day = AWC().dayLabel(b.t);
    const tone = b.up > 0 ? "up" : b.up < 0 ? "down" : "flat";
    const pc = b.open ? (100 * (b.close - b.open) / b.open) : 0;
    return `
      <span class="aw-read-when">${esc(day)} ${esc(when)} <i>ET</i></span>
      <span class="aw-read-ohlc">
        <span class="o">O<i>${AWC().fmtPrice(b.open)}</i></span>
        <span class="h">H<i>${AWC().fmtPrice(b.high)}</i></span>
        <span class="l">L<i>${AWC().fmtPrice(b.low)}</i></span>
        <span>C<i class="${tone}">${AWC().fmtPrice(b.close)}</i></span>
        <em class="${tone}">${pc >= 0 ? "+" : ""}${pc.toFixed(2)}%</em>
      </span>
      <span class="aw-read-vol">
        <b class="up">Bulls ${awPts(b.bullPts)}<i>(${awNum(b.bullWins * awScale())})</i></b>
        <b class="down">Bears ${awPts(b.bearPts)}<i>(${awNum(b.bearWins * awScale())})</i></b>
        <b class="flat m">${awNum(b.matches * awScale())} matches</b>
        ${b.estimated ? `<b class="flat aw-est" title="the candle is still forming">forming</b>` : ""}
      </span>`;
  }

  function awPaintRead(v) {
    const html = awReadHTML(v || awView());
    const fresh = html !== awReadWas;
    awReadWas = html;
    awBoxes().forEach((box) => {
      const el = box.querySelector(".aw-read");
      if (!el) return;
      if (fresh || !box.dataset.awPad) {
        el.innerHTML = html;
        /* the one place a height is allowed to be measured: it changes only
           when the markup does, and each box keeps its own because the same
           readout wraps to three lines on a phone and one on a desktop panel */
        const h = el.offsetHeight + 8;
        if (String(h) !== box.dataset.awPad) { box.dataset.awPad = String(h); awPaintSoon(); }
      }
    });
    document.querySelectorAll(".aw-jump").forEach((j) => { j.hidden = !!state.awFollow; });
  }

  /* ---------------- the countdown and the calls ---------------- */

  const awBarNow = () => AW().liveBar(state.awTf);
  const awBarEnd = () => AW().barEnd(state.awTf, awBarNow());
  const awLeftMs = () => Math.max(0, awBarEnd() - AW().nowMs());
  const awLocked = () => awLeftMs() <= AW_LOCK_MS;

  const awClock = (ms) => {
    const s = Math.ceil(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  };

  const awOpenBet = () => {
    const o = store.awOpen && store.awOpen[state.awTf];
    return o && o.bar === awBarNow() ? o : null;
  };

  /* ---- the rate ----
     Raw volume grows with the number of players, so points are converted before
     they touch a balance. The rate is set from the average total volume of the
     last twelve candles of this timeframe and locked at the candle's open —
     which is the same thing as computing it from the twelve candles before this
     one, because those twelve never change again.

     A big candle still pays more than a quiet one: it pays more because it is
     big compared with normal, which is the point. */
  function awRate(tfId, barIdx) {
    let sum = 0, n = 0;
    for (let i = barIdx - AW_RATE_BARS; i < barIdx; i++) {
      const b = AW().bar(tfId, i);
      if (!b || b.forming) continue;
      sum += b.bullPts + b.bearPts;
      n++;
    }
    if (!n) return null;              // not enough history yet: no entries
    const half = (sum / n) / 2;
    return half > 0 ? AW_TARGET / half : null;
  }

  /* What each side has brought in since a prediction's entry. Works the same
     while the candle is forming and after it has closed, because a forming
     candle reports its running totals and a closed one reports its final ones.

     On a timeframe above five minutes the bar is several base candles, and the
     entry sits inside one of them: the candles after it count whole, the candle
     it is in counts from the entry's ten-second sample, and the ones before it
     do not count at all. */
  function awEarnedAfter(tfId, barIdx, entryMs) {
    const k = AW().tfOf(tfId).k;
    const first = barIdx * k;
    const ec = AW().idxAt(entryMs);
    const es = AW().entrySample(ec, entryMs);
    let bull = 0, bear = 0, ok = false;
    for (let i = 0; i < k; i++) {
      const c = AW().bar5(first + i);
      if (!c) continue;
      if (first + i < ec) continue;
      ok = true;
      if (first + i > ec) { bull += c.bullPts; bear += c.bearPts; continue; }
      const run = AW().runningAt(ec, es);
      if (!run) continue;
      bull += Math.max(0, c.bullPts - run.bull);
      bear += Math.max(0, c.bearPts - run.bear);
    }
    return ok ? { bull, bear } : null;
  }

  function awPick(side) {
    if (!awReady) return;
    if (awLocked()) return;
    if (awOpenBet()) return;
    if (awPoints() <= 0) { state.awNote = "No play points left — reset the balance in Settings."; render(); return; }
    const bar = awBarNow();
    const rate = awRate(state.awTf, bar);
    if (rate == null) { state.awNote = "Not enough history on this timeframe yet."; render(); return; }
    /* The entry time is the playback clock's, and the entry counts from the
       NEXT ten-second sample after it, so nothing that had already happened
       when the button was pressed can be claimed.

       ==> The playback clock is the device's, because there is no server to
       check it against. A tester who moves their phone's clock moves their own
       chart and their own entries with it. That is survivable for play points
       and is the fourth reason settlement has to move server-side before Æway
       points are worth anything. */
    const at = AW().nowMs();
    const c5 = AW().idxAt(at);
    /* The entry time is checked against the playback clock rather than trusted:
       the five-minute candle it lands in has to be inside the bar it is being
       filed against, or the clock moved between reading the bar and reading the
       time and the prediction would settle against a candle it was not placed
       in. Nothing legitimate trips this; a clock that jumped does. */
    if (Math.floor(c5 / AW().tfOf(state.awTf).k) !== bar) {
      state.awNote = "The clock moved — try that again.";
      render();
      return;
    }
    if (!store.awOpen) store.awOpen = {};
    store.awOpen[state.awTf] = {
      tf: state.awTf, bar, side, at, rate,
      candle: c5, sample: AW().entrySample(c5, at),
      barStart: AW().barStart(state.awTf, bar),
    };
    state.awNote = "";
    awSave();
    render();
  }

  /* ---- settling ----
     At the candle's close: your side won it and you gain your own side's
     post-entry points, your side lost it and you lose the other side's, a tied
     candle pays nothing either way.

     A balance never goes below zero: a loss bigger than the balance takes it to
     zero and stops. */
  function awSettleDue() {
    if (!awReady || !store.awOpen) return false;
    let any = false;
    for (const tfId of Object.keys(store.awOpen)) {
      const o = store.awOpen[tfId];
      if (!o) { delete store.awOpen[tfId]; continue; }
      const end = AW().barEnd(tfId, o.bar);
      if (AW().nowMs() < end) continue;
      const b = AW().bar(tfId, o.bar);
      if (!b || b.forming) continue;           // its day is not loaded yet
      const earned = awEarnedAfter(tfId, o.bar, o.at);
      if (!earned) continue;
      const won = b.up > 0 ? "bull" : b.up < 0 ? "bear" : null;
      const raw = won == null ? 0 : won === o.side
        ? (o.side === "bull" ? earned.bull : earned.bear)
        : (o.side === "bull" ? earned.bear : earned.bull);
      const delta = won == null ? 0 : Math.round(raw * o.rate) * (won === o.side ? 1 : -1);
      const before = awPoints();
      const after = Math.max(0, before + delta);
      store.awPoints = after;
      if (!store.awDone) store.awDone = [];
      store.awDone.unshift({
        t: end, tf: tfId, bar: o.bar, barStart: o.barStart, side: o.side,
        at: o.at, rate: o.rate, raw, delta: after - before,
        won, bullWins: b.bullWins, bearWins: b.bearWins,
        bullPts: b.bullPts, bearPts: b.bearPts,
        earnedBull: earned.bull, earnedBear: earned.bear,
      });
      if (store.awDone.length > AW_HISTORY_MAX) store.awDone.length = AW_HISTORY_MAX;
      delete store.awOpen[tfId];
      any = true;
    }
    if (any) awSave();
    return any;
  }

  /* the live line under the calls, while a prediction is open */
  function awLiveHTML() {
    const o = awOpenBet();
    if (!o) return "";
    const earned = awEarnedAfter(o.tf, o.bar, o.at);
    if (!earned) return "";
    const mine = o.side === "bull" ? earned.bull : earned.bear;
    const theirs = o.side === "bull" ? earned.bear : earned.bull;
    const win = Math.round(mine * o.rate);
    const lose = Math.round(theirs * o.rate);
    const since = new Date(o.at + (o.sample + 1) * AW().SAMPLE_MS - AW().SAMPLE_MS);
    return `<div class="aw-open ${o.side}">
      <b>${o.side === "bull" ? "BULL" : "BEAR"}</b>
      since ${esc(since.toLocaleTimeString("en-US",
        { timeZone: AWC().TZ, hour: "numeric", minute: "2-digit", second: "2-digit" }))}
      · If ${o.side === "bull" ? "Bulls" : "Bears"} win <i class="up">+${awNum(win)}</i>
      · If ${o.side === "bull" ? "Bears" : "Bulls"} win <i class="down">−${awNum(lose)}</i>
    </div>`;
  }

  /* ---------------- the screen ---------------- */

  function tpAewayHTML(desk) {
    if (state.awView === "history") return awHistoryHTML();
    if (state.awView === "admin" && awIsAdmin()) return awAdminHTML();
    const head = `
      ${desk ? "" : tpModeHTML("data-tp-mode")}
      <div class="tp-chart-head ae-head aw-head">
        <div class="tp-quote"><b>ÆWAY</b>
          ${AW() && AW().simulated()
            ? `<span class="aw-sim" data-aw-sim>Simulated market</span>` : ""}
        </div>
        <div class="tp-sym-name">Moved by Bulls vs Bears match results.</div>
      </div>`;

    if (awFailed) {
      return `${head}
        <div class="aw-box aw-dead">
          <span class="ae-empty-line">The market recording did not load.</span>
          <span class="aw-dead-why">${esc(awFailed)}</span>
          <button class="dc-tool" data-aw-retry>Try again</button>
        </div>`;
    }
    if (!awReady) {
      return `${head}
        <div class="aw-box aw-dead"><span class="ae-empty-line">Loading the market…</span></div>`;
    }

    const open = awOpenBet();
    const locked = awLocked();
    const tf = awTf();
    return `
      ${head}
      <div class="aw-box">
        <canvas class="aw-canvas"></canvas>
        <div class="aw-read"></div>
        <div class="tp-menus aw-menus">
          <div class="tp-menu-wrap">
            <button class="tp-menu-btn${state.awMenu ? " on" : ""}" data-aw-menu
                    aria-expanded="${!!state.awMenu}">${esc(tf.label)}<i></i></button>
            ${state.awMenu ? `<div class="tp-menu">
              ${AW().TFS.map((t) => `<button class="tp-menu-item${t.id === state.awTf ? " on" : ""}"
                data-aw-tf="${t.id}">${esc(t.label)}</button>`).join("")}
            </div>` : ""}
          </div>
        </div>
        <button class="aw-jump" data-aw-jump aria-label="Jump to the latest candle"
                ${state.awFollow ? "hidden" : ""}>›|</button>
      </div>
      <div class="ae-panel aw-panel">
        <div class="aw-live">${awLiveHTML()}</div>
        <div class="ae-calls aw-calls">
          <button class="ae-call up${open && open.side === "bull" ? " on" : ""}"
                  data-aw-pick="bull" ${locked || open ? "disabled" : ""}>Bull</button>
          <div class="aw-count${locked ? " locked" : ""}">
            ${locked ? "Locked" : awClock(awLeftMs())}
            <i>${esc(tf.label)}</i>
          </div>
          <button class="ae-call down${open && open.side === "bear" ? " on" : ""}"
                  data-aw-pick="bear" ${locked || open ? "disabled" : ""}>Bear</button>
        </div>
        ${state.awAdminAsk && !awIsAdmin() ? `
          <div class="aw-foot aw-adm-ask">
            <input class="mt-input aw-adm-pass" id="awPass" type="password"
                   placeholder="Admin passcode" autocomplete="off">
            <button class="aw-link" data-aw-admin-go>Enter</button>
            <button class="aw-link" data-aw-admin-no>Cancel</button>
          </div>`
        : `<div class="aw-foot">
            <span class="aw-bal">${awNum(awPoints())} <i>play points</i></span>
            ${state.awNote ? `<span class="aw-note">${esc(state.awNote)}</span>` : ""}
            <button class="aw-link" data-aw-history>History</button>
            ${awIsAdmin() ? `<button class="aw-link" data-aw-admin>Admin</button>` : ""}
          </div>`}
      </div>`;
  }

  /* the panel under the chart, updated where it stands: the countdown moves
     every second and the live line with it, and rebuilding the screen would
     replace the canvas under the finger that is panning it */
  function awPaintPanel() {
    const html = awLiveHTML();
    document.querySelectorAll(".aw-live").forEach((el) => { el.innerHTML = html; });
    const counts = document.querySelectorAll(".aw-count");
    if (!counts.length) return;
    const locked = awLocked();
    const label = `${locked ? "Locked" : awClock(awLeftMs())}<i>${esc(awTf().label)}</i>`;
    counts.forEach((c) => { c.classList.toggle("locked", locked); c.innerHTML = label; });
    const open = awOpenBet();
    document.querySelectorAll("[data-aw-pick]").forEach((b) => {
      b.disabled = locked || !!open;
      b.classList.toggle("on", !!open && open.side === b.getAttribute("data-aw-pick"));
    });
  }

  /* ---------------- point history ---------------- */

  function awHistoryHTML() {
    const list = (store.awDone || []);
    return `
      <div class="pw-lib-head">
        <button class="pw-hub-back" data-aw-back aria-label="Back to the chart">
          <img src="assets/nav-icons/icon-arrow-back@2x.png" alt="">
        </button>
        <span class="pw-lib-title">Point history</span>
      </div>
      <div class="aw-hist-top">
        <span class="aw-bal">${awNum(awPoints())} <i>play points</i></span>
      </div>
      <div class="aw-hist">
        ${list.length ? list.map(awHistRowHTML).join("")
          : `<div class="tp-note">No settled predictions yet. Pick Bull or Bear on the
             chart and the candle will settle it when it closes.</div>`}
      </div>`;
  }

  function awHistRowHTML(h) {
    const tone = h.delta > 0 ? "up" : h.delta < 0 ? "down" : "flat";
    const when = new Date(h.barStart).toLocaleTimeString("en-US",
      { timeZone: AWC().TZ, hour: "numeric", minute: "2-digit" });
    const day = AWC().dayLabel(h.barStart);
    const entered = new Date(h.at).toLocaleTimeString("en-US",
      { timeZone: AWC().TZ, hour: "numeric", minute: "2-digit", second: "2-digit" });
    const mine = h.side === "bull" ? h.earnedBull : h.earnedBear;
    const theirs = h.side === "bull" ? h.earnedBear : h.earnedBull;
    const raw = h.won == null ? 0 : h.won === h.side ? mine : theirs;
    const per = h.rate > 0 ? Math.round(1 / h.rate) : 0;
    const verdict = h.won == null
      ? `The candle tied at ${awNum(h.bullWins)} match wins each — nothing either way`
      : `${h.won === "bull" ? "Bulls" : "Bears"} won ${awNum(Math.max(h.bullWins, h.bearWins))}
         to ${awNum(Math.min(h.bullWins, h.bearWins))} matches`;
    return `
      <div class="aw-hrow ${tone}">
        <div class="aw-hrow-top">
          <b class="${tone}">${h.delta > 0 ? "+" : ""}${awNum(h.delta)} pts</b>
          <span class="aw-hrow-side ${h.side}">${h.side === "bull" ? "Bull" : "Bear"}</span>
          <span class="aw-hrow-when">${esc(day)} ${esc(when)} candle (${esc(h.tf)})</span>
        </div>
        <div class="aw-hrow-why">
          Entered ${esc(entered)} ·
          ${h.won === h.side ? `${h.side === "bull" ? "Bulls" : "Bears"}` :
            h.won == null ? "Nobody" : `${h.side === "bull" ? "Bears" : "Bulls"}`}
          brought in ${awNum(raw)} pts after entry ·
          Rate 1 per ${awNum(per)} · ${esc(verdict.replace(/\s+/g, " "))}
        </div>
      </div>`;
  }

  /* ---------------- gestures ----------------
     A drag pans. A press held for four tenths of a second raises the crosshair
     and then scrubs with the finger, snapping candle to candle. Two fingers
     pinch the span. Lifting clears the crosshair.

     The order matters: the crosshair must not come up during a pan and a pan
     must not start from a hold, so the first movement past the slop decides
     which of the two this gesture is and the other never happens. */
  let awGrab = null;

  function awDown(e) {
    const box = e.target.closest && e.target.closest(".aw-box");
    if (!box) return;
    if (e.target.closest(".tp-menus") || e.target.closest(".aw-jump")) return;
    if (state.awMenu) return;
    if (awGrab && awGrab.b == null && e.pointerId !== awGrab.a) {
      awGrab.b = e.pointerId; awGrab.bx = e.clientX;
      awGrab.pinch = true; awGrab.mode = "pan";
      awGrab.span0 = state.awSpan;
      awGrab.gap0 = Math.max(24, Math.abs(awGrab.bx - awGrab.ax));
      awGrab.from0 = awWindow().from;
      awHoldOff();
      return;
    }
    if (awGrab) return;
    const r = box.getBoundingClientRect();
    awGrab = {
      a: e.pointerId, b: null, ax: e.clientX, ay: e.clientY,
      x0: e.clientX, y0: e.clientY, rect: r, box,
      mode: null, from0: awWindow().from, span0: state.awSpan,
      hold: setTimeout(() => {
        if (!awGrab || awGrab.mode) return;
        awGrab.mode = "cross";
        state.awCross = awCrossAt(awGrab.ax, awGrab.ay, r, box);
        awBuzz();
        awPaintSoon();
      }, AW_HOLD_MS),
    };
  }

  function awHoldOff() {
    if (awGrab && awGrab.hold) { clearTimeout(awGrab.hold); awGrab.hold = null; }
  }

  /* a light tap, where the device has one */
  function awBuzz() {
    try { if (navigator.vibrate) navigator.vibrate(8); } catch (e) { /* no haptics */ }
  }

  /* the crosshair, snapped to the nearest candle */
  function awCrossAt(cx, cy, rect, box) {
    const cv = box && box.querySelector(".aw-canvas");
    if (!cv) return null;
    const v = awView();
    const g = AWC().geom(cv, v);
    const x = cx - rect.left, y = cy - rect.top;
    let i = g.barAt(Math.max(g.plot.x, Math.min(g.plot.x + g.plot.w - 1, x)));
    i = Math.max(v.from, Math.min(v.from + v.span - 1, i));
    let bar = v.bars.find((b) => b.idx === i);
    if (!bar && v.bars.length) {
      /* the finger is past the newest candle: snap to it rather than showing
         nothing, and never past it — there is nothing there to show */
      bar = v.bars[v.bars.length - 1];
    }
    return { x, y: Math.max(g.plot.y, Math.min(g.plot.y + g.plot.h, y)), bar };
  }

  function awMove(e) {
    if (!awGrab) return;
    const G = awGrab;
    if (e.pointerId === G.a) { G.ax = e.clientX; G.ay = e.clientY; }
    else if (e.pointerId === G.b) { G.bx = e.clientX; }
    else return;

    if (!G.mode) {
      if (Math.abs(G.ax - G.x0) < AW_SLOP && Math.abs(G.ay - G.y0) < AW_SLOP) return;
      G.mode = "pan";
      awHoldOff();
      /* the gesture is a pan from here, so the surface is ours */
      try { G.box.setPointerCapture(G.a); } catch (err) { /* already gone */ }
    }
    if (e.cancelable) e.preventDefault();

    if (G.mode === "cross") {
      state.awCross = awCrossAt(G.ax, G.ay, G.rect, G.box);
      awPaintSoon();
      awPaintPanel();
      return;
    }

    if (G.pinch && G.b != null) {
      const gap = Math.max(24, Math.abs(G.bx - G.ax));
      const span = Math.max(AW_SPAN_MIN, Math.min(AW_SPAN_MAX,
        Math.round(G.span0 * G.gap0 / gap)));
      /* the pair's middle holds its place, so a pinch zooms where the fingers
         are rather than at the edge */
      const mid = ((G.ax + G.bx) / 2 - G.rect.left - AWC().PAD.l) /
        Math.max(1, G.rect.width - AWC().PAD.l - AWC().PAD.r);
      const anchor = G.from0 + G.span0 * Math.max(0, Math.min(1, mid));
      state.awSpan = span;
      state.awFollow = false;
      state.awFrom = Math.round(anchor - span * Math.max(0, Math.min(1, mid)));
      awPaintSoon();
      return;
    }

    const w = G.rect.width - AWC().PAD.l - AWC().PAD.r;
    const perBar = Math.max(1, w) / Math.max(1, G.span0);
    const moved = Math.round((G.x0 - G.ax) / perBar);
    state.awFrom = G.from0 + moved;
    state.awFollow = false;
    const win = awWindow();
    /* back at the right-hand edge is the same thing as following again */
    if (win.from >= win.last - win.span + 1 + Math.round(win.span * 0.06)) {
      state.awFollow = true;
    }
    awPaintSoon();
    awPaintRead();
  }

  function awUp(e) {
    if (!awGrab) return;
    if (e.pointerId === awGrab.b) { awGrab.b = null; return; }
    if (e.pointerId !== awGrab.a) return;
    awHoldOff();
    const wasCross = awGrab.mode === "cross";
    awGrab = null;
    if (wasCross) {
      state.awCross = null;
      awPaintSoon();
      awPaintPanel();
    }
    awPaintRead();
  }

  /* ==================== admin only ====================

     Hidden from testers, and the two ways in are in awIsAdmin() above. What is
     on it is the simulator's own report plus one switch, and nothing about any
     user: no money, no pricing, no revenue arithmetic. The brief is explicit
     that this build has none of that, and this page is where it would have gone.

     ---- what is measured offline and what is measured here ----

     The market-likeness and balance figures are computed by sim/report.js from
     the whole 90-day recording and shipped as aggregates in
     data/aeway/report.json — distributions, correlations and counts.

     ==> Aggregates ONLY, and that is a rule rather than a convenience. A report
     carrying 90 days of closes would be the future in plaintext, next to a
     recording that was scrambled precisely so it would not be. So anything that
     needs the actual shape of the market — the CSV export, the wins-against-
     points comparison — is built here in the browser out of days that have
     already happened. */

  /* The long press landed. The passcode box appears in the footer rather than
     over a dimmed screen, because no action in this app opens a modal. */
  function awAdminAsk() {
    if (awIsAdmin()) { state.awView = "admin"; render(); return; }
    state.awAdminAsk = true;
    render();
    const el = document.getElementById("awPass");
    if (el) el.focus();
  }
  function awAdminTry() {
    const el = document.getElementById("awPass");
    const want = awCfg().adminPasscode || "";
    if (want && el && el.value === want) {
      state.awAdminOk = true;
      state.awAdminAsk = false;
      state.awView = "admin";
      state.awNote = "";
    } else {
      state.awNote = "That is not the admin passcode.";
      state.awAdminAsk = false;
    }
    render();
  }

  const AW_ADMIN_DEF = { predictRate: 35, perDay: 12, csvDays: 7 };
  const awAdm = () => Object.assign({}, AW_ADMIN_DEF, store.awAdmin || {});
  let awReport = null, awReportErr = null;

  function awLoadReport() {
    if (awReport || awReportErr) return;
    awReportErr = "loading";
    fetch(`${AW().config.dir}report.json`, { cache: "no-cache" })
      .then((r) => { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then((j) => { awReport = j; awReportErr = null; if (state.awView === "admin") render(); })
      .catch((e) => {
        awReportErr = `report.json is not there yet (${e.message}). ` +
          `Run: node sim/report.js`;
        if (state.awView === "admin") render();
      });
  }

  function awAdminHTML() {
    awLoadReport();
    const a = awAdm();
    const proj = state.awProject;
    const scale = proj ? 100 : 1;
    const players = 10000 * scale;
    const r = awReport;

    /* per-day throughput, from the recording's own manifest and report */
    const perCandle = (r && r.throughput && r.throughput.matchesPerCandle) || 4050;
    const matchesDay = perCandle * 288 * scale;
    const ptsDay = (r && r.throughput && r.throughput.pointsPerCandle
      ? r.throughput.pointsPerCandle : perCandle * 13.5 * 0.969) * 288 * scale;
    const predictors = Math.round(players * a.predictRate / 100);
    const predDay = predictors * a.perDay;

    const row = (k, v, hint) => `<div class="aw-adm-row">
      <span class="aw-adm-k">${esc(k)}</span>
      <span class="aw-adm-v">${esc(v)}</span>
      ${hint ? `<span class="aw-adm-h">${esc(hint)}</span>` : ""}
    </div>`;
    const mo = (n) => awNum(n * 30);

    return `
      <div class="pw-lib-head">
        <button class="pw-hub-back" data-aw-back aria-label="Back to the chart">
          <img src="assets/nav-icons/icon-arrow-back@2x.png" alt="">
        </button>
        <span class="pw-lib-title">Admin — simulator report</span>
      </div>
      <div class="aw-adm">

        <div class="aw-adm-sw">
          <button class="tp-mode-btn${!proj ? " on" : ""}" data-aw-project="0">10,000 players<i>actual</i></button>
          <button class="tp-mode-btn${proj ? " on" : ""}" data-aw-project="1">1,000,000 players<i>projected</i></button>
        </div>
        ${proj ? `<div class="aw-adm-flag">Projection — the chart's shape is unchanged.
          Because ε is tuned to a ~1% day, a hundred times the crowd changes the
          volume and not the shape. Match counts and point volumes below, in the
          chart readout and in the volume bars are ×100.</div>` : ""}

        <h4 class="aw-adm-h4">Throughput${proj ? " — Projection" : ""}</h4>
        ${row("Matches played", `${awNum(matchesDay)} / day · ${mo(matchesDay)} / month`)}
        ${row("Points traded by winners", `${awNum(ptsDay)} / day · ${mo(ptsDay)} / month`)}
        ${row("Matches per 5-minute candle", awNum(perCandle * scale))}

        <h4 class="aw-adm-h4">Prediction activity${proj ? " — Projection" : ""}</h4>
        <div class="aw-adm-ass">
          <label>Players who predict
            <input class="mt-input aw-adm-in" type="number" min="0" max="100" step="1"
                   value="${a.predictRate}" data-aw-ass="predictRate"> %
          </label>
          <label>Predictions each, per day
            <input class="mt-input aw-adm-in" type="number" min="0" max="500" step="1"
                   value="${a.perDay}" data-aw-ass="perDay">
          </label>
        </div>
        ${row("Predicting players", awNum(predictors))}
        ${row("Predictions", `${awNum(predDay)} / day · ${mo(predDay)} / month`)}
        <div class="aw-adm-flag">Assumptions, not measurements — Mattia sets the real
          ones. Everything in this section is labelled Projection whichever switch
          is selected, because nobody has made a prediction yet.</div>

        <h4 class="aw-adm-h4">The shape of the market</h4>
        <div class="aw-cmp-wrap">
          <canvas class="aw-cmp" id="awCmp"></canvas>
          <div class="aw-cmp-key">
            <b class="k1">price by wins</b> — what the chart shows
            <b class="k2">price by points</b> — the same matches, moved by volume instead
          </div>
        </div>
        <div class="aw-adm-act">
          <button class="dc-tool" data-aw-csv="7">Export 7 days as CSV</button>
          <button class="dc-tool" data-aw-csv="30">30 days</button>
          <span class="aw-adm-h">Built here from days that have already played,
            so the export never contains a candle from the future.</span>
        </div>

        ${r ? awReportHTML(r) : `<div class="tp-note">${esc(awReportErr || "loading the report…")}</div>`}
      </div>`;
  }

  function awReportHTML(r) {
    const row = (k, v, flag) => `<div class="aw-adm-row${flag ? " bad" : ""}">
      <span class="aw-adm-k">${esc(k)}</span><span class="aw-adm-v">${esc(v)}</span></div>`;
    const b = r.balance || {};
    const m = r.likeness || {};
    const es = m.es;
    const pair = (k, mine, theirs, fmt) => `<div class="aw-adm-row">
      <span class="aw-adm-k">${esc(k)}</span>
      <span class="aw-adm-v">${esc(fmt(mine))}</span>
      <span class="aw-adm-v es">${theirs == null ? "—" : esc(fmt(theirs))}</span></div>`;
    const p2 = (x) => (x == null ? "—" : Number(x).toFixed(2));
    const p3 = (x) => (x == null ? "—" : Number(x).toFixed(3));
    const pc = (x) => (x == null ? "—" : (100 * Number(x)).toFixed(2) + "%");

    return `
      <h4 class="aw-adm-h4">Game balance, over ${esc(awNum(r.matches || 0))} matches</h4>
      ${row("Bull win rate", pc(b.bullRate), b.bullRate > 0.52 || b.bullRate < 0.48)}
      ${row("Bear win rate", pc(b.bearRate), b.bearRate > 0.52 || b.bearRate < 0.48)}
      ${row("Draws", pc(b.drawRate))}
      ${row("Average match length", `${p2(b.meanRounds)} rounds · ${p2(b.meanSeconds / 60)} min`)}
      ${row("Finished at the full 25", pc(b.onTrackRate))}
      ${row("YOLO met Market News", `${pc(b.yoloNewsPerMatch)} of matches, ` +
        `${pc(b.yoloNewsDeciderRate)} of them deciding one`)}
      ${(b.bullRate > 0.52 || b.bearRate > 0.52)
        ? `<div class="aw-adm-flag bad">One side is winning more than 52% over the
            recording, which would make the chart drift on its own.</div>`
        : `<div class="aw-adm-flag ok">Neither side is over 52%, so the chart has no
            drift of its own: the price is a fair walk.</div>`}

      <h4 class="aw-adm-h4">Market likeness
        <span class="aw-adm-h">ÆWAY · ES 5-minute</span></h4>
      ${es ? "" : `<div class="aw-adm-flag">No ES data in the repository, so the right-hand
         column is empty. Drop Mattia's Tradovate export in as
         <b>data/aeway/es-5m.csv</b> (timestamp, open, high, low, close[, volume])
         and re-run <b>node sim/report.js</b>; nothing else has to change.</div>`}
      ${pair("Kurtosis of returns (3 is a bell curve)", m.kurtosis, es && es.kurtosis, p2)}
      ${pair("Moves beyond 4 standard deviations", m.tail4, es && es.tail4, pc)}
      ${pair("Autocorrelation, lag 1", m.acf && m.acf[0], es && es.acf && es.acf[0], p3)}
      ${pair("lag 2", m.acf && m.acf[1], es && es.acf && es.acf[1], p3)}
      ${pair("lag 3", m.acf && m.acf[2], es && es.acf && es.acf[2], p3)}
      ${pair("lag 4", m.acf && m.acf[3], es && es.acf && es.acf[3], p3)}
      ${pair("lag 5", m.acf && m.acf[4], es && es.acf && es.acf[4], p3)}
      ${pair("Volatility clustering (|return| lag 1)", m.volAcf, es && es.volAcf, p3)}
      ${pair("Mean run of same-colour candles", m.meanStreak, es && es.meanStreak, p2)}
      ${pair("Longest run", m.maxStreak, es && es.maxStreak, (x) => (x == null ? "—" : String(x)))}
      ${pair("Median candle range", m.medRange, es && es.medRange, pc)}
      ${pair("95th percentile range", m.p95Range, es && es.p95Range, pc)}
      ${pair("Typical day", m.dailySd, es && es.dailySd, pc)}
      ${pair("Typical 5-minute candle", m.sd, es && es.sd, pc)}
      ${m.winsVsPoints != null ? row("Wins and points agree, candle to candle", p3(m.winsVsPoints)) : ""}
      <div class="aw-adm-say">${esc(m.summary || "")}</div>
      <div class="aw-adm-h">Generated ${esc(r.generated || "")} from
        ${esc(awNum(r.candles || 0))} five-minute candles.</div>`;
  }

  /* ---- the wins-against-points comparison ----
     The same matches, drawn twice: once with the price moved by who won, which
     is what the chart shows, and once with it moved by how many points the
     winners brought in. The second line is scaled to the same typical daily
     move as the first, or the two would not fit on one axis and the comparison
     would be about the scaling rather than about the shape. */
  function awPaintCompare() {
    const cv = document.getElementById("awCmp");
    if (!cv || !awReady) return;
    const days = 7;
    const last = AW().liveIdx();
    const from = last - days * 288 + 1;
    AW().need(from, last).then(() => {
      const wins = [], pts = [];
      let cw = 0, cp = 0;
      for (let i = from; i <= last; i++) {
        const b = AW().bar5(i);
        if (!b) continue;
        cw += b.bullWins - b.bearWins;
        cp += b.bullPts - b.bearPts;
        wins.push(cw); pts.push(cp);
      }
      if (wins.length < 10) return;
      const sd = (a) => {
        const d = a.slice(1).map((x, i) => x - a[i]);
        const mu = d.reduce((x, y) => x + y, 0) / d.length;
        return Math.sqrt(d.reduce((s, x) => s + (x - mu) * (x - mu), 0) / d.length) || 1;
      };
      const k = sd(wins) / sd(pts);
      const dpr = Math.min(3, window.devicePixelRatio || 1);
      const w = cv.clientWidth, h = cv.clientHeight;
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
      const ctx = cv.getContext("2d");
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      /* One vertical frame for both, or the comparison would be about the
         scaling rather than about the shape: two lines each stretched to fill
         the box always look alike. They are also both started at zero, so what
         is being compared is where each one went from the same opening. */
      const a = wins.map((v) => v - wins[0]);
      const b2 = pts.map((v) => (v - pts[0]) * k);
      let lo = Infinity, hi = -Infinity;
      for (const v of a.concat(b2)) { if (v < lo) lo = v; if (v > hi) hi = v; }
      if (hi === lo) hi = lo + 1;
      const line = (vals, colour, width) => {
        ctx.strokeStyle = colour; ctx.lineWidth = width;
        ctx.beginPath();
        vals.forEach((v, i) => {
          const x = (i / (vals.length - 1)) * (w - 2) + 1;
          const y = h - 3 - ((v - lo) / (hi - lo)) * (h - 6);
          i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
        });
        ctx.stroke();
      };
      line(b2, "rgba(61,223,255,.8)", 1);
      line(a, "#F2FBFF", 1.5);
    }).catch(() => {});
  }

  /* ---- the CSV ----
     Every stored field of every five-minute candle of the last N days, built
     here from the recording as the app already has it. Past days only. */
  function awExportCsv(days) {
    if (!awReady) return;
    const last = AW().liveIdx();
    const from = Math.max(AW().firstIdx(), last - days * 288 + 1);
    state.awNote = "building the CSV…";
    render();
    AW().need(from, last).then(() => {
      const head = ["time", "iso", "open", "high", "low", "close",
        "bullWins", "bearWins", "bullPoints", "bearPoints", "matches", "draws",
        "netWinsAtClose"];
      const rows = [head.join(",")];
      for (let i = from; i <= last; i++) {
        const b = AW().bar5(i);
        if (!b || b.forming) continue;
        rows.push([b.t, new Date(b.t).toISOString(),
          b.open.toFixed(2), b.high.toFixed(2), b.low.toFixed(2), b.close.toFixed(2),
          b.bullWins, b.bearWins, b.bullPts, b.bearPts, b.matches, b.draws,
          b.closeNet].join(","));
      }
      const blob = new Blob([rows.join("\n")], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `aeway-5m-${days}d.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      state.awNote = `${rows.length - 1} candles exported.`;
      render();
    }).catch((e) => { state.awNote = `CSV failed: ${e.message}`; render(); });
  }

  const TP_SPAN_MIN = 18, TP_SPAN_MAX = 220;
  function tpClampView() {
    state.tpSpan = Math.max(TP_SPAN_MIN, Math.min(TP_SPAN_MAX, Math.round(state.tpSpan)));
    /* null means the newest bars, which is where a chart opens — anchoring to
       bar 0 would open it on the oldest history it has and leave a pan toward
       the past already at its limit. */
    if (state.tpFrom == null) state.tpFrom = TP_BARS;
    state.tpFrom = Math.max(0, Math.min(TP_BARS - state.tpSpan, Math.round(state.tpFrom)));
  }

  /* The one mapping between a price and its place in the box, and the one
     between a bar and its column. Everything is percent for the same reason
     the bars are: the box changes size with the panel, so nothing here can be
     measured in pixels. Both directions are here because the desktop chart's
     crosshair and its drawings have to run it backwards — a cursor gives a
     percentage and needs a price and a bar back. */
  /* which mode a given chart is in: "m" is the phone's, "d" the desktop
     panel's. They do not track each other. */
  const chartMode = (k) => (k === "d" ? state.dcMode : state.tpMode);
  /* $ÆWAY's tape and a saved pattern are both look-only: no pan, no pinch,
     no drawing, and no crosshair — the crosshair carries a price, which is
     the one thing $ÆWAY must never put on screen. */
  const tpFrozen = (k) => chartMode(k) === "aeway" || !!state.tpPatOpen;

  const TP_PAD = 8, TP_USABLE = 100 - TP_PAD * 2;
  function tpGeom(sym, tfId, from, span) {
    return tpGeomOf(tpSeries(sym, tfId), from, span);
  }
  /* the same geometry over any run of candles — the instrument series, the
     $Æway live tape, or a saved pattern's frozen bars */
  function tpGeomOf(all, from, span) {
    const view = all.slice(from, from + span);
    const gMax = Math.max.apply(null, view.map((c) => c.high));
    const gMin = Math.min.apply(null, view.map((c) => c.low));
    const range = Math.max(1e-9, gMax - gMin);
    return {
      view, gMin, gMax, range, from, span,
      y: (v) => TP_PAD + TP_USABLE - ((v - gMin) / range) * TP_USABLE,
      priceAt: (yPct) => gMin + ((TP_PAD + TP_USABLE - yPct) / TP_USABLE) * range,
      /* x is the centre of a bar's own column */
      x: (gi) => ((gi - from) + 0.5) / span * 100,
      barAt: (xPct) => from + (xPct / 100) * span - 0.5,
    };
  }

  function tpCandlesHTML(g) {
    return g.view.map((c) => {
      const wt = g.y(c.high), wh = Math.max(0.5, g.y(c.low) - wt);
      const bt = g.y(Math.max(c.open, c.close));
      const bh = Math.max(0.9, g.y(Math.min(c.open, c.close)) - bt);
      return `<div class="tp-col ${c.dir}">
        <span class="pa-wick" style="top:${wt.toFixed(2)}%;height:${wh.toFixed(2)}%"></span>
        <span class="pa-body" style="top:${bt.toFixed(2)}%;height:${bh.toFixed(2)}%"></span></div>`;
    }).join("");
  }

  /* Just the bars. Rewritten on its own during a gesture so a pan does not
     rebuild the tabs, the strip and the header sixty times a second. */
  function tpBarsHTML() {
    tpClampView();
    return tpCandlesHTML(tpGeom(tpSymbol(), state.tpTf, state.tpFrom, state.tpSpan));
  }

  function tpPaintBars() {
    const track = document.getElementById("tpTrack");
    if (track) track.innerHTML = tpBarsHTML();
    /* the drawings are anchored to bars, so they move with them */
    const ov = document.getElementById("tpOverlay");
    if (ov) ov.innerHTML = dcOverlayHTML("m");
    const hd = document.getElementById("tpChg");
    if (hd) {
      const all = tpSeries(tpSymbol(), state.tpTf);
      const view = all.slice(state.tpFrom, state.tpFrom + state.tpSpan);
      const chg = (view[view.length - 1].close - view[0].open) / view[0].open * 100;
      hd.textContent = (chg >= 0 ? "+" : "") + chg.toFixed(2) + "%";
      hd.className = chg >= 0 ? "up" : "down";
    }
  }

  function tpStripHTML() {
    const cur = tpSymbol();
    return `<div class="tp-strip">
      ${tpWatchlist().map((sym) => {
        const row = TP_UNI[sym] || { sym, base: 100 };
        const q = tpQuote(row, todayKey());
        return `<button class="tp-chip${sym === cur ? " on" : ""}" data-tp-sym="${esc(sym)}">
          <span class="tp-chip-sym">${esc(sym)}</span>
          <span class="tp-chip-chg ${q.pct >= 0 ? "up" : "down"}">${q.pct >= 0 ? "+" : ""}${q.pct.toFixed(2)}%</span>
        </button>`;
      }).join("")}
    </div>`;
  }

  /* ==================== SAVED PATTERNS (NORMAL CHART) ====================
     A pattern is what was on the chart when you pressed the button: the bars
     in the window, the lines and boxes and fibs drawn over them, and which
     instrument and timeframe it was. The drawings are stored against the
     window's own left edge rather than the series index, so a saved pattern
     stands on its own once the live series has rolled past it.

     These live in the local store only. They are candle data and geometry,
     not progress, and a hundred of them would bloat the synced document for
     no benefit. ==> revisit if patterns should follow a user between
     devices. */
  const PAT_MAX = 24;
  const patRound = (v) => Math.round(v * 100) / 100;

  function patSave(k) {
    const m = k === "m";
    const sym = m ? tpSymbol() : state.dcSym;
    const tf = m ? state.tpTf : state.dcTf;
    if (m) tpClampView();
    const g = m ? tpGeom(sym, tf, state.tpFrom, state.tpSpan) : dcGeom();
    const draw = m ? state.tpDraw : state.dcDraw;
    store.patterns.unshift({
      id: "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      at: Date.now(), sym, tf,
      bars: g.view.map((c) => ({ o: patRound(c.open), h: patRound(c.high),
        l: patRound(c.low), c: patRound(c.close), d: c.dir })),
      draw: draw.map((d) => ({ type: d.type,
        a: { i: d.a.i - g.from, p: patRound(d.a.p) },
        b: { i: d.b.i - g.from, p: patRound(d.b.p) } })),
    });
    if (store.patterns.length > PAT_MAX) store.patterns.length = PAT_MAX;
    save();
  }
  const patFind = (id) => store.patterns.filter((p) => p.id === id)[0] || null;
  function patGeom(rec) {
    return tpGeomOf(rec.bars.map((b) => ({ open: b.o, high: b.h, low: b.l, close: b.c, dir: b.d })),
      0, rec.bars.length);
  }
  function patOverlayHTML(rec) {
    const g = patGeom(rec);
    const shapes = rec.draw.map((d, i) => dcShapeSVG(d, g, i, false)).join("");
    const labels = rec.draw.map((d) => dcLabelsHTML(d, g)).join("");
    return `<svg class="dc-svg" viewBox="0 0 100 100" preserveAspectRatio="none">${shapes}</svg>
      <div class="dc-labels">${labels}</div>`;
  }

  function tpSaveBarHTML(k) {
    const m = k === "m";
    const open = m ? state.tpPat : state.dcPat;
    const n = store.patterns.length;
    return `
      <div class="tp-savebar">
        <button class="dc-tool" ${m ? "data-tp-patsave" : "data-dc-patsave"}>Save pattern</button>
        <button class="dc-tool${open ? " on" : ""}"
          ${m ? "data-tp-pat" : "data-dc-pat"}="${open ? "0" : "1"}">Saved${n ? ` (${n})` : ""}</button>
      </div>
      ${open ? patListHTML() : ""}`;
  }
  function patListHTML() {
    if (!store.patterns.length) {
      return `<div class="tp-note">Nothing saved yet — draw on the chart, then press Save pattern.</div>`;
    }
    return `<div class="pat-list">
      ${store.patterns.map((p) => {
        const d = new Date(p.at);
        const nd = p.draw.length;
        return `<div class="pat-row">
          <button class="pat-open" data-pat-open="${esc(p.id)}">
            <span class="pat-sym">${esc(p.sym)}<small>${esc(p.tf)}</small></span>
            <span class="pat-meta">${d.toLocaleDateString([], { month: "short", day: "numeric" })}
              · ${p.bars.length} bars · ${nd} drawing${nd === 1 ? "" : "s"}</span>
          </button>
          <button class="pat-del" data-pat-del="${esc(p.id)}" aria-label="Delete this pattern">✕</button>
        </div>`;
      }).join("")}
    </div>`;
  }
  /* a saved pattern, frozen: no gestures, no tools, nothing live */
  function tpPatternHTML() {
    const rec = patFind(state.tpPatOpen);
    if (!rec) { state.tpPatOpen = null; return tpChartHTML(); }
    const d = new Date(rec.at);
    return `
      <div class="tp-chart-head">
        <div class="tp-quote"><b>${esc(rec.sym)}</b><span class="tp-pat-tf">${esc(rec.tf)}</span></div>
        <div class="tp-sym-name">Saved ${d.toLocaleDateString([], { month: "short", day: "numeric" })}
          ${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</div>
      </div>
      <div class="tp-chart pat-chart">
        <div class="tp-track">${tpCandlesHTML(patGeom(rec))}</div>
        <div class="dc-overlay">${patOverlayHTML(rec)}</div>
      </div>
      <div class="tp-savebar">
        <button class="dc-tool" data-pat-close>Back to the chart</button>
        <button class="dc-tool" data-pat-del="${esc(rec.id)}">Delete</button>
      </div>`;
  }

  /* the two-way switch that sits at the top of both charts */
  function tpModeHTML(attr) {
    const m = chartMode(attr === "data-dc-mode" ? "d" : "m");
    return `<div class="tp-mode">
      <button class="tp-mode-btn${m === "aeway" ? " on" : ""}" ${attr}="aeway">Æway Chart</button>
      <button class="tp-mode-btn${m === "normal" ? " on" : ""}" ${attr}="normal">Normal Chart</button>
    </div>`;
  }

  /* ---- the phone's chart: two dropdowns, over the plot's top-left ----
     Nine timeframes and five tools as two rows of pills cost the chart most
     of its height on a phone. They collapse to a pair of buttons inside the
     chart box instead, which is what lets the plot start immediately under
     the mode toggle. Only one menu is open at a time; picking from either
     closes it. Inline, over the chart — no overlay, nothing dimmed. */
  function tpMenusHTML() {
    const tf = TP_TFS.find((t) => t.id === state.tpTf) || TP_TFS[3];
    const tool = DC_TOOLS.find((t) => t.id === state.tpTool) || DC_TOOLS[0];
    const open = state.tpMenu;
    return `
      <div class="tp-menus">
        <div class="tp-menu-wrap">
          <button class="tp-menu-btn${open === "tf" ? " on" : ""}" data-tp-menu="tf"
                  aria-expanded="${open === "tf"}">${esc(tf.label)}<i></i></button>
          ${open === "tf" ? `<div class="tp-menu">
            ${TP_TFS.map((t) => `<button class="tp-menu-item${t.id === state.tpTf ? " on" : ""}"
              data-tp-tf="${t.id}">${esc(t.label)}</button>`).join("")}
          </div>` : ""}
        </div>
        <div class="tp-menu-wrap">
          <button class="tp-menu-btn${open === "tools" ? " on" : ""}" data-tp-menu="tools"
                  aria-expanded="${open === "tools"}">${esc(tool.label)}<i></i></button>
          ${open === "tools" ? `<div class="tp-menu">
            ${DC_TOOLS.map((t) => `<button class="tp-menu-item${t.id === state.tpTool ? " on" : ""}"
              data-tp-tool="${t.id}">${esc(t.label)}</button>`).join("")}
            <button class="tp-menu-item del${state.tpSel == null ? " off" : ""}"
              ${state.tpSel == null ? "disabled" : ""} data-tp-draw-del>Delete</button>
          </div>` : ""}
        </div>
      </div>`;
  }

  function tpChartHTML() {
    if (state.tpPractice) return tpPracticeHTML();
    if (state.tpPatOpen) return tpPatternHTML();
    if (state.tpMode === "aeway") return tpAewayHTML();
    const sym = tpSymbol();
    const row = TP_UNI[sym] || { sym, name: sym, base: 100 };
    const all = tpSeries(sym, state.tpTf);
    tpClampView();
    const view = all.slice(state.tpFrom, state.tpFrom + state.tpSpan);
    const chg = (view[view.length - 1].close - view[0].open) / view[0].open * 100;
    return `
      ${tpModeHTML("data-tp-mode")}
      <div class="tp-chart tall${state.tpTool !== "cursor" ? " drawing" : ""}" id="tpChart">
        <div class="tp-track" id="tpTrack">${tpBarsHTML()}</div>
        <div class="dc-overlay" id="tpOverlay">${dcOverlayHTML("m")}</div>
        <div class="dc-cross" id="tpCross" hidden>
          <span class="dc-cross-v"></span><span class="dc-cross-h"></span>
        </div>
        <span class="dc-read dc-read-p" id="tpReadP" hidden></span>
        <span class="dc-read dc-read-t" id="tpReadT" hidden></span>
        <div class="tp-ticker">${esc(sym)} - ${esc(row.name)}</div>
        <span class="tp-chg ${chg >= 0 ? "up" : "down"}" id="tpChg">${chg >= 0 ? "+" : ""}${chg.toFixed(2)}%</span>
        ${tpMenusHTML()}
      </div>
      ${tpSaveBarHTML("m")}
      ${tpStripHTML()}`;
  }


  /* ==================== DESKTOP CHART + WATCHLIST ====================
     The right panel is the same chart the hamburger's Chart tab draws — the
     same series, the same eight timeframes, the same percent geometry via
     tpGeom — with its own view window so panning one does not move the other.
     What is desktop-only is the pointer work: a crosshair with price and time
     at the edges, and three drawings on top.

     Drawings are held in chart space (a bar index and a price), never in
     pixels, so they stay attached to the candles through a pan, a zoom and a
     panel resize. They live for the session; nothing here writes to the
     store. ==> a later pass can persist them per symbol+timeframe. */

  const DC_TOOLS = [
    { id: "cursor", label: "Cursor" },
    { id: "line",   label: "Trend" },
    { id: "box",    label: "Box" },
    { id: "fib",    label: "Fib" },
  ];
  /* Deliberately five levels, not the fuller standard set. */
  const DC_FIB = [0, 38.2, 50, 61.8, 100];

  /* The two charts this layer serves. Everything below reads a chart through
     one of these rather than naming dc* or tp* directly, so the crosshair and
     the three tools are one implementation on both platforms — item 7 is a
     port, not a second design. */
  const DC = {
    d: {
      box: "dcBox", ov: "dcOverlay", cross: "dcCross", rp: "dcReadP", rt: "dcReadT",
      draw: "dcDraw", sel: "dcSel", tool: "dcTool", draft: "dcDraft",
      tf: () => state.dcTf,
      geom: () => dcGeom(),
      repaint: () => dcPaint(),
      rerender: () => renderDesktopTools(),
    },
    m: {
      box: "tpChart", ov: "tpOverlay", cross: "tpCross", rp: "tpReadP", rt: "tpReadT",
      draw: "tpDraw", sel: "tpSel", tool: "tpTool", draft: "tpDraft",
      tf: () => state.tpTf,
      geom: () => { tpClampView(); return tpGeom(tpSymbol(), state.tpTf, state.tpFrom, state.tpSpan); },
      repaint: () => tpPaintBars(),
      /* NOT render(): rebuilding the panel replaces #tpChart, and replacing
         it in the middle of a touch loses the pointerup that would have
         ended the gesture. The overlay and the toolbar are updated in place
         instead, which is all that ever changes. */
      rerender: () => tpSyncTools(),
    },
  };
  /* the phone's chart, updated where it stands */
  function tpSyncTools() {
    const ov = document.getElementById("tpOverlay");
    if (ov) ov.innerHTML = dcOverlayHTML("m");
    const del = document.querySelector("[data-tp-draw-del]");
    if (del) {
      del.disabled = state.tpSel == null;
      del.classList.toggle("off", state.tpSel == null);
    }
    document.querySelectorAll("[data-tp-tool]").forEach((btn) => {
      btn.classList.toggle("on", btn.getAttribute("data-tp-tool") === state.tpTool);
    });
    const chart = document.getElementById("tpChart");
    if (chart) chart.classList.toggle("drawing", state.tpTool !== "cursor");
  }

  /* which chart an event landed in, or null */
  function dcWhich(target) {
    if (!target || !target.closest) return null;
    const k = target.closest("#dcBox") ? "d" : target.closest("#tpChart") ? "m" : null;
    return k && !tpFrozen(k) ? k : null;
  }

  const dcSignedIn = () => !!(window.FB && FB.user());
  const dcTf = () => TP_TFS.find((t) => t.id === state.dcTf) || TP_TFS[3];
  function dcGeom() {
    state.dcSpan = Math.max(TP_SPAN_MIN, Math.min(TP_SPAN_MAX, Math.round(state.dcSpan)));
    if (state.dcFrom == null) state.dcFrom = TP_BARS;
    state.dcFrom = Math.max(0, Math.min(TP_BARS - state.dcSpan, Math.round(state.dcFrom)));
    return tpGeom(state.dcSym, state.dcTf, state.dcFrom, state.dcSpan);
  }
  /* the newest bar is now; everything before it steps back one timeframe */
  function dcTimeAt(gi, tfId) {
    const tf = TP_TFS.find((t) => t.id === (tfId || state.dcTf)) || TP_TFS[3];
    const mins = (TP_BARS - 1 - gi) * tf.min;
    const d = new Date(Date.now() - mins * 60000);
    return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }
  const dcPriceLabel = (v) => v >= 1000 ? v.toFixed(1) : v >= 10 ? v.toFixed(2) : v.toFixed(3);

  /* a drawing, in chart space, as SVG in the same percent box as the bars */
  function dcShapeSVG(d, g, i, selected) {
    const x1 = g.x(d.a.i), y1 = g.y(d.a.p), x2 = g.x(d.b.i), y2 = g.y(d.b.p);
    const cls = `dc-shape${selected ? " sel" : ""}`;
    if (d.type === "box") {
      return `<rect class="${cls}" data-dc-shape="${i}" vector-effect="non-scaling-stroke"
        x="${Math.min(x1, x2)}" y="${Math.min(y1, y2)}"
        width="${Math.abs(x2 - x1)}" height="${Math.abs(y2 - y1)}"></rect>`;
    }
    if (d.type === "fib") {
      const lo = Math.min(d.a.p, d.b.p), hi = Math.max(d.a.p, d.b.p);
      const xa = Math.min(x1, x2), xb = Math.max(x1, x2);
      return DC_FIB.map((lv) => {
        const p = hi - (hi - lo) * (lv / 100);
        const y = g.y(p);
        return `<line class="${cls} fib" data-dc-shape="${i}" vector-effect="non-scaling-stroke"
          x1="${xa}" y1="${y}" x2="${xb}" y2="${y}"></line>`;
      }).join("");
    }
    return `<line class="${cls}" data-dc-shape="${i}" vector-effect="non-scaling-stroke"
      x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"></line>`;
  }

  /* fib's own labels are HTML, not SVG: the box is stretched to fill the
     panel, so text inside it would stretch with it */
  function dcLabelsHTML(d, g) {
    if (!d || d.type !== "fib") return "";
    const lo = Math.min(d.a.p, d.b.p), hi = Math.max(d.a.p, d.b.p);
    /* the level, and only the level. A price at each line said nothing the
       axis was not already saying, and it read as a quote. They sit against
       the right edge so the lines themselves stay clear. */
    return DC_FIB.map((lv) => {
      const p = hi - (hi - lo) * (lv / 100);
      return `<span class="dc-fib-lbl" style="top:${g.y(p).toFixed(2)}%">${lv.toFixed(1)}%</span>`;
    }).join("");
  }

  function dcOverlayHTML(k) {
    const C = DC[k], g = C.geom();
    const list = state[C.draw], selIdx = state[C.sel], draftD = state[C.draft];
    const shapes = list.map((d, i) => dcShapeSVG(d, g, i, i === selIdx)).join("");
    const draft = draftD ? dcShapeSVG(draftD, g, -1, false) : "";
    /* handles only on the selected one, so a busy chart is not all dots */
    const sel = list[selIdx];
    const handles = sel ? [sel.a, sel.b].map((pt, k) =>
      `<circle class="dc-handle" data-dc-handle="${k}" vector-effect="non-scaling-stroke"
        cx="${g.x(pt.i)}" cy="${g.y(pt.p)}" r="1.4"></circle>`).join("") : "";
    /* every fib keeps its levels labelled, selected or not — an unlabelled
       retracement is just five lines */
    const labels = list.map((d) => dcLabelsHTML(d, g)).join("")
      + dcLabelsHTML(draftD, g);
    return `<svg class="dc-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
        ${shapes}${draft}${handles}
      </svg>
      <div class="dc-labels">${labels}</div>`;
  }

  /* ---- the desktop chart's controls, in the header band ----
     Everything that steers the chart — the toggle, what it is showing, the
     drawings and the timeframe — sits in the top strip above the right
     column rather than on top of the chart card, so the card is the plot and
     the two buttons under it and nothing else.

     The strip is wide and short where the card was narrow and tall, so the
     four stacked rows become two: what the chart is on one line, how you
     work it on the next. */
  function dcHeadToolsHTML() {
    if (state.tpPatOpen) {
      const rec = patFind(state.tpPatOpen);
      if (rec) {
        const d = new Date(rec.at);
        return `
          <div class="dt-ht-row">
            ${tpModeHTML("data-dc-mode")}
            <div class="dc-quote"><b>${esc(rec.sym)}</b><span class="dc-name">${esc(rec.tf)} ·
              saved ${d.toLocaleDateString([], { month: "short", day: "numeric" })}</span></div>
          </div>
          <div class="dt-ht-row">
            <span class="dt-ht-note">Saved pattern — frozen</span>
            <div class="dc-tools">
              <button class="dc-tool" data-pat-close>Back to the chart</button>
              <button class="dc-tool" data-pat-del="${esc(rec.id)}">Delete</button>
            </div>
          </div>`;
      }
      state.tpPatOpen = null;
    }
    if (state.dcMode === "aeway") {
      return `
        <div class="dt-ht-row">
          ${tpModeHTML("data-dc-mode")}
          <div class="dc-quote"><b>$ÆWAY</b>
            <span class="dc-name">Æway Trading System — price action only</span></div>
        </div>`;
    }
    const g = dcGeom();
    const row = TP_UNI[state.dcSym] || { sym: state.dcSym, name: state.dcSym };
    const chg = (g.view[g.view.length - 1].close - g.view[0].open) / g.view[0].open * 100;
    return `
      <div class="dt-ht-row">
        ${tpModeHTML("data-dc-mode")}
        <div class="dc-quote"><b>${esc(state.dcSym)}</b>
          <span class="${chg >= 0 ? "up" : "down"}">${chg >= 0 ? "+" : ""}${chg.toFixed(2)}%</span>
          <span class="dc-name">${esc(row.name)}</span></div>
      </div>
      <div class="dt-ht-row">
        <div class="dc-tf">
          ${TP_TFS.map((t) => `<button class="dc-tf-btn${t.id === state.dcTf ? " on" : ""}"
            data-dc-tf="${t.id}">${t.label}</button>`).join("")}
        </div>
        <div class="dc-tools">
          ${DC_TOOLS.map((t) => `<button class="dc-tool${t.id === state.dcTool ? " on" : ""}"
            data-dc-tool="${t.id}">${esc(t.label)}</button>`).join("")}
          <button class="dc-tool dc-del${state.dcSel == null ? " off" : ""}"
            ${state.dcSel == null ? "disabled" : ""} data-dc-del>Delete</button>
        </div>
      </div>`;
  }

  /* the card itself: the plot, and what you do with the plot */
  function dcChartHTML() {
    if (state.tpPatOpen) return dcPatternHTML();
    if (state.dcMode === "aeway") return dcAewayHTML();
    const g = dcGeom();
    return `
      <div class="dc-box${state.dcTool !== "cursor" ? " drawing" : ""}" id="dcBox">
        <div class="tp-track" id="dcTrack">${tpCandlesHTML(g)}</div>
        <div class="dc-overlay" id="dcOverlay">${dcOverlayHTML("d")}</div>
        <div class="dc-cross" id="dcCross" hidden>
          <span class="dc-cross-v"></span><span class="dc-cross-h"></span>
        </div>
        <span class="dc-read dc-read-p" id="dcReadP" hidden></span>
        <span class="dc-read dc-read-t" id="dcReadT" hidden></span>
      </div>
      ${tpSaveBarHTML("d")}`;
  }

  /* ---- the desktop's ÆWAY panel ----
     The same screen, not a second one. The chart is a canvas that measures its
     own box, so the one implementation fits a 320-pixel panel and a 900-pixel
     one without a line of difference; what the desktop does not get is the mode
     toggle, which its own chrome already draws above the panel. */
  function dcAewayHTML() {
    return `<div class="aw-desk">${tpAewayHTML(true)}</div>`;
  }

  function dcPatternHTML() {
    const rec = patFind(state.tpPatOpen);
    if (!rec) { state.tpPatOpen = null; return dcChartHTML(); }
    return `
      <div class="dc-box pat-chart">
        <div class="tp-track">${tpCandlesHTML(patGeom(rec))}</div>
        <div class="dc-overlay">${patOverlayHTML(rec)}</div>
      </div>`;
  }

  /* The watchlist as the bottom panel: the same list and the same search the
     hamburger's Watchlist tab uses, laid out along a strip instead of down a
     column, and each row switches the chart above it. */
  function dcWatchHTML() {
    const key = todayKey();
    const q = (state.dcQuery || "").trim().toUpperCase();
    const hits = q
      ? TP_UNIVERSE.filter((r) => r.sym.indexOf(q) >= 0 || r.name.toUpperCase().indexOf(q) >= 0).slice(0, 6)
      : [];
    return `
      <div class="dc-wl-head">
        <span class="dc-wl-cap">Watchlist</span>
        <input id="dcSearch" class="dc-wl-search" type="search" autocomplete="off"
               placeholder="Search a ticker" value="${esc(state.dcQuery || "")}" data-dc-q>
      </div>
      ${hits.length ? `<div class="dc-wl-hits">
        ${hits.map((r) => {
          const on = tpWatchlist().indexOf(r.sym) >= 0;
          return `<button class="dc-wl-hit" data-dc-add="${esc(r.sym)}"${on ? " disabled" : ""}>
            <b>${esc(r.sym)}</b><span>${esc(r.name)}</span>${on ? "<i>Added</i>" : "<i>+</i>"}</button>`;
        }).join("")}
      </div>` : ""}
      <div class="dc-wl-rows">
        ${tpWatchlist().map((sym) => {
          const row = TP_UNI[sym] || { sym, name: sym, base: 100 };
          const qt = tpQuote(row, key);
          return `<div class="dc-wl-row${sym === state.dcSym ? " on" : ""}">
            <button class="dc-wl-pick" data-dc-sym="${esc(sym)}">
              <b>${esc(sym)}</b>
              <span class="dc-wl-name">${esc(row.name)}</span>
              <span class="dc-wl-last">${esc(qt.last)}</span>
              <span class="dc-wl-chg ${qt.pct >= 0 ? "up" : "down"}">${qt.pct >= 0 ? "+" : ""}${qt.pct.toFixed(2)}%</span>
            </button>
            <button class="dc-wl-del" data-dc-del-sym="${esc(sym)}" aria-label="Remove ${esc(sym)}">×</button>
          </div>`;
        }).join("")}
      </div>`;
  }

  /* Only a signed-in visitor gets either panel. FB.user() is the real thing —
     the session is persisted and restored on load, and it is already what
     gates cloud sync — so a logged-out visitor keeps the empty frames. */
  /* both chart surfaces at once. The mode and the saved patterns belong to
     the feature rather than to one panel, so a change to either has to reach
     the phone's chart and the desktop panel together. */
  function renderBothCharts() { render(); renderDesktopTools(); }

  /* The landing art. Three of the desktop panels stand empty until someone
     signs in, and this is what they hold instead: one picture each, filling
     the panel inside its lit rim. They are written as bare divs and dressed
     by CSS, and that CSS lives inside the desktop query — so a phone, which
     runs this function too and gets the same divs, never fetches a single
     one of the images. */
  const dtStill = (name) => `<div class="dt-still dt-still-${name}" aria-hidden="true"></div>`;

  function renderDesktopTools() {
    const chart = document.querySelector(".dt-panel-chart");
    const wide = document.querySelector(".dt-panel-wide");
    const square = document.querySelector(".dt-panel-square");
    const head = document.getElementById("dtChartBar");
    if (!chart || !wide) return;
    const on = dcSignedIn() && window.matchMedia(DESKTOP_MQ).matches;
    /* all three are built before any is written: assigning as we go once left
       the chart rendered and the watchlist blank when the second threw */
    const h = on && head ? dcHeadToolsHTML() : "";
    const a = on ? dcChartHTML() : dtStill("portal");
    const c = on ? dcWatchHTML() : dtStill("discipline");
    chart.classList.toggle("dt-live", on);
    wide.classList.toggle("dt-live", on);
    if (head) { head.classList.toggle("dt-live", on); head.innerHTML = h; }
    chart.innerHTML = a;
    wide.innerHTML = c;
    /* the left panel has no signed-in counterpart — it simply empties */
    if (square) square.innerHTML = on ? "" : dtStill("journey");
  }

  /* the bars and the drawings only; the toolbar and the watchlist stay put
     while a pan is running */
  function dcPaint() {
    const g = dcGeom();
    const track = document.getElementById("dcTrack");
    if (track) track.innerHTML = tpCandlesHTML(g);
    const ov = document.getElementById("dcOverlay");
    if (ov) ov.innerHTML = dcOverlayHTML("d");
  }

  /* ==================== PRACTICE LOOP ====================
     The two axes the Æway games already score separately: name the phase you
     are looking at, and call the candle that has not printed yet. Both are
     marked independently, because getting one right and the other wrong is
     the interesting case — a reader who names the phase but calls the wrong
     way has half the skill.

     The story's composed sequence is what marks the phase answer. It is read
     here and nowhere else, and nothing about it reaches the screen. */

  /* nine to choose from: the eight the spec names, plus the opening range,
     with the two rejections offered as one — the difference between a soft
     and a hard rejection is not what this question is asking */
  const TP_PHASE_OPTS = [
    { id: "range", label: "Range Set" },
    { id: "breakout", label: "Breakout" },
    { id: "fakeout", label: "Fakeout" },
    { id: "retrace", label: "Retracement" },
    { id: "reject", label: "Rejection" },
    { id: "retest", label: "Retest" },
    { id: "continuation", label: "Continuation" },
    { id: "reversal", label: "Reversal" },
    { id: "consolidation", label: "Consolidation" },
  ];
  const tpPhaseKey = (id) => (id === "rejectsoft" || id === "rejecthard") ? "reject" : id;
  const TP_SEEN = 8;          // candles on screen before the first question
  const TP_ROUNDS = 6;        // questions in a session
  const TP_GAP = 2;           // candles that print between one question and the next

  /* which story the last session used, so "Another story" is another one and
     not the same thirty candles again */
  let tpPracAt = null;

  function tpPracticeStart() {
    const sym = tpSymbol(), tf = state.tpTf;
    tpSeries(sym, tf);                       // makes sure the stories exist
    const list = tpStories[sym + "|" + tf + "|" + seBucket()];
    if (!list || !list.length) return;
    /* newest first, then back through the ones it was built on top of */
    const idx = tpPracAt == null || tpPracAt >= list.length
      ? list.length - 1
      : (tpPracAt - 1 + list.length) % list.length;
    tpPracAt = idx;
    let from = 0;
    for (let i = 0; i < idx; i++) from += list[i].candles.length;
    /* the last story can be cut short by the end of the series */
    const len = Math.min(list[idx].candles.length, TP_BARS - from);
    state.tpPractice = {
      sym, tf, from, len,
      shown: Math.min(TP_SEEN, Math.max(2, len - 1)),
      phase: null, dir: null,                 // this round's two answers
      graded: null,
      phaseHits: 0, dirHits: 0, rounds: 0,
    };
    render();
  }

  function tpPracticeGeom(p) {
    /* only what has printed: the rest of the story has not happened yet */
    return tpGeom(p.sym, p.tf, p.from, Math.max(2, p.shown));
  }

  function tpPracticeHTML() {
    const p = state.tpPractice;
    const g = tpPracticeGeom(p);
    const over = p.rounds >= TP_ROUNDS || p.shown >= p.len;
    const ready = p.phase && p.dir;
    const gr = p.graded;
    return `
      <div class="tp-prac-head">
        <span class="tp-prac-cap">Practice</span>
        <span class="tp-prac-score">Phase <b>${p.phaseHits}</b>/${p.rounds}
          · Direction <b>${p.dirHits}</b>/${p.rounds}</span>
        <button class="dc-tool" data-tp-prac-end>Exit</button>
      </div>
      <div class="tp-chart" id="tpPracChart">
        <div class="tp-track">${tpCandlesHTML(g)}</div>
      </div>
      ${gr ? `<div class="tp-prac-mark">
          <div class="tp-prac-line ${gr.phaseOk ? "ok" : "no"}">
            Phase — ${gr.phaseOk ? "correct" : `you said ${esc(gr.said)}, it was ${esc(gr.was)}`}</div>
          <div class="tp-prac-line ${gr.dirOk ? "ok" : "no"}">
            Next candle — ${gr.dirOk ? "correct" : `it printed ${gr.actual}`}</div>
          <button class="ci-submit" data-tp-prac-next>${over ? "See result" : "Next"}</button>
        </div>`
      : over ? `<div class="tp-prac-done">
          <div class="ci-result-title">Session complete</div>
          <div class="ci-result-body">Phase ${p.phaseHits} of ${p.rounds} ·
            Direction ${p.dirHits} of ${p.rounds}</div>
          <button class="btn-primary" data-tp-prac-again>Another story</button>
          <button class="btn-secondary" data-tp-prac-end>Back to the chart</button>
        </div>`
      : `<div class="tp-prac-q">
          <div class="bt-q">What's happening right now?</div>
          <div class="bt-opts bt-opts-3">
            ${TP_PHASE_OPTS.map((o) => `<button class="bt-opt${p.phase === o.id ? " on" : ""}"
              data-tp-prac-phase="${o.id}">${esc(o.label)}</button>`).join("")}
          </div>
          <div class="bt-q">The next candle — green or red?</div>
          <div class="bt-opts bt-opts-2">
            <button class="bt-opt up${p.dir === "up" ? " on" : ""}" data-tp-prac-dir="up">Green</button>
            <button class="bt-opt down${p.dir === "down" ? " on" : ""}" data-tp-prac-dir="down">Red</button>
          </div>
          <button class="ci-submit${ready ? "" : " off"}"${ready ? "" : " disabled"}
            data-tp-prac-submit>Submit</button>
        </div>`}`;
  }

  /* marks both axes, then lets the next candle print */
  function tpPracticeSubmit() {
    const p = state.tpPractice;
    if (!p || !p.phase || !p.dir || p.graded) return;
    const all = tpSeries(p.sym, p.tf);
    const curIdx = p.from + p.shown - 1;      // the last candle on screen
    const nextIdx = p.from + p.shown;
    const was = tpPhaseKey(tpPhaseAt(p.sym, p.tf, curIdx) || "consolidation");
    const actual = all[nextIdx] ? all[nextIdx].dir : "up";
    const phaseOk = p.phase === was;
    const dirOk = p.dir === actual;
    p.rounds++;
    if (phaseOk) p.phaseHits++;
    if (dirOk) p.dirHits++;
    p.graded = { phaseOk, dirOk, actual: actual === "up" ? "green" : "red",
      said: (TP_PHASE_OPTS.find((o) => o.id === p.phase) || {}).label,
      was: (TP_PHASE_OPTS.find((o) => o.id === was) || {}).label || was };
    p.shown = Math.min(p.len, p.shown + 1);   // the candle they called prints
    render();
  }

  function tpWatchHTML() {
    const key = todayKey();
    const q = (state.tpQuery || "").trim().toUpperCase();
    const list = tpWatchlist();
    const hits = q
      ? TP_UNIVERSE.filter((r) => r.sym.indexOf(q) >= 0 || r.name.toUpperCase().indexOf(q) >= 0).slice(0, 8)
      : [];
    return `
      <div class="tp-search">
        <input class="tp-search-in" id="tpSearch" type="text" inputmode="latin"
               autocomplete="off" autocapitalize="characters" spellcheck="false"
               placeholder="Search a symbol — ES, gold, AAPL" value="${esc(state.tpQuery || "")}"
               aria-label="Search for a symbol">
        ${q ? `<button class="tp-search-x" data-tp-q="" aria-label="Clear search">✕</button>` : ""}
      </div>
      ${q ? `<div class="tp-hits">
        ${hits.length ? hits.map((r) => {
          const on = list.indexOf(r.sym) >= 0;
          return `<button class="tp-hit" data-tp-add="${esc(r.sym)}"${on ? " disabled" : ""}>
            <span class="tp-sym">${esc(r.sym)}<small>${esc(r.name)}</small></span>
            <span class="tp-hit-add">${on ? "On list" : "Add"}</span>
          </button>`;
        }).join("") : `<div class="tp-note">Nothing matches “${esc(q)}”.</div>`}
      </div>` : ""}
      <div class="tp-rows">
        ${list.map((sym) => {
          const row = TP_UNI[sym] || { sym, name: sym, base: 100 };
          const quote = tpQuote(row, key);
          return `<div class="tp-row">
            <button class="tp-sym tp-sym-go" data-tp-sym="${esc(sym)}">
              ${esc(row.sym)}<small>${esc(row.name)}</small></button>
            <span class="tp-last">${quote.last}</span>
            <span class="tp-chg ${quote.pct >= 0 ? "up" : "down"}">${quote.pct >= 0 ? "+" : ""}${quote.pct.toFixed(2)}%</span>
            <button class="tp-del" data-tp-del="${esc(sym)}" aria-label="Remove ${esc(sym)}">✕</button>
          </div>`;
        }).join("")}
      </div>
      <div class="tp-note">Sample prices, steady for the day — no market feed is
        connected yet.</div>`;
  }

  /* ---- economic calendar ----
     Which events land on a date comes from the date, so every day the user
     steps to has a stable set instead of only this week having one. */
  function tpEventsFor(d) {
    const key = dayKeyOf(d);
    let h = 2166136261;
    for (const ch of key) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    const rnd = () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h ^= h >>> 13; return ((h >>> 0) % 10000) / 10000; };
    const dow = d.getDay();
    if (dow === 0 || dow === 6) return [];        // the tape is shut
    const n = 2 + Math.floor(rnd() * 4);
    const picked = [], used = {};
    for (let i = 0; i < n; i++) {
      let k = Math.floor(rnd() * TP_EVENT_POOL.length);
      for (let g = 0; used[k] && g < TP_EVENT_POOL.length; g++) k = (k + 1) % TP_EVENT_POOL.length;
      used[k] = true;
      picked.push(Object.assign({ t: TP_EVENT_TIMES[Math.floor(rnd() * TP_EVENT_TIMES.length)] },
        TP_EVENT_POOL[k]));
    }
    return picked.sort((a, b) => a.t.localeCompare(b.t));
  }

  function tpCalHTML() {
    const d = state.tpDate ? new Date(state.tpDate + "T12:00:00") : new Date();
    const key = dayKeyOf(d);
    const evs = tpEventsFor(d);
    const impLabel = (n) => n >= 3 ? "High" : n === 2 ? "Med" : "Low";
    return `
      <div class="tp-datebar">
        <button class="tp-step" data-tp-day="-1" aria-label="Previous day">‹</button>
        <input class="tp-date" id="tpDate" type="date" value="${key}" aria-label="Pick a date">
        <button class="tp-step" data-tp-day="1" aria-label="Next day">›</button>
      </div>
      <div class="tp-datehead">
        ${d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
        ${key === todayKey() ? " · today" : ""}
        ${key !== todayKey() ? `<button class="tp-today" data-tp-day="0">Today</button>` : ""}
      </div>
      <div class="tp-cal">
        ${evs.length ? evs.map((e) => `
          <div class="tp-ev">
            <span class="tp-ev-t">${esc(e.t)}</span>
            <span class="tp-ev-c">${esc(e.cur)}</span>
            <span class="tp-ev-n">${esc(e.name)}</span>
            <span class="tp-ev-i i${e.imp}">${impLabel(e.imp)}</span>
          </div>`).join("")
          : `<div class="tp-note">Nothing scheduled — markets are closed.</div>`}
      </div>
      <div class="tp-note">Sample events — no calendar feed is connected yet.</div>`;
  }

  function toolsPanelHTML() {
    const tab = TP_TABS.some((t) => t.id === state.tpTab) ? state.tpTab : "chart";
    const body = tab === "watch" ? tpWatchHTML()
      : tab === "cal" ? tpCalHTML()
      : tpChartHTML();
    return `
      <div class="tp-tabs">
        ${TP_TABS.map((t) => `<button class="tp-tab${t.id === tab ? " on" : ""}"
          data-tp-tab="${t.id}">${esc(t.label)}</button>`).join("")}
      </div>
      <div class="tp-body">${body}</div>`;
  }

  /* ---------------- the two inline center panels ----------------
     The hamburger and the gear used to open overlays. They render into the
     middle of the screen now, over whatever view is underneath, and they are
     one slot rather than two: state.panel holds "tools", "settings" or null,
     so opening one closes the other by construction rather than by a pair of
     handlers remembering to. Tapping the lit icon again closes it.

     Nothing else in the app changed: every other overlay, modal and popup is
     out of scope and still uses openOverlay. */
  /* The name is a live input, so it lives in the DOM until something asks for
     it. Every route out of settings — the overlay's Done, the panel's X, the
     gear that closes it, a tab away — comes through here first, or a typed
     name would be lost. */
  function commitSettingsName() {
    const el = $("setName");
    if (el) { store.settings.name = el.value.trim(); save(); }
  }

  function togglePanel(which) {
    if (state.panel === "settings") commitSettingsName();
    state.panel = state.panel === which ? null : which;
    state.panelView = state.panel ? state.view : null;
    if (state.panel) closeOverlay();
    render();
  }

  /* The course menu that used to sit under the hamburger is gone. It appeared
     below every section of the panel rather than belonging to any of them,
     and the same navigation is the home screen's own All Sections tab, which
     is where it belongs. */

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
      <div class="set-group">
        <div class="set-label">ÆWAY play points</div>
        <div class="set-bal">${awNum(awPoints())} <i>play points</i></div>
        ${state.awResetAsk ? `
          <div class="set-ask">Start again from 10,000? Open predictions and the
            point history go with it.</div>
          <div class="set-options">
            <button class="set-opt active" data-aw-reset-ok>Reset</button>
            <button class="set-opt" data-aw-reset-no>Keep</button>
          </div>`
          : `<button class="set-opt" data-aw-reset>Reset balance</button>`}
      </div>
      <button class="btn-secondary" data-reset-progress>Reset course progress</button>
      <button class="btn-secondary" data-logout>Log Out</button>`;
    openOverlay(html);
  }

  /* The same settings, without the overlay's head and Done button — those
     belong to a panel that had to be dismissed, and this one is dismissed by
     the gear that opened it. */
  function settingsPanelHTML() {
    const s = store.settings;
    return `
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
      <div class="set-group">
        <div class="set-label">Plan</div>
        ${tpPlanHTML()}
      </div>
      <div class="set-group">
        <div class="set-label">ÆWAY play points</div>
        <div class="set-bal">${awNum(awPoints())} <i>play points</i></div>
        ${state.awResetAsk ? `
          <div class="set-ask">Start again from 10,000? Open predictions and the
            point history go with it.</div>
          <div class="set-options">
            <button class="set-opt active" data-aw-reset-ok>Reset</button>
            <button class="set-opt" data-aw-reset-no>Keep</button>
          </div>`
          : `<button class="set-opt" data-aw-reset>Reset balance</button>`}
      </div>
      <button class="btn-secondary" data-reset-progress>Reset course progress</button>
      <button class="btn-secondary" data-logout>Log Out</button>`;
  }

  /* Plan lives with the rest of the account under the gear now, not as a tab
     among the market tools — it is something about you, not about the tape. */
  /* ---- the paid tiers are off in this build ----
     The ÆWAY brief is explicit that there is to be no mention of subscriptions,
     rewards, cash or redemption anywhere in the app while points are play
     points, and two tiers priced per month next to a balance of Æway points is
     exactly the thing it is guarding against: a tester would reasonably read
     the one as a way to buy the other.

     So they are behind a flag rather than deleted. The screen, the markup and
     the upgrade path are untouched and one line in js/config.js brings them
     back; nothing about this is a decision that pricing has changed. */
  function tpPlanHTML() {
    const plan = (store.plan && store.plan.id) || "free";
    const paid = !!(window.LEARNAEWAY_CONFIG && window.LEARNAEWAY_CONFIG.showPaidPlans);
    const TIERS = [
      { id: "free", name: "Beta", price: "Free", lines: ["The full course", "Trade Journal", "Gameæway", "Practice chart", "The ÆWAY chart and predictions"] },
      { id: "pro", name: "Pro", price: "$19/mo", lines: ["Everything in Beta", "Live market data", "Unlimited journal imports", "Priority Ask Æway"] },
      { id: "desk", name: "Desk", price: "$49/mo", lines: ["Everything in Pro", "Prop firm tracking", "Connections and leaderboards", "Early access to new games"] },
    ].filter((t) => paid || t.id === "free");
    return `
      <div class="tp-plans">
        ${TIERS.map((t) => `
          <div class="tp-plan${t.id === plan ? " on" : ""}">
            <div class="tp-plan-top">
              <span class="tp-plan-name">${esc(t.name)}</span>
              <span class="tp-plan-price">${esc(t.price)}</span>
            </div>
            <ul class="tp-plan-list">${t.lines.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>
            ${t.id === plan
              ? `<div class="tp-plan-cur">Your plan</div>`
              : `<button class="pa-ghost" data-tp-plan="${t.id}">Upgrade</button>`}
          </div>`).join("")}
      </div>
      ${paid ? `<div class="tp-note">Billing is not connected yet — upgrading tells us you
        are interested and changes nothing else.</div>` : ""}`;
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

      ${profileOnlineHTML()}

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
        ${/* ==> connections.js: the connect-code section that used to sit here
              is gone — code, share, AEW-XXXXXX box and Send Request with it.
              Connections are their own screen now, and they are found the way
              challenges are: an exact name or a match invite code. */""}
        <button class="pr-conn-entry" data-open-connections>
          <span class="pr-conn-entry-n">${connCount()}</span>
          <span class="pr-conn-entry-cap">Connections</span>
          <span class="pr-conn-entry-go" aria-hidden="true">›</span>
        </button>
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

  function openProfile() {
    stopAudio();
    state.view = "profile";
    state.slideDir = 0;
    state.profileMode = "view";
    state.profileNotice = null;
    closeOverlay();
    render();
    profileOnlineLoad();
  }

  /* ==================== Æway Online — the profile ====================
     The account behind live play, as a section of the profile screen: the
     name and photo the queue shows, a bio, a trading level, and the lifetime
     record the matches write. Everything on it goes through profiles.js.

     ==> INTEGRATION: requireUser() → getProfile(uid) on open; saveProfile on
         Save; uploadProfilePhoto whenever the app's own photo cropper saves,
         so the one picture is both the app's and the account's; the stats
         are read only, written by recordMatchResult at the end of a match. */
  const ONLINE_LEVELS = [
    { id: "beginner", label: "Beginner" },
    { id: "intermediate", label: "Intermediate" },
    { id: "advanced", label: "Advanced" },
  ];

  function profileOnlineState() {
    if (!state.online) state.online = { status: "idle", profile: null, draft: null, notice: null, uid: null };
    return state.online;
  }

  async function profileOnlineLoad(force) {
    const so = profileOnlineState();
    if (so.status === "ready" && !force) { renderProfileOnlineInPlace(); return; }
    so.status = "loading"; so.notice = null;
    renderProfileOnlineInPlace();
    const api = await onlineReady();
    if (state.view !== "profile") return;
    if (!api) { so.status = "offline"; renderProfileOnlineInPlace(); return; }
    let user;
    try { user = await api.requireUser(); } catch (e) { user = null; }
    if (state.view !== "profile") return;
    if (!user) { so.status = "signin"; renderProfileOnlineInPlace(); return; }
    try {
      const p = await api.getProfile(user.uid);
      so.uid = user.uid;
      so.profile = p;
      so.draft = {
        displayName: p.displayName || "",
        bio: p.bio || "",
        tradingLevel: ONLINE_LEVELS.some((l) => l.id === p.tradingLevel) ? p.tradingLevel : "beginner",
      };
      so.status = "ready";
    } catch (e) {
      so.status = "error";
    }
    if (state.view === "profile") renderProfileOnlineInPlace();
  }

  function profileOnlineReadDraft() {
    const so = profileOnlineState();
    if (!so.draft) return;
    const n = $("prOnName"), b = $("prOnBio");
    if (n) so.draft.displayName = n.value.trim().slice(0, 40);
    if (b) so.draft.bio = b.value.trim().slice(0, PROFILE_BIO_MAX);
  }

  function profileOnlineSetLevel(id) {
    const so = profileOnlineState();
    if (!so.draft || !ONLINE_LEVELS.some((l) => l.id === id)) return;
    profileOnlineReadDraft();
    so.draft.tradingLevel = id;
    renderProfileOnlineInPlace();
  }

  async function profileOnlineSave() {
    const so = profileOnlineState();
    const api = online();
    if (!api || so.status !== "ready" || !so.uid) return;
    profileOnlineReadDraft();
    so.notice = { kind: "pending", text: "Saving…" };
    renderProfileOnlineInPlace();
    try {
      await api.saveProfile(so.uid, so.draft);
      so.profile = Object.assign({}, so.profile, so.draft);
      so.notice = { kind: "ok", text: "Saved — this is what opponents see." };
    } catch (e) {
      so.notice = { kind: "err", text: "Couldn't save — check your connection and try again." };
    }
    if (state.view === "profile") renderProfileOnlineInPlace();
  }

  /* the app's cropper has just saved a photo; the account gets the same one.
     A data URL is turned back into a File because that is what the module
     takes — it downsizes it again to its own thumbnail on the way in. */
  async function profileOnlinePhotoSync(dataUrl) {
    const api = online();
    if (!api || !dataUrl) return;
    let user;
    try { user = await api.requireUser(); } catch (e) { return; }
    try {
      const blob = await (await fetch(dataUrl)).blob();
      const file = new File([blob], "profile.jpg", { type: blob.type || "image/jpeg" });
      const url = await api.uploadProfilePhoto(user.uid, file);
      const so = profileOnlineState();
      if (so.profile) so.profile.photoURL = url;
    } catch (e) { /* the app's own copy is saved; the account's follows next time */ }
  }

  /* Copy or the system share sheet, whichever the button asked for — the same
     two the connect code already offers, over the account's invite code. */
  function profileShareInviteCode(btn, useShare) {
    const so = profileOnlineState();
    const code = so.profile && so.profile.inviteCode;
    if (!code) return;
    const done = (text) => { so.notice = { kind: "ok", text }; renderProfileOnlineInPlace(); };
    if (useShare && navigator.share) {
      navigator.share({ title: "Challenge me on Æway", text: `Challenge me on Æway! My code: ${code}` })
        .then(() => done("Code shared."))
        .catch(() => { /* dismissed — say nothing */ });
      return;
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(code)
        .then(() => done("Code copied."))
        .catch(() => done(`Your code is ${code}`));
      return;
    }
    done(`Your code is ${code}`);
  }

  /* the section is re-rendered on its own so the rest of the profile — and
     the scroll position — stay put */
  function renderProfileOnlineInPlace() {
    const host = document.getElementById("prOnline");
    if (host && state.view === "profile") host.outerHTML = profileOnlineHTML();
  }

  /* ==================== Connections ====================
     The connect-code feature this replaces issued a code on the device, took
     another one in a box, and pushed the request onto a local list that
     reached nobody. All of it is gone. What stands here instead is one screen
     with four things on it and nothing else:

       · who you are, and how many people you are connected to
       · the requests waiting on your answer, answered where they are listed
       · one place to find somebody, and one control that says where you stand
         with them — Connect, Requested, Connected
       · a thread, once you are connected

     ==> INTEGRATION (connections.js and messages.js, through AEWAY_ONLINE):
       watchConnectionCount(uid, cb)             — the live count
       watchIncomingConnectionRequests(uid, cb)  — what is waiting on you
       watchOutgoingConnectionRequests(uid, cb)  — what you are waiting on
       getMyConnections(uid)                     — the list, with the other
                                                   person's name and photo
       getConnectionState(myUid, otherUid)       — where you stand with one
       sendConnectionRequest / approve / deny / cancel
       sendMessage(me, otherUid, text) / watchMessages(myUid, otherUid, cb)

     ==> FINDING SOMEBODY is invites.js's lookupPlayer, unchanged and shared
     with the challenge screen: an exact display name or a match invite code.
     There is deliberately no directory, no prefix search and nothing to
     browse, which is the same rule challenges keep.

     ==> SECURITY: messages.js does not check that two players are connected.
     firestore.rules does — a write to conversations/{a_b} is refused unless
     connections/{a_b} exists and names the writer. The UI hiding the button
     is not the enforcement; that rule is. */

  const conn = {
    status: "idle",        // idle | loading | ready | offline | signin | error
    uid: null,
    unsubCount: null, unsubIn: null, unsubOut: null,
    count: 0,
    incoming: [],          // requests waiting on me
    outgoing: [],          // requests waiting on them
    list: null,            // getMyConnections, or null before it is asked for
    listOpen: false,
    listBusy: false,
    results: null,         // what the last lookup resolved to
    states: {},            // uid -> the state getConnectionState reported
    busy: null,            // the uid or request id a call is in flight for
    err: null,
    notice: null,
    thread: null,          // { uid, displayName, photoURL, msgs, unsub, err, sending }
  };

  const connCount = () => conn.count || 0;

  /* The count and the two request lists are watched app-wide, like the
     challenge inbox: an approval can land while its recipient is anywhere,
     and the profile's entry row carries the number. */
  async function connectionsStart() {
    const api = await onlineReady();
    if (!api || !api.watchConnectionCount) return;
    const me = await aewayIdentity();
    if (!me) return;
    if (conn.unsubCount && conn.uid === me.uid) return;
    connectionsStop();
    conn.uid = me.uid;
    conn.unsubCount = api.watchConnectionCount(me.uid, (n) => {
      conn.count = Number(n) || 0;
      /* the list is stale the moment the count moves */
      if (conn.listOpen) connLoadList();
      connRepaint();
    });
    conn.unsubIn = api.watchIncomingConnectionRequests(me.uid, (list) => {
      conn.incoming = Array.isArray(list) ? list : [];
      connRepaint();
    });
    conn.unsubOut = api.watchOutgoingConnectionRequests(me.uid, (list) => {
      conn.outgoing = Array.isArray(list) ? list : [];
      connRepaint();
    });
  }

  function connectionsStop() {
    [conn.unsubCount, conn.unsubIn, conn.unsubOut].forEach((f) => {
      if (f) { try { f(); } catch (e) { /* gone */ } }
    });
    conn.unsubCount = conn.unsubIn = conn.unsubOut = null;
    connThreadClose();
    conn.uid = null; conn.count = 0; conn.incoming = []; conn.outgoing = [];
    conn.list = null; conn.listOpen = false; conn.results = null;
    conn.states = {}; conn.busy = null; conn.err = null; conn.notice = null;
    connRepaint();
  }

  function connRepaint() {
    if (state.view === "connections") renderConnections();
    else if (state.view === "profile") {
      const n = document.querySelector(".pr-conn-entry-n");
      if (n) n.textContent = String(connCount());
    }
  }

  function openConnections() {
    stopAudio();
    state.view = "connections";
    state.slideDir = 0;
    conn.notice = null;
    closeOverlay();
    render();
    connectionsLoad();
  }

  async function connectionsLoad(force) {
    if (conn.status === "ready" && !force) { connectionsStart(); return; }
    conn.status = "loading";
    conn.err = null;
    renderConnections();
    const api = await onlineReady();
    if (state.view !== "connections") return;
    if (!api) { conn.status = "offline"; renderConnections(); return; }
    const me = await aewayIdentity(force);
    if (state.view !== "connections") return;
    if (!me) { conn.status = "signin"; renderConnections(); return; }
    conn.status = "ready";
    await connectionsStart();
    renderConnections();
  }

  /* ---- finding somebody: the challenge screen's lookup, shared ---- */
  async function connLookup() {
    const api = online();
    if (!api || conn.busy) return;
    const input = $("connFind");
    if (input) state.connQuery = input.value.trim();
    conn.err = null; conn.notice = null;
    if (!state.connQuery) { conn.err = "Enter an invite code or a player's exact name."; renderConnections(); return; }
    conn.busy = "lookup"; conn.results = null;
    renderConnections();
    let list = [];
    try { list = await api.lookupPlayer(state.connQuery, conn.uid) || []; }
    catch (e) { conn.busy = null; conn.err = "That lookup didn't go through — check your connection."; renderConnections(); return; }
    conn.busy = null;
    conn.results = list;
    if (!list.length) conn.err = "No player found. Check the code or name and try again.";
    /* where we stand with each of them, from the module rather than from
       whatever this screen happens to be holding */
    await Promise.all(list.map(async (p) => {
      try { conn.states[p.uid] = await api.getConnectionState(conn.uid, p.uid); }
      catch (e) { conn.states[p.uid] = "none"; }
    }));
    if (state.view === "connections") renderConnections();
  }

  /* the state of one person, live: the subscriptions know before a re-read
     would, so they win over the last getConnectionState */
  function connStateOf(uid) {
    if ((conn.list || []).some((c) => c.uid === uid)) return "connected";
    if (conn.outgoing.some((r) => r.toUid === uid)) return "pending-sent";
    if (conn.incoming.some((r) => r.fromUid === uid)) return "pending-received";
    return conn.states[uid] || "none";
  }

  async function connConnect(uid) {
    const api = online();
    const target = (conn.results || []).find((p) => p.uid === uid);
    if (!api || !target || conn.busy) return;
    conn.busy = uid; conn.err = null;
    renderConnections();
    const me = await aewayIdentity();
    if (!me) { conn.busy = null; renderConnections(); return; }
    try { await api.sendConnectionRequest(me, target); conn.states[uid] = "pending-sent"; }
    catch (e) { conn.err = (e && e.message) || "That request didn't send — check your connection."; }
    conn.busy = null;
    renderConnections();
  }

  async function connCancel(uid) {
    const api = online();
    const req = conn.outgoing.find((r) => r.toUid === uid);
    if (!api || !req || conn.busy) return;
    conn.busy = uid;
    renderConnections();
    try { await api.cancelConnectionRequest(req.id); conn.states[uid] = "none"; }
    catch (e) { conn.err = "That didn't go through — check your connection."; }
    conn.busy = null;
    renderConnections();
  }

  async function connAnswer(requestId, approve) {
    const api = online();
    if (!api || conn.busy) return;
    conn.busy = requestId; conn.err = null;
    renderConnections();
    try {
      if (approve) await api.approveConnectionRequest(requestId);
      else await api.denyConnectionRequest(requestId);
      if (approve) { conn.list = null; if (conn.listOpen) await connLoadList(); }
    } catch (e) {
      conn.err = (e && e.message) || "That request is no longer available.";
    }
    conn.busy = null;
    renderConnections();
  }

  /* ---- the list ---- */
  async function connToggleList() {
    conn.listOpen = !conn.listOpen;
    if (conn.listOpen && conn.list === null) { renderConnections(); await connLoadList(); }
    renderConnections();
  }

  async function connLoadList() {
    const api = online();
    if (!api || !conn.uid) return;
    conn.listBusy = true;
    try { conn.list = await api.getMyConnections(conn.uid) || []; }
    catch (e) { conn.list = []; conn.err = "That list couldn't be loaded — check your connection."; }
    conn.listBusy = false;
    if (state.view === "connections") renderConnections();
  }

  /* ---- the thread ----
     Text only, one pair, and it opens inside this screen rather than over it.
     Only a connection has a Message button, and the security rule is what
     actually holds that line. */
  async function connThreadOpen(uid) {
    const api = online();
    const who = (conn.list || []).find((c) => c.uid === uid);
    if (!api || !who || !conn.uid) return;
    connThreadClose();
    conn.thread = { uid, displayName: who.displayName, photoURL: who.photoURL,
                    msgs: null, unsub: null, err: null, sending: false };
    renderConnections();
    const t = conn.thread;
    try {
      t.unsub = api.watchMessages(conn.uid, uid, (list) => {
        if (conn.thread !== t) return;
        t.msgs = Array.isArray(list) ? list : [];
        renderConnections();
        connThreadScroll();
      });
    } catch (e) {
      t.err = "That conversation couldn't be opened.";
      renderConnections();
    }
  }

  function connThreadClose() {
    const t = conn.thread;
    if (t && t.unsub) { try { t.unsub(); } catch (e) { /* gone */ } }
    conn.thread = null;
  }

  function connThreadScroll() {
    const box = $("connMsgs");
    if (box) box.scrollTop = box.scrollHeight;
  }

  async function connSend() {
    const api = online();
    const t = conn.thread;
    const input = $("connMsgInput");
    if (!api || !t || !input || t.sending) return;
    const text = input.value.trim();
    if (!text) return;
    t.sending = true; t.err = null;
    input.value = "";
    renderConnections();
    const me = await aewayIdentity();
    if (!me || conn.thread !== t) return;
    try { await api.sendMessage(me, t.uid, text); }
    catch (e) {
      /* the commonest reason is the security rule: the two are not connected */
      t.err = "That message didn't send. You can only message a connection.";
    }
    t.sending = false;
    if (conn.thread === t) { renderConnections(); connThreadScroll(); }
  }

  /* ---- what it looks like ---- */
  function renderConnections() {
    if (state.view !== "connections") return;
    barTitle.textContent = "Learnæway";
    const nameEl = $("profileBarName");
    if (nameEl) nameEl.textContent = "Connections";
    cardFooter.style.display = "none";
    const keep = cardScroll.scrollTop;
    cardScroll.innerHTML = connectionsHTML();
    cardScroll.scrollTop = keep;
    connThreadScroll();
  }

  const connAvatar = (p, cls) => pwOnlineAvatar(p, cls);

  function connectionsHTML() {
    const head = `
      <div class="pw-lib-head">
        <button type="button" class="pw-hub-back" data-conn-back aria-label="Back to your profile">
          <img src="assets/nav-icons/icon-arrow-back@2x.png" alt="">
        </button>
        <span class="pw-lib-title">Connections</span>
      </div>`;
    if (conn.status === "idle" || conn.status === "loading") {
      return `<div class="conn">${head}
        <div class="pw-finding-body"><div class="pw-spinner sm" aria-hidden="true"></div>
        <div class="pw-finding-cap" role="status">Loading…</div></div></div>`;
    }
    if (conn.status === "offline") {
      return `<div class="conn">${head}
        <div class="pw-on-msg"><b>You're offline</b>
        <span>Connections and messages need a connection.</span></div>
        <div class="pw-over-row"><button type="button" class="pw-over-pill on" data-conn-retry><span>Try Again</span></button></div></div>`;
    }
    if (conn.status === "signin") {
      if (onlineAuthState() === "reconnect") return `<div class="conn">${head}${onlineReconnectHTML("Cn")}</div>`;
      return `<div class="conn">${head}
        <div class="pw-on-msg"><b>Sign in to connect</b>
        <span>Connections live on your account, so it has to be signed in on this device.</span></div>
        <div class="pw-over-row"><button type="button" class="pw-over-pill on" data-pw-online-signin><span>Sign In</span></button></div></div>`;
    }
    if (conn.thread) return `<div class="conn">${head}${connThreadHTML()}</div>`;

    const me = aewayMe || {};
    return `
      <div class="conn">
        ${head}

        ${/* who you are, and the count — tapping it opens the list */""}
        <button type="button" class="conn-me" data-conn-list aria-expanded="${conn.listOpen}">
          ${connAvatar({ photoURL: me.photoURL || store.profilePhoto }, "lg")}
          <span class="conn-me-n">${connCount()}</span>
          <span class="conn-me-cap">Connection${connCount() === 1 ? "" : "s"}</span>
          <span class="conn-me-go" aria-hidden="true">${conn.listOpen ? "▲" : "▼"}</span>
        </button>

        ${conn.listOpen ? `
        <div class="conn-list">
          ${conn.listBusy && conn.list === null
            ? `<div class="conn-empty"><span class="pw-spinner sm" aria-hidden="true"></span> Loading your connections…</div>`
            : (conn.list || []).length
              ? (conn.list || []).map((c) => `
                <div class="conn-row">
                  ${connAvatar(c, "")}
                  <span class="conn-row-name">${esc(c.displayName || "Trader")}</span>
                  <button type="button" class="conn-btn msg" data-conn-msg="${esc(c.uid)}">Message</button>
                </div>`).join("")
              : `<div class="conn-empty">No connections yet. Find someone below.</div>`}
        </div>` : ""}

        ${conn.incoming.length ? `
        <div class="conn-sec">
          <div class="conn-sec-head">
            <span>Requests</span><span class="conn-sec-n">${conn.incoming.length}</span>
          </div>
          ${conn.incoming.map((r) => {
            const busy = conn.busy === r.id;
            return `
            <div class="conn-row">
              ${connAvatar({ photoURL: r.fromPhoto }, "")}
              <span class="conn-row-name">${esc(r.fromName || "A trader")}<i>wants to connect</i></span>
              ${busy
                ? `<span class="pw-spinner sm" aria-hidden="true"></span>`
                : `<button type="button" class="conn-btn yes" data-conn-approve="${esc(r.id)}">Approve</button>
                   <button type="button" class="conn-btn" data-conn-deny="${esc(r.id)}">Deny</button>`}
            </div>`;
          }).join("")}
        </div>` : ""}

        <div class="conn-sec">
          <div class="conn-sec-head"><span>Find someone</span></div>
          ${/* ==> invites.js: the same lookup the challenge screen uses. No
                directory, no prefix search, nothing to browse. */""}
          <div class="conn-find-cap">Their invite code, or their display name exactly as they wrote it.</div>
          <input class="mt-input conn-find" id="connFind" type="text"
                 inputmode="latin" autocapitalize="characters" autocomplete="off" spellcheck="false"
                 maxlength="40" placeholder="KQ7Z2M  ·  or  ·  Jane Trader" value="${esc(state.connQuery || "")}">
          <button type="button" class="btn-primary conn-go" data-conn-find${conn.busy === "lookup" ? " disabled" : ""}>
            ${conn.busy === "lookup" ? "Looking…" : "Find Player"}</button>
          ${conn.err ? `<div class="pw-on-err" role="alert">${esc(conn.err)}</div>` : ""}
          ${(conn.results || []).map((p) => connResultHTML(p)).join("")}
        </div>

        <div class="conn-foot">Your own invite code is on your profile — the same one
          that lets somebody challenge you.</div>
      </div>`;
  }

  /* one person, and the single control that says where you stand with them */
  function connResultHTML(p) {
    const st = connStateOf(p.uid);
    const busy = conn.busy === p.uid;
    const btn = busy
      ? `<span class="pw-spinner sm" aria-hidden="true"></span>`
      : st === "connected"
        ? `<span class="conn-btn done" aria-disabled="true">Connected</span>`
        : st === "pending-sent"
          ? `<button type="button" class="conn-btn sent" data-conn-cancel="${esc(p.uid)}"
                     title="Tap to cancel">Requested</button>`
          : st === "pending-received"
            ? `<span class="conn-btn done" aria-disabled="true">Asked you</span>`
            : `<button type="button" class="conn-btn yes" data-conn-add="${esc(p.uid)}">Connect</button>`;
    return `
      <div class="conn-row result">
        ${connAvatar(p, "md")}
        <span class="conn-row-name">${esc(p.displayName || "Trader")}</span>
        ${btn}
      </div>`;
  }

  function connThreadHTML() {
    const t = conn.thread;
    const rows = t.msgs;
    return `
      <div class="conn-thread">
        <div class="conn-thread-head">
          <button type="button" class="conn-thread-back" data-conn-thread-close aria-label="Back to connections">‹</button>
          ${connAvatar(t, "")}
          <span class="conn-thread-name">${esc(t.displayName || "Trader")}</span>
        </div>
        <div class="conn-msgs" id="connMsgs">
          ${rows === null
            ? `<div class="conn-empty"><span class="pw-spinner sm" aria-hidden="true"></span> Loading…</div>`
            : rows.length
              ? rows.map((m) => `
                <div class="conn-msg ${m.senderUid === conn.uid ? "mine" : "theirs"}">
                  <span>${esc(m.text || "")}</span>
                </div>`).join("")
              : `<div class="conn-empty">No messages yet. Say something.</div>`}
        </div>
        ${t.err ? `<div class="pw-on-err" role="alert">${esc(t.err)}</div>` : ""}
        <div class="conn-compose">
          <input class="mt-input conn-msg-input" id="connMsgInput" type="text" maxlength="500"
                 placeholder="Message ${esc(t.displayName || "them")}" autocomplete="off"
                 ${t.sending ? "disabled" : ""}>
          <button type="button" class="conn-send" data-conn-send ${t.sending ? "disabled" : ""}
                  aria-label="Send">${t.sending ? "…" : "Send"}</button>
        </div>
      </div>`;
  }

  function profileOnlineHTML() {
    const so = profileOnlineState();
    const wrap = (inner) => `<div class="pr-sec pr-online" id="prOnline">
        <div class="pr-sec-head">Æway Online</div>${inner}</div>`;
    if (so.status === "idle" || so.status === "loading") {
      return wrap(`<div class="pr-online-line"><span class="pw-spinner sm" aria-hidden="true"></span> Loading your account…</div>`);
    }
    if (so.status === "offline") {
      return wrap(`<div class="pr-online-line">You're offline. Your online profile and match record show when you're back on a connection.</div>
        <button type="button" class="ad-back" data-pr-online-retry>Try Again</button>`);
    }
    if (so.status === "signin") {
      /* signed into the app but not into Æway Online — see onlineAuthState */
      if (onlineAuthState() === "reconnect") return wrap(onlineReconnectHTML("Pr"));
      return wrap(`<div class="pr-online-line">Sign in to sync your name, photo and match record across devices and play live opponents.</div>
        <button type="button" class="ad-save" data-pr-online-signin>Sign In</button>`);
    }
    if (so.status === "error") {
      return wrap(`<div class="pr-online-line">Couldn't load your online profile.</div>
        <button type="button" class="ad-back" data-pr-online-retry>Try Again</button>`);
    }
    const p = so.profile || {};
    const d = so.draft;
    const st = Object.assign({ xp: 0, wins: 0, losses: 0, draws: 0 }, p.stats || {});
    const n = so.notice;
    return wrap(`
        <div class="pr-online-stats">
          <div class="pr-online-stat"><b class="win">${st.wins}</b><span>Wins</span></div>
          <div class="pr-online-stat"><b class="loss">${st.losses}</b><span>Losses</span></div>
          <div class="pr-online-stat"><b>${st.draws}</b><span>Draws</span></div>
          <div class="pr-online-stat"><b class="xp">${st.xp}</b><span>XP</span></div>
        </div>
        ${/* ==> profiles.js: the code is the profile's own, generated when the
              account was created and backfilled onto older ones on read. It is
              how somebody challenges this player without a directory to find
              them in. */""}
        ${p.inviteCode ? `
        <div class="pr-invite">
          <div class="pr-invite-cap">Your invite code</div>
          <div class="pr-invite-code" id="prInviteCode">${esc(p.inviteCode)}</div>
          <div class="pr-invite-row">
            <button type="button" class="ad-back" data-pr-code-copy>Copy</button>
            <button type="button" class="ad-save" data-pr-code-share>Share</button>
          </div>
          <div class="pr-invite-note">Anyone with this code can challenge you to a live match.</div>
        </div>` : ""}
        <div class="pr-sec-note">The name and photo below are what opponents see. The photo is your profile picture — tap it above to change it.</div>
        <label class="mt-label">Display name
          <input class="mt-input" id="prOnName" type="text" maxlength="40" placeholder="Trader"
                 value="${esc(d.displayName)}" autocomplete="nickname"></label>
        <label class="mt-label">Bio
          <textarea class="mt-input pr-bio-input" id="prOnBio" rows="2" maxlength="${PROFILE_BIO_MAX}">${esc(d.bio)}</textarea></label>
        <div class="mt-label">Trading level</div>
        <div class="pr-checks pr-online-levels">
          ${ONLINE_LEVELS.map((l) => `
            <button type="button" class="bt-opt${d.tradingLevel === l.id ? " on" : ""}"
                    data-pr-online-level="${l.id}" aria-pressed="${d.tradingLevel === l.id}">${l.label}</button>`).join("")}
        </div>
        <button type="button" class="ad-save" data-pr-online-save>Save Online Profile</button>
        ${n ? `<div class="pr-notice ${esc(n.kind)}">${esc(n.text)}</div>` : ""}`);
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

  /* ---- chart gestures ----
     One finger pans, two pinch. Both work the same way: they move a window
     (tpFrom, tpSpan) over a series that never changes, and then repaint only
     the bars — a full render would rebuild the tabs and the strip on every
     frame and lose the input.

     Delegated from the scroller because the chart element is replaced on
     every render, and pointer events rather than touch so a mouse drag on
     desktop works without a second code path. The chart carries
     touch-action: none so the browser does not take the gesture for its own
     scrolling and zooming first. */
  const tpPtr = new Map();
  let tpGesture = null, tpRaf = null;
  const tpDist = () => {
    const [a, b] = [...tpPtr.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };
  function tpQueuePaint() {
    if (tpRaf != null) return;
    tpRaf = requestAnimationFrame(() => { tpRaf = null; tpPaintBars(); });
  }
  cardScroll.addEventListener("pointerdown", (e) => {
    const box = e.target.closest("#tpChart");
    if (!box || tpFrozen("m")) return;
    /* the dropdowns sit inside the chart box: a finger on one of them is not
       a gesture, and a finger anywhere else closes whichever is open */
    if (e.target.closest(".tp-menus")) return;
    if (state.tpMenu) { state.tpMenu = null; render(); return; }
    /* With a drawing tool picked, or a finger on a handle or an existing
       shape, the drawing layer takes the pointer and the chart does not pan
       under it. One finger only — a second one is always a pinch. */
    if (tpPtr.size === 0 && dcDown(e, "m")) { e.preventDefault(); return; }
    tpPtr.set(e.pointerId, { x: e.clientX, y: e.clientY });
    /* dcDown may have cleared a selection, and clearing one re-renders the
       panel — so the element captured above is detached by now. Re-query it:
       a detached box measures zero wide, and a pan divided by that is
       Infinity, which is a chart that never moves again. */
    const live = document.getElementById("tpChart") || box;
    tpGesture = tpPtr.size >= 2
      ? { kind: "pinch", dist: tpDist(), span: state.tpSpan, from: state.tpFrom }
      : { kind: "pan", x: e.clientX, from: state.tpFrom, w: live.getBoundingClientRect().width };
    /* Capture keeps the moves coming if the finger slides off the chart. It is
       an improvement, not a requirement, and it throws outright when there is
       no live pointer behind the event — so it goes after the gesture is set
       up and inside a guard, or a failure here would cancel the gesture it was
       meant to help. */
    try { box.setPointerCapture(e.pointerId); } catch (x) { /* no live pointer */ }
  });
  cardScroll.addEventListener("pointermove", (e) => {
    if (dcDrag && dcDrag.k === "m") return;   // the drawing layer has it
    if (!tpPtr.has(e.pointerId) || !tpGesture) return;
    tpPtr.set(e.pointerId, { x: e.clientX, y: e.clientY });
    e.preventDefault();
    if (tpGesture.kind === "pan" && tpPtr.size >= 2) {
      // a second finger landed mid-drag: become a pinch from where we are
      tpGesture = { kind: "pinch", dist: tpDist(), span: state.tpSpan, from: state.tpFrom };
      return;
    }
    if (tpGesture.kind === "pinch") {
      if (tpPtr.size < 2) return;
      const d = tpDist();
      if (d < 8 || tpGesture.dist < 8) return;
      /* fingers apart = fewer bars on screen = zoomed in, and the window is
         re-centred so the pinch pulls toward the middle of what you see */
      const mid = tpGesture.from + tpGesture.span / 2;
      state.tpSpan = tpGesture.span * (tpGesture.dist / d);
      tpClampView();
      state.tpFrom = mid - state.tpSpan / 2;
    } else {
      const perBar = tpGesture.w / Math.max(1, state.tpSpan);
      state.tpFrom = tpGesture.from - (e.clientX - tpGesture.x) / perBar;
    }
    tpClampView();
    tpQueuePaint();
  }, { passive: false });
  function tpEndPointer(e) {
    if (!tpPtr.has(e.pointerId)) return;
    tpPtr.delete(e.pointerId);
    if (tpPtr.size === 0) tpGesture = null;
    else if (tpPtr.size === 1) {
      const [only] = [...tpPtr.values()];
      const box = document.getElementById("tpChart");
      tpGesture = { kind: "pan", x: only.x, from: state.tpFrom,
        w: box ? box.getBoundingClientRect().width : 300 };
    }
  }
  cardScroll.addEventListener("pointerup", tpEndPointer);
  cardScroll.addEventListener("pointercancel", tpEndPointer);
  /* a mouse wheel is the same zoom, for anyone on a desktop */
  cardScroll.addEventListener("wheel", (e) => {
    if (!e.target.closest("#tpChart") || tpFrozen("m")) return;
    e.preventDefault();
    const mid = state.tpFrom + state.tpSpan / 2;
    state.tpSpan *= e.deltaY > 0 ? 1.12 : 0.89;
    tpClampView();
    state.tpFrom = mid - state.tpSpan / 2;
    tpClampView();
    tpQueuePaint();
  }, { passive: false });

  /* The search box is a live input, so what was typed lives in the DOM until
     something asks for it — same reason Placeæway reads its seed back. */
  function tpReadQuery() {
    const el = document.getElementById("tpSearch");
    if (el) state.tpQuery = el.value;
  }
  cardScroll.addEventListener("input", (e) => {
    if (e.target.id === "tpSearch") {
      state.tpQuery = e.target.value;
      const at = e.target.selectionStart;
      render();
      const again = document.getElementById("tpSearch");
      if (again) { again.focus(); try { again.setSelectionRange(at, at); } catch (x) { /* not selectable */ } }
    } else if (e.target.id === "tpDate") {
      state.tpDate = e.target.value || null;
      render();
    }
  });

  $("btnChart").addEventListener("click", () => togglePanel("tools"));

  /* ---------------- the title bars, folded away ----------------
     The header's hamburger hides the two bars under it and gives the room to
     the card. Nothing about what those bars hold changes — the titles, the
     gear, the home button, the streak, the progress, whatever the screen puts
     there — they are only taken off the screen and put back.

     Everything below them reflows for free: the card is the flex column's one
     growing child, so as the bars give up their height it takes it, frame by
     frame, on every screen at once. The card's own top margin goes with them,
     which is what leaves it flush against the video.

     Held for the session rather than saved: coming back to an app with no
     title on it and no obvious reason why is a worse first second than
     folding it again. */
  let barsHidden = false;
  function syncBars() {
    const btn = $("hdrMenu");
    document.querySelector(".app").classList.toggle("bars-hidden", barsHidden);
    if (btn) {
      btn.setAttribute("aria-expanded", String(!barsHidden));
      btn.setAttribute("aria-label", barsHidden ? "Show the title bars" : "Hide the title bars");
      btn.classList.toggle("on", barsHidden);
    }
  }
  const hdrMenu = $("hdrMenu");
  if (hdrMenu) hdrMenu.addEventListener("click", () => {
    barsHidden = !barsHidden; syncBars();
    if (pw && pw.phase === "hub" && pw.perf.on) requestAnimationFrame(pwPerfLayout);
  });

  /* ---- the video header, folded to a pill ----
     The second of the two folds, and independent of the first: the hamburger
     folds the title bars, the grabber folds the footage, and either can be
     folded without the other.

     The height has to be a number for the shrink to animate, and the number is
     the shape the header already had — its own width in the clip's 1080:455 —
     so measuring it changes nothing on screen and only gives the transition
     something to run between. Measured from the element rather than computed
     from the column, because the column's width is one expression on a phone,
     another past 700px and another again on desktop.

     Held for the session rather than saved, for the same reason the bars are:
     opening to a pill where the clock used to be, with no memory of having
     asked for it, is a worse first second than folding it again. */
  function syncHeadHeight() {
    const hz = $("headerZone");
    if (!hz) return;
    const w = hz.clientWidth;
    if (w > 0) {
      document.querySelector(".app").style.setProperty(
        "--head-h", (w * 455 / 1080).toFixed(1) + "px");
    }
  }
  let headCollapsed = false;
  function syncHead() {
    const btn = $("hdrFold");
    document.querySelector(".app").classList.toggle("head-collapsed", headCollapsed);
    if (btn) {
      btn.setAttribute("aria-expanded", String(!headCollapsed));
      btn.setAttribute("aria-label",
        headCollapsed ? "Expand the video header" : "Collapse the video header");
    }
    /* "hidden" for a <video> has to mean stopped as well as invisible, or the
       clip is still being decoded behind a pill nobody can see */
    const v = $("waveVideo");
    if (v) {
      if (headCollapsed) { try { v.pause(); } catch (e) {} }
      else if (v.querySelector("source")) { const p = v.play(); if (p && p.catch) p.catch(() => {}); }
    }
  }
  const hdrFold = $("hdrFold");
  if (hdrFold) hdrFold.addEventListener("click", () => {
    headCollapsed = !headCollapsed; syncHead();
    /* the chart is measured from the box it is in, and the box just changed */
    if (pw && pw.phase === "hub" && pw.perf.on) requestAnimationFrame(pwPerfLayout);
  });

  /* ---- the two folds, asked for from the hub's chart ----
     Folded once on the way in and put back on the way out, with what they
     were in between left alone: unfolding the header by hand while the chart
     is up is allowed, and the chart redraws into whatever room is left. */
  let pwPerfHeadWas = null;
  function pwPerfHead(want) {
    if (want) {
      if (pwPerfHeadWas) return;                       // already done, hands off
      pwPerfHeadWas = { head: headCollapsed, bars: barsHidden };
      if (!headCollapsed) { headCollapsed = true; syncHead(); }
      if (!barsHidden) { barsHidden = true; syncBars(); }
      return;
    }
    if (!pwPerfHeadWas) return;
    const was = pwPerfHeadWas;
    pwPerfHeadWas = null;
    if (headCollapsed !== was.head) { headCollapsed = was.head; syncHead(); }
    if (barsHidden !== was.bars) { barsHidden = was.bars; syncBars(); }
  }
  /* and the same reasoning one step out: a clip nobody is looking at is a
     clip nobody should be decoding. Folded away was already covered; this is
     the app in the background, or the screen locked. */
  document.addEventListener("visibilitychange", () => {
    const v = $("waveVideo");
    if (!v) return;
    if (document.hidden) { try { v.pause(); } catch (e) {} }
    else if (!headCollapsed && v.querySelector("source")) {
      const p = v.play(); if (p && p.catch) p.catch(() => {});
    }
  });
  $("btnSettings").addEventListener("click", () => togglePanel("settings"));
  $("btnProfile").addEventListener("click", () => { state.homeTab = "sections"; goHome(); });
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
  $("btnBarHome").addEventListener("click", openAeHome);
  $("btnCheckinHome").addEventListener("click", openAeHome);
  $("btnCheckinProfile").addEventListener("click", () => { state.homeTab = "sections"; goHome(); });
  $("navAdd").addEventListener("click", openJournal);
  $("btnJournalHome").addEventListener("click", openAeHome);
  $("btnJournalProfile").addEventListener("click", () => { state.homeTab = "sections"; goHome(); });
  $("navBattle").addEventListener("click", openGames);
  $("navProfile").addEventListener("click", openProfile);
  $("btnPickHome").addEventListener("click", openAeHome);
  $("btnProfileHome").addEventListener("click", openAeHome);
  $("btnProfileEdit").addEventListener("click", () => {
    if (state.view !== "profile") return;
    if (state.profileMode === "edit") readProfileForm();
    state.profileMode = state.profileMode === "edit" ? "view" : "edit";
    state.profileNotice = null;
    renderProfile();
  });
  $("btnPickProfile").addEventListener("click", () => { state.homeTab = "sections"; goHome(); });
  $("photoInput").addEventListener("change", (e) => {
    readProfilePhoto(e.target.files && e.target.files[0]);
    e.target.value = "";     // same file twice in a row still fires change
  });
  /* a trade screenshot for the note being written — kept whole, no cropper */
  $("jnoteImg").addEventListener("change", (e) => {
    journalNotesSetImage(e.target.files && e.target.files[0]);
    e.target.value = "";
  });

  /* ---------------- delegated clicks (rendered content + overlays) ------ */

  document.addEventListener("click", (e) => {
    const t = e.target.closest("[data-tab],[data-panel-close],[data-tp-tab],[data-tp-tf],[data-tp-sym],[data-tp-add],[data-tp-del],[data-tp-q],[data-dc-tool],[data-dc-tf],[data-dc-del],[data-dc-sym],[data-dc-add],[data-dc-del-sym],[data-tp-mode],[data-dc-mode],[data-aw-pick],[data-aw-menu],[data-aw-tf],[data-aw-jump],[data-aw-history],[data-aw-admin],[data-aw-back],[data-aw-retry],[data-aw-project],[data-aw-csv],[data-aw-admin-go],[data-aw-admin-no],[data-aw-reset],[data-aw-reset-ok],[data-aw-reset-no],[data-tp-patsave],[data-dc-patsave],[data-tp-pat],[data-dc-pat],[data-pat-open],[data-pat-del],[data-pat-close],[data-tp-menu],[data-tp-tool],[data-tp-draw-del],[data-tp-prac],[data-tp-prac-end],[data-tp-prac-again],[data-tp-prac-phase],[data-tp-prac-dir],[data-tp-prac-submit],[data-tp-prac-next],[data-tp-day],[data-tp-plan],[data-ae-go],[data-mod],[data-sec],[data-sub],[data-screen],[data-close],[data-menu-sec],[data-set-sound],[data-set-size],[data-save-note],[data-notes-list],[data-logout],[data-reset-progress],[data-vcat],[data-vid],[data-vback],[data-vfull],[data-grid],[data-grid-back],[data-grid-play],[data-ci],[data-ci-submit],[data-ci-before],[data-ci-exit],[data-ci-review],[data-bt],[data-bt2],[data-bt2-continue],[data-bt2-change],[data-bt-submit],[data-bt-stage2],[data-bt-back],[data-bt-exit],[data-bt-open],[data-at],[data-at-submit],[data-at-open],[data-at-exit],[data-at-add],[data-at-cancel],[data-at-detail],[data-bt-detail],[data-ds-open],[data-ds-month],[data-ds-day],[data-ds-back],[data-ds-detail],[data-jtab],[data-jmonth],[data-jadd],[data-jimport],[data-jmanual],[data-jsave],[data-jacct],[data-jaddacct],[data-jsaveacct],[data-jcash],[data-jsavecash],[data-pfsave],[data-pfpill],[data-pfadd],[data-pfedit],[data-pfdel],[data-pfdelok],[data-pfcancel],[data-jsection],[data-jviewall],[data-jday],[data-jdayback],[data-jdelmanual],[data-jdelbatch],[data-jreplace],[data-jdelok],[data-jdelcancel],[data-photo-pick],[data-photo-clear],[data-pr-edit],[data-pr-save],[data-pr-cancel],[data-pr-market],[data-contents],[data-contents-back],[data-open-connections],[data-conn-back],[data-conn-retry],[data-conn-list],[data-conn-find],[data-conn-add],[data-conn-cancel],[data-conn-approve],[data-conn-deny],[data-conn-msg],[data-conn-thread-close],[data-conn-send],[data-chal-bar-hide],[data-online-reconnect],[data-pk-replay],[data-pk-build],[data-game],[data-pa-count],[data-pa-mode],[data-pa-back],[data-pa-diff],[data-pa-copy],[data-pa-dice],[data-pa-start],[data-pa-howto],[data-pa-history],[data-pa-hopen],[data-pa-hround],[data-pa-clear],[data-pa-clearok],[data-pa-clearcancel],[data-pa-reveal],[data-pa-tap],[data-pa-next],[data-pa-round],[data-pa-save],[data-pa-new],[data-pw-side],[data-pw-random],[data-pw-play],[data-pw-draw],[data-pw-library],[data-pw-lib-back],[data-pw-lib-set],[data-pw-lib-card],[data-pw-lib-close],[data-pw-lib-step],[data-pw-howto],[data-pw-ht-close],[data-pw-ht-step],[data-pw-ht-go],[data-pw-setup-back],[data-pw-restart],[data-pw-again],[data-pw-specials],[data-pw-seen],[data-pw-answer],[data-pw-tp],[data-pw-match],[data-pw-home],[data-pw-round],[data-pw-round-close],[data-pw-hub-start],[data-pw-hub-create],[data-pw-hub-local],[data-pw-create-points],[data-pw-create-spec],[data-pw-create-go],[data-pw-create-joinopen],[data-pw-create-check],[data-pw-create-join],[data-pw-create-back],[data-pw-code-copy],[data-pw-code-share],[data-pw-perf],[data-pw-perf-menu],[data-pw-perf-side],[data-pw-perf-opp],[data-pw-hub-all],[data-pw-hub-back],[data-pw-hub-open],[data-pw-saved-back],[data-pw-hub-history],[data-pw-online-cancel],[data-pw-online-back],[data-pw-online-retry],[data-pw-online-signin],[data-pw-online-card],[data-pw-online-chart],[data-pw-chart],[data-pw-online-seen],[data-pw-online-specials],[data-pw-online-forfeit],[data-pw-online-forfeit-yes],[data-pw-online-forfeit-no],[data-pw-online-again],[data-pw-online-rematch],[data-pw-oh-open],[data-pr-online-save],[data-pr-online-level],[data-pr-online-signin],[data-pr-online-retry],[data-jnote-new],[data-jnote-cancel],[data-jnote-save],[data-jnote-img],[data-jnote-img-clear],[data-jnote-edit],[data-jnote-del],[data-jnote-del-yes],[data-jnote-del-no],[data-jnote-open],[data-jnote-retry],[data-jnote-signin],[data-pw-chal-cancel],[data-pw-oh-rematch],[data-pw-inv-accept],[data-pw-inv-decline],[data-pr-code-copy],[data-pr-code-share],[data-crop-save],[data-jpick],[data-jeditlist],[data-jdellist],[data-jeditacct],[data-jdelacct],[data-jdelconfirm],[data-jsaveedit],[data-jpicktoggle],[data-jpickclose],[data-jlinkall],[data-bmins],[data-bmcool],[data-bmcd],[data-bmdiff],[data-bmrisk],[data-bmtier],[data-bmstake],[data-bmback],[data-bmstart],[data-mkpick],[data-mkrisk],[data-mkrr],[data-mkexpand],[data-mkreplay],[data-mkrematch],[data-mkdone],[data-rvtf]");
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
        <button class="btn-secondary" data-jmanual>Manually Enter Trade</button>
        <button class="btn-secondary" data-jnote-new>Add Trade Note + Screenshot</button>`);
    }
    /* ==> journal.js: the synced notes under the ledger */
    else if (t.hasAttribute("data-jnote-new")) {
      closeOverlay();
      const jn = jnotes();
      if (jn.status !== "ready") { journalNotesLoad(true); }
      else {
        journalNotesOpenComposer(null);
        const host = document.getElementById("jNotes");
        if (host) host.scrollIntoView({ block: "start", behavior: "smooth" });
      }
    }
    else if (t.hasAttribute("data-jnote-cancel")) { journalNotesDropPreview(); jnotes().composer = null; journalNotesPaint(); }
    else if (t.hasAttribute("data-jnote-save")) journalNotesSave();
    else if (t.hasAttribute("data-jnote-img")) { journalNotesReadComposer(); $("jnoteImg").click(); }
    else if (t.hasAttribute("data-jnote-img-clear")) { journalNotesReadComposer(); journalNotesDropPreview(); jnotes().composer.file = null; journalNotesPaint(); }
    else if (t.hasAttribute("data-jnote-edit")) {
      const e = (jnotes().entries || []).find((x) => x.id === t.getAttribute("data-jnote-edit"));
      if (e) journalNotesOpenComposer(e);
    }
    else if (t.hasAttribute("data-jnote-del")) { jnotes().confirmDel = t.getAttribute("data-jnote-del"); journalNotesPaint(); }
    else if (t.hasAttribute("data-jnote-del-no")) { jnotes().confirmDel = null; journalNotesPaint(); }
    else if (t.hasAttribute("data-jnote-del-yes")) journalNotesDelete(t.getAttribute("data-jnote-del-yes"));
    else if (t.hasAttribute("data-jnote-open")) {
      const jn = jnotes(); const id = t.getAttribute("data-jnote-open");
      jn.open = jn.open === id ? null : id; journalNotesPaint();
    }
    else if (t.hasAttribute("data-jnote-retry")) journalNotesLoad(true);
    else if (t.hasAttribute("data-jnote-signin")) {
      const lo = document.createElement("button");
      lo.setAttribute("data-logout", "");
      document.body.appendChild(lo); lo.click(); lo.remove();
    }
    else if (t.dataset.ci) {
      const id = t.dataset.ci, val = t.dataset.ciVal;
      // tapping the chosen side clears it; the other side switches the answer
      if (store.checklist[id] === val) delete store.checklist[id];
      else store.checklist[id] = val;
      save();
      renderChecklistInPlace(renderCheckin);
    }
    else if (t.hasAttribute("data-ci-review")) {
      /* the rows come back holding what was logged, not what the working set
         happens to have in it — an abandoned edit from a previous review is
         not the answer of record */
      const rec = (store.checkinLog || {})[todayKey()];
      if (rec && rec.answers) {
        CHECKIN_ITEMS.forEach((it) => {
          if (rec.answers[it.id]) store.checklist[it.id] = rec.answers[it.id];
          else delete store.checklist[it.id];
        });
        save();
      }
      state.checkinReview = true;
      renderCheckin();
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
    else if (t.hasAttribute("data-at-open")) openAfterTrade();
    else if (t.dataset.at) {
      const id = t.dataset.at, val = t.dataset.atVal;
      // tapping the chosen answer clears it, same as the other two checklists
      if (store.afterTrade[id] === val) delete store.afterTrade[id];
      else store.afterTrade[id] = val;
      save();
      renderChecklistInPlace(renderAfterTrade);
    }
    else if (t.hasAttribute("data-at-submit")) {
      if (!atAnswered()) return;
      const answers = {};
      AT_ITEMS.forEach((it) => { answers[it.id] = store.afterTrade[it.id]; });
      const k = todayKey();
      // appended, never overwritten: a day holds one entry per trade taken
      const list = atEntries(k).slice();
      list.push({ answers, submittedAt: new Date().toISOString() });
      store.afterTradeLog[k] = list;
      store.afterTrade = {};        // the row scratch, clear for the next one
      state.atAdding = false;
      save();
      renderAfterTrade();
    }
    else if (t.hasAttribute("data-at-add")) {
      store.afterTrade = {};
      save();
      state.atAdding = true;
      renderAfterTrade();
    }
    else if (t.hasAttribute("data-at-cancel")) { state.atAdding = false; renderAfterTrade(); }
    else if (t.hasAttribute("data-bt-detail")) {
      state.btDetail = !state.btDetail;
      renderChecklistInPlace(renderBeforeTrade);
    }
    else if (t.dataset.atDetail !== undefined) {
      // each entry opens on its own, so the key is the entry's own index
      const i = t.dataset.atDetail;
      state.atOpen[i] = !state.atOpen[i];
      renderChecklistInPlace(renderAfterTrade);
    }
    else if (t.hasAttribute("data-at-exit")) openCheckin();
    else if (t.hasAttribute("data-ds-open")) openStreak();
    else if (t.dataset.dsMonth) {
      state.dsMonth += Number(t.dataset.dsMonth);
      renderChecklistInPlace(renderStreak);
    }
    else if (t.dataset.dsDay) { state.dsDay = t.dataset.dsDay; state.dsOpen = {}; renderStreak(); }
    else if (t.hasAttribute("data-ds-back")) { state.dsDay = null; state.dsOpen = {}; renderStreak(); }
    else if (t.dataset.dsDetail) {
      const id = t.dataset.dsDetail;
      state.dsOpen[id] = !state.dsOpen[id];
      renderChecklistInPlace(renderStreak);
    }
    else if (t.hasAttribute("data-bt-stage2")) {
      state.btStage2 = true; state.btStrategyDone = false; renderBeforeTrade();
    }
    else if (t.hasAttribute("data-bt-back")) {
      state.btStage2 = false; state.btStrategyDone = false; renderBeforeTrade();
    }
    else if (t.hasAttribute("data-bt2")) {
      const id = t.getAttribute("data-bt2");
      // single select: tapping the chosen one clears it, tapping another moves it
      if (store.beforeTrade.strategy === id) delete store.beforeTrade.strategy;
      else store.beforeTrade.strategy = id;
      save();
      renderChecklistInPlace(renderBeforeTrade);
    }
    else if (t.hasAttribute("data-bt2-continue")) {
      if (!store.beforeTrade.strategy) return;
      state.btStrategyDone = true;
      renderBeforeTrade();
    }
    else if (t.hasAttribute("data-bt2-change")) { state.btStrategyDone = false; renderBeforeTrade(); }
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
    else if (t.hasAttribute("data-contents")) openContents();
    else if (t.hasAttribute("data-contents-back")) closeContents();
    else if (t.hasAttribute("data-open-connections")) openConnections();
    /* ==> connections.js + messages.js: the whole screen */
    else if (t.hasAttribute("data-conn-back")) { connThreadClose(); openProfile(); }
    else if (t.hasAttribute("data-conn-retry")) connectionsLoad(true);
    else if (t.hasAttribute("data-conn-list")) connToggleList();
    else if (t.hasAttribute("data-conn-find")) connLookup();
    else if (t.hasAttribute("data-conn-add")) connConnect(t.getAttribute("data-conn-add"));
    else if (t.hasAttribute("data-conn-cancel")) connCancel(t.getAttribute("data-conn-cancel"));
    else if (t.hasAttribute("data-conn-approve")) connAnswer(t.getAttribute("data-conn-approve"), true);
    else if (t.hasAttribute("data-conn-deny")) connAnswer(t.getAttribute("data-conn-deny"), false);
    else if (t.hasAttribute("data-conn-msg")) connThreadOpen(t.getAttribute("data-conn-msg"));
    else if (t.hasAttribute("data-conn-thread-close")) { connThreadClose(); renderConnections(); }
    else if (t.hasAttribute("data-conn-send")) connSend();
    else if (t.hasAttribute("data-chal-bar-hide")) { inbox.hidden = t.getAttribute("data-chal-bar-hide"); syncChallengeBar(); }
    else if (t.hasAttribute("data-online-reconnect")) onlineReconnect(t.getAttribute("data-online-reconnect"));
    else if (t.hasAttribute("data-photo-pick")) $("photoInput").click();
    else if (t.hasAttribute("data-crop-save")) savePhotoCrop();
    else if (t.hasAttribute("data-photo-clear")) {
      store.profilePhoto = "";
      save();
      syncProfilePhoto();
      if (state.view === "profile") renderProfile(); else openSettings();
    }
    else if (t.hasAttribute("data-game")) {
      const g = t.getAttribute("data-game");
      if (g === "pointaeway") openPointaeway();
      else if (g === "placeaway") openPlaceaway();
      else openPickaeway();
    }
    else if (t.hasAttribute("data-pa-count")) { paReadSeed(); pa.count = +t.getAttribute("data-pa-count"); renderPlaceaway(); }
    else if (t.hasAttribute("data-pa-copy")) paCopySeed(t.getAttribute("data-pa-copy"));
    else if (t.hasAttribute("data-pa-dice")) { pa.seed = paRandomSeed(); renderPlaceaway(); }
    else if (t.hasAttribute("data-pa-start")) { paReadSeed(); paStartMatch(); }
    else if (t.hasAttribute("data-pa-howto")) { paReadSeed(); pa.showHowTo = !pa.showHowTo; renderPlaceaway(); }
    else if (t.hasAttribute("data-pa-history")) { paReadSeed(); pa.showHistory = !pa.showHistory; pa.historyOpen = null; pa.confirmClear = false; renderPlaceaway(); }
    else if (t.hasAttribute("data-pa-hopen")) {
      const i = +t.getAttribute("data-pa-hopen");
      pa.historyOpen = pa.historyOpen === i ? null : i;
      pa.historyRound = 0;
      renderPlaceaway();
    }
    else if (t.hasAttribute("data-pa-hround")) { pa.historyRound = +t.getAttribute("data-pa-hround"); renderPlaceaway(); }
    else if (t.hasAttribute("data-pa-clear")) { pa.confirmClear = true; renderPlaceaway(); }
    else if (t.hasAttribute("data-pa-clearcancel")) { pa.confirmClear = false; renderPlaceaway(); }
    else if (t.hasAttribute("data-pa-clearok")) {
      try { localStorage.removeItem(PA_HISTORY_KEY); } catch (e) { /* nothing to clear */ }
      pa.confirmClear = false; pa.historyOpen = null; renderPlaceaway();
    }
    else if (t.hasAttribute("data-pa-reveal")) {
      if (pa.mode === "reaction") rxStartRound(); else paStartRound();
    }
    else if (t.hasAttribute("data-pa-mode")) {
      pa.mode = t.getAttribute("data-pa-mode");
      pa.screen = "setup"; pa.showHowTo = false; pa.showHistory = false;
      renderPlaceaway();
    }
    else if (t.hasAttribute("data-pa-back")) { pa = paNewGame(); renderPlaceaway(); }
    else if (t.hasAttribute("data-pa-diff")) { pa.diff = t.getAttribute("data-pa-diff"); renderPlaceaway(); }
    else if (t.hasAttribute("data-pa-tap")) {
      // a real finger already went through pointerdown; this is its echo
      if (performance.now() - paPointerTapAt < 700) return;
      paTap(t.getAttribute("data-pa-tap"));
    }
    else if (t.hasAttribute("data-pa-next")) paNextRound();
    else if (t.hasAttribute("data-pa-round")) { pa.reviewIdx = +t.getAttribute("data-pa-round"); renderPlaceaway(); }
    else if (t.hasAttribute("data-pa-save")) paSaveMatch();
    else if (t.hasAttribute("data-pa-new")) {
      const { mode, count, diff } = pa;
      pa = paNewGame();
      Object.assign(pa, { mode, count, diff });   // same mode and settings, fresh match
      renderPlaceaway();
    }
    /* mid-flicker the randomiser owns the choice; a tap on a card it happens
       to be lighting would otherwise start a match on it */
    else if (t.hasAttribute("data-pw-side")) { if (!pwRolling) pwStart(t.getAttribute("data-pw-side")); }
    else if (t.hasAttribute("data-pw-random")) pwRollStart();
    else if (t.hasAttribute("data-pw-play")) pwPlay(t.getAttribute("data-pw-play"));
    else if (t.hasAttribute("data-pw-answer")) pwDisciplineAnswer(t.getAttribute("data-pw-answer"));
    else if (t.hasAttribute("data-pw-tp")) pwTakeProfitChoose(t.getAttribute("data-pw-tp") === "double");
    else if (t.hasAttribute("data-pw-draw")) pwChooseDraw(t.getAttribute("data-pw-draw"));
    else if (t.hasAttribute("data-pw-specials")) { pw.showSpecials = !pw.showSpecials; renderPointaeway(); }
    else if (t.hasAttribute("data-pw-seen")) { pw.showSeen = !pw.showSeen; renderPointaeway(); }
    else if (t.hasAttribute("data-pw-chart")) { pw.showChart = !pw.showChart; renderPointaeway(); }
    /* ---- the performance chart's toggle ----
       Opening it folds the video header and the title bars away, which is
       what the live chart does inside a match, and for the same reason: the
       chart wants the height. Closing it puts both back exactly as they were
       — not expanded, as they were — because what they were is remembered
       here rather than assumed. */
    else if (t.hasAttribute("data-pw-perf")) {
      pw.perf.on = !pw.perf.on;
      pw.perf.sel = null;
      pw.perf.menu = null;
      pw.perf.count = 0;                 // it reopens on the newest matches
      renderPointaeway();
    }
    else if (t.hasAttribute("data-pw-perf-menu")) {
      /* one open at a time, and a second press on the same one shuts it */
      const k = t.getAttribute("data-pw-perf-menu");
      pw.perf.menu = pw.perf.menu === k ? null : k;
      renderPointaeway();
    }
    else if (t.hasAttribute("data-pw-perf-side") || t.hasAttribute("data-pw-perf-opp")) {
      const side = t.hasAttribute("data-pw-perf-side");
      pw.perf[side ? "side" : "opp"] = t.getAttribute(side ? "data-pw-perf-side" : "data-pw-perf-opp");
      pw.perf.menu = null;
      pw.perf.count = 0; pw.perf.from = 0; pw.perf.sel = null;
      renderPointaeway();
    }
    /* The library is a place, not a panel: going there and coming back leaves
       the picker exactly as it was, because nothing about the picker is
       rebuilt — only the phase moves. */
    else if (t.hasAttribute("data-pw-library")) {
      pwPreloadArt();
      pw.phase = "library"; pw.libSet = "bull"; pw.libCard = null;
      pw.libFrom = t.getAttribute("data-pw-library") || "setup";
      renderPointaeway();
    }
    else if (t.hasAttribute("data-pw-lib-back")) {
      /* back to wherever it was opened from — the side picker, the hub, or
         the last page of How to Play */
      pw.phase = pw.libFrom === "hub" ? "hub" : pw.libFrom === "howto" ? "howto" : "setup";
      pw.libCard = null;
      renderPointaeway();
    }
    else if (t.hasAttribute("data-pw-lib-set")) {
      const k = t.getAttribute("data-pw-lib-set");
      /* a different set is a different list, so nothing carries over open */
      if (k !== pw.libSet) { pw.libSet = k; pw.libCard = null; renderPointaeway(); }
    }
    else if (t.hasAttribute("data-pw-lib-card")) pwLibOpenCard(Number(t.getAttribute("data-pw-lib-card")));
    else if (t.hasAttribute("data-pw-lib-close")) { pw.libCard = null; renderPointaeway(); }
    else if (t.hasAttribute("data-pw-lib-step")) pwLibStep(Number(t.getAttribute("data-pw-lib-step")));
    else if (t.hasAttribute("data-pw-howto")) {
      /* every page's faces, fetched and decoded before the first one is drawn */
      pwPreloadArt();
      pw.phase = "howto"; pw.htPage = 0; renderPointaeway();
    }
    else if (t.hasAttribute("data-pw-ht-close")) { pw.phase = "hub"; renderPointaeway(); }
    else if (t.hasAttribute("data-pw-ht-step")) pwHowToStep(Number(t.getAttribute("data-pw-ht-step")));
    else if (t.hasAttribute("data-pw-ht-go")) { pw.htPage = Number(t.getAttribute("data-pw-ht-go")); renderPointaeway(); }
    /* out of the pre-match flow and back to the record. The game object is
       kept: no match has started, so there is nothing in it to drop. */
    else if (t.hasAttribute("data-pw-setup-back")) { pw.phase = "hub"; renderPointaeway(); }
    else if (t.hasAttribute("data-pw-restart") || t.hasAttribute("data-pw-again")) {
      /* straight back to the side picker: these two mean play again, not go
         and look at the record */
      pwAbort(); pw = pwNewGame(); pw.phase = "setup"; renderPointaeway();
    }
    else if (t.hasAttribute("data-pw-hub-start")) {
      /* back to the default shape: a Create Match at 10 points leaves its
         settings on pw, and the computer game is specified as unchanged */
      pw.settings = null; pw.specialTypes = null; pw.localNote = false;
      pw.phase = "setup"; renderPointaeway();
    }
    /* ==> ONLINE: the pill on the hub, and everything that follows from it */
    else if (t.hasAttribute("data-pw-hub-create")) { pw.localNote = false; pwCreateOpen(); }
    /* the whole of Play Local, for now: the brief asks for the button and the
       one line under it and nothing else until the build-out */
    else if (t.hasAttribute("data-pw-hub-local")) { pw.localNote = true; renderPointaeway(); }
    else if (t.hasAttribute("data-pw-create-points")) {
      pwCreateSet("points", Number(t.getAttribute("data-pw-create-points")));
    }
    else if (t.hasAttribute("data-pw-create-spec")) {
      pwCreateSet("perColour", Number(t.getAttribute("data-pw-create-spec")));
    }
    else if (t.hasAttribute("data-pw-create-go")) pwCreateGo();
    else if (t.hasAttribute("data-pw-create-joinopen")) pwCreateJoinOpen();
    else if (t.hasAttribute("data-pw-create-check")) pwCreateJoinCheck();
    else if (t.hasAttribute("data-pw-create-join")) pwCreateJoinGo();
    else if (t.hasAttribute("data-pw-create-back")) {
      const c = pw.online && pw.online.create;
      if (c) { c.step = "setup"; c.err = null; renderPointaeway(); }
    }
    else if (t.hasAttribute("data-pw-code-copy")) pwShareCode(false);
    else if (t.hasAttribute("data-pw-code-share")) pwShareCode(true);
    else if (t.hasAttribute("data-pw-hub-history")) pwOnlineHistoryOpen();
    /* ==> invites.js: the challenge screen, the inbox, and the rematch */

    else if (t.hasAttribute("data-pw-chal-cancel")) pwChallengeCancel();
    else if (t.hasAttribute("data-pw-oh-rematch")) {
      const o = pw.online;
      const room = o && (o.history || []).find((r) => r.id === t.getAttribute("data-pw-oh-rematch"));
      if (room) {
        const oppId = (room.players || []).find((p) => p !== o.me.uid);
        const info = (room.playerInfo || {})[oppId] || {};
        if (oppId) pwChallengeRematch(oppId, info.displayName || "Trader", info.photoURL || "");
      }
    }
    else if (t.hasAttribute("data-pw-inv-accept")) inboxAccept(t.getAttribute("data-pw-inv-accept"));
    else if (t.hasAttribute("data-pw-inv-decline")) inboxDecline(t.getAttribute("data-pw-inv-decline"));
    else if (t.hasAttribute("data-pr-code-copy")) profileShareInviteCode(t, false);
    else if (t.hasAttribute("data-pr-code-share")) profileShareInviteCode(t, true);
    else if (t.hasAttribute("data-pw-online-cancel") || t.hasAttribute("data-pw-online-back")) {
      pwOnlineLeave(); pw.phase = "hub"; renderPointaeway();
    }
    else if (t.hasAttribute("data-pw-online-retry")) {
      if (pw.phase === "onlinehistory") pwOnlineHistoryOpen();
      else if (pw.phase === "create") pwCreateOpen();
      else if (pw.phase === "challenge") { pwOnlineLeave(); pw.phase = "hub"; renderPointaeway(); }
      else pwOnlineStart(pw.online && pw.online.code);
    }
    /* the SDK has no session for this account. The app's own sign-in is the
       one place that mirrors into it, so the way there is the app's own way
       out: the same path as the settings panel's Log Out. */
    else if (t.hasAttribute("data-pw-online-signin") || t.hasAttribute("data-pr-online-signin")) {
      pwOnlineLeave();
      const lo = document.createElement("button");
      lo.setAttribute("data-logout", "");
      document.body.appendChild(lo); lo.click(); lo.remove();
    }
    else if (t.hasAttribute("data-pw-online-card")) pwOnlinePlayCard(t.getAttribute("data-pw-online-card"));
    else if (t.hasAttribute("data-pw-online-chart")) {
      if (pw.online) { pw.online.showChart = !pw.online.showChart; renderPointaeway(); }
    }
    else if (t.hasAttribute("data-pw-online-seen")) {
      if (pw.online) { pw.online.showSeen = !pw.online.showSeen; pw.online.showSpecials = false; renderPointaeway(); }
    }
    else if (t.hasAttribute("data-pw-online-specials")) {
      if (pw.online) { pw.online.showSpecials = !pw.online.showSpecials; pw.online.showSeen = false; renderPointaeway(); }
    }
    else if (t.hasAttribute("data-pw-online-forfeit")) { if (pw.online) { pw.online.confirmForfeit = true; pw.online.showSeen = false; pw.online.showSpecials = false; renderPointaeway(); } }
    else if (t.hasAttribute("data-pw-online-forfeit-no")) { if (pw.online) { pw.online.confirmForfeit = false; renderPointaeway(); } }
    else if (t.hasAttribute("data-pw-online-forfeit-yes")) pwOnlineForfeit();
    else if (t.hasAttribute("data-pw-online-again")) pwOnlineStart();
    else if (t.hasAttribute("data-pw-online-rematch")) pwOnlineTimeoutLeave();
    else if (t.hasAttribute("data-pw-oh-open")) {
      const id = t.getAttribute("data-pw-oh-open");
      if (pw.online) { pw.online.histOpen = pw.online.histOpen === id ? null : id; renderPointaeway(); }
    }
    else if (t.hasAttribute("data-pr-online-level")) {
      profileOnlineSetLevel(t.getAttribute("data-pr-online-level"));
    }
    else if (t.hasAttribute("data-pr-online-save")) profileOnlineSave();
    else if (t.hasAttribute("data-pr-online-retry")) profileOnlineLoad(true);
    else if (t.hasAttribute("data-pw-hub-all")) { pw.hubAll = !pw.hubAll; renderPointaeway(); }
    /* a history row opens the match it stands for. The chart starts closed —
       the round reveal belongs to whichever chart it was opened from, and this
       one has just arrived. */
    else if (t.hasAttribute("data-pw-hub-open")) {
      pw.savedT = Number(t.getAttribute("data-pw-hub-open"));
      /* Opens on the first round rather than on nothing. This screen is two
         halves, the chart and the round it opens, and arriving with the bottom
         half empty would be the blank stretch this layout exists to remove. */
      const m = (store.pwHistory || []).find((x) => x.t === pw.savedT);
      const first = pwDecChart(m && m.chart)[0];
      pw.showRound = first ? first.round : null;
      pw.phase = "saved";
      renderPointaeway();
    }
    else if (t.hasAttribute("data-pw-saved-back")) {
      pw.savedT = null; pw.showRound = null; pw.phase = "hub"; renderPointaeway();
    }
    /* the chart takes the art's slot rather than opening over it — nothing in
       this app arrives as a panel on a dimmed screen */
    else if (t.hasAttribute("data-pw-match")) {
      pw.showMatch = !pw.showMatch;
      pw.showRound = null;      // a reveal belongs to the chart it was opened from
      renderPointaeway();
    }
    /* the candle and its chip are one control: tapping either opens that
       round, tapping the open one closes it, and opening another closes the
       first because only the selected round is ever rendered */
    else if (t.hasAttribute("data-pw-round")) {
      /* the click at the end of a scrub is the drag's own shadow: the round
         it lands on is already open, and toggling would shut it */
      if (Date.now() - pwScrubbedAt < 400) return;
      const n = Number(t.getAttribute("data-pw-round"));
      pw.showRound = pw.showRound === n ? null : n;
      renderPointaeway();
    }
    else if (t.hasAttribute("data-pw-round-close")) { pw.showRound = null; renderPointaeway(); }
    /* "Back to Home" is Pointæway's own home — the hub — not the game picker.
       A fresh game object starts there, and the record it just wrote is in the
       store rather than in the game, so nothing is lost by dropping it. */
    else if (t.hasAttribute("data-pw-home")) { pwAbort(); pw = pwNewGame(); renderPointaeway(); }
    else if (t.hasAttribute("data-pw-hub-back")) { pwAbort(); openGames(); }
    else if (t.hasAttribute("data-pk-build")) openBuildMatch();
    else if (t.hasAttribute("data-pk-replay")) {
      if (!openReplay()) {
        openOverlay(panelHead("Match Replay") + `
          <div class="liked-empty">No matches played yet. Once you've battled, every round is
            replayable here.</div>
          <button class="btn-primary" data-close>Got it</button>`);
      }
    }
    else if (t.dataset.bmins) bmRenderInPlace(() => bmSet("instrument", t.dataset.bmins));
    else if (t.dataset.bmcd) bmRenderInPlace(() => bmSet("candles", +t.dataset.bmcd));
    else if (t.dataset.bmdiff) bmRenderInPlace(() => bmSet("difficulty", t.dataset.bmdiff));
    else if (t.hasAttribute("data-bmstart")) startMatch();
    else if (t.hasAttribute("data-bmstake")) openStake();
    else if (t.hasAttribute("data-bmback")) openBuildMatch();
    else if (t.dataset.bmcool) bmRenderInPlace(() => bmSet("cooldown", +t.dataset.bmcool));
    else if (t.dataset.bmrisk) bmRenderInPlace(() => bmSet("risk", +t.dataset.bmrisk));
    else if (t.dataset.bmtier) bmRenderInPlace(() => bmSet("tier", +t.dataset.bmtier));
    else if (t.dataset.mkpick) mkLock(t.dataset.mkpick);

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
    else if (t.hasAttribute("data-ci-exit")) { closeOverlay(); state.checkinResult = null; state.checkinReview = false; state.homeTab = "sections"; goHome(); }
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
      state.checkinReview = false;
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
    else if (t.hasAttribute("data-panel-close")) { commitSettingsName(); state.panel = null; render(); }
    else if (t.hasAttribute("data-tp-tab")) {
      tpReadQuery(); state.tpPractice = null; state.tpMenu = null;
      state.tpTab = t.getAttribute("data-tp-tab"); render();
    }
    /* each chart's toggle moves only its own chart. The saved patterns are
       shared, though — they are a library, not a chart — so a change to those
       still rebuilds both. */
    else if (t.hasAttribute("data-tp-mode") || t.hasAttribute("data-dc-mode")) {
      const d = t.hasAttribute("data-dc-mode");
      const m = t.getAttribute(d ? "data-dc-mode" : "data-tp-mode");
      if (m !== chartMode(d ? "d" : "m")) {
        if (d) state.dcMode = store.dcChartMode = m;
        else state.tpMode = store.chartMode = m;
        /* leaving the ÆWAY chart puts away whatever it had open */
        state.awView = null; state.awCross = null; state.awMenu = false;
        state.tpPractice = null; state.tpPatOpen = null;
        save(); renderBothCharts();
      }
    }
    /* ---- ÆWAY ---- */
    else if (t.hasAttribute("data-aw-pick")) awPick(t.getAttribute("data-aw-pick"));
    else if (t.hasAttribute("data-aw-menu")) { state.awMenu = !state.awMenu; render(); }
    else if (t.hasAttribute("data-aw-tf")) {
      const id = t.getAttribute("data-aw-tf");
      state.awMenu = false;
      if (id !== state.awTf) {
        state.awTf = id;
        /* a new timeframe is a new chart: the window and the crosshair belong
           to the one being left */
        state.awFrom = null; state.awFollow = true; state.awCross = null;
      }
      render();
    }
    else if (t.hasAttribute("data-aw-jump")) {
      state.awFollow = true; state.awFrom = null; state.awCross = null; render();
    }
    else if (t.hasAttribute("data-aw-history")) { state.awView = "history"; state.awNote = ""; render(); }
    else if (t.hasAttribute("data-aw-admin")) { state.awView = "admin"; state.awNote = ""; render(); }
    else if (t.hasAttribute("data-aw-back")) { state.awView = null; state.awNote = ""; render(); }
    else if (t.hasAttribute("data-aw-retry")) { awFailed = null; awReady = false; awBoot(); render(); }
    else if (t.hasAttribute("data-aw-project")) {
      state.awProject = t.getAttribute("data-aw-project") === "1";
      render();
    }
    else if (t.hasAttribute("data-aw-admin-go")) awAdminTry();
    else if (t.hasAttribute("data-aw-admin-no")) { state.awAdminAsk = false; render(); }
    else if (t.hasAttribute("data-aw-ass")) { /* handled on input, not on click */ }
    else if (t.hasAttribute("data-aw-csv")) awExportCsv(Number(t.getAttribute("data-aw-csv")) || 7);
    else if (t.hasAttribute("data-aw-reset")) { state.awResetAsk = true; render(); }
    else if (t.hasAttribute("data-aw-reset-no")) { state.awResetAsk = false; render(); }
    else if (t.hasAttribute("data-aw-reset-ok")) {
      store.awPoints = 10000; store.awOpen = {}; store.awDone = [];
      state.awResetAsk = false;
      awSave();
      render();
    }
    else if (t.hasAttribute("data-tp-patsave")) { patSave("m"); state.tpPat = true; renderBothCharts(); }
    else if (t.hasAttribute("data-dc-patsave")) { patSave("d"); state.dcPat = true; renderBothCharts(); }
    else if (t.hasAttribute("data-tp-pat")) { state.tpPat = t.getAttribute("data-tp-pat") === "1"; render(); }
    else if (t.hasAttribute("data-dc-pat")) { state.dcPat = t.getAttribute("data-dc-pat") === "1"; renderDesktopTools(); }
    else if (t.hasAttribute("data-pat-open")) { state.tpPatOpen = t.getAttribute("data-pat-open"); renderBothCharts(); }
    else if (t.hasAttribute("data-pat-close")) { state.tpPatOpen = null; renderBothCharts(); }
    else if (t.hasAttribute("data-pat-del")) {
      const id = t.getAttribute("data-pat-del");
      store.patterns = store.patterns.filter((p) => p.id !== id);
      if (state.tpPatOpen === id) state.tpPatOpen = null;
      save(); renderBothCharts();
    }
    else if (t.hasAttribute("data-tp-prac")) tpPracticeStart();
    else if (t.hasAttribute("data-tp-prac-end")) { state.tpPractice = null; render(); }
    else if (t.hasAttribute("data-tp-prac-again")) tpPracticeStart();
    else if (t.hasAttribute("data-tp-prac-phase")) {
      const id = t.getAttribute("data-tp-prac-phase");
      state.tpPractice.phase = state.tpPractice.phase === id ? null : id;
      render();
    }
    else if (t.hasAttribute("data-tp-prac-dir")) {
      const d = t.getAttribute("data-tp-prac-dir");
      state.tpPractice.dir = state.tpPractice.dir === d ? null : d;
      render();
    }
    else if (t.hasAttribute("data-tp-prac-submit")) tpPracticeSubmit();
    else if (t.hasAttribute("data-tp-prac-next")) {
      const p = state.tpPractice;
      p.graded = null; p.phase = null; p.dir = null;
      /* a couple more candles print between questions, so a session walks
         through the story rather than sitting on its opening */
      p.shown = Math.min(p.len, p.shown + TP_GAP);
      render();
    }
    else if (t.hasAttribute("data-tp-menu")) {
      const m = t.getAttribute("data-tp-menu");
      state.tpMenu = state.tpMenu === m ? null : m;
      render();
    }
    else if (t.hasAttribute("data-tp-tool")) {
      state.tpTool = t.getAttribute("data-tp-tool");
      state.tpSel = null; state.tpDraft = null;
      /* picking from the menu closes it, and the button that opened it has to
         come back holding the new tool's name */
      if (state.tpMenu) { state.tpMenu = null; render(); }
      else tpSyncTools();
    }
    else if (t.hasAttribute("data-tp-draw-del")) {
      if (state.tpSel != null) state.tpDraw.splice(state.tpSel, 1);
      state.tpSel = null;
      if (state.tpMenu) { state.tpMenu = null; render(); }
      else tpSyncTools();
    }
    else if (t.hasAttribute("data-dc-tool")) {
      state.dcTool = t.getAttribute("data-dc-tool");
      state.dcSel = null; state.dcDraft = null;
      renderDesktopTools();
    }
    else if (t.hasAttribute("data-dc-tf")) {
      state.dcTf = t.getAttribute("data-dc-tf");
      /* the drawings belong to the series they were drawn on */
      state.dcDraw = []; state.dcSel = null;
      renderDesktopTools();
    }
    else if (t.hasAttribute("data-dc-del")) {
      if (state.dcSel != null) state.dcDraw.splice(state.dcSel, 1);
      state.dcSel = null;
      renderDesktopTools();
    }
    else if (t.hasAttribute("data-dc-sym")) {
      state.dcSym = t.getAttribute("data-dc-sym");
      state.dcDraw = []; state.dcSel = null; state.dcFrom = null;
      renderDesktopTools();
    }
    else if (t.hasAttribute("data-dc-add")) {
      const sym = t.getAttribute("data-dc-add");
      if (!store.watchlist) store.watchlist = [];
      if (store.watchlist.indexOf(sym) < 0) store.watchlist.push(sym);
      state.dcQuery = "";
      save();
      renderDesktopTools();
    }
    else if (t.hasAttribute("data-dc-del-sym")) {
      const sym = t.getAttribute("data-dc-del-sym");
      store.watchlist = (store.watchlist || []).filter((x) => x !== sym);
      if (state.dcSym === sym) state.dcSym = tpWatchlist()[0];
      save();
      renderDesktopTools();
    }
    else if (t.hasAttribute("data-tp-tf")) {
      /* the drawings belong to the series they were drawn on */
      state.tpDraw = []; state.tpSel = null;
      state.tpMenu = null;
      state.tpTf = t.getAttribute("data-tp-tf");
      // a new timeframe is a new series, so start at its right edge
      state.tpSpan = 60; state.tpFrom = TP_BARS; tpClampView(); render();
    }
    else if (t.hasAttribute("data-tp-sym")) {
      state.tpSym = t.getAttribute("data-tp-sym");
      state.tpTab = "chart";
      state.tpSpan = 60; state.tpFrom = TP_BARS; tpClampView(); render();
    }
    else if (t.hasAttribute("data-tp-add")) {
      const sym = t.getAttribute("data-tp-add");
      store.watchlist = tpWatchlist().slice();
      if (store.watchlist.indexOf(sym) < 0) store.watchlist.push(sym);
      save(); state.tpQuery = ""; render();
    }
    else if (t.hasAttribute("data-tp-del")) {
      const sym = t.getAttribute("data-tp-del");
      tpReadQuery();
      const left = tpWatchlist().filter((x) => x !== sym);
      // never empty: the chart has to have something to draw
      store.watchlist = left.length ? left : ["ES"];
      if (state.tpSym === sym) state.tpSym = null;
      save(); render();
    }
    else if (t.hasAttribute("data-tp-q")) { state.tpQuery = t.getAttribute("data-tp-q"); render(); }
    else if (t.hasAttribute("data-tp-day")) {
      const step = Number(t.getAttribute("data-tp-day"));
      if (step === 0) state.tpDate = null;
      else {
        const d = state.tpDate ? new Date(state.tpDate + "T12:00:00") : new Date();
        d.setDate(d.getDate() + step);
        state.tpDate = dayKeyOf(d);
      }
      render();
    }
    else if (t.hasAttribute("data-tp-plan")) {
      store.plan = { id: t.getAttribute("data-tp-plan"), wantedAt: new Date().toISOString() };
      /* ==> BACKEND: this only records the interest on the device. Real
         billing has to take over here before a plan means anything. */
      save(); render();
    }
    else if (t.hasAttribute("data-ae-go")) {
      const to = t.getAttribute("data-ae-go");
      if (to === "journal") openJournal();
      else if (to === "checkin") openCheckin();
      else if (to === "games") openGames();
      else if (to === "learn" || to === "resume") goHome();
    }
    else if (t.dataset.setSound !== undefined) {
      store.settings.sound = t.dataset.setSound === "1"; save(); syncVolume();
      if (state.panel === "settings") render(); else openSettings();
    }
    else if (t.dataset.setSize) {
      store.settings.textSize = t.dataset.setSize; save(); applyTextSize();
      if (state.panel === "settings") render(); else openSettings();
    }
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
      /* ==> ONLINE: and the SDK's session with it */
      { const api = online(); if (api) api.signOut().catch(() => {}); }
      state.online = null;
      state.jnotes = null;
      aewayMe = null;
      inboxStop();
      connectionsStop();
      conn.status = "idle";
      store.authSeen = false;
      save();
      closeOverlay();
      setAuthMode("login");
      setLoginOpen(false);      // back to the one pill, not a form already open
      showAuthStep();
      $("authScreen").classList.remove("hidden");
      syncSessionClock();
    }
    else if (t.hasAttribute("data-reset-progress")) {
      if (confirm("Reset all course progress? Likes, saves and notes are kept.")) {
        store.visited = {};
        store.lastScreen = null;
        save();
        closeOverlay();
        state.panel = null;
        render();
      }
    }
    else if (t.hasAttribute("data-close")) { commitSettingsName(); closeOverlay(); }
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

  /* The fields, the button that submits them, and the way across to the other
     mode: which mode is showing decides all three, so one place writes all
     three. The way across sits under the submit and reads smaller — signing
     up is the second thing this screen is for, not the first. */
  function renderAuthForm() {
    const login = authMode === "login";
    authForm.innerHTML =
      /* Each field is wrapped because the pill around it is translucent now
         and the gradient ring that draws it is a ::before — which an <input>
         does not have. The wrapper is the pill; the input is the text in it. */
      AUTH_FIELDS[authMode].map((f) =>
        `<span class="entry-pill field-pill"><input class="auth-input" name="${f.name}" type="${f.type}" placeholder="${f.placeholder}" autocomplete="off"></span>`
      ).join("") +
      `<div id="authError" class="gate-error hidden"></div>` +
      /* Login carries its own submit again, inline under the fields and the
         same pill as the way across beside it. It is a plain submit button in
         this form, so it and the pill in the dock are one control with one
         handler — there is no second path to write or to keep in step — and a
         Go keypress in Password reaches it as the form's default button.

         Sign-up has no inline submit: its own submit is the dock's pill, which
         names this form from outside it and is its default button instead. */
      (login ? `<button type="submit" class="entry-pill auth-switch">Login</button>` : "") +
      /* the way across, or the way back. Same pill either way; in sign-up it
         carries .auth-floor, which takes it out of the stack and down onto the
         reflective floor. */
      `<button type="button" class="entry-pill auth-switch${login ? "" : " auth-floor"}" data-auth-mode="${
        login ? "signup" : "login"}">${login ? "Sign Up" : "Back to Login"}</button>`;
    syncAuthDocks();
  }

  /* The one fixed zone at the foot of the screen, in whichever layout is up.
     Closed it offers the way in; open it is the form's submit, relabelled for
     the mode. Nothing here moves — only what is inside it changes. */
  /* The session clock belongs to the app, not to the way in. On a phone this
     is invisible either way — the auth screen covers the header it sits on —
     but on desktop the screen starts below the header strip, so before anyone
     has signed in the clock was the one piece of the app on show. It follows
     the auth screen exactly: up while that is up, back the moment it goes. */
  function syncSessionClock() {
    const clock = $("waveClock");
    if (clock) clock.classList.toggle("hidden", !authScreen.classList.contains("hidden"));
  }

  function syncAuthDocks() {
    const label = authMode === "login" ? "Login" : "Sign Up";
    [["loginOpenBtn", "loginSubmit"], ["introLoginBtn", "introSubmit"]].forEach(([o, u]) => {
      const open = $(o), sub = $(u);
      if (open) open.classList.toggle("hidden", loginOpen);
      if (sub) { sub.classList.toggle("hidden", !loginOpen); sub.textContent = label; }
    });
  }

  /* whichever dock is on screen holds it; the form no longer does. Named
     rather than selected by class: the phone's is the shared bottom pill now
     and the desktop's is the centre dock's, and the two wear nothing in
     common besides being this form's submit. */
  const authSubmitBtn = () =>
    [$("loginSubmit"), $("introSubmit")]
      .filter(Boolean)
      .find((e) => !e.classList.contains("hidden") && e.offsetParent !== null) ||
    $("loginSubmit");

  function setAuthMode(mode) {
    authMode = mode;
    renderAuthForm();
  }

  /* the desktop dock's Log In shortcut, and anything else that names a mode:
     both open the form on the login step rather than routing anywhere */
  document.addEventListener("click", (e) => {
    const t = e.target.closest("[data-intro]");
    if (!t) return;
    setAuthMode(t.dataset.intro === "signup" ? "signup" : "login");
    setIntroStage("form");
    setLoginOpen(true);
  });

  /* the switch under the submit, and the single pill that opens the form */
  authForm.addEventListener("click", (e) => {
    const t = e.target.closest("[data-auth-mode]");
    if (t) setAuthMode(t.getAttribute("data-auth-mode"));
  });
  $("loginOpenBtn").addEventListener("click", () => setLoginOpen(true));

  authForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(authForm);
    const email = (f.get("email") || "").trim();
    const password = f.get("password") || "";
    const btn = authSubmitBtn();
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
      /* ==> ONLINE: the SDK behind the online modules keeps a session of its
         own. Signed in beside the app's, best effort and never awaited — the
         app's own login neither waits for it nor fails with it. The inbox of
         incoming challenges follows that session. */
      onlineReady(4000).then((api) => {
        if (!api) return;
        api.signIn(email, password).then(() => { aewayMe = null; inboxStart(); connectionsStart(); }).catch(() => {});
      });
      await pullCloudAndMerge();   // resume progress/notes from other devices
      authScreen.classList.add("hidden");
      syncSessionClock();       // signing in is what puts the clock on screen
      stopAuthVideo();          // nothing left to watch behind a hidden screen
      startHeroAfterLogin();    // the header clip, with sound, on the way in
      render();
      renderDesktopTools();     // signing in is what unlocks the desktop panels
    } catch (ex) {
      err.textContent = ex.message || "Sign-in failed — please try again.";
      err.classList.remove("hidden");
    } finally {
      btn.disabled = false;
      btn.classList.remove("pending");
      /* not a literal: the dock's label has one owner, and spelling it again
         here is how the pill came back from a failed attempt reading LOG IN
         while every other screen said LOGIN */
      syncAuthDocks();
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

  function syncSurveyDock() {
    const onSurvey = !!store.gatePassed && !store.surveyDone;
    const show = onSurvey && surveyStep === 0;
    const dock = $("surveyDock");
    const step = $("surveyStep");
    if (dock) dock.classList.toggle("hidden", !show);
    if (step) step.classList.toggle("sv-has-dock", show);
  }

  /* steps: access gate -> questionnaire -> login.

     The login step is now the same brand loop and the same one pill on both
     platforms, which is the job the desktop's intro step used to do on its
     own, so nothing routes to that step any more. Its markup and its code are
     still here — the dock's Log In shortcut still opens the form through it —
     ==> pull them out if the intro video is not coming back. */
  function showAuthStep() {
    const onGate = !store.gatePassed;
    const onSurvey = !onGate && !store.surveyDone;
    const past = !onGate && !onSurvey;
    if (onSurvey && !surveyRendered) { surveyStep = 0; renderSurveyStep(); surveyRendered = true; }
    $("gateStep").classList.toggle("hidden", !onGate);
    // ENTER lives in the dock now, so it comes and goes with the gate card
    $("gateDock").classList.toggle("hidden", !onGate);
    $("surveyStep").classList.toggle("hidden", !onSurvey);
    $("introStep").classList.add("hidden");
    $("loginStep").classList.toggle("hidden", !past);
    /* the wave band belongs to the gate and the questionnaire; the login step
       brings its own clip and fills the column with it */
    $("authScreen").classList.toggle("on-login", past);
    // the Log In shortcut sits in the dock slot through every pre-login state
    $("introDock").classList.toggle("hidden", !(past && introDesktop()));
    if (past) startLoginVideo();
    syncSurveyDock();
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
      syncSurveyDock();
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
    syncSurveyDock();
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

  function skipSurveyToLogin() {
    store.surveyDone = true;
    store.surveySkipped = true;
    save();
    setAuthMode("login");
    if (introDesktop()) setIntroStage("form");
    showAuthStep();
  }

  const surveyLoginBtn = $("surveyLoginBtn");
  if (surveyLoginBtn) {
    surveyLoginBtn.addEventListener("click", (e) => {
      e.preventDefault();
      skipSurveyToLogin();
    });
  }

  surveyForm.addEventListener("click", (e) => {
    if (e.target.closest("[data-sv-login]")) { skipSurveyToLogin(); return; }
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

  /* ---------------- the gate's panel, and its sound ----------------
     The gate's own copy of the header clip, in the gate's own copy of the
     header panel. Its source is attached on the way in and the element is
     stopped on the way out, so once the user is through there is no second
     decoder running on a screen nobody can see.

     Unlike the app's header, this one is meant to be heard. A browser will
     refuse an UNMUTED autoplay until the page has been interacted with — iOS
     always, desktop Chrome until the site has earned enough engagement — and
     it refuses by rejecting play(), silently, which is why asking once and
     hoping is not an implementation. So:

       1. ask for sound: muted = false, play();
       2. if that is refused, keep the picture and give up the sound — muted =
          true, play() again, so the panel is never a still — and arm a
          one-shot unlock;
       3. the unlock fires on the first pointerdown, keydown or focusin
          anywhere on the page. Tapping into First Name is one, and it is the
          gesture the browser was waiting for, so the second attempt keeps its
          audio. The listeners come off the moment they fire.

     The speaker's own tap is deliberately NOT that gesture: the unlock ignores
     anything inside the button, because a toggle that also unlocks would mute
     and unmute in the same frame and look broken. The button's own handler
     does the play() it needs.

     A listener who mutes is remembered, and is never unmuted behind their
     back: not by the unlock, and not on the next visit. */
  const GATE_MUTE_KEY = "aeway_beta_audio_muted";
  const GATE_UNLOCK_EVENTS = ["pointerdown", "keydown", "focusin"];
  let gateMuteWanted = false;
  try { gateMuteWanted = localStorage.getItem(GATE_MUTE_KEY) === "1"; } catch (e) {}
  let gateUnlockArmed = false;

  /* the button is a view of the element's real state, never of what we hoped
     for: it repaints from v.muted on volumechange, so a refused unmute cannot
     leave a speaker-with-waves over a silent clip */
  function syncGateMute() {
    const btn = $("gateMute");
    if (!btn) return;
    const v = $("authVideo");
    const muted = !v || v.muted;
    const img = btn.querySelector("img");
    if (img) img.src = muted ? VOL_OFF : VOL_ON;
    btn.setAttribute("aria-pressed", muted ? "false" : "true");
    btn.setAttribute("aria-label", muted ? "Turn sound on" : "Turn sound off");
  }

  function gateUnlock(e) {
    const t = e && e.target;
    if (t && t.closest && t.closest("#gateMute")) return;   // the toggle is not the unlock
    gateDisarmUnlock();
    if (gateMuteWanted) return;
    const v = $("authVideo");
    if (!v) return;
    v.muted = false;
    Promise.resolve(v.play()).catch(() => { v.muted = true; }).then(syncGateMute);
  }
  /* capture, so a handler that stops propagation further down cannot swallow
     the one gesture the sound is waiting for */
  function gateArmUnlock() {
    if (gateUnlockArmed) return;
    gateUnlockArmed = true;
    GATE_UNLOCK_EVENTS.forEach((t) => document.addEventListener(t, gateUnlock, true));
  }
  function gateDisarmUnlock() {
    if (!gateUnlockArmed) return;
    gateUnlockArmed = false;
    GATE_UNLOCK_EVENTS.forEach((t) => document.removeEventListener(t, gateUnlock, true));
  }

  function startAuthVideo() {
    const v = $("authVideo");
    if (!v) return;
    /* The panel behind the gate and the questionnaire. Desktop hides it
       outright (.auth-wave is display:none past the breakpoint), so attaching
       a source here only ever fetched 1.6MB for an element nobody on this
       layout can see — the same bargain the header clip already makes. */
    if (window.matchMedia(DESKTOP_MQ).matches) return;
    if (!v.querySelector("source")) {
      v.addEventListener("error", () => v.classList.add("hidden"));  // panel stays black
      ["volumechange", "play", "pause", "loadedmetadata"].forEach((t) =>
        v.addEventListener(t, syncGateMute));
      const src = document.createElement("source");
      src.src = "assets/video/header-loop.mp4";
      src.type = "video/mp4";
      v.appendChild(src);
      v.load();
    }
    gatePlay();
  }

  function gatePlay() {
    const v = $("authVideo");
    if (!v) return;
    v.muted = gateMuteWanted;
    Promise.resolve(v.play())
      .then(() => { if (!v.muted) gateDisarmUnlock(); })
      .catch(() => {
        v.muted = true;
        Promise.resolve(v.play()).catch(() => {});
        if (!gateMuteWanted) gateArmUnlock();
      })
      .then(syncGateMute);
    syncGateMute();
  }

  function toggleGateSound() {
    const v = $("authVideo");
    if (!v) return;
    /* whichever way this tap goes, it settles the question the unlock exists
       to answer — so the unlock stands down either way */
    gateDisarmUnlock();
    const mute = !v.muted;                 // where this tap is trying to get to
    v.muted = mute;
    gateMuteWanted = mute;
    try { localStorage.setItem(GATE_MUTE_KEY, mute ? "1" : "0"); } catch (e) {}
    /* A tap is exactly the gesture the browser was holding out for, so an
       unmute here nearly always takes. On the rare occasion it does not, the
       clip goes back to silent playback rather than sitting paused under a
       speaker claiming sound. */
    Promise.resolve(v.play())
      .catch(() => {
        if (mute) return;
        v.muted = true;
        return Promise.resolve(v.play()).catch(() => {});
      })
      .then(syncGateMute);
    syncGateMute();
  }

  /* Backgrounded, the clip is a decoder running for nobody. It comes back in
     the state it left in — gatePlay() would re-ask for sound the listener may
     have turned off, so this resumes the element rather than restarting it. */
  document.addEventListener("visibilitychange", () => {
    const v = $("authVideo"), screen = $("authScreen");
    if (!v || !v.querySelector("source")) return;
    if (!screen || screen.classList.contains("hidden")) return;
    if (document.hidden) { v.pause(); return; }
    if (screen.classList.contains("on-login")) return;   // the panel is not on this step
    Promise.resolve(v.play()).catch(() => {}).then(syncGateMute);
  });

  function stopAuthVideo() {
    gateDisarmUnlock();
    const v = $("authVideo");
    if (v) v.pause();
    const l = $("loginVideo");
    if (l) l.pause();
  }

  /* ---------------- the way in ----------------
     The brand loop fills the centre column behind the login step, and keeps
     running through it: the source is attached once and nothing here ever
     calls load() or pause() again, so opening the form does not restart the
     clip or drop a frame. */
  function startLoginVideo() {
    const v = $("loginVideo");
    if (!v || v.querySelector("source")) return;
    /* Desktop's centre panel carries the landing picture instead of the clip,
       so there is nothing to start and 3.1MB not to fetch. Checked here rather
       than at the call site because every pre-login state calls this. */
    if (window.matchMedia(DESKTOP_MQ).matches) return;
    /* if it cannot play at all the still behind it is what shows */
    v.addEventListener("error", () => v.classList.add("hidden"));
    const src = document.createElement("source");
    src.src = "assets/video/login-loop.mp4";
    src.type = "video/mp4";
    v.appendChild(src);
    v.load();
    /* Sound on, and the same bargain every hero in this app strikes: ask for
       unmuted playback, settle for muted rather than for no playback at all
       when the browser refuses an unmuted autoplay without a prior gesture.
       The speaker at the top of the screen is what turns it back on, and it
       is painted from this element's own .muted either way. */
    watchHeroAudio(v);
    tryUnmuted(v);
    syncMuteButton();
  }

  /* closed: one pill. open: the fields, the submit, and the way across. */
  let loginOpen = false;
  function setLoginOpen(open) {
    loginOpen = open;
    const form = $("loginForm"), step = $("loginStep");
    if (form) form.classList.toggle("hidden", !open);
    if (step) step.classList.toggle("form-open", open);
    syncAuthDocks();
    if (open) {
      renderAuthForm();
      const first = authForm.querySelector("input");
      if (first) first.focus({ preventScroll: true });
    }
  }

  if (!store.authSeen) {
    renderAuthForm();
    setLoginOpen(false);
    showAuthStep();
    authScreen.classList.remove("hidden");
    syncSessionClock();
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
    /* A measured flag rather than a height media query, for the same reason
       --vhpx exists: the query reads the large viewport, which is the number
       that lies by about a toolbar. Screens that have to drop a line to fit a
       short column hang off this. */
    if (h > 0) document.documentElement.classList.toggle("short-vh", h < 700);
  }
  syncViewportHeight();
  syncHeadHeight();
  // the settling ticks: cheap, and the only thing that catches a stale boot value
  [60, 300, 1000].forEach((ms) => setTimeout(syncViewportHeight, ms));
  [60, 300, 1000].forEach((ms) => setTimeout(syncHeadHeight, ms));
  window.addEventListener("pageshow", syncViewportHeight);
  window.addEventListener("resize", syncViewportHeight);
  window.addEventListener("pageshow", syncHeadHeight);
  window.addEventListener("resize", syncHeadHeight);
  window.addEventListener("orientationchange", syncHeadHeight);

  /* ==> ONLINE: closing the tab or backgrounding the app mid-match forfeits
     it — the opponent would otherwise sit through the module's sixty-second
     wait for a card that is never coming. A queue entry is withdrawn the same
     way. pagehide rather than unload: it is the one of the two that fires on
     a phone. */
  window.addEventListener("pagehide", () => {
    const o = pw && pw.online;
    const api = online();
    if (!o || !api) return;
    if (o.mm) { try { o.mm.cancel(); } catch (e) { /* stopped */ } }
    if (o.roomId && o.room && o.room.status === "active" && o.me) {
      api.forfeitRoom(o.roomId, o.me.uid).catch(() => {});
    }
  });
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
  /* The login step is exempt from the shrink. This handling exists for the
     gate and the questionnaire, whose forms are long enough that a field can
     end up behind the keyboard — it shrinks the screen to the visual viewport
     and scrolls the field to the middle of what is left. On the login step
     that is the bug: shrink-and-scroll drags the whole composition up, taking
     the dock out of its fixed place and into the middle of the panel. */
  const onLoginStep = () => authScreen.classList.contains("on-login");
  function applyKbHeight() {
    if (!kbFocused || !vv) return;
    authScreen.style.setProperty("--kbvh", Math.round(vv.height) + "px");
  }
  function scrollFocusedIntoView() {
    if (kbFocused) kbFocused.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  /* What the login step gets instead. The exemption used to rest on the fields
     sitting above the keyboard whatever happened, and that stopped being true
     when sign-up's stack was anchored by its head: four fields reach the
     bottom third of the composition now, and the last of them is behind the
     keyboard on any phone.

     So the step slides, by exactly the overlap and not a pixel more, and
     slides back when the keyboard goes. One transform on and one transform
     off — the composition is never scrolled, so there is no scroll position
     left behind to restore and nothing can end up displaced. */
  let kbShiftEl = null;
  function syncLoginKbShift() {
    const step = $("loginStep");
    if (!step) return;
    if (!kbShiftEl || !vv || !onLoginStep()) { step.style.transform = ""; return; }
    /* Where the field WOULD be with the step at rest — not where it is.
       getBoundingClientRect() reports the transform, and mid-transition it
       reports a value part of the way through one, so measuring the field
       against the viewport directly makes this function fight itself: the
       first call slides the field clear, the second sees it already clear and
       takes the slide straight back off. Measured off two things a transform
       cannot touch instead — the field's offset inside the step, and the
       step's own offsetTop — it computes the same answer however many times
       it runs, and whenever it runs. */
    const sr = step.getBoundingClientRect();
    const within = kbShiftEl.getBoundingClientRect().bottom - sr.top;
    const rest = authScreen.getBoundingClientRect().top + step.offsetTop + within;
    const over = rest + 14 - vv.height;
    step.style.transform = over > 1 ? `translateY(${-Math.round(over)}px)` : "";
  }

  authScreen.addEventListener("focusin", (e) => {
    if (!isTouchLayout()) return;
    if (!e.target.classList || !e.target.classList.contains("auth-input")) return;
    if (onLoginStep()) {
      kbShiftEl = e.target;
      syncLoginKbShift();
      // again once the keyboard and its toolbar have finished coming up
      setTimeout(syncLoginKbShift, 320);
      return;
    }
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
      kbShiftEl = null;
      authScreen.classList.remove("kb-open");
      syncLoginKbShift();             // back where it started
    }, 60);
  });
  if (vv) vv.addEventListener("resize", () => {
    if (!isTouchLayout()) return;
    if (onLoginStep()) { syncLoginKbShift(); return; }
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

  /* The banner across the top of the desktop grid used to carry a second copy
     of the header clip. It does not any more: the centre column plays its own
     copy at every width now, which is the one the mute button reaches, and
     the strip behind it is just the black ground the clock sits on. */
  function buildDesktopBanner() { /* the strip carries no video of its own */ }
  function keepBannerPlaying() { /* nothing to keep playing */ }

  /* ---------------- hero sound ----------------
     One control for whichever video is the hero at this width: the header clip
     on a phone, the banner's centre layer on desktop.

     Sound on by default, but a browser will refuse an unmuted autoplay without
     a prior gesture — iOS always, desktop Chrome unless the site has earned
     enough engagement. So: try unmuted, and fall back to muted playback rather
     than to no playback at all. Either way the button is painted from the
     element's own .muted, never from what we hoped it would be, and it repaints
     on volumechange so it cannot drift out of step with reality. */

  /* whichever clip is the one on screen: the brand loop while the way in is
     showing, the header clip once the app itself is. The button reaches one
     of them and it is always the one the listener can see. */
  function heroVideo() {
    const screen = $("authScreen"), step = $("loginStep"), login = $("loginVideo");
    if (login && screen && !screen.classList.contains("hidden")
        && step && !step.classList.contains("hidden")) return login;
    /* looked up rather than closed over: the way in starts its own clip
       during boot, before the const below it has been initialised */
    return $("waveVideo");
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

  /* The header clip, running with its sound, the moment someone is through.
     A browser will refuse an unmuted autoplay without a prior gesture, which
     is why the attempt at boot nearly always lands on muted — but submitting
     the login form IS that gesture, and this runs inside the handler it fired,
     so the second attempt is the one that gets to keep its audio. Desktop has
     no header clip to start, so there is nothing here for it to do. */
  function startHeroAfterLogin() {
    if (window.matchMedia(DESKTOP_MQ).matches) return;
    attachHeaderSource();       // a no-op if the source is already on
    const v = $("waveVideo");
    if (v) tryUnmuted(v);
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

  /* ---------------- chart pointer work, both platforms ----------------
     The move and up listeners are on the document because a drag leaves the
     box; the down and wheel ones sit on the panel, which outlives its own
     innerHTML. Everything is keyed by which chart the pointer is over, so
     the crosshair and the three tools are one implementation. */

  function dcPct(e, k) {
    const box = document.getElementById(DC[k].box);
    if (!box) return null;
    const r = box.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    return {
      x: Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100)),
      y: Math.max(0, Math.min(100, ((e.clientY - r.top) / r.height) * 100)),
      r,
    };
  }

  function dcPaintCross(pt, k) {
    const C = DC[k];
    const cross = document.getElementById(C.cross);
    const rp = document.getElementById(C.rp), rt = document.getElementById(C.rt);
    if (!cross || !rp || !rt) return;
    if (!pt) { cross.hidden = true; rp.hidden = true; rt.hidden = true; return; }
    const g = C.geom();
    cross.hidden = false; rp.hidden = false; rt.hidden = false;
    cross.querySelector(".dc-cross-v").style.left = pt.x.toFixed(2) + "%";
    cross.querySelector(".dc-cross-h").style.top = pt.y.toFixed(2) + "%";
    /* price comes off the vertical position, time off the horizontal one */
    rp.style.top = pt.y.toFixed(2) + "%";
    rp.textContent = dcPriceLabel(g.priceAt(pt.y));
    const gi = Math.max(0, Math.min(TP_BARS - 1, Math.round(g.barAt(pt.x))));
    rt.style.left = pt.x.toFixed(2) + "%";
    rt.textContent = dcTimeAt(gi, C.tf());
  }

  const dcPointOf = (pt, g) => ({ i: g.barAt(pt.x), p: g.priceAt(pt.y) });

  /* how far a percentage point is from a shape, for picking one up */
  function dcHitTest(pt, g, k) {
    const near = (x1, y1, x2, y2) => {
      const dx = x2 - x1, dy = y2 - y1;
      const len2 = dx * dx + dy * dy;
      const t = len2 ? Math.max(0, Math.min(1, ((pt.x - x1) * dx + (pt.y - y1) * dy) / len2)) : 0;
      const cx = x1 + t * dx, cy = y1 + t * dy;
      return Math.hypot(pt.x - cx, pt.y - cy) <= 2.2;
    };
    const list = state[DC[k].draw];
    for (let i = list.length - 1; i >= 0; i--) {
      const d = list[i];
      const x1 = g.x(d.a.i), y1 = g.y(d.a.p), x2 = g.x(d.b.i), y2 = g.y(d.b.p);
      if (d.type === "line" && near(x1, y1, x2, y2)) return i;
      if (d.type === "box") {
        const xa = Math.min(x1, x2), xb = Math.max(x1, x2);
        const ya = Math.min(y1, y2), yb = Math.max(y1, y2);
        if (near(xa, ya, xb, ya) || near(xa, yb, xb, yb)
         || near(xa, ya, xa, yb) || near(xb, ya, xb, yb)) return i;
      }
      if (d.type === "fib") {
        const lo = Math.min(d.a.p, d.b.p), hi = Math.max(d.a.p, d.b.p);
        const xa = Math.min(x1, x2), xb = Math.max(x1, x2);
        for (const lv of DC_FIB) {
          const y = g.y(hi - (hi - lo) * (lv / 100));
          if (near(xa, y, xb, y)) return i;
        }
      }
    }
    return null;
  }

  const dcChartPanel = document.querySelector(".dt-panel-chart");
  const dcWidePanel = document.querySelector(".dt-panel-wide");

  /* Shared by both charts. On the phone this runs alongside the pan/pinch
     gestures that were already there: with the cursor tool selected the
     gestures own the pointer, and with a drawing tool selected this does. */
  function dcDown(e, k) {
    const C = DC[k];
    const pt = dcPct(e, k);
    if (!pt) return false;
    const g = C.geom();
    const handle = e.target.closest ? e.target.closest("[data-dc-handle]") : null;
    if (handle && state[C.draw][state[C.sel]]) {
      dcDrag = { k, kind: "handle", end: handle.getAttribute("data-dc-handle") === "0" ? "a" : "b" };
      return true;
    }
    if (state[C.tool] !== "cursor") {
      const at = dcPointOf(pt, g);
      state[C.draft] = { type: state[C.tool], a: at, b: at };
      dcDrag = { k, kind: "draw" };
      dcRepaintOverlay(k);
      return true;
    }
    const hit = dcHitTest(pt, g, k);
    if (hit !== null) { state[C.sel] = hit; C.rerender(); return true; }
    if (state[C.sel] != null) { state[C.sel] = null; C.rerender(); }
    return false;      // nothing to draw or pick: the chart's own pan takes it
  }

  /* the overlay on its own — the bars have not moved */
  function dcRepaintOverlay(k) {
    const ov = document.getElementById(DC[k].ov);
    if (ov) ov.innerHTML = dcOverlayHTML(k);
  }

  let dcDrag = null;

  if (dcChartPanel) dcChartPanel.addEventListener("pointerdown", (e) => {
    if (!e.target.closest || !e.target.closest("#dcBox") || tpFrozen("d")) return;
    e.preventDefault();
    if (!dcDown(e, "d")) {
      const pt = dcPct(e, "d");
      dcDrag = { k: "d", kind: "pan", x: e.clientX, from: state.dcFrom, w: pt.r.width };
    }
  });

  document.addEventListener("pointermove", (e) => {
    if (!dcDrag) {
      /* no drag: just the crosshair, over whichever chart the pointer is on */
      const k = dcWhich(e.target);
      if (k) dcPaintCross(dcPct(e, k), k);
      else { ["d", "m"].forEach((x) => {
        if (document.getElementById(DC[x].cross)) dcPaintCross(null, x); }); }
      return;
    }
    const k = dcDrag.k, C = DC[k];
    const pt = dcPct(e, k);
    if (!pt) return;
    if (dcDrag.kind === "pan") {
      /* a bar is the box width over the span, so a drag of N pixels is N of
         those — the chart tracks the cursor rather than a fixed rate */
      const perBar = dcDrag.w / state.dcSpan;
      state.dcFrom = dcDrag.from - Math.round((e.clientX - dcDrag.x) / perBar);
      dcPaint();
      return;
    }
    const g = C.geom();
    if (dcDrag.kind === "draw" && state[C.draft]) {
      state[C.draft].b = dcPointOf(pt, g);
      dcRepaintOverlay(k);
    }
    if (dcDrag.kind === "handle") {
      const d = state[C.draw][state[C.sel]];
      if (d) { d[dcDrag.end] = dcPointOf(pt, g); dcRepaintOverlay(k); }
    }
    dcPaintCross(pt, k);
  });

  document.addEventListener("pointerup", () => {
    if (!dcDrag) return;
    const { k, kind } = dcDrag;
    const C = DC[k];
    dcDrag = null;
    if (kind === "draw" && state[C.draft]) {
      const d = state[C.draft];
      state[C.draft] = null;
      /* a tap with no drag is not a drawing */
      const g = C.geom();
      if (Math.abs(g.x(d.b.i) - g.x(d.a.i)) < 1 && Math.abs(g.y(d.b.p) - g.y(d.a.p)) < 1) {
        dcRepaintOverlay(k);
        return;
      }
      state[C.draw].push(d);
      state[C.sel] = state[C.draw].length - 1;
      state[C.tool] = "cursor";       // one shape per pick, the way charts do it
      C.rerender();
      return;
    }
    if (kind === "handle") C.rerender();
  });

  /* on the panel rather than the document: a non-passive wheel listener on
     the document would cost the whole page its async scrolling */
  if (dcChartPanel) dcChartPanel.addEventListener("wheel", (e) => {
    const box = e.target.closest ? e.target.closest("#dcBox") : null;
    if (!box || tpFrozen("d")) return;
    e.preventDefault();
    const pt = dcPct(e, "d");
    const g = dcGeom();
    const anchor = g.barAt(pt ? pt.x : 50);
    const next = Math.max(TP_SPAN_MIN, Math.min(TP_SPAN_MAX,
      Math.round(state.dcSpan * (e.deltaY > 0 ? 1.12 : 0.89))));
    /* zoom about the cursor: the bar under it stays under it */
    state.dcFrom = Math.round(anchor - (pt ? pt.x : 50) / 100 * next + 0.5);
    state.dcSpan = next;
    dcPaint();
    dcPaintCross(pt, "d");
  }, { passive: false });

  document.addEventListener("keydown", (e) => {
    const k = document.getElementById("dcBox") ? "d" : document.getElementById("tpChart") ? "m" : null;
    if (!k || tpFrozen(k) || state[DC[k].sel] == null) return;
    const tag = (e.target.tagName || "").toLowerCase();
    if (tag === "input" || tag === "textarea") return;
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      state[DC[k].draw].splice(state[DC[k].sel], 1);
      state[DC[k].sel] = null;
      DC[k].rerender();
    } else if (e.key === "Escape") {
      state[DC[k].sel] = null;
      DC[k].rerender();
    }
  });

  /* ==> connections.js / messages.js: Enter sends, on both of the screen's
     two inputs. A message thread that needs a tap on a button to send is a
     thread nobody uses. */
  cardScroll.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" || e.shiftKey) return;
    const id = e.target && e.target.id;
    if (id === "connMsgInput") { e.preventDefault(); connSend(); }
    else if (id === "connFind") { e.preventDefault(); connLookup(); }
    else if (id === "pwJoinInput") { e.preventDefault(); pwCreateJoinCheck(); }
    else if (/^onRe/.test(id || "")) { e.preventDefault(); onlineReconnect(id); }
  });

  if (dcWidePanel) dcWidePanel.addEventListener("input", (e) => {
    if (e.target.id !== "dcSearch") return;
    state.dcQuery = e.target.value;
    const at = e.target.selectionStart;
    renderDesktopTools();
    const again = document.getElementById("dcSearch");
    if (again) { again.focus(); try { again.setSelectionRange(at, at); } catch (x) { /* not selectable */ } }
  });

  function syncDesktopChrome() {
    if (window.matchMedia(DESKTOP_MQ).matches) buildDesktopBanner();
    renderDesktopTools();
    // crossing the breakpoint changes which pre-login step applies
    if (!store.authSeen) showAuthStep();
  }
  syncDesktopChrome();
  window.matchMedia(DESKTOP_MQ).addEventListener("change", syncDesktopChrome);
  setInterval(keepBannerPlaying, 1000);
  $("hdrMute").addEventListener("click", toggleHeroSound);
  // crossing the breakpoint changes which video the button speaks for
  window.matchMedia(DESKTOP_MQ).addEventListener("change", syncMuteButton);
  /* The gate panel's speaker — its own listener rather than a row in the
     delegated dispatcher, the way the header's speaker is wired. It does not
     need to stop the event: the unlock, which runs first and in capture,
     already ignores anything inside this button. */
  const gateMuteBtn = $("gateMute");
  if (gateMuteBtn) gateMuteBtn.addEventListener("click", toggleGateSound);

  applyTextSize();
  syncVolume();
  syncProfilePhoto();
  // the header clock runs on every screen, so it starts once and never stops
  paintWaveClock();
  clockTimer = setInterval(paintWaveClock, 1000);
  render();

  if (window.FB && FB.user() && store.authSeen) {
    pullCloudAndMerge().then((merged) => { if (merged && state.view === "home") render(); });
    /* ==> invites.js: a challenge can arrive while its recipient is anywhere
       in the app, so the inbox is watched from boot rather than from the game
       screen. It needs the SDK's own session, which a visitor who signed in
       before that mirror existed will not have — inboxStart simply finds
       nobody and does nothing. */
    inboxStart();
    connectionsStart();
  }

  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => { /* offline support unavailable */ });
    });
  }
})();
