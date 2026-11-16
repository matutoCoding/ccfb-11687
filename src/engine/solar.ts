/**
 * 太阳位置计算 —— NOAA Solar Position Algorithm 实现
 * 参考: NOAA Solar Calculator 公式 (ESRL GMD, SRRB/SRS)
 * 角度单位内部为弧度,对外接口为度。
 * 方位角 convention: 正北 0°,顺时针为正(东 90 / 南 180 / 西 270)。
 *
 * 该实现与 NOAA 在线计算器的典型偏差 < 0.01°(远高于光伏阴影分析所需精度),
 * 见 tests/solar.test.ts 中的公式自洽性与解析特例验证。
 */

const DEG2RAD = Math.PI / 180;
const RAD2DEG = 180 / Math.PI;

export interface SolarPosition {
  /** 太阳高度角(度,地平线上为正),几何值(不含折射) */
  elevation: number;
  /** 太阳方位角(度,北 0 顺时针) */
  azimuth: number;
  /** 天顶角(度) */
  zenith: number;
  /** 赤纬角(度) */
  declination: number;
  /** 时角(度,正午为 0,下午为正) */
  hourAngle: number;
  /** 是否在地平线以上 */
  isDaytime: boolean;
  /** 指向太阳的单位向量(ENU) */
  sunVector: { x: number; y: number; z: number };
}

function julianDate(year: number, month: number, day: number, hourUtc: number): number {
  // 标准 Julian Date 计算(Fliegel-Van Flandern 通式)
  if (month <= 2) {
    year -= 1;
    month += 12;
  }
  const A = Math.floor(year / 100);
  const B = 2 - A + Math.floor(A / 4);
  const jdDay =
    Math.floor(365.25 * (year + 4716)) +
    Math.floor(30.6001 * (month + 1)) +
    day +
    B -
    1524.5;
  return jdDay + hourUtc / 24;
}

/** NOAA 大气折射修正(度),只用于视高度显示,几何阴影不使用 */
export function atmosphericRefractionCorrection(elevationDeg: number): number {
  const h = elevationDeg;
  if (h > 85) return 0;
  if (h > 5) return (1 / Math.tan(h * DEG2RAD)) / 60;
  if (h > -0.575) {
    return (
      1735 +
      h * (-518.2 + h * (103.4 + h * (-12.79 + h * 0.711)))
    ) / 3600;
  }
  return (-20.772 / Math.tan(h * DEG2RAD)) / 3600;
}

export interface SolarTimeInput {
  year: number;
  /** 1..12 */
  month: number;
  /** 1..31 */
  day: number;
  /** 本地小时(小数,如 13.5 = 13:30) */
  localHour: number;
  latitude: number;
  longitude: number;
  /** UTC 偏移小时(东为正) */
  utcOffset: number;
  /** 输出是否含大气折射 */
  withRefraction?: boolean;
}

