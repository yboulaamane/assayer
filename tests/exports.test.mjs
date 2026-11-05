import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  pythonAllows, environmentFor, toolHealth, methodsDraft, citeFromCrossref,
  bibtexFromCrossref, bibtexFallback, QUIET_MONTHS, PYTHON_CAP,
} from "../web/assets/exports.js";
import { RECIPES, MODULES, REFERENCES } from "../web/assets/modules.js";

const cat = JSON.parse(readFileSync(new URL("../web/catalog.json", import.meta.url)));

// The page's own name lookup (lookupTool in app.js): name, squashed name, repo basename.
const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const BY_NAME = new Map();
for (const t of cat.tools) {
  for (const k of [norm(t.name), norm(t.name).replace(/\s+/g, ""), t.repo && norm(t.repo.split("/")[1])]) {
    if (k && !BY_NAME.has(k)) BY_NAME.set(k, t);
  }
}
const lookup = (n) => BY_NAME.get(norm(n)) || BY_NAME.get(norm(n).replace(/\s+/g, "")) || null;
const recipePlan = (id) => ({ id, label: RECIPES[id].label, steps: RECIPES[id].modules.map((m) => MODULES[m]).filter(Boolean) });
const planTools = (plan) => [...new Set(plan.steps.flatMap((s) => s.tools || []))].map((name) => ({ name, entry: lookup(name) }));

/* ------------------------------------------------------------ python ranges */
test("Python ranges are read the way pip reads them", () => {
  const cases = [
    [">=3.10", 9, false], [">=3.10", 10, true], [">=3.10.4", 10, true],
    ["<3.11,>=3.8", 10, true], ["<3.11,>=3.8", 11, false], ["<3.14,>=3.11", 13, true],
    ["==3.10.*", 10, true], ["==3.10.*", 11, false], ["~=3.13.0", 13, true], ["~=3.13.0", 12, false],
    ["~=3.9", 12, true], [">=2.7, !=3.0.*, !=3.1.*, <4", 12, true], ["<3.12,>=3.7", 12, false],
  ];
  for (const [spec, minor, want] of cases) assert.equal(pythonAllows(spec, minor), want, `${spec} vs 3.${minor}`);
  assert.equal(pythonAllows("not a range", 10), null);
});

test("every Python range in the catalogue can be read", () => {
  const unread = cat.tools.filter((t) => t.python && pythonAllows(t.python, 11) === null).map((t) => `${t.name}: ${t.python}`);
  assert.deepEqual(unread, []);
});

