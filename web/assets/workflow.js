// The consultant: read a plain-language research question, work out which
// protocol applies, fetch the target and its structures live from UniProt /
// RCSB / AlphaFold, and lay out the steps. It never runs any computation, // docking, MD and enrichment are the researcher's to run.

/* ------------------------------------------------------------------ intent */
// The protocol texts live in the module registry now; this file routes a
// question to one and resolves what it is about.
export { RECIPES as PROTOCOLS } from "./modules.js";
import { RECIPES, FAMILY_TERMS } from "./modules.js";

const INTENTS = [
  ["network-pharmacology", ["network pharmacology", "network-pharmacology", "systems pharmacology",
    "compound-target-disease", "compound target disease"]],
  ["fbdd", ["fragment", "fragments", "fbdd", "fragment screen", "fragment hit", "fragment growing",
    "fragment merging", "fragment linking", "xchem", "crystallographic screen", "ligand efficiency",
    "soaking", "fragment library"]],
  ["degrader", ["protac", "degrader", "molecular glue", "targeted protein degradation", "tpd",
    "e3 ligase", "ternary complex", "cereblon", "vhl", "degradation"]],
  ["selectivity", ["selectivity", "selective", "off-target", "off target", "counter-screen",
    "counterscreen", "cross-reactivity", "polypharmacology", "kinome-wide", "family-wide",
    "isoform selectivity", "paralog", "wrong target", "wrong kinase", "hitting the wrong",
    "promiscuous", "promiscuity", "cross-react", "also hits", "hits other"]],
  ["fep", ["fep", "free energy perturbation", "relative binding free energy", "rbfe", "abfe",
    "alchemical", "thermodynamic integration", "predict affinity change", "ddg"]],
  ["qsar", ["qsar", "qspr", "property model", "property prediction", "predict solubility",
    "predict logp", "predict activity", "predict potency", "machine learning model", "ml model",
    "train a model", "train a classifier", "regression model", "build a model", "model building",
    "featuris", "featuriz", "descriptor", "chemprop", "random forest", "scaffold split",
    "applicability domain", "predictive model"]],
  ["resistance", ["resistance", "resistant", "mutation", "mutant", "variant effect", "escape",
    "point mutation", "loses activity in the", "gatekeeper mutation", "\u0394\u0394g of mutation",
    "stability of a mutation", "missense", "variants", "polymorphism", "snp",
    "mutants vs", "versus wild", "vs wild", "wild-type", "wildtype", "allele"]],
  ["hit-discovery", ["inhibitor", "inhibitors", "hit", "hits", "screen", "screening", "virtual screening",
    "vs campaign", "find compounds", "find molecules", "dock", "docking", "binders", "actives",
    "hit finding", "hit identification", "antagonist", "agonist", "block"]],
  // "fep", "free energy" and "selectivity" now have protocols of their own and
  // are deliberately not claimed here.
  ["lead-opt", ["optimi", "lead series", "analog", "analogue", "sar", "potency",
    "improve binding", "affinity improvement", "matched pair", "next compound"]],
  ["denovo", ["de novo", "generate molecules", "generative", "design molecules", "design compounds",
    "new chemotype", "scaffold hopping", "protac", "degrader"]],
  ["antibody", ["antibody", "antibodies", "nanobody", "vhh", "biologic", "epitope", "bispecific",
    "cdr", "immunogen", "vaccine"]],
  ["admet", ["admet", "adme", "toxicity", "toxic", "pharmacokinetic", "pk ", "safety", "herg",
    "hepatotox", "liability", "bioavailab", "metabolism", "permeability"]],
  ["conformational-sampling", ["conformational sampling", "conformational ensemble",
    "conformational landscape", "conformational space", "conformational change",
    "enhanced sampling", "accelerated md", "gamd", "metadynamics", "replica exchange",
    "rest2", "umbrella sampling", "weighted ensemble", "rare event", "cryptic pocket",
    "free energy landscape", "markov state model", "ensemble generation", "ensemble docking",
    "sample the conformation", "explore the conformation", "flexibility of", "sample 3a4"]],
  ["md-stability", ["molecular dynamics", "simulate", "simulation", "stability of", "md of",
    "allosteric", "residence time", "pocket dynamics", "stable", "stability", "dynamics",
    "trajectory", "equilibrat", "rmsd", "rmsf", "in md", "run md"]],
  ["retrosynthesis", ["synthesi", "retrosynthe", "route", "make this molecule", "synthesise", "synthesize"]],
  ["target-triage", ["which target", "find a target", "target for", "target identification",
    "validate the target", "druggable", "disease", "novel target", "target selection"]],
  ["structure", ["structure of", "best structure", "model of", "fold", "crystal structure",
    "alphafold", "pdb", "conformation of"]],
];

