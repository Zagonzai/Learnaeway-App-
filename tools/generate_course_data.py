#!/usr/bin/env python3
"""Generate data/course-data.js from the extracted course.txt.

Structure: modules -> sections -> subsections -> screens.
Doc conventions: '# ' = module, '## ' = section, '### ' = subsection,
plain lines = body paragraphs. Sections with body before their first
subsection (or with none at all) get an implicit subsection.
"""
import json, re, sys

import sys
SRC = sys.argv[1] if len(sys.argv) > 1 else "course.txt"
DST = sys.argv[2] if len(sys.argv) > 2 else "data/course-data.js"

# Display-name overrides so outline titles match the approved UI screenshots.
SECTION_SHORT = {
    "Introduction — Welcome to Learnaeway": "Welcome to Learnæway",
    "Why This Comes First — The Full Picture, Not Just the Markets": "Why This Comes First",
    "Pillar 1: Earned Income — Your Foundation": "Pillar 1 - Earned Income",
    "Pillar 2: Protection — Life Insurance & Risk Management": "Pillar 2 - Protection & Life Insurance",
    "Pillar 3: Tax-Advantaged Accounts — Make the Government Work for You": "Pillar 3 - Tax-Advantaged Accounts",
    "Pillar 4: Business Ownership — Creating Your Own Economy": "Pillar 4 - Business Ownership",
    "Pillar 5: Real Estate — Building Equity and Passive Income": "Pillar 5 - Real Estate",
    "Pillar 6: Market Investing & Trading — Accelerating Your Wealth": "Pillar 6 - Market Investing & Trading",
    "How the Pillars Work Together — A System, Not a Checklist": "How the Pillars Work Together",
    "Generational Wealth Mindset — Thinking Beyond Yourself": "Generational Wealth Mindset",
    "Transition to Module 2 — Where Trading Fits and Where We Go Next": "Transition to Module 2",
    "The Reality of Trading: What You Must Know Before You Begin": "The Reality of Trading",
    "Trading Sessions (Eastern Standard Time — EST)": "Trading Sessions",
    "How to Pay Yourself Through Prop Firms: The TopStep Approach": "How to Pay Yourself - Prop Firms",
    "Building Wealth: Your Financial Roadmap": "Financial Roadmap Outline",
    "Chart Patterns Used (Candlestick)": "Chart Patterns (Candlestick)",
}
MODULE_TAGLINE = {
    1: "The Pillars of Building Long-Term Wealth",
    2: "Your Path to Becoming a Trader",
}
MODULE_TITLE = {
    1: "The Pillars of Building Long-Term Wealth",
    2: "Your Path to Becoming a Trader",
}

def slugify(s):
    s = s.lower().replace("æ", "ae")
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s[:48].rstrip("-")

def fix_ae(s):
    return s.replace("Learnaeway", "Learnæway").replace("Aeway", "Æway")

def chunk_paragraphs(paras, budget=520):
    """Pack consecutive paragraphs into screens of roughly `budget` chars."""
    screens, cur, size = [], [], 0
    for p in paras:
        plen = len(p)
        if cur and size + plen > budget:
            screens.append(cur)
            cur, size = [], 0
        cur.append(p)
        size += plen
    if cur:
        screens.append(cur)
    return screens

