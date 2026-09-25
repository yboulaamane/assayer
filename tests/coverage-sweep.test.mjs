import test from "node:test";
import assert from "node:assert/strict";
import { parseQuery, statedConstraints } from "../web/assets/workflow.js";
import { buildBrief, compose, validate } from "../web/assets/compose.js";
import { RECIPES } from "../web/assets/modules.js";

// Combinatorial coverage, so a gap is found here rather than by someone typing
// a prompt into the live page. The metal list is the periodic table, which does
// not grow; the phrasings are several per protocol, which is what catches a new
// protocol quietly claiming an existing one's questions.

const METALS = ["gold", "silver", "platinum", "palladium", "ruthenium", "iridium", "osmium", "rhodium",
  "copper", "zinc", "iron", "nickel", "cobalt", "manganese", "chromium", "vanadium", "titanium",
  "molybdenum", "tungsten", "technetium", "rhenium", "gallium", "indium", "tin", "lead", "bismuth",
  "antimony", "arsenic", "boron", "silicon", "germanium", "lithium", "sodium", "potassium", "magnesium",
  "calcium", "strontium", "barium", "lanthanum", "cerium", "neodymium", "samarium", "europium",
  "gadolinium", "terbium", "dysprosium", "holmium", "erbium", "ytterbium", "lutetium", "yttrium",
  "scandium", "zirconium", "hafnium", "niobium", "tantalum", "cadmium", "mercury", "thallium", "uranium"];

const TASKS = [
  ["parameterisation", (m) => `parameterise a ${m} complex for MD`],
  ["parameterisation", (m) => `I need force field parameters for this ${m} containing ligand`],
  ["qm-geometry", (m) => `optimise the geometry of a ${m} complex`],
  ["qm-mechanism", (m) => `work out the mechanism of this ${m} catalysed step`],
  ["md-stability", (m) => `run MD on my ${m} binding protein`],
  ["hit-discovery", (m) => `find inhibitors of this ${m} dependent enzyme`],
  ["qm-properties", (m) => `predict the pKa of this ${m} chelator`],
];

const build = (q) => {
  const parsed = { ...parseQuery(q), constraints: statedConstraints(q) };
  const brief = buildBrief(parsed);
  return { parsed, brief, result: compose(brief) };
};

test("every metal, across every task that mentions one", () => {
  const bad = [];
  for (const metal of METALS) {
    for (const [want, make] of TASKS) {
      const q = make(metal);
      const { parsed, brief, result } = build(q);
      if (parsed.intent !== want) bad.push(`routed ${parsed.intent} not ${want}: ${q}`);
      if (!brief.metal.length) bad.push(`metal not detected: ${q}`);
      if (!result.ok || !result.steps.length) bad.push(`no plan: ${q}`);
      const issues = validate(result);
      if (issues.length) bad.push(`invalid: ${q} -> ${issues.join("; ")}`);
    }
  }
  assert.deepEqual(bad, [], `${bad.length} of ${METALS.length * TASKS.length} metal queries failed`);
});

// Several phrasings per protocol. A keyword router that only recognises the one
// phrasing someone happened to test is not coverage.
const PHRASINGS = {
  "hit-discovery": ["find inhibitors of EGFR", "screen for binders of BRD4", "dock this library into CDK2", "identify hits for JAK2"],
  "lead-opt": ["improve potency in my lead series", "optimise my analogue series for potency", "what should I make next in this series"],
  "qsar": ["build a QSAR model for solubility", "train an activity model on my data", "predict potency with machine learning"],
  "fep": ["rank these analogues with FEP", "relative binding free energy for my series", "compute ddG for these mutations"],
  "fbdd": ["my fragment screen gave 40 hits", "which fragment should I grow", "fragment based design against this pocket"],
  "selectivity": ["why is my series hitting the wrong kinase", "make this selective over the paralog", "counter-screen my compounds"],
  "degrader": ["design a PROTAC for BRD4", "molecular glue for this target", "targeted protein degradation strategy"],
  "resistance": ["how does this mutation affect binding", "design against the gatekeeper mutant", "analyse resistance variants"],
  "denovo": ["generate new scaffolds for KRAS", "de novo design against this pocket", "propose new chemotypes"],
  "antibody": ["design a nanobody against this epitope", "antibody developability assessment", "humanise this antibody"],
  "admet": ["ADMET and hERG risk for my compounds", "predict toxicity of this set", "assess metabolic liability"],
  "md-stability": ["run MD on my EGFR complex", "is this complex stable in simulation", "simulate the bound pose"],
  "conformational-sampling": ["conformational sampling of CYP3A4", "find cryptic pockets with enhanced sampling", "metadynamics on this loop"],
  "retrosynthesis": ["plan a synthesis route for this molecule", "how do I make this compound", "retrosynthetic analysis"],
  "target-triage": ["which target should I pick for Alzheimers", "is this target druggable", "validate this target"],
  "structure": ["best crystal structure for EGFR", "get me a structure of this protein", "which PDB entry should I use"],
  "network-pharmacology": ["network pharmacology of this plant against diabetes", "systems pharmacology study"],
  "ligand-discovery": ["ligand based virtual screening", "find inhibitors of EGFR without a structure",
                       "find binders for EGFR with no usable structure"],
  "qm-geometry": ["optimise the geometry of this molecule", "energy minimise this complex", "DFT single point"],
  "qm-mechanism": ["work out the reaction mechanism", "find the transition state", "activation barrier for this step"],
  "qm-properties": ["predict the pKa", "which tautomer dominates", "predict the NMR spectrum"],
  "parameterisation": ["parametrise this ligand", "force field parameters for a cofactor", "RESP charges for my molecule"],
  "protein-engineering": ["engineer this enzyme for thermostability", "improve protein solubility", "directed evolution campaign"],
  "peptide-design": ["design a cyclic peptide binder", "stapled peptide against this helix", "macrocycle for this surface"],
  "landscape": ["competitive landscape for this target", "what is in the clinic", "patent position on this scaffold"],
  "library-design": ["build a focused screening library", "standardise and deduplicate my compounds", "select a diverse subset"],
  "benchmarking": ["benchmark my scoring function", "validate the method on a reference set", "compare these methods"],
  "target-prediction": ["target prediction", "predict the targets of my compound", "target deconvolution", "what protein does this compound bind", "target fishing for a phenotypic hit"],
};

