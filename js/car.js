// Процедурная модель Fiat Doblò Cargo Maxi (кузов 263, L2H1) с жилым модулем «спальник».
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
    [2.95, 1.852],
    [3.1, 1.835],
    [3.97, 1.13],
    [4.25, 1.09],
    [4.6, 1.02],
    [4.76, 0.93],
  ],
  0.05,
  -0.1,
  4.9
);

const shoulder = (x) => topLine(x) - R_ROOF;

// Полуширина кузова: сужение носа в плане, завал боковин вверху и подворот внизу.
function halfWidth(x, y) {
  let w = HW;
  if (x > 4.1) w -= 0.13 * Math.pow((x - 4.1) / 0.65, 2.4);
  if (x < 0.3) w -= 0.07 * Math.pow((0.3 - x) / 0.3, 2.2); // скруглённые задние углы в плане
  if (y > 1.0) w -= 0.07 * Math.pow(Math.min(1, (y - 1.0) / 0.85), 1.6);
  if (y < 0.5) w -= 0.025 * Math.pow((0.5 - y) / 0.16, 2);
  return w;
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

const woodTexture = () =>
  canvasTexture(512, 512, (g, w, h) => {
    const r = rand(7);
    g.fillStyle = '#c9a37a';
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 90; i++) {
      const y = r() * h;
      g.strokeStyle = `rgba(${120 + r() * 40},${80 + r() * 30},${40 + r() * 20},${0.12 + r() * 0.2})`;
      g.lineWidth = 1 + r() * 3;
      g.beginPath();
      g.moveTo(0, y);
      for (let x = 0; x <= w; x += 32) g.lineTo(x, y + Math.sin(x * 0.02 + i) * (2 + r() * 4));
      g.stroke();
    }
  });

