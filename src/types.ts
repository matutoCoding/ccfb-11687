/**
 * 领域模型与持久化类型定义
 * 坐标系:右手 ENU,x=东(m), y=北(m), z=天顶(m);地面 z=0
 * 方位角 convention: 正北=0°,顺时针,正东=90°,正南=180°,正西=270°
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export type ObstacleType = 'building' | 'pole' | 'tree';

export interface BuildingParams {
  /**  footprint X 边长(m,局部坐标,随 rotation 旋转) */
  width: number;
  /** footprint Y 边长(m) */
  depth: number;
  /** 高度(m) */
  height: number;
  /** footprint 绕 z 轴旋转角(度,逆时针为正) */
  rotation: number;
}

export interface PoleParams {
  /** 圆柱半径(m) */
  radius: number;
  /** 杆高(m) */
  height: number;
}

export interface TreeParams {
  trunkRadius: number;
  trunkHeight: number;
  /** 树冠椭球三轴半径(m) */
  crownRx: number;
  crownRy: number;
  crownRz: number;
}

export interface Obstacle {
  id: string;
  name: string;
  type: ObstacleType;
  position: Vec3;
  building?: BuildingParams;
  pole?: PoleParams;
  tree?: TreeParams;
}

export interface PVArrayConfig {
  id: string;
  name: string;
  /** 组件长边(沿阵列 u 方向)尺寸 m */
  moduleWidth: number;
  /** 组件短边(倾斜方向)尺寸 m */
  moduleHeight: number;
  /** 倾角(度,水平面=0) */
  tilt: number;
  /** 朝向方位角(度,北0顺时针;正南=180) */
  azimuth: number;
  rows: number;
  cols: number;
  /** 行距(相邻两排中心线沿朝向方向的距离,m) */
  rowPitch: number;
  /** 列距(相邻组件中心线沿横向的距离,m) */
  colPitch: number;
  /** 组件下沿离地高度 m */
  mountHeight: number;
  /** 第一排(最靠朝向方向)中心位置 */
  origin: Vec3;
}

export interface ModuleInstance {
  id: string;
  arrayId: string;
  arrayName: string;
  row: number;
  col: number;
  center: Vec3;
  /** 局部横向单位向量(水平) */
  u: Vec3;
  /** 局部沿板面向上单位向量 */
  vUp: Vec3;
  /** 板面法线(朝向天空一侧) */
  normal: Vec3;
  width: number;
  height: number;
  tilt: number;
  azimuth: number;
  mountHeight: number;
}

export interface ObserverPoint {
  id: string;
  name: string;
  /** z 一般取视点离地高度,如 1.5m */
  position: Vec3;
}

export interface SiteConfig {
  name: string;
  latitude: number;
  longitude: number;
  /**  UTC 偏移小时,中国 +8 */
  utcOffset: number;
  /** 分析年份(决定闰年) */
  year: number;
  groundWidth: number;
  groundDepth: number;
}

export interface AnalysisSettings {
  /** 眩光判定半角(度):反射方向与视线夹角阈值 */
  glareThresholdDeg: number;
  /** 眩光是否做遮挡物视线检测 */
  lineOfSightCheck: boolean;
  /** 多重叠阴影求并集的栅格分辨率(单边格数) */
  shadowGridSize: number;
  /** 全年分析时间步长(分钟) 30 或 60 */
  timeStepMinutes: number;
  /** 太阳高度角是否加大气折射修正(几何引擎默认 false) */
  useRefraction: boolean;
}

export interface Project {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  site: SiteConfig;
  arrays: PVArrayConfig[];
  obstacles: Obstacle[];
  observers: ObserverPoint[];
  settings: AnalysisSettings;
}

export interface MonthlyShading {
  moduleId: string;
  /** 全年(有阳光时段)平均遮挡比例 0..1 */
  annualMean: number;
  /** 12 个月平均遮挡比例 */
  monthly: number[];
  /** 全年有阳光小时数 */
  daylightSamples: number;
}

export interface GlareEvent {
  /** ISO 本地时间字符串 */
  timestamp: string;
  dateLabel: string;
  hourLabel: string;
  moduleId: string;
  arrayId: string;
  angleDeg: number;
  distance: number;
  blocked: boolean;
}

export interface GlareResult {
  observerId: string;
  observerName: string;
  events: GlareEvent[];
  totalHours: number;
  blockedHours: number;
}
