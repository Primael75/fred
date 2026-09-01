import { Graph } from "@dagrejs/dagre";
import dagre from "@dagrejs/dagre";

import type { MindmapGraphData } from "./graphAdapter";

export interface MindmapNodePosition {
  x: number;
  y: number;
}

// Cards are a fixed, uniform size — dagre needs a concrete width/height per
// node to compute non-overlapping positions. Widened from 220x52 so titles
// wrap onto two lines instead of being ellipsized, and to leave room for the
// accent rail, the theme icon and the collapse button.
export const NODE_WIDTH = 262;
export const NODE_HEIGHT = 58;

/**
 * Compute a stable dagre (layered tree) layout for every node in the full
 * (unfiltered) graph — one position per node, independent of collapse/expand
 * state. Same output contract as the radial layout it replaces, so callers
 * don't change: a Map from node id to {x, y}.
 */
export function computeDagreLayout(graph: MindmapGraphData): Map<string, MindmapNodePosition> {
  const g = new Graph();
  g.setGraph({ rankdir: "LR", nodesep: 32, ranksep: 100 });
  g.setDefaultEdgeLabel(() => ({}));

  for (const node of graph.nodes) {
    g.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  for (const link of graph.links) {
    g.setEdge(link.source, link.target);
  }

  dagre.layout(g);

  const positions = new Map<string, MindmapNodePosition>();
  for (const node of graph.nodes) {
    const laidOut = g.node(node.id);
    positions.set(node.id, { x: laidOut.x, y: laidOut.y });
  }
  return positions;
}
