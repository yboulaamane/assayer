// Live star counts for any repo in the catalogue.
//
// The browser cannot ask GitHub directly: unauthenticated requests are capped
// at 60/hour per IP, so a single screen of cards would spend a visitor's quota.
// This batches up to 100 repos into one GraphQL query with a server-side token
// and lets the CDN hold the answer, so GitHub sees a handful of requests a day
// however many people are reading.
//
// GITHUB_TOKEN needs no scopes at all for public repositories; it exists purely
// to lift the rate limit. Without it this returns 501 and the page falls back
// to the counts baked into catalog.json.

export const config = { runtime: "edge" };

const MAX = 100;
const alias = (i) => `r${i}`;

const json = (obj, status = 200, cache = false) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json",
      // fresh for an hour at the edge, servable stale for a day while it
      // revalidates: star counts do not need to be to the minute
      "Cache-Control": cache
        ? "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400"
        : "no-store",
    },
  });

export default async function handler(req) {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  const token = process.env.GITHUB_TOKEN;
  if (!token) return json({ error: "no GITHUB_TOKEN configured", fallback: true }, 501);

  let repos;
  try {
    ({ repos } = await req.json());
  } catch {
    return json({ error: "bad request body" }, 400);
  }
  if (!Array.isArray(repos) || !repos.length) return json({ error: "repos required" }, 400);

  // owner/name only; anything else is not ours to forward
  const clean = [...new Set(repos.map(String))]
    .filter((r) => /^[\w.-]+\/[\w.-]+$/.test(r))
    .slice(0, MAX);
  if (!clean.length) return json({}, 200, true);

  const query = `query {\n${clean
    .map((r, i) => {
      const [owner, name] = r.split("/");
      return `  ${alias(i)}: repository(owner:${JSON.stringify(owner)}, name:${JSON.stringify(name)}) { stargazerCount }`;
    })
    .join("\n")}\n}`;

  let res;
  try {
    res = await fetch("https://api.github.com/graphql", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "assayer/1.0",
      },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(10000),
    });
  } catch (e) {
    return json({ error: `upstream unreachable: ${e.name}`, fallback: true }, 502);
  }
  if (!res.ok) {
    return json({ error: `upstream ${res.status}`, fallback: true }, 502);
  }

  const body = await res.json();
  // Renamed or deleted repos come back null next to the ones that resolved;
  // GraphQL reports those as errors but still returns the rest, so partial
  // results are normal and fine.
  const out = {};
  clean.forEach((r, i) => {
    const n = body?.data?.[alias(i)]?.stargazerCount;
    if (Number.isInteger(n)) out[r] = n;
  });
  return json(out, 200, true);
}
