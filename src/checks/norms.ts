// Справочник норм: значения по умолчанию из data/norms и переопределения проекта.
import gaps from '../../data/norms/gaps.json';
import clearances from '../../data/norms/clearances.json';
import regulations from '../../data/norms/regulations.json';
import materials from '../../data/materials.json';
import type { Project } from '../core/types';

export interface GapNorm {
  id: string;
  title: string;
  gapMin: number;
  gapNom: number;
  gapMax: number;
  flushTol: number;
  spreadMax: number;
  source: string;
  overridden: boolean;
}

export interface ClearanceNorm {
  id: string;
  title: string;
  min: number;
  source: string;
  overridden: boolean;
}

export type RegulationNorm = (typeof regulations.items)[number];

export const NORM_BOOKS = { gaps, clearances, regulations, materials };

function override(project: Project | undefined, id: string) {
  return project?.overrides.find((o) => o.normId === id)?.values;
}

export function gapNorm(id: string, project?: Project): GapNorm {
  const g = gaps.items.find((x) => x.id === id);
  if (!g) throw new Error(`Нет нормы зазора «${id}»`);
  const o = override(project, id) ?? {};
  return {
    id,
    title: g.title,
    gapMin: o.gapMin ?? g.gap.min,
    gapNom: o.gapNom ?? g.gap.nom,
    gapMax: o.gapMax ?? g.gap.max,
    flushTol: o.flushTol ?? g.flush.tol,
    spreadMax: o.spreadMax ?? g.spreadMax,
    source: g.source,
    overridden: Object.keys(o).length > 0,
  };
}

export function clearanceNorm(id: string, project?: Project): ClearanceNorm {
  const c = clearances.items.find((x) => x.id === id);
  if (!c) throw new Error(`Нет нормы минимального зазора «${id}»`);
  const o = override(project, id) ?? {};
  return { id, title: c.title, min: o.min ?? c.min, source: c.source, overridden: Object.keys(o).length > 0 };
}

export function regulationNorms(project?: Project): (RegulationNorm & { overridden: boolean })[] {
  return regulations.items.map((r) => {
    const o = override(project, r.id) ?? {};
    return { ...r, ...o, overridden: Object.keys(o).length > 0 } as RegulationNorm & { overridden: boolean };
  });
}

export function materialDensity(id: string) {
  return materials.items.find((m) => m.id === id)?.density ?? 0;
}

export function materialTitle(id: string) {
  return materials.items.find((m) => m.id === id)?.title ?? id;
}
