/**
 * 冬至日(北半球 12-21 / 南半球 6-21)9:00–15:00
 * 前后排不遮挡的最小行距自动计算。
 *
 * 方法:直接复用阴影引擎 computeShadingFractions 做遮挡判定,
 * 对每个时刻二分搜索后排组件遮挡比例降为 0 的临界行距,对时间窗取最大值。
 * 因与逐时阴影分析共用同一几何内核,行距结果与热力图/实时阴影严格自洽。
 *
 * 工程三角公式(对照):
 *   D = h·cos(az_s-az_m)/tan(α),行距 = D + H·cos(β),h = H·sin β
 */
import type { PVArrayConfig } from '../types';
import { buildModules } from './layout';
import { computeShadingFractions } from './shadow';
import { solarPosition } from './solar';

const DEG2RAD = Math.PI / 180;
const SHADE_EPS = 1e-6;

export interface RowSpacingResult {
  minPitch: number;
  formulaPitch: number;
  worstTime: string;
  worstElevation: number;
  worstAzimuth: number;
  steps: { time: string; elevation: number; azimuth: number; requiredPitch: number; formulaPitch: number }[];
}

function winterSolstice(latitude: number): { month: number; day: number } {
  return latitude >= 0 ? { month: 12, day: 21 } : { month: 6, day: 21 };
}

export function computeMinRowPitch(
  arr: PVArrayConfig,
  latitude: number,
  longitude: number,
  utcOffset: number,
  year: number,
  startHour = 9,
  endHour = 15,
  minuteStep = 30,
): RowSpacingResult {
  const { month, day } = winterSolstice(latitude);
  const H = arr.moduleHeight;
  const beta = arr.tilt * DEG2RAD;

  // 用于判定的最小阵列:2 排 1 列即可体现前后排关系
  const probe: PVArrayConfig = { ...arr, rows: 2, cols: 1 };

  const steps: RowSpacingResult['steps'] = [];
  let maxPitch = 0;
  let maxFormula = 0;
  let worst = { time: '', elevation: 0, azimuth: 0 };

  const backRowShaded = (pitch: number, s: { x: number; y: number; z: number }): boolean => {
    const cfg = { ...probe, rowPitch: pitch };
    const mods = buildModules([cfg]);
    const { fractions } = computeShadingFractions(mods, [cfg], [], s, 32);
    // 后排(row===1)任一组件被挡即视为遮挡
    for (let i = 0; i < mods.length; i++) {
      if (mods[i].row === 1 && fractions[i] > SHADE_EPS) return true;
    }
    return false;
  };

  for (let mins = startHour * 60; mins <= endHour * 60; mins += minuteStep) {
    const localHour = mins / 60;
    const sp = solarPosition({ year, month, day, localHour, latitude, longitude, utcOffset });
    if (!sp.isDaytime) continue;
    const s = sp.sunVector;

    let pitch = 0;
    if (backRowShaded(0, s)) {
      let lo = 0;
      let hi = 50;
      for (let guard = 0; guard < 36; guard++) {
        const mid = (lo + hi) / 2;
        if (backRowShaded(mid, s)) lo = mid;
        else hi = mid;
        if (hi - lo < 1e-4) break;
      }
      pitch = hi;
    }

    const gamma = (sp.azimuth - arr.azimuth) * DEG2RAD;
    const alpha = sp.elevation * DEG2RAD;
    const h = H * Math.sin(beta);
    const formula = (h * Math.cos(gamma)) / Math.tan(alpha) + H * Math.cos(beta);

    steps.push({
      time: `${pad(Math.floor(localHour))}:${pad(Math.round((localHour % 1) * 60))}`,
      elevation: round3(sp.elevation),
      azimuth: round3(sp.azimuth),
      requiredPitch: round3(pitch),
      formulaPitch: round3(formula),
    });
    if (pitch > maxPitch) {
      maxPitch = pitch;
      worst = { time: steps[steps.length - 1].time, elevation: sp.elevation, azimuth: sp.azimuth };
    }
    if (formula > maxFormula) maxFormula = formula;
  }

  return {
    minPitch: round3(maxPitch),
    formulaPitch: round3(maxFormula),
    worstTime: worst.time,
    worstElevation: round3(worst.elevation),
    worstAzimuth: round3(worst.azimuth),
    steps,
  };
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
