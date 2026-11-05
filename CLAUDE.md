# Assayer

A drug-discovery tool catalogue and workflow planner. Live at https://assayer.vercel.app. Vercel deploys every push to `main`.

## Layout

- `web/` is a static site. No framework, no build step. ES modules in `web/assets/` load directly in the browser.
- Catalogue, two layers:
  - Curated (~302 tools): chosen and written by hand in `scripts/curated_standard_tools.py`.
  - Registry (~2,000 tools): scraped from bio.tools and GitHub topics (`scripts/scrape_*.py`), filtered by the relevance gate in `scripts/build_catalog.py`.
- The page loads the catalogue in layers: `web/catalog-core.json`, then `web/catalog-registry.json`, then `web/details/<stage>.json`. `web/catalog.json` is the full reference that scripts and tests read. All are generated; do not hand-edit.
- Workflow planner:
  - `web/assets/modules.js`: protocol registry (`RECIPES`, 29 protocols; `MODULES`, ~184 steps).
  - `web/assets/workflow.js`: routing (`INTENTS` keywords).
  - `web/assets/compose.js`: builds the plan.
  - `web/assets/exports.js`: pure functions for what a plan or card hands back: the environment file (verified conda-forge/PyPI packages only), the draft methods section and its references (bibliographic details fetched from Crossref in the reader's browser), and the maintenance signal on cards.
  - `web/api/` (`route.js`, `plan.js`, `tailor.js`, shared `_llm.js`): model-backed endpoints on free-tier Gemini/Groq keys held in Vercel env vars. The deterministic plan is always the fallback.
- `evals/`: 80 planner cases (`cases.json`), runner `run.mjs`, no-regression guard `baseline.json`.
- `docs/`: protocol coverage audit and planning reviews.

## Commands

```sh
# Export the curated list after editing scripts/curated_standard_tools.py (checks every URL, needs network;
# --no-check skips the checks but blanks every url_status, so do not commit its output as is)
python3 scripts/curated_standard_tools.py

# Rebuild the catalogue (build_catalog also rewrites the split files and README figures via scripts/readme_counts.py)
python3 scripts/build_index.py && python3 scripts/build_catalog.py && python3 scripts/build_artifact.py

node --test tests/*.test.mjs   # 136 tests should pass
node evals/run.mjs             # 80 cases
python3 scripts/version_assets.py   # REQUIRED after editing any file in web/assets/ (content-hashed URLs; a test enforces it)
node scripts/check_refs.mjs    # verifies every DOI against Crossref
```

Network: scrapers and live checks need bio.tools, GitHub, ChEMBL, RCSB and Crossref. If any is blocked in the sandbox, report it to the owner rather than working around it.

## Rules

- Never describe a tool from memory. Read its README or repo first and say only what it says about itself.
- Cite a paper only after checking it on Crossref and confirming the step's text actually makes the paper's claim.
- Numeric thresholds in step gates must cite a source or be labelled a working default (a test enforces this).
- Fix problems broadly, not one example at a time.
- Adding a protocol means all of:
  1. the recipe and steps in `web/assets/modules.js`;
  2. routing keywords in `web/assets/workflow.js` `INTENTS`;
  3. the model's menu entry in `web/api/route.js` `INTENTS` (a test keeps the two in sync);
  4. coverage-sweep phrasings (`tests/coverage-sweep.test.mjs`);
  5. at least two eval cases, then raise `evals/baseline.json`.
- Report honestly. If something can't be verified, say so rather than asserting it. Eval cases are the author's judgement until a domain expert has checked them.
- Never ask the owner to paste API keys or tokens into the chat.
- Nothing merges to `main` without a person reviewing it. No auto-merge.
- Do not use em dashes in writing.

## Automation

- `.github/workflows/link-check.yml` (Mondays): opens, updates and closes a "rot" issue. Cloudflare bot challenges count as protected, not dead.
- `.github/workflows/refresh-catalogue.yml` (monthly, 1st): re-scrapes, rebuilds, tests, opens a PR. Never merges. Includes `scripts/scrape_repo_health.py`, which records each catalogued repo's last push and archive state in `data/repo_health.json` for the card maintenance signal. Until its first run, only repos the topic and star scrapes found have dates.
- `scripts/refresh_gate.py` (merged in PR #5, not yet wired into a workflow): judges whether a refresh PR is safe. Intended use is "one-click": label `safe-to-merge` or `needs-review` with reasoning in the PR body, never auto-merge.

## Known open items (as of 2026-11-05; check GitHub for current state)

- `scripts/refresh_gate.py` is merged but not yet called from `refresh-catalogue.yml`.
- Issue #4 (link rot, 2026-11-02 run): MolSkill archived on 2026-10-21 and now tagged `archived`. Repeated 403s from RosettaCommons, PubMed and DVC are probably bot protection, not yet checked in a browser. Repeated timeouts from the docking.org hosts (ZINC22, DOCK 6, DUD-E) and BATMAN-TCM are unverified. IBM RXN failed DNS lookup once. NAMD, VMD and FoldX have recovered.
- Tool papers (`paper_url`) come only from bio.tools records, merged into curated entries by name or repo, and have never been checked; the methods export labels them so. Some look wrong (ChEMBL's points to 10.1007/s10822-009-9260-9). Checking them needs Crossref, which the sandbox cannot reach.
- The metal-design protocol (metal site and metalloenzyme design) is new and unreviewed. No eval case has been checked by a domain expert.