const ORGANISMS = [
  [["human", "homo sapiens", "h. sapiens", "hsa"], 9606, "Homo sapiens"],
  [["mouse", "mus musculus", "murine"], 10090, "Mus musculus"],
  [["rat", "rattus"], 10116, "Rattus norvegicus"],
  [["zebrafish", "danio"], 7955, "Danio rerio"],
  [["yeast", "saccharomyces", "s. cerevisiae"], 559292, "Saccharomyces cerevisiae"],
  [["e. coli", "e.coli", "escherichia"], 83333, "Escherichia coli"],
  [["sars-cov-2", "sars cov 2", "covid", "coronavirus"], 2697049, "SARS-CoV-2"],
  [["tuberculosis", "m. tuberculosis", "mtb"], 83332, "Mycobacterium tuberculosis"],
  [["plasmodium", "malaria", "falciparum"], 36329, "Plasmodium falciparum"],
  [["arabidopsis"], 3702, "Arabidopsis thaliana"],
  [["drosophila", "fruit fly"], 7227, "Drosophila melanogaster"],
  [["c. elegans", "caenorhabditis"], 6239, "Caenorhabditis elegans"],
  [["candida"], 237561, "Candida albicans"],
  [["honey bee", "honeybee", "apis mellifera", "bee"], 7460, "Apis mellifera"],
  [["dog", "canine", "beagle"], 9615, "Canis lupus familiaris"],
  [["rabbit"], 9986, "Oryctolagus cuniculus"],
  [["pig", "porcine", "swine"], 9823, "Sus scrofa"],
  [["monkey", "macaque", "cynomolgus"], 9544, "Macaca mulatta"],
  [["guinea pig"], 10141, "Cavia porcellus"],
  [["hamster", "cho cell"], 10029, "Cricetulus griseus"],
  [["mosquito", "anopheles"], 7165, "Anopheles gambiae"],
  [["aedes"], 7159, "Aedes aegypti"],
  [["daphnia"], 6668, "Daphnia pulex"],
  [["tribolium", "flour beetle"], 7070, "Tribolium castaneum"],
  [["xenopus", "frog"], 8355, "Xenopus laevis"],
  [["chicken", "avian"], 9031, "Gallus gallus"],
  [["cow", "bovine", "cattle"], 9913, "Bos taurus"],
  [["trypanosoma", "trypanosome"], 5691, "Trypanosoma brucei"],
  [["leishmania"], 5671, "Leishmania major"],
  [["schistosoma"], 6183, "Schistosoma mansoni"],
  [["pseudomonas"], 287, "Pseudomonas aeruginosa"],
  [["staph", "staphylococcus", "aureus", "mrsa"], 1280, "Staphylococcus aureus"],
];

const ORGANISM_TERMS = ORGANISMS
  .flatMap(([words, id, label]) => words.map((w) => [w, id, label]))
  .sort((a, b) => b[0].length - a[0].length);

