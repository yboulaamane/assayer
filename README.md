# Assayer

An assayer judges whether ore is worth smelting. This one does it for drug-discovery
software: what exists, what each thing is for, and which structure is worth docking into.

A catalogue of 3,973 medicinal- and computational-chemistry tools across 18
pipeline stages, and 14 protocols that turn a research question into a
step-by-step plan — with the gate each step has to pass, the way it usually
goes wrong, and the point at which you should stop.

Everything is plain JSON/CSV under `data/`, and every file is reproducible by
re-running the script that made it (stdlib Python 3 only, no dependencies).
Assayer plans the work; it never runs docking, MD or enrichment for you.

## Sources

Everything that ships is either openly licensed or our own. The selection, the
stage taxonomy and the protocols are ours in every case.

| Source | What it is | Licence | Script |
|---|---|---|---|
| [bio.tools](https://bio.tools) | ELIXIR registry, filtered to 16 drug-discovery EDAM topics | CC-BY 4.0, attributed | `scripts/scrape_biotools.py` |
| GitHub topics | Repos ≥30 stars across 16 relevant topics — the "is it maintained" layer | public metadata (facts) | `scripts/scrape_github_topics.py` |
| Curated standard stack | The tools a discovery project actually runs on, written here | ours | `scripts/curated_standard_tools.py` |
| Own starred repos | The maintainer's own GitHub stars | ours | `scripts/scrape_github_stars.py` |

## Files in `data/`

- `github_stars_yboulaamane.json` / `.csv` — repo metadata: description, homepage,
  language, topics, stars/forks, license, `created_at` / `pushed_at` / `starred_at`.
- `curated_standard_tools.json` / `.csv` — the curated stack, one row per tool:
  `name`, `stage`, `stage_label`, `description`, `url`, `repo`, `access`
  (`open-source` / `free-web` / `academic` / `commercial`), `tags`, `url_status`.
  Every URL is HTTP-checked on each run; the script prints anything that is not 200.
- `tools_index.json` / `.csv` — all four sources merged, one row per tool:
  `source`, `stage`, `name`, `description`, `url`, `code_url`, `paper_url`,
  `categories`, `year`, `license`, `repo`, `also_in`.
- `.cache/` — raw API responses, so re-runs don't re-hit the APIs. Delete a file
  (or the whole directory) to force a refresh.

`repo` is the normalised `owner/name` of the tool's GitHub repo, and `also_in`
lists the other sources that same repo/name shows up in — 318 of 4360 rows overlap
(e.g. `chemprop/chemprop`, `gcorso/diffdock`, `facebookresearch/esm`). 167 of the
253 curated tools are written here rather than taken from any source.

## The curated stack

The scraped sources are strong on new AI models and thin on everything a project
actually runs on. `scripts/curated_standard_tools.py` fills that in, stage by
stage, as plain data you can edit:

| Stage | Count | Examples |
|---|---|---|
| Target identification & validation | 18 | Open Targets, DepMap, Pharos, UniProt, STRING, OmniPath |
| Molecular dynamics & free energy | 21 | GROMACS, AMBER, OpenMM, PLUMED, OpenFE, gmx_MMPBSA, MACE |
| Docking & virtual screening | 18 | smina, Uni-Dock, Vina-GPU, Meeko, Ringtail, PLIP, Glide, GOLD |
| Protein structure & modelling | 13 | RCSB PDB, AlphaFold DB/AF3, Chai-1, MMseqs2, PDBFixer, PROPKA |
| Compound & bioactivity databases | 12 | ChEMBL, PubChem, ZINC22, Enamine REAL, BindingDB, SureChEMBL |
| Omics analysis | 10 | Bioconductor, DESeq2, Seurat, scvi-tools, Salmon, CellProfiler |
| Cheminformatics toolkits | 10 | Open Babel, Datamol, ChEMBL Structure Pipeline, Mordred, CDK |
| QSAR / property ML | 9 | QSARtuna, Uni-Mol, MolSkill, PyG, DGL-LifeSci, Optuna, KNIME |
| ADMET, PK & toxicity | 9 | ADMETlab 3.0, SwissADME, pkCSM, ProTox 3.0, OPERA, PK-Sim, Simcyp |
| Antibodies & protein engineering | 9 | PyRosetta, ANARCI, ImmuneBuilder, AbLang2, SAbDab, OAS, FoldX |
| Clinical, regulatory & literature | 8 | ClinicalTrials.gov, openFDA, Drugs@FDA, DailyMed, Europe PMC |
| Workflow & ML infrastructure | 8 | Nextflow, Snakemake, MLflow, DVC, Ray, Dask, Lightning |
| Quantum chemistry | 7 | Psi4, PySCF, ORCA, xtb, CREST, NWChem, autodE |
| Generative design | 6 | MOSES, GuacaMol, SAFE, Pocket2Mol, DiffLinker, LigandMPNN |
| Retrosynthesis & accessibility | 6 | ASKCOS, Syntheseus, IBM RXN, rdchiral, SCScore, RAscore |
| Benchmarks & reference datasets | 6 | TDC, MoleculeNet, DUD-E, LIT-PCBA, PoseCheck, Polaris |
| Structure & molecule visualisation | 6 | PyMOL, ChimeraX, VMD, Mol*, NGL, py3Dmol |
| Binding site detection | 5 | fpocket, P2Rank, PrankWeb, CASTp, ProteinsPlus |

By access: 108 open-source, 50 free web services, 16 academic-licence,
7 commercial (Glide, GOLD, MOE, FEP+, Simcyp, GastroPlus, Enamine REAL).

## The website

`web/` is Assayer itself: a browsable catalogue of all 3,973 tools plus a consultant
that turns a research question into a step-by-step protocol. It is deliberately
a **static site** — no build step, no framework, no API keys, no server. Three
ES modules, one stylesheet and one JSON file.

- **Browse by stage** — 24 pipeline stages, each with its own line-art icon from
  a single authored set (no icon pack, nothing to 404, no licence to track).
  Hovering a card expands its description; clicking opens a detail drawer with
  links, access terms, tags and which sources listed it.
- **Plan a workflow** — type a question ("find inhibitors of EGFR in human") and
  the page picks the matching protocol, resolves the target against UniProt,
  ranks every linked PDB entry, and lays out the steps with the gate each one
  has to pass. Export as Markdown.
- **It never computes anything.** Docking, cross-docking, enrichment and MD are
  yours to run — the site plans the work and states what each step must prove.

The structure ranking is transparent, not a black box: resolution, R-free,
ligand state (holo with a drug-like ligand beats apo beats cofactor-only),
method and organism match, each contributing a visible reason. For EGFR it
picks 3POZ (1.50 Å, R-free 0.243, holo) out of 385 linked entries.

UniProt, RCSB PDB and AlphaFold DB all send `access-control-allow-origin: *`,
so the browser calls them directly — which is why no backend is needed.

### Run it locally

```bash
python3 -m http.server 8000 --directory web
```

Then open http://localhost:8000.

### Optional: the LLM router

The keyword router answers about 80% of questions on its own and costs nothing.
For the rest — vague or unusually phrased questions — `web/api/route.js` asks a
model to pick the protocol instead. Set these in Vercel's environment variables:

| Variable | Default | Notes |
|---|---|---|
| `LLM_API_KEY` | — | Required to enable it. Without it the endpoint returns 501 and the page uses keywords. |
| `LLM_PROVIDER` | `gemini` | `gemini`, `groq` or `openrouter`. |
| `LLM_MODEL` | per provider | e.g. `gemini-2.5-flash`, `llama-3.3-70b-versatile`. |

Get a Gemini key at [aistudio.google.com](https://aistudio.google.com/apikey) —
free tier, no card. At ~1,500 requests/day and a ~20% call rate, that covers
roughly 7,500 questions a day.

The model's job is deliberately narrow: **pick one of the ten protocols and pull
out the target and organism.** It never writes steps and never names tools —
those come from the curated catalogue — so a confused model produces a wrong
route, not an invented tool. An intent that isn't a real protocol id is rejected
outright.

Every failure path falls back to the keyword router: no key, spent quota, slow
model, unparseable JSON, no function deployed at all. The page never breaks; it
just gets dumber for that one query. That is also why the local server and the
hosted preview still work with no key — there is no `/api` there, so the fetch
fails and the keyword router answers.

The key is only ever read server-side. Never put it in the client bundle.

### Deploy to Vercel

```bash
cd web && vercel deploy --prod
```

Or point Vercel at the repo with `web/` as the root directory and no build
command — `api/route.js` is picked up automatically as an Edge Function — `vercel.json` sets the cache headers and nothing else. Any static host
works the same way (Netlify, Cloudflare Pages, GitHub Pages).

### Rebuilding the catalogue

`web/catalog.json` is generated, never hand-edited:

```bash
python3 scripts/build_catalog.py
```

It maps all 2504 free-text source categories onto the 18 browsable stages, merges
tools that appear in several sources into one entry, and keeps the counts in
`web/index.html` honest.

## Refreshing

```bash
python3 scripts/scrape_biotools.py        # bio.tools, CC-BY 4.0
python3 scripts/scrape_github_topics.py   # GITHUB_TOKEN optional, just faster
python3 scripts/scrape_github_stars.py    # optional: another user as argv[1]
python3 scripts/curated_standard_tools.py # re-checks every curated URL is live
python3 scripts/build_index.py
python3 scripts/build_catalog.py         # regenerates web/catalog.json
```

The Notion scraper reads the public `loadPageChunk` / `queryCollection` endpoints
behind published notion.site pages; the newsletter scraper reads Substack's public
archive/post API; the stars scraper uses the GitHub REST API (set `GITHUB_TOKEN`
to lift the 60 req/hr unauthenticated limit).

## Caveats

- The atlas is the curator's data as-is, including its own duplicates (e.g.
  `chemprop` / `ChemProp`, `DynamicBind` twice) and 13 rows with no link. Nothing
  is deduped inside a source — only flagged across sources via `also_in`.
- Newsletter tools are extracted per heading section. "A Primer on …" issues are
  explainer essays with no tool sections, so they contribute links only; deep-dive
  issues (one company per issue, e.g. Savana, Scigantic) contribute one row taken
  from the issue itself.
- The curated stack is a judgement call about what a general small-molecule
  discovery project needs end to end, not an exhaustive census; add rows to the
  `T` list in `scripts/curated_standard_tools.py` and re-run. Commercial entries
  are included where they are the de facto standard (Glide, GOLD, FEP+, Simcyp).
- `genecards.org` blocks automated requests, so its check can report 403 even
  though the site is fine.
- Stage assignment is keyword-driven: 253 curated tools carry their stage
  by hand, the rest map through an exact category table or fall to keyword
  scoring; a residue ends up in "Everything else". Fix a misplaced tool by adding
  its label to `CATEGORY_MAP` in `scripts/build_catalog.py`.
- The structure ranking scores metadata, not biology. It cannot see whether the
  binding site has missing residues or which conformational state a structure
  is in — the site says so on the page, every time.
- Stars are a personal reading list, not a curated tool list — it includes
  general-purpose repos (`yt-dlp`, `sindresorhus/awesome`) alongside the
  cheminformatics ones.

## Licence

| What | Licence |
|---|---|
| Code — `scripts/`, `web/` | MIT (see [LICENSE](LICENSE)) |
| Data — `data/`, `web/catalog.json` | CC BY 4.0 (see [LICENSE-DATA](LICENSE-DATA)) |

The split is deliberate. Assayer builds on [bio.tools](https://bio.tools), whose
records are CC BY 4.0, so the derived catalogue carries the same attribution
requirement onward — the obligation we inherit is the one we pass on. The code
has no such constraint and is MIT.

Reusing the catalogue? Credit it as:

> Assayer catalogue (https://github.com/yboulaamane/assayer), CC BY 4.0.
> Contains records from bio.tools, CC BY 4.0.
