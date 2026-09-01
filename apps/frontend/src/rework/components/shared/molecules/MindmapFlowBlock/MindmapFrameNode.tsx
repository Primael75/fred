import { Handle, Position } from "@xyflow/react";
import IconButton from "@shared/atoms/IconButton/IconButton";
import Icon from "@shared/atoms/Icon/Icon";
import type { MaterialIconType } from "@shared/utils/Type";
import { NODE_WIDTH, NODE_HEIGHT } from "../MindmapForceGraphBlock/dagreLayout";

/**
 * Dark palette local to the Flow renderer, aligned with the Prezi and Zumly
 * blocks. Deliberately NOT folded into MINDMAP_THEME: that constant is shared
 * with the force-graph block, which keeps its own look.
 */
export const FLOW_THEME = {
  canvas: "#0e1217",
  node: "#151b23",
  nodeRoot: "#1b222c",
  border: "#262d36",
  borderStrong: "#3d4650",
  title: "#e6edf3",
  muted: "#7d8590",
  body: "#c9d1d9",
  panel: "rgba(21, 27, 35, 0.94)",
};

export type MindmapFrameData = {
  name: string;
  depth: number;
  hasChildren: boolean;
  isCollapsed: boolean;
  isSelected: boolean;
  /** Branch accent, inherited from the level-1 ancestor. */
  accent: string;
  /** Material Symbols ligature for this node's theme. */
  icon: MaterialIconType;
  /** Only the root carries one (counts); other nodes stay compact. */
  subtitle?: string;
  onToggleCollapse: () => void;
};

export function MindmapFrameNode({ data }: { data: MindmapFrameData }) {
  const { name, depth, hasChildren, isCollapsed, isSelected, accent, icon, subtitle, onToggleCollapse } = data;
  const isRoot = depth <= 0;

  return (
    <div
      style={{
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
        boxSizing: "border-box",
        display: "flex",
        alignItems: "stretch",
        borderRadius: 10,
        overflow: "hidden",
        background: isRoot ? FLOW_THEME.nodeRoot : FLOW_THEME.node,
        border: `1px solid ${isSelected ? accent : FLOW_THEME.border}`,
        boxShadow: isSelected ? `0 0 0 1px ${accent}, 0 4px 16px rgba(0, 0, 0, 0.5)` : "0 4px 16px rgba(0, 0, 0, 0.45)",
        color: FLOW_THEME.title,
        position: "relative",
      }}
    >
      <Handle type="target" position={Position.Left} />
      {/* Accent rail replaces the old colored left border so the radius stays clean. */}
      <div style={{ width: 3, flex: "none", background: accent }} />
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          alignItems: "center",
          gap: 9,
          padding: "0 10px",
        }}
      >
        <span aria-hidden="true" style={{ fontSize: 18, lineHeight: 1, color: accent, flex: "none" }}>
          <Icon category="outlined" type={icon} />
        </span>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              fontSize: 12.5,
              fontWeight: 600,
              lineHeight: 1.25,
              // Two lines instead of a single ellipsized one: titles like
              // "Développement et Qualité Continue" were unreadable truncated.
              display: "-webkit-box",
              WebkitLineClamp: subtitle ? 1 : 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {name}
          </div>
          {subtitle ? (
            <div
              style={{
                fontSize: 10.5,
                color: FLOW_THEME.muted,
                lineHeight: 1.35,
                marginTop: 2,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {subtitle}
            </div>
          ) : null}
        </div>
        {hasChildren && (
          <IconButton
            type="button"
            color="primary"
            variant="icon"
            size="xs"
            icon={{ category: "outlined", type: isCollapsed ? "add" : "remove" }}
            onClick={(event) => {
              event.stopPropagation();
              onToggleCollapse();
            }}
            aria-label={isCollapsed ? `Expand ${name}` : `Collapse ${name}`}
            title={isCollapsed ? "Expand" : "Collapse"}
            style={{ flexShrink: 0 }}
          />
        )}
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
