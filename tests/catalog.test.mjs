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
