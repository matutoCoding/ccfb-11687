/**
 * 阵列布置引擎:把阵列配置展开为每块组件的 3D 位姿。
 *
 * 局部坐标架(朝向方位角 az,倾角 t):
 *   朝向水平向量 f = (sin az, cos az, 0)
 *   横向水平向量 u = (-cos az, sin az, 0)   (u ⟂ f)
 *   板面法线     n = (sin t·sin az, sin t·cos az, cos t)
 *   沿板向上   vUp = n × u = (-cos t·sin az, -cos t·cos az, sin t)
 * 已验证:t=0 时 vUp=-f(水平向后),t=90° 时 vUp=(0,0,1)。
 */
import type { ModuleInstance, PVArrayConfig, Vec3 } from '../types';
import { v3 } from './geometry';

const DEG2RAD = Math.PI / 180;

export interface ArrayFrame {
  f: Vec3; // 朝向(水平)
  u: Vec3; // 横向(水平)
  vUp: Vec3; // 板面向上
  normal: Vec3; // 法线
}

export function arrayFrame(azimuthDeg: number, tiltDeg: number): ArrayFrame {
  const az = azimuthDeg * DEG2RAD;
  const t = tiltDeg * DEG2RAD;
  const f: Vec3 = { x: Math.sin(az), y: Math.cos(az), z: 0 };
  const u: Vec3 = { x: -Math.cos(az), y: Math.sin(az), z: 0 };
  const normal: Vec3 = {
    x: Math.sin(t) * Math.sin(az),
    y: Math.sin(t) * Math.cos(az),
    z: Math.cos(t),
  };
  const vUp: Vec3 = {
    x: -Math.cos(t) * Math.sin(az),
    y: -Math.cos(t) * Math.cos(az),
    z: Math.sin(t),
  };
  return { f, u, vUp, normal };
}

export function buildModules(arrays: PVArrayConfig[]): ModuleInstance[] {
  const modules: ModuleInstance[] = [];
  for (const arr of arrays) {
    const { f, u, vUp, normal } = arrayFrame(arr.azimuth, arr.tilt);
    const centerZ = arr.mountHeight + (arr.moduleHeight / 2) * Math.sin(arr.tilt * DEG2RAD);
    for (let row = 0; row < arr.rows; row++) {
      for (let col = 0; col < arr.cols; col++) {
        // row 0 在 origin(最靠前),后续排向 -f 方向(后方)布置
        const back = v3.scale(f, -row * arr.rowPitch);
        const side = v3.scale(u, (col - (arr.cols - 1) / 2) * arr.colPitch);
        const center = v3.add(v3.add(arr.origin, back), side);
        center.z = centerZ;
        modules.push({
          id: moduleId(arr.id, row, col),
          arrayId: arr.id,
          arrayName: arr.name,
          row,
          col,
          center,
          u,
          vUp,
          normal,
          width: arr.moduleWidth,
          height: arr.moduleHeight,
          tilt: arr.tilt,
          azimuth: arr.azimuth,
          mountHeight: arr.mountHeight,
        });
      }
    }
  }
  return modules;
}

export function moduleId(arrayId: string, row: number, col: number): string {
  return `${arrayId}__r${row}c${col}`;
}

/** 组件四角(世界坐标),顺序:左下、右下、右上、左上(局部 u/vUp) */
export function moduleCorners(m: ModuleInstance): Vec3[] {
  const hu = m.width / 2;
  const hv = m.height / 2;
  return [
    v3.add(v3.add(m.center, v3.scale(m.u, -hu)), v3.scale(m.vUp, -hv)),
    v3.add(v3.add(m.center, v3.scale(m.u, hu)), v3.scale(m.vUp, -hv)),
    v3.add(v3.add(m.center, v3.scale(m.u, hu)), v3.scale(m.vUp, hv)),
    v3.add(v3.add(m.center, v3.scale(m.u, -hu)), v3.scale(m.vUp, hv)),
  ];
}

/** 组件投影到地面的 footprint(凸四边形 xy) */
export function moduleGroundPolygon(m: ModuleInstance): { x: number; y: number }[] {
  return moduleCorners(m).map((p) => ({ x: p.x, y: p.y }));
}

/** 整片阵列平移 */
export function translateArray(arr: PVArrayConfig, dx: number, dy: number, dz = 0): PVArrayConfig {
  return {
    ...arr,
    origin: { x: arr.origin.x + dx, y: arr.origin.y + dy, z: arr.origin.z + dz },
  };
}
