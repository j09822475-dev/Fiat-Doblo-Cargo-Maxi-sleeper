// Процедурная модель цельнометаллического фургона Fiat Doblò Cargo Maxi (кузов 263, L2H1).
// Система координат модели: X — вдоль машины (0 = задний срез, +X вперёд), Y — вверх, Z — вправо.
// Единицы — метры. Габариты взяты из техданных: 4740 × 1832 × 1845 мм, база 3105 мм.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export const DIM = {
  L: 4.74,
  W: 1.832,
  H: 1.845,
  wheelbase: 3.105,
  rearAxle: 0.705,
  frontAxle: 3.81,
  wheelR: 0.315,
  archR: 0.4,
};

const HW = DIM.W / 2;      // половина ширины
const NOSE_X = DIM.L - 0.38;
const NOSE_W = HW - 0.13 * Math.pow((NOSE_X - 4.1) / 0.65, 2.4);
const R_ROOF = 0.16;       // радиус скругления крыши
const Y_BOTTOM = 0.34;     // нижняя кромка кузова

// ---------------------------------------------------------------- профили

// Кусочно-линейная кривая, сглаженная двойным box-blur: даёт мягкие переходы
// «капот → лобовое → крыша» без ручного подбора сплайнов.
function smoothProfile(points, blur, x0, x1, n = 1400) {
  const lin = (x) => {
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
    const out = new Array(s.length);
    for (let i = 0; i < s.length; i++) {
      let acc = 0;
      let c = 0;
      for (let j = i - k; j <= i + k; j++) {
        acc += s[Math.min(s.length - 1, Math.max(0, j))];
        c++;
      }
      out[i] = acc / c;
    }
    s = out;
  }
  return (x) => {
    const f = Math.min(n, Math.max(0, (x - x0) / dx));
    const i = Math.floor(f);
    const t = f - i;
    return s[i] * (1 - t) + s[Math.min(n, i + 1)] * t;
  };
}

// Верхняя линия силуэта по оси машины: крыша → лобовое стекло → капот → нос.
const topLine = smoothProfile(
  [
    [0.0, 1.815],
    [0.14, 1.842],
    [2.72, 1.852],
    [2.88, 1.835],
    [3.72, 1.17],   // низ лобового стекла (по чертежу ~1,1 м от носа)
    [4.1, 1.125],
    [4.5, 1.075],
    [4.76, 1.01],
  ],
  0.05,
  -0.1,
  4.9
);

const shoulder = (x) => topLine(x) - R_ROOF;

// Передняя точка носа на высоте y: внизу нос самый длинный, выше плавно уходит назад —
// так торец скругляется и в профиле (кромка капота заворачивает к решётке).
function noseEnd(y) {
  const k = Math.min(1, Math.max(0, (y - 0.72) / 0.38));
  return DIM.L + 0.012 - 0.11 * k * k;
}

// Завал боковин вверху и подворот внизу (вычитается из ширины в плане).
function tuck(y) {
  let d = 0;
  if (y > 1.0) d += 0.15 * Math.pow(Math.min(1.2, (y - 1.0) / 0.75), 1.5); // крыша ≈1,45 м
  if (y < 0.5) d += 0.025 * Math.pow((0.5 - y) / 0.16, 2);
  return d;
}

// Полуширина кузова: сужение носа в плане, завал боковин вверху и подворот внизу.
function halfWidth(x, y) {
  let w = HW;
  // нос: до NOSE_X плавное сужение, дальше крылья в плане идут по суперэллипсу —
  // той же кривой, что и бампер, поэтому крыло, фара и бампер сходятся без ступенек
  if (x > NOSE_X) {
    const u = Math.min(1, (x - NOSE_X) / (noseEnd(y) - NOSE_X));
    w = NOSE_W * Math.pow(1 - Math.pow(u, 4), 0.25);
  } else if (x > 4.1) w -= 0.13 * Math.pow((x - 4.1) / 0.65, 2.4);
  if (x < 0.3) w -= 0.07 * Math.pow((0.3 - x) / 0.3, 2.2); // скруглённые задние углы в плане
  return Math.max(0.002, w - tuck(y));
}

// Обратная функция: x поверхности носа в точке (z, y). Нужна для деталей на скруглённом торце.
function xFront(z, y) {
  const w = Math.abs(z) + tuck(y);
  if (w >= NOSE_W) return NOSE_X;
  return NOSE_X + (noseEnd(y) - NOSE_X) * Math.pow(1 - Math.pow(w / NOSE_W, 4), 0.25);
}

// Высота верха сечения кузова в точке (x, z): крыша/капот со скруглёнными кромками.
function sectionTop(x, z) {
  const ys = topLine(x) - R_ROOF;
  const hwS = halfWidth(x, ys);
  const cz = hwS - R_ROOF;
  const az = Math.abs(z);
  if (az <= cz) return topLine(x) + 0.012 * (1 - (az / cz) ** 2);
  if (az <= hwS) return ys + Math.sqrt(Math.max(0, R_ROOF ** 2 - (az - cz) ** 2));
  return ys;
}

// Верх колёсной арки (выше неё может быть панель кузова).
function archTop(x) {
  let y = -Infinity;
  for (const ax of [DIM.rearAxle, DIM.frontAxle]) {
    const d = x - ax;
    if (Math.abs(d) < DIM.archR) y = Math.max(y, DIM.wheelR + Math.sqrt(DIM.archR ** 2 - d * d));
  }
  return y;
}

// ---------------------------------------------------------------- генераторы панелей

const fn = (v) => (typeof v === 'function' ? v : () => v);