/* -------------------------------------------------------------- environment */
test("the environment file installs only verified packages, conda-forge first", () => {
  const tools = [
    { name: "A", entry: { name: "A", conda: "a-conda", pypi: "a-pypi", python: ">=3.9" } },
    { name: "B", entry: { name: "B", pypi: "b-pypi", python: ">=3.10" } },
    { name: "C", entry: { name: "C", repo: "org/c" } },
    { name: "D", entry: null },
  ];
  const env = environmentFor("x", "X", tools);
  assert.match(env.yaml, /^  - a-conda/m);
  assert.doesNotMatch(env.yaml, /a-pypi/);
  assert.match(env.yaml, /^    - b-pypi/m);
  assert.match(env.yaml, /#   C: see https:\/\/github.com\/org\/c/);
  assert.match(env.yaml, /#   D$/m);
  assert.equal(env.python, `3.${PYTHON_CAP}`);
  assert.equal(env.installed, 2);
});

test("a Python range that cannot be met is named, not silently broken", () => {
  const tools = [
    { name: "Old", entry: { name: "Old", conda: "old", python: "<3.11,>=3.8" } },
    { name: "New1", entry: { name: "New1", conda: "new1", python: ">=3.11" } },
    { name: "New2", entry: { name: "New2", pypi: "new2", python: ">=3.11" } },
  ];
  const env = environmentFor("x", "X", tools);
  assert.equal(env.python, "3.12");
  assert.deepEqual(env.conflicts.map((c) => c.name), ["Old"]);
  assert.match(env.yaml, /#   Old: Python <3.11,>=3.8/);
});

test("every protocol produces an environment file built from catalogue packages", () => {
  const known = new Set(cat.tools.flatMap((t) => [t.conda, t.pypi]).filter(Boolean));
  for (const id of Object.keys(RECIPES)) {
    const env = environmentFor(id, RECIPES[id].label, planTools(recipePlan(id)));
    assert.doesNotMatch(env.yaml, /undefined|null/, id);
    assert.match(env.yaml, /^  - python=3\.\d+$/m, id);
    const pkgs = [...env.yaml.split("dependencies:")[1].matchAll(/^ {2,4}- ([^\s#]+)/gm)].map((m) => m[1])
      .filter((p) => p !== "pip" && p !== "pip:" && !p.startsWith("python="));
    for (const p of pkgs) assert.ok(known.has(p), `${id}: ${p} is not a verified catalogue package`);
  }
});

/* ------------------------------------------------------------------- health */
test("maintenance is measured from when the dates were read", () => {
  assert.equal(toolHealth({ repo_archived: true }, "2026-11-01").state, "archived");
  assert.equal(toolHealth({ archived: true }, "2026-11-01").state, "archived");
  assert.equal(toolHealth({ pushed: "2026-10-01" }, "2026-11-01").state, "active");
  assert.equal(toolHealth({ pushed: "2024-12-01" }, "2026-11-01").state, "active");
  assert.equal(toolHealth({ pushed: "2024-11-01" }, "2026-11-01").state, "quiet");
  assert.equal(toolHealth({}, "2026-11-01"), null);
  assert.equal(QUIET_MONTHS, 24);
});

test("the catalogue carries push dates in a form the page can read", () => {
  assert.match(cat.health_as_of, /^\d{4}-\d{2}-\d{2}$/);
  const bad = cat.tools.filter((t) => t.pushed && !/^\d{4}-\d{2}-\d{2}$/.test(t.pushed)).map((t) => t.name);
  assert.deepEqual(bad, []);
  assert.ok(cat.tools.some((t) => t.pushed), "no push dates reached the catalogue");
  // A date belongs to the entry's own repository, never to a same-named fork merged in by name.
  assert.deepEqual(cat.tools.filter((t) => (t.pushed || t.repo_archived) && !t.repo).map((t) => t.name), []);
  const core = JSON.parse(readFileSync(new URL("../web/catalog-core.json", import.meta.url)));
  assert.equal(core.health_as_of, cat.health_as_of, "the page reads the as-of date from the core file");
});

/* ------------------------------------------------------------------ methods */
test("the methods draft cites gate papers only from the checked registry", () => {
  for (const id of Object.keys(RECIPES)) {
    const plan = recipePlan(id);
    const byName = new Map(planTools(plan).filter((x) => x.entry).map((x) => [x.name, x.entry]));
    const { paragraphs, refs } = methodsDraft(plan, byName, REFERENCES);
    assert.match(paragraphs[0], /^DRAFT/, id);
    assert.equal(paragraphs.length, plan.steps.length + 1, id);
    refs.forEach((r, i) => assert.equal(r.n, i + 1, id));
    const checked = new Set(Object.values(REFERENCES).map((r) => r.doi));
    for (const r of refs.filter((x) => x.kind === "gate")) assert.ok(checked.has(r.doi), `${id}: ${r.doi}`);
    for (const r of refs.filter((x) => x.kind === "tool" && x.doi)) assert.match(r.source, /not checked/, id);
    // Every [n] in the text points at a reference that exists.
    for (const m of paragraphs.join(" ").matchAll(/\[(\d+(?:, \d+)*)\]/g)) {
      for (const n of m[1].split(", ")) assert.ok(Number(n) <= refs.length, `${id}: [${n}]`);
    }
    assert.doesNotMatch(paragraphs.join(" "), /—/, `${id}: em dash in generated text`);
  }
});

const WORK = {
  DOI: "10.1006/jmbi.1996.0897", type: "journal-article",
  title: ["Development and validation of a genetic algorithm for flexible docking"],
  author: [{ family: "Jones", given: "Gareth" }, { family: "Willett", given: "Peter" }, { family: "Glen", given: "Robert C." }],
  "container-title": ["Journal of Molecular Biology"], "short-container-title": ["J Mol Biol"],
  volume: "267", issue: "3", page: "727-748", issued: { "date-parts": [[1997, 4]] },
};

test("Crossref records become a short citation and a BibTeX entry", () => {
  assert.equal(citeFromCrossref(WORK), "Jones et al. (1997) J Mol Biol 267:727-748");
  const b = bibtexFromCrossref(WORK, "GOLD");
  assert.match(b, /^@article\{jones1997,/);
  assert.match(b, /author = \{Jones, Gareth and Willett, Peter and Glen, Robert C\.\}/);
  assert.match(b, /pages = \{727--748\}/);
  assert.match(b, /doi = \{10.1006\/jmbi.1996.0897\}/);
  assert.match(bibtexFallback({ name: "Tool_X", doi: "10.1/x" }), /title = \{Tool\\_X\}[\s\S]*Could not be fetched from Crossref/);
  assert.match(bibtexFallback({ name: "Y", url: "https://y.org" }), /howpublished = \{\\url\{https:\/\/y.org\}\}/);
});
