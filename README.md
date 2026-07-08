# Learnæway — Path to Trading Course (Mobile PWA)

Mobile-first Progressive Web App (9:16 vertical) for the Learnæway course — the education
arm of the Æway ecosystem. Built to the production design spec and the approved UI
screenshots (neon glass, cyan/magenta glow, stacked-card outline deck).

## Run it

No build step — it's a static site:

```bash
python3 -m http.server 8000
# open http://localhost:8000 on a phone-sized viewport
```

Installable as a PWA (manifest + service worker, offline after first load).

## Structure

```
index.html              app shell (header zone, icon rows, card, bottom nav)
css/style.css           design system — palette, glass bars, deck, overlays
js/app.js               state, rendering, swipe nav, overlays, localStorage
data/course-data.js     generated course content (2 modules · 34 sections ·
                        137 subsections · 230 screens)
tools/generate_course_data.py   regenerates data/course-data.js from the
                        course text extracted from Learnaeway_Course_Complete.docx
                        (includes the section-order overrides in SECTION_MOVES)
tools/generate_toc.py   regenerates docs/Learnaeway_Table_of_Contents.md from
                        data/course-data.js — run after generate_course_data.py
docs/Learnaeway_Table_of_Contents.md   generated outline, kept in sync with the
                        app's actual section/subsection/screen order
assets/                 brand assets, trimmed + optimized from the delivery zip,
                        organized per the spec's asset manifest
manifest.webmanifest    PWA manifest
sw.js                   cache-first service worker
```

## Behavior implemented (v1)

- **Learning screens** — swipe left/next, swipe right/previous (40px minimum,
  vertical scrolls don't trigger). Arrow keys work on desktop.
- **Header icon row** — hamburger (course menu drawer) · section title · settings gear
  (audio default, text size S/M/L, account name, progress reset).
- **Progress row** — user icon (profile: overall %, screens viewed, liked/saved counts,
  notes list) · progress bar showing “X of Y” for the current subsection ·
  layers icon (screen list ⇄ full outline overlay).
- **Card footer** — bookmark (fills cyan when saved) · wordmark · heart (fills magenta
  when liked). Independent per screen, both persist.
- **Bottom nav** — Notes (per-screen note modal, localStorage; backend sync is v2) ·
  Home (cyan glow on tap) · Bookmark (opens the Saved Screens list — navigation
  only, it never toggles save state; glows magenta while the current screen is
  saved as a status indicator).
- **Home/outline** — stacked-card deck per section with peeking layers; tap to expand
  into the subsection list; % badges per section/subsection. Tabs: **All Sections**
  (with a module switcher), **Liked**, and **Saved** (bookmark got its own tab).
- **Action icons** — Ask Æway mic, volume, play/pause, and replay sit as a row in
  the card footer between the bookmark and heart (v2 target layout); the header is
  wave-only. Narration audio is a v2 hook — `<!-- AUDIO: … -->` placeholders are
  emitted per screen. The avatar assets remain in `assets/avatars/` but are not
  currently rendered (removed from the header per the v2 mockups).
- **Persistence** — visited screens, likes, bookmarks, notes, and settings in
  `localStorage` under `learnaeway.v1`.

## Asset notes / open items from the spec

- `icon-notes`, `icon-bookmark`, `icon-heart` were **not** in the delivery zip —
  substituted with inline SVGs matched to the screenshots (swap when exported).
- v2 asset batch: `logo-symbol-v2`, `app-background-card-v2`, `btn-ask-aeway-v2`,
  `button-pill-standard` (login pills), and `login-screen-background` replace the
  originals; superseded files were removed. Bars and the main card render their
  PNG assets via border-image 9-slice so corners stay crisp at any size.
- Source assets were delivered on 5100×3300 canvases; everything in `assets/` is
  alpha-trimmed and downscaled for web delivery.
- Diagrams: candlestick anatomy + candlestick-run are inline SVGs in `js/app.js`
  (reference style from screenshots). Equivalents for chart types, market structure,
  and patterns are still to be provided.

## Regenerating course data

```bash
python3 tools/generate_course_data.py path/to/course.txt data/course-data.js
python3 tools/generate_toc.py data/course-data.js docs/Learnaeway_Table_of_Contents.md
```

`course.txt` is the plain-text extraction of `Learnaeway_Course_Complete.docx`
(`#` module / `##` section / `###` subsection headings, body lines as paragraphs).
Section order is the doc's natural order plus the overrides listed in
`SECTION_MOVES` at the top of `generate_course_data.py` — edit that list (not
the copy) to reorder sections; content and screen ids stay stable either way.
