# MindmapPreziBlock — rendu Prezi pour l'agent mindmap

Troisième mode de rendu pour `synthia.mindmap.agent`, aux côtés de l'arbre React Flow (`synthia-mindmap-flow`) et du force graph (`synthia-mindmap`). Vue d'ensemble avec visuel d'ancrage central, cartes de niveau 1 dispersées organiquement autour, et caméra continue qui vole vers n'importe quelle carte jusqu'à des feuilles de type slide.

## Fichiers

`preziLayout.ts` — moteur de layout pur (sans React ni DOM, testable en Node) : anneau organique relaxé pour le niveau 1, partition binaire pondérée avec jitter pour les niveaux internes, coordonnées monde absolues calculées une seule fois. `preziCamera.ts` — moteur de caméra pur : `{cx, cy, s}` dérivé du rectangle cible, interpolation du scale en espace log, `flyTo` sur requestAnimationFrame. `MindmapPreziBlock.tsx` — composant React autonome (aucune dépendance hors React) consommant directement les props du ComponentPart.

## Contrat de données

Le composant consomme le payload existant produit par `normalize_mindmap_payload` dans `graph_steps.py`, sans aucune modification backend requise : `{version, title, summary, root: {id, name, summary, detail, evidence[], children[]}, presentation}`. Les slugs `id` uniques garantis par `_normalize_node` servent de clés React et de clés de layout. `summary`/`detail`/`evidence` alimentent le contenu des slides feuilles. Le champ optionnel `imageUrl` par nœud est déjà lu par le composant (image d'ancrage au centre) en prévision de l'enrichissement backend décrit plus bas.

Les types `MindmapNodeData`/`MindmapPayloadData`/`MindmapEvidenceData` sont dérivés de `MindMapNode`/`MindMapPayload`/`MindMapEvidence` (`../MindmapForceGraphBlock/graphAdapter.ts`) plutôt que redéfinis — seule différence réelle : `imageUrl?: string`, ajouté récursivement sur chaque nœud. Une source unique pour la forme du payload backend, partagée avec les deux autres variantes de rendu.

## Intégration frontend

Le dossier vit déjà à côté des deux autres blocs mindmap (`apps/frontend/src/rework/components/shared/molecules/MindmapPreziBlock/`). `MindmapPreziBlock` est un **export nommé** (pas `export default`) et reçoit ses props **à plat** — `{title, summary, root, presentation, height?}` — pour matcher exactement la convention des trois autres composants du registre (`PrestonEditorBlock`, `QuizBlock`, `MindmapForceGraphBlock`, `MindmapFlowBlock`), qui reçoivent tous le payload spreadé directement (`<Component {...(part.props ?? {})} />`) plutôt qu'encapsulé dans une prop `payload`. Le composant reconstruit un objet `payload` en interne (mémoïsé) pour son propre usage (`buildLayout`, `AnchorCircle`).

Enregistrement dans `ComponentBlock.tsx` :

```tsx
import { MindmapPreziBlock } from "../MindmapPreziBlock/MindmapPreziBlock";

// dans COMPONENT_REGISTRY :
"synthia-mindmap-prezi": MindmapPreziBlock,
```

Point de vigilance : `MindmapPreziBlock` est un export **nommé** — un import par défaut (`import MindmapPreziBlock from ...`) donnerait un composant `undefined` au rendu, sans erreur claire à la compilation.

## Choix du rendu côté backend (optionnel)

Pour laisser l'opérateur choisir le rendu, ajouter un FieldSpec dans `graph_agent.py` :

```python
FieldSpec(
    key="settings.renderer",
    type="select",
    title="Renderer",
    description="Interactive component used to render the mindmap.",
    default="flow",
    enum=["flow", "prezi"],
    ui=UIHints(group="Mindmap"),
),
```

Puis dans `build_output` (le `component_id` devient conditionnel) :

```python
ComponentPart(
    component_id="synthia-mindmap-prezi" if renderer == "prezi" else "synthia-mindmap-flow",
    props=state.mindmap_payload,
),
```

Note : `build_output` ne reçoit pas le contexte de tuning ; le plus simple est de stocker le choix dans `MindmapState` (champ `renderer: str = "flow"`) rempli par `analyze_request_step` depuis `context.tuning_values`.

## Enrichissement image (étape suivante, non incluse)

Conformément au document d'architecture : ajouter `image_query` (requête de recherche) et `image_prompt` (repli génération IA) par nœud dans les prompts `extract_mindmap.md`/`refine_mindmap.md` et les variantes bornées `_bounded_mindmap_node_type`, puis résoudre ces champs en `imageUrl` avant `build_output`. Le composant affichera automatiquement `root.imageUrl` au centre dès que le champ sera présent.

## Limites connues

Pas encore de culling des frames hors champ (acceptable jusqu'à ~200 nœuds ; l'agent borne à profondeur 4 à 8 enfants). Pas de mode de repli linéaire pour l'accessibilité (prévu au plan d'architecture, étape 7). Le pincer-zoomer tactile n'est pas géré.
