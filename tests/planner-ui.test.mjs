import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { parseQuery, statedConstraints, planToMarkdown, PROTOCOL_LIST } from "../web/assets/workflow.js";
import { buildBrief, compose, composeFromSelection, validate } from "../web/assets/compose.js";

// Render smoke tests: execute the actual page controller with small DOM stubs.
// These check content and copy behavior, not browser layout or remote lookups.
const source = readFileSync(new URL("../web/assets/app.js", import.meta.url), "utf8")
  .replace(/^import .*\n/gm, "").replace(/\nboot\(\);\s*$/, "");

function page(query, overrides = {}) {
  const nodes = new Map();
  const get = (id) => {
    if (!nodes.has(id)) nodes.set(id, { innerHTML: "", textContent: "" });
    return nodes.get(id);
  };
  const copied = [];
  const context = vm.createContext({
    document: { getElementById: get }, window: {}, addEventListener() {},
    setTimeout() {}, icon: () => "", buildBrief, compose, composeFromSelection, validate, planToMarkdown, PROTOCOL_LIST,
    renderStructures: () => "", findTarget: async () => [], findStructures: async () => ({ entries: [], total: 0 }),
    alphafold: async () => null, intentUsesProtein: () => true, AbortSignal: { timeout: () => undefined },
    resolveQuery: async () => ({ ...parseQuery(query), target: null, constraints: statedConstraints(query) }),
    navigator: { clipboard: { writeText: async (text) => copied.push(text) } },
    ...overrides,
  });
  vm.runInContext(source, context);
  return { context, get, copied };
}

test("page and copied Markdown both show prerequisite and budget limitations", async () => {
  const query = "Run MD. No usable structure. CPU only, within two days.";
  const p = page(query);
  await p.context.drawPlan(query);
  const html = p.get("plan").innerHTML;
  assert.ok(html.includes("Provisional plan"));
  assert.ok(html.includes("Provide or complete receptor structure"));
  assert.ok(html.includes("Not applied:"));
  await p.get("cp").onclick({ target: {} });
  assert.ok(p.copied[0].includes("**Provisional plan:**"));
  assert.ok(p.copied[0].includes("receptor structure"));
  assert.ok(p.copied[0].includes("CPU only, two days"));
});

test("invalid plans are stopped before steps or export controls are rendered", async () => {
  const p = page("Run MD", { compose: () => ({ ok: true, steps: [{ id: "not-in-registry" }] }) });
  await p.context.drawPlan("Run MD");
  const html = p.get("plan").innerHTML;
  assert.ok(html.includes("needs correction"));
  assert.ok(html.includes("unknown module"));
  assert.ok(!html.includes('id="dl"'));
});

test("named off-target work appears in the rendered workflow", async () => {
  const query = "Find selective inhibitors that spare ERBB2";
  const p = page(query);
  await p.context.drawPlan(query);
  const html = p.get("plan").innerHTML;
  assert.ok(html.includes("Must spare: ERBB2"));
  assert.ok(html.includes("Compare the shortlist against the named off-target panel"));
});

test("the reported Aloysia request renders and exports the network workflow", async () => {
  const query = "network pharmacology study of aloysia plant vs parkinsons";
  const p = page(query, {
    resolveQuery: async () => ({ ...parseQuery(query), constraints: statedConstraints(query) }),
    findTarget: () => { throw new Error("A plant study must not resolve a single protein"); },
  });
  await p.context.drawPlan(query);
  const html = p.get("plan").innerHTML;
  assert.ok(html.includes("Network pharmacology"));
  assert.ok(html.includes(query));
  assert.ok(html.includes("botanical species"));
  assert.ok(html.includes("compound-target-disease"));
  assert.ok(!html.includes("Assayer does not plan this"));
  assert.equal(p.get("target-box").innerHTML, "");
  await p.get("cp").onclick({ target: {} });
  assert.ok(p.copied[0].includes("# Network pharmacology"));
  assert.ok(p.copied[0].includes(query));
  assert.ok(p.copied[0].includes("adjusted significance"));
});

test("tools named in a generated brief render as clean inline links", () => {
  const p = page("Profile ADMET for my compound set");
  vm.runInContext(`
    DATA = { tools: [{ id: "rdkit", name: "RDKit" }] };
    BY_NAME = new Map([["rdkit", DATA.tools[0]]]);
    window.updateTool = (id) => "#/browse?tool=" + id;
  `, p.context);
  const el = { innerHTML: "Use RDKit to standardise the structures." };
  p.context.linkTools(el);
  assert.match(el.innerHTML, /class="tool-ref"/);
  assert.doesNotMatch(el.innerHTML, /class="tool"/);
});

