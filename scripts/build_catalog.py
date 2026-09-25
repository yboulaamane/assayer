#!/usr/bin/env python3
"""Turn data/tools_index.json into the catalogue the web app serves.

Three jobs:
  1. Put every tool into one browsable stage. The scraped sources between them
     use 702 free-text category labels; the curated stack uses 18 pipeline
     stages. This maps everything onto one taxonomy of 23 stages.
  2. Merge duplicates. The same tool appears in several sources (and the atlas
     repeats a few itself), so rows sharing a GitHub repo or a normalised name
     collapse into one entry that remembers every source it came from.
  3. Emit web/catalog.json - flat, small, and the only data file the site loads.
"""

import json
import os
import re
import sys
import unicodedata
from collections import Counter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "data")
WEB = os.path.join(ROOT, "web")

# slug, label, one-line blurb, accent hue (deg on the site's colour wheel)
STAGES = [
    ("target-id", "Target & druggability", "Is the target real, and is there a pocket worth attacking?", 265),
    ("structure", "Protein structures", "Get and prepare the receptor you will design against.", 210),
    ("binding-site", "Binding sites & pockets", "Find, characterise and score the site itself.", 145),
    ("docking", "Docking & virtual screening", "Pose prediction, rescoring, screening at scale.", 25),
    ("md", "Dynamics & free energy", "Simulation, enhanced sampling, binding free energies.", 15),
    ("qm", "Quantum chemistry", "DFT, semiempirical methods, reaction profiles, parameters.", 5),
    ("cheminformatics", "Cheminformatics", "Structures, descriptors, fingerprints, standardisation.", 45),
    ("libraries", "Compounds & bioactivity", "Screening libraries, measured activity, patents.", 60),
    ("generative", "Generative & de novo design", "New molecules, linkers, scaffolds, degraders.", 330),
    ("qsar-ml", "QSAR & property models", "Predicting activity and properties, and the ML under it.", 345),
    ("admet", "ADMET, PK & toxicity", "Absorption, metabolism, exposure, safety, liabilities.", 0),
    ("synthesis", "Synthesis & retrosynthesis", "Can it be made, by what route, from what building blocks.", 35),
    ("protein-design", "Peptides & protein design", "Macrocycles, peptides, biologics and protein engineering.", 175),
    ("clinical", "Clinical & competitive", "Trials, labels, approvals, real-world safety signals.", 250),
    ("benchmarks", "Benchmarks & datasets", "Reference sets that tell you whether a method works.", 120),
    ("viz", "Visualisation", "Looking at poses, structures and molecules.", 100),
    ("infra", "Workflow & infrastructure", "Pipelines, tracking, compute, helper utilities.", 200),
]

# Out of scope for a medicinal/computational chemistry atlas. Tools that land
# here are dropped rather than shown: single-cell, imaging, genomics and
# literature agents are real fields, just not this one.
DROPPED = {"omics", "imaging", "nucleic-acids", "agents"}

STAGE_ORDER = [s[0] for s in STAGES]

# Curated stages that were merged into a broader browsing stage.
CURATED_REMAP = {"biologics": "protein-design", "protein-ml": "structure"}

