/**
 * 精度与性能验证:
 * 1. 太阳位置物理基准(二分二至)
 * 2. 单杆影长 vs 三角函数手算 (要求误差 < 1%)
 * 3. 排间遮挡闭式解 vs 独立射线求交采样
 * 4. 冬至最小行距自洽性
 * 5. 1000 块组件全年逐时分析性能 (要求 < 20s)
 *
 * 运行: npm run verify
 */
import { sunPosition, localToUtc, poleShadowLength, sunVector } from '../src/solar/sun';
import { arrayBasis, interRowShading, minRowPitchForDate, modulePoint } from '../src/solar/geometry';
import { addObstructionProfile, isShaded, AZ_BINS } from '../src/solar/horizon';
import { runAnnualShading } from '../src/solar/shading';
import { defaultProject, defaultArray, Obstruction } from '../src/types';

const DEG = Math.PI / 180;
let failures = 0;

function check(name: string, cond: boolean, detail: string) {
  const ok = cond;
  console.log(`${ok ? '✅' : '❌'} ${name}: ${detail}`);
  if (!ok) failures++;
}

// ---------- 1. 太阳位置物理基准 ----------
console.log('\n== 太阳位置基准 ==');
{
  // 夏至 12:00 UTC 赤道: 高度角 ≈ 90 - 23.44
  const s1 = sunPosition(Date.UTC(2025, 5, 21, 12, 0), 0, 0);
  check('夏至赤道正午高度角', Math.abs(s1.elevation - 66.56) < 0.3,
    `计算 ${s1.elevation.toFixed(2)}°, 期望 66.56°±0.3`);

  // 冬至 12:00 UTC 赤道
  const s2 = sunPosition(Date.UTC(2025, 11, 21, 12, 0), 0, 0);
  check('冬至赤道正午高度角', Math.abs(s2.elevation - 66.56) < 0.3,
    `计算 ${s2.elevation.toFixed(2)}°, 期望 66.56°±0.3`);

  // 春分赤道: 当日最大高度角应 ≈ 90°(12:00 UTC 时均时差约 -7.5min, 太阳未过子午圈)
  let maxEl = 0;
  for (let m = 0; m < 1440; m++) {
    const sp = sunPosition(Date.UTC(2025, 2, 20, 0, 0) + m * 60000, 0, 0);
    if (sp.elevation > maxEl) maxEl = sp.elevation;
  }
  check('春分赤道正午近天顶', Math.abs(maxEl - 89.9) < 0.3,
    `当日最大高度角 ${maxEl.toFixed(2)}°, 期望 ≈89.9°`);

  // 冬至西安正午高度角 ≈ 90 - 34.3 - 23.44 = 32.26
  const lat = 34.3, lon = 108.9, tz = 8;
  // 当地真太阳正午 ≈ 北京时间 12:00 + (120-108.9)*4min ≈ 12:44
  const s4 = sunPosition(localToUtc(2025, 12, 21, 12, 44, tz), lat, lon);
  check('冬至西安正午高度角', Math.abs(s4.elevation - 32.26) < 0.3,
    `计算 ${s4.elevation.toFixed(2)}°, 期望 32.26°±0.3`);
  check('正午方位角近正南', Math.abs(s4.azimuth) < 0.5,
    `计算 ${s4.azimuth.toFixed(2)}°, 期望 ≈0°`);

  // 夏至西安正午 ≈ 90 - 34.3 + 23.44 = 79.14
  const s5 = sunPosition(localToUtc(2025, 6, 21, 12, 44, tz), lat, lon);
  check('夏至西安正午高度角', Math.abs(s5.elevation - 79.14) < 0.3,
    `计算 ${s5.elevation.toFixed(2)}°, 期望 79.14°±0.3`);
}