const STOP = new Set(["I", "A", "THE", "FOR", "AND", "OF", "TO", "IN", "ON", "WITH", "MY", "WE",
  "AN", "IS", "ARE", "WANT", "NEED", "FIND", "HOW", "WHAT", "CAN", "DO", "DNA", "RNA", "AI", "ML",
  "PDB", "MD", "FEP", "SAR", "PK", "US", "IT", "BE", "OR", "AT", "SO", "IF", "NEW", "ITS",
  "ADMET", "ADME", "HERG", "QSAR", "RMSD", "IC50", "EC50", "LLM", "GPU", "CPU", "HTS", "SMILES",
  // family names, not genes, only meaningful with their number attached
  "CYP", "UGT", "GST", "SULT", "ABC", "SLC", "PDE", "HDAC", "GPCR", "TRP", "HSP",
  "CES", "FMO", "NAT", "MRP", "OATP", "AKR", "NQO",
  "THIS", "THAT", "MY", "SET", "ALL", "ANY", "BEST", "GOOD",
  "PROTAC", "PROTACS", "TPD", "FBDD", "FEP", "RBFE", "ABFE", "DEL", "HTS", "SPR",
  "ITC", "NMR", "SAR", "MMP", "LE", "LLE", "DMSO", "E3",
  // experimental shorthand, not proteins: "mutants vs WT" is not a request
  // about Wilms tumor protein
  "WT", "MT", "KO", "KD", "SNP", "SNPS", "VUS", "INDEL", "VS", "CTRL", "DMSO"]);

// Questions where the noun is a disease, an endpoint or a molecule, not a
// protein to look up. Guessing one produces confident nonsense.
const NO_PROTEIN = new Set(["admet", "retrosynthesis", "target-triage", "network-pharmacology"]);

// Common informal names that UniProt search alone handles badly.
const ALIASES = {
  "mpro": "3C-like proteinase", "main protease": "3C-like proteinase",
  "spike": "spike glycoprotein", "3clpro": "3C-like proteinase",
  "ace2": "ACE2", "parp": "PARP1", "cox-2": "PTGS2", "cox2": "PTGS2",
  "pd-l1": "CD274", "pdl1": "CD274", "pd-1": "PDCD1", "her2": "ERBB2",
  "vegfr2": "KDR", "gsk3b": "GSK3B", "gsk-3": "GSK3B", "cdk2": "CDK2",
  "beta-secretase": "BACE1", "bace": "BACE1", "ache": "ACHE",
  "acetylcholinesterase": "ACHE", "tnf-alpha": "TNF", "il-6": "IL6",
  // Cytochromes are almost always written as the bare isoform in conversation.
  "3a4": "CYP3A4", "2d6": "CYP2D6", "2c9": "CYP2C9", "2c19": "CYP2C19",
  "1a2": "CYP1A2", "2b6": "CYP2B6", "3a5": "CYP3A5",
  // enzyme and family shorthand that does not match a gene symbol
  "dhfr": "dihydrofolate reductase", "mtor": "MTOR", "aurora": "AURKA",
  "aurora a": "AURKA", "aurora b": "AURKB", "pi3k alpha": "PIK3CA",
  "pi3k beta": "PIK3CB", "pi3k": "PIK3CA", "beta-2 adrenergic": "ADRB2",
  "beta2 adrenergic": "ADRB2", "thymidylate synthase": "TYMS",
  "hmg-coa reductase": "HMGCR", "topoisomerase ii": "TOP2A",
  "carbonic anhydrase": "CA2", "mao-b": "MAOB", "mao-a": "MAOA",
  "5-lox": "ALOX5", "sglt2": "SLC5A2", "dpp-4": "DPP4", "dpp4": "DPP4",
};

// Gene families are written with a space as often as not ("CYP 9Q3", "UGT 1A1").
// Rejoin them before token extraction, or the family name alone becomes the
// target, and a bare family name resolves to something unrelated: "CYP" hits
// cyclophilin, not cytochrome P450.
const FAMILY_SPLIT = /\b([A-Z]{2,6})\s+(\d[A-Z0-9]{0,5})\b/g;

/**
 * Map informal names onto something UniProt can resolve.
 *
 * Applied to the model's answer as well as the user's words: asked the same
 * question twice the model may say "AURKA" or "Aurora kinase", and the alias
 * table is what makes both land on the same accession.
 */
// Longest first, so "aurora b" is tried before "aurora" and "pi3k alpha"
// before "pi3k". Matched on word boundaries, because plain substring search
// finds "mpro" inside "improve" and hands back SARS-CoV-2 main protease.
const ALIAS_KEYS = Object.keys(ALIASES).sort((a, b) => b.length - a.length);
const WORDISH = (k) => new RegExp(`(?<![\\w-])${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`, "i");
const ALIAS_RE = new Map(ALIAS_KEYS.map((k) => [k, WORDISH(k)]));

