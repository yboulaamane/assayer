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
//                 (set this to pin a model and skip the fallback ladder)
//
// With no key set the endpoint returns 501 and the page silently falls back to
// its keyword router, which is also what happens on quota exhaustion.

export const config = { runtime: "edge" };

const INTENTS = [
  ["hit-discovery", "find hits/inhibitors/binders for a target; virtual screening; docking campaign"],
  ["lead-opt", "improve an existing series: potency, selectivity, SAR, free-energy ranking"],
  ["denovo", "generate new molecules, de novo design, scaffold hopping, PROTACs"],
  ["antibody", "antibodies, nanobodies, biologics, epitopes, developability"],
  ["admet", "ADMET, PK, toxicity, safety, hERG, metabolism for compounds"],
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
      generationConfig: { temperature: 0, responseMimeType: "application/json", maxOutputTokens: 200 },
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
      model: m, temperature: 0, max_tokens: 200,
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
      model: m, temperature: 0, max_tokens: 200,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: PROMPT + q }],
    }),
    text: (d) => d?.choices?.[0]?.message?.content,
  },
};

const IDS = new Set(INTENTS.map(([id]) => id));
const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });

export default async function handler(req) {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const key = process.env.LLM_API_KEY;
  if (!key) return json({ error: "no LLM_API_KEY configured", fallback: true }, 501);

  const provider = PROVIDERS[process.env.LLM_PROVIDER || "gemini"];
  if (!provider) return json({ error: "unknown LLM_PROVIDER", fallback: true }, 501);
  const model = process.env.LLM_MODEL || provider.model;

  let query;
  try {
    ({ query } = await req.json());
  } catch {
    return json({ error: "bad request body" }, 400);
  }
  if (typeof query !== "string" || !query.trim()) return json({ error: "empty query" }, 400);
  query = query.slice(0, 300); // the router needs a question, not a document

  const candidates = process.env.LLM_MODEL ? [model] : [model, ...(provider.fallbacks || [])];
  let upstream, detail = "", used = model;

  for (const candidate of candidates) {
    used = candidate;
    try {
      upstream = await fetch(provider.url(candidate, key), {
        method: "POST",
        headers: provider.headers(key),
        body: JSON.stringify(provider.body(candidate, query)),
        signal: AbortSignal.timeout(6000), // the page must not hang on a slow model
      });
    } catch (e) {
      return json({ error: `upstream unreachable: ${e.name}`, fallback: true }, 502);
    }
    if (upstream.ok) break;
    detail = (await upstream.text()).slice(0, 200);
    // 404 means this model is retired for this project — try the next name.
    // Anything else (401 bad key, 429 quota spent) will not be fixed by retrying.
    if (upstream.status !== 404) break;
  }

  if (!upstream.ok) {
    return json({ error: `upstream ${upstream.status}`, model: used, detail, fallback: true }, 502);
  }

  let parsed, raw = "";
  try {
    raw = provider.text(await upstream.json()) || "";
    const cleaned = String(raw).replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      // Some models wrap the object in prose however firmly you ask them not to.
      const block = cleaned.match(/\{[\s\S]*\}/);
      if (!block) throw new Error("no JSON object in response");
      parsed = JSON.parse(block[0]);
    }
  } catch (e) {
    return json({
      error: "model did not return usable JSON",
      detail: String(raw).slice(0, 200) || `(empty response: ${e.message})`,
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
