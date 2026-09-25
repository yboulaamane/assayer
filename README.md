# Assayer
<img width="1546" height="982" alt="assayer" src="https://github.com/user-attachments/assets/89d7ff51-4aac-40fe-aea4-95a20f081ea4" />

A catalogue of medicinal and computational chemistry tools (<!--n:curated-->300<!--/n--> chosen and
written up by hand, <!--n:tools-->2,384<!--/n--> listed in all), plus <!--n:protocols-->28<!--/n--> protocols that lay out how to
actually run a piece of work.

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

<!--block:stages-->
| Stage | Curated | Listed | | Stage | Curated | Listed |
|---|--:|--:|---|---|--:|--:|
| Docking & virtual screening | 28 | 576 | | Quantum chemistry | 12 | 88 |
| ADMET, PK & toxicity | 11 | 324 | | Protein structures | 19 | 67 |
| Cheminformatics | 19 | 250 | | Target & druggability | 40 | 62 |
| Dynamics & free energy | 32 | 195 | | Workflow & infrastructure | 8 | 56 |
| Binding sites & pockets | 18 | 166 | | Peptides & protein design | 16 | 51 |
| Generative & de novo design | 11 | 157 | | Clinical & competitive | 10 | 34 |
| Compounds & bioactivity | 21 | 111 | | Synthesis & retrosynthesis | 22 | 28 |
| QSAR & property models | 17 | 105 | | Benchmarks & datasets | 7 | 14 |
| Visualisation | 9 | 100 | | | | |

300 of the 2,384 entries were chosen and written up by hand; the rest are listed from public registries and marked as such on every card. 190 carry a verified `pip` or `conda` command and 118 a Python version the authors declared. 34 have a hand-written example and 31 quote one from the project's own README. No example is generated.
<!--/block:stages-->

## Where the data comes from