# Exact category label -> stage. Covers most of the atlas rows on its own.
CATEGORY_MAP = {
    "protein prediction": "structure", "protein folding": "structure",
    "structural bioinformatics": "structure", "protein similarity": "structure",
    "protein structure prediction": "structure", "protein structure": "structure",
    "protein language model": "protein-ml", "protein embeddings": "protein-ml",
    "protein function prediction": "protein-ml",
    "protein design": "protein-design", "enzyme prediction": "protein-design",
    "protein mutation prediction": "protein-design", "protein engineering": "protein-design",
    "directed evolution": "protein-design", "protein solubility prediction": "protein-design",
    "termostability prediction": "protein-design", "thermostability prediction": "protein-design",
    "antibody design": "biologics", "antibody developability": "biologics",
    "hla binding prediction": "biologics", "macrocyclic peptide design": "biologics",
    "peptide design": "biologics", "tcr": "biologics", "vaccine design": "biologics",
    "single cell omics": "omics", "omics": "omics", "transcriptomics": "omics",
    "proteomics": "omics", "genomics": "omics", "perturbation": "omics",
    "perturbation prediction": "omics", "spatial omics foundation model": "omics",
    "single cell foundation model / embeddings": "omics", "variant prediction": "omics",
    "mass spectra": "omics", "molecular quantification": "omics", "epigenomics": "omics",
    "biological imaging": "imaging", "medical imaging": "imaging", "pathology": "imaging",
    "cell profiler": "imaging", "image retrieval": "imaging",
    "gel electrophoresis segmentation": "imaging", "cryo-em": "imaging",
    "genomic language model": "nucleic-acids", "rna language model": "nucleic-acids",
    "rna folding": "nucleic-acids", "rna design": "nucleic-acids",
    "mrna prediction": "nucleic-acids", "codon optimisation": "nucleic-acids",
    "dna language model": "nucleic-acids", "crispr": "nucleic-acids",
    "docking": "docking", "protein-ligand interaction": "docking",
    "binding prediction": "docking", "molecular interaction prediction": "docking",
    "structure-based drug design": "docking", "virtual screening": "docking",
    "protein-protein interaction": "docking", "binding affinity": "docking",
    "molecular dynamics": "md", "molecular simulation": "md", "protein dynamics": "md",
    "free energy": "md",
    "drug design & discovery": "generative", "molecule design": "generative",
    "small molecule design": "generative", "generative chemistry": "generative",
    "protac design": "generative", "antibiotic design": "generative",
    "de novo design": "generative", "fragment based drug design": "generative",
    "chemical prediction": "qsar-ml", "chemistry": "qsar-ml",
    "chemistry foundation model": "qsar-ml", "molecular property prediction": "qsar-ml",
    "qsar": "qsar-ml", "admet": "admet", "drug side effects": "admet",
    "drug-induced liver injury": "admet", "toxicity": "admet",
    "pharmacokinetics": "admet", "antimicrobial resistance": "admet",
    "retrosynthetic planning": "synthesis", "retrosynthesis": "synthesis",
    "synthesis planning": "synthesis", "reaction prediction": "synthesis",
    "clinical trial": "clinical", "clinical prediction": "clinical",
    "drug repurposing": "clinical", "clinical": "clinical",
    "protein degradation prediction": "generative",
    "biological agents": "agents", "agents": "agents", "literature search": "agents",
    "literature mining": "agents", "knowledgegraph": "agents",
    "biomedical knowledge": "agents", "name entity recognition": "agents",
    "sql translator": "agents", "chemistry image extraction": "agents",
    "benchmark": "benchmarks", "synthetic data generation": "benchmarks",
    "dataset": "benchmarks",
    "helper": "infra", "clustering": "infra", "lab automation": "infra",
    "lab support": "infra", "data science/statistics": "infra",
    "bioinformatics analysis": "infra", "design of experiment (doe)": "infra",
    "visualisation": "viz", "visualization": "viz",

    # --- EDAM topics and operations, as used by bio.tools ---------------
    "molecular docking": "docking", "virtual screening": "docking",
    # Added when the topic lists were narrowed to medicinal and computational
    # chemistry. Unmapped topics fall through to keyword matching, the weakest
    # rule the classifier has.
    "pharmacophore": "docking", "adme": "admet",
    "de novo drug design": "generative", "drug design": "generative",
    "drug target interaction": "target-id",
    "molecular representation learning": "qsar-ml",
    "protein-ligand docking": "docking", "docking simulation": "docking",
    "binding sites": "binding-site", "ligand-binding site prediction": "binding-site",
    "binding site prediction": "binding-site", "protein binding site prediction": "binding-site",
    "pocket detection": "binding-site", "active site prediction": "binding-site",
    "molecular dynamics simulation": "md", "trajectory analysis": "md",
    "free energy calculation": "md", "biophysics": "md",
    "protein structure prediction": "structure", "structure prediction": "structure",
    "protein structure analysis": "structure", "structural biology": "structure",
    "homology modelling": "structure", "structure analysis": "structure",
    "protein secondary structure prediction": "structure",
    "protein folding stability and design": "protein-design",
    "protein design": "protein-design", "protein engineering": "protein-design",
    "protein stability prediction": "protein-design",
    "computational chemistry": "qm", "quantum chemistry": "qm",
    "compound libraries and screening": "libraries", "chemical database search": "libraries",
    "toxicology": "admet", "toxicity prediction": "admet", "pharmacology": "admet",
    "admet prediction": "admet", "pharmacokinetics": "admet",
    "immunoproteins and antigens": "biologics", "immunology": "biologics",
    "epitope prediction": "biologics", "antigen": "biologics",
    "medicinal chemistry": "cheminformatics", "chemical structure": "cheminformatics",
    "molecular descriptors": "cheminformatics", "format conversion": "cheminformatics",
    "molecule design": "generative", "drug design": "generative",
    "natural language processing": "agents", "text mining": "agents",
    "gene expression analysis": "omics", "sequence analysis": "omics",
    "imaging": "imaging", "image analysis": "imaging",
    "workflows": "infra", "data management": "infra",
    "molecular visualisation": "viz", "rendering": "viz",
}

