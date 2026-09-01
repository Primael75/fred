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
 * Pure layout engine for the Prezi-style mindmap renderer.
 *
 * Why this exists:
 * - the Prezi renderer needs every node placed once, in absolute "world"
 *   coordinates, so the camera can fly anywhere without re-layout
 * - keeping this file free of React and DOM makes it unit-testable in Node
 *
 * How it works:
 * - level-1 nodes are placed on an organic elliptical ring around a central
 *   anchor, then relaxed to remove overlaps (mirrors the Prezi "scatter" look)
 * - deeper nodes are placed by recursive weighted binary partition of their
 *   parent's content area, with deterministic jitter for the organic feel
 * - all randomness comes from a seeded PRNG so a given mindmap always
 *   produces the same layout
 */

import type { MindMapNode, MindMapPayload, MindMapEvidence } from "../MindmapForceGraphBlock/graphAdapter";

export type MindmapEvidenceData = MindMapEvidence;

/** Same shape as MindMapNode, recursively extended with the optional
 * imageUrl reserved for future backend image enrichment. */
export type MindmapNodeData = Omit<MindMapNode, "children"> & {
  imageUrl?: string;
  children?: MindmapNodeData[];
};

export type MindmapPayloadData = Omit<MindMapPayload, "root"> & {
  root: MindmapNodeData;
};

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type ImageVariant = "left" | "right";

export interface Frame {
  node: MindmapNodeData;
  rect: Rect;
  depth: number;
  accent: string;
  isLeaf: boolean;
  /** Ancestor chain names, root first — used for the breadcrumb. */
  path: string[];
  /** node.id of the parent, or null for the root. Used for zoom-based culling. */
  parentId: string | null;
  /**
   * Where this card's illustration sits (deterministic per id), or `null` when
   * the node has no image. Only level-1 cards carry one, since the backend
   * resolves images for the root and first-level branches only. The layout
   * insets the children area to match, so image and content never overlap.
   */
  imageVariant: ImageVariant | null;
}

export const WORLD = { w: 2400, h: 1500 };
export const ANCHOR_RADIUS = 430;
export const CENTER_STAGE = { w: 780, h: 560 };
export const TITLE_ZONE = { w: 1080, h: 440 };
export const TITLE_BAND_RATIO = 0.24;
/** Fraction of an image card's height reserved for the title above children. */
export const TITLE_COL_RATIO = 0.3;

/**
 * Neon accents tuned for the dark canvas, shared with the Zumly renderer so
 * both dark modes read as one product. One per level-1 branch, inherited by
 * that branch's descendants.
 */
export const ACCENT_PALETTE = ["#a371f7", "#f0883e", "#3fb950", "#58a6ff", "#d29922", "#ec6cb9"];

/** Deterministic PRNG (mulberry32) so layouts are stable across renders. */
function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashString(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h | 0;
}

/**
 * A node longer than this many `detail` characters is content-rich enough to
 * warrant a full card rather than a one-line icon point. Single source of
 * truth shared by the layout (row vs scatter) and the renderer (card vs point)
 * so both always agree.
 */
export const POINT_DETAIL_LIMIT = 90;

/**
 * True when a node should render as a compact icon point: a childless leaf
 * with at most a short detail. Nodes with children or a verbose detail are
 * full cards instead.
 */
export function isPointNode(node: MindmapNodeData): boolean {
  if ((node.children?.length ?? 0) > 0) return false;
  return (node.detail ?? "").trim().length <= POINT_DETAIL_LIMIT;
}

/** Subtree weight: bigger subtrees get bigger cards and softer zooms. */
export function subtreeWeight(node: MindmapNodeData): number {
  const children = node.children ?? [];
  if (children.length === 0) {
    const contentBonus = (node.detail ? 0.4 : 0) + (node.evidence?.length ?? 0) * 0.1;
    return 1 + contentBonus;
  }
  return children.reduce((sum, child) => sum + subtreeWeight(child), 1);
}

function rectsOverlap(a: Rect, b: Rect, margin: number): boolean {
  return (
    Math.min(a.x + a.w + margin, b.x + b.w + margin) - Math.max(a.x - margin, b.x - margin) > 0 &&
    Math.min(a.y + a.h + margin, b.y + b.h + margin) - Math.max(a.y - margin, b.y - margin) > 0
  );
}

