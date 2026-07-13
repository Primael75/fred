# Copyright Thales 2026
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""
UI-rendering part types shared between the runtime execution contract
(`fred-sdk`) and conversation history persistence (`fred-core`).

Why this module exists (RUNTIME-10):
- an agent can return `ui_parts` (LinkPart, GeoPart, ComponentPart) alongside
  its text answer; the live SSE `final` event carries them correctly, but
  before RUNTIME-10 they were silently dropped when the turn was written to
  history — `fred_core.history.history_schema.MessagePart` had no UI members
- these types used to live only in `fred_sdk/contracts/context.py`, one layer
  above `fred-core` in the dependency graph (`fred-sdk` depends on
  `fred-core`); defining them in `fred-core` and having `fred-sdk` import them
  back avoids the circular dependency that adding a `fred-core -> fred-sdk`
  edge would create
- same pattern already used for `VectorSearchHit` (`fred_core.store`), which
  `fred_sdk/contracts/context.py` already imports for `ToolInvocationResult.sources`

How to use it:
- import `UiPart` (or the individual `LinkPart` / `GeoPart` / `ComponentPart`)
  to type a field that carries rendering instructions for the Fred frontend
- `fred_core.history.history_schema.MessagePart` includes these so they survive
  a `ChatMessage` round-trip through the history store
"""

from __future__ import annotations

from enum import Enum
from typing import Annotated, Any, Dict, Literal, Optional

from pydantic import BaseModel, Field


class LinkKind(str, Enum):
    citation = "citation"  # source supporting the answer
    download = "download"  # file to fetch (pdf, csv, etc.)
    external = "external"  # generic external link
    dashboard = "dashboard"  # e.g., Grafana, Kibana
    related = "related"  # further reading
    view = "view"  # for pdf preview


class LinkPart(BaseModel):
    """
    Why this exists:
      - The UI needs a typed, explicit way to render links without parsing free text.
      - Lets agents express intent (citation/download/etc.) so the UI can group + style.
    """

    type: Literal["link"] = "link"
    href: Optional[str] = None  # absolute URL
    title: Optional[str] = None  # human label; fallback to href if None
    kind: LinkKind = LinkKind.external
    rel: Optional[str] = None  # e.g. "noopener", "noreferrer", "ugc"
    mime: Optional[str] = None  # e.g. "application/pdf"
    source_id: Optional[str] = None
    # ^ if this link corresponds to a VectorSearchHit (metadata.sources),
    #   set source_id = hit.id so the UI can cross-highlight.
    document_uid: Optional[str] = None
    file_name: Optional[str] = None


class GeoPart(BaseModel):
    """
    Why this exists:
      - Maps shouldn't be 'imagined' from text. We carry real data (GeoJSON FeatureCollection)
        so the UI can render it with Leaflet immediately.
      - Optional presentation hints keep style logic minimal in the UI.
    """

    type: Literal["geo"] = "geo"
    # Strict GeoJSON to avoid format proliferation; agents must normalize before emitting.
    # Expecting: {"type":"FeatureCollection","features":[...]}
    geojson: Dict[str, Any]
    # Optional UI hints; the UI should treat all as best-effort:
    popup_property: Optional[str] = None  # property to show in popups if present
    fit_bounds: bool = True  # auto-fit map to the features
    style: Optional[Dict[str, Any]] = None
    # e.g. {"weight":2,"opacity":0.8,"fillOpacity":0.1}


class ComponentPart(BaseModel):
    """
    Instructs the Fred frontend to mount a registered React component
    directly in the chat, inline with the assistant response.

    Why this exists:
      - Agents that produce rich artifacts (editors, viewers, dashboards)
        need a way to surface interactive UIs without leaving the chat.
      - component_id is the lookup key in the frontend COMPONENT_REGISTRY.
      - props carries the data the component needs (IDs, URLs, config).
    """

    type: Literal["component"] = "component"
    component_id: str
    props: Dict[str, Any] = {}
    title: Optional[str] = None


UiPart = Annotated[LinkPart | GeoPart | ComponentPart, Field(discriminator="type")]
