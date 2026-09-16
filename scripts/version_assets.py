#!/usr/bin/env python3
"""Stamp every asset URL with a hash of its contents.

The assets have fixed names — /assets/app.js, never /assets/app.8f3a2c.js — so a
browser holding an old copy has no way to know the file changed. Revalidation
headers are supposed to cover that and in practice do not reliably: a user gets
a stale bundle, sees a broken page, and has no idea why. This project has been
caught by it more than once.

So each import carries `?v=<hash>`. The URL changes exactly when the content
changes, which is the property content-hashed filenames give you, without a
bundler or a dist/ directory. The files keep their names, so `python3 -m
http.server --directory web` still works untouched.

Hashes propagate in dependency order: a change in modules.js changes the hash in
workflow.js's import, which changes workflow.js's own content, which changes the
hash app.js imports it by. Editing a leaf therefore busts the whole chain, which
is the point.

Idempotent: existing `?v=` stamps are stripped before hashing, so the hash is
always of the source rather than of the last stamped version.

  python3 scripts/version_assets.py          # stamp
  python3 scripts/version_assets.py --check  # fail if stamps are stale (for CI)
"""

import argparse
import hashlib
import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB = os.path.join(ROOT, "web")
ASSETS = os.path.join(WEB, "assets")

IMPORT = re.compile(r'(from\s+")(\./)([\w-]+\.js)(\?v=[0-9a-f]+)?(")')
HTML_REF = re.compile(r'((?:src|href)=")(assets/[\w-]+\.(?:js|css))(\?v=[0-9a-f]+)?(")')


def digest(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:10]


def strip(text):
    """Remove existing stamps so a hash is always of the source."""
    return IMPORT.sub(lambda m: f"{m.group(1)}{m.group(2)}{m.group(3)}{m.group(5)}", text)


def graph():
    """Every asset module, with the modules it imports."""
    deps = {}
    for name in sorted(os.listdir(ASSETS)):
        if not name.endswith(".js"):
            continue
        source = strip(open(os.path.join(ASSETS, name), encoding="utf-8").read())
        deps[name] = sorted({m.group(3) for m in IMPORT.finditer(source)})
    return deps


def ordered(deps):
    """Leaves first, so a module is stamped only once its imports are final."""
    done, out = set(), []
    while len(out) < len(deps):
        progressed = False
        for name, needs in deps.items():
            if name in done:
                continue
            if all(d in done or d not in deps for d in needs):
                out.append(name)
                done.add(name)
                progressed = True
        if not progressed:
            raise SystemExit(f"import cycle among: {sorted(set(deps) - done)}")
    return out


def stamp(check_only=False):
    deps = graph()
    hashes, written = {}, []

    for name in ordered(deps):
        path = os.path.join(ASSETS, name)
        original = open(path, encoding="utf-8").read()
        source = strip(original)
        # Point each import at the version of the file we just fixed.
        stamped = IMPORT.sub(
            lambda m: f"{m.group(1)}{m.group(2)}{m.group(3)}"
                      f"{'?v=' + hashes[m.group(3)] if m.group(3) in hashes else ''}{m.group(5)}",
            source)
        hashes[name] = digest(stamped)
        if stamped != original:
            written.append(name)
            if not check_only:
                open(path, "w", encoding="utf-8").write(stamped)

    # CSS has no imports of its own; hash it directly.
    css = os.path.join(ASSETS, "styles.css")
    if os.path.exists(css):
        hashes["styles.css"] = digest(open(css, encoding="utf-8").read())

    for page in ("index.html", "artifact.html"):
        path = os.path.join(WEB, page)
        if not os.path.exists(path):
            continue
        original = open(path, encoding="utf-8").read()
        updated = HTML_REF.sub(
            lambda m: f"{m.group(1)}{m.group(2)}"
                      f"{'?v=' + hashes[os.path.basename(m.group(2))] if os.path.basename(m.group(2)) in hashes else ''}{m.group(4)}",
            original)
        if updated != original:
            written.append(page)
            if not check_only:
                open(path, "w", encoding="utf-8").write(updated)

    return hashes, written


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check", action="store_true",
                    help="exit 1 if any stamp is out of date, without writing")
    args = ap.parse_args()

    hashes, written = stamp(check_only=args.check)
    for name, h in sorted(hashes.items()):
        print(f"  {name:<16} {h}")
    if args.check:
        if written:
            print(f"\nstale: {', '.join(written)}")
            print("run python3 scripts/version_assets.py")
            return 1
        print("\nevery asset URL matches its contents.")
        return 0
    print(f"\nstamped {len(written)} file(s)" if written else "\nalready up to date")
    return 0


if __name__ == "__main__":
    sys.exit(main())
