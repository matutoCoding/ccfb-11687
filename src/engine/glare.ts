/**
 * 眩光分析:从指定观察点出发,全年逐时判断哪些组件的镜面反射光会进入视线。
 *
 * 物理模型:太阳方向 s(指向太阳),组件法线 n(单位),
 * 镜面反射方向 r = s - 2(s·n)n(指向反射光去向)。
 * 观察点 P,组件中心 C,视线 d = norm(P-C)。r 与 d 夹角 ≤ 阈值角即记一次眩光事件;
 * 可选:若 P 与组件之间存在厂房/树木遮挡,事件标记 blocked(视线检测)。
 */
import type { GlareEvent, GlareResult, Project } from '../types';
import { v3 } from './geometry';
import { obstacleGroundFootprint, obstacleTopZ } from './casters';
import { buildModules } from './layout';
import { solarPosition, yearlyTimesteps } from './solar';

const DEG2RAD = Math.PI / 180;

/**
 * 镜面反射光去向方向。s 为指向太阳的单位向量,反射光从组件射向远方:
 * r = 2(s·n)n - s(标准反射公式对"指向光源"约定的去向形式)。
 */
function reflect(s: { x: number; y: number; z: number }, n: { x: number; y: number; z: number }) {
  const k = 2 * (s.x * n.x + s.y * n.y + s.z * n.z);
  return { x: k * n.x - s.x, y: k * n.y - s.y, z: k * n.z - s.z };
}

/** 线段 P->Q 是否与某遮挡物(竖直柱体,顶面水平)相交 */
function segmentBlocked(
  px: number, py: number, pz: number,
  qx: number, qy: number, qz: number,
  foot: { x: number; y: number }[],
  topZ: number,
): boolean {
  // 1. 包围盒快速排除
  let minX = Infinity; let maxX = -Infinity; let minY = Infinity; let maxY = -Infinity;
  for (const p of foot) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  const loX = Math.min(px, qx); const hiX = Math.max(px, qx);
  const loY = Math.min(py, qy); const hiY = Math.max(py, qy);
  if (hiX < minX || loX > maxX || hiY < minY || loY > maxY) return false;

  // 2. 沿线段按高度 <= topZ 的部分做多边形包含测试
  const dz = qz - pz;
  const zLo = Math.max(0, Math.min(pz, qz));
  const zHi = Math.min(topZ, Math.max(pz, qz));
  if (zHi < zLo) return false;
  const t0 = dz === 0 ? 0 : (zLo - pz) / dz;
  const t1 = dz === 0 ? 1 : (zHi - pz) / dz;
  const samples = 6;
  for (let i = 0; i <= samples; i++) {
    const t = t0 + ((t1 - t0) * i) / samples;
    const x = px + (qx - px) * t;
    const y = py + (qy - py) * t;
    if (pointInPoly(foot, x, y)) return true;
  }
  return false;
}

function pointInPoly(poly: { x: number; y: number }[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x; const yi = poly[i].y;
    const xj = poly[j].x; const yj = poly[j].y;
    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export interface GlareProgress {
  done: number;
  total: number;
}

export function analyzeGlare(
  project: Project,
  observerId: string,
  onProgress?: (p: GlareProgress) => void,
): GlareResult {
  const observer = project.observers.find((o) => o.id === observerId);
  if (!observer) throw new Error(`观察点不存在: ${observerId}`);

  const { site, arrays, obstacles, settings } = project;
  const modules = buildModules(arrays);
  const cosThreshold = Math.cos(settings.glareThresholdDeg * DEG2RAD);
  const events: GlareEvent[] = [];
  const blockerData = settings.lineOfSightCheck
    ? obstacles.map((o) => ({
        feet: obstacleGroundFootprint(o),
        topZ: obstacleTopZ(o),
      }))
    : [];

  const steps = Array.from(yearlyTimesteps(site.year, settings.timeStepMinutes as 60 | 30));
  let processed = 0;

  for (const step of steps) {
    processed++;
    const sp = solarPosition({
      year: site.year,
      month: step.month,
      day: step.day,
      localHour: step.localHour,
      latitude: site.latitude,
      longitude: site.longitude,
      utcOffset: site.utcOffset,
      withRefraction: settings.useRefraction,
    });
    if (!sp.isDaytime) {
      if (onProgress && processed % 100 === 0) onProgress({ done: processed, total: steps.length });
      continue;
    }
    const s = sp.sunVector;

    for (const m of modules) {
      const front = s.x * m.normal.x + s.y * m.normal.y + s.z * m.normal.z;
      if (front <= 1e-6) continue; // 太阳照在组件背面,无正面反射
      const r = reflect(s, m.normal);
      const d = v3.sub(observer.position, m.center);
      const dist = v3.len(d);
      const dn = v3.norm(d);
      const cosAng = r.x * dn.x + r.y * dn.y + r.z * dn.z;
      if (cosAng < cosThreshold) continue;
      const angleDeg = Math.acos(Math.min(1, cosAng)) / DEG2RAD;

      let blocked = false;
      if (settings.lineOfSightCheck) {
        for (const b of blockerData) {
          for (const foot of b.feet) {
            if (
              segmentBlocked(
                observer.position.x, observer.position.y, observer.position.z,
                m.center.x, m.center.y, m.center.z,
                foot.pts, b.topZ,
              )
            ) {
              blocked = true;
              break;
            }
          }
          if (blocked) break;
        }
      }

      const hourInt = Math.floor(step.localHour);
      const minute = Math.round((step.localHour - hourInt) * 60);
      events.push({
        timestamp: `${site.year}-${pad(step.month)}-${pad(step.day)}T${pad(hourInt)}:${pad(minute)}`,
        dateLabel: `${pad(step.month)}-${pad(step.day)}`,
        hourLabel: `${pad(hourInt)}:${pad(minute)}`,
        moduleId: m.id,
        arrayId: m.arrayId,
        angleDeg: round2(angleDeg),
        distance: round2(dist),
        blocked,
      });
    }
    if (onProgress && processed % 50 === 0) onProgress({ done: processed, total: steps.length });
  }
  onProgress?.({ done: steps.length, total: steps.length });

  const stepHours = settings.timeStepMinutes / 60;
  const totalHours = events.length * stepHours;
  const blockedHours = events.filter((e) => e.blocked).length * stepHours;
  return {
    observerId,
    observerName: observer.name,
    events: events.sort((a, b) => a.timestamp.localeCompare(b.timestamp)),
    totalHours,
    blockedHours,
  };
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
