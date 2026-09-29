// Движок проверок. Работает с сетками в координатах кузова (мм).
// Используется в Web Worker и в тестах, от DOM не зависит.
import * as THREE from 'three';
import { MeshBVH, type HitPointInfo } from 'three-mesh-bvh';
import type { GapProfile, Issue, PartDef, Project, Rule, Vec3 } from '../core/types';
import { motionPoses } from '../core/kinematics';
import type { EdgeSamples } from '../geometry/mesh';
import { clearanceNorm, gapNorm, regulationNorms } from './norms';

export interface PartInput {
  id: string;
  version: string;
  position: Float32Array;
  index: Uint32Array;
  edges: EdgeSamples;
}

interface Item {
  def: PartDef;
  version: string;
  geom: THREE.BufferGeometry;
  bvh: MeshBVH;
  box: THREE.Box3;
  edges: EdgeSamples;
}

export interface CheckResult {
  issues: Issue[];
  profiles: GapProfile[];
  stats: { pairs: number; poses: number; ms: number };
}

const I = new THREE.Matrix4();
const v3 = (p: THREE.Vector3): Vec3 => [round(p.x), round(p.y), round(p.z)];
const round = (x: number) => Math.round(x * 10) / 10;

export class CheckEngine {
  private items = new Map<string, Item>();

