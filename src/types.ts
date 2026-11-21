/** 坐标系:x=东, y=北, z=天(米)。方位角约定:0°=正南, 正值偏西, 负值偏东(与 PVsyst 一致)。 */

export type ObstructionType = 'building' | 'tree' | 'pole';

export interface Obstruction {
  id: string;
  type: ObstructionType;
  name: string;
  /** 中心位置 */
  x: number;
  y: number;
  /** 绕 z 轴旋转(度, 逆时针) */
  rotation: number;
  /** 厂房: 长(x向)/宽(y向)/高 */
  length: number;
  width: number;
  height: number;
  /** 树: 树冠半径 + 干高(树冠近似球); 电线杆: 半径 */
  radius: number;
}

export interface ArrayConfig {
  /** 组件宽(沿排方向, m) */
  moduleWidth: number;
  /** 组件长(沿坡面方向, m) */
  moduleLength: number;
  /** 倾角(度) */
  tilt: number;
  /** 方位角(度, 0=正南, 正偏西) */
  azimuth: number;
  /** 行距(前后排中心间距, m) */
  rowPitch: number;
  rows: number;
  modulesPerRow: number;
  /** 排内组件间隙(m) */
  moduleGap: number;
  /** 组件下沿离地高度(m) */
  clearance: number;
  /** 阵列区块中心位置 */
  originX: number;
  originY: number;
}

export interface Project {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  location: {
    lat: number;   // 北纬为正
    lon: number;   // 东经为正
    timezone: number; // UTC 偏移小时, 如 8
  };
  obstructions: Obstruction[];
  array: ArrayConfig;
  /** 眩光观察点 */
  observer: { x: number; y: number; z: number };
}

export interface AppSettings {
  /** 全年分析时间步长(分钟) */
  timeStepMin: number;
  /** 每组件采样点网格 N×N */
  sampleGrid: number;
  /** 眩光判定角阈值(度): 反射光线与观察方向夹角小于该值视为眩光 */
  glareAngleDeg: number;
  /** 全年分析年份 */
  year: number;
}

export const DEFAULT_SETTINGS: AppSettings = {
  timeStepMin: 60,
  sampleGrid: 4,
  glareAngleDeg: 0.5,
  year: 2025,
};

export function defaultArray(): ArrayConfig {
  return {
    moduleWidth: 1.134,
    moduleLength: 2.278,
    tilt: 25,
    azimuth: 0,
    rowPitch: 6,
    rows: 10,
    modulesPerRow: 20,
    moduleGap: 0.02,
    clearance: 0.8,
    originX: 0,
    originY: 0,
  };
}

export function defaultProject(name: string): Project {
  return {
    id: genId(),
    name,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    location: { lat: 34.3, lon: 108.9, timezone: 8 },
    obstructions: [],
    array: defaultArray(),
    observer: { x: 30, y: -40, z: 1.7 },
  };
}

export function genId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export const OBSTRUCTION_DEFAULTS: Record<ObstructionType, Omit<Obstruction, 'id' | 'type' | 'name' | 'x' | 'y'>> = {
  building: { rotation: 0, length: 30, width: 15, height: 10, radius: 0 },
  tree: { rotation: 0, length: 0, width: 0, height: 8, radius: 3 },
  pole: { rotation: 0, length: 0, width: 0, height: 12, radius: 0.2 },
};

export const OBSTRUCTION_LABEL: Record<ObstructionType, string> = {
  building: '厂房',
  tree: '树木',
  pole: '电线杆',
};
