#!/usr/bin/env python3
"""Record when each catalogued GitHub repository was last pushed, and whether
it is archived.

The topic and star scrapes already record this for the repositories they find,
but most curated tools come from neither, so their cards had nothing to say
about maintenance. This asks GitHub once per repository in the catalogue.

    GITHUB_TOKEN=... python3 scripts/scrape_repo_health.py

Outputs data/repo_health.json:
    {"fetched": "YYYY-MM-DD",
     "repos": {"owner/repo": {"pushed_at": "YYYY-MM-DD", "archived": false}}}

A repository GitHub cannot find is recorded as {"missing": true}. Without a
token the 60-requests-an-hour limit cannot cover the catalogue, so the script
refuses to start rather than writing a partial file that looks complete.
"""
import datetime
import json
import os
import sys
import time
import urllib.error
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
API = "https://api.github.com/repos/"
HEADERS = {"Accept": "application/vnd.github+json", "User-Agent": "assayer-repo-health/1.0"}


def repos_in_index():
    rows = json.load(open(os.path.join(DATA, "tools_index.json")))
    return sorted({r["repo"].lower() for r in rows if r.get("repo")})


def fetch(repo):
    req = urllib.request.Request(API + repo, headers=HEADERS)
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                d = json.load(r)
            return {"pushed_at": (d.get("pushed_at") or "")[:10] or None,
                    "archived": bool(d.get("archived"))}
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return {"missing": True}
            if e.code in (403, 429):        # rate limit: wait for the window
                reset = int(e.headers.get("x-ratelimit-reset") or 0)
                time.sleep(max(5, min(900, reset - int(time.time()) + 2)))
                continue
            if attempt == 2:
                return None
        except (urllib.error.URLError, TimeoutError):
            if attempt == 2:
                return None
        time.sleep(2 ** attempt)
    return None


def main():
    token = os.environ.get("GITHUB_TOKEN")
    if not token:
        sys.exit("GITHUB_TOKEN is not set; the unauthenticated limit cannot cover the catalogue.")
    HEADERS["Authorization"] = "Bearer " + token

    repos = repos_in_index()
    out, failed = {}, []
    for i, repo in enumerate(repos, 1):
        state = fetch(repo)
        if state is None:
            failed.append(repo)
        else:
            out[repo] = state
        if i % 200 == 0:
            print(f"  {i}/{len(repos)}", flush=True)
        time.sleep(0.05)

    # Keep last month's answer for anything that failed this time, rather than
    # letting a network hiccup erase what we knew.
    path = os.path.join(DATA, "repo_health.json")
    if os.path.exists(path):
        previous = json.load(open(path)).get("repos") or {}
        for repo in failed:
            if repo in previous:
                out[repo] = previous[repo]

    json.dump({"fetched": datetime.date.today().isoformat(), "repos": dict(sorted(out.items()))},
              open(path, "w"), indent=1)
    archived = sum(1 for v in out.values() if v.get("archived"))
    missing = sum(1 for v in out.values() if v.get("missing"))
    print(f"{len(out)} of {len(repos)} repositories recorded "
          f"({archived} archived, {missing} missing, {len(failed)} failed) -> {path}")


if __name__ == "__main__":
    main()
