// One-off: turn the 16 hand-written protocols into a module registry.
//
// Each step becomes a module with a stable id, a method family (so a request
// can exclude one), and the capabilities it needs and produces (so a step can
// be skipped when the user already has its output, and so an order can be
// derived rather than hardcoded).
//
// The inference below is a first pass. Where it is wrong the module file is
// edited by hand afterwards: that file, not this script, is the source of truth.
import { PROTOCOLS } from "/home/yassir/cdd/sciagent/web/assets/workflow.js";
import fs from "node:fs";

const FAMILY = [
  [/redock|cross-dock|dock|screen the library|virtual screen|pose/i, "docking"],
  [/free energy|alchemical|perturbation|rbfe|fep/i, "fep"],
  [/replicate|production|simulat|molecular dynamics|converg|ensemble|sampling method|trajector/i, "md"],
  [/quantum|dft|semiempirical|parameteris|force field/i, "parameters"],
  [/retrosynth|route|building block|precedent|synthesis|chemist review/i, "synthesis"],
  [/admet|liabilit|toxic|exposure|safety|counter-screen/i, "admet"],
  [/generat|analogue|linker|de novo|design|grow|merge/i, "generative"],
  [/curate|split|baseline|representation|applicability|model/i, "qsar"],
  [/structure|receptor|pdb|crystallograph|density|fold/i, "structure"],
  [/pocket|hot spot|cryptic|site/i, "pocket"],
  [/variant|mutation|resistance/i, "variants"],
  [/target|accession|evidence|tractab|competitive/i, "identity"],
  [/library|fragment/i, "library"],
  [/triage|cluster|filter|prioritis/i, "triage"],
  [/assay|measure|dose-response|confirm/i, "assay"],
];

// capability tokens: what a step needs, and what it leaves behind
const PRODUCES = [
  [/resolve the name|confirm the target|accession/i, ["target_identity"]],
  [/choose the receptor|pick and prepare the structure|anchor on|rank the experimental|which structure/i, ["receptor_structure"]],
  [/prepare the receptor/i, ["prepared_receptor", "prepared_ligands"]],
  [/redock the native/i, ["validated_setup"]],
  [/cross-dock/i, ["receptor_ensemble"]],
  [/enrichment control/i, ["enrichment_metrics"]],
  [/screen the library/i, ["hit_list"]],
  [/triage/i, ["triaged_hits"]],
  [/rescore|simulate the survivors/i, ["rescored_hits"]],
  [/profile before you buy|fast profile|cross-check the liabilities/i, ["admet_profile"]],
  [/map the existing sar/i, ["sar_map"]],
  [/propose analogues|design linkers|vary geometry|generate\b/i, ["candidate_molecules"]],
  [/rank with free energy|validate retrospectively|act on differences/i, ["ranked_candidates"]],
  [/pocket|hot spot|cryptic/i, ["binding_site"]],
  [/build the system|parameteris/i, ["simulation_system"]],
  [/production as independent replicates|equilibrate/i, ["trajectory"]],
  [/prove it converged|analyse what you predefined/i, ["convergence_evidence"]],
  [/extract the ensemble/i, ["conformer_ensemble"]],
  [/curate the data/i, ["curated_dataset"]],
  [/split the way/i, ["evaluation_split"]],
  [/baseline/i, ["baseline_metrics"]],
  [/learned representation/i, ["trained_model"]],
  [/applicability domain/i, ["calibrated_model"]],
  [/generate routes/i, ["synthesis_routes"]],
  [/building blocks/i, ["sourced_blocks"]],
  [/confirm every hit|screen and confirm/i, ["confirmed_hits"]],
  [/find the real binding events|re-solve the structure/i, ["fragment_structures"]],
  [/find the mutations|which mutations/i, ["variant_list"]],
  [/estimate the effect on binding/i, ["variant_effects"]],
  [/model the ternary/i, ["ternary_model"]],
];
const REQUIRES = [
  [/choose the receptor|rank the experimental|pick and prepare/i, ["target_identity"]],
  [/prepare the receptor/i, ["receptor_structure"]],
  [/redock the native/i, ["prepared_receptor", "native_ligand"]],
  [/cross-dock/i, ["validated_setup"]],
  [/enrichment control/i, ["validated_setup", "known_actives"]],
  [/screen the library/i, ["validated_setup"]],
  [/triage/i, ["hit_list"]],
  [/rescore|simulate the survivors/i, ["triaged_hits"]],
  [/profile before you buy/i, ["triaged_hits"]],
  [/rank with free energy/i, ["receptor_structure", "candidate_molecules"]],
  [/propose analogues/i, ["sar_map"]],
  [/build the system/i, ["receptor_structure"]],
  [/production as independent replicates|equilibrate/i, ["simulation_system"]],
  [/prove it converged|analyse what you predefined/i, ["trajectory"]],
  [/extract the ensemble/i, ["convergence_evidence"]],
  [/use the ensemble/i, ["conformer_ensemble"]],
  [/split the way/i, ["curated_dataset"]],
  [/baseline/i, ["evaluation_split"]],
  [/learned representation/i, ["baseline_metrics"]],
  [/generate routes/i, ["candidate_molecules"]],
  [/building blocks/i, ["synthesis_routes"]],
  [/estimate the effect on binding/i, ["variant_list", "receptor_structure"]],
];

