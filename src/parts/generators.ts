// Генераторы деталей Fiat Doblò Cargo Maxi. Каждая деталь — участок управляющих
// поверхностей (BodyForm) с толщиной или простое тело. Параметры деталей
// (зазоры, глубины, положения) берутся из PartDef.params и редактируются в интерфейсе.
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import type { PartDef, Project } from '../core/types';
import { BodyForm } from '../geometry/bodyform';
import {
  MeshBuilder, shellFromSurface, beam, aabb, box8, lathe, cylinder,
  type EdgeSamples, type PartMesh,
} from '../geometry/mesh';

type P = [number, number, number];
type F = (a: number) => number;

interface Ctx {
  f: BodyForm;
  mb: MeshBuilder;
  e: EdgeSamples;
  /** Участки детали: диапазоны треугольников и точек кромки (для отсева внутренних швов). */
  pieces: { tri: [number, number]; edge: [number, number] }[];
}

const fn = (v: number | F): F => (typeof v === 'number' ? () => v : v);

/**
 * Универсальный участок: первичная координата a ∈ [a0, a1], вторичная b ∈ [b0(a), b1(a)].
 * pt(a, b) — точка наружной поверхности.
 */
function patch(
  c: Ctx,
  a0: number,
  a1: number,
  b0: number | F,
  b1: number | F,
  pt: (a: number, b: number) => P,
  depth: number | ((a: number, b: number) => number),
  nu = 24,
  nv = 12,
  hint?: (p: P) => P,
  normalAt?: (p: P) => P,
  /** Минимальная ширина участка в единицах b (мм или доля дуги сечения). */
  minSpan = 0.5,
) {
  const lo = fn(b0);
  const hi = fn(b1);
  // участок может быть пустым на части длины (обрезан аркой, фарой и т. п.):
  // строим только непустые куски, иначе остаются полоски нулевой высоты
  const N = 400;
  const ranges: [number, number][] = [];
  let start = -1;
  for (let i = 0; i <= N; i++) {
    const a = a0 + ((a1 - a0) * i) / N;
    const ok = hi(a) - lo(a) > minSpan;
    if (ok && start < 0) start = i;
    if ((!ok || i === N) && start >= 0) {
      const end = ok ? i : i - 1;
      if (end > start) ranges.push([a0 + ((a1 - a0) * start) / N, a0 + ((a1 - a0) * end) / N]);
      start = -1;
    }
  }
  if (ranges.length !== 1 || ranges[0][0] !== a0 || ranges[0][1] !== a1) {
    for (const [r0, r1] of ranges) {
      const share = Math.abs(r1 - r0) / Math.abs(a1 - a0);
      patch(c, r0, r1, b0, b1, pt, depth, Math.max(2, Math.round(nu * share)), nv, hint, normalAt, minSpan);
    }
    return;
  }
  const coord = (u: number, v: number): [number, number] => {
    const a = a0 + (a1 - a0) * u;
    const h = hi(a);
    const l = Math.min(lo(a), h);
    return [a, l + (h - l) * v];
  };
  const d = typeof depth === 'number' ? depth : (u: number, v: number) => depth(...coord(u, v));
  const t0 = c.mb.idx.length;
  const e0 = c.e.p.length;
  shellFromSurface(c.mb, c.e, (u, v) => pt(...coord(u, v)), nu, nv, d, hint, normalAt);
  c.pieces.push({ tri: [t0, c.mb.idx.length], edge: [e0, c.e.p.length] });
}