# Fallback keyword scoring, checked against name + description + tags.
KEYWORDS = {
    "target-id": ["biomarker", "target prioriti", "genetic evidence", "target identification", "target validation", "druggability", "essentiality",
                  "gene-disease", "disease association", "pathway enrichment", "gene set",
                  "protein-protein association", "target-disease", "gwas", "eqtl"],
    "omics": ["cell embedding", "methylation", "cpg", "epigenetic", "microbiome", "bacterial genome", "metagenom", "spatial", "flow cytometry", "cytometry", "atac", "chromatin", "gene expression", "biosynthetic gene cluster", "secondary metabolite", "single-cell", "single cell", "scrna", "rna-seq", "transcriptom", "proteom",
              "differential expression", "cell type annotation", "sequencing", "genome annotation"],
    "imaging": ["pathology", "biopsy", "radiolog", "tissue image", "cell image", "slide", "microscop", "histopatholog", "image analysis", "high-content", "segmentation",
                "cell painting", "whole slide"],
    "structure": ["conformation", "3d structure", "structural model", "protein complex", "structure prediction", "protein folding", "folding", "homology model",
                  "structure alignment", "structural", "pdb", "cryo-em", "msa ", "complex prediction"],
    "protein-ml": ["protein fitness", "fitness prediction", "sequence model", "esm", "plm ", "protein representation", "zero-shot variant", "language model", "protein embedding", "sequence embedding", "foundation model for protein"],
    "protein-design": ["allergen", "protein optimi", "solubility", "expression optimi", "protein design", "sequence design", "enzyme", "mutation", "stability",
                       "ddg", "inverse folding", "binder design"],
    "biologics": ["antimicrobial peptide", "amp ", "immune", "mhc", "vaccine", "biologic", "antibody", "antibodies", "nanobody", "peptide", "epitope", "paratope",
                  "immunogen", "tcr", "vhh", "developability"],
    "nucleic-acids": ["crispr", "grna", "guide rna", "gene editing", "base editing", "splic", "transcription factor", "untranslated region", "codon", "rna", "dna", "mrna", "genomic language", "nucleotide", "promoter",
                      "aptamer", "oligonucleotide", "guide design"],
    "binding-site": ["binding site", "pocket", "cavity", "allosteric site", "hotspot"],
    "docking": ["screening campaign", "hit identification", "hit finding", "ligand pose", "docking", "dock ", "virtual screen", "pose prediction", "rescoring",
                "scoring function", "protein-ligand", "binding affinity", "interaction fingerprint"],
    "md": ["molecular dynamics", "simulation", "force field", "trajectory", "free energy",
           "enhanced sampling", "metadynamics", "mm-pbsa", "mm-gbsa", "fep", "coarse-grained"],
    "qm": ["quantum", "dft", "ab initio", "semiempirical", "electronic structure",
           "transition state", "conformer search"],
    "cheminformatics": ["featuriz", "molecular feature", "molecular descriptor", "substructure", "chemical structure", "molecular fingerprint", "cheminformatic", "smiles", "fingerprint", "descriptor", "rdkit",
                        "file format", "standardis", "standardiz", "molecular representation"],
    "libraries": ["database of", "compound library", "screening library", "bioactivity",
                  "purchasable", "chemical database", "patent", "natural product", "catalog"],
    "generative": ["generative", "de novo", "molecule generation", "molecular generation",
                   "scaffold hopping", "linker design", "protac", "lead optimi", "molecular design"],
    "qsar-ml": ["deep learning framework", "prediction model", "predictive model", "chemistry model", "molecular machine learning", "activity prediction", "property prediction", "qsar", "admet prediction", "graph neural network",
                "representation learning", "pretrained", "regression", "classifier",
                "hyperparameter", "machine learning model"],
    "admet": ["blood-brain", "bbb", "penetration", "clearance", "bioavailab", "safety", "liability", "off-target", "admet", "adme", "toxicity", "pharmacokinetic", "pbpk", "hepatotox", "cardiotox",
              "side effect", "herg", "solubility prediction", "permeability", "metabolism"],
    "synthesis": ["retrosynthe", "synthesis planning", "synthetic accessibility", "reaction",
                  "route", "forward prediction"],
    "clinical": ["electronic health", "ehr", "clinical event", "diagnosis", "diagnostic", "medical", "patient outcome", "treatment", "disease management", "healthcare", "clinical trial", "regulatory", "real-world", "patient", "electronic health",
                 "drug label", "adverse event", "repurposing", "epidemiolog"],
    "agents": ["curated list", "awesome", "tutorial", "course", "code generation", "reasoning", "benchmark for agents", "research assistant", "search engine", "agent", "llm", "literature", "knowledge graph", "question answering",
               "chatbot", "retrieval-augmented", "text mining", "copilot", "assistant"],
    "benchmarks": ["evaluating", "evaluate", "harness", "task suite", "benchmark", "evaluation", "leaderboard", "test set", "reference dataset"],
    "infra": ["framework", "library", "toolkit", "platform", "package", "automation", "liquid handling", "high-throughput screening platform", "workflow", "pipeline", "experiment tracking", "orchestrat", "distributed",
              "utility", "utilities", "helper", "data management", "versioning",
              "notebook", "api client", "wrapper"],
    "viz": ["viewer", "visualis", "visualiz", "rendering", "3d view", "plotting"],
}

# What a resource *is* beats what it is tagged for. bio.tools labels
# StreptomeDB "Virtual screening" and LOTUS "Toxicology" because that is what
# people do with them, and the category vote then files a compound database
# under docking. These run first.
EARLY_RULES = [
    ("libraries", r"database of (?:natural products?|compounds?|molecules?|chemicals?)|"
                  r"natural products? database|compendium of|collection of documented|"
                  r"structure-organism pairs|integrative database|"
                  r"(?:database|collection|compendium|repository) of [\w\s-]{0,30}"
                  r"(?:products?|compounds?|metabolites?|phytochemicals?)|"
                  # a resource named *DB / *Atlas / *Bank that describes compounds
                  r"^\w*(?:db|atlas|bank|base)\b[\s\S]{0,140}"
                  r"(?:natural products?|phytochemicals?|metabolites?)"),
    ("target-id", r"target prediction of|drug.gene interaction|chemical-gene|"
                  r"gene-disease|network pharmacology|symptom mapping"),
]

