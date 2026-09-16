Protocol coverage audit — 16 September 2026

Assayer catalogues 3,967 tools across 18 stages and plans 19 protocols from 129
modules. Those two sets were built separately and have never been reconciled.
This audit asks which stages a user can actually reach through the planner, and
which realistic questions have nowhere to land.

Prompted by a real report: "i wanna optimize geometry of palladium bound ligand"
returned *"Assayer does not plan this."* The router was correct — there was no
quantum chemistry protocol — but the catalogue held 203 QM tools and every
metal-complex builder needed to do the job. That gap is now filled by
`qm-geometry`. This audit looks for the rest of them before a user does.

**Method.** Each module names tools; each tool resolves to a catalogue stage.
A protocol "reaches" a stage if any of its modules names a tool in it. Separately,
twenty realistic questions were put through the deterministic router to see where
they land and whether the semantic router is even consulted.

**Stage coverage**

| Stage | Tools | Named by a module | Protocols reaching it |
|---|--:|--:|--:|
| Unsorted | 17 | 0 | 0 |
| Workflow & infrastructure | 69 | 2 | 1 |
| Clinical & competitive | 28 | 6 | 2 |
| Visualisation | 107 | 3 | 3 |
| Peptides & protein design | 121 | 11 | 3 |
| Quantum chemistry | 203 | 8 | 4 |
| Synthesis & retrosynthesis | 28 | 18 | 4 |
| QSAR & property models | 111 | 13 | 5 |
| Benchmarks & datasets | 18 | 6 | 6 |
| Generative & de novo design | 177 | 9 | 6 |
| Dynamics & free energy | 831 | 27 | 7 |
| ADMET, PK & toxicity | 334 | 10 | 8 |
| Binding sites & pockets | 475 | 11 | 8 |
| Target & druggability | 60 | 21 | 10 |
| Docking & virtual screening | 535 | 19 | 12 |
| Cheminformatics | 263 | 14 | 13 |
| Compounds & bioactivity | 117 | 13 | 14 |
| Protein structures | 473 | 16 | 14 |

The "named" column is the weaker signal. A stage holding 831 tools does not need
831 of them named; the protocols should name the few a project actually runs on
and let browsing cover the long tail. The count that matters is the right-hand
one, and the questions below.

**Where a realistic question has nowhere to land**

Twenty questions, one or more per stage, through the deterministic router.
Sixteen scored 1 or 0, meaning the keyword router has no opinion and the
semantic router decides. Two were checked live and both answered `unsupported`,
which is the honest outcome and the same one the palladium question got.

| Question | Routes to | Verdict |
|---|---|---|
| engineer this enzyme to be more thermostable | md-stability (s1) | unsupported live |
| improve the solubility of my protein construct | — (s0) | no protocol |
| design a cyclic peptide binder for this surface | — (s0) | no protocol |
| plan a directed evolution campaign | — (s0) | no protocol |
| what is already in the clinic for this target | — (s0) | no protocol |
| is my scaffold covered by an existing patent | — (s1) | no protocol |
| find me the competitive landscape for KRAS inhibitors | hit-discovery (s4) | **wrong, and locked in** |
| work out the mechanism of this reaction | — (s0) | no protocol |
| predict the pKa of my compound | — (s0) | no protocol |
| predict the NMR spectrum of this molecule | — (s0) | no protocol |
| compute the tautomer distribution at pH 7 | — (s0) | no protocol |
| make my docking pipeline reproducible | hit-discovery (s2) | wrong route |
| cluster my library by scaffold | structure (s1) | no protocol |
| standardise and deduplicate these SMILES | — (s0) | no protocol |
| build a focused screening library | hit-discovery (s3) | partial |
| how do I benchmark my scoring function | — (s0) | no protocol |
| solve the structure from my diffraction data | — (s0) | no protocol |
| will this compound be soluble enough to dose | — (s0) | no protocol |

**One behavioural finding, independent of the gaps** — *fixed 16 September 2026, see below*

"Find me the competitive landscape for KRAS inhibitors" scores 4 on keywords —
"find", "inhibitors", "KRAS" — so `resolveQuery()` short-circuits and never asks
the model. The page shows a structure-based hit discovery campaign, confidently.

Asked directly, the semantic router returns `unsupported` for that question. So
the keyword shortcut is overriding a correct refusal with a wrong plan. This is
the failure mode the earlier review named at `workflow.js:215`: a high keyword
score is confidence in vocabulary, not in intent, and a question can score well
on exactly the words that make it *not* the protocol they belong to.

