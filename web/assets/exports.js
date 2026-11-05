// What a plan or a tool card can hand back to the reader: an environment file,
// a draft methods section with its references, and a maintenance signal.
//
// Pure functions only. The page does the fetching (catalogue shards, Crossref)
// and passes the results in, so everything here runs the same under node --test.

/* ------------------------------------------------------------------ health */

// Working default, not a cited threshold: two years without a push is long
// enough that a reader should check the tool still runs before relying on it.
export const QUIET_MONTHS = 24;

const monthsBetween = (from, to) => {
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  return (ty - fy) * 12 + (tm - fm);
};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const monthYear = (iso) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;

/**
 * Maintenance state for a tool, measured from the date the push dates were
 * read (`asOf`), never from today: the data does not get older on its own.
 * Returns null when there is nothing to say.
 */
export function toolHealth(t, asOf) {
  if (t.archived || t.repo_archived) {
    return { state: "archived", label: "archived",
             detail: "The repository is archived on GitHub: read-only, no further updates." };
  }
  if (!t.pushed) return null;
  const quiet = asOf ? monthsBetween(t.pushed, asOf) >= QUIET_MONTHS : false;
  return quiet
    ? { state: "quiet", label: `no GitHub commits since ${t.pushed.slice(0, 4)}`,
        detail: `Last commit to its GitHub repository ${monthYear(t.pushed)}. Some projects develop elsewhere ` +
                "and keep only a mirror on GitHub, so check the project's site, and that it still installs and runs, before relying on it." }
    : { state: "active", label: null, detail: `Last commit to its GitHub repository ${monthYear(t.pushed)}.` };
}

/* ------------------------------------------------------------- environment */

// Python minors a generated environment may pin. The cap is a working default,
// not a cited threshold: the newest releases often lack wheels for scientific
// packages, so the file prefers the newest version at or below it.
export const PYTHON_CANDIDATES = [8, 9, 10, 11, 12, 13, 14];
export const PYTHON_CAP = 12;

const parseVer = (s) => s.split(".").map((x) => Number(x));
const cmp = (a, b) => {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d) return d;
  }
  return 0;
};
const prefix = (v, p) => p.every((x, i) => v[i] === x);

/**
 * Does Python 3.<minor> satisfy a PEP 440 specifier such as ">=3.9,<3.12"?
 * A minor counts as allowed if any of its patch releases would be, so lower
 * bounds compare against 3.<minor>.99 and upper bounds against 3.<minor>.0.
 * Returns null when the specifier cannot be read.
 */
export function pythonAllows(spec, minor) {
  const lo = [3, minor, 99], hi = [3, minor, 0];
  for (const raw of String(spec).split(",")) {
    const c = raw.trim();
    if (!c) continue;
    const m = c.match(/^(~=|===|==|!=|<=|>=|<|>)\s*([0-9]+(?:\.[0-9]+)*)(\.\*)?$/);
    if (!m) return null;
    const [, op, ver, wild] = m;
    const v = parseVer(ver);
    let ok;
    if (op === "==" || op === "===") ok = wild || v.length < 3 ? prefix(hi, v) : cmp(hi, v) <= 0 && cmp(lo, v) >= 0;
    else if (op === "!=") ok = wild || v.length < 3 ? !prefix(hi, v) : true;
    else if (op === ">=") ok = cmp(lo, v) >= 0;
    else if (op === ">") ok = cmp(lo, v) > 0;
    else if (op === "<=") ok = cmp(hi, v) <= 0;
    else if (op === "<") ok = cmp(hi, v) < 0;
    else if (op === "~=") ok = cmp(lo, v) >= 0 && prefix(hi, v.slice(0, Math.max(1, v.length - 1)));
    if (!ok) return false;
  }
  return true;
}

/**
 * Build a conda environment file for the tools a plan names.
 *
 * `tools` is [{name, entry}] where entry is the catalogue record (with its
 * detail fields loaded) or null when the name is not catalogued. Only verified
 * package names go in: conda-forge first, PyPI otherwise. Everything else is
 * listed as a comment saying how to get it.
 */
