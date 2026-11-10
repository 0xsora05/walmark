export interface Pt {
  x: number;
  y: number;
}

export function dist(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function pathLength(pts: Pt[]): number {
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += dist(pts[i - 1], pts[i]);
  return len;
}

export function bbox(pts: Pt[]): { minX: number; minY: number; maxX: number; maxY: number; w: number; h: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

export type StrokeVerdict = { ok: true } | { ok: false; reason: 'short' | 'small' | 'open' };

/**
 * A "circle" is any roughly closed loop: long enough, big enough in both directions
 * (so a flat ellipse around one word counts) and with its end close to its start.
 */
export function analyzeStroke(pts: Pt[]): StrokeVerdict {
  if (pts.length < 8) return { ok: false, reason: 'short' };
  const len = pathLength(pts);
  if (len < 50) return { ok: false, reason: 'short' };
  const bb = bbox(pts);
  if (bb.w < 16 || bb.h < 16) return { ok: false, reason: 'small' };
  const diag = Math.hypot(bb.w, bb.h);
  const gap = dist(pts[0], pts[pts.length - 1]);
  if (gap > Math.max(36, diag * 0.45) || len < diag * 1.5) return { ok: false, reason: 'open' };
  return { ok: true };
}

/** Even-odd ray casting. */
export function pointInPolygon(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    const crosses = a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

export function centroid(pts: Pt[]): Pt {
  let x = 0;
  let y = 0;
  for (const p of pts) {
    x += p.x;
    y += p.y;
  }
  return { x: x / pts.length, y: y / pts.length };
}
