#!/usr/bin/env python3
"""Mine GitHub for actively-maintained drug-discovery code, by topic.

Repository facts — name, URL, stars, language, licence, last push — are just
facts, and the selection here (which topics, what star floor, how recently
pushed) is ours. This is the "is anyone still maintaining it" layer that a
curated registry cannot give you.

Unauthenticated search allows 10 requests/minute, so this paces itself and
caches. Set GITHUB_TOKEN to go faster.

Outputs data/github_topics.json / .csv
"""

import csv
import json
import os
import time
import urllib.request
from urllib.error import HTTPError

OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
CACHE = os.path.join(OUT_DIR, ".cache", "github_topics")

# The first block is the classical discovery stack. The second targets where a
# registry of established software is structurally weak: the modern ML tooling,
# which lives on GitHub long before it reaches any curated registry.
TOPICS = [
    "drug-discovery", "cheminformatics", "computational-chemistry", "molecular-dynamics",
    "molecular-docking", "virtual-screening", "protein-structure", "protein-design",
    "molecular-modeling", "structural-bioinformatics", "qsar", "admet",
    "protein-ligand-interaction", "retrosynthesis", "molecular-generation", "bioinformatics-tool",

    "protein-language-model", "protein-folding", "protein-structure-prediction", "alphafold",
    "protein-engineering", "antibody", "antibody-design", "single-cell", "scrna-seq",
    "single-cell-rna-seq", "genomics", "computational-biology", "bioimage-analysis",
    "cryo-em", "mass-spectrometry", "proteomics", "transcriptomics",
    "molecular-property-prediction", "structure-based-drug-design", "de-novo-drug-design",
    "drug-repurposing", "drug-target-interaction", "molecular-representation-learning",
    "bioinformatics",
]
MIN_STARS = 30
PAGES = 2          # 100 per page; the long tail below 30 stars is mostly abandoned
PER_PAGE = 100

HEADERS = {"Accept": "application/vnd.github+json", "User-Agent": "assayer/1.0",
           "X-GitHub-Api-Version": "2022-11-28"}
if os.environ.get("GITHUB_TOKEN"):
    HEADERS["Authorization"] = "Bearer " + os.environ["GITHUB_TOKEN"]
PACE = 2 if os.environ.get("GITHUB_TOKEN") else 7  # unauthenticated search: 10/min

FIELDS = ["full_name", "owner", "name", "url", "description", "homepage", "language", "topics",
          "stars", "forks", "license", "archived", "created_at", "pushed_at", "matched_topics"]


def search(topic, page):
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, f"{topic}_{page}.json")
    if os.path.exists(path):
        return json.load(open(path))
    url = (f"https://api.github.com/search/repositories?q=topic:{topic}+stars:>={MIN_STARS}"
           f"&sort=stars&order=desc&per_page={PER_PAGE}&page={page}")
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=HEADERS), timeout=60) as r:
            data = json.load(r)
    except HTTPError as e:
        if e.code in (403, 429):
            print(f"    rate-limited on {topic} p{page}; waiting 60s", flush=True)
            time.sleep(60)
            return search(topic, page)
        raise
    json.dump(data, open(path, "w"))
    time.sleep(PACE)
    return data


def main():
    repos, matched = {}, {}
    for topic in TOPICS:
        found = 0
        for page in range(1, PAGES + 1):
            d = search(topic, page)
            items = d.get("items", [])
            found += len(items)
            for r in items:
                repos[r["full_name"]] = r
                matched.setdefault(r["full_name"], set()).add(topic)
            if len(items) < PER_PAGE:
                break
        print(f"  {found:5d}  topic:{topic}", flush=True)

    rows = []
    for full, r in repos.items():
        lic = r.get("license") or {}
        rows.append({
            "full_name": full,
            "owner": (r.get("owner") or {}).get("login"),
            "name": r.get("name"),
            "url": r.get("html_url"),
            "description": (r.get("description") or "").strip() or None,
            "homepage": (r.get("homepage") or "").strip() or None,
            "language": r.get("language"),
            "topics": (r.get("topics") or [])[:8],
            "stars": r.get("stargazers_count"),
            "forks": r.get("forks_count"),
            "license": lic.get("spdx_id"),
            "archived": r.get("archived"),
            "created_at": (r.get("created_at") or "")[:10] or None,
            "pushed_at": (r.get("pushed_at") or "")[:10] or None,
            "matched_topics": sorted(matched[full]),
        })
    rows.sort(key=lambda r: -(r["stars"] or 0))

    os.makedirs(OUT_DIR, exist_ok=True)
    json.dump(rows, open(os.path.join(OUT_DIR, "github_topics.json"), "w"), indent=2, ensure_ascii=False)
    with open(os.path.join(OUT_DIR, "github_topics.csv"), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS)
        w.writeheader()
        for r in rows:
            w.writerow({k: "; ".join(r[k]) if isinstance(r[k], list) else r[k] for k in FIELDS})
    live = sum(1 for r in rows if (r["pushed_at"] or "") >= "2024-01-01" and not r["archived"])
    print(f"\n{len(rows)} unique repos ({live} pushed since 2024) -> data/github_topics.{{json,csv}}")


if __name__ == "__main__":
    main()