export function environmentFor(planId, planLabel, tools) {
  const conda = new Map(), pip = new Map(), manual = [], unknown = [], specs = [];
  for (const { name, entry } of tools) {
    if (!entry) { unknown.push(name); continue; }
    if (entry.conda) conda.set(entry.conda, entry.name);
    else if (entry.pypi) pip.set(entry.pypi, entry.name);
    else manual.push(entry);
    if ((entry.conda || entry.pypi) && entry.python) specs.push({ name: entry.name, spec: entry.python });
  }

  // Pick the Python every declared range allows; if none does, the one most of
  // them allow, and name the tools that need an environment of their own.
  const readable = specs.filter((s) => pythonAllows(s.spec, PYTHON_CAP) !== null);
  const unreadable = specs.filter((s) => pythonAllows(s.spec, PYTHON_CAP) === null);
  const fits = (minor) => readable.filter((s) => pythonAllows(s.spec, minor));
  const prefer = (a, b) => (a <= PYTHON_CAP) !== (b <= PYTHON_CAP) ? (a <= PYTHON_CAP ? a : b) : Math.max(a, b);
  let python = null;
  for (const minor of PYTHON_CANDIDATES) {
    const n = fits(minor).length, best = python === null ? -1 : fits(python).length;
    if (n > best || (n === best && prefer(minor, python) === minor)) python = minor;
  }
  const conflicts = readable.filter((s) => !pythonAllows(s.spec, python));

  const slug = String(planId || "plan").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const L = [
    `# Environment for: ${planLabel}`,
    "# Generated by Assayer (https://assayer.vercel.app) from the tools this plan names.",
    "# Package names are checked against conda-forge and PyPI. Python ranges are what",
    "# each package declares on PyPI; a conda-forge build can differ, so test the solve.",
    `name: assayer-${slug}`,
    "channels:",
    "  - conda-forge",
    "dependencies:",
    `  - python=3.${python}`,
  ];
  for (const [pkg, who] of conda) L.push(`  - ${pkg}${pkg.toLowerCase() === who.toLowerCase() ? "" : `  # ${who}`}`);
  if (pip.size) {
    L.push("  - pip", "  - pip:");
    for (const [pkg, who] of pip) L.push(`    - ${pkg}${pkg.toLowerCase() === who.toLowerCase() ? "" : `  # ${who}`}`);
  }
  if (conflicts.length) {
    L.push("", `# Python 3.${python} is outside what these declare; give them their own environment:`);
    for (const c of conflicts) L.push(`#   ${c.name}: Python ${c.spec}`);
  }
  if (manual.length) {
    L.push("", "# No verified conda-forge or PyPI package (a database, web service, desktop app,", "# or software that installs another way), so not installed by this file:");
    for (const t of manual) {
      L.push(`#   ${t.name}: see ${t.repo ? `https://github.com/${t.repo}` : (t.url || "its project page")}`);
    }
  }
  if (unknown.length) {
    L.push("", "# Named by the plan but not in the catalogue:");
    for (const n of unknown) L.push(`#   ${n}`);
  }
  return {
    yaml: L.join("\n") + "\n",
    filename: `assayer-${slug}-environment.yml`,
    python: `3.${python}`,
    installed: conda.size + pip.size,
    conflicts, manual: manual.map((t) => t.name), unknown, unreadable,
    cappedBy: python === PYTHON_CAP && fits(PYTHON_CAP + 1).length === fits(PYTHON_CAP).length,
  };
}

/* ----------------------------------------------------------------- methods */

const doiOf = (url) => (url || "").replace(/^https?:\/\/(dx\.)?doi\.org\//i, "") || null;

/**
 * A draft methods section for a plan: one sentence per step naming its tools,
 * the step's acceptance criterion where it cites a paper, and a numbered
 * reference list. Tool DOIs are the ones the source registry lists for the
 * tool; gate references are the ones checked against Crossref in modules.js.
 */
export function methodsDraft(plan, toolsByName, references) {
  const refs = [], index = new Map();
  const cite = (key, make) => {
    if (!index.has(key)) { refs.push({ n: refs.length + 1, ...make() }); index.set(key, refs.length); }
    return index.get(key);
  };
  const toolRef = (name) => {
    const t = toolsByName.get(name);
    if (!t) return null;
    const doi = doiOf(t.paper_url);
    return cite(`tool:${t.id}`, () => ({
      kind: "tool", name: t.name, doi,
      url: doi ? null : (t.code_url || t.url || null),
      // Only the bio.tools layer carries papers, matched to curated entries by
      // name or repository. That match can be wrong, so say where it came from.
      source: doi ? "DOI from the tool's bio.tools record, not checked" : "no paper recorded; cite the software",
    }));
  };

  const paras = [
    `DRAFT generated by Assayer from the "${plan.label}" protocol (https://assayer.vercel.app). ` +
    "Edit it to describe what you actually ran, and delete any step or tool you did not use. " +
    "Tool references come from registry records and have not been checked: confirm each is the paper the authors ask you to cite.",
  ];
  plan.steps.forEach((s, i) => {
    const names = [...new Set(s.tools || [])];
    const tools = names.map((n) => {
      const k = toolRef(n);
      return k ? `${toolsByName.get(n).name} [${k}]` : n;
    });
    let line = `Step ${i + 1}, ${s.title}${tools.length ? ` (tools: ${tools.join(", ")})` : ""}.`;
    const gateRefs = (s.refs || []).filter((r) => references[r]);
    if (s.gate && gateRefs.length) {
      const ks = gateRefs.map((r) => cite(`ref:${r}`, () => ({
        kind: "gate", name: references[r].cite, doi: references[r].doi, url: null,
        source: "checked against Crossref for this criterion", cite: references[r].cite,
      })));
      line += ` Acceptance criterion: ${s.gate} [${ks.join(", ")}]`;
      if (!/[.!?]$/.test(line)) line += ".";
    }
    paras.push(line);
  });
  return { paragraphs: paras, refs };
}

/** "Jones et al. (1997) J Mol Biol 267:727-748" from a Crossref work record. */
export function citeFromCrossref(m) {
  const fam = (m.author || []).map((a) => a.family || a.name).filter(Boolean);
  const who = fam.length > 2 ? `${fam[0]} et al.` : fam.length === 2 ? `${fam[0]} & ${fam[1]}` : (fam[0] || "Anonymous");
  const year = (m.issued?.["date-parts"] || [[]])[0][0] ?? "n.d.";
  const where = (m["short-container-title"] || [])[0] || (m["container-title"] || [])[0] || m.publisher || "";
  const vol = m.volume ? ` ${m.volume}${m.page ? `:${m.page}` : ""}` : (m.page ? ` ${m.page}` : "");
  return `${who} (${year}) ${where}${vol}`.trim();
}

const bib = (s) => String(s).replace(/[{}]/g, "").replace(/([&%$#_])/g, "\\$1");
const keyFor = (name, year) => `${String(name).toLowerCase().replace(/[^a-z0-9]+/g, "")}${year || ""}`;

/** One BibTeX entry from a Crossref work record. */
export function bibtexFromCrossref(m, label) {
  const year = (m.issued?.["date-parts"] || [[]])[0][0];
  const first = (m.author || [])[0]?.family || label;
  const type = m.type === "journal-article" ? "article" : "misc";
  const f = [
    ["author", (m.author || []).map((a) => a.family ? `${a.family}, ${a.given || ""}`.trim().replace(/,$/, "") : a.name).filter(Boolean).join(" and ")],
    ["title", (m.title || [])[0]],
    [type === "article" ? "journal" : "howpublished", (m["container-title"] || [])[0] || m.publisher],
    ["year", year], ["volume", m.volume], ["number", m.issue], ["pages", m.page && m.page.replace(/-/g, "--")],
    ["doi", m.DOI],
  ].filter(([, v]) => v);
  return `@${type}{${keyFor(first, year)},\n${f.map(([k, v]) => `  ${k} = {${k === "doi" ? v : bib(v)}}`).join(",\n")}\n}`;
}

/** A BibTeX entry for a reference Crossref could not supply. */
export function bibtexFallback(ref) {
  const f = [["title", bib(ref.name)], ref.doi ? ["doi", ref.doi] : ["howpublished", `\\url{${ref.url || ""}}`],
             ["note", ref.doi ? "Could not be fetched from Crossref; check the details by hand" : "Software"]];
  return `@misc{${keyFor(ref.name)},\n${f.map(([k, v]) => `  ${k} = {${v}}`).join(",\n")}\n}`;
}
