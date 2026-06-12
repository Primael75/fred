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

import type { ComponentType } from "react";
import type { ComponentPart } from "../../../../../slices/runtime/runtimeOpenApi";

const COMPONENT_REGISTRY: Record<string, ComponentType<Record<string, any>>> = {
  // Register Synthia components here as they are implemented.
  // Example: "presenton-editor": PrestonEditorBlock,
};

export function ComponentBlock({ part }: { part: ComponentPart }) {
  const Component = COMPONENT_REGISTRY[part.component_id];
  if (!Component) {
    return <p>Unknown component: {part.component_id}</p>;
  }
  return <Component {...(part.props ?? {})} />;
}
