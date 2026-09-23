import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

// Scheduled workflows fail where nobody is watching, so the mistakes that can
// be seen from the file are checked here instead of at 04:00 on the 1st.

const dir = new URL("../.github/workflows/", import.meta.url);
const workflows = readdirSync(dir).filter((f) => /\.ya?ml$/.test(f))
  .map((f) => ({ name: f, src: readFileSync(new URL(f, dir), "utf8") }));

test("every label a workflow applies, it also creates", () => {
  // gh fails on a label the repository does not have. refresh-catalogue.yml
  // shipped asking for "catalogue" without creating it, which would have
  // failed its first run after pushing the branch.
  const missing = [];
  for (const { name, src } of workflows) {
    for (const [, label] of src.matchAll(/--label\s+["']?([\w-]+)["']?/g)) {
      if (!new RegExp(`gh label create\\s+["']?${label}["']?\\b`).test(src)) {
        missing.push(`${name} applies "${label}" but never creates it`);
      }
    }
  }
  assert.deepEqual(missing, []);
  assert.ok(workflows.length >= 2, "expected the link-check and refresh workflows");
});

test("a label is created before anything is pushed", () => {
  for (const { name, src } of workflows) {
    const create = src.indexOf("gh label create");
    const push = src.indexOf("git push");
    if (create < 0 || push < 0) continue;
    assert.ok(create < push, `${name} pushes before creating its label`);
  }
});
