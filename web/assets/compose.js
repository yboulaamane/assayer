// Composing a plan for one request, instead of printing a template.
//
// Three things drive it: the method families a request rules out, the assets it
// already has, and what each module needs before it can run. The curated order
// inside a recipe is kept — that sequence is judgement — but modules are
// dropped, skipped and borrowed from other recipes as the request requires.

import { MODULES, RECIPES, FAMILY_TERMS } from "./modules.js?v=4e59b677ca";

/** Phrases people use for an asset, mapped to the capability it satisfies. */
const ASSET_TERMS = [
  [/trajector/i, "trajectory"],
  [/(measured|assayed|known)\s+(compounds?|analogues?|data)|measured sar|assay data/i, "measured_data"],
  [/\bhits?\b/i, "hit_list"],
  [/co-?crystal|crystal structure|experimental structure|\bpdb\b/i, "receptor_structure"],
  [/analogues?|congeneric series|my series/i, "candidate_molecules"],
  [/variants?|mutations?/i, "variant_list"],
  [/topology/i, "matching_topology"],
  [/known actives?/i, "known_actives"],
];

function capabilities(phrase) {
  const out = ASSET_TERMS.filter(([re]) => re.test(phrase)).map(([, cap]) => cap);
  if (/\bstructures?\b/i.test(phrase)) out.push("receptor_structure");
  if (/\b(?:measured )?data\b/i.test(phrase)) out.push("measured_data");
  return [...new Set(out)];
}

/** Turn a routed question plus its stated constraints into a structured brief. */
export function buildBrief(parsed) {
  const said = (parsed.constraints || []);
  const excluded = new Set();
  for (const c of said.filter((c) => c.kind === "excluded method")) {
    for (const [family, terms] of Object.entries(FAMILY_TERMS)) {
      if (terms.some((t) => new RegExp(`\\b${t}\\b`, "i").test(c.phrase))) excluded.add(family);
    }
  }
  const assets = new Set();
  for (const c of said.filter((c) => c.kind === "existing asset")) {
    capabilities(c.phrase).forEach((cap) => assets.add(cap));
  }
  // "no usable structure" is the absence of an asset, which changes the route
  // rather than merely trimming it.
  const missing = new Set(said.some((c) => c.kind === "no structure") ? ["receptor_structure"] : []);
  for (const c of said.filter((c) => c.kind === "missing asset")) {
    capabilities(c.phrase).forEach((cap) => missing.add(cap));
  }
  for (const cap of missing) assets.delete(cap);

  return {
    question: parsed.query,
    intent: parsed.intent,
    target: parsed.target || null,
    organism: parsed.organism || null,
    excluded: [...excluded],
    assets: [...assets],
    missing: [...missing],
    offTargets: said.filter((c) => c.kind === "off-target").map((c) => c.phrase),
    metal: said.filter((c) => c.kind === "metal site").map((c) => c.phrase),
    compute: said.filter((c) => c.kind === "compute limit").map((c) => c.phrase),
    time: said.filter((c) => c.kind === "time limit").map((c) => c.phrase),
    stated: said,
    degraded: Boolean(parsed.degraded),
    truncated: Boolean(parsed.truncated),
  };
}

// Only include implications that do not invent files or evidence. A trajectory
// does not prove its topology is available; measurements need not contain actives.
const IMPLIES = {
  confirmed_hits: ["hit_list"],
  hit_list: ["candidate_molecules"],
  triaged_hits: ["hit_list"],
  ranked_candidates: ["candidate_molecules"],
  receptor_ensemble: ["receptor_structure"],
  comparable_dataset: ["measured_data"],
};

function expand(assets) {
  const out = new Set(assets);
  for (let grew = true; grew; ) {
    grew = false;
    for (const a of [...out]) for (const i of IMPLIES[a] || []) if (!out.has(i)) { out.add(i); grew = true; }
  }
  return out;
}

// A metal centre is not a protocol of its own; it is a complication inside
// whichever protocol was routed. These go where the coordination problem
// actually bites: before the structure is used, before anything is simulated,
// and alongside the scoring that a metal breaks.
const METAL_SETUP = ["metal.characterise_the_metal_centre", "metal.prepare_the_coordination_sphere"];
const STRUCTURAL = ["docking", "md", "fep"];
const familyAt = (list, families) => list.findIndex((id) => families.includes(MODULES[id]?.family));

