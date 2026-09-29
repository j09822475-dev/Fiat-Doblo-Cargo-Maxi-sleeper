import { describe, expect, it } from 'vitest';
import { CheckEngine } from '../src/checks/engine';
import { MeshBuilder, aabb, shellFromSurface, volume } from '../src/geometry/mesh';
import type { PartDef, Project } from '../src/core/types';

// Две пластины в одной плоскости с известным зазором — эталон для проверки зазоров.
function plate(x0: number, x1: number) {
  const mb = new MeshBuilder();
  const e = { p: [] as number[], n: [] as number[], t: [] as number[] };
  shellFromSurface(mb, e, (u, v) => [x0 + (x1 - x0) * u, 900, 400 + 400 * v], 10, 10, 1, () => [0, -1, 0]);
  const g = mb.build();
  return { position: new Float32Array(g.attributes.position.array), index: new Uint32Array(g.index!.array), edges: e };
}

const def = (id: string): PartDef => ({ id, title: id, layer: 'outer', assembly: 'a', generator: 'x', params: {}, material: 'DC04', thickness: 1, joint: { type: 'fixed' }, status: 'draft' });

function project(rules: Project['rules'], ids: string[]): Project {
  return { format: 'doblo-body/1', title: 't', vehicle: {} as Project['vehicle'], hardpoints: {}, layers: [], assemblies: [], parts: ids.map(def), joined: [], rules, overrides: [] };
}

describe('проверка зазоров', () => {
  it('находит номинальный зазор 4,0 мм', () => {
    const pr = project([{ id: 'g', kind: 'gap', a: 'a', b: 'b', norm: 'door-body' }], ['a', 'b']);
    const eng = new CheckEngine();
    eng.setParts(pr, [{ id: 'a', version: '1', ...plate(0, 500) }, { id: 'b', version: '1', ...plate(504, 900) }]);
    const r = eng.gapRule(pr, pr.rules[0] as never);
    expect(r.profile).toBeTruthy();
    const gaps = r.profile!.samples.map((s) => s.gap);
    expect(Math.min(...gaps)).toBeCloseTo(4, 1);
    expect(Math.max(...gaps)).toBeCloseTo(4, 1);
    expect(r.issues).toHaveLength(0);
  });

  it('сообщает об увеличенном зазоре при сдвиге на 3 мм', () => {
    const pr = project([{ id: 'g', kind: 'gap', a: 'a', b: 'b', norm: 'door-body' }], ['a', 'b']);
    const eng = new CheckEngine();
    eng.setParts(pr, [{ id: 'a', version: '1', ...plate(0, 500) }, { id: 'b', version: '1', ...plate(507, 900) }]);
    const r = eng.gapRule(pr, pr.rules[0] as never);
    const large = r.issues.find((i) => i.kind === 'gap-large');
    expect(large).toBeTruthy();
    expect(large!.value).toBeCloseTo(7, 1);
  });

  it('находит пересечение деталей', () => {
    const pr = project([], ['a', 'b']);
    const eng = new CheckEngine();
    eng.setParts(pr, [{ id: 'a', version: '1', ...plate(0, 500) }, { id: 'b', version: '1', ...plate(450, 900) }]);
    const res = eng.run(pr);
    expect(res.issues.some((i) => i.kind === 'collision')).toBe(true);
  });
});

describe('геометрия', () => {
  it('объём замкнутого бруса считается верно', () => {
    const mb = new MeshBuilder();
    aabb(mb, [0, 0, 0], [100, 200, 300]);
    expect(volume(mb.build())).toBeCloseTo(6e6, -2);
  });
});