const NO_PROTEIN = new Set(["admet", "retrosynthesis", "target-triage", "network-pharmacology",
  "qm-geometry", "qm-mechanism", "qm-properties", "library-design", "benchmarking", "parameterisation"]);

/** Would this question skip the semantic router entirely? */
const locksIn = (q) => {
  const k = parseQuery(q), c = statedConstraints(q);
  const routeChanging = c.some((x) =>
    ["excluded method", "missing asset", "no structure", "existing asset"].includes(x.kind));
  const resolved = k.target || NO_PROTEIN.has(k.intent);
  return !routeChanging && k.operational && ((k.score >= 1 && resolved) || k.score >= 3);
};

test("no phrasing is locked into the wrong protocol", () => {
  // Deferring to the model is fine; it knows all the protocols. Skipping the
  // model on a wrong answer is the failure that reaches a user as a bad plan.
  const locked = [];
  for (const [want, queries] of Object.entries(PHRASINGS)) {
    for (const q of queries) {
      // The composed intent is what reaches the page: a keyword guess that a
      // stated constraint then corrects was never shown to anyone.
      const got = build(q).result.intent;
      if (got !== want && locksIn(q)) locked.push(`${got} not ${want}, with no model call: ${q}`);
    }
  }
  assert.deepEqual(locked, []);
});

test("every protocol is reachable by more than one phrasing", () => {
  const covered = new Set();
  for (const queries of Object.values(PHRASINGS)) for (const q of queries) covered.add(build(q).result.intent);
  const unreachable = Object.keys(RECIPES).filter((id) => !covered.has(id));
  assert.deepEqual(unreachable, [], "a protocol no phrasing reaches is a protocol no one can use");
  // And the sweep must cover every protocol that exists, so a new one is not
  // added without a phrasing that finds it.
  assert.deepEqual(Object.keys(RECIPES).filter((id) => !PHRASINGS[id]), []);
});

test("ordinary English is not read as coordination chemistry", () => {
  const trap = ["the gold standard for docking", "a silver bullet for this target",
    "lead optimisation of my series", "lead compound selection", "iron out the workflow",
    "calcium channel blocker", "sodium channel inhibitor", "potassium channel opener",
    "in human cells", "find inhibitors of EGFR in human", "co-crystal structure of CDK2",
    "the copper author list", "tin can", "silicon valley biotech", "mercury the software",
    "lead series optimisation", "a novel lead molecule", "lead-like compounds",
    "the iron age of drug design", "scaffold hopping from this series"];
  const fired = trap.filter((q) => statedConstraints(q).some((c) => c.kind === "metal site"));
  assert.deepEqual(fired, []);
});

test("a keyword only matches where a word starts", () => {
  // "fold" is a structure keyword and lives inside "scaffold"; raw substring
  // matching sent "generate new scaffolds" to structure prediction.
  assert.equal(parseQuery("generate new scaffolds for KRAS").intent, "denovo");
  assert.equal(parseQuery("what is the fold of this protein").intent, "structure");
  assert.deepEqual(parseQuery("a roadblock in the workflow").evidence, []);
  assert.ok(parseQuery("blocking the receptor").evidence.includes("block"));
  // Deliberate stems still match their own inflections.
  assert.ok(parseQuery("optimise my lead series").evidence.includes("optimi"));
});

test("saying you have no structure reroutes however it is phrased", () => {
  for (const q of [
    "find inhibitors of EGFR without a structure",
    "find inhibitors of EGFR with no usable structure",
    "find inhibitors of EGFR, I don't have a crystal structure",
    "find inhibitors of EGFR lacking any solved structure",
  ]) {
    const { brief, result } = build(q);
    assert.ok(brief.missing.includes("receptor_structure"), `missed the absence in: ${q}`);
    assert.equal(result.intent, "ligand-discovery", `did not reroute: ${q}`);
    assert.deepEqual(validate(result), []);
  }
  // And a question that says nothing about structures is left alone.
  assert.equal(build("find inhibitors of EGFR in human").result.intent, "hit-discovery");
});
