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
  /** Распределение столбцов сетки по a: u ∈ [0, 1] → доля длины (по умолчанию равномерно). */
  warp: (u: number) => number = (u) => u,
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
    const a = a0 + (a1 - a0) * warp(u);
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
function top(
  c: Ctx, x0: number, x1: number, s0: number | F, s1: number | F, depth: number | ((x: number, s: number) => number),
  off = 0, nu = 20, nv = 24, warp?: (u: number) => number,
) {
  patch(c, x0, x1, s0, s1, (x, s) => c.f.top(x, s, off), depth, Math.max(nu, Math.ceil(Math.abs(x1 - x0) / 20)), nv, undefined, undefined, 0.0005, warp);
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

/** Участок поверхности, огибающей угол носа: a — координата обхода (BodyForm.wrapPoint), z ∈ [zlo(a), zhi(a)]. */
function wrap(c: Ctx, a0: number, a1: number, zlo: number | F, zhi: number | F, depth: number | ((a: number, z: number) => number), nu: number, nv: number) {
  const { f } = c;
  patch(c, a0, a1, zlo, zhi, (a, z) => f.wrapPoint(a, z), depth, nu, nv, undefined, (q) => f.wrapInward(q));
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
  sideOuter(c, p, _part, project) {
    const { f } = c;
    const h = f.h;
    const s = p.side;
    const t = 0.8;
    // проём сдвижной двери — только с той стороны, где она есть в проекте
    const slide = project.parts.some((q) => q.generator === 'slideDoor' && q.params.side === s);
    const dt = doorTop(f);
    const low = (x: number) => (x > f.xRear - 360 ? h.zRearSill + 1 : f.v.bodyBottom);
    const lampX = f.xRear - 110;
    // стойка A между крылом и проёмом двери
    side(c, s, h.xCowl, h.xDoorFront, f.shoulder(h.xCowl), (x) => f.shoulder(x), t, { nu: 10, nv: 6 });
    // рельс над дверями
    side(c, s, h.xDoorFront, f.xRear, dt, (x) => f.shoulder(x), t, { nu: 60, nv: 2 });
    // двери закрывают боковину до нижней кромки кузова, порог — за ними
    if (slide) {
      // мелкий шаг по высоте: внизу боковина подворачивается, крупные грани дали бы ложный перепад у дверей
      side(c, s, h.xDoorRear, h.xSlideFront, low, dt, t, { nu: 3, nv: 48 });
      side(c, s, h.xSlideRear, lampX - 3, low, dt, t, { nu: 30, nv: 48 });
    } else {
      side(c, s, h.xDoorRear, lampX - 3, low, dt, t, { nu: 50, nv: 48 });
    }
    // угол у заднего фонаря: ниже и выше фонаря
    const [cut0, cut1] = f.tailCut;
    side(c, s, lampX - 3, f.xRear, low, cut0, t, { nu: 6, nv: 8 });
    side(c, s, lampX - 3, f.xRear, cut1, dt, t, { nu: 6, nv: 4 });
    // стойка лобового стекла (дуга верха сечения)
    top(c, h.xCowl, h.xRoofFront, s > 0 ? 0.9 : -1, s > 0 ? 1 : -0.9, t, 0, 16, 4);
  },

  roof(c) {
    // мелкий шаг поперёк: на скруглении крыши хорды не должны срезать дуги каркаса под обшивкой
    top(c, c.f.h.xRoofFront, c.f.xRear, -1, 1, 0.8, 0, 40, 120);
  },

  // Переднее крыло: от шва носа до проёма двери, снизу — бампер и арка, сверху — капот и фара
  fender(c, p) {
    const { f } = c;
    const h = f.h;
    const s = p.side;
    // спереди крыло начинается за фарой, снизу — над бампером и аркой, сверху — до капота
    const zTop = (x: number) => (x < h.xCowl ? f.shoulder(x) : f.shoulder(h.xCowl));
    const zLow = (x: number) => (x <= -390 ? bumperSideTop(f, x) + p.gapBumper : f.v.bodyBottom);
    // под фарой: клин между фарой и косой верхней кромкой бампера
    side(c, s, h.xNoseSeam, f.xLampEnd + p.gapLamp, zLow, (x) => f.lampBottom(x) - p.gapLamp, 0.8, { nu: 30, nv: 8 });
    // отдельный участок у бампера, чтобы вертикальная кромка у арки легла точно в узлы сетки
    side(c, s, f.xLampEnd + p.gapLamp, -390, zLow, zTop, 0.8, { nu: 30, nv: 14 });
    side(c, s, -390, h.xDoorFront, f.v.bodyBottom, zTop, 0.8, { nu: 60, nv: 14 });
  },

  hood(c, p) {
    const { f } = c;
    const h = f.h;
    const g = p.gap;
    const edge = hoodEdge(f, g);
    // передняя кромка капота изогнута в плане (BodyForm.hoodFrontX), сбоку капот ограничен фарами
    const lim = (x: number) => Math.min(edge(x), f.hoodFrontS(x));
    // у кромок — отбортовка толщиной p.flange, к середине капот набирает полную глубину
    const flange = p.flange;
    const d = (x: number, s: number) => {
      const y = f.top(x, s)[1];
      return Math.min(p.depth, flange + 0.3 * Math.min(x - f.hoodFrontX(y), h.xCowl - g - x, (lim(x) - Math.abs(s)) * f.topHalfArc(x)));
    };
    // по центру передняя кромка прямая (станция xLampFront), сбоку капот ограничен фарами — одним куском
    // у передней кромки сетка мельче: там боковая кромка капота изгибается вдоль фары
    top(c, f.xLampFront, h.xCowl - g, (x) => -lim(x), lim, d, 0, 80, 96, (u) => Math.pow(u, 1.7));
    // передняя кромка капота над решёткой, между фарами
    front(c, -h.yLampInner + g, h.yLampInner - g, h.zGrilleTop + g, (y) => f.hoodFrontZ(y) - 1, flange, 0, 16, 4);
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
    const belt = (x: number) => f.belt(x);
    side(c, s, x0, x1, h.zDoorBottom, belt, (x, z) => Math.min(wedge(x), sillRoom(f, x, z)), { nu: 90, nv: 14, arch: p.archGap });
    const fw = Math.min(30, p.depth);
    side(c, s, x0, x0 + 60, belt, zt, (x) => Math.min(fw, wedge(x)), { nu: 4, nv: 10 });
    side(c, s, x1 - 70, x1, belt, zt, fw, { nu: 4, nv: 10 });
    side(c, s, x0 + 60, x1 - 70, (x) => zt(x) - 40, zt, fw, { nu: 24, nv: 2 });
  },

  frontDoorGlass(c, p) {
    const { f } = c;
    const h = f.h;
    const g = p.gap;
    const top = doorTopGap(f, g);
    const zt = (x: number) => top(x) - 40;
    side(c, p.side, h.xDoorFront + g + 60, h.xDoorRear - g - 70, (x) => f.belt(x), zt, 4, { off: -12, nu: 20, nv: 8 });
  },

  slideDoor(c, p) {
    const { f } = c;
    const h = f.h;
    const g = p.gap;
    side(c, p.side, h.xSlideFront + g, h.xSlideRear - g, h.zDoorBottom, doorTopGap(f, g), (x, z) => Math.min(p.depth, sillRoom(f, x, z)), { nu: 28, nv: 22 });
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
      const [cut0, cut1] = f.tailCut;
      rear(c, h.zRearSill + 1, cut0, ...pair(inner, hw), t, 0, 12, 4);
      rear(c, cut0, cut1, ...pair(inner, lampIn), t, 0, 20, 2);
      rear(c, cut1, h.zRearTop, ...pair(inner, hw), t, 0, 6, 4);
    }
    // верхняя поперечина — на всю ширину сечения задка, вместе со скруглёнными углами крыши
    const R = f.radius(f.xRear);
    const ys = f.shoulder(f.xRear);
    const cz = f.halfWidth(f.xRear, ys) - R;
    const zt = h.zRearTop;
    const yMax = (zt > ys ? cz + Math.sqrt(Math.max(0, R * R - (zt - ys) ** 2)) : f.halfWidth(f.xRear, zt)) - 1;
    patch(c, -yMax, yMax, zt, (yy) => f.sectionTop(f.xRear, yy) - 2, (yy, z) => [f.xRear, yy, z], t, 40, 6);
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
    const A = f.wrapA;
    const aEnd = A + (f.xLampEnd - h.xNoseSeam);
    // лицевая часть сверху уходит под кромку капота (зазор g), дальше по кромке капота доходит
    // до верха сечения, где начинается часть фары на скруглении крыла
    const yS = f.hoodFrontY(f.xLampFront);
    const xOf = (a: number) => h.xNoseSeam + (a - A);
    const lo = (a: number) => (a <= A ? f.zLampFront : f.lampBottom(xOf(a)));
    // под капотом фара ниже кромки на зазор, за краем капота выходит на кромку
    const hiUnder = (a: number) => f.hoodFrontZ(a) - g - 0.5;
    const hi = (a: number) => (a > A ? f.shoulder(xOf(a)) : f.hoodFrontZ(a));
    // корпус уходит вглубь, у верхней кромки и на крыле — тонкий край
    const d = (a: number, z: number) => Math.min(p.depth, 2 + ((a < yS ? hiUnder(a) : hi(a)) - z) * 1.2, 6 + Math.max(0, A - a));
    // под капотом и за его краем — два участка со ступенькой ровно по краю; лицевая часть
    // и часть на крыле — одним куском: угол носа без шва и излома
    const n1 = Math.max(8, Math.round((140 * (yS - yIn)) / (aEnd - yIn)));
    if (s > 0) {
      wrap(c, yIn, yS, lo, hiUnder, d, n1, 16);
      wrap(c, yS, aEnd, lo, hi, d, 140 - n1, 16);
    } else {
      wrap(c, -yS, -yIn, (a) => lo(-a), (a) => hiUnder(-a), (a, z) => d(-a, z), n1, 16);
      wrap(c, -aEnd, -yS, (a) => lo(-a), (a) => hi(-a), (a, z) => d(-a, z), 140 - n1, 16);
    }
    // часть на скруглении крыла (верх сечения). Перед швом — между кромкой капота и внутренней
    // кромкой фары; кромка капота там идёт почти поперёк, поэтому сетка строится по Y
    const sIn = f.lampS(h.xNoseSeam);
    const yIn0 = Math.abs(f.top(f.xLampFront, sIn)[1]);
    const xInner = (y: number) => {
      // станция, где внутренняя кромка фары (s = sIn) проходит через |y|
      let lo2 = f.xLampFront;
      let hi2 = h.xNoseSeam;
      if (Math.abs(f.top(hi2, sIn)[1]) <= y) return hi2;
      for (let i = 0; i < 30; i++) {
        const m = (lo2 + hi2) / 2;
        if (Math.abs(f.top(m, sIn)[1]) < y) lo2 = m;
        else hi2 = m;
      }
      return lo2;
    };
    const yOf = (a: number) => s * a;
    patch(
      c, yIn0, f.wrapA, (a) => f.hoodFrontX(a), (a) => xInner(a),
      (a, x) => f.top(x, f.topS(x, yOf(a))), 3, 40, 8, undefined, undefined, 0.3,
    );
    top(c, h.xNoseSeam, f.xLampEnd, s > 0 ? (x) => f.lampS(x) : -1, s > 0 ? 1 : (x) => -f.lampS(x), 3, 0, 16, 6);
  },

  grille(c, p) {
    const { f } = c;
    const h = f.h;
    const bt = bumperFrontTop(f, 1.5);
    front(c, -h.yLampInner + p.gap, h.yLampInner - p.gap, (y) => bt(y) + p.gapBumper, h.zGrilleTop, p.depth, 0, 80, 4);
  },

  bumperFront(c, p) {
    const { f } = c;
    const h = f.h;
    // по центру верх бампера — под решёткой, у фар — под фарами, на боковине — косо вниз к арке
    const topFront = bumperFrontTop(f, p.gapLamp);
    const A = f.wrapA;
    const xArch = -391.5;
    const aEnd = A + (xArch - h.xNoseSeam);
    const xOf = (a: number) => h.xNoseSeam + (Math.abs(a) - A);
    const top = (a: number) => (Math.abs(a) <= A ? topFront(a) : bumperSideTop(f, xOf(a), p.gapLamp));
    const low = (a: number) => (Math.abs(a) <= A ? 240 : Math.max(240, f.archTop(xOf(a), 2)));
    // у угла носа и у арки бампер тонкий: объём не уходит под фару и в арку
    const d = (a: number, z: number) => {
      const aa = Math.abs(a);
      return Math.min(p.depth, 4 + (top(a) - z) * 0.8, 4 + Math.abs(aa - A) * 0.5, aa > A ? 4 + (xArch - xOf(a)) * 0.8 : Infinity);
    };
    // лицевая часть и обе боковые — одним куском, без швов на углах носа
    wrap(c, -aEnd, aEnd, low, top, d, 360, 36);
  },

  // задний бампер: поперечина со ступенькой под створками и боковины от колёсных арок —
  // закрывают низ кузова за аркой, как у серийного фургона
  bumperRear(c, p) {
    const { f } = c;
    const x1 = f.xRear + p.protrusion;
    const [z0, z1] = [265, 468];
    // спереди — с зазором от арки заднего колеса (её радиус ~410 мм)
    const x0 = f.v.wheelbase + f.v.archRadius + 25;
    const w = (z: number) => f.halfWidth(x1, z);
    rear(c, z0, z1, (z) => -w(z), w, p.protrusion + 20, p.protrusion, 40, 6);
    for (const s of [-1, 1]) side(c, s, x0, x1, z0, z1, 40, { nu: 20, nv: 6 });
  },

  tailLamp(c, p) {
    const { f } = c;
    const s = p.side;
    const g = p.gap;
    const hw = (z: number) => f.halfWidth(f.xRear, z);
    const yin = (z: number) => f.rearEdge(z) + 22 + g;
    // фонарь заполняет вырез в боковине и панели задка с зазором g
    const z0 = f.tailCut[0] + g;
    const z1 = f.tailCut[1] - g;
    if (s > 0) rear(c, z0, z1, yin, hw, p.depth, 0, 16, 4);
    else rear(c, z0, z1, (z) => -hw(z), (z) => -yin(z), p.depth, 0, 16, 4);
    side(c, s, f.xRear - 110, f.xRear, z0, z1, p.depth, { nu: 6, nv: 12 });
  },

  chmsl(c) {
    const x = c.f.xRear;
    aabb(c.mb, [x + 1, -150, 1740], [x + 16, 150, 1772]);
  },

  fogLamp(c, p) {
    // ось фары — по нормали к поверхности бампера: стекло выступает на 3 мм, корпус уходит внутрь
    const f = c.f;
    const y = p.side * p.y;
    const pt = f.front(y, p.z);
    const q = f.front(y + 2, p.z);
    const t = [q[0] - pt[0], q[1] - pt[1]];
    const l = Math.hypot(t[0], t[1]);
    const n = [-t[1] / l, t[0] / l];
    if (n[0] > 0) (n[0] = -n[0]), (n[1] = -n[1]);
    cylinder(c.mb, [pt[0] + 3 * n[0], pt[1] + 3 * n[1], pt[2]], [pt[0] - 40 * n[0], pt[1] - 40 * n[1], pt[2]], 38);
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
    // по чертежу зеркало стоит в переднем углу окна двери, низ — чуть выше линии остекления
    const x = f.h.xDoorFront;
    const zb = f.belt(x + 95);
    const y0 = f.halfWidth(x, 1200) + 30;
    const lo: P = [x + 40, s > 0 ? y0 : -(y0 + 190), zb + 15];
    const hi: P = [x + 150, s > 0 ? y0 + 190 : -y0, zb + 215];
    aabb(c.mb, lo, hi);
    beam(c.mb, [x + 95, s * (y0 - 25), zb + 30], [x + 95, s * (y0 + 5), zb + 30], 40, 40, [1, 0, 0]);
  },

  moulding(c, p) {
    const { f } = c;
    const h = f.h;
    const g = p.gap;
    // молдинг по чертежу: полоса 515…585 мм на передней и сдвижной дверях
    const [x0, x1] = p.slide ? [h.xSlideFront + g + 10, p.end] : [h.xDoorFront + g + 150, h.xDoorRear - g - 10];
    side(c, p.side, x0, x1, 515, 585, 10, { off: 10, nu: 20, nv: 2, arch: 30 });
  },

  // ---------- каркас кузова в белом
  sill(c, p) {
    const { f } = c;
    const s = p.side;
    // порог утоплен внутрь: снаружи его закрывают двери до нижней кромки кузова
    const y = s * (f.hw - SILL_INSET);
    beam(c.mb, [470, y, 370], [2690, y, 370], 90, 80);
  },

  bPillar(c, p) {
    const { f } = c;
    const s = p.side;
    const x = f.h.xDoorRear + 35;
    beam(c.mb, [x, s * (f.halfWidth(x, 430) - 75), 425], [x, s * (f.halfWidth(x, 1640) - 75), 1640], 50, 60);
  },

  roofBow(c, p) {
    top(c, p.x - 25, p.x + 25, -0.93, 0.93, 35, -2.5, 2, 80);
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
    // щит под основанием лобового стекла, верх — с запасом под капотом
    const x = c.f.h.xCowl - 180;
    const zTop = Math.min(1080, c.f.topLine(x) - 70);
    aabb(c.mb, [x - 2, -420, 402], [x, 420, 790]);
    aabb(c.mb, [x - 2, -760, 790], [x, 760, zTop]);
  },

  radiatorSupport(c) {
    const x = c.f.h.xNoseSeam + 20;
    // верх рамки закрывает щель под кромкой капота
    aabb(c.mb, [x, -640, 480], [x + 30, 640, c.f.h.zGrilleTop]);
  },

  frontRail(c, p) {
    const y = p.side * 380;
    beam(c.mb, [c.f.h.xNoseSeam + 55, y, 470], [55, y, 420], 60, 90);
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

  // габарит агрегата под капотом: верх идёт за профилем капота с запасом под норму 60 мм
  engine(c) {
    const f = c.f;
    const x0 = f.h.xNoseSeam + 80;
    const zt = (x: number) => f.topLine(x) - 125;
    prism(c, [[x0, 380], [40, 380], [40, zt(40)], [-300, zt(-300)], [x0, zt(x0)]], -300, 300);
  },

  // ---------- интерьер
  instrumentPanel(c) {
    // передняя часть уходит под капот и основание стекла
    prism(c, [[140, 800], [330, 800], [470, 860], [560, 1000], [520, 1165], [380, 1190], [240, 1110], [140, 1060]], -800, 800);
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
    const inset = 70;
    const yMax = f.halfWidth(x, 1000) - inset;
    // вверху боковины заваливаются внутрь — контур перегородки идёт за ними
    const zSide = (y: number) => {
      let lo = 1000;
      let hi = f.topLine(x);
      for (let i = 0; i < 30; i++) {
        const m = (lo + hi) / 2;
        if (f.halfWidth(x, m) - inset >= Math.abs(y)) lo = m;
        else hi = m;
      }
      return lo;
    };
    patch(c, -yMax, yMax, 483, (y) => Math.min(f.sectionTop(x, y) - 50, zSide(y)), (y, z) => [x, y, z], 1.5, 48, 8);
  },

  doorSeal(c, p) {
    const { f } = c;
    const s = p.side;
    const x = f.h.xDoorRear + 8;
    beam(c.mb, [x, s * (f.halfWidth(x, 450) - 40), 450], [x, s * (f.halfWidth(x, 1500) - 40), 1500], 12, 12);
  },
};

/** Верх бампера на боковине: у носа — под фарой, дальше по чертежу косо вниз к передней кромке арки. */
function bumperSideTop(f: BodyForm, x: number, gap = 1.5) {
  const xl = f.h.xNoseSeam;
  if (x < xl) return f.lampBottom(x) - gap;
  const k = Math.min(1, (x - xl) / (-390 - xl));
  return f.lampBottom(xl) - gap + (560 - (f.lampBottom(xl) - gap)) * k;
}

/**
 * Кромка капота у фары (параметр s сечения): кромка фары идёт косо по скруглению крыла,
 * поэтому точку кромки капота ищем так, чтобы расстояние в пространстве до кромки фары было ровно g.
 */
function hoodEdge(f: BodyForm, g: number) {
  const h = f.h;
  const cache = new Map<number, number>();
  // граница, от которой откладывается зазор: кромка фары, за фарой — верхняя кромка крыла (s = 1)
  const border = (x: number) => f.top(x, f.lampS(x));
  // спереди фара ограничена кромкой капота: её участок от угла фары до угла носа
  const yS = f.hoodFrontY(f.xLampFront);
  const front: P[] = [];
  for (let k = 0; k <= 24; k++) {
    const y = -(yS + ((f.wrapA - yS) * k) / 24);
    front.push([f.hoodFrontX(y), y, f.hoodFrontZ(y)]);
  }
  // расстояние от точки до ломаной (до отрезков, а не до вершин — иначе зазор выходит меньше заданного)
  const toPolyline = (p: P, pts: P[]) => {
    let best = Infinity;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
      const l2 = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2;
      const t = l2 > 0 ? Math.min(1, Math.max(0, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / l2)) : 0;
      best = Math.min(best, Math.hypot(ap[0] - ab[0] * t, ap[1] - ab[1] * t, ap[2] - ab[2] * t));
    }
    return best;
  };
  const dist = (x: number, s: number) => {
    const p = f.top(x, s);
    const line: P[] = [];
    for (let k = -12; k <= 12; k++) line.push(border(Math.min(h.xCowl, Math.max(f.xLampFront, x + k * 5))));
    const q: P = [p[0], -Math.abs(p[1]), p[2]];
    const d = toPolyline(q, line.map((r): P => [r[0], -Math.abs(r[1]), r[2]]));
    return x - h.xNoseSeam < 4 * g ? Math.min(d, toPolyline(q, front)) : d;
  };
  return (x: number) => {
    const key = Math.round(x * 100);
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const s1 = f.lampS(x);
    let lo = s1 - (4 * g) / f.topHalfArc(x);
    let hi = s1;
    for (let i = 0; i < 30; i++) {
      const m = (lo + hi) / 2;
      if (dist(x, m) > g) lo = m;
      else hi = m;
    }
    cache.set(key, lo);
    return lo;
  };
}

/** Порог утоплен на столько внутрь от наружной поверхности. */
const SILL_INSET = 150;

/** Сколько места по глубине у двери над порогом в точке (x, z): у низа дверь тоньше. */
function sillRoom(f: BodyForm, x: number, z: number) {
  if (z > 420) return Infinity;
  return Math.max(12, f.halfWidth(x, z) - (f.hw - SILL_INSET + 45) - 8);
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
