#!/usr/bin/env python3
"""Generate docs/Learnaeway_Table_of_Contents.md from data/course-data.js.

Run after tools/generate_course_data.py whenever section/subsection order
or counts change, so the ToC stays in sync with the app's outline.
"""
import json, os, re, sys

SRC = sys.argv[1] if len(sys.argv) > 1 else "data/course-data.js"
DST = sys.argv[2] if len(sys.argv) > 2 else "docs/Learnaeway_Table_of_Contents.md"

def main():
    raw = open(SRC, encoding="utf-8").read()
    data = json.loads(re.search(r"window\.COURSE_DATA = (.*);\s*$", raw, re.S).group(1))

    lines = [f"# {data['courseTitle']}", data["byline"], ""]
    screen_total = 0
    for m in data["modules"]:
        lines.append(f"## {m['docTitle']}")
        lines.append("")
        for si, s in enumerate(m["sections"], 1):
            lines.append(f"### {si}. {s['title']}")
            for sub in s["subsections"]:
                k = len(sub["screens"])
                screen_total += k
                plural = "s" if k != 1 else ""
                if sub["title"] in ("Overview", s["title"]):
                    lines.append(f"- {k} screen{plural}")
                else:
                    lines.append(f"- {sub['title']} ({k} screen{plural})")
            lines.append("")

    n_sections = sum(len(m["sections"]) for m in data["modules"])
    n_subs = sum(len(s["subsections"]) for m in data["modules"] for s in m["sections"])
    lines.append(f"**Total: {len(data['modules'])} modules, {n_sections} sections, "
                  f"{n_subs} subsections, {screen_total} screens.**")

    os.makedirs(os.path.dirname(DST), exist_ok=True)
    with open(DST, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    print(f"wrote {DST}: {len(data['modules'])} modules, {n_sections} sections, "
          f"{n_subs} subsections, {screen_total} screens")

if __name__ == "__main__":
    main()