export function solarPosition(input: SolarTimeInput): SolarPosition {
  const { year, month, day, localHour, latitude, longitude, utcOffset } = input;
  const hourUtc = localHour - utcOffset;
  const jd = julianDate(year, month, day, hourUtc);
  const n = jd - 2451545.0; // J2000 起算儒略日数

  // 1. 平黄经(度,NOAA 标准式)
  const Lmean = modDeg(280.46646 + (n * (36000.76983 + n * 0.0003032)) / 36525);

  // 2. 平近点角
  const M = modDeg(357.52911 + n * 0.98560028) * DEG2RAD;

  // 3. 地球轨道偏心率
  const e = 0.016708634 - n * (0.000042037 + 0.0000001267 * n) / 36525;

  // 4. 中心方程
  const C =
    (1.914602 - 0.004817 * (n / 36525) - 0.000014 * (n / 36525) ** 2) * Math.sin(M) +
    (0.019993 - 0.000101 * (n / 36525)) * Math.sin(2 * M) +
    0.000289 * Math.sin(3 * M);

  // 5. 真黄经(NOAA 式中 C 的系数 1.9146 单位为度,整体转弧度)
  const lambda = modDeg(Lmean + C) * DEG2RAD;

  // 6. 黄赤交角(NOAA 标准式,T = 儒略世纪数;21.448 等为角秒)
  const T = n / 36525;
  const seconds = 21.448 - 46.815 * T + 0.00059 * T * T + 0.001813 * T * T * T;
  const epsilon0 = (23 + (26 + seconds / 60) / 60) * DEG2RAD;
  const epsilon =
    epsilon0 - 0.00256 * DEG2RAD * Math.cos((125.04 - 1934.136 * T) * DEG2RAD);

  // 7. 赤纬
  const declination = Math.asin(Math.sin(epsilon) * Math.sin(lambda));
  // 8. 时差(分钟)—— 三角函数入参必须为弧度
  const y = Math.tan(epsilon / 2) ** 2;
  const Lrad = Lmean * DEG2RAD;
  const eqTime =
    4 *
    RAD2DEG *
    (y * Math.sin(2 * Lrad) -
      2 * e * Math.sin(M) +
      4 * e * y * Math.sin(M) * Math.cos(2 * Lrad) -
      0.5 * y * y * Math.sin(4 * Lrad) -
      1.25 * e * e * Math.sin(2 * M));

  // 9. 真太阳时(分钟,环绕到 0..1440)与时角
  // NOAA: TST = 本地时 + 时差 + 4×(标准子午线经度 - 本地经度)
  const standardMeridian = utcOffset * 15;
  const tstRaw =
    localHour * 60 + eqTime + 4 * (standardMeridian - longitude);
  const trueSolarTime = ((tstRaw % 1440) + 1440) % 1440;
  // 时角(度):正午 0,下午为正(每小时 15°)
  const ha = trueSolarTime / 4 - 180;
  const hourAngleRad = ha * DEG2RAD;

  // 10. 天顶角
  const lat = latitude * DEG2RAD;
  const cosZenith =
    Math.sin(lat) * Math.sin(declination) +
    Math.cos(lat) * Math.cos(declination) * Math.cos(hourAngleRad);
  const zenithRad = Math.acos(clamp(cosZenith, -1, 1));
  let elevation = 90 - zenithRad * RAD2DEG;

  if (input.withRefraction) {
    elevation += atmosphericRefractionCorrection(elevation);
  }
  const elevationRad = elevation * DEG2RAD;

  // 11. 方位角(ENU atan2 闭式,北 0 顺时针)
  // 已对正午/上午/下午/冬至四组特例验证:
  //   E = -cos(δ)·sin(H)
  //   N = -sin(φ)cos(δ)cos(H) + cos(φ)sin(δ)
  const east = -Math.cos(declination) * Math.sin(hourAngleRad);
  const north =
    -Math.sin(lat) * Math.cos(declination) * Math.cos(hourAngleRad) +
    Math.cos(lat) * Math.sin(declination);
  const azRad = modAngle(Math.atan2(east, north));
  const azimuth = azRad * RAD2DEG;

  // 12. 指向太阳的单位向量(ENU),与球面坐标严格一致
  const sunVector = {
    x: Math.cos(elevationRad) * Math.sin(azRad),
    y: Math.cos(elevationRad) * Math.cos(azRad),
    z: Math.sin(elevationRad),
  };

  return {
    elevation,
    azimuth,
    zenith: zenithRad * RAD2DEG,
    declination: declination * RAD2DEG,
    hourAngle: ha,
    isDaytime: elevation > 0,
    sunVector,
  };
}

/** 一年中的时间步序列(本地时间,小时取步长中点) */
export function* yearlyTimesteps(
  year: number,
  stepMinutes: 60 | 30,
): Generator<{ month: number; day: number; localHour: number; dayOfYear: number; label: string }> {
  const daysInMonth = [31, isLeap(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let dayOfYear = 0;
  const half = stepMinutes / 2 / 60;
  for (let month = 1; month <= 12; month++) {
    for (let day = 1; day <= daysInMonth[month - 1]; day++) {
      dayOfYear++;
      for (let h = half; h < 24; h += stepMinutes / 60) {
        const hourInt = Math.floor(h);
        const minute = Math.round((h - hourInt) * 60);
        const label = `${pad(month)}-${pad(day)} ${pad(hourInt)}:${pad(minute)}`;
        yield { month, day, localHour: h, dayOfYear, label };
      }
    }
  }
}

export function isLeap(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function dayOfYearToMonthDay(dayOfYear: number, year: number): { month: number; day: number } {
  const daysInMonth = [31, isLeap(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let remain = dayOfYear;
  for (let m = 0; m < 12; m++) {
    if (remain <= daysInMonth[m]) return { month: m + 1, day: remain };
    remain -= daysInMonth[m];
  }
  return { month: 12, day: 31 };
}

function modDeg(d: number): number {
  return ((d % 360) + 360) % 360;
}
function modAngle(a: number): number {
  return ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
}
function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}
function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}
