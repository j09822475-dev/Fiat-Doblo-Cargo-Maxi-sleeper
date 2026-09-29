// Построение замкнутых сеток деталей. Листовая деталь задаётся наружной поверхностью
// (сеткой точек) и толщиной: сетка сдвигается внутрь кузова, края сшиваются стенками.
// Все сетки замкнутые и ориентированы нормалями наружу — это нужно для проверок
// пересечений и для заливки среза в режиме сечения.
import * as THREE from 'three';
import type { Vec3 } from '../core/types';

export interface EdgeSamples {
  /** Точки наружной кромки детали, x,y,z подряд. */
  p: number[];
  /** Наружная нормаль поверхности в этих точках. */
  n: number[];
  /** Касательная к кромке (направление обхода). */
  t: number[];
}

export interface PartMesh {
  geometry: THREE.BufferGeometry;
  edges: EdgeSamples;
}

type P = [number, number, number];

const sub = (a: P, b: P): P => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: P, b: P): P => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a: P, b: P) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: P): P => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** Направление «внутрь кузова» по умолчанию: к оси машины. */
export const inwardHint = (p: P): P => [1500 - p[0], -p[1], 900 - p[2]];

/** Накопитель треугольников с автоматической ориентацией граней. */
export class MeshBuilder {
  pos: number[] = [];
  idx: number[] = [];

  vertex(p: P) {
    this.pos.push(p[0], p[1], p[2]);
    return this.pos.length / 3 - 1;
  }

  /** Треугольник, развёрнутый так, чтобы его нормаль смотрела в сторону out. */
  tri(a: number, b: number, c: number, out: P) {
    const pa: P = [this.pos[a * 3], this.pos[a * 3 + 1], this.pos[a * 3 + 2]];
    const pb: P = [this.pos[b * 3], this.pos[b * 3 + 1], this.pos[b * 3 + 2]];
    const pc: P = [this.pos[c * 3], this.pos[c * 3 + 1], this.pos[c * 3 + 2]];
    const n = cross(sub(pb, pa), sub(pc, pa));
    if (dot(n, n) < 1e-12) return; // вырожденный треугольник
    if (dot(n, out) >= 0) this.idx.push(a, b, c);
    else this.idx.push(a, c, b);
  }

  /** Четырёхугольник делится по более короткой диагонали — сетка ровнее и зеркально симметрична. */
  quad(a: number, b: number, c: number, d: number, out: P) {
    const P = this.pos;
    const dist = (i: number, j: number) => Math.hypot(P[i * 3] - P[j * 3], P[i * 3 + 1] - P[j * 3 + 1], P[i * 3 + 2] - P[j * 3 + 2]);
    if (dist(a, c) <= dist(b, d) + 1e-9) {
      this.tri(a, b, c, out);
      this.tri(a, c, d, out);
    } else {
      this.tri(a, b, d, out);
      this.tri(b, c, d, out);
    }
  }

  append(g: THREE.BufferGeometry) {
    const base = this.pos.length / 3;
    const p = g.attributes.position.array;
    for (let i = 0; i < p.length; i++) this.pos.push(p[i]);
    if (g.index) for (let i = 0; i < g.index.count; i++) this.idx.push(g.index.getX(i) + base);
    else for (let i = 0; i < p.length / 3; i++) this.idx.push(base + i);
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setIndex(this.idx);
    g.computeVertexNormals();
    g.computeBoundingBox();
    return g;
  }
}

/**
 * Листовая деталь из сетки наружной поверхности.
 * @param surf — точка поверхности по параметрам u,v ∈ [0,1]
 * @param depth — толщина (или глубина объёма) в точке, мм
 */
