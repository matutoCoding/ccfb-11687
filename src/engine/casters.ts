/**
 * 平行光投影剪影:所有遮挡物(厂房/杆/树)与组件排,
 * 在给定太阳方向下生成 3D 凸包顶点,供地面阴影与组件面投影复用。
 */
import type { ModuleInstance, Obstacle, Vec3 } from '../types';
import { convexHull2D, v3, type Poly2 } from './geometry';
import { moduleCorners } from './layout';

const DEG2RAD = Math.PI / 180;

export interface Caster {
  kind: 'obstacle' | 'module';
  id: string;
  /** 投影后的 3D 顶点(平行光方向 s),其 xy 凸包即地面阴影 */
  projected3D: Vec3[];
  groundAABB: { minX: number; maxX: number; minY: number; maxY: number };
  /** 投影点本身已是凸序(如四边形排面板),可跳过 convexHull 排序 */
  convexOrdered?: boolean;
  /** 圆柱类投射体的解析阴影(两圆外公切线胶囊形),优先于凸包使用 */
  analyticGround?: Capsule2D;
  /** 解析阴影在组件局部平面上的形式(同形状,变换坐标后给出) */
  analyticOnModule?: (m: import('../types').ModuleInstance, s: Vec3) => Capsule2D;
}

/** 二维胶囊:圆心 a、b(xy),半径 r */
export interface Capsule2D {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  r: number;
}

function capsuleAABB(c: Capsule2D) {
  return {
    minX: Math.min(c.ax, c.bx) - c.r,
    maxX: Math.max(c.ax, c.bx) + c.r,
    minY: Math.min(c.ay, c.by) - c.r,
    maxY: Math.max(c.ay, c.by) + c.r,
  };
}

/** 胶囊转多边形(用于渲染与统一裁剪,32 段) */
export function capsuleToPoly(c: Capsule2D, segPerHalf = 16): Poly2 {
  const dx = c.bx - c.ax;
  const dy = c.by - c.ay;
  const ang = Math.atan2(dy, dx);
  const pts: { x: number; y: number }[] = [];
  // b 端半圆(从 ang-90 绕到 ang+90),a 端半圆
  for (let i = 0; i <= segPerHalf; i++) {
    const t = ang - Math.PI / 2 + (i / segPerHalf) * Math.PI;
    pts.push({ x: c.bx + c.r * Math.cos(t), y: c.by + c.r * Math.sin(t) });
  }
  for (let i = 0; i <= segPerHalf; i++) {
    const t = ang + Math.PI / 2 + (i / segPerHalf) * Math.PI;
    pts.push({ x: c.ax + c.r * Math.cos(t), y: c.ay + c.r * Math.sin(t) });
  }
  return { pts };
}

/** 点在胶囊内 */
export function pointInCapsule(c: Capsule2D, x: number, y: number): boolean {
  const dx = c.bx - c.ax;
  const dy = c.by - c.ay;
  const len2 = dx * dx + dy * dy || 1e-12;
  let t = ((x - c.ax) * dx + (y - c.ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const qx = c.ax + t * dx;
  const qy = c.ay + t * dy;
  return Math.hypot(x - qx, y - qy) <= c.r + 1e-12;
}

/** 平行光方向上,点 p 沿 -s 投影到地面 z=0 的点 */
export function projectToGround(p: Vec3, s: Vec3): Vec3 {
  const k = p.z / s.z; // s.z>0(白天)
  return { x: p.x - k * s.x, y: p.y - k * s.y, z: 0 };
}

/** 点 p 沿 -s 投影到指定高度 zTarget 的水平面 */
export function projectToZ(p: Vec3, s: Vec3, zTarget: number): Vec3 {
  const k = (p.z - zTarget) / s.z;
  return { x: p.x - k * s.x, y: p.y - k * s.y, z: zTarget };
}

function aabbOf(points: Vec3[]) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, maxX, minY, maxY };
}

/** 厂房 8 个顶点 */
function buildingVertices(o: Obstacle): Vec3[] {
  const b = o.building!;
  const hw = b.width / 2;
  const hd = b.depth / 2;
  const rot = b.rotation * DEG2RAD;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const local = [
    [-hw, -hd, 0],
    [hw, -hd, 0],
    [hw, hd, 0],
    [-hw, hd, 0],
    [-hw, -hd, b.height],
    [hw, -hd, b.height],
    [hw, hd, b.height],
    [-hw, hd, b.height],
  ];
  return local.map(([lx, ly, lz]) => ({
    x: o.position.x + lx * cos - ly * sin,
    y: o.position.y + lx * sin + ly * cos,
    z: o.position.z + lz,
  }));
}

/** 圆柱杆:上下两个圆周高密采样(48 段,保证细长阴影面积精度) */
function poleVertices(o: Obstacle): Vec3[] {
  const p = o.pole!;
  const N = 48;
  const pts: Vec3[] = [];
  for (const z of [o.position.z, o.position.z + p.height]) {
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      pts.push({
        x: o.position.x + p.radius * Math.cos(a),
        y: o.position.y + p.radius * Math.sin(a),
        z,
      });
    }
  }
  return pts;
}

