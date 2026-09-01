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
 * Zumly-style renderer for the mindmap agent payload — dark dashboard theme.
 *
 * Why this exists:
 * - fourth rendering mode, complementary to the Prezi canvas: Zumly's model is
 *   discrete hierarchical zoom navigation ("Z over XY") — one full-frame view
 *   per node, and you dive INTO a clicked element to open the next depth level
 * - the visual grammar mirrors Zumly's showcase dashboards (Mercedes
 *   production line / mission control): dark surface, KPI strip computed from
 *   the subtree, a grid of themed tiles with icon + status badge per child,
 *   and a detail card with a source log on leaves
 *
 * How the depth effect works (mirrors Zumly's engine, verified in its source):
 * - views are stacked layers; on zoom-in the new view opens FROM the clicked
 *   tile (cover scale = view width / trigger width) while the previous view
 *   scales up around the trigger center and stays mounted behind as a depth
 *   layer; blur is applied only once layers settle (see EFFECT_* note)
 */

import { useCallback, useEffect, useRef, useState } from "react";
import IconButton from "@shared/atoms/IconButton/IconButton";
import Icon from "@shared/atoms/Icon/Icon";
import type { MaterialIconType } from "@shared/utils/Type";

import type { MindmapNodeData, Rect } from "../MindmapPreziBlock/preziLayout";
import { pickIcon } from "../MindmapPreziBlock/preziIcons";

const COLORS = {
  bg: "#0e1217",
  panel: "#151b23",
  border: "#2a3139",
  borderHover: "#3d4650",
  text: "#e6edf3",
  secondary: "#7d8590",
  hud: "rgba(21, 27, 35, 0.92)",
};

const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

/** Neon accents on dark, one per level-1 branch, inherited below. */
const DARK_ACCENTS = ["#a371f7", "#f0883e", "#3fb950", "#58a6ff", "#d29922", "#ec6cb9"];

/** Zumly default transition timing. */
const ZOOM_MS = 800;
const EASE = "cubic-bezier(0.4, 0, 0.2, 1)";

/** Default corner and approximate footprint of the draggable fullscreen button. */
const FS_BTN_DEFAULT = { x: 14, y: 12 };
const FS_BTN_SIZE = 40;
/**
 * Background-layer effects, applied AFTER the transform settles, never
 * animated: transitioning `filter` re-rasterizes every frame and stutters on
 * GPU-limited environments (VirtualBox). During motion, depth is conveyed by
 * a cheap opacity-animated dimming veil.
 */
const EFFECT_PREVIOUS = "blur(4px)";
const EFFECT_OLDER = "blur(9px) saturate(0.25)";
const VEIL_PREVIOUS = 0.45;
const VEIL_OLDER = 0.7;

interface StackEntry {
  node: MindmapNodeData;
  /** Trigger rect (container coordinates) this view was opened from. */
  trigger: Rect | null;
  accent: string;
}

interface MindmapZumlyBlockProps {
  title: string;
  summary?: string;
  root: MindmapNodeData;
  /** Rendered height in pixels. */
  height?: number;
}

/** Start transform for a view opening from (or closing into) its trigger. */
function coverTransform(trigger: Rect, cw: number, ch: number): string {
  const scaleInv = trigger.w / cw;
  const tx = trigger.x;
  const ty = trigger.y + (trigger.h - ch * scaleInv) / 2;
  return `translate(${tx}px, ${ty}px) scale(${scaleInv})`;
}

/** Transform pushing a previous view back as an enlarged depth layer. */
function depthTransform(trigger: Rect, cw: number): { transform: string; transformOrigin: string } {
  const scale = cw / Math.max(1, trigger.w);
  return {
    transform: `scale(${Math.min(scale, 4)})`,
    transformOrigin: `${trigger.x + trigger.w / 2}px ${trigger.y + trigger.h / 2}px`,
  };
}

/** Subtree metrics powering the KPI strip and tile badges. */
interface SubtreeStats {
  sections: number;
  points: number;
  depth: number;
  citations: number;
}

function subtreeStats(node: MindmapNodeData): SubtreeStats {
  let points = 0;
  let citations = 0;
  let depth = 1;
  const walk = (n: MindmapNodeData, d: number): void => {
    depth = Math.max(depth, d);
    citations += (n.evidence ?? []).filter((e) => (e.quote ?? "").trim()).length;
    for (const child of n.children ?? []) {
      points += 1;
      walk(child, d + 1);
    }
  };
  walk(node, 1);
  return {
    sections: node.children?.length ?? 0,
    points,
    depth,
    citations,
  };
}

interface BadgeSpec {
  label: string;
  color: string;
}

const GREEN = "#3fb950";
const BLUE = "#58a6ff";
const YELLOW = "#d29922";

/**
 * Status badge, Mercedes-showcase style: semantic keyword detection first
 * (mandatory / recommended / risk vocabulary in FR + EN), falling back to a
 * neutral count of sub-points or citations.
 */
function statusBadge(node: MindmapNodeData): BadgeSpec {
  const haystack = `${node.name} ${node.summary ?? ""} ${node.detail ?? ""}`
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
  if (/obligatoire|mandatory|requis|required|must\b/.test(haystack)) {
    return { label: "OBLIGATOIRE", color: GREEN };
  }
  if (/recommande|recommended|conseille|advised/.test(haystack)) {
    return { label: "RECOMMANDÉ", color: BLUE };
  }
  if (/risque|risk|warning|alerte|danger|vigilance/.test(haystack)) {
    return { label: "RISQUE", color: YELLOW };
  }
  const children = node.children?.length ?? 0;
  if (children > 0) return { label: `${children} POINTS`, color: "#7d8590" };
  const quotes = (node.evidence ?? []).filter((e) => (e.quote ?? "").trim()).length;
  if (quotes > 0) return { label: `${quotes} CITATION${quotes > 1 ? "S" : ""}`, color: GREEN };
  return { label: "DÉTAIL", color: "#7d8590" };
}

function Badge({ spec }: { spec: BadgeSpec }) {
  return (
    <span
      style={{
        display: "inline-block",
        fontSize: 9.5,
        fontFamily: MONO,
        letterSpacing: "0.06em",
        padding: "2.5px 8px",
        borderRadius: 10,
        color: spec.color,
        background: `${spec.color}1a`,
        border: `1px solid ${spec.color}44`,
        whiteSpace: "nowrap",
      }}
    >
      {spec.label}
    </span>
  );
}

function MonoLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 10.5,
        letterSpacing: "0.14em",
        color: COLORS.secondary,
        fontFamily: MONO,
        textTransform: "uppercase",
      }}
    >
      {children}
    </div>
  );
}

