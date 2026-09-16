#!/usr/bin/env python3
"""Curated list of standard drug-discovery tools, stage by stage.

The scraped sources (Notion atlas, newsletter, GitHub stars) skew towards new
AI models and miss most of the classical backbone: primary databases, MD and QM
engines, ADMET services, cheminformatics toolkits, benchmarks, infrastructure.
This module holds that backbone as data, checks every URL is live, and writes
it into data/ in the same shape as the scraped sources.

  python3 scripts/curated_standard_tools.py            # verify links, write data
  python3 scripts/curated_standard_tools.py --no-check  # skip the link check

Fields: name, stage, description, url, repo (owner/name on GitHub), access
(open-source | free-web | academic | commercial), tags.
"""

import csv
import json
import os
import sys
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from urllib.error import HTTPError, URLError
from urllib.parse import urlparse

OUT_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data")

STAGES = [
    ("target-id", "Target identification & validation"),
    ("structure", "Protein structure & modelling"),
    ("binding-site", "Binding site detection"),
    ("cheminformatics", "Cheminformatics toolkits"),
    ("libraries", "Compound & bioactivity databases"),
    ("docking", "Docking & virtual screening"),
    ("md", "Molecular dynamics & free energy"),
    ("qm", "Quantum chemistry"),
    ("generative", "Generative design"),
    ("qsar-ml", "QSAR / property-prediction ML"),
    ("admet", "ADMET, PK & toxicity"),
    ("synthesis", "Retrosynthesis & synthetic accessibility"),
    ("biologics", "Antibodies & protein engineering"),
    ("benchmarks", "Benchmarks & reference datasets"),
    ("clinical", "Clinical, regulatory & literature data"),
    ("infra", "Workflow & ML infrastructure"),
    ("viz", "Structure & molecule visualisation"),
]

