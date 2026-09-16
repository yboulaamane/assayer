// Module selection: let the model choose the steps, not just the protocol.
//
// The routing endpoint picks one of twenty-six protocols, which is under five
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

// The registry goes in every prompt, so its wire format is a running cost.
// Free tiers meter tokens per minute: Groq's is 8,000, and a verbose digest of
// 122 modules plus all eighteen orderings ate most of that in one call, which
// meant the endpoint spent its life rate-limited and falling back. Terse field
// separators instead of prose labels, grouped by family so the family name is
// written once, and only the orderings that are actually near this request.
function digest(excluded = [], only = null) {
  const groups = new Map();
  for (const [id, m] of Object.entries(MODULES)) {
    // A family the user ruled out cannot be selected, so offering it only
    // invites a violation the server would have to strip out again.
    if (excluded.includes(m.family) || (m.methods || []).some((f) => excluded.includes(f))) continue;
    if (only && !only.has(id)) continue;
    if (!groups.has(m.family)) groups.set(m.family, []);
    groups.get(m.family).push(`${id}|${m.title}|<${m.requires.join(",") || "-"}|>${m.produces.join(",") || "-"}`);
  }
  return [...groups].map(([family, rows]) => `[${family}]\n${rows.join("\n")}`).join("\n");
}

/** The routed recipe, its nearest neighbours, and anything that feeds them.
 *
 *  Used only where the full registry will not fit the provider's per-minute
 *  budget. It is a smaller menu, not a different one: the ordering rules,
 *  validation and reinstated controls are identical either way.
 */
function nearby(intent, brief) {
  const keep = new Set(RECIPES[intent]?.modules || []);
  for (const [id, r] of neighbours(intent)) for (const m of r.modules) keep.add(m);
  // Concerns the recipe list does not carry.
  if (brief.metal?.length) for (const [id, m] of Object.entries(MODULES)) if (m.family === "metal") keep.add(id);
  if (brief.offTargets?.length) { keep.add("selectivity.define_panel"); keep.add("selectivity.compare_panel"); }
  // One hop of providers, so a prerequisite is always expressible.
  for (const id of [...keep]) {
    for (const need of MODULES[id]?.requires || []) {
      for (const [other, m] of Object.entries(MODULES)) {
        if (m.produces.includes(need)) keep.add(other);
      }
    }
  }
  return keep;
}

/** Recipes closest to this one, by how many modules they share with it. */
function neighbours(intent, limit = 3) {
  const here = new Set(RECIPES[intent]?.modules || []);
  return Object.entries(RECIPES)
    .filter(([id]) => id !== intent)
    .map(([id, r]) => [id, r, r.modules.filter((m) => here.has(m)).length])
    .sort((a, b) => b[2] - a[2])
    .slice(0, limit)
    .map(([id, r]) => [id, r]);
}

const blocked = (id, excluded) => {
  const m = MODULES[id];
  return !m || excluded.includes(m.family) || (m.methods || []).some((f) => excluded.includes(f));
};

/** The routed ordering plus its nearest neighbours, as grounding for shape.
 *
 *  Excluded modules are stripped here too. Printing them in an example
 *  sequence puts them back on the menu however firmly the rules say otherwise,
 *  and a selection the server then has to strip is a wasted call.
 */
function orderings(intent, excluded = []) {
  const rows = RECIPES[intent] ? [[intent, RECIPES[intent]]] : [];
  rows.push(...neighbours(intent));
  return rows
    .map(([id, r]) => [id, r.modules.filter((m) => !blocked(m, excluded))])
    .filter(([, mods]) => mods.length)
    .map(([id, mods]) => `${id}: ${mods.join(" -> ")}`)
    .join("\n");
}

const rules = (excluded, intent, only) => `You are planning computational drug-discovery work for a medicinal or computational chemist.

Choose the modules this specific request needs. Return JSON only.

MODULE REGISTRY, grouped by family. One module per line as:
  id|title|<what it needs|>what it gives     ("-" means none)
${digest(excluded, only)}

CURATED ORDERINGS, as reference for what a sound plan of this shape looks like:
${orderings(intent, excluded)}

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
    const full = rules([], "hit-discovery");
    const near = rules([], "hit-discovery", nearby("hit-discovery", {}));
    return json({ modules: Object.keys(MODULES).length, routes: Object.keys(RECIPES).length,
                  providers: configured().length,
                  fullPromptTokens: Math.round(full.length / 3.8),
                  narrowPromptTokens: Math.round(near.length / 3.8) });
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
  const excluded = Array.isArray(input.brief?.excluded) ? input.brief.excluded.filter((x) => typeof x === "string") : [];
  const intent = typeof input.brief?.intent === "string" ? input.brief.intent : "";
  const context = brief(input);

  // Sized to the provider actually being tried. Sending one payload everywhere
  // meant the small free tier answered with a rate-limit every time, so the
  // selection never happened there at all.
  const build = ({ budget }) => {
    const full = `${rules(excluded, intent)}\n\n${context}`;
    if (Math.round(full.length / 3.8) <= budget) return full;
    return `${rules(excluded, intent, nearby(intent, input.brief || {}))}\n\n${context}`;
  };
  const reply = await ask(build, { timeout: 20000, maxTokens: 4096 });
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