export function aliasTarget(text, substring = false) {
  if (!text) return null;
  const low = String(text).toLowerCase().trim();
  if (ALIASES[low]) return ALIASES[low];
  for (const k of ALIAS_KEYS) {
    if (substring && ALIAS_RE.get(k).test(low)) return ALIASES[k];
  }
  // "aurora kinase" -> "aurora"; drop a trailing descriptor and retry
  const trimmed = low.replace(/\s+(kinase|receptor|protein|enzyme|transporter|channel|synthase|reductase)s?$/, "");
  return ALIASES[trimmed] || null;
}

export function parseQuery(raw) {
  const q = (raw || "").replace(FAMILY_SPLIT, "$1$2").trim();
  // Score on what is being asked for. "Do not run docking or virtual screening"
  // contains every docking keyword there is, and counting them routes the
  // request to the one thing it explicitly rules out.
  const low = q.toLowerCase().replace(EXCLUDED_METHODS, " ");
  const entityText = q.toLowerCase();

  // Short acronyms carry more signal than their length suggests: "FEP" names a
  // method exactly, while "analogue" appears in half the questions people ask.
  const STRONG = new Set(["fep", "rbfe", "abfe", "fbdd", "protac", "gamd", "tpd",
                          "molecular glue", "degrader", "off-target", "selectivity"]);
  let intent = "hit-discovery", best = 0;
  for (const [id, words] of INTENTS) {
    let s = 0;
    for (const w of words) if (low.includes(w)) s += (w.length > 8 || STRONG.has(w)) ? 2 : 1;
    if (s > best) { best = s; intent = id; }
  }
  if (!best) intent = "hit-discovery";
  // An explicitly named network study can mention screening, hits and docking
  // as substeps. Those overlapping keywords must not replace the study itself.
  if (INTENTS.find(([id]) => id === "network-pharmacology")[1].some((w) => low.includes(w))) {
    intent = "network-pharmacology";
    best = Math.max(best, 4);
  }

  const score = best;
  // Flattened and sorted by phrase length so "guinea pig" beats "pig".
  let organism = null;
  for (const [w, id, label] of ORGANISM_TERMS) {
    if (WORDISH(w).test(entityText)) { organism = { id, label }; break; }
  }

  let target = null;
  if (NO_PROTEIN.has(intent)) {
    return { query: q, intent, organism, target: null, score, via: "keywords", matched: true };
  }
  target = aliasTarget(entityText, true);
  if (!target) {
    // Gene-ish tokens: 2-9 chars, upper-case/digits, at least one letter, so
    // "3A4" and "G12C" are caught alongside "EGFR".
    const caps = (q.match(/\b(?=[A-Z0-9-]{2,9}\b)(?=[A-Z0-9-]*[A-Z])[A-Z0-9][A-Z0-9-]{1,8}\b/g) || [])
      .filter((t) => !STOP.has(t));
    if (caps.length) target = caps[0];
  }
  if (!target) {
    const m = q.match(/\b(?:of|for|against|targeting|inhibit(?:ing)?)\s+([A-Za-z0-9][\w-]{2,24})/i);
    if (m && !STOP.has(m[1].toUpperCase())) target = m[1];
  }
  // Drug discovery means human unless told otherwise. Without this, UniProt's
  // relevance ranking picks the species, "EGFR" alone returns the honey bee
  // orthologue, which is a silent, confident, wrong answer.
  if (target && !organism) organism = { id: 9606, label: "Homo sapiens", assumed: true };

  return { query: q, intent, organism, target, score, via: "keywords", matched: best > 0 };
}

function organismByTaxid(taxid) {
  if (!taxid) return null;
  const hit = ORGANISMS.find(([, id]) => id === taxid);
  return hit ? { id: hit[1], label: hit[2] } : { id: taxid, label: `taxon ${taxid}` };
}

/**
 * Route a question, asking the model only when the keyword router is unsure.
 *
 * Clear questions never leave the browser, so the free tier is spent on the
 * ambiguous ones. Every failure, no key, quota gone, slow model, nonsense
 * JSON, lands back on the keyword result rather than breaking the page.
 */