# Families that kept landing in "Everything else". Checked before the general
# keyword scoring because they are specific enough to be decisive.
LATE_RULES = [
    ("structure", r"structure refinement|loop modell?ing|homology model|comparative model|"
                  r"crystallograph|x-ray data|cryo-?em|model quality|backbone|side.chain|"
                  r"3d structure compar|structure superpos|structure alignment|"
                  r"protein model|c-?alpha|rotamer"),
    ("docking", r"drug.target interaction|compound.protein interaction|compound.protein affinity|"
                r"protein.ligand interaction|binding affinity predict|interaction predict"),
    ("clinical", r"drug reposition|drug repurpos|drug combination|drug sensitivit|"
                 r"drug resistance|adverse drug|drug.drug interaction|pharmacovigilance"),
    ("cheminformatics", r"tautomer|protonation state|subgraph min|chemical space|"
                        r"molecular representation"),
    ("generative", r"grows? new ligand|ligand growing|peptide design|genetic algorithm.*peptide"),
    ("binding-site", r"molecular surface|interaction fingerprint|surface.based|water molecule"),
    ("libraries", r"\bdatabase of\b|compendium|curated database|data portal|knowledgebase"),

    # A second sweep over what was still unsorted. Each pattern below came from
    # reading the bucket, not from guessing at vocabulary.
    ("structure", r"small angle x-ray|\bsaxs\b|x-ray data collection|connected c-alphas|"
                  r"secondary structure|architectures of all|angles between helices|"
                  r"superimpos\w+|chemical shift perturbation|conserved functional region|"
                  r"protein crystals|structure refinement"),
    ("docking", r"interaction property field|molecular interaction potential|"
                r"ligand/receptor|protein-ligand complex structure|affinity prediction|"
                r"compound affinity|ligand-specific|virtual screening front"),
    ("md", r"markov model|interfacial analysis|lammps|molecular simulations?|"
           r"dynamical architecture|phase separation|kinetics of protein|"
           r"autoregressive equivariant|force-free md"),
    ("qsar-ml", r"in silico prediction of|activity prediction|drug response|"
             r"drug.target interaction prediction|regularized least squares|hypergraph|"
             r"representation for graphs|pre-training deep learning|molecular image|"
             r"multi-modal molecule|graph neural network"),
    ("cheminformatics", r"bemis-?murcko|molecular features|pandas dataframe|"
                        r"decomposition of molecules"),
    ("generative", r"molecular design|programmable protein design|molecule generation"),
    ("target-id", r"synthetic lethal|gene targets of|resistant target|target database|"
                  r"complementary functional|drug treatment based on gene"),
    ("viz", r"\bpymol\b|displays the information"),
    ("infra", r"recipes|implementation of nsga|group factor analysis|"
              r"introduction to|code repository|bayesian optimi[sz]ation|"
              r"algorithms? (?:repository|and)|jupyter environment"),
    ("structure", r"nmr spectra|2d nmr|two-dimensional nmr"),
    ("qm", r"quantum mechanical|qm/mm|qm-mm"),
    ("md", r"molecular dynamics"),
    ("docking", r"quickvina|autodock|\bvina\b"),
    ("cheminformatics", r"fingerprints?\b"),
    ("qsar-ml", r"masked autoencoder|self-supervised|pretrain\w*|representation learning"),
]

# Real tools, real science, different field. They arrive through broad EDAM
# topics like "Molecular modelling" and only surface here because nothing in
# the medicinal-chemistry taxonomy fits them.
OUT_OF_SCOPE = re.compile(
    r"phylogenet|genome assembl|sequence assembl|read align|comparative genomic|"
    r"boolean network|gene regulatory network|metabolic model|systems biolog|"
    r"homologous sequence|distant homolog|\bblast\b|domain architecture|"
    r"polyketide synthase|chromosome|transcription factor binding site|"
    r"phenotype ontolog|causal model|scale-free network|"
    r"boolean (?:molecular )?network|metabolic system|biochemical model|"
    r"copy number|sequencing reads|virulence gene|biosynthetic gene cluster|"
    r"mass screening of contigs|next-gen\w* sequencing|"
    r"coverage track|bam file|single-?cell|circos|antismash|"
    r"variant calling|read simulat", re.I)


def clean(s):
    """Strip replacement characters and control codes from upstream text.

    Some registry records were mis-decoded before we ever saw them (an α that
    arrived as U+FFFD), and those bytes break a strict JSON consumer.
    """
    if not s:
        return s
    s = s.replace("\ufffd", "").replace("\u0000", "")
    s = "".join(c for c in s if c >= " " or c in "\n\t")
    return re.sub(r"\s{2,}", " ", s).strip() or None


def norm(s):
    s = unicodedata.normalize("NFKD", (s or "")).lower()
    return re.sub(r"[^a-z0-9]+", " ", s).strip()


