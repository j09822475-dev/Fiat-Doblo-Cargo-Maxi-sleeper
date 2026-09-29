// Обёртка над фоновым потоком проверок.
import type { Project } from '../core/types';
import type { CheckResult, PartInput } from './engine';

export class CheckClient {
  private worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  private seq = 0;

  run(project: Project, parts: PartInput[], onProgress: (share: number, stage: string) => void): Promise<CheckResult> {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      const handler = (e: MessageEvent) => {
        const m = e.data;
        if (m.id !== id) return;
        if (m.type === 'progress') onProgress(m.share, m.stage);
        else {
          this.worker.removeEventListener('message', handler);
          if (m.type === 'done') resolve(m.result);
          else reject(new Error(m.message));
        }
      };
      this.worker.addEventListener('message', handler);
      this.worker.postMessage({ id, project, parts });
    });
  }
}
