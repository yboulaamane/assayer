// Intent routing for a research question, via whichever LLM you point it at.
//
// The API key lives here, server-side, never in the page. The model's job is
// deliberately narrow: pick one of the known protocols and pull out the target
// and organism. It never writes protocol steps and never names tools — those
// come from the curated catalogue, so a confused model produces a wrong route,
// not an invented tool.
//
// Configure with environment variables in Vercel:
//   LLM_API_KEY   required — the provider key
//   LLM_PROVIDER  gemini (default) | groq | openrouter
//   LLM_MODEL     optional override, e.g. gemini-3.6-flash / llama-3.3-70b-versatile
//
// Free tiers run out. Set a second provider and the endpoint moves to it on a
// quota error rather than dropping to keyword routing for the rest of the day:
//   LLM_API_KEY_2, LLM_PROVIDER_2, LLM_MODEL_2
//                 (set this to pin a model and skip the fallback ladder)
//
// With no key set the endpoint returns 501 and the page silently falls back to
// its keyword router, which is also what happens on quota exhaustion.

export const config = { runtime: "edge" };

// Kept in step with PROTOCOLS in ../assets/workflow.js by hand: the list is
// hardcoded here so a caller cannot talk this endpoint into arbitrary work.
// An id the client does not know is rejected there too, so drift degrades to a
// keyword fallback rather than a broken page.
const INTENTS = [
  ["hit-discovery", "find hits/inhibitors/binders for a target; virtual screening; docking campaign"],
  ["lead-opt", "improve an existing series: potency, selectivity, SAR, free-energy ranking"],
  ["denovo", "generate new molecules, de novo design, scaffold hopping, PROTACs"],
  ["antibody", "antibodies, nanobodies, biologics, epitopes, developability"],
  ["admet", "ADMET, PK, toxicity, safety, hERG, metabolism for compounds"],
  ["qsar", "building or validating a property/QSAR model: training data, splits, descriptors, applicability domain"],
  ["resistance", "resistance or mutation effects: variant impact on binding, escape mutations, designing against a mutant"],
  ["fbdd", "fragment-based discovery: fragment screening, hits, growing, merging, linking, ligand efficiency"],
  ["selectivity", "selectivity and off-target profiling; counter-screening; isoform or family selectivity"],
  ["fep", "free energy perturbation / relative binding free energy to rank analogues"],
  ["degrader", "PROTACs, molecular glues, targeted protein degradation, E3 ligases, ternary complexes"],
  ["conformational-sampling", "sample the conformational landscape: enhanced sampling, accelerated MD, metadynamics, replica exchange, weighted ensemble, cryptic pockets, ensemble generation"],
  ["md-stability", "run or analyse a plain MD simulation: is a complex stable, RMSD/RMSF, trajectory analysis"],
  ["retrosynthesis", "how to synthesise a molecule, routes, building blocks"],
  ["target-triage", "which target to pick for a disease; target identification and validation"],
  ["structure", "get or model the structure of a protein; pick the best PDB entry"],
];

const PROMPT = `You route drug-discovery questions to a protocol. Reply with JSON only.

Protocols:
${INTENTS.map(([id, d]) => `- ${id}: ${d}`).join("\n")}

Return exactly:
{"intent": "<one id above>", "target": "<gene symbol or protein name, or null>", "organism_taxid": <NCBI taxon id or null>, "reason": "<8 words max>"}

Rules:
- target is a PROTEIN. For a disease, an endpoint (ADMET, hERG) or an unnamed molecule, use null.
- Expand informal names: "3A4" -> "CYP3A4", "Mpro"/"main protease" -> "3C-like proteinase", "PD-L1" -> "CD274".
- organism_taxid: human 9606, mouse 10090, rat 10116, SARS-CoV-2 2697049, E. coli 83333, yeast 559292. null if unstated.
- Choose conformational-sampling over md-stability whenever the question is about exploring conformations rather than checking stability.

Question: `;

const PROVIDERS = {
  gemini: {
    model: "gemini-3.6-flash",
    // Model names churn: Google retires them for new projects with a 404 whose
    // message names the replacement. Try the next one rather than silently
    // dropping to keyword routing for months.
    fallbacks: ["gemini-2.5-flash", "gemini-flash-latest"],
    url: (m, k) => `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${k}`,
    headers: () => ({ "Content-Type": "application/json" }),
    body: (m, q) => ({
      contents: [{ parts: [{ text: PROMPT + q }] }],
      // Reasoning models spend output tokens thinking before they answer, so a
      // budget sized for the answer alone truncates it mid-object. The reply we
      // want is ~60 tokens; the rest of this headroom is for the thinking.
      generationConfig: { temperature: 0, responseMimeType: "application/json", maxOutputTokens: 2048 },
    }),
    text: (d) =>
      (d?.candidates?.[0]?.content?.parts || [])
        .filter((p) => typeof p.text === "string" && !p.thought)
        .map((p) => p.text)
        .join("")
        .trim(),
  },
  groq: {
    model: "llama-3.3-70b-versatile",
    fallbacks: ["llama-3.1-8b-instant"],
    url: () => "https://api.groq.com/openai/v1/chat/completions",
    headers: (k) => ({ "Content-Type": "application/json", Authorization: `Bearer ${k}` }),
    body: (m, q) => ({
      model: m, temperature: 0, max_tokens: 1024,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: PROMPT + q }],
    }),
    text: (d) => d?.choices?.[0]?.message?.content,
  },
  openrouter: {
    model: "meta-llama/llama-3.3-70b-instruct:free",
    fallbacks: [],
    url: () => "https://openrouter.ai/api/v1/chat/completions",
    headers: (k) => ({ "Content-Type": "application/json", Authorization: `Bearer ${k}` }),
    body: (m, q) => ({
      model: m, temperature: 0, max_tokens: 1024,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: PROMPT + q }],
    }),
    text: (d) => d?.choices?.[0]?.message?.content,
  },
};

