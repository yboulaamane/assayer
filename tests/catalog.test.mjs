import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { matchesAccess } from "../web/assets/catalog.js";

test("open-source filter includes explicit licences and their version suffixes", () => {
  for (const license of ["open-source", "MIT", "Apache-2.0", "BSD-3-Clause", "ISC",
    "GPL-3.0", "GPL-2.0-or-later", "AGPL-3.0-only", "LGPL-2.1+", " MPL-2.0 "]) {
    assert.equal(matchesAccess(license, "open-source"), true, license);
  }
});

test("unknown, restricted and free downloads are not assumed to be open source", () => {
  for (const license of [undefined, "NOASSERTION", "Not licensed", "Other", "Proprietary",
    "Free of charge", "Free of charge (with restrictions)", "CC-BY-NC-4.0", "GPL-3.0-custom"]) {
    assert.equal(matchesAccess(license, "open-source"), false, String(license));
  }
  assert.equal(matchesAccess(undefined, ""), true);
  assert.equal(matchesAccess("free-web", "free-web"), true);
  assert.equal(matchesAccess("Free of charge", "free-web"), false);
  assert.equal(matchesAccess("Proprietary", "commercial"), true);
});

const source = readFileSync(new URL("../web/assets/app.js", import.meta.url), "utf8")
  .replace(/^import .*\n/gm, "").replace(/\nboot\(\);\s*$/, "");