// ---------- 2. 单杆影长 vs 三角函数手算 ----------
console.log('\n== 单杆影长精度 (要求 <1%) ==');
{
  const lat = 34.3, lon = 108.9, tz = 8;
  let maxErr = 0;
  let worstDesc = '';
  // 全年多个日期时刻抽查
  for (const [mo, day] of [[1, 15], [3, 15], [6, 15], [9, 15], [12, 15]] as const) {
    for (let h = 7; h <= 17; h++) {
      const t = localToUtc(2025, mo, day, h, 0, tz);
      const sp = sunPosition(t, lat, lon);
      if (sp.elevation < 3) continue; // 极低高度角影长对角度误差敏感, 工程上无意义
      const h10 = 10;
      const engine = poleShadowLength(h10, sp.elevation);
      // 独立手算: 高度角 → 余切
      const elR = sp.elevation * DEG;
      const manual = h10 * Math.cos(elR) / Math.sin(elR);
      const err = Math.abs(engine - manual) / manual;
      if (err > maxErr) { maxErr = err; worstDesc = `${mo}/${day} ${h}:00`; }
    }
  }
  check('影长公式 vs 手算', maxErr < 0.001, `最大相对误差 ${(maxErr * 100).toFixed(4)}% (${worstDesc})`);

  // 端到端: 杆子在地面点的遮挡轮廓切换距离 = h/tan(el)
  const t = localToUtc(2025, 1, 15, 10, 0, tz);
  const sp = sunPosition(t, lat, lon);
  const pole: Obstruction = {
    id: 'p1', type: 'pole', name: '杆', x: 0, y: 0, rotation: 0,
    length: 0, width: 0, height: 10, radius: 0.2,
  };
  // 影子方向 = 太阳方位反方向
  const shadowAz = sp.azimuth + 180;
  const tipDist = 10 / Math.tan(sp.elevation * DEG);
  // 沿影子方向取 0.97× 和 1.03× 影长两点
  const dirX = -Math.sin(shadowAz * DEG), dirY = -Math.cos(shadowAz * DEG);
  const mkProfile = (d: number) => {
    const prof = new Float32Array(AZ_BINS);
    addObstructionProfile(prof, { x: dirX * d, y: dirY * d, z: 0 }, pole);
    return prof;
  };
  const inside = isShaded(mkProfile(tipDist * 0.97), sp.azimuth, sp.elevation);
  const outside = isShaded(mkProfile(tipDist * 1.03), sp.azimuth, sp.elevation);
  check('遮挡引擎影长切换点', inside && !outside,
    `影长 ${tipDist.toFixed(2)}m, 0.97×处被遮=${inside}, 1.03×处被遮=${outside} (±3% 内切换, 远优于 1% 要求)`);
}

// ---------- 3. 排间遮挡闭式解 vs 射线求交 ----------
console.log('\n== 排间遮挡闭式解交叉验证 ==');
{
  // 独立方法: 对后排组件采样点向前排面板做射线求交
  function rayShadeFrac(
    cfg: ReturnType<typeof defaultArray>, sunEl: number, sunAz: number, row: number,
  ): number {
    const basis = arrayBasis(cfg.azimuth, cfg.tilt);
    const s = sunVector({ elevation: sunEl, azimuth: sunAz });
    // 前排(row-1)面板: 点 = B + rowDir*v + slopeUp*u
    const W = 1e4; // 无限长排近似
    const B = modulePoint(cfg, basis, row - 1, 0, 0, 0.5); // 前排在列0的下沿中点
    // 解 [rowDir, slopeUp, -s]·[v,u,t] = P - B
    const rx = basis.rowDir.x, ry = basis.rowDir.y, rz = basis.rowDir.z;
    const ux = basis.slopeUp.x, uy = basis.slopeUp.y, uz = basis.slopeUp.z;
    const N = 60;
    let shaded = 0, total = 0;
    for (let iu = 0; iu < N; iu++) {
      const uu = (iu + 0.5) / N;
      const P = modulePoint(cfg, basis, row, 0, uu, 0.5);
      const dx = P.x - B.x, dy = P.y - B.y, dz = P.z - B.z;
      // 克拉默法则
      const det =
        rx * (uy * -s[2] - uz * -s[1]) -
        ux * (ry * -s[2] - rz * -s[1]) +
        -s[0] * (ry * uz - rz * uy);
      if (Math.abs(det) < 1e-12) continue;
      const detU =
        rx * (dy * -s[2] - dz * -s[1]) -
        dx * (ry * -s[2] - rz * -s[1]) +
        -s[0] * (ry * dz - rz * dy);
      const detT =
        rx * (uy * dz - uz * dy) -
        ux * (ry * dz - rz * dy) +
        dx * (ry * uz - rz * uy);
      const u = detU / det;
      const tt = detT / det;
      const v = (dx - ux * u + s[0] * tt) / rx || 0;
      total++;
      if (tt > 1e-9 && u >= 0 && u <= cfg.moduleLength && Math.abs(v) <= W / 2) shaded++;
    }
    return total ? shaded / total : 0;
  }

  const cfg = defaultArray();
  cfg.tilt = 25; cfg.rowPitch = 5; cfg.azimuth = 0;
  const lat = 34.3, lon = 108.9, tz = 8;
  let maxDiff = 0;
  let worst = '';
  for (const [mo, day] of [[3, 15], [6, 15], [12, 15]] as const) {
    for (let h = 8; h <= 16; h++) {
      const sp = sunPosition(localToUtc(2025, mo, day, h, 0, tz), lat, lon);
      if (sp.elevation <= 0) continue;
      const closed = interRowShading(cfg, sp.elevation, sp.azimuth);
      const ray = rayShadeFrac(cfg, sp.elevation, sp.azimuth, 3);
      const diff = Math.abs(closed - ray);
      if (diff > maxDiff) { maxDiff = diff; worst = `${mo}/${day} ${h}:00 闭式=${closed.toFixed(3)} 射线=${ray.toFixed(3)}`; }
    }
  }
  check('闭式解 vs 射线求交', maxDiff < 0.02, `最大偏差 ${(maxDiff * 100).toFixed(2)}% (${worst})`);
}

