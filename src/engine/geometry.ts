/** 3D 向量运算(ENU),全部纯函数 */
import type { Vec3 } from '../types';

export const v3 = {
  add: (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z }),
  sub: (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z }),
  scale: (a: Vec3, s: number): Vec3 => ({ x: a.x * s, y: a.y * s, z: a.z * s }),
  dot: (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z,
  cross: (a: Vec3, b: Vec3): Vec3 => ({
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  }),
  len: (a: Vec3): number => Math.hypot(a.x, a.y, a.z),
  norm(a: Vec3): Vec3 {
    const l = Math.hypot(a.x, a.y, a.z) || 1;
    return { x: a.x / l, y: a.y / l, z: a.z / l };
  },
  zero: (): Vec3 => ({ x: 0, y: 0, z: 0 }),
};

export interface Poly2 {
  pts: { x: number; y: number }[];
}

/** 多边形面积(有符号,逆时针为正) —— Shoelace */
export function polygonArea(poly: Poly2): number {
  const p = poly.pts;
  if (p.length < 3) return 0;
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i];
    const b = p[(i + 1) % p.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

/** 点在凸多边形内(含边界),要求多边形为严格凸 */
export function pointInConvex(poly: Poly2, qx: number, qy: number): boolean {
  const p = poly.pts;
  const n = p.length;
  if (n < 3) return false;
  let sign = 0;
  for (let i = 0; i < n; i++) {
    const a = p[i];
    const b = p[(i + 1) % n];
    const cross = (b.x - a.x) * (qy - a.y) - (b.y - a.y) * (qx - a.x);
    if (cross > 1e-12) {
      if (sign === 0) sign = 1;
      else if (sign === -1) return false;
    } else if (cross < -1e-12) {
      if (sign === 0) sign = -1;
      else if (sign === 1) return false;
    }
  }
  return true;
}

/**
 * Sutherland-Hodgman 凸多边形裁剪:subject 被 clip(凸)裁剪。
 * 返回裁剪后的多边形(可能为 0/1/2 个点)。
 */
export function clipConvex(subject: Poly2, clip: Poly2): Poly2 {
  let output = subject.pts.slice();
  const cp = clip.pts;
  for (let i = 0; i < cp.length; i++) {
    if (output.length === 0) return { pts: [] };
    const input = output;
    output = [];
    const A = cp[i];
    const B = cp[(i + 1) % cp.length];
    for (let j = 0; j < input.length; j++) {
      const P = input[j];
      const Q = input[(j + 1) % input.length];
      const pin = side(A, B, P) >= -1e-12;
      const qin = side(A, B, Q) >= -1e-12;
      if (pin && qin) {
        output.push(Q);
      } else if (pin && !qin) {
        output.push(intersect(P, Q, A, B));
      } else if (!pin && qin) {
        output.push(intersect(P, Q, A, B));
        output.push(Q);
      }
    }
  }
  return { pts: output };
}

function side(a: { x: number; y: number }, b: { x: number; y: number }, p: { x: number; y: number }): number {
  return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
}

function intersect(
  p: { x: number; y: number },
  q: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
): { x: number; y: number } {
  const r = { x: q.x - p.x, y: q.y - p.y };
  const s = { x: b.x - a.x, y: b.y - a.y };
  const denom = r.x * s.y - r.y * s.x;
  const t = ((a.x - p.x) * s.y - (a.y - p.y) * s.x) / denom;
  return { x: p.x + t * r.x, y: p.y + t * r.y };
}

/**
 * 多个凸多边形在矩形区域内的并集面积 —— 自适应栅格法。
 * 仅在单解析法失效(阴影互相重叠)时调用。
 * @param gridN 单边格数
 */
export function unionAreaInRect(polys: Poly2[], rect: Poly2, gridN: number): number {
  const xs = rect.pts.map((p) => p.x);
  const ys = rect.pts.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const dx = (maxX - minX) / gridN;
  const dy = (maxY - minY) / gridN;
  const covered = new Uint8Array(gridN * gridN);

  for (const poly of polys) {
    const pxs = poly.pts.map((p) => p.x);
    const pys = poly.pts.map((p) => p.y);
    const pminX = Math.min(...pxs);
    const pmaxX = Math.max(...pxs);
    const pminY = Math.min(...pys);
    const pmaxY = Math.max(...pys);
    const i0 = Math.max(0, Math.floor((pminX - minX) / dx));
    const i1 = Math.min(gridN - 1, Math.floor((pmaxX - minX) / dx));
    const j0 = Math.max(0, Math.floor((pminY - minY) / dy));
    const j1 = Math.min(gridN - 1, Math.floor((pmaxY - minY) / dy));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const idx = j * gridN + i;
        if (covered[idx]) continue;
        const cx = minX + (i + 0.5) * dx;
        const cy = minY + (j + 0.5) * dy;
        if (pointInConvex(poly, cx, cy)) covered[idx] = 1;
      }
    }
  }
  let count = 0;
  for (let k = 0; k < covered.length; k++) count += covered[k];
  return (count * dx * dy);
}

/** 2D 凸包(Andrew monotone chain),输入 3D 点投影到 (px,py) 平面后使用 */
export function convexHull2D(pts: { x: number; y: number }[]): Poly2 {
  if (pts.length <= 2) return { pts: pts.slice() };
  const sorted = pts.slice().sort((a, b) => (a.x - b.x || a.y - b.y));
  const unique: { x: number; y: number }[] = [];
  for (const p of sorted) {
    const last = unique[unique.length - 1];
    if (!last || Math.abs(last.x - p.x) > 1e-12 || Math.abs(last.y - p.y) > 1e-12) unique.push(p);
  }
  if (unique.length <= 2) return { pts: unique };
  const cross = (o: typeof pts[0], a: typeof pts[0], b: typeof pts[0]) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: typeof unique = [];
  for (const p of unique) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 1e-12) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: typeof unique = [];
  for (let i = unique.length - 1; i >= 0; i--) {
    const p = unique[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 1e-12) {
      upper.pop();
    }
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return { pts: lower.concat(upper) };
}

export function aabb2D(poly: Poly2): { minX: number; maxX: number; minY: number; maxY: number } {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of poly.pts) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, maxX, minY, maxY };
}

export function aabbOverlap2D(
  a: { minX: number; maxX: number; minY: number; maxY: number },
  b: { minX: number; maxX: number; minY: number; maxY: number },
): boolean {
  return !(a.maxX < b.minX || a.minX > b.maxX || a.maxY < b.minY || a.minY > b.maxY);
}