const slug = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").split("_").slice(0, 4).join("_");
const first = (rules, text, dflt) => { for (const [re, v] of rules) if (re.test(text)) return v; return dflt; };
const all = (rules, text) => { const out = new Set(); for (const [re, v] of rules) if (re.test(text)) v.forEach((x) => out.add(x)); return [...out]; };

const modules = {};
const recipes = {};
for (const [pid, p] of Object.entries(PROTOCOLS)) {
  recipes[pid] = { label: p.label, summary: p.summary, decision: p.decision, stop: p.stop, modules: [] };
  for (const s of p.steps) {
    const text = `${s.title} ${s.why}`;
    const family = first(FAMILY, text, "general");
    let id = `${family}.${slug(s.title)}`;
    let n = 2; while (modules[id]) id = `${family}.${slug(s.title)}_${n++}`;
    modules[id] = {
      id, family, title: s.title, why: s.why,
      gate: s.gate || null, pitfall: s.pitfall || null,
      tools: s.tools || [], live: s.live || null,
      requires: all(REQUIRES, s.title), produces: all(PRODUCES, s.title),
      from: pid,
    };
    recipes[pid].modules.push(id);
  }
}
fs.writeFileSync("/tmp/modules.json", JSON.stringify({ modules, recipes }, null, 1));
const fams = {}; for (const m of Object.values(modules)) fams[m.family] = (fams[m.family] || 0) + 1;
console.log("  modules:", Object.keys(modules).length, "| families:", Object.keys(fams).length);
console.log(" ", Object.entries(fams).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`${k}:${v}`).join("  "));
console.log("  with requires:", Object.values(modules).filter(m=>m.requires.length).length,
            "| with produces:", Object.values(modules).filter(m=>m.produces.length).length);

// --- emit the registry and the recipes as source ---------------------------
const q = (v) => JSON.stringify(v);
const mod = (m) => `  ${q(m.id)}: {
    family: ${q(m.family)},
    title: ${q(m.title)},
    why: ${q(m.why)},${m.gate ? `\n    gate: ${q(m.gate)},` : ""}${m.pitfall ? `\n    pitfall: ${q(m.pitfall)},` : ""}${m.live ? `\n    live: ${q(m.live)},` : ""}
    requires: ${q(m.requires)},
    produces: ${q(m.produces)},
    tools: ${q(m.tools)},
  },`;

const header = `// The module registry: every planning step Assayer knows, with a stable id.
//
// A module names the method family it belongs to (so a request can exclude it),
// what it needs before it can run, and what it leaves behind. Those three facts
// are what let a plan be composed for a particular request instead of a fixed
// template being printed.
//
// Generated once from the hand-written protocols by scripts/gen_modules.mjs and
// hand-corrected since. This file is the source of truth; do not regenerate it.

export const REGISTRY_VERSION = "1.0.0";

/** Method families a request can exclude, and the words people use for them. */
export const FAMILY_TERMS = {
  docking: ["docking", "dock", "virtual screening", "screening"],
  fep: ["fep", "free energy", "alchemical", "rbfe", "abfe", "perturbation"],
  md: ["md", "molecular dynamics", "simulation", "simulations", "sampling"],
  synthesis: ["synthesis", "retrosynthesis", "route planning"],
  admet: ["admet", "adme", "toxicity prediction"],
  generative: ["generative", "de novo", "molecule generation"],
  qsar: ["qsar", "machine learning", "ml model", "property model"],
  structure: ["crystallography", "structure prediction", "homology modelling"],
  parameters: ["parameterisation", "force field"],
  assay: ["assay", "experiment", "wet lab"],
};

export const MODULES = {
`;

const recipeSrc = Object.entries(recipes).map(([id, r]) => `  ${q(id)}: {
    label: ${q(r.label)},
    summary: ${q(r.summary)},
    decision: ${q(r.decision)},
    stop: ${q(r.stop)},
    modules: [\n${r.modules.map((m) => `      ${q(m)},`).join("\n")}\n    ],
  },`).join("\n");

fs.writeFileSync("/home/yassir/cdd/sciagent/web/assets/modules.js",
  header + Object.values(modules).map(mod).join("\n") + "\n};\n\n" +
  `/** Curated orderings. The sequence is judgement, not something to re-derive. */\nexport const RECIPES = {\n${recipeSrc}\n};\n`);
console.log("  wrote web/assets/modules.js");
