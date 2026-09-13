// The consultant: read a plain-language research question, work out which
// protocol applies, fetch the target and its structures live from UniProt /
// RCSB / AlphaFold, and lay out the steps. It never runs any computation, // docking, MD and enrichment are the researcher's to run.

/* ------------------------------------------------------------------ intent */
const INTENTS = [
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

const STOP = new Set(["I", "A", "THE", "FOR", "AND", "OF", "TO", "IN", "ON", "WITH", "MY", "WE",
  "AN", "IS", "ARE", "WANT", "NEED", "FIND", "HOW", "WHAT", "CAN", "DO", "DNA", "RNA", "AI", "ML",
  "PDB", "MD", "FEP", "SAR", "PK", "US", "IT", "BE", "OR", "AT", "SO", "IF", "NEW", "ITS",
  "ADMET", "ADME", "HERG", "QSAR", "RMSD", "IC50", "EC50", "LLM", "GPU", "CPU", "HTS", "SMILES",
  // family names, not genes, only meaningful with their number attached
  "CYP", "UGT", "GST", "SULT", "ABC", "SLC", "PDE", "HDAC", "GPCR", "TRP", "HSP",
  "CES", "FMO", "NAT", "MRP", "OATP", "AKR", "NQO",
  "THIS", "THAT", "MY", "SET", "ALL", "ANY", "BEST", "GOOD",
  "PROTAC", "PROTACS", "TPD", "FBDD", "FEP", "RBFE", "ABFE", "DEL", "HTS", "SPR",
  "ITC", "NMR", "SAR", "MMP", "LE", "LLE", "DMSO", "E3"]);

// Questions where the noun is a disease, an endpoint or a molecule, not a
// protein to look up. Guessing one produces confident nonsense.
const NO_PROTEIN = new Set(["admet", "retrosynthesis", "target-triage"]);

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
export function aliasTarget(text, substring = false) {
  if (!text) return null;
  const low = String(text).toLowerCase().trim();
  if (ALIASES[low]) return ALIASES[low];
  for (const k of Object.keys(ALIASES)) {
    if (substring ? low.includes(k) : false) return ALIASES[k];
  }
  // "aurora kinase" -> "aurora"; drop a trailing descriptor and retry
  const trimmed = low.replace(/\s+(kinase|receptor|protein|enzyme|transporter|channel|synthase|reductase)s?$/, "");
  return ALIASES[trimmed] || null;
}

export function parseQuery(raw) {
  const q = (raw || "").replace(FAMILY_SPLIT, "$1$2").trim();
  const low = q.toLowerCase();

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

  const score = best;
  let organism = null;
  for (const [words, id, label] of ORGANISMS) {
    if (words.some((w) => low.includes(w))) { organism = { id, label }; break; }
  }

  let target = null;
  if (NO_PROTEIN.has(intent)) return { query: q, intent, organism, target: null, score, via: "keywords" };
  target = aliasTarget(low, true);
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

  return { query: q, intent, organism, target, score, via: "keywords" };
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
  if ((kw.score >= 2 && resolved) || kw.score >= 4) return kw;

  try {
    const r = await fetch("api/route", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: raw }),
    });
    if (!r.ok) return kw;
    const d = await r.json();
    if (!d || !PROTOCOLS[d.intent]) return kw;
    return {
      query: raw,
      intent: d.intent,
      // The model answers in prose as readily as in gene symbols; run it
      // through the same alias table so both spellings reach one accession.
      target: (d.target && (aliasTarget(d.target) || d.target)) || kw.target,
      organism: organismByTaxid(d.organism_taxid) || kw.organism,
      score: kw.score,
      via: "llm",
      reason: d.reason || null,
    };
  } catch {
    return kw; // offline, blocked by a preview sandbox, or no function deployed
  }
}

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

