#!/usr/bin/env python3
"""Decide whether a monthly refresh is safe to merge without a person.

The refresh was built never to merge itself, because the classification rules
have misfired before in ways nothing caught until someone looked. Most months,
though, the change is small and dull: a handful of tools appear, one or two
leave, a few licences are corrected. Those do not need a reader. The ones that
do are the ones that are large, or that reach into what was judged by hand.

So this decides on the shape of the change, not on which source it came from:

  - the curated layer is untouched: no curated tool added, removed or moved
  - the taxonomy is untouched: no stage appears or disappears
  - the change is small: removals, additions and stage moves under a cap

Anything outside that waits for review, with the reason written in the pull
request. The tests, the evaluation set and the citation check have already
passed by the time this runs; a refresh that fails any of them never gets here.

  python3 scripts/refresh_gate.py before.json after.json   # exit 0 = merge, 1 = review
"""

import json
import sys

# Caps relative to the catalogue, with a floor so a small month is not blocked
# by a percentage of a small number.
MAX_REMOVED = lambda n: max(10, n // 100)     # 1%       # noqa: E731
MAX_ADDED = lambda n: max(50, n * 3 // 100)   # 3%       # noqa: E731
MAX_MOVED = 10


def load(path):
    d = json.load(open(path))
    return {t["id"]: t for t in d["tools"]}, {s["slug"] for s in d["stages"] if s.get("count")}


def decide(before_path, after_path):
    old, old_stages = load(before_path)
    new, new_stages = load(after_path)
    n = len(old)

    added = new.keys() - old.keys()
    removed = old.keys() - new.keys()
    moved = [k for k in old.keys() & new.keys() if old[k]["stage"] != new[k]["stage"]]

    cur_old = {k for k, t in old.items() if t.get("curated")}
    cur_new = {k for k, t in new.items() if t.get("curated")}
    cur_moved = [k for k in cur_old & cur_new if old[k]["stage"] != new[k]["stage"]]

    reasons = []
    if cur_old != cur_new:
        gone, came = sorted(cur_old - cur_new), sorted(cur_new - cur_old)
        reasons.append("the curated layer changed"
                       + (f": lost {', '.join(old[k]['name'] for k in gone)}" if gone else "")
                       + (f"; gained {', '.join(new[k]['name'] for k in came)}" if came else ""))
    if cur_moved:
        reasons.append(f"curated tools changed stage: {', '.join(new[k]['name'] for k in cur_moved)}")
    if old_stages != new_stages:
        reasons.append(f"the stages changed (lost {sorted(old_stages - new_stages) or 'none'}, "
                       f"new {sorted(new_stages - old_stages) or 'none'})")
    if len(removed) > MAX_REMOVED(n):
        reasons.append(f"{len(removed)} tools removed, more than the {MAX_REMOVED(n)} allowed")
    if len(added) > MAX_ADDED(n):
        reasons.append(f"{len(added)} tools added, more than the {MAX_ADDED(n)} allowed")
    if len(moved) > MAX_MOVED:
        reasons.append(f"{len(moved)} tools changed stage, more than the {MAX_MOVED} allowed")

    summary = (f"{len(added)} added, {len(removed)} removed, {len(moved)} changed stage; "
               f"curated layer {'unchanged' if cur_old == cur_new and not cur_moved else 'CHANGED'}")
    return not reasons, reasons, summary


def main():
    if len(sys.argv) != 3:
        print(__doc__)
        return 2
    ok, reasons, summary = decide(sys.argv[1], sys.argv[2])
    if ok:
        print(f"**Merged automatically.** {summary}. Small, and nothing chosen by hand was touched; "
              "the tests, evaluation set and citation check all passed.")
        return 0
    print(f"**Needs review before merging.** {summary}.\n")
    for r in reasons:
        print(f"- {r}")
    print("\nThis is the kind of change the classification rules have got wrong before. Read the "
          "summary above, then merge or close.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
