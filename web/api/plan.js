// Module selection: let the model choose the steps, not just the protocol.
//
// The routing endpoint picks one of eighteen protocols, which is roughly four
// bits of freedom — every word of the resulting plan was written in advance.
// This endpoint hands the model the whole registry and asks which modules this
// particular request needs, in what order, and why each one.
//
// What keeps that safe is that the model returns ids and nothing else. It never
// writes a step, a gate, a threshold or a tool name; those come from the
// curated registry, which lives here on the server and is never supplied by the
// caller. An id that does not exist is discarded, an excluded method is dropped,
// a missing control is put back, and the assembled plan has to pass the same
// validator as the curated one before the page will show it. A confused model
// therefore produces a worse selection, not an invented protocol.
//
// Environment variables are the same ones route.js reads; see ./_llm.js.

import { MODULES, RECIPES } from "../assets/modules.js";
import { ask, parseObject, configured, json } from "./_llm.js";

export const config = { runtime: "edge" };

// The registry, compact enough to send in full on every call. Sending all of it
// is the point: choosing across protocols is what a fixed recipe cannot do.
const CATALOGUE = Object.entries(MODULES)
  .map(([id, m]) => `${id} | ${m.family} | ${m.title} | needs: ${m.requires.join(", ") || "nothing"} | gives: ${m.produces.join(", ") || "nothing"}`)
  .join("\n");

const ROUTES = Object.entries(RECIPES)
  .map(([id, r]) => `${id}: ${r.modules.join(" -> ")}`)
  .join("\n");

const RULES = `You are planning computational drug-discovery work for a medicinal or computational chemist.

Choose the modules this specific request needs. Return JSON only.

MODULE REGISTRY (id | family | title | needs | gives):
${CATALOGUE}

CURATED ORDERINGS, as reference for what a sound plan of each kind looks like:
${ROUTES}

Return exactly:
{"understood": "<one sentence restating what they asked for, in your words>",
 "modules": [{"id": "<exact id from the registry>", "why": "<why this step for THIS case, max 20 words>"}],
 "questions": ["<max 2 questions, only where the answer would change which modules apply>"],
 "assumptions": ["<max 3 things you assumed because they were not stated>"],
 "unsupported": false}

Rules:
- Use ONLY ids that appear in the registry above, spelled exactly. Never invent an id, a tool, a threshold or a step.
- Select the smallest set that can actually produce the requested result. Order them so each module's "needs" are met by an earlier module's "gives", or by something the user already has.
- Start from the curated ordering for the closest route, then add, drop and reorder for what this request actually says. Draw modules from several routes when the request spans them.
- Respect exclusions absolutely. If they ruled out a method, select nothing from that family.
- Do not re-do work they say is already done. Treat what they have as an input, but keep any step that checks it is usable.
- Keep the controls. A screen needs its redock and enrichment checks, a model needs its split and applicability domain, a simulation needs its convergence check. Never drop a step whose absence would make the rest unfalsifiable.
- Use the evidence given below. No experimental structure changes which modules apply; do not treat an empty structure list as proof none exists.
- Ask a question only when the answer changes the module set. Never ask for information already in the request.
- Set unsupported true, with an empty module list, when the registry cannot address the request at all.
- "why" is about this case. Do not restate the module title.`;

