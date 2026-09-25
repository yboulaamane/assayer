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

// Hardcoded so a caller cannot talk this endpoint into arbitrary work, and
// exported so a test can hold it against the registry: this list and RECIPES
// drifted apart once already, and the symptom was a whole protocol the router
// could never reach. An id the client does not know is rejected there too, so
// drift degrades to a keyword fallback rather than a broken page.
export const INTENTS = [
  ["network-pharmacology", "network or systems pharmacology: connect plant/natural-product or compound sets to disease targets, protein networks and enriched pathways"],
  ["hit-discovery", "find hits/inhibitors/binders for a target; virtual screening; docking campaign"],
  ["lead-opt", "improve an existing series: potency, selectivity, SAR, free-energy ranking"],
  ["denovo", "generate new molecules, de novo design, scaffold hopping, PROTACs"],
  ["antibody", "antibodies, nanobodies, biologics, epitopes, developability"],
  ["admet", "ADMET, PK, toxicity, safety, hERG, metabolism for compounds"],
  ["ligand-discovery", "discovery without a usable structure, or with docking ruled out: modelling from measured compounds"],
  ["qsar", "building or validating a property/QSAR model: training data, splits, descriptors, applicability domain"],
  ["resistance", "resistance or mutation effects: variant impact on binding, escape mutations, designing against a mutant"],
  ["fbdd", "fragment-based discovery: fragment screening, hits, growing, merging, linking, ligand efficiency"],
  ["selectivity", "selectivity and off-target profiling; counter-screening; isoform or family selectivity"],
  ["fep", "free energy perturbation / relative binding free energy to rank analogues"],
  ["degrader", "PROTACs, molecular glues, targeted protein degradation, E3 ligases, ternary complexes"],
  ["conformational-sampling", "sample the conformational landscape: enhanced sampling, accelerated MD, metadynamics, replica exchange, weighted ensemble, cryptic pockets, ensemble generation"],
  ["md-stability", "run or analyse a plain MD simulation: is a complex stable, RMSD/RMSF, trajectory analysis"],
  ["retrosynthesis", "how to synthesise a molecule, routes, building blocks"],
  ["target-prediction", "a compound whose protein target is unknown: target prediction, deconvolution, target fishing, reverse screening, mechanism of action, polypharmacology profile for a given molecule"],
  ["target-triage", "which target to pick for a disease; target identification and validation"],
  ["structure", "get or model the structure of a protein; pick the best PDB entry"],
  ["qm-geometry", "optimise or minimise the geometry of a molecule or metal complex; DFT or semi-empirical calculation; conformer or spin-state energies; frequencies and orbitals"],
  ["parameterisation", "derive force field parameters for something that has none: a metal centre, a non-standard residue, a modified cofactor or a ligand; charges, bonded terms, topology files"],
  ["qm-mechanism", "reaction mechanism, transition states, activation barriers, reaction paths, catalytic cycles, regio- or stereoselectivity explained by computed energies"],
  ["qm-properties", "computed molecular properties: pKa, tautomer or protonation state, and predicted NMR, IR or UV spectra compared with measurement"],
  ["protein-engineering", "engineer a protein or enzyme itself: thermostability, solubility, expression, activity; point mutations for stability; directed evolution library design"],
  ["peptide-design", "design a peptide, macrocycle, cyclic or stapled peptide as the binder; peptide liabilities and constraint"],
  ["landscape", "what already exists for a target: published chemical matter, clinical pipeline, patent position, competitive white space"],
  ["library-design", "build, curate, standardise, filter or select a compound screening library; deduplication and diversity or focused selection"],
  ["benchmarking", "test or validate a method, model or scoring function against a reference set; compare methods; choose metrics and baselines"],
];

