/**
 * 阴影引擎 —— 系统的精度核心。
 *
 * 方法(纯解析几何,不依赖 GPU/像素):
 * 1. 每个遮挡物/每排组件在太阳方向做平行光投影,取投影体 xy 凸包作为地面阴影;
 * 2. 粗筛:地面阴影 AABB 与组件"投影体到地面的包围盒"相交才进入精算;
 * 3. 精算:把投影顶点投到组件平面得到局部 2D 凸多边形,
 *    Sutherland-Hodgman 裁剪到组件矩形,有符号面积比 = 遮挡比例;
 * 4. 多个阴影重叠时改用自适应栅格求并集,避免重复计数。
 *
 * 单根立杆等简单情形退化为纯三角函数,与手算公式同源,误差仅来自浮点舍入。
 */
import type { ModuleInstance, Obstacle, PVArrayConfig, Vec3 } from '../types';
import {
  aabb2D,
  clipConvex,
  pointInConvex,
  polygonArea,
  v3,
  type Poly2,
} from './geometry';
import {
  capsuleToPoly,
  casterGroundPoly,
  casterShadowOnModule,
  makeCaster as makeCasterExport,
  obstacleCaster,
  pointInCapsule,
  projectToGround,
  type Caster,
  type Capsule2D,
} from './casters';
import { arrayFrame, moduleCorners } from './layout';

const DEG2RAD = Math.PI / 180;

/** 手算公式:垂直立杆影长 L = h / tan(α) */
export function poleShadowLengthFormula(height: number, elevationDeg: number): number {
  return height / Math.tan(elevationDeg * DEG2RAD);
}

/** 本引擎管线计算的杆影长(底点与顶点落地点的水平距离) */
export function poleShadowLengthEngine(height: number, s: Vec3): number {
  const base: Vec3 = { x: 0, y: 0, z: 0 };
  const tip: Vec3 = { x: 0, y: 0, z: height };
  const g0 = projectToGround(base, s);
  const g1 = projectToGround(tip, s);
  return Math.hypot(g1.x - g0.x, g1.y - g0.y);
}

interface RowCaster {
  key: string;
  arrayId: string;
  row: number;
  caster: Caster;
}

/**
 * 排 caster(凸四边形)在指定组件平面的零分配遮挡比例。
 * 直接把 4 个投影顶点变换到组件局部坐标,再裁剪到组件矩形求面积。
 */
function rowShadowFractionZeroAlloc(
  caster: Caster,
  m: ModuleInstance,
  repIdx: number,
  s: Vec3,
  ctx: ShadingContext,
): number {
  const denom = v3.dot(s, m.normal);
  const buf = ctx.scratchPts;
  let sMinX = Infinity; let sMaxX = -Infinity; let sMinY = Infinity; let sMaxY = -Infinity;
  for (let i = 0; i < 4; i++) {
    const p = caster.projected3D[i];
    const t = -v3.dot(v3.sub(p, m.center), m.normal) / denom;
    const qx = p.x + t * s.x - m.center.x;
    const qy = p.y + t * s.y - m.center.y;
    const qz = p.z + t * s.z - m.center.z;
    const lx = qx * m.u.x + qy * m.u.y + qz * m.u.z;
    const ly = qx * m.vUp.x + qy * m.vUp.y + qz * m.vUp.z;
    buf[i].x = lx;
    buf[i].y = ly;
    if (lx < sMinX) sMinX = lx;
    if (lx > sMaxX) sMaxX = lx;
    if (ly < sMinY) sMinY = ly;
    if (ly > sMaxY) sMaxY = ly;
  }
  // 局部 2D AABB 快速拒绝,跳过昂贵的多边形裁剪
  const hu = m.width / 2;
  const hv = m.height / 2;
  if (sMaxX < -hu || sMinX > hu || sMaxY < -hv || sMinY > hv) return 0;
  const shadow: Poly2 = { pts: buf.slice(0, 4) };
  const clipped = clipConvex(shadow, ctx.geom[repIdx].rect);
  return Math.min(1, Math.abs(polygonArea(clipped)) / ctx.geom[repIdx].area);
}