/** Участок боковины: x ∈ [x0, x1], z ∈ [zlo(x), zhi(x)], обрезка аркой и плечом крыши. */
function side(
  c: Ctx, s: number, x0: number, x1: number, zlo: number | F, zhi: number | F,
  depth: number | ((x: number, z: number) => number), opts: { nu?: number; nv?: number; off?: number; arch?: number } = {},
) {
  const { f } = c;
  const lo = fn(zlo);
  const hi = fn(zhi);
  const arch = opts.arch ?? 0;
  patch(
    c, x0, x1,
    (x) => Math.max(lo(x), f.archTop(x, arch)),
    (x) => Math.min(hi(x), f.shoulder(x)),
    (x, z) => f.side(s, x, z, opts.off ?? 0),
    // шаг сетки вдоль кузова не больше 20 мм: хорды не срезают изгибы кромок
    depth, Math.max(opts.nu ?? 24, Math.ceil(Math.abs(x1 - x0) / 20)), opts.nv ?? 12, undefined,
    (q) => f.sideInward(s, q[0], q[2]),
  );
}

/** Участок верха сечения (крыша, капот, стекло): x ∈ [x0, x1], s ∈ [s0(x), s1(x)]. */
function top(c: Ctx, x0: number, x1: number, s0: number | F, s1: number | F, depth: number | ((x: number, s: number) => number), off = 0, nu = 20, nv = 24) {
  patch(c, x0, x1, s0, s1, (x, s) => c.f.top(x, s, off), depth, Math.max(nu, Math.ceil(Math.abs(x1 - x0) / 20)), nv, undefined, undefined, 0.0005);
}

/** Участок носовой поверхности: y ∈ [y0, y1], z ∈ [zlo(y), zhi(y)]. */
function front(c: Ctx, y0: number, y1: number, zlo: number | F, zhi: number | F, depth: number | ((y: number, z: number) => number), off = 0, nu = 20, nv = 10) {
  const { f } = c;
  patch(
    c, y0, y1, zlo, zhi,
    (y, z) => {
      const lim = f.frontHalf(z);
      return f.front(Math.max(-lim, Math.min(lim, y)), z, off);
    },
    depth, nu, nv, undefined, () => [1, 0, 0],
  );
}

/** Участок задней плоскости кузова: z ∈ [z0, z1], y ∈ [y0(z), y1(z)]. */
function rear(c: Ctx, z0: number, z1: number, y0: number | F, y1: number | F, depth: number, off = 0, nu = 12, nv = 12) {
  const x = c.f.xRear + off;
  patch(c, z0, z1, y0, y1, (z, y) => [x, y, z], depth, nu, nv);
}

/** Призма: выпуклый профиль в плоскости XZ, вытянутый по Y. */
function prism(c: Ctx, poly: [number, number][], y0: number, y1: number) {
  const { mb } = c;
  const cx = poly.reduce((s, p) => s + p[0], 0) / poly.length;
  const cz = poly.reduce((s, p) => s + p[1], 0) / poly.length;
  const a = poly.map(([x, z]) => mb.vertex([x, y0, z]));
  const b = poly.map(([x, z]) => mb.vertex([x, y1, z]));
  const ca = mb.vertex([cx, y0, cz]);
  const cb = mb.vertex([cx, y1, cz]);
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length;
    const mx = (poly[i][0] + poly[j][0]) / 2 - cx;
    const mz = (poly[i][1] + poly[j][1]) / 2 - cz;
    mb.quad(a[i], a[j], b[j], b[i], [mx, 0, mz]);
    mb.tri(ca, a[i], a[j], [0, -1, 0]);
    mb.tri(cb, b[i], b[j], [0, 1, 0]);
  }
}

// ------------------------------------------------------------------ генераторы

type Gen = (c: Ctx, p: Record<string, number>, part: PartDef, project: Project) => void;

const doorTop = (f: BodyForm) => (x: number) => f.shoulder(x) - 55;

/** Верхняя кромка двери с зазором g, отложенным по нормали к наклонной кромке проёма. */
const doorTopGap = (f: BodyForm, g: number) => (x: number) => {
  const dt = doorTop(f);
  const slope = (dt(x + 5) - dt(x - 5)) / 10;
  return dt(x) - g * Math.sqrt(1 + slope * slope);
};

