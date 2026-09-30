import { describe, expect, it } from 'vitest';
import { createDobloProject } from '../src/parts/doblo-project';
import { buildAll, toInput } from '../src/app/build';
import { CheckEngine } from '../src/checks/engine';
import type { Project } from '../src/core/types';
import { formOf } from '../src/app/build';

function check(project: Project) {
  const meshes = buildAll(project);
  const eng = new CheckEngine();
  eng.setParts(project, project.parts.map((p) => toInput(project, p, meshes.get(p.id)!)));
  return { meshes, res: eng.run(project) };
}

describe('проект Doblò Cargo Maxi', () => {
  it('все детали строятся, базовый проект проходит проверки без ошибок', () => {
    const project = createDobloProject();
    const { meshes, res } = check(project);
    for (const p of project.parts) expect(meshes.get(p.id)!.geometry.index!.count, p.id).toBeGreaterThan(0);
    const lines = res.issues.map((i) => `${i.severity} ${i.kind} ${i.parts.join('/')} = ${i.value}`);
    expect(lines).toEqual([]);
    // все стыки найдены
    expect(res.profiles.length).toBe(project.rules.filter((r) => r.kind === 'gap').length);
  }, 120000);

  it('внутренние детали не выходят за наружную поверхность боковин', () => {
    // пары, соединённые конструктивно, проверка коллизий пропускает — поэтому отдельный контроль габарита
    const project = createDobloProject();
    const f = formOf(project);
    const meshes = buildAll(project);
    const out: string[] = [];
    for (const p of project.parts.filter((q) => q.layer === 'interior' || q.layer === 'powertrain')) {
      const pos = meshes.get(p.id)!.geometry.attributes.position.array;
      let worst = -Infinity;
      for (let i = 0; i < pos.length; i += 3) {
        const [x, y, z] = [pos[i], pos[i + 1], pos[i + 2]];
        if (z < 450 || x < f.h.xNoseSeam || x > f.xRear) continue;
        worst = Math.max(worst, Math.abs(y) - f.halfWidth(x, z));
      }
      if (worst > 0) out.push(`${p.id} +${worst.toFixed(1)}`);
    }
    expect(out).toEqual([]);
  });

  it('сетки деталей ориентированы согласованно (нет вывернутых треугольников)', () => {
    // у согласованной сетки каждое ребро соседние треугольники проходят в противоположных направлениях
    const project = createDobloProject();
    const meshes = buildAll(project);
    const bad: string[] = [];
    for (const p of project.parts) {
      const g = meshes.get(p.id)!.geometry;
      const idx = g.index!.array;
      // рёбра — по номерам вершин: так сравниваются только треугольники одной сетки,
      // а совпадающие по месту стенки соседних участков детали не мешают
      const seen = new Set<string>();
      let twice = 0;
      for (let t = 0; t < idx.length; t += 3) {
        for (let e = 0; e < 3; e++) {
          const k = `${idx[t + e]}>${idx[t + ((e + 1) % 3)]}`;
          if (seen.has(k)) twice++;
          seen.add(k);
        }
      }
      if (twice) bad.push(`${p.id}: ${twice}`);
    }
    expect(bad).toEqual([]);
  });

  it('увеличенный зазор двери 7 мм обнаруживается', () => {
    const project = createDobloProject();
    project.parts.find((p) => p.id === 'door-fl')!.params.gap = 7;
    const { res } = check(project);
    const large = res.issues.filter((i) => i.kind === 'gap-large' && i.parts.includes('door-fl'));
    expect(large.length).toBeGreaterThan(0);
    expect(large[0].value!).toBeGreaterThan(6.5);
  }, 120000);

  it('ось петель внутри кузова даёт пересечение при открывании', () => {
    const project = createDobloProject();
    const door = project.parts.find((p) => p.id === 'door-fr')!;
    if (door.joint.type !== 'hinge') throw new Error('ожидалась петля');
    door.joint.origin = [door.joint.origin[0] + 150, door.joint.origin[1] - 120, 0];
    const { res } = check(project);
    expect(res.issues.some((i) => i.pose?.part === 'door-fr' && i.kind === 'collision')).toBe(true);
  }, 120000);

  it('сиденье, сдвинутое назад, нарушает зазор до перегородки', () => {
    const project = createDobloProject();
    project.parts.find((p) => p.id === 'seat-l')!.params.x = 1100;
    const { res } = check(project);
    expect(res.issues.some((i) => i.norm === 'seat-bulkhead' && i.parts.includes('seat-l'))).toBe(true);
  }, 120000);

  it('без заднего фонаря в обшивке остаётся сквозной просвет, и он обнаруживается', () => {
    const project = createDobloProject();
    project.parts = project.parts.filter((p) => p.id !== 'tail-l');
    const { res } = check(project);
    const holes = res.issues.filter((i) => i.kind === 'opening');
    expect(holes.length).toBeGreaterThan(0);
    // просвет — на месте фонаря: задний левый угол кузова на высоте 0,9…1,5 м
    expect(holes.some((i) => i.at[0] > 3500 && i.at[1] < -600 && i.at[2] > 850 && i.at[2] < 1550)).toBe(true);
  }, 120000);

  it('задний фонарь выше 1500 мм нарушает Правила ЕЭК ООН № 48', () => {
    const project = createDobloProject();
    const n = project.overrides;
    n.push({ normId: 'rear-lamp-height', values: { max: 1400 }, reason: 'тест' });
    const { res } = check(project);
    expect(res.issues.some((i) => i.kind === 'regulation' && i.norm === 'rear-lamp-height')).toBe(true);
  }, 120000);
});
