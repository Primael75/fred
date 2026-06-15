# RFC-001 — ComponentPart : Composants React interactifs dans le chat Fred

**Status**: Proposed  
**Author**: Primael (Synthia / Thales)  
**Date**: 2026-06-12  
**ID**: RUNTIME-07  
**Area**: `fred-sdk`, `apps/frontend`

---

## 1. Pourquoi ce RFC existe

Fred expose deux types de parts UI qu'un agent peut retourner dans une réponse :

- `LinkPart` (`type: "link"`) — un lien hypertexte typé (téléchargement, citation, dashboard)
- `GeoPart` (`type: "geo"`) — une carte GeoJSON rendue via Leaflet

Ces deux types couvrent des cas simples. Certains agents ont besoin de retourner une
**interface interactive complète** — un éditeur, un visualiseur, un formulaire — directement
dans le chat, sans que l'utilisateur quitte l'interface Fred.

### Cas d'usage déclencheur

Le `PrestonAgent` (Synthia) génère des présentations PPTX depuis un corpus. Après génération,
l'utilisateur doit pouvoir éditer ses slides directement dans Fred. Le contournement actuel
(lien Markdown dans le texte) n'offre pas une expérience native.

---

## 2. Problème actuel

### 2.1 `UiPart` ne supporte pas les interfaces composées

```python
# fred_sdk/contracts/context.py — état actuel
UiPart = Annotated[LinkPart | GeoPart, Field(discriminator="type")]
```

Il n'existe pas de mécanisme pour qu'un agent signale au frontend de monter un
composant React spécifique avec des données structurées.

### 2.2 `toThreadMessages()` filtre toutes les parts non-texte

Dans `useManagedChat.ts`, seules les parts `type === "text"` survivent jusqu'à
`AssistantTurn`. Ce bug silencieux affecte déjà `LinkPart` et `GeoPart` — aucun
des deux n'est rendu dans la rework UI actuelle.

---

## 3. Solution proposée

### 3.1 Nouveau type Python — `ComponentPart`

```python
# fred_sdk/contracts/context.py

class ComponentPart(BaseModel):
    type: Literal["component"] = "component"
    component_id: str        # clé dans COMPONENT_REGISTRY côté frontend
    props: Dict[str, Any] = {}
    title: Optional[str] = None
```

Usage agent :

```python
return ToolOutput(
    text="Présentation générée.",
    ui_parts=(ComponentPart(
        component_id="presenton-editor",
        props={"presentation_id": "abc123"}
    ),)
)
```

### 3.2 Extension de l'union `UiPart`

```python
# Avant
UiPart = Annotated[LinkPart | GeoPart, Field(discriminator="type")]

# Après
UiPart = Annotated[
    LinkPart | GeoPart | ComponentPart,
    Field(discriminator="type")
]
```

Les quatre champs `ui_parts: tuple[UiPart, ...]` dans `ToolInvocationResult`,
`AgentInvocationResult`, `FinalRuntimeEvent`, `ToolResultRuntimeEvent` héritent
automatiquement du nouveau discriminant — aucun autre changement SDK requis.

### 3.3 Régénération des types TypeScript

```bash
cd libs/fred-runtime && make generate-openapi
cd apps/frontend && make update-runtime-api
```

`agenticOpenApi.ts` dépend du repo externe `agentic-backend` — coordination
séparée nécessaire pour mettre à jour `ChatMessage.parts`.

### 3.4 Corrections frontend — six points

**Point 1 — `ThreadMessage`** (`rework/types/thread.ts`)
```typescript
export interface ThreadMessage {
  uiParts?: UiPart[];   // nouveau
}
```

**Point 2 — `toThreadMessages()`** (`useManagedChat.ts`)
```typescript
const uiParts = finalMessages
  .flatMap(m => m.parts ?? [])
  .filter(p => p.type !== "text" && p.type !== "tool_call" && p.type !== "tool_result");
```

**Point 3 — `AssistantTurnProps`** (`AssistantTurn.tsx`)
```typescript
interface AssistantTurnProps {
  uiParts?: UiPart[];   // nouveau
}
```

**Point 4 — Rendu dans `AssistantTurn`**
```tsx
{!isStreaming && uiParts && uiParts.length > 0 && (
  <div className={styles.uiParts}>
    {uiParts.map((part, i) => <UiPartRenderer key={i} part={part} />)}
  </div>
)}
```

**Point 5 — `UiPartRenderer`** (nouveau composant molecules)
```tsx
function UiPartRenderer({ part }: { part: UiPart }) {
  switch (part.type) {
    case "component": return <ComponentBlock part={part} />;
    case "geo":       return <GeoBlock part={part} />;
    case "link":      return <LinkBlock part={part} />;
    default:          return null;
  }
}
```

**Point 6 — `ComponentBlock` + `COMPONENT_REGISTRY`** (nouveau composant molecules)
```tsx
const COMPONENT_REGISTRY: Record<string, React.ComponentType<any>> = {
  "presenton-editor": PrestonEditorBlock,
};

function ComponentBlock({ part }: { part: ComponentPart }) {
  const Component = COMPONENT_REGISTRY[part.component_id];
  if (!Component) return <p>Composant inconnu : {part.component_id}</p>;
  return <Component {...part.props} />;
}
```

---

## 4. Impact sur les contrats gelés

`UiPart` est utilisé dans `FinalRuntimeEvent` et `ToolResultRuntimeEvent` (contrats gelés).

**Justification :**
- L'union discriminée est extensible par design — ajouter un membre ne casse aucun client existant.
- Les clients qui ne connaissent pas `"component"` l'ignorent silencieusement.
- Aucun champ existant n'est modifié ou supprimé.

**Action :** entrée datée dans `RUNTIME-EXECUTION-CONTRACT.md §8`.

---

## 5. Alternatives considérées

**A — Iframe via `LinkPart` enrichi** (`embed: bool`) : rejeté — mélange deux responsabilités.

**B — Markdown workaround** : utilisé en interim dans Synthia ; rejeté comme solution permanente — pas d'interface interactive.

**C — Web Components** : rejeté — dépendance technologique supplémentaire, friction avec le design system React/Tailwind.

---

## 6. Fichiers touchés

| Fichier | Modification |
|---|---|
| `libs/fred-sdk/fred_sdk/contracts/context.py` | Ajouter `ComponentPart`, étendre `UiPart` |
| `apps/frontend/src/slices/runtime/runtimeOpenApi.ts` | Régénérer (ne pas éditer à la main) |
| `apps/frontend/src/rework/types/thread.ts` | Ajouter `uiParts?: UiPart[]` |
| `apps/frontend/src/rework/.../useManagedChat.ts` | Fix `toThreadMessages()` |
| `apps/frontend/src/rework/.../AssistantTurn.tsx` | Ajouter prop + rendu |
| `apps/frontend/src/rework/.../UiPartRenderer/` | Nouveau composant dispatcher |
| `apps/frontend/src/rework/.../ComponentBlock/` | Nouveau composant + registry |
| `docs/swift/design/RUNTIME-EXECUTION-CONTRACT.md` | Créer §8, entrée datée RUNTIME-07 |
| `docs/swift/data/id-legend.yaml` | Ajouter RUNTIME-07 |
| `docs/swift/backlog/CHAT-UI-BACKLOG.md` | Ajouter case §4 RUNTIME-07 |
| `docs/swift/PMO-BOARD.md` | Ligne RUNTIME-07 |
