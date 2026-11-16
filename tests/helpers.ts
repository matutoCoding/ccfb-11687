import type { Project } from '../src/types';
import { createProject, createArray, createObstacle, createObserver } from '../src/defaults';

export function makeProject(partial?: Partial<Project>): Project {
  const p = createProject('测试项目', 2025);
  return { ...p, ...partial };
}

/** 北京真太阳正午的钟表时刻(经度修正+时差后约 11.73~11.8,随季节微变) */
export const SOLAR_NOON_HOUR = 11.73;

export { createArray, createObstacle, createObserver };
