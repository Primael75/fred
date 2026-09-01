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
 * Continuous camera engine for the Prezi-style mindmap renderer.
 *
 * Why this exists:
 * - the defining trait of a Prezi-like experience is a single persistent DOM
 *   "world" that is never swapped: the camera only translates and scales it
 * - unlike view-swap approaches (including Zumly's), this lets the camera fly
 *   from any frame to any other frame in one continuous motion, with
 *   neighboring content visibly sliding in and out of the viewport
 *
 * How it works:
 * - a camera is `{cx, cy, s}`: the world point at the viewport center plus a
 *   zoom scale; `cameraForRect` derives it from any target rectangle, which
 *   is how "frame size controls zoom intensity" falls out for free
 * - `flyTo` interpolates the center linearly and the scale in log space
 *   (perceptually uniform zoom), driven by requestAnimationFrame
 */

import type { Rect } from "./preziLayout";

export interface Camera {
  /** World x of the point shown at the viewport center. */
  cx: number;
  /** World y of the point shown at the viewport center. */
  cy: number;
  /** Zoom scale (world pixels to screen pixels). */
  s: number;
}

/** Camera that frames `rect` inside a viewport of `vw` x `vh` pixels. */
export function cameraForRect(rect: Rect, vw: number, vh: number, fill = 0.86): Camera {
  const s = Math.min(vw / rect.w, vh / rect.h) * fill;
  return { cx: rect.x + rect.w / 2, cy: rect.y + rect.h / 2, s };
}

/** CSS transform to apply on the world element (transform-origin: 0 0). */
export function cameraTransform(camera: Camera, vw: number, vh: number): string {
  const tx = vw / 2 - camera.cx * camera.s;
  const ty = vh / 2 - camera.cy * camera.s;
  return `translate(${tx}px, ${ty}px) scale(${camera.s})`;
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * Animate from one camera to another. Returns a cancel function; callers must
 * cancel any in-flight animation before starting a new one.
 */
export function flyTo(from: Camera, to: Camera, apply: (camera: Camera) => void, durationMs = 950): () => void {
  const start = performance.now();
  const logS0 = Math.log(from.s);
  const logS1 = Math.log(to.s);
  let rafId = 0;
  const step = (now: number): void => {
    const t = Math.min(1, (now - start) / durationMs);
    const k = easeInOutCubic(t);
    apply({
      cx: from.cx + (to.cx - from.cx) * k,
      cy: from.cy + (to.cy - from.cy) * k,
      s: Math.exp(logS0 + (logS1 - logS0) * k),
    });
    if (t < 1) rafId = requestAnimationFrame(step);
  };
  rafId = requestAnimationFrame(step);
  return () => cancelAnimationFrame(rafId);
}