const plaidTexture = () =>
  canvasTexture(256, 256, (g, w, h) => {
    g.fillStyle = '#39556b';
    g.fillRect(0, 0, w, h);
    g.globalAlpha = 0.55;
    for (const [c, o, s] of [
      ['#c9d4dc', 0, 18],
      ['#1f3344', 64, 40],
      ['#d98c3a', 150, 8],
    ]) {
      g.fillStyle = c;
      g.fillRect(o, 0, s, h);
      g.fillRect(0, o, w, s);
    }
  }, [2, 2]);

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
      color: 0xaab3ba, metalness: 0.9, roughness: 0.1, clearcoat: 1, emissive: 0x6d7f8c, emissiveIntensity: 0.1, side: DS,
    }),
    tail: new THREE.MeshPhysicalMaterial({
      color: 0xa3141b, roughness: 0.15, clearcoat: 1, emissive: 0x5a0508, emissiveIntensity: 0.6, side: DS,
    }),
    amber: new THREE.MeshStandardMaterial({ color: 0xf0a020, roughness: 0.2, emissive: 0x6a3d00, emissiveIntensity: 0.5 }),
    tire: new THREE.MeshStandardMaterial({ color: 0x17181a, roughness: 0.92 }),
    fabric: new THREE.MeshStandardMaterial({ color: 0xffffff, map: fabricTexture(), roughness: 0.95 }),
    wood: new THREE.MeshStandardMaterial({ color: 0xffffff, map: woodTexture(), roughness: 0.7, side: DS }),
    felt: new THREE.MeshStandardMaterial({ color: 0x6c7076, roughness: 1, side: DS }),
    mattress: new THREE.MeshStandardMaterial({ color: 0xe6e2da, roughness: 0.95 }),
    pillow: new THREE.MeshStandardMaterial({ color: 0xf5f2ec, roughness: 0.95 }),
    blanket: new THREE.MeshStandardMaterial({ color: 0xffffff, map: plaidTexture(), roughness: 0.98 }),
    led: new THREE.MeshStandardMaterial({ color: 0xfff3da, emissive: 0xffd9a0, emissiveIntensity: 2.2 }),
    screen: new THREE.MeshStandardMaterial({ color: 0x0b0f14, emissive: 0x2a6fa8, emissiveIntensity: 0.55, roughness: 0.2 }),
    gauge: new THREE.MeshStandardMaterial({ color: 0x0d0e10, emissive: 0xffffff, emissiveIntensity: 0.02, roughness: 0.3 }),
    plate: new THREE.MeshStandardMaterial({ color: 0xf6f6f2, roughness: 0.5 }),
    rubber: new THREE.MeshStandardMaterial({ color: 0x101112, roughness: 0.9, side: DS }),
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
  const X_B = 2.62;          // стойка B (задняя кромка передней двери)
  const X_B2 = 2.55;         // передняя кромка сдвижной двери
  const X_SL = 1.56;         // задняя кромка сдвижной двери
  const Y_SILL = 0.41;       // порог
  const Y_BELT = 1.06;       // линия остекления
  const GAP = 0.004;
  const doorTop = (x) => shoulder(x) - 0.055;

  // ----- кузов: боковины, стойки, пороги
  for (const side of [-1, 1]) {
    const hasSlide = side > 0; // у этого фургона сдвижная дверь только справа
    mesh(sideGeo({ side, x0: X_A + GAP, x1: DIM.L, y0: Y_BOTTOM, nu: 40, nv: 14 }), M.paint);
    mesh(sideGeo({ side, x0: X_B, x1: X_A, y0: doorTop, nu: 20, nv: 2 }), M.paint);
    mesh(sideGeo({ side, x0: X_B2, x1: X_B, y0: Y_BOTTOM, nu: 3, nv: 14 }), M.paint);
    if (hasSlide) mesh(sideGeo({ side, x0: X_SL, x1: X_B2, y0: doorTop, nu: 20, nv: 2 }), M.paint);
    mesh(sideGeo({ side, x0: hasSlide ? X_SL : X_B, x1: X_A, y0: Y_BOTTOM, y1: Y_SILL, nu: 40, nv: 2 }), M.plastic);
    mesh(sideGeo({ side, x0: 0, x1: hasSlide ? X_SL - GAP : X_B2, y0: Y_BOTTOM, nu: 40, nv: 14 }), M.paint);
    // выштамповка большой панели на грузовом отсеке
    emboss(side, 0.3, hasSlide ? X_SL - 0.08 : X_B2 - 0.1, 1.1, 1.64);
    // молдинг: слева продолжается на боковину, справа — только на дверях
    if (!hasSlide) mesh(sideGeo({ side, x0: 1.55, x1: X_B2 - 0.01, y0: 0.66, y1: 0.74, off: 0.008, nu: 12, nv: 1 }), M.plastic);
    // обшивка грузового отсека изнутри (фанера)
    mesh(sideGeo({ side, x0: 0.06, x1: hasSlide ? X_SL : 2.46, y0: 0.5, y1: (x) => shoulder(x) - 0.02, off: -0.035, nu: 24, nv: 10 }), M.wood, interior);
    mesh(sideGeo({ side, x0: X_B2, x1: X_B, y0: 0.5, off: -0.035, nu: 2, nv: 8 }), M.trim, interior);
    if (hasSlide) {
      // закрытая направляющая сдвижной двери на задней боковине
      box(0.62, 0.035, 0.02, 0.01, M.plastic, X_SL - 0.33, 1.02, HW + 0.004, body);
      box(0.64, 0.05, 0.012, 0.01, M.paint, X_SL - 0.33, 1.05, HW + 0.002, body);
    } else {
      // лючок топливного бака над передней частью задней арки
      const fx = 1.02;
      const fy = 1.02;
      const flap = mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.006, 32), M.paint);
      flap.rotation.x = Math.PI / 2;
      flap.position.set(fx, fy, -(halfWidth(fx, fy) + 0.003));
      const seam = mesh(new THREE.TorusGeometry(0.087, 0.003, 6, 40), M.plastic);
      seam.position.set(fx, fy, -(halfWidth(fx, fy) + 0.001));
    }

    // чёрные угловые накладки заднего бампера, заходящие на боковину
    mesh(sideGeo({ side, x0: 0.0, x1: 0.34, y0: Y_BOTTOM, y1: (x) => 0.88 - 0.36 * Math.pow(x / 0.34, 1.5), off: 0.008, nu: 12, nv: 6 }), M.plastic);
    box(0.03, 0.56, 0.14, 0.012, M.plastic, -0.012, 0.61, side * (halfWidth(0, 0.6) - 0.06), body);

    // подкрылки
    for (const ax of [DIM.rearAxle, DIM.frontAxle]) {
      const g = new THREE.CylinderGeometry(DIM.archR - 0.005, DIM.archR - 0.005, 0.26, 32, 1, true, Math.PI / 2, Math.PI);
      const liner = mesh(g, M.rubber, body, false);
      liner.rotation.x = Math.PI / 2;
      liner.position.set(ax, DIM.wheelR, side * (HW - 0.13));
    }
  }

  // ----- крыша, лобовое стекло, капот
  mesh(topGeo({ x0: 0, x1: 3.14, nu: 30, nv: 30 }), M.paint, roof);
  mesh(topGeo({ x0: 0.06, x1: 2.55, off: -0.03, s0: -0.93, s1: 0.93, nu: 10, nv: 20 }), M.wood, roof);
  mesh(topGeo({ x0: 2.55, x1: 3.12, off: -0.03, s0: -0.93, s1: 0.93, nu: 6, nv: 20 }), M.headliner, roof);
  mesh(topGeo({ x0: 3.14, x1: 3.95, s0: -0.9, s1: 0.9, nu: 20, nv: 24 }), M.glass, body, false);
  mesh(topGeo({ x0: 3.12, x1: 3.97, s0: -1, s1: -0.9, nu: 20, nv: 4 }), M.plastic);
  mesh(topGeo({ x0: 3.12, x1: 3.97, s0: 0.9, s1: 1, nu: 20, nv: 4 }), M.plastic);
  mesh(topGeo({ x0: 3.12, x1: 3.16, s0: -0.9, s1: 0.9, nu: 1, nv: 24, off: 0.001 }), M.plastic);
  mesh(topGeo({ x0: 3.93, x1: 4.0, s0: -0.9, s1: 0.9, nu: 2, nv: 24, off: 0.002 }), M.plastic);
  // антенна над лобовым стеклом
  {
    const p = topPoint(3.0, 0, 0, new THREE.Vector3());
    const ant = mesh(new THREE.CylinderGeometry(0.004, 0.007, 0.4, 8), M.plastic, roof);
    ant.position.set(2.92, p.y + 0.18, 0);
    ant.rotation.z = 0.5;
    box(0.06, 0.03, 0.04, 0.01, M.plastic, 3.0, p.y + 0.01, 0, roof);
  }
  // вентилятор-люк спального модуля
  {
    const p = topPoint(1.15, 0, 0, new THREE.Vector3());
    box(0.42, 0.05, 0.42, 0.02, M.plastic, 1.15, p.y + 0.02, 0, roof);
    const dome = mesh(new THREE.SphereGeometry(0.2, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), M.glass, roof, false);
    dome.scale.y = 0.35;
    dome.position.set(1.15, p.y + 0.045, 0);
    box(0.4, 0.02, 0.4, 0.005, M.plastic, 1.15, p.y - 0.05, 0, roof);
  }

  // капот — открывается
  {
    const pivot = new THREE.Group();
    const px = 3.99;
    const py = topLine(px);
    pivot.position.set(px, py, 0);
    const inner = new THREE.Group();
    inner.position.set(-px, -py, 0);
    pivot.add(inner);
    const hood = mesh(topGeo({ x0: 3.99, x1: 4.745, nu: 24, nv: 30 }), M.paint, inner);
    hood.userData.part = true;
    const under = mesh(topGeo({ x0: 4.03, x1: 4.7, off: -0.025, s0: -0.9, s1: 0.9, nu: 12, nv: 16 }), M.plasticMid, inner);
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

  // ----- нос: чёрный торец с решёткой, стреловидные фары, большой чёрный бампер
  mesh(capGeo(sectionShape(DIM.L - 0.004), DIM.L - 0.004), M.plastic);
  {
    const Y_BUMP = 0.71; // верх бампера = низ фар и решётки
    // решётка: чёрная полоса под кромкой капота между фарами
    for (let i = 0; i < 3; i++) {
      box(0.02, 0.012, 0.74, 0.004, M.plasticMid, DIM.L + 0.006, Y_BUMP + 0.035 + i * 0.035, 0, body);
    }
    // эмблема в хромированном кольце
    const bRing = mesh(new THREE.CylinderGeometry(0.052, 0.052, 0.02, 36), M.chrome);
    bRing.rotation.z = Math.PI / 2;
    bRing.position.set(DIM.L + 0.012, 0.815, 0);
    const bRed = mesh(new THREE.CylinderGeometry(0.042, 0.042, 0.02, 36), M.badge);
    bRed.rotation.z = Math.PI / 2;
    bRed.position.set(DIM.L + 0.018, 0.815, 0);
    // фары: каплевидные, вытянуты назад по крылу до стойки капота
    const hlBottom = (x) => Y_BUMP + 0.01 + 0.17 * Math.pow(Math.max(0, DIM.L - x) / 0.5, 1.2);
    for (const side of [-1, 1]) {
      mesh(sideGeo({ side, x0: 4.24, x1: DIM.L, y0: hlBottom, y1: 9, off: 0.006, nu: 18, nv: 6 }), M.lamp);
      // верхняя кромка фары заходит на скругление крыла, выше — линия разъёма капота
      mesh(topGeo({ x0: (sv) => 4.3 + 1.6 * (1 - Math.abs(sv)), x1: DIM.L, s0: side < 0 ? -1 : 0.91, s1: side < 0 ? -0.91 : 1, off: 0.006, nu: 12, nv: 4 }), M.lamp);
      // лицевая часть фары на торце
      const fShape = new THREE.Shape();
      const zi = 0.4;
      const zo = halfWidth(DIM.L, 0.8);
      fShape.moveTo(side * zi, Y_BUMP + 0.01);
      fShape.lineTo(side * zo, Y_BUMP + 0.01);
      fShape.lineTo(side * zo, topLine(DIM.L) - 0.02);
      fShape.quadraticCurveTo(side * (zi + 0.1), topLine(DIM.L) + 0.02, side * zi, Y_BUMP + 0.08);
      fShape.closePath();
      mesh(capGeo(fShape, DIM.L + 0.002), M.lamp);
      // отражатели внутри фары
      for (const [dz, r] of [[0.52, 0.05], [0.66, 0.042]]) {
        const pr = mesh(new THREE.CylinderGeometry(r, r * 1.1, 0.012, 24), M.chrome);
        pr.rotation.z = Math.PI / 2;
        pr.position.set(DIM.L + 0.006, 0.8, side * dz);
      }
      box(0.008, 0.02, 0.06, 0.006, M.amber, DIM.L + 0.006, 0.76, side * (zo - 0.05), body);
    }
    // бампер: план повторяет скругление носа, верх на уровне низа фар
    const pts = [];
    for (let i = 0; i <= 28; i++) {
      const x = 4.18 + ((DIM.L + 0.04 - 4.18) * i) / 28;
      pts.push(new THREE.Vector2(x, halfWidth(Math.min(x, DIM.L), 0.5) + 0.018));
    }
    const shape = new THREE.Shape();
    shape.moveTo(pts[0].x, -pts[0].y);
    for (const p of pts) shape.lineTo(p.x, -p.y);
    shape.lineTo(DIM.L + 0.07, 0);
    for (let i = pts.length - 1; i >= 0; i--) shape.lineTo(pts[i].x, pts[i].y);
    shape.closePath();
    const bg = new THREE.ExtrudeGeometry(shape, { depth: Y_BUMP - 0.26, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.022, bevelSegments: 4, curveSegments: 12 });
    const bumper = mesh(bg, M.plastic);
    bumper.rotation.x = -Math.PI / 2;
    bumper.position.y = 0.23;
    // номер, нижний воздухозаборник, противотуманки в нишах
    box(0.01, 0.11, 0.52, 0.005, M.plate, DIM.L + 0.1, 0.52, 0, body);
    box(0.02, 0.1, 0.9, 0.02, M.rubber, DIM.L + 0.094, 0.33, 0, body);
    for (let i = 0; i < 3; i++) box(0.01, 0.008, 0.86, 0, M.plasticMid, DIM.L + 0.104, 0.3 + i * 0.03, 0, body);
    for (const side of [-1, 1]) {
      const niche = box(0.03, 0.1, 0.2, 0.035, M.rubber, DIM.L + 0.06, 0.36, side * 0.63, body);
      niche.rotation.y = side * 0.35;
      const fog = mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.02, 20), M.lamp);
      fog.rotation.z = Math.PI / 2;
      fog.position.set(DIM.L + 0.07, 0.36, side * 0.64);
      fog.rotation.y = side * 0.35;
    }
  }

  // ----- корма: рамка проёма, фонари, бампер
  const RD = { z0: -0.74, z1: 0.74, y0: 0.47, y1: 1.7, split: 0.11 };
  {
    const outer = sectionShape(0.001);
    outer.holes.push(roundedRectShape(RD.z0, RD.y0, RD.z1, RD.y1, 0.02, 0.12));
    mesh(capGeo(outer, 0.001), M.paint);
    // внутренняя кромка проёма (толщина)
    const frameD = 0.05;
    box(frameD, 0.04, RD.z1 - RD.z0, 0, M.paint, frameD / 2, RD.y1 + 0.02, 0, body);
    box(frameD, RD.y1 - RD.y0, 0.04, 0, M.paint, frameD / 2, (RD.y0 + RD.y1) / 2, RD.z0 - 0.02, body);
    box(frameD, RD.y1 - RD.y0, 0.04, 0, M.paint, frameD / 2, (RD.y0 + RD.y1) / 2, RD.z1 + 0.02, body);
    // фонари на стойках
    for (const side of [-1, 1]) {
      // корпус фонаря снаружи стойки + часть, заходящая на боковину
      const tl = new THREE.Shape();
      const zi = 0.755;
      const zo = halfWidth(0, 1.2) + 0.006;
      tl.moveTo(side * zi, 0.9);
      tl.lineTo(side * zo, 0.9);
      tl.lineTo(side * zo, 1.6);
      tl.quadraticCurveTo(side * zi, 1.62, side * zi, 1.45);
      tl.closePath();
      mesh(capGeo(tl, -0.006), M.tail);
      mesh(sideGeo({ side, x0: 0.0, x1: 0.17, y0: (x) => 0.9 + x * 0.3, y1: (x) => 1.6 - x * 0.9, off: 0.006, nu: 8, nv: 6 }), M.tail);
      const rev = mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.012, 24), M.lamp);
      rev.rotation.z = Math.PI / 2;
      rev.position.set(-0.01, 1.08, side * (zi + 0.055));
    }
    // стоп-сигнал
    box(0.03, 0.04, 0.3, 0.01, M.tail, 0.0, 1.79, 0, body);
    // бампер и порог
    box(0.2, 0.24, 2 * halfWidth(0.07, 0.45) + 0.02, 0.06, M.plastic, 0.07, 0.38, 0, body);
    box(0.12, 0.03, 1.5, 0.01, M.plastic, 0.03, 0.47, 0, body);
  }

  // ----- пол, перегородки, колёсные ниши внутри
  box(2.52, 0.04, 1.62, 0, M.felt, 0.05 + 2.52 / 2, 0.48, 0, interior);
  box(1.35, 0.04, 1.62, 0, M.rubber, 2.57 + 1.35 / 2, 0.4, 0, interior);
  for (const side of [-1, 1]) {
    box(0.82, 0.26, 0.2, 0.04, M.felt, DIM.rearAxle, 0.62, side * 0.72, interior);
  }
  // перегородка «кабина / грузовой отсек» с окном, как у серийного Doblò Cargo
  {
    const XP = 2.47;
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
  box(0.05, 0.6, 1.62, 0, M.rubber, 3.97, 0.72, 0, interior);

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
    mesh(sideGeo({ side, x0: x0 + 0.01, x1: x1 - 0.01, y0: 0.66, y1: 0.74, off: 0.008, nu: 20, nv: 1 }), M.plastic, g);
    box(0.035, 0.14, 0.03, 0.012, M.plastic, x0 + 0.1, 0.98, side * (HW + 0.012), g);
    // зеркало
    const arm = box(0.1, 0.05, 0.12, 0.02, M.plastic, X_A - 0.1, 1.12, side * (HW + 0.04), g);
    void arm;
    const housing = box(0.11, 0.24, 0.2, 0.05, M.mirror, X_A - 0.12, 1.18, side * (HW + 0.17), g);
    void housing;
    const mirror = mesh(new THREE.PlaneGeometry(0.18, 0.14), M.chrome, g, false);
    mirror.position.set(X_A - 0.175, 1.18, side * (HW + 0.17));
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
    mesh(sideGeo({ side, x0: x0 + 0.02, x1: x1 - 0.02, y0: Y_SILL + 0.03, y1: (x) => top(x) - 0.03, off: -0.05, nu: 20, nv: 10 }), M.wood, g);
    mesh(sideGeo({ side, x0: x0 + 0.01, x1: x1 - 0.01, y0: 0.66, y1: 0.74, off: 0.008, nu: 20, nv: 1 }), M.plastic, g);
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
    const hingeZ = side < 0 ? RD.z0 : RD.z1;
    const za = side < 0 ? RD.z0 : RD.split + 0.004;
    const zb = side < 0 ? RD.split - 0.004 : RD.z1;
    const pivot = new THREE.Group();
    pivot.position.set(0, 0, hingeZ);
    const g = new THREE.Group();
    g.position.set(0, 0, -hingeZ);
    pivot.add(g);
    const depth = 0.045;
    const outline = new THREE.Shape();
    const rT = 0.12;
    const [y0, y1] = [RD.y0 + 0.004, RD.y1 - 0.004];
    // скругляем только внешний верхний угол
    if (side < 0) {
      outline.moveTo(za, y0);
      outline.lineTo(zb, y0);
      outline.lineTo(zb, y1);
      outline.lineTo(za + rT, y1);
      outline.quadraticCurveTo(za, y1, za, y1 - rT);
    } else {
      outline.moveTo(za, y0);
      outline.lineTo(zb, y0);
      outline.lineTo(zb, y1 - rT);
      outline.quadraticCurveTo(zb, y1, zb - rT, y1);
      outline.lineTo(za, y1);
    }
    outline.closePath();
    const geo = new THREE.ExtrudeGeometry(outline, { depth, bevelEnabled: false, curveSegments: 8 });
    const panel = mesh(geo, M.paint, g);
    panel.rotation.y = -Math.PI / 2;
    panel.position.x = depth;
    // обшивка изнутри
    const trimShape = roundedRectShape(za + 0.05, y0 + 0.05, zb - 0.05, y1 - 0.06, 0.03);
    mesh(capGeo(trimShape, depth + 0.012), M.wood, g);
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
    box(0.55, 0.04, 1.5, 0.02, M.headliner, 2.8, 1.63, 0, roof);
    box(0.03, 0.08, 1.5, 0.01, M.headliner, 2.53, 1.66, 0, roof);
    // плафон
    box(0.12, 0.02, 0.2, 0.01, M.led, 3.05, 1.8, 0, roof);
  }

  // ---------------------------------------------------------------- спальный модуль
  const sleeper = new THREE.Group();
  interior.add(sleeper);
  {
    const bx0 = 0.08;
    const bx1 = 2.02;
    const L = bx1 - bx0;
    const cx = (bx0 + bx1) / 2;
    const top = 0.8;
    // каркас и столешница кровати
    box(L, 0.022, 1.46, 0.004, M.wood, cx, top, 0, sleeper);
    for (const z of [-0.72, 0.72]) box(L, 0.3, 0.018, 0.003, M.wood, cx, 0.65, z, sleeper);
    box(0.018, 0.3, 1.44, 0.003, M.wood, bx1, 0.65, 0, sleeper);
    // выдвижные ящики со стороны задних дверей
    const drawers = [];
    for (const [z, w] of [[-0.38, 0.62], [0.38, 0.62]]) {
      const d = new THREE.Group();
      d.position.set(bx0, 0, z);
      sleeper.add(d);
      box(0.02, 0.26, w, 0.004, M.wood, 0, 0.65, 0, d);
      box(0.55, 0.018, w - 0.04, 0.003, M.wood, 0.28, 0.53, 0, d);
      box(0.5, 0.2, 0.012, 0.002, M.wood, 0.28, 0.63, (w / 2 - 0.02), d);
      box(0.5, 0.2, 0.012, 0.002, M.wood, 0.28, 0.63, -(w / 2 - 0.02), d);
      box(0.025, 0.03, 0.16, 0.012, M.plastic, -0.02, 0.7, 0, d);
      // содержимое ящика
      box(0.22, 0.12, 0.2, 0.02, M.amber, 0.2, 0.6, 0.12, d).material = M.plasticMid;
      box(0.18, 0.1, 0.16, 0.03, M.blanket, 0.38, 0.59, -0.12, d);
      drawers.push(d);
    }
    // матрас
    box(L - 0.02, 0.12, 1.42, 0.05, M.mattress, cx, top + 0.07, 0, sleeper);
    // подушки у кабины
    for (const z of [-0.34, 0.34]) {
      const p = box(0.36, 0.1, 0.56, 0.05, M.pillow, bx1 - 0.25, top + 0.18, z, sleeper);
      p.rotation.z = -0.12;
    }
    // плед
    const bl = box(1.15, 0.035, 1.46, 0.015, M.blanket, bx0 + 0.62, top + 0.145, 0, sleeper);
    void bl;
    const fold = box(0.14, 0.05, 1.46, 0.022, M.blanket, bx0 + 1.2, top + 0.15, 0, sleeper);
    void fold;
    // светодиодные ленты и точечный свет
    for (const side of [-1, 1]) {
      const p = topPoint(1.2, side * 0.86, -0.045, new THREE.Vector3());
      box(2.1, 0.012, 0.025, 0.004, M.led, 1.2, p.y, p.z, roof);
    }
    // полка с книгами на левой стенке
    box(0.7, 0.015, 0.14, 0.004, M.wood, 0.8, 1.35, -0.74, sleeper);
    const books = [0x3b5f7a, 0x8c4a2f, 0xd4b26a, 0x4f6b4a, 0x6c4f7a];
    books.forEach((c, i) => {
      const m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 });
      box(0.03, 0.18 + (i % 2) * 0.03, 0.11, 0.004, m, 0.55 + i * 0.04, 1.45 + (i % 2) * 0.015, -0.74, sleeper);
    });
    // термос-кружка и фонарик на полке
    const mug = mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.12, 20), M.steel, sleeper);
    mug.position.set(0.95, 1.42, -0.74);
    // сетка-органайзер на правой стенке
    box(0.6, 0.35, 0.01, 0.005, M.plastic, 0.9, 1.25, 0.77, sleeper).material = new THREE.MeshStandardMaterial({
      color: 0x2c3036, roughness: 1, transparent: true, opacity: 0.75,
    });
    sleeper.userData.drawers = drawers;
  }

  // Светильники салона: без теней, чтобы внутри было видно и при закрытой машине.
  const cabinLight = new THREE.PointLight(0xffe2b8, 1.2, 3.2, 1.6);
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
