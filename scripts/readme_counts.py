#!/usr/bin/env python3
"""Keep the figures in README.md true.

A README that quotes counts goes stale the moment the data moves, and this one
went stale twice in a single session: "3,973 tools" outlived a prune to 2,380,
and "18 protocols, 117 modules" outlived the registry growing to 27 and 173. The
monthly refresh moves the catalogue counts every time it runs, so they cannot be
kept right by hand.

Every figure derived from the data sits inside a marker that GitHub does not
render:

    <!--n:curated-->296<!--/n-->          one value, inline

    <!--block:stages-->                   a whole generated section
    ...
    <!--/block:stages-->

This fills them from the data. Anything outside a marker is prose. Figures that
are history rather than state ("346 rows turned out to be CT scanners") are left
as written, on purpose.

An unknown key, or a marker the pattern cannot read, is an error rather than a
skip: either would freeze a number while making it look maintained.

  python3 scripts/readme_counts.py          # rewrite README.md
  python3 scripts/readme_counts.py --check  # exit 1 if it is out of date

build_catalog.py calls update() at the end of every build.
"""

import argparse
import json
import os
import re
import sys
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
README = os.path.join(ROOT, "README.md")

INLINE = re.compile(r"<!--n:([\w-]+)-->(.*?)<!--/n-->")
BLOCK = re.compile(r"(<!--block:([\w-]+)-->\n)(.*?)(\n<!--/block:\2-->)", re.S)


def _load(*parts):
    with open(os.path.join(ROOT, *parts), encoding="utf-8") as f:
        return json.load(f)


def _rows(data):
    """The scrapers write either a bare list or {"tools": [...]}."""
    if isinstance(data, dict):
        return data.get("tools") or data.get("repos") or []
    return data


def _registry_block(src, name):
    start = src.index(f"export const {name} = {{")
    return src[start:src.index("\n};", start)]


def _topics(script):
    src = open(os.path.join(ROOT, "scripts", script), encoding="utf-8").read()
    body = re.search(r"^TOPICS\s*=\s*\[(.*?)^\]", src, re.S | re.M)
    if not body:
        raise SystemExit(f"readme_counts: cannot find TOPICS in scripts/{script}")
    return re.findall(r'"([^"]+)"', body.group(1))


def figures():
    """Every value the README is allowed to quote, computed from the data."""
    cat = _load("web", "catalog.json")
    tools = cat["tools"]
    index = _load("data", "tools_index.json")
    stars = _rows(_load("data", "github_stars_yboulaamane.json"))
    registry = open(os.path.join(ROOT, "web", "assets", "modules.js"), encoding="utf-8").read()
    modules = _registry_block(registry, "MODULES")
    recipes = _registry_block(registry, "RECIPES")
    cases = _load("evals", "cases.json")["cases"]
    baseline = _load("evals", "baseline.json")

    packaged = lambda t: t.get("pypi") or t.get("conda")  # noqa: E731
    curated = sum(1 for t in tools if t.get("curated"))
    kept_stars = sum(1 for r in index if r["source"].startswith("github-stars"))
    return {
        # the catalogue as built
        "tools": len(tools),
        "curated": curated,
        "listed": len(tools) - curated,
        "excluded": len(_load("data", "excluded.json")["entries"]),
        "stages": sum(1 for s in cat["stages"] if s["count"]),
        "packages": sum(1 for t in tools if packaged(t)),
        "python": sum(1 for t in tools if t.get("python")),
        "no_install": sum(1 for t in tools if not t.get("repo") and not packaged(t)),
        "snippets": sum(1 for t in tools if t.get("snippet")),
        "quickstarts": sum(1 for t in tools if t.get("quickstart")),
        # the layers it was built from
        "index_rows": len(index),
        "multi_source": sum(1 for r in index if r.get("also_in")),
        "biotools_rows": len(_rows(_load("data", "biotools.json"))),
        "github_rows": len(_rows(_load("data", "github_topics.json"))),
        "curated_rows": Counter(r["source"] for r in index)["curated"],
        "stars_rows": kept_stars,
        "stars_dropped": len(stars) - kept_stars,
        "biotools_topics": len(_topics("scrape_biotools.py")),
        "github_topics": len(_topics("scrape_github_topics.py")),
        # the planner. Counted from the source text; tests/readme.test.mjs checks
        # these against the real import, so a format change cannot miscount quietly.
        "protocols": len(re.findall(r'^  "[^"]+":\s*\{', recipes, re.M)),
        "modules": len(re.findall(r'^  "[^"]+":\s*\{', modules, re.M)),
        "pitfalls": len(re.findall(r"^    pitfall:", modules, re.M)),
        # the evaluation set
        "eval_cases": len(cases),
        "eval_reviewed": sum(1 for c in cases if c.get("reviewed")),
        "eval_checks": baseline["checks"],
        "eval_passed": baseline["passed"],
    }


