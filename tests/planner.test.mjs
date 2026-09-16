import test from "node:test";
import assert from "node:assert/strict";
import { resolveQuery, parseQuery, aliasTarget, statedConstraints, planToMarkdown } from "../web/assets/workflow.js";
import { buildBrief, compose, validate } from "../web/assets/compose.js";
import { MODULES, RECIPES, FAMILY_TERMS } from "../web/assets/modules.js";

// Exercise the deterministic fallback without using quotas or depending on a provider.
function plan(query, overrides = {}) {
  const parsed = { ...parseQuery(query), constraints: statedConstraints(query), ...overrides };
  const brief = buildBrief(parsed);
  return { parsed, brief, result: compose(brief) };
}
const ids = (result) => result.steps.map((s) => s.id);

test("plant-disease network studies select a complete workflow without inventing a protein", () => {
  for (const query of [
    "network pharmacology study of aloysia plant vs parkinsons",
    "Network-pharmacology study of Aloysia citrodora against Parkinson's disease",
    "Systems pharmacology of a compound set in human",
    "Network pharmacology: screen phytochemicals for inhibitors and docking hits",
  ]) {
    const { parsed, brief, result } = plan(query);
    assert.equal(parsed.matched, true);
    assert.equal(parsed.intent, "network-pharmacology");
    assert.equal(parsed.target, null);
    assert.equal(result.steps.length, 8);
    assert.deepEqual(validate(result), []);
    const md = planToMarkdown(result, null, [], brief);
    assert.ok(md.includes(query));
    assert.ok(md.includes("constituent table"));
    assert.ok(md.includes("disease-associated"));
    assert.ok(md.includes("justified background"));
    assert.ok(md.includes("orthogonal validation"));
  }
});

test("the reported network study works without a routing provider", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; throw new Error("offline"); });
  const parsed = await resolveQuery("network pharmacology study of aloysia plant vs parkinsons");
  assert.equal(parsed.intent, "network-pharmacology");
  assert.equal(parsed.matched, true);
  assert.equal(calls, 0);
  const constrained = await resolveQuery("Network pharmacology of Aloysia vs Parkinson's without docking or MD");
  assert.equal(constrained.intent, "network-pharmacology");
  assert.equal(constrained.degraded, true);
  assert.deepEqual(validate(compose(buildBrief(constrained))), []);
});

test("semantic network routes cannot trigger protein lookups for plants or diseases", async (t) => {
  t.mock.method(globalThis, "fetch", async () => ({ ok: true, json: async () => ({ intent: "network-pharmacology", target: "Aloysia" }) }));
  const parsed = await resolveQuery("Study the pathways connecting this plant to this disease");
  assert.equal(parsed.intent, "network-pharmacology");
  assert.equal(parsed.target, null);
});

test("unrelated questions still have no matched workflow", () => {
  assert.equal(parseQuery("What is the weather tomorrow?").matched, false);
});

test("specific aliases and organism names retain the earlier fixes", () => {
  assert.equal(parseQuery("Find inhibitors of Aurora B in human").target, "AURKB");
  assert.equal(parseQuery("Find inhibitors of EGFR in guinea pig").organism.id, 10141);
  assert.equal(aliasTarget("Improve potency", true), null);
});

test("the original constrained EGFR request selects the ligand-based route", () => {
  const { brief, result } = plan("Find inhibitors of EGFR in human. I have 500 measured compounds, no usable structure, CPU only, and two days. Do not use docking or MD.");
  assert.equal(result.intent, "ligand-discovery");
  assert.deepEqual(brief.excluded, ["docking", "md"]);
  assert.deepEqual(brief.time, ["two days"]);
  assert.ok(!result.steps.some((s) => [s.family, ...(s.methods || [])].some((m) => brief.excluded.includes(m))));
  assert.deepEqual(validate(result), []);
});

test("a simulation module cannot bypass a no-MD exclusion", () => {
  const { result } = plan("Find inhibitors of EGFR. Do not use MD.");
  assert.ok(!ids(result).includes("docking.rescore_or_simulate_the"));
});

test("no FEP removes the ranking step in lead optimisation", () => {
  const { parsed, brief, result } = plan("I do not want FEP. Improve potency of my EGFR analogues using measured SAR.");
  assert.equal(parsed.target, "EGFR");
  assert.ok(brief.assets.includes("measured_data"));
  assert.ok(!ids(result).includes("docking.rank_with_free_energy"));
});

test("negation stops at a positive instruction, including comma clauses", () => {
  for (const tail of ["without docking but use MD", "without docking, use MD", "without docking and use MD"]) {
    assert.deepEqual(plan(`Find inhibitors of EGFR ${tail}.`).brief.excluded, ["docking"]);
  }
});

