#!/usr/bin/env python3
"""Take the first real Python example out of each project's own README.

A usage guide written by someone who has not used the tool is fabrication, and
at three thousand tools it would be fabrication at scale — exactly what the rest
of this project is built to avoid. So nothing here is written: each snippet is
*quoted* from the project's README, stored with the URL it came from, and shown
on the site as the authors' words rather than ours.

Fetches raw.githubusercontent.com rather than the API, which keeps it off the
API rate limit entirely.

Outputs data/quickstarts.json  { "owner/repo": {"code": ..., "source": url} }
"""

import json
import os
import re
import sys
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
OUT = os.path.join(DATA, "quickstarts.json")
CACHE = os.path.join(DATA, ".cache", "quickstarts.json")
UA = {"User-Agent": "assayer/1.0 (https://assayer.vercel.app)"}

FENCE = re.compile(r"```(?:python|py|python3)\s*\n(.*?)```", re.S | re.I)
# A block worth showing does something. Imports alone, a bare version print, or
# a shell transcript pasted into a python fence are not a usage example.
USES = re.compile(r"^\s*(?:from|import)\s+\w", re.M)
CALLS = re.compile(r"\w\s*\(")
SHELLISH = re.compile(r"^\s*(?:\$|>>>\s*$|pip |conda |git |cd |apt|sudo)", re.M)


def readme(repo):
    for branch in ("HEAD",):
        for name in ("README.md", "README.rst", "readme.md"):
            url = f"https://raw.githubusercontent.com/{repo}/{branch}/{name}"
            try:
                req = urllib.request.Request(url, headers=dict(UA))
                with urllib.request.urlopen(req, timeout=25) as r:
                    return r.read().decode("utf-8", "replace"), url
            except (urllib.error.HTTPError, urllib.error.URLError, OSError):
                continue
    return None, None


def extract(text):
    """The first fenced Python block that actually demonstrates the library."""
    for match in FENCE.finditer(text):
        code = match.group(1).strip("\n").rstrip()
        lines = [ln for ln in code.split("\n") if ln.strip()]
        if not (2 <= len(lines) <= 22):
            continue
        if SHELLISH.search(code):
            continue
        if not USES.search(code) or not CALLS.search(code):
            continue
        # "import x; print(x.__version__)" passes every structural test and
        # teaches nothing. Require a line that is neither an import, a comment,
        # nor a bare print.
        work = [ln for ln in lines
                if not re.match(r"^\s*(?:from|import)\s", ln)
                and not ln.lstrip().startswith("#")
                and not re.match(r"^\s*print\s*\(", ln)]
        if not work:
            continue
        if len(code) > 900:
            continue
        return code
    return None


def one(repo):
    text, url = readme(repo)
    if not text:
        return repo, None
    code = extract(text)
    return repo, ({"code": code, "source": url} if code else None)


def main():
    tools = json.load(open(os.path.join(ROOT, "web", "catalog.json")))["tools"]
    # Curated tools only. These are the ones someone is most likely to click,
    # and keeping the set small keeps it reviewable by a person.
    repos = sorted({t["repo"] for t in tools if t.get("curated") and t.get("repo")})
    cached = json.load(open(CACHE)) if os.path.exists(CACHE) else {}
    todo = [r for r in repos if r not in cached]
    print(f"{len(repos)} curated repositories, {len(todo)} not yet fetched", flush=True)

    done = 0
    with ThreadPoolExecutor(max_workers=8) as ex:
        for repo, found in ex.map(one, todo):
            cached[repo] = found
            done += 1
            if done % 50 == 0:
                print(f"  {done}/{len(todo)}", flush=True)

    os.makedirs(os.path.dirname(CACHE), exist_ok=True)
    json.dump(cached, open(CACHE, "w"))
    hits = {k: v for k, v in cached.items() if v}
    json.dump(hits, open(OUT, "w"), indent=2)
    print(f"\n{len(hits)} of {len(repos)} repositories have a usable example in their README")
    print("Each is quoted, not written, and carries the URL it came from.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
