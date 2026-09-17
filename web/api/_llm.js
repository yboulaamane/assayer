// Shared provider plumbing for the LLM endpoints.
//
// Three things went wrong often enough in production to be worth centralising:
// vendors retire model names on their own schedule, free tiers run out mid-day,
// and reasoning models print their thinking into the response. Each endpoint
// used to carry its own copy of the workarounds, which meant fixing each one
// three times. This is the one copy.
//
// Environment variables (same names every endpoint reads):
//   LLM_API_KEY    required — the provider key
//   LLM_PROVIDER   gemini (default) | groq | openrouter
//   LLM_MODEL      optional override; set it to pin and skip the fallback ladder
//   LLM_API_KEY_2, LLM_PROVIDER_2, LLM_MODEL_2   a second provider for failover

export const PROVIDERS = {
  gemini: {
    // Largest prompt, in tokens, this tier should be sent. Not the context
    // window: the free tiers meter tokens per minute across prompt and
    // completion together, so a prompt sized to the window buys one call a
    // minute and a rate-limit after it. Gemini meters requests long before
    // tokens, so it can take the full payload.
    budget: 30000,
    model: "gemini-3.6-flash",
    fallbacks: ["gemini-2.5-flash", "gemini-flash-latest"],
    list: (k) => `https://generativelanguage.googleapis.com/v1beta/models?key=${k}`,
    url: (m, k) => `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${k}`,
    headers: () => ({ "Content-Type": "application/json" }),
    body: (m, prompt, o) => ({
      contents: [{ parts: [{ text: prompt }] }],
      // Reasoning models spend output tokens thinking before they answer, so a
      // budget sized for the answer alone truncates it mid-object.
      generationConfig: {
        temperature: o.temperature, maxOutputTokens: o.maxTokens,
        ...(o.json ? { responseMimeType: "application/json" } : {}),
      },
    }),
    // A thinking part is not the answer. Taking parts[0] returns the reasoning.
    text: (d) => (d?.candidates?.[0]?.content?.parts || [])
      .filter((p) => typeof p.text === "string" && !p.thought)
      .map((p) => p.text).join("").trim(),
    finish: (d) => d?.candidates?.[0]?.finishReason || "",
  },
  groq: {
    // 8,000 tokens per minute, shared between prompt and completion. Leaving
    // room for a ~1,200-token answer and more than one question per minute puts
    // the usable prompt here, which is under a full registry digest.
    budget: 2800,
    model: "openai/gpt-oss-20b",
    fallbacks: ["openai/gpt-oss-120b", "qwen/qwen3.6-27b"],
    list: () => "https://api.groq.com/openai/v1/models",
    url: () => "https://api.groq.com/openai/v1/chat/completions",
    headers: (k) => ({ "Content-Type": "application/json", Authorization: `Bearer ${k}` }),
    body: (m, prompt, o) => ({
      model: m, temperature: o.temperature, max_tokens: o.maxTokens,
      ...(o.json ? { response_format: { type: "json_object" } } : {}),
      messages: [{ role: "user", content: prompt }],
    }),
    text: (d) => d?.choices?.[0]?.message?.content,
    finish: (d) => d?.choices?.[0]?.finish_reason || "",
  },
  openrouter: {
    budget: 8000,
    model: "meta-llama/llama-3.3-70b-instruct:free",
    fallbacks: [],
    list: () => "https://openrouter.ai/api/v1/models",
    url: () => "https://openrouter.ai/api/v1/chat/completions",
    headers: (k) => ({ "Content-Type": "application/json", Authorization: `Bearer ${k}` }),
    body: (m, prompt, o) => ({
      model: m, temperature: o.temperature, max_tokens: o.maxTokens,
      ...(o.json ? { response_format: { type: "json_object" } } : {}),
      messages: [{ role: "user", content: prompt }],
    }),
    text: (d) => d?.choices?.[0]?.message?.content,
    finish: (d) => d?.choices?.[0]?.finish_reason || "",
  },
};

export const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });

const named = (v, dflt) => PROVIDERS[String(v ?? dflt).trim().toLowerCase()];

/** Work out the provider from the key when nobody said. Each vendor's keys
 *  carry a distinct prefix, so a second key alone is enough to act on. */
export function inferred(key) {
  const k = (key || "").trim();
  if (k.startsWith("gsk_")) return "groq";
  if (k.startsWith("sk-or-")) return "openrouter";
  if (k.startsWith("AIza")) return "gemini";
  return null;
}

/** Configured providers, primary first. A second one only exists if it has a key. */
export function configured() {
  const out = [];
  const a = named(process.env.LLM_PROVIDER, inferred(process.env.LLM_API_KEY) || "gemini");
  if (process.env.LLM_API_KEY?.trim() && a) {
    out.push({ p: a, key: process.env.LLM_API_KEY.trim(),
               model: (process.env.LLM_MODEL || a.model).trim(), pinned: Boolean(process.env.LLM_MODEL) });
  }
  const b = named(process.env.LLM_PROVIDER_2, inferred(process.env.LLM_API_KEY_2) || "");
  if (process.env.LLM_API_KEY_2?.trim() && b) {
    out.push({ p: b, key: process.env.LLM_API_KEY_2.trim(),
               model: (process.env.LLM_MODEL_2 || b.model).trim(), pinned: Boolean(process.env.LLM_MODEL_2) });
  }
  return out;
}

