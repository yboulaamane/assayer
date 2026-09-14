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
  [/fragment (?:hits|screen)/i, "confirmed_hits"],
  [/known actives?/i, "known_actives"],
];

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
    for (const [re, cap] of ASSET_TERMS) if (re.test(c.phrase)) assets.add(cap);
  }
  // "no usable structure" is the absence of an asset, which changes the route
  // rather than merely trimming it.
  const missing = new Set(said.some((c) => c.kind === "no structure") ? ["receptor_structure"] : []);

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
  };
}

// Having one thing means having what it was made from. A trajectory implies the
// system that produced it; confirmed hits imply the screen that found them.
const IMPLIES = {
  trajectory: ["simulation_system", "prepared_receptor"],
  confirmed_hits: ["hit_list"],
  conformer_ensemble: ["trajectory", "simulation_system"],
  calibrated_model: ["trained_model", "baseline_metrics", "evaluation_split"],
  trained_model: ["evaluation_split", "curated_dataset"],
  ranked_candidates: ["candidate_molecules"],
  receptor_ensemble: ["receptor_structure"],
  comparable_dataset: ["measured_data"],
  measured_data: ["known_actives"],
};

function expand(assets) {
  const out = new Set(assets);
  for (let grew = true; grew; ) {
    grew = false;
    for (const a of [...out]) for (const i of IMPLIES[a] || []) if (!out.has(i)) { out.add(i); grew = true; }
  }
  return out;
}

/** Modules that can supply a capability, cheapest family first. */
function providersOf(capability, excluded) {
  return Object.values(MODULES).filter(
    (m) => m.produces.includes(capability) && !excluded.includes(m.family));
}

/**
 * Compose a plan.
 *
 * Returns every decision, not just the surviving steps: what was dropped and
 * why, what is still unmet, what was borrowed from another recipe. A planner
 * that silently omits a step is worse than one that prints too many.
 */
export function compose(brief) {
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

  const recipe = RECIPES[intent];
  if (!recipe) return { ok: false, error: `no recipe for ${intent}` };

  const excluded = brief.excluded;
  // What the user brought, not what earlier steps in this plan will produce.
  // Skipping a step because a previous step covers it is how a plan loses the
  // step that was supposed to do the work.
  const supplied = expand(brief.assets);
  const steps = [], dropped = [], borrowed = [];

  for (const id of recipe.modules) {
    const m = MODULES[id];
    if (!m) { dropped.push({ id, reason: "unknown module id" }); continue; }

    if (excluded.includes(m.family)) {
      dropped.push({ id, title: m.title, reason: `you excluded ${m.family}` });
      continue;
    }
    // Already have what this produces: skip it, but say so rather than leaving
    // a gap the reader has to notice.
    if (m.produces.length && m.produces.every((p) => supplied.has(p))) {
      dropped.push({ id, title: m.title, reason: `you already have ${m.produces.join(", ")}` });
      continue;
    }
    steps.push({ ...m, unmet: [] });
  }

  // A step whose inputs nothing supplies is a step that cannot run. Look for a
  // module elsewhere in the registry that produces what is missing.
  for (const s of steps) {
    for (const need of s.requires) {
      if (supplied.has(need) || brief.missing.includes(need)) continue;
      const earlier = steps.slice(0, steps.indexOf(s)).some((e) => e.produces.includes(need));
      if (earlier) continue;
      const candidate = providersOf(need, excluded)
        .find((c) => !steps.some((e) => e.id === c.id));
      if (candidate) {
        borrowed.push({ id: candidate.id, title: candidate.title, for: s.id, capability: need });
        steps.splice(steps.indexOf(s), 0, { ...candidate, unmet: [], borrowed: true });
        supplied.add(need);
      } else {
        s.unmet.push(need);
      }
    }
    s.produces.forEach((p) => supplied.add(p));
  }

  // A route can be gutted by its own exclusions. Say so instead of showing the
  // three steps that happen to survive.
  const viable = steps.length >= Math.ceil(recipe.modules.length / 3);

  return {
    ok: true, viable, intent, rerouted,
    label: recipe.label, summary: recipe.summary,
    decision: recipe.decision, stop: recipe.stop,
    steps, dropped, borrowed,
    unmet: steps.flatMap((s) => s.unmet.map((u) => ({ id: s.id, capability: u }))),
  };
}

/** Structural checks a model's choices would have to pass too. */
export function validate(plan) {
  const issues = [];
  const seen = new Set();
  for (const s of plan.steps) {
    if (!MODULES[s.id]) issues.push(`unknown module: ${s.id}`);
    if (seen.has(s.id)) issues.push(`module appears twice: ${s.id}`);
    seen.add(s.id);
  }
  const produced = new Set();
  for (const s of plan.steps) {
    for (const need of s.requires) {
      if (!produced.has(need) && !s.unmet.includes(need)) continue;
    }
    s.produces.forEach((p) => produced.add(p));
  }
  return issues;
}
