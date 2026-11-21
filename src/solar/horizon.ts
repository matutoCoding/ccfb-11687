/**
 * 障碍物遮挡引擎: 对每个采样点建立"方位角→遮挡高度角"轮廓(horizon profile),
 * 太阳高度角低于该方位轮廓高度即被遮挡。1° 方位分辨率。
 */
import { Obstruction } from '../types';
import { Vec3 } from './geometry';

export const AZ_BINS = 360;
const DEG = Math.PI / 180;

/** 方位角(0=南,+西) → bin 索引 */
export function azToBin(azimuthDeg: number): number {
  let b = Math.round(azimuthDeg + 180) % AZ_BINS;
  if (b < 0) b += AZ_BINS;
  return b;
}

/** 方向 (dx,dy)(东,北) → 方位角(度, 0=南,+西) */
export function dirToAzimuth(dx: number, dy: number): number {
  return Math.atan2(-dx, -dy) / DEG;
}

function fillBin(profile: Float32Array, azDeg: number, elDeg: number) {
  const b = azToBin(azDeg);
  if (elDeg > profile[b]) profile[b] = elDeg;
}

/** 两点方位之间的 bin 线性填充(取两者较大高度, 避免采样缝隙) */
function fillSpan(profile: Float32Array, az1: number, el1: number, az2: number, el2: number) {
  let diff = az2 - az1;
  while (diff > 180) diff -= 360;
  while (diff < -180) diff += 360;
  const steps = Math.max(1, Math.ceil(Math.abs(diff)));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    fillBin(profile, az1 + diff * t, el1 + (el2 - el1) * t);
  }
}

/** 计算单个障碍物对某点的遮挡轮廓, 合并进 profile(取最大) */
export function addObstructionProfile(profile: Float32Array, p: Vec3, obs: Obstruction) {
  if (obs.type === 'building') {
    // 顶面四角(考虑旋转)
    const rot = (obs.rotation * DEG);
    const c = Math.cos(rot), s = Math.sin(rot);
    const hl = obs.length / 2, hw = obs.width / 2;
    const corners: [number, number][] = [
      [-hl, -hw], [hl, -hw], [hl, hw], [-hl, hw],
    ].map(([lx, ly]) => [obs.x + lx * c - ly * s, obs.y + lx * s + ly * c]);
    // 若观察点在建筑内部(俯视), 全遮挡
    if (pointInRect(p.x, p.y, obs, c, s)) {
      if (obs.height > p.z) profile.fill(90);
      return;
    }
    // 顶面四条边采样
    for (let e = 0; e < 4; e++) {
      const [x1, y1] = corners[e];
      const [x2, y2] = corners[(e + 1) % 4];
      const edgeLen = Math.hypot(x2 - x1, y2 - y1);
      const n = Math.max(8, Math.ceil(edgeLen / 0.25));
      let prevAz = 0, prevEl = 0;
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const x = x1 + (x2 - x1) * t, y = y1 + (y2 - y1) * t;
        const dx = x - p.x, dy = y - p.y, dz = obs.height - p.z;
        const az = dirToAzimuth(dx, dy);
        const el = Math.atan2(dz, Math.hypot(dx, dy)) / DEG;
        if (i > 0) fillSpan(profile, prevAz, prevEl, az, el);
        else fillBin(profile, az, el);
        prevAz = az; prevEl = el;
      }
    }
  } else if (obs.type === 'pole') {
    const dx = obs.x - p.x, dy = obs.y - p.y;
    const d = Math.hypot(dx, dy);
    if (d < obs.radius) {
      if (obs.height > p.z) profile.fill(90);
      return;
    }
    const halfW = Math.asin(Math.min(1, obs.radius / d)) / DEG;
    const az0 = dirToAzimuth(dx, dy);
    const n = Math.max(2, Math.ceil(halfW * 2));
    for (let i = 0; i <= n; i++) {
      const off = -halfW + (2 * halfW * i) / n;
      const dist = Math.max(d * Math.cos(off * DEG), obs.radius);
      const el = Math.atan2(obs.height - p.z, dist) / DEG;
      fillBin(profile, az0 + off, el);
    }
  } else {
    // tree: 树冠近似球, 球心 (x, y, height), 半径 radius
    const dx = obs.x - p.x, dy = obs.y - p.y;
    const d = Math.hypot(dx, dy);
    const dz = obs.height - p.z;
    const dist3 = Math.hypot(d, dz);
    if (dist3 < obs.radius) { profile.fill(90); return; }
    const angR = Math.asin(Math.min(1, obs.radius / dist3)) / DEG;
    const az0 = dirToAzimuth(dx, dy);
    const el0 = Math.atan2(dz, d) / DEG;
    const halfW = Math.asin(Math.min(1, obs.radius / Math.max(d, obs.radius))) / DEG;
    const n = Math.max(4, Math.ceil(halfW));
    for (let i = 0; i <= n; i++) {
      const off = -halfW + (2 * halfW * i) / n;
      // 球体在方位 off 处的轮廓高度角
      const rel = halfW > 0 ? off / halfW : 0;
      const el = el0 + angR * Math.sqrt(Math.max(0, 1 - rel * rel));
      fillBin(profile, az0 + off, el);
    }
  }
}

function pointInRect(px: number, py: number, obs: Obstruction, c: number, s: number): boolean {
  const dx = px - obs.x, dy = py - obs.y;
  const lx = dx * c + dy * s;
  const ly = -dx * s + dy * c;
  return Math.abs(lx) <= obs.length / 2 && Math.abs(ly) <= obs.width / 2;
}

/** 太阳是否被轮廓遮挡 */
export function isShaded(profile: Float32Array, azimuthDeg: number, elevationDeg: number): boolean {
  return elevationDeg < profile[azToBin(azimuthDeg)];
}
