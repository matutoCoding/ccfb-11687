/**
 * 眩光分析: 对全年每个时步, 计算各组件反射光线是否射向观察点。
 * 反射向量 r = 2(s·n)n − s (s 为指向太阳的单位向量, n 为组件法线)。
 * 当 r 与 (观察点−组件) 方向夹角小于阈值, 且太阳在组件正面、观察点在组件前方时, 判定为眩光。
 */
import { Project, AppSettings } from '../types';
import { sunPosition, yearTimeSteps } from './sun';
import { arrayBasis, moduleCenter } from './geometry';

export interface GlareEvent {
  /** UTC 时间戳 */
  time: number;
  /** 产生眩光的组件数 */
  moduleCount: number;
  /** 最小夹角(度) */
  minAngleDeg: number;
}

export interface GlareDayWindow {
  date: string;      // YYYY-MM-DD (当地)
  start: string;     // HH:MM
  end: string;
  minutes: number;
  peakModules: number;
}

export interface GlareResult {
  events: GlareEvent[];
  windows: GlareDayWindow[];
  elapsedMs: number;
}

export function runGlareAnalysis(project: Project, settings: AppSettings): GlareResult {
  const t0 = performance.now();
  const cfg = project.array;
  const basis = arrayBasis(cfg.azimuth, cfg.tilt);
  const n = basis.normal;
  const rows = cfg.rows, cols = cfg.modulesPerRow;
  const nMod = rows * cols;
  const { lat, lon, timezone } = project.location;
  const obs = project.observer;
  const cosThresh = Math.cos((settings.glareAngleDeg * Math.PI) / 180);

  // 预计算组件中心与指向观察点的向量
  const vx = new Float32Array(nMod), vy = new Float32Array(nMod), vz = new Float32Array(nMod);
  const vlen = new Float32Array(nMod);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const m = moduleCenter(cfg, basis, r, c);
      const i = r * cols + c;
      const dx = obs.x - m.x, dy = obs.y - m.y, dz = obs.z - m.z;
      const len = Math.hypot(dx, dy, dz) || 1e-6;
      vx[i] = dx / len; vy[i] = dy / len; vz[i] = dz / len;
      vlen[i] = len;
    }
  }

  const times = yearTimeSteps(settings.year, timezone, settings.timeStepMin);
  const events: GlareEvent[] = [];
  const DEG = Math.PI / 180;

  for (const t of times) {
    const sp = sunPosition(t, lat, lon);
    if (sp.elevation <= 0) continue;
    const elR = sp.elevation * DEG, azR = sp.azimuth * DEG;
    const sx = -Math.sin(azR) * Math.cos(elR);
    const sy = -Math.cos(azR) * Math.cos(elR);
    const sz = Math.sin(elR);
    const sdn = sx * n.x + sy * n.y + sz * n.z;
    if (sdn <= 0) continue; // 太阳在组件背面
    // 反射向量
    const rx = 2 * sdn * n.x - sx;
    const ry = 2 * sdn * n.y - sy;
    const rz = 2 * sdn * n.z - sz;
    let count = 0;
    let maxCos = -1;
    for (let i = 0; i < nMod; i++) {
      // 观察点须在组件前方
      if (vx[i] * n.x + vy[i] * n.y + vz[i] * n.z <= 0) continue;
      const cosA = rx * vx[i] + ry * vy[i] + rz * vz[i];
      if (cosA > cosThresh) {
        count++;
        if (cosA > maxCos) maxCos = cosA;
      }
    }
    if (count > 0) {
      events.push({
        time: t,
        moduleCount: count,
        minAngleDeg: Math.acos(Math.min(1, maxCos)) / DEG,
      });
    }
  }

  // 合并为每日时间窗
  const windows: GlareDayWindow[] = [];
  const stepMs = settings.timeStepMin * 60000;
  let cur: GlareDayWindow | null = null;
  let lastTime = 0;
  for (const ev of events) {
    const local = new Date(ev.time + timezone * 3600000);
    const date = local.toISOString().slice(0, 10);
    const hh = String(local.getUTCHours()).padStart(2, '0');
    const mm = String(local.getUTCMinutes()).padStart(2, '0');
    const label = `${hh}:${mm}`;
    if (cur && cur.date === date && ev.time - lastTime <= stepMs * 1.5) {
      cur.end = label;
      cur.minutes += settings.timeStepMin;
      cur.peakModules = Math.max(cur.peakModules, ev.moduleCount);
    } else {
      if (cur) windows.push(cur);
      cur = { date, start: label, end: label, minutes: settings.timeStepMin, peakModules: ev.moduleCount };
    }
    lastTime = ev.time;
  }
  if (cur) windows.push(cur);

  return { events, windows, elapsedMs: performance.now() - t0 };
}
