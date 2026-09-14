# Assayer

A catalogue of 3,944 tools for medicinal and computational chemistry, plus 16
protocols that lay out how to actually run a piece of work.

Live at **https://assayer.vercel.app**

The catalogue part is easy to explain: what exists, what each thing is for, and
how to install it. The protocols are the part I care about more. Ask it "find
inhibitors of EGFR in human" and you get the steps in order, which tools to use
at each one, what each step has to prove before you move on, and when to give up.
It resolves the target against UniProt and ranks the available PDB structures
while you watch.

It does not run anything. No docking, no MD, no enrichment. Those stay on your
machine.

## Quick start

```bash
python3 -m http.server 8000 --directory web
```

Open http://localhost:8000. That is the whole thing — the site is static files,
no build step, no framework, no server. UniProt, RCSB and AlphaFold all allow
cross-origin requests, so the browser talks to them directly.

## What's in the catalogue

| Stage | Tools | | Stage | Tools |
|---|--:|---|---|--:|
| Dynamics & free energy | 822 | | QSAR & property models | 97 |
| Docking & virtual screening | 526 | | Compounds & bioactivity | 84 |
| Binding sites & pockets | 471 | | Workflow & infrastructure | 65 |
| Protein structures | 439 | | Target & druggability | 40 |
| ADMET, PK & toxicity | 345 | | Synthesis & retrosynthesis | 28 |
| Cheminformatics | 256 | | Benchmarks & datasets | 18 |
| Quantum chemistry | 203 | | Clinical & competitive | 17 |
| Generative & de novo design | 176 | | Everything else | 158 |
| Peptides & protein design | 120 | | Visualisation | 105 |

238 tools carry a verified `pip` or `conda` command, and 34 of the most-used ones
have a worked example in the detail panel. Those examples are hand-written,
because the first command you need is rarely the one in the README's quick start.

## Where the data comes from