function gridGeometry(nu, nv, point) {
  const pos = [];
  const uv = [];
  const idx = [];
  const p = new THREE.Vector3();
  for (let j = 0; j <= nv; j++) {
    for (let i = 0; i <= nu; i++) {
      point(i / nu, j / nv, p);
      pos.push(p.x, p.y, p.z);
      uv.push(i / nu, j / nv);
    }
  }
  const row = nu + 1;
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = j * row + i;
      idx.push(a, a + 1, a + row, a + 1, a + row + 1, a + row);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// Панель боковины: область x∈[x0,x1], y∈[y0(x), y1(x)], обрезанная аркой и плечом крыши.
// off > 0 — наружу, off < 0 — внутрь (для обшивки).
function sideGeo({ side, x0, x1, y0 = Y_BOTTOM, y1 = 9, off = 0, nu = 24, nv = 10 }) {
  const f0 = fn(y0);
  const f1 = fn(y1);
  return gridGeometry(nu, nv, (u, v, p) => {
    const x = x0 + (x1 - x0) * u;
    const lo = Math.max(f0(x), archTop(x), Y_BOTTOM);
    const hi = Math.max(lo, Math.min(f1(x), shoulder(x)));
    const y = lo + (hi - lo) * v;
    p.set(x, y, side * (halfWidth(x, y) + off));
  });
}

// Точка сечения верхней части (скругление + крыша), s ∈ [-1, 1] слева направо.
function topPoint(x, s, off, out) {
  const ys = shoulder(x);
  const hwS = halfWidth(x, ys);
  const cz = hwS - R_ROOF;
  const arc = (R_ROOF * Math.PI) / 2;
  const a = cz / (cz + arc);
  const as = Math.abs(s);
  const sg = Math.sign(s) || 1;
  if (as <= a) {
    const z = (s / a) * cz;
    const crown = 0.012 * (1 - (z / cz) ** 2);
    out.set(x, ys + R_ROOF + crown + off, z);
  } else {
    const t = (as - a) / (1 - a);
    const th = (Math.PI / 2) * (1 - t);
    const r = R_ROOF + off;
    out.set(x, ys + r * Math.sin(th), sg * (cz + r * Math.cos(th)));
  }
  return out;
}

function topGeo({ x0, x1, s0 = -1, s1 = 1, off = 0, nu = 24, nv = 24 }) {
  const fx0 = fn(x0);
  const fx1 = fn(x1);
  return gridGeometry(nu, nv, (u, v, p) => {
    const s = s0 + (s1 - s0) * v;
    const a = fx0(s);
    const b = fx1(s);
    topPoint(a + (b - a) * u, s, off, p);
  });
}

// Поверхность на скруглённом торце носа: параметризация по z (t) и по высоте (v).
// z ограничивается швом с крыльями (NOSE_SEAM), так что торец точно стыкуется с боковинами.
const NOSE_SEAM = DIM.L - 0.1;
function frontGeo({ z0, z1, y0, y1, off = 0, nu = 24, nv = 16 }) {
  const f0 = fn(y0);
  const f1 = fn(y1);
  return gridGeometry(nu, nv, (u, v, p) => {
    let z = z0 + (z1 - z0) * u;
    const lo = f0(z);
    const hi = Math.max(lo, f1(z));
    const y = lo + (hi - lo) * v;
    const lim = halfWidth(NOSE_SEAM, y);
    z = Math.max(-lim, Math.min(lim, z));
    // смещение по нормали к поверхности носа (у краёв она смотрит вбок)
    const e = 0.004;
    const dxdz = (xFront(z + e, y) - xFront(z - e, y)) / (2 * e);
    const nl = Math.hypot(1, dxdz);
    p.set(xFront(z, y) + off / nl, y, z - (off * dxdz) / nl);
  });
}

// Плоский контур сечения кузова в плоскости (z, y) — для торцов.
function sectionShape(x) {
  const pts = [];
  const n = 14;
  const ys = shoulder(x);
  for (let i = 0; i <= n; i++) {
    const y = Y_BOTTOM + ((ys - Y_BOTTOM) * i) / n;
    pts.push(new THREE.Vector2(halfWidth(x, y), y));
  }
  const p = new THREE.Vector3();
  for (let i = 1; i < 30; i++) {
    const s = 1 - (2 * i) / 30;
    topPoint(x, s, 0, p);
    pts.push(new THREE.Vector2(p.z, p.y));
  }
  for (let i = n; i >= 0; i--) {
    const y = Y_BOTTOM + ((ys - Y_BOTTOM) * i) / n;
    pts.push(new THREE.Vector2(-halfWidth(x, y), y));
  }
  return new THREE.Shape(pts);
}

// Плоская фигура в плоскости (z,y) → геометрия в плоскости x = const.
function capGeo(shape, x) {
  const g = new THREE.ShapeGeometry(shape, 12);
  const a = g.attributes.position;
  for (let i = 0; i < a.count; i++) {
    const z = a.getX(i);
    const y = a.getY(i);
    a.setXYZ(i, x, y, z);
  }
  g.computeVertexNormals();
  return g;
}

function roundedRectShape(x0, y0, x1, y1, r, rTop = r) {
  const s = new THREE.Shape();
  s.moveTo(x0 + r, y0);
  s.lineTo(x1 - r, y0);
  s.quadraticCurveTo(x1, y0, x1, y0 + r);
  s.lineTo(x1, y1 - rTop);
  s.quadraticCurveTo(x1, y1, x1 - rTop, y1);
  s.lineTo(x0 + rTop, y1);
  s.quadraticCurveTo(x0, y1, x0, y1 - rTop);
  s.lineTo(x0, y0 + r);
  s.quadraticCurveTo(x0, y0, x0 + r, y0);
  return s;
}

// Объёмный бампер: контур в плане (x,z) вытягивается по высоте, в каждой точке
// профиль смещается по нормали (подворот внизу, завал вверху), сверху и снизу — полки.
// outline — точки в плане по порядку; yLo/yHi(i) — высоты низа и верха в точке i;
// prof(v) — смещение наружу при относительной высоте v ∈ [0,1]; depth — глубина полок.
function bumperGeo(outline, yLo, yHi, prof, depth = 0.14, nv = 14) {
  const n = outline.length;
  const normals = outline.map((p, i) => {
    const a = outline[Math.max(0, i - 1)];
    const b = outline[Math.min(n - 1, i + 1)];
    const t = new THREE.Vector2(b.x - a.x, b.y - a.y).normalize();
    const nn = new THREE.Vector2(t.y, -t.x);
    // наружу — от центра машины в плане
    const c = new THREE.Vector2(p.x - DIM.L / 2, p.y);
    if (nn.dot(c) < 0) nn.negate();
    return nn;
  });
  const rows = [];
  // нижняя полка (изнутри к кромке), лицевая поверхность, верхняя полка (от кромки внутрь)
  rows.push((i) => ({ o: prof(0) - depth, y: yLo(i) + 0.01 }));
  for (let j = 0; j <= nv; j++) rows.push((i) => ({ o: prof(j / nv), y: yLo(i) + (yHi(i) - yLo(i)) * (j / nv) }));
  rows.push((i) => ({ o: prof(1) - depth, y: yHi(i) - 0.005 }));
  const pos = [];
  const idx = [];
  rows.forEach((row) => {
    for (let i = 0; i < n; i++) {
      const { o, y } = row(i);
      pos.push(outline[i].x + normals[i].x * o, y, outline[i].y + normals[i].y * o);
    }
  });
  for (let r = 0; r < rows.length - 1; r++) {
    for (let i = 0; i < n - 1; i++) {
      const a = r * n + i;
      idx.push(a, a + 1, a + n, a + 1, a + n + 1, a + n);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------- текстуры

function canvasTexture(w, h, draw, repeat = [1, 1]) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function rand(seed) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

const fabricTexture = () =>
  canvasTexture(128, 128, (g, w, h) => {
    const r = rand(3);
    g.fillStyle = '#3b4048';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 1600; i++) {
      g.fillStyle = r() > 0.5 ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.08)';
      g.fillRect(r() * w, r() * h, 1, 1);
    }
  }, [4, 4]);

// ---------------------------------------------------------------- материалы

export function createMaterials() {
  const DS = THREE.DoubleSide;
  return {
    paint: new THREE.MeshPhysicalMaterial({
      color: 0xf1f2ef, metalness: 0.15, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.06, side: DS,
    }),
    plastic: new THREE.MeshStandardMaterial({ color: 0x1d1f22, roughness: 0.72, side: DS }),
    plasticMid: new THREE.MeshStandardMaterial({ color: 0x33363b, roughness: 0.65, side: DS }),
    trim: new THREE.MeshStandardMaterial({ color: 0x2b2d31, roughness: 0.8, side: DS }),
    headliner: new THREE.MeshStandardMaterial({ color: 0xb9b6ae, roughness: 0.95, side: DS }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xdadde0, metalness: 1, roughness: 0.12 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x9aa0a6, metalness: 0.9, roughness: 0.35 }),
    glass: new THREE.MeshPhysicalMaterial({
      color: 0x1b2a33, metalness: 0.1, roughness: 0.03, transparent: true, opacity: 0.32,
      side: DS, depthWrite: false, envMapIntensity: 1.6,
    }),
    lamp: new THREE.MeshPhysicalMaterial({
      color: 0x7f8a93, metalness: 1, roughness: 0.18, clearcoat: 1, emissive: 0x2c3338, emissiveIntensity: 0.15, side: DS,
    }),
    tail: new THREE.MeshPhysicalMaterial({
      color: 0xa3141b, roughness: 0.15, clearcoat: 1, emissive: 0x5a0508, emissiveIntensity: 0.6, side: DS,
    }),
    amber: new THREE.MeshStandardMaterial({ color: 0xf0a020, roughness: 0.2, emissive: 0x6a3d00, emissiveIntensity: 0.5 }),
    tire: new THREE.MeshStandardMaterial({ color: 0x17181a, roughness: 0.92 }),
    fabric: new THREE.MeshStandardMaterial({ color: 0xffffff, map: fabricTexture(), roughness: 0.95 }),
    led: new THREE.MeshStandardMaterial({ color: 0xfff3da, emissive: 0xffd9a0, emissiveIntensity: 2.2 }),
    screen: new THREE.MeshStandardMaterial({ color: 0x0b0f14, emissive: 0x2a6fa8, emissiveIntensity: 0.55, roughness: 0.2 }),
    gauge: new THREE.MeshStandardMaterial({ color: 0x0d0e10, emissive: 0xffffff, emissiveIntensity: 0.02, roughness: 0.3 }),
    plate: new THREE.MeshStandardMaterial({ color: 0xf6f6f2, roughness: 0.5 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x101112, roughness: 0.9, side: DS }),
    paintInner: new THREE.MeshStandardMaterial({ color: 0xe9eae7, roughness: 0.55, side: DS }), // изнанка кузова
    bulkhead: new THREE.MeshStandardMaterial({ color: 0x9b9fa4, roughness: 1, side: DS }), // серый войлок
    fabricLight: new THREE.MeshStandardMaterial({ color: 0x7d8085, roughness: 1 }),
    steelBlack: new THREE.MeshStandardMaterial({ color: 0x1c1d20, metalness: 0.55, roughness: 0.45 }),
    mirror: new THREE.MeshStandardMaterial({ color: 0x8e9297, roughness: 0.5 }),
    badge: new THREE.MeshPhysicalMaterial({ color: 0x9c1b2a, roughness: 0.2, clearcoat: 1 }),
  };
}

// ---------------------------------------------------------------- сборка

export function buildCar(M) {
  const car = new THREE.Group();
  car.name = 'Doblo';
  const body = new THREE.Group();
  const roof = new THREE.Group();   // крышу можно снять, чтобы заглянуть сверху
  const interior = new THREE.Group();
  car.add(body, roof, interior);

  const mesh = (geo, mat, parent = body, cast = true) => {
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = cast;
    m.receiveShadow = true;
    parent.add(m);
    return m;
  };
  const box = (w, h, d, r, mat, x, y, z, parent) => {
    const g = r > 0 ? new RoundedBoxGeometry(w, h, d, 3, r) : new THREE.BoxGeometry(w, h, d);
    const m = mesh(g, mat, parent);
    m.position.set(x, y, z);
    return m;
  };

  const doors = {};
  const X_RF = 2.9;  // передняя кромка крыши (верх лобового стекла)
  const X_CW = 3.72; // стык лобового стекла с капотом

  // Выштамповка большой прямоугольной панели на глухой боковине (как на фото Doblò Cargo):
  // рельефный контур со скруглёнными углами, проложенный по поверхности кузова.
  const emboss = (side, x0, x1, y0, y1, parent = body, r = 0.13) => {
    const pts = [];
    const corner = (cx, cy, a0) => {
      for (let i = 0; i <= 6; i++) {
        const a = a0 + (Math.PI / 2) * (i / 6);
        pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
      }
    };
    corner(x1 - r, y0 + r, -Math.PI / 2);
    corner(x1 - r, y1 - r, 0);
    corner(x0 + r, y1 - r, Math.PI / 2);
    corner(x0 + r, y0 + r, Math.PI);
    const v = pts.map(([x, y]) => new THREE.Vector3(x, y, side * (halfWidth(x, y) + 0.004)));
    const curve = new THREE.CatmullRomCurve3(v, true, 'centripetal');
    return mesh(new THREE.TubeGeometry(curve, 160, 0.007, 8, true), M.paint, parent);
  };

  // ----- ключевые координаты
  const X_A = 3.52;          // передняя кромка передней двери
  const X_B = 2.36;          // стойка B (задняя кромка передней двери)
  const X_B2 = 2.29;         // передняя кромка сдвижной двери
  const X_SL = 1.32;         // задняя кромка сдвижной двери
  const Y_SILL = 0.41;       // порог
  const Y_BELT = 1.06;       // линия остекления
  const GAP = 0.004;
  const doorTop = (x) => shoulder(x) - 0.055;

  // ----- кузов: боковины, стойки, пороги
  for (const side of [-1, 1]) {
    const hasSlide = side > 0; // у этого фургона сдвижная дверь только справа
    mesh(sideGeo({ side, x0: X_A + GAP, x1: NOSE_SEAM, y0: Y_BOTTOM, nu: 40, nv: 14 }), M.paint);
    mesh(sideGeo({ side, x0: X_B, x1: X_A, y0: doorTop, nu: 20, nv: 2 }), M.paint);
    mesh(sideGeo({ side, x0: X_B2, x1: X_B, y0: Y_BOTTOM, nu: 3, nv: 14 }), M.paint);
    if (hasSlide) mesh(sideGeo({ side, x0: X_SL, x1: X_B2, y0: doorTop, nu: 20, nv: 2 }), M.paint);
    mesh(sideGeo({ side, x0: hasSlide ? X_SL : X_B, x1: X_A, y0: Y_BOTTOM, y1: Y_SILL, nu: 40, nv: 2 }), M.plastic);
    mesh(sideGeo({ side, x0: 0, x1: hasSlide ? X_SL - GAP : X_B2, y0: Y_BOTTOM, nu: 40, nv: 14 }), M.paint);
    // выштамповка большой панели на грузовом отсеке
    emboss(side, 0.3, hasSlide ? X_SL - 0.08 : X_B2 - 0.1, 1.1, 1.64);
    // молдинг: слева продолжается на боковину, справа — только на дверях
    if (!hasSlide) mesh(sideGeo({ side, x0: 1.2, x1: X_B2 - 0.01, y0: 0.47, y1: 0.54, off: 0.008, nu: 12, nv: 1 }), M.plastic);
    // грузовой отсек без обшивки: внутренняя панель боковины из окрашенного металла
    mesh(sideGeo({ side, x0: 0.06, x1: hasSlide ? X_SL : X_B2 - 0.06, y0: 0.5, y1: (x) => shoulder(x) - 0.02, off: -0.035, nu: 24, nv: 10 }), M.paintInner, interior);
    // силовые стойки и продольный брус по линии пояса
    const xMax = hasSlide ? X_SL - 0.06 : 2.4;
    for (const x of [0.2, 0.62, 1.1, 1.62, 2.1]) {
      if (x > xMax) continue;
      mesh(sideGeo({ side, x0: x - 0.035, x1: x + 0.035, y0: 0.72, y1: (xx) => shoulder(xx) - 0.03, off: -0.065, nu: 2, nv: 6 }), M.paintInner, interior);
    }
    mesh(sideGeo({ side, x0: 0.12, x1: xMax, y0: 1.06, y1: 1.14, off: -0.07, nu: 16, nv: 1 }), M.paintInner, interior);
    // крючки крепления груза на стойках
    for (const x of [0.2, 1.1, 2.1]) {
      if (x > xMax) continue;
      const hook = mesh(new THREE.TorusGeometry(0.025, 0.006, 6, 12, Math.PI), M.steel, interior);
      hook.position.set(x, 1.2, side * (halfWidth(x, 1.2) - 0.08));
      hook.rotation.y = Math.PI / 2;
    }
    mesh(sideGeo({ side, x0: X_B2, x1: X_B, y0: 0.5, off: -0.035, nu: 2, nv: 8 }), M.trim, interior);
    if (hasSlide) {
      // закрытая направляющая сдвижной двери на задней боковине
      box(0.62, 0.035, 0.02, 0.01, M.plastic, X_SL - 0.33, 1.02, HW + 0.004, body);
      box(0.64, 0.05, 0.012, 0.01, M.paint, X_SL - 0.33, 1.05, HW + 0.002, body);
    } else {
      // лючок топливного бака над передней частью задней арки
      const fx = 0.72;
      const fy = 1.2;
      const flap = mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.006, 32), M.paint);
      flap.rotation.x = Math.PI / 2;
      flap.position.set(fx, fy, -(halfWidth(fx, fy) + 0.003));
      const seam = mesh(new THREE.TorusGeometry(0.087, 0.003, 6, 40), M.plastic);
      seam.position.set(fx, fy, -(halfWidth(fx, fy) + 0.001));
    }

    // чёрные угловые накладки заднего бампера, заходящие на боковину
    mesh(sideGeo({ side, x0: 0.0, x1: 0.36, y0: Y_BOTTOM, y1: (x) => 0.9 - 0.4 * Math.pow(x / 0.36, 1.3), off: 0.01, nu: 14, nv: 8 }), M.plastic);
    box(0.03, 0.42, 0.12, 0.012, M.plastic, -0.014, 0.69, side * (halfWidth(0, 0.7) - 0.05), body);

    // подкрылки
    for (const ax of [DIM.rearAxle, DIM.frontAxle]) {
      const g = new THREE.CylinderGeometry(DIM.archR - 0.005, DIM.archR - 0.005, 0.26, 32, 1, true, Math.PI / 2, Math.PI);
      const liner = mesh(g, M.rubber, body, false);
      liner.rotation.x = Math.PI / 2;
      liner.position.set(ax, DIM.wheelR, side * (HW - 0.13));
    }
  }

  // ----- крыша, лобовое стекло, капот
  mesh(topGeo({ x0: 0, x1: X_RF + 0.02, nu: 30, nv: 30 }), M.paint, roof);
  mesh(topGeo({ x0: 0.06, x1: X_B2 - 0.06, off: -0.03, s0: -0.93, s1: 0.93, nu: 10, nv: 20 }), M.paintInner, roof);
  mesh(topGeo({ x0: X_B2 - 0.06, x1: X_RF, off: -0.03, s0: -0.93, s1: 0.93, nu: 6, nv: 20 }), M.headliner, roof);
  mesh(topGeo({ x0: X_RF + 0.02, x1: X_CW - 0.02, s0: -0.9, s1: 0.9, nu: 20, nv: 24 }), M.glass, body, false);
  mesh(topGeo({ x0: X_RF, x1: X_CW, s0: -1, s1: -0.9, nu: 20, nv: 4 }), M.plastic);
  mesh(topGeo({ x0: X_RF, x1: X_CW, s0: 0.9, s1: 1, nu: 20, nv: 4 }), M.plastic);
  mesh(topGeo({ x0: X_RF, x1: X_RF + 0.04, s0: -0.9, s1: 0.9, nu: 1, nv: 24, off: 0.001 }), M.plastic);
  mesh(topGeo({ x0: X_CW - 0.04, x1: X_CW + 0.03, s0: -0.9, s1: 0.9, nu: 2, nv: 24, off: 0.002 }), M.plastic);
  // антенна над лобовым стеклом
  {
    const p = topPoint(X_RF - 0.12, 0, 0, new THREE.Vector3());
    const ant = mesh(new THREE.CylinderGeometry(0.004, 0.007, 0.4, 8), M.plastic, roof);
    ant.position.set(X_RF - 0.2, p.y + 0.18, 0);
    ant.rotation.z = 0.5;
    box(0.06, 0.03, 0.04, 0.01, M.plastic, X_RF - 0.12, p.y + 0.01, 0, roof);
  }

  // капот — открывается
  {
    const pivot = new THREE.Group();
    const px = X_CW + 0.02;
    const py = topLine(px);
    pivot.position.set(px, py, 0);
    const inner = new THREE.Group();
    inner.position.set(-px, -py, 0);
    pivot.add(inner);
    const hood = mesh(topGeo({ x0: X_CW + 0.02, x1: NOSE_SEAM, nu: 24, nv: 30 }), M.paint, inner);
    hood.userData.part = true;
    const under = mesh(topGeo({ x0: X_CW + 0.06, x1: NOSE_SEAM - 0.03, off: -0.025, s0: -0.9, s1: 0.9, nu: 12, nv: 16 }), M.plasticMid, inner);
    body.add(pivot);
    doors.hood = {
      id: 'hood', name: 'Капот', key: '6', object: pivot, max: 1,
      apply: (t) => (pivot.rotation.z = t * 0.95),
    };
    pivot.userData.doorId = 'hood';
    void under;
  }
  // моторный отсек
  box(0.62, 0.36, 1.4, 0.03, M.plasticMid, 4.33, 0.72, 0, body);
  box(0.36, 0.1, 0.5, 0.03, M.plastic, 4.3, 0.95, -0.2, body);
  box(0.2, 0.08, 0.26, 0.02, M.steel, 4.45, 0.93, 0.35, body);
  {
    const cap = mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.03, 16), M.amber);
    cap.position.set(4.2, 0.95, 0.45);
  }

  // ----- нос: окрашенный торец, решётка под кромкой капота, высокие стреловидные фары, чёрный бампер
  const ZN = halfWidth(NOSE_SEAM, 0.7) + 0.01;
  const noseTop = (z) => sectionTop(NOSE_SEAM, z);
  mesh(frontGeo({ z0: -ZN, z1: ZN, y0: Y_BOTTOM, y1: noseTop, nu: 48, nv: 24 }), M.paint);
  {
    const Y_BUMP = 0.75;   // верх бампера по центру = низ решётки
    const Y_GR = 0.9;      // верх решётки = кромка капота
    const HL_ZI = 0.4;     // внутренний край фары на торце
    // решётка: трапеция, шире сверху, с рамкой и сотовыми рёбрами
    const gr = new THREE.Shape();
    gr.moveTo(-HL_ZI + 0.02, Y_BUMP - 0.01);
    gr.lineTo(HL_ZI - 0.02, Y_BUMP - 0.01);
    gr.lineTo(HL_ZI + 0.03, Y_GR);
    gr.lineTo(-HL_ZI - 0.03, Y_GR);
    gr.closePath();
    mesh(frontGeo({ z0: -HL_ZI - 0.01, z1: HL_ZI + 0.01, y0: Y_BUMP - 0.01, y1: Y_GR, off: 0.004, nu: 16, nv: 6 }), M.plastic);
    void gr;
    for (let i = 0; i < 4; i++) {
      const y = Y_BUMP + 0.03 + i * 0.043;
      const w = 2 * (HL_ZI - 0.04 + ((y - Y_BUMP) / (Y_GR - Y_BUMP)) * 0.05);
      box(0.012, 0.01, w, 0.003, M.plasticMid, xFront(0, y) + 0.01, y, 0, body);
    }
    for (let i = -6; i <= 6; i++) box(0.012, Y_GR - Y_BUMP - 0.04, 0.008, 0.002, M.plasticMid, xFront(i * 0.05, (Y_BUMP + Y_GR) / 2) + 0.01, (Y_BUMP + Y_GR) / 2, i * 0.05, body);
    // хромированный молдинг по верхней кромке решётки
    box(0.012, 0.012, 2 * HL_ZI + 0.04, 0.005, M.chrome, xFront(0, Y_GR) + 0.012, Y_GR - 0.006, 0, body);
    // эмблема в хромированном кольце
    const bRing = mesh(new THREE.CylinderGeometry(0.052, 0.052, 0.02, 36), M.chrome);
    bRing.rotation.z = Math.PI / 2;
    bRing.position.set(xFront(0, 0.83) + 0.016, 0.83, 0);
    const bRed = mesh(new THREE.CylinderGeometry(0.042, 0.042, 0.02, 36), M.badge);
    bRed.rotation.z = Math.PI / 2;
    bRed.position.set(xFront(0, 0.83) + 0.022, 0.83, 0);
    // фары: каплевидные, вытянуты назад по крылу до стойки капота
    // низ фары: на торце ~0.79 м, назад по крылу поднимается к линии капота
    const hlBottom = (x) => 0.87 + 0.13 * Math.pow(Math.max(0, DIM.L - x) / 0.5, 1.3);
    for (const side of [-1, 1]) {
      mesh(sideGeo({ side, x0: 4.24, x1: NOSE_SEAM, y0: hlBottom, y1: 9, off: 0.006, nu: 18, nv: 6 }), M.lamp);
      // верхняя кромка фары заходит на скругление крыла, выше — линия разъёма капота
      mesh(topGeo({ x0: (sv) => 4.3 + 1.6 * (1 - Math.abs(sv)), x1: NOSE_SEAM, s0: side < 0 ? -1 : 0.8, s1: side < 0 ? -0.8 : 1, off: 0.006, nu: 12, nv: 4 }), M.lamp);
      // лицевая часть фары на торце
      const zi = HL_ZI;
      // лицевая часть фары лежит на скруглённом торце, сверху — до кромки капота
      mesh(frontGeo({
        z0: side < 0 ? -ZN : zi, z1: side < 0 ? -zi : ZN,
        y0: (z) => 0.87 + 0.03 * Math.max(0, 1 - (Math.abs(z) - zi) / 0.08),
        y1: (z) => noseTop(z) - 0.02, off: 0.006, nu: 18, nv: 8,
      }), M.lamp);
      // отражатели внутри фары
      // отражатели: один на торце, второй на скруглении крыла, ось — по нормали поверхности
      const onNose = (xx, yy) => {
        const w = halfWidth(xx, yy);
        const dw = (halfWidth(xx + 0.002, yy) - halfWidth(xx - 0.002, yy)) / 0.004;
        const n = new THREE.Vector3(-dw, 0, side).normalize();
        return { p: new THREE.Vector3(xx, yy, side * w).addScaledVector(n, 0.004), n };
      };
      const r1 = mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.012, 24), M.chrome);
      r1.rotation.z = Math.PI / 2;
      r1.position.set(xFront(zi + 0.09, 0.93) + 0.012, 0.93, side * (zi + 0.09));
      for (const [xx, r] of [[DIM.L - 0.05, 0.042], [DIM.L - 0.15, 0.03]]) {
        const { p, n } = onNose(xx, 0.95);
        const pr = mesh(new THREE.CylinderGeometry(r, r * 1.1, 0.012, 24), M.chrome);
        pr.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
        pr.position.copy(p);
      }
      // указатель поворота — узкая полоска по поверхности крыла внутри фары
      mesh(sideGeo({ side, x0: DIM.L - 0.3, x1: DIM.L - 0.2, y0: (x) => hlBottom(x) + 0.015, y1: (x) => hlBottom(x) + 0.04, off: 0.009, nu: 6, nv: 1 }), M.amber);
    }
    // бампер: объёмный, в плане повторяет скругление носа и уходит к передним аркам,
    // верхняя кромка идёт по нижнему краю фар, снизу — подворот и приподнятые углы
    // план бампера: боковины вдоль крыльев + передняя часть-суперэллипс (плавно скруглённые углы)
    const CX = NOSE_X;
    const zEnd = halfWidth(CX, 0.5) + 0.022;
    const AX = DIM.L + 0.085 - CX;
    const outline = [];
    const sidePts = [];
    for (let i = 0; i < 12; i++) {
      const x = 4.16 + ((CX - 4.16) * i) / 12;
      sidePts.push(new THREE.Vector2(x, halfWidth(x, 0.5) + 0.022));
    }
    const nose = [];
    for (let i = 0; i <= 40; i++) {
      const t = -Math.PI / 2 + (Math.PI * i) / 40;
      const c = Math.cos(t);
      const sn = Math.sin(t);
      nose.push(new THREE.Vector2(CX + AX * Math.pow(Math.abs(c), 0.5), zEnd * Math.sign(sn) * Math.pow(Math.abs(sn), 0.5)));
    }
    sidePts.forEach((p) => outline.push(new THREE.Vector2(p.x, -p.y)));
    nose.forEach((p) => outline.push(p));
    sidePts.slice().reverse().forEach((p) => outline.push(new THREE.Vector2(p.x, p.y)));
    // передняя кромка бампера для размещения деталей
    const frontX = (z) => CX + AX * Math.pow(Math.max(0, 1 - Math.pow(Math.min(1, Math.abs(z) / zEnd), 4)), 0.25);
    const bLo = (i) => {
      const p = outline[i];
      const k = p.x < CX ? (CX - p.x) / 0.5 : 0;
      return 0.235 + 0.06 * Math.pow(Math.abs(p.y) / zEnd, 4) + 0.08 * k;
    };
    // сбоку верх бампера идёт по низу фары, за фарой опускается к арке
    const bHi = (i) => {
      const x = outline[i].x;
      if (x <= 4.3) return hlBottom(4.3) - 0.012 - (4.3 - x) * 1.6;
      const zz = Math.abs(outline[i].y);
      const k = Math.min(1, Math.max(0, (zz - (HL_ZI - 0.04)) / 0.12));
      const kk = k * k * (3 - 2 * k);
      return Y_BUMP - 0.012 + (hlBottom(Math.min(x, DIM.L)) - 0.012 - (Y_BUMP - 0.012)) * kk;
    };
    const bProf = (v) => 0.02 - 0.055 * Math.pow(1 - v, 3) - 0.035 * Math.pow(v, 3) + (v > 0.52 ? -0.01 : 0);
    mesh(bumperGeo(outline, bLo, bHi, bProf, 0.16), M.plastic);
    const fx = (z) => frontX(z) - 0.012;
    // углубление под номер
    box(0.03, 0.16, 0.6, 0.02, M.rubber, fx(0) - 0.01, 0.57, 0, body);
    box(0.012, 0.11, 0.52, 0.005, M.plate, fx(0) + 0.008, 0.57, 0, body);
    // нижний воздухозаборник-трапеция с рёбрами
    const intake = new THREE.Shape();
    intake.moveTo(-0.46, 0.27);
    intake.lineTo(0.46, 0.27);
    intake.lineTo(0.52, 0.43);
    intake.lineTo(-0.52, 0.43);
    intake.closePath();
    const ig = capGeo(intake, 0);
    ig.translate(0, 0, 0);
    const im = mesh(ig, M.rubber);
    im.position.x = fx(0.3) + 0.004;
    for (let i = 0; i < 4; i++) box(0.01, 0.012, 0.9 + i * 0.03, 0.004, M.plasticMid, fx(0.3) + 0.012, 0.3 + i * 0.037, 0, body);
    // противотуманки в угловых нишах
    for (const side of [-1, 1]) {
      const z = side * 0.6;
      // угол касательной к кромке бампера в точке z
      const ang = -Math.atan2(frontX(z + 0.01) - frontX(z - 0.01), 0.02);
      const niche = box(0.03, 0.12, 0.2, 0.04, M.rubber, fx(z) - 0.004, 0.37, z, body);
      niche.rotation.y = ang;
      const fog = mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.02, 24), M.lamp);
      fog.rotation.z = Math.PI / 2;
      fog.rotation.y = ang;
      fog.position.set(fx(z) + 0.012, 0.37, z);
      const rim = mesh(new THREE.TorusGeometry(0.042, 0.006, 6, 24), M.chrome);
      rim.rotation.y = Math.PI / 2 + ang;
      rim.position.set(fx(z) + 0.014, 0.37, z);
    }
    // заглушка буксировочной проушины
    box(0.012, 0.04, 0.05, 0.015, M.plasticMid, fx(-0.46) + 0.004, 0.52, -0.46, body);
  }

  // ----- корма: рамка проёма, фонари, бампер
  const RD = { z0: -0.74, z1: 0.74, y0: 0.47, y1: 1.7, split: 0.11 };
  // полуширина проёма на высоте y: повторяет завал боковин, оставляя стойку ~7 см
  const rearEdge = (y) => Math.min(RD.z1, halfWidth(0.002, y) - 0.075);
  // контур створки/проёма: внешняя кромка идёт по rearEdge, верхний внешний угол скруглён
  const rearShape = (za, zb, y0, y1, inset, outerSign, rT = 0.12) => {
    const pts = [];
    const edge = (y) => outerSign * (rearEdge(y) - inset);
    const inner = outerSign < 0 ? zb : za;
    pts.push([inner, y0], [edge(y0), y0]);
    for (let i = 1; i <= 10; i++) {
      const y = y0 + ((y1 - rT - y0) * i) / 10;
      pts.push([edge(y), y]);
    }
    const c = edge(y1 - rT);
    for (let i = 1; i <= 6; i++) {
      const a = (Math.PI / 2) * (i / 6);
      pts.push([c - outerSign * rT * (1 - Math.cos(a)), y1 - rT + rT * Math.sin(a)]);
    }
    pts.push([inner, y1]);
    if (outerSign > 0) pts.reverse();
    return new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(z, y)));
  };
  {
    const outer = sectionShape(0.001);
    const hole = new THREE.Path([
      ...rearShape(0, 0, RD.y0, RD.y1, 0, -1).getPoints().slice(0, -1).reverse(),
      ...rearShape(0, 0, RD.y0, RD.y1, 0, 1).getPoints().slice(1).reverse(),
    ]);
    outer.holes.push(hole);
    mesh(capGeo(outer, 0.001), M.paint);
    // внутренняя кромка проёма (толщина)
    const frameD = 0.05;
    box(frameD, 0.04, 2 * rearEdge(RD.y1) - 0.2, 0, M.paint, frameD / 2, RD.y1 + 0.02, 0, body);
    // фонари на стойках
    for (const side of [-1, 1]) {
      // корпус фонаря снаружи стойки + часть, заходящая на боковину
      const tl = new THREE.Shape();
      const zi = rearEdge(1.2) + 0.012;
      const zo = halfWidth(0, 1.2) + 0.006;
      tl.moveTo(side * (rearEdge(0.9) + 0.012), 0.9);
      tl.lineTo(side * (halfWidth(0, 0.9) + 0.006), 0.9);
      tl.lineTo(side * (halfWidth(0, 1.55) + 0.006), 1.55);
      tl.quadraticCurveTo(side * (rearEdge(1.6) + 0.02), 1.64, side * (rearEdge(1.45) + 0.012), 1.45);
      tl.closePath();
      mesh(capGeo(tl, -0.006), M.tail);
      // боковая часть фонаря: узкая, со скруглённым верхом
      mesh(sideGeo({ side, x0: 0.0, x1: 0.11, y0: (x) => 0.9 + x * 0.6, y1: (x) => 1.6 - 14 * x * x, off: 0.006, nu: 10, nv: 8 }), M.tail);
      const rev = mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.012, 24), M.lamp);
      rev.rotation.z = Math.PI / 2;
      rev.position.set(-0.01, 1.08, side * (zi + zo) / 2);
    }
    // стоп-сигнал
    box(0.03, 0.04, 0.3, 0.01, M.tail, 0.0, 1.79, 0, body);
    // задний бампер: объёмный, углы уходят вперёд к аркам, сверху — ступенька с рифлением
    const zE = halfWidth(0.04, 0.4) + 0.02;
    const rearX = (z) => -0.07 + 0.1 * Math.pow(Math.min(1, Math.abs(z) / zE), 3);
    const rOut = [];
    const rSide = [];
    for (let i = 0; i <= 10; i++) {
      const x = 0.3 - ((0.3 - 0.04) * i) / 10;
      rSide.push(new THREE.Vector2(x, halfWidth(x, 0.4) + 0.02));
    }
    rSide.forEach((p) => rOut.push(new THREE.Vector2(p.x, p.y)));
    for (let i = 1; i < 26; i++) {
      const z = zE - (2 * zE * i) / 26;
      rOut.push(new THREE.Vector2(rearX(z), z));
    }
    rSide.slice().reverse().forEach((p) => rOut.push(new THREE.Vector2(p.x, -p.y)));
    const rLo = (i) => 0.27 + 0.06 * Math.max(0, rOut[i].x - 0.03) / 0.27;
    const rHi = () => 0.5;
    const rProf = (v) => 0.015 - 0.04 * Math.pow(1 - v, 3) - 0.01 * Math.pow(v, 4);
    mesh(bumperGeo(rOut, rLo, rHi, rProf, 0.2), M.plastic);
    // рифлёная ступенька под порогом проёма
    for (let i = 0; i < 6; i++) box(0.012, 0.008, 1.3, 0.003, M.rubber, -0.05 + i * 0.022, 0.503, 0, body);
    // катафоты, датчики парковки, противотуманный фонарь
    for (const side of [-1, 1]) {
      box(0.012, 0.03, 0.1, 0.006, M.tail, rearX(side * 0.7) - 0.008, 0.33, side * 0.7, body);
      for (const z of [0.18, 0.5]) {
        const sn = mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.01, 16), M.plasticMid);
        sn.rotation.z = Math.PI / 2;
        sn.position.set(rearX(side * z) - 0.012, 0.42, side * z);
      }
    }
    box(0.012, 0.035, 0.08, 0.006, M.tail, rearX(-0.3) - 0.008, 0.3, -0.3, body);
  }

  // ----- пол, перегородки, колёсные ниши внутри
  // пол грузового отсека: чёрное резиновое покрытие с рифлением и проушины крепления груза
  box(X_B2 - 0.1, 0.04, 1.62, 0, M.rubber, 0.05 + (X_B2 - 0.1) / 2, 0.48, 0, interior);
  for (let i = 0; i < 22; i++) box(0.012, 0.006, 1.5, 0, M.plastic, 0.12 + i * 0.105, 0.503, 0, interior);
  for (const x of [0.2, 1.25, 2.3]) for (const z of [-0.62, 0.62]) {
    const ring = mesh(new THREE.TorusGeometry(0.03, 0.006, 6, 16), M.steel, interior);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(x, 0.51, z);
  }
  box(1.35, 0.04, 1.62, 0, M.rubber, 2.57 + 1.35 / 2, 0.4, 0, interior);
  for (const side of [-1, 1]) {
    box(0.82, 0.26, 0.2, 0.04, M.paintInner, DIM.rearAxle, 0.62, side * 0.72, interior);
  }
  // перегородка «кабина / грузовой отсек» с окном, как у серийного Doblò Cargo
  {
    const XP = X_B2 - 0.05;
    const outline = roundedRectShape(-0.84, 0.5, 0.84, 1.77, 0.02, 0.17);
    const win = roundedRectShape(-0.38, 1.34, 0.38, 1.6, 0.05);
    outline.holes.push(win);
    const pg = new THREE.ExtrudeGeometry(outline, { depth: 0.02, bevelEnabled: false, curveSegments: 8 });
    const part = mesh(pg, M.bulkhead, interior);
    part.rotation.y = -Math.PI / 2;
    part.position.x = XP + 0.02;
    mesh(capGeo(roundedRectShape(-0.38, 1.34, 0.38, 1.6, 0.05), XP + 0.01), M.glass, interior, false);
    // резиновый уплотнитель окна
    const seal = new THREE.Shape(roundedRectShape(-0.4, 1.32, 0.4, 1.62, 0.06).getPoints(24));
    seal.holes.push(roundedRectShape(-0.38, 1.34, 0.38, 1.6, 0.05));
    mesh(capGeo(seal, XP + 0.022), M.rubber, interior, false);
  }

  // моторный щит
  box(0.05, 0.6, 1.62, 0, M.rubber, X_CW - 0.02, 0.72, 0, interior);

  // ----- колёса
  const wheels = new THREE.Group();
  car.add(wheels);
  {
    const prof = [];
    const rIn = 0.205;
    const rOut = DIM.wheelR;
    const w = 0.195 / 2;
    prof.push(new THREE.Vector2(rIn, -w * 0.92));
    for (let i = 0; i <= 10; i++) {
      const a = -Math.PI / 2 + (Math.PI * i) / 10;
      prof.push(new THREE.Vector2(rOut - 0.035 + Math.cos(a) * 0.035, Math.sin(a) * w));
    }
    prof.push(new THREE.Vector2(rIn, w * 0.92));
    const tireGeo = new THREE.LatheGeometry(prof, 48);
    for (const ax of [DIM.rearAxle, DIM.frontAxle]) {
      for (const side of [-1, 1]) {
        const g = new THREE.Group();
        g.position.set(ax, DIM.wheelR, side * (HW - 0.14));
        const tire = new THREE.Mesh(tireGeo, M.tire);
        tire.rotation.x = Math.PI / 2;
        tire.castShadow = true;
        g.add(tire);
        const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.205, 0.205, 0.16, 36), M.steelBlack);
        rim.rotation.x = Math.PI / 2;
        g.add(rim);
        // лицевой диск со штампованным кольцом отверстий
        const face = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.2, 0.02, 36), M.steelBlack);
        face.rotation.x = Math.PI / 2;
        face.position.z = side * 0.075;
        g.add(face);
        const dish = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.012, 8, 36), M.steelBlack);
        dish.position.z = side * 0.088;
        g.add(dish);
        for (let i = 0; i < 14; i++) {
          const a = (i / 14) * Math.PI * 2;
          const hole = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.006, 12), M.tire);
          hole.rotation.x = Math.PI / 2;
          hole.position.set(Math.cos(a) * 0.15, Math.sin(a) * 0.15, side * 0.087);
          g.add(hole);
        }
        const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.03, 20), M.steelBlack);
        hub.rotation.x = Math.PI / 2;
        hub.position.z = side * 0.09;
        g.add(hub);
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * Math.PI * 2 + 0.4;
          const nut = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.02, 6), M.steel);
          nut.rotation.x = Math.PI / 2;
          nut.position.set(Math.cos(a) * 0.07, Math.sin(a) * 0.07, side * 0.09);
          g.add(nut);
        }
        wheels.add(g);
      }
    }
  }

  // ----- передние двери
  const makeHingedFront = (side) => {
    const id = side < 0 ? 'fl' : 'fr';
    const pivot = new THREE.Group();
    const hingeZ = side * halfWidth(X_A, 0.8);
    pivot.position.set(X_A, 0, hingeZ);
    const g = new THREE.Group();
    g.position.set(-X_A, 0, -hingeZ);
    pivot.add(g);
    const xw0 = X_B + 0.07;
    const xw1 = X_A - 0.05;
    const top = (x) => doorTop(x) - 0.004;
    const winTop = (x) => top(x) - 0.06;
    const x0 = X_B + GAP;
    const x1 = X_A - GAP;
    mesh(sideGeo({ side, x0, x1, y0: Y_SILL, y1: Y_BELT, nu: 24, nv: 10 }), M.paint, g);
    mesh(sideGeo({ side, x0, x1: xw0, y0: Y_BELT, y1: top, nu: 3, nv: 8 }), M.paint, g);
    mesh(sideGeo({ side, x0: xw1, x1, y0: Y_BELT, y1: top, nu: 3, nv: 8 }), M.paint, g);
    mesh(sideGeo({ side, x0: xw0, x1: xw1, y0: winTop, y1: top, nu: 20, nv: 2 }), M.plastic, g);
    mesh(sideGeo({ side, x0: xw0, x1: xw1, y0: Y_BELT, y1: winTop, nu: 20, nv: 6, off: -0.01 }), M.glass, g, false);
    // обшивка изнутри
    mesh(sideGeo({ side, x0: x0 + 0.02, x1: x1 - 0.02, y0: Y_SILL + 0.02, y1: Y_BELT + 0.02, off: -0.06, nu: 20, nv: 6 }), M.trim, g);
    box(0.5, 0.05, 0.08, 0.02, M.plasticMid, (x0 + x1) / 2, Y_BELT, side * (HW - 0.07), g);
    box(0.22, 0.04, 0.06, 0.015, M.plastic, x0 + 0.35, 0.93, side * (HW - 0.1), g);
    box(0.35, 0.06, 0.03, 0.01, M.plasticMid, (x0 + x1) / 2, 0.6, side * (HW - 0.095), g);
    // молдинг и ручка
    mesh(sideGeo({ side, x0: x0 + 0.01, x1: x1 - 0.01, y0: 0.47, y1: 0.54, off: 0.008, nu: 20, nv: 1 }), M.plastic, g);
    box(0.035, 0.14, 0.03, 0.012, M.plastic, x0 + 0.1, 0.98, side * (HW + 0.012), g);
    // зеркало
    const arm = box(0.1, 0.05, 0.12, 0.02, M.plastic, X_A - 0.1, 1.12, side * (HW + 0.04), g);
    void arm;
    const housing = box(0.12, 0.3, 0.2, 0.05, M.mirror, X_A - 0.12, 1.2, side * (HW + 0.13), g);
    void housing;
    const mirror = mesh(new THREE.PlaneGeometry(0.18, 0.14), M.chrome, g, false);
    mirror.position.set(X_A - 0.182, 1.2, side * (HW + 0.13));
    mirror.scale.y = 1.6;
    mirror.rotation.y = -Math.PI / 2;
    body.add(pivot);
    pivot.userData.doorId = id;
    doors[id] = {
      id, key: side < 0 ? '1' : '2', name: side < 0 ? 'Водительская' : 'Пассажирская', object: pivot, max: 1,
      apply: (t) => (pivot.rotation.y = side * t * 1.2),
    };
  };
  makeHingedFront(-1);
  makeHingedFront(1);

  // ----- сдвижные двери
  const makeSliding = (side) => {
    const id = side < 0 ? 'sl' : 'sr';
    const g = new THREE.Group();
    const x0 = X_SL + GAP;
    const x1 = X_B2 - GAP;
    const top = (x) => doorTop(x) - 0.004;
    // грузовой фургон: сдвижная дверь глухая, без окна
    mesh(sideGeo({ side, x0, x1, y0: Y_SILL, y1: top, nu: 24, nv: 16 }), M.paint, g);
    emboss(side, x0 + 0.1, x1 - 0.1, 1.1, 1.64, g);
    mesh(sideGeo({ side, x0: x0 + 0.02, x1: x1 - 0.02, y0: Y_SILL + 0.03, y1: (x) => top(x) - 0.03, off: -0.05, nu: 20, nv: 10 }), M.paintInner, g);
    mesh(sideGeo({ side, x0: x0 + 0.01, x1: x1 - 0.01, y0: 0.47, y1: 0.54, off: 0.008, nu: 20, nv: 1 }), M.plastic, g);
    box(0.035, 0.14, 0.03, 0.012, M.plastic, x1 - 0.06, 0.98, side * (HW + 0.012), g);
    box(0.03, 0.18, 0.04, 0.012, M.plastic, x1 - 0.06, 1.0, side * (HW - 0.07), g);
    body.add(g);
    g.userData.doorId = id;
    const travel = x1 - x0 - 0.02;
    const ease = (a, b, t) => {
      const k = Math.min(1, Math.max(0, (t - a) / (b - a)));
      return k * k * (3 - 2 * k);
    };
    doors[id] = {
      id, key: '3', name: 'Сдвижная', object: g, max: 1, linear: true,
      apply: (t) => {
        g.position.z = side * 0.075 * ease(0, 0.22, t);
        g.position.x = -travel * ease(0.12, 1, t);
      },
    };
  };
  makeSliding(1);

  // ----- распашные задние двери (асимметрия 60/40, открытие до 180°)
  const makeRear = (side) => {
    const id = side < 0 ? 'rl' : 'rr';
    const hingeZ = side * rearEdge(1.0);
    const za = side < 0 ? -rearEdge(1.0) : RD.split + 0.004;
    const zb = side < 0 ? RD.split - 0.004 : rearEdge(1.0);
    const pivot = new THREE.Group();
    pivot.position.set(0, 0, hingeZ);
    const g = new THREE.Group();
    g.position.set(0, 0, -hingeZ);
    pivot.add(g);
    const depth = 0.045;
    const [y0, y1] = [RD.y0 + 0.004, RD.y1 - 0.004];
    const outline = rearShape(za, zb, y0, y1, 0.004, side);
    const geo = new THREE.ExtrudeGeometry(outline, { depth, bevelEnabled: false, curveSegments: 8 });
    const panel = mesh(geo, M.paint, g);
    panel.rotation.y = -Math.PI / 2;
    panel.position.x = depth;
    // обшивка изнутри
    const frame = rearShape(side < 0 ? za : za + 0.03, side < 0 ? zb - 0.03 : zb, y0 + 0.03, y1 - 0.03, 0.035, side, 0.1);
    const w = zb - za;
    frame.holes.push(roundedRectShape(za + 0.1, y0 + 0.12, zb - 0.1, 0.88, 0.08));
    frame.holes.push(roundedRectShape(za + 0.1 + (side < 0 ? 0.06 : 0), 1.04, zb - 0.1 - (side > 0 ? 0.06 : 0), y1 - 0.14, 0.08));
    const fg = new THREE.ExtrudeGeometry(frame, { depth: 0.035, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.008, bevelSegments: 2, curveSegments: 8 });
    const fm = mesh(fg, M.paintInner, g);
    fm.rotation.y = -Math.PI / 2;
    fm.position.x = depth + 0.045;
    // механизм замка и тяги
    const lockZ = side < 0 ? zb - 0.12 : za + 0.12;
    box(0.03, 0.14, 0.08, 0.01, M.steelBlack, depth + 0.05, 0.95, lockZ, g);
    box(0.012, y1 - y0 - 0.3, 0.012, 0, M.steel, depth + 0.045, (y0 + y1) / 2, lockZ, g);
    void w;
    // ручка, номер
    // чёрная накладка поперёк дверей: на левой — номер и ручка, на правой — эмблема
    if (side < 0) {
      box(0.02, 0.15, zb - za - 0.12, 0.02, M.plastic, -0.008, 0.95, (za + 0.12 + zb) / 2, g);
      box(0.012, 0.11, 0.52, 0.005, M.plate, -0.02, 0.95, zb - 0.42, g);
      box(0.03, 0.05, 0.1, 0.015, M.plasticMid, -0.022, 0.95, zb - 0.08, g);
    } else {
      box(0.02, 0.15, 0.32, 0.02, M.plastic, -0.008, 0.95, za + 0.16, g);
      const ring = mesh(new THREE.CylinderGeometry(0.052, 0.052, 0.012, 32), M.chrome, g);
      ring.rotation.z = Math.PI / 2;
      ring.position.set(-0.02, 0.95, za + 0.2);
      const red = mesh(new THREE.CylinderGeometry(0.043, 0.043, 0.012, 32), M.badge, g);
      red.rotation.z = Math.PI / 2;
      red.position.set(-0.024, 0.95, za + 0.2);
    }
    // уплотнитель
    box(0.02, y1 - y0, 0.02, 0.005, M.rubber, depth / 2, (y0 + y1) / 2, side < 0 ? zb : za, g);
    body.add(pivot);
    pivot.userData.doorId = id;
    doors[id] = {
      id, key: side < 0 ? '4' : '5', name: side < 0 ? 'Задняя левая' : 'Задняя правая', object: pivot, max: 1, rear: true,
      // wide ∈ [0,1]: 0 — упор на 90°, 1 — полное раскрытие на 180°
      apply: (t, wide = 0) => (pivot.rotation.y = side * t * Math.PI * (0.5 + 0.495 * wide)),
    };
  };
  makeRear(-1);
  makeRear(1);

  // ---------------------------------------------------------------- кабина
  const cab = new THREE.Group();
  cab.position.x = X_CW - 3.97; // интерьер построен от стыка стекла 3,97 м
  interior.add(cab);
  {
    // торпедо: профиль в плоскости (x,y), вытянутый по ширине
    const s = new THREE.Shape();
    s.moveTo(3.95, 0.62);
    s.lineTo(3.95, 1.12);
    s.lineTo(3.7, 1.17);
    s.quadraticCurveTo(3.5, 1.2, 3.44, 1.12);
    s.lineTo(3.42, 0.96);
    s.quadraticCurveTo(3.45, 0.84, 3.58, 0.76);
    s.lineTo(3.72, 0.62);
    s.closePath();
    const dg = new THREE.ExtrudeGeometry(s, { depth: 1.62, bevelEnabled: true, bevelSize: 0.015, bevelThickness: 0.015, bevelSegments: 2 });
    const dash = mesh(dg, M.plasticMid, cab);
    dash.position.z = -0.81;
    // верх торпедо темнее
    box(0.4, 0.02, 1.6, 0.01, M.plastic, 3.72, 1.165, 0, cab).rotation.z = 0.12;
    // щиток приборов
    // щиток приборов: тёмная панель в торце торпедо под козырьком
    box(0.012, 0.15, 0.36, 0.005, M.plastic, 3.418, 1.06, -0.42, cab);
    const visor = box(0.12, 0.035, 0.38, 0.015, M.plastic, 3.45, 1.16, -0.42, cab);
    visor.rotation.z = -0.1;
    for (const [dz, r, y] of [[-0.11, 0.055, 1.055], [0.11, 0.055, 1.055], [-0.035, 0.026, 1.09], [0.035, 0.026, 1.09]]) {
      const g = mesh(new THREE.CircleGeometry(r, 32), M.gauge, cab, false);
      g.position.set(3.41, y, -0.42 + dz);
      g.rotation.y = -Math.PI / 2;
      const ring = mesh(new THREE.TorusGeometry(r + 0.001, r > 0.03 ? 0.005 : 0.003, 8, 32), M.chrome, cab, false);
      ring.position.copy(g.position);
      ring.rotation.y = -Math.PI / 2;
      const needle = box(0.004, r * 0.8, 0.004, 0, M.tail, 3.406, y, -0.42 + dz, cab);
      needle.rotation.x = dz < 0 ? -1.1 : 0.9;
    }
    // дисплей бортового компьютера между спидометром и тахометром
    box(0.004, 0.035, 0.08, 0.002, M.tail, 3.408, 1.02, -0.42, cab);
    // центральная консоль: экран, дефлекторы, блок климата
    box(0.03, 0.24, 0.46, 0.08, M.plastic, 3.425, 1.03, 0, cab);                  // овальная рамка
    for (const dz of [-0.17, 0.17]) {
      box(0.012, 0.15, 0.06, 0.02, M.plasticMid, 3.408, 1.04, dz, cab);             // вертикальные дефлекторы
      for (let i = 0; i < 4; i++) box(0.006, 0.13, 0.004, 0, M.plastic, 3.402, 1.04, dz - 0.021 + i * 0.014, cab);
    }
    box(0.012, 0.055, 0.2, 0.006, M.plastic, 3.405, 1.085, 0, cab);                  // магнитола
    box(0.004, 0.018, 0.07, 0.002, M.screen, 3.398, 1.09, 0.04, cab);
    box(0.012, 0.035, 0.18, 0.006, M.rubber, 3.407, 1.025, 0, cab);                  // ниша
    box(0.012, 0.03, 0.28, 0.006, M.plasticMid, 3.408, 0.955, 0, cab);               // ряд кнопок
    box(0.006, 0.026, 0.035, 0.004, M.badge, 3.402, 0.955, 0, cab);                  // аварийка
    box(0.03, 0.1, 0.28, 0.03, M.plasticMid, 3.44, 0.86, 0, cab);                    // блок климата
    for (const dz of [-0.085, 0, 0.085]) {
      const k = mesh(new THREE.CylinderGeometry(0.028, 0.03, 0.03, 20), M.plastic, cab);
      k.rotation.z = Math.PI / 2;
      k.position.set(3.418, 0.855, dz);
    }
    for (const dz of [-0.72, 0.72]) box(0.03, 0.05, 0.11, 0.012, M.plastic, 3.425, 1.1, dz, cab);
    // ниша-бардачок на верху торпедо
    box(0.16, 0.012, 0.36, 0.01, M.rubber, 3.66, 1.185, 0, cab).rotation.z = 0.12;
    // бардачок / полка над торпедо справа
    box(0.02, 0.14, 0.5, 0.02, M.plastic, 3.46, 0.92, 0.45, cab);
    // тоннель и рычаг КПП
    box(0.5, 0.14, 0.24, 0.04, M.plasticMid, 3.25, 0.5, 0, cab);
    const lever = mesh(new THREE.CylinderGeometry(0.01, 0.012, 0.22, 10), M.plastic, cab);
    lever.position.set(3.32, 0.86, 0);
    lever.rotation.z = 0.3;
    const knob = mesh(new THREE.SphereGeometry(0.03, 16, 12), M.plastic, cab);
    knob.position.set(3.29, 0.97, 0);
    box(0.12, 0.05, 0.12, 0.02, M.rubber, 3.36, 0.76, 0, cab);
    box(0.25, 0.05, 0.05, 0.02, M.plastic, 2.98, 0.62, 0, cab).rotation.z = 0.2;

    // руль (левый руль): колонка поднимается к водителю
    const wheelPos = new THREE.Vector3(3.27, 1.06, -0.42);
    const sw = new THREE.Group();
    sw.position.copy(wheelPos);
    sw.lookAt(wheelPos.clone().add(new THREE.Vector3(-Math.cos(0.55), Math.sin(0.55), 0)));
    cab.add(sw);
    const rimM = new THREE.Mesh(new THREE.TorusGeometry(0.185, 0.019, 12, 48), M.plastic);
    rimM.castShadow = true;
    sw.add(rimM);
    const hubM = new THREE.Mesh(new RoundedBoxGeometry(0.15, 0.13, 0.06, 3, 0.03), M.plastic);
    sw.add(hubM);
    const badgeRing = new THREE.Mesh(new THREE.CircleGeometry(0.024, 24), M.chrome);
    badgeRing.position.z = 0.031;
    sw.add(badgeRing);
    const badge = new THREE.Mesh(new THREE.CircleGeometry(0.019, 24), M.badge);
    badge.position.z = 0.032;
    sw.add(badge);
    for (const a of [0, Math.PI, -Math.PI / 2]) {
      const sp = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.035, 0.018), M.plasticMid);
      sp.position.set(Math.cos(a) * 0.1, Math.sin(a) * 0.1, 0);
      sp.rotation.z = a;
      sw.add(sp);
    }
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 0.3, 16), M.plastic);
    col.rotation.x = Math.PI / 2;
    col.position.z = -0.17;
    sw.add(col);
    // подрулевые переключатели
    for (const dx of [-0.07, 0.07]) {
      const st = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.012, 0.012), M.plastic);
      st.position.set(dx * 1.9, 0.02, -0.07);
      sw.add(st);
    }

    // педали
    for (const [dz, w] of [[-0.55, 0.06], [-0.43, 0.08], [-0.3, 0.06]]) {
      const p = box(0.02, 0.09, w, 0.008, M.rubber, 3.72, 0.55, dz, cab);
      p.rotation.z = -0.35;
    }

    // сиденья
    const seat = (z, wide = 0.5, armrest = false) => {
      const s = new THREE.Group();
      s.position.set(2.92, 0, z);
      cab.add(s);
      box(0.5, 0.13, wide, 0.05, M.fabric, 0.02, 0.63, 0, s);
      box(0.3, 0.2, wide - 0.1, 0.02, M.plastic, 0.0, 0.48, 0, s);
      const back = new THREE.Group();
      back.position.set(-0.22, 0.66, 0);
      back.rotation.z = 0.22;
      s.add(back);
      box(0.13, 0.66, wide, 0.06, M.fabric, 0, 0.33, 0, back);
      box(0.1, 0.18, wide * 0.55, 0.04, M.fabric, 0.0, 0.76, 0, back);
      box(0.02, 0.4, wide * 0.56, 0.01, M.fabricLight, 0.06, 0.36, 0, back);      // светлая вставка спинки
      box(0.012, 0.08, 0.012, 0, M.chrome, 0, 0.64, wide * 0.15, back);
      box(0.012, 0.08, 0.012, 0, M.chrome, 0, 0.64, -wide * 0.15, back);
      // боковая поддержка
      for (const sd of [-1, 1]) {
        box(0.14, 0.52, 0.06, 0.03, M.fabric, 0.015, 0.34, sd * (wide / 2 - 0.02), back);
      }
      box(0.3, 0.015, wide * 0.56, 0.006, M.fabricLight, 0.04, 0.697, 0, s);        // светлая вставка подушки
      if (armrest) box(0.32, 0.05, 0.06, 0.02, M.plastic, -0.02, 0.86, wide / 2 + 0.03, s);
      return s;
    };
    seat(-0.42, 0.5, true);
    seat(0.42);
    // салонное зеркало
    box(0.03, 0.06, 0.22, 0.02, M.plastic, 3.36, 1.64, 0, cab);
    box(0.08, 0.02, 0.02, 0, M.plastic, 3.4, 1.69, 0, cab);
    // козырьки
    for (const sd of [-1, 1]) {
      const v = box(0.24, 0.02, 0.36, 0.01, M.headliner, 3.3, 1.7, sd * 0.42, cab);
      v.rotation.z = 0.28;
    }
    // полка над кабиной
    box(0.45, 0.04, 1.5, 0.02, M.headliner, X_RF - 0.3, 1.63, 0, roof);
    box(0.03, 0.08, 1.5, 0.01, M.headliner, X_RF - 0.52, 1.66, 0, roof);
    // плафон
    box(0.12, 0.02, 0.2, 0.01, M.led, X_RF - 0.12, 1.8, 0, roof);
  }

  // плафон грузового отсека
  box(0.16, 0.025, 0.08, 0.01, M.led, 1.3, topPoint(1.3, 0, -0.035, new THREE.Vector3()).y - 0.01, 0, roof);

  // Светильники салона: без теней, чтобы внутри было видно и при закрытой машине.
  const cabinLight = new THREE.PointLight(0xfff4e2, 1.0, 3.2, 1.6);
  cabinLight.position.set(1.1, 1.55, 0);
  interior.add(cabinLight);
  const cabinLight2 = new THREE.PointLight(0xfff0dc, 0.7, 2.4, 1.6);
  cabinLight2.position.set(3.0, 1.55, 0);
  interior.add(cabinLight2);

  // Отмечаем все меши двери её id — чтобы клик по любой детали двери её открывал.
  for (const d of Object.values(doors)) {
    d.object.traverse((o) => (o.userData.doorId = d.id));
  }

  return { car, body, roof, interior, wheels, doors, lights: [cabinLight, cabinLight2] };
}
