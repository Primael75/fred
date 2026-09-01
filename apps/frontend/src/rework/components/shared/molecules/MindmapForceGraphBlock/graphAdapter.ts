import type { MindMapEvidence, MindMapNode, MindMapPayload } from "../MindMapBlock/mindmapParser";

export type { MindMapEvidence, MindMapNode, MindMapPayload };

export interface MindmapGraphNode {
  id: string;
  name: string;
  summary?: string;
  detail?: string;
  evidence?: MindMapEvidence[];
  depth: number;
  parentId: string | null;
  childIds: string[];
}

export interface MindmapGraphLink {
  source: string;
  target: string;
}

export interface MindmapGraphData {
  nodes: MindmapGraphNode[];
  links: MindmapGraphLink[];
}

/**
 * Flatten the nested MindMapPayload tree into a {nodes, links} shape,
 * recording each node's depth and parent/child ids — needed for
 * theme-by-depth coloring, radial layout, and expand/collapse.
 */
export function buildMindmapGraph(root: MindMapNode): MindmapGraphData {
  const nodes: MindmapGraphNode[] = [];
  const links: MindmapGraphLink[] = [];

  function visit(node: MindMapNode, depth: number, parentId: string | null): void {
    const childIds = (node.children ?? []).map((child) => child.id);
    nodes.push({
      id: node.id,
      name: node.name,
      summary: node.summary,
      detail: node.detail,
      evidence: node.evidence,
      depth,
      parentId,
      childIds,
    });
    if (parentId) {
      links.push({ source: parentId, target: node.id });
    }
    for (const child of node.children ?? []) {
      visit(child, depth + 1, node.id);
    }
  }

  visit(root, 0, null);
  return { nodes, links };
}

/**
 * Filter a graph down to the nodes/links that remain visible once every
 * id in collapsedIds has its descendants hidden.
 */
export function computeVisibleGraph(graph: MindmapGraphData, collapsedIds: Set<string>): MindmapGraphData {
  const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
  const hiddenIds = new Set<string>();

  function hideDescendants(id: string): void {
    const node = nodesById.get(id);
    if (!node) return;
    for (const childId of node.childIds) {
      if (!hiddenIds.has(childId)) {
        hiddenIds.add(childId);
        hideDescendants(childId);
      }
    }
  }

  for (const id of collapsedIds) {
    hideDescendants(id);
  }

  const nodes = graph.nodes.filter((node) => !hiddenIds.has(node.id));
  const visibleIds = new Set(nodes.map((node) => node.id));
  const links = graph.links.filter((link) => visibleIds.has(link.source) && visibleIds.has(link.target));
  return { nodes, links };
}