# Categories are looked up as norm(c), which folds hyphens and slashes into
# spaces. Eleven keys here were written with them and so could never match --
# "protein-ligand docking" and "ligand-binding site prediction" among them.
# Normalising the keys once, here, fixes those and stops the next one happening.
CATEGORY_MAP = {norm(k): v for k, v in CATEGORY_MAP.items()}


def is_repo_name(s):
    """True for "owner/repo", false for a display name like "py3Dmol / 3Dmol.js"."""
    return bool(re.match(r"^[\w.-]+/[\w.-]+$", (s or "").strip()))


def slugify(s):
    s = unicodedata.normalize("NFKD", (s or "")).encode("ascii", "ignore").decode()
    s = re.sub(r"[^A-Za-z0-9]+", "-", s).strip("-").lower()
    return s or "tool"


def classify(row):
    if row["source"] == "curated" and row.get("stage"):
        return CURATED_REMAP.get(row["stage"], row["stage"]), "curated"

    # Raw, not normalised: norm() removes the hyphens and slashes these
    # patterns match on, so "x-ray" and "bemis-murcko" would never fire.
    raw = f"{row.get('name') or ''} {row.get('description') or ''} {' '.join(row.get('categories') or [])}".lower()
    hay_early = raw
    for stage, pattern in EARLY_RULES:
        if re.search(pattern, hay_early, re.I):
            return stage, "early-rule"

    cats = [norm(c) for c in (row.get("categories") or [])]
    votes = Counter(CURATED_REMAP.get(CATEGORY_MAP[c], CATEGORY_MAP[c])
                    for c in cats if c in CATEGORY_MAP)
    if votes:
        top = votes.most_common()
        # a clear winner, or a single mapped category, settles it
        if len(top) == 1 or top[0][1] > top[1][1]:
            return top[0][0], "category"
        tied = {s for s, n in top if n == top[0][1]}
        # prefer the more specific stage when two are tied
        for pref in ("binding-site", "docking", "md", "qm", "admet", "biologics",
                     "generative", "protein-design", "cheminformatics", "libraries",
                     "structure", "omics", "imaging", "agents", "viz", "infra"):
            if pref in tied:
                return pref, "category"
        return top[0][0], "category"

    hay_name = norm(row.get("name"))
    hay_desc = norm(row.get("description"))
    hay_cats = " ".join(cats)
    scores = Counter()
    for stage, words in KEYWORDS.items():
        for w in words:
            w = norm(w)
            if not w:
                continue
            if w in hay_cats:
                scores[stage] += 3
            if w in hay_name:
                scores[stage] += 2
            if w in hay_desc:
                scores[stage] += 1
    scores = Counter({CURATED_REMAP.get(k, k): v for k, v in scores.items()})
    if scores:
        ranked = scores.most_common(2)
        best, score = ranked[0]
        # a clear winner, or the only stage that matched at all
        if score >= 2 or len(ranked) == 1:
            return best, "keyword"
        if score > ranked[1][1]:
            return best, "keyword"

    # Nothing else placed it. These families are specific enough to decide on
    # their own, and only run here so they can never override a good match.
    for stage, pattern in LATE_RULES:
        if re.search(pattern, raw, re.I):
            return stage, "late-rule"
    return "other", "unmatched"


# --------------------------------------------------------------- the gate
#
# bio.tools labels a tool by method, and says nothing about purpose. That is
# fine for a registry and wrong for this catalogue: "Molecular dynamics" is a
# structural-biology topic, so scraping it brings in all of structural biology.
# Measured share of scraped rows in each stage whose name, description and tags
# never once mention this field:
#
#   protein structures 86%   docking            3%
#   dynamics           83%   ADMET              0%
#   quantum chemistry  82%   generative         4%
#   binding sites      69%   compounds          5%
#   peptides           63%   target/druggability 8%
#
# Nobody docks for a reason unrelated to drug discovery, so the docking rows
# need no gate. The five on the left do. A curated entry is never gated: it was
# judged by a person, which is the whole point of the curated layer.
PLANNER_TOOLS = set()

METHOD_ONLY = {"md", "structure", "qm", "binding-site", "protein-design", "other"}

IN_FIELD = re.compile(
    r"drug|ligand|compound|pharmacophore|pharmac|admet|adme\b|toxic|"
    r"binding affinit|lead optimi|medicinal|inhibitor|small molecule|"
    r"virtual screen|docking|qsar|chembl|bioactivit|scaffold|\bhit\b", re.I)

# Not tools. A paper's code drop, a course, or a row that never got past
# "owner/repo" cannot be recommended to anyone, whatever stage it landed in.
COURSEWARE = re.compile(r"\b(tutorials?|courses?|workshops?|lectures?|teaching|"
                        r"intro(duction)?\s+to|awesome|cheat\s?sheets?|roadmaps?|"
                        r"syllabus)\b", re.I)
# A list of other people's work is not a tool, however popular it is. Without
# this, the most-starred entry in the whole catalogue was cs-video-courses:
# "List of Computer Science courses with video lectures", 83,480 stars.
# Popularity exempts a row from the relevance gate only if it is at least
# recognisably this kind of science. Without this, NVIDIA's DeepLearningExamples
# ("State-of-the-Art Deep Learning scripts", 14,843 stars) sat at the very top
# of Protein structures.
SCIENTIFIC = re.compile(
    r"protein|molecul|chemi|atom|ligand|drug|biolog|peptide|enzyme|crystal|"
    r"dock|simulat|force.?field|quantum|\bdft\b|trajector|structur|\brna\b|"
    r"\bdna\b|genom|spectro|conformer|solvent|binding", re.I)