The existing mitigation only covers stated constraints ("no docking" forces a
model call). It does not cover a question whose vocabulary belongs to one
protocol and whose requested outcome belongs to none.

**Gaps worth filling, in order**

1. **Quantum chemistry beyond geometry.** `qm-geometry` covers optimisation and
   frequencies. Reaction mechanism and transition states, pKa and tautomer
   prediction, and predicted spectra are all distinct workflows with tools
   already in the catalogue and no route in. Largest tool stage with the thinnest
   coverage, and adjacent to work already done.

2. **Protein and enzyme engineering.** 121 tools, and only antibody work is
   routed. Thermostability, solubility, expression and activity engineering, and
   directed evolution campaign design are mainstream and entirely absent. Peptide
   design is distinct enough from antibodies to need its own route.

3. **Competitive and IP landscape.** 28 tools, no protocol, and the one question
   in this area is currently answered with a wrong plan rather than a refusal.
   "What exists for this target already" is a real first step in a project and
   the catalogue has the sources for it.

4. **Library design and compound curation.** Building a focused or diverse
   library, standardising and deduplicating structures, and scaffold analysis are
   currently folded into hit discovery, where they are one step rather than the
   question.

5. **Benchmarking and method validation.** How to test a scoring function, a
   model or a pipeline against a reference set. The benchmarks stage exists and
   is reached only incidentally.

Lower priority, and arguably not protocol-shaped: visualisation and workflow
infrastructure are steps inside other work rather than workflows in their own
right. They would be better served by modules other protocols can borrow —
reproducibility and provenance, for instance — than by routes of their own.

**Recommended before any of that**

Fix the shortcut first. A wrong plan delivered confidently is worse than a
refusal, and adding protocols widens the vocabulary that can trigger one. Two
options, not exclusive: require the semantic router whenever the requested
outcome is not itself matched (not just when a constraint is stated), or treat a
keyword match on a target or compound class as context rather than as evidence
of a workflow, which is already the rule the semantic router is given and the
keyword router is not.

**Checks to add with any new protocol**

- The router's `INTENTS` and `RECIPES` stay identical. Already enforced.
- Each new protocol's characteristic questions route to it, and the protocols it
  is most confusable with keep their own questions. `qm-geometry` versus
  `lead-opt` over the shared "optimi" stem is the worked example.
- Every module names only tools the catalogue holds. Already enforced.
- A question in the new area no longer returns unsupported, and questions outside
  every protocol still do.

---

**Addendum: the shortcut, fixed 16 September 2026**

Three changes, in `web/assets/workflow.js`:

1. *Scores count spans, not terms.* "inhibitors" contains "inhibitor", both were
   in the hit-discovery list, and both cleared the >8-character bonus, so a
   single noun scored four — the entire shortcut threshold on its own. Terms are
   now matched longest-first and nothing inside an already-matched span counts
   again. "Virtual screening" no longer also scores as "screening".

2. *Subject is separated from operation.* Entity nouns — compound classes,
   modalities, variants, disease — are marked context. They still choose an
   intent; they no longer license skipping the model on their own. The exception
   is when one of them is the object of a requested action within a couple of
   words, which is what distinguishes "find inhibitors of EGFR" from "the
   competitive landscape for KRAS inhibitors". This is the rule the semantic
   router was already given and the keyword router was not.

3. *Only route-changing constraints force a model call.* An exclusion, a missing
   asset or a supplied asset can change which modules apply. A compute limit, a
   time limit and a metal note cannot — the first two are reported as not
   applied and the third annotates the plan. Asking the model about those was
   spending quota on questions the keywords had already settled.

Thresholds came down with the deflation, from "score >= 2 with a target, or >= 4
without" to ">= 1 with a target, or >= 3 without". The operational test now does
the work the high threshold was standing in for.

One keyword was removed on the way: `route` matched "plan a route to the train
station", and at the lower threshold that was enough to lock in retrosynthesis.
An existing test caught it, which is the argument for the test.

Measured over 25 genuine requests and 11 out-of-scope ones: **17/25 (68%)** are
still answered without a model call, and **0 of 11** out-of-scope questions are
locked into a protocol. Before the fix, "find me the competitive landscape for
KRAS inhibitors" was served a docking campaign with no model call at all.