| Source | Rows | Licence |
|---|--:|---|
| [bio.tools](https://bio.tools), 12 drug-discovery EDAM topics | 3,092 | CC BY 4.0 |
| GitHub repos with 30+ stars across 40 topics | 867 | public metadata |
| Written for this project | 243 | ours |
| My own starred repos, filtered | 130 | ours |

bio.tools gives breadth. I filtered it to the topics a chemist would care about
rather than taking the whole registry, which is mostly sequence analysis. The
GitHub layer answers a question registries can't: is anyone still maintaining
this. The 253 curated entries cover the things a project actually runs on, which
both other sources are patchy about.

318 of 4,360 rows appear in more than one source. They get merged into one entry
that remembers where it came from.

## How a plan is built

Protocols are not printed as templates. Each step is a **module** in
`web/assets/modules.js` with a stable id, the method family it belongs to, and
the capabilities it needs and produces. A recipe is an ordered list of module
ids; that order is judgement and is kept.

`web/assets/compose.js` turns a question into a plan:

1. **Brief** — the request is read for excluded methods, assets already in hand,
   missing assets, off-targets, compute and time limits.
2. **Route** — and re-route where the constraints demand it. Structure-based
   discovery with no usable structure is not the same protocol minus a step; it
   becomes the ligand-based route.
3. **Compose** — drop modules whose family you excluded, skip modules whose
   output you already have, borrow a module from another recipe when a step
   needs something nothing supplies.
4. **Validate** — module ids resolve, nothing appears twice, unmet requirements
   are reported rather than hidden.

Every decision is shown: what was left out and why, what was added, where the
route changed. A planner that silently drops a step is worse than one that
prints too many.

Constraints it notices but cannot act on, such as compute and time limits, are
named as not applied rather than quietly ignored.

## The protocols

17 of them, 107 modules. Each protocol says what decision it supports and when to
walk away. Each step says what to do, why, which tools, and the gate it has to
pass. 28 steps also name the specific way that step usually goes wrong.

Some examples of what that looks like in practice:

- Redocking: top pose within 2.0 Å of the crystal pose, or your setup is broken
  and nothing downstream means anything.
- Enrichment: EF1% below about 5 means your ranking is close to noise. Fix the
  setup instead of screening on it.
- FEP: if you can't reproduce measured ΔΔG within ~1 kcal/mol retrospectively,
  don't predict prospectively.
- Conformational sampling: "we ran 1 µs of plain MD" is not a sampling strategy
  for something like CYP3A4.

These are opinions, not facts, and I'd rather argue about them than not. If a
gate is wrong, open an issue.

Covered: hit discovery, ligand-based discovery, lead optimisation, generative design, fragment-based
discovery, selectivity, free energy, degraders, ADMET, conformational sampling,
MD stability, retrosynthesis, target triage, structure selection, antibodies,
property-model building, resistance and mutation effects.

When a question matches none of them, the page says so and lists what it does
cover, rather than presenting the closest guess as an answer.

## Structure ranking

When a question names a protein, the page resolves it against UniProt and scores
every PDB entry linked to it: resolution, R-free, whether there's a drug-like
ligand in the site, method, and whether the organism matches. Each contributes a
visible reason, so you can disagree with the ranking rather than trust it.

For EGFR it picks 3POZ (1.50 Å, R-free 0.243, holo) out of 385 entries.

Two things it can't do: it scores metadata, not biology, so it doesn't know
whether the binding site has missing residues or which conformational state
you're looking at. The page says so under every table. And for a polyprotein
target the structure list mixes domains — ask for SARS-CoV-2 Mpro and you'll see
nsp16 structures in the list too, because UniProt has no standalone Mpro entry.

If the species you asked for isn't the species it found, it says so. That
warning exists because an early version answered a honey bee question with a
human protein and looked confident doing it.

## Optional: LLM routing

Keyword matching handles roughly 80% of questions. For the rest — vague or oddly
phrased ones — `web/api/route.js` asks a model which protocol applies.

Set `LLM_API_KEY` in Vercel's environment variables. A free Gemini key from
[aistudio.google.com](https://aistudio.google.com/apikey) covers it.
`LLM_PROVIDER` (`gemini`, `groq`, `openrouter`) and `LLM_MODEL` are optional
overrides.

Free tiers run out, and they do it silently. Set a second provider and both
endpoints move to it on a quota error instead of dropping to keyword routing
for the rest of the day:

```
LLM_API_KEY_2, LLM_PROVIDER_2, LLM_MODEL_2
```

`LLM_PROVIDER_2` is optional: keys carry a distinguishable prefix (`gsk_` for
Groq, `sk-or-` for OpenRouter, `AIza` for Gemini) so a key on its own is enough.

`GET /api/route` reports which providers the running deployment can see and
whether each half of the configuration resolved. It never echoes a key. Worth
checking after any environment change, because edge functions inline
`process.env` at build time and a cached redeploy keeps the old values.

Two free tiers is usually enough. The per-case brief costs roughly twenty times
what routing does, so it is offered behind a button rather than written for
every plan, and never written for a question that matched nothing.

The model only picks a protocol and pulls out the target and organism. It never
writes steps and never names tools, so a confused model gives you a wrong route
rather than an invented tool. An intent that isn't a real protocol id is thrown
away.

Everything falls back to keywords: no key, spent quota, slow model, unparseable
reply, no function deployed. The page gets dumber for that one question and
carries on. That's also why it works fine locally with no key at all.

The key is read server-side only. Don't put it in the client bundle.

## Deploying

Point Vercel at the repo with `web/` as the root directory and no build command.
`api/route.js` is picked up as an Edge Function automatically. Any static host
works if you don't need the LLM routing.

## Rebuilding

```bash
python3 scripts/scrape_biotools.py         # bio.tools
python3 scripts/scrape_github_topics.py    # GITHUB_TOKEN optional, just faster
python3 scripts/scrape_github_stars.py     # optional: another username as argv[1]
python3 scripts/curated_standard_tools.py  # also HTTP-checks every curated URL
python3 scripts/enrich_packages.py         # resolves pip/conda names
python3 scripts/build_index.py             # -> data/tools_index.json
python3 scripts/build_catalog.py           # -> web/catalog.json
```

Stdlib Python 3 only, nothing to install. Raw API responses are cached under
`data/.cache/`; delete a file to force a refresh. `web/catalog.json` is
generated, so don't edit it by hand.

## Known limits

- **Stage assignment is keyword-driven.** The 243 curated tools carry their
  stage by hand; everything else goes through a category lookup table, then
  keyword scoring, then a short list of last-resort rules for families that
  kept falling through (crystallography, drug repurposing, tautomer handling).
  80 tools still land in "Unsorted", which is roughly 2% and about where the
  returns stop: more rules start mis-filing things that are currently right.
  To fix a misplaced tool, add its label to `CATEGORY_MAP` in
  `scripts/build_catalog.py`.
- **Some bio.tools records are real science from another field.** They arrive
  through broad EDAM topics like "Molecular modelling": genome assemblers,
  phylogenetics, Boolean network biology. Those are dropped when nothing in
  this taxonomy fits them, rather than filed under a label that tells the
  reader nothing.
- **The curated list is a judgement call**, not a census. It's what I think a
  small-molecule project needs end to end. Commercial tools are included where
  they're the de facto standard (Glide, GOLD, FEP+, Simcyp). Add rows to the `T`
  list in `scripts/curated_standard_tools.py`.
- **bio.tools skews classical.** It's thin on recent ML tooling, which lands on
  GitHub long before it reaches any registry. The GitHub and curated layers are
  what fill that gap.
- **My starred repos are a reading list**, so `build_index.py` filters them.
  18 are excluded as off-domain (video downloaders, image generators, awesome
  lists). The filter denies the recognisable rather than demanding proof of
  relevance, because several real tools carry no description or topics at all
  and would fail any positive test. Those few are named in `KEEP_ANYWAY`.
- **Some sites block automated requests.** DrugBank, GeneCards, Mcule and a few
  others return 403 to the link checker even from a browser user-agent. They're
  listed as bot-protected so the check doesn't cry wolf every run.

## Licence

Code (`scripts/`, `web/`) is MIT. Data (`data/`, `web/catalog.json`) is CC BY 4.0.

The data is CC BY because bio.tools is, and that requirement carries through to
anything derived from it. If you reuse the catalogue:

> Assayer catalogue (https://github.com/yboulaamane/assayer), CC BY 4.0.
> Contains records from bio.tools, CC BY 4.0.
