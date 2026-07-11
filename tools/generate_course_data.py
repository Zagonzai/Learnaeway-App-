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
    # Round-3 content update: the 60/20/20 Rule (5 pages) and Minimum
    # Accounts to Have (6 pages) close out Pillar 1 as two subsections.
    # Authored explicitly so every page stays one atomic swipeable screen
    # (the paragraph chunker would split the longer ones).
    AUTHORED_SUBSECTIONS = {
        "Pillar 1: Earned Income — Your Foundation": [
            {
                "title": "The 60/20/20 Rule",
                "screens": [
                    {
                        "headline": "The 60/20/20 Rule",
                        "body": ["Once you begin earning income, every dollar should have a purpose.",
                                 "One of the easiest ways to build financial discipline is by giving your money structure before you spend it.",
                                 "Instead of asking, \"What's left over after I pay my bills?\" ask yourself, \"Where should every dollar go before I spend it?\""],
                    },
                    {
                        "headline": "60% — Fixed Expenses",
                        "body": ["Use approximately 60% of your income to cover your essential monthly expenses.", "These include:"],
                        "list": ["Housing", "Utilities", "Transportation", "Insurance", "Groceries", "Phone", "Internet", "Other recurring bills"],
                        "listClose": ["These are the expenses that keep your life running."],
                    },
                    {
                        "headline": "20% — Save & Invest for Your Future",
                        "body": ["The next 20% should always be invested back into your future.", "This money can be used for:"],
                        "list": ["High-yield savings accounts", "Emergency fund", "Roth IRA", "401(k)", "Brokerage accounts", "Index funds", "Real estate", "Starting or growing a business", "Trading education", "Future investments", "Large planned purchases"],
                        "listClose": ["The goal is simple: pay your future self first.",
                                      "Every dollar you invest today is building opportunities for tomorrow."],
                    },
                    {
                        "headline": "20% — Enjoy Your Money",
                        "body": ["The final 20% is yours.",
                                 "You've worked hard for your money, and it's important that you enjoy it.",
                                 "Use this money for the things that make life meaningful. Examples include:"],
                        "list": ["Family vacations", "Weekend trips", "Saving for a new vehicle", "Concerts", "Hobbies", "Dining out", "New clothes or shoes", "Gifts", "Entertainment", "Anything that's important to you"],
                        "listClose": ["Financial discipline doesn't mean you stop enjoying life. It means you've already planned for it.",
                                      "When you intentionally set aside money for the things you enjoy, you eliminate guilt, reduce unnecessary spending, and avoid dipping into your savings or investment accounts."],
                    },
                    {
                        "headline": "Why This Matters",
                        "body": ["Money without structure often disappears. Money with structure creates freedom.",
                                 "By giving every dollar a purpose, you're creating consistency — not only in your finances, but in your habits. The goal isn't to deprive yourself.",
                                 "The goal is to build a financial system that allows you to live today while preparing for tomorrow.",
                                 "Spend with intention. Save with purpose. Invest for the future. Enjoy the journey."],
                    },
                ],
            },
            {
                "title": "Minimum Accounts to Have",
                "screens": [
                    {
                        "headline": "Minimum Accounts to Have",
                        "body": ["These are some of the minimum financial accounts every individual should consider opening to begin building a strong financial foundation and a structured future."],
                    },
                    {
                        "headline": "High-Yield Savings Account (HYSA)",
                        "body": ["A High-Yield Savings Account is a savings account that earns a significantly higher interest rate than a traditional bank savings account. It allows your money to grow while keeping it safe, secure, and easily accessible.",
                                 "This account is ideal for:"],
                        "list": ["Emergency funds", "Short-term savings", "Large future purchases", "Opportunity funds"],
                        "listClose": ["Think of this account as your financial safety net."],
                    },
                    {
                        "headline": "Roth IRA",
                        "body": ["A Roth IRA (Individual Retirement Account) is a retirement investment account that allows your money to grow tax-free for retirement.",
                                 "Unlike some retirement accounts, you contribute after-tax money, meaning you've already paid taxes on the income before investing it. In return, your investments can grow over time, and if certain IRS requirements are met, you can withdraw your money during retirement tax-free.",
                                 "Inside a Roth IRA, you can invest in:"],
                        "list": ["Index Funds", "ETFs", "Mutual Funds", "Individual Stocks", "Bonds", "Other eligible investments"],
                        "listClose": ["Annual Contribution Limit — The IRS sets a maximum amount you can contribute each year. This limit may change over time, so it's important to stay up to date with current contribution limits.",
                                      "A Roth IRA is one of the most powerful long-term wealth-building tools available because it combines compound growth with tax-free retirement withdrawals."],
                    },
                    {
                        "headline": "401(k)",
                        "body": ["A 401(k) is an employer-sponsored retirement savings plan designed to help employees save and invest for retirement.",
                                 "Money is automatically deducted from each paycheck and deposited into your retirement account, making it easy to invest consistently over time.",
                                 "Many employers also offer a company match, meaning they contribute additional money to your retirement account based on how much you contribute. This is essentially free money toward your future.",
                                 "Inside a 401(k), you can typically invest in:"],
                        "list": ["Mutual Funds", "Index Funds", "Target-Date Funds", "Bond Funds", "Stock Funds"],
                        "listClose": ["Annual Contribution Limit — Like the Roth IRA, the IRS sets annual contribution limits that may change from year to year.",
                                      "If your employer offers a matching contribution, it's generally recommended to contribute at least enough to receive the full company match."],
                    },
                    {
                        "headline": "Brokerage Account",
                        "body": ["A Brokerage Account is an investment account that allows you to buy and sell financial assets whenever you choose.",
                                 "Unlike retirement accounts, brokerage accounts generally do not have annual contribution limits or age restrictions on withdrawals.",
                                 "You can invest in:"],
                        "list": ["Stocks", "ETFs", "Index Funds", "Mutual Funds", "Bonds", "Options (depending on approval)", "Other investment products"],
                        "listClose": ["Brokerage accounts offer flexibility and are commonly used to build wealth, invest for medium- and long-term goals, or actively participate in the financial markets.",
                                      "Best For — General investing, building wealth, trading, and financial flexibility."],
                    },
                    {
                        "headline": "Remember",
                        "body": ["Each account serves a different purpose."],
                        "list": ["High-Yield Savings Account → Protect your cash.", "Roth IRA → Build tax-free retirement wealth.", "401(k) → Take advantage of employer retirement benefits.", "Brokerage Account → Invest and grow wealth outside of retirement accounts."],
                        "listClose": ["There isn't one account that's \"better\" than the others. They work together to create a well-rounded financial foundation — one that can help with unexpected expenses, grow your wealth, and prepare for retirement.",
                                      "This is the end of Pillar 1 — Earned Income. Pillar 2 - Protection & Life Insurance begins next."],
                    },
                ],
            },
        ],
    }

    for full_title, authored_subs in AUTHORED_SUBSECTIONS.items():
        sec = next(s for m in modules for s in m["sections"] if s["fullTitle"] == full_title)
        for ai, asub in enumerate(authored_subs):
            sid = f"{sec['id']}--{slugify(asub['title'])}-a{ai}"
            screens = []
            for n, scr in enumerate(asub["screens"], 1):
                entry = {
                    "id": f"{sid}--{n}",
                    "headline": scr["headline"],
                    "subhead": scr.get("subhead", ""),
                    "body": scr.get("body", []),
                    "audio": f"{sid}/{n}.mp3",  # v2 hook, no playback in v1
                }
                if scr.get("list"):
                    entry["list"] = scr["list"]
                if scr.get("listClose"):
                    entry["listClose"] = scr["listClose"]
                screens.append(entry)
                total += 1
            sec["subsections"].append({"id": sid, "title": asub["title"], "screens": screens})

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