const G: Record<string, Gen> = {
  // Наружная боковина: всё, что не занято проёмами дверей, фарами и фонарями
  sideOuter(c, p) {
    const { f } = c;
    const h = f.h;
    const s = p.side;
    const t = 0.8;
    const slide = s > 0; // сдвижная дверь только справа
    const dt = doorTop(f);
    const low = (x: number) => (x > f.xRear - 360 ? h.zRearSill + 1 : f.v.bodyBottom);
    const lampX = f.xRear - 110;
    // стойка A между крылом и проёмом двери
    side(c, s, h.xCowl, h.xDoorFront, f.shoulder(h.xCowl), (x) => f.shoulder(x), t, { nu: 10, nv: 6 });
    // рельс над дверями
    side(c, s, h.xDoorFront, f.xRear, dt, (x) => f.shoulder(x), t, { nu: 60, nv: 2 });
    // порог под проёмами
    side(c, s, h.xDoorFront, h.xDoorRear, low, h.zSill, t, { nu: 20, nv: 2 });
    if (slide) {
      side(c, s, h.xDoorRear, h.xSlideFront, low, dt, t, { nu: 3, nv: 16 });
      side(c, s, h.xSlideFront, h.xSlideRear, low, h.zSill, t, { nu: 16, nv: 2 });
      side(c, s, h.xSlideRear, lampX - 3, low, dt, t, { nu: 30, nv: 16 });
    } else {
      side(c, s, h.xDoorRear, lampX - 3, low, dt, t, { nu: 50, nv: 16 });
    }
    // угол у заднего фонаря: ниже и выше фонаря
    side(c, s, lampX - 3, f.xRear, low, 897, t, { nu: 6, nv: 8 });
    side(c, s, lampX - 3, f.xRear, 1563, dt, t, { nu: 6, nv: 4 });
    // стойка лобового стекла (дуга верха сечения)
    top(c, h.xCowl, h.xRoofFront, s > 0 ? 0.9 : -1, s > 0 ? 1 : -0.9, t, 0, 16, 4);
  },

  roof(c) {
    top(c, c.f.h.xRoofFront, c.f.xRear, -1, 1, 0.8, 0, 40, 30);
  },

  // Переднее крыло: от шва носа до проёма двери, снизу — бампер и арка, сверху — капот и фара
  fender(c, p) {
    const { f } = c;
    const h = f.h;
    const s = p.side;
    // спереди крыло начинается за фарой, снизу — над бампером и аркой, сверху — до капота
    const zTop = (x: number) => (x < h.xCowl ? f.shoulder(x) : f.shoulder(h.xCowl));
    const zLow = (x: number) => (x <= -390 ? bumperSideTop(f, x) + p.gapBumper : f.v.bodyBottom);
    // отдельный участок у бампера, чтобы вертикальная кромка у арки легла точно в узлы сетки
    side(c, s, f.xLampEnd + p.gapLamp, -390, zLow, zTop, 0.8, { nu: 30, nv: 14 });
    side(c, s, -390, h.xDoorFront, f.v.bodyBottom, zTop, 0.8, { nu: 60, nv: 14 });
  },

  hood(c, p) {
    const { f } = c;
    const h = f.h;
    const g = p.gap;
    // кромка капота у фары идёт по диагонали: зазор откладываем поперёк шва, а не вдоль сечения
    const edge = (x: number) => {
      const L = f.topHalfArc(x);
      const slope = ((f.lampS(x + 5) - f.lampS(x - 5)) / 10) * L;
      return f.lampS(x) - (g * Math.sqrt(1 + slope * slope)) / L;
    };
    // у кромок — отбортовка толщиной p.flange, к середине капот набирает полную глубину
    const flange = p.flange;
    const d = (x: number, s: number) =>
      Math.min(p.depth, flange + 0.3 * Math.min(x - h.xNoseSeam, h.xCowl - g - x, (edge(x) - Math.abs(s)) * f.topHalfArc(x)));
    top(c, h.xNoseSeam, h.xCowl - g, (x) => -edge(x), edge, d, 0, 40, 96);
    // передняя кромка капота над решёткой, между фарами
    front(c, -h.yLampInner + g, h.yLampInner - g, 900 + g, (y) => f.sectionTop(h.xNoseSeam, y) - 1, flange, 0, 16, 4);
  },

  frontDoor(c, p) {
    const { f } = c;
    const h = f.h;
    const s = p.side;
    const g = p.gap;
    const x0 = h.xDoorFront + g;
    const x1 = h.xDoorRear - g;
    const zt = doorTopGap(f, g);
    // клиновидная передняя кромка: даёт место для поворота вокруг петель
    const wedge = (x: number) => Math.min(p.depth, 12 + (x - x0) * p.frontBevel, 12 + (x1 - x) * 1.5);
    side(c, s, x0, x1, h.zSill + g, h.zBelt, (x) => wedge(x), { nu: 90, nv: 10, arch: p.archGap });
    const fw = Math.min(30, p.depth);
    side(c, s, x0, x0 + 60, h.zBelt, zt, (x) => Math.min(fw, wedge(x)), { nu: 4, nv: 10 });
    side(c, s, x1 - 70, x1, h.zBelt, zt, fw, { nu: 4, nv: 10 });
    side(c, s, x0 + 60, x1 - 70, (x) => zt(x) - 40, zt, fw, { nu: 24, nv: 2 });
  },

  frontDoorGlass(c, p) {
    const { f } = c;
    const h = f.h;
    const g = p.gap;
    const top = doorTopGap(f, g);
    const zt = (x: number) => top(x) - 40;
    side(c, p.side, h.xDoorFront + g + 60, h.xDoorRear - g - 70, h.zBelt, zt, 4, { off: -12, nu: 20, nv: 8 });
  },

  slideDoor(c, p) {
    const { f } = c;
    const h = f.h;
    const g = p.gap;
    side(c, p.side, h.xSlideFront + g, h.xSlideRear - g, h.zSill + g, doorTopGap(f, g), p.depth, { nu: 28, nv: 18 });
  },

  rearDoor(c, p) {
    const { f } = c;
    const h = f.h;
    const g = p.gap;
    const gc = p.gapCenter / 2;
    const split = p.split;
    const edge = (z: number) => f.rearEdge(z) - g;
    if (p.side < 0) rear(c, h.zRearSill + g, h.zRearTop - g, (z) => -edge(z), split - gc, p.depth, 0, 12, 14);
    else rear(c, h.zRearSill + g, h.zRearTop - g, split + gc, edge, p.depth, 0, 12, 14);
  },

  // Задняя рамка проёма: стойки, полоски у проёма, верхняя поперечина
  rearFrame(c) {
    const { f } = c;
    const h = f.h;
    const t = 0.8;
    const hw = (z: number) => f.halfWidth(f.xRear, z);
    for (const s of [-1, 1]) {
      const inner = (z: number) => f.rearEdge(z);
      const lampIn = (z: number) => f.rearEdge(z) + 22;
      const y = (fz: F) => (s > 0 ? fz : (z: number) => -fz(z));
      const pair = (a: F, b: F): [F, F] => (s > 0 ? [a, b] : [y(b), y(a)]);
      rear(c, h.zRearSill + 1, 897, ...pair(inner, hw), t, 0, 12, 4);
      rear(c, 897, 1563, ...pair(inner, lampIn), t, 0, 20, 2);
      rear(c, 1563, h.zRearTop, ...pair(inner, hw), t, 0, 6, 4);
    }
    const yMax = f.rearEdge(h.zRearTop);
    patch(c, -yMax, yMax, h.zRearTop, (yy) => f.sectionTop(f.xRear, yy) - 2, (yy, z) => [f.xRear, yy, z], t, 24, 6);
  },

  windshield(c, p) {
    const { f } = c;
    const h = f.h;
    top(c, h.xCowl + p.gap, h.xRoofFront - p.gap, -0.9 + 0.004, 0.9 - 0.004, 5, 0, 20, 24);
  },

  headlamp(c, p) {
    const { f } = c;
    const h = f.h;
    const s = p.side;
    const g = p.gap;
    const yIn = h.yLampInner;
    // лицевая часть на носу: сверху уходит под кромку капота (зазор g + отбортовка капота),
    // у угла продолжается на скругление крыла
    const yS = Math.abs(f.top(h.xNoseSeam, f.lampS(h.xNoseSeam))[1]);
    const yEdge = f.frontHalf(900);
    // под кромкой капота фара ниже на зазор g; за границей капота выходит на скругление
    const zUnder = (y: number) => f.sectionTop(h.xNoseSeam, y) - g;
    const zOpen = (y: number) => f.sectionTop(h.xNoseSeam, y);
    // корпус фары уходит вглубь, но у верхней кромки и у угла носа — тонкий край
    const dF = (zt: F) => (y: number, z: number) => Math.min(p.depth, 2 + (zt(y) - z) * 1.2, 2 + (yEdge - Math.abs(y)) * 1.0);
    const m = (fz: F): F => (y) => fz(-y);
    if (s > 0) {
      front(c, yIn, yS, f.zLampFront, zUnder, dF(zUnder), 0, 60, 8);
      front(c, yS, yEdge, f.zLampFront, zOpen, dF(zOpen), 0, 20, 8);
    } else {
      front(c, -yS, -yIn, f.zLampFront, m(zUnder), dF(m(zUnder)), 0, 60, 8);
      front(c, -yEdge, -yS, f.zLampFront, m(zOpen), dF(m(zOpen)), 0, 20, 8);
    }
    // часть на скруглении крыла и на боковине
    top(c, h.xNoseSeam, f.xLampEnd, s > 0 ? (x) => f.lampS(x) : -1, s > 0 ? 1 : (x) => -f.lampS(x), 3, 0, 16, 6);
    side(c, s, h.xNoseSeam, f.xLampEnd, (x) => f.lampBottom(x), (x) => f.shoulder(x), 6, { nu: 60, nv: 4 });
  },

  grille(c, p) {
    const { f } = c;
    const h = f.h;
    const bt = bumperFrontTop(f, 1.5);
    front(c, -h.yLampInner + p.gap, h.yLampInner - p.gap, (y) => bt(y) + p.gapBumper, 900, p.depth, 0, 80, 4);
  },

  bumperFront(c, p) {
    const { f } = c;
    const h = f.h;
    // по центру верх бампера — под решёткой, у фар — под фарами
    const topFront = bumperFrontTop(f, p.gapLamp);
    const dF = (y: number, z: number) => Math.min(p.depth, 4 + (topFront(y) - z) * 0.8);
    const yb = f.frontHalf(600);
    front(c, -yb, yb, 240, topFront, dF, 0, 180, 10);
    for (const s of [-1, 1]) {
      const top = (x: number) => bumperSideTop(f, x, p.gapLamp);
      // у угла носа нормаль боковины сильно наклонена вперёд: там бампер тонкий, чтобы объём не уходил под фару
      const dS = (x: number, z: number) => Math.min(p.depth, 4 + (top(x) - z) * 0.8, 4 + (-391.5 - x) * 0.8, 4 + (x - h.xNoseSeam) * 0.5);
      side(c, s, h.xNoseSeam, -391.5, 240, top, dS, { nu: 90, nv: 8, arch: 2 });
    }
  },

  bumperRear(c) {
    const { f } = c;
    const w = f.halfWidth(f.xRear, 400) + 20;
    box8(c.mb, [
      [f.xRear - 190, -w + 40, 265], [f.xRear + 35, -w + 40, 265], [f.xRear + 35, w - 40, 265], [f.xRear - 190, w - 40, 265],
      [f.xRear - 190, -w, 468], [f.xRear + 35, -w, 468], [f.xRear + 35, w, 468], [f.xRear - 190, w, 468],
    ]);
  },

  tailLamp(c, p) {
    const { f } = c;
    const s = p.side;
    const g = p.gap;
    const hw = (z: number) => f.halfWidth(f.xRear, z);
    const yin = (z: number) => f.rearEdge(z) + 22 + g;
    if (s > 0) rear(c, 900, 1490, yin, hw, p.depth, 0, 16, 4);
    else rear(c, 900, 1490, (z) => -hw(z), (z) => -yin(z), p.depth, 0, 16, 4);
    side(c, s, f.xRear - 110, f.xRear, 900, 1490, p.depth, { nu: 6, nv: 12 });
  },

  chmsl(c) {
    const x = c.f.xRear;
    aabb(c.mb, [x + 1, -150, 1740], [x + 16, 150, 1772]);
  },

  fogLamp(c, p) {
    const pt = c.f.front(p.side * 610, 370);
    cylinder(c.mb, [pt[0] + 40, pt[1], pt[2]], [pt[0] - 6, pt[1], pt[2]], 38);
  },

  plateRear(c) {
    const x = c.f.xRear;
    aabb(c.mb, [x - 14, -560, 900], [x - 4, -40, 1012]);
  },

  plateFront(c) {
    const pt = c.f.front(0, 560);
    aabb(c.mb, [pt[0] - 12, -260, 504], [pt[0] - 2, 260, 616]);
  },

  mirror(c, p) {
    const { f } = c;
    const s = p.side;
    const x = f.h.xDoorFront;
    const y0 = f.halfWidth(x, 1200) + 30;
    const lo: P = [x + 40, s > 0 ? y0 : -(y0 + 190), 1080];
    const hi: P = [x + 150, s > 0 ? y0 + 190 : -y0, 1330];
    aabb(c.mb, lo, hi);
    beam(c.mb, [x + 95, s * (y0 - 25), 1130], [x + 95, s * (y0 + 5), 1130], 40, 40, [1, 0, 0]);
  },

  moulding(c, p) {
    const { f } = c;
    const h = f.h;
    const g = p.gap;
    side(c, p.side, h.xDoorFront + g + 10, h.xDoorRear - g - 10, 470, 540, 10, { off: 10, nu: 20, nv: 2, arch: 30 });
  },

  // ---------- каркас кузова в белом
  sill(c, p) {
    const { f } = c;
    const s = p.side;
    const y = s * (f.hw - 90);
    beam(c.mb, [470, y, 370], [2690, y, 370], 90, 80);
  },

  bPillar(c, p) {
    const { f } = c;
    const s = p.side;
    const x = f.h.xDoorRear + 35;
    beam(c.mb, [x, s * (f.halfWidth(x, 430) - 75), 425], [x, s * (f.halfWidth(x, 1640) - 75), 1640], 50, 60);
  },

  roofBow(c, p) {
    top(c, p.x - 25, p.x + 25, -0.93, 0.93, 35, -1.5, 2, 20);
  },

  // пол кабины начинается за передними арками; между арками — наклонный щиток ног
  floorFront(c) {
    aabb(c.mb, [460, -780, 398], [1515, 780, 402]);
    aabb(c.mb, [62, -420, 398], [460, 420, 402]);
  },

  floorCargo(c) {
    const { f } = c;
    const xa = f.v.wheelbase;
    // пол заканчивается у порогов проёмов: сдвижная дверь и задние створки ложатся снаружи
    const w = f.hw - 110;
    const xEnd = f.xRear - 70;
    aabb(c.mb, [1515, -596, 478], [xEnd, 596, 482]);
    for (const s of [-1, 1]) {
      const y0 = s > 0 ? 600 : -w;
      const y1 = s > 0 ? w : -600;
      aabb(c.mb, [1515, y0, 478], [xa - 425, y1, 482]);
      aabb(c.mb, [xa + 425, y0, 478], [xEnd, y1, 482]);
    }
  },

  // щит: внизу только между арками колёс, выше арок — во всю ширину
  firewall(c) {
    aabb(c.mb, [58, -420, 402], [60, 420, 790]);
    aabb(c.mb, [58, -760, 790], [60, 760, 1080]);
  },

  radiatorSupport(c) {
    aabb(c.mb, [-835, -640, 480], [-805, 640, 860]);
  },

  frontRail(c, p) {
    const y = p.side * 380;
    beam(c.mb, [-800, y, 470], [55, y, 420], 60, 90);
  },

  // арка заднего колеса: дуга над колесом и внутренняя стенка
  wheelhouseRear(c, p) {
    const { f } = c;
    const s = p.side;
    const xa = f.v.wheelbase;
    const zc = f.v.tireRadius;
    const R = p.radius;
    const yIn = p.inner;
    const outward = (q: P): P => [q[0] - xa, 0, q[2] - zc];
    patch(
      c, 0, Math.PI, yIn, (th) => Math.min(895, f.halfWidth(xa - R * Math.cos(th), zc + R * Math.sin(th)) - 3),
      (th, y) => [xa - R * Math.cos(th), s * y, zc + R * Math.sin(th)], 1, 24, 6, outward,
    );
    patch(
      c, 0, Math.PI, 0, R, (th, r) => [xa - r * Math.cos(th), s * yIn, zc + r * Math.sin(th)], 1, 24, 4,
      () => [0, -s, 0],
    );
  },

  wheelLinerFront(c, p) {
    const { f } = c;
    const s = p.side;
    const zc = f.v.tireRadius;
    const R = p.radius;
    const yIn = p.inner;
    const outward = (q: P): P => [q[0], 0, q[2] - zc];
    patch(
      c, 0.05, Math.PI - 0.05, yIn, (th) => Math.min(900, f.halfWidth(-R * Math.cos(th), zc + R * Math.sin(th)) - 4),
      (th, y) => [-R * Math.cos(th), s * y, zc + R * Math.sin(th)], 2.5, 24, 6, outward,
    );
    patch(c, 0.05, Math.PI - 0.05, 0, R, (th, r) => [-r * Math.cos(th), s * yIn, zc + r * Math.sin(th)], 2.5, 24, 4, () => [0, -s, 0]);
  },

  // ---------- шасси и агрегаты
  wheel(c, p, _part, project) {
    const v = project.vehicle;
    const x = p.axle === 0 ? 0 : v.wheelbase;
    const track = p.axle === 0 ? v.trackFront : v.trackRear;
    const R = v.tireRadius;
    const w = v.tireWidth / 2;
    lathe(c.mb, [x, (p.side * track) / 2, R], [
      [205, -w + 8], [R - 30, -w], [R - 8, -w + 12], [R, -w + 40], [R, w - 40], [R - 8, w - 12], [R - 30, w], [205, w - 8],
    ], 40);
  },

  engine(c) {
    aabb(c.mb, [-740, -300, 380], [40, 300, 930]);
  },

  // ---------- интерьер
  instrumentPanel(c) {
    prism(c, [[140, 800], [330, 800], [470, 860], [560, 1000], [520, 1165], [330, 1190], [140, 1130]], -800, 800);
  },

  seat(c, p) {
    const s = p.side;
    const x = p.x;
    const y0 = s * 170;
    const y1 = s * 670;
    const [ya, yb] = s > 0 ? [y0, y1] : [y1, y0];
    aabb(c.mb, [x - 150, ya + 50, 402], [x + 150, yb - 50, 560]);
    aabb(c.mb, [x - 260, ya, 560], [x + 220, yb, 690]);
    const a = p.recline;
    const H = 800;
    const bx = x + 180;
    const T = 120;
    const dx = H * Math.sin(a);
    const dz = H * Math.cos(a);
    box8(c.mb, [
      [bx, ya, 640], [bx + T, ya, 640], [bx + T, yb, 640], [bx, yb, 640],
      [bx + dx, ya, 640 + dz], [bx + T + dx, ya, 640 + dz], [bx + T + dx, yb, 640 + dz], [bx + dx, yb, 640 + dz],
    ]);
  },

  steeringWheel(c, p) {
    const g = new THREE.TorusGeometry(185, 19, 10, 40);
    const m = new THREE.Matrix4();
    const pos = new THREE.Vector3(p.x, -420, p.z);
    const axis = new THREE.Vector3(Math.cos(0.55), 0, Math.sin(0.55));
    m.lookAt(new THREE.Vector3(), axis, new THREE.Vector3(0, 0, 1));
    m.setPosition(pos);
    g.applyMatrix4(m);
    c.mb.append(g.toNonIndexed());
  },

  bulkhead(c, p) {
    const { f } = c;
    const x = p.x;
    const yMax = f.halfWidth(x, 1000) - 70;
    patch(c, -yMax, yMax, 483, (y) => f.sectionTop(x, y) - 50, (y, z) => [x, y, z], 1.5, 24, 8);
  },

  doorSeal(c, p) {
    const { f } = c;
    const s = p.side;
    const x = f.h.xDoorRear + 8;
    beam(c.mb, [x, s * (f.halfWidth(x, 450) - 40), 450], [x, s * (f.halfWidth(x, 1500) - 40), 1500], 12, 12);
  },
};

