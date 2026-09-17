import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { MODULES, RECIPES } from "../web/assets/modules.js";

// The evaluation set is data; this holds it to the score it last achieved, so a
// change that quietly makes plans worse fails here rather than in someone's
// research. The guard is no-regression, not perfection: a case can be added
// that currently fails, which lowers the baseline honestly.

const suite = JSON.parse(readFileSync(new URL("../evals/cases.json", import.meta.url)));
const baseline = JSON.parse(readFileSync(new URL("../evals/baseline.json", import.meta.url)));

const run = () => JSON.parse(execFileSync(process.execPath,
  [new URL("../evals/run.mjs", import.meta.url).pathname, "--json"], { encoding: "utf8" }));

test("the evaluation score has not regressed", () => {
  const { totals, cases } = run();
  assert.ok(totals.passed >= baseline.passed,
            `expectations met fell from ${baseline.passed} to ${totals.passed}`);
  assert.ok(totals.clean >= baseline.clean,
            `fully correct cases fell from ${baseline.clean} to ${totals.clean}`);
  // Name what broke, rather than only that something did.
  const nowFailing = cases.filter((c) => c.failed.length).map((c) => c.id);
  const regressions = nowFailing.filter((id) => !baseline.failing.includes(id));
  assert.deepEqual(regressions, [], `cases that used to pass: ${regressions.join(", ")}`);
});

test("every expectation names something that exists", () => {
  const bad = [];
  for (const c of suite.cases) {
    const e = c.expect;
    const ids = [...(e.must_include || []), ...(e.must_exclude || []),
                 ...(e.order || []).flat(), ...(e.must_cover || []).flat()];
    for (const id of ids) if (!MODULES[id]) bad.push(`${c.id}: no module ${id}`);
    if (e.route && !RECIPES[e.route]) bad.push(`${c.id}: no protocol ${e.route}`);
    if (e.rerouted_from && !RECIPES[e.rerouted_from]) bad.push(`${c.id}: no protocol ${e.rerouted_from}`);
  }
  assert.deepEqual(bad, [], "an expectation that names a missing module can never fail honestly");
});

test("every case says what it is for and where it came from", () => {
  const ids = new Set();
  for (const c of suite.cases) {
    assert.ok(c.id && !ids.has(c.id), `duplicate or missing id: ${c.id}`);
    ids.add(c.id);
    assert.ok(c.question?.trim(), `${c.id} has no question`);
    assert.ok(c.why?.length > 30, `${c.id} does not say what it is testing`);
    assert.ok(c.source?.trim(), `${c.id} has no provenance`);
    assert.equal(typeof c.reviewed, "boolean", `${c.id} must record whether a reviewer confirmed it`);
    assert.ok(Object.keys(c.expect || {}).length, `${c.id} expects nothing`);
  }
});

test("the set covers every protocol the planner offers", () => {
  const routed = new Set(suite.cases.map((c) => c.expect.route).filter(Boolean));
  const uncovered = Object.keys(RECIPES).filter((id) => !routed.has(id));
  assert.deepEqual(uncovered, [],
                   "a protocol with no case in the evaluation set is a protocol nothing measures");
});

// Citations, checked structurally here and against Crossref by
// scripts/check_refs.mjs. A reference that does not resolve is worse than none.

test("every citation is well formed and reachable from a module", async () => {
  const { REFERENCES } = await import("../web/assets/modules.js");
  const used = new Set();
  const bad = [];
  for (const [id, m] of Object.entries(MODULES)) {
    for (const r of m.refs || []) {
      if (!REFERENCES[r]) bad.push(`${id} cites unknown reference ${r}`);
      else used.add(r);
      if (!m.gate) bad.push(`${id} carries a reference but has no gate to attach it to`);
    }
  }
  for (const [id, ref] of Object.entries(REFERENCES)) {
    if (!/^10\.\d{4,9}\/\S+$/.test(ref.doi)) bad.push(`${id}: ${ref.doi} is not a DOI`);
    if (!/\(\d{4}\)/.test(ref.cite)) bad.push(`${id}: citation has no year`);
    if (!used.has(id)) bad.push(`${id} is cited by nothing`);
  }
  assert.deepEqual(bad, []);
});

