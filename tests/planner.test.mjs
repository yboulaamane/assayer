import test from "node:test";
import assert from "node:assert/strict";
import { resolveQuery, parseQuery, aliasTarget, statedConstraints, planToMarkdown } from "../web/assets/workflow.js";
import { buildBrief, compose, composeFromSelection, validate } from "../web/assets/compose.js";
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

// ---------------------------------------------------------------- selection

const pick = (query, modules, extra = {}) => {
  const { brief } = plan(query);
  return { brief, result: composeFromSelection(brief, { modules, ...extra }) };
};

test("a selected plan is assembled from the registry and passes the same validator", () => {
  const { result } = pick("rank my EGFR analogues with FEP and keep an eye on ADMET", [
    { id: "docking.anchor_on_a_co", why: "start from the bound pose" },
    { id: "fep.check_the_series_is", why: "the series must be connectable" },
    { id: "fep.design_the_perturbation_map", why: "plan the edges" },
    { id: "docking.rank_with_free_energy", why: "the actual ranking" },
    { id: "general.keep_the_properties_in", why: "watch properties while optimising" },
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.selected, true);
  assert.deepEqual(validate(result), []);
  // Drawing across protocols is the point; the curated route could not do this.
  const families = new Set(result.steps.map((s) => s.family));
  assert.ok(families.size > 1);
  // Per-step reasoning for this case survives onto the step.
  assert.ok(result.steps.some((s) => s.context === "start from the bound pose"));
});

test("a selection cannot invent a module, a tool or a gate", () => {
  // Mostly-invented ids are a confused response, not a selection to repair.
  const bogus = pick("find inhibitors of EGFR", [
    { id: "docking.do_the_magic" }, { id: "made.up" }, { id: "docking.screen_the_library" },
  ]);
  assert.equal(bogus.result.ok, false);

  // A single bad id is dropped and reported, and the rest still assembles.
  const mostly = pick("find inhibitors of EGFR in human", [
    { id: "structure.confirm_the_target_and" },
    { id: "structure.choose_the_receptor_structure" },
    { id: "docking.prepare_the_receptor_and" },
    { id: "not.a_module" },
  ]);
  assert.equal(mostly.result.ok, true);
  assert.deepEqual(mostly.result.rejected, ["not.a_module"]);
  // Every step's text, gates and tools come from the registry, never the model.
  for (const step of mostly.result.steps) {
    const canonical = MODULES[step.id];
    assert.equal(step.why, canonical.why);
    assert.equal(step.gate, canonical.gate);
    assert.deepEqual(step.tools, canonical.tools);
  }
});

test("the model cannot drop a control the rest of the plan depends on", () => {
  // A screen with no redock and no enrichment control is unfalsifiable.
  const screen = pick("find inhibitors of EGFR in human", [
    { id: "structure.confirm_the_target_and" },
    { id: "structure.choose_the_receptor_structure" },
    { id: "docking.prepare_the_receptor_and" },
    { id: "docking.screen_the_library" },
  ]);
  const ids = screen.result.steps.map((s) => s.id);
  assert.ok(ids.includes("docking.redock_the_native_ligand"));
  assert.ok(ids.includes("docking.run_the_enrichment_control"));
  assert.ok(ids.indexOf("docking.redock_the_native_ligand") < ids.indexOf("docking.screen_the_library"));
  assert.equal(screen.result.reinstated.length, 2);
  for (const step of screen.result.steps.filter((s) => !s.chosen && s.context)) {
    assert.match(step.context, /Kept in because/);
  }

  // A model without a deployment-matched split or an applicability domain.
  const model = pick("build an activity model from my 500 measured compounds", [
    { id: "qsar.curate_the_data_properly" }, { id: "qsar.only_then_reach_for" },
  ]);
  const mids = model.result.steps.map((s) => s.id);
  assert.ok(mids.includes("qsar.split_the_way_you"));
  assert.ok(mids.includes("qsar.check_the_applicability_domain"));

  // An MD run with nothing proving it converged.
  const md = pick("run MD on my EGFR complex", [
    { id: "md.build_the_system" }, { id: "md.equilibrate_then_run_replicates" },
  ]);
  const dids = md.result.steps.map((s) => s.id);
  assert.ok(dids.some((id) => ["md.prove_it_converged", "md.check_convergence_not_wall"].includes(id)));
});

test("stated constraints outrank the selection", () => {
  // Excluded methods are dropped even when the model picked them.
  const { result } = pick("find inhibitors of EGFR in human without docking or MD", [
    { id: "docking.screen_the_library" }, { id: "md.build_the_system" },
    { id: "ligand.similarity_baseline" }, { id: "qsar.curate_the_data_properly" },
  ]);
  assert.deepEqual(validate(result), []);
  assert.ok(!result.steps.some((s) => ["docking", "md"].includes(s.family)));
  assert.ok(result.dropped.some((d) => /you excluded/.test(d.reason)));

  // A control is not reinstated into a family the user ruled out.
  assert.ok(!result.steps.some((s) => s.id === "docking.redock_the_native_ligand"));
});

test("selection reasoning survives into the Markdown export", () => {
  const { brief, result } = pick("find inhibitors of EGFR in human", [
    { id: "structure.confirm_the_target_and", why: "pin the accession first" },
    { id: "docking.prepare_the_receptor_and" },
    { id: "docking.screen_the_library" },
  ], {
    understood: "Find new EGFR binders by screening against a validated docking setup.",
    assumptions: ["Human EGFR, kinase domain"],
    questions: ["Do you have known actives for the enrichment control?"],
  });
  const md = planToMarkdown(result, null, [], brief);
  assert.ok(md.includes("Steps chosen for this case"));
  assert.ok(md.includes("Find new EGFR binders"));
  assert.ok(md.includes("Human EGFR, kinase domain"));
  assert.ok(md.includes("known actives for the enrichment control"));
  assert.ok(md.includes("Put back as required controls"));
  assert.ok(md.includes("pin the accession first"));
});

test("an empty or unusable selection leaves the curated plan standing", () => {
  const { brief } = plan("find inhibitors of EGFR in human");
  for (const selection of [{}, { modules: [] }, { modules: ["nope"] }, null]) {
    assert.equal(composeFromSelection(brief, selection).ok, false);
  }
  // And the curated fallback is always a complete, valid plan.
  const fallback = compose(brief);
  assert.equal(fallback.ok, true);
  assert.deepEqual(validate(fallback), []);
});

test("optimising a geometry is quantum chemistry, not lead optimisation", () => {
  for (const query of [
    "i wanna optimize geometry of palladium bound ligand",
    "geometry optimisation of a ruthenium complex",
    "DFT single point energies for my ligand set",
    "what spin state is the iron centre in",
  ]) {
    const { parsed } = plan(query);
    assert.equal(parsed.intent, "qm-geometry", `routed ${query} to ${parsed.intent}`);
    // A metal complex is a molecule, not a protein; no UniProt lookup applies.
    assert.equal(parsed.target, null);
  }

  // The "optimi" stem must not drag potency work into quantum chemistry, nor
  // the reverse.
  for (const [query, intent] of [
    ["optimise my EGFR lead series for potency", "lead-opt"],
    ["improve potency of my analogues using measured SAR", "lead-opt"],
    ["conformational sampling of CYP3A4", "conformational-sampling"],
  ]) assert.equal(plan(query).parsed.intent, intent, `${query} should be ${intent}`);
});

test("the quantum chemistry protocol settles the electronic state before it optimises", () => {
  const { brief, result } = plan("i wanna optimize geometry of palladium bound ligand");
  assert.equal(result.intent, "qm-geometry");
  assert.equal(result.ok, true);
  assert.equal(result.viable, true);
  assert.deepEqual(validate(result), []);

  const order = result.steps.map((s) => s.id);
  const at = (id) => order.indexOf(id);
  // Charge and spin decide the geometry, so they are settled first; the method
  // and starting structure both depend on them.
  assert.equal(at("qm.fix_the_electronic_state"), 0);
  assert.ok(at("qm.choose_a_method_that_can_describe_the_metal") < at("qm.optimise_then_prove_it_is_a_minimum"));
  assert.ok(at("qm.build_a_defensible_starting_geometry") < at("qm.optimise_then_prove_it_is_a_minimum"));
  // An optimisation is not a result until the frequencies say it is a minimum.
  assert.match(MODULES["qm.optimise_then_prove_it_is_a_minimum"].gate, /imaginary frequen/i);

  // The metal is detected, but protein-site modules need a receptor and there
  // is none: this is a complex, not a metalloenzyme.
  assert.ok(brief.metal.length);
  assert.ok(!result.steps.some((s) => s.family === "metal"));

  const md = planToMarkdown(result, null, [], brief);
  assert.ok(md.includes("Fix the charge and spin state"));
  assert.ok(md.includes("effective core potential"));
});

test("every recipe still resolves to real modules and real tools", async () => {
  const { readFileSync } = await import("node:fs");
  const catalogue = JSON.parse(readFileSync(new URL("../web/catalog.json", import.meta.url)));
  const norm = (s) => s.normalize("NFKD").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const names = new Set();
  for (const t of catalogue.tools) {
    for (const k of [t.name, ...(t.aliases || [])]) { names.add(norm(k)); names.add(norm(k).replace(/\s+/g, "")); }
  }
  for (const [id, recipe] of Object.entries(RECIPES)) {
    assert.ok(recipe.label && recipe.summary && recipe.decision && recipe.stop, `${id} is missing framing`);
    assert.ok(recipe.modules.length, `${id} has no modules`);
    for (const m of recipe.modules) assert.ok(MODULES[m], `${id} names a missing module: ${m}`);
  }
  for (const [id, m] of Object.entries(MODULES)) {
    for (const tool of m.tools) {
      assert.ok(names.has(norm(tool)) || names.has(norm(tool).replace(/\s+/g, "")),
                `${id} names a tool the catalogue does not hold: ${tool}`);
    }
  }
});

// ------------------------------------------------- keyword confidence

test("one noun cannot score twice by containing itself", () => {
  // "inhibitors" contains "inhibitor"; both were in the list and both cleared
  // the length bonus, so a single word was worth four points and locked in the
  // shortcut on its own.
  const { evidence, score } = parseQuery("who first discovered EGFR inhibitors");
  assert.deepEqual(evidence, ["inhibitors"]);
  assert.ok(score <= 2, `one noun scored ${score}`);

  // The longer phrase consumes the text, so the shorter one inside it is not
  // counted again either.
  const vs = parseQuery("run a virtual screening campaign");
  assert.ok(vs.evidence.includes("virtual screening"));
  assert.ok(!vs.evidence.includes("screening"));
});

test("matching a subject is not evidence of a requested workflow", () => {
  // Asked for, so the keyword route is trustworthy on its own.
  for (const query of [
    "Find inhibitors of EGFR in human",
    "find new inhibitors of EGFR in human",
    "Design a PROTAC for BRD4 using VHL",
    "identify hits for this target",
  ]) assert.equal(parseQuery(query).operational, true, `${query} asks for the thing`);

  // Merely mentioned: the noun sits in a phrase attached to something else, and
  // no protocol covers what is being asked. These carry the vocabulary of a
  // workflow without requesting one.
  for (const query of [
    "who first discovered EGFR inhibitors",
    "how much do EGFR inhibitors cost per gram",
    "translate this paper about kinase inhibitors",
    "how many antibodies reached phase 3 last year",
  ]) assert.equal(parseQuery(query).operational, false, `${query} only mentions it`);
});

test("the shortcut defers to the model when the evidence is only a subject", async () => {
  const asked = [];
  const stub = async (query) => {
    asked.push(query);
    return { intent: "unsupported", matched: false, confidence: "low", evidence: null,
             target: null, organism_taxid: null, reason: "no protocol covers this" };
  };
  const call = async (query) => {
    const old = globalThis.fetch;
    globalThis.fetch = async (_u, o) => new Response(JSON.stringify(await stub(JSON.parse(o.body).query)),
      { headers: { "Content-Type": "application/json" } });
    try { return await resolveQuery(query); } finally { globalThis.fetch = old; }
  };

  // Vocabulary of a screening campaign, and not a request for one. The model
  // must be asked, and its refusal must stand.
  const aside = await call("who first discovered EGFR inhibitors");
  assert.equal(asked.length, 1);
  assert.equal(aside.matched, false);

  // The genuine version of the same vocabulary never reaches the model.
  const real = await call("Find inhibitors of EGFR in human");
  assert.equal(asked.length, 1, "a clear request should not cost a model call");
  assert.equal(real.via, "keywords");
  assert.equal(real.intent, "hit-discovery");
});

test("only constraints that change the plan are worth a model call", async () => {
  let calls = 0;
  const call = async (query) => {
    const old = globalThis.fetch;
    globalThis.fetch = async () => { calls++; return new Response(JSON.stringify(
      { intent: "hit-discovery", matched: true, confidence: "high", evidence: "x",
        target: null, organism_taxid: null }), { headers: { "Content-Type": "application/json" } }); };
    try { return await resolveQuery(query); } finally { globalThis.fetch = old; }
  };

  // A compute or time limit is reported as not applied; a metal note annotates
  // the plan. Neither changes which modules apply, so neither is worth a call.
  await call("Conformational sampling of CYP3A4 on CPU only within two days");
  await call("Optimise the geometry of a palladium bound ligand");
  assert.equal(calls, 0, "non-route-changing constraints should not spend quota");

  // An exclusion does change the route, so it must be asked about.
  await call("Find inhibitors of EGFR in human without docking");
  assert.equal(calls, 1);
});

// --------------------------------------------------- the added protocols

test("each added protocol claims its own questions", () => {
  const cases = [
    ["qm-mechanism", ["work out the mechanism of this reaction", "find the transition state for this step",
                      "what is the activation barrier for this step"]],
    ["qm-properties", ["predict the pKa of my compound", "which tautomer dominates at pH 7",
                       "predict the NMR spectrum of this molecule"]],
    ["protein-engineering", ["engineer this enzyme to be more thermostable",
                             "improve the solubility of my protein construct",
                             "plan a directed evolution campaign"]],
    ["peptide-design", ["design a cyclic peptide binder for this surface",
                        "make a stapled peptide against this helix"]],
    ["landscape", ["what is already in the clinic for this target",
                   "find me the competitive landscape for KRAS inhibitors",
                   "is my scaffold covered by an existing patent"]],
    ["library-design", ["build a focused screening library", "standardise and deduplicate these SMILES",
                        "cluster my library by scaffold"]],
    ["benchmarking", ["how do I benchmark my scoring function", "compare methods on a reference set"]],
  ];
  for (const [intent, queries] of cases) {
    for (const q of queries) assert.equal(parseQuery(q).intent, intent, `"${q}" routed elsewhere`);
  }
});

test("the added protocols do not steal the questions that already worked", () => {
  for (const [q, intent] of [
    ["Find inhibitors of EGFR in human", "hit-discovery"],
    ["improve potency of my analogues using measured SAR", "lead-opt"],
    ["i wanna optimize geometry of palladium bound ligand", "qm-geometry"],
    ["design a nanobody against this epitope", "antibody"],
    ["my fragment screen gave 40 hits which should I grow", "fbdd"],
    ["Plan a synthesis route for this molecule", "retrosynthesis"],
    ["Conformational sampling of CYP3A4", "conformational-sampling"],
    ["Design a PROTAC for BRD4 using VHL", "degrader"],
    ["Network pharmacology study of Aloysia vs Parkinsons", "network-pharmacology"],
    ["I have missense variants, analyse mutants vs WT", "resistance"],
  ]) assert.equal(parseQuery(q).intent, intent, `"${q}" was stolen`);
});

test("every protocol composes into a plan that validates", () => {
  for (const id of Object.keys(RECIPES)) {
    const result = compose({ intent: id });
    assert.equal(result.ok, true, `${id} did not compose`);
    assert.ok(result.steps.length >= 4, `${id} produced only ${result.steps.length} steps`);
    assert.deepEqual(validate(result), [], `${id} failed validation`);
    // Dependencies resolve within the plan, so no step depends on a later one.
    const seen = new Set();
    for (const s of result.steps) {
      for (const d of s.dependencies || []) assert.ok(seen.has(d), `${id}: ${s.id} depends on later ${d}`);
      seen.add(s.id);
    }
  }
});

test("the added protocols carry gates and name real work", () => {
  const added = ["qm-mechanism", "qm-properties", "protein-engineering", "peptide-design",
                 "landscape", "library-design", "benchmarking"];
  for (const id of added) {
    const recipe = RECIPES[id];
    assert.ok(recipe, `${id} is missing`);
    const gated = recipe.modules.filter((m) => MODULES[m].gate).length;
    assert.ok(gated >= Math.ceil(recipe.modules.length / 2),
              `${id} has only ${gated}/${recipe.modules.length} gated steps`);
    // Only the modules written for these protocols; a borrowed one is the
    // responsibility of the protocol it was written for.
    const own = recipe.modules.filter((m) => m.startsWith(id.split("-")[0]) ||
      m.startsWith("protein.") || m.startsWith("peptide.") || m.startsWith("library.") ||
      m.startsWith("landscape.") || m.startsWith("bench."));
    assert.ok(own.length, `${id} has no modules of its own`);
    for (const m of own) {
      assert.ok(MODULES[m].why.length > 80, `${m} needs a real reason, not a label`);
    }
  }
});

test("a protein engineering plan separates stability from function", () => {
  const { result } = plan("engineer this enzyme to be more thermostable");
  assert.equal(result.intent, "protein-engineering");
  assert.deepEqual(validate(result), []);
  const ids = result.steps.map((s) => s.id);
  // Positions come before predictions, and the function check comes after the
  // designs it is meant to test.
  assert.ok(ids.indexOf("protein.locate_where_change_is_tolerated")
            < ids.indexOf("protein.predict_the_change_in_stability"));
  assert.ok(ids.indexOf("protein.design_the_variants")
            < ids.indexOf("protein.check_you_have_not_broken_function"));
  assert.match(MODULES["protein.check_you_have_not_broken_function"].pitfall, /turnover|function/i);
});

test("a landscape plan states the limits of its own search", () => {
  const { brief, result } = plan("find me the competitive landscape for KRAS inhibitors");
  assert.equal(result.intent, "landscape");
  assert.deepEqual(validate(result), []);
  assert.ok(result.steps.some((s) => s.id === "landscape.check_the_patent_position"));
  // A patent scoping exercise must not present itself as legal advice.
  assert.match(MODULES["landscape.check_the_patent_position"].gate, /legal advice|scoping/i);
  const md = planToMarkdown(result, null, [], brief);
  assert.ok(md.includes("Competitive & IP landscape"));
});