function withMetalSite(ids, brief) {
  if (!brief.metal?.length) return ids;

  // A route that only picks a structure still has to check the metal in it —
  // that is part of judging the structure — but it has nothing to protonate
  // for, nothing to score and nothing to simulate.
  if (familyAt(ids, STRUCTURAL) < 0) {
    const structural = familyAt(ids, ["structure"]);
    if (structural < 0) return ids;
    const only = [...ids];
    only.splice(structural + 1, 0, "metal.characterise_the_metal_centre");
    return only;
  }

  const out = [...ids];
  out.splice(familyAt(out, STRUCTURAL), 0, ...METAL_SETUP);

  const simulation = familyAt(out, ["md", "fep"]);
  if (simulation >= 0) out.splice(simulation, 0, "metal.parameterise_the_centre");

  // Scoring belongs with the setup it corrects, not after the screen it should
  // have informed, so it follows whichever step prepares the ligands.
  const prepared = out.findIndex((id) => MODULES[id]?.produces.includes("prepared_ligands"));
  const firstDock = familyAt(out, ["docking"]);
  const at = prepared >= 0 ? prepared + 1 : firstDock;
  if (at >= 0) out.splice(at, 0, "metal.score_the_coordination");

  // Only where compounds are actually being chosen. Simulating a zinc finger
  // does not involve a metal-binding warhead, so the liability step would be
  // padding there.
  if (familyAt(out, ["docking", "generative"]) >= 0) out.push("metal.check_the_binding_group");
  return out;
}

const methods = (m) => [m.family, ...(m.methods || [])];
const forbidden = (m, brief) => methods(m).some((f) => brief.excluded.includes(f));
const compatible = (m, intent) => RECIPES[intent]?.modules.includes(m.id) || m.borrowFor?.includes(intent);
const injected = (m, brief) => m.family === "metal" && Boolean(brief.metal?.length);
const inputs = (brief) => new Set([...expand(brief.assets)].filter((a) => !brief.missing.includes(a)));
function outputs(available, m, brief) {
  for (const cap of expand(m.produces)) if (!brief.missing.includes(cap)) available.add(cap);
}

/** Normalise a brief so every list field exists before anything reads it. */
const settle = (brief) => ({
  excluded: [], assets: [], missing: [], offTargets: [], metal: [], ...brief,
});

/**
 * Turn an ordered list of module ids into steps.
 *
 * Shared by the curated route and the model-selected one, so a plan the model
 * chose passes through exactly the same exclusions, asset reuse and dependency
 * resolution as a plan the recipe chose. `open` widens only which modules may
 * be pulled in to satisfy a prerequisite: a selected plan is allowed to draw on
 * the whole registry, because choosing across protocols is the point of it.
 */