/** 每排组件作为一个整体阴影投射体(四角平行投影) */
export function buildRowCasters(arrays: PVArrayConfig[], s: Vec3): RowCaster[] {
  const out: RowCaster[] = [];
  for (const arr of arrays) {
    const { f, u, vUp } = arrayFrame(arr.azimuth, arr.tilt);
    const centerZ = arr.mountHeight + (arr.moduleHeight / 2) * Math.sin(arr.tilt * DEG2RAD);
    const halfW = ((arr.cols - 1) * arr.colPitch + arr.moduleWidth) / 2;
    const halfH = arr.moduleHeight / 2;
    for (let row = 0; row < arr.rows; row++) {
      const center = v3.add(arr.origin, v3.scale(f, -row * arr.rowPitch));
      center.z = centerZ;
      const verts = [
        v3.add(v3.add(center, v3.scale(u, -halfW)), v3.scale(vUp, -halfH)),
        v3.add(v3.add(center, v3.scale(u, halfW)), v3.scale(vUp, -halfH)),
        v3.add(v3.add(center, v3.scale(u, halfW)), v3.scale(vUp, halfH)),
        v3.add(v3.add(center, v3.scale(u, -halfW)), v3.scale(vUp, halfH)),
      ];
      const caster = makeCasterExport('module', `row:${arr.id}:${row}`, verts, s);
      caster.convexOrdered = true;
      out.push({
        key: `row:${arr.id}:${row}`,
        arrayId: arr.id,
        row,
        caster,
      });
    }
  }
  return out;
}

/** 预计算组件四角世界坐标(与太阳无关,可跨时刻复用) */
interface ModuleGeom {
  corners: Vec3[];
  rect: Poly2;
  area: number;
  denomSign: number;
}

function buildModuleGeom(modules: ModuleInstance[]): ModuleGeom[] {
  return modules.map((m) => ({
    corners: moduleCorners(m),
    rect: moduleLocalRect(m),
    area: m.width * m.height,
    denomSign: 0,
  }));
}

/**
 * 组件投影体包围盒模板:同阵列组件姿态一致,角点相对中心的局部偏移相同,
 * 因此包围盒相对中心的 extents 只取决于太阳方向,每阵列每时刻算一次即可。
 * 返回相对中心的 [minX,maxX,minY,maxY] 偏移。
 */
function moduleAABBTemplate(m: ModuleInstance, s: Vec3): [number, number, number, number] {
  let dMinX = Infinity;
  let dMaxX = -Infinity;
  let dMinY = Infinity;
  let dMaxY = -Infinity;
  const sz = s.z;
  const cx = m.center.x;
  const cy = m.center.y;
  for (const p of moduleCorners(m)) {
    const dx = p.x - cx;
    const dy = p.y - cy;
    if (dx < dMinX) dMinX = dx;
    if (dx > dMaxX) dMaxX = dx;
    if (dy < dMinY) dMinY = dy;
    if (dy > dMaxY) dMaxY = dy;
    const k = p.z / sz;
    const gdx = dx - k * s.x;
    const gdy = dy - k * s.y;
    if (gdx < dMinX) dMinX = gdx;
    if (gdx > dMaxX) dMaxX = gdx;
    if (gdy < dMinY) dMinY = gdy;
    if (gdy > dMaxY) dMaxY = gdy;
  }
  return [dMinX, dMaxX, dMinY, dMaxY];
}

function moduleLocalRect(m: ModuleInstance): Poly2 {
  const hu = m.width / 2;
  const hv = m.height / 2;
  return {
    pts: [
      { x: -hu, y: -hv },
      { x: hu, y: -hv },
      { x: hu, y: hv },
      { x: -hu, y: hv },
    ],
  };
}

export interface ShadingResult {
  fractions: Float64Array;
  /** 实际参与精算的(组件,投射体)对数,用于性能诊断 */
  clipCount: number;
}

/** 与太阳方向无关的可复用上下文(全年分析只构建一次,缓冲区跨时刻复用) */
export interface ShadingContext {
  modules: ModuleInstance[];
  arrays: PVArrayConfig[];
  obstacles: Obstacle[];
  geom: ModuleGeom[];
  arrayIndexById: Map<string, number>;
  /** 每阵列每排首个组件的模块索引 [arrayIndex][row] */
  rowFirstIdx: Int32Array[];
  /** 每模块所属阵列的数值索引 */
  moduleArrayIdx: Int32Array;
  /** 排 caster 槽位缓冲(每时刻填充,跨时刻复用) */
  rowSlots: (Caster | undefined)[][];
  /** 自遮挡裁剪用的复用多边形缓冲,避免热路径 GC */
  scratchPts: { x: number; y: number }[];
  scratchPoly: Poly2;
  // 预分配标量缓冲区,避免每时刻产生 GC 压力
  aabbMinX: Float64Array;
  aabbMaxX: Float64Array;
  aabbMinY: Float64Array;
  aabbMaxY: Float64Array;
  /** 排级自遮挡比例缓冲 [arrayIndex][row],每时刻复用 */
  rowSelfBuf: Float64Array[];
  fractions: Float64Array;
  hitScratch: Caster[];
}