export function shellFromSurface(
  mb: MeshBuilder,
  edges: EdgeSamples,
  surf: (u: number, v: number) => P,
  nu: number,
  nv: number,
  depth: number | ((u: number, v: number) => number),
  hint: (p: P) => P = inwardHint,
  /** Точная нормаль поверхности (внутрь). Без неё нормаль считается по сетке. */
  normalAt?: (p: P) => P,
) {
  const dfn = typeof depth === 'number' ? () => depth : depth;
  const row = nu + 1;
  const outer: P[] = [];
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) outer.push(surf(i / nu, j / nv));
  // нормаль сетки по разностям соседей, развёрнутая внутрь кузова
  // нормаль поверхности по сетке (для перепада на кромках) и направление толщины
  const surfaceN: P[] = outer.map((p, k) => {
    const i = k % row;
    const j = Math.floor(k / row);
    const du = sub(outer[j * row + Math.min(nu, i + 1)], outer[j * row + Math.max(0, i - 1)]);
    const dv = sub(outer[Math.min(nv, j + 1) * row + i], outer[Math.max(0, j - 1) * row + i]);
    let n = cross(du, dv);
    if (dot(n, n) < 1e-9) n = hint(p);
    n = norm(n);
    return dot(n, hint(p)) < 0 ? ([-n[0], -n[1], -n[2]] as P) : n;
  });
  const inward: P[] = normalAt ? outer.map((p) => norm(normalAt(p))) : surfaceN;
  const inner: P[] = outer.map((p, k) => {
    const d = dfn((k % row) / nu, Math.floor(k / row) / nv);
    return [p[0] + inward[k][0] * d, p[1] + inward[k][1] * d, p[2] + inward[k][2] * d];
  });
  const oi = outer.map((p) => mb.vertex(p));
  const ii = inner.map((p) => mb.vertex(p));
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = j * row + i;
      const n = inward[a];
      mb.quad(oi[a], oi[a + 1], oi[a + row + 1], oi[a + row], [-n[0], -n[1], -n[2]]);
      mb.quad(ii[a], ii[a + 1], ii[a + row + 1], ii[a + row], n);
    }
  }
  // контур сетки по кругу: низ → правый край → верх → левый край
  // контур и для каждой точки — соседняя точка внутри сетки (стенка смотрит от неё наружу)
  const ring: number[] = [];
  const into: number[] = [];
  for (let i = 0; i < nu; i++) { ring.push(i); into.push(row + i); }
  for (let j = 0; j < nv; j++) { ring.push(j * row + nu); into.push(j * row + nu - 1); }
  for (let i = nu; i > 0; i--) { ring.push(nv * row + i); into.push((nv - 1) * row + i); }
  for (let j = nv; j > 0; j--) { ring.push(j * row); into.push(j * row + 1); }
  for (let r = 0; r < ring.length; r++) {
    const a = ring[r];
    const b = ring[(r + 1) % ring.length];
    const n = inward[a];
    let out = sub(outer[a], outer[into[r]]);
    // если сетка в этом месте вырождена, берём направление от середины детали
    if (dot(out, out) < 1e-6) {
      const c = outer[Math.floor(outer.length / 2)];
      out = sub(outer[a], c);
    }
    out = sub(out, [n[0] * dot(out, n), n[1] * dot(out, n), n[2] * dot(out, n)]);
    const wa = mb.vertex(outer[a]);
    const wb = mb.vertex(outer[b]);
    const wc = mb.vertex(inner[b]);
    const wd = mb.vertex(inner[a]);
    mb.quad(wa, wb, wc, wd, out);
    const sn = surfaceN[a];
    edges.p.push(...outer[a]);
    edges.n.push(-sn[0], -sn[1], -sn[2]);
    edges.t.push(...norm(sub(outer[b], outer[a])));
  }
}

/** Прямоугольный брус между двумя точками (пороги, стойки, поперечины). */
export function beam(mb: MeshBuilder, a: Vec3, b: Vec3, w: number, h: number, up: Vec3 = [0, 0, 1]) {
  const dir = norm(sub(b as P, a as P));
  let side = cross(dir, up as P);
  if (dot(side, side) < 1e-6) side = cross(dir, [1, 0, 0]);
  side = norm(side);
  const top = norm(cross(side, dir));
  const corners = (p: Vec3): P[] =>
    [
      [-1, -1], [1, -1], [1, 1], [-1, 1],
    ].map(([s, t]) => [
      p[0] + (side[0] * s * w) / 2 + (top[0] * t * h) / 2,
      p[1] + (side[1] * s * w) / 2 + (top[1] * t * h) / 2,
      p[2] + (side[2] * s * w) / 2 + (top[2] * t * h) / 2,
    ]);
  box8(mb, [...corners(a), ...corners(b)]);
}

/** Шестигранник по 8 вершинам: 0–3 — нижнее кольцо, 4–7 — верхнее (в том же порядке обхода). */
export function box8(mb: MeshBuilder, v: P[]) {
  const c = v.reduce<P>((s, p) => [s[0] + p[0] / 8, s[1] + p[1] / 8, s[2] + p[2] / 8], [0, 0, 0]);
  const id = v.map((p) => mb.vertex(p));
  const faces = [
    [0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7],
  ];
  for (const f of faces) {
    const m: P = [0, 1, 2, 3].reduce<P>((s, k) => [s[0] + v[f[k]][0] / 4, s[1] + v[f[k]][1] / 4, s[2] + v[f[k]][2] / 4], [0, 0, 0]);
    mb.quad(id[f[0]], id[f[1]], id[f[2]], id[f[3]], sub(m, c));
  }
}

