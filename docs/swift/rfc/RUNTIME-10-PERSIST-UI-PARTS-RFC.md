# RFC — Persister les `ui_parts` (LinkPart, GeoPart, ComponentPart) dans l'historique de session

**Status**: Implemented (awaiting review) — 2026-07-13, `make code-quality`/`make test` green on `fred-core` (250 tests), `fred-sdk` (186 tests, incl. purity), `fred-runtime` (408 tests)
**Author**: Primael (Synthia / Thales)
**Date**: 2026-07-13
**ID**: RUNTIME-10
**Area**: `fred-core`, `fred-sdk`, `fred-runtime`
**Related**: `CHAT-16` / `RFC-001-COMPONENT-PART.md` (extension SDK+frontend de l'union `UiPart` — périmètre distinct, ne touche pas la persistance)

---

## 1. Pourquoi ce RFC existe

Un agent peut retourner des `ui_parts` (`LinkPart`, `GeoPart`, `ComponentPart`) dans sa réponse finale.
En session live (SSE), ces parts s'affichent correctement — le frontend les reçoit directement dans
l'événement `final`. Mais **au rechargement de la page**, l'historique relu via
`GET /agents/sessions/{session_id}/messages` ne les contient plus : les liens de téléchargement,
cartes GeoJSON et composants interactifs (ex. éditeur Presenton) disparaissent.

Le bullet backlog existant (`CHAT-UI-BACKLOG.md §4.5.D`) décrit déjà le symptôme pour `LinkPart` :
*"Preserve `ui_parts` in runtime history so live SSE and `messages_url_template` replay show the
same download links"* — ce RFC en est la solution technique complète, étendue à `GeoPart` et
`ComponentPart`.

---

## 2. Problème actuel — trois pertes en cascade

### 2.1 `fred_core.history.history_schema.MessagePart` n'inclut aucun type UI

```python
# libs/fred-core/fred_core/history/history_schema.py — état actuel
MessagePart: TypeAlias = Annotated[
    Union[TextPart, CodePart, ImageUrlPart, ToolCallPart, ToolResultPart,
          HitlRequestPart, HitlResponsePart],
    Field(discriminator="type"),
]
```

Le docstring du module affirme qu'*"agentic-backend extends this union with LinkPart and GeoPart in
its own `chat_schema` module"* — ce module n'existe nulle part dans le dépôt actuel (confirmé par
recherche exhaustive). C'est une extension documentée mais jamais construite, et elle ne mentionne
même pas `ComponentPart`.

### 2.2 `make_assistant_final()` n'a pas de paramètre `ui_parts`

```python
def make_assistant_final(session_id, exchange_id, rank, text, *, model=None, usage=None,
                          sources=None, finish_reason=None) -> ChatMessage:
    return ChatMessage(..., parts=[TextPart(text=text)] if text else [], ...)
```

Même si le payload contenait `ui_parts`, cette factory ne saurait pas où les mettre.

### 2.3 `_write_turn_history()` ne lit jamais `payload["ui_parts"]`

```python
# libs/fred-runtime/fred_runtime/app/agent_app.py — branche "final"
elif kind == "final":
    final_content = payload.get("content", "")
    raw_sources = payload.get("sources") or []
    ...
    final_model = payload.get("model_name")
    final_finish_reason = payload.get("finish_reason")
    # payload.get("ui_parts") jamais lu
```

Le payload SSE `final` contient pourtant bien la clé `ui_parts` (confirmé par le fixture
`tests/test_conversational_memory.py:290`).

### 2.4 Le frontend, lui, est déjà prêt

`apps/frontend/.../useManagedChat.ts::toThreadMessages()` filtre déjà `m.parts` pour
`type === "geo" || type === "component"` et extrait les `LinkPart` via `linksOf(m)`. Aucun
changement frontend n'est nécessaire pour ce RFC — le problème est entièrement côté écriture
d'historique.

---

## 3. Solution proposée

### 3.1 Déplacer les types UI de `fred-sdk` vers `fred-core`

```python
# libs/fred-core/fred_core/ui_parts.py (nouveau module)

class LinkKind(str, Enum): ...
class LinkPart(BaseModel): ...
class GeoPart(BaseModel): ...
class ComponentPart(BaseModel): ...
UiPart = Annotated[LinkPart | GeoPart | ComponentPart, Field(discriminator="type")]
```

`libs/fred-sdk/fred_sdk/contracts/context.py` réimporte ces types au lieu de les définir localement :

```python
from fred_core.ui_parts import LinkKind, LinkPart, GeoPart, ComponentPart, UiPart
```

**Pourquoi ce sens et pas l'inverse** : `fred-sdk` dépend déjà de `fred-core`
(`fred-sdk/pyproject.toml:10`). L'inverse (`fred-core` → `fred-sdk`) créerait un cycle, car
`fred-sdk` dépend déjà de `fred-core` — confirmé lors de l'analyse préalable. Précédent identique
déjà en place dans le même fichier : `VectorSearchHit` est défini dans `fred_core.store` et
réimporté par `fred_sdk/contracts/context.py` (ligne 44) pour `ToolInvocationResult.sources`.