def stage_block(figs):
    cat = _load("web", "catalog.json")
    stages = sorted([s for s in cat["stages"] if s["count"]], key=lambda s: -s["count"])
    half = (len(stages) + 1) // 2
    rows = []
    for i in range(half):
        a = stages[i]
        b = stages[i + half] if i + half < len(stages) else None
        rows.append(f"| {a['label']} | {a['curated']} | {a['count']} |"
                    + (f" | {b['label']} | {b['curated']} | {b['count']} |" if b else " | | | |"))
    return ("| Stage | Curated | Listed | | Stage | Curated | Listed |\n"
            "|---|--:|--:|---|---|--:|--:|\n" + "\n".join(rows) + "\n\n"
            f"{figs['curated']} of the {figs['tools']:,} entries were chosen and written up by hand; "
            f"the rest are listed from public registries and marked as such on every card. "
            f"{figs['packages']} carry a verified `pip` or `conda` command and {figs['python']} a "
            f"Python version the authors declared. {figs['snippets']} have a hand-written example "
            f"and {figs['quickstarts']} quote one from the project's own README. No example is "
            f"generated.")


def render(text, figs):
    """Return (new text, [changed keys]); raise on anything it cannot vouch for."""
    blocks = {"stages": stage_block(figs)}
    errors, changed = [], []

    def inline(m):
        key, old = m.group(1), m.group(2)
        if key not in figs:
            errors.append(f"unknown figure <!--n:{key}-->")
            return m.group(0)
        new = f"{figs[key]:,}"
        if new != old:
            changed.append(f"{key}: {old} -> {new}")
        return f"<!--n:{key}-->{new}<!--/n-->"

    def block(m):
        key = m.group(2)
        if key not in blocks:
            errors.append(f"unknown block <!--block:{key}-->")
            return m.group(0)
        if m.group(3) != blocks[key]:
            changed.append(f"block {key}")
        return m.group(1) + blocks[key] + m.group(4)

    out = BLOCK.sub(block, text)
    out = INLINE.sub(inline, out)

    # A marker split across a line wrap, or missing its closer, would never
    # match and never update. Count openers against what the patterns consumed.
    opened = len(re.findall(r"<!--n:", text))
    matched = len(INLINE.findall(text))
    if opened != matched:
        errors.append(f"{opened - matched} inline marker(s) not closed on the same line")
    opened_b = len(re.findall(r"<!--block:", text))
    if opened_b != len(BLOCK.findall(text)):
        errors.append("a block marker has no matching closer")

    if errors:
        raise SystemExit("readme_counts: " + "; ".join(errors))
    return out, changed


def update(check=False, quiet=False):
    text = open(README, encoding="utf-8").read()
    new, changed = render(text, figures())
    if not quiet:
        n = len(INLINE.findall(new)) + len(BLOCK.findall(new))
        print(f"README: {n} maintained figures, "
              + (f"{len(changed)} changed: {', '.join(changed)}" if changed else "all current"))
    if check:
        return 1 if changed else 0
    if new != text:
        with open(README, "w", encoding="utf-8") as f:
            f.write(new)
    return 0


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--check", action="store_true",
                    help="exit 1 if README.md is out of date, without writing")
    return update(check=ap.parse_args().check)


if __name__ == "__main__":
    sys.exit(main())