test("a gate that states a number either cites a source or says it has none", async () => {
  const { REFERENCES } = await import("../web/assets/modules.js");
  // Numbers presented as criteria are assertions about the field. Each one is
  // either sourced, or says in the gate text that it is a working default.
  const states = /\b\d+(\.\d+)?\s*(Å|kcal|kJ|%)|\bat least \d|\bbelow ~?\d|\bwithin ~?\d|\bBEDROC|\bEF1%|\bpLDDT|\bR-free/;
  const unsourced = [];
  for (const [id, m] of Object.entries(MODULES)) {
    if (!m.gate || !states.test(m.gate)) continue;
    const cited = (m.refs || []).some((r) => REFERENCES[r]);
    const admits = /working default|not a published|judgement about|rather than a published/.test(m.gate);
    if (!cited && !admits) unsourced.push(`${id}: ${m.gate.slice(0, 70)}`);
  }
  assert.deepEqual(unsourced, [],
    "a numeric gate must carry a source, or say in its own text that it is a convention");
});

test("every asset URL carries a hash of what it serves", async () => {
  const { readFileSync, readdirSync } = await import("node:fs");
  const dir = new URL("../web/assets/", import.meta.url);
  const stamped = /from "\.\/[\w-]+\.js\?v=[0-9a-f]{10}"/;
  const bare = /from "\.\/[\w-]+\.js"/;
  const bad = [];

  for (const name of readdirSync(dir).filter((f) => f.endsWith(".js"))) {
    const src = readFileSync(new URL(name, dir), "utf8");
    // An unstamped import is a URL that cannot change when its contents do,
    // which is how a browser ends up running last week's code.
    if (bare.test(src)) bad.push(`${name} imports without a version stamp`);
    if (src.includes("from \"./") && !stamped.test(src) && bare.test(src)) {
      bad.push(`${name} has an unstamped relative import`);
    }
  }
  const html = readFileSync(new URL("../web/index.html", import.meta.url), "utf8");
  for (const m of html.matchAll(/(?:src|href)="(assets\/[\w-]+\.(?:js|css))(\?v=[0-9a-f]{10})?"/g)) {
    if (!m[2]) bad.push(`index.html references ${m[1]} without a version stamp`);
  }
  assert.deepEqual(bad, [], "run: python3 scripts/version_assets.py");
});

test("an example is always quoted or hand-written, never generated", async () => {
  const { readFileSync, existsSync } = await import("node:fs");
  const cat = JSON.parse(readFileSync(new URL("../web/catalog.json", import.meta.url)));
  const bad = [];
  for (const t of cat.tools) {
    // A README example must carry the URL it was taken from. Without that it is
    // indistinguishable from something written for it, which is the line this
    // project does not cross.
    if (t.quickstart && !/^https:\/\/raw\.githubusercontent\.com\//.test(t.quickstart.source || "")) {
      bad.push(`${t.name}: quickstart has no verifiable source`);
    }
    if (t.quickstart && !t.quickstart.code?.trim()) bad.push(`${t.name}: empty quickstart`);
    // Showing both would imply one was derived from the other.
    if (t.quickstart && t.snippet) bad.push(`${t.name}: has both a snippet and a quickstart`);
    // A declared Python version is copied from package metadata, so it looks
    // like a version specifier or it did not come from there.
    if (t.python && !/^[<>=!~ ,.\d*]+$/.test(t.python)) {
      bad.push(`${t.name}: "${t.python}" is not a version specifier`);
    }
  }
  assert.deepEqual(bad, []);

  // Every quoted example traces back to the file it was fetched into.
  const path = new URL("../data/quickstarts.json", import.meta.url);
  if (existsSync(path)) {
    const source = JSON.parse(readFileSync(path));
    for (const t of cat.tools.filter((x) => x.quickstart)) {
      assert.ok(source[t.repo], `${t.name}: quickstart not traceable to data/quickstarts.json`);
    }
  }
});
