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
  Home (cyan glow on tap) · Bookmark (mirrors the card bookmark, glows magenta when
  the current screen is saved).
- **Home/outline** — stacked-card deck per section with peeking layers; tap to expand
  into the subsection list; % badges per section/subsection. Tabs: **All Sections**
  (with a module switcher), **Liked**, and **Saved** (bookmark got its own tab).
- **Avatar states** — ring pulses on learning screens; smile flashes on like/bookmark,
  saved note, and subsection completion; mouth-open is shown while “playing”
  (structural only — narration audio is a v2 hook, `<!-- AUDIO: … -->` placeholders
  are emitted per screen).
- **Persistence** — visited screens, likes, bookmarks, notes, and settings in
  `localStorage` under `learnaeway.v1`.

## Asset notes / open items from the spec

- `icon-notes`, `icon-bookmark`, `icon-heart` were **not** in the delivery zip —
  substituted with inline SVGs matched to the screenshots (swap when exported).
- `avatar-eyes-closed` was not in the zip — `eyes-open` doubles as idle for now.
- `app-background-card-expanded@2x.png` is a full UI mockup, not a tileable
  background, so the card interior is a CSS recreation (corner glows + grid floor).
  The file is kept in `assets/backgrounds/` for reference.
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