  /** Загружает детали; BVH пересчитывается только у изменившихся. */
  setParts(project: Project, inputs: PartInput[]) {
    const keep = new Set(inputs.map((i) => i.id));
    for (const id of [...this.items.keys()]) if (!keep.has(id)) this.items.delete(id);
    for (const inp of inputs) {
      const def = project.parts.find((p) => p.id === inp.id)!;
      const prev = this.items.get(inp.id);
      if (prev && prev.version === inp.version) {
        prev.def = def;
        continue;
      }
      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.BufferAttribute(inp.position, 3));
      geom.setIndex(new THREE.BufferAttribute(inp.index, 1));
      geom.computeBoundingBox();
      const bvh = new MeshBVH(geom);
      // closestPointToGeometry использует дерево второй сетки, если оно есть
      (geom as unknown as { boundsTree: MeshBVH }).boundsTree = bvh;
      this.items.set(inp.id, { def, version: inp.version, geom, bvh, box: geom.boundingBox!.clone(), edges: inp.edges });
    }
  }

  run(project: Project, onProgress: (share: number, stage: string) => void = () => {}): CheckResult {
    const t0 = performance.now();
    const issues: Issue[] = [];
    const profiles: GapProfile[] = [];
    let pairs = 0;
    let poses = 0;
    const joined = new Set(project.joined.map(([a, b]) => [a, b].sort().join('|')));
    const parentOf = (id: string) => {
      const j = this.items.get(id)?.def.joint;
      return j?.type === 'mounted' ? j.to : null;
    };
    /** Детали, соединённые конструктивно или закреплённые одна на другой. */
    const related = (a: string, b: string) =>
      joined.has([a, b].sort().join('|')) || parentOf(a) === b || parentOf(b) === a || (parentOf(a) !== null && parentOf(a) === parentOf(b));

    // --- 1. статические коллизии и касания
    onProgress(0, 'Коллизии');
    const ids = [...this.items.keys()];
    const staticMin = clearanceNorm('static-default', project);
    for (let i = 0; i < ids.length; i++) {
      const A = this.items.get(ids[i])!;
      for (let k = i + 1; k < ids.length; k++) {
        const B = this.items.get(ids[k])!;
        if (related(ids[i], ids[k])) continue;
        if (!A.box.clone().expandByScalar(staticMin.min).intersectsBox(B.box)) continue;
        pairs++;
        const hit = this.closest(A, B, I, staticMin.min);
        if (!hit) continue;
        if (hit.distance < 1e-3 && A.bvh.intersectsGeometry(B.geom, I) && this.confirmed(A, B, hit, 0.05)) {
          issues.push({
            id: `collision:${ids[i]}|${ids[k]}`, severity: 'error', kind: 'collision',
            title: `Пересечение: ${A.def.title} и ${B.def.title}`, parts: [ids[i], ids[k]], at: v3(hit.point),
            value: 0, limit: `≥ ${staticMin.min} мм`, norm: staticMin.id, source: staticMin.source,
          });
        } else if (hit.distance < staticMin.min && this.confirmed(A, B, hit, staticMin.min)) {
          issues.push({
            id: `touch:${ids[i]}|${ids[k]}`, severity: 'warning', kind: 'clearance',
            title: `Касание: ${A.def.title} и ${B.def.title}`, parts: [ids[i], ids[k]], at: v3(hit.point),
            value: round(hit.distance), limit: `≥ ${staticMin.min} мм`, norm: staticMin.id, source: staticMin.source,
          });
        }
      }
      onProgress((0.3 * i) / ids.length, 'Коллизии');
    }

    // --- 2. зазоры и перепады по стыкам
    const gapRules = project.rules.filter((r): r is Extract<Rule, { kind: 'gap' }> => r.kind === 'gap');
    gapRules.forEach((r, n) => {
      onProgress(0.3 + (0.2 * n) / gapRules.length, 'Зазоры по стыкам');
      const res = this.gapRule(project, r);
      if (res.profile) profiles.push(res.profile);
      issues.push(...res.issues);
    });

    // --- 3. минимальные зазоры между заданными деталями
    for (const r of project.rules) {
      if (r.kind !== 'clearance') continue;
      const A = this.items.get(r.a);
      const B = this.items.get(r.b);
      if (!A || !B) continue;
      const norm = clearanceNorm(r.norm, project);
      const hit = this.closest(A, B, I, norm.min + 500);
      const d = hit ? hit.distance : Infinity;
      if (d < norm.min) {
        issues.push({
          id: `clear:${r.id}`, severity: d < 1e-3 ? 'error' : 'warning', kind: 'clearance',
          title: `Зазор меньше нормы: ${A.def.title} — ${B.def.title}`, parts: [r.a, r.b], at: v3(hit!.point),
          value: round(d), limit: `≥ ${norm.min} мм`, norm: norm.id, source: norm.source,
        });
      }
    }

    // --- 4. движение: двери, капот, створки, колёса
    const motion = project.rules.filter((r): r is Extract<Rule, { kind: 'motion' }> => r.kind === 'motion');
    motion.forEach((r, n) => {
      onProgress(0.5 + (0.45 * n) / motion.length, `Движение: ${this.items.get(r.part)?.def.title ?? r.part}`);
      const res = this.motionRule(project, r, related);
      poses += res.poses;
      issues.push(...res.issues);
    });

    // --- 5. нормативы положения
    onProgress(0.97, 'Нормативы');
    issues.push(...this.regulations(project));

    onProgress(1, 'Готово');
    const order = { error: 0, warning: 1, info: 2 };
    issues.sort((a, b) => order[a.severity] - order[b.severity]);
    return { issues, profiles, stats: { pairs, poses, ms: Math.round(performance.now() - t0) } };
  }

  /** Ближайшие точки двух деталей; B смещена матрицей mB. null — дальше max. */
  private closest(A: Item, B: Item, mB: THREE.Matrix4, max: number): HitPointInfo | null {
    const t1 = { point: new THREE.Vector3(), distance: 0, faceIndex: 0 };
    const t2 = { point: new THREE.Vector3(), distance: 0, faceIndex: 0 };
    const hit = A.bvh.closestPointToGeometry(B.geom, mB, t1, t2, 0, max);
    // порог max у BVH — только ускорение поиска, результат может быть дальше
    return hit && hit.distance <= max ? hit : null;
  }

  /**
   * Проверка найденного касания точным запросом «точка — сетка» в обе стороны.
   * closestPointToGeometry иногда занижает расстояние на вырожденных треугольниках.
   */
  private confirmed(A: Item, B: Item, hit: HitPointInfo, min: number, mB: THREE.Matrix4 = I) {
    const t = { point: new THREE.Vector3(), distance: 0, faceIndex: 0 };
    const inv = mB.clone().invert();
    // точка на A → ближайшая точка B (B смещена матрицей mB) → обратно на A
    const pLocal = hit.point.clone().applyMatrix4(inv);
    const dB = B.bvh.closestPointToPoint(pLocal, t)?.distance ?? Infinity;
    const q = t.point.clone().applyMatrix4(mB);
    const dA = A.bvh.closestPointToPoint(q, t)?.distance ?? Infinity;
    return Math.max(dB, dA) < min;
  }

  /** Профиль зазора вдоль стыка: точки кромки детали A → ближайшая точка детали B. */
  gapRule(project: Project, r: Extract<Rule, { kind: 'gap' }>): { issues: Issue[]; profile?: GapProfile } {
    const A = this.items.get(r.a);
    const B = this.items.get(r.b);
    const out: Issue[] = [];
    if (!A || !B) return { issues: out };
    const norm = gapNorm(r.norm, project);
    // увеличенный зазор ищем до трёх максимальных норм; дальше — это уже не стык
    const search = norm.gapMax * 3 + 10;
    const samples: GapProfile['samples'] = [];
    const p = new THREE.Vector3();
    const target = { point: new THREE.Vector3(), distance: 0, faceIndex: 0 };
    const e = A.edges;
    for (let i = 0; i < e.p.length; i += 3) {
      p.set(e.p[i], e.p[i + 1], e.p[i + 2]);
      const hit = B.bvh.closestPointToPoint(p, target, 0, search);
      if (!hit || hit.distance > search) continue;
      const vx = hit.point.x - p.x;
      const vy = hit.point.y - p.y;
      const vz = hit.point.z - p.z;
      const d = Math.hypot(vx, vy, vz);
      // точки на углах кромки не учитываем: там зазор и перепад не определены
      const turn = (j: number) => (j < 0 || j >= e.t.length ? 1 : e.t[i] * e.t[j] + e.t[i + 1] * e.t[j + 1] + e.t[i + 2] * e.t[j + 2]);
      if (turn(i - 3) < 0.87 || turn(i + 3) < 0.87) continue;
      // и точки, у которых ближайшая точка соседней детали лежит не поперёк стыка
      const along = Math.abs(vx * e.t[i] + vy * e.t[i + 1] + vz * e.t[i + 2]);
      if (d > 0.05 && along > 0.35 * d) continue;
      // перепад — между наружными поверхностями обеих деталей у стыка, по средней нормали:
      // на плавно изогнутой поверхности отрезок между кромками перпендикулярен средней нормали.
      // Если поверхности у стыка не параллельны (капот над фарой), перепад не определён.
      const eb = edgeNear(B.edges, hit.point);
      const nb = eb?.n ?? faceNormal(B.geom, hit.faceIndex);
      const parallel = nb.x * e.n[i] + nb.y * e.n[i + 1] + nb.z * e.n[i + 2] > 0.85;
      let flush = 0;
      if (parallel) {
        const q = eb?.p ?? hit.point;
        const na = new THREE.Vector3(e.n[i] + nb.x, e.n[i + 1] + nb.y, e.n[i + 2] + nb.z).normalize();
        flush = (q.x - p.x) * na.x + (q.y - p.y) * na.y + (q.z - p.z) * na.z;
      }
      samples.push({ p: [p.x, p.y, p.z], gap: round(d), flush: round(flush) });
    }
    const title = `${A.def.title} — ${B.def.title}`;
    if (samples.length < 3) {
      out.push({
        id: `noseam:${r.id}`, severity: 'info', kind: 'no-seam', title: `Стык не найден: ${title}`,
        parts: [r.a, r.b], at: centerOf(A.box), norm: norm.id, source: norm.source,
        limit: `ожидался зазор ${norm.gapNom} мм`,
      });
      return { issues: out };
    }
    const gapsV = samples.map((s) => s.gap);
    // оценка по всем точкам стыка (угловые точки кромки уже отброшены)
    const lo = Math.min(...gapsV);
    const hi = Math.max(...gapsV);
    const worst = (f: (s: (typeof samples)[number]) => number) => samples.reduce((a, b) => (f(b) > f(a) ? b : a));
    const base = { parts: [r.a, r.b], norm: norm.id, source: norm.source };
    if (lo < norm.gapMin) {
      const w = worst((s) => -s.gap);
      out.push({ ...base, id: `gapsmall:${r.id}`, severity: w.gap < 0.2 ? 'error' : 'warning', kind: 'gap-small', title: `Зазор меньше нормы: ${title}`, at: w.p, value: w.gap, limit: `${norm.gapMin}…${norm.gapMax} мм` });
    }
    if (hi > norm.gapMax) {
      const w = worst((s) => s.gap);
      out.push({ ...base, id: `gaplarge:${r.id}`, severity: 'warning', kind: 'gap-large', title: `Увеличенный зазор: ${title}`, at: w.p, value: w.gap, limit: `${norm.gapMin}…${norm.gapMax} мм` });
    }
    if (hi - lo > norm.spreadMax) {
      const w = worst((s) => Math.abs(s.gap - (lo + hi) / 2));
      out.push({ ...base, id: `spread:${r.id}`, severity: 'warning', kind: 'gap-spread', title: `Неравномерный зазор: ${title}`, at: w.p, value: round(hi - lo), limit: `разброс ≤ ${norm.spreadMax} мм` });
    }
    const fl = Math.max(...samples.map((s) => Math.abs(s.flush)));
    if (fl > norm.flushTol) {
      const w = worst((s) => Math.abs(s.flush));
      out.push({ ...base, id: `flush:${r.id}`, severity: 'warning', kind: 'flush', title: `Перепад по стыку: ${title}`, at: w.p, value: w.flush, limit: `±${norm.flushTol} мм` });
    }
    return { issues: out, profile: { rule: r.id, a: r.a, b: r.b, samples } };
  }

  private motionRule(project: Project, r: Extract<Rule, { kind: 'motion' }>, related: (a: string, b: string) => boolean) {
    const M = this.items.get(r.part);
    const out: Issue[] = [];
    if (!M) return { issues: out, poses: 0 };
    const norm = clearanceNorm(r.norm, project);
    const moving = [M, ...[...this.items.values()].filter((it) => it.def.joint.type === 'mounted' && (it.def.joint as { to: string }).to === r.part)];
    const movingIds = new Set(moving.map((m) => m.def.id));
    const others = [...this.items.values()].filter((o) => !movingIds.has(o.def.id) && !(o.def.joint.type === 'wheel' && M.def.joint.type === 'wheel'));
    const list = motionPoses(M.def);
    const found = new Map<string, Issue>();
    const box = new THREE.Box3();
    for (const pose of list) {
      for (const m of moving) {
        box.copy(m.box).applyMatrix4(pose.matrix).expandByScalar(norm.min);
        for (const o of others) {
          if (related(m.def.id, o.def.id)) continue;
          if (!box.intersectsBox(o.box)) continue;
          const key = `${m.def.id}|${o.def.id}`;
          const prev = found.get(key);
          if (prev?.kind === 'collision') continue;
          const hit = this.closest(o, m, pose.matrix, norm.min);
          if (!hit || !this.confirmed(o, m, hit, Math.max(norm.min, 0.05), pose.matrix)) continue;
          const coll = hit.distance < 1e-3 && o.bvh.intersectsGeometry(m.geom, pose.matrix) && this.confirmed(o, m, hit, 0.05, pose.matrix);
          if (prev && !coll && (prev.value ?? 0) <= hit.distance) continue;
          found.set(key, {
            id: `motion:${r.part}:${key}`, severity: coll ? 'error' : 'warning', kind: coll ? 'collision' : 'clearance',
            title: `${coll ? 'Пересечение' : 'Зазор меньше нормы'} при движении: ${m.def.title} и ${o.def.title}`,
            parts: [m.def.id, o.def.id], at: v3(hit.point), value: coll ? 0 : round(hit.distance),
            limit: `≥ ${norm.min} мм`, norm: norm.id, source: norm.source,
            pose: { part: r.part, t: pose.t, label: pose.label },
          });
        }
      }
    }
    out.push(...found.values());
    return { issues: out, poses: list.length };
  }

  private regulations(project: Project): Issue[] {
    const out: Issue[] = [];
    const byRole = (role: string) => [...this.items.values()].filter((it) => it.def.role === role);
    let maxY = 0;
    for (const it of this.items.values()) {
      if (['outer', 'closures'].includes(it.def.layer)) maxY = Math.max(maxY, Math.abs(it.box.min.y), Math.abs(it.box.max.y));
    }
    for (const n of regulationNorms(project)) {
      for (const it of byRole(n.part)) {
        const b = it.box;
        const at = centerOf(b);
        const push = (ok: boolean, value: number, limit: string) => {
          if (ok) return;
          out.push({ id: `reg:${n.id}:${it.def.id}`, severity: 'error', kind: 'regulation', title: `${n.title}: ${it.def.title}`, parts: [it.def.id], at, value: round(value), limit, norm: n.id, source: n.source });
        };
        const nn = n as unknown as Record<string, number>;
        if (n.measure === 'zRange') {
          push(b.min.z >= nn.min, b.min.z, `нижняя кромка ≥ ${nn.min} мм`);
          push(b.max.z <= nn.max, b.max.z, `верхняя кромка ≤ ${nn.max} мм`);
        } else if (n.measure === 'zMin') {
          push(b.min.z >= nn.min, b.min.z, `≥ ${nn.min} мм`);
        } else if (n.measure === 'lateralFromEdge') {
          const edge = Math.max(Math.abs(b.min.y), Math.abs(b.max.y));
          push(maxY - edge <= nn.max, maxY - edge, `≤ ${nn.max} мм`);
        } else if (n.measure === 'plateSize') {
          push(b.max.y - b.min.y >= nn.minWidth, b.max.y - b.min.y, `ширина ≥ ${nn.minWidth} мм`);
          push(b.max.z - b.min.z >= nn.minHeight, b.max.z - b.min.z, `высота ≥ ${nn.minHeight} мм`);
        }
      }
    }
    return out;
  }
}

