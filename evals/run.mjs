// Score the planner against the reviewed fixtures.
//
//   node evals/run.mjs              full report
//   node evals/run.mjs --failures   only what failed
//   node evals/run.mjs --json       machine-readable, for a baseline
//   node evals/run.mjs --model      also exercise the semantic router (uses quota)
//   node evals/run.mjs --only id,id restrict to named cases, to pace a --model run
//
// Only the deterministic path is scored: routing, extraction, composition and
// validation with no model call. That is what can be run in CI on every change.
// Whether the model's *selection* improves on it is a separate question needing
// provider quota, and is not answered here.

import { readFileSync } from "node:fs";
import { parseQuery, statedConstraints, resolveQuery } from "../web/assets/workflow.js";
import { buildBrief, compose, validate } from "../web/assets/compose.js";
import { MODULES, RECIPES } from "../web/assets/modules.js";

const suite = JSON.parse(readFileSync(new URL("./cases.json", import.meta.url)));
const onlyFailures = process.argv.includes("--failures");
const asJson = process.argv.includes("--json");
// Without --model only the deterministic layer runs, which cannot decline a
// question: refusing is the semantic router's job. In that mode an out-of-scope
// question passes by deferring rather than by locking a protocol in.
const withModel = process.argv.includes("--model");
// A --model run is metered by the provider, and 50-odd calls will exhaust a free
// tier part way through. Restrict it, and pace it, rather than reporting a score
// that is really a rate limit.
const onlyArg = process.argv.find((a) => a.startsWith("--only="));
const only = onlyArg ? new Set(onlyArg.slice(7).split(",").map((x) => x.trim())) : null;
const pauseMs = withModel ? 4000 : 0;

const NO_PROTEIN = new Set(["admet", "retrosynthesis", "target-triage", "network-pharmacology",
  "qm-geometry", "qm-mechanism", "qm-properties", "library-design", "benchmarking", "parameterisation"]);

/** Would this question skip the semantic router altogether? */
function locksIn(question) {
  const k = parseQuery(question), c = statedConstraints(question);
  const routeChanging = c.some((x) =>
    ["excluded method", "missing asset", "no structure", "existing asset"].includes(x.kind));
  const resolved = k.target || NO_PROTEIN.has(k.intent);
  return !routeChanging && k.operational && ((k.score >= 1 && resolved) || k.score >= 3);
}