test("a metal plan renders its metal steps and says what triggered them", async () => {
  const query = "Dock hydroxamates into HDAC6 and spare HDAC1";
  const p = page(query);
  await p.context.drawPlan(query);
  const html = p.get("plan").innerHTML;

  assert.ok(html.includes("Characterise the metal centre before anything else"));
  assert.ok(html.includes("Set up the coordination sphere explicitly"));
  assert.ok(html.includes("Score coordination as coordination"));
  assert.ok(html.includes("Treat the metal-binding group as a liability"));
  // The trigger is stated on the page, so a wrong guess can be argued with.
  assert.ok(html.includes("HDAC6"));
  assert.ok(html.includes("these steps do not apply"));
  // Metal-aware tools are offered, not just named in prose.
  assert.ok(html.includes("CheckMyMetal"));
  assert.ok(html.includes("AutoDock4Zn"));

  await p.get("cp").onclick({ target: {} });
  assert.ok(p.copied[0].includes("Characterise the metal centre"));
  assert.ok(p.copied[0].includes("these steps do not apply"));
});

test("a plan with no metal in it renders no metal steps", async () => {
  const query = "Find inhibitors of EGFR in human";
  const p = page(query);
  await p.context.drawPlan(query);
  const html = p.get("plan").innerHTML;
  assert.ok(!/metal centre|coordination sphere|metal-binding group/i.test(html));
});

/** A stubbed /api/plan that answers with this selection. */
const planner = (reply, ok = true) => ({
  fetch: async () => ({ ok, json: async () => reply }),
});

test("a model selection is rendered with what it understood and what it asks", async () => {
  const query = "Find inhibitors of EGFR in human";
  const p = page(query, planner({
    understood: "Find new EGFR binders by screening against a validated docking setup.",
    modules: [
      { id: "structure.confirm_the_target_and", why: "pin the accession before anything else" },
      { id: "docking.prepare_the_receptor_and", why: "EGFR needs care over the gatekeeper" },
      { id: "docking.screen_the_library", why: "the campaign itself" },
    ],
    questions: ["Do you have known actives for the enrichment control?"],
    assumptions: ["Human EGFR, kinase domain"],
  }));
  await p.context.drawPlan(query);
  const html = p.get("plan").innerHTML;

  assert.ok(html.includes("What I understood"));
  assert.ok(html.includes("Find new EGFR binders"));
  assert.ok(html.includes("Human EGFR, kinase domain"));
  assert.ok(html.includes("known actives for the enrichment control"));
  assert.ok(html.includes("steps chosen for your case"));
  // Per-case reasoning appears against the step it belongs to.
  assert.ok(html.includes("pin the accession before anything else"));
  // The controls the selection omitted were put back and labelled.
  assert.ok(html.includes("Redock the native ligand"));
  assert.ok(html.includes("Kept in because"));
});

test("an unreachable or unusable planner leaves the curated plan in place", async () => {
  const query = "Find inhibitors of EGFR in human";
  for (const override of [
    {},                                             // no fetch at all
    planner({ modules: [] }),                       // nothing selected
    planner({ modules: [{ id: "not.real" }] }),     // nothing that exists
    planner({}, false),                             // upstream error
  ]) {
    const p = page(query, override);
    await p.context.drawPlan(query);
    const html = p.get("plan").innerHTML;
    assert.ok(!html.includes("What I understood"));
    assert.ok(html.includes("routed by"));
    // The curated protocol is still complete and exportable.
    assert.ok(html.includes("Redock the native ligand"));
    assert.ok(html.includes("Download as Markdown"));
  }
});

test("a selection cannot smuggle text into a step", async () => {
  const query = "Find inhibitors of EGFR in human";
  const p = page(query, planner({
    understood: "<img src=x onerror=alert(1)>",
    modules: [{ id: "docking.screen_the_library", why: "<script>alert(2)</script>" }],
  }));
  await p.context.drawPlan(query);
  const html = p.get("plan").innerHTML;
  assert.ok(!html.includes("<img src=x"));
  assert.ok(!html.includes("<script>alert(2)"));
  assert.ok(html.includes("&lt;img") || html.includes("&lt;script"));
});
