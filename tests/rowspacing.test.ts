import { describe, it, expect } from 'vitest';
import { computeMinRowPitch } from '../src/engine/rowspacing';
import { createArray } from './helpers';

describe('冬至日最小行距', () => {
  const arr = createArray(0, 0);
  arr.tilt = 30;
  arr.azimuth = 180;
  arr.moduleHeight = 1.1;
  arr.mountHeight = 0.5;

  const r = computeMinRowPitch(arr, 39.9, 116.4, 8, 2025);

  it('返回时间窗内逐时结果且最不利时刻在窗口边缘(太阳高度最低)', () => {
    expect(r.steps.length).toBeGreaterThan(10);
    expect(r.minPitch).toBeGreaterThan(0);
    // 太阳高度角在 9 点/15 点最低,所需行距最大
    expect(['09:00', '15:00']).toContain(r.worstTime);
    // 行距随太阳降低而增大:边缘时刻 ≥ 正午时刻
    const noon = r.steps.find((s) => s.time === '12:00')!;
    const edge = r.steps.find((s) => s.time === '15:00')!;
    expect(edge.requiredPitch).toBeGreaterThanOrEqual(noon.requiredPitch);
  });

  it('3D 精确模型与三角公式结果差异 <2%(同一几何的独立表达,高度一致)', () => {
    const diff = Math.abs(r.minPitch - r.formulaPitch) / r.formulaPitch;
    expect(diff).toBeLessThan(0.02);
  });

  it('按计算行距布置时,9-15 点后排组件无遮挡(引擎交叉验证)', async () => {
    const { solarPosition } = await import('../src/engine/solar');
    const { buildModules } = await import('../src/engine/layout');
    const { computeShadingFractions } = await import('../src/engine/shadow');

    const placed = { ...arr, rows: 3, cols: 4, rowPitch: r.minPitch + 0.001 };
    const mods = buildModules([placed]);
    for (let h = 9; h <= 15; h += 0.5) {
      const sp = solarPosition({
        year: 2025, month: 12, day: 21, localHour: h,
        latitude: 39.9, longitude: 116.4, utcOffset: 8,
      });
      if (!sp.isDaytime) continue;
      const { fractions } = computeShadingFractions(mods, [placed], [], sp.sunVector, 64);
      for (let i = 0; i < fractions.length; i++) {
        expect(fractions[i]).toBeLessThan(1e-6);
      }
    }
  });

  it('行距再减 5% 时至少一个时刻出现遮挡(说明结果确为最小临界值)', async () => {
    const { solarPosition } = await import('../src/engine/solar');
    const { buildModules } = await import('../src/engine/layout');
    const { computeShadingFractions } = await import('../src/engine/shadow');

    const placed = { ...arr, rows: 2, cols: 2, rowPitch: r.minPitch * 0.95 };
    const mods = buildModules([placed]);
    let anyShadow = false;
    for (let h = 9; h <= 15; h += 0.5) {
      const sp = solarPosition({
        year: 2025, month: 12, day: 21, localHour: h,
        latitude: 39.9, longitude: 116.4, utcOffset: 8,
      });
      if (!sp.isDaytime) continue;
      const { fractions } = computeShadingFractions(mods, [placed], [], sp.sunVector, 64);
      if (Array.from(fractions).some((f) => f > 1e-6)) anyShadow = true;
    }
    expect(anyShadow).toBe(true);
  });

  it('倾角越大所需行距越大', () => {
    const a40 = { ...arr, tilt: 40 };
    const r40 = computeMinRowPitch(a40, 39.9, 116.4, 8, 2025);
    expect(r40.minPitch).toBeGreaterThan(r.minPitch);
  });
});