export const PROTOCOLS = {
  fbdd: {
    label: "Fragment-based discovery",
    summary: "Fragments buy you a starting point in a pocket nothing else binds. The whole discipline is refusing to design from a hit you have not confirmed twice.",
    decision: "Whether a fragment hit is real, and in which direction to grow it.",
    stop: "If nothing reproduces orthogonally across a diverse library, that is the site telling you it is not ligandable. More fragments will not fix a flat surface.",
    steps: [
      S("Check the site can bind fragments at all", "Fragments need a real hot spot: a buried, enclosed subpocket with polar anchors. A flat, solvent-exposed surface produces a 0.1% hit rate and six months of disappointment, and you can find that out in an afternoon.", { live: "structures", gate: "Identify at least one hot spot with meaningful buried volume before committing to a screen.", pitfall: "Running the screen first and assessing ligandability afterwards, when the hit rate has already told you.", tools: ["FTMap", "Fragment Hotspot Maps", "fpocket", "P2Rank", "PocketMiner"] }),
      S("Choose the library for this target", "Fragment libraries are not interchangeable. Shape diversity, three-dimensionality, solubility at screening concentration and a sane functional-group distribution matter more than size.", { pitfall: "A library of flat aromatics against a polar pocket. You will get hits, and they will all be the same uninteresting chemotype.", tools: ["ZINC22", "Enamine REAL Space", "RDKit", "Datamol"] }),
      S("Confirm every hit by a second method", "Primary screening artefacts are the norm, not the exception. A hit seen by one technique is a candidate; a hit seen by two is a hit.", { gate: "Orthogonal confirmation by SPR, ITC, NMR or crystallography, plus a dose-response, before any design work starts.", pitfall: "Designing on a single-technique hit. Most of what you build will be on sand.", tools: ["PLIP", "ProLIF"] }),
      S("Find the real binding events in the density", "Fragment density is weak and partial-occupancy. Conventional refinement hides exactly the events you screened for; ground-state comparison is what surfaces them.", { gate: "Every fragment pose must sit in interpretable difference density. If you are arguing about whether it is there, it is not.", pitfall: "Modelling a fragment into noise, then spending a year growing it.", tools: ["PanDDA", "Fragalysis", "PyMOL (open source)", "UCSF ChimeraX"] }),
      S("Decide: grow, merge, or link", "Growing extends one fragment into adjacent space. Merging combines overlapping fragments into one scaffold. Linking joins two sites, and is the one that usually disappoints, because the linker rarely lets both halves bind as they did alone.", { gate: "Choose based on where the fragments actually sit, not on which is easiest to make.", pitfall: "Expecting linked fragments to give additive affinity. Superadditivity is the exception and the entropic cost is real.", tools: ["Fragmenstein", "SeeSAR", "DiffLinker", "CReM", "RDKit"] }),
      S("Hold ligand efficiency as you grow", "A fragment's value is its efficiency, not its potency. If every added heavy atom buys less than the last, you are inflating molecular weight rather than optimising.", { gate: "Ligand efficiency should hold or improve with each round. A potency gain that costs efficiency is a warning.", pitfall: "Chasing IC50 while LE quietly collapses, arriving at a 550 Da compound with the binding efficiency of the original fragment.", tools: ["RDKit", "DataWarrior", "PoseBusters", "xtb"] }),
      S("Re-solve the structure after every significant change", "Growing changes the binding mode more often than anyone expects. The assumption that your elaborated compound binds like its parent is the single most expensive assumption in FBDD.", { gate: "Assume the pose changed until a structure says otherwise.", tools: ["PanDDA", "Fragalysis", "ProLIF", "PLIP"] }),
    ],
  },
  selectivity: {
    label: "Selectivity & off-target profiling",
    summary: "Selectivity is designed in against a named list, not discovered at the end. The question is always \u201cselective against what, by how much\u201d.",
    decision: "Whether this chemotype can be made selective enough, and what to counter-screen against.",
    stop: "If the off-target's pocket is identical at every residue you could exploit, and no published ligand has ever separated the two, chemistry probably will not either.",
    steps: [
      S("Write down what selectivity means here", "\u201cSelective\u201d without a number and a named list is not a goal. Therapeutic margin, not fold-selectivity in the abstract, is what matters, and against off-targets that are actually expressed in the relevant tissue.", { gate: "State the fold-selectivity required, against which specific proteins, and why that number. Do this before any design.", pitfall: "Optimising against the off-target that is easy to assay rather than the one that causes the toxicity.", tools: ["Open Targets Platform", "Human Protein Atlas", "gnomAD"] }),
      S("Compare the pockets, not the sequences", "Sequence identity is a poor predictor of cross-reactivity. Two kinases at 40% identity can have identical ATP sites; two at 80% can differ at the one residue that matters.", { live: "structures", gate: "Align the binding sites specifically and list the residue differences you could exploit.", pitfall: "Reasoning from a phylogenetic tree instead of from the pocket.", tools: ["KLIFS", "GPCRdb", "PDBe-KB", "Foldseek", "ProLIF"] }),
      S("Predict off-targets from the chemistry", "Ligand-based target prediction tells you what your chemotype resembles. It is fast, cheap and worth doing before the first synthesis.", { pitfall: "Reading a clean prediction as a clean compound. These methods find known chemistry, a genuinely novel scaffold comes back clean because nothing like it has ever been tested.", tools: ["SEA", "SwissTargetPrediction", "STITCH", "ChEMBL", "Papyrus"] }),
      S("Find the difference you will exploit", "Selectivity comes from a specific interaction a specific residue makes possible: a gatekeeper, a pocket that only one family member opens, a water network that differs.", { gate: "Name the residue or subpocket. If you cannot, you do not have a selectivity strategy, you have a hope.", tools: ["ProLIF", "PLIP", "FTMap", "Fragment Hotspot Maps", "fpocket"] }),
      S("Predict the selectivity margin before making it", "Relative free energy across a target/off-target pair is one of the better-behaved FEP applications, because the perturbation is identical and the systems are similar.", { gate: "Validate on compounds whose selectivity is already measured before trusting a prediction.", tools: ["OpenFE", "BioSimSpace", "GROMACS", "smina", "gnina"] }),
      S("Counter-screen against reality", "Computational profiling narrows the panel; it does not replace it. The liabilities that kill programmes (hERG, CYP inhibition, the standard safety panel) are cheap to measure and expensive to discover late.", { gate: "Run the safety panel before committing to a series, not before the tox study.", tools: ["ADMETlab 3.0", "ProTox 3.0", "vNN-ADMET", "ADMET-AI", "OPERA"] }),
    ],
  },
  fep: {
    label: "Free energy campaign",
    summary: "Relative binding free energy is the one physics method that routinely beats docking on potency \u2014 when the series is congeneric, the pose is right, and you validated retrospectively first.",
    decision: "Which analogue to synthesise next, ranked with an error bar you can defend.",
    stop: "If retrospective validation cannot reproduce measured \u0394\u0394G within about 1.5 kcal/mol, the system is not ready. Fix the setup or rank with something cheaper and honest about it.",
    steps: [
      S("Check the series is actually congeneric", "FEP perturbs one molecule into another. That is only meaningful when they share a core and a binding mode; a scaffold hop is not an edge, it is a different question.", { gate: "Shared core, same pose, changes at defined positions. Otherwise use absolute free energy or do not use FEP.", pitfall: "Running a map across a series that quietly contains two binding modes.", tools: ["RDKit", "mmpdb", "Datamol"] }),
      S("Anchor on a structure you trust", "Every perturbation inherits the errors of the reference pose. A co-crystal with your chemotype is worth more here than anywhere else in the pipeline.", { live: "structures", pitfall: "Building a campaign on a docked pose. You will get precise numbers about the wrong geometry.", tools: ["RCSB PDB", "PDBe-KB", "PDBFixer", "PROPKA"] }),
      S("Decide protonation and tautomers explicitly", "The most common silent error in FEP is a ligand or site residue in the wrong state. The calculation will happily converge to a confident wrong answer.", { gate: "One recorded protonation and tautomer decision per ligand and per titratable site residue, with the reasoning.", tools: ["PROPKA", "MolGpKa", "OpenFF Toolkit", "espaloma", "xtb"] }),
      S("Design the perturbation map", "Map topology determines how errors propagate. Closed cycles let you measure your own error; a star map around one reference hides it.", { gate: "Include redundant cycles so cycle-closure error is measurable.", pitfall: "A star topology, cheap to run, impossible to diagnose.", tools: ["OpenFE", "BioSimSpace"] }),
      S("Validate retrospectively before predicting", "Run the edges you already have data for. This is the step that separates a working campaign from an expensive random number generator.", { gate: "Reproduce measured \u0394\u0394G within ~1 kcal/mol MUE, and get the ranking right, before anyone acts on a prediction.", tools: ["alchemlyb", "OpenFE", "FEP+ (Schrödinger)"] }),
      S("Check convergence, not wall-clock time", "Long is not converged. Overlap between neighbouring lambda windows, hysteresis between forward and reverse, and cycle closure are the diagnostics that matter.", { gate: "Report phase-space overlap, cycle-closure error and a bootstrapped uncertainty per edge.", tools: ["alchemlyb", "PLUMED", "MDAnalysis", "GROMACS", "OpenMM"] }),
      S("Act on differences bigger than your error", "The output is a number with an uncertainty. Ranking two compounds 0.3 kcal/mol apart when your MUE is 1.0 is theatre.", { gate: "Only prioritise gaps larger than the validated error. Report the error bar alongside every number you hand a chemist.", pitfall: "Presenting FEP output as a ranked list with no uncertainties. Chemists will treat it as truth and lose faith when it fails once.", tools: ["alchemlyb", "DataWarrior"] }),
    ],
  },
  degrader: {
    label: "Degrader / PROTAC design",
    summary: "A degrader is not an inhibitor. Potency against the target barely predicts degradation \u2014 cooperativity, geometry and cellular context do.",
    decision: "Whether a ternary complex is plausible for this pair, and which linker geometries to make.",
    stop: "If no linker length or exit vector gives degradation while both binaries demonstrably engage in cells, the ternary geometry may simply be unavailable for this target and this E3.",
    steps: [
      S("Choose the E3 for the biology, not the convenience", "CRBN and VHL dominate because the ligands exist, not because they are right for every target. E3 expression in the relevant cell and tissue is the first thing to check, and the one most often skipped.", { gate: "Confirm the E3 is expressed where you need degradation.", tools: ["PROTAC-DB", "Human Protein Atlas", "DepMap", "Open Targets Platform"] }),
      S("Get both binary binders right first", "A degrader inherits every weakness of its two halves. Weak or structurally uncharacterised binaries make the linker work unreadable, because failures cannot be attributed.", { gate: "Potent, structurally characterised binders for both target and E3, with known exit vectors, before any linker chemistry.", pitfall: "Starting linker SAR from a binary whose binding mode is a docking hypothesis.", live: "structures", tools: ["RCSB PDB", "PDBe-KB", "AutoDock Vina", "ProLIF"] }),
      S("Model the ternary complex as a hypothesis", "Ternary modelling is genuinely hard and current methods are not reliable enough to design from directly. Use it to bound linker length and exit-vector geometry, not to predict cooperativity.", { gate: "Treat every ternary model as a hypothesis that generates linkers, never as evidence of a complex.", pitfall: "Presenting a ternary model as a structure. It is a proposal with large error bars.", tools: ["HADDOCK3", "AlphaFold 3", "Boltz", "Chai-1", "PyRosetta", "PLIP"] }),
      S("Vary geometry, not just length", "Linker SAR has three axes (length, exit vector and rigidity) and teams routinely scan only the first. Attachment point often matters more than how many atoms sit between.", { gate: "Vary attachment point and rigidity alongside length, or you have run one axis of a three-axis problem.", tools: ["DiffLinker", "CReM", "RDKit", "SeeSAR", "Auto3D"] }),
      S("Design assays that can see the hook effect", "Excess degrader forms binary complexes instead of ternary ones, so degradation falls at high concentration. A single-concentration assay can miss the active window entirely.", { gate: "Full dose-response every time, wide enough to show the hook. Report Dmax and DC50, not percent degradation at one dose.", pitfall: "Calling a degrader inactive because you tested it at one concentration on the wrong side of the hook.", tools: ["PROTAC-DB"] }),
      S("Prove the mechanism is degradation", "Loss of signal is not proof of degradation. Rescue experiments are what distinguish a real degrader from an inhibitor, a toxin or an artefact.", { gate: "Rescue with a proteasome inhibitor, with E3 knockdown, and with a non-binding epimer control.", tools: ["PROTAC-DB", "DepMap"] }),
      S("Accept the property penalty and plan for it", "Degraders sit well outside Rule-of-Five space. Permeability and solubility are the usual reasons a potent degrader does nothing in cells, and they need designing for from the start.", { pitfall: "Optimising degradation in a biochemical system, then discovering the compound never enters a cell.", tools: ["SwissADME", "ADMETlab 3.0", "ADMET-AI", "RDKit"] }),
    ],
  },
  "hit-discovery": {
    label: "Structure-based hit discovery",
    summary: "Pick a receptor you can trust, prove the docking setup reproduces known binding, then screen, and only believe the screen if it enriches actives over decoys.",
    decision: "Which compounds to buy or make, and first, whether the docking setup can be trusted at all.",
    stop: "If the setup cannot redock the native ligand or enrich actives over decoys, stop and fix it. Screening millions of compounds on a broken setup yields a confident list of nothing.",
    steps: [
      S("Confirm the target and pull its sequence", "Resolve the name to a single UniProt accession so every later step (structures, constructs, orthologues) is anchored to one identifier rather than a gene symbol that may be ambiguous across species.", { live: "target", tools: ["UniProt", "Open Targets Platform", "Pharos / TCRD"] }),
      S("Choose the receptor structure", "Resolution alone does not decide this. You want a holo structure with a drug-like ligand in the site you care about, an ordered binding site, wild-type sequence, and the conformational state your chemotype should bind. The table below ranks every PDB entry for this target on exactly those grounds.", { live: "structures", tools: ["RCSB PDB", "AlphaFold Protein Structure DB", "Foldseek"] }),
      S("Prepare the receptor and the ligands", "Most docking failures are preparation failures: wrong protonation at physiological pH, missing side chains in the pocket, a tautomer the scoring function cannot reward. Fix the structure, assign states explicitly, and generate reasonable 3D conformers for the library.", { pitfall: "Leaving a crystallographic water in, or taking them all out, without deciding which are structural. Both choices are defensible; not choosing is not.", gate: "Binding-site residues must have zero missing heavy atoms before you dock.", tools: ["PDBFixer", "PROPKA", "PDB2PQR / APBS", "Meeko", "Open Babel", "RDKit"] }),
      S("Redock the native ligand", "The single cheapest sanity check in the field. Take the crystallographic ligand out, dock it back into its own receptor, and measure heavy-atom RMSD to the deposited pose. If your setup cannot recover a pose it was handed, nothing downstream means anything.", { pitfall: "A redock that only succeeds with the crystallographic ligand's own starting conformer. Randomise the input geometry or you are testing nothing.", gate: "Pass: top-ranked pose within 2.0 Å RMSD of the crystal pose. Fail: revisit box, protonation and ligand setup before going further.", tools: ["AutoDock Vina", "smina", "gnina", "PLIP", "ProLIF"] }),
      S("Cross-dock if the target moves", "One receptor is one conformational snapshot. If the target has several states (kinase DFG-in/out, an induced-fit subpocket, a flexible lid), dock each known ligand into every receptor and keep the receptors that recover the most poses. This is how you pick an ensemble instead of guessing.", { gate: "Keep receptors that redock ≥60% of the known ligand set within 2 Å.", tools: ["AutoDock Vina", "smina", "Uni-Dock", "ODDT"] }),
      S("Run the enrichment control", "Before screening millions of compounds, prove the setup can tell actives from look-alikes. Assemble known actives plus property-matched decoys, dock both, and measure how far up the ranking the actives land.", { pitfall: "Decoys that differ from the actives in molecular weight or logP. The model learns the property, reports beautiful enrichment, and tells you nothing about binding.", gate: "Report EF1%, BEDROC (α=20) and ROC-AUC. EF1% below ~5 means your ranking is close to noise, fix the setup rather than screening on it.", tools: ["DUD-E", "LIT-PCBA", "ODDT", "Therapeutics Data Commons"] }),
      S("Screen the library", "Now scale. Choose a library that matches what you can actually buy or make, and keep the bookkeeping in a database rather than a directory of poses, a screen you cannot query is a screen you will redo.", { tools: ["ZINC22", "Enamine REAL Space", "Uni-Dock", "VirtualFlow", "Ringtail", "EasyDock"] }),
      S("Triage the hits like a chemist", "Docking scores are a filter, not a ranking. Cluster by scaffold, look at the interactions rather than the number, strip PAINS and infeasible chemistry, and check each survivor is synthesisable or purchasable.", { pitfall: "Ranking by docking score. Scores separate binders from non-binders poorly and rank binders against each other worse.", gate: "Every compound you order should have a pose you can explain: which interactions, which subpocket, why it beats the decoys.", tools: ["PLIP", "ProLIF", "RDKit", "SCScore", "RAscore", "DataWarrior"] }),
      S("Rescore or simulate the survivors", "For the short list only, end-point or alchemical free energies and short MD tell you whether a pose is stable, at a cost you cannot afford on the full library.", { tools: ["GROMACS", "OpenMM", "gmx_MMPBSA", "OpenFE", "MDAnalysis"] }),
      S("Profile before you buy", "A potent compound with a fatal ADMET liability is a wasted synthesis slot. Run the cheap in-silico profile on the shortlist and let it break ties.", { pitfall: "Treating an ADMET prediction as a gate rather than a tiebreak this early. Good chemistry has been killed by a model trained on compounds nothing like yours.", tools: ["ADMETlab 3.0", "SwissADME", "pkCSM", "ADMET-AI", "ProTox 3.0"] }),
    ],
  },
  "lead-opt": {
    label: "Lead optimisation",
    summary: "Work out what drives potency in the series, propose analogues on that basis, and rank them with a method whose error bars you know.",
    decision: "Which analogue to make next in a series you already have.",
    stop: "If every potency gain now costs solubility, permeability or hERG, the series may be at its ceiling. That is a decision to take deliberately, not to discover in tox.",
    steps: [
      S("Anchor on a co-crystal of your series", "Optimising against a docked pose of your own compound compounds its errors. Get a structure with your chemotype, or the closest analogue that exists.", { live: "structures", tools: ["RCSB PDB", "PDBbind+", "BindingDB"] }),
      S("Map the existing SAR", "Before generating anything, know which changes have already been tried and what they did. Matched molecular pairs turn a spreadsheet of analogues into rules.", { pitfall: "Rediscovering the SAR your own project already generated because it lives in a spreadsheet nobody indexed.", tools: ["ChEMBL", "BindingDB", "RDKit", "DataWarrior"] }),
      S("Characterise the binding mode", "Interaction fingerprints plus a short simulation tell you which contacts are actually load-bearing and which subpocket has room, that is where the next analogue comes from.", { tools: ["PLIP", "ProLIF", "GROMACS", "MDAnalysis", "fpocket"] }),
      S("Propose analogues", "Enumerate around the scaffold with chemistry that is real. Constrained generation keeps the core and varies what you asked it to vary.", { tools: ["CReM", "SAFE", "REINVENT4", "RDKit", "Enamine REAL Space"] }),
      S("Rank with free energy, not docking score", "In a congeneric series, relative binding free energy is the method that earns its cost. Run it on a handful of well-chosen edges rather than everything.", { pitfall: "Running FEP across a scaffold hop. The method assumes a shared binding mode; breaking that assumption produces confident nonsense.", gate: "Validate on measured analogues first: RBFE should reproduce known ΔΔG within ~1 kcal/mol before you trust a prediction.", tools: ["OpenFE", "BioSimSpace", "alchemlyb", "GROMACS", "FEP+ (Schrödinger)"] }),
      S("Keep the properties in view", "Potency gained at the cost of solubility, permeability or hERG is not progress. Track the multi-parameter profile each cycle, not at the end.", { tools: ["ADMETlab 3.0", "ADMET-AI", "OPERA", "QSARtuna", "MolSkill"] }),
      S("Check you can make it", "Route feasibility decides which of your top ten actually gets tested next month.", { tools: ["AiZynthFinder", "ASKCOS", "Syntheseus", "RAscore"] }),
    ],
  },
  denovo: {
    label: "Generative design",
    summary: "Generate into a constrained space, then apply the same validation you would demand of any other compound source.",
    decision: "Whether any generated molecule is worth synthesising.",
    stop: "If everything surviving physical and synthetic filtering is a minor variant of the training set, the model is retrieving rather than designing.",
    steps: [
      S("Define the target and the pocket", "Generative models condition on something. Give them a receptor you have already validated, and a pocket definition you can defend.", { live: "structures", tools: ["RCSB PDB", "fpocket", "P2Rank", "PrankWeb"] }),
      S("Set the objective honestly", "A scoring function used as a reward will be exploited. Combine potency proxies with property and synthesisability terms from the start, rather than filtering afterwards.", { tools: ["REINVENT4", "QSARtuna", "Chemprop", "SCScore", "RAscore"] }),
      S("Generate", "Pocket-conditioned 3D generation or scaffold-constrained 2D generation, the choice depends on whether you trust the pocket geometry more than the known chemotype.", { tools: ["REINVENT4", "Pocket2Mol", "DiffSBDD", "TargetDiff", "SAFE", "DiffLinker"] }),
      S("Check the molecules are physically real", "Generative output is full of strained geometries and clashes that score well and cannot exist. Check before you get attached.", { gate: "Screen for strain energy, steric clashes and valence sanity, PoseBusters/PoseCheck failures are disqualifying, not cosmetic.", tools: ["PoseBusters", "PoseCheck", "RDKit"] }),
      S("Validate exactly like a screening hit", "Novelty is not evidence. Redock, rescore, enrichment-test the setup, and profile the survivors, the same gates as any other hit.", { tools: ["AutoDock Vina", "gnina", "ODDT", "ADMETlab 3.0"] }),
      S("Filter to what can be made", "A generated molecule nobody can synthesise is a picture. Route-check before it enters a project.", { gate: "Every nominated compound needs a proposed route or a catalogue match.", tools: ["AiZynthFinder", "ASKCOS", "Syntheseus", "Enamine REAL Space"] }),
    ],
  },
  antibody: {
    label: "Antibody / biologics discovery",
    summary: "Structure and repertoire first, design second, developability throughout.",
    decision: "Which binder to take into expression and developability work.",
    stop: "If CDR-H3 models disagree across methods and no structure is available, treat affinity predictions as unusable rather than uncertain.",
    steps: [
      S("Define the antigen and the epitope", "Everything downstream depends on which surface you are targeting and whether it is accessible in the biological context.", { live: "structures", tools: ["RCSB PDB", "AlphaFold Protein Structure DB", "SAbDab / SAbPred"] }),
      S("Mine what already binds it", "Known binders to the same antigen, or to close homologues, are the strongest starting point available.", { tools: ["SAbDab / SAbPred", "Observed Antibody Space (OAS)", "ChEMBL"] }),
      S("Number and clean the sequences", "Consistent numbering is the precondition for every antibody model and every ML step that follows.", { tools: ["ANARCI", "IgBLAST", "AbLang2"] }),
      S("Model the structures", "Fast, accurate Fv modelling is mature; CDR-H3 remains the hard part and should be treated as uncertain.", { gate: "Treat CDR-H3 loop conformations as hypotheses, not facts.", tools: ["ImmuneBuilder", "ABodyBuilder3", "Chai-1", "AlphaFold 3"] }),
      S("Design and score variants", "Affinity maturation in silico, with the caveat that predicted ΔΔG for protein-protein interfaces is noisier than for small molecules.", { tools: ["RFdiffusion", "ProteinMPNN", "LigandMPNN", "FoldX", "PyRosetta"] }),
      S("Screen for developability early", "Aggregation, polyreactivity, viscosity and expression liabilities kill more candidates than affinity does.", { gate: "Flag TAP outliers, unpaired cysteines, N-glycosylation and deamidation motifs before committing to expression.", tools: ["SAbDab / SAbPred", "ANARCI", "ImmuneBuilder"] }),
    ],
  },
  admet: {
    label: "ADMET & safety profiling",
    summary: "Cheap predictions first, applicability domain always, PBPK when the question is about exposure.",
    decision: "Which compounds carry a liability serious enough to deprioritise now.",
    stop: "If a compound sits outside every model's applicability domain, the predictions are not evidence. Measure it instead of arguing with the numbers.",
    steps: [
      S("Standardise the structures", "Salts, tautomers and inconsistent representations silently break every model you are about to run.", { gate: "One canonical parent structure per compound before any prediction.", tools: ["ChEMBL Structure Pipeline", "RDKit", "Datamol", "Open Babel"] }),
      S("Run the fast profile", "Web and local predictors cover absorption, distribution, metabolism, excretion and the common tox endpoints in minutes.", { pitfall: "Averaging several models into one number. Disagreement between them is information, and averaging discards it.", tools: ["ADMETlab 3.0", "SwissADME", "pkCSM", "ADMET-AI", "ProTox 3.0", "OPERA"] }),
      S("Check the applicability domain", "A confident prediction for a compound unlike anything in training is a guess wearing a number. Check similarity to the training set and prefer models that report it.", { gate: "Discount any endpoint where the compound falls outside the model's domain.", tools: ["OPERA", "vNN-ADMET", "QSARtuna"] }),
      S("Cross-check the liabilities that matter", "For the endpoints that kill programmes (hERG, DILI, mutagenicity, CYP inhibition), use more than one model and look for agreement.", { tools: ["ProTox 3.0", "vNN-ADMET", "ADMET-AI", "Therapeutics Data Commons"] }),
      S("Model exposure if the question is dose", "Endpoint predictions do not answer 'what plasma concentration'. PBPK does.", { tools: ["Open Systems Pharmacology (PK-Sim/MoBi)", "Simcyp (Certara)", "GastroPlus"] }),
    ],
  },
  "conformational-sampling": {
    label: "Conformational sampling",
    summary: "Plain MD will not cross the barriers that matter. Pick the sampling method from the observable you actually need, then prove the ensemble converged before anyone docks into it.",
    decision: "Which conformational states to carry into docking or design.",
    stop: "If the landscape has not converged across replicates, do not use the ensemble. An unconverged ensemble is worse than a single crystal structure, because it looks thorough.",
    steps: [
      S("Name the observable first", "An ensemble for ensemble docking, a cryptic pocket, a binding pathway, and a rate constant are four different questions, and each has a different right method. Choosing the method before naming the observable is the usual way these campaigns waste a month of GPU time.", { gate: "Write down what result would change your decision. If no answer to the simulation changes what you do next, do not run it." }),
      S("Pick and prepare the structure", "Flexible proteins are exactly the ones with disordered loops in their crystal structures. What is missing near your site of interest matters more here than resolution does.", { live: "structures", tools: ["RCSB PDB", "AlphaFold Protein Structure DB", "PDBFixer", "MODELLER", "PROPKA", "CHARMM-GUI"] }),
      S("Ask whether a cryptic pocket is even expected", "Before committing to microseconds of sampling, get a cheap prior on whether this protein opens a pocket at all, and where.", { tools: ["PocketMiner", "fpocket", "P2Rank"] }),
      S("Choose the sampling method", "This is the step that decides whether the campaign works. With no defensible collective variable, use accelerated MD (GaMD) or replica exchange, both of which flatten barriers without you naming the coordinate. A good CV: metadynamics. A rate constant or a rare event: weighted ensemble. A binding or unbinding pathway: supervised MD. Plain unbiased MD is the right answer only when the motion you care about is fast.", { pitfall: "Reaching for the method you already have a script for, rather than the one that matches the observable.", gate: "State the method and why it fits the observable, before any production run. 'We ran 1 µs of plain MD' is not a sampling strategy for a protein like CYP3A4.", tools: ["GaMD", "gamd-openmm", "PLUMED", "openmmtools", "WESTPA", "SuMD", "OpenPathSampling"] }),
      S("Run production as independent replicates", "Enhanced sampling does not exempt you from replicates, it makes them more important, because boost potentials and CV choices are themselves sources of variance.", { gate: "Multiple independent seeds. Report each replicate; a pooled average hides the one that never left the starting basin.", tools: ["GROMACS", "AMBER / AmberTools", "OpenMM", "NAMD", "gamd-openmm"] }),
      S("Prove it converged", "The single most-skipped step, and the one that decides whether the ensemble means anything. Length is not convergence.", { gate: "Show block-averaged free energies, CV histogram overlap between replicates, and a bootstrapped error on the landscape. An unconverged landscape is an illustration, not a result.", tools: ["PLUMED", "alchemlyb", "MDAnalysis", "deeptime"] }),
      S("Extract the ensemble", "Cluster on what you care about (the pocket, the loop, the CV) rather than global backbone RMSD, which is dominated by motions irrelevant to your question. Markov state models turn the trajectories into populations and timescales rather than a pile of frames.", { gate: "Cluster on binding-site atoms. Keep representatives by population, and record how much of the ensemble each one stands for.", tools: ["deeptime", "MDAnalysis", "MDTraj", "mdpocket"] }),
      S("Use the ensemble", "Now it earns its cost: dock into the representative states rather than one crystal snapshot, and keep the receptors that recover known poses.", { gate: "Cross-dock known ligands across the ensemble; keep the states that redock them within 2 Å.", tools: ["AutoDock Vina", "smina", "gnina", "Uni-Dock", "ODDT"] }),
    ],
  },
  "md-stability": {
    label: "Simulation & dynamics",
    summary: "Build the system carefully, equilibrate honestly, and analyse something you decided on before you looked.",
    decision: "Whether a modelled complex holds together under dynamics.",
    stop: "If replicates disagree qualitatively, the honest answer is that you do not know yet, not the average of the three.",
    steps: [
      S("Pick and repair the structure", "Missing loops near the site of interest will dominate your results. Fix them or acknowledge them.", { live: "structures", tools: ["RCSB PDB", "PDBFixer", "MODELLER", "PROPKA"] }),
      S("Build the system", "Force field, protonation, ions, box and membrane if relevant. This step determines what your simulation is actually about.", { tools: ["CHARMM-GUI", "GROMACS", "AMBER / AmberTools", "OpenFF Toolkit", "ACPYPE", "Martini"] }),
      S("Parameterise the ligand", "Generic small-molecule parameters are the usual weak link in a protein-ligand simulation.", { pitfall: "Accepting default parameters for an unusual moiety (phosphates, boronates, metals) and discovering months later that the geometry was never physical.", gate: "Sanity-check ligand geometry and charges against a QM optimisation before production.", tools: ["OpenFF Toolkit", "ACPYPE", "xtb", "espaloma", "ParmEd"] }),
      S("Equilibrate, then run replicates", "One trajectory is an anecdote. Multiple independent replicates are the minimum for any claim about stability.", { gate: "At least 3 independent replicates; report per-replicate results, not just the pooled average.", tools: ["GROMACS", "OpenMM", "NAMD", "AMBER / AmberTools"] }),
      S("Analyse what you predefined", "RMSD/RMSF, contact occupancy, pocket volume, water networks, decide the observable before you see the trajectory.", { tools: ["MDAnalysis", "MDTraj", "PLIP", "deeptime", "VMD"] }),
      S("Escalate when plain MD cannot reach it", "If the motion you care about never happens in an unbiased trajectory, the answer is a different sampling method, not a longer run. Ask for a conformational sampling plan instead, accelerated MD, metadynamics, replica exchange and weighted ensemble each suit a different observable.", { tools: ["GaMD", "PLUMED", "openmmtools", "WESTPA", "OpenFE", "gmx_MMPBSA", "alchemlyb"] }),
    ],
  },
  retrosynthesis: {
    label: "Synthesis planning",
    summary: "Machine routes are proposals; building-block availability and chemist review decide.",
    decision: "Whether this molecule can be made, by what route, and at what cost in weeks.",
    stop: "If no route survives chemist review, the molecule is a design exercise rather than a synthesis target. Redesign is cheaper than a doomed campaign.",
    steps: [
      S("Clean and canonicalise the target molecule", "Stereochemistry and tautomer choice change the route.", { tools: ["RDKit", "ChEMBL Structure Pipeline", "OPSIN"] }),
      S("Score how hard it will be", "A fast synthesisability score tells you whether to invest in full planning at all. Use two, they disagree, and the disagreement is the interesting part.", { tools: ["SCScore", "RAscore", "SYBA", "RDKit"] }),
      S("Generate routes", "Run more than one planner. Template-based, expert-rules and sequence-to-sequence planners fail in different ways, and a disconnection all three propose is worth more than any single confidence score.", { gate: "Benchmark your planner on known routes before trusting it on a new molecule.", tools: ["AiZynthFinder", "ASKCOS", "Syntheseus", "Retro*", "R-SMILES", "IBM RXN for Chemistry", "PaRoutes", "RetroSim"] }),
      S("Check the precedent", "A predicted step either has literature precedent or it does not. Searching the reaction databases is what separates a plausible route from a citable one.", { tools: ["Reaxys", "Open Reaction Database", "RXNMapper", "Molecular Transformer"] }),
      S("Check building blocks are real and in stock", "A route to unavailable starting materials is not a route. Check price and lead time, not just existence, a six-week block changes the plan.", { pitfall: "Accepting catalogue availability at face value. \u201cIn stock\u201d at milligram scale is not the same as available when you need grams.", gate: "Every terminal node should map to a purchasable catalogue entry with a price and lead time.", tools: ["Enamine REAL Space", "eMolecules", "Mcule", "Chemspace", "PostEra Manifold", "ZINC22"] }),
      S("Have a chemist review it", "Predicted conditions and selectivity are where these models are weakest, they are trained on reactions that worked and rarely see the ones that did not.", { gate: "Chemist sign-off on selectivity, protecting groups and order of steps before anything is ordered.", tools: ["ASKCOS", "IBM RXN for Chemistry", "Synthia", "Spaya"] }),
    ],
  },
  "target-triage": {
    label: "Target identification & triage",
    summary: "Genetic evidence, tractability and competition, before any structure work starts.",
    decision: "Whether to start a programme on this target at all.",
    stop: "Write the kill criteria before you start. If genetics, tractability and competitive position all point the wrong way, the cheapest decision available is the one you make today.",
    steps: [
      S("Assemble the evidence", "Genetics, expression, perturbation and literature, in one view, with the strength of each line visible.", { tools: ["Open Targets Platform", "DisGeNET", "Reactome", "OmniPath", "STRING"] }),
      S("Check dependency and specificity", "Does removing it actually matter in the relevant cells, and only there?", { tools: ["DepMap", "cBioPortal", "GTEx Portal", "Human Protein Atlas"] }),
      S("Assess tractability", "Is there a pocket, a known ligand, a chemical probe, a structure? Small-molecule tractability is a structural question as much as a biological one.", { live: "structures", tools: ["Pharos / TCRD", "RCSB PDB", "ChEMBL", "fpocket", "Chemical Probes Portal"] }),
      S("Check the competitive and clinical landscape", "Someone may have already answered your question in the clinic.", { tools: ["ClinicalTrials.gov", "SureChEMBL", "Drugs@FDA", "Europe PMC"] }),
      S("Check safety signal early", "Expression in the wrong tissue and known consequences of loss-of-function are cheaper to learn now than in tox.", { gate: "Write down the kill criteria before committing, which result would make you stop.", tools: ["Human Protein Atlas", "GTEx Portal", "openFDA", "SIDER"] }),
    ],
  },
  structure: {
    label: "Structure selection & modelling",
    summary: "Take the best experimental structure available; predict only what is genuinely missing.",
    decision: "Which structure everything downstream will be built on.",
    stop: "If nothing experimental exists and the predicted model is low-confidence at the site itself, structure-based design is premature, run the ligand-based route instead.",
    steps: [
      S("Resolve the target to one accession", "Everything else keys off this.", { live: "target", tools: ["UniProt", "Ensembl"] }),
      S("Rank the experimental structures", "Resolution, R-free, ligand state, construct coverage and organism, ranked below.", { live: "structures", tools: ["RCSB PDB", "PDBbind+"] }),
      S("Fall back to prediction where nothing exists", "Predicted models are good, and their confidence metrics are not decoration, a low-pLDDT region is a region you should not dock into.", { gate: "Treat pLDDT < 70 regions as unmodelled; check PAE before trusting a domain arrangement.", tools: ["AlphaFold Protein Structure DB", "AlphaFold 3", "Chai-1", "SWISS-MODEL", "MODELLER"] }),
      S("Find structural relatives", "Homologues and structural neighbours give templates, alternative conformations and sometimes the ligand you needed.", { tools: ["Foldseek", "MMseqs2", "HH-suite3"] }),
      S("Prepare it for whatever comes next", "Protonation, missing atoms, ligand and metal handling.", { tools: ["PDBFixer", "PROPKA", "PDB2PQR / APBS", "Meeko"] }),
    ],
  },
};

export function buildPlan(parsed) {
  const p = PROTOCOLS[parsed.intent] || PROTOCOLS["hit-discovery"];
  return { ...p, id: parsed.intent, parsed };
}

/* ------------------------------------------------------------------ export */
export function planToMarkdown(plan, target, structures) {
  const L = [];
  L.push(`# ${plan.label}`, "");
  L.push(`**Question:** ${plan.parsed.query}`, "");
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
    if (s.gate) L.push(`> **Gate:** ${s.gate}`, "");
    if (s.pitfall) L.push(`> **Common failure:** ${s.pitfall}`, "");
    if (s.tools?.length) L.push(`*Tools:* ${s.tools.join(", ")}`, "");
  });
  L.push("---", "", "_Generated by Assayer. You run the computation; this plans it._");
  return L.join("\n");
}