T = [
    # ---------------- target identification & validation ----------------
    ("Open Targets Platform", "target-id", "Target-disease association evidence aggregated from genetics, omics, literature and known drugs; the standard first stop for target triage.", "https://platform.opentargets.org", None, "free-web", ["target-validation", "genetics"]),
    ("DepMap", "target-id", "Genome-wide CRISPR and RNAi essentiality across ~1,100 cancer cell lines, plus expression, mutation and drug-sensitivity data.", "https://depmap.org/portal/", None, "free-web", ["essentiality", "cancer"]),
    ("Pharos / TCRD", "target-id", "NIH IDG portal ranking the druggable genome by how well each target is studied (Tclin/Tchem/Tbio/Tdark).", "https://pharos.nih.gov", None, "free-web", ["druggability"]),
    ("UniProt", "target-id", "Reference protein sequence and functional annotation; the identifier backbone every other resource maps to.", "https://www.uniprot.org", None, "free-web", ["sequence", "annotation"]),
    ("Ensembl", "target-id", "Genome annotation, variation, comparative genomics and the BioMart/REST query layer over them.", "https://www.ensembl.org", None, "free-web", ["genomics"]),
    ("Human Protein Atlas", "target-id", "Tissue, single-cell, subcellular and pathology protein expression maps; used to check target expression and off-tissue risk.", "https://www.proteinatlas.org", None, "free-web", ["expression", "tissue"]),
    ("GTEx Portal", "target-id", "Bulk and single-nucleus expression and eQTL data across 50+ human tissues.", "https://gtexportal.org", None, "free-web", ["expression", "eqtl"]),
    ("cBioPortal", "target-id", "Interactive exploration of large-scale cancer genomics studies (mutation, CNA, expression, survival).", "https://www.cbioportal.org", "cbioportal/cbioportal", "open-source", ["cancer", "genomics"]),
    ("STRING", "target-id", "Protein-protein association networks combining experiments, co-expression, text mining and orthology transfer.", "https://string-db.org", None, "free-web", ["ppi", "network"]),
    ("BioGRID", "target-id", "Curated protein, genetic and chemical interactions from primary literature.", "https://thebiogrid.org", None, "free-web", ["ppi"]),
    ("OmniPath", "target-id", "Unified signalling network: pathways, enzyme-substrate, complexes and annotations from 100+ resources, with a Python client.", "https://omnipathdb.org", "saezlab/pypath", "open-source", ["network", "signalling"]),
    ("Reactome", "target-id", "Peer-reviewed pathway database with pathway enrichment and network analysis tools.", "https://reactome.org", None, "free-web", ["pathway"]),
    ("KEGG", "target-id", "Pathway, disease and drug maps; free for academic web use, licensed for bulk download.", "https://www.genome.jp/kegg/", None, "academic", ["pathway"]),
    ("GSEA / MSigDB", "target-id", "Gene set enrichment analysis and the curated hallmark/canonical gene set collections behind it.", "https://www.gsea-msigdb.org/gsea/index.jsp", None, "free-web", ["enrichment", "gene-sets"]),
    ("Enrichr", "target-id", "Fast web enrichment against 200+ gene set libraries, with an API.", "https://maayanlab.cloud/Enrichr/", None, "free-web", ["enrichment"]),
    ("g:Profiler", "target-id", "Functional enrichment, ortholog mapping and ID conversion with a stable versioned API.", "https://biit.cs.ut.ee/gprofiler/gost", None, "free-web", ["enrichment"]),
    ("DisGeNET", "target-id", "Gene-disease and variant-disease association collection used for target-indication rationale.", "https://disgenet.com", None, "free-web", ["disease-association"]),
    ("GeneCards", "target-id", "Aggregated gene-centric annotation across ~150 sources; free for academic browsing.", "https://www.genecards.org", None, "academic", ["annotation"]),

    # ---------------- protein structure & modelling ----------------
    ("RCSB PDB", "structure", "The experimental structure archive plus search, validation and ligand chemistry services.", "https://www.rcsb.org", None, "free-web", ["structures", "database"]),
    ("AlphaFold Protein Structure DB", "structure", "Predicted structures for 200M+ proteins with per-residue pLDDT confidence.", "https://alphafold.ebi.ac.uk", None, "free-web", ["structure-prediction", "database"]),
    ("AlphaFold 3", "structure", "Joint structure prediction for proteins, nucleic acids, ligands and ions; weights are available for non-commercial use on request.", "https://github.com/google-deepmind/alphafold3", "google-deepmind/alphafold3", "academic", ["structure-prediction", "complexes"]),
    ("Chai-1", "structure", "Open multimodal biomolecular complex prediction model, free for commercial use.", "https://github.com/chaidiscovery/chai-lab", "chaidiscovery/chai-lab", "open-source", ["structure-prediction", "complexes"]),
    ("MODELLER", "structure", "Comparative/homology modelling by satisfaction of spatial restraints; free academic licence.", "https://salilab.org/modeller/", None, "academic", ["homology-modelling"]),
    ("SWISS-MODEL", "structure", "Automated homology modelling server with quality estimation (QMEANDisCo) and oligomeric state prediction.", "https://swissmodel.expasy.org", None, "free-web", ["homology-modelling"]),
    ("MMseqs2", "structure", "Ultra-fast sequence search and clustering; the MSA engine behind ColabFold.", "https://github.com/soedinglab/MMseqs2", "soedinglab/MMseqs2", "open-source", ["msa", "search"]),
    ("HH-suite3", "structure", "HMM-HMM remote homology detection for hard templates and deep MSAs.", "https://github.com/soedinglab/hh-suite", "soedinglab/hh-suite", "open-source", ["msa", "remote-homology"]),
    ("PDBFixer", "structure", "Repairs PDB files for simulation: missing residues and heavy atoms, non-standard residues, protonation, solvation.", "https://github.com/openmm/pdbfixer", "openmm/pdbfixer", "open-source", ["preparation"]),
    ("PDB2PQR / APBS", "structure", "Assigns titration states and charges/radii, then solves Poisson-Boltzmann electrostatics.", "https://github.com/Electrostatics/apbs", "Electrostatics/apbs", "open-source", ["preparation", "electrostatics"]),
    ("PROPKA", "structure", "Empirical pKa prediction for protein residues and ligands, used to set protonation before docking or MD.", "https://github.com/jensengroup/propka", "jensengroup/propka", "open-source", ["preparation", "pka"]),
    ("Biopython", "structure", "General bioinformatics library: sequence and structure parsing, alignment, PDB handling.", "https://biopython.org", "biopython/biopython", "open-source", ["library"]),
    ("DSSP", "structure", "Reference secondary-structure and solvent-accessibility assignment from 3D coordinates.", "https://github.com/PDB-REDO/dssp", "PDB-REDO/dssp", "open-source", ["secondary-structure"]),

    ("CheckMyMetal", "structure", "Validates metal sites in deposited or refined structures against expected coordination number, geometry and donor distances. Mis-assigned metals are common; check before you build a docking model on one.", "https://cmm.minorlab.org", None, "free-web", ["metals", "validation", "crystallography"]),
    ("AlphaFill", "structure", "Transplants ligands, cofactors and metal ions into AlphaFold models by sequence and structure similarity. AlphaFold predicts the fold, not the metal, so a metalloprotein model without this step has an empty site.", "https://alphafill.eu", None, "free-web", ["metals", "cofactors", "model-repair"]),

    ("ColabFold", "structure", "AlphaFold2 and friends with MMseqs2 doing the MSA, which turns an overnight job into minutes; the usual way people actually run structure prediction.", "https://github.com/sokrypton/ColabFold", "sokrypton/ColabFold", "open-source", ["structure-prediction", "msa"]),

    # ---------------- binding site detection ----------------
    ("fpocket", "binding-site", "Voronoi-based pocket detection and druggability scoring, with mdpocket for pocket dynamics over MD trajectories.", "https://github.com/Discngine/fpocket", "Discngine/fpocket", "open-source", ["pocket-detection", "druggability"]),
    ("P2Rank", "binding-site", "Machine-learning ligand-binding site prediction from structure; fast, template-free, used inside several docking pipelines.", "https://github.com/rdk/p2rank", "rdk/p2rank", "open-source", ["pocket-detection"]),
    ("PrankWeb", "binding-site", "Web front end for P2Rank with conservation scoring and in-browser visualisation.", "https://prankweb.cz", None, "free-web", ["pocket-detection"]),
    ("CASTp", "binding-site", "Computed atlas of surface topography: analytic pocket and cavity measurement.", "http://sts.bioe.uic.edu/castp/", None, "free-web", ["pocket-detection"]),
    ("ProteinsPlus / DoGSiteScorer", "binding-site", "Pocket detection with druggability scores, plus protonation (Protoss) and pose analysis tools.", "https://proteins.plus", None, "free-web", ["pocket-detection", "druggability"]),

    ("MetalPDB", "binding-site", "Every metal site in the PDB, abstracted into minimal functional sites so you can compare coordination geometry and donor sets across unrelated folds.", "https://metalpdb.cerm.unifi.it", None, "free-web", ["metals", "metal-site", "database"]),
    ("MESPEUS", "binding-site", "Metal coordination geometry measured across the PDB: bond lengths, angles and donor-set frequencies per metal. The reference for judging whether a site's geometry is physically reasonable.", "https://mespeus.nchu.edu.tw", None, "free-web", ["metals", "metal-site", "geometry"]),
    ("MIB2", "binding-site", "Predicts metal ion-binding residues and models the ion into the structure, by fragment transfer from known sites; covers a dozen biologically common ions.", "http://bioinfo.cmu.edu.tw/MIB2/", None, "free-web", ["metals", "metal-site", "prediction"]),
    ("Metal3D", "binding-site", "3D CNN predicting zinc site location and probability density directly from protein geometry; useful when the apo structure has no ion modelled.", "https://github.com/lcbc-epfl/metal-site-prediction", "lcbc-epfl/metal-site-prediction", "open-source", ["metals", "zinc", "prediction"]),
    ("BioMetAll", "binding-site", "Geometry-based search for candidate metal-binding sites using only backbone and side-chain positions, so it finds sites in apo and predicted structures. This is the published v1; v2 adds scoring and metal discrimination.", "https://github.com/insilichem/biometall", "insilichem/biometall", "open-source", ["metals", "metal-site", "prediction"]),
    ("BioMetAll v2", "binding-site", "The current BioMetAll: adds a score per candidate site, discriminates between metals rather than reporting any site, and uses side-chain descriptors instead of backbone geometry alone.", "https://github.com/insilichem/biometallv2", "insilichem/biometallv2", "open-source", ["metals", "metal-site", "prediction"]),
    ("BioBrigit", "binding-site", "Predicts how a metal ion travels through a protein to reach its site, not just where the site is. Combines a 3D CNN over the biochemical environment with known bioinorganic coordination preferences.", "https://github.com/insilichem/BioBrigit", "insilichem/BioBrigit", "open-source", ["metals", "metal-site", "diffusion-pathway"]),
    ("LMetalSite", "binding-site", "Alignment-free metal-binding residue prediction from sequence alone, via a protein language model; the fallback when there is no structure at all.", "https://github.com/biomed-AI/LMetalSite", "biomed-AI/LMetalSite", "open-source", ["metals", "metal-site", "sequence"]),
    ("ZincBind", "binding-site", "Curated database of zinc binding sites extracted from the PDB, grouped by coordinating residue family and site type.", "https://zincbind.net", None, "free-web", ["metals", "zinc", "database"]),
    ("InterMetalDB", "binding-site", "Intermolecular metal sites, where the ion bridges two chains or a chain and a ligand; the place to look before assuming a metal-mediated contact is an artefact.", "https://intermetaldb.biotech.uwr.edu.pl", None, "free-web", ["metals", "metal-site", "database"]),

    # ---------------- cheminformatics toolkits ----------------
    ("RDKit", "cheminformatics", "The open cheminformatics toolkit everything else is built on: descriptors, fingerprints, conformers, substructure search, reaction handling.", "https://www.rdkit.org", "rdkit/rdkit", "open-source", ["toolkit", "descriptors", "fingerprints"]),
    ("AutoDock Vina", "docking", "The most widely used open docking engine; fast, well-validated, and the baseline every other method is measured against.", "https://vina.scripps.edu", "ccsb-scripps/AutoDock-Vina", "open-source", ["docking", "baseline"]),
    ("OpenMM", "md", "GPU-accelerated MD as a Python library rather than a monolithic binary — the easiest engine to script custom simulation protocols around.", "https://openmm.org", "openmm/openmm", "open-source", ["md-engine", "python", "gpu"]),
    ("Foldseek", "structure", "Structure search at sequence-search speed; finds structural homologues across the whole PDB and AlphaFold DB in seconds.", "https://github.com/steineggerlab/foldseek", "steineggerlab/foldseek", "open-source", ["structure-search", "homology"]),
    ("ProteinMPNN", "biologics", "Inverse folding: given a backbone, designs sequences that fold to it. The workhorse of modern de novo protein design.", "https://github.com/dauparas/ProteinMPNN", "dauparas/ProteinMPNN", "open-source", ["inverse-folding", "sequence-design"]),
    ("RFdiffusion", "biologics", "Diffusion-based generation of protein backbones, including binders to a specified target site.", "https://github.com/RosettaCommons/RFdiffusion", "RosettaCommons/RFdiffusion", "open-source", ["protein-design", "binder-design"]),
    ("AiZynthFinder", "synthesis", "Monte-Carlo tree search retrosynthesis over learned templates, with building-block availability built into the search.", "https://github.com/MolecularAI/aizynthfinder", "MolecularAI/aizynthfinder", "open-source", ["retrosynthesis", "route-planning"]),
    ("ADMET-AI", "admet", "Fast Chemprop-RDKit ADMET predictions across the TDC endpoint set, with percentile context against approved drugs.", "https://github.com/swansonk14/admet_ai", "swansonk14/admet_ai", "open-source", ["admet", "batch"]),
    ("PoseBusters", "benchmarks", "Checks whether a predicted pose is physically possible at all — geometry, stereochemistry, clashes with the protein. The standard sanity gate for generated poses.", "https://github.com/maabuu/posebusters", "maabuu/posebusters", "open-source", ["pose-validation", "benchmark"]),
    ("ProLIF", "docking", "Protein-ligand interaction fingerprints from structures or trajectories, so poses can be compared on interactions rather than score.", "https://github.com/chemosim-lab/ProLIF", "chemosim-lab/ProLIF", "open-source", ["interactions", "fingerprints"]),
    ("ABodyBuilder3", "biologics", "Fast, accurate antibody Fv structure prediction with per-residue confidence on the CDR loops.", "https://github.com/Exscientia/abodybuilder3", "Exscientia/abodybuilder3", "open-source", ["antibody", "structure-prediction"]),
    ("REINVENT4", "generative", "AstraZeneca's production generative design framework: reinforcement learning over a multi-parameter scoring function, with scaffold and linker modes.", "https://github.com/MolecularAI/REINVENT4", "MolecularAI/REINVENT4", "open-source", ["generative", "reinforcement-learning"]),
    ("DiffSBDD", "generative", "Equivariant diffusion generating ligands directly inside a protein pocket.", "https://github.com/arneschneuing/DiffSBDD", "arneschneuing/DiffSBDD", "open-source", ["sbdd", "diffusion"]),
    ("TargetDiff", "generative", "3D diffusion model for structure-based ligand generation; a common baseline for pocket-conditioned design.", "https://github.com/guanjq/targetdiff", "guanjq/targetdiff", "open-source", ["sbdd", "diffusion", "baseline"]),

    # --- harvested: medicinal / computational chemistry ML -----------------
    # Found by asking where the open registries are structurally thin (recent
    # ML tooling lands on GitHub years before it reaches a curated registry),
    # then verified and written up from each tool's own repository and paper.
    ("NeuralPLexer", "docking", "Predicts protein-ligand complex structures directly, generating the receptor conformation alongside the pose instead of docking into a fixed one.", "https://github.com/zrqiao/NeuralPLexer", "zrqiao/NeuralPLexer", "open-source", ["co-folding", "pose-prediction", "induced-fit"]),
    ("KarmaDock", "docking", "Deep-learning docking that scores and optimises poses in one pass, fast enough to make a neural method viable for library-scale screening.", "https://github.com/schrojunzhang/KarmaDock", "schrojunzhang/KarmaDock", "open-source", ["docking", "deep-learning", "speed"]),
    ("SurfDock", "docking", "Surface-informed diffusion docking: conditions pose generation on the molecular surface of the pocket rather than atoms alone.", "https://github.com/CAODH/SurfDock", "CAODH/SurfDock", "open-source", ["docking", "diffusion", "surface"]),
    ("AIMNet2", "qm", "Neural network potential covering neutral, charged and open-shell organic molecules across most of the periodic table — QM-quality energies at force-field cost.", "https://github.com/isayevlab/AIMNet2", "isayevlab/AIMNet2", "open-source", ["mlip", "semiempirical-replacement"]),
    ("Auto3D", "cheminformatics", "Turns SMILES into low-energy 3D structures with correct stereochemistry and tautomer handling — the unglamorous step that silently ruins docking when skipped.", "https://github.com/isayevlab/Auto3D_pkg", "isayevlab/Auto3D_pkg", "open-source", ["conformers", "3d-generation", "stereochemistry"]),
    ("mmpdb", "cheminformatics", "Matched molecular pair database from RDKit: extracts which single transformations have been made across a dataset and what they did to a property. The most directly medicinal-chemistry tool in the open stack.", "https://github.com/rdkit/mmpdb", "rdkit/mmpdb", "open-source", ["matched-pairs", "sar", "med-chem"]),
    ("Lilly Medchem Rules", "cheminformatics", "Eli Lilly's published rule set for rejecting compounds a medicinal chemist would not take forward — reactive groups, known frequent hitters, unstable motifs. A harder filter than PAINS alone.", "https://github.com/IanAWatson/Lilly-Medchem-Rules", "IanAWatson/Lilly-Medchem-Rules", "open-source", ["filters", "triage", "med-chem"]),
    ("Fragmenstein", "generative", "Merges and places fragment hits into a single compound that respects the crystallographic positions they came from — built for fragment-based campaigns and XChem-style data.", "https://github.com/matteoferla/Fragmenstein", "matteoferla/Fragmenstein", "open-source", ["fragment-merging", "fbdd", "placement"]),
    ("ScaffoldGraph", "cheminformatics", "Builds scaffold trees and networks over a library, so you can see which chemotypes a screening set actually covers and where a series sits.", "https://github.com/UCLCheminformatics/ScaffoldGraph", "UCLCheminformatics/ScaffoldGraph", "open-source", ["scaffolds", "library-analysis"]),
    ("MolFormer", "qsar-ml", "IBM's transformer pretrained on a billion molecules; a strong general-purpose embedding when you have too little labelled data to train from scratch.", "https://github.com/IBM/molformer", "IBM/molformer", "open-source", ["pretrained", "embeddings"]),
    ("ChemBERTa", "qsar-ml", "BERT-style pretraining over SMILES — the accessible baseline for whether a pretrained representation beats fingerprints on your endpoint.", "https://github.com/seyonechithrananda/bert-loves-chemistry", "seyonechithrananda/bert-loves-chemistry", "open-source", ["pretrained", "smiles", "baseline"]),
    ("Chemformer", "synthesis", "Sequence-to-sequence transformer for reaction prediction and retrosynthesis, pretrained on SMILES and fine-tuned per task.", "https://github.com/MolecularAI/Chemformer", "MolecularAI/Chemformer", "open-source", ["retrosynthesis", "reaction-prediction"]),
    ("OpenADMET", "admet", "Open consortium generating new experimental ADMET data on the targets that break programmes, and releasing models trained on it — an answer to ADMET models trained on stale public sets.", "https://openadmet.org", None, "open-source", ["admet", "open-data"]),
    ("PROTAC-DB", "libraries", "Curated database of PROTACs with ternary complex data, linker chemistry and measured degradation — the reference set for degrader design.", "http://cadd.zju.edu.cn/protacdb/", None, "free-web", ["protac", "degrader", "database"]),
    ("SEA", "target-id", "Similarity Ensemble Approach: relates targets by the chemistry of their ligands, so a compound's likely off-targets fall out of its structure. Long-standing polypharmacology check.", "https://sea.bkslab.org", None, "free-web", ["off-target", "polypharmacology"]),
    ("SwissBioisostere", "cheminformatics", "Which substituent replacements have actually been made and what they did to activity, mined from measured data — bioisosteric replacement grounded in evidence rather than intuition.", "http://www.swissbioisostere.ch", None, "free-web", ["bioisostere", "med-chem", "sar"]),
    ("RXNMapper", "synthesis", "Atom-maps reactions from an attention-based model with no templates — the preprocessing step that template extraction and most reaction ML quietly depend on.", "https://github.com/rxn4chemistry/rxnmapper", "rxn4chemistry/rxnmapper", "open-source", ["atom-mapping", "reaction-data"]),
    ("Molecular Transformer", "synthesis", "Sequence-to-sequence forward reaction prediction: given reactants, predict the product. The model most later reaction work is benchmarked against.", "https://github.com/pschwllr/MolecularTransformer", "pschwllr/MolecularTransformer", "open-source", ["forward-prediction", "baseline"]),
    ("Retro*", "synthesis", "Neural A* search over retrosynthesis trees, optimising the whole route rather than greedily picking each disconnection.", "https://github.com/binghong-ml/retro_star", "binghong-ml/retro_star", "open-source", ["retrosynthesis", "search"]),
    ("R-SMILES", "synthesis", "Root-aligned SMILES: a representation change that sharply improves seq2seq retrosynthesis accuracy by minimising the edit distance between product and reactants.", "https://github.com/otori-bird/retrosynthesis", "otori-bird/retrosynthesis", "open-source", ["retrosynthesis", "representation"]),
    ("RetroSim", "synthesis", "Similarity-based retrosynthesis: find precedent reactions for similar molecules and transfer the disconnection. The baseline every neural planner should beat, and often does not.", "https://github.com/connorcoley/retrosim", "connorcoley/retrosim", "open-source", ["retrosynthesis", "baseline", "precedent"]),
    ("PaRoutes", "synthesis", "Benchmark of real multi-step routes with the metrics to score a planner against them — how you tell whether a retrosynthesis model is actually better.", "https://github.com/MolecularAI/PaRoutes", "MolecularAI/PaRoutes", "open-source", ["benchmark", "routes"]),
    ("AiZynthTrain", "synthesis", "Reproducible pipelines for training AiZynthFinder's models on your own reaction data, so in-house chemistry and stock are reflected in the routes.", "https://github.com/MolecularAI/aizynthtrain", "MolecularAI/aizynthtrain", "open-source", ["retrosynthesis", "training", "in-house"]),
    ("Open Reaction Database", "synthesis", "Open, structured reaction data with a defined schema — the public counterweight to proprietary reaction corpora, and the place to put your own.", "https://open-reaction-database.org", "open-reaction-database/ord-schema", "open-source", ["reaction-data", "open-data"]),
    ("DRFP", "synthesis", "Reaction fingerprints without atom mapping or a neural net; a fast, surprisingly strong featuriser for yield and condition models.", "https://github.com/reymond-group/drfp", "reymond-group/drfp", "open-source", ["reaction-fingerprint", "yield-prediction"]),
    ("SYBA", "synthesis", "Bayesian classifier for synthetic accessibility trained on easy vs hard molecules — a different signal from SAscore, useful as a second opinion.", "https://github.com/lich-uct/syba", "lich-uct/syba", "open-source", ["synthetic-accessibility"]),
    ("PostEra Manifold", "synthesis", "Route search over purchasable space with prices and lead times, plus synthesis-aware analogue search. Free tier covers occasional use.", "https://postera.ai", None, "free-web", ["retrosynthesis", "purchasability", "analogues"]),
    ("Spaya", "synthesis", "Iktos' retrosynthesis service scoring routes on feasibility and building-block availability.", "https://spaya.ai", None, "commercial", ["retrosynthesis"]),
    ("Synthia", "synthesis", "Merck's expert-rules retrosynthesis platform (formerly Chematica) — hand-encoded chemistry rather than learned templates, and strong on stereochemistry.", "https://www.synthiaonline.com", None, "commercial", ["retrosynthesis", "expert-rules"]),
    ("Reaxys", "synthesis", "Elsevier's reaction and substance database; the precedent search a chemist checks before trusting any predicted route.", "https://www.reaxys.com", None, "commercial", ["reaction-database", "precedent"]),
    ("eMolecules", "libraries", "Building-block and screening-compound catalogue with supplier stock and pricing, searchable by substructure.", "https://www.emolecules.com", None, "commercial", ["building-blocks", "suppliers"]),
    ("Mcule", "libraries", "Purchasable compound database with per-compound availability and a free web tier for small searches.", "https://mcule.com", None, "commercial", ["building-blocks", "purchasable"]),
    ("Chemspace", "libraries", "Aggregated supplier space — in-stock screening compounds and make-on-demand building blocks in one search.", "https://chem-space.com", None, "commercial", ["building-blocks", "make-on-demand"]),
    ("canSAR", "target-id", "Target assessment built for drug discovery rather than biology: structural druggability, existing chemistry, clinical precedent and safety signals for one protein on one page.", "https://cansar.ai", None, "free-web", ["druggability", "target-assessment"]),
    ("Probe Miner", "target-id", "Scores public chemical probes on potency, selectivity and cell activity, so you can tell whether the compound in a paper actually supports its conclusion.", "https://probeminer.icr.ac.uk", None, "free-web", ["chemical-probes", "tool-compounds"]),
    ("FTMap", "target-id", "Computational solvent mapping: docks small organic probes across the surface to find consensus hot spots — where a ligand could get real binding energy, before any chemistry starts.", "https://ftmap.bu.edu", None, "free-web", ["hotspots", "ligandability", "fragment-mapping"]),
    ("Fragment Hotspot Maps", "binding-site", "CCDC's hotspot maps score a pocket by the interaction patterns seen in crystal structures, showing which subpockets are worth growing into.", "https://github.com/prcurran/hotspots", "prcurran/hotspots", "academic", ["hotspots", "fragment-growing"]),
    ("DrugCentral", "target-id", "Approved drugs with their targets, measured activities, indications and pharmacology — the fastest way to see what already works on a target family.", "https://drugcentral.org", None, "free-web", ["approved-drugs", "precedent"]),
    ("Therapeutic Target Database", "target-id", "Targets classified by clinical stage with the drugs against each, useful for judging how contested a target already is.", "https://db.idrblab.net/ttd/", None, "free-web", ["targets", "competitive"]),
    ("PDBe-KB", "target-id", "Aggregates every structural annotation for a protein — ligand sites, interfaces, conformational states — across all its PDB entries at once.", "https://www.ebi.ac.uk/pdbe/pdbe-kb/", None, "free-web", ["structural-annotation", "ligand-sites"]),
    ("KLIFS", "target-id", "Kinase-ligand structures on a common 85-residue binding-site numbering, so binding modes and DFG/αC states are comparable across the whole kinome.", "https://klifs.net", None, "free-web", ["kinase", "selectivity", "binding-mode"]),
    ("GPCRdb", "target-id", "Structures, mutations, ligands and conformational states across the GPCR superfamily, on a shared residue numbering.", "https://gpcrdb.org", None, "free-web", ["gpcr", "structures", "family"]),
    ("gnomAD", "target-id", "Population variation with loss-of-function constraint: whether humans tolerate losing this gene is the cheapest safety signal you will get on a target.", "https://gnomad.broadinstitute.org", None, "free-web", ["genetic-constraint", "target-safety"]),
    ("GWAS Catalog", "target-id", "Curated genotype-phenotype associations — the genetic evidence line that most strongly predicts clinical success.", "https://www.ebi.ac.uk/gwas/", None, "free-web", ["genetics", "target-validation"]),
    ("STITCH", "target-id", "Known and predicted chemical-protein interactions across species, useful for a first pass at what else a chemotype might touch.", "http://stitch-db.org", None, "free-web", ["off-target", "chemical-protein"]),
    ("Chemprop", "qsar-ml", "Directed message-passing neural networks for molecular property prediction — the open baseline that beats descriptor models on most endpoints with enough data, and the engine under ADMET-AI.", "https://github.com/chemprop/chemprop", "chemprop/chemprop", "open-source", ["gnn", "property-prediction", "baseline"]),
    ("PanDDA", "structure", "Finds fragment binding events that conventional refinement misses, by comparing many datasets to a ground state — the analysis that makes crystallographic fragment screening work at all.", "https://github.com/ConorFWild/pandda", "ConorFWild/pandda", "open-source", ["fragment-screening", "crystallography", "event-maps"]),
    ("Fragalysis", "structure", "Diamond's browser for fragment screening campaigns: every hit, its density and its pose, in one place, with the merged designs that came from them.", "https://fragalysis.diamond.ac.uk", "xchem/fragalysis", "free-web", ["fragment-screening", "xchem", "hit-browser"]),
    ("SeeSAR", "generative", "Interactive structure-based design: grow, replace and link with estimated affinity and torsion strain updating as you edit. The commercial tool medicinal chemists actually enjoy using.", "https://www.biosolveit.de/products/", None, "commercial", ["interactive-design", "fragment-growing", "strain"]),
    ("HADDOCK3", "docking", "Integrative docking driven by experimental restraints, and the practical open route to protein-protein and ternary complexes such as PROTAC-induced interfaces.", "https://github.com/haddocking/haddock3", "haddocking/haddock3", "open-source", ["protein-protein", "ternary-complex", "restraints"]),
    # --- network pharmacology ---------------------------------------------
    ("Cytoscape", "viz", "The platform network pharmacology is done on: build a compound-target-pathway network, lay it out, score the hubs, and see what the topology actually says.", "https://cytoscape.org", "cytoscape/cytoscape", "open-source", ["network", "pharmacology", "visualisation"]),
    ("NetworkAnalyst", "target-id", "Network and enrichment analysis in the browser, from a gene or protein list to a protein-protein interaction subnetwork with statistics attached.", "https://www.networkanalyst.ca", None, "free-web", ["network", "enrichment", "ppi"]),
    ("Metascape", "target-id", "Gene list annotation and enrichment across many ontologies at once, with a protein-protein interaction module. The fastest way from a hit list to a defensible pathway story.", "https://metascape.org", None, "free-web", ["enrichment", "annotation", "network"]),
    ("GeneMANIA", "target-id", "Predicts function by placing a gene in a composite network of co-expression, physical interaction and pathway membership, and names the evidence for each edge.", "https://genemania.org", None, "free-web", ["network", "function-prediction"]),
    ("clusterProfiler", "target-id", "The R package most enrichment figures in the literature come from: over-representation and GSEA across GO, KEGG and custom sets, with the plots built in.", "https://bioconductor.org/packages/clusterProfiler/", "YuLab-SMU/clusterProfiler", "open-source", ["enrichment", "gsea", "r"]),
    ("CTD", "target-id", "Comparative Toxicogenomics Database: curated chemical-gene, chemical-disease and gene-disease relationships from the literature. The evidence layer under most chemical-centric network studies.", "https://ctdbase.org", None, "free-web", ["chemical-gene", "curated", "toxicogenomics"]),
    ("BATMAN-TCM", "target-id", "Predicts targets for the constituents of a herbal formula and runs the enrichment over them, built specifically for the multi-compound multi-target case.", "http://bionet.ncpsb.org.cn/batman-tcm/", None, "free-web", ["network-pharmacology", "tcm", "target-prediction"]),

    # --- natural products and plant chemistry ------------------------------
    ("NPASS", "libraries", "Natural products with measured activities against defined targets, and the species they came from. The quantitative counterpart to structure-only natural product collections.", "https://bidd.group/NPASS/", None, "free-web", ["natural-products", "bioactivity", "species"]),
    ("CMAUP", "libraries", "Collective molecular activities of useful plants: plant species mapped to their constituents, those constituents to targets, and targets to pathways and diseases.", "https://bidd.group/CMAUP/", None, "free-web", ["plants", "network-pharmacology", "targets"]),
    ("IMPPAT", "libraries", "Indian medicinal plants, their phytochemicals and therapeutic uses, with curated structures and drug-likeness already computed.", "https://cb.imsc.res.in/imppat/", None, "free-web", ["plants", "phytochemicals", "ethnopharmacology"]),
    ("FooDB", "libraries", "The chemistry of food: constituents of plant and animal foods with structures, concentrations and provenance. Useful when the starting point is a dietary source rather than a screening deck.", "https://foodb.ca", None, "free-web", ["food-chemistry", "phytochemicals"]),
    ("Phenol-Explorer", "libraries", "Measured polyphenol contents of foods, including what processing and cooking do to them. Specific where general natural product databases are silent.", "http://phenol-explorer.eu", None, "free-web", ["polyphenols", "plants", "measured-content"]),
    ("Open Babel", "cheminformatics", "Chemical file format interconversion, 3D coordinate generation and conformer search across 110+ formats.", "https://openbabel.org", "openbabel/openbabel", "open-source", ["file-formats", "conversion"]),
    ("Datamol", "cheminformatics", "Ergonomic RDKit wrapper for standardisation, featurisation and parallel molecular processing.", "https://datamol.io", "datamol-io/datamol", "open-source", ["rdkit", "preprocessing"]),
    ("ChEMBL Structure Pipeline", "cheminformatics", "The exact standardisation, parent-extraction and salt-stripping rules ChEMBL applies; the reference for reproducible curation.", "https://github.com/chembl/ChEMBL_Structure_Pipeline", "chembl/ChEMBL_Structure_Pipeline", "open-source", ["standardisation", "curation"]),
    ("Mordred", "cheminformatics", "1,800+ 2D/3D molecular descriptors on top of RDKit; the classical descriptor baseline for QSAR.", "https://github.com/JacksonBurns/mordred-community", "JacksonBurns/mordred-community", "open-source", ["descriptors"]),
    ("CDK", "cheminformatics", "Chemistry Development Kit: the mature Java cheminformatics library (descriptors, fingerprints, IO).", "https://cdk.github.io", "cdk/cdk", "open-source", ["java", "library"]),
    ("Indigo", "cheminformatics", "EPAM's cheminformatics toolkit for structure handling, reaction processing and rendering, with bindings for several languages.", "https://github.com/epam/Indigo", "epam/Indigo", "open-source", ["library", "rendering"]),
    ("Ketcher", "cheminformatics", "Web structure editor for sketching molecules and reactions in browser-based apps.", "https://github.com/epam/ketcher", "epam/ketcher", "open-source", ["editor", "web"]),
    ("OPSIN", "cheminformatics", "Converts IUPAC chemical names to structures; the standard name-to-structure parser.", "https://github.com/dan2097/opsin", "dan2097/opsin", "open-source", ["name-to-structure"]),
    ("DataWarrior", "cheminformatics", "Free desktop app for chemical data visualisation, SAR analysis, clustering and property prediction.", "https://openmolecules.org/datawarrior/", None, "free-web", ["visualisation", "sar"]),
    ("CReM", "cheminformatics", "Chemically reasonable mutations: fragment-based structure generation with medicinal-chemistry-valid replacements.", "https://github.com/DrrDom/crem", "DrrDom/crem", "open-source", ["enumeration", "fragments"]),

    ("molSimplify", "cheminformatics", "Builds, optimises and screens transition-metal complexes from a metal, oxidation state and ligand set; generates sane 3D geometries where general-purpose toolkits guess badly.", "https://github.com/hjkgrp/molSimplify", "hjkgrp/molSimplify", "open-source", ["metals", "organometallic", "structure-generation"]),
    ("Architector", "cheminformatics", "Generates 3D conformers for metal complexes across the periodic table, including multiple spin states and coordination geometries, as a Python API.", "https://github.com/lanl/Architector", "lanl/Architector", "open-source", ["metals", "organometallic", "conformers"]),
    ("Cambridge Structural Database (CCDC)", "cheminformatics", "The small-molecule crystal structure archive, over half of it metal-organic. The empirical reference for coordination geometry, bond lengths and ligand conformation.", "https://www.ccdc.cam.ac.uk/solutions/software/csd/", None, "commercial", ["metals", "crystal-structures", "reference"]),

    # ---------------- compound & bioactivity databases ----------------
    ("ChEMBL", "libraries", "Manually curated bioactivity database (~2.4M compounds, 20M+ activities) mapped to targets and assays.", "https://www.ebi.ac.uk/chembl/", None, "free-web", ["bioactivity", "database"]),
    ("PubChem", "libraries", "The largest open chemical database: compounds, substances, bioassays, patents and literature links.", "https://pubchem.ncbi.nlm.nih.gov", None, "free-web", ["database"]),
    ("ZINC22", "libraries", "Purchasable and make-on-demand compounds prepared for docking in 3D, at tens of billions of molecules.", "https://cartblanche22.docking.org", None, "free-web", ["screening-library", "docking"]),
    ("Enamine REAL Space", "libraries", "Make-on-demand combinatorial space of 6B+ synthesisable compounds with ~80% synthesis success.", "https://enamine.net/compound-collections/real-compounds/real-space-navigator", None, "commercial", ["screening-library", "make-on-demand"]),
    ("DrugBank", "libraries", "Approved and investigational drugs with targets, pharmacology, interactions and ADMET; free academic tier.", "https://go.drugbank.com", None, "academic", ["drugs", "database"]),
    ("BindingDB", "libraries", "Measured binding affinities (Kd/Ki/IC50) for protein-small molecule pairs, curated from literature and patents.", "https://www.bindingdb.org/rwd/bind/index.jsp", None, "free-web", ["affinity", "database"]),
    ("PDBbind+", "libraries", "Experimental binding affinities paired with their PDB complex structures; the basis of the CASF scoring benchmarks (the old pdbbind.org.cn is retired).", "https://www.pdbbind-plus.org.cn", None, "academic", ["affinity", "structures"]),
    ("Papyrus", "libraries", "A normalised, standardised bioactivity dataset (60M+ points) assembled for ML-ready QSAR modelling — the cleaned-up ChEMBL you were going to build yourself.", "https://github.com/OlivierBeq/Papyrus-scripts", "OlivierBeq/Papyrus-scripts", "open-source", ["bioactivity", "ml-ready"]),
    ("SureChEMBL", "libraries", "Chemical structures extracted from patents, updated daily; the standard patent-chemistry search.", "https://www.surechembl.org", None, "free-web", ["patents"]),
    ("COCONUT", "libraries", "Aggregated open natural products collection with structures and source organisms.", "https://coconut.naturalproducts.net", None, "free-web", ["natural-products"]),
    ("GtoPdb (Guide to Pharmacology)", "libraries", "Expert-curated ligand-target pharmacology: selectivity, affinities and recommended tool compounds.", "https://www.guidetopharmacology.org", None, "free-web", ["pharmacology", "tool-compounds"]),
    ("Chemical Probes Portal", "libraries", "Expert review of which chemical probes are actually fit for target validation, and at what concentration.", "https://www.chemicalprobes.org", None, "free-web", ["tool-compounds", "target-validation"]),

    # ---------------- docking & virtual screening ----------------
    ("smina", "docking", "Vina fork with flexible scoring-function specification and much easier custom-term development.", "https://github.com/mwojcikowski/smina", "mwojcikowski/smina", "open-source", ["docking"]),
    ("Vina-GPU 2.1", "docking", "GPU-parallel Vina, and the QuickVina2-GPU variant alongside it, giving one to two orders of magnitude speedup on large screens.", "https://github.com/DeltaGroupNJUPT/Vina-GPU-2.1", "DeltaGroupNJUPT/Vina-GPU-2.1", "open-source", ["docking", "gpu"]),
    ("Uni-Dock", "docking", "GPU-accelerated docking engine reaching thousands of molecules per second per GPU.", "https://github.com/dptech-corp/Uni-Dock", "dptech-corp/Uni-Dock", "open-source", ["docking", "gpu"]),
    ("DOCK 6", "docking", "UCSF's long-standing anchor-and-grow docking program with a wide scoring-function suite.", "https://dock.compbio.ucsf.edu", None, "academic", ["docking"]),
    ("rDock", "docking", "Fast open-source docking for proteins and nucleic acids, with pharmacophore and tethered-scaffold restraints.", "https://rdock.github.io", "CBDD/rDock", "open-source", ["docking", "rna"]),
    ("Meeko", "docking", "Prepares ligands and receptors for AutoDock: PDBQT writing, macrocycle handling, covalent setups.", "https://github.com/forlilab/Meeko", "forlilab/Meeko", "open-source", ["preparation", "docking"]),
    ("Ringtail", "docking", "Stores and filters millions of docking results in SQLite so large screens stay queryable.", "https://github.com/forlilab/Ringtail", "forlilab/Ringtail", "open-source", ["virtual-screening", "data-management"]),
    ("VirtualFlow", "docking", "Open workflow for distributing ultra-large virtual screens (billions of ligands) across HPC and cloud.", "https://virtual-flow.org", "VirtualFlow/VFVS", "open-source", ["virtual-screening", "hpc"]),
    ("EasyDock", "docking", "Python wrapper unifying Vina/smina/gnina runs with SQLite bookkeeping and protonation handling.", "https://github.com/ci-lab-cz/easydock", "ci-lab-cz/easydock", "open-source", ["docking", "workflow"]),
    ("DockStream", "docking", "AstraZeneca's docking wrapper exposing several backends to generative loops such as REINVENT.", "https://github.com/MolecularAI/DockStream", "MolecularAI/DockStream", "open-source", ["docking", "generative-loop"]),
    ("ODDT", "docking", "Open Drug Discovery Toolkit: rescoring functions (RFScore, NNScore), interaction fingerprints and VS metrics.", "https://github.com/oddt/oddt", "oddt/oddt", "open-source", ["rescoring", "virtual-screening"]),
    ("PLIP", "docking", "Detects and reports non-covalent protein-ligand interactions from a complex; standard for pose interpretation.", "https://github.com/pharmai/plip", "pharmai/plip", "open-source", ["interactions", "analysis"]),
    ("LigPlot+", "docking", "2D schematic diagrams of protein-ligand interactions for figures and pose triage.", "https://www.ebi.ac.uk/thornton-srv/software/LigPlus/", None, "academic", ["interactions", "visualisation"]),
    ("Glide (Schrödinger)", "docking", "Industry-standard commercial docking (HTVS/SP/XP) with the Maestro preparation stack.", "https://www.schrodinger.com/platform/products/glide/", None, "commercial", ["docking"]),
    ("GOLD (CCDC)", "docking", "Genetic-algorithm docking with CSD-derived knowledge and well-validated scoring functions.", "https://www.ccdc.cam.ac.uk/solutions/software/gold/", None, "commercial", ["docking"]),
    ("MOE (CCG)", "docking", "Integrated commercial modelling environment: docking, pharmacophores, biologics and QSAR in one platform.", "https://www.chemcomp.com/en/Products.htm", None, "commercial", ["platform"]),
    ("SwissDock", "docking", "Free docking web service (AutoDock Vina and Attracting Cavities backends) for occasional runs.", "https://www.swissdock.ch", None, "free-web", ["docking", "web"]),
    ("Pharmit", "docking", "Interactive pharmacophore and shape search over billions of purchasable compounds, with in-browser minimisation.", "https://pharmit.csb.pitt.edu", "dkoes/pharmit", "open-source", ["pharmacophore", "virtual-screening"]),

    ("MetalDock", "docking", "Docks organometallic and metal-complex ligands into proteins, DNA and other biomolecules, optimising the complex with QM and generating the metal parameters the docking needs.", "https://github.com/MatthijsHak/MetalDock", "MatthijsHak/MetalDock", "open-source", ["metals", "docking", "organometallic"]),
    ("AutoDock4Zn", "docking", "Zinc force field for AutoDock4 adding directional pseudo-atoms around the ion, so tetrahedral coordination is rewarded geometrically rather than as undirected electrostatics.", "https://autodock.scripps.edu/resources/autodock-zn/", None, "open-source", ["metals", "zinc", "docking", "scoring"]),

    ("gnina", "docking", "Fork of smina with convolutional neural network scoring and rescoring, run alongside the empirical score rather than instead of it.", "https://github.com/gnina/gnina", "gnina/gnina", "open-source", ["docking", "cnn-scoring"]),
    ("GaudiMM", "docking", "Multi-objective genetic algorithm that optimises binding, geometry and any other objective you define at once, instead of collapsing them into one score. Handles metal coordination and flexible systems that fixed-receptor docking cannot express.", "https://gaudi.readthedocs.io", "insilichem/gaudi", "open-source", ["metals", "optimisation", "molecular-design"]),

    # ---------------- molecular dynamics & free energy ----------------
    ("GROMACS", "md", "The most widely used open MD engine; fast on CPU and GPU, with a complete analysis toolchain.", "https://www.gromacs.org", None, "open-source", ["md-engine"]),
    ("AMBER / AmberTools", "md", "Amber force fields and simulation stack; AmberTools is free, pmemd.CUDA is licensed.", "https://ambermd.org", None, "academic", ["md-engine", "force-field"]),
    ("NAMD", "md", "Scalable MD for very large systems on HPC, paired with VMD for setup and analysis.", "https://www.ks.uiuc.edu/Research/namd/", None, "academic", ["md-engine", "hpc"]),
    ("CHARMM-GUI", "md", "Web system builder that sets up membranes, glycans, ligands and solvated systems for every major MD engine.", "https://www.charmm-gui.org", None, "free-web", ["system-preparation", "membrane"]),
    ("MDAnalysis", "md", "Python library for reading and analysing trajectories from essentially every MD format.", "https://www.mdanalysis.org", "MDAnalysis/mdanalysis", "open-source", ["analysis", "trajectories"]),
    ("MDTraj", "md", "Fast trajectory IO and geometric analysis with a lightweight NumPy-native API.", "https://www.mdtraj.org", "mdtraj/mdtraj", "open-source", ["analysis", "trajectories"]),
    ("PLUMED", "md", "Plugin for enhanced sampling and free-energy methods (metadynamics, umbrella sampling) across MD engines.", "https://www.plumed.org", "plumed/plumed2", "open-source", ["enhanced-sampling", "free-energy"]),
    ("OpenFF Toolkit", "md", "Open Force Field small-molecule parameterisation with direct OpenMM/GROMACS export.", "https://github.com/openforcefield/openff-toolkit", "openforcefield/openff-toolkit", "open-source", ["force-field", "parameterisation"]),
    ("ACPYPE", "md", "Converts Antechamber/GAFF ligand parameters into GROMACS, CHARMM and other topologies.", "https://github.com/alanwilter/acpype", "alanwilter/acpype", "open-source", ["parameterisation"]),
    ("ParmEd", "md", "Reads, edits and converts parameter/topology files between AMBER, CHARMM, GROMACS and OpenMM.", "https://github.com/ParmEd/ParmEd", "ParmEd/ParmEd", "open-source", ["topology", "conversion"]),
    ("gmx_MMPBSA", "md", "MM-PBSA/MM-GBSA end-state binding free energies from GROMACS trajectories, with per-residue decomposition.", "https://github.com/Valdes-Tresanco-MS/gmx_MMPBSA", "Valdes-Tresanco-MS/gmx_MMPBSA", "open-source", ["free-energy", "mmpbsa"]),
    ("OpenFE", "md", "Open Free Energy: production relative and absolute binding free-energy campaigns with reproducible protocols.", "https://github.com/OpenFreeEnergy/openfe", "OpenFreeEnergy/openfe", "open-source", ["free-energy", "fep"]),
    ("BioSimSpace", "md", "Interoperable layer for building and running MD and alchemical free-energy workflows across engines.", "https://github.com/OpenBioSim/biosimspace", "OpenBioSim/biosimspace", "open-source", ["free-energy", "workflow"]),
    ("alchemlyb", "md", "Standard estimators (MBAR, BAR, TI) and convergence diagnostics for alchemical free-energy data.", "https://github.com/alchemistry/alchemlyb", "alchemistry/alchemlyb", "open-source", ["free-energy", "analysis"]),
    ("FEP+ (Schrödinger)", "md", "Commercial relative binding free-energy platform, the industry reference for lead-optimisation potency prediction.", "https://www.schrodinger.com/platform/products/fep/", None, "commercial", ["free-energy", "fep"]),
    ("MACE / MACE-OFF", "md", "Equivariant machine-learned interatomic potentials, including transferable organic force fields for biomolecular systems.", "https://github.com/ACEsuit/mace", "ACEsuit/mace", "open-source", ["mlip", "force-field"]),
    ("TorchANI", "md", "PyTorch implementation of the ANI neural network potentials for organic molecules.", "https://github.com/aiqm/torchani", "aiqm/torchani", "open-source", ["mlip"]),
    ("Espaloma", "md", "Graph-neural-network force-field parameter assignment, replacing atom typing with learned chemistry.", "https://github.com/choderalab/espaloma", "choderalab/espaloma", "open-source", ["force-field", "ml"]),
    ("OpenMM-ML", "md", "Mixed ML/MM simulation in OpenMM: treat the ligand with a neural potential and the rest classically.", "https://github.com/openmm/openmm-ml", "openmm/openmm-ml", "open-source", ["mlip", "qm-mm"]),
    ("Martini", "md", "Coarse-grained force field for large-scale membrane, protein and lipid-nanoparticle simulation.", "https://cgmartini.nl", None, "open-source", ["coarse-grained", "membrane"]),
    ("GaMD", "md", "Gaussian accelerated MD: adds a harmonic boost potential to flatten energy barriers, reaching microsecond-scale conformational transitions without a predefined reaction coordinate. Implemented in AMBER, NAMD and OpenMM.", "http://miaolab.org/GaMD/", None, "academic", ["enhanced-sampling", "accelerated-md", "conformational-sampling"]),
    ("gamd-openmm", "md", "The OpenMM implementation of GaMD — the easiest route to accelerated sampling on a GPU without leaving Python.", "https://github.com/MiaoLab20/gamd-openmm", "MiaoLab20/gamd-openmm", "open-source", ["enhanced-sampling", "accelerated-md", "openmm"]),
    ("WESTPA", "md", "Weighted ensemble sampling: runs many short trajectories with statistical reweighting to reach rare events and extract rate constants, rather than waiting for one long trajectory to cross the barrier.", "https://github.com/westpa/westpa", "westpa/westpa", "open-source", ["enhanced-sampling", "rare-events", "kinetics"]),
    ("SuMD", "md", "Supervised MD: biases nothing but discards trajectories heading the wrong way, so ligand binding and unbinding pathways emerge in accessible wall-clock time.", "https://github.com/molecularmodelingsection/SuMD", "molecularmodelingsection/SuMD", "open-source", ["enhanced-sampling", "binding-pathway"]),
    ("OpenPathSampling", "md", "Transition path sampling and interface sampling for rare events where you care about the mechanism and rate, not just the endpoints.", "https://github.com/openpathsampling/openpathsampling", "openpathsampling/openpathsampling", "open-source", ["enhanced-sampling", "rare-events", "mechanism"]),
    ("openmmtools", "md", "Replica exchange, alchemical factories and well-tested integrators for OpenMM — the standard way to run REST2/parallel tempering in Python.", "https://github.com/choderalab/openmmtools", "choderalab/openmmtools", "open-source", ["enhanced-sampling", "replica-exchange", "openmm"]),
    ("mdpocket", "binding-site", "The fpocket companion that tracks pocket volume and persistence across an MD trajectory — how you find a cryptic pocket that only opens some of the time.", "https://github.com/Discngine/fpocket", "Discngine/fpocket", "open-source", ["cryptic-pocket", "pocket-dynamics", "md-analysis"]),
    ("PocketMiner", "binding-site", "Predicts where cryptic pockets are likely to open from a single structure, so you know whether long sampling is worth running at all.", "https://pocketminer.azurewebsites.net", "Mickdub/gvp", "open-source", ["cryptic-pocket", "machine-learning"]),
    ("deeptime", "md", "Markov state models, TICA/VAMP and kinetic analysis of long or many-replica trajectories.", "https://github.com/deeptime-ml/deeptime", "deeptime-ml/deeptime", "open-source", ["msm", "kinetics"]),

    ("MCPB.py", "md", "AmberTools' metal centre parameter builder: derives bonded-model force field parameters for a metal site from QM, the standard route to simulating a metalloprotein without the ion drifting out.", "https://ambermd.org/tutorials/advanced/tutorial20/", None, "academic", ["metals", "force-field", "parameterisation"]),
    ("easyPARM", "md", "Automates force field parameter derivation for metal complexes and organometallics from a QM optimisation, producing ready-to-run Amber, GROMACS, CHARMM and OpenMM inputs.", "https://github.com/Abdelazim-Abdelgawwad/easyPARM", "Abdelazim-Abdelgawwad/easyPARM", "open-source", ["metals", "force-field", "parameterisation"]),

    ("GPathFinder", "md", "Finds the route a ligand takes in and out of a buried site by multi-objective search over GaudiMM, giving binding pathways and intermediate poses rather than only the bound state.", "https://gpathfinder.readthedocs.io/en/latest/", "insilichem/gpathfinder", "open-source", ["binding-pathway", "optimisation"]),
    ("OMMProtocol", "md", "Runs a complete OpenMM pipeline, from minimisation through equilibration to production, from one YAML file, with checkpointing and standard reporters.", "https://ommprotocol.readthedocs.io", "insilichem/ommprotocol", "open-source", ["md-engine", "workflow"]),

    # ---------------- quantum chemistry ----------------
    ("Psi4", "qm", "Open-source quantum chemistry (DFT, MP2, CC) with a Python API suited to automated workflows.", "https://psicode.org", "psi4/psi4", "open-source", ["dft", "ab-initio"]),
    ("PySCF", "qm", "Python-native electronic structure library, easy to embed in ML and screening pipelines.", "https://pyscf.org", "pyscf/pyscf", "open-source", ["dft", "python"]),
    ("ORCA", "qm", "Broad-capability QM package, free for academic use; common for spectroscopy and mechanism work.", "https://orcaforum.kofo.mpg.de", None, "academic", ["dft", "ab-initio"]),
    ("xtb", "qm", "Semiempirical GFNn-xTB methods: geometry, frequencies and energies fast enough for thousands of molecules.", "https://github.com/grimme-lab/xtb", "grimme-lab/xtb", "open-source", ["semiempirical", "conformers"]),
    ("CREST", "qm", "Conformer-rotamer ensemble sampling on top of xtb; the standard cheap conformational search.", "https://github.com/crest-lab/crest", "crest-lab/crest", "open-source", ["conformers"]),
    ("NWChem", "qm", "Scalable HPC quantum chemistry for large systems and plane-wave/molecular hybrids.", "https://github.com/nwchemgit/nwchem", "nwchemgit/nwchem", "open-source", ["hpc", "ab-initio"]),
    ("autodE", "qm", "Automated reaction-profile generation: conformers, transition states and barriers with minimal manual setup.", "https://github.com/duartegroup/autodE", "duartegroup/autodE", "open-source", ["reaction-mechanism", "transition-state"]),

    ("Garleek", "qm", "Bridges Gaussian's ONIOM to molecular mechanics backends such as Tinker and OpenMM, so a QM/MM job can put a metal centre in the QM layer and the rest of the protein in MM.", "https://garleek.readthedocs.io", "insilichem/garleek", "open-source", ["metals", "qm-mm", "oniom"]),
    ("ESIgen", "qm", "Turns raw quantum chemistry output into a formatted supporting information document: geometries, energies, frequencies and images, from a template.", "https://github.com/insilichem/esigen", "insilichem/esigen", "open-source", ["reporting", "supporting-information"]),

    ("pysisyphus", "qm", "Optimises stationary points on reaction paths: chain-of-states methods, transition state searches and intrinsic reaction coordinates, driving whichever QM engine you have.", "https://github.com/eljost/pysisyphus", "eljost/pysisyphus", "open-source", ["reaction-path", "transition-state"]),
    ("Multiwfn", "qm", "Wavefunction analysis: bond orders, charges, orbital composition, electron density topology and non-covalent interaction plots from the output of most QM programs.", "http://sobereva.com/multiwfn/", None, "academic", ["wavefunction-analysis", "bonding"]),

    # ---------------- generative design ----------------
    ("MOSES", "generative", "Benchmarking platform for molecular generative models with standard splits and distribution metrics.", "https://github.com/molecularsets/moses", "molecularsets/moses", "open-source", ["benchmark", "generative"]),
    ("GuacaMol", "generative", "Goal-directed and distribution-learning benchmarks for de novo design, still the common comparison point.", "https://github.com/BenevolentAI/guacamol", "BenevolentAI/guacamol", "open-source", ["benchmark", "generative"]),
    ("SAFE", "generative", "Sequential attachment-based fragment embedding: a SMILES rewrite that makes scaffold-constrained generation natural.", "https://github.com/datamol-io/safe", "datamol-io/safe", "open-source", ["representation", "generative"]),
    ("Pocket2Mol", "generative", "Equivariant generation of 3D molecules conditioned directly on a binding pocket.", "https://github.com/pengxingang/Pocket2Mol", "pengxingang/Pocket2Mol", "open-source", ["sbdd", "3d-generation"]),
    ("DiffLinker", "generative", "Equivariant diffusion for linker design in fragment linking and PROTAC-style problems.", "https://github.com/igashov/DiffLinker", "igashov/DiffLinker", "open-source", ["linker-design", "fragments"]),
    ("LigandMPNN", "generative", "Sequence design conditioned on ligands, nucleotides and cofactors; the successor to ProteinMPNN for binding sites.", "https://github.com/dauparas/LigandMPNN", "dauparas/LigandMPNN", "open-source", ["protein-design", "sequence-design"]),

    # ---------------- QSAR / property-prediction ML ----------------
    ("scikit-mol", "qsar-ml", "RDKit featurisation wrapped as scikit-learn transformers, so fingerprints and descriptors live inside a Pipeline and cannot leak across a split.", "https://github.com/EBjerrum/scikit-mol", "EBjerrum/scikit-mol", "open-source", ["featurisation", "sklearn"]),
    ("DeepChem", "qsar-ml", "Long-running deep learning library for chemistry and biology: featurisers, splitters, model zoo and the MoleculeNet task collection.", "https://github.com/deepchem/deepchem", "deepchem/deepchem", "open-source", ["deep-learning", "library"]),
    ("QSARtuna", "qsar-ml", "AstraZeneca's automated QSAR model building: preprocessing, algorithm and hyperparameter search, uncertainty.", "https://github.com/MolecularAI/QSARtuna", "MolecularAI/QSARtuna", "open-source", ["qsar", "automl"]),
    ("Uni-Mol", "qsar-ml", "3D-aware molecular representation model used as a pretrained backbone for property and binding tasks.", "https://github.com/deepmodeling/Uni-Mol", "deepmodeling/Uni-Mol", "open-source", ["pretrained", "3d"]),
    ("MolSkill", "qsar-ml", "Learns medicinal chemists' implicit preferences from pairwise choices to score compound attractiveness.", "https://github.com/microsoft/molskill", "microsoft/molskill", "open-source", ["scoring", "med-chem"]),
    ("PyTorch Geometric", "qsar-ml", "The standard GNN library for molecular graphs: message passing, pooling, batching over molecules.", "https://github.com/pyg-team/pytorch_geometric", "pyg-team/pytorch_geometric", "open-source", ["gnn", "library"]),
    ("DGL-LifeSci", "qsar-ml", "Ready-made GNN models and datasets for property prediction, reaction prediction and generation.", "https://github.com/awslabs/dgl-lifesci", "awslabs/dgl-lifesci", "open-source", ["gnn", "models"]),
    ("Optuna", "qsar-ml", "Hyperparameter optimisation with pruning; the usual companion to model selection in QSAR pipelines.", "https://github.com/optuna/optuna", "optuna/optuna", "open-source", ["hpo"]),
    ("scikit-learn", "qsar-ml", "The classical ML baseline stack (RF, SVM, calibration, CV) that every QSAR study is measured against.", "https://scikit-learn.org", "scikit-learn/scikit-learn", "open-source", ["ml", "baseline"]),
    ("XGBoost", "qsar-ml", "Gradient boosting that remains highly competitive on descriptor/fingerprint tabular chemistry data.", "https://github.com/dmlc/xgboost", "dmlc/xgboost", "open-source", ["ml", "boosting"]),
    ("KNIME", "qsar-ml", "Visual workflow platform with mature chemistry nodes (RDKit, Schrödinger, Vernalis) for no-code pipelines.", "https://www.knime.com", None, "open-source", ["workflow", "no-code"]),

    ("CheMeleon", "qsar-ml", "Foundation model pretrained to reproduce Mordred descriptors, then fine-tuned through Chemprop with --from-foundation CheMeleon; beats descriptor and GNN baselines on small property datasets.", "https://github.com/JacksonBurns/chemeleon", "JacksonBurns/chemeleon", "open-source", ["pretrained", "property-prediction", "chemprop"]),
    ("Mol-JEPA", "qsar-ml", "Boehringer Ingelheim's multimodal joint-embedding model, fusing cellular effects, binding affinity, ADMET and quantum chemistry into one molecular representation. Code is unlicensed; the weights are CC BY-NC 4.0.", "https://github.com/Boehringer-Ingelheim/mol-jepa", "Boehringer-Ingelheim/mol-jepa", "academic", ["pretrained", "multimodal", "embeddings"]),

    # ---------------- ADMET, PK & toxicity ----------------
    ("ADMETlab 3.0", "admet", "Web predictor covering 88 ADMET endpoints with uncertainty estimates and batch submission.", "https://admetlab3.scbdd.com", None, "free-web", ["admet", "web"]),
    ("SwissADME", "admet", "Fast physicochemical, pharmacokinetic and drug-likeness profiling including the BOILED-Egg permeability model.", "http://www.swissadme.ch", None, "free-web", ["admet", "drug-likeness"]),
    ("pkCSM", "admet", "Graph-signature-based ADMET prediction across absorption, distribution, metabolism, excretion and toxicity endpoints.", "https://biosig.lab.uq.edu.au/pkcsm/", None, "free-web", ["admet"]),
    ("ProTox 3.0", "admet", "Toxicity endpoint prediction (organ toxicity, endpoints, pathways, LD50) with similarity and fragment evidence.", "https://tox.charite.de/protox3/", None, "free-web", ["toxicity"]),
    ("vNN-ADMET", "admet", "Variable-nearest-neighbour ADMET models with explicit applicability domain, including DILI and CYP endpoints.", "https://vnnadmet.bhsai.org", None, "free-web", ["admet", "applicability-domain"]),
    ("OPERA", "admet", "Free, regulatory-grade QSAR models for physchem and ADMET endpoints with applicability domain and AD-based confidence; used by EPA/NIH.", "https://github.com/kmansouri/OPERA", "kmansouri/OPERA", "open-source", ["admet", "regulatory", "qsar"]),
    ("Open Systems Pharmacology (PK-Sim/MoBi)", "admet", "Open-source PBPK and QSP modelling suite; the free alternative to commercial PBPK platforms.", "https://github.com/Open-Systems-Pharmacology/Suite", "Open-Systems-Pharmacology/Suite", "open-source", ["pbpk", "qsp"]),
    ("Simcyp (Certara)", "admet", "Commercial PBPK simulator used in regulatory submissions for DDI and special-population predictions.", "https://www.certara.com/software/simcyp-pbpk/", None, "commercial", ["pbpk", "regulatory"]),
    ("GastroPlus", "admet", "Commercial PBPK/absorption simulation, standard for formulation and oral bioavailability modelling.", "https://www.simulations-plus.com/software/gastroplus/", None, "commercial", ["pbpk", "absorption"]),

    # ---------------- retrosynthesis & synthetic accessibility ----------------
    ("ASKCOS", "synthesis", "MIT's open retrosynthesis, forward prediction and condition recommendation platform.", "https://askcos.mit.edu", "ASKCOS/askcos-core", "open-source", ["retrosynthesis", "planning"]),
    ("Syntheseus", "synthesis", "Benchmarking and inference framework that puts retrosynthesis models on a common, fairly evaluated footing.", "https://github.com/microsoft/syntheseus", "microsoft/syntheseus", "open-source", ["retrosynthesis", "benchmark"]),
    ("IBM RXN for Chemistry", "synthesis", "Transformer-based forward prediction, retrosynthesis and procedure generation as a free web service.", "https://rxn.res.ibm.com", None, "free-web", ["retrosynthesis", "web"]),
    ("rdchiral", "synthesis", "Correct chirality handling when applying retrosynthetic reaction templates in RDKit.", "https://github.com/connorcoley/rdchiral", "connorcoley/rdchiral", "open-source", ["templates", "chirality"]),
    ("SCScore", "synthesis", "Synthetic complexity score learned from reaction corpora, complementing the classic SA score.", "https://github.com/connorcoley/scscore", "connorcoley/scscore", "open-source", ["synthetic-accessibility"]),
    ("RAscore", "synthesis", "Predicts whether a retrosynthesis planner would find a route, as a fast synthesisability filter.", "https://github.com/reymond-group/RAscore", "reymond-group/RAscore", "open-source", ["synthetic-accessibility"]),

    # ---------------- antibodies & protein engineering ----------------
    ("PyRosetta", "biologics", "Python interface to Rosetta for design, docking, loop modelling and energy calculations; free academic licence.", "https://www.pyrosetta.org", None, "academic", ["protein-design", "rosetta"]),
    ("RosettaCommons", "biologics", "The Rosetta software suite for macromolecular modelling and design, and its licensing/community hub.", "https://rosettacommons.org", None, "academic", ["protein-design"]),
    ("ANARCI", "biologics", "Antibody numbering and germline assignment (IMGT, Kabat, Chothia); the preprocessing step for antibody ML.", "https://github.com/oxpig/ANARCI", "oxpig/ANARCI", "open-source", ["antibody", "numbering"]),
    ("ImmuneBuilder", "biologics", "Fast antibody, nanobody and TCR structure prediction with accuracy competitive on CDR loops.", "https://github.com/oxpig/ImmuneBuilder", "oxpig/ImmuneBuilder", "open-source", ["antibody", "structure-prediction"]),
    ("AbLang2", "biologics", "Antibody language model for restoring missing residues and generating germline-plausible sequences.", "https://github.com/oxpig/AbLang2", "oxpig/AbLang2", "open-source", ["antibody", "language-model"]),
    ("SAbDab / SAbPred", "biologics", "Curated structural antibody database plus the OPIG prediction suite (paratope, epitope, developability, TAP).", "https://opig.stats.ox.ac.uk/webapps/sabdab-sabpred/sabdab/", None, "free-web", ["antibody", "database"]),
    ("Observed Antibody Space (OAS)", "biologics", "Billions of cleaned, numbered antibody repertoire sequences; the pretraining corpus for antibody models.", "https://opig.stats.ox.ac.uk/webapps/oas/", None, "free-web", ["antibody", "repertoire"]),
    ("IgBLAST", "biologics", "NCBI's immunoglobulin/TCR V(D)J assignment tool for repertoire sequencing.", "https://ncbi.github.io/igblast/", None, "open-source", ["antibody", "repertoire"]),
    ("FoldX", "biologics", "Empirical force field for fast stability and binding ddG on point mutations; free academic licence.", "https://foldxsuite.crg.eu", None, "academic", ["stability", "mutation"]),

    ("ESM", "biologics", "Evolutionary-scale protein language models, used for embeddings, variant effect scores and as the front end of structure prediction without an MSA.", "https://github.com/facebookresearch/esm", "facebookresearch/esm", "open-source", ["protein-language-model", "variant-effect"]),
    ("ThermoMPNN", "biologics", "Graph network predicting the change in folding stability for every point mutation in a structure, fast enough to scan a whole protein.", "https://github.com/Kuhlman-Lab/ThermoMPNN", "Kuhlman-Lab/ThermoMPNN", "open-source", ["stability", "ddg", "protein-engineering"]),

    # ---------------- benchmarks & reference datasets ----------------
    ("Therapeutics Data Commons", "benchmarks", "66+ AI-ready therapeutic datasets with fixed splits and leaderboards, spanning ADMET to biologics.", "https://tdcommons.ai", "mims-harvard/TDC", "open-source", ["benchmark", "datasets"]),
    ("MoleculeNet", "benchmarks", "The original standard property-prediction benchmark suite (ESOL, FreeSolv, BACE, Tox21, …).", "https://moleculenet.org", None, "open-source", ["benchmark"]),
    ("DUD-E", "benchmarks", "Directory of useful decoys, enhanced: actives with property-matched decoys for virtual-screening evaluation.", "https://dude.docking.org", None, "free-web", ["benchmark", "virtual-screening"]),
    ("LIT-PCBA", "benchmarks", "Unbiased virtual screening benchmark built from dose-response PubChem assays, designed to avoid DUD-E's biases.", "https://drugdesign.unistra.fr/LIT-PCBA/", None, "free-web", ["benchmark", "virtual-screening"]),
    ("PoseCheck", "benchmarks", "Physical-plausibility checks (strain energy, steric clashes, interactions) for structure-based generative models.", "https://github.com/cch1999/posecheck", "cch1999/posecheck", "open-source", ["benchmark", "sbdd"]),
    ("Polaris", "benchmarks", "Community platform for rigorous, versioned benchmarks in drug-discovery ML with leak-resistant splits.", "https://polarishub.io", "polaris-hub/polaris", "open-source", ["benchmark", "evaluation"]),

    # ---------------- clinical, regulatory & literature ----------------
    ("ClinicalTrials.gov", "clinical", "Registry of 500k+ trials with a modern API; the source for competitive and trial-design landscaping.", "https://clinicaltrials.gov", None, "free-web", ["trials", "api"]),
    ("openFDA", "clinical", "APIs over FDA drug labels, adverse events (FAERS), recalls and device data.", "https://open.fda.gov", None, "free-web", ["regulatory", "api"]),
    ("Drugs@FDA", "clinical", "Approval history, review documents and labels for FDA-approved drugs.", "https://www.accessdata.fda.gov/scripts/cder/daf/", None, "free-web", ["regulatory", "approvals"]),
    ("EMA Medicines", "clinical", "European public assessment reports and product information for centrally authorised medicines.", "https://www.ema.europa.eu/en/medicines", None, "free-web", ["regulatory", "europe"]),
    ("DailyMed", "clinical", "Current FDA structured product labels (SPL), machine-readable and updated daily.", "https://dailymed.nlm.nih.gov/dailymed/", None, "free-web", ["labels"]),
    ("SIDER", "clinical", "Side-effect resource linking marketed drugs to label-extracted adverse reactions and frequencies.", "http://sideeffects.embl.de", None, "free-web", ["adverse-events"]),
    ("Europe PMC", "clinical", "Full-text life-science literature with annotations and a solid API for text mining.", "https://europepmc.org", None, "free-web", ["literature", "api"]),
    ("PubMed / NCBI E-utilities", "clinical", "Biomedical citation index and the E-utilities API behind most literature pipelines.", "https://pubmed.ncbi.nlm.nih.gov", None, "free-web", ["literature", "api"]),

    ("Google Patents", "clinical", "Full-text patent search across the major offices with chemical structure indexing; the practical first look at whether a scaffold is already claimed.", "https://patents.google.com", None, "free-web", ["patents", "freedom-to-operate"]),
    ("Espacenet", "clinical", "The European Patent Office's search over 140 million patent documents, with family and legal-status data that the free aggregators do not carry.", "https://worldwide.espacenet.com", None, "free-web", ["patents", "freedom-to-operate"]),

    # ---------------- workflow & ML infrastructure ----------------
    ("Nextflow", "infra", "Dataflow workflow engine with containerised, resumable execution across HPC and cloud; nf-core supplies vetted pipelines.", "https://www.nextflow.io", "nextflow-io/nextflow", "open-source", ["workflow", "reproducibility"]),
    ("Snakemake", "infra", "Python-based workflow manager with conda/container integration, common for bioinformatics pipelines.", "https://snakemake.github.io", "snakemake/snakemake", "open-source", ["workflow"]),
    ("MLflow", "infra", "Experiment tracking, model registry and packaging; the usual answer to 'which model made this prediction'.", "https://mlflow.org", "mlflow/mlflow", "open-source", ["tracking", "mlops"]),
    ("DVC", "infra", "Git-style versioning for datasets and model artefacts, so screening data stays reproducible.", "https://dvc.org", "iterative/dvc", "open-source", ["data-versioning"]),
    ("Ray", "infra", "Distributed execution for parallel docking, simulation sweeps and model training on one API.", "https://www.ray.io", "ray-project/ray", "open-source", ["distributed"]),
    ("Dask", "infra", "Parallel dataframes and task graphs for larger-than-memory chemical datasets.", "https://www.dask.org", "dask/dask", "open-source", ["distributed", "dataframes"]),
    ("PyTorch Lightning", "infra", "Training-loop framework that standardises multi-GPU training and checkpointing for molecular models.", "https://github.com/Lightning-AI/pytorch-lightning", "Lightning-AI/pytorch-lightning", "open-source", ["training"]),
    ("Hugging Face Hub", "infra", "Where most released protein and molecule model weights and datasets now live.", "https://huggingface.co", None, "free-web", ["models", "datasets"]),

    # ---------------- visualisation ----------------
    ("PyChimera", "viz", "Use the UCSF Chimera Python API from an ordinary interpreter, so Chimera's structure handling can be scripted inside a normal pipeline instead of its own shell.", "https://github.com/insilichem/pychimera", "insilichem/pychimera", "open-source", ["chimera", "scripting"]),
    ("Tangram", "viz", "A suite of UCSF Chimera extensions from the same group: QM and QM/MM setup, PLIP interaction depiction, PropKa states, normal modes, and dummy-atom preparation of metal systems for MD. Free for academic use.", "https://github.com/insilichem/tangram", "insilichem/tangram", "academic", ["metals", "chimera", "modelling"]),
    ("PyMOL (open source)", "viz", "The de facto structure viewer for figures and pose inspection; open-source build plus a commercial edition.", "https://github.com/schrodinger/pymol-open-source", "schrodinger/pymol-open-source", "open-source", ["visualisation", "structures"]),
    ("UCSF ChimeraX", "viz", "Modern successor to Chimera: large structures, cryo-EM maps, AlphaFold integration and scripting.", "https://www.cgl.ucsf.edu/chimerax/", None, "academic", ["visualisation", "cryo-em"]),
    ("VMD", "viz", "Trajectory visualisation and analysis for MD, with scripting and rendering for publication figures.", "https://www.ks.uiuc.edu/Research/vmd/", None, "academic", ["visualisation", "md"]),
    ("Mol*", "viz", "The web molecular viewer used by RCSB and PDBe; embeddable in any internal tool.", "https://github.com/molstar/molstar", "molstar/molstar", "open-source", ["visualisation", "web"]),
    ("NGL Viewer", "viz", "Lightweight WebGL structure viewer, and the nglview Jupyter widget built on it.", "https://github.com/nglviewer/ngl", "nglviewer/ngl", "open-source", ["visualisation", "web"]),
    ("3Dmol.js", "viz", "WebGL structure viewer, and through its py3Dmol binding the quickest way to eyeball docking poses inside a notebook.", "https://github.com/3dmol/3Dmol.js", "3dmol/3Dmol.js", "open-source", ["visualisation", "notebook"]),
]

