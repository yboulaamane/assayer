import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { parseQuery, statedConstraints, planToMarkdown, PROTOCOL_LIST } from "../web/assets/workflow.js";
import { buildBrief, compose, validate } from "../web/assets/compose.js";

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
    setTimeout() {}, icon: () => "", buildBrief, compose, validate, planToMarkdown, PROTOCOL_LIST,
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
