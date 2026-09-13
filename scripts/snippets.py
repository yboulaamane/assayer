#!/usr/bin/env python3
"""Minimal working examples for the tools people open most.

Deliberately hand-written rather than scraped: the first command a chemist
needs is rarely the one in the README's quick-start. Keyed by tool name as it
appears in the catalogue; `lang` only drives syntax highlighting hints.
"""

SNIPPETS = {
    "RDKit": ("python", '''from rdkit import Chem
from rdkit.Chem import Descriptors, Crippen

mol = Chem.MolFromSmiles("CC(=O)Oc1ccccc1C(=O)O")
print(Descriptors.MolWt(mol), Crippen.MolLogP(mol), Descriptors.NumHDonors(mol))'''),

    "AutoDock Vina": ("bash", '''vina --receptor receptor.pdbqt --ligand ligand.pdbqt \\
     --center_x 11.0 --center_y 5.5 --center_z 22.3 \\
     --size_x 20 --size_y 20 --size_z 20 \\
     --exhaustiveness 16 --out poses.pdbqt'''),

    "smina": ("bash", '''# autobox from the crystallographic ligand — no manual grid centre
smina -r receptor.pdb -l ligands.sdf --autobox_ligand native.sdf \\
      --autobox_add 4 --exhaustiveness 16 -o docked.sdf'''),

    "gnina": ("bash", '''# dock, then rescore the poses with the CNN
gnina -r receptor.pdb -l ligands.sdf --autobox_ligand native.sdf \\
      --cnn_scoring rescore -o docked.sdf'''),

    "Meeko": ("bash", '''mk_prepare_ligand.py -i ligand.sdf -o ligand.pdbqt
mk_prepare_receptor.py --read_pdb receptor.pdb -o receptor -p'''),

    "fpocket": ("bash", '''fpocket -f receptor.pdb
# ranked pockets land in receptor_out/pockets/ with druggability scores in receptor_info.txt'''),

    "P2Rank": ("bash", '''prank predict -f receptor.pdb -o out/
# out/receptor.pdb_predictions.csv ranks pockets with residue lists'''),

    "PLIP": ("bash", '''plip -f complex.pdb -t --name interactions
# text report of every H-bond, salt bridge, pi-stack and hydrophobic contact'''),

    "ProLIF": ("python", '''import prolif, MDAnalysis as mda
u = mda.Universe("complex.pdb")
fp = prolif.Fingerprint()
fp.run(u.trajectory, u.select_atoms("resname LIG"), u.select_atoms("protein"))
print(fp.to_dataframe().mean())   # interaction occupancy'''),

    "PoseBusters": ("bash", '''bust docked.sdf -l native.sdf -p receptor.pdb --outfmt long
# fails on clashes, bad geometry, wrong stereochemistry — check before believing a pose'''),

    "Open Babel": ("bash", '''obabel input.smi -O output.sdf --gen3d --best
obabel ligand.sdf -O ligand.pdbqt -p 7.4     # protonate at physiological pH'''),

    "OpenMM": ("python", '''from openmm.app import *
from openmm import *
from openmm.unit import *

pdb = PDBFile("system.pdb")
ff = ForceField("amber14-all.xml", "amber14/tip3pfb.xml")
system = ff.createSystem(pdb.topology, nonbondedMethod=PME, constraints=HBonds)
sim = Simulation(pdb.topology, system, LangevinMiddleIntegrator(300*kelvin, 1/picosecond, 2*femtoseconds))
sim.context.setPositions(pdb.positions); sim.minimizeEnergy(); sim.step(500000)'''),

    "GROMACS": ("bash", '''gmx pdb2gmx -f protein.pdb -o processed.gro -water tip3p
gmx editconf -f processed.gro -o box.gro -c -d 1.0 -bt cubic
gmx solvate -cp box.gro -cs spc216.gro -o solv.gro -p topol.top
gmx grompp -f md.mdp -c solv.gro -p topol.top -o md.tpr
gmx mdrun -deffnm md -nb gpu'''),

    "MDAnalysis": ("python", '''import MDAnalysis as mda
from MDAnalysis.analysis import rms

u = mda.Universe("topol.tpr", "traj.xtc")
R = rms.RMSD(u, select="backbone", groupselections=["resname LIG"]).run()
print(R.results.rmsd[:, 2:])   # backbone and ligand RMSD per frame'''),

    "PLUMED": ("bash", '''# plumed.dat — metadynamics on a distance CV
d: DISTANCE ATOMS=10,250
METAD ARG=d PACE=500 HEIGHT=1.2 SIGMA=0.35 BIASFACTOR=10 FILE=HILLS
PRINT ARG=d,metad.bias STRIDE=100 FILE=COLVAR'''),

    "gmx_MMPBSA": ("bash", '''gmx_MMPBSA -O -i mmpbsa.in -cs complex.tpr -ci index.ndx \\
           -cg 1 13 -ct traj.xtc -cp topol.top -nogui'''),

    "xtb": ("bash", '''xtb molecule.xyz --opt --gfn 2 --alpb water
# optimised geometry in xtbopt.xyz, energies in the log'''),

    "CREST": ("bash", '''crest molecule.xyz --gfn2 --alpb water --T 8
# conformer/rotamer ensemble in crest_conformers.xyz, ranked by energy'''),

    "Foldseek": ("bash", '''foldseek easy-search query.pdb pdb100 results.m8 tmp/ --format-mode 4
# structural homologues across the PDB in seconds'''),

    "mmpdb": ("bash", '''mmpdb fragment compounds.smi -o compounds.fragments
mmpdb index compounds.fragments -o compounds.mmpdb --properties props.csv
mmpdb transform --smiles "c1ccccc1C(=O)N" compounds.mmpdb
# which single changes have been made before, and what they did to the property'''),

    "ADMET-AI": ("bash", '''admet_predict --data_path smiles.csv --smiles_column smiles \\
              --save_path predictions.csv'''),

    "AiZynthFinder": ("bash", '''aizynthcli --config config.yml --smiles targets.txt --output routes.json.gz
# then inspect route trees and their building blocks'''),

    "REINVENT4": ("bash", '''reinvent -l staged_run.log staged_learning.toml
# scoring function, diversity filter and stages all live in the TOML'''),

    "Chemprop": ("bash", '''# chemprop v2 CLI
chemprop train -i data.csv -t regression --smiles-columns smiles --target-columns y -o model/
chemprop predict -i new.csv --model-path model/best.pt -o preds.csv'''),

    "Datamol": ("python", '''import datamol as dm

mols = dm.read_sdf("library.sdf", as_df=False)
mols = [dm.standardize_mol(m, disconnect_metals=True) for m in mols]
df = dm.descriptors.batch_compute_many_descriptors(mols, n_jobs=-1)'''),

    "PDBFixer": ("bash", '''pdbfixer input.pdb --output=fixed.pdb --add-residues \\
          --add-atoms=all --replace-nonstandard --ph=7.4'''),

    "PROPKA": ("bash", '''propka3 protein.pdb
# per-residue pKa — check the site residues before assuming a protonation state'''),

    "OpenFE": ("bash", '''openfe plan-rbfe-network -M ligands.sdf -p protein.pdb -o network/
openfe quickrun network/transformations/easy_rbfe_lig1_lig2.json -o result.json'''),

    "WESTPA": ("bash", '''w_init --bstate "start,1.0,bstate.ncrst" --segs-per-state 5
w_run --work-manager processes
w_ipa      # rate constants and flux, not just trajectories'''),

    "RXNMapper": ("python", '''from rxnmapper import RXNMapper

rxn = ["CC(=O)O.OCC>>CC(=O)OCC.O"]
print(RXNMapper().get_attention_guided_atom_maps(rxn))'''),

    "Auto3D": ("bash", '''# SMILES -> low-energy 3D with stereochemistry and tautomers handled
python -m Auto3D.auto3D smiles.smi --k 1 --optimizing_engine AIMNET --use_gpu True'''),

    "Uni-Dock": ("bash", '''unidock --receptor receptor.pdbqt --ligand_index ligands.txt \\
        --center_x 11.0 --center_y 5.5 --center_z 22.3 \\
        --size_x 20 --size_y 20 --size_z 20 --search_mode balance --dir out/'''),

    "ODDT": ("python", '''import oddt
from oddt.scoring.functions import RFScore

rec = next(oddt.toolkit.readfile("pdb", "receptor.pdb")); rec.protein = True
sf = RFScore.load(version=3); sf.set_protein(rec)
for pose in oddt.toolkit.readfile("sdf", "docked.sdf"):
    print(sf.predict_ligand(pose).data["rfscore_v3"])'''),

    "CReM": ("python", '''from crem.crem import mutate_mol
from rdkit import Chem

mol = Chem.MolFromSmiles("c1ccccc1C(=O)Nc1ccccc1")
for smi in list(mutate_mol(mol, db_name="replacements.db", max_size=8))[:10]:
    print(smi)   # chemically reasonable single-point changes'''),
}
