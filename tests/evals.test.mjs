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
