import test from "node:test";
import assert from "node:assert/strict";
import handler from "../web/api/route.js";

const original = {
  key: process.env.LLM_API_KEY,
  provider: process.env.LLM_PROVIDER,
  model: process.env.LLM_MODEL,
};
process.env.LLM_API_KEY = "gsk_test";
process.env.LLM_PROVIDER = "groq";
process.env.LLM_MODEL = "test-router";

test.after(() => {
  if (original.key == null) delete process.env.LLM_API_KEY; else process.env.LLM_API_KEY = original.key;
  if (original.provider == null) delete process.env.LLM_PROVIDER; else process.env.LLM_PROVIDER = original.provider;
  if (original.model == null) delete process.env.LLM_MODEL; else process.env.LLM_MODEL = original.model;
});

async function route(query, modelReply) {
  const oldFetch = globalThis.fetch;
  let sentPrompt = "";
  globalThis.fetch = async (_url, options) => {
    sentPrompt = JSON.parse(options.body).messages[0].content;
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(modelReply) } }] }), {
      headers: { "Content-Type": "application/json" },
    });
  };
  try {
    const response = await handler({ method: "POST", json: async () => ({ query }) });
    return { body: await response.json(), prompt: sentPrompt };
  } finally {
    globalThis.fetch = oldFetch;
  }
}

test("broad drug-discovery language cannot become generative design", async () => {
  const { body, prompt } = await route("Design a drug discovery workflow for Alzheimer's disease", {
    intent: "denovo", confidence: "high", evidence: "Design a drug discovery workflow",
    target: null, organism_taxid: 9606, reason: "drug design",
  });
  assert.equal(body.matched, false);
  assert.equal(body.intent, "unsupported");
  assert.match(prompt, /Never fill ambiguity with hit discovery or generative design/);

  const createWorkflow = await route("Create a workflow for EGFR", {
    intent: "denovo", confidence: "high", evidence: "Create a workflow",
    target: "EGFR", organism_taxid: 9606, reason: "create for EGFR",
  });
  assert.equal(createWorkflow.body.matched, false);
});

test("generic binding analysis cannot silently become hit discovery", async () => {
  const { body } = await route("Analyze binding of my compounds to EGFR", {
    intent: "hit-discovery", confidence: "high", evidence: "Analyze binding of my compounds",
    target: "EGFR", organism_taxid: 9606, reason: "binding analysis",
  });
  assert.equal(body.matched, false);
});

test("specific generation and hit-finding outcomes retain their routes", async () => {
  const generated = await route("Generate new inhibitor scaffolds for EGFR", {
    intent: "denovo", confidence: "high", evidence: "Generate new inhibitor scaffolds",
    target: "EGFR", organism_taxid: 9606, reason: "generate inhibitor scaffolds",
  });
  assert.equal(generated.body.intent, "denovo");
  assert.equal(generated.body.confidence, "high");

  const hits = await route("Find inhibitors of EGFR", {
    intent: "hit-discovery", confidence: "high", evidence: "Find inhibitors",
    target: "EGFR", organism_taxid: 9606, reason: "find EGFR inhibitors",
  });
  assert.equal(hits.body.intent, "hit-discovery");

  const excludedDocking = await route("Do not use docking; analyze my EGFR compounds", {
    intent: "hit-discovery", confidence: "high", evidence: "analyze my EGFR compounds",
    target: "EGFR", organism_taxid: 9606, reason: "analyze compounds",
  });
  assert.equal(excludedDocking.body.matched, false);
});

test("missing confidence or non-verbatim evidence is rejected", async () => {
  const missing = await route("Find inhibitors of EGFR", {
    intent: "hit-discovery", evidence: "Find inhibitors", target: "EGFR",
  });
  assert.equal(missing.body.matched, false);

  const invented = await route("Find inhibitors of EGFR", {
    intent: "hit-discovery", confidence: "high", evidence: "virtual screen a library", target: "EGFR",
  });
  assert.equal(invented.body.matched, false);
});