def main():
    with open(SRC, encoding="utf-8") as f:
        lines = [l.rstrip() for l in f.read().split("\n")]

    modules = []
    module = section = subsection = None
    slug_seen = {}

    def uniq_slug(base):
        n = slug_seen.get(base, 0)
        slug_seen[base] = n + 1
        return base if n == 0 else f"{base}-{n+1}"

    def new_subsection(title):
        nonlocal subsection
        subsection = {"title": fix_ae(title), "paras": []}
        section["subsections"].append(subsection)

    for i, raw in enumerate(lines):
        line = raw.strip()
        if not line:
            continue
        if line.startswith("# ") and not line.startswith("##"):
            num = len(modules) + 1
            module = {
                "id": f"module-{num}", "num": num,
                "title": MODULE_TITLE.get(num, fix_ae(line[2:])),
                "docTitle": fix_ae(line[2:]),
                "tagline": MODULE_TAGLINE.get(num, ""),
                "sections": [],
            }
            modules.append(module)
            section = subsection = None
        elif line.startswith("## ") and module is not None:
            title = line[3:]
            short = SECTION_SHORT.get(title, title)
            section = {
                "id": uniq_slug(slugify(short)),
                "title": fix_ae(short),
                "fullTitle": fix_ae(title),
                "subsections": [],
            }
            module["sections"].append(section)
            subsection = None
        elif line.startswith("### ") and section is not None:
            new_subsection(line[4:])
        elif section is not None:
            if subsection is None:
                new_subsection("Overview" if section["subsections"] == [] else section["title"])
            subsection["paras"].append(fix_ae(line))
        # lines before the first module heading (course title/byline) are skipped

    # Section reorders — content and copy are untouched; only sequence moves.
    # Each entry: (section fullTitle to move, destination module num,
    # fullTitle of the section it should follow, or None for "first").
    SECTION_MOVES = [
        ("Building Wealth: Your Financial Roadmap", 1, "Generational Wealth Mindset — Thinking Beyond Yourself"),
        ("Key Trading Vocabulary", 2, "The Reality of Trading: What You Must Know Before You Begin"),
    ]

    def move_section(from_full_title, to_module_num, after_full_title):
        moved = None
        for m in modules:
            for i, s in enumerate(m["sections"]):
                if s["fullTitle"] == from_full_title:
                    moved = m["sections"].pop(i)
                    break
            if moved is not None:
                break
        if moved is None:
            raise ValueError(f"section not found: {from_full_title!r}")
        dest = next(m for m in modules if m["num"] == to_module_num)
        if after_full_title is None:
            insert_at = 0
        else:
            insert_at = next(i for i, s in enumerate(dest["sections"]) if s["fullTitle"] == after_full_title) + 1
        dest["sections"].insert(insert_at, moved)

    for move in SECTION_MOVES:
        move_section(*move)

    # Build final structure with chunked screens + ids
    total = 0
    for m in modules:
        for s in m["sections"]:
            # drop empty subsections, chunk paragraphs into screens
            subs = []
            for idx, ss in enumerate(s["subsections"]):
                if not ss["paras"]:
                    continue
                sid = f"{s['id']}--{slugify(ss['title']) or 'part'}-{idx}"
                screens = []
                for k, group in enumerate(chunk_paragraphs(ss["paras"])):
                    total += 1
                    screens.append({
                        "id": f"{sid}--{k+1}",
                        "headline": s["title"],
                        "subhead": ss["title"] if ss["title"] not in ("Overview", s["title"]) else "",
                        "body": group,
                        "audio": f"{s['id']}/{k+1}.mp3",  # v2 hook, no playback in v1
                    })
                subs.append({"id": sid, "title": ss["title"], "screens": screens})
            s["subsections"] = subs
    # Authored screens not present in the source doc. Appended to the end of
    # their section (after the doc-derived screens), so existing screen ids —
    # and the progress/likes/notes keyed on them — stay stable.
    # Screens with a "list" render the numbered-list template; "listClose" is
    # an optional closing paragraph below the list.
    AUTHORED_SCREENS = {
        "Pillar 1: Earned Income — Your Foundation": [
            {
                "headline": "The 60/20/20 Rule",
                "subhead": "",
                "body": ["Once you begin earning income, every dollar should have a purpose. Instead of spending first and saving what's left over, flip the process."],
            },
            {
                "headline": "60% — Living Expenses",
                "subhead": "Use approximately 60% of your income for necessities",
                "body": [],
                "list": ["Housing", "Food", "Transportation", "Insurance", "Bills", "Everyday expenses"],
            },
            {
                "headline": "20% — High-Yield Savings",
                "subhead": "Build financial stability first",
                "body": [],
                "list": ["Emergency Fund", "Opportunity Fund", "Future investments", "Large purchases"],
                "listClose": "Your first goal is to build a strong cash reserve before taking unnecessary financial risks.",
            },
            {
                "headline": "20% — Investing & Wealth Building",
                "subhead": "Use the remaining 20% to invest in your future",
                "body": [],
                "list": ["Roth IRA", "401(k)", "Brokerage Account", "Index Funds", "Business", "Real Estate", "Trading Education", "Building additional income streams"],
            },
            {
                "headline": "Why This Matters",
                "subhead": "",
                "body": ["A trader without savings is forced to trade. A trader with savings has the freedom to wait for high-quality opportunities. Building wealth isn't about making more money — it's about developing the discipline to manage the money you already earn. Income creates opportunity. Savings create security. Investing creates wealth."],
            },
        ],
    }

    for full_title, authored in AUTHORED_SCREENS.items():
        sec = next(s for m in modules for s in m["sections"] if s["fullTitle"] == full_title)
        sub = sec["subsections"][0]
        base = len(sub["screens"])
        for j, scr in enumerate(authored):
            n = base + j + 1
            entry = {
                "id": f"{sub['id']}--{n}",
                "headline": scr["headline"],
                "subhead": scr.get("subhead", ""),
                "body": scr.get("body", []),
                "audio": f"{sec['id']}/{n}.mp3",  # v2 hook, no playback in v1
            }
            if scr.get("list"):
                entry["list"] = scr["list"]
            if scr.get("listClose"):
                entry["listClose"] = scr["listClose"]
            sub["screens"].append(entry)
            total += 1

    # Merge short intro subsections into a single screen (no swipe-to-continue)
    # and attach real narration audio where a track exists.
    MERGE_SUBSECTIONS = {
        "welcome-to-learnaeway--overview-0": {"audioSrc": "assets/audio/Welcome_to_Learnaeway.mp3"},
    }
    for m in modules:
        for sec in m["sections"]:
            for sub in sec["subsections"]:
                if sub["id"] in MERGE_SUBSECTIONS and len(sub["screens"]) > 1:
                    merged = dict(sub["screens"][0])
                    merged["body"] = [p for scr in sub["screens"] for p in scr["body"]]
                    merged.update(MERGE_SUBSECTIONS[sub["id"]])
                    total -= len(sub["screens"]) - 1
                    sub["screens"] = [merged]

    data = {
        "courseTitle": "Learnæway's Path to Trading Course",
        "byline": "By Æway",
        "totalScreens": total,
        "modules": modules,
    }
    js = "// Generated from Learnaeway_Course_Complete.docx — do not edit by hand.\n"
    js += "window.COURSE_DATA = " + json.dumps(data, ensure_ascii=False, indent=1) + ";\n"
    import os
    os.makedirs(os.path.dirname(DST), exist_ok=True)
    with open(DST, "w", encoding="utf-8") as f:
        f.write(js)
    n_sec = sum(len(m["sections"]) for m in modules)
    n_sub = sum(len(s["subsections"]) for m in modules for s in m["sections"])
    print(f"modules={len(modules)} sections={n_sec} subsections={n_sub} screens={total}")

if __name__ == "__main__":
    main()
