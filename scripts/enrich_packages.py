#!/usr/bin/env python3
"""Work out how each tool is actually installed, so the site can show a command.

For every tool worth clicking (curated, or 50+ GitHub stars) this asks PyPI and
conda-forge whether a package of that name exists — and only accepts the match
if the package points back at the same GitHub repository. Without that check,
"hotspots" or "boltz" happily resolve to somebody else's unrelated package and
the site would print a command that installs the wrong thing.

Keyed by GitHub repo, not by catalogue id: ids are derived from names and shift
whenever merging changes, which silently orphans every resolved package. The
repo is the stable identity.

Outputs data/packages.json  { "owner/repo": {"pypi": ..., "conda": ...} }
"""

import json
import os
import re
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from urllib.error import HTTPError, URLError

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
CACHE = os.path.join(DATA, ".cache", "packages.json")
HEADERS = {"User-Agent": "assayer/1.0", "Accept": "application/json"}


def get(url):
    try:
        with urllib.request.urlopen(urllib.request.Request(url, headers=HEADERS), timeout=25) as r:
            return json.load(r)
    except (HTTPError, URLError, OSError, ValueError):
        return None


def candidates(tool):
    out = []
    if tool.get("repo"):
        out.append(tool["repo"].split("/")[1])
    name = re.sub(r"[^a-z0-9]+", "-", (tool.get("name") or "").lower()).strip("-")
    out += [name, name.replace("-", "_"), name.replace("-", "")]
    seen, uniq = set(), []
    for c in out:
        if c and len(c) > 2 and c not in seen:
            seen.add(c)
            uniq.append(c)
    return uniq[:4]


def pypi_match(name, repo):
    d = get(f"https://pypi.org/pypi/{name}/json")
    if not d:
        return None
    info = d.get("info") or {}
    blob = " ".join(str(v) for v in (info.get("project_urls") or {}).values())
    blob += " " + str(info.get("home_page") or "") + " " + str(info.get("package_url") or "")
    # Only trust it when the package points back at the same repository.
    if repo and repo.lower() in blob.lower():
        return {"name": info.get("name") or name, "summary": (info.get("summary") or "")[:120]}
    return None


def conda_match(name, repo):
    d = get(f"https://api.anaconda.org/package/conda-forge/{name}")
    if not d:
        return None
    blob = " ".join(str(d.get(k) or "") for k in ("dev_url", "source_git_url", "html_url", "home"))
    if repo and repo.lower() in blob.lower():
        return {"name": d.get("name") or name}
    return None


def resolve(tool):
    repo = tool.get("repo")
    if not repo:
        return tool["id"], None
    found = {}
    for c in candidates(tool):
        if "pypi" not in found:
            m = pypi_match(c, repo)
            if m:
                found["pypi"] = m["name"]
        if "conda" not in found:
            m = conda_match(c, repo)
            if m:
                found["conda"] = m["name"]
        if len(found) == 2:
            break
    return repo, (found or None)


def main():
    tools = json.load(open(os.path.join(ROOT, "web", "catalog.json")))["tools"]
    worth = [t for t in tools if (t.get("curated") or (t.get("stars") or 0) >= 50) and t.get("repo")]
    cached = json.load(open(CACHE)) if os.path.exists(CACHE) else {}
    todo = [t for t in worth if t["repo"] not in cached]
    print(f"{len(worth)} tools worth resolving, {len(todo)} not yet cached", flush=True)

    done = 0
    with ThreadPoolExecutor(max_workers=8) as ex:
        for repo, found in ex.map(resolve, todo):
            cached[repo] = found
            done += 1
            if done % 100 == 0:
                print(f"  {done}/{len(todo)}", flush=True)
                json.dump(cached, open(CACHE, "w"))

    os.makedirs(os.path.dirname(CACHE), exist_ok=True)
    json.dump(cached, open(CACHE, "w"))
    hits = {k: v for k, v in cached.items() if v}
    json.dump(hits, open(os.path.join(DATA, "packages.json"), "w"), indent=2)
    print(f"\n{len(hits)} tools have a verified package "
          f"({sum(1 for v in hits.values() if v.get('pypi'))} pypi, "
          f"{sum(1 for v in hits.values() if v.get('conda'))} conda-forge)")


if __name__ == "__main__":
    main()
