// Copyright Thales 2026
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import type { ComponentPart, GeoPart, LinkPart } from "../../../../../slices/runtime/runtimeOpenApi";
import type { UiPart } from "@rework/types/thread";
import { ComponentBlock } from "@shared/molecules/ComponentBlock/ComponentBlock";

function LinkBlock({ part }: { part: LinkPart }) {
  return (
    <a href={part.href ?? "#"} target="_blank" rel="noopener noreferrer">
      {part.title ?? part.file_name ?? part.href ?? "Download"}
    </a>
  );
}

function GeoBlock(_: { part: GeoPart }) {
  // Full Leaflet rendering is tracked under CHAT-04.
  return <div>Map (GeoJSON rendering not yet available)</div>;
}

export function UiPartRenderer({ part }: { part: UiPart }) {
  if (part.type === "component") return <ComponentBlock part={part as ComponentPart} />;
  if (part.type === "geo") return <GeoBlock part={part as GeoPart} />;
  if (part.type === "link") return <LinkBlock part={part as LinkPart} />;
  return null;
}
