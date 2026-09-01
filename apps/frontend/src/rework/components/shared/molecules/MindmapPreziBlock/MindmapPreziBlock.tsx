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
 * Prezi-style renderer for the mindmap agent payload — dark theme.
 *
 * Why this exists:
 * - third rendering mode for `synthia.mindmap.agent`, alongside the React
 *   Flow tree and the force graph: an overview canvas with a theme image at
 *   the center, cards for level-1 topics laid organically around it, and a
 *   continuous camera that flies into any card down to slide-like leaves
 *
 * How it works:
 * - `preziLayout.buildLayout` positions every node once, in absolute world
 *   coordinates (the frame list is also the depth-first presentation path)
 * - `preziCamera` flies a single persistent world element between frames;
 *   nothing in the DOM is ever swapped during navigation
 * - navigation: previous/next follow the depth-first path, clicking any card
 *   jumps straight to it, Escape returns to the overview
 *
 * Visual language (shared with the Zumly renderer so both dark modes match):
 * - dark surfaces, neon accent per branch shown as a thin left rail (no
 *   colored header band), depth carried by drop shadows rather than color
 * - photos always get a brightness/contrast boost — stock images are usually
 *   under-exposed and vanish against a dark canvas — and are darkened only by
 *   a DIRECTIONAL gradient behind the text, never a uniform veil
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import IconButton from "@shared/atoms/IconButton/IconButton";
import Icon from "@shared/atoms/Icon/Icon";
import type { MaterialIconType } from "@shared/utils/Type";

import { CENTER_STAGE, WORLD, buildLayout, cardRegions } from "./preziLayout";
import type { Frame, MindmapNodeData, MindmapPayloadData } from "./preziLayout";
import { cameraForRect, cameraTransform, flyTo } from "./preziCamera";
import type { Camera } from "./preziCamera";
import { pickIcon, renderMode } from "./preziIcons";
import type { RenderMode } from "./preziIcons";

const COLORS = {
  canvas: "#0e1217",
  card: "#151b23",
  cardBorder: "#262d36",
  title: "#e6edf3",
  body: "#c9d1d9",
  muted: "#8b949e",
  quote: "#7d8590",
  hudBg: "rgba(21, 27, 35, 0.92)",
};

const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
/** Lifts under-exposed stock photos so they stay readable on the dark canvas. */
const IMAGE_BOOST = "brightness(1.15) contrast(1.05) saturate(1.1)";
/** Left accent rail width, as a fraction of card width. */
const RAIL_RATIO = 0.014;

/**
 * Local authoring width for card content. Every card lays its content out in
 * this fixed coordinate space and is then scaled to its world rect, exactly
 * like a Prezi frame.
 *
 * Why this matters: world rects shrink with depth (a deep leaf can be ~20px
 * wide). Deriving font sizes from the world rect meant composing text at
 * sub-pixel sizes, which the browser renders illegibly — and the camera then
 * magnified that broken raster. Authoring at a constant 1000-unit width keeps
 * every card's text laid out at readable sizes, crisp at any zoom, and makes
 * all cards rigorously identical in proportion whatever their depth.
 */
const CARD_UNIT = 1000;

interface MindmapPreziBlockProps {
  title: string;
  summary?: string;
  root: MindmapNodeData;
  presentation?: MindmapPayloadData["presentation"];
  /** Rendered height in pixels. */
  height?: number;
}

/** Stagger between successive siblings appearing, in milliseconds. */
const APPEAR_STAGGER = 110;

/**
 * Cards author their own `transform` (CARD_UNIT scale) — `useAppear` can't
 * hand back a `transform` of its own without a caller silently clobbering
 * that scale via `...appear`. `riseY` is the local-space rise offset the
 * card composes into its single `transform` string itself; `style` carries
 * only opacity/transition, safe to spread as-is.
 */
interface Appear {
  style: React.CSSProperties;
  riseY: number;
}

/**
 * Fade + rise a card in on mount, after `delay` ms. Cards unmount when culled
 * and remount when their parent is focused again, so the cascade replays each
 * time you zoom into a card.
 */