export function createShadingContext(
  modules: ModuleInstance[],
  arrays: PVArrayConfig[],
  obstacles: Obstacle[],
): ShadingContext {
  const n = modules.length;
  const arrayIndexById = new Map(arrays.map((a, i) => [a.id, i]));
  const rowFirstIdx = arrays.map((a) => new Int32Array(a.rows).fill(-1));
  const moduleArrayIdx = new Int32Array(n);
  for (let mi = 0; mi < n; mi++) {
    const mm = modules[mi];
    const ai = arrayIndexById.get(mm.arrayId)!;
    moduleArrayIdx[mi] = ai;
    if (rowFirstIdx[ai][mm.row] === -1) rowFirstIdx[ai][mm.row] = mi;
  }
  const rowSlots = arrays.map((a) => new Array<Caster | undefined>(a.rows));
  const scratchPts = Array.from({ length: 8 }, () => ({ x: 0, y: 0 }));
  return {
    modules,
    arrays,
    obstacles,
    geom: buildModuleGeom(modules),
    arrayIndexById,
    rowFirstIdx,
    moduleArrayIdx,
    rowSlots,
    scratchPts,
    scratchPoly: { pts: scratchPts },
    aabbMinX: new Float64Array(n),
    aabbMaxX: new Float64Array(n),
    aabbMinY: new Float64Array(n),
    aabbMaxY: new Float64Array(n),
    rowSelfBuf: arrays.map((a) => new Float64Array(a.rows)),
    fractions: new Float64Array(n),
    hitScratch: [],
  };
}