/** Верх бампера на боковине: под фарой, за ней — вниз к передней кромке арки. */
function bumperSideTop(f: BodyForm, x: number, gap = 1.5) {
  const xl = f.xLampEnd;
  if (x < xl) return f.lampBottom(x) - gap;
  const k = Math.min(1, (x - xl) / (-390 - xl));
  return f.lampBottom(xl) - gap + (560 - (f.lampBottom(xl) - gap)) * k;
}

/** Верх бампера на носу: по центру под решёткой, у фар — под фарами. */
function bumperFrontTop(f: BodyForm, gapLamp: number) {
  const h = f.h;
  return (y: number) => {
    const k = Math.min(1, Math.max(0, (Math.abs(y) - (h.yLampInner - 120)) / 120));
    return h.zBumperTop + (f.zLampFront - gapLamp - h.zBumperTop) * k * k * (3 - 2 * k);
  };
}

export const GENERATORS = Object.keys(G);

export function buildPart(part: PartDef, project: Project, form: BodyForm): PartMesh {
  const gen = G[part.generator];
  if (!gen) throw new Error(`Неизвестный генератор «${part.generator}» у детали ${part.id}`);
  const c: Ctx = { f: form, mb: new MeshBuilder(), e: { p: [], n: [], t: [] }, pieces: [] };
  gen(c, part.params, part, project);
  return { geometry: c.mb.build(), edges: dropInternalSeams(c) };
}