# Sites behind bot protection answer 403 to any automated request, including a
# browser user-agent. That is the WAF talking, not a broken link — these were
# each confirmed live by hand, so the checker reports them separately instead
# of crying wolf on every run.
BOT_PROTECTED = {
    "go.drugbank.com", "www.drugbank.com", "www.genecards.org",
    "mcule.com", "chem-space.com", "www.synthiaonline.com", "probeminer.icr.ac.uk",
    "europepmc.org", "worldwide.espacenet.com",
}

FIELDS = ["name", "stage", "stage_label", "description", "url", "repo", "access", "tags", "url_status"]
STAGE_LABELS = dict(STAGES)


def check(url):
    """HEAD the URL, falling back to GET; returns an HTTP status or an error string."""
    for method in ("HEAD", "GET"):
        req = urllib.request.Request(
            url, method=method,
            headers={"User-Agent": "Mozilla/5.0 (compatible; link-check/1.0)"},
        )
        try:
            with urllib.request.urlopen(req, timeout=25) as r:
                # a redirect is a live site, not a dead link
                return 200 if 200 <= r.status < 400 else r.status
        except HTTPError as e:
            if method == "HEAD":
                continue  # plenty of servers mishandle HEAD; retry with GET
            return 200 if 300 <= e.code < 400 else e.code
        except (URLError, OSError, ValueError) as e:
            if method == "HEAD":
                continue
            return f"error: {type(e).__name__}"
    return "error: unreachable"