function clamp(min: number, max: number, value: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Place level-1 nodes on a jittered elliptical ring around the anchor, then
 * run a bounded relaxation loop to separate overlapping cards and keep them
 * clear of the central anchor circle.
 *
 * Card sizes are driven by the weight of each subtree *relative to its
 * siblings*, clamped to a bounded factor. Absolute weights must never set
 * absolute sizes: a depth-4 / 8-children payload has subtree weights in the
 * hundreds, which would produce cards wider than the world itself.
 */
function layoutRing(children: MindmapNodeData[], rng: () => number): Map<string, Rect> {
  const cx = WORLD.w / 2;
  const cy = WORLD.h / 2;
  const weights = children.map((child) => subtreeWeight(child));
  const meanWeight = weights.reduce((sum, weight) => sum + weight, 0) / (weights.length || 1);
  const baseWidth = clamp(230, 380, 1900 / Math.max(1, children.length));
  const rects = children.map((_child, index) => {
    const angle = -Math.PI / 2 + ((2 * Math.PI) / children.length) * index + (rng() - 0.5) * 0.35;
    const radius = 800 + (rng() - 0.5) * 140;
    const sizeFactor = clamp(0.78, 1.35, Math.sqrt(weights[index] / meanWeight));
    const w = baseWidth * sizeFactor * (0.95 + rng() * 0.15);
    const h = w * (0.68 + rng() * 0.14);
    return {
      x: cx + Math.cos(angle) * radius - w / 2,
      y: cy + Math.sin(angle) * radius * 0.62 - h / 2,
      w,
      h,
    };
  });

  for (let iteration = 0; iteration < 120; iteration++) {
    let moved = false;
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i];
        const b = rects[j];
        if (!rectsOverlap(a, b, 40)) continue;
        moved = true;
        const dx = a.x + a.w / 2 - (b.x + b.w / 2);
        const dy = a.y + a.h / 2 - (b.y + b.h / 2);
        const overlapX = Math.min(a.x + a.w + 40, b.x + b.w + 40) - Math.max(a.x - 40, b.x - 40);
        const overlapY = Math.min(a.y + a.h + 40, b.y + b.h + 40) - Math.max(a.y - 40, b.y - 40);
        if (overlapX < overlapY) {
          const push = (overlapX / 2) * Math.sign(dx || 1);
          a.x += push;
          b.x -= push;
        } else {
          const push = (overlapY / 2) * Math.sign(dy || 1);
          a.y += push;
          b.y -= push;
        }
      }
      const rect = rects[i];
      const rcx = rect.x + rect.w / 2;
      const rcy = rect.y + rect.h / 2;
      const distance = Math.hypot(rcx - cx, rcy - cy);
      const minDistance = ANCHOR_RADIUS + (Math.hypot(rect.w, rect.h) / 2) * 0.7 + 30;
      if (distance < minDistance) {
        moved = true;
        const factor = (minDistance - distance) / (distance || 1);
        rect.x += (rcx - cx) * factor;
        rect.y += (rcy - cy) * factor;
      }
      // The bottom-left corner is reserved for the cover title (CenterStage's
      // fading title block) — push out any card biting into it, escaping via
      // whichever axis needs the smaller nudge.
      const zoneTop = WORLD.h - TITLE_ZONE.h;
      if (rect.x < TITLE_ZONE.w && rect.y + rect.h > zoneTop) {
        moved = true;
        const pushRight = TITLE_ZONE.w - rect.x;
        const pushUp = rect.y + rect.h - zoneTop;
        if (pushRight < pushUp) rect.x += pushRight;
        else rect.y -= pushUp;
      }
      // Clamp inside the relaxation loop, not after it: clamping afterwards
      // could silently reintroduce overlaps that relaxation already resolved.
      rect.x = clamp(30, WORLD.w - rect.w - 30, rect.x);
      rect.y = clamp(30, WORLD.h - rect.h - 30, rect.y);
    }
    if (!moved) break;
  }

  const result = new Map<string, Rect>();
  children.forEach((child, index) => {
    result.set(child.id, rects[index]);
  });
  return result;
}