function brief(input) {
  const b = input.brief || {};
  const lines = [`Request: "${String(input.query || "").slice(0, 1500)}"`];
  lines.push(`Closest route from the router: ${b.intent || "unknown"}`);
  if (b.target) lines.push(`Target named: ${b.target}${b.organism ? ` in ${b.organism}` : ""}`);
  if (b.excluded?.length) lines.push(`Ruled out (absolute): ${b.excluded.join(", ")}`);
  if (b.assets?.length) lines.push(`Already has: ${b.assets.join(", ")}`);
  if (b.missing?.length) lines.push(`Stated as unavailable: ${b.missing.join(", ")}`);
  if (b.offTargets?.length) lines.push(`Must spare: ${b.offTargets.join(", ")}`);
  if (b.metal?.length) lines.push(`Metal centre mentioned: ${b.metal.join(", ")}`);
  if (b.compute?.length) lines.push(`Compute limit: ${b.compute.join(", ")}`);
  if (b.time?.length) lines.push(`Time limit: ${b.time.join(", ")}`);

  // Evidence the router never had. A plan built before looking anything up is
  // the same plan for a target with 400 structures and one with none.
  const e = input.evidence || {};
  if (e.target) {
    lines.push(`Resolved target: ${e.target.name}${e.target.gene ? ` (${e.target.gene})` : ""}, ` +
      `${e.target.organism}, ${e.target.length} aa, UniProt ${e.target.accession}.`);
  }
  if (Array.isArray(e.structures) && e.structures.length) {
    lines.push(`Experimental structures available (${e.total ?? e.structures.length} total), best few:`);
    for (const s of e.structures.slice(0, 4)) {
      lines.push(`  ${s.id}: ${s.res ?? "?"} A, R-free ${s.rfree ?? "?"}, ${s.holo ? `holo (${s.ligand || "ligand"})` : "apo"}`);
    }
  } else if (e.target) {
    lines.push(`No experimental structure is linked to this entry. ${e.alphafold ? "An AlphaFold model exists." : "AlphaFold was not checked or returned nothing."}`);
  }
  return lines.join("\n");
}

const clean = (v, n) => (typeof v === "string" ? v.slice(0, n) : null);

export default async function handler(req) {
  if (req.method === "GET") {
    return json({ modules: Object.keys(MODULES).length, routes: Object.keys(RECIPES).length,
                  providers: configured().length });
  }
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!configured().length) return json({ error: "no LLM_API_KEY configured", fallback: true }, 501);

  let input;
  try {
    input = await req.json();
  } catch {
    return json({ error: "bad request body" }, 400);
  }
  if (typeof input?.query !== "string" || !input.query.trim()) {
    return json({ error: "empty query" }, 400);
  }

  // Selecting and justifying a dozen modules is a longer answer than routing,
  // and a reasoning model spends output tokens before any of it appears.
  const reply = await ask(`${RULES}\n\n${brief(input)}`, { timeout: 20000, maxTokens: 4096 });
  if (!reply.ok) {
    return json({ error: reply.error || reply.detail, model: reply.model, detail: reply.detail, fallback: true },
                reply.status || 502);
  }

  const parsed = parseObject(reply.text);
  if (!parsed) {
    return json({ error: "model did not return JSON", model: reply.model,
                  finish: reply.finish, fallback: true }, 502);
  }
  if (parsed.unsupported === true) {
    return json({ unsupported: true, understood: clean(parsed.understood, 400), model: reply.model });
  }

  // Filter to ids that exist before the client ever sees them. The client
  // checks again against the same registry; neither side trusts the model.
  const seen = new Set();
  const modules = (Array.isArray(parsed.modules) ? parsed.modules : [])
    .map((m) => (typeof m === "string" ? { id: m } : m))
    .filter((m) => m && typeof m.id === "string" && MODULES[m.id] && !seen.has(m.id) && seen.add(m.id))
    .slice(0, 24)
    .map((m) => ({ id: m.id, why: clean(m.why, 300) }));

  const unknown = (Array.isArray(parsed.modules) ? parsed.modules : [])
    .map((m) => (typeof m === "string" ? m : m?.id))
    .filter((id) => typeof id === "string" && !MODULES[id]);

  if (!modules.length) {
    return json({ error: "no usable modules selected", unknown: unknown.slice(0, 8),
                  model: reply.model, fallback: true }, 502);
  }

  const list = (v, n, len) => (Array.isArray(v) ? v : [])
    .filter((x) => typeof x === "string" && x.trim()).slice(0, n).map((x) => x.slice(0, len));

  return json({
    understood: clean(parsed.understood, 400),
    modules,
    questions: list(parsed.questions, 2, 200),
    assumptions: list(parsed.assumptions, 3, 200),
    unknown: unknown.slice(0, 8),
    model: reply.model,
    provider: reply.provider,
    truncated: String(input.query).length > 1500,
  });
}