function assemble(brief, intent, ids, { open = false } = {}) {
  // What the user brought, not what earlier steps in this plan will produce.
  // Skipping a step because a previous step covers it is how a plan loses the
  // step that was supposed to do the work.
  const supplied = inputs(brief), available = new Set(supplied);
  const steps = [], dropped = [], borrowed = [], errors = [];
  const chosen = [];
  const drop = (m, reason) => {
    if (!dropped.some((d) => d.id === m.id)) dropped.push({ id: m.id, title: m.title, reason });
  };
  const eligible = (m) => !forbidden(m, brief) &&
    !m.produces.some((p) => brief.missing.includes(p)) &&
    !m.skipWith?.some((p) => supplied.has(p));

  for (const id of ids) {
    const m = MODULES[id];
    if (!m) { errors.push(`unknown module: ${id}`); continue; }

    if (forbidden(m, brief)) {
      drop(m, `you excluded ${methods(m).filter((f) => brief.excluded.includes(f)).join(", ")}`);
      continue;
    }
    if (m.produces.some((p) => brief.missing.includes(p))) {
      drop(m, "its required output was stated to be unavailable; resolve that prerequisite first");
      continue;
    }
    if (m.skipWith?.some((p) => supplied.has(p))) {
      drop(m, "start from the work you already supplied");
      continue;
    }
    // Already have what this produces: skip it, but say so rather than leaving
    // a gap the reader has to notice.
    if (!m.alwaysInclude && m.produces.length && m.produces.every((p) => supplied.has(p))) {
      drop(m, `you already have ${m.produces.join(", ")}`);
      continue;
    }
    if (!chosen.includes(id)) chosen.push(id);
  }

  // Resolve dependencies recursively before appending a step. Only the current
  // recipe and explicitly approved cross-recipe providers may supply an input.
  const visited = new Set(), visiting = new Set();
  const add = (id, forStep = null, capability = null) => {
    if (visited.has(id)) return;
    if (visiting.has(id)) { errors.push(`dependency cycle at ${id}`); return; }
    const m = MODULES[id];
    visiting.add(id);
    const dependencies = [];
    for (const need of m.requires) {
      if (available.has(need) || brief.missing.includes(need)) continue;
      const prior = steps.find((s) => expand(s.produces).has(need));
      if (prior) { dependencies.push(prior.id); continue; }
      const candidate = [...chosen.map((k) => MODULES[k]), ...Object.values(MODULES)]
        .find((c) => c.id !== id && !visited.has(c.id) && eligible(c) &&
          (open || compatible(c, intent) || injected(c, brief)) && c.produces.includes(need));
      if (candidate) {
        add(candidate.id, id, need);
        dependencies.push(candidate.id);
      }
    }
    const s = { ...m, dependencies: [...new Set(dependencies)],
      unmet: m.requires.filter((need) => !available.has(need)), borrowed: !chosen.includes(id) };
    if (id === "network.define_scope" && brief.question) {
      s.context = `Study request: ${brief.question}`;
    }
    if (s.borrowed) borrowed.push({ id, title: m.title, for: forStep, capability });
    if (m.family === "metal") {
      s.context = `Added because the question mentions ${brief.metal.join(", ")}. `
        + "If there is no metal in the site you care about, these steps do not apply.";
    }
    if (id === "selectivity.define_panel" || id === "selectivity.compare_panel") {
      s.context = `Primary target: ${brief.target || "not specified"}. Must spare: ${brief.offTargets.join(", ")}.`;
    }
    steps.push(s);
    // A blocked step's outputs are conditional, not evidence that downstream
    // work can proceed. Propagate the missing inputs instead of hiding them.
    if (!s.unmet.length) outputs(available, s, brief);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of chosen) add(id);
  const unmet = steps.flatMap((s) => s.unmet.map((capability) => ({ id: s.id, capability })));

  return { steps, dropped, borrowed, errors, unmet, chosen };
}

/** Re-route where the stated constraints make the route itself wrong. */
function reroute(brief) {
  // Structure-based discovery without a structure, or with docking ruled out,
  // is not a shorter version of itself. It is a different route.
  if (brief.intent === "hit-discovery" &&
      (brief.excluded.includes("docking") || brief.missing.includes("receptor_structure"))) {
    return {
      from: brief.intent, to: "ligand-discovery",
      because: brief.missing.includes("receptor_structure")
        ? "you said there is no usable structure"
        : "you excluded docking",
    };
  }
  return null;
}

/**
 * Compose a plan.
 *
 * Returns every decision, not just the surviving steps: what was dropped and
 * why, what is still unmet, what was borrowed from another recipe. A planner
 * that silently omits a step is worse than one that prints too many.
 */
export function compose(brief) {
  brief = settle(brief);
  const rerouted = reroute(brief);
  const intent = rerouted ? rerouted.to : brief.intent;

  brief = { ...brief, intent };
  const recipe = RECIPES[intent];
  if (!recipe) return { ok: false, error: `no recipe for ${intent}` };

  const ids = withMetalSite(brief.offTargets.length
    ? ["selectivity.define_panel", ...recipe.modules, "selectivity.compare_panel"] : recipe.modules, brief);
  const built = assemble(brief, intent, ids);
  const viable = built.steps.length > 0 && !built.unmet.length && !built.errors.length;

  return {
    ok: !built.errors.length, errors: built.errors, viable, id: intent, intent, rerouted, brief,
    label: recipe.label, summary: recipe.summary,
    decision: recipe.decision, stop: recipe.stop,
    steps: built.steps, dropped: built.dropped, borrowed: built.borrowed,
    unmet: built.unmet,
  };
}

