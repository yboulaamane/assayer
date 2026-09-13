#!/usr/bin/env python3
"""Scrape a GitHub user's starred repositories (default: yboulaamane).

Uses the public REST API. Set GITHUB_TOKEN for a higher rate limit; works
unauthenticated for a few hundred repos.

Outputs into ../data:
  github_stars_<user>.json / .csv
"""

import csv
import json
import os
import sys
import time
import urllib.request
from urllib.error import HTTPError

USER = sys.argv[1] if len(sys.argv) > 1 else "yboulaamane"
OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")
CACHE = os.path.join(OUT_DIR, ".cache", "github")

HEADERS = {
    # star+json returns {"starred_at": ..., "repo": {...}}
    "Accept": "application/vnd.github.star+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "assayer/1.0",
}
if os.environ.get("GITHUB_TOKEN"):
    HEADERS["Authorization"] = "Bearer " + os.environ["GITHUB_TOKEN"]

FIELDS = ["full_name", "owner", "name", "url", "description", "homepage", "language",
          "topics", "stars", "forks", "open_issues", "license", "archived", "fork",
          "created_at", "updated_at", "pushed_at", "starred_at", "size_kb", "default_branch"]


def get(url, cache_key):
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, cache_key + ".json")
    if os.path.exists(path):
        return json.load(open(path))
    req = urllib.request.Request(url, headers=HEADERS)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            data = json.load(r)
    except HTTPError as e:
        if e.code in (403, 429):
            raise SystemExit(
                f"GitHub rate-limited ({e.code}). Set GITHUB_TOKEN and re-run; "
                f"pages already fetched are cached in {CACHE}."
            )
        raise
    json.dump(data, open(path, "w"))
    time.sleep(0.5)
    return data


def fetch_stars(user):
    repos, page = [], 1
    while True:
        batch = get(
            f"https://api.github.com/users/{user}/starred?per_page=100&page={page}",
            f"{user}_stars_{page}",
        )
        repos += batch
        if len(batch) < 100:
            break
        page += 1
    return repos


def flatten(entry):
    repo = entry.get("repo", entry)
    lic = repo.get("license") or {}
    return {
        "full_name": repo.get("full_name"),
        "owner": (repo.get("owner") or {}).get("login"),
        "name": repo.get("name"),
        "url": repo.get("html_url"),
        "description": (repo.get("description") or "").strip() or None,
        "homepage": (repo.get("homepage") or "").strip() or None,
        "language": repo.get("language"),
        "topics": repo.get("topics") or [],
        "stars": repo.get("stargazers_count"),
        "forks": repo.get("forks_count"),
        "open_issues": repo.get("open_issues_count"),
        "license": lic.get("spdx_id") or lic.get("name"),
        "archived": repo.get("archived"),
        "fork": repo.get("fork"),
        "created_at": (repo.get("created_at") or "")[:10] or None,
        "updated_at": (repo.get("updated_at") or "")[:10] or None,
        "pushed_at": (repo.get("pushed_at") or "")[:10] or None,
        "starred_at": (entry.get("starred_at") or "")[:10] or None,
        "size_kb": repo.get("size"),
        "default_branch": repo.get("default_branch"),
    }


def write(rows, user):
    os.makedirs(OUT_DIR, exist_ok=True)
    json_path = os.path.join(OUT_DIR, f"github_stars_{user}.json")
    csv_path = os.path.join(OUT_DIR, f"github_stars_{user}.csv")
    json.dump(rows, open(json_path, "w"), indent=2, ensure_ascii=False)
    with open(csv_path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS)
        w.writeheader()
        for r in rows:
            w.writerow({k: "; ".join(r[k]) if isinstance(r[k], list) else r[k] for k in FIELDS})
    return json_path, csv_path


if __name__ == "__main__":
    rows = [flatten(e) for e in fetch_stars(USER)]
    rows.sort(key=lambda r: (r["starred_at"] or ""), reverse=True)
    paths = write(rows, USER)
    print(f"{len(rows)} starred repos for {USER} ->")
    for p in paths:
        print("  " + p)
