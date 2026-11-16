import { describe, it, expect } from 'vitest';
import { analyzeGlare } from '../src/engine/glare';
import { makeProject, createArray, createObserver } from './helpers';

describe('眩光分析', () => {
  it('正南朝向阵列:正南道路观察点在夏季正午反射最平时存在眩光事件', () => {
    const proj = makeProject();
    const arr = createArray(0, 0);
    arr.tilt = 30;
    arr.azimuth = 180;
    arr.rows = 2;
    arr.cols = 4;
    proj.arrays = [arr];
    // 远距离道路观察点,视线近似水平(工程眩光锥角阈值取 60°)
    const obv = createObserver(0, -120, 1.5);
    proj.observers = [obv];
    proj.settings.glareThresholdDeg = 60;

    const result = analyzeGlare(proj, obv.id);
    expect(result.events.length).toBeGreaterThan(0);
    // 事件应集中在夏季正午附近(太阳高,反射光最贴近水平指向南侧道路)
    const summerMonths = result.events.filter((e) => {
      const m = Number(e.timestamp.slice(5, 7));
      return m >= 5 && m <= 7;
    });
    expect(summerMonths.length).toBeGreaterThan(0);
    expect(result.totalHours).toBeCloseTo(result.events.length, 5);
    for (const e of result.events) {
      expect(e.angleDeg).toBeLessThanOrEqual(60 + 1e-9);
      expect(e.distance).toBeGreaterThan(100);
    }
  });

  it('阵列背面方向的观察点无正面反射事件', () => {
    const proj = makeProject();
    const arr = createArray(0, 0);
    arr.azimuth = 180;
    proj.arrays = [arr];
    const obv = createObserver(0, 80, 1.5); // 正北(背面)
    proj.observers = [obv];
    const result = analyzeGlare(proj, obv.id);
    expect(result.events.length).toBe(0);
  });

  it('视线遮挡:厂房挡在观察点与阵列之间时事件被标记 blocked', () => {
    const proj = makeProject();
    const arr = createArray(0, 0);
    arr.tilt = 30;
    arr.azimuth = 180;
    arr.rows = 1;
    arr.cols = 2;
    proj.arrays = [arr];
    const obv = createObserver(0, -120, 1.5);
    proj.observers = [obv];
    proj.settings.glareThresholdDeg = 60;
    // 宽厂房横在观察点(南)与阵列(原点)之间
    const bld = {
      id: 'b1', name: '挡光厂房', type: 'building' as const,
      position: { x: 0, y: -60, z: 0 },
      building: { width: 80, depth: 8, height: 12, rotation: 0 },
    };
    proj.obstacles = [bld];
    const result = analyzeGlare(proj, obv.id);
    expect(result.events.length).toBeGreaterThan(0);
    expect(result.events.every((e) => e.blocked)).toBe(true);
    expect(result.blockedHours).toBe(result.totalHours);
  });

  it('关闭视线检测后 blocked 全为 false', () => {
    const proj = makeProject();
    const arr = createArray(0, 0);
    arr.tilt = 30;
    arr.azimuth = 180;
    arr.rows = 1;
    arr.cols = 2;
    proj.arrays = [arr];
    const obv = createObserver(0, -60, 1.5);
    proj.observers = [obv];
    proj.settings.lineOfSightCheck = false;
    const result = analyzeGlare(proj, obv.id);
    expect(result.events.every((e) => !e.blocked)).toBe(true);
  });
});