COLLECTION = re.compile(
    r"^\s*(a\s+|an\s+|the\s+)?(curated\s+)?(list|collection|catalogue|catalog|"
    r"compilation|index)\s+of\b|\bpapers?[_\s]+(for|about|on)\b|"
    r"\breading[_\s]list\b|\bresources?\s+for\b", re.I)
PAPER_DROP = re.compile(r"\b(code|repository|repo|implementation)\b.{0,24}\b(for|of)\b"
                        r".{0,30}\b(paper|manuscript|publication|preprint)\b|"
                        r"supplementary (code|material)", re.I)


def planner_tools():
    """Every tool name the workflow protocols recommend.

    A tool a protocol names has been judged by a person just as surely as a
    curated row has — the protocol is where that judgement is written down. So
    the gate must never remove one, or a plan ends up pointing at a tool this
    catalogue no longer admits exists. tests/ enforces that this stays true.
    """
    path = os.path.join(ROOT, "web", "assets", "modules.js")
    if not os.path.exists(path):
        return set()
    src = open(path, encoding="utf-8").read()
    names = set()
    for block in re.findall(r"tools:\s*\[(.*?)\]", src, re.S):
        names.update(n for n in re.findall(r'"([^"]+)"', block))
    return {norm(n) for n in names}


def excluded_because(entry):
    """Why this entry should not be shown, or None to keep it.

    Returns a reason rather than a boolean so the build can write down what it
    threw away. A good tool caught by this gate is a tool to curate by hand,
    not a reason to widen it.
    """
    if entry.get("curated"):
        return None
    if norm(entry.get("name")) in PLANNER_TOOLS:
        return None
    # "Unsorted" says the catalogue cannot tell you what this is for. That is
    # not a shelf to put things on; it is a reason not to show them.
    if entry.get("stage") == "other":
        return "nothing here could say what it is for"
    desc = (entry.get("description") or "").strip()
    if not desc:
        return "no description"
    if PAPER_DROP.search(desc):
        return "a paper's code, not a tool"
    haystack = f"{entry.get('name') or ''} {desc} {' '.join(entry.get('tags') or [])}"
    if COURSEWARE.search(haystack):
        return "teaching material"
    if COLLECTION.search(desc) or COLLECTION.search(entry.get("name") or ""):
        return "a list of other people's work"
    # Traction beats keywords. Of the rows this gate would drop, all but 19 have
    # no repository or no stars at all; the ones that do are TorchMD, PyPDB,
    # PENSA, wepy, MD-TASK — tools people in this field plainly use, whose
    # descriptions simply never say the word "drug". The GitHub layer's own
    # floor is 30 stars; 100 is where traction stops being noise. It exempts a
    # row from the relevance gate only — never from the checks above, so no
    # number of stars can turn a reading list into a tool.
    if (entry.get("stars") or 0) >= 100 and SCIENTIFIC.search(haystack):
        return None
    if entry.get("stage") in METHOD_ONLY and not IN_FIELD.search(haystack):
        return f"real science, different field ({entry.get('stage')})"
    return None

def merge_key(row):
    if row.get("repo"):
        # Curated entries are deliberately distinct even when they ship from one
        # repository (fpocket and mdpocket, say), so they key on name as well.
        # The name pass below still folds each with its scraped counterpart.
        if row["source"] == "curated":
            return f"repo:{row['repo']}#{norm(row.get('name'))}"
        return "repo:" + row["repo"]
    name = norm(row.get("name"))
    name = re.sub(r"\b(v?\d+(\.\d+)?)$", "", name).strip()
    return "name:" + name if name else "row:" + (row.get("url") or "")


def pick(*vals):
    for v in vals:
        if v:
            return v
    return None


def load_extras():
    """Install commands, declared Python versions, and usage examples.

    Two kinds of example, kept apart deliberately: `snippet` is hand-written for
    this catalogue, `quickstart` is quoted from the project's own README and
    carries the URL it came from. Neither is generated.
    """
    pkg_path = os.path.join(DATA, "packages.json")
    packages = json.load(open(pkg_path)) if os.path.exists(pkg_path) else {}
    qs_path = os.path.join(DATA, "quickstarts.json")
    quickstarts = json.load(open(qs_path)) if os.path.exists(qs_path) else {}
    try:
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        from snippets import SNIPPETS
    except Exception:
        SNIPPETS = {}
    # match on name, squashed name and repo basename, like the site does
    snips = {}
    for name, (lang, code) in SNIPPETS.items():
        key = norm(name)
        snips[key] = {"lang": lang, "code": code}
        snips[key.replace(" ", "")] = {"lang": lang, "code": code}
    return packages, snips, quickstarts


