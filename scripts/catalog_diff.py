#!/usr/bin/env python3
"""Summarise what changed between two builds of the catalogue.

web/catalog.json is two megabytes on one line, so `git diff` reports it as one
insertion and one deletion. An automated refresh whose diff nobody can read is
an automated refresh nobody reviews, which is worse than none: this turns it
back into something a person can approve or reject.

  python3 scripts/catalog_diff.py old.json new.json
  python3 scripts/catalog_diff.py old.json new.json --markdown
"""

import argparse
import json
from collections import Counter


def load(path):
    d = json.load(open(path))
    return ({t["id"]: t for t in d["tools"]},
            {s["slug"]: s for s in d["stages"]})


def summarise(old_path, new_path):
    old, old_stages = load(old_path)
    new, new_stages = load(new_path)

    added = [new[k] for k in new.keys() - old.keys()]
    removed = [old[k] for k in old.keys() - new.keys()]
    both = old.keys() & new.keys()

    moved = [(old[k], new[k]) for k in both if old[k].get("stage") != new[k].get("stage")]
    relicensed = [(old[k], new[k]) for k in both
                  if (old[k].get("license") or "") != (new[k].get("license") or "")]
    resourced = [(old[k], new[k]) for k in both
                 if sorted(old[k].get("sources") or []) != sorted(new[k].get("sources") or [])]

    stage_delta = {}
    for slug in set(old_stages) | set(new_stages):
        before = old_stages.get(slug, {}).get("count", 0)
        after = new_stages.get(slug, {}).get("count", 0)
        if before != after:
            stage_delta[new_stages.get(slug, old_stages[slug])["label"]] = (before, after)

    return {
        "totals": {"before": len(old), "after": len(new)},
        "added": sorted(added, key=lambda t: t["name"]),
        "removed": sorted(removed, key=lambda t: t["name"]),
        "moved": sorted(moved, key=lambda p: p[1]["name"]),
        "relicensed": sorted(relicensed, key=lambda p: p[1]["name"]),
        "resourced": sorted(resourced, key=lambda p: p[1]["name"]),
        "stages": stage_delta,
        "new_stages": sorted(set(new_stages) - set(old_stages)),
        "lost_stages": sorted(set(old_stages) - set(new_stages)),
    }


def markdown(s):
    L = []
    before, after = s["totals"]["before"], s["totals"]["after"]
    delta = after - before
    L.append(f"**{before:,} → {after:,} tools** ({delta:+,})\n")

    headline = [f"{len(s['added'])} added", f"{len(s['removed'])} removed",
                f"{len(s['moved'])} changed stage", f"{len(s['relicensed'])} changed licence"]
    L.append(" · ".join(headline) + "\n")

    # Anything that removes a tool or a stage is the review-worthy half.
    if s["lost_stages"]:
        L.append(f"> **A stage disappeared: {', '.join(s['lost_stages'])}.** "
                 "That is a classification bug, not a data change. Do not merge.\n")
    if s["removed"]:
        L.append(f"\n### Removed ({len(s['removed'])})\n")
        L.append("A tool leaves only if its source dropped it or a merge absorbed it. "
                 "Worth a look at each.\n")
        for t in s["removed"][:30]:
            L.append(f"- **{t['name']}** — was in {t.get('stage', '?')} "
                     f"(from {', '.join(t.get('sources') or ['?'])})")
        if len(s["removed"]) > 30:
            L.append(f"- …and {len(s['removed']) - 30} more")

    if s["moved"]:
        L.append(f"\n### Changed stage ({len(s['moved'])})\n")
        for a, b in s["moved"][:30]:
            L.append(f"- **{b['name']}** — `{a.get('stage')}` → `{b.get('stage')}`")
        if len(s["moved"]) > 30:
            L.append(f"- …and {len(s['moved']) - 30} more")

    if s["stages"]:
        L.append("\n### Stage counts\n")
        L.append("| Stage | Before | After |")
        L.append("|---|--:|--:|")
        for label, (b, a) in sorted(s["stages"].items(), key=lambda kv: abs(kv[1][1] - kv[1][0]), reverse=True):
            L.append(f"| {label} | {b:,} | {a:,} |")

    if s["added"]:
        by_stage = Counter(t.get("stage", "?") for t in s["added"])
        L.append(f"\n<details><summary>Added ({len(s['added'])})</summary>\n")
        L.append("Landing in: " + ", ".join(f"{k} ({v})" for k, v in by_stage.most_common()) + "\n")
        for t in s["added"][:120]:
            L.append(f"- **{t['name']}** — {t.get('stage', '?')} — "
                     f"{(t.get('description') or 'no description')[:110]}")
        if len(s["added"]) > 120:
            L.append(f"- …and {len(s['added']) - 120} more")
        L.append("\n</details>")

    if s["relicensed"]:
        L.append(f"\n<details><summary>Licence changed ({len(s['relicensed'])})</summary>\n")
        for a, b in s["relicensed"][:40]:
            L.append(f"- **{b['name']}** — `{a.get('license') or 'none'}` → `{b.get('license') or 'none'}`")
        L.append("\n</details>")

    L.append("\n---\n**Check before merging:** a stage that vanished, a tool removed that "
             "should not be, and any move that puts a tool somewhere a protocol would not "
             "look for it. The tests cover structure; they cannot tell you a tool is now "
             "filed wrongly.")
    return "\n".join(L)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("old")
    ap.add_argument("new")
    ap.add_argument("--markdown", action="store_true")
    ap.add_argument("--json", metavar="PATH")
    args = ap.parse_args()

    s = summarise(args.old, args.new)
    if args.json:
        json.dump(s, open(args.json, "w"), indent=2, default=str)
    if args.markdown:
        print(markdown(s))
    else:
        print(f"tools {s['totals']['before']:,} -> {s['totals']['after']:,}")
        print(f"  added {len(s['added'])}  removed {len(s['removed'])}  "
              f"moved {len(s['moved'])}  relicensed {len(s['relicensed'])}")
        for label, (b, a) in sorted(s["stages"].items()):
            print(f"    {label:<28} {b:>5} -> {a:>5}")
        if s["lost_stages"]:
            print(f"  STAGE DISAPPEARED: {', '.join(s['lost_stages'])}")
    # A lost stage is a bug; a merge should not proceed on it.
    return 2 if s["lost_stages"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