// Steps a plan may not quietly lose. A model asked for "the smallest sufficient
// set" will cheerfully drop the control that proves the work means anything,
// because a plan without it looks leaner and reads fine. These are the checks
// whose absence would make the rest of the plan unfalsifiable, so they are put
// back whenever the work that needs them is present. They only ever add.
const NON_NEGOTIABLE = [
  { trigger: ["docking.screen_the_library"], anyOf: ["docking.redock_the_native_ligand"],
    because: "a screen is only worth as much as a setup proven to recover a known pose" },
  { trigger: ["docking.screen_the_library"], anyOf: ["docking.run_the_enrichment_control"],
    because: "without an enrichment control the ranking has no measured skill" },
  { trigger: ["qsar.only_then_reach_for", "qsar.establish_the_baseline_first"],
    anyOf: ["qsar.split_the_way_you"],
    because: "a model split at random reports its own leakage as accuracy" },
  { trigger: ["qsar.only_then_reach_for", "qsar.establish_the_baseline_first"],
    anyOf: ["qsar.check_the_applicability_domain"],
    because: "a prediction from outside the applicability domain is not a prediction" },
  { trigger: ["md.run_production_as_independent", "md.equilibrate_then_run_replicates"],
    anyOf: ["md.prove_it_converged", "md.check_convergence_not_wall"],
    because: "an unconverged trajectory cannot support the conclusion drawn from it" },
  { trigger: ["docking.rank_with_free_energy", "fep.estimate_the_effect_on"],
    anyOf: ["generative.validate_retrospectively_before_predicting"],
    because: "free energy predictions are believed only after a retrospective check" },
];

/** Put back any control the selection dropped out from under its own work. */
function reinstate(ids, brief) {
  const out = [...ids];
  const reinstated = [];
  for (const rule of NON_NEGOTIABLE) {
    const at = out.findIndex((id) => rule.trigger.includes(id));
    if (at < 0 || rule.anyOf.some((id) => out.includes(id))) continue;
    const pick = rule.anyOf.find((id) => MODULES[id] && !forbidden(MODULES[id], brief));
    // Excluded on purpose is a decision; the drop is then recorded as the
    // user's, which is not the same as the model forgetting it.
    if (!pick) continue;
    out.splice(at, 0, pick);
    reinstated.push({ id: pick, title: MODULES[pick].title, because: rule.because });
  }
  return { ids: out, reinstated };
}

const MAX_SELECTED = 24;

/**
 * Build a plan from modules a model chose, rather than from a fixed recipe.
 *
 * The model picks ids; everything else is enforced here. Unknown ids are
 * discarded, excluded methods are dropped exactly as in the curated path,
 * dropped controls are put back, and the result has to survive validate()
 * before the caller will show it. On anything that smells like a confused
 * response, return ok:false and let the caller fall back to the curated plan.
 */