function useAppear(delay: number): Appear {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, []);
  return {
    style: {
      opacity: shown ? 1 : 0,
      transition: `opacity 0.4s ease ${delay}ms, transform 0.4s ease ${delay}ms`,
    },
    riseY: shown ? 0 : 8,
  };
}

/** Thin accent rail down the card's left edge, replacing the colored header. */
function Rail({ accent, width }: { accent: string; width: number }) {
  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        bottom: 0,
        width,
        background: accent,
        pointerEvents: "none",
      }}
    />
  );
}

/** Uppercase monospace section label (Sources, …). */
function MonoLabel({ children, size }: { children: React.ReactNode; size: number }) {
  return (
    <div
      style={{
        fontSize: size,
        fontFamily: MONO,
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        color: COLORS.quote,
      }}
    >
      {children}
    </div>
  );
}

/** Evidence quotes, rendered identically wherever a leaf shows its sources. */
function SourceList({ frame, fontSize, limit }: { frame: Frame; fontSize: number; limit: number }) {
  const quotes = (frame.node.evidence ?? []).filter((item) => (item.quote ?? "").trim());
  if (quotes.length === 0) return null;
  return (
    <div>
      <MonoLabel size={fontSize * 0.8}>Sources</MonoLabel>
      <div style={{ marginTop: fontSize * 0.4 }}>
        {quotes.slice(0, limit).map((item, index) => (
          <div
            key={index}
            style={{
              borderLeft: `${fontSize * 0.14}px solid ${frame.accent}`,
              paddingLeft: fontSize * 0.7,
              marginTop: index === 0 ? 0 : fontSize * 0.5,
              color: COLORS.quote,
              fontStyle: "italic",
              lineHeight: 1.45,
              display: "-webkit-box",
              WebkitLineClamp: 3,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            &quot;{item.quote}&quot;
            {typeof item.sourceIndex === "number" ? (
              <span
                style={{
                  fontFamily: MONO,
                  fontStyle: "normal",
                  color: frame.accent,
                  marginLeft: "0.5em",
                }}
              >
                source {item.sourceIndex}
              </span>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Compact "icon point": a short leaf enumerated inside its parent, rendered as
 * an accent-tinted icon chip plus title and one line — no card box, so it sits
 * lightly on the parent card surface (mirrors the Prezi bullet-with-icon look).
 */
function PointCard({ frame, appear, onSelect }: { frame: Frame; appear: Appear; onSelect: (frame: Frame) => void }) {
  const { rect, node, accent } = frame;
  // Same fixed local authoring space as CardShell — see CARD_UNIT.
  const unitScale = rect.w / CARD_UNIT;
  const localH = rect.h / unitScale;
  const fontSize = Math.min(CARD_UNIT * 0.075, localH * 0.3);
  const chip = fontSize * 1.9;
  const line = (node.summary ?? node.detail ?? "").trim();
  const iconName = pickIcon(node.name, node.summary) as MaterialIconType;
  return (
    <div
      onClick={(event) => {
        event.stopPropagation();
        onSelect(frame);
      }}
      style={{
        position: "absolute",
        left: rect.x,
        top: rect.y,
        width: CARD_UNIT,
        height: localH,
        transform: `scale(${unitScale}) translateY(${appear.riseY}px)`,
        transformOrigin: "0 0",
        display: "flex",
        alignItems: "center",
        gap: chip * 0.32,
        padding: `${localH * 0.08}px ${CARD_UNIT * 0.05}px`,
        cursor: "pointer",
        overflow: "hidden",
        ...appear.style,
      }}
    >
      <div
        style={{
          flex: "none",
          width: chip,
          height: chip,
          borderRadius: chip * 0.28,
          background: `${accent}1f`,
          border: `1px solid ${accent}55`,
          color: accent,
          fontSize: chip * 0.58,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Icon category="outlined" type={iconName} />
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div
          style={{
            fontSize,
            fontWeight: 600,
            color: COLORS.title,
            lineHeight: 1.2,
            whiteSpace: "normal",
            overflowWrap: "break-word",
          }}
        >
          {node.name}
        </div>
        {line ? (
          <div
            style={{
              marginTop: chip * 0.12,
              fontSize: fontSize * 0.7,
              color: COLORS.muted,
              lineHeight: 1.45,
              display: "-webkit-box",
              WebkitLineClamp: 3,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {line}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The one card anatomy, used at every depth so the zoom stays visually
 * continuous: full-bleed photo background, directional gradient that is
 * opaque behind the text column and clear over the visible half of the photo,
 * accent rail on the left edge, title at the top of the text column, and the
 * region below it left free for children (branch) or filled with summary /
 * detail / sources (leaf).
 */
function CardShell({ frame, appear, onSelect }: { frame: Frame; appear: Appear; onSelect: (frame: Frame) => void }) {
  const { rect, node, accent, depth, isLeaf } = frame;
  const variant = node.imageUrl ? (frame.imageVariant ?? "right") : null;
  // Local space: same aspect ratio as the world rect, constant width.
  const unitScale = rect.w / CARD_UNIT;
  const localH = rect.h / unitScale;
  const reg = cardRegions({ x: 0, y: 0, w: CARD_UNIT, h: localH }, variant);
  const titleFont = Math.min(reg.title.w * 0.1, reg.title.h * 0.44);
  const bodyFont = titleFont * 0.44;
  // Photo visible on the side opposite the text column.
  const fadeDir = variant === "left" ? "270deg" : "90deg";
  return (
    <div
      onClick={(event) => {
        event.stopPropagation();
        onSelect(frame);
      }}
      style={{
        position: "absolute",
        left: rect.x,
        top: rect.y,
        width: CARD_UNIT,
        height: localH,
        transform: `scale(${unitScale}) translateY(${appear.riseY}px)`,
        transformOrigin: "0 0",
        zIndex: depth,
        background: COLORS.card,
        border: `4px solid ${COLORS.cardBorder}`,
        borderRadius: 30,
        overflow: "hidden",
        cursor: "pointer",
        boxShadow: "0 18px 60px rgba(0, 0, 0, 0.55)",
        ...appear.style,
      }}
    >
      {node.imageUrl ? (
        <>
          <img
            src={node.imageUrl}
            alt=""
            aria-hidden="true"
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
              filter: IMAGE_BOOST,
              pointerEvents: "none",
            }}
          />
          <div
            aria-hidden="true"
            style={{
              position: "absolute",
              inset: 0,
              background: `linear-gradient(${fadeDir}, ${COLORS.canvas}f5 0%, ${COLORS.canvas}f0 52%, ${COLORS.canvas}40 100%)`,
              pointerEvents: "none",
            }}
          />
        </>
      ) : null}
      <Rail accent={accent} width={CARD_UNIT * RAIL_RATIO} />
      <div
        style={{
          position: "absolute",
          left: reg.title.x,
          top: reg.title.y,
          width: reg.title.w,
          height: reg.title.h,
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
          fontSize: titleFont,
          fontWeight: 700,
          color: COLORS.title,
          lineHeight: 1.18,
        }}
      >
        {node.name}
      </div>
      {isLeaf ? (
        <div
          style={{
            position: "absolute",
            left: reg.content.x,
            top: reg.content.y,
            width: reg.content.w,
            height: reg.content.h,
            display: "flex",
            flexDirection: "column",
            gap: bodyFont * 0.9,
            fontSize: bodyFont,
            color: COLORS.body,
            lineHeight: 1.5,
            overflow: "hidden",
          }}
        >
          {node.summary ? (
            <div
              style={{
                flex: "none",
                fontStyle: "italic",
                color: COLORS.muted,
                lineHeight: 1.5,
                display: "-webkit-box",
                WebkitLineClamp: 3,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }}
            >
              {node.summary}
            </div>
          ) : null}
          {node.detail ? (
            // Flexible and allowed to shrink (minHeight 0): the detail gives
            // room back to the sources block instead of overflowing under it.
            <div
              style={{
                flex: "1 1 auto",
                minHeight: 0,
                lineHeight: 1.5,
                overflow: "hidden",
              }}
            >
              {node.detail}
            </div>
          ) : null}
          <div style={{ flex: "none" }}>
            <SourceList frame={frame} fontSize={bodyFont} limit={1} />
          </div>
        </div>
      ) : (
        node.summary && (
          <div
            style={{
              position: "absolute",
              left: reg.content.x,
              top: reg.title.y + reg.title.h + bodyFont * 0.3,
              width: reg.content.w,
              fontSize: bodyFont,
              color: COLORS.muted,
              lineHeight: 1.45,
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
              pointerEvents: "none",
            }}
          >
            {node.summary}
          </div>
        )
      )}
    </div>
  );
}

function FrameCard({
  frame,
  mode,
  appearDelay,
  onSelect,
}: {
  frame: Frame;
  /** Display mode, decided per parent so all siblings render alike. */
  mode: RenderMode;
  /** Cascade delay before this card fades in, in ms. */
  appearDelay: number;
  onSelect: (frame: Frame) => void;
}) {
  // One unconditional hook call, before any early return, then handed down.
  const appear = useAppear(appearDelay);
  if (mode === "point") {
    return <PointCard frame={frame} appear={appear} onSelect={onSelect} />;
  }
  return <CardShell frame={frame} appear={appear} onSelect={onSelect} />;
}

/**
 * Central theme illustration: a large evocative image at the canvas center
 * acting as the presentation's visual metaphor, at full opacity with boosted
 * exposure and soft edges fading into the dark canvas. When no image was
 * resolved, falls back to a constellation drawn from the real level-1 topics.
 */
function CenterStage({ payload }: { payload: MindmapPayloadData }) {
  const left = WORLD.w / 2 - CENTER_STAGE.w / 2;
  const top = WORLD.h / 2 - CENTER_STAGE.h / 2;
  const fade = "radial-gradient(ellipse 60% 60% at 50% 50%, black 42%, transparent 94%)";
  if (payload.root.imageUrl) {
    return (
      <img
        src={payload.root.imageUrl}
        alt={payload.title}
        style={{
          position: "absolute",
          left,
          top,
          width: CENTER_STAGE.w,
          height: CENTER_STAGE.h,
          objectFit: "cover",
          borderRadius: 14,
          filter: IMAGE_BOOST,
          WebkitMaskImage: fade,
          maskImage: fade,
          pointerEvents: "none",
          zIndex: 0,
        }}
      />
    );
  }
  const topics = payload.root.children ?? [];
  const n = Math.max(1, topics.length);
  const cx = CENTER_STAGE.w / 2;
  const cy = CENTER_STAGE.h / 2;
  const rx = CENTER_STAGE.w * 0.36;
  const ry = CENTER_STAGE.h * 0.34;
  const points = topics.map((topic, i) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / n;
    return {
      x: cx + rx * Math.cos(angle),
      y: cy + ry * Math.sin(angle),
      r: 12 + ((topic.name.length * 7) % 12),
    };
  });
  return (
    <svg
      width={CENTER_STAGE.w}
      height={CENTER_STAGE.h}
      viewBox={`0 0 ${CENTER_STAGE.w} ${CENTER_STAGE.h}`}
      aria-hidden="true"
      style={{ position: "absolute", left, top, zIndex: 0 }}
    >
      {points.map((p, i) => (
        <line key={`c${i}`} x1={cx} y1={cy} x2={p.x} y2={p.y} stroke="#2f3a46" strokeWidth={4} />
      ))}
      {points.map((p, i) => {
        const next = points[(i + 1) % points.length];
        return points.length > 2 ? (
          <line key={`n${i}`} x1={p.x} y1={p.y} x2={next.x} y2={next.y} stroke="#232c36" strokeWidth={3} />
        ) : null;
      })}
      <circle cx={cx} cy={cy} r={34} fill="#58a6ff" opacity={0.85} />
      {points.map((p, i) => (
        <circle key={`p${i}`} cx={p.x} cy={p.y} r={p.r} fill="#3d4650" stroke="#4b5561" strokeWidth={1.5} />
      ))}
    </svg>
  );
}

export function MindmapPreziBlock({ title, summary, root, presentation, height = 640 }: MindmapPreziBlockProps) {
  const payload = useMemo<MindmapPayloadData>(
    () => ({ title, summary, root, presentation }),
    [title, summary, root, presentation],
  );
  const frames = useMemo(() => buildLayout(payload), [payload]);
  const [index, setIndex] = useState(0);
  // Live container width, so overlay chrome (cover title) scales with the
  // rendered size instead of overwhelming the canvas in the small chat view.
  const [viewWidth, setViewWidth] = useState(0);

  // Zoom-level culling: only mount cards on the focused path.
  const frameById = useMemo(() => {
    const map = new Map<string, Frame>();
    for (const frame of frames) map.set(frame.node.id, frame);
    return map;
  }, [frames]);

  const openIds = useMemo(() => {
    const open = new Set<string>();
    let frame: Frame | undefined = frames[index];
    while (frame) {
      open.add(frame.node.id);
      frame = frame.parentId ? frameById.get(frame.parentId) : undefined;
    }
    return open;
  }, [frames, index, frameById]);

  const isFrameVisible = useCallback(
    (frame: Frame): boolean => {
      if (frame.depth === 0) return false;
      if (frame.depth === 1) return true;
      return frame.parentId != null && openIds.has(frame.parentId);
    },
    [openIds],
  );

  // Card/point choice is made per PARENT, not per node, so a zoomed card's
  // children render uniformly — all sub-cards or all icon points, never a mix.
  const modeByParentId = useMemo(() => {
    const childrenByParent = new Map<string, Frame[]>();
    for (const frame of frames) {
      if (frame.parentId == null) continue;
      const list = childrenByParent.get(frame.parentId);
      if (list) list.push(frame);
      else childrenByParent.set(frame.parentId, [frame]);
    }
    const modes = new Map<string, RenderMode>();
    for (const [parentId, children] of childrenByParent) {
      const allPoints = children.every((child) => renderMode(child.node) === "point");
      modes.set(parentId, allPoints ? "point" : "card");
    }
    return modes;
  }, [frames]);

  const frameMode = useCallback(
    (frame: Frame): RenderMode => {
      if (frame.depth <= 1) return "card";
      return (frame.parentId && modeByParentId.get(frame.parentId)) || "card";
    },
    [modeByParentId],
  );

  const containerRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<HTMLDivElement | null>(null);
  const cameraRef = useRef<Camera>({ cx: WORLD.w / 2, cy: WORLD.h / 2, s: 0.4 });
  const cancelFlightRef = useRef<(() => void) | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

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

  const applyCamera = useCallback((camera: Camera) => {
    cameraRef.current = camera;
    const container = containerRef.current;
    const world = worldRef.current;
    if (!container || !world) return;
    world.style.transform = cameraTransform(camera, container.clientWidth, container.clientHeight);
  }, []);

  const goTo = useCallback(
    (nextIndex: number, animate = true) => {
      const container = containerRef.current;
      if (!container || frames.length === 0) return;
      const clamped = Math.max(0, Math.min(frames.length - 1, nextIndex));
      setIndex(clamped);
      const frame = frames[clamped];
      const target = cameraForRect(
        frame.rect,
        container.clientWidth,
        container.clientHeight,
        frame.depth === 0 ? 0.92 : 0.86,
      );
      cancelFlightRef.current?.();
      if (animate) {
        cancelFlightRef.current = flyTo(cameraRef.current, target, applyCamera);
      } else {
        cancelFlightRef.current = null;
        applyCamera(target);
      }
    },
    [frames, applyCamera],
  );

  const selectFrame = useCallback(
    (frame: Frame) => {
      const frameIndex = frames.indexOf(frame);
      if (frameIndex < 0) return;
      goTo(frameIndex === index ? 0 : frameIndex);
    },
    [frames, index, goTo],
  );

  useEffect(() => {
    goTo(0, false);
    const container = containerRef.current;
    if (!container) return;
    setViewWidth(container.clientWidth);
    const observer = new ResizeObserver(() => {
      setViewWidth(container.clientWidth);
      const frame = frames[index];
      if (!frame) return;
      applyCamera(
        cameraForRect(frame.rect, container.clientWidth, container.clientHeight, frame.depth === 0 ? 0.92 : 0.86),
      );
    });
    observer.observe(container);
    return () => {
      observer.disconnect();
      cancelFlightRef.current?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [frames]);

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "ArrowRight" || event.key === "PageDown") {
        event.preventDefault();
        goTo(index + 1);
      } else if (event.key === "ArrowLeft" || event.key === "PageUp") {
        event.preventDefault();
        goTo(index - 1);
      } else if (event.key === "Escape" || event.key === "Home") {
        event.preventDefault();
        goTo(0);
      }
    },
    [index, goTo],
  );

  const current = frames[index];
  const buttonStyle: React.CSSProperties = {
    font: "inherit",
    fontSize: 12.5,
    padding: "6px 14px",
    border: `1px solid ${COLORS.cardBorder}`,
    background: COLORS.card,
    color: COLORS.title,
    borderRadius: 7,
    cursor: "pointer",
  };

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onDoubleClick={() => goTo(0)}
      style={{
        position: "relative",
        height: isFullscreen ? "100%" : height,
        overflow: "hidden",
        background: COLORS.canvas,
        borderRadius: 12,
        outline: "none",
        fontFamily: '"Segoe UI", system-ui, sans-serif',
      }}
    >
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
      <div
        ref={worldRef}
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: WORLD.w,
          height: WORLD.h,
          transformOrigin: "0 0",
          willChange: "transform",
        }}
      >
        <CenterStage payload={payload} />
        {(() => {
          // Cascade order: each visible card's rank among its visible siblings.
          const visible = frames.filter(isFrameVisible);
          const rankPerParent = new Map<string, number>();
          return visible.map((frame) => {
            const key = frame.parentId ?? "root";
            const rank = rankPerParent.get(key) ?? 0;
            rankPerParent.set(key, rank + 1);
            return (
              <FrameCard
                key={frame.node.id}
                frame={frame}
                mode={frameMode(frame)}
                appearDelay={rank * APPEAR_STAGGER}
                onSelect={selectFrame}
              />
            );
          });
        })()}
      </div>

      <div
        style={{
          position: "absolute",
          left: Math.max(14, viewWidth * 0.018),
          bottom: Math.max(52, viewWidth * 0.05),
          maxWidth: "44%",
          opacity: index === 0 ? 1 : 0,
          transition: "opacity 0.45s ease",
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            fontSize: Math.max(15, Math.min(36, viewWidth * 0.024)),
            fontWeight: 700,
            color: COLORS.title,
            lineHeight: 1.08,
          }}
        >
          {payload.title}
        </div>
        {payload.summary && viewWidth > 520 ? (
          <div
            style={{
              marginTop: 6,
              fontSize: Math.max(11, Math.min(14, viewWidth * 0.0095)),
              color: COLORS.muted,
              lineHeight: 1.45,
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {payload.summary}
          </div>
        ) : null}
      </div>

      <div
        style={{
          position: "absolute",
          top: 14,
          left: 16,
          maxWidth: "60%",
          fontSize: 11.5,
          fontFamily: MONO,
          color: COLORS.quote,
          background: COLORS.hudBg,
          border: `1px solid ${COLORS.cardBorder}`,
          borderRadius: 8,
          padding: "5px 11px",
          overflow: "hidden",
          whiteSpace: "nowrap",
          textOverflow: "ellipsis",
        }}
      >
        {current ? current.path.join("  /  ") : ""}
      </div>

      <div
        style={{
          position: "absolute",
          bottom: 16,
          left: "50%",
          transform: "translateX(-50%)",
          display: "flex",
          gap: 8,
          alignItems: "center",
          background: COLORS.hudBg,
          border: `1px solid ${COLORS.cardBorder}`,
          borderRadius: 10,
          padding: "8px 12px",
        }}
      >
        <button type="button" style={buttonStyle} onClick={() => goTo(index - 1)}>
          {"<- Précédent"}
        </button>
        <span
          style={{
            fontSize: 12,
            fontFamily: MONO,
            color: COLORS.quote,
            minWidth: 52,
            textAlign: "center",
          }}
        >
          {index + 1} / {frames.length}
        </span>
        <button type="button" style={buttonStyle} onClick={() => goTo(index + 1)}>
          {"Suivant ->"}
        </button>
        <button type="button" style={buttonStyle} onClick={() => goTo(0)}>
          Vue d&apos;ensemble
        </button>
      </div>
    </div>
  );
}