/** Убирает точки кромки, которые лежат на стыке с другим участком той же детали. */
function dropInternalSeams(c: Ctx): EdgeSamples {
  if (c.pieces.length < 2) return c.e;
  const keep = new Array(c.e.p.length / 3).fill(true);
  const pos = new THREE.Float32BufferAttribute(c.mb.pos, 3);
  const target = { point: new THREE.Vector3(), distance: 0, faceIndex: 0 };
  const p = new THREE.Vector3();
  for (let k = 0; k < c.pieces.length; k++) {
    const others: number[] = [];
    c.pieces.forEach((pc, j) => {
      if (j !== k) for (let i = pc.tri[0]; i < pc.tri[1]; i++) others.push(c.mb.idx[i]);
    });
    if (!others.length) continue;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', pos);
    g.setIndex(others);
    const bvh = new MeshBVH(g);
    const [e0, e1] = c.pieces[k].edge;
    for (let i = e0; i < e1; i += 3) {
      p.set(c.e.p[i], c.e.p[i + 1], c.e.p[i + 2]);
      const hit = bvh.closestPointToPoint(p, target, 0, 1.5);
      if (hit && hit.distance < 1.5) keep[i / 3] = false;
    }
  }
  const out: EdgeSamples = { p: [], n: [], t: [] };
  keep.forEach((k, i) => {
    if (!k) return;
    out.p.push(c.e.p[i * 3], c.e.p[i * 3 + 1], c.e.p[i * 3 + 2]);
    out.n.push(c.e.n[i * 3], c.e.n[i * 3 + 1], c.e.n[i * 3 + 2]);
    out.t.push(c.e.t[i * 3], c.e.t[i * 3 + 1], c.e.t[i * 3 + 2]);
  });
  return out;
}