export async function resolveQuery(raw) {
  const kw = parseQuery(raw);
  // Confident when the router matched real signal AND either found a protein or
  // is on a protocol that needs none; or when the intent match alone is strong.
  const resolved = kw.target || NO_PROTEIN.has(kw.intent);
  // A high keyword score on a request with explicit exclusions is confidence in
  // the wrong thing: "do not run docking" contains every docking keyword there
  // is. Always ask when constraints are stated.
  const constraints = statedConstraints(raw);
  kw.constraints = constraints;
  if (!constraints.length && ((kw.score >= 2 && resolved) || kw.score >= 4)) return kw;

  try {
    const r = await fetch("api/route", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: raw }),
    });
    if (!r.ok) return { ...kw, degraded: true };
    const d = await r.json();
    if (d?.matched === false || d?.intent === "unsupported") {
      return { ...kw, matched: false, target: null, via: "llm" };
    }
    if (!d || !RECIPES[d.intent]) return { ...kw, degraded: true };
    return {
      query: raw,
      intent: d.intent,
      // The model answers in prose as readily as in gene symbols, so run it
      // through the same alias table. An explicit null means it judged there to
      // be no protein here, which has to beat the keyword guess rather than
      // fall back to it.
      target: d.intent === "network-pharmacology" ? null : "target" in d
        ? (d.target ? aliasTarget(d.target) || d.target : null)
        : kw.target,
      organism: organismByTaxid(d.organism_taxid) || kw.organism,
      score: kw.score,
      via: "llm",
      reason: d.reason || null,
      matched: true,
      truncated: Boolean(d.truncated),
      constraints,
    };
  } catch {
    return { ...kw, degraded: true };
  }
}

// Match only a list of method names after a negation. Free-text tails swallow
// positive clauses such as "without docking but use MD".
const METHOD_TERM = [...new Set(Object.values(FAMILY_TERMS).flat())]
  .sort((a, b) => b.length - a.length)
  .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
const METHOD_NAME = `(?:${METHOD_TERM.join("|")})\\b`;
const EXCLUDED_METHODS = new RegExp(
  `\\b(?:no need for|no|without|avoid|exclude|skip|don['’]?t (?:use|run|want)|do not (?:use|run|want)|not run|cannot run|can['’]?t run|rather not)\\s+(${METHOD_NAME}(?:\\s*(?:,\\s*(?:(?:and|or)\\s+)?|/|\\b(?:and|or)\\s+)${METHOD_NAME})*)`, "gi");