/** 树:树干圆柱 + 椭球树冠(网格采样,投影取 2D 凸包) */
function treeVertices(o: Obstacle): Vec3[] {
  const t = o.tree!;
  const pts: Vec3[] = [];
  // 树干
  const N = 12;
  for (const z of [o.position.z, o.position.z + t.trunkHeight]) {
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      pts.push({
        x: o.position.x + t.trunkRadius * Math.cos(a),
        y: o.position.y + t.trunkRadius * Math.sin(a),
        z,
      });
    }
  }
  // 树冠椭球,中心位于树干顶 + Rz
  const center: Vec3 = {
    x: o.position.x,
    y: o.position.y,
    z: o.position.z + t.trunkHeight + t.crownRz,
  };
  const rings = 10;
  const segs = 28;
  for (let r = 0; r <= rings; r++) {
    const phi = (r / rings) * Math.PI; // 0..π
    for (let i = 0; i < segs; i++) {
      const theta = (i / segs) * Math.PI * 2;
      pts.push({
        x: center.x + t.crownRx * Math.sin(phi) * Math.cos(theta),
        y: center.y + t.crownRy * Math.sin(phi) * Math.sin(theta),
        z: center.z + t.crownRz * Math.cos(phi),
      });
    }
  }
  return pts;
}

export function obstacleVertices(o: Obstacle): Vec3[] {
  switch (o.type) {
    case 'building':
      return buildingVertices(o);
    case 'pole':
      return poleVertices(o);
    case 'tree':
      return treeVertices(o);
  }
}

/** 组件面板的 4 个顶点 */
export function moduleVertices(m: ModuleInstance): Vec3[] {
  return moduleCorners(m);
}

export function makeCaster(kind: Caster['kind'], id: string, verts: Vec3[], s: Vec3): Caster {
  const projected3D = verts.map((p) => v3.sub(p, v3.scale(s, p.z / s.z)));
  return { kind, id, projected3D, groundAABB: aabbOf(projected3D) };
}

export function obstacleCaster(o: Obstacle, s: Vec3): Caster {
  const base = makeCaster('obstacle', o.id, obstacleVertices(o), s);
  if (o.type === 'pole') {
    // 地面解析胶囊(仅用于地面渲染与 AABB):两圆心落到 z=0,半径恒为 r
    const centerBottom: Vec3 = { x: o.position.x, y: o.position.y, z: o.position.z };
    const centerTop: Vec3 = {
      x: o.position.x,
      y: o.position.y,
      z: o.position.z + o.pole!.height,
    };
    const a = projectToGround(centerBottom, s);
    const b = projectToGround(centerTop, s);
    const capsule: Capsule2D = { ax: a.x, ay: a.y, bx: b.x, by: b.y, r: o.pole!.radius };
    base.analyticGround = capsule;
    base.groundAABB = capsuleAABB(capsule);
    // 组件平面遮挡走 48 段凸包(poleVertices),精度对细长影约 0.2%,避免仿射半径推导误差
  }
  return base;
}

export function moduleCaster(m: ModuleInstance, s: Vec3): Caster {
  return makeCaster('module', m.id, moduleVertices(m), s);
}

/** Caster 的地面阴影多边形(投影点 xy 凸包) */
export function casterGroundPoly(c: Caster): Poly2 {
  return convexHull2D(c.projected3D.map((p) => ({ x: p.x, y: p.y })));
}

/**
 * Caster 在某组件平面上的阴影多边形(局部 2D 坐标)。
 * 把投影后的 3D 点再投到组件平面:q = p - t·s,使 (q-center)·normal=0。
 */
export function casterShadowOnModule(
  c: Caster,
  m: ModuleInstance,
  s: Vec3,
): Poly2 {
  const denom = v3.dot(s, m.normal);
  const localPts = c.projected3D.map((p) => {
    // 光线沿 -s 传播,沿 +s 回交组件平面:q = p + t·s
    const t = -v3.dot(v3.sub(p, m.center), m.normal) / denom;
    const q = v3.add(p, v3.scale(s, t));
    const rel = v3.sub(q, m.center);
    return { x: v3.dot(rel, m.u), y: v3.dot(rel, m.vUp) };
  });
  // 四边形排/组件投影保持凸序,直接返回;障碍点云走凸包
  if (c.convexOrdered) return { pts: localPts };
  return convexHull2D(localPts);
}

/** 遮挡物在地面的 footprint(用于眩光视线检测),xy 凸多边形 */
export function obstacleGroundFootprint(o: Obstacle): Poly2[] {
  if (o.type === 'building') {
    return [convexHull2D(buildingVertices(o).map((p) => ({ x: p.x, y: p.y })))];
  }
  if (o.type === 'pole') {
    // 杆很细:用半径圆近似
    const N = 16;
    const pts = [];
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      pts.push({
        x: o.position.x + o.pole!.radius * Math.cos(a),
        y: o.position.y + o.pole!.radius * Math.sin(a),
      });
    }
    return [{ pts }];
  }
  const t = o.tree!;
  const N = 24;
  const crown: { x: number; y: number }[] = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    crown.push({ x: o.position.x + t.crownRx * Math.cos(a), y: o.position.y + t.crownRy * Math.sin(a) });
  }
  const trunk: { x: number; y: number }[] = [];
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    trunk.push({
      x: o.position.x + t.trunkRadius * Math.cos(a),
      y: o.position.y + t.trunkRadius * Math.sin(a),
    });
  }
  return [{ pts: crown }, { pts: trunk }];
}

/** 遮挡物最高点 z(视线检测用) */
export function obstacleTopZ(o: Obstacle): number {
  if (o.type === 'building') return o.position.z + o.building!.height;
  if (o.type === 'pole') return o.position.z + o.pole!.height;
  return o.position.z + o.tree!.trunkHeight + 2 * o.tree!.crownRz;
}
