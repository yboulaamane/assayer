# Assayer

A catalogue of 3,973 tools for medicinal and computational chemistry, plus 27
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
| Written for this project | 293 | ours |
| My own starred repos, filtered | 130 | ours |

bio.tools gives breadth. I filtered it to the topics a chemist would care about
rather than taking the whole registry, which is mostly sequence analysis. The
GitHub layer answers a question registries can't: is anyone still maintaining
this. The 293 curated entries cover the things a project actually runs on, which
both other sources are patchy about.

336 of 4,382 rows appear in more than one source. They get merged into one entry
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
3. **Compose** — apply exclusions to all methods used by a module, reuse supplied
   assets, and resolve prerequisites recursively. Borrowing is limited to
   explicitly compatible recipes. Named off-targets add panel-definition and
   comparison steps.
4. **Validate** — check canonical module inputs, outputs and tools, exclusions,
   compatibility and dependency order. Missing inputs make the affected work
   conditional; blocked steps cannot supply downstream outputs. Invalid plans
   are stopped before rendering.

Every decision is shown: what was left out and why, what was added, where the
route changed. A planner that silently drops a step is worse than one that
prints too many.

**Two ways a plan gets built.** The curated route above is the floor: always
complete, always valid, and what you get with no key configured. On top of it,
`web/api/plan.js` hands a model the whole registry and asks which modules *this*
request needs, in what order, and why each one. That is the difference between
choosing one of 27 pre-written documents and composing from 173 parts.

The model returns ids and nothing else. It never writes a step, a gate, a
threshold or a tool name — those come from the registry, which lives on the
server and is never supplied by the caller. Then `composeFromSelection()` puts
the selection through exactly the same machinery as the curated path: unknown
ids are discarded, excluded methods dropped, prerequisites resolved, and the
result has to pass `validate()` before the page will show it. If any of that
fails, the curated plan stands. A confused model produces a worse selection,
never an invented protocol.

One thing the model is not allowed to do is drop a control. Asked for "the
smallest sufficient set" it will happily remove the check that makes the rest
falsifiable, because the plan then looks leaner and reads fine. A screen keeps
its redock and enrichment controls, a model keeps its split and applicability
domain, a simulation keeps its convergence check. Those are reinstated whenever
the work that needs them is present, and the page says so.

The lookup now runs **before** the selection rather than after it, so the model
knows whether the target has four hundred experimental structures or none.
An empty structure list is passed as "none found", never as proof none exists.

Because the selection is per-case, the page shows what the model understood,
what it assumed, and up to two questions whose answers would change which
modules apply. All of it travels into the Markdown export.

**Metal centres** are handled the same way. A metalloenzyme is not a separate
kind of project; it is the same project with a coordination problem in the
middle of it. So there is no metal protocol. When the question mentions a metal,
a metalloenzyme family or coordination chemistry, five modules are injected into
whichever protocol was routed, each where it actually bites: characterising and
validating the site before the structure is used, setting the protonation of
the donor residues, scoring coordination as something directional rather than
as an undirected point charge, deriving force field parameters before anything
is simulated, and treating the metal-binding group as a selectivity liability
rather than a potency handle. They obey the same exclusions as every other
module, and each one states what triggered it, so a wrong guess is visible and
correctable. Detection is deliberately narrow: bare two-letter element symbols
collide with ordinary words, so they count only with an oxidation state or
charge, and "calcium channel blocker" is not a coordination question.

Constraints it notices but cannot act on, such as compute and time limits, are
named as not applied rather than quietly ignored. These limits, off-targets and
step prerequisites also appear in the Markdown export. When semantic routing
is unavailable, the page labels the fallback as provisional.

Run the planner regression and rendering checks with Node.js 24 or later:

```bash
node --test tests/*.test.mjs
```

`tests/coverage-sweep.test.mjs` is combinatorial rather than example-based: every
metal in the periodic table across every task that mentions one, several
phrasings for each of the 27 protocols, and a set of phrases that must never
read as coordination chemistry ("the gold standard for docking"). It asserts on
the composed plan rather than the keyword guess, and it fails on a route that is
locked in without a model call rather than on one the model would correct. A new
protocol has to appear in it, so one cannot be added without phrasings that find
it.

