// Управляющие поверхности кузова: силуэт сбоку, план, сечения.
// Все детали кузова строятся как участки этих поверхностей — поэтому стыки
// совпадают по форме, а зазоры задаются явно размерами участков.
// Координаты: X — назад от передней оси, Y — вправо, Z — вверх, мм.
import type { VehicleParams } from '../core/types';

type P = [number, number, number];

/** Базовые точки кузова (редактируются в проекте). */
export interface Hardpoints {
  /** Передняя кромка крыши = верх лобового стекла. */
  xRoofFront: number;
  /** Низ лобового стекла (стык с капотом). */
  xCowl: number;
  /** Проём передней двери: передняя и задняя кромки. */
  xDoorFront: number;
  xDoorRear: number;
  /** Проём сдвижной двери. */
  xSlideFront: number;
  xSlideRear: number;
  /** Порог проёмов и линия остекления. */
  zSill: number;
  zBelt: number;
  /** Задний проём. */
  zRearSill: number;
  zRearTop: number;
  /** Верх переднего бампера по центру и внутренний край фар. */
  zBumperTop: number;
  yLampInner: number;
  /** Шов между носовой поверхностью и крыльями. */
  xNoseSeam: number;
  roofRadius: number;
}

export const DEFAULT_HARDPOINTS: Hardpoints = {
  xRoofFront: 910,
  xCowl: 90,
  xDoorFront: 290,
  xDoorRear: 1450,
  xSlideFront: 1520,
  xSlideRear: 2490,
  zSill: 410,
  zBelt: 1060,
  zRearSill: 470,
  zRearTop: 1700,
  zBumperTop: 750,
  yLampInner: 400,
  xNoseSeam: -830,
  roofRadius: 160,
};

/** Кусочно-линейная кривая, сглаженная двойным скользящим средним. */
function smoothCurve(points: [number, number][], blur: number, x0: number, x1: number, n = 1600) {
  const lin = (x: number) => {
    if (x <= points[0][0]) return points[0][1];
    for (let i = 1; i < points.length; i++) {
      if (x <= points[i][0]) {
        const [ax, ay] = points[i - 1];
        const [bx, by] = points[i];
        return ay + ((by - ay) * (x - ax)) / (bx - ax);
      }
    }
    return points[points.length - 1][1];
  };
  const dx = (x1 - x0) / n;
  let s = Array.from({ length: n + 1 }, (_, i) => lin(x0 + i * dx));
  const k = Math.max(1, Math.round(blur / dx));
  for (let pass = 0; pass < 2; pass++) {
    const out = new Array<number>(s.length);
    for (let i = 0; i < s.length; i++) {
      let acc = 0;
      for (let j = i - k; j <= i + k; j++) acc += s[Math.min(s.length - 1, Math.max(0, j))];
      out[i] = acc / (2 * k + 1);
    }
    s = out;
  }
  return (x: number) => {
    const f = Math.min(n, Math.max(0, (x - x0) / dx));
    const i = Math.floor(f);
    const t = f - i;
    return s[i] * (1 - t) + s[Math.min(n, i + 1)] * t;
  };
}

export class BodyForm {
  readonly v: VehicleParams;
  readonly h: Hardpoints;
  readonly xNose: number;
  readonly xRear: number;
  readonly hw: number;
  readonly topLine: (x: number) => number;
  private readonly noseX = -550;
  private readonly noseW: number;

  constructor(v: VehicleParams, h: Hardpoints) {
    this.v = v;
    this.h = h;
    this.xNose = -v.frontOverhang;
    this.xRear = v.length - v.frontOverhang;
    this.hw = v.width / 2;
    const H = v.height;
    // силуэт по оси машины: нос → капот → лобовое стекло → крыша → корма
    this.topLine = smoothCurve(
      [
        [this.xNose - 20, 1010],
        [-690, 1075],
        [-290, 1125],
        [h.xCowl, 1170],
        [h.xRoofFront + 20, H - 10],
        [h.xRoofFront + 180, H + 7],
        [this.xRear - 140, H - 3],
        [this.xRear, H - 30],
      ],
      50,
      this.xNose - 200,
      this.xRear + 200,
    );
    this.noseW = this.hw - 130 * Math.pow((-290 - this.noseX) / 650, 2.4);
  }

  shoulder(x: number) {
    return this.topLine(x) - this.h.roofRadius;
  }

  /** Завал боковин вверху и подворот внизу. */
  tuck(z: number) {
    let d = 0;
    if (z > 1000) d += 150 * Math.pow(Math.min(1.2, (z - 1000) / 750), 1.5);
    if (z < 500) d += 25 * Math.pow((500 - z) / 160, 2);
    return d;
  }

  /** Самая передняя точка носа в плане. */
  get noseTip() {
    return this.xNose - 12;
  }

  /** Отступ носа назад на высоте z: выше бампера нос плавно уходит назад
   *  и у кромки капота выходит точно на шов — нос и капот стыкуются без ступеньки. */
  noseRetreat(z: number) {
    const zTop = this.topLine(this.h.xNoseSeam);
    const k = Math.min(1, Math.max(0, (z - 720) / (zTop - 720)));
    return (this.h.xNoseSeam - this.noseTip) * k * k;
  }

