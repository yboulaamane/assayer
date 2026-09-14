Assayer workflow planning review — 14 September 2026

Assayer currently selects a reference protocol. To produce a plan for an individual request, it needs to extract the research context, select applicable steps, and validate the resulting plan against that context. Keep the curated protocols as the foundation; make their applicability explicit.

This review inspected the local source and exercised the JavaScript planner against 12 prompts. Routing API calls were mocked as unavailable to test the deterministic path; several failures bypass that API entirely. A separate mock checked how an explicit null target from the model is handled. The hosted page could not be retrieved through the browsing tool, so this is not a live deployment or visual UI verification. No application behavior was changed.

**What causes the generic results**

- `web/assets/workflow.js:665`: `buildPlan()` returns the selected protocol unchanged. The query is attached as metadata; constraints never determine which steps are included.
- `web/assets/workflow.js:167`: keyword routing uses substring counts. Negation, completed work, and the relationship between objectives are not represented. Overlapping terms such as “inhibitor” and “inhibitors” inflate scores.
- `web/assets/workflow.js:215`: sufficiently high keyword scores skip semantic routing, including for complex requests with explicit exclusions. More detailed prompts can make incorrect keyword routing appear more confident.
- `web/api/route.js:47`: the model can return only one intent, one protein, an organism, and a short reason. It cannot preserve off-targets, mutation roles, input assets, compute limits, forbidden methods, or requested deliverables. The schema has no unsupported or needs-clarification outcome.
- `web/api/tailor.js:17` and `web/assets/app.js:568`: tailoring is an optional prose brief. It cannot change the plan. The tool choices are restricted to those already present in the selected template, so it also cannot repair an unsuitable method selection.
- Both API endpoints silently truncate the question to 300 characters. Constraints near the end of a detailed request can disappear.

**Reproduced behavior**

| Request | Current result | Required behavior |
|---|---|---|
| Find inhibitors of EGFR in human; 500 measured compounds, no usable structure, CPU only, two days, no docking or MD | Exactly the same ten step objects as the unconstrained EGFR request; no routing API call | Preserve every constraint and consider an applicable ligand-based route |
| Analyse my existing EGFR trajectory; do not run docking or virtual screening | Hit discovery; no routing API call | Start with existing trajectory inputs and the requested analysis |
| Find selective EGFR inhibitors that spare ERBB2 | Hit discovery, with only EGFR represented; no routing API call | Preserve EGFR as primary target and ERBB2 as an off-target constraint |
| My fragment screen gave 40 hits, which should I grow? | The fragment template starts with site assessment and library selection | Record the completed screen; verify hit evidence before choosing growth steps |
| I do not want FEP. Improve potency of my EGFR analogues using measured SAR | Lead optimisation still includes free energy ranking; target becomes 3C-like proteinase | Exclude FEP and retain EGFR |
| Find inhibitors of Aurora B in human | AURKA | Match the specific Aurora B alias before the broader Aurora alias |
| Find inhibitors of EGFR in guinea pig | Sus scrofa | Match “guinea pig” before “pig” |
| What is the weather tomorrow? | `matched: false`, but `buildPlan()` still returns a hit-discovery workflow | Show unsupported scope without a recommended scientific plan |

The Mpro error occurs because `aliasTarget(..., true)` finds “mpro” inside “improve”. Boundary-aware matching and longest-phrase priority are necessary for both aliases and organism names. The mocked model test also confirmed that `target: null` is replaced by the keyword target in `resolveQuery()`, so the semantic router cannot explicitly clear a bad guess.

**Recommended planning flow**

Prompt → structured research brief → decision-changing clarifications → relevant evidence lookup → compose curated steps → validate constraints and dependencies → render and export.

1. Extract a structured research brief from the full request. Include objective, desired output, modality, primary targets, off-targets, organism, variants, available assets, completed work, prohibited methods, compute, time, licensing constraints, and unknowns. Preserve supporting prompt spans for extracted facts. Distinguish user statements, retrieved evidence, assumptions, and unknown values.
2. Ask at most one to three questions when the answer changes the route. For an existing trajectory request, the observable and available topology/trajectory matter. For analogue prioritisation, assay comparability and available measurements matter. Do not ask again for information already supplied. A nonblocking unknown can produce a visible conditional branch.
3. Fetch evidence needed for the proposed route. Resolve ambiguous identities before committing to target-specific steps. Store lookup states separately: not requested, pending, succeeded with results, succeeded with no results, and failed. An empty array must not be translated into “no experimental structure exists”.
4. Compose a plan from applicable modules across protocols. A selectivity request may need modules from hit discovery and selectivity; an analysis request may need only trajectory modules. Existing work should become an input with an evidence check, rather than automatically being repeated or automatically trusted.
5. Validate before displaying a recommended plan. Reject unsupported module/tool IDs, missing dependencies, forbidden methods, incompatible compute requirements, and unsupported claims. A model can choose modules and explain their relevance, while code enforces explicit constraints.
6. Render the same validated plan object in the UI and Markdown export. Include assumptions, remaining questions, reasons for method choices, and conditional branches. The current export cannot include the brief because it only receives the original plan and lookup results.