| Source | Rows | Licence |
|---|--:|---|
| [bio.tools](https://bio.tools), <!--n:biotools_topics-->10<!--/n--> drug-discovery EDAM topics | <!--n:biotools_rows-->2,746<!--/n--> | CC BY 4.0 |
| GitHub repos with 30+ stars across <!--n:github_topics-->23<!--/n--> topics | <!--n:github_rows-->713<!--/n--> | public metadata |
| Written for this project | <!--n:curated_rows-->300<!--/n--> | ours |
| My own starred repos, filtered | <!--n:stars_rows-->130<!--/n--> | ours |

Both topic lists are deliberately narrow: **medicinal and computational chemistry
for drug design, and nothing else.** They used to reach into structural biology,
bioinformatics and imaging, and the catalogue paid for it — bio.tools' "Biophysics"
and "Structural biology" topics alone contributed 346 rows that turned out to be
cone-beam CT backprojection, MRI browsers and image-registration toolboxes. Real
software, correctly labelled, and nothing to do with designing a drug.

bio.tools gives breadth within that scope. The GitHub layer answers a question
registries can't: is anyone still maintaining this. The <!--n:curated-->300<!--/n--> curated
entries cover what a project actually runs on, which both other sources are
patchy about.

<!--n:multi_source-->328<!--/n--> of <!--n:index_rows-->3,889<!--/n--> rows appear in more than one source. They get merged into one
entry that remembers where it came from.

### What gets thrown away, and why

bio.tools labels a tool by **method** and says nothing about **purpose**. That is
right for a registry and wrong for this catalogue: "Molecular dynamics" is a
structural-biology topic, so scraping it brings in all of structural biology — a
microbial community simulator, a flow-cytometry utility, an embryo morphodynamics
browser, all correctly labelled and none of them drug discovery.

Measured share of scraped rows per stage whose name, description and tags never
once mention this field:

| Swamped | | Tight | |
|---|--:|---|--:|
| Protein structures | 86% | ADMET, PK & toxicity | 0% |
| Dynamics & free energy | 83% | Docking & virtual screening | 3% |
| Quantum chemistry | 82% | Generative & de novo design | 4% |
| Binding sites & pockets | 69% | Compounds & bioactivity | 5% |
| Peptides & protein design | 63% | Target & druggability | 8% |

Nobody docks for a reason unrelated to drug discovery, so those stages need no
gate. The five on the left do. `excluded_because()` in `scripts/build_catalog.py`
drops <!--n:excluded-->1,144<!--/n--> rows, in this order: no description, a paper's code drop,
courseware, a list of other people's work, and — only in the five stages where the
topic cannot carry the purpose — anything that never mentions the field.

Two things rescue a row from that last rule. A tool the protocols recommend is
exempt, and so is one with **100+ GitHub stars whose own words are recognisably
this kind of science** — traction in an adjacent field is better evidence than a
keyword, and it is what keeps LAMMPS, OpenFold, deepmd-kit and SchNetPack. It
exempts a row from the relevance rule only, never from the checks above, so no
number of stars can turn a reading list into a tool: `cs-video-courses` arrived
here with 83,480 of them.

Known residue: two entries in the registry layer survive on stars and topic tags
that the repository does not really earn — NVIDIA's `DeepLearningExamples` and
Folding@home's `coronavirus`. Both would need a rule written around one
repository, which is how a classifier rots, so they stay and are named here
instead.

Two things it must never drop, both enforced in `tests/catalog.test.mjs`:

- **anything curated.** A person judged it; that is the whole point of the layer.
- **anything a protocol recommends.** A plan that names a tool the catalogue has
  dropped renders a dead chip and tells you to use something this site refuses to
  describe. The gate reads the tool names out of `modules.js` and exempts them.

Every exclusion is written to `data/excluded.json` with the reason. A good tool
caught by the gate is a tool to curate by hand, not a reason to widen the rule.

### Two layers, said out loud

The catalogue is <!--n:curated-->300<!--/n--> entries someone chose and wrote up, and <!--n:listed-->2,084<!--/n--> that arrived
from a registry and were only filtered. Those are different promises, so the site
does not render them identically: browsing opens on the curated layer, the wider
one is one click away and says on the page that nobody here has read it.

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
choosing one of <!--n:protocols-->28<!--/n--> pre-written documents and composing from <!--n:modules-->178<!--/n--> parts.

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

**Thresholds carry their source.** A gate that states a number is an assertion
about the field, and ten of them do. Each is either cited to the work it comes
from — the 2 Å redocking criterion, BEDROC's α=20, the ~1 kcal/mol RBFE
expectation, pLDDT's confidence bands, replicates, R-free — or says in its own
text that it is a working default rather than a published threshold. The
citations render under the gate and travel into the Markdown export, so a plan
someone acts on carries the reference with it.

`node scripts/check_refs.mjs` re-verifies every DOI against Crossref and
compares the author, year, volume and pages. It checks that a reference is real
and correctly transcribed; it cannot check that the work supports the threshold
it is attached to, which needs a reader. A test enforces the rule that a numeric
gate either cites something or admits it has no source.

`evals/` is the evaluation set: <!--n:eval_cases-->56<!--/n--> fixtures that say what a correct
plan must *do* — which protocol, which constraints it must extract, which steps
it cannot omit, what must precede what — rather than which exact steps it must
contain, so it survives registry changes. `node evals/run.mjs` scores it and
`tests/evals.test.mjs` fails if the score drops below `evals/baseline.json`.

The score is currently <!--n:eval_passed-->256<!--/n-->/<!--n:eval_checks-->256<!--/n--> expectations, and **<!--n:eval_reviewed-->0<!--/n--> of <!--n:eval_cases-->56<!--/n--> cases are
domain-reviewed**: the expectations are mine, not verified science. A case
becomes evidence when someone who does this work has agreed that a plan failing
it would be wrong. `evals/README.md` explains how to review one.

`tests/coverage-sweep.test.mjs` is combinatorial rather than example-based: every
metal in the periodic table across every task that mentions one, several
phrasings for each of the <!--n:protocols-->28<!--/n--> protocols, and a set of phrases that must never
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

<!--n:protocols-->28<!--/n--> of them, <!--n:modules-->178<!--/n--> modules. Each protocol says what decision it supports and when to
walk away. Each step says what to do, why, which tools, and the gate it has to
pass. <!--n:pitfalls-->133<!--/n--> steps also name the specific way that step usually goes wrong.

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
goes in every selection prompt, which is about 5,800 tokens for all <!--n:modules-->178<!--/n--> modules.
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
python3 scripts/enrich_packages.py         # resolves pip/conda names + Python version
python3 scripts/fetch_quickstarts.py       # quotes each README's first real example
python3 scripts/build_index.py             # -> data/tools_index.json
python3 scripts/build_catalog.py           # -> web/catalog.json
```

Stdlib Python 3 only, nothing to install. Raw API responses are cached under
`data/.cache/`; delete a file to force a refresh. `web/catalog.json` is
generated, so don't edit it by hand.

## What a tool's panel shows

Install, and where the data allows it, a Python version and a usage example.

`scripts/enrich_packages.py` only accepts a package whose metadata points back
at the same GitHub repository, so "boltz" cannot resolve to an unrelated
package of the same name. That strictness is why coverage is what it is: **<!--n:packages-->190<!--/n-->
of <!--n:tools-->2,384<!--/n-->** tools have a verified package, **<!--n:python-->118<!--/n-->** carry the Python version the
authors declared in `requires_python`. Everything else with a repository gets a
`git clone` and an honest note that there is no published package; the <!--n:no_install-->1,144<!--/n-->
web servers, databases and commercial tools get nothing, because there is nothing
to install.

Usage examples come in two kinds and are never generated. A **snippet** is
hand-written for this catalogue (<!--n:snippets-->34<!--/n--> tools). A **quickstart** is the first real
Python block from the project's own README, quoted unedited and shown with a
link to the file it came from (<!--n:quickstarts-->31<!--/n--> tools). Writing usage prose for three
thousand tools nobody here has run would be fabrication at scale, which is the
thing the rest of this project exists to avoid — so the site says plainly that a
quoted example is how the authors introduce the tool, not how to use it for any
particular task.

A test enforces it: a quoted example must carry a resolvable source URL, a
declared Python version must look like a version specifier, and no tool may
show both kinds at once.

## Cache busting

Assets keep fixed names — `/assets/app.js`, never `/assets/app.8f3a2c.js` — so a
browser holding an old copy has no way to know the file changed. Revalidation
headers are meant to cover that and in practice did not: a stale bundle reached
a user, the page looked broken, and nothing said why.

So every asset URL now carries a hash of its contents, stamped by
`scripts/version_assets.py` and re-run automatically by `build_artifact.py`:

```html
<script type="module" src="assets/app.js?v=34c00c0bce"></script>
```

Hashes propagate in dependency order. A one-line change to `modules.js` changes
the hash `workflow.js` imports it by, which changes `workflow.js`, which changes
the hash in `app.js`, which changes the URL in the page. Editing any leaf busts
the whole chain, which is the property that makes this work.

The headers then say what is now true: the HTML must always be revalidated,
because it carries the stamps, and the assets are `immutable` for a year,
because a hashed URL can never mean two different things.

Two consequences worth knowing. Node treats `./modules.js` and
`./modules.js?v=abc` as different modules, so a test that needs the same
instance the app holds has to import through the same specifier — `tests/planner.test.mjs`
reads it out of the source rather than hard-coding a hash. And a test enforces
that no import or page reference is left unstamped, because an unstamped URL is
one that cannot change when its contents do.

## Automation

Two scheduled workflows, neither of which can change the site on its own.

**`.github/workflows/link-check.yml`** — weekly. Runs `scripts/check_links.py`
over every curated URL and asks GitHub whether each repository still exists and
is still maintained. It edits nothing; findings go into a single issue that gets
updated rather than a new issue every Monday. Failures are checked twice, because
one slow response is not evidence a resource is gone, and a `404` is reported
differently from "unreachable from the runner", which can just mean geo-blocking
or a certificate the client rejects.

**`.github/workflows/refresh-catalogue.yml`** — monthly. Re-scrapes bio.tools and
the GitHub layers, rebuilds, runs the tests, the evaluation set and the citation
check, then opens a **pull request**. Never pushes to main: the classification
rules have misfired before in ways nothing caught until someone looked, and a
catalogue people take scientific advice from should not absorb that
automatically. The curated entries are not touched — those are the judgement.

`web/catalog.json` is over a megabyte on one line, so its git diff is one insertion
and one deletion. `scripts/catalog_diff.py` turns a rebuild into something
reviewable — what was added, what was removed, what changed stage, what changed
licence — and that summary is the body of the pull request. A stage disappearing
is treated as a bug rather than a data change and says so in the PR.

The figures quoted in this README are written by the build, not by hand. Each one
sits inside an HTML comment marker that GitHub does not render, and
`scripts/readme_counts.py` fills them from the data at the end of every
`build_catalog.py` run, so a refresh that moves the counts carries the README with
it. The marker syntax is documented at the top of that script. To quote a new
figure, add it to `figures()` there and to `truth()` in `tests/readme.test.mjs`,
which recomputes every figure independently and fails on any that disagree. A
typo'd key or a marker broken across a line stops the build rather than freezing
a number. Figures that record history rather than state ("346 rows turned out
to be CT scanners") are prose on purpose.

Both use first-party actions only. A scheduled job with write access is a
supply-chain surface, and that is not worth the convenience of a third-party
action here. `GITHUB_TOKEN` is injected by Actions, so there is nothing to
configure; it also raises the scrapers' rate limit, which is most of their
runtime.

Note that GitHub disables scheduled workflows on a repository with no activity
for 60 days. It emails first, but it is a quiet way for this to stop.

## Known limits

- **Stage assignment is keyword-driven.** The <!--n:curated-->300<!--/n--> curated tools carry their
  stage by hand; everything else goes through a category lookup table, then
  keyword scoring, then a short list of last-resort rules for families that
  kept falling through (crystallography, drug repurposing, tautomer handling).
  Nothing is filed under "Unsorted" any more: a row no rule can place is
  dropped by the relevance gate rather than shown under a label that tells the
  reader nothing (see *What gets thrown away, and why*).
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
  <!--n:stars_dropped-->18<!--/n--> are excluded as off-domain (video downloaders, image generators, awesome
  lists). The filter denies the recognisable rather than demanding proof of
  relevance, because several real tools carry no description or topics at all
  and would fail any positive test. Those few are named in `KEEP_ANYWAY`.
- **Some sites block automated requests.** DrugBank, GeneCards, Mcule and a few
  others return 403 to the link checker even from a browser user-agent. They're
  listed as bot-protected so the check doesn't cry wolf every run.

## Licence

Code (`scripts/`, `web/`) is MIT. Data (`data/`, `web/catalog.json`) is CC BY 4.0.

The two typefaces in `web/assets/fonts/` are not ours: Newsreader and Instrument
Sans, both under the SIL Open Font Licence, whose text sits beside them. They are
self-hosted rather than loaded from a font CDN, so that reading the catalogue
sends a request to nobody but the catalogue.

The data is CC BY because bio.tools is, and that requirement carries through to
anything derived from it. If you reuse the catalogue:

> Assayer catalogue (https://github.com/yboulaamane/assayer), CC BY 4.0.
> Contains records from bio.tools, CC BY 4.0.