/** Ask the provider what it actually serves.
 *
 *  Model names are retired on the vendor's schedule, not ours. When every
 *  configured name 404s, read the list rather than guess again.
 */
export async function discover(p, key) {
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
    return ids.sort((a, b) =>
      (/mini|lite|small|8b|20b|flash/i.test(b) ? 1 : 0) - (/mini|lite|small|8b|20b|flash/i.test(a) ? 1 : 0));
  } catch {
    return [];
  }
}

/**
 * Call the first provider that answers, walking the model ladder within each.
 *
 * `prompt` may be a string, or a function of the provider entry so the caller
 * can size the payload to that tier's budget. Failing over from a large-context
 * provider to a small one otherwise trades a rate-limit for a rate-limit.
 *
 * Returns { ok, text, model, provider, detail, finish }. Never throws: a caller
 * that cannot reach a model must degrade, not break the page.
 */
export async function ask(prompt, { timeout = 9000, maxTokens = 2048, temperature = 0,
                                    json: wantJson = true, deadline = 0 } = {}) {
  // `timeout` bounds one attempt; `deadline` bounds the whole call. Without the
  // second, two providers at 20s each can spend 40s behind a gateway that hangs
  // up at 25 -- which the caller sees as a 504 rather than as a degradation it
  // could handle. Each attempt gets whatever is left, and when too little is
  // left to be worth sending, we stop and let the caller fall back.
  const startedAt = Date.now();
  const remaining = () => (deadline ? deadline - (Date.now() - startedAt) : Infinity);
  const providers = configured();
  if (!providers.length) return { ok: false, detail: "no LLM_API_KEY configured", status: 501 };

  let upstream, detail = "", used = "", winner = null, sent = 0;
  const opts = { maxTokens, temperature, json: wantJson };
  const build = (p) => {
    const text = typeof prompt === "function"
      ? prompt({ budget: p.budget ?? 30000, provider: Object.keys(PROVIDERS).find((k) => PROVIDERS[k] === p) })
      : prompt;
    sent = Math.round(text.length / 3.8);
    return text;
  };

  outer:
  for (const { p, key, model, pinned } of providers) {
    // A pinned model means the caller chose; otherwise walk the ladder and, if
    // every name is retired, ask the provider what it serves today.
    const queue = pinned ? [model] : [model, ...(p.fallbacks || [])];
    let retried = false, asked = false;

    while (queue.length) {
      const candidate = queue.shift();
      used = candidate;
      const slice = Math.min(timeout, remaining());
      if (slice < 1500) { detail = detail || "deadline reached before a model answered"; break outer; }
      try {
        upstream = await fetch(p.url(candidate, key), {
          method: "POST",
          headers: p.headers(key),
          body: JSON.stringify(p.body(candidate, build(p), opts)),
          signal: AbortSignal.timeout(slice),
        });
      } catch (e) {
        detail = `unreachable: ${e.name}`;
        continue outer;
      }
      if (upstream.ok) { winner = p; break outer; }
      detail = (await upstream.text()).slice(0, 200);

      // 503 is the model being briefly overloaded: worth exactly one retry.
      if (upstream.status === 503 && !retried && remaining() > 2500) {
        retried = true;
        await new Promise((r) => setTimeout(r, 700));
        queue.unshift(candidate);
        continue;
      }
      // 429: this tier is spent for today, so move on to the next provider.
      if (upstream.status === 429) continue outer;
      if (upstream.status !== 404) continue outer;

      if (!queue.length && !asked && remaining() > 4000) {
        asked = true;
        queue.push(...(await discover(p, key)).slice(0, 3));
      }
    }
  }

  if (!upstream || !upstream.ok) {
    return { ok: false, model: used, detail,
             status: upstream ? 502 : 502,
             error: upstream ? `upstream ${upstream.status}` : "no provider answered" };
  }

  try {
    const body = await upstream.json();
    return { ok: true, text: winner.text(body) || "", finish: winner.finish(body), promptTokens: sent,
             model: used, provider: Object.keys(PROVIDERS).find((k) => PROVIDERS[k] === winner) };
  } catch {
    return { ok: false, model: used, detail: "unreadable response", error: "bad upstream body", status: 502 };
  }
}

/**
 * Parse a JSON object out of a model's reply.
 *
 * Models wrap objects in prose however firmly you ask them not to, and a
 * reasoning model may print braces while thinking. Scan for each "{" and take
 * the first that closes into valid JSON: a greedy match from the first brace to
 * the last swallows the thinking and parses nothing.
 */
export function parseObject(raw) {
  const cleaned = String(raw || "").replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  try {
    return JSON.parse(cleaned);
  } catch { /* fall through to the scanner */ }

  for (let i = cleaned.indexOf("{"); i >= 0; i = cleaned.indexOf("{", i + 1)) {
    let depth = 0, inString = false, escaped = false;
    for (let j = i; j < cleaned.length; j++) {
      const c = cleaned[j];
      if (inString) {
        if (escaped) escaped = false;
        else if (c === "\\") escaped = true;
        else if (c === '"') inString = false;
        continue;
      }
      if (c === '"') inString = true;
      else if (c === "{") depth++;
      else if (c === "}" && --depth === 0) {
        try {
          return JSON.parse(cleaned.slice(i, j + 1));
        } catch { break; }
      }
    }
  }
  return null;
}