/** Ближайшая к q точка наружной кромки детали и нормаль в ней. */
function edgeNear(e: EdgeSamples, q: THREE.Vector3): { p: THREE.Vector3; n: THREE.Vector3 } | null {
  let best = 25;
  let k = -1;
  for (let i = 0; i < e.p.length; i += 3) {
    const d = Math.hypot(e.p[i] - q.x, e.p[i + 1] - q.y, e.p[i + 2] - q.z);
    if (d < best) {
      best = d;
      k = i;
    }
  }
  return k < 0 ? null : { p: new THREE.Vector3(e.p[k], e.p[k + 1], e.p[k + 2]), n: new THREE.Vector3(e.n[k], e.n[k + 1], e.n[k + 2]) };
}

const _t = new THREE.Triangle();
function faceNormal(g: THREE.BufferGeometry, face: number) {
  const pos = g.attributes.position as THREE.BufferAttribute;
  const idx = g.index!;
  _t.a.fromBufferAttribute(pos, idx.getX(face * 3));
  _t.b.fromBufferAttribute(pos, idx.getX(face * 3 + 1));
  _t.c.fromBufferAttribute(pos, idx.getX(face * 3 + 2));
  return _t.getNormal(new THREE.Vector3());
}

function centerOf(b: THREE.Box3): Vec3 {
  const c = b.getCenter(new THREE.Vector3());
  return [round(c.x), round(c.y), round(c.z)];
}