const IDS = new Set(INTENTS.map(([id]) => id));
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });

/** Configured providers, primary first. A second one only exists if it has a key. */
function configured() {
  const out = [];
  const a = PROVIDERS[process.env.LLM_PROVIDER || "gemini"];
  if (process.env.LLM_API_KEY && a) {
    out.push({ p: a, key: process.env.LLM_API_KEY, model: process.env.LLM_MODEL || a.model });
  }
  const b = PROVIDERS[process.env.LLM_PROVIDER_2 || ""];
  if (process.env.LLM_API_KEY_2 && b) {
    out.push({ p: b, key: process.env.LLM_API_KEY_2, model: process.env.LLM_MODEL_2 || b.model });
  }
  return out;
}

export default async function handler(req) {
  // GET reports which providers this deployment can see. Names only, never
  // keys. Edge functions inline process.env at build time, so "I added the
  // variable" and "the running code has it" are different facts.
  if (req.method === "GET") {
    return json({
      providers: configured().map(({ p, model }) => ({
        provider: Object.keys(PROVIDERS).find((k) => PROVIDERS[k] === p), model,
      })),
      protocols: INTENTS.length,
    });
  }
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const providers = configured();
  if (!providers.length) return json({ error: "no LLM_API_KEY configured", fallback: true }, 501);

  let query;
  try {
    ({ query } = await req.json());
  } catch {
    return json({ error: "bad request body" }, 400);
  }
  if (typeof query !== "string" || !query.trim()) return json({ error: "empty query" }, 400);
  query = query.slice(0, 300); // the router needs a question, not a document

  let upstream, detail = "", used = "", winner = null;

  outer:
  for (const { p, key, model } of providers) {
    // A pinned LLM_MODEL means the caller chose; otherwise walk the ladder,
    // since model names are retired with a 404 naming their replacement.
    const candidates = process.env.LLM_MODEL ? [model] : [model, ...(p.fallbacks || [])];
    let retried = false;

    for (const candidate of candidates) {
      used = candidate;
      try {
        upstream = await fetch(p.url(candidate, key), {
          method: "POST",
          headers: p.headers(key),
          body: JSON.stringify(p.body(candidate, query)),
          signal: AbortSignal.timeout(6000), // the page must not hang on a slow model
        });
      } catch (e) {
        detail = `unreachable: ${e.name}`;
        continue outer;                      // try the next provider instead
      }
      if (upstream.ok) { winner = p; break outer; }
      detail = (await upstream.text()).slice(0, 200);

      // 503 is the model being briefly overloaded: worth exactly one retry.
      if (upstream.status === 503 && !retried) {
        retried = true;
        await new Promise((r) => setTimeout(r, 700));
        candidates.unshift(candidate);
        continue;
      }
      // 404: this model is retired for this project, try the next name.
      // 429: this tier is spent for today, so move to the next provider.
      if (upstream.status === 429) continue outer;
      if (upstream.status !== 404) continue outer;
    }
  }

  if (!upstream || !upstream.ok) {
    return json({ error: upstream ? `upstream ${upstream.status}` : "no provider answered",
                  model: used, detail, fallback: true }, 502);
  }

  let parsed, raw = "", finish = "";
  try {
    const body = await upstream.json();
    finish = body?.candidates?.[0]?.finishReason || body?.choices?.[0]?.finish_reason || "";
    raw = winner.text(body) || "";
    const cleaned = String(raw).replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      // Some models wrap the object in prose however firmly you ask them not
      // to, and a reasoning model may print braces while thinking. Scan for
      // each "{" and take the first that closes into valid JSON — a greedy
      // /\{[\s\S]*\}/ would span from a brace in the reasoning to one at the
      // very end and parse neither.
      parsed = null;
      for (let i = 0; i < cleaned.length && !parsed; i++) {
        if (cleaned[i] !== "{") continue;
        let depth = 0, inStr = false, esc = false;
        for (let j = i; j < cleaned.length; j++) {
          const ch = cleaned[j];
          if (esc) { esc = false; continue; }
          if (ch === "\\") { esc = true; continue; }
          if (ch === '"') { inStr = !inStr; continue; }
          if (inStr) continue;
          if (ch === "{") depth++;
          else if (ch === "}" && --depth === 0) {
            try { parsed = JSON.parse(cleaned.slice(i, j + 1)); } catch {}
            break;
          }
        }
      }
      if (!parsed) throw new Error("no parsable JSON object in response");
    }
  } catch (e) {
    return json({
      error: "model did not return usable JSON",
      detail: String(raw).slice(0, 200) || `(empty response: ${e.message})`,
      finishReason: finish,
      model: used,
      fallback: true,
    }, 502);
  }

  // Only ever hand back a protocol we actually have.
  if (!IDS.has(parsed.intent)) return json({ error: "unknown intent", fallback: true }, 502);

  return json({
    intent: parsed.intent,
    target: typeof parsed.target === "string" && parsed.target.trim() ? parsed.target.trim() : null,
    organism_taxid: Number.isInteger(parsed.organism_taxid) ? parsed.organism_taxid : null,
    reason: typeof parsed.reason === "string" ? parsed.reason.slice(0, 80) : null,
    model: used,
    via: "llm",
  });
}