/** Прямоугольный параллелепипед по двум углам. */
export function aabb(mb: MeshBuilder, min: Vec3, max: Vec3) {
  const [x0, y0, z0] = min;
  const [x1, y1, z1] = max;
  box8(mb, [
    [x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0],
    [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1],
  ]);
}

/** Тело вращения вокруг оси Y (колёса). profile — пары [радиус, смещение по Y]. */
export function lathe(mb: MeshBuilder, center: Vec3, profile: [number, number][], seg = 40) {
  const ring = (k: number) => profile.map(([r, y]) => {
    const a = (k / seg) * Math.PI * 2;
    return mb.vertex([center[0] + r * Math.cos(a), center[1] + y, center[2] + r * Math.sin(a)]);
  });
  const rings: number[][] = [];
  for (let k = 0; k < seg; k++) rings.push(ring(k));
  for (let k = 0; k < seg; k++) {
    const r0 = rings[k];
    const r1 = rings[(k + 1) % seg];
    const a = ((k + 0.5) / seg) * Math.PI * 2;
    for (let i = 0; i < profile.length; i++) {
      const i2 = (i + 1) % profile.length;
      // наружу — от средней линии профиля
      const mr = (profile[i][0] + profile[i2][0]) / 2;
      const my = (profile[i][1] + profile[i2][1]) / 2;
      const dr = profile[i2][0] - profile[i][0];
      const dy = profile[i2][1] - profile[i][1];
      // нормаль к ребру профиля в плоскости (r, y), выбор стороны — от центра профиля
      const cr = profile.reduce((s, p) => s + p[0], 0) / profile.length;
      const cy = profile.reduce((s, p) => s + p[1], 0) / profile.length;
      let nr = dy;
      let ny = -dr;
      if (nr * (mr - cr) + ny * (my - cy) < 0) {
        nr = -nr;
        ny = -ny;
      }
      mb.quad(r0[i], r1[i], r1[i2], r0[i2], [nr * Math.cos(a), ny, nr * Math.sin(a)]);
    }
  }
}

/** Цилиндр вдоль заданной оси. */
export function cylinder(mb: MeshBuilder, a: Vec3, b: Vec3, r: number, seg = 24) {
  const dir = norm(sub(b as P, a as P));
  let u = cross(dir, [0, 0, 1]);
  if (dot(u, u) < 1e-6) u = cross(dir, [1, 0, 0]);
  u = norm(u);
  const w = cross(dir, u);
  const ringA: number[] = [];
  const ringB: number[] = [];
  const pt = (c: Vec3, k: number): P => {
    const t = (k / seg) * Math.PI * 2;
    return [c[0] + r * (u[0] * Math.cos(t) + w[0] * Math.sin(t)), c[1] + r * (u[1] * Math.cos(t) + w[1] * Math.sin(t)), c[2] + r * (u[2] * Math.cos(t) + w[2] * Math.sin(t))];
  };
  for (let k = 0; k < seg; k++) {
    ringA.push(mb.vertex(pt(a, k)));
    ringB.push(mb.vertex(pt(b, k)));
  }
  const ca = mb.vertex(a as P);
  const cb = mb.vertex(b as P);
  for (let k = 0; k < seg; k++) {
    const k2 = (k + 1) % seg;
    const t = ((k + 0.5) / seg) * Math.PI * 2;
    const out: P = [u[0] * Math.cos(t) + w[0] * Math.sin(t), u[1] * Math.cos(t) + w[1] * Math.sin(t), u[2] * Math.cos(t) + w[2] * Math.sin(t)];
    mb.quad(ringA[k], ringA[k2], ringB[k2], ringB[k], out);
    mb.tri(ca, ringA[k], ringA[k2], [-dir[0], -dir[1], -dir[2]]);
    mb.tri(cb, ringB[k], ringB[k2], dir);
  }
}

/** Объём сетки (для массы). Для замкнутой ориентированной сетки. */
export function volume(g: THREE.BufferGeometry): number {
  const p = g.attributes.position.array;
  const idx = g.index!;
  let v = 0;
  for (let i = 0; i < idx.count; i += 3) {
    const a = idx.getX(i) * 3;
    const b = idx.getX(i + 1) * 3;
    const c = idx.getX(i + 2) * 3;
    v += p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) - p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) + p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c]);
  }
  return Math.abs(v / 6);
}
