import { describe, it, expect } from 'vitest';
import { solarPosition } from '../src/engine/solar';
import {
  poleShadowLengthEngine,
  poleShadowLengthFormula,
  computeShadingFractions,
} from '../src/engine/shadow';
import { buildModules } from '../src/engine/layout';
import { createArray, createObstacle, SOLAR_NOON_HOUR } from './helpers';

const BJ = { latitude: 39.9042, longitude: 116.4074, utcOffset: 8 };

function sunAt(month: number, day: number, hour: number, year = 2025) {
  return solarPosition({ year, month, day, localHour: hour, ...BJ }).sunVector;
}

describe('单杆影长精度(手算三角函数对照,要求 <1%)', () => {
  const heights = [5, 10, 18];
  const cases: [number, number, number][] = [
    [12, 21, SOLAR_NOON_HOUR], [12, 21, 10], [6, 21, 9], [3, 20, 15], [9, 23, 13.5],
  ];

  for (const h of heights) {
    for (const [m, d, hr] of cases) {
      it(`杆高 ${h}m @ ${m}-${d} ${hr}:00`, () => {
        const sp = solarPosition({ year: 2025, month: m, day: d, localHour: hr, ...BJ });
        const formula = poleShadowLengthFormula(h, sp.elevation);
        const engine = poleShadowLengthEngine(h, sp.sunVector);
        const relErr = Math.abs(engine - formula) / formula;
        expect(relErr).toBeLessThan(0.01); // <1% 验收线
        expect(relErr).toBeLessThan(1e-12); // 实际同源,误差仅浮点舍入
      });
    }
  }

  it('低太阳高度角(5°)长阴影仍满足精度', () => {
    const elev = 5;
    const s = { x: Math.cos((elev * Math.PI) / 180), y: 0, z: Math.sin((elev * Math.PI) / 180) };
    const formula = poleShadowLengthFormula(10, elev);
    const engine = poleShadowLengthEngine(10, s);
    expect(Math.abs(engine - formula) / formula).toBeLessThan(1e-12);
  });
});

describe('组件遮挡比例', () => {
  it('无遮挡物时全部为 0', () => {
    const arr = createArray(0, 0);
    const mods = buildModules([arr]);
    const { fractions } = computeShadingFractions(mods, [arr], [], sunAt(6, 21, SOLAR_NOON_HOUR), 64);
    for (const f of fractions) expect(f).toBe(0);
  });

  it('立杆阴影:解析胶囊面积与引擎一致(凸包离散 <1%)', () => {
    const arr = createArray(0, 0);
    arr.tilt = 0;
    arr.rows = 1;
    arr.cols = 1;
    arr.moduleWidth = 60;
    arr.moduleHeight = 60;
    arr.mountHeight = 2;

    const pole = createObstacle('pole', 0, 0);
    pole.pole = { radius: 0.2, height: 10 };

    // 真太阳正午:阴影水平投向正北。用引擎影长把杆放到板中心,
    // 大板(60m)足以容纳完整胶囊(影长约 20m)。
    const s = sunAt(12, 21, SOLAR_NOON_HOUR);
    const shadowLen = poleShadowLengthEngine(10, s);
    const hlen = Math.hypot(s.x, s.y);
    const dir = { x: -s.x / hlen, y: -s.y / hlen };
    pole.position = { x: -dir.x * shadowLen / 2, y: -dir.y * shadowLen / 2, z: 0 };

    // 独立解析:圆柱阴影为胶囊 = 矩形(2r·L) + 两端半圆(πr²)
    const r = 0.2;
    const capsuleArea = 2 * r * shadowLen + Math.PI * r * r;

    const mods = buildModules([arr]);
    const { fractions } = computeShadingFractions(mods, [arr], [pole], s, 64);
    expect(fractions[0]).toBeGreaterThan(0);
    const gotArea = fractions[0] * 60 * 60;
    expect(Math.abs(gotArea - capsuleArea) / capsuleArea).toBeLessThan(0.01);
  });

  it('厂房阴影完全覆盖组件时遮挡比例 = 1', () => {
    const arr = createArray(0, 0);
    arr.tilt = 0;
    arr.rows = 1;
    arr.cols = 1;
    arr.moduleWidth = 4;
    arr.moduleHeight = 4;
    arr.mountHeight = 1;
    const bld = createObstacle('building', 0, 0);
    bld.building = { width: 40, depth: 20, height: 12, rotation: 0 };
    // 真太阳正午把厂房放在组件南侧,使其投影完全覆盖
    const s = sunAt(12, 21, SOLAR_NOON_HOUR);
    const hlen = Math.hypot(s.x, s.y);
    const dir = { x: -s.x / hlen, y: -s.y / hlen };
    bld.position = { x: -dir.x * 15, y: -dir.y * 15, z: 0 };
    const mods = buildModules([arr]);
    const { fractions } = computeShadingFractions(mods, [arr], [bld], s, 64);
    expect(fractions[0]).toBeCloseTo(1, 6);
  });

  it('夜间/太阳背面:遮挡比例为 0 且不崩溃', () => {
    const arr = createArray(0, 0);
    const bld = createObstacle('building', 0, 10);
    const mods = buildModules([arr]);
    const night = { x: 0.2, y: 0.3, z: -0.1 };
    const r1 = computeShadingFractions(mods, [arr], [bld], night, 64);
    for (const f of r1.fractions) expect(f).toBe(0);
    // 倾斜板(朝南,法线含 +y 分量):太阳从北侧低处照到背面
    const tilted = { ...arr, tilt: 30, azimuth: 180 };
    const modsT = buildModules([tilted]);
    const back = { x: 0, y: 1, z: 0.05 }; // 北向低太阳,与朝南法线点积为负
    const r2 = computeShadingFractions(modsT, [tilted], [bld], back, 64);
    for (const f of r2.fractions) expect(f).toBe(0);
  });

  it('前后排自遮挡:窄行距有遮挡,加宽到临界值以上无遮挡', async () => {
    const { computeMinRowPitch } = await import('../src/engine/rowspacing');
    const arr = createArray(0, 0);
    arr.tilt = 35;
    arr.rows = 3;
    arr.cols = 2;
    const s = sunAt(12, 21, 10);

    // 该时刻临界行距由行距引擎给出
    const crit = computeMinRowPitch(arr, 39.9042, 116.4074, 8, 2025, 10, 10, 30);
    const narrow = { ...arr, rowPitch: crit.minPitch * 0.6 };
    const wide = { ...arr, rowPitch: crit.minPitch * 1.25 };

    const modsN = buildModules([narrow]);
    const rN = computeShadingFractions(modsN, [narrow], [], s, 64);
    expect(rN.fractions.filter((_, i) => modsN[i].row > 0).some((f) => f > 0.01)).toBe(true);

    const modsW = buildModules([wide]);
    const rW = computeShadingFractions(modsW, [wide], [], s, 64);
    for (const f of rW.fractions) expect(f).toBeLessThan(1e-6);
  });
});