/** 基于可复用上下文计算某时刻遮挡比例(热路径,避免重复构建组件几何) */
export function computeShadingFractionsCtx(
  ctx: ShadingContext,
  s: Vec3,
  gridSize: number,
): ShadingResult {
  const { modules, arrays, obstacles, geom, arrayIndexById } = ctx;
  const fractions = ctx.fractions.fill(0);
  let clipCount = 0;
  if (s.z <= 0.001) return { fractions, clipCount };
  const overlapAABB = (b: { minX: number; maxX: number; minY: number; maxY: number }, minX: number, maxX: number, minY: number, maxY: number) =>
    !(b.maxX < minX || b.minX > maxX || b.maxY < minY || b.minY > maxY);

  // 障碍 caster(数量少);排 caster 填入 context 预分配槽位
  const obstacleCasters: Caster[] = obstacles.map((o) => obstacleCaster(o, s));
  const rowCasters = buildRowCasters(arrays, s);
  const rowsByArray = ctx.rowSlots;
  for (const slots of rowsByArray) slots.fill(undefined);
  for (const rc of rowCasters) {
    const ai = arrayIndexById.get(rc.arrayId)!;
    rowsByArray[ai][rc.row] = rc.caster;
  }

  // 同阵列组件共享 AABB 模板(只取决于太阳方向与姿态),每阵列算一次
  const nTpl = arrays.length;
  const tMinX = new Float64Array(nTpl);
  const tMaxX = new Float64Array(nTpl);
  const tMinY = new Float64Array(nTpl);
  const tMaxY = new Float64Array(nTpl);
  for (let ai2 = 0; ai2 < nTpl; ai2++) {
    const repIdx = ctx.rowFirstIdx[ai2][0];
    if (repIdx !== -1) {
      const t = moduleAABBTemplate(modules[repIdx], s);
      tMinX[ai2] = t[0]; tMaxX[ai2] = t[1]; tMinY[ai2] = t[2]; tMaxY[ai2] = t[3];
    }
  }
  const modAi = ctx.moduleArrayIdx;
  const aMinX = ctx.aabbMinX, aMaxX = ctx.aabbMaxX, aMinY = ctx.aabbMinY, aMaxY = ctx.aabbMaxY;
  for (let mi = 0; mi < modules.length; mi++) {
    const cx = modules[mi].center.x;
    const cy = modules[mi].center.y;
    const ai2 = modAi[mi];
    aMinX[mi] = cx + tMinX[ai2];
    aMaxX[mi] = cx + tMaxX[ai2];
    aMinY[mi] = cy + tMinY[ai2];
    aMaxY[mi] = cy + tMaxY[ai2];
  }

  // 排级自遮挡:每排只对首个组件(列 0)算一次,比例对全列相同,写入复用缓冲
  for (let ai2 = 0; ai2 < arrays.length; ai2++) {
    const buf = ctx.rowSelfBuf[ai2];
    buf.fill(0);
    const slots = rowsByArray[ai2];
    for (let r = 1; r < arrays[ai2].rows; r++) {
      const repIdx = ctx.rowFirstIdx[ai2][r];
      const prev = slots[r - 1];
      if (repIdx === -1 || !prev) continue;
      const rep = modules[repIdx];
      if (v3.dot(s, rep.normal) <= 1e-6) continue;
      if (!overlapAABB(prev.groundAABB, ctx.aabbMinX[repIdx], ctx.aabbMaxX[repIdx], ctx.aabbMinY[repIdx], ctx.aabbMaxY[repIdx])) continue;
      clipCount++;
      buf[r] = rowShadowFractionZeroAlloc(prev, rep, repIdx, s, ctx);
    }
  }

  const hitScratch = ctx.hitScratch;
  const overlap = overlapAABB;
  // 全部障碍的合并包围盒:先整体排除远离障碍区的绝大多数模块
  let obMinX = Infinity; let obMaxX = -Infinity; let obMinY = Infinity; let obMaxY = -Infinity;
  for (const c of obstacleCasters) {
    const b = c.groundAABB;
    if (b.minX < obMinX) obMinX = b.minX;
    if (b.maxX > obMaxX) obMaxX = b.maxX;
    if (b.minY < obMinY) obMinY = b.minY;
    if (b.maxY > obMaxY) obMaxY = b.maxY;
  }
  const hasObstacles = obstacleCasters.length > 0;
  // 每阵列法线一致,正面/背面按阵列一次判定
  const arrayFront = arrays.map((a) => {
    const repIdx = ctx.rowFirstIdx[arrayIndexById.get(a.id)!][0];
    return repIdx !== -1 && v3.dot(s, modules[repIdx].normal) > 1e-6;
  });
  const singleArray = arrays.length === 1;

  for (let mi = 0; mi < modules.length; mi++) {
    const selfAi = ctx.moduleArrayIdx[mi];
    if (!arrayFront[selfAi]) {
      fractions[mi] = 0;
      continue;
    }
    const m = modules[mi];
    const vMinX = ctx.aabbMinX[mi];
    const vMaxX = ctx.aabbMaxX[mi];
    const vMinY = ctx.aabbMinY[mi];
    const vMaxY = ctx.aabbMaxY[mi];
    const selfFrac = m.row > 0 ? ctx.rowSelfBuf[selfAi][m.row] : 0;
    hitScratch.length = 0;

    // 场地障碍:先合并包围盒快速排除,再逐个精确检查
    if (hasObstacles && overlap({ minX: obMinX, maxX: obMaxX, minY: obMinY, maxY: obMaxY }, vMinX, vMaxX, vMinY, vMaxY)) {
      for (const c of obstacleCasters) {
        if (overlap(c.groundAABB, vMinX, vMaxX, vMinY, vMaxY)) hitScratch.push(c);
      }
    }
    // 跨阵列排(单阵列时整段跳过)
    if (!singleArray) {
      for (let ai2 = 0; ai2 < rowsByArray.length; ai2++) {
        if (ai2 === selfAi) continue;
        for (const c of rowsByArray[ai2]) {
          if (c && overlap(c.groundAABB, vMinX, vMaxX, vMinY, vMaxY)) hitScratch.push(c);
        }
      }
    }

    if (hitScratch.length === 0) {
      fractions[mi] = selfFrac;
      continue;
    }

    const rect = geom[mi].rect;
    const area = geom[mi].area;

    // 单障碍:直接裁剪
    if (hitScratch.length === 1) {
      const c = hitScratch[0];
      const shadow = c.analyticOnModule
        ? capsuleToPoly(c.analyticOnModule(m, s))
        : casterShadowOnModule(c, m, s);
      const clipped = clipConvex(shadow, rect);
      clipCount++;
      const obFrac = Math.min(1, Math.abs(polygonArea(clipped)) / area);
      fractions[mi] = Math.min(1, selfFrac + obFrac - selfFrac * obFrac);
      continue;
    }

    const clippedPolys: Poly2[] = [];
    const analyticCapsules: Capsule2D[] = [];
    for (const c of hitScratch) {
      if (c.analyticOnModule) analyticCapsules.push(c.analyticOnModule(m, s));
      const shadow = c.analyticOnModule
        ? capsuleToPoly(c.analyticOnModule(m, s))
        : casterShadowOnModule(c, m, s);
      const clipped = clipConvex(shadow, rect);
      if (clipped.pts.length >= 3) clippedPolys.push(clipped);
      clipCount++;
    }
    const obUnion = unionAreaInRectWithCapsules(clippedPolys, analyticCapsules, rect, gridSize) / area;
    fractions[mi] = Math.min(1, selfFrac + obUnion - selfFrac * obUnion);
  }
  return { fractions, clipCount };
}