function Kpi({ label, value, color }: { label: string; value: number | string; color?: string }) {
  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        background: COLORS.panel,
        border: `1px solid ${COLORS.border}`,
        borderRadius: 9,
        padding: "10px 14px",
      }}
    >
      <MonoLabel>{label}</MonoLabel>
      <div
        style={{
          fontSize: 20,
          fontWeight: 600,
          color: color ?? COLORS.text,
          marginTop: 3,
        }}
      >
        {value}
      </div>
    </div>
  );
}

/**
 * One full-frame dashboard view: header + KPI strip + tile grid for branch
 * nodes; header + summary/detail panels + source log for leaves.
 */
function ZumlyView({
  entry,
  isRoot,
  isTop,
  onDive,
}: {
  entry: StackEntry;
  isRoot: boolean;
  isTop: boolean;
  onDive: (node: MindmapNodeData, accent: string, e: React.MouseEvent<HTMLElement>) => void;
}) {
  const { node, accent } = entry;
  const children = node.children ?? [];
  const stats = subtreeStats(node);
  const badge = statusBadge(node);
  const quotes = (node.evidence ?? []).filter((e) => (e.quote ?? "").trim());
  const initials = node.name
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 3)
    .join("")
    .toUpperCase();

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        background: COLORS.bg,
        color: COLORS.text,
        display: "flex",
        flexDirection: "column",
        padding: "24px 26px",
        overflow: "hidden",
        fontFamily: '"Segoe UI", system-ui, sans-serif',
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
        {isRoot ? (
          <div
            style={{
              width: 38,
              height: 38,
              borderRadius: "50%",
              border: `1.5px solid ${COLORS.borderHover}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 11,
              fontWeight: 600,
              flex: "none",
            }}
          >
            {initials}
          </div>
        ) : (
          <span style={{ color: accent, flex: "none", fontSize: 24 }}>
            <Icon category="outlined" type={pickIcon(node.name, node.summary) as MaterialIconType} />
          </span>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: 17,
              fontWeight: 600,
              lineHeight: 1.2,
              display: "-webkit-box",
              WebkitLineClamp: 1,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {node.name}
          </div>
          {node.summary ? (
            <div
              style={{
                fontSize: 11.5,
                color: COLORS.secondary,
                marginTop: 2,
                display: "-webkit-box",
                WebkitLineClamp: 1,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {node.summary}
            </div>
          ) : null}
        </div>
        <Badge spec={badge} />
      </div>

      {children.length > 0 ? (
        <>
          <div style={{ display: "flex", gap: 10, marginBottom: 16 }}>
            <Kpi label="Sections" value={stats.sections} color={accent} />
            <Kpi label="Points" value={stats.points} />
            <Kpi label="Profondeur" value={stats.depth} />
            <Kpi label="Citations" value={stats.citations} color={GREEN} />
          </div>
          <div
            style={{
              flex: 1,
              minHeight: 0,
              overflowY: "auto",
              display: "grid",
              gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
              gap: 10,
              alignContent: "start",
              paddingBottom: 8,
            }}
          >
            {children.map((child, i) => {
              const childAccent = isRoot ? DARK_ACCENTS[i % DARK_ACCENTS.length] : accent;
              const childBadge = statusBadge(child);
              return (
                <div
                  key={child.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (isTop) onDive(child, childAccent, e);
                  }}
                  style={{
                    background: COLORS.panel,
                    border: `1px solid ${COLORS.border}`,
                    borderRadius: 10,
                    padding: "16px 12px 12px",
                    textAlign: "center",
                    cursor: "pointer",
                    transition: "border-color 0.15s ease, transform 0.15s ease",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = COLORS.borderHover;
                    e.currentTarget.style.transform = "translateY(-2px)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = COLORS.border;
                    e.currentTarget.style.transform = "none";
                  }}
                >
                  <div style={{ color: childAccent, fontSize: 26 }}>
                    <Icon category="outlined" type={pickIcon(child.name, child.summary) as MaterialIconType} />
                  </div>
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      marginTop: 8,
                      lineHeight: 1.25,
                      display: "-webkit-box",
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical",
                      overflow: "hidden",
                    }}
                  >
                    {child.name}
                  </div>
                  {child.summary ? (
                    <div
                      style={{
                        fontSize: 10,
                        color: COLORS.secondary,
                        marginTop: 2,
                        display: "-webkit-box",
                        WebkitLineClamp: 1,
                        WebkitBoxOrient: "vertical",
                        overflow: "hidden",
                      }}
                    >
                      {child.summary}
                    </div>
                  ) : null}
                  <div style={{ marginTop: 8 }}>
                    <Badge spec={childBadge} />
                  </div>
                </div>
              );
            })}
          </div>
        </>
      ) : (
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflowY: "auto",
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: node.detail ? "1fr 1fr" : "1fr",
              gap: 10,
            }}
          >
            {node.summary ? (
              <div
                style={{
                  background: COLORS.panel,
                  border: `1px solid ${COLORS.border}`,
                  borderRadius: 10,
                  padding: "14px 16px",
                }}
              >
                <MonoLabel>Résumé</MonoLabel>
                <div style={{ fontSize: 12.5, lineHeight: 1.55, marginTop: 7 }}>{node.summary}</div>
              </div>
            ) : null}
            {node.detail ? (
              <div
                style={{
                  background: COLORS.panel,
                  border: `1px solid ${COLORS.border}`,
                  borderRadius: 10,
                  padding: "14px 16px",
                }}
              >
                <MonoLabel>Détail</MonoLabel>
                <div style={{ fontSize: 12.5, lineHeight: 1.55, marginTop: 7 }}>{node.detail}</div>
              </div>
            ) : null}
          </div>
          {quotes.length > 0 ? (
            <div
              style={{
                background: COLORS.panel,
                border: `1px solid ${COLORS.border}`,
                borderRadius: 10,
                padding: "14px 16px",
              }}
            >
              <MonoLabel>Sources</MonoLabel>
              <div
                style={{
                  fontFamily: MONO,
                  fontSize: 11,
                  lineHeight: 1.9,
                  marginTop: 8,
                }}
              >
                {quotes.map((item, index) => (
                  <div key={index}>
                    <span style={{ color: GREEN }}>source {item.sourceIndex ?? "?"}</span>
                    <span style={{ color: COLORS.secondary }}>
                      {"  "}&quot;{item.quote}&quot;
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

/**
 * A leaving (zoom-out) layer: mounts at identity, then animates back into the
 * trigger rect it originally opened from, and fades.
 */
function LeavingLayer({ entry, cw, ch }: { entry: StackEntry; cw: number; ch: number }) {
  const [gone, setGone] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setGone(true)));
    return () => cancelAnimationFrame(id);
  }, []);
  const target = entry.trigger ? coverTransform(entry.trigger, cw, ch) : "scale(0.6)";
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 40,
        transformOrigin: "0 0",
        willChange: "transform, opacity",
        transform: gone ? target : "none",
        opacity: gone ? 0 : 1,
        transition: `transform ${ZOOM_MS}ms ${EASE}, opacity ${ZOOM_MS}ms ${EASE}`,
        pointerEvents: "none",
      }}
    >
      <ZumlyView entry={entry} isRoot={false} isTop={false} onDive={() => undefined} />
    </div>
  );
}

export function MindmapZumlyBlock({ title, summary, root, height = 640 }: MindmapZumlyBlockProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [stack, setStack] = useState<StackEntry[]>([{ node: root, trigger: null, accent: DARK_ACCENTS[0] }]);
  const [entering, setEntering] = useState(false);
  const [leaving, setLeaving] = useState<StackEntry | null>(null);
  const [animating, setAnimating] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const leaveTimer = useRef<number | null>(null);
  const animTimer = useRef<number | null>(null);

  const markAnimating = useCallback(() => {
    setAnimating(true);
    if (animTimer.current) window.clearTimeout(animTimer.current);
    animTimer.current = window.setTimeout(() => setAnimating(false), ZOOM_MS + 40);
  }, []);

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

  // Draggable fullscreen button: its default corner can end up sitting over
  // content at some zoom level, so it can be dragged out of the way instead
  // of being pinned there. `fsPos` is null until first dragged (default
  // corner); positions are clamped to the container so a resize can't strand
  // it off-screen.
  const [fsPos, setFsPos] = useState<{ x: number; y: number } | null>(null);
  const [fsDragging, setFsDragging] = useState(false);
  const fsDrag = useRef<{ startX: number; startY: number; baseX: number; baseY: number } | null>(null);
  const fsJustDragged = useRef(false);

  const onFsPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const base = fsPos ?? FS_BTN_DEFAULT;
      fsDrag.current = { startX: e.clientX, startY: e.clientY, baseX: base.x, baseY: base.y };
      setFsDragging(true);
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [fsPos],
  );

  const onFsPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const drag = fsDrag.current;
    const container = containerRef.current;
    if (!drag || !container) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (!fsJustDragged.current && Math.hypot(dx, dy) < 4) return;
    fsJustDragged.current = true;
    const rect = container.getBoundingClientRect();
    const maxX = Math.max(0, rect.width - FS_BTN_SIZE);
    const maxY = Math.max(0, rect.height - FS_BTN_SIZE);
    setFsPos({
      x: Math.min(Math.max(0, drag.baseX + dx), maxX),
      y: Math.min(Math.max(0, drag.baseY + dy), maxY),
    });
  }, []);

  const onFsPointerUp = useCallback(() => {
    fsDrag.current = null;
    setFsDragging(false);
  }, []);

  const onFsClick = useCallback(() => {
    if (fsJustDragged.current) {
      fsJustDragged.current = false;
      return;
    }
    toggleFullscreen();
  }, []);

  useEffect(() => {
    setStack([{ node: root, trigger: null, accent: DARK_ACCENTS[0] }]);
  }, [root]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const measure = () => setSize({ w: container.clientWidth, h: container.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Keep a dragged button on-screen if the container is resized afterwards.
  // Guarded so it only writes when clamping actually changes something —
  // otherwise this and the effect's own `fsPos` dependency would loop forever.
  useEffect(() => {
    if (!fsPos || size.w === 0) return;
    const maxX = Math.max(0, size.w - FS_BTN_SIZE);
    const maxY = Math.max(0, size.h - FS_BTN_SIZE);
    const clampedX = Math.min(fsPos.x, maxX);
    const clampedY = Math.min(fsPos.y, maxY);
    if (clampedX !== fsPos.x || clampedY !== fsPos.y) {
      setFsPos({ x: clampedX, y: clampedY });
    }
  }, [size, fsPos]);

  useEffect(() => {
    if (!entering) return;
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setEntering(false)));
    return () => cancelAnimationFrame(id);
  }, [entering]);

  const dive = useCallback(
    (node: MindmapNodeData, accent: string, e: React.MouseEvent<HTMLElement>) => {
      const container = containerRef.current;
      if (!container || leaving) return;
      const cRect = container.getBoundingClientRect();
      const tRect = e.currentTarget.getBoundingClientRect();
      const trigger: Rect = {
        x: tRect.left - cRect.left,
        y: tRect.top - cRect.top,
        w: tRect.width,
        h: tRect.height,
      };
      setStack((s) => [...s, { node, trigger, accent }]);
      setEntering(true);
      markAnimating();
    },
    [leaving, markAnimating],
  );

  const back = useCallback(() => {
    if (stack.length < 2 || leaving) return;
    const top = stack[stack.length - 1];
    setLeaving(top);
    setStack((s) => s.slice(0, -1));
    markAnimating();
    if (leaveTimer.current) window.clearTimeout(leaveTimer.current);
    leaveTimer.current = window.setTimeout(() => setLeaving(null), ZOOM_MS + 60);
  }, [stack, leaving, markAnimating]);

  useEffect(
    () => () => {
      if (leaveTimer.current) window.clearTimeout(leaveTimer.current);
      if (animTimer.current) window.clearTimeout(animTimer.current);
    },
    [],
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape" || event.key === "Backspace") {
        event.preventDefault();
        back();
      }
    },
    [back],
  );

  const topIndex = stack.length - 1;
  const breadcrumb = [title, ...stack.slice(1).map((s) => s.node.name)].join("  /  ");
  void summary;

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      style={{
        position: "relative",
        height: isFullscreen ? "100%" : height,
        overflow: "hidden",
        contain: "layout paint",
        background: COLORS.bg,
        borderRadius: 12,
        outline: "none",
        fontFamily: '"Segoe UI", system-ui, sans-serif',
      }}
    >
      <div
        onPointerDown={onFsPointerDown}
        onPointerMove={onFsPointerMove}
        onPointerUp={onFsPointerUp}
        // The click handler lives here, not on the inner button: setPointerCapture
        // above redirects the resulting click's target to this div, so a handler
        // on the button itself would never fire.
        onClick={onFsClick}
        style={{
          position: "absolute",
          top: (fsPos ?? FS_BTN_DEFAULT).y,
          left: (fsPos ?? FS_BTN_DEFAULT).x,
          zIndex: 1000,
          cursor: fsDragging ? "grabbing" : "grab",
          touchAction: "none",
        }}
      >
        <IconButton
          type="button"
          color="primary"
          variant="filled"
          size="medium"
          icon={{ category: "outlined", type: isFullscreen ? "fullscreen_exit" : "fullscreen" }}
          aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
          title="Glisser pour déplacer, cliquer pour le plein écran"
        />
      </div>
      {stack.map((entry, index) => {
        const depthBelow = topIndex - index;
        if (depthBelow > 2) return null;
        const isTop = depthBelow === 0;
        let style: React.CSSProperties = {
          position: "absolute",
          inset: 0,
          zIndex: 10 + index,
          transformOrigin: "0 0",
          willChange: "transform",
          transition: `transform ${ZOOM_MS}ms ${EASE}, opacity ${ZOOM_MS}ms ${EASE}`,
        };
        let veil = 0;
        if (isTop) {
          const start =
            entering && entry.trigger && size.w > 0 ? coverTransform(entry.trigger, size.w, size.h) : "none";
          style = { ...style, transform: start, filter: "none" };
        } else {
          const successor = stack[index + 1];
          const pushed =
            successor?.trigger && size.w > 0
              ? depthTransform(successor.trigger, size.w)
              : { transform: "scale(1.4)", transformOrigin: "50% 50%" };
          veil = depthBelow === 1 ? VEIL_PREVIOUS : VEIL_OLDER;
          style = {
            ...style,
            ...pushed,
            filter: animating ? "none" : depthBelow === 1 ? EFFECT_PREVIOUS : EFFECT_OLDER,
            pointerEvents: "none",
          };
        }
        return (
          <div key={`${entry.node.id}-${index}`} style={style}>
            <ZumlyView entry={entry} isRoot={index === 0} isTop={isTop && !entering} onDive={dive} />
            <div
              aria-hidden="true"
              style={{
                position: "absolute",
                inset: 0,
                background: COLORS.bg,
                opacity: veil,
                transition: `opacity ${ZOOM_MS}ms ${EASE}`,
                pointerEvents: "none",
              }}
            />
          </div>
        );
      })}

      {leaving && size.w > 0 ? <LeavingLayer entry={leaving} cw={size.w} ch={size.h} /> : null}

      <div
        style={{
          position: "absolute",
          top: 12,
          right: 14,
          maxWidth: "60%",
          zIndex: 50,
          fontSize: 11,
          fontFamily: MONO,
          color: COLORS.secondary,
          background: COLORS.hud,
          border: `1px solid ${COLORS.border}`,
          borderRadius: 7,
          padding: "5px 10px",
          overflow: "hidden",
          whiteSpace: "nowrap",
          textOverflow: "ellipsis",
        }}
      >
        {breadcrumb}
      </div>

      {stack.length > 1 ? (
        <button
          type="button"
          onClick={back}
          aria-label="Niveau précédent"
          style={{
            position: "absolute",
            bottom: 16,
            left: 16,
            zIndex: 50,
            width: 42,
            height: 42,
            borderRadius: "50%",
            border: `1px solid ${COLORS.border}`,
            background: COLORS.hud,
            color: COLORS.text,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 20,
          }}
        >
          <Icon category="outlined" type="arrow_back" />
        </button>
      ) : null}
    </div>
  );
}
