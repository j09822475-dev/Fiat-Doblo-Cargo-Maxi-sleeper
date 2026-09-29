// Проверки в фоновом потоке: интерфейс не замирает на время расчёта.
import { CheckEngine, type PartInput } from './engine';
import type { Project } from '../core/types';

const engine = new CheckEngine();

self.onmessage = (e: MessageEvent<{ id: number; project: Project; parts: PartInput[] }>) => {
  const { id, project, parts } = e.data;
  try {
    engine.setParts(project, parts);
    const res = engine.run(project, (share, stage) => self.postMessage({ id, type: 'progress', share, stage }));
    self.postMessage({ id, type: 'done', result: res });
  } catch (err) {
    self.postMessage({ id, type: 'error', message: String(err) });
  }
};