**A practical data model**

Give each curated step a stable ID and structured applicability metadata. For example:

```json
{
  "id": "trajectory.contact_analysis",
  "requires": ["trajectory", "matching_topology", "analysis_observable"],
  "produces": ["contact_summary", "replicate_comparison"],
  "depends_on": ["trajectory.input_qc"],
  "method_family": "trajectory_analysis",
  "tool_ids": [],
  "gate_ref": "trajectory.analysis_qc",
  "on_failure": "review_inputs_or_report_inconclusive"
}
```

This is a proposed schema, not an existing module. Populate tool IDs from the real catalogue. Add factual capability metadata to a small curated tool subset first: supported inputs/outputs, modality, CPU/GPU requirements, licence restrictions, and evidence links. A catalogue stage alone is insufficient to decide whether a tool fits the task. Unknown capabilities should remain unknown.

Each composed step should identify its input, action, output, reason for inclusion, tools, prerequisite steps, gate, and what happens if the gate fails. Prefer one recommended tool with a reason and a small number of relevant alternatives. Gates need applicability and provenance; do not turn template thresholds into universal scientific guarantees.

**Suggested planner instruction**

> Read the complete research brief and provided evidence. Select the smallest sufficient set of modules from the supplied registry that can produce the requested deliverable. Respect explicit exclusions, available assets, completed work, compute, time, and licence constraints. Select modules from multiple protocol families when necessary. Do not invent tools, evidence, or validation thresholds. Ask only questions whose answers change module eligibility or the decision. For every selected module, return its ID, inputs, dependencies, outputs, reason for this case, applicable gate reference, and failure action. Return unresolved prerequisites as questions or conditional branches. Return unsupported when the available registry cannot address the request. Do not convert an unsuccessful lookup into evidence of absence. Return structured data for validation before rendering.

Use separate instruction and user-data fields. Check the output against a server-owned module registry and schema; a prompt restriction alone is not validation. This can start with one semantic planning call and deterministic validation. Additional model review should be justified by evaluation failures.

**Implementation order**

1. Repair immediate correctness issues: boundary-aware and longest-specific alias matching; explicit null handling; unsupported outcomes without fallback steps; visible API failure states; no silent prompt truncation. Treat negated, compound, or conflicting requests as requiring semantic interpretation rather than a high keyword score.
2. Add the research brief and clarification state. Use a multiline input and show an editable “I understood” summary. When semantic planning is unavailable, label the result as a reference template and disclose that constraints have not been fully interpreted.
3. Extract a shared, versioned module registry from the existing protocols. Implement composition for hit discovery, lead optimisation, and existing-trajectory analysis first. Add a ligand-based discovery branch; the current hit-discovery template assumes docking.
4. Add structured tool compatibility and relevant evidence retrieval. Structure selection must consider the requested chain/domain/variant/site and available evidence, beyond entry-level metadata. The current lookup scores at most 60 entries and treats a qualifying ligand anywhere in an entry as evidence for a holo site; neither establishes suitability for the user's target site.
5. Make the personalized plan the primary result, preserve it in export, and add other protocol families after the first routes pass evaluation.

**Acceptance checks**

Start with the reproduced examples and add reviewed fixtures for long prompts, missing inputs, ambiguous entities, multiple targets, unavailable providers, and failed scientific lookups. Run deterministic parser/validator checks separately from provider-backed semantic evaluations.

- “Do not use docking/MD/FEP” excludes those method families from executable steps, even if negated mentions dominate keyword counts.
- Changing only compute, available evidence, completed work, or requested output changes the plan where those facts affect applicability. Cosmetic wording changes preserve the same intended route.
- Every step consumes supplied assets or an earlier output; conditional prerequisites are visible and no graph contains cycles.
- Every selected tool and gate reference resolves to the curated registry; compatibility is checked rather than inferred from a name.
- The EGFR/ERBB2 request retains both entities and their distinct roles; “Improve” never creates an Mpro target; explicit model nulls clear keyword guesses.
- Unsupported questions produce no recommended workflow. Provider or lookup failures produce a visible degraded state, not fabricated scientific conclusions.
- Display and export preserve the same steps, conditions, assumptions, and evidence.
- Domain reviewers assess whether each plan answers its requested scientific decision. Keyword accuracy and fluent prose alone are insufficient measures of correctness.

For the constrained EGFR example, the intended result is a conditional proposal to check the measured data and candidate set, assess assay comparability, establish a suitable ligand-based baseline if the data support one, validate against the intended use, and produce a prioritisation table with uncertainty and a follow-up validation plan. If the data cannot support predictive ranking, the plan should say so and offer a justified exploratory output. This example defines product behavior to review; it does not claim that any particular dataset or method has already been scientifically validated.
