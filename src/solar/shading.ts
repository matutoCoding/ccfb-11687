/**
 * 全年逐时遮挡分析引擎。
 * 性能设计: 1000 块组件 × 全年逐时(约 4400 个日照时步) × 16 采样点
 * ≈ 7000 万次查表比较, 纯 JS 数秒内完成。
 */
import { Project, AppSettings } from '../types';
import { sunPosition, yearTimeSteps } from './sun';
import { arrayBasis, interRowShading, modulePoint } from './geometry';
import { addObstructionProfile, azToBin, AZ_BINS } from './horizon';

export interface AnnualShadingResult {
  rows: number;
  cols: number;
  timeStepMin: number;
  /** 每组件时间加权遮挡比例 0..1 */
  moduleTimeFrac: Float32Array;
  /** 每组件辐照加权遮挡损失 0..1(以入射角余弦为权重) */
  moduleIrrFrac: Float32Array;
  /** 阵列整体逐时步遮挡比例(辐照加权), 长度 = 日照时步数 */
  stepShadedFrac: Float32Array;
  /** 对应时步的 UTC 时间戳 */
  stepTimes: number[];
  /** 全年总日照时步数 */
  sunSteps: number;
  /** 计算耗时 ms */
  elapsedMs: number;
}

export function runAnnualShading(project: Project, settings: AppSettings): AnnualShadingResult {
  const t0 = performance.now();
  const cfg = project.array;
  const basis = arrayBasis(cfg.azimuth, cfg.tilt);
  const rows = cfg.rows, cols = cfg.modulesPerRow;
  const nMod = rows * cols;
  const N = Math.max(2, settings.sampleGrid);
  const nPts = N * N;
  const hasObs = project.obstructions.length > 0;
  const { lat, lon, timezone } = project.location;

  // 1. 预计算日照时步的太阳位置与入射角余弦
  const times = yearTimeSteps(settings.year, timezone, settings.timeStepMin);
  const sunTimes: number[] = [];
  const sunEl: number[] = [];
  const sunAz: number[] = [];
  const cosInc: number[] = [];
  const n = basis.normal;
  for (const t of times) {
    const sp = sunPosition(t, lat, lon);
    if (sp.elevation <= 0) continue;
    const elR = (sp.elevation * Math.PI) / 180;
    const azR = (sp.azimuth * Math.PI) / 180;
    const sx = -Math.sin(azR) * Math.cos(elR);
    const sy = -Math.cos(azR) * Math.cos(elR);
    const sz = Math.sin(elR);
    const ci = sx * n.x + sy * n.y + sz * n.z;
    sunTimes.push(t);
    sunEl.push(sp.elevation);
    sunAz.push(sp.azimuth);
    cosInc.push(Math.max(0, ci));
  }
  const nSteps = sunTimes.length;

  // 2. 预计算采样点世界坐标
  const ptsX = new Float32Array(nMod * nPts);
  const ptsY = new Float32Array(nMod * nPts);
  const ptsZ = new Float32Array(nMod * nPts);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const mi = r * cols + c;
      for (let iu = 0; iu < N; iu++) {
        for (let iv = 0; iv < N; iv++) {
          const u = (iu + 0.5) / N, v = (iv + 0.5) / N;
          const p = modulePoint(cfg, basis, r, c, u, v);
          const k = mi * nPts + iu * N + iv;
          ptsX[k] = p.x; ptsY[k] = p.y; ptsZ[k] = p.z;
        }
      }
    }
  }

  // 3. 障碍物遮挡轮廓 (nMod × nPts × 360)
  let profiles: Float32Array | null = null;
  if (hasObs) {
    profiles = new Float32Array(nMod * nPts * AZ_BINS);
    for (let k = 0; k < nMod * nPts; k++) {
      const prof = profiles.subarray(k * AZ_BINS, (k + 1) * AZ_BINS);
      const p = { x: ptsX[k], y: ptsY[k], z: ptsZ[k] };
      for (const obs of project.obstructions) addObstructionProfile(prof, p, obs);
    }
  }

  // 4. 主循环
  const shadedTime = new Float64Array(nMod);
  const shadedIrr = new Float64Array(nMod);
  const totIrr = new Float64Array(nMod);
  const stepShaded = new Float32Array(nSteps);
  const stepWeight = new Float64Array(nSteps);

  for (let s = 0; s < nSteps; s++) {
    const el = sunEl[s], az = sunAz[s], ci = cosInc[s];
    // 排间遮挡(第 0 排除外, 其余各排相同)
    const rowFrac = interRowShading(cfg, el, az);
    const bin = azToBin(az);
    let stepShadeSum = 0;
    if (profiles) {
      const base = s * 0; // (占位, 保持循环清晰)
      void base;
      for (let m = 0; m < nMod; m++) {
        const isFrontRow = m < cols;
        const rf = isFrontRow ? 0 : rowFrac;
        // 障碍物遮挡: 采样点查表
        let shadedPts = 0;
        const pBase = m * nPts * AZ_BINS + bin;
        for (let k = 0; k < nPts; k++) {
          if (el < profiles[pBase + k * AZ_BINS]) shadedPts++;
        }
        const of = shadedPts / nPts;
        const frac = 1 - (1 - rf) * (1 - of);
        shadedTime[m] += frac;
        shadedIrr[m] += frac * ci;
        totIrr[m] += ci;
        stepShadeSum += frac * ci;
      }
    } else {
      for (let m = 0; m < nMod; m++) {
        const frac = m < cols ? 0 : rowFrac;
        shadedTime[m] += frac;
        shadedIrr[m] += frac * ci;
        totIrr[m] += ci;
        stepShadeSum += frac * ci;
      }
    }
    stepShaded[s] = ci > 0 ? stepShadeSum / (ci * nMod) : 0;
    stepWeight[s] = ci;
  }

  const moduleTimeFrac = new Float32Array(nMod);
  const moduleIrrFrac = new Float32Array(nMod);
  for (let m = 0; m < nMod; m++) {
    moduleTimeFrac[m] = shadedTime[m] / nSteps;
    moduleIrrFrac[m] = totIrr[m] > 0 ? shadedIrr[m] / totIrr[m] : 0;
  }

  return {
    rows, cols,
    timeStepMin: settings.timeStepMin,
    moduleTimeFrac,
    moduleIrrFrac,
    stepShadedFrac: stepShaded,
    stepTimes: sunTimes,
    sunSteps: nSteps,
    elapsedMs: performance.now() - t0,
  };
}