def build(do_check=True):
    rows = [
        {
            "name": n, "stage": s, "stage_label": STAGE_LABELS[s], "description": d,
            "url": u, "repo": (r.lower() if r else None), "access": a, "tags": t,
            "url_status": None,
        }
        for (n, s, d, u, r, a, t) in T
    ]
    if do_check:
        with ThreadPoolExecutor(max_workers=8) as ex:
            for row, status in zip(rows, ex.map(lambda x: check(x["url"]), rows)):
                host = urlparse(row["url"]).hostname or ""
                if status == 403 and host in BOT_PROTECTED:
                    status = "403 (bot-protected, live)"
                row["url_status"] = status
    return rows


def write(rows):
    os.makedirs(OUT_DIR, exist_ok=True)
    json.dump(rows, open(os.path.join(OUT_DIR, "curated_standard_tools.json"), "w"),
              indent=2, ensure_ascii=False)
    with open(os.path.join(OUT_DIR, "curated_standard_tools.csv"), "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS)
        w.writeheader()
        for r in rows:
            w.writerow({k: "; ".join(r[k]) if isinstance(r[k], list) else r[k] for k in FIELDS})


if __name__ == "__main__":
    rows = build(do_check="--no-check" not in sys.argv)
    write(rows)
    blocked = [r for r in rows if isinstance(r["url_status"], str) and "bot-protected" in r["url_status"]]
    bad = [r for r in rows if r["url_status"] not in (200, None) and r not in blocked]
    print(f"{len(rows)} curated tools across {len(STAGES)} stages -> {OUT_DIR}/curated_standard_tools.{{json,csv}}")
    if blocked:
        print(f"{len(blocked)} live but behind bot protection (expected): "
              + ", ".join(r["name"] for r in blocked))
    if bad:
        print(f"{len(bad)} URLs did not return 200:")
        for r in bad:
            print(f"  {r['url_status']:<24} {r['name']}  {r['url']}")