test("method lists support commas, conjunctions and slashes", () => {
  for (const tail of ["docking, MD, or FEP", "docking/MD/FEP", "docking and MD or FEP"]) {
    assert.deepEqual(new Set(plan(`Find EGFR inhibitors. Do not use ${tail}.`).brief.excluded), new Set(["docking", "md", "fep"]));
  }
});

test("exclusions support the registry vocabulary beyond the old short list", () => {
  for (const method of ["QSAR", "ADMET", "generative", "wet lab", "homology modelling"]) {
    assert.ok(plan(`Find EGFR inhibitors. Avoid ${method}.`).brief.excluded.length);
  }
});

test("constraints after the sixth fact are retained", () => {
  const { brief, result } = plan("Find inhibitors of EGFR. I have 20 measured compounds, 30 analogues, 40 hits, 50 variants, CPU only, within two days, no usable structure.");
  assert.ok(brief.stated.length > 6);
  assert.ok(brief.missing.includes("receptor_structure"));
  assert.equal(result.intent, "ligand-discovery");
});

test("validator rejects undeclared missing inputs", () => {
  const result = { steps: [{ ...MODULES["docking.redock_the_native_ligand"], unmet: [] }] };
  const issues = validate(result);
  assert.ok(issues.some((s) => s.includes("prepared_receptor")));
  assert.ok(issues.some((s) => s.includes("native_ligand")));
});

test("explicitly missing structure blocks construction and downstream simulation", () => {
  const { result } = plan("Run MD of EGFR. No usable structure.");
  assert.equal(result.viable, false);
  assert.ok(result.unmet.some((s) => s.capability === "receptor_structure"));
  assert.ok(result.steps.find((s) => s.id === "md.equilibrate_then_run_replicates").unmet.includes("simulation_system"));
  assert.deepEqual(validate(result), []); // Valid conditional plan, not a ready plan.
});

test("known actives cannot be inferred from arbitrary measurements", () => {
  const { result } = plan("Find EGFR inhibitors. I have 500 measured compounds.");
  assert.ok(result.unmet.some((s) => s.capability === "known_actives"));
});

test("a negated asset is never treated as supplied", () => {
  const { brief } = plan("Find EGFR inhibitors. I have no known actives.");
  assert.ok(!brief.assets.includes("known_actives"));
  assert.ok(brief.missing.includes("known_actives"));
});

test("ordinary lead optimisation cannot borrow PROTAC linker design", () => {
  const { result } = plan("Improve potency of EGFR analogues without docking.");
  assert.ok(!ids(result).includes("generative.vary_geometry_not_just"));
  assert.ok(ids(result).includes("docking.propose_analogues"));
  assert.deepEqual(validate(result), []);
});

test("borrowing recursively resolves the borrowed module's inputs", () => {
  const result = compose({ intent: "conformational-sampling" });
  const sequence = ids(result);
  assert.ok(sequence.indexOf("identity.resolve_the_target_to") < sequence.indexOf("structure.pick_and_prepare_the"));
  assert.ok(sequence.indexOf("md.build_the_system") < sequence.indexOf("md.run_production_as_independent"));
  assert.deepEqual(validate(result), []);
});

test("cycles in provider dependencies stop composition instead of looping", () => {
  const m = MODULES["identity.resolve_the_target_to"], before = m.requires;
  try {
    m.requires = ["receptor_structure"];
    const result = compose({ intent: "conformational-sampling" });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((s) => s.includes("cycle")));
  } finally { m.requires = before; }
});

test("off-target constraints add concrete panel work and persist in export", () => {
  const base = plan("Find inhibitors of EGFR").result;
  const { brief, result } = plan("Find selective EGFR inhibitors that spare ERBB2");
  assert.notDeepEqual(ids(result), ids(base));
  assert.ok(ids(result).includes("selectivity.define_panel"));
  assert.ok(ids(result).includes("selectivity.compare_panel"));
  assert.ok(result.steps.find((s) => s.id === "selectivity.compare_panel").context.includes("ERBB2"));
  const md = planToMarkdown(result, null, [], brief);
  assert.ok(md.includes("**Must spare:** ERBB2"));
  assert.ok(md.includes("Primary target: EGFR"));
});

test("missing prerequisites and unapplied budgets persist in export", () => {
  const { brief, result } = plan("Run MD of EGFR. No usable structure. CPU only, within two days.");
  const md = planToMarkdown(result, null, [], brief);
  assert.ok(md.includes("**Provisional plan:**"));
  assert.ok(md.includes("**Before this step:** Provide or complete receptor structure"));
  assert.ok(md.includes("**Not costed or scheduled:** CPU only, two days"));
});

