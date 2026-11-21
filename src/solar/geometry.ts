import { ArrayConfig } from '../types';

const DEG = Math.PI / 180;

export interface Vec3 { x: number; y: number; z: number }

/** 阵列朝向基向量 */
export interface ArrayBasis {
  /** 沿排方向(组件宽度方向) */
  rowDir: Vec3;
  /** 水平面上指向阵列后方(北) */
  behindDir: Vec3;
  /** 坡面向上方向 */
  slopeUp: Vec3;
  /** 组件法线 */
  normal: Vec3;
  tilt: number;
  azimuth: number;
}

export function arrayBasis(azimuthDeg: number, tiltDeg: number): ArrayBasis {
  const g = azimuthDeg * DEG;
  const b = tiltDeg * DEG;
  const sg = Math.sin(g), cg = Math.cos(g);
  const sb = Math.sin(b), cb = Math.cos(b);
  return {
    rowDir: { x: cg, y: -sg, z: 0 },
    behindDir: { x: sg, y: cg, z: 0 },
    slopeUp: { x: sg * cb, y: cg * cb, z: sb },
    normal: { x: -sg * cb, y: -cg * cb, z: sb },
    tilt: tiltDeg,
    azimuth: azimuthDeg,
  };
}

/** 某排某组件下沿中心的地面坐标(z=0) */
export function moduleGroundPos(
  cfg: ArrayConfig, basis: ArrayBasis, row: number, col: number,
): { x: number; y: number } {
  const rowOffset = row * cfg.rowPitch;
  const colOffset = (col - (cfg.modulesPerRow - 1) / 2) * (cfg.moduleWidth + cfg.moduleGap);
  return {
    x: cfg.originX + basis.behindDir.x * rowOffset + basis.rowDir.x * colOffset,
    y: cfg.originY + basis.behindDir.y * rowOffset + basis.rowDir.y * colOffset,
  };
}

/** 组件中心 3D 坐标 */
export function moduleCenter(cfg: ArrayConfig, basis: ArrayBasis, row: number, col: number): Vec3 {
  const g = moduleGroundPos(cfg, basis, row, col);
  const halfL = cfg.moduleLength / 2;
  return {
    x: g.x + basis.slopeUp.x * halfL,
    y: g.y + basis.slopeUp.y * halfL,
    z: cfg.clearance + basis.slopeUp.z * halfL,
  };
}

/**
 * 组件上的采样点(世界坐标)。
 * @param u 沿坡面方向 0=下沿 1=上沿
 * @param v 沿排方向 0..1
 */
export function modulePoint(
  cfg: ArrayConfig, basis: ArrayBasis, row: number, col: number, u: number, v: number,
): Vec3 {
  const g = moduleGroundPos(cfg, basis, row, col);
  const L = cfg.moduleLength;
  const w = (v - 0.5) * cfg.moduleWidth;
  return {
    x: g.x + basis.slopeUp.x * u * L + basis.rowDir.x * w,
    y: g.y + basis.slopeUp.y * u * L + basis.rowDir.y * w,
    z: cfg.clearance + basis.slopeUp.z * u * L,
  };
}

/**
 * 前排对第 row 排的遮挡比例(闭式解, 对所有组件相同)。
 * 推导: 前排上沿高 H=h0+L·sinβ, 本排下沿距前排上沿水平距离 x0=P−L·cosβ。
 * 太阳高度角 α、太阳与本排方位差 Δγ 时, 前排上沿影子在水平距离 x 处的高度为
 * H − x·tanα/cosΔγ, 与坡面求交即得遮挡长度。
 *
 * @returns 0..1, 被遮坡面长度占比
 */
export function interRowShading(
  cfg: ArrayConfig, sunElevationDeg: number, sunAzimuthDeg: number,
): number {
  const beta = cfg.tilt * DEG;
  const L = cfg.moduleLength;
  const P = cfg.rowPitch;
  const cosDG = Math.cos((sunAzimuthDeg - cfg.azimuth) * DEG);
  const alpha = sunElevationDeg * DEG;
  if (alpha <= 0 || cosDG <= 0) return 0;
  const x0 = P - L * Math.cos(beta);
  const H = L * Math.sin(beta); // 相对下沿高度
  const tanA = Math.tan(alpha);
  // x0 处影高 <= 0 则无遮挡
  if (H - (x0 * tanA) / cosDG <= 0) return 0;
  const tanB = Math.tan(beta);
  const xStar = (H + x0 * tanB) / (tanB + tanA / cosDG);
  const frac = (xStar - x0) / (L * Math.cos(beta));
  return Math.min(1, Math.max(0, frac));
}

/**
 * 冬至日 9:00–15:00 前后排不遮挡的最小行距。
 * 不遮挡条件: P >= L·cosβ + L·sinβ·cosΔγ/tanα, 取时段内最大值。
 */
export function minRowPitchForDate(
  cfg: ArrayConfig,
  sunAt: (hour: number, minute: number) => { elevation: number; azimuth: number },
  startHour = 9, endHour = 15,
): { pitch: number; worstTime: string; worstElevation: number; worstAzimuth: number } {
  const beta = cfg.tilt * DEG;
  const L = cfg.moduleLength;
  let need = L * Math.cos(beta); // 至少容纳组件水平投影
  let worstT = '12:00';
  let worstEl = 0, worstAz = 0;
  for (let t = startHour * 60; t <= endHour * 60; t++) {
    const h = Math.floor(t / 60), m = t % 60;
    const s = sunAt(h, m);
    if (s.elevation <= 0) continue;
    const cosDG = Math.cos((s.azimuth - cfg.azimuth) * DEG);
    if (cosDG <= 0) continue;
    const p = L * Math.cos(beta) + (L * Math.sin(beta) * cosDG) / Math.tan(s.elevation * DEG);
    if (p > need) {
      need = p;
      worstT = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      worstEl = s.elevation;
      worstAz = s.azimuth;
    }
  }
  return { pitch: need, worstTime: worstT, worstElevation: worstEl, worstAzimuth: worstAz };
}
