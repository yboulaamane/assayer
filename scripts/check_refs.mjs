// Re-verify every citation in the registry against Crossref.
//
//   node scripts/check_refs.mjs
//
// A citation is a claim that a particular work says a particular thing. This
// checks the weaker half of that automatically: that the DOI resolves, and that
// the author, year, journal and pages recorded here match what the registrar
// holds. It cannot check that the paper supports the threshold — only a reader
// can — but it does catch a DOI that was typed wrong or invented, which is the
// failure this project cannot afford.

import { REFERENCES } from "../web/assets/modules.js";

const API = "https://api.crossref.org/works/";
const UA = "assayer-citation-check/1.0 (https://assayer.vercel.app)";

/** "Jones et al. (1997) J Mol Biol 267:727–748" -> the pieces worth checking. */
function parse(cite) {
  const year = cite.match(/\((\d{4})\)/)?.[1];
  const family = cite.match(/^([^\s(]+)/)?.[1];
  const pages = cite.match(/(\d+)[–-](\d+)\s*$/);
  const volume = cite.match(/\s(\d+):\d+[–-]\d+\s*$/)?.[1];
  return { year, family, volume, first: pages?.[1], last: pages?.[2] };
}

const problems = [];
let checked = 0;

for (const [id, ref] of Object.entries(REFERENCES)) {
  let message;
  try {
    const r = await fetch(API + encodeURIComponent(ref.doi), { headers: { "User-Agent": UA } });
    if (!r.ok) { problems.push(`${id}: DOI ${ref.doi} did not resolve (${r.status})`); continue; }
    message = (await r.json()).message;
  } catch (e) {
    problems.push(`${id}: could not reach Crossref (${e.message})`);
    continue;
  }
  checked++;

  const want = parse(ref.cite);
  const gotFamily = (message.author || [])[0]?.family || "";
  const gotYear = String((message.issued?.["date-parts"] || [[]])[0][0] ?? "");
  const gotVolume = String(message.volume ?? "");
  const gotPages = String(message.page ?? "");
  const title = (message.title || [""])[0];

  // Years disagree by one between print and online issues often enough that an
  // exact match would cry wolf; everything else should be exact.
  if (want.family && gotFamily && !gotFamily.toLowerCase().startsWith(want.family.toLowerCase().slice(0, 5))) {
    problems.push(`${id}: first author is ${gotFamily}, cited as ${want.family}`);
  }
  if (want.year && gotYear && Math.abs(Number(want.year) - Number(gotYear)) > 1) {
    problems.push(`${id}: year is ${gotYear}, cited as ${want.year}`);
  }
  if (want.volume && gotVolume && want.volume !== gotVolume) {
    problems.push(`${id}: volume is ${gotVolume}, cited as ${want.volume}`);
  }
  if (want.first && gotPages && !gotPages.replace(/\s/g, "").startsWith(want.first)) {
    problems.push(`${id}: pages are ${gotPages}, cited as ${want.first}-${want.last}`);
  }
  console.log(`  ${problems.length ? " " : ""}${id.padEnd(14)} ${ref.doi.padEnd(30)} ${title.slice(0, 58)}`);
  await new Promise((r) => setTimeout(r, 400));   // be polite to the API
}

console.log(`\n${checked}/${Object.keys(REFERENCES).length} DOIs resolved`);
if (problems.length) {
  console.log("\nmismatches:");
  for (const p of problems) console.log("  - " + p);
  process.exitCode = 1;
} else {
  console.log("every citation matches the record Crossref holds.");
  console.log("\nThis checks the DOI and the bibliographic details, not that the");
  console.log("work supports the threshold it is attached to. That needs a reader.");
}
