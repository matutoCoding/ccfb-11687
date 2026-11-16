/**
 * 全年逐时遮挡聚合:对一年所有白天时间步逐组件求遮挡比例,
 * 汇总为全年均值与 12 个月均值(热力图与 CSV 数据源)。
 * 纯计算、无 DOM,可在主线程或 Worker 中运行。
 */
import type { MonthlyShading, Project } from '../types';
import { buildModules } from './layout';
import { computeShadingFractionsCtx, createShadingContext } from './shadow';
import { solarPosition, yearlyTimesteps } from './solar';

export interface AnnualProgress {
  done: number;
  total: number;
}

export interface AnnualResult {
  modules: MonthlyShading[];
  totalDaylightSamples: number;
  totalSamples: number;
}

export function analyzeAnnualShading(
  project: Project,
  onProgress?: (p: AnnualProgress) => void,
): AnnualResult {
  const { site, arrays, obstacles, settings } = project;
  const modules = buildModules(arrays);
  const ctx = createShadingContext(modules, arrays, obstacles);
  const n = modules.length;

  const annualSum = new Float64Array(n);
  const monthlySum = Array.from({ length: 12 }, () => new Float64Array(n));
  const monthlyCount = new Uint32Array(12);
  let daylight = 0;

  const steps = Array.from(yearlyTimesteps(site.year, settings.timeStepMinutes as 60 | 30));
  let processed = 0;

  for (const step of steps) {
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
    processed++;
    if (!sp.isDaytime) continue;
    daylight++;
    monthlyCount[step.month - 1]++;

    const { fractions } = computeShadingFractionsCtx(
      ctx,
      sp.sunVector,
      settings.shadowGridSize,
    );
    for (let i = 0; i < n; i++) {
      annualSum[i] += fractions[i];
      monthlySum[step.month - 1][i] += fractions[i];
    }
    if (onProgress && (processed % 50 === 0 || processed === steps.length)) {
      onProgress({ done: processed, total: steps.length });
    }
  }

  const result: MonthlyShading[] = modules.map((m, i) => ({
    moduleId: m.id,
    annualMean: daylight > 0 ? annualSum[i] / daylight : 0,
    monthly: monthlySum.map((arr, mi) =>
      monthlyCount[mi] > 0 ? arr[i] / monthlyCount[mi] : 0,
    ),
    daylightSamples: daylight,
  }));

  return { modules: result, totalDaylightSamples: daylight, totalSamples: processed };
}