test("existing trajectories use analysis and require their actual topology", () => {
  const { result } = plan("Analyse my existing EGFR trajectory; do not run docking or virtual screening.");
  assert.deepEqual(ids(result), ["md.analyse_what_you_predefined"]);
  assert.deepEqual(result.steps[0].unmet, ["matching_topology"]);
  const ready = compose({ intent: "md-stability", assets: ["trajectory", "matching_topology"] });
  assert.equal(ready.viable, true);
});

test("completed fragment screening does not repeat library selection", () => {
  const { result } = plan("My fragment screen gave 40 hits, which should I grow?");
  assert.ok(!ids(result).includes("identity.choose_the_library_for"));
  assert.ok(ids(result).includes("assay.confirm_every_hit_by"));
});

test("successful semantic routing overrides unmatched keyword routing", async (t) => {
  t.mock.method(globalThis, "fetch", async () => ({ ok: true, json: async () => ({ intent: "hit-discovery", target: "EGFR", organism_taxid: 9606 }) }));
  const result = await resolveQuery("Help me with EGFR");
  assert.equal(result.via, "llm");
  assert.equal(result.matched, true);
});

test("explicit null targets and unsupported model results remain authoritative", async (t) => {
  t.mock.method(globalThis, "fetch", async () => ({ ok: true, json: async () => ({ intent: "admet", target: null }) }));
  assert.equal((await resolveQuery("Help me with EGFR")).target, null);
  t.mock.method(globalThis, "fetch", async () => ({ ok: true, json: async () => ({ intent: "unsupported", matched: false }) }));
  assert.equal((await resolveQuery("Plan a route to the train station")).matched, false);
});

test("provider failures and truncated semantic input are disclosed", async (t) => {
  t.mock.method(globalThis, "fetch", async () => ({ ok: false }));
  assert.equal((await resolveQuery("Help me with EGFR")).degraded, true);
  t.mock.method(globalThis, "fetch", async () => ({ ok: true, json: async () => ({ intent: "hit-discovery", target: "EGFR", truncated: true }) }));
  assert.equal((await resolveQuery("Help me with EGFR")).truncated, true);
});

test("validation uses canonical requirements and rejects forbidden or reordered steps", () => {
  const m = MODULES["docking.redock_the_native_ligand"];
  assert.ok(validate({ steps: [{ ...m, requires: [], unmet: [] }] }).some((s) => s.includes("modified requires")));
  assert.ok(validate({ brief: { excluded: ["docking"] }, steps: [{ ...m, unmet: m.requires }] }).some((s) => s.includes("excluded method")));
  const result = compose({ intent: "conformational-sampling" });
  assert.ok(validate({ ...result, steps: [...result.steps].reverse() }).length);
});

test("all recipes compose valid conditional graphs across single-family exclusions", () => {
  for (const intent of Object.keys(RECIPES)) {
    for (const excluded of [[], ...Object.keys(FAMILY_TERMS).map((f) => [f])]) {
      const result = compose({ intent, excluded });
      assert.equal(result.ok, true, `${intent}: ${excluded} ${result.errors}`);
      assert.deepEqual(validate(result), [], `${intent}: ${excluded}`);
      assert.ok(!result.steps.some((s) => [s.family, ...(s.methods || [])].some((m) => excluded.includes(m))));
    }
  }
});

test("a metal centre is detected from real coordination language, not from lookalikes", () => {
  const metals = (q) => statedConstraints(q).filter((c) => c.kind === "metal site").map((c) => c.phrase);
  for (const query of [
    "find inhibitors of carbonic anhydrase II in human",
    "dock hydroxamates into HDAC6",
    "metalloprotein docking for a zinc enzyme",
    "simulate an Fe(III) porphyrin site",
    "MMP-13 selectivity over MMP1",
    "a chelating fragment for a manganese enzyme",
  ]) assert.ok(metals(query).length, `expected a metal site in: ${query}`);

  // Bare two-letter symbols collide with ordinary words, calcium channels are
  // not coordination chemistry, and "heme" hides inside unrelated names.
  for (const query of [
    "find inhibitors of EGFR in human",
    "calcium channel blocker for hypertension",
    "co-crystal structure of CDK2 with a fragment",
    "train a CheMeleon model for solubility",
    "design a PROTAC for BRD4",
    "improve potency of my analogues using measured SAR",
  ]) assert.deepEqual(metals(query), [], `unexpected metal site in: ${query}`);
});