/** Build a plan exactly as the page does when no model is reachable. */
async function planFor(question) {
  const parsed = withModel
    ? await resolveQuery(question)
    : { ...parseQuery(question), constraints: statedConstraints(question) };
  if (!parsed.constraints) parsed.constraints = statedConstraints(question);
  const brief = buildBrief(parsed);
  return { parsed, brief, plan: compose(brief) };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** Each expectation is scored on its own, so a near miss is visible as one. */
async function score(testCase) {
  const { question, expect: want } = testCase;
  const { parsed, brief, plan } = await planFor(question);
  const checks = [];
  const check = (name, ok, detail) => checks.push({ name, ok: Boolean(ok), detail });
  const ids = (plan.steps || []).map((s) => s.id);

  // An unsupported question must produce no workflow. Nothing else is scored,
  // because there is no plan to score.
  if (want.unsupported) {
    if (withModel) {
      check("declines", parsed.matched === false, `offered ${parsed.intent}`);
    } else {
      // The deterministic layer's duty is to ask rather than to answer wrongly.
      const deferred = parsed.matched === false || !locksIn(question);
      check("does not lock in a protocol", deferred, `locked in ${parsed.intent}`);
    }
    return { checks, plan, parsed, brief };
  }
  if (parsed.matched === false) {
    check("does not decline", false, "declined a question a protocol covers");
    return { checks, plan, parsed, brief };
  }

  if (want.route) check("route", plan.intent === want.route, `got ${plan.intent}`);
  if (want.rerouted_from) {
    check("rerouted", plan.rerouted?.from === want.rerouted_from,
          plan.rerouted ? `from ${plan.rerouted.from}` : "no reroute");
  }
  if ("target" in want) {
    const got = parsed.target ?? null;
    check("target", got === want.target, `got ${JSON.stringify(got)}`);
  }
  if (want.organism) {
    check("organism", parsed.organism?.label === want.organism,
          `got ${parsed.organism?.label ?? "none"}`);
  }
  if ("metal" in want) {
    check("metal", Boolean(brief.metal.length) === want.metal,
          `detected ${JSON.stringify(brief.metal)}`);
  }
  if ("viable" in want) check("viable", plan.viable === want.viable, `got ${plan.viable}`);

  for (const [field, expected] of Object.entries(want.extract || {})) {
    const got = brief[field] || [];
    if (typeof expected === "number") {
      check(`extract.${field}`, got.length >= expected, `got ${got.length}`);
    } else {
      const missing = expected.filter((x) => !got.includes(x));
      check(`extract.${field}`, missing.length === 0, `missing ${JSON.stringify(missing)}`);
    }
  }

  for (const id of want.must_include || []) {
    check(`includes ${id}`, ids.includes(id), ids.includes(id) ? "" : "absent");
  }
  // "the plan must cover X", where more than one module can satisfy it. Keeps an
  // expectation about the science from breaking when a module is renamed or when
  // two modules say the same thing under different ids.
  for (const alternatives of want.must_cover || []) {
    const hit = alternatives.find((id) => ids.includes(id));
    check(`covers ${alternatives[0].split(".").pop()}`, Boolean(hit),
          `none of ${alternatives.join(" | ")}`);
  }
  for (const id of want.must_exclude || []) {
    check(`omits ${id}`, !ids.includes(id), ids.includes(id) ? "present" : "");
  }
  for (const family of want.must_exclude_families || []) {
    const offenders = (plan.steps || []).filter(
      (s) => [s.family, ...(s.methods || [])].includes(family)).map((s) => s.id);
    check(`no ${family} steps`, offenders.length === 0, offenders.join(", "));
  }
  for (const [first, second] of want.order || []) {
    const a = ids.indexOf(first), b = ids.indexOf(second);
    check(`${first.split(".").pop()} before ${second.split(".").pop()}`,
          a >= 0 && b >= 0 && a < b, a < 0 ? `${first} absent` : b < 0 ? `${second} absent` : "wrong order");
  }

  // A plan that does not validate is wrong however well it scores elsewhere.
  const issues = validate(plan);
  check("validates", issues.length === 0, issues.join("; "));
  return { checks, plan, parsed, brief };
}

const results = [];
const chosen = suite.cases.filter((c) => !only || only.has(c.id));
if (only && chosen.length !== only.size) {
  console.error(`unknown case id in --only: ${[...only].filter((id) => !suite.cases.some((c) => c.id === id)).join(", ")}`);
  process.exit(2);
}
for (const c of chosen) {
  results.push({ case: c, ...(await score(c)) });
  if (pauseMs) await wait(pauseMs);
}

// A --model run where the provider never answered is a deterministic run
// wearing the wrong label. Scoring it would report passes the model did not
// earn, which is worse than reporting nothing.
const degraded = results.filter((r) => r.parsed?.degraded).map((r) => r.case.id);
if (withModel && degraded.length) {
  console.error(`\nThe provider was unreachable for ${degraded.length} of ${results.length} cases ` +
    `(${degraded.slice(0, 5).join(", ")}${degraded.length > 5 ? ", ..." : ""}).`);
  console.error("Those fell back to keyword routing, so this is not a --model score. " +
    "Check quota, then re-run, or narrow with --only=<id>.");
  process.exit(3);
}

const totals = { checks: 0, passed: 0, cases: 0, clean: 0, reviewed: 0 };
const byCase = [];
for (const r of results) {
  const passed = r.checks.filter((c) => c.ok).length;
  totals.checks += r.checks.length;
  totals.passed += passed;
  totals.cases += 1;
  if (passed === r.checks.length) totals.clean += 1;
  if (r.case.reviewed) totals.reviewed += 1;
  byCase.push({ id: r.case.id, passed, of: r.checks.length,
                failed: r.checks.filter((c) => !c.ok).map((c) => `${c.name}${c.detail ? ` (${c.detail})` : ""}`) });
}

if (asJson) {
  console.log(JSON.stringify({ version: suite.version, totals, cases: byCase }, null, 2));
} else {
  console.log(`Assayer evaluation set ${suite.version}${withModel ? " (with the semantic router)" : " (deterministic only)"}`);
  console.log(`${totals.cases} cases, ${totals.checks} expectations, ${Object.keys(RECIPES).length} protocols, ${Object.keys(MODULES).length} modules`);
  if (only) console.log(`restricted to: ${[...only].join(", ")}`);
  console.log("");
  for (const c of byCase) {
    if (onlyFailures && !c.failed.length) continue;
    const mark = c.failed.length ? "FAIL" : " ok ";
    console.log(`${mark} ${c.id.padEnd(34)} ${String(c.passed).padStart(2)}/${String(c.of).padEnd(2)}`);
    for (const f of c.failed) console.log(`       - ${f}`);
  }
  const pct = (n, d) => `${((100 * n) / d).toFixed(1)}%`;
  console.log(`\ncases fully correct : ${totals.clean}/${totals.cases}  (${pct(totals.clean, totals.cases)})`);
  console.log(`expectations met    : ${totals.passed}/${totals.checks}  (${pct(totals.passed, totals.checks)})`);
  console.log(`domain-reviewed     : ${totals.reviewed}/${totals.cases}  (${pct(totals.reviewed, totals.cases)})`);
  if (totals.reviewed < totals.cases) {
    console.log("\nUnreviewed expectations are the author's judgement, not verified science.");
    console.log("A case is only evidence once someone who does this work has checked what it asks for.");
  }
}

process.exitCode = 0;