const PROMPT = `You route drug-discovery questions to a protocol. Classify the concrete outcome the user asks for, not the broad topic. Reply with JSON only.

Protocols:
${INTENTS.map(([id, d]) => `- ${id}: ${d}`).join("\n")}

Return exactly:
{"intent": "<one id above, or unsupported>", "confidence": "high|medium|low", "evidence": "<exact short quote from the question, or null>", "target": "<gene symbol or protein name, or null>", "organism_taxid": <NCBI taxon id or null>, "reason": "<8 words max>"}

Rules:
- Return unsupported when none of the protocols addresses the request. Do not force unrelated questions into a protocol.
- Return unsupported with low confidence when the user names only a target, disease, project or broad topic without saying what result they need. Never fill ambiguity with hit discovery or generative design.
- Evidence must quote the words that express the requested outcome. A protein, disease, compound or the phrase "drug discovery" is context, not evidence of a workflow.
- Generative design is ONLY for an explicit request to generate, create or propose new molecules, chemotypes or scaffolds. "Drug design", "drug discovery", "work on a target" and "study a disease" alone are not generative design.
- Hit discovery requires an explicit request to find, screen, dock or identify hits, binders or inhibitors. Lead optimisation requires an existing lead, series, analogues or SAR and a request to improve or rank them.
- A request to understand, analyse or help with something is insufficient unless it names an operation covered by a protocol.
- Respect negations and distinguish completed work from the requested next task. Return the primary target; a protein the user wants to spare is an off-target.
- target is a PROTEIN. For a disease, an endpoint (ADMET, hERG) or an unnamed molecule, use null.
- For network-pharmacology use target null: plant names and diseases are study context, not a single protein. Route plant-versus-disease network studies here, including Aloysia versus Parkinson's disease.
- Expand informal names: "3A4" -> "CYP3A4", "Mpro"/"main protease" -> "3C-like proteinase", "PD-L1" -> "CD274".
- organism_taxid: human 9606, mouse 10090, rat 10116, SARS-CoV-2 2697049, E. coli 83333, yeast 559292. null if unstated.
- Choose conformational-sampling over md-stability whenever the question is about exploring conformations rather than checking stability.
- qm-geometry is for optimising a structure or computing its energy with quantum chemistry, including metal complexes and organometallics. "Optimise the geometry" is qm-geometry; "optimise a lead" or "optimise potency" is lead-opt. A ligand bound to a metal is a chemical structure, not a protein target.
- Among the quantum chemistry routes: a structure or its energy is qm-geometry; a barrier, transition state or mechanism is qm-mechanism; pKa, tautomers or a predicted spectrum is qm-properties.
- parameterisation is for producing force field parameters so something can be simulated, which is a different request from running the simulation (md-stability) or optimising the structure (qm-geometry).
- protein-engineering changes the protein itself (stability, solubility, expression, activity). resistance is about how a mutation affects drug binding. antibody is for antibodies and nanobodies; peptide-design is for peptides and macrocycles as the binder.
- landscape is for what already exists (published compounds, trials, patents) rather than for making something new. A question about the competitive or patent position is landscape even when it names inhibitors.
- library-design is for assembling or curating the compound set itself. benchmarking is for testing a method against a reference set rather than applying it.

Examples:
- "Help me with EGFR drug discovery" -> unsupported (goal is unspecified)
- "Design a drug discovery workflow for Alzheimer's" -> unsupported (goal is unspecified; not generative design)
- "Generate new EGFR inhibitor scaffolds" -> denovo
- "Find inhibitors of EGFR" -> hit-discovery
- "Improve potency in my EGFR lead series" -> lead-opt
- "I have 200 measured compounds; build an activity model" -> qsar
- "I have compounds for EGFR and want to understand them" -> unsupported (operation is unspecified)

Question: `;

