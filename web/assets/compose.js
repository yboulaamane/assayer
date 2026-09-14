// Composing a plan for one request, instead of printing a template.
//
// Three things drive it: the method families a request rules out, the assets it
// already has, and what each module needs before it can run. The curated order
// inside a recipe is kept — that sequence is judgement — but modules are
// dropped, skipped and borrowed from other recipes as the request requires.

import { MODULES, RECIPES, FAMILY_TERMS } from "./modules.js";

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

const methods = (m) => [m.family, ...(m.methods || [])];
const forbidden = (m, brief) => methods(m).some((f) => brief.excluded.includes(f));
const compatible = (m, intent) => RECIPES[intent]?.modules.includes(m.id) || m.borrowFor?.includes(intent);
const inputs = (brief) => new Set([...expand(brief.assets)].filter((a) => !brief.missing.includes(a)));
function outputs(available, m, brief) {
  for (const cap of expand(m.produces)) if (!brief.missing.includes(cap)) available.add(cap);
}

/**
 * Compose a plan.
 *
 * Returns every decision, not just the surviving steps: what was dropped and
 * why, what is still unmet, what was borrowed from another recipe. A planner
 * that silently omits a step is worse than one that prints too many.
 */
export function compose(brief) {
  brief = { excluded: [], assets: [], missing: [], offTargets: [], ...brief };
  let intent = brief.intent, rerouted = null;

  // Structure-based discovery without a structure, or with docking ruled out,
  // is not a shorter version of itself. It is a different route.
  if (intent === "hit-discovery" &&
      (brief.excluded.includes("docking") || brief.missing.includes("receptor_structure"))) {
    rerouted = {
      from: intent, to: "ligand-discovery",
      because: brief.missing.includes("receptor_structure")
        ? "you said there is no usable structure"
        : "you excluded docking",
    };
    intent = "ligand-discovery";
  }

  brief = { ...brief, intent, excluded: brief.excluded || [], assets: brief.assets || [],
    missing: brief.missing || [], offTargets: brief.offTargets || [] };
  const recipe = RECIPES[intent];
  if (!recipe) return { ok: false, error: `no recipe for ${intent}` };

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

  const ids = brief.offTargets.length
    ? ["selectivity.define_panel", ...recipe.modules, "selectivity.compare_panel"] : recipe.modules;
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
          compatible(c, intent) && c.produces.includes(need));
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
  const viable = steps.length > 0 && !unmet.length && !errors.length;

  return {
    ok: !errors.length, errors, viable, id: intent, intent, rerouted, brief,
    label: recipe.label, summary: recipe.summary,
    decision: recipe.decision, stop: recipe.stop,
    steps, dropped, borrowed,
    unmet,
  };
}

/** Structural checks a model's choices would have to pass too. */
export function validate(plan) {
  const issues = [];
  const brief = { assets: [], missing: [], excluded: [], offTargets: [], ...plan.brief };
  const available = inputs(brief);
  const seen = new Set();
  for (const s of plan.steps || []) {
    const m = MODULES[s.id];
    if (!m) { issues.push(`unknown module: ${s.id}`); continue; }
    if (seen.has(s.id)) issues.push(`module appears twice: ${s.id}`);
    if (forbidden(m, brief)) issues.push(`excluded method in ${s.id}`);
    const panel = brief.offTargets.length && ["selectivity.define_panel", "selectivity.compare_panel"].includes(s.id);
    if (plan.intent && !compatible(m, plan.intent) && !panel) issues.push(`incompatible module: ${s.id}`);
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
