/** Worker 客户端:单例复用,Promise 化调用,暴露进度回调 */
import type { Project } from './types';
import type { AnnualShadingLike, GlareResultLike } from './worker-types';
import type { WorkerRequest, WorkerResponse } from './analysis.worker';

type ProgressCb = (done: number, total: number) => void;

class AnalysisClient {
  private worker: Worker | null = null;
  private progressCb: ProgressCb | null = null;
  private resolve: ((v: unknown) => void) | null = null;
  private reject: ((e: Error) => void) | null = null;

  private ensure(): Worker {
    if (this.worker) return this.worker;
    this.worker = new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
      const msg = ev.data;
      if (msg.kind === 'progress' && this.progressCb && msg.done != null && msg.total != null) {
        this.progressCb(msg.done, msg.total);
      } else if (msg.kind === 'done') {
        this.resolve?.(msg.payload);
        this.cleanup();
      } else if (msg.kind === 'error') {
        this.reject?.(new Error(msg.message));
        this.cleanup();
      }
    };
    this.worker.onerror = (e) => {
      this.reject?.(new Error(e.message));
      this.cleanup();
    };
    return this.worker;
  }

  private cleanup(): void {
    this.resolve = null;
    this.reject = null;
    this.progressCb = null;
  }

  runAnnual(project: Project, onProgress?: ProgressCb): Promise<AnnualShadingLike> {
    return this.dispatch({ kind: 'annual', project }, onProgress) as Promise<AnnualShadingLike>;
  }

  runGlare(project: Project, observerId: string, onProgress?: ProgressCb): Promise<GlareResultLike> {
    return this.dispatch({ kind: 'glare', project, observerId }, onProgress) as Promise<GlareResultLike>;
  }

  private dispatch(req: WorkerRequest, onProgress?: ProgressCb): Promise<unknown> {
    return new Promise((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
      this.progressCb = onProgress ?? null;
      this.ensure().postMessage(req);
    });
  }
}

export const analysisClient = new AnalysisClient();