def main():
    global PLANNER_TOOLS
    PLANNER_TOOLS = planner_tools()
    packages, snips, quickstarts = load_extras()
    rows = json.load(open(os.path.join(DATA, "tools_index.json")))
    groups = {}
    for row in rows:
        stage, how = classify(row)
        row["_stage"], row["_how"] = stage, how
        groups.setdefault(merge_key(row), []).append(row)

    # A curated entry keys on repo+name so two curated tools from one repository
    # stay apart (fpocket/mdpocket). That also keeps it away from the scraped
    # row for the same repo, so rejoin them here when only one curated entry
    # claims that repository.
    by_repo = {}
    for key in list(groups):
        if key.startswith("repo:"):
            by_repo.setdefault(key.split("#")[0], []).append(key)
    for bare, keys in by_repo.items():
        curated_keys = [k for k in keys if "#" in k]
        if bare in groups and len(curated_keys) == 1:
            groups[bare] += groups.pop(curated_keys[0])

    # Second pass: a tool listed with a repo in one source and only a homepage
    # in another lands in two groups. Fold groups that share a canonical name.
    canon = {}
    for key, members in list(groups.items()):
        names = [norm(m.get("name")) for m in members
                 if m.get("name") and not is_repo_name(m["name"])]
        # A group whose only names are "owner/repo" still has an identity: the
        # repo's own name. Without this, openbabel/openbabel never folds into
        # Open Babel.
        if not names and members[0].get("repo"):
            names = [norm(members[0]["repo"].split("/")[1])]
        # Compare with punctuation and spacing removed: "Open Babel" and
        # "openbabel" are one tool, and so are "Uni-Dock" and "unidock".
        name = re.sub(r"\s+v?\d+(\.\d+)*$", "", names[0]).strip() if names else None
        name = name.replace(" ", "") if name else None
        if not name or len(name) < 3:   # "xtb" is a real tool
            continue
        if name in canon and canon[name] != key:
            # The canonical name ignores a trailing version, which is right for
            # one tool listed twice, and wrong for two curated entries that are
            # separate methods (BioMetAll and BioMetAll v2). The curated list is
            # hand-written, so a deliberate second entry outranks the match.
            if (any(m["source"] == "curated" for m in members)
                    and any(m["source"] == "curated" for m in groups[canon[name]])):
                continue
            groups[canon[name]] += members
            del groups[key]
        else:
            canon[name] = key

    # DROPPED stages are legitimate intermediate classifications: a tool is
    # filed as omics and then dropped for being out of scope. Only a stage
    # nothing knows about is a typo.
    known = set(STAGE_ORDER) | DROPPED | {"other"}
    for row in rows:
        if row["_stage"] not in known:
            print(f"  !! rule produced an unknown stage {row['_stage']!r}; filed as other")
            row["_stage"] = "other"

    catalogue, excluded = [], []
    for key, members in groups.items():
        if all(m["_stage"] in DROPPED for m in members):
            continue
        # Unplaceable *and* recognisably another field: drop rather than file
        # under a label that tells the reader nothing.
        if all(m["_stage"] == "other" for m in members) and any(
                OUT_OF_SCOPE.search(f"{m.get('name') or ''} {m.get('description') or ''}")
                for m in members):
            continue
        # curated entries win on description and stage; they were written for this
        members.sort(key=lambda r: (r["source"] != "curated", -(len(r.get("description") or ""))))
        head = members[0]
        # "owner/repo" is a fallback identity, not a name: prefer a real one
        if is_repo_name(head.get("name")):
            nicer = next((m for m in members if not is_repo_name(m.get("name"))), None)
            if nicer:
                head = dict(head, name=nicer["name"])
            else:
                # Nothing gave it a display name, so take the repository's own,
                # in the authors' casing. Dropping these would have cost
                # graphein, htmd, pytraj, openfold and ChemicalX.
                head = dict(head, name=head["name"].split("/")[-1])
        # A merged tool can inherit a dropped stage from whichever record won
        # the head slot. Prefer a stage this catalogue actually shows.
        usable = [m["_stage"] for m in members
                  if m["_stage"] != "other" and m["_stage"] not in DROPPED]
        stage = (head["_stage"] if head["_stage"] in usable
                 else (usable[0] if usable else "other"))
        tags, seen = [], set()
        for m in members:
            for t in (m.get("categories") or []):
                if t.lower() not in seen and len(tags) < 8:
                    seen.add(t.lower())
                    tags.append(t)
        stars = max([m.get("stars") or 0 for m in members] + [0])
        curated = any(m["source"] == "curated" for m in members)
        # Set explicitly rather than read from tags: tags are merged across
        # sources and capped at four, so an "archived" tag can be cut off.
        archived = any(m["source"] == "curated" and "archived" in (m.get("categories") or [])
                       for m in members)
        # Ranks what a person should look at first: our own picks, then the
        # code people actually use, then anything with a paper behind it.
        rank = (1000 if curated else 0) + min(stars, 20000) / 100 \
             + (25 if any(m.get("has_paper") for m in members) else 0) \
             + (10 if len(members) > 1 else 0)
        entry = {
            "id": slugify(head.get("name")) + ("-" + head["repo"].split("/")[0] if head.get("repo") and len(head["name"] or "") < 4 else ""),
            "name": clean(head.get("name")),
            "stage": stage,
            "description": clean(pick(*[m.get("description") for m in members])),
            "url": pick(*[m.get("url") for m in members]),
            "code_url": pick(*[m.get("code_url") for m in members]),
            "paper_url": pick(*[m.get("paper_url") for m in members]),
            "repo": head.get("repo"),
            "license": pick(*[m.get("license") for m in members]),
            "year": pick(*[m.get("year") for m in members]),
            "tags": tags[:4],
            "sources": sorted({m["source"] for m in members}),
            "curated": curated,
            "archived": archived,
            "stars": stars or None,
            "rank": round(rank, 1),
        }
        pkg = packages.get(entry.get("repo") or "")
        if pkg:
            entry["pypi"] = pkg.get("pypi")
            entry["conda"] = pkg.get("conda")
            # The author's own declared floor, straight from the package metadata.
            entry["python"] = pkg.get("python")
        # Name only: two tools can ship from one repository (fpocket/mdpocket),
        # and a repo-name fallback hands the wrong example to the second one.
        for k in (norm(entry["name"]), norm(entry["name"]).replace(" ", "")):
            if k in snips:
                entry["snippet"] = snips[k]
                break
        # Only where no hand-written example exists: ours is the better one when
        # we have it, and showing both would just be noise.
        if "snippet" not in entry:
            qs = quickstarts.get(entry.get("repo") or "")
            if qs:
                entry["quickstart"] = qs
        if entry["description"] and len(entry["description"]) > 300:
            entry["description"] = entry["description"][:297].rstrip() + "…"
        why = excluded_because(entry)
        if why:
            excluded.append({"name": entry["name"], "stage": entry["stage"],
                             "reason": why, "url": entry.get("url"),
                             "description": (entry.get("description") or "")[:120]})
            continue
        entry = {k: v for k, v in entry.items() if v not in (None, [], False) or k == "curated"}
        catalogue.append(entry)

    # unique ids
    seen = Counter()
    for e in catalogue:
        seen[e["id"]] += 1
        if seen[e["id"]] > 1:
            e["id"] = f"{e['id']}-{seen[e['id']]}"

    catalogue.sort(key=lambda e: (STAGE_ORDER.index(e["stage"]) if e["stage"] in STAGE_ORDER else 99,
                                  -e.get("rank", 0), (e["name"] or "").lower()))

    stage_counts = Counter(e["stage"] for e in catalogue)
    # Counted separately so the site can show what it vouches for and what it
    # merely lists, without the two numbers ever drifting apart.
    curated_counts = Counter(e["stage"] for e in catalogue if e.get("curated"))
    payload = {
        "generated_from": "data/tools_index.json",
        "curated": sum(curated_counts.values()),
        "excluded": len(excluded),
        "stages": [
            {"slug": s, "label": l, "blurb": b, "hue": h,
             "count": stage_counts.get(s, 0), "curated": curated_counts.get(s, 0)}
            for (s, l, b, h) in STAGES
        ],
        "tools": catalogue,
    }
    os.makedirs(WEB, exist_ok=True)
    with open(os.path.join(WEB, "catalog.json"), "w") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))

    # keep the static <meta> description honest about the counts
    idx = os.path.join(WEB, "index.html")
    if os.path.exists(idx):
        html = open(idx).read()
        n_stages = sum(1 for s in payload["stages"] if s["count"])
        html = re.sub(r"A browsable atlas of [\d,]+ drug-discovery tools across \d+ pipeline stages",
                      f"A browsable atlas of {len(catalogue)} drug-discovery tools across {n_stages} pipeline stages",
                      html)
        open(idx, "w").write(html)

    # What the gate threw away, written down. A catalogue that silently drops
    # rows is not reviewable, and this file is how a good tool caught by the
    # rule gets noticed and curated by hand instead.
    excluded.sort(key=lambda e: (e["reason"], (e["name"] or "").lower()))
    with open(os.path.join(DATA, "excluded.json"), "w") as f:
        json.dump({"count": len(excluded), "entries": excluded}, f,
                  ensure_ascii=False, indent=1)

    how = Counter(r["_how"] for r in rows)
    print(f"{len(rows)} index rows -> {len(catalogue)} unique tools "
          f"({len(rows) - len(catalogue) - len(excluded)} merged as duplicates)")
    print(f"excluded {len(excluded)} (data/excluded.json):")
    for reason, n in Counter(e["reason"] for e in excluded).most_common():
        print(f"  {n:4d}  {reason}")
    print("classified by:", dict(how))
    for s, l, _b, _h in STAGES:
        print(f"  {stage_counts.get(s, 0):4d}  {l}")
    if stage_counts.get("other"):
        print(f"  {stage_counts['other']:4d}  (unplaced)")
    print(f"wrote {os.path.join(WEB, 'catalog.json')} "
          f"({os.path.getsize(os.path.join(WEB, 'catalog.json'))/1024:.0f} KB)")

    # The README quotes figures from what was just built. Rewriting them here is
    # what stops the monthly refresh leaving "3,973 tools" in its first line.
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import readme_counts  # noqa: E402
    readme_counts.update()


if __name__ == "__main__":
    main()
