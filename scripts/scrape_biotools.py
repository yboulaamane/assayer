#!/usr/bin/env python3
"""Pull drug-discovery tools from bio.tools, the ELIXIR registry.

bio.tools holds ~34,000 curated life-science tools and its content is released
under CC-BY 4.0, so it can be reused commercially with attribution — which is
what makes it a sound foundation to build on rather than borrow.

We take only the EDAM topics that matter for drug discovery, not the whole
registry: the selection is ours, the records are theirs, and the attribution
is in the site footer and the README.

Outputs data/biotools.json / .csv
"""

import csv
import json
import os
import time
import urllib.parse
import urllib.request

OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
CACHE = os.path.join(OUT_DIR, ".cache", "biotools")
API = "https://bio.tools/api/t/"
HEADERS = {"Accept": "application/json", "User-Agent": "assayer/1.0 (tool catalogue; CC-BY reuse)"}

# EDAM topics that are actually about discovering and developing drugs. The
# broad ones ("Machine learning", "Molecular interactions, pathways and
# networks") are deliberately excluded — they flood the catalogue with general
# bioinformatics packages and dilute what the atlas is for.
# Scoped to what a medicinal or computational chemist actually works on.
# The broad structural-bioinformatics topics ("Structure prediction", "Protein
# structure analysis") were tried and dropped: they add ~1,800 general-purpose
# sequence and structure tools that dilute the catalogue without helping anyone
# design a molecule. Receptor preparation is covered by the curated stack.
TOPICS = [
    "Drug discovery",
    "Medicinal chemistry",
    "Cheminformatics",
    "Computational chemistry",
    "Molecular dynamics",
    "Molecular modelling",
    "Binding sites",
    "Compound libraries and screening",
    "Pharmacology",
    "Toxicology",
    "Biophysics",
    "Structural biology",
]

FIELDS = ["biotools_id", "name", "description", "homepage", "topics", "functions",
          "tool_type", "license", "cost", "maturity", "language", "url", "publications"]


def get(url, key):
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, key + ".json")
    if os.path.exists(path):
        return json.load(open(path))
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=60) as r:
        data = json.load(r)
    json.dump(data, open(path, "w"))
    time.sleep(0.35)
    return data


def fetch_topic(topic):
    q = urllib.parse.quote(f'"{topic}"')
    slug = topic.lower().replace(" ", "-").replace(",", "")[:40]
    out, page = [], 1
    while True:
        d = get(f"{API}?topic={q}&format=json&page={page}", f"{slug}_{page}")
        out += d.get("list", [])
        if not d.get("next"):
            break
        page += 1
        if page > 40:  # a topic this broad is not a topic
            break
    return out


def flatten(t, topics_seen):
    links = t.get("link") or []
    repo = next((l["url"] for l in links if l.get("type") and "Repository" in l["type"]), None)
    pubs = [p.get("doi") or p.get("pmid") for p in (t.get("publication") or [])]
    funcs = []
    for f in t.get("function") or []:
        funcs += [o["term"] for o in (f.get("operation") or [])]
    return {
        "biotools_id": t.get("biotoolsID"),
        "name": t.get("name"),
        "description": (t.get("description") or "").strip() or None,
        "homepage": t.get("homepage"),
        "topics": sorted(topics_seen),
        "functions": sorted(set(funcs))[:6],
        "tool_type": (t.get("toolType") or [None])[0],
        "license": t.get("license"),
        "cost": t.get("cost"),
        "maturity": t.get("maturity"),
        "language": ", ".join(t.get("language") or []) or None,
        "url": repo or t.get("homepage"),
        "publications": [p for p in pubs if p][:3],
    }


def main():
    by_id, topics_of = {}, {}
    for topic in TOPICS:
        got = fetch_topic(topic)
        print(f"  {len(got):5d}  {topic}", flush=True)
        for t in got:
            tid = t.get("biotoolsID")
            if not tid:
                continue
            by_id[tid] = t
            topics_of.setdefault(tid, set()).add(topic)

    rows = [flatten(t, topics_of[tid]) for tid, t in by_id.items()]
    rows = [r for r in rows if r["name"] and r["homepage"]]
    rows.sort(key=lambda r: (r["name"] or "").lower())

    os.makedirs(OUT_DIR, exist_ok=True)
    json.dump(rows, open(os.path.join(OUT_DIR, "biotools.json"), "w"), indent=2, ensure_ascii=False)
    with open(os.path.join(OUT_DIR, "biotools.csv"), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS)
        w.writeheader()
        for r in rows:
            w.writerow({k: "; ".join(r[k]) if isinstance(r[k], list) else r[k] for k in FIELDS})
    print(f"\n{len(rows)} unique tools across {len(TOPICS)} EDAM topics -> data/biotools.{{json,csv}}")


if __name__ == "__main__":
    main()