test("failed catalogue loads can retry successfully without duplicate routing", async () => {
  for (const failure of [
    async () => { throw new Error("offline"); },
    async () => ({ ok: false, status: 503 }),
    async () => ({ ok: true, json: async () => { throw new Error("invalid JSON"); } }),
    async () => ({ ok: true, json: async () => ({ error: "bad schema" }) }),
  ]) {
    const nodes = new Map();
    const get = (id) => {
      if (!nodes.has(id)) nodes.set(id, { innerHTML: "" });
      return nodes.get(id);
    };
    const events = [];
    const context = vm.createContext({
      document: { getElementById: get }, window: {},
      addEventListener: (name) => events.push(name),
      fetch: failure, AbortSignal,
    });
    vm.runInContext(source, context);
    vm.runInContext("route = () => { window.routed = true; }", context);
    await context.boot();
    assert.match(get("app").innerHTML, /Couldn't load the tool catalogue/);
    assert.equal(events.filter((x) => x === "hashchange").length, 0);
    context.fetch = async (_, options) => {
      assert.ok(options.signal instanceof AbortSignal);
      return { ok: true, json: async () => ({ stages: [], tools: [] }) };
    };
    await get("retry-catalog").onclick();
    assert.equal(context.window.routed, true);
    assert.equal(events.filter((x) => x === "hashchange").length, 1);
    assert.doesNotMatch(get("app").innerHTML, /Couldn't load/);
  }
});

// The catalogue is pruned at build time (scripts/build_catalog.py). These hold
// the prune to the two things it must never do: remove a tool a protocol
// recommends, or remove one a person curated.

test("the prune never removes a tool a protocol recommends", async () => {
  const { MODULES } = await import("../web/assets/modules.js");
  const cat = JSON.parse(readFileSync(new URL("../web/catalog.json", import.meta.url)));
  const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const known = new Set();
  for (const t of cat.tools) {
    known.add(norm(t.name));
    known.add(norm(t.name).replace(/\s+/g, ""));
    if (t.repo) known.add(norm(t.repo.split("/")[1]));
  }
  const missing = [];
  for (const [id, m] of Object.entries(MODULES)) {
    for (const tool of m.tools || []) {
      if (!known.has(norm(tool)) && !known.has(norm(tool).replace(/\s+/g, ""))) {
        missing.push(`${id} recommends ${tool}, which the catalogue no longer holds`);
      }
    }
  }
  // A plan that names a tool the catalogue has dropped renders a dead chip, and
  // tells the reader to use something this site will not describe.
  assert.deepEqual(missing, []);
});

test("nothing curated was pruned, and the excluded list says why for each row", () => {
  const cat = JSON.parse(readFileSync(new URL("../web/catalog.json", import.meta.url)));
  const curated = cat.tools.filter((t) => t.curated).length;
  assert.ok(curated >= 290, `curated entries fell to ${curated}`);

  const path = new URL("../data/excluded.json", import.meta.url);
  const dropped = JSON.parse(readFileSync(path));
  assert.equal(dropped.count, dropped.entries.length);
  for (const e of dropped.entries) {
    assert.ok(e.reason?.trim(), `${e.name} was dropped with no reason recorded`);
    assert.ok(e.name?.trim(), "an excluded row with no name cannot be reviewed");
  }
  // An exclusion rule that fires on nothing is a rule nobody can check.
  const reasons = new Set(dropped.entries.map((e) => e.reason.replace(/ \(.*\)$/, "")));
  assert.ok(reasons.size >= 4, `only ${reasons.size} distinct reasons fired`);
});

test("the stage a tool is filed under is one the catalogue lists", () => {
  const cat = JSON.parse(readFileSync(new URL("../web/catalog.json", import.meta.url)));
  const slugs = new Set(cat.stages.map((s) => s.slug));
  const orphans = cat.tools.filter((t) => !slugs.has(t.stage)).map((t) => `${t.name} -> ${t.stage}`);
  assert.deepEqual(orphans, []);
  // "Unsorted" is gone by construction: the gate drops what it cannot place.
  assert.ok(!slugs.has("other"), "the Unsorted bucket is back");
});

// Renders the real browse view over the real catalogue. The prune only pays off
// if the page is honest about which layer you are looking at, and that is markup,
// not data, so it needs rendering to check.

async function browseView(query, mangle) {
  const cat = JSON.parse(readFileSync(new URL("../web/catalog.json", import.meta.url)));
  if (mangle) mangle(cat);
  const nodes = new Map();
  const get = (id) => {
    if (!nodes.has(id)) {
      const node = {
        innerHTML: "", value: "", addEventListener() {}, focus() {},
        setSelectionRange() {},
        insertAdjacentHTML(_where, html) { node.innerHTML += html; },
      };
      nodes.set(id, node);
    }
    return nodes.get(id);
  };
  const context = vm.createContext({
    document: {
      getElementById: get,
      querySelectorAll: () => [],
      querySelector: () => null,
      documentElement: { dataset: {} },
      activeElement: { tagName: "BODY" },
    },
    window: {}, location: { hash: `#/browse?${query}` }, URLSearchParams,
    addEventListener() {}, setTimeout, clearTimeout, console,
    localStorage: { getItem: () => null, setItem() {} },
    matchMedia: () => ({ matches: false }),
    IntersectionObserver: class { observe() {} disconnect() {} },
    scrollTo() {},
    icon: () => "<svg></svg>",
    matchesAccess,
    PROTOCOL_LIST: () => [],
    fetch: async () => ({ ok: true, json: async () => cat }),
    AbortSignal,
  });
  vm.runInContext(source, context);
  vm.runInContext("route = () => {};", context);
  await context.boot();
  vm.runInContext(query === "HOME"
    ? "renderHome()"
    : `renderBrowse(new URLSearchParams(${JSON.stringify(query)}))`, context);
  // The cards land in #grid, which renderBrowse fills after writing #app.
  return { html: get("app").innerHTML + get("grid").innerHTML, cat };
}

test("browsing starts on the curated layer and says so", async () => {
  const { html, cat } = await browseView("");
  const curated = cat.tools.filter((t) => t.curated).length;
  const num = (v) => Number(v).toLocaleString("en");
  assert.match(html, new RegExp(`${num(curated)} chosen by hand`),
               "the note must state how many entries a person actually chose");
  assert.match(html, /Show all [\d,]+<\/a> to add the registry layer/);
  // Nothing from the registry layer may appear before the reader asks for it.
  const shownIds = [...html.matchAll(/data-id="([^"]+)"/g)].map((m) => m[1]);
  const byId = new Map(cat.tools.map((t) => [t.id, t]));
  const uncurated = shownIds.filter((id) => byId.get(id) && !byId.get(id).curated);
  assert.deepEqual(uncurated, [], "a scraped entry rendered on the default view");
  assert.ok(shownIds.length > 0);
});

test("the wider layer admits, in the page itself, that nobody read it", async () => {
  const { html, cat } = await browseView("src=all");
  assert.match(html, /filtered for relevance but not read by\s+anyone here/);
  assert.match(html, /Treat them as leads, not recommendations/);
  assert.match(html, new RegExp(`All ${Number(cat.tools.length).toLocaleString("en")} listed`));
});

test("a search that finds nothing curated points at the layer that has it", async () => {
  const cat = JSON.parse(readFileSync(new URL("../web/catalog.json", import.meta.url)));
  const scrapedOnly = cat.tools.find((t) => !t.curated && /^[A-Za-z][\w-]{5,}$/.test(t.name)
                                            && !cat.tools.some((o) => o.curated && o.name === t.name));
  assert.ok(scrapedOnly, "no registry-only tool to search for");
  const { html } = await browseView(`q=${encodeURIComponent(scrapedOnly.name)}`);
  assert.match(html, /Nothing curated matches that/);
  assert.match(html, /Show [\d,]+ in the wider registry/);
});

test("a curated card is marked as curated, and not as a warning", async () => {
  const { html } = await browseView("");
  assert.match(html, /<span class="pill curated">curated<\/span>/);
  assert.doesNotMatch(html, /pill star">standard/);
});

test("stage counts are computed, never defaulted to zero", async () => {
  // A catalogue built before the per-stage counts existed, or a stale cached
  // copy, used to render every stage as "0" because the fallback was a literal.
  // The tools are in hand either way, so the number is always computable.
  const strip = (h) => [...h.matchAll(/<span class="n"[^>]*>([^<]*)<\/span>/g)].map((m) => m[1]);

  const full = await browseView("HOME");
  const shown = strip(full.html).filter((x) => x !== "plan →");
  assert.ok(shown.length >= 15, `only ${shown.length} stage cards rendered`);
  assert.deepEqual(shown.filter((x) => x === "0"), [], "a stage card showed 0");

  const bare = await browseView("HOME", (cat) => {
    for (const s of cat.stages) { delete s.curated; delete s.count; }
  });
  const fallback = strip(bare.html).filter((x) => x !== "plan →");
  assert.deepEqual(fallback.filter((x) => x === "0"), [],
                   "a catalogue without per-stage counts still must not render 0");
  assert.deepEqual(fallback, shown, "computed counts must match the ones the build wrote");
});

test("a stage chip counts the layer the page is actually showing", async () => {
  const cur = await browseView("");
  const all = await browseView("src=all");
  const counts = (h) => Object.fromEntries(
    [...h.matchAll(/class="chip[^"]*"[^>]*>([^<]+)<span class="cnt">([^<]*)<\/span>/g)]
      .map((m) => [m[1], m[2]]));
  const a = counts(cur.html), b = counts(all.html);
  const label = Object.keys(a).find((k) => /Docking/.test(k));
  assert.ok(label, "no docking chip found");
  // Promising 576 and then showing 28 is the mismatch this guards against.
  assert.notEqual(a[label], b[label]);
  const curatedDocking = cur.cat.tools.filter((t) => t.curated && t.stage === "docking").length;
  assert.equal(Number(a[label]), curatedDocking);
  assert.equal(Number(b[label]), cur.cat.tools.filter((t) => t.stage === "docking").length);
});

// An archived entry is kept on purpose, and the page is honest about it only if
// the flag, the description and the card all agree.

test("an archived tool says so in its description and on its card", async () => {
  const cat = JSON.parse(readFileSync(new URL("../web/catalog.json", import.meta.url)));
  const flagged = cat.tools.filter((t) => t.archived);
  assert.ok(flagged.length >= 1, "no archived entries: the flag is not reaching the catalogue");
  const silent = flagged.filter((t) => !/archived/i.test(t.description || "")).map((t) => t.name);
  assert.deepEqual(silent, [], "flagged archived, but the description never tells the reader");
  // Only the curated layer is judged, so only it can carry the flag.
  assert.deepEqual(flagged.filter((t) => !t.curated).map((t) => t.name), []);

  // Search for each one: browse renders 60 cards and loads the rest on scroll,
  // which this harness never does.
  for (const t of flagged) {
    const { html } = await browseView(`q=${encodeURIComponent(t.name)}`);
    const card = html.split(`data-id="${t.id}"`)[1]?.split("</button>")[0] || "";
    assert.ok(card, `${t.name} did not render at all`);
    assert.match(card, /pill archived">archived/, `${t.name} is archived but its card does not say so`);
  }
});
