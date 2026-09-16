# Evaluation set

Reviewed fixtures that say what a correct plan has to do, so a change to the
planner can be **scored** rather than argued about.

```bash
node evals/run.mjs              # full report
node evals/run.mjs --failures   # only what failed
node evals/run.mjs --json       # machine-readable
node evals/run.mjs --model      # also exercise the semantic router (uses quota)
```

`tests/evals.test.mjs` runs the deterministic score in CI and fails if it drops
below `baseline.json`. The guard is no-regression, not perfection: a case that
currently fails can be added, which lowers the baseline honestly rather than
hiding the gap.

## What a case asserts

Not "these exact steps". A plan is correct when it does the right things in a
defensible order, and the registry will keep changing, so cases assert on
behaviour:

| Field | Means |
|---|---|
| `route` | the protocol the composed plan must land on |
| `rerouted_from` | it must have started elsewhere and been corrected by a constraint |
| `extract` | constraints the brief must capture from the question |
| `must_include` | modules whose absence would make the plan wrong |
| `must_cover` | groups of alternatives; at least one from each, for claims about the science rather than a module id |
| `must_exclude` / `must_exclude_families` | work that would be wrong here |
| `order` | pairs that must be in that order for scientific reasons |
| `target`, `organism`, `metal` | what must be extracted from the question |
| `viable` | whether the plan must be conditional on something not supplied |
| `unsupported` | no protocol should be offered at all |

Every expectation is scored on its own, so a near miss shows as one failed check
rather than a failed case.

## The two modes, and why they are separate

**Deterministic** (the default) scores routing, extraction, composition and
validation with no model call. It runs on every change, costs nothing, and is
what the CI guard uses.

In this mode an out-of-scope question cannot be *declined* — refusing is the
semantic router's job. So `unsupported` cases are scored on whether the
deterministic layer **defers** instead of locking a protocol in. Deferring to a
model that then declines is correct; answering confidently is the failure.

**`--model`** adds the semantic router and scores the refusals properly. It
spends provider quota and depends on a service being up, so it is a manual run,
not a gate. Fifty-odd calls will exhaust a free tier part way through, so it
paces itself and takes `--only=id,id` to run a handful:

```bash
node evals/run.mjs --model --only=review-weather,refuse-history,refuse-price
```

If the provider does not answer, `resolveQuery` falls back to keyword routing
and returns `degraded`. A score computed from that is a deterministic score
wearing the wrong label, and would report passes the model never earned, so the
runner refuses to print one and exits 3 instead.

## Provenance, and what "reviewed" means

Every case records where it came from and whether a domain reviewer has
confirmed it. Right now:

```
domain-reviewed : 0/53
```

**All expectations are the author's judgement, not verified science.** That is
the honest state and the reason the field exists. A case becomes evidence when
someone who does this work has read what it demands and agreed that a plan
failing it would be wrong.

Reviewing is per case: read `question` and `why`, decide whether the
expectations are what you would actually require of a colleague's plan, adjust
them if not, and set `"reviewed": true`. Disagreeing with an expectation is the
most useful outcome — it means the planner was being held to the wrong standard.

Cases drawn from `docs/workflow-planning-review.md` and from reported failures
carry that in `source`; those are the ones with the strongest claim to being
real requirements rather than invention.

## Known gaps this set does not cover

- **Plan quality beyond structure.** The set checks that the right work is
  present, ordered and validated. It does not judge whether the prose in a
  module is good advice; that needs a reader, not a runner.
- **The model's module selection.** Scoring whether a per-case selection beats
  the curated composition needs repeated provider calls and a way to compare two
  plans that are both valid. Not attempted here.
- **Live lookups.** UniProt and RCSB results change. Cases assert on the target
  symbol, not on which PDB entry ranks first.

## Registry findings surfaced by writing the set

- `qsar.give_every_prediction_an` and `qsar.check_the_applicability_domain` say
  substantially the same thing under different ids, and sit in different
  protocols. `must_cover` works around it; merging them would be better.
