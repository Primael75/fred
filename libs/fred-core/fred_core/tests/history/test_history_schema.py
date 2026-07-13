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
RUNTIME-10 — ui_parts must round-trip through ChatMessage.

Why this file exists:
- before RUNTIME-10, MessagePart had no UI-rendering members, so a ChatMessage
  built with a LinkPart/GeoPart/ComponentPart in ``parts`` would either fail
  Pydantic validation or silently drop the part — this must never regress
"""

from __future__ import annotations

from datetime import datetime, timezone

from fred_core.history.history_schema import (
    Channel,
    ChatMessage,
    Role,
    TextPart,
    make_assistant_final,
)
from fred_core.ui_parts import ComponentPart, GeoPart, LinkKind, LinkPart


def test_chat_message_accepts_link_part() -> None:
    msg = ChatMessage(
        session_id="s1",
        exchange_id="ex1",
        rank=0,
        timestamp=datetime.now(timezone.utc),
        role=Role.assistant,
        channel=Channel.final,
        parts=[LinkPart(href="https://example.com/report.pdf", kind=LinkKind.download)],
    )
    assert isinstance(msg.parts[0], LinkPart)
    assert msg.parts[0].kind == LinkKind.download


def test_chat_message_accepts_geo_part() -> None:
    msg = ChatMessage(
        session_id="s1",
        exchange_id="ex1",
        rank=0,
        timestamp=datetime.now(timezone.utc),
        role=Role.assistant,
        channel=Channel.final,
        parts=[GeoPart(geojson={"type": "FeatureCollection", "features": []})],
    )
    assert isinstance(msg.parts[0], GeoPart)


def test_chat_message_accepts_component_part() -> None:
    msg = ChatMessage(
        session_id="s1",
        exchange_id="ex1",
        rank=0,
        timestamp=datetime.now(timezone.utc),
        role=Role.assistant,
        channel=Channel.final,
        parts=[
            ComponentPart(
                component_id="presenton-editor", props={"presentation_id": "abc"}
            )
        ],
    )
    assert isinstance(msg.parts[0], ComponentPart)
    assert msg.parts[0].component_id == "presenton-editor"


def test_chat_message_round_trips_ui_parts_through_json() -> None:
    """
    The discriminated union must survive a dump/validate cycle — this is what
    actually happens between writing a row and reading it back from Postgres.
    """
    msg = ChatMessage(
        session_id="s1",
        exchange_id="ex1",
        rank=0,
        timestamp=datetime.now(timezone.utc),
        role=Role.assistant,
        channel=Channel.final,
        parts=[
            LinkPart(href="https://example.com/x.csv", kind=LinkKind.download),
            ComponentPart(component_id="presenton-editor", props={"id": "1"}),
        ],
    )
    restored = ChatMessage.model_validate_json(msg.model_dump_json())
    assert isinstance(restored.parts[0], LinkPart)
    assert isinstance(restored.parts[1], ComponentPart)
    assert restored.parts[1].component_id == "presenton-editor"


def test_make_assistant_final_includes_ui_parts() -> None:
    link = LinkPart(href="https://example.com/report.pdf", kind=LinkKind.download)
    msg = make_assistant_final(
        "s1",
        "ex1",
        0,
        text="Here is your download.",
        ui_parts=[link],
    )
    assert len(msg.parts) == 2
    text_part = msg.parts[0]
    assert isinstance(text_part, TextPart)
    assert text_part.text == "Here is your download."
    assert msg.parts[1] == link


def test_make_assistant_final_without_ui_parts_is_unchanged() -> None:
    """Backwards-compatibility guard: ui_parts=None must not change existing behaviour."""
    msg = make_assistant_final("s1", "ex1", 0, text="Done.")
    assert len(msg.parts) == 1
    text_part = msg.parts[0]
    assert isinstance(text_part, TextPart)
    assert text_part.text == "Done."