const MISSING_ASSETS = /\b(?:no|without|do not have|don['’]?t have)\s+((?:(?:usable|experimental|known|measured|matching)\s+)?(?:structures?|actives?|data|topology|trajector\w*))\b/gi;

const CONSTRAINT_PATTERNS = [
  [EXCLUDED_METHODS, "excluded method"],
  [/\b(cpu[- ]only|no gpu|without a gpu|single (?:cpu|core)|laptop only)\b/gi, "compute limit"],
  [/\b((?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:days?|weeks?|hours?))\b/gi, "time limit"],
  [/\b(?:spare|selective over|selectivity over|but not|whilst sparing|while sparing)\s+([A-Z][A-Z0-9-]{1,9})\b/g, "off-target"],
  [/\b(?:i have|we have|already have|existing|my)\s+(?:[\w-]+\s+){0,2}?((?:\d+\s+)?(?:(?:measured|assayed|known|matching|crystal|experimental)\s+)?(?:compounds?|analogues?|trajector\w+|topology|structures?|hits?|actives?|variants?|mutations?|series|dataset))\b/gi, "existing asset"],
  [/\b(\d+\s+(?:measured|assayed|known|screened)?\s*(?:compounds?|analogues?|hits?|actives?|variants?|mutations?|structures?))\b/gi, "existing asset"],
  [/\b(measured SAR|assay data|measured data)\b/gi, "existing asset"],
  [MISSING_ASSETS, "missing asset"],
];

/** Preserve all stated constraints; presentation limits must not discard facts. */
export function statedConstraints(text) {
  const out = [];
  for (const [re, kind] of CONSTRAINT_PATTERNS) {
    const source = kind === "existing asset"
      ? String(text || "").replace(MISSING_ASSETS, ".") : String(text || "");
    for (const m of source.matchAll(re)) {
      const phrase = (m[1] || m[0]).trim().replace(/\s+/g, " ");
      if (phrase && !out.some((o) => o.kind === kind && o.phrase.toLowerCase() === phrase.toLowerCase())) {
        out.push({ kind, phrase });
      }
    }
  }
  return out;
}

/** The protocols on offer, for telling someone what is actually covered. */
export const PROTOCOL_LIST = () =>
  Object.entries(RECIPES).map(([id, p]) => ({ id, label: p.label }));

/* ------------------------------------------------------- live data lookups */
const UNIPROT = "https://rest.uniprot.org/uniprotkb";
const RCSB_SEARCH = "https://search.rcsb.org/rcsbsearch/v2/query";
const RCSB_GQL = "https://data.rcsb.org/graphql";
const AFDB = "https://alphafold.ebi.ac.uk/api/prediction";

async function jget(url) {
  const r = await fetch(url, { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}
async function jpost(url, body) {
  const r = await fetch(url, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

export async function findTarget(name, organism) {
  const esc = name.replace(/"/g, "");
  const org = organism ? ` AND organism_id:${organism.id}` : "";
  const fields = "accession,id,protein_name,gene_names,organism_name,organism_id,length";
  // Widen in steps: curated and in-species first, then TrEMBL, then drop the
  // species filter. Insisting on reviewed:true returns nothing for most
  // non-model organisms, every insect P450 lives in TrEMBL.
  const precise = `(gene:${esc} OR protein_name:"${esc}")`;
  const tries = organism?.assumed
    // Human was assumed, not asked for. Apply it only to precise gene/name
    // matches: combining a guessed species with a free-text search returns
    // whatever human protein merely mentions the term, "spike glycoprotein"
    // lands on a human aminopeptidase that happens to be a coronavirus receptor.
    ? [
        [`${precise}${org} AND reviewed:true`, true],
        [`${precise}${org}`, true],
        [`${precise} AND reviewed:true`, false],
        [precise, false],
        [`${esc} AND reviewed:true`, false],
        [esc, false],
      ]
    : [
        [`${precise}${org} AND reviewed:true`, true],
        [`${precise}${org}`, true],
        [`${esc}${org}`, true],
        [`${precise} AND reviewed:true`, false],
        [precise, false],
        [`${esc} AND reviewed:true`, false],
        [esc, false],
      ];
  for (const [q, inSpecies] of tries) {
    const d = await jget(`${UNIPROT}/search?query=${encodeURIComponent(q)}&fields=${fields}&size=5&format=json`);
    if (d.results && d.results.length) {
      const scoreHit = (r) => {
        const gene = (r.genes?.[0]?.geneName?.value || "").toLowerCase();
        const nm = (r.proteinDescription?.recommendedName?.fullName?.value || "").toLowerCase();
        const want = esc.toLowerCase();
        let sc = 0;
        if (gene === want) sc += 6;                       // exact gene symbol
        else if (gene.startsWith(want)) sc += 3;
        if (nm === want) sc += 4;
        else if (nm.includes(want)) sc += 1;
        if (r.entryType && /reviewed/i.test(r.entryType)) sc += 2;   // Swiss-Prot
        if (organism && r.organism?.taxonId === organism.id) sc += 3;
        return sc;
      };
      d.results.sort((a, b) => scoreHit(b) - scoreHit(a));
      const hits = d.results.map((r) => ({
        accession: r.primaryAccession,
        id: r.uniProtkbId,
        name: r.proteinDescription?.recommendedName?.fullName?.value
           || r.proteinDescription?.submissionNames?.[0]?.fullName?.value || r.uniProtkbId,
        gene: r.genes?.[0]?.geneName?.value || null,
        organism: r.organism?.scientificName || null,
        length: r.sequence?.length || null,
      }));
      // Tell the caller when we had to leave the requested species behind.
      hits.droppedOrganism = Boolean(organism) && !inSpecies;
      return hits;
    }
  }
  return [];
}

// Het codes that are crystallisation reality, not chemical matter.
const JUNK = new Set(["HOH", "SO4", "PO4", "GOL", "EDO", "PEG", "PGE", "1PE", "ACT", "CL", "NA",
  "MG", "ZN", "CA", "K", "MN", "FE", "NI", "CD", "CU", "DMS", "MPD", "TRS", "IMD", "FMT", "NO3",
  "CIT", "EPE", "BME", "IOD", "BR", "ACE", "NH2", "SCN", "AZI", "MLI", "TLA", "P6G", "OLC", "LDA",
  "SIN", "MES", "BCT", "FLC", "GLY", "EOH", "IPA", "ARS", "PER", "UNX", "UNL"]);
const COFACTORS = new Set(["ATP", "ADP", "ANP", "AGS", "ACP", "GTP", "GDP", "GNP", "NAD", "NAI",
  "NAP", "NDP", "FAD", "FMN", "SAM", "SAH", "COA", "HEM", "PLP", "TPP", "UDP", "UTP", "CTP"]);

export async function findStructures(accession, organismLabel) {
  const body = {
    query: {
      type: "group", logical_operator: "and", nodes: [{
        type: "terminal", service: "text", parameters: {
          attribute: "rcsb_polymer_entity_container_identifiers.reference_sequence_identifiers.database_accession",
          operator: "exact_match", value: accession,
        },
      }],
    },
    return_type: "entry",
    request_options: { paginate: { start: 0, rows: 80 }, results_verbosity: "compact" },
  };
  let ids = [], total = 0;
  try {
    const d = await jpost(RCSB_SEARCH, body);
    ids = (d.result_set || []).slice(0, 60);
    total = d.total_count || ids.length;
  } catch { ids = []; }
  if (!ids.length) return { entries: [], total: 0 };

  const gql = `{ entries(entry_ids: [${ids.map((i) => `"${i}"`).join(",")}]) {
    rcsb_id struct { title } exptl { method }
    rcsb_entry_info { resolution_combined deposited_model_count }
    refine { ls_R_factor_R_free }
    nonpolymer_entities { nonpolymer_comp { chem_comp { id name formula_weight } } }
    polymer_entities {
      entity_poly { rcsb_sample_sequence_length }
      rcsb_entity_source_organism { scientific_name }
    } } }`;
  const d = await jpost(RCSB_GQL, { query: gql });
  const entries = (d.data?.entries || []).filter(Boolean).map((e) => score(e, organismLabel));
  entries.sort((a, b) => b.score - a.score);
  return { entries, total };
}

function score(e, organismLabel) {
  const res = e.rcsb_entry_info?.resolution_combined?.[0] ?? null;
  const rfree = e.refine?.[0]?.ls_R_factor_R_free ?? null;
  const method = e.exptl?.[0]?.method || "";
  const org = e.polymer_entities?.[0]?.rcsb_entity_source_organism?.[0]?.scientific_name || null;

  const hets = (e.nonpolymer_entities || [])
    .map((n) => n.nonpolymer_comp?.chem_comp)
    .filter(Boolean)
    .map((c) => ({ id: c.id, name: c.name, mw: c.formula_weight || 0 }));
  const drug = hets.filter((h) => !JUNK.has(h.id) && !COFACTORS.has(h.id) && h.mw >= 250 && h.mw <= 900);
  const cofactor = hets.filter((h) => COFACTORS.has(h.id));

  let s = 0;
  const reasons = [];
  if (res != null) {
    const add = Math.max(0, (3.2 - res) * 2.2);
    s += add;
    if (res <= 2.0) reasons.push(`${res.toFixed(2)} Å, high resolution`);
    else if (res > 2.8) reasons.push(`${res.toFixed(2)} Å, modest resolution`);
  } else s -= 1;
  if (rfree != null) {
    s += Math.max(0, (0.30 - rfree) * 25);
    if (rfree > 0.28) reasons.push(`R-free ${rfree.toFixed(3)} is high`);
  }
  if (drug.length) { s += 3.5; reasons.push(`holo: ${drug[0].id} (${Math.round(drug[0].mw)} Da) in the site`); }
  else if (cofactor.length) { s += 1; reasons.push(`cofactor only (${cofactor[0].id}), apo for a ligand campaign`); }
  else reasons.push("apo, no ligand to redock against");
  if (method.includes("X-RAY")) s += 1;
  else if (method.includes("ELECTRON")) { s += 0.4; reasons.push("cryo-EM"); }
  else if (method.includes("NMR")) { s -= 0.5; reasons.push("NMR ensemble"); }
  if (organismLabel && org && org.toLowerCase() === organismLabel.toLowerCase()) s += 1;
  else if (organismLabel && org) reasons.push(`construct from ${org}`);

  return {
    id: e.rcsb_id, title: e.struct?.title || "", method, res, rfree, org,
    ligands: drug, cofactors: cofactor, holo: drug.length > 0,
    score: Math.round(s * 10) / 10, reasons,
  };
}

export async function alphafold(accession) {
  try {
    const d = await jget(`${AFDB}/${accession}`);
    const m = d[0];
    return m ? { id: m.entryId, cif: m.cifUrl, pdb: m.pdbUrl, pae: m.paeImageUrl, version: m.latestVersion } : null;
  } catch { return null; }
}

/* --------------------------------------------------------------- protocols */
const S = (title, why, opts = {}) => ({ title, why, ...opts });



/* ------------------------------------------------------------------ export */
export function planToMarkdown(plan, target, structures, brief) {
  const L = [];
  L.push(`# ${plan.label}`, "");
  L.push(`**Question:** ${brief?.question ?? ""}`, "");
  if (brief?.excluded?.length) L.push(`**Excluded:** ${brief.excluded.join(", ")}`, "");
  if (brief?.assets?.length) L.push(`**Already in hand:** ${brief.assets.join(", ")}`, "");
  if (brief?.missing?.length) L.push(`**Missing:** ${brief.missing.join(", ")}`, "");
  if (brief?.offTargets?.length) L.push(`**Must spare:** ${brief.offTargets.join(", ")}`, "");
  if (brief?.compute?.length || brief?.time?.length) L.push(`**Not costed or scheduled:** ${[...(brief.compute || []), ...(brief.time || [])].join(", ")}`, "");
  if (brief?.degraded) L.push("**Routing:** Semantic routing was unavailable; review this provisional plan against the full question.", "");
  if (brief?.truncated) L.push("**Routing:** The model saw only the first 1,500 characters; review the selected workflow.", "");
  if (!plan.viable) L.push("**Provisional plan:** Missing inputs or excluded methods prevent this plan from being ready to follow. Resolve the conditions below first.", "");
  if (plan.rerouted) L.push(`**Route changed:** ${plan.rerouted.from} → ${plan.rerouted.to} (${plan.rerouted.because})`, "");
  L.push(plan.summary, "");
  if (plan.decision) L.push(`**This decides:** ${plan.decision}`, "");
  if (plan.stop) L.push(`**Stop if:** ${plan.stop}`, "");
  if (target) {
    L.push("## Target", "", `- **${target.name}** (${target.gene || "—"})`,
      `- UniProt: ${target.accession} · ${target.organism} · ${target.length} aa`, "");
  }
  if (structures && structures.length) {
    L.push("## Ranked structures", "", "| PDB | Res (Å) | R-free | State | Score |",
      "|---|---|---|---|---|");
    for (const s of structures.slice(0, 8)) {
      L.push(`| ${s.id} | ${s.res?.toFixed(2) ?? "—"} | ${s.rfree?.toFixed(3) ?? "—"} | ${s.holo ? `holo (${s.ligands[0].id})` : "apo"} | ${s.score} |`);
    }
    L.push("");
  }
  L.push("## Protocol", "");
  plan.steps.forEach((s, i) => {
    L.push(`### ${i + 1}. ${s.title}`, "", s.why, "");
    if (s.context) L.push(s.context, "");
    if (s.unmet?.length) L.push(`> **Before this step:** Provide or complete ${s.unmet.map((n) => n.replaceAll("_", " ")).join(", ")}. This step and dependent work are conditional.`, "");
    if (s.gate) L.push(`> **Gate:** ${s.gate}`, "");
    if (s.pitfall) L.push(`> **Common failure:** ${s.pitfall}`, "");
    if (s.tools?.length) L.push(`*Tools:* ${s.tools.join(", ")}`, "");
  });
  if (plan.dropped?.length) {
    L.push("## Left out", "");
    for (const d of plan.dropped) L.push(`- ${d.title || d.id} — ${d.reason}`);
    L.push("");
  }
  L.push("---", "", "_Generated by Assayer. You run the computation; this plans it._");
  return L.join("\n");
}
