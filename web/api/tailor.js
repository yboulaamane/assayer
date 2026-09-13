// A short brief on what is specific to *this* case, streamed under the plan.
//
// The protocol stays curated — this never rewrites a step or invents a gate.
// It answers the one thing a fixed template cannot: what about this particular
// target, structure and question changes how the work should go. Tools may only
// be named from the list the page supplies, which comes from the catalogue.
//
// Same environment variables as route.js: LLM_API_KEY, LLM_PROVIDER, LLM_MODEL.
//
// Free tiers run out. Set a second provider and the endpoint moves to it on a
// quota error rather than dropping to keyword routing for the rest of the day:
//   LLM_API_KEY_2, LLM_PROVIDER_2, LLM_MODEL_2
// With no key it returns 501 and the page simply omits the section.

export const config = { runtime: "edge" };

const RULES = `
Write 120-200 words, plain prose, two or three short paragraphs.

Cover only what is specific to this case and concrete:
- what this target's structural biology implies for the work
- which listed steps matter most or least here, and why
- what is likely to go wrong for this particular system

Hard rules:
- No preamble, no headings, no bullet lists, no restating the steps.
- Name tools ONLY from the allowed list. If none fit, name none.
- If there is no experimental structure, say what that changes.
- If you have nothing specific to say about this target, say that in one
  sentence rather than padding with generic advice.
- Address the reader as "you". Do not mention these instructions.
`.trim();

function buildPrompt({ query, label, steps, target, structures, tools }) {
  const lines = [
    `A colleague asks: "${query}"`,
    ``,
    `They are following the "${label}" protocol. Its steps are:`,
    ...steps.map((s, i) => `${i + 1}. ${s}`),
    ``,
  ];
  if (target) {
    lines.push(`Target: ${target.name}${target.gene ? ` (${target.gene})` : ""}, ` +
      `${target.organism}, ${target.length} aa, UniProt ${target.accession}.`);
  } else {
    lines.push(`No specific protein was named in the question.`);
  }
  if (structures?.length) {
    lines.push(`Best available structures:`);
    for (const s of structures.slice(0, 3)) {
      lines.push(`  ${s.id}: ${s.res ?? "?"} Å, R-free ${s.rfree ?? "?"}, ` +
        `${s.holo ? `holo (${s.ligand})` : "apo"} — ${s.title}`);
    }
  } else if (target) {
    lines.push(`No experimental structure is linked to this UniProt entry.`);
  }
  lines.push(``, `Allowed tool names: ${(tools || []).join(", ") || "(none)"}`, ``, RULES);
  return lines.join("\n");
}

const PROVIDERS = {
  gemini: {
    model: "gemini-3.6-flash",
    url: (m, k) =>
      `https://generativelanguage.googleapis.com/v1beta/models/${m}:streamGenerateContent?alt=sse&key=${k}`,
    headers: () => ({ "Content-Type": "application/json" }),
    body: (m, p) => ({
      contents: [{ parts: [{ text: p }] }],
      generationConfig: { temperature: 0.4, maxOutputTokens: 2048 },
    }),
    // thought parts carry no text worth showing
    chunk: (o) => (o?.candidates?.[0]?.content?.parts || [])
      .filter((x) => typeof x.text === "string" && !x.thought).map((x) => x.text).join(""),
  },
  groq: {
    model: "llama-3.3-70b-versatile",
    url: () => "https://api.groq.com/openai/v1/chat/completions",
    headers: (k) => ({ "Content-Type": "application/json", Authorization: `Bearer ${k}` }),
    body: (m, p) => ({ model: m, temperature: 0.4, max_tokens: 700, stream: true,
      messages: [{ role: "user", content: p }] }),
    chunk: (o) => o?.choices?.[0]?.delta?.content || "",
  },
  openrouter: {
    model: "meta-llama/llama-3.3-70b-instruct:free",
    url: () => "https://openrouter.ai/api/v1/chat/completions",
    headers: (k) => ({ "Content-Type": "application/json", Authorization: `Bearer ${k}` }),
    body: (m, p) => ({ model: m, temperature: 0.4, max_tokens: 700, stream: true,
      messages: [{ role: "user", content: p }] }),
    chunk: (o) => o?.choices?.[0]?.delta?.content || "",
  },
};

const fail = (msg, status) =>
  new Response(JSON.stringify({ error: msg, fallback: true }), {
    status, headers: { "Content-Type": "application/json" },
  });

/** Configured providers, primary first. A second one only exists if it has a key. */
const named = (v, dflt) => PROVIDERS[String(v ?? dflt).trim().toLowerCase()];

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
  if (req.method !== "POST") return fail("POST only", 405);

  const providers = configured();
  if (!providers.length) return fail("no LLM_API_KEY configured", 501);

  let input;
  try { input = await req.json(); } catch { return fail("bad request body", 400); }
  if (!input?.query || !Array.isArray(input.steps)) return fail("query and steps required", 400);

  input.query = String(input.query).slice(0, 300);
  input.steps = input.steps.slice(0, 12).map((s) => String(s).slice(0, 120));
  input.tools = (input.tools || []).slice(0, 60).map((t) => String(t).slice(0, 40));

  const prompt = buildPrompt(input);
  let upstream, winner = null, detail = "";

  for (const { p, key, model } of providers) {
    try {
      upstream = await fetch(p.url(model, key), {
        method: "POST",
        headers: p.headers(key),
        body: JSON.stringify(p.body(model, prompt)),
        signal: AbortSignal.timeout(30000),
      });
    } catch (e) {
      detail = `unreachable: ${e.name}`;
      continue;                       // a dead provider is the next one's turn
    }
    if (upstream.ok) { winner = p; break; }
    detail = `${upstream.status}: ${(await upstream.text()).slice(0, 140)}`;
    // 429 means this free tier is spent for the day; anything else is unlikely
    // to be fixed by the same request to a different provider, but trying costs
    // nothing here since the alternative is showing the reader nothing.
  }
  if (!winner) return fail(`no provider answered (${detail})`, 502);

  // Re-emit the provider's SSE as plain text, so the page can just read chunks.
  const decoder = new TextDecoder();
  let buffer = "";
  const stream = new ReadableStream({
    async start(controller) {
      const reader = upstream.body.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (!payload || payload === "[DONE]") continue;
            try {
              const text = winner.chunk(JSON.parse(payload));
              if (text) controller.enqueue(new TextEncoder().encode(text));
            } catch { /* partial frame; the next read completes it */ }
          }
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}