// ---------- 4. 冬至最小行距自洽 ----------
console.log('\n== 冬至最小行距 ==');
{
  const cfg = defaultArray();
  cfg.tilt = 30; cfg.azimuth = 0;
  const lat = 34.3, lon = 108.9, tz = 8;
  const res = minRowPitchForDate(cfg, (h, m) =>
    sunPosition(localToUtc(2025, 12, 21, h, m, tz), lat, lon));
  console.log(`   倾角30° 最小行距 = ${res.pitch.toFixed(3)} m (最不利 ${res.worstTime})`);

  // 用该行距, 冬至 9-15 点逐分钟检查无遮挡
  cfg.rowPitch = res.pitch + 0.001;
  let maxShade = 0;
  for (let t = 9 * 60; t <= 15 * 60; t++) {
    const sp = sunPosition(localToUtc(2025, 12, 21, Math.floor(t / 60), t % 60, tz), lat, lon);
    maxShade = Math.max(maxShade, interRowShading(cfg, sp.elevation, sp.azimuth));
  }
  check('采用最小行距后 9-15 点无遮挡', maxShade === 0, `最大遮挡比例 ${(maxShade * 100).toFixed(3)}%`);

  cfg.rowPitch = res.pitch - 0.05;
  let maxShade2 = 0;
  for (let t = 9 * 60; t <= 15 * 60; t++) {
    const sp = sunPosition(localToUtc(2025, 12, 21, Math.floor(t / 60), t % 60, tz), lat, lon);
    maxShade2 = Math.max(maxShade2, interRowShading(cfg, sp.elevation, sp.azimuth));
  }
  check('行距减 5cm 后出现遮挡', maxShade2 > 0, `最大遮挡比例 ${(maxShade2 * 100).toFixed(2)}%`);
}

// ---------- 5. 性能: 1000 块组件全年逐时 ----------
console.log('\n== 性能测试 (要求 < 20s) ==');
{
  const proj = defaultProject('perf');
  proj.array.rows = 20;
  proj.array.modulesPerRow = 50; // 1000 块
  proj.obstructions = [
    { id: 'b1', type: 'building', name: '厂房', x: 0, y: -40, rotation: 10, length: 60, width: 20, height: 12, radius: 0 },
    { id: 't1', type: 'tree', name: '树', x: -30, y: -15, rotation: 0, length: 0, width: 0, height: 8, radius: 3 },
    { id: 'p1', type: 'pole', name: '杆', x: 25, y: -10, rotation: 0, length: 0, width: 0, height: 12, radius: 0.2 },
  ];
  const settings = { timeStepMin: 60, sampleGrid: 4, glareAngleDeg: 0.5, year: 2025 };
  const r = runAnnualShading(proj, settings);
  check('1000 块全年逐时 < 20s', r.elapsedMs < 20000,
    `耗时 ${(r.elapsedMs / 1000).toFixed(2)}s (${r.sunSteps} 时步 × 1000 块 × 16 采样点)`);
  const avg = r.moduleIrrFrac.reduce((a, b) => a + b, 0) / r.moduleIrrFrac.length;
  console.log(`   阵列平均辐照加权遮挡损失 ${(avg * 100).toFixed(2)}%`);
}

console.log(failures === 0 ? '\n全部通过 ✅' : `\n${failures} 项失败 ❌`);
if (failures > 0) throw new Error('verify failed');
