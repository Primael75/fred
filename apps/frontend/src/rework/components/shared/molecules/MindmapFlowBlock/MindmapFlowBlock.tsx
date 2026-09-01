import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  type Node,
  type Edge,
  type NodeTypes,
  type ReactFlowInstance,
  type NodeMouseHandler,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import IconButton from "@shared/atoms/IconButton/IconButton";
import Icon from "@shared/atoms/Icon/Icon";
import type { MaterialIconType } from "@shared/utils/Type";

import { buildMindmapGraph, computeVisibleGraph, type MindMapPayload } from "../MindmapForceGraphBlock/graphAdapter";
import { computeDagreLayout } from "../MindmapForceGraphBlock/dagreLayout";
import { pickIcon } from "../MindmapPreziBlock/preziIcons";
import { MindmapFrameNode, FLOW_THEME, type MindmapFrameData } from "./MindmapFrameNode";

const nodeTypes: NodeTypes = {
  frame: MindmapFrameNode,
};

/** Same neon accents as the Prezi and Zumly renderers, one per level-1 branch. */
const BRANCH_ACCENTS = ["#a371f7", "#f0883e", "#3fb950", "#58a6ff", "#d29922", "#ec6cb9"];
const ROOT_ACCENT = "#58a6ff";

export function MindmapFlowBlock({ root }: MindMapPayload) {
  const graph = useMemo(() => buildMindmapGraph(root), [root]);

  /**
   * Branch accent per node: level-1 children each take the next palette
   * entry, every descendant inherits its branch's colour. Lets both the cards
   * and the edges say which branch they belong to — the old single teal made
   * the fan of edges near the root unreadable.
   */
  const accentById = useMemo(() => {
    const accents = new Map<string, string>();
    let branchIndex = 0;
    for (const node of graph.nodes) {
      if (node.depth === 0) {
        accents.set(node.id, ROOT_ACCENT);
      } else if (node.depth === 1) {
        accents.set(node.id, BRANCH_ACCENTS[branchIndex++ % BRANCH_ACCENTS.length]);
      } else {
        const parentAccent = node.parentId ? accents.get(node.parentId) : undefined;
        accents.set(node.id, parentAccent ?? ROOT_ACCENT);
      }
    }
    return accents;
  }, [graph]);

  /** Root-only subtitle: quick shape of the map, like the Zumly KPI strip. */
  const rootSubtitle = useMemo(() => {
    const sections = graph.nodes.filter((node) => node.depth === 1).length;
    const points = graph.nodes.length - 1;
    return `${sections} sections · ${points} points`;
  }, [graph]);

  // Positions are computed once on the full, unfiltered graph and never
  // recomputed when collapsedIds changes — collapse/expand is a pure
  // visibility filter over these stable coordinates.
  const positions = useMemo(() => computeDagreLayout(graph), [graph]);

  // Conservative, payload-independent default: depth === 1 (root's direct
  // children) start collapsed whenever they have children of their own.
  // Deliberately does NOT read presentation.initialDepth — that's what let
  // the force-graph version render cluttered on wide/deep payloads.
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => {
    const ids = new Set<string>();
    for (const node of graph.nodes) {
      if (node.depth === 1 && node.childIds.length > 0) {
        ids.add(node.id);
      }
    }
    return ids;
  });
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const visibleGraph = useMemo(() => computeVisibleGraph(graph, collapsedIds), [graph, collapsedIds]);

  // Detail panel looks up the selected node in the full graph, not
  // visibleGraph — a node can be selected then collapsed away from view
  // while its detail panel should still show what was last selected.
  const selectedNode = selectedNodeId ? (graph.nodes.find((node) => node.id === selectedNodeId) ?? null) : null;

  const toggleCollapse = useCallback((id: string) => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const nodes: Node<MindmapFrameData>[] = useMemo(
    () =>
      visibleGraph.nodes.map((node) => ({
        id: node.id,
        type: "frame",
        position: positions.get(node.id) ?? { x: 0, y: 0 },
        data: {
          name: node.name,
          depth: node.depth,
          hasChildren: node.childIds.length > 0,
          isCollapsed: collapsedIds.has(node.id),
          isSelected: node.id === selectedNodeId,
          accent: accentById.get(node.id) ?? ROOT_ACCENT,
          icon: (node.depth === 0 ? "hub" : pickIcon(node.name, node.summary)) as MaterialIconType,
          subtitle: node.depth === 0 ? rootSubtitle : undefined,
          onToggleCollapse: () => toggleCollapse(node.id),
        },
      })),
    [visibleGraph.nodes, positions, collapsedIds, selectedNodeId, toggleCollapse, accentById, rootSubtitle],
  );

  const edges: Edge[] = useMemo(
    () =>
      visibleGraph.links.map((link) => ({
        id: `${link.source}-${link.target}`,
        source: link.source,
        target: link.target,
        // Tinted with the target's branch colour so the fan leaving the root
        // reads as distinct branches rather than one white tangle.
        style: {
          stroke: accentById.get(link.target) ?? ROOT_ACCENT,
          strokeWidth: 1.6,
          opacity: 0.7,
        },
      })),
    [visibleGraph.links, accentById],
  );

  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === containerRef.current);
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void containerRef.current?.requestFullscreen();
    }
  };

  // onInit + ref, not useReactFlow() — avoids needing a <ReactFlowProvider>
  // wrapper, same ref-based pattern already used for ForceGraphMethods.
  const reactFlowInstanceRef = useRef<ReactFlowInstance | undefined>(undefined);

  const handleNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      setSelectedNodeId(node.id);
      const position = positions.get(node.id);
      const instance = reactFlowInstanceRef.current;
      if (instance && position) {
        void instance.setCenter(position.x, position.y, { zoom: 1.5, duration: 800 });
      }
    },
    [positions],
  );

  const selectedAccent = selectedNode ? (accentById.get(selectedNode.id) ?? ROOT_ACCENT) : ROOT_ACCENT;
  const selectedIcon: MaterialIconType | undefined = selectedNode
    ? ((selectedNode.depth === 0 ? "hub" : pickIcon(selectedNode.name, selectedNode.summary)) as MaterialIconType)
    : undefined;

  return (
    <div
      ref={containerRef}
      style={{
        width: "100%",
        height: isFullscreen ? "100%" : "calc(100vh - 60px)",
        position: "relative",
        background: FLOW_THEME.canvas,
        borderRadius: 12,
        overflow: "hidden",
      }}
    >
      <ReactFlow
        nodeTypes={nodeTypes}
        nodes={nodes}
        edges={edges}
        style={{ background: FLOW_THEME.canvas }}
        onInit={(instance) => {
          reactFlowInstanceRef.current = instance;
        }}
        onNodeClick={handleNodeClick}
        onPaneClick={() => setSelectedNodeId(null)}
        minZoom={0.2}
        maxZoom={4}
        fitView
      />

      <IconButton
        type="button"
        color="primary"
        variant="filled"
        size="medium"
        icon={{ category: "outlined", type: isFullscreen ? "fullscreen_exit" : "fullscreen" }}
        onClick={toggleFullscreen}
        aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
        title={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
        style={{ position: "absolute", top: 12, right: 12, zIndex: 1000 }}
      />

      {/* Explanatory banner — same trigger and content as before (selected
          node's name / summary / detail / quotes), restyled for the dark
          canvas with the branch accent as its left rail. */}
      {selectedNode && (
        <div
          style={{
            position: "absolute",
            bottom: 10,
            left: 10,
            right: 10,
            maxHeight: "38%",
            overflowY: "auto",
            display: "flex",
            gap: 12,
            padding: "12px 14px",
            background: FLOW_THEME.panel,
            border: `1px solid ${FLOW_THEME.border}`,
            borderLeft: `3px solid ${selectedAccent}`,
            borderRadius: 10,
            color: FLOW_THEME.body,
            fontSize: 13,
            lineHeight: 1.5,
            boxShadow: "0 8px 28px rgba(0, 0, 0, 0.5)",
            zIndex: 1000,
          }}
        >
          <span
            aria-hidden="true"
            style={{
              fontSize: 20,
              lineHeight: 1,
              flex: "none",
              marginTop: 1,
              color: selectedAccent,
            }}
          >
            {selectedIcon ? <Icon category="outlined" type={selectedIcon} /> : null}
          </span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontWeight: 600, color: FLOW_THEME.title, fontSize: 14 }}>{selectedNode.name}</div>
            {selectedNode.summary && (
              <div style={{ marginTop: 4, color: FLOW_THEME.muted, fontStyle: "italic" }}>{selectedNode.summary}</div>
            )}
            {selectedNode.detail && <div style={{ marginTop: 6 }}>{selectedNode.detail}</div>}
            {selectedNode.evidence && selectedNode.evidence.length > 0 && (
              <div style={{ marginTop: 8 }}>
                <div
                  style={{
                    fontSize: 10.5,
                    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
                    letterSpacing: "0.14em",
                    textTransform: "uppercase",
                    color: FLOW_THEME.muted,
                  }}
                >
                  Sources
                </div>
                {selectedNode.evidence.map((item, index) => (
                  <div
                    key={index}
                    style={{
                      marginTop: 5,
                      paddingLeft: 10,
                      borderLeft: `2px solid ${selectedAccent}`,
                      color: FLOW_THEME.muted,
                      fontStyle: "italic",
                      fontSize: 12.5,
                    }}
                  >
                    &quot;{item.quote}&quot;
                    {typeof item.sourceIndex === "number" ? (
                      <span
                        style={{
                          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
                          fontStyle: "normal",
                          marginLeft: "0.5em",
                          color: selectedAccent,
                        }}
                      >
                        source {item.sourceIndex}
                      </span>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