export function composeFromSelection(brief, selection) {
  brief = settle(brief);
  const rerouted = reroute(brief);
  const intent = rerouted ? rerouted.to : brief.intent;
  brief = { ...brief, intent };
  const recipe = RECIPES[intent];
  if (!recipe) return { ok: false, error: `no recipe for ${intent}` };

  const proposed = Array.isArray(selection?.modules) ? selection.modules : [];
  if (!proposed.length) return { ok: false, error: "no modules selected" };

  const rejected = [], wanted = [];
  for (const entry of proposed.slice(0, MAX_SELECTED)) {
    const id = typeof entry === "string" ? entry : entry?.id;
    if (typeof id !== "string" || !MODULES[id]) { rejected.push(String(id)); continue; }
    if (!wanted.some((w) => w.id === id)) {
      wanted.push({ id, why: typeof entry?.why === "string" ? entry.why.slice(0, 300) : null });
    }
  }
  // A response mostly made of ids that do not exist is not a selection worth
  // repairing. Fall back rather than show whatever survived the filter.
  if (!wanted.length || rejected.length > wanted.length) {
    return { ok: false, error: `selection named ${rejected.length} unknown modules` };
  }

  // Injected modules keep the position the injector chose, not the one the
  // model put them in. Knowing what you must spare shapes the library and the
  // enrichment set, so the panel belongs at the front whatever order the
  // selection came back in; the metal steps belong where the coordination
  // problem bites. The model chooses *which* modules, not where these go.
  const INJECTED = (id) => id.startsWith("metal.") ||
    ["selectivity.define_panel", "selectivity.compare_panel"].includes(id);
  const asked = wanted.map((w) => w.id).filter((id) => !INJECTED(id));
  const positioned = withMetalSite(brief.offTargets.length
    ? ["selectivity.define_panel", ...asked, "selectivity.compare_panel"] : asked, brief);

  const { ids, reinstated } = reinstate(positioned, brief);
  const built = assemble(brief, intent, ids, { open: true });
  if (!built.steps.length) return { ok: false, error: "selection left no steps" };

  const why = new Map(wanted.map((w) => [w.id, w.why]));
  for (const step of built.steps) {
    const note = why.get(step.id);
    if (note && !step.context) step.context = note;
    const put = reinstated.find((r) => r.id === step.id);
    if (put) step.context = `Kept in because ${put.because}.`;
    step.chosen = why.has(step.id);
  }

  const viable = built.steps.length > 0 && !built.unmet.length && !built.errors.length;
  return {
    ok: !built.errors.length, errors: built.errors, viable, id: intent, intent, rerouted, brief,
    label: recipe.label, summary: recipe.summary,
    decision: recipe.decision, stop: recipe.stop,
    steps: built.steps, dropped: built.dropped, borrowed: built.borrowed,
    unmet: built.unmet,
    selected: true, rejected, reinstated,
    understood: typeof selection?.understood === "string" ? selection.understood.slice(0, 400) : null,
    questions: (Array.isArray(selection?.questions) ? selection.questions : [])
      .filter((q) => typeof q === "string").slice(0, 3).map((q) => q.slice(0, 200)),
    assumptions: (Array.isArray(selection?.assumptions) ? selection.assumptions : [])
      .filter((a) => typeof a === "string").slice(0, 4).map((a) => a.slice(0, 200)),
  };
}

/** Structural checks a model's choices would have to pass too. */
export function validate(plan) {
  const issues = [];
  const brief = { assets: [], missing: [], excluded: [], offTargets: [], metal: [], ...plan.brief };
  const available = inputs(brief);
  const seen = new Set();
  for (const s of plan.steps || []) {
    const m = MODULES[s.id];
    if (!m) { issues.push(`unknown module: ${s.id}`); continue; }
    if (seen.has(s.id)) issues.push(`module appears twice: ${s.id}`);
    if (forbidden(m, brief)) issues.push(`excluded method in ${s.id}`);
    const panel = brief.offTargets.length && ["selectivity.define_panel", "selectivity.compare_panel"].includes(s.id);
    // A model-selected plan is allowed to draw modules from any protocol, which
    // is the whole point of letting it choose. Its safety comes from every id
    // resolving, the exclusions holding and the dependency order being checked,
    // all of which still run below.
    if (plan.intent && !plan.selected && !compatible(m, plan.intent) && !panel && !injected(m, brief)) {
      issues.push(`incompatible module: ${s.id}`);
    }
    for (const field of ["requires", "produces", "tools"]) {
      if (JSON.stringify(s[field]) !== JSON.stringify(m[field])) issues.push(`modified ${field} in ${s.id}`);
    }
    for (const dependency of s.dependencies || []) {
      if (!seen.has(dependency)) issues.push(`dependency must precede ${s.id}: ${dependency}`);
    }
    const missing = m.requires.filter((need) => !available.has(need));
    for (const need of missing) {
      if (!s.unmet?.includes(need)) issues.push(`missing prerequisite for ${s.id}: ${need}`);
    }
    for (const need of s.unmet || []) {
      if (!missing.includes(need)) issues.push(`incorrect unmet prerequisite for ${s.id}: ${need}`);
    }
    if (!missing.length) outputs(available, m, brief);
    seen.add(s.id);
  }
  return issues;
}