/**
 * 某一时刻全部组件的遮挡比例。
 * @param modules 已展开的组件
 * @param arrays 阵列配置(用于排级投射体)
 * @param obstacles 场地遮挡物
 * @param s 指向太阳的单位向量
 */
export function computeShadingFractions(
  modules: ModuleInstance[],
  arrays: PVArrayConfig[],
  obstacles: Obstacle[],
  s: Vec3,
  gridSize: number,
): ShadingResult {
  return computeShadingFractionsCtx(createShadingContext(modules, arrays, obstacles), s, gridSize);
}

/** 用于三维场景渲染的地面阴影多边形(世界 xy 坐标) */
export function groundShadowPolygons(
  arrays: PVArrayConfig[],
  obstacles: Obstacle[],
  s: Vec3,
): Poly2[] {
  if (s.z <= 0.001) return [];
  const polys: Poly2[] = [];
  for (const o of obstacles) {
    const c = obstacleCaster(o, s);
    polys.push(c.analyticGround ? capsuleToPoly(c.analyticGround) : casterGroundPoly(c));
  }
  for (const rc of buildRowCasters(arrays, s)) polys.push(casterGroundPoly(rc.caster));
  return polys;
}

/** 栅格求并集,同时支持凸多边形与解析胶囊 */
function unionAreaInRectWithCapsules(
  polys: Poly2[],
  capsules: Capsule2D[],
  rect: Poly2,
  gridN: number,
): number {
  const xs = rect.pts.map((p) => p.x);
  const ys = rect.pts.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const dx = (maxX - minX) / gridN;
  const dy = (maxY - minY) / gridN;
  const covered = new Uint8Array(gridN * gridN);

  const mark = (test: (cx: number, cy: number) => boolean, bounds: { minX: number; maxX: number; minY: number; maxY: number }) => {
    const i0 = Math.max(0, Math.floor((bounds.minX - minX) / dx));
    const i1 = Math.min(gridN - 1, Math.floor((bounds.maxX - minX) / dx));
    const j0 = Math.max(0, Math.floor((bounds.minY - minY) / dy));
    const j1 = Math.min(gridN - 1, Math.floor((bounds.maxY - minY) / dy));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const idx = j * gridN + i;
        if (covered[idx]) continue;
        if (test(minX + (i + 0.5) * dx, minY + (j + 0.5) * dy)) covered[idx] = 1;
      }
    }
  };

  for (const poly of polys) {
    mark((cx, cy) => pointInConvex(poly, cx, cy), aabb2D(poly));
  }
  for (const cap of capsules) {
    const r = cap.r;
    mark(
      (cx, cy) => pointInCapsule(cap, cx, cy),
      {
        minX: Math.min(cap.ax, cap.bx) - r,
        maxX: Math.max(cap.ax, cap.bx) + r,
        minY: Math.min(cap.ay, cap.by) - r,
        maxY: Math.max(cap.ay, cap.by) + r,
      },
    );
  }
  let count = 0;
  for (let k = 0; k < covered.length; k++) count += covered[k];
  return count * dx * dy;
}