Optional browser checks cover mobile and desktop navigation, catalogue recovery,
licence filtering, workflow loading, structure rendering and Markdown export.
With Playwright and Chromium installed, start the local server above, then run
`node tests/browser-smoke.mjs`. External API responses are fixtures in these
checks; they do not use provider quotas. Set `PLAYWRIGHT_MODULE` to an absolute
Playwright module path if it is installed outside the project.

The social sharing image is `web/assets/social-preview.png`. Edit
`scripts/social-preview.html` and run `node scripts/build_social_preview.mjs`
with Playwright to regenerate it. The image and Open Graph metadata ship with
the static site. Feedback links to this repository's GitHub issue form.

The checks use mocked routing responses and DOM stubs; they do not call providers
or verify the live deployment's layout.

## The protocols

18 of them, 117 modules. Each protocol says what decision it supports and when to
walk away. Each step says what to do, why, which tools, and the gate it has to
pass. 35 steps also name the specific way that step usually goes wrong.

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
property-model building, resistance and mutation effects, network pharmacology.

Plant-versus-disease network studies (for example, “network pharmacology study of
aloysia plant vs parkinsons”) start with botanical identity and constituent
provenance, then compound targets, disease evidence, networks, enrichment and a
validation plan. The plant and disease are not sent to a single-protein lookup.
The workflow preserves unknown species and preparation details as decisions to
resolve, and treats network results as hypotheses rather than evidence of efficacy.

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

Keyword matching handles roughly two thirds of questions on its own. For the
rest — vague, oddly phrased, or carrying a constraint that changes the route —
`web/api/route.js` asks a model which protocol applies.

Skipping that call takes more than a high keyword score. A score is confidence
in vocabulary, and vocabulary is not intent: "find me the competitive landscape
for KRAS inhibitors" matched hit-discovery on the word "inhibitors" alone and
was served a docking campaign, while the model, asked the same question,
correctly declined it. So the shortcut now also requires that something matched
names the *operation* being asked for, not only its subject — a verb applied to
the noun, within a couple of words of it. "Find inhibitors of EGFR" asks for
inhibitors; "the landscape for KRAS inhibitors" mentions them.

Scores are also counted per matched span rather than per matched term. Both
"inhibitor" and "inhibitors" were in the list, both cleared the length bonus,
and one noun was therefore worth four points, which was the whole threshold.

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

There are two model endpoints, and both degrade to the curated path alone:

| Endpoint | What the model returns | If it fails |
|---|---|---|
| `POST /api/route` | one protocol id, target, organism | keyword routing |
| `POST /api/plan` | a list of module ids with a reason each | the curated protocol |

Neither writes steps or names tools, so a confused model gives you a wrong
selection rather than an invented tool. An id that is not in the registry is
thrown away by the endpoint and again by the page; neither side trusts the
model. `GET /api/plan` reports how many modules and routes the running
deployment can see, which is the quickest way to tell whether the function
actually deployed.

**Selection costs tokens, and free tiers meter them per minute.** The registry
goes in every selection prompt, which is about 5,400 tokens for all 173 modules.
Gemini's free tier meters requests long before tokens and takes that happily.
Groq's meters 8,000 tokens a minute across prompt *and* completion, so the full
digest buys one call a minute and a rate-limit after it — which is how it
behaved until each provider got a prompt budget. Over its budget, a provider is
sent the routed recipe, its three nearest neighbours and anything feeding them,
plus the metal and selectivity modules when the request calls for them: about
2,000 tokens. That is a smaller menu, not a different one — the rules,
validation and reinstated controls are identical either way.

Modules from a family you excluded are left out of both the registry digest and
the printed example orderings. Naming them in an example puts them back on the
menu however firmly the rules say otherwise.

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

- **Stage assignment is keyword-driven.** The 293 curated tools carry their
  stage by hand; everything else goes through a category lookup table, then
  keyword scoring, then a short list of last-resort rules for families that
  kept falling through (crystallography, drug repurposing, tautomer handling).
  17 tools still land in "Unsorted", under half a percent. Nine of those have
  no description at all, which is the real floor: nothing can be inferred from
  an empty record.
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
