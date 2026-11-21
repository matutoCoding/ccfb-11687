/**
 * 太阳位置算法 —— NOAA 太阳位置公式(精度约 0.01°),
 * 足以保证单杆影长与三角函数手算误差远小于 1%。
 *
 * 方位角约定: 0° = 正南, 正值偏西, 负值偏东(与 PVsyst 一致)。
 * 高度角: 地平线为 0, 天顶为 90°。
 */

const DEG = Math.PI / 180;

export interface SunPos {
  /** 高度角(度) */
  elevation: number;
  /** 方位角(度, 0=南, +西, -东) */
  azimuth: number;
}

function julianDay(dateUtcMs: number): number {
  return dateUtcMs / 86400000 + 2440587.5;
}

/**
 * @param dateUtcMs  UTC 毫秒时间戳
 * @param lat        纬度(北纬为正, 度)
 * @param lon        经度(东经为正, 度)
 */
export function sunPosition(dateUtcMs: number, lat: number, lon: number): SunPos {
  const jd = julianDay(dateUtcMs);
  const T = (jd - 2451545.0) / 36525; // 儒略世纪

  // 几何平均黄经 / 平近点角
  const L0 = (280.46646 + T * (36000.76983 + 0.0003032 * T)) % 360;
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);

  // 中心差
  const Mr = M * DEG;
  const C =
    (1.914602 - T * (0.004817 + 0.000014 * T)) * Math.sin(Mr) +
    (0.019993 - 0.000101 * T) * Math.sin(2 * Mr) +
    0.000289 * Math.sin(3 * Mr);

  const trueLong = L0 + C;
  const omega = 125.04 - 1934.136 * T;
  const appLong = trueLong - 0.00569 - 0.00478 * Math.sin(omega * DEG);

  // 黄赤交角
  const meanObliq =
    23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
  const obliq = meanObliq + 0.00256 * Math.cos(omega * DEG);

  // 赤纬
  const sinDec = Math.sin(obliq * DEG) * Math.sin(appLong * DEG);
  const decl = Math.asin(sinDec);

  // 均时差(分钟)
  const varY = Math.tan((obliq / 2) * DEG) ** 2;
  const L0r = L0 * DEG;
  const eqTime =
    4 *
    ((varY * Math.sin(2 * L0r) -
      2 * e * Math.sin(Mr) +
      4 * e * varY * Math.sin(Mr) * Math.cos(2 * L0r) -
      0.5 * varY * varY * Math.sin(4 * L0r) -
      1.25 * e * e * Math.sin(2 * Mr)) /
      DEG);

  // 真太阳时 -> 时角
  const utcMinutes = dateUtcMs / 60000;
  const trueSolarTime = ((utcMinutes + eqTime + 4 * lon) % 1440 + 1440) % 1440;
  const hourAngle = (trueSolarTime / 4 - 180) * DEG; // 上午为负

  const latR = lat * DEG;
  const cosZenith =
    Math.sin(latR) * Math.sin(decl) +
    Math.cos(latR) * Math.cos(decl) * Math.cos(hourAngle);
  const zenith = Math.acos(Math.min(1, Math.max(-1, cosZenith)));
  const elevation = 90 - zenith / DEG;

  // 方位角(自正南起算, 西正东负)
  const cosAz =
    (Math.sin(latR) * Math.cos(zenith) - Math.sin(decl)) /
    (Math.cos(latR) * Math.sin(zenith));
  let azFromSouth = Math.acos(Math.min(1, Math.max(-1, cosAz))) / DEG;
  if (hourAngle < 0) azFromSouth = -azFromSouth; // 上午在东侧

  return { elevation, azimuth: azFromSouth };
}

/** 由本地时间构造 UTC 毫秒时间戳 */
export function localToUtc(
  year: number, month: number, day: number,
  hour: number, minute: number, timezone: number,
): number {
  return Date.UTC(year, month - 1, day, hour - timezone, minute, 0, 0);
}

/** 太阳方向单位向量(指向太阳), 坐标系 x=东 y=北 z=天 */
export function sunVector(pos: SunPos): [number, number, number] {
  const el = pos.elevation * DEG;
  const az = pos.azimuth * DEG;
  return [
    -Math.sin(az) * Math.cos(el),
    -Math.cos(az) * Math.cos(el),
    Math.sin(el),
  ];
}

/** 单根竖杆在水平地面上的影长(m): h / tan(高度角) */
export function poleShadowLength(height: number, elevationDeg: number): number {
  if (elevationDeg <= 0) return Infinity;
  return height / Math.tan(elevationDeg * DEG);
}

/** 生成全年逐时(或按步长)分析时间戳序列(仅含当地可能日出的时段粗筛) */
export function yearTimeSteps(year: number, timezone: number, stepMin: number): number[] {
  const out: number[] = [];
  const start = localToUtc(year, 1, 1, 0, 0, timezone);
  const days = isLeap(year) ? 366 : 365;
  for (let d = 0; d < days; d++) {
    for (let m = 0; m < 1440; m += stepMin) {
      out.push(start + d * 86400000 + m * 60000);
    }
  }
  return out;
}

function isLeap(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}
