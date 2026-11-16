/** Worker 跨线程共享的结构类型(避免循环依赖) */
import type { AnnualResult } from './engine/annual';
import type { GlareResult } from './types';

export type AnnualShadingLike = AnnualResult;
export type GlareResultLike = GlareResult;
