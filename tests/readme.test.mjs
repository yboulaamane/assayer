import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { MODULES, RECIPES } from "../web/assets/modules.js";

// The README's figures are written by scripts/readme_counts.py at the end of
// every build. This recomputes each one independently -- the registry figures
// from the real import rather than by counting source lines -- so a bug in the
// generator cannot pass by agreeing with itself.

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const json = (p) => JSON.parse(read(p));
const FIX = "run: python3 scripts/readme_counts.py";
const readme = read("README.md");
const markers = [...readme.matchAll(/<!--n:([\w-]+)-->(.*?)<!--\/n-->/g)]
  .map((m) => ({ key: m[1], shown: m[2] }));

function truth() {
  const cat = json("web/catalog.json");
  const tools = cat.tools;
  const index = json("data/tools_index.json");
  const rows = (d) => (Array.isArray(d) ? d : d.tools || d.repos || []);
  const stars = rows(json("data/github_stars_yboulaamane.json"));
  const packaged = (t) => Boolean(t.pypi || t.conda);
  const curated = tools.filter((t) => t.curated).length;
  const keptStars = index.filter((r) => r.source.startsWith("github-stars")).length;
  const topics = (script) => {
    const m = read(`scripts/${script}`).match(/^TOPICS\s*=\s*\[([\s\S]*?)^\]/m);
    return (m[1].match(/"[^"]+"/g) || []).length;
  };
  const cases = json("evals/cases.json").cases;
  const baseline = json("evals/baseline.json");
  const modules = Object.values(MODULES);
  return {
    tools: tools.length,
    curated,
    listed: tools.length - curated,
    excluded: json("data/excluded.json").entries.length,
    stages: cat.stages.filter((s) => s.count).length,
    packages: tools.filter(packaged).length,
    python: tools.filter((t) => t.python).length,
    no_install: tools.filter((t) => !t.repo && !packaged(t)).length,
    snippets: tools.filter((t) => t.snippet).length,
    quickstarts: tools.filter((t) => t.quickstart).length,
    index_rows: index.length,
    // An empty array is truthy in JS and falsy in Python; count what is in it.
    multi_source: index.filter((r) => (r.also_in || []).length).length,
    biotools_rows: rows(json("data/biotools.json")).length,
    github_rows: rows(json("data/github_topics.json")).length,
    curated_rows: index.filter((r) => r.source === "curated").length,
    stars_rows: keptStars,
    stars_dropped: stars.length - keptStars,
    biotools_topics: topics("scrape_biotools.py"),
    github_topics: topics("scrape_github_topics.py"),
    protocols: Object.keys(RECIPES).length,
    modules: modules.length,
    pitfalls: modules.filter((m) => m.pitfall).length,
    eval_cases: cases.length,
    eval_reviewed: cases.filter((c) => c.reviewed).length,
    eval_checks: baseline.checks,
    eval_passed: baseline.passed,
  };
}

const fmt = (v) => Number(v).toLocaleString("en");

test("every figure the README maintains is true", () => {
  const t = truth();
  const wrong = markers
    .filter(({ key, shown }) => key in t && shown !== fmt(t[key]))
    .map(({ key, shown }) => `${key}: README says ${shown}, the data says ${fmt(t[key])}`);
  assert.deepEqual(wrong, [], FIX);
});

test("every marker names a figure that can be checked", () => {
  const t = truth();
  const unknown = [...new Set(markers.map((m) => m.key))].filter((k) => !(k in t));
  // An unchecked marker is a number that looks maintained and is not.
  assert.deepEqual(unknown, [], "add it to truth() here and to figures() in readme_counts.py");
  assert.ok(markers.length >= 30, `only ${markers.length} maintained figures found`);
  // A marker split across a line wrap never matches, so it would never update.
  assert.equal((readme.match(/<!--n:/g) || []).length, markers.length,
               "an inline marker is not closed on the line it opens");
});

test("the generated stage table matches the catalogue", () => {
  const block = readme.match(/<!--block:stages-->\n([\s\S]*?)\n<!--\/block:stages-->/);
  assert.ok(block, "the stages block is missing");
  const cat = json("web/catalog.json");
  const missing = cat.stages.filter((s) => s.count)
    .filter((s) => !block[1].includes(`| ${s.label} | ${s.curated} | ${s.count} |`))
    .map((s) => `${s.label}: ${s.curated} curated, ${s.count} listed`);
  assert.deepEqual(missing, [], FIX);

  // The paragraph under the table is generated too, and its figures are plain
  // text rather than markers, so check each one against the data directly.
  const t = truth();
  const expected = [
    `${t.curated} of the ${fmt(t.tools)} entries`,
    `${t.packages} carry a verified`,
    `${t.python} a Python version`,
    `${t.snippets} have a hand-written example`,
    `and ${t.quickstarts} quote one`,
  ];
  const absent = expected.filter((phrase) => !block[1].includes(phrase));
  assert.deepEqual(absent, [], FIX);
});

test("the running totals are not also typed into the prose", () => {
  // A figure written outside a marker is the one that goes stale. Strip every
  // maintained region and look for the current totals in what is left.
  const t = truth();
  const prose = readme
    .replace(/<!--block:(\w+)-->[\s\S]*?<!--\/block:\1-->/g, "")
    .replace(/<!--n:[\w-]+-->.*?<!--\/n-->/g, "");
  const typed = [
    ["tools", fmt(t.tools)], ["listed", fmt(t.listed)], ["excluded", fmt(t.excluded)],
  ].filter(([, v]) => new RegExp(`(?<![\\d,.])${v.replace(",", "\\,")}(?![\\d,])`).test(prose));
  assert.deepEqual(typed.map(([k, v]) => `${k} (${v}) appears unmarked`), [],
                   "wrap it in <!--n:key-->...<!--/n--> so the build can maintain it");
});

test("the build rewrites the README and the refresh proposes it", () => {
  const build = read("scripts/build_catalog.py");
  assert.match(build, /readme_counts\.update\(\)/, "build_catalog.py must update the README");
  const refresh = read(".github/workflows/refresh-catalogue.yml");
  assert.match(refresh, /git diff --quiet -- [^\n]*README\.md/,
               "the refresh would not notice a README-only change");
  assert.match(refresh, /git add [^\n]*README\.md/,
               "the refresh pull request would leave the README behind");
});
