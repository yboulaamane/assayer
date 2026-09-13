#!/usr/bin/env python3
"""Assemble web/artifact.html — the same site, packaged for a hosted preview.

Artifacts supply their own <!doctype>/<head>/<body> wrapper and serve supporting
files by relative path, so the preview build is index.html's body content with
the stylesheet inlined. Everything else (the modules, catalog.json) ships
unchanged as supporting files, so there is only ever one copy of the app.
"""

import os
import re

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WEB = os.path.join(ROOT, "web")

html = open(os.path.join(WEB, "index.html")).read()
css = open(os.path.join(WEB, "assets", "styles.css")).read()

body = re.search(r"<body>(.*)</body>", html, re.S).group(1).strip()
title = re.search(r"<title>([^<]+)</title>", html).group(1).split("—")[0].strip()

out = f"""<title>{title}</title>
<style>
{css}
</style>

{body}
"""
path = os.path.join(WEB, "artifact.html")
open(path, "w").write(out)
print(f"wrote {path} ({len(out)/1024:.0f} KB) — publish with assets/*.js + catalog.json")
