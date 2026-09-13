#!/usr/bin/env python3
"""Merge every scraped source into one flat tool index.

Sources (all cleanly licensed or our own):
  data/curated_standard_tools.json    - our curated standard drug-discovery stack
  data/biotools.json                  - bio.tools / ELIXIR registry (CC-BY 4.0)
  data/github_topics.json             - GitHub topic mining (facts; our selection)
  data/github_stars_<user>.json       - the maintainer's own starred repos

Writes data/tools_index.json and data/tools_index.csv, one row per tool, with
a `repo` key (owner/name, lowercased) used to spot the same tool across
sources.
"""

import csv
import glob
import json
import os
import re

OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
FIELDS = ["source", "stage", "name", "description", "url", "code_url", "paper_url",
          "categories", "year", "license", "repo", "stars", "also_in"]

REPO_RE = re.compile(r"https?://(?:www\.)?github\.com/([^/\s#?]+)/([^/\s#?]+)", re.I)


def repo_key(*urls):
    for u in urls:
        for candidate in (u if isinstance(u, list) else [u]):
            if not candidate:
                continue
            m = REPO_RE.search(candidate)
            if m:
                name = m.group(2).removesuffix(".git")
                return f"{m.group(1)}/{name}".lower()
    return None


def squash(s):
    return re.sub(r"[^a-z0-9]+", "", (s or "").lower())


def load(path):
    return json.load(open(path)) if os.path.exists(path) else []


def from_curated(rows):
    for r in rows:
        yield {
            "source": "curated",
            "stars": None,
            "stage": r.get("stage"),
            "name": r.get("name"),
            "description": r.get("description"),
            "url": r.get("url"),
            "code_url": f"https://github.com/{r['repo']}" if r.get("repo") else None,
            "paper_url": None,
            "categories": r.get("tags") or [],
            "year": None,
            "license": r.get("access"),
            "repo": r.get("repo"),
        }


def from_biotools(rows):
    for r in rows:
        url = r.get("url") or r.get("homepage")
        yield {
            "source": "biotools",
            "stars": None,
            "stage": None,
            "name": r.get("name"),
            "description": r.get("description"),
            "url": url,
            "code_url": url if url and "github.com" in url else None,
            "paper_url": (f"https://doi.org/{r['publications'][0]}"
                          if r.get("publications") and "/" in str(r["publications"][0]) else None),
            "categories": (r.get("topics") or []) + (r.get("functions") or []),
            "year": None,
            "license": r.get("license") or r.get("cost"),
            "repo": repo_key(url),
            "has_paper": bool(r.get("publications")),
        }


def from_github_topics(rows):
    for r in rows:
        yield {
            "source": "github-topics",
            "stars": r.get("stars"),
            "stage": None,
            "name": r.get("full_name"),
            "description": r.get("description"),
            "url": r.get("url"),
            "code_url": r.get("url"),
            "paper_url": None,
            "categories": r.get("topics") or [],
            "year": (r.get("created_at") or "")[:4] or None,
            "license": r.get("license"),
            "repo": repo_key(r.get("url")),
        }


def from_stars(rows, user):
    for r in rows:
        yield {
            "source": f"github-stars:{user}",
            "stars": r.get("stars"),
            "stage": None,
            "name": r.get("full_name"),
            "description": r.get("description"),
            "url": r.get("url"),
            "code_url": r.get("url"),
            "paper_url": None,
            "categories": r.get("topics") or [],
            "year": (r.get("created_at") or "")[:4] or None,
            "license": r.get("license"),
            "repo": repo_key(r.get("url")),
        }


def main():
    rows = []
    rows += list(from_curated(load(os.path.join(OUT_DIR, "curated_standard_tools.json"))))
    rows += list(from_biotools(load(os.path.join(OUT_DIR, "biotools.json"))))
    rows += list(from_github_topics(load(os.path.join(OUT_DIR, "github_topics.json"))))
    for path in sorted(glob.glob(os.path.join(OUT_DIR, "github_stars_*.json"))):
        user = os.path.basename(path)[len("github_stars_"):-len(".json")]
        rows += list(from_stars(load(path), user))

    # cross-source overlap, by repo when there is one, else by lowercased name
    buckets = {}
    for r in rows:
        key = r["repo"] or (r["name"] or "").strip().lower()
        if key:
            buckets.setdefault(key, set()).add(r["source"])
    for r in rows:
        key = r["repo"] or (r["name"] or "").strip().lower()
        others = sorted(buckets.get(key, set()) - {r["source"]})
        r["also_in"] = others

    json.dump(rows, open(os.path.join(OUT_DIR, "tools_index.json"), "w"),
              indent=2, ensure_ascii=False)
    with open(os.path.join(OUT_DIR, "tools_index.csv"), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS)
        w.writeheader()
        for r in rows:
            w.writerow({k: "; ".join(r[k]) if isinstance(r[k], list) else r[k] for k in FIELDS})

    by_source = {}
    for r in rows:
        by_source[r["source"]] = by_source.get(r["source"], 0) + 1
    print(f"{len(rows)} rows -> {OUT_DIR}/tools_index.{{json,csv}}")
    for s, n in sorted(by_source.items()):
        print(f"  {n:4d}  {s}")
    print(f"  {sum(1 for r in rows if r['repo']):4d}  rows with a GitHub repo")
    print(f"  {sum(1 for r in rows if r['also_in']):4d}  rows that also appear in another source")
    curated_new = [r for r in rows if r["source"] == "curated" and not r["also_in"]]
    print(f"  {len(curated_new):4d}  curated tools absent from the scraped sources")


if __name__ == "__main__":
    main()
