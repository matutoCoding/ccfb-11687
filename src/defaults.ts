/** 默认模型与工厂函数 */
import type {
  AnalysisSettings,
  Obstacle,
  ObserverPoint,
  Project,
  PVArrayConfig,
  SiteConfig,
} from './types';

export const DEFAULT_SETTINGS: AnalysisSettings = {
  glareThresholdDeg: 30,
  lineOfSightCheck: true,
  shadowGridSize: 64,
  timeStepMinutes: 60,
  useRefraction: false,
};

let counter = 0;
export function uid(prefix = 'id'): string {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}_${counter.toString(36)}`;
}

export function defaultSite(year: number): SiteConfig {
  return {
    name: '新建场地',
    latitude: 39.9,
    longitude: 116.4,
    utcOffset: 8,
    year,
    groundWidth: 200,
    groundDepth: 200,
  };
}

export function createProject(name: string, year = new Date().getFullYear()): Project {
  const now = Date.now();
  return {
    id: uid('proj'),
    name,
    createdAt: now,
    updatedAt: now,
    site: defaultSite(year),
    arrays: [],
    obstacles: [],
    observers: [],
    settings: { ...DEFAULT_SETTINGS },
  };
}

export function createObstacle(
  type: Obstacle['type'],
  x = 0,
  y = 0,
): Obstacle {
  const base: Obstacle = {
    id: uid('obs'),
    name: type === 'building' ? '厂房' : type === 'pole' ? '电线杆' : '树木',
    type,
    position: { x, y, z: 0 },
  };
  if (type === 'building') {
    base.building = { width: 20, depth: 12, height: 8, rotation: 0 };
  } else if (type === 'pole') {
    base.pole = { radius: 0.15, height: 10 };
  } else {
    base.tree = {
      trunkRadius: 0.2,
      trunkHeight: 3,
      crownRx: 3,
      crownRy: 3,
      crownRz: 3,
    };
  }
  return base;
}

export function createArray(x = 0, y = 0): PVArrayConfig {
  return {
    id: uid('arr'),
    name: '光伏阵列',
    moduleWidth: 2.3,
    moduleHeight: 1.1,
    tilt: 30,
    azimuth: 180,
    rows: 4,
    cols: 10,
    rowPitch: 4,
    colPitch: 2.4,
    mountHeight: 0.5,
    origin: { x, y, z: 0 },
  };
}

export function createObserver(x = 0, y = 0, z = 1.5): ObserverPoint {
  return {
    id: uid('obv'),
    name: '观察点',
    position: { x, y, z },
  };
}

/** 深拷贝(用于项目复制/导入) */
export function deepClone<T>(v: T): T {
  return structuredClone(v);
}