/**
 * Recursive weighted binary partition: splits the area along its longer side
 * proportionally to subtree weights, producing treemap-like nested cells
 * without any external dependency. Jitter shrinks each final cell slightly
 * so nested cards never touch and the composition looks hand-placed.
 */
function partition(
  items: { node: MindmapNodeData; weight: number }[],
  area: Rect,
  rng: () => number,
  out: Map<string, Rect>,
): void {
  if (items.length === 0 || area.w <= 0 || area.h <= 0) return;
  if (items.length === 1) {
    const shrink = 0.05 + rng() * 0.07;
    const w = area.w * (1 - shrink);
    const h = area.h * (1 - shrink);
    out.set(items[0].node.id, {
      x: area.x + (area.w - w) * rng(),
      y: area.y + (area.h - h) * rng(),
      w,
      h,
    });
    return;
  }
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  let acc = 0;
  let splitIndex = 1;
  for (let i = 0; i < items.length - 1; i++) {
    acc += items[i].weight;
    if (acc >= total / 2) {
      splitIndex = i + 1;
      break;
    }
  }
  const firstWeight = items.slice(0, splitIndex).reduce((sum, item) => sum + item.weight, 0);
  const ratio = clamp(0.3, 0.7, firstWeight / total);
  // Proportional, never absolute: a fixed 12px gap exceeds the area itself a
  // few levels deep, which produced negative cell sizes and malformed cards.
  const gap = Math.min(12, Math.min(area.w, area.h) * 0.06);
  if (area.w >= area.h) {
    const firstW = (area.w - gap) * ratio;
    partition(items.slice(0, splitIndex), { x: area.x, y: area.y, w: firstW, h: area.h }, rng, out);
    partition(
      items.slice(splitIndex),
      { x: area.x + firstW + gap, y: area.y, w: area.w - firstW - gap, h: area.h },
      rng,
      out,
    );
  } else {
    const firstH = (area.h - gap) * ratio;
    partition(items.slice(0, splitIndex), { x: area.x, y: area.y, w: area.w, h: firstH }, rng, out);
    partition(
      items.slice(splitIndex),
      { x: area.x, y: area.y + firstH + gap, w: area.w, h: area.h - firstH - gap },
      rng,
      out,
    );
  }
}

/**
 * Lay children out as full-width stacked rows inside `area`. Used when a node's
 * children are all icon points, giving the tidy vertical list (icon + full
 * title + description per row) of a Prezi "bullets" slide, instead of the
 * organic scatter used for mixed/verbose children.
 */
function layoutRows(children: MindmapNodeData[], area: Rect, out: Map<string, Rect>): void {
  const count = children.length;
  if (count === 0) return;
  const gap = area.h * 0.04;
  const rowHeight = Math.max(1, (area.h - gap * (count - 1)) / count);
  children.forEach((child, index) => {
    out.set(child.id, {
      x: area.x,
      y: area.y + index * (rowHeight + gap),
      w: area.w,
      h: rowHeight,
    });
  });
}

export function contentArea(rect: Rect): Rect {
  // Strictly proportional to the card, never clamped to absolute pixels:
  // deep cells can be a few world-pixels wide, and an absolute minimum would
  // make the title band larger than the card itself (negative content area).
  // The camera zoom is what makes small cells legible, as in Prezi.
  const titleH = rect.h * TITLE_BAND_RATIO;
  const pad = rect.w * 0.035;
  return {
    x: rect.x + pad,
    y: rect.y + titleH,
    w: rect.w - pad * 2,
    h: rect.h - titleH - pad,
  };
}

/** Fraction of a card's width taken by its full-height illustration column. */
export const IMAGE_FRACTION = 0.44;
/** Fraction of an illustrated card's width used by the text/children column. */
export const TEXT_COL_RATIO = 0.56;

const IMAGE_VARIANTS: readonly ImageVariant[] = ["left", "right"];

/** Deterministic image placement for a node, stable across renders. */
export function imageVariantFor(id: string): ImageVariant {
  return IMAGE_VARIANTS[Math.abs(hashString(id)) % IMAGE_VARIANTS.length];
}