const PROVIDERS = {
  gemini: {
    model: "gemini-3.6-flash",
    list: (k) => `https://generativelanguage.googleapis.com/v1beta/models?key=${k}`,
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
    model: "openai/gpt-oss-20b",
    fallbacks: ["openai/gpt-oss-120b", "qwen/qwen3.6-27b"],
    list: () => "https://api.groq.com/openai/v1/models",
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
    list: () => "https://openrouter.ai/api/v1/models",
    fallbacks: [],
    list: () => "https://openrouter.ai/api/v1/models",
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
const named = (v, dflt) => PROVIDERS[String(v ?? dflt).trim().toLowerCase()];

/** Ask the provider what it actually serves.
 *
 *  Model names are retired on the vendor's schedule, not ours: three of the
 *  names hardcoded here went stale within a few months. When every configured
 *  name 404s, read the list rather than guess again.
 */
async function discover(p, key) {
  if (!p.list) return [];
  try {
    const r = await fetch(p.list(key), {
      headers: p.list.length ? {} : { Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(6000),
    });
    if (!r.ok) return [];
    const d = await r.json();
    const ids = (d.data || d.models || [])
      .map((m) => String(m.id || m.name || "").replace(/^models\//, ""))
      .filter((id) => id && !/embed|whisper|tts|guard|vision|image|rerank/i.test(id));
    // prefer the small fast ones: this is a classification call, not an essay
    return ids.sort((a, b) =>
      (/mini|lite|small|8b|20b|flash/i.test(b) ? 1 : 0) - (/mini|lite|small|8b|20b|flash/i.test(a) ? 1 : 0));
  } catch {
    return [];
  }
}

/** Work out the provider from the key when nobody said. Each vendor's keys
 *  carry a distinct prefix, so a second key alone is enough to act on. */
function inferred(key) {
  const k = (key || "").trim();
  if (k.startsWith("gsk_")) return "groq";
  if (k.startsWith("sk-or-")) return "openrouter";
  if (k.startsWith("AIza")) return "gemini";
  return null;
}

function configured() {
  const out = [];
  const a = named(process.env.LLM_PROVIDER, inferred(process.env.LLM_API_KEY) || "gemini");
  if (process.env.LLM_API_KEY?.trim() && a) {
    out.push({ p: a, key: process.env.LLM_API_KEY.trim(),
               model: (process.env.LLM_MODEL || a.model).trim() });
  }
  const b = named(process.env.LLM_PROVIDER_2, inferred(process.env.LLM_API_KEY_2) || "");
  if (process.env.LLM_API_KEY_2?.trim() && b) {
    out.push({ p: b, key: process.env.LLM_API_KEY_2.trim(),
               model: (process.env.LLM_MODEL_2 || b.model).trim() });
  }
  return out;
}

export default async function handler(req) {
  // GET reports which providers this deployment can see. Names only, never
  // keys. Edge functions inline process.env at build time, so "I added the
  // variable" and "the running code has it" are different facts.
  if (req.method === "GET") {
    // Say what is wrong, not just what is missing. Values are never echoed:
    // only whether a key is present and whether a provider name resolved.
    const why = (keyVar, provVar, dflt) => {
      const guess = inferred(process.env[keyVar]);
      return {
        key: process.env[keyVar]?.trim() ? "set" : "missing",
        provider: process.env[provVar]?.trim()
          ? (named(process.env[provVar], dflt) ? "recognised" : "not a known provider")
          : guess ? `not set, inferred ${guess} from the key`
          : dflt ? `not set, defaulted to ${dflt}`
          : "not set, and the key prefix matches no known provider",
      };
    };
    return json({
      providers: configured().map(({ p, model }) => ({
        provider: Object.keys(PROVIDERS).find((k) => PROVIDERS[k] === p), model,
      })),
      primary: why("LLM_API_KEY", "LLM_PROVIDER", "gemini"),
      secondary: why("LLM_API_KEY_2", "LLM_PROVIDER_2", ""),
      known: Object.keys(PROVIDERS),
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
  // Long enough for a real request with constraints. Truncation here used to
  // drop exactly the part that changes the answer.
  const full = query;
  query = query.slice(0, 1500);
  const truncated = full.length > query.length;

  let upstream, detail = "", used = "", winner = null;

  outer:
  for (const { p, key, model } of providers) {
    // A pinned LLM_MODEL means the caller chose; otherwise walk the ladder and,
    // if every name is retired, ask the provider what it serves today.
    const queue = process.env.LLM_MODEL ? [model] : [model, ...(p.fallbacks || [])];
    let retried = false, asked = false;

    while (queue.length) {
      const candidate = queue.shift();
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
        queue.unshift(candidate);
        continue;
      }
      // 429: this tier is spent for today, so move on to the next provider.
      if (upstream.status === 429) continue outer;
      if (upstream.status !== 404) continue outer;

      // Every name we knew is retired. Read the model list and try again.
      if (!queue.length && !asked) {
        asked = true;
        queue.push(...(await discover(p, key)).slice(0, 3));
      }
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
  if (parsed.intent === "unsupported") return json({ intent: "unsupported", matched: false, via: "llm" });
  if (!IDS.has(parsed.intent)) return json({ error: "unknown intent", fallback: true }, 502);

  const confidence = ["high", "medium", "low"].includes(parsed.confidence)
    ? parsed.confidence : "low";
  const evidence = typeof parsed.evidence === "string" ? parsed.evidence.trim() : "";
  const normalized = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const quoted = evidence && normalized(query).includes(normalized(evidence));
  // This is the costly false positive: broad drug-design language was being
  // promoted to molecule generation. Require the request itself to say what
  // is being created before accepting that route.
  // Do not let a forbidden method count as affirmative evidence for that same
  // workflow. Keep later comma/semicolon clauses so "without MD, find hits"
  // still retains the actual request.
  const requested = query.replace(
    /\b(?:no|without|avoid|exclude|skip|do not|don['’]?t|cannot|can['’]?t)\b[^,.;]{0,60}/gi, " ");
  const molecule = "(?:molecul\\w*|compound\\w*|chemotype\\w*|scaffold\\w*|ligand\\w*|inhibitor\\w*)";
  const explicitGeneration = new RegExp(
    `\\b(?:de[ -]?novo|scaffold[ -]?hop\\w*|generative\\s+(?:molecular\\s+)?design|` +
    `(?:generat|creat|invent|propos|design)\\w*\\W{0,40}(?:new\\s+)?${molecule}|` +
    `${molecule}\\W{0,20}generat\\w*)\\b`, "i").test(requested);
  const explicitHitDiscovery = /\b(?:virtual\s+screen\w*|dock\w*|(?:find|discover|identify|screen|search\s+for)\W{0,30}(?:hit\w*|binder\w*|inhibitor\w*|compound\w*|molecule\w*|ligand\w*))\b/i.test(requested);
  if (confidence === "low" || !quoted
      || (parsed.intent === "denovo" && !explicitGeneration)
      || (parsed.intent === "hit-discovery" && !explicitHitDiscovery)) {
    return json({
      intent: "unsupported", matched: false, via: "llm",
      reason: "The requested outcome is not specific enough",
    });
  }

  return json({
    intent: parsed.intent,
    confidence,
    evidence,
    target: typeof parsed.target === "string" && parsed.target.trim() ? parsed.target.trim() : null,
    organism_taxid: Number.isInteger(parsed.organism_taxid) ? parsed.organism_taxid : null,
    reason: typeof parsed.reason === "string" ? parsed.reason.slice(0, 80) : null,
    truncated: truncated || undefined,
    model: used,
    via: "llm",
  });
}