  /** Полуширина кузова в плане на станции x и высоте z. */
  halfWidth(x: number, z: number) {
    let w = this.hw;
    if (x < this.noseX) {
      const u = Math.min(1, (this.noseX - x) / (this.noseX - this.noseTip));
      w = this.noseW * Math.pow(Math.max(0, 1 - Math.pow(u, 4)), 0.25);
    } else if (x < -290) w -= 130 * Math.pow((-290 - x) / 650, 2.4);
    if (x > this.xRear - 300) w -= 70 * Math.pow((x - (this.xRear - 300)) / 300, 2.2);
    return Math.max(2, w - this.tuck(z));
  }

  /** x поверхности носа в точке (y, z): скругление в плане плюс отступ назад по высоте. */
  xFront(y: number, z: number) {
    const w = Math.abs(y) + this.tuck(z);
    const plan = w >= this.noseW ? this.noseX : this.noseX + (this.noseTip - this.noseX) * Math.pow(1 - Math.pow(w / this.noseW, 4), 0.25);
    return plan + this.noseRetreat(z);
  }

  /** Верх колёсной арки в станции x (−∞ вне арок). */
  archTop(x: number, extra = 0) {
    let z = -Infinity;
    const r = this.v.archRadius + extra;
    for (const ax of [0, this.v.wheelbase]) {
      const d = x - ax;
      if (Math.abs(d) < r) z = Math.max(z, this.v.tireRadius + Math.sqrt(r * r - d * d));
    }
    return z;
  }

  /** Нормаль боковины внутрь кузова в точке (x, z). */
  sideInward(side: number, x: number, z: number): P {
    const e = 2;
    const wx = (this.halfWidth(x + e, z) - this.halfWidth(x - e, z)) / (2 * e);
    return [side * wx, -side, 0];
  }

  /** Точка боковины. */
  side(side: number, x: number, z: number, off = 0): P {
    return [x, side * (this.halfWidth(x, z) + off), z];
  }

  /** Полудлина дуги сечения верха (от оси до плеча) — для перевода зазора в параметр s. */
  topHalfArc(x: number) {
    const R = this.h.roofRadius;
    const cz = this.halfWidth(x, this.shoulder(x)) - R;
    return cz + (R * Math.PI) / 2;
  }

  /** Точка верха сечения: s ∈ [−1, 1] слева направо (крыша, капот, стекло). */
  top(x: number, s: number, off = 0): P {
    const R = this.h.roofRadius;
    const ys = this.shoulder(x);
    const cz = this.halfWidth(x, ys) - R;
    const a = cz / (cz + (R * Math.PI) / 2);
    const as = Math.abs(s);
    const sg = Math.sign(s) || 1;
    if (as <= a) {
      const y = (s / a) * cz;
      return [x, y, ys + R + 12 * (1 - (y / cz) ** 2) + off];
    }
    const th = (Math.PI / 2) * (1 - (as - a) / (1 - a));
    const r = R + off;
    return [x, sg * (cz + r * Math.cos(th)), ys + r * Math.sin(th)];
  }

  /** Высота верха сечения в точке (x, y). */
  sectionTop(x: number, y: number) {
    const R = this.h.roofRadius;
    const ys = this.shoulder(x);
    const hwS = this.halfWidth(x, ys);
    const cz = hwS - R;
    const ay = Math.abs(y);
    if (ay <= cz) return this.topLine(x) + 12 * (1 - (ay / cz) ** 2);
    if (ay <= hwS) return ys + Math.sqrt(Math.max(0, R * R - (ay - cz) ** 2));
    return ys;
  }

  /** Точка носовой поверхности (перед шва xNoseSeam). */
  front(y: number, z: number, off = 0): P {
    const e = 4;
    const x = Math.min(this.xFront(y, z), this.h.xNoseSeam);
    const dxdy = (this.xFront(y + e, z) - this.xFront(y - e, z)) / (2 * e);
    const l = Math.hypot(1, dxdy);
    return [x - off / l, y + (off * dxdy) / l, z];
  }

  /** Полуширина носовой поверхности до шва с крыльями. */
  frontHalf(z: number) {
    return this.halfWidth(this.h.xNoseSeam, z);
  }

  /** Полуширина заднего проёма на высоте z (стойка ~75 мм). */
  rearEdge(z: number) {
    return this.halfWidth(this.xRear, z) - 75;
  }

  /** Задний конец фары на крыле. */
  readonly xLampEnd = -600;

  /** Доля 0…1 от шва носа до заднего конца фары. */
  lampU(x: number) {
    return Math.min(1, Math.max(0, (x - this.h.xNoseSeam) / (this.xLampEnd - this.h.xNoseSeam)));
  }

  /** Низ фары на боковине: у носа на 30 мм ниже плеча, к концу фары сходится к плечу. */
  lampBottom(x: number) {
    return this.shoulder(x) - 30 * (1 - this.lampU(x));
  }

  /** Граница фары на скруглении крыла (параметр s сечения): у носа 0,8, к концу фары 1. */
  lampS(x: number) {
    return 0.8 + 0.2 * this.lampU(x);
  }

  /** Низ фары на носовой поверхности. */
  get zLampFront() {
    return this.shoulder(this.h.xNoseSeam) - 30;
  }
}
