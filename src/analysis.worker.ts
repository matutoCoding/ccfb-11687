/**
 * Web Worker:把全年逐时遮挡与眩光分析移出主线程,避免阻塞 UI。
 * 消息协议:
 *   in  { kind:'annual'|'glare'; project; observerId? }
 *   out { kind:'progress'; done; total } | { kind:'done'; payload } | { kind:'error'; message }
 */
import { analyzeAnnualShading } from './engine/annual';
import { analyzeGlare } from './engine/glare';
import type { Project } from './types';
import type { AnnualShadingLike, GlareResultLike } from './worker-types';

export interface WorkerRequest {
  kind: 'annual' | 'glare';
  project: Project;
  observerId?: string;
}
export interface WorkerResponse {
  kind: 'progress' | 'done' | 'error';
  done?: number;
  total?: number;
  payload?: AnnualShadingLike | GlareResultLike;
  message?: string;
}

self.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const { kind, project, observerId } = ev.data;
  const post = (msg: WorkerResponse) => (self as unknown as Worker).postMessage(msg);
  const onProgress = (done: number, total: number) => post({ kind: 'progress', done, total });
  try {
    if (kind === 'annual') {
      const payload = analyzeAnnualShading(project, (p) => onProgress(p.done, p.total));
      post({ kind: 'done', payload });
    } else {
      if (!observerId) throw new Error('眩光分析缺少观察点 id');
      const payload = analyzeGlare(project, observerId, (p) => onProgress(p.done, p.total));
      post({ kind: 'done', payload });
    }
  } catch (err) {
    post({ kind: 'error', message: (err as Error).message });
  }
};