test("metal work is inserted into the routed protocol, before the structure is used", () => {
  const { brief, result } = plan("find inhibitors of carbonic anhydrase II in human");
  assert.equal(result.intent, "hit-discovery");
  assert.deepEqual(validate(result), []);
  assert.deepEqual(brief.metal, ["carbonic anhydrase"]);

  const order = ids(result);
  const at = (id) => order.indexOf(id);
  assert.ok(at("metal.characterise_the_metal_centre") > at("structure.choose_the_receptor_structure"));
  assert.ok(at("metal.characterise_the_metal_centre") < at("docking.prepare_the_receptor_and"));
  assert.ok(at("metal.prepare_the_coordination_sphere") < at("docking.prepare_the_receptor_and"));
  // Scoring corrects the setup, so it must precede the screen it informs.
  assert.ok(at("metal.score_the_coordination") > at("docking.prepare_the_receptor_and"));
  assert.ok(at("metal.score_the_coordination") < at("docking.screen_the_library"));

  // Every metal step says what triggered it, so a wrong guess is correctable.
  for (const step of result.steps.filter((s) => s.family === "metal")) {
    assert.match(step.context, /carbonic anhydrase/);
    assert.match(step.context, /do not apply/);
  }
  const md = planToMarkdown(result, null, [], brief);
  assert.ok(md.includes("Characterise the metal centre before anything else"));
  assert.ok(md.includes("carbonic anhydrase"));
});

test("metal steps follow the same exclusions and route changes as everything else", () => {
  // Docking excluded reroutes to the ligand-based branch, which has no receptor
  // to set up, so no metal step is bolted on to it.
  const withoutDocking = plan("find inhibitors of carbonic anhydrase II without docking").result;
  assert.equal(withoutDocking.intent, "ligand-discovery");
  assert.deepEqual(validate(withoutDocking), []);
  assert.deepEqual(ids(withoutDocking).filter((id) => id.startsWith("metal.")), []);

  // A simulation of a metal site needs parameters, but has no metal-binding
  // warhead to hold liable.
  const zincFinger = plan("simulate the stability of a zinc finger protein").result;
  assert.equal(zincFinger.intent, "md-stability");
  assert.deepEqual(validate(zincFinger), []);
  const order = ids(zincFinger);
  assert.ok(order.includes("metal.parameterise_the_centre"));
  assert.ok(!order.includes("metal.check_the_binding_group"));
  assert.ok(order.indexOf("metal.parameterise_the_centre") < order.indexOf("md.build_the_system"));

  // Ruling out force field work drops the parameterisation, not the whole plan.
  const noParams = plan("simulate a zinc finger protein without force field parameterisation").result;
  assert.deepEqual(validate(noParams), []);
  assert.ok(!ids(noParams).includes("metal.parameterise_the_centre"));
  assert.ok(noParams.dropped.some((d) => d.id === "metal.parameterise_the_centre"));
});

test("no question without a metal ever acquires a metal step", () => {
  for (const query of [
    "find inhibitors of EGFR in human",
    "improve potency of my EGFR analogues using measured SAR",
    "my fragment screen gave 40 hits, which should I grow?",
    "analyse my existing EGFR trajectory",
    "plan a synthesis route for this molecule",
  ]) {
    const { result } = plan(query);
    assert.deepEqual(ids(result).filter((id) => id.startsWith("metal.")), [], `metal step in: ${query}`);
    assert.deepEqual(validate(result), []);
  }
});

test("every metal module resolves, and names only tools the catalogue holds", async () => {
  const { readFileSync } = await import("node:fs");
  const catalogue = JSON.parse(readFileSync(new URL("../web/catalog.json", import.meta.url)));
  const names = new Set(catalogue.tools.flatMap((t) => [t.name, ...(t.aliases || [])]));
  const metal = Object.values(MODULES).filter((m) => m.family === "metal");
  assert.ok(metal.length >= 5);
  for (const m of metal) {
    assert.ok(m.title && m.why && m.produces.length, `incomplete metal module: ${m.id}`);
    for (const tool of m.tools) assert.ok(names.has(tool), `${m.id} names a missing tool: ${tool}`);
  }
  // Injected, never listed in a recipe; that is what keeps them out of plans
  // for questions with no metal in them.
  for (const recipe of Object.values(RECIPES)) {
    assert.deepEqual(recipe.modules.filter((id) => id.startsWith("metal.")), []);
  }
});

test("a structure-only question checks the metal without setting up for work it is not doing", () => {
  const { result } = plan("what is the best structure for a copper-binding protein");
  assert.equal(result.intent, "structure");
  assert.deepEqual(validate(result), []);
  const metal = ids(result).filter((id) => id.startsWith("metal."));
  assert.deepEqual(metal, ["metal.characterise_the_metal_centre"]);
  assert.ok(ids(result).indexOf("metal.characterise_the_metal_centre")
    > ids(result).indexOf("structure.rank_the_experimental_structures"));
});
