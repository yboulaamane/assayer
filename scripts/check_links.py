#!/usr/bin/env python3
"""Check the curated catalogue for rot: dead links, archived and deleted repos.

Reads what has already been built rather than rebuilding it, so this is safe to
run on a schedule: it changes nothing and can only report.

  python3 scripts/check_links.py                 # human-readable
  python3 scripts/check_links.py --markdown      # for a GitHub issue body
  python3 scripts/check_links.py --json out.json # machine-readable

Exit code is 1 when something needs attention, which is what makes it usable as
a scheduled check. Sites behind a WAF answer 403 to any automated request; those
are listed separately rather than counted as broken, because crying wolf every
week is how a scheduled check gets ignored.
"""

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urlparse

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

from curated_standard_tools import BOT_PROTECTED, check  # noqa: E402

DATA = os.path.join(ROOT, "data", "curated_standard_tools.json")
UA = {"User-Agent": "assayer-link-check/1.0 (https://assayer.vercel.app)"}


def repo_state(repo):
    """Is this GitHub repository still there, and is it archived?"""
    req = urllib.request.Request(f"https://api.github.com/repos/{repo}", headers=dict(UA))
    token = os.environ.get("GITHUB_TOKEN")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req, timeout=25) as r:
            d = json.load(r)
        if d.get("archived"):
            return "archived"
        # A repository that has not been touched in years is not broken, but it
        # is the signal the GitHub layer exists to carry.
        return "ok"
    except urllib.error.HTTPError as e:
        return "gone" if e.code == 404 else f"http {e.code}"
    except Exception as e:
        return f"error: {type(e).__name__}"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--markdown", action="store_true", help="format for a GitHub issue")
    ap.add_argument("--json", metavar="PATH", help="also write the findings as JSON")
    args = ap.parse_args()

    rows = json.load(open(DATA))
    urls = [r for r in rows if r.get("url")]
    repos = sorted({r["repo"] for r in rows if r.get("repo")})

    with ThreadPoolExecutor(max_workers=8) as ex:
        statuses = list(ex.map(lambda r: check(r["url"]), urls))

    # Anything that failed gets a second look. A scheduled job that reports a
    # transient timeout is a scheduled job whose notifications get muted, and
    # one slow response is not evidence a resource is gone.
    retry = [i for i, st in enumerate(statuses) if st != 200]
    if retry:
        time.sleep(5)
        with ThreadPoolExecutor(max_workers=4) as ex:
            second = list(ex.map(lambda i: check(urls[i]["url"]), retry))
        for i, st in zip(retry, second):
            statuses[i] = st
    with ThreadPoolExecutor(max_workers=6) as ex:
        states = dict(zip(repos, ex.map(repo_state, repos)))

    dead, blocked = [], []
    for row, status in zip(urls, statuses):
        if status == 200:
            continue
        host = urlparse(row["url"]).hostname or ""
        (blocked if status == 403 and host in BOT_PROTECTED else dead).append(
            {"name": row["name"], "url": row["url"], "status": str(status)})

    # A curated entry tagged "archived" has been looked at and its description
    # says so. Reporting it every week is how a scheduled check gets muted, so
    # those are listed as acknowledged. Only a repository archived since the
    # last look is a finding.
    acknowledged_repos = {r["repo"] for r in rows
                          if r.get("repo") and "archived" in (r.get("tags") or [])}
    archived_all = [{"name": r["name"], "repo": r["repo"]} for r in rows
                    if r.get("repo") and states.get(r["repo"]) == "archived"]
    archived = [x for x in archived_all if x["repo"] not in acknowledged_repos]
    acknowledged = [x for x in archived_all if x["repo"] in acknowledged_repos]
    # The reverse is also worth knowing: tagged archived, but live again.
    revived = [{"name": r["name"], "repo": r["repo"]} for r in rows
               if r.get("repo") in acknowledged_repos and states.get(r["repo"]) == "ok"]
    vanished = [{"name": r["name"], "repo": r["repo"]} for r in rows
                if r.get("repo") and states.get(r["repo"]) == "gone"]
    # De-duplicate: several curated entries can share one repository.
    archived = list({x["repo"]: x for x in archived}.values())
    acknowledged = list({x["repo"]: x for x in acknowledged}.values())
    revived = list({x["repo"]: x for x in revived}.values())
    vanished = list({x["repo"]: x for x in vanished}.values())

    findings = {"checked_urls": len(urls), "checked_repos": len(repos),
                "dead": dead, "archived": archived, "vanished": vanished,
                "acknowledged_archived": acknowledged, "revived": revived,
                "bot_protected": blocked}
    if args.json:
        json.dump(findings, open(args.json, "w"), indent=2)

    problems = len(dead) + len(archived) + len(vanished) + len(revived)
    if args.markdown:
        print(f"Checked **{len(urls)} curated URLs** and **{len(repos)} repositories**.\n")
        if not problems:
            print("Everything resolves. No action needed.")
        for title, items, fmt in [
            ("Unreachable", dead, lambda x: f"- [ ] **{x['name']}** — `{x['status']}` — {x['url']}"),
            ("Repositories now archived", archived, lambda x: f"- [ ] **{x['name']}** — `{x['repo']}`"),
            ("Repositories gone", vanished, lambda x: f"- [ ] **{x['name']}** — `{x['repo']}`"),
            ("Tagged archived, but live again", revived,
             lambda x: f"- [ ] **{x['name']}** — `{x['repo']}` — remove the tag and the note"),
        ]:
            if items:
                print(f"\n### {title} ({len(items)})\n")
                for x in items:
                    print(fmt(x))
        if acknowledged:
            print(f"\n<details><summary>{len(acknowledged)} archived and already flagged "
                  f"(expected, not new)</summary>\n")
            for x in acknowledged:
                print(f"- {x['name']} — `{x['repo']}`")
            print("\n</details>")
        if blocked:
            print(f"\n<details><summary>{len(blocked)} behind bot protection "
                  f"(expected, not broken)</summary>\n")
            for x in blocked:
                print(f"- {x['name']} — {x['url']}")
            print("\n</details>")
        print("\n---\nEach failure was checked twice. A `404` is gone; an `error:` is only "
              "*unreachable from the runner*, which can mean geo-blocking, a certificate the "
              "client rejects, or a slow host. Open it yourself before removing an entry.\n")
        print("Archived is not the same as broken: plenty of good tools are finished. "
              "It is a prompt to check whether the description still reads as current.")
    else:
        print(f"{len(urls)} URLs, {len(repos)} repositories checked")
        print(f"  unreachable     {len(dead)}  (checked twice)")
        print(f"  archived repos  {len(archived)} new, {len(acknowledged)} already flagged")
        print(f"  revived         {len(revived)}")
        print(f"  vanished repos  {len(vanished)}")
        print(f"  bot-protected   {len(blocked)} (expected)")
        for x in dead:
            print(f"    DEAD     {x['status']:<22} {x['name']}  {x['url']}")
        for x in archived:
            print(f"    ARCHIVED {x['repo']:<22} {x['name']}")
        for x in vanished:
            print(f"    GONE     {x['repo']:<22} {x['name']}")

    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
