import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import ForceGraph2D, { type ForceGraphMethods, type NodeObject } from "react-force-graph-2d";
import IconButton from "@shared/atoms/IconButton/IconButton";

import { buildMindmapGraph, computeVisibleGraph, type MindMapPayload, type MindmapGraphNode } from "./graphAdapter";

/**
 * Placeholder palette — a first pass, not a final design decision.
 * Everything visual lives here so a future palette change is a single edit.
 */
export const MINDMAP_THEME = {
  background: "#0D1B2A",
  link: "rgba(255, 255, 255, 0.25)",
  nodeRoot: "#F4A11B",
  nodeLevel1: "#00B4D8",
  nodeDeepest: "#FFFFFF",
  nodeMaxDepthForGradient: 4,
  radiusRoot: 10,
  radiusLevel1: 7,
  radiusDeepest: 4,
  labelColor: "#E8EEF5",
  labelFont: "Inter, system-ui, sans-serif",
  panelBackground: "rgba(13, 27, 42, 0.92)",
  panelBorder: "rgba(255, 255, 255, 0.12)",
};

function lerpChannel(a: number, b: number, t: number): number {
  return Math.round(a + (b - a) * t);
}

function lerpColor(hexA: string, hexB: string, t: number): string {
  const a = [1, 3, 5].map((i) => parseInt(hexA.slice(i, i + 2), 16));
  const b = [1, 3, 5].map((i) => parseInt(hexB.slice(i, i + 2), 16));
  const mixed = a.map((channel, i) => lerpChannel(channel, b[i], t));
  return `#${mixed.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

function colorForDepth(depth: number): string {
  if (depth <= 0) return MINDMAP_THEME.nodeRoot;
  const t = Math.min(1, (depth - 1) / Math.max(1, MINDMAP_THEME.nodeMaxDepthForGradient - 1));
  return lerpColor(MINDMAP_THEME.nodeLevel1, MINDMAP_THEME.nodeDeepest, t);
}

function radiusForDepth(depth: number): number {
  if (depth <= 0) return MINDMAP_THEME.radiusRoot;
  const t = Math.min(1, (depth - 1) / Math.max(1, MINDMAP_THEME.nodeMaxDepthForGradient - 1));
  return MINDMAP_THEME.radiusLevel1 + (MINDMAP_THEME.radiusDeepest - MINDMAP_THEME.radiusLevel1) * t;
}

function useContainerSize(): [RefObject<HTMLDivElement>, number, number] {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return [containerRef, size.width, size.height];
}

export function MindmapForceGraphBlock({ title, summary, root, presentation }: MindMapPayload) {
  const graph = useMemo(() => buildMindmapGraph(root), [root]);

  const initialDepth = presentation?.initialDepth ?? 2;
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => {
    const ids = new Set<string>();
    for (const node of graph.nodes) {
      if (node.depth === initialDepth && node.childIds.length > 0) {
        ids.add(node.id);
      }
    }
    return ids;
  });
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  const visibleGraph = useMemo(() => computeVisibleGraph(graph, collapsedIds), [graph, collapsedIds]);
  const selectedNode = selectedNodeId ? (graph.nodes.find((node) => node.id === selectedNodeId) ?? null) : null;

  const [containerRef, containerWidth, containerHeight] = useContainerSize();
  const forceGraphRef = useRef<ForceGraphMethods<any, any> | undefined>(undefined);

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(document.fullscreenElement === containerRef.current);
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, [containerRef]);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void containerRef.current?.requestFullscreen();
    }
  };

  const handleNodeClick = useCallback((rawNode: NodeObject, event: MouseEvent) => {
    const node = rawNode as unknown as MindmapGraphNode;
    if (event.detail >= 2 && node.childIds.length > 0) {
      setCollapsedIds((prev) => {
        const next = new Set(prev);
        if (next.has(node.id)) {
          next.delete(node.id);
        } else {
          next.add(node.id);
        }
        return next;
      });
      return;
    }
    setSelectedNodeId(node.id);
    const fg = forceGraphRef.current;
    if (fg && typeof rawNode.x === "number" && typeof rawNode.y === "number") {
      fg.centerAt(rawNode.x, rawNode.y, 800);
      fg.zoom(3, 800);
    }
  }, []);

  return (
    <div
      ref={containerRef}
      style={{
        width: "100%",
        height: isFullscreen ? "100%" : "calc(100vh - 60px)",
        position: "relative",
        overflow: "hidden",
        borderRadius: 8,
        background: MINDMAP_THEME.background,
      }}
    >
      {containerWidth > 0 && containerHeight > 0 && (
        <ForceGraph2D
          ref={forceGraphRef}
          width={containerWidth}
          height={containerHeight}
          graphData={visibleGraph}
          backgroundColor={MINDMAP_THEME.background}
          linkColor={() => MINDMAP_THEME.link}
          minZoom={0.3}
          maxZoom={8}
          onNodeClick={handleNodeClick}
          onBackgroundClick={() => setSelectedNodeId(null)}
          nodeCanvasObject={(rawNode: NodeObject, ctx, globalScale) => {
            const node = rawNode as unknown as MindmapGraphNode;
            const x = rawNode.x ?? 0;
            const y = rawNode.y ?? 0;
            const radius = radiusForDepth(node.depth);

            ctx.beginPath();
            ctx.arc(x, y, radius, 0, 2 * Math.PI);
            ctx.fillStyle = colorForDepth(node.depth);
            ctx.fill();
            if (node.id === selectedNodeId) {
              ctx.lineWidth = 2 / globalScale;
              ctx.strokeStyle = "#FFFFFF";
              ctx.stroke();
            }

            const fontSize = Math.max(10 / globalScale, 3);
            ctx.font = `${fontSize}px ${MINDMAP_THEME.labelFont}`;
            ctx.textAlign = "center";
            ctx.textBaseline = "top";
            ctx.fillStyle = MINDMAP_THEME.labelColor;
            ctx.fillText(node.name, x, y + radius + 2);
          }}
          nodePointerAreaPaint={(rawNode: NodeObject, color, ctx) => {
            const node = rawNode as unknown as MindmapGraphNode;
            const x = rawNode.x ?? 0;
            const y = rawNode.y ?? 0;
            ctx.beginPath();
            ctx.arc(x, y, radiusForDepth(node.depth) + 2, 0, 2 * Math.PI);
            ctx.fillStyle = color;
            ctx.fill();
          }}
        />
      )}

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

      {(title || summary) && (
        <div
          style={{
            position: "absolute",
            top: 8,
            left: 8,
            maxWidth: "60%",
            padding: "6px 10px",
            background: MINDMAP_THEME.panelBackground,
            border: `1px solid ${MINDMAP_THEME.panelBorder}`,
            borderRadius: 6,
            color: MINDMAP_THEME.labelColor,
            fontSize: 13,
            pointerEvents: "none",
          }}
        >
          <strong>{title}</strong>
          {summary && <div style={{ opacity: 0.8, marginTop: 2 }}>{summary}</div>}
        </div>
      )}

      {selectedNode && (
        <div
          style={{
            position: "absolute",
            bottom: 8,
            left: 8,
            right: 8,
            padding: "8px 12px",
            background: MINDMAP_THEME.panelBackground,
            border: `1px solid ${MINDMAP_THEME.panelBorder}`,
            borderRadius: 6,
            color: MINDMAP_THEME.labelColor,
            fontSize: 13,
          }}
        >
          <strong>{selectedNode.name}</strong>
          {selectedNode.summary && <div style={{ marginTop: 4 }}>{selectedNode.summary}</div>}
          {selectedNode.detail && <div style={{ marginTop: 4, opacity: 0.85 }}>{selectedNode.detail}</div>}
          {selectedNode.evidence && selectedNode.evidence.length > 0 && (
            <ul style={{ marginTop: 4, paddingLeft: 18 }}>
              {selectedNode.evidence.map((item, index) => (
                <li key={index}>{item.quote}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
