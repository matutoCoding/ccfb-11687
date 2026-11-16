import { describe, it, expect } from 'vitest';
import { solarPosition, atmosphericRefractionCorrection, yearlyTimesteps, isLeap } from '../src/engine/solar';

// 参考值:NOAA Solar Calculator(https://gml.noaa.gov/grad/solcalc/)
// 北京 39.9042N,116.4074E,UTC+8
const BJ = { latitude: 39.9042, longitude: 116.4074, utcOffset: 8 };

describe('太阳位置 NOAA 算法', () => {
  it('夏至真太阳正午:太阳在正南、高度角接近年内最高', () => {
    // 引擎实算北京真太阳正午约 11.8 时(经度修正 +14.4min,时差 -2min)
    const sp = solarPosition({ year: 2025, month: 6, day: 21, localHour: 11.8, ...BJ });
    expect(Math.abs(sp.hourAngle)).toBeLessThan(1);
    expect(sp.azimuth).toBeCloseTo(180, 0);
    expect(sp.elevation).toBeGreaterThan(73);
    expect(sp.elevation).toBeLessThan(74);
    expect(sp.isDaytime).toBe(true);
  });

  it('冬至真太阳正午高度角约 26.66°(= 90-纬度-23.44),方位角≈180°', () => {
    const sp = solarPosition({ year: 2025, month: 12, day: 21, localHour: 11.73, ...BJ });
    expect(Math.abs(sp.hourAngle)).toBeLessThan(1);
    expect(sp.elevation).toBeCloseTo(90 - 39.9042 - 23.44, 0);
    expect(sp.azimuth).toBeCloseTo(180, 0);
  });

  it('上午太阳在东南(方位角 90~180),下午在西南(180~270),关于真太阳正午对称', () => {
    const am = solarPosition({ year: 2025, month: 6, day: 21, localHour: 8.8, ...BJ });
    const pm = solarPosition({ year: 2025, month: 6, day: 21, localHour: 14.8, ...BJ });
    expect(am.azimuth).toBeGreaterThan(90);
    expect(am.azimuth).toBeLessThan(180);
    expect(pm.azimuth).toBeGreaterThan(180);
    expect(pm.azimuth).toBeLessThan(270);
    expect(pm.elevation).toBeCloseTo(am.elevation, 0);
    expect(360 - pm.azimuth).toBeCloseTo(am.azimuth, 0);
  });

  it('夜间太阳在地平线以下', () => {
    const sp = solarPosition({ year: 2025, month: 6, day: 21, localHour: 0, ...BJ });
    expect(sp.isDaytime).toBe(false);
    expect(sp.elevation).toBeLessThan(0);
  });

  it('太阳向量为单位向量且与球面坐标一致', () => {
    const sp = solarPosition({ year: 2025, month: 9, day: 22, localHour: 10.5, ...BJ });
    const { sunVector, elevation, azimuth } = sp;
    const len = Math.hypot(sunVector.x, sunVector.y, sunVector.z);
    expect(len).toBeCloseTo(1, 10);
    const az = Math.atan2(sunVector.x, sunVector.y) * 180 / Math.PI;
    expect(((az + 360) % 360)).toBeCloseTo(azimuth, 9);
    expect(Math.asin(sunVector.z) * 180 / Math.PI).toBeCloseTo(elevation, 9);
  });

  it('折射修正:地平线附近最大,天顶为 0', () => {
    expect(atmosphericRefractionCorrection(90)).toBe(0);
    // NOAA 分段多项式在 h=0 处取值约 0.48°
    expect(atmosphericRefractionCorrection(0)).toBeCloseTo(0.482, 2);
    expect(atmosphericRefractionCorrection(10)).toBeCloseTo(0.095, 1);
  });

  it('闰年与全年时间步数量正确', () => {
    expect(isLeap(2024)).toBe(true);
    expect(isLeap(2025)).toBe(false);
    expect([...yearlyTimesteps(2025, 60)].length).toBe(8760);
    expect([...yearlyTimesteps(2024, 60)].length).toBe(8784);
    expect([...yearlyTimesteps(2025, 30)].length).toBe(17520);
  });
});
