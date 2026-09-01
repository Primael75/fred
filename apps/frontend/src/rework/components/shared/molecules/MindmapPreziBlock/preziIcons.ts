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

/**
 * Pure helpers for the Prezi renderer's adaptive card/point rendering.
 *
 * Why this exists:
 * - the renderer shows a node either as a full "sub-card" (when it has its own
 *   children or a verbose detail) or as a lightweight "icon point" (a short
 *   leaf just being enumerated) — this file decides which, and which icon
 * - keeping it free of React/DOM makes the decision logic unit-testable
 *
 * Icon names are Material Symbols ligatures consumed by the app's home-grown
 * `Icon` atom (`@shared/atoms/Icon/Icon`), NOT SVG paths. Every name returned
 * here must exist in the `MaterialIconType` union (`@shared/utils/Type.ts`).
 * `PREZI_ICON_NAMES` lists the full set so missing names can be added there.
 */

import type { MindmapNodeData } from "./preziLayout";
import { isPointNode } from "./preziLayout";

export type RenderMode = "card" | "point";

/**
 * Decide how one node renders inside its frame, from the shared `isPointNode`
 * (single source of truth, also used by the layout to pick row vs scatter).
 *
 * Level-1 nodes are forced to "card" by the caller regardless of this result,
 * since they are the illustrated top-level cards of the overview.
 */
export function renderMode(node: MindmapNodeData): RenderMode {
  return isPointNode(node) ? "point" : "card";
}

/** Strip accents and lowercase, so keyword rules stay accent-free. */
function normalize(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/**
 * Keyword → Material Symbols ligature. First matching rule wins, so more
 * specific themes are listed before broad ones (e.g. "kpi" → analytics before
 * "gestion" → account_tree). Keywords are accent-free lowercase substrings.
 */
// Ordered by semantic salience: a node's most meaningful theme should win even
// when a weaker keyword also appears. "Risques liés aux outils" must resolve to
// warning (risk), not build (tool); "Références documentaires" to menu_book
// (reference), not description (document). Broad themes (gestion/process) sit
// last so specific ones match first.
const ICON_RULES: ReadonlyArray<{ icon: string; keywords: readonly string[] }> = [
  {
    icon: "warning",
    keywords: ["risque", "risk", "danger", "alerte", "alert", "warning", "probleme", "issue", "menace", "vuln"],
  },
  { icon: "target", keywords: ["objectif", "object", "goal", "cible", "purpose", "finalit", "enjeu", "ambition"] },
  {
    icon: "checklist",
    keywords: [
      "test",
      "qualit",
      "quality",
      "valid",
      "accept",
      "critere",
      "criteria",
      "revue",
      "review",
      "controle",
      "control",
      "verif",
      "conformit",
      "recette",
    ],
  },
  {
    icon: "schedule",
    keywords: [
      "planif",
      "plan ",
      "calendrier",
      "schedule",
      "delai",
      "timeline",
      "echeance",
      "roadmap",
      "jalon",
      "phase",
      "suivi",
      "temporel",
    ],
  },
  {
    icon: "analytics",
    keywords: [
      "kpi",
      "indicateur",
      "metric",
      "mesure",
      "measure",
      "performance",
      "statistique",
      "stat",
      "budget",
      "cout",
      "cost",
      "chiffre",
      "analyse",
      "analytic",
    ],
  },
  {
    icon: "menu_book",
    keywords: [
      "reference",
      "acronyme",
      "glossaire",
      "norme",
      "standard",
      "directive",
      "guide",
      "principe",
      "definition",
      "defini",
      "terme",
    ],
  },
  {
    icon: "description",
    keywords: [
      "document",
      "fichier",
      "file",
      "rapport",
      "report",
      "livrable",
      "deliverable",
      "dossier",
      "specification",
      "specif",
    ],
  },
  {
    icon: "rocket_launch",
    keywords: ["livraison", "delivery", "deploiement", "deploy", "release", "distribution", "production", "go live"],
  },
  {
    icon: "lock",
    keywords: ["acces", "access", "habilitation", "droit", "permission", "secur", "confidential", "authentif", "rgpd"],
  },
  {
    icon: "database",
    keywords: [
      "donnee",
      "data",
      "base de",
      "referentiel",
      "referenti",
      "stockage",
      "storage",
      "archive",
      "dataset",
      "corpus",
    ],
  },
  {
    icon: "groups",
    keywords: [
      "equipe",
      "team",
      "membre",
      "member",
      "utilisateur",
      "user",
      "communaut",
      "communit",
      "collabor",
      "acteur",
      "stakeholder",
      "gouvernance",
      "role",
    ],
  },
  {
    icon: "code",
    keywords: [
      "code",
      "developp",
      "dev ",
      "logiciel",
      "software",
      "programm",
      "implement",
      "devops",
      "integration",
      "pipeline",
    ],
  },
  { icon: "build", keywords: ["outil", "tool", "instrument", "plateforme", "platform", "construct", "atelier"] },
  {
    icon: "account_tree",
    keywords: [
      "process",
      "gestion",
      "management",
      "workflow",
      "operation",
      "methode",
      "method",
      "pratique",
      "practice",
      "discipline",
      "organisation",
    ],
  },
];

/** Icon used when no keyword rule matches. */
export const DEFAULT_ICON = "circle";

/**
 * All ligature names this module can emit. Any name missing from the app's
 * `MaterialIconType` union must be added there (the font already ships the
 * glyphs; the union is the only gate).
 */
export const PREZI_ICON_NAMES: readonly string[] = [...ICON_RULES.map((rule) => rule.icon), DEFAULT_ICON];

/**
 * Pick a Material Symbols ligature for a node, from its name plus a little of
 * its summary. Falls back to `DEFAULT_ICON` when nothing matches.
 */
export function pickIcon(name: string, summary = ""): string {
  const haystack = normalize(`${name} ${summary}`);
  for (const rule of ICON_RULES) {
    if (rule.keywords.some((keyword) => haystack.includes(keyword))) {
      return rule.icon;
    }
  }
  return DEFAULT_ICON;
}
