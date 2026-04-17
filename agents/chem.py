# /workers/chem.py
import sys, json
from rdkit import Chem
from rdkit.Chem import Descriptors, Draw, AllChem, rdMolDescriptors
args = json.loads(sys.argv[1])

if 'mol_props' in sys.argv[0]:
    mol = Chem.MolFromSmiles(args['smiles'])
    props = {
      "mw": round(Descriptors.MolWt(mol),2),
      "logp": round(Descriptors.MolLogP(mol),2),
      "tpsa": round(Descriptors.TPSA(mol),2),
      "hbd": Descriptors.NumHDonors(mol),
      "hba": Descriptors.NumHAcceptors(mol),
      "rot_bonds": Descriptors.NumRotatableBonds(mol)
    }
    print(json.dumps(props))

elif 'retrosynthesis' in sys.argv[0]:
    # Simplified: use AiZynthFinder or template
    from aizynthfinder.aizynthfinder import AiZynthFinder
    finder = AiZynthFinder(configfile="/opt/aizynth/config.yml")
    finder.target_smiles = args['target']
    finder.tree_search()
    routes = []
    for route in finder.routes[:3]:
        steps = [{"smiles": s.smiles, "type": "reaction"} for s in route.reactions]
        routes.append({"steps": steps, "score": route.score})
    print(json.dumps({"routes": routes}))

elif 'rxn_predict' in sys.argv[0]:
    # Use Molecular Transformer or template
    from rxnfp.models import SmilesTokenizer, SmilesClassificationModel
    rxn = '.'.join(args['reactants']) + '>>'
    # Mock: return first reactant as product + conditions note
    print(json.dumps({"products":[args['reactants'][0]],"yield":85,"mechanism":"SN2"}))

elif 'smiles_to_iupac' in sys.argv[0]:
    mol = Chem.MolFromSmiles(args['smiles'])
    name = Chem.MolToInchiKey(mol) # RDKit has no IUPAC; use inchi as fallback
    print(json.dumps(name))

elif 'draw_mol' in sys.argv[0]:
    mol = Chem.MolFromSmiles(args['smiles'])
    svg = Draw.MolsToSVG(mol)
    print(json.dumps(svg))