### 3.2 Étendre `MessagePart`

```python
# libs/fred-core/fred_core/history/history_schema.py
from fred_core.ui_parts import LinkPart, GeoPart, ComponentPart

MessagePart: TypeAlias = Annotated[
    Union[TextPart, CodePart, ImageUrlPart, ToolCallPart, ToolResultPart,
          HitlRequestPart, HitlResponsePart, LinkPart, GeoPart, ComponentPart],
    Field(discriminator="type"),
]
```

### 3.3 Étendre `make_assistant_final()`

```python
def make_assistant_final(session_id, exchange_id, rank, text, *, model=None, usage=None,
                          sources=None, finish_reason=None,
                          ui_parts: Optional[Sequence[UiPart]] = None) -> ChatMessage:
    parts: list[MessagePart] = [TextPart(text=text)] if text else []
    if ui_parts:
        parts.extend(ui_parts)
    return ChatMessage(..., parts=parts, ...)
```

### 3.4 Lire `ui_parts` dans `_write_turn_history`

```python
elif kind == "final":
    ...
    raw_ui_parts = payload.get("ui_parts") or []
    final_ui_parts = [
        _parse_ui_part(p) for p in raw_ui_parts if isinstance(p, dict)
    ]
...
messages.append(
    make_assistant_final(..., ui_parts=final_ui_parts or None)
)
```

`_parse_ui_part` utilise le discriminant `type` pour valider contre `LinkPart | GeoPart |
ComponentPart` (pattern identique à `VectorSearchHit.model_validate(s)` déjà utilisé pour
`sources` quelques lignes plus haut).

---

## 4. Impact sur les contrats gelés

`agent_app.py` (`_write_turn_history`) et `MessagePart`/`UiPart` (union discriminée) sont touchés.

**Justification** :
- L'union `MessagePart` est extensible par design (discriminant `type`) — ajouter des membres ne
  casse aucun client existant qui ignore les types inconnus.
- `make_assistant_final(..., ui_parts=None)` par défaut — signature rétrocompatible, aucun appelant
  existant cassé.
- Aucun champ existant supprimé ou modifié.

**Action** : entrée datée dans `RUNTIME-EXECUTION-CONTRACT.md §14` (Frozen Contract Change Log).

---

## 5. Alternatives considérées

**A — Étendre `fred-core` avec une dépendance vers `fred-sdk`** : rejeté — cycle confirmé
(`fred-sdk` → `fred-core` existe déjà ; l'inverse créerait `fred-core → fred-sdk → fred-core`).

**B — Stocker `ui_parts` dans `ChatMetadata` (déjà `extra="allow"`)** : rejeté — sémantiquement faux
(ce sont des parties de contenu affichées en ligne, pas des métadonnées d'analytics), et le
frontend lit déjà `m.parts`, pas `m.metadata`, pour ces types — demanderait aussi une réécriture
frontend hors périmètre.

**C — Ne rien faire, garder l'historique text-only** : rejeté — régression produit confirmée
(composants interactifs Synthia/Presenton disparaissent au reload), symptôme déjà remonté en
production.

---

## 6. Fichiers touchés

| Fichier | Modification |
|---|---|
| `libs/fred-core/fred_core/ui_parts.py` | **Nouveau** — `LinkKind`, `LinkPart`, `GeoPart`, `ComponentPart`, `UiPart` |
| `libs/fred-core/fred_core/history/history_schema.py` | Étendre `MessagePart` ; ajouter `ui_parts` à `make_assistant_final` |
| `libs/fred-sdk/fred_sdk/contracts/context.py` | Remplacer définitions locales par import depuis `fred_core.ui_parts` |
| `libs/fred-runtime/fred_runtime/app/agent_app.py` | `_write_turn_history` — lire et parser `payload["ui_parts"]` |
| `libs/fred-runtime/tests/test_history.py` | Étendre `test_write_turn_history_maps_react_turn_to_chat_messages` |
| `libs/fred-core` tests | Nouveau test — `ChatMessage` accepte `LinkPart`/`GeoPart`/`ComponentPart` |
| `libs/fred-sdk/tests/test_sdk_purity.py` | Rejoué (aucune modification attendue) |
| `docs/swift/design/RUNTIME-EXECUTION-CONTRACT.md` | Entrée datée §14 |
| `docs/swift/data/id-legend.yaml` | Ajouter `RUNTIME-10` |
| `docs/swift/backlog/CHAT-UI-BACKLOG.md` | Rattacher les 2 bullets `§4.5.D` à `RUNTIME-10` |
| `docs/swift/PMO-BOARD.md` | Ligne `RUNTIME-10` |