/**
 * Split a whole card `rect` into three regions for the two-column image
 * layout (Prezi "Northrop" style): a full-height image column on one side, a
 * title box at the top of the other column, and the children/content region
 * below it. The image touches the card's outer edges top-to-bottom — the
 * card's own `overflow: hidden` + radius round its outer corners while the
 * inner edge stays straight (image internal to the card, full frame height).
 * Shared by the layout (to place children in `content`) and the renderer (to
 * place the <img> and title), so both agree. Coordinates are in the same
 * space as `rect` (world for layout, local for the renderer).
 */
export function cardRegions(rect: Rect, variant: ImageVariant | null): { image: Rect; title: Rect; content: Rect } {
  // Padding is capped against BOTH dimensions: on a very wide, short card a
  // width-derived padding could exceed the height and yield negative regions
  // (which cascaded into negative font sizes and malformed deep cards).
  const pad = Math.min(rect.w, rect.h) * 0.05;
  const titleH = rect.h * TITLE_COL_RATIO;
  // No image: the text column spans the full card.
  const colW = Math.max(0, (variant ? rect.w * TEXT_COL_RATIO : rect.w) - pad * 2);
  // Image is a full-bleed background; the text column sits on the side
  // opposite the visible part of the photo (gradient handles legibility).
  const colX = variant === "left" ? rect.x + rect.w - colW - pad : rect.x + pad;
  return {
    image: { x: rect.x, y: rect.y, w: rect.w, h: rect.h },
    title: { x: colX, y: rect.y + pad, w: colW, h: Math.max(0, titleH - pad) },
    content: {
      x: colX,
      y: rect.y + titleH,
      w: colW,
      h: Math.max(0, rect.h - titleH - pad),
    },
  };
}

/**
 * Build the full flat frame list in depth-first (presentation) order.
 * The first frame is always the overview (root node, whole world rect).
 */
export function buildLayout(payload: MindmapPayloadData): Frame[] {
  const root = payload.root;
  const rng = mulberry32(hashString(root.id + "|" + root.name));
  const frames: Frame[] = [];
  const level1 = root.children ?? [];
  const ringRects = layoutRing(level1, rng);

  frames.push({
    node: root,
    rect: { x: 0, y: 0, w: WORLD.w, h: WORLD.h },
    depth: 0,
    accent: ACCENT_PALETTE[0],
    isLeaf: level1.length === 0,
    path: [root.name],
    parentId: null,
    imageVariant: null,
  });

  const walk = (
    node: MindmapNodeData,
    rect: Rect,
    depth: number,
    accent: string,
    path: string[],
    parentId: string,
  ): void => {
    const children = node.children ?? [];
    // Only level-1 cards carry an illustration (backend resolves images for
    // root + first level only). When present, the children area is inset to
    // leave the image strip clear.
    const imageVariant = depth === 1 && node.imageUrl ? imageVariantFor(node.id) : null;
    frames.push({
      node,
      rect,
      depth,
      accent,
      isLeaf: children.length === 0,
      path,
      parentId,
      imageVariant,
    });
    if (children.length === 0) return;
    // Children always live in the card's text column (full width when the
    // card has no image), the exact region the renderer leaves free below
    // the title — so a card's title can never be overlapped by its children.
    const area = cardRegions(rect, imageVariant).content;
    // Stop descending once the content region is degenerate: laying children
    // out in a zero/near-zero area produced malformed slivers. Those nodes
    // stay reachable through the previous/next path, just not drawn inside a
    // parent too small to hold them.
    if (area.w <= 2 || area.h <= 2) return;
    const cells = new Map<string, Rect>();
    // All-point parents get a tidy vertical row list; anything with a verbose
    // or branching child keeps the organic scatter. This mirrors the renderer's
    // per-parent card/point decision, since both use isPointNode.
    if (children.every(isPointNode)) {
      layoutRows(children, area, cells);
    } else {
      partition(
        children.map((child) => ({ node: child, weight: subtreeWeight(child) })),
        area,
        rng,
        cells,
      );
    }
    for (const child of children) {
      const cell = cells.get(child.id);
      if (!cell) continue;
      walk(child, cell, depth + 1, accent, [...path, child.name], node.id);
    }
  };

  level1.forEach((child, index) => {
    const accent = ACCENT_PALETTE[index % ACCENT_PALETTE.length];
    const rect = ringRects.get(child.id);
    if (!rect) return;
    walk(child, rect, 1, accent, [root.name, child.name], root.id);
  });

  return frames;
}
