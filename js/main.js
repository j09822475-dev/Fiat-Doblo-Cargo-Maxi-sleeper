import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildCar, createMaterials, DIM } from './car.js';

// ---------------------------------------------------------------- сцена

const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
scene.environmentIntensity = 0.85;

const camera = new THREE.PerspectiveCamera(38, 1, 0.03, 80);

const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(4, 8, 5);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -4;
sun.shadow.camera.right = 4;
sun.shadow.camera.top = 4;
sun.shadow.camera.bottom = -4;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 20;
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
scene.add(sun);
scene.add(new THREE.HemisphereLight(0xdfe8f2, 0x6b625a, 0.5));

// Пол: только тень + мягкое контактное пятно, фон рисует CSS (подстраивается под тему).
const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.ShadowMaterial({ opacity: 0.28 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);
{
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(128, 128, 10, 128, 128, 128);
  grd.addColorStop(0, 'rgba(0,0,0,0.5)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 256, 256);
  const blob = new THREE.Mesh(
    new THREE.PlaneGeometry(5.6, 2.6),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false })
  );
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.002;
  scene.add(blob);
}

const M = createMaterials();
const model = buildCar(M);
const CX = DIM.L / 2;
model.car.position.x = -CX; // центр машины в начале координат
scene.add(model.car);

// перевод координат модели в мировые
const W = (x, y, z) => new THREE.Vector3(x - CX, y, z);

// ---------------------------------------------------------------- управление снаружи

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 1.1;
controls.maxDistance = 14;
controls.maxPolarAngle = Math.PI * 0.495;
controls.autoRotateSpeed = 0.8;
controls.target.set(0, 0.85, 0);
controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN };
camera.position.set(5.4, 2.3, 5.9);

// ---------------------------------------------------------------- осмотр изнутри (от первого лица)

const look = {
  enabled: false,
  yaw: 0,
  pitch: 0,
  pos: new THREE.Vector3(),
  fov: 70,
  bounds: { x: [0.3, 3.05], y: [0.95, 1.62], z: [-0.62, 0.62] },
};
const insideFov = () => (camera.aspect < 0.8 ? 88 : 70);
const lookDir = (yaw, pitch, out = new THREE.Vector3()) =>
  out.set(Math.cos(pitch) * Math.cos(yaw), Math.sin(pitch), Math.cos(pitch) * Math.sin(yaw));

function applyLook() {
  camera.position.copy(look.pos);
  camera.lookAt(look.pos.clone().add(lookDir(look.yaw, look.pitch)));
  if (Math.abs(camera.fov - look.fov) > 0.01) {
    camera.fov = look.fov;
    camera.updateProjectionMatrix();
  }
}

function clampLookPos() {
  const b = look.bounds;
  const local = look.pos.clone();
  local.x += CX;
  local.x = THREE.MathUtils.clamp(local.x, b.x[0], b.x[1]);
  local.y = THREE.MathUtils.clamp(local.y, b.y[0], b.y[1]);
  local.z = THREE.MathUtils.clamp(local.z, b.z[0], b.z[1]);
  look.pos.set(local.x - CX, local.y, local.z);
}

// ---------------------------------------------------------------- двери

const doors = model.doors;
const doorOrder = ['fl', 'fr', 'sr', 'hood', 'rl', 'rr'];
const DOOR_COUNT = doorOrder.length - 1; // без капота
for (const d of Object.values(doors)) {
  d.t = 0;
  d.target = 0;
}
let rearWide = { v: 0, target: 0 };

const smooth = (t) => t * t * (3 - 2 * t);

function setDoor(id, open) {
  const d = doors[id];
  d.target = open ? 1 : 0;
  syncUI();
}
const toggleDoor = (id) => setDoor(id, doors[id].target < 0.5);
const setAll = (open) => doorOrder.filter((id) => id !== 'hood').forEach((id) => setDoor(id, open));

// ---------------------------------------------------------------- виды

const VIEWS = {
  outside: { label: 'Снаружи', cam: W(8.1, 2.35, 5.9), target: W(CX - 0.1, 0.85, 0) },
  rear: { label: 'Сзади', cam: W(-3.4, 1.75, 1.2), target: W(1.3, 0.95, 0), open: ['rl', 'rr'] },
  side: { label: 'Сбоку', cam: W(2.0, 1.55, 4.2), target: W(1.75, 0.95, 0), open: ['sr', 'fr'] },
  top: { label: 'Сверху', cam: W(CX + 0.6, 6.4, 0.9), target: W(CX, 0.6, 0), roofOff: true },
  driver: { label: 'Водитель', inside: true, pos: W(2.74, 1.47, -0.42), yaw: 0.05, pitch: -0.13 },
  sleeper: { label: 'Грузовой отсек', inside: true, pos: W(2.36, 1.52, 0.05), yaw: Math.PI, pitch: -0.2 },
  bed: { label: 'С кровати', inside: true, pos: W(1.78, 1.16, 0.22), yaw: Math.PI + 0.12, pitch: -0.06, open: ['rl', 'rr'] },
};

let mode = 'outside';
let currentView = 'outside';
let tween = null;

function goView(name, instant = false) {
  const v = VIEWS[name];
  currentView = name;
  if (v.open) v.open.forEach((id) => setDoor(id, true));
  if (v.roofOff) setRoof(false);
  controls.autoRotate = false;
  const dur = instant ? 0 : 1.1;

  if (v.inside) {
    const fromPos = camera.position.clone();
    const fromDir = new THREE.Vector3();
    camera.getWorldDirection(fromDir);
    const fromYaw = Math.atan2(fromDir.z, fromDir.x);
    const fromPitch = Math.asin(THREE.MathUtils.clamp(fromDir.y, -1, 1));
    let dy = v.yaw - fromYaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    setMode('inside');
    tween = {
      t: 0, dur,
      step(k) {
        look.pos.lerpVectors(fromPos, v.pos, k);
        look.yaw = fromYaw + dy * k;
        look.pitch = fromPitch + (v.pitch - fromPitch) * k;
        look.fov = camera.fov + (insideFov() - camera.fov) * k;
        applyLook();
      },
    };
  } else {
    const fromPos = camera.position.clone();
    const fromTarget = mode === 'inside'
      ? camera.position.clone().add(lookDir(look.yaw, look.pitch).multiplyScalar(0.5))
      : controls.target.clone();
    const fromFov = camera.fov;
    setMode('outside');
    tween = {
      t: 0, dur,
      step(k) {
        camera.position.lerpVectors(fromPos, v.cam, k);
        controls.target.lerpVectors(fromTarget, v.target, k);
        camera.fov = fromFov + (38 - fromFov) * k;
        camera.updateProjectionMatrix();
      },
    };
  }
  if (instant) {
    tween.step(1);
    tween = null;
    if (mode === 'outside') controls.update();
  }
  syncUI();
}

function setMode(m) {
  mode = m;
  look.enabled = m === 'inside';
  controls.enabled = m === 'outside';
  document.body.dataset.mode = m;
  updateViewOffset();
}

// ---------------------------------------------------------------- опции

const state = { roof: true, xray: false, wide: false, spin: false, color: 'white' };

function setRoof(on) {
  state.roof = on;
  model.roof.visible = on;
  syncUI();
}
function setXray(on) {
  state.xray = on;
  M.paint.transparent = on;
  M.paint.opacity = on ? 0.16 : 1;
  M.paint.depthWrite = !on;
  M.paint.needsUpdate = true;
  syncUI();
}
function setWide(on) {
  state.wide = on;
  rearWide.target = on ? 1 : 0;
  if (on) ['rl', 'rr'].forEach((id) => setDoor(id, true));
  syncUI();
}
function setSpin(on) {
  state.spin = on;
  if (on && mode === 'inside') goView('outside');
  controls.autoRotate = on;
  syncUI();
}
const COLORS = {
  white: { hex: 0xf1f2ef, name: 'Белый' },
  silver: { hex: 0xb4b9bd, name: 'Серебристый' },
  graphite: { hex: 0x4b5057, name: 'Графит' },
  red: { hex: 0xa3161f, name: 'Красный' },
  blue: { hex: 0x24466e, name: 'Синий' },
  sage: { hex: 0x8e9c86, name: 'Шалфей' },
};
function setColor(key) {
  state.color = key;
  M.paint.color.setHex(COLORS[key].hex);
  syncUI();
}

// ---------------------------------------------------------------- интерфейс

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const panel = $('#panel');

{
  const grid = $('#door-grid');
  for (const id of doorOrder) {
    const d = doors[id];
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'door';
    b.id = `door-${id}`;
    b.dataset.door = id;
    b.innerHTML = `<span class="door-name">${d.name}</span><kbd>${d.key}</kbd><span class="door-state"></span>`;
    b.addEventListener('click', () => toggleDoor(id));
    grid.appendChild(b);
  }
  const views = $('#view-grid');
  for (const [key, v] of Object.entries(VIEWS)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'view' + (v.inside ? ' view-inside' : '');
    b.id = `view-${key}`;
    b.dataset.view = key;
    b.textContent = v.label;
    b.addEventListener('click', () => {
      goView(key);
      if (matchMedia('(max-width: 720px)').matches) setPanel(false);
    });
    views.appendChild(b);
  }
  const sw = $('#swatches');
  for (const [key, c] of Object.entries(COLORS)) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'swatch';
    b.id = `color-${key}`;
    b.dataset.color = key;
    b.title = c.name;
    b.setAttribute('aria-label', c.name);
    b.style.setProperty('--c', '#' + c.hex.toString(16).padStart(6, '0'));
    b.addEventListener('click', () => setColor(key));
    sw.appendChild(b);
  }
  $('#open-all').addEventListener('click', () => setAll(true));
  $('#close-all').addEventListener('click', () => setAll(false));
  $('#opt-roof').addEventListener('change', (e) => setRoof(!e.target.checked));
  $('#opt-xray').addEventListener('change', (e) => setXray(e.target.checked));
  $('#opt-wide').addEventListener('change', (e) => setWide(e.target.checked));
  $('#opt-spin').addEventListener('change', (e) => setSpin(e.target.checked));
  $('#panel-toggle').addEventListener('click', () => setPanel(panel.classList.contains('collapsed')));
  $('#exit-inside').addEventListener('click', () => goView('outside'));
  $('#go-inside').addEventListener('click', () => goView(mode === 'inside' ? 'outside' : 'driver'));
  $('#quick-doors').addEventListener('click', () => {
    const anyClosed = doorOrder.some((id) => id !== 'hood' && doors[id].target < 0.5);
    setAll(anyClosed);
  });
}

function setPanel(open) {
  panel.classList.toggle('collapsed', !open);
  $('#panel-toggle').setAttribute('aria-expanded', String(open));
  updateViewOffset();
}
if (matchMedia('(max-width: 720px)').matches) setPanel(false);

function syncUI() {
  for (const id of doorOrder) {
    const b = document.getElementById(`door-${id}`);
    if (!b) continue;
    const open = doors[id].target > 0.5;
    b.setAttribute('aria-pressed', String(open));
    b.querySelector('.door-state').textContent = open ? 'открыта' : 'закрыта';
  }
  $$('.view').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === currentView)));
  $$('.swatch').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.color === state.color)));
  $('#opt-roof').checked = !state.roof;
  $('#opt-xray').checked = state.xray;
  $('#opt-wide').checked = state.wide;
  $('#opt-spin').checked = state.spin;
  const openCount = doorOrder.filter((id) => id !== 'hood' && doors[id].target > 0.5).length;
  $('#quick-doors').textContent = openCount === DOOR_COUNT ? 'Закрыть двери' : 'Открыть двери';
  $('#door-count').textContent = `${openCount} из ${DOOR_COUNT} открыто`;
  $('#go-inside').textContent = mode === 'inside' ? 'Наружу' : 'Внутрь';
}

// ---------------------------------------------------------------- указатель: клик по двери, осмотр, щипок

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const tip = $('#tip');

function pickDoor(clientX, clientY) {
  const r = canvas.getBoundingClientRect();
  ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObject(model.car, true);
  for (const h of hits) {
    if (!h.object.visible || (h.object.material === M.paint && state.xray)) continue;
    if (!isVisible(h.object)) continue;
    return h.object.userData.doorId || null;
  }
  return null;
}
function isVisible(o) {
  for (let p = o; p; p = p.parent) if (!p.visible) return false;
  return true;
}

const pointers = new Map();
let down = null;
let pinchStart = null;

canvas.addEventListener('pointerdown', (e) => {
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  down = pointers.size === 1 ? { x: e.clientX, y: e.clientY, t: performance.now(), moved: false } : null;
  if (mode === 'inside') {
    canvas.setPointerCapture(e.pointerId);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchStart = { d: Math.hypot(a.x - b.x, a.y - b.y), fov: look.fov };
    }
  }
  tween = null;
  if (state.spin) setSpin(false);
});

canvas.addEventListener('pointermove', (e) => {
  const prev = pointers.get(e.pointerId);
  if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) down.moved = true;
  if (prev) {
    if (mode === 'inside') {
      if (pointers.size === 1) {
        const k = (camera.fov / 70) * 0.0045;
        look.yaw -= (e.clientX - prev.x) * k;
        look.pitch = THREE.MathUtils.clamp(look.pitch + (e.clientY - prev.y) * k, -1.35, 1.35);
      } else if (pointers.size === 2 && pinchStart) {
        pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        look.fov = THREE.MathUtils.clamp((pinchStart.fov * pinchStart.d) / Math.max(d, 1), 28, 90);
      }
    }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  }
  if (e.pointerType === 'mouse' && pointers.size === 0) hover(e);
});

function endPointer(e) {
  const wasTap = down && !down.moved && pointers.size === 1 && performance.now() - down.t < 500;
  pointers.delete(e.pointerId);
  if (pointers.size < 2) pinchStart = null;
  if (wasTap && e.type === 'pointerup') {
    const id = pickDoor(e.clientX, e.clientY);
    if (id) {
      toggleDoor(id);
      if (e.pointerType === 'mouse') hover(e);
    }
  }
  if (pointers.size === 0) down = null;
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('pointerleave', () => (tip.hidden = true));

let hoverRaf = 0;
function hover(e) {
  if (hoverRaf) return;
  hoverRaf = requestAnimationFrame(() => {
    hoverRaf = 0;
    const id = pickDoor(e.clientX, e.clientY);
    canvas.style.cursor = id ? 'pointer' : mode === 'inside' ? 'grab' : 'default';
    if (id) {
      const d = doors[id];
      tip.textContent = `${d.target > 0.5 ? 'Закрыть' : 'Открыть'}: ${d.name.toLowerCase()} · ${d.key}`;
      tip.style.transform = `translate(${e.clientX + 14}px, ${e.clientY + 16}px)`;
      tip.hidden = false;
    } else tip.hidden = true;
  });
}

canvas.addEventListener(
  'wheel',
  (e) => {
    if (mode !== 'inside') return;
    e.preventDefault();
    look.fov = THREE.MathUtils.clamp(look.fov * Math.exp(e.deltaY * 0.0012), 28, 90);
  },
  { passive: false }
);
canvas.addEventListener('dblclick', (e) => {
  // двойной клик снаружи — приблизиться к точке
  if (mode !== 'outside') return;
  const r = canvas.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  const hit = raycaster.intersectObject(model.car, true).find((h) => isVisible(h.object));
  if (!hit) return;
  const fromT = controls.target.clone();
  const fromP = camera.position.clone();
  const toT = hit.point.clone();
  const toP = toT.clone().add(fromP.clone().sub(fromT).setLength(Math.max(1.6, controls.minDistance + 0.4)));
  tween = {
    t: 0, dur: 0.8,
    step(k) {
      controls.target.lerpVectors(fromT, toT, k);
      camera.position.lerpVectors(fromP, toP, k);
    },
  };
});

// ---------------------------------------------------------------- клавиатура

const held = new Set();
window.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const t = e.target;
  const onControl = t instanceof HTMLElement && t.closest('button, input, label');
  if (onControl && (e.key === ' ' || e.key === 'Enter')) return;
  const k = e.key.toLowerCase();
  const door = doorOrder.find((id) => doors[id].key === e.key);
  if (door) return toggleDoor(door);
  const code = e.code;
  switch (code) {
    case 'KeyO': return setAll(true);
    case 'KeyC': return setAll(false);
    case 'KeyI': return goView(mode === 'inside' ? 'outside' : 'driver');
    case 'KeyT': return setRoof(!state.roof);
    case 'KeyX': return setXray(!state.xray);
    case 'KeyZ': return setWide(!state.wide);
    case 'KeyR': return goView('outside');
    case 'KeyV': {
      const keys = Object.keys(VIEWS);
      return goView(keys[(keys.indexOf(currentView) + 1) % keys.length]);
    }
    case 'Space':
      e.preventDefault();
      return setSpin(!state.spin);
    case 'Escape':
      if (mode === 'inside') return goView('outside');
      return setPanel(panel.classList.contains('collapsed'));
  }
  if (['arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'w', 'a', 's', 'd', 'q', 'e', '+', '=', '-', '_'].includes(k) ||
      ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE'].includes(code)) {
    e.preventDefault();
    held.add(code.startsWith('Key') ? code : k);
    tween = null;
  }
});
window.addEventListener('keyup', (e) => {
  held.delete(e.code);
  held.delete(e.key.toLowerCase());
});
window.addEventListener('blur', () => held.clear());

const spherical = new THREE.Spherical();
function keyboardStep(dt) {
  if (!held.size) return;
  const h = (k) => held.has(k);
  if (mode === 'inside') {
    const rs = 1.6 * dt;
    if (h('arrowleft')) look.yaw -= rs;
    if (h('arrowright')) look.yaw += rs;
    if (h('arrowup')) look.pitch = Math.min(1.35, look.pitch + rs);
    if (h('arrowdown')) look.pitch = Math.max(-1.35, look.pitch - rs);
    const ms = 1.1 * dt;
    const fwd = new THREE.Vector3(Math.cos(look.yaw), 0, Math.sin(look.yaw));
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    if (h('KeyW')) look.pos.addScaledVector(fwd, ms);
    if (h('KeyS')) look.pos.addScaledVector(fwd, -ms);
    if (h('KeyA')) look.pos.addScaledVector(right, -ms);
    if (h('KeyD')) look.pos.addScaledVector(right, ms);
    if (h('KeyE')) look.pos.y += ms;
    if (h('KeyQ')) look.pos.y -= ms;
    if (h('+') || h('=')) look.fov = Math.max(28, look.fov - 40 * dt);
    if (h('-') || h('_')) look.fov = Math.min(90, look.fov + 40 * dt);
    clampLookPos();
  } else {
    const off = camera.position.clone().sub(controls.target);
    spherical.setFromVector3(off);
    const rs = 1.4 * dt;
    if (h('arrowleft') || h('KeyA')) spherical.theta -= rs;
    if (h('arrowright') || h('KeyD')) spherical.theta += rs;
    if (h('arrowup') || h('KeyW')) spherical.phi = Math.max(0.15, spherical.phi - rs);
    if (h('arrowdown') || h('KeyS')) spherical.phi = Math.min(controls.maxPolarAngle, spherical.phi + rs);
    if (h('+') || h('=') || h('KeyE')) spherical.radius = Math.max(controls.minDistance, spherical.radius * (1 - 1.4 * dt));
    if (h('-') || h('_') || h('KeyQ')) spherical.radius = Math.min(controls.maxDistance, spherical.radius * (1 + 1.4 * dt));
    camera.position.copy(controls.target).add(off.setFromSpherical(spherical));
  }
}

// ---------------------------------------------------------------- цикл

function resize() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  // на узком экране отъезжаем дальше, чтобы машина целиком помещалась
  fitOutsideView();
  updateViewOffset();
}

// Подбираем расстояние так, чтобы машина целиком помещалась в свободной части экрана.
// На узком экране смотрим ближе к фронтальному ракурсу — так проекция машины уже.
function fitOutsideView() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const pw = w > 720 ? panel.getBoundingClientRect().width + 32 : 0;
  const ph = w > 720 ? 0 : 120;
  const aspect = (w - pw) / Math.max(1, h - ph);
  const az = aspect < 1 ? 0.5 : 0.78;                 // азимут от продольной оси
  const el = aspect < 1 ? 0.2 : 0.17;                 // возвышение камеры
  const projW = DIM.L * Math.sin(az) + DIM.W * Math.cos(az);
  const vf = THREE.MathUtils.degToRad(38) / 2;
  const hf = Math.atan(Math.tan(vf) * aspect);
  const dist = Math.max((projW / 2) * (aspect < 1 ? 1.4 : 1.15) / Math.tan(hf), 1.35 / Math.tan(vf)) + 1.2;
  const t = VIEWS.outside.target;
  VIEWS.outside.cam = new THREE.Vector3(
    t.x + dist * Math.cos(el) * Math.cos(az),
    t.y + dist * Math.sin(el),
    t.z + dist * Math.cos(el) * Math.sin(az)
  );
  VIEWS.top.cam = W(CX + 0.4, 5 + dist * 0.35, 0.6);
}

// Центр кадра смещаем в свободную от панели область: машина не прячется под интерфейсом.
function updateViewOffset() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  const r = panel.getBoundingClientRect();
  let dx = 0;
  let dy = 0;
  if (mode === 'outside') {
    if (w > 720) dx = (r.width + 16) / 2;
    else dy = Math.max(0, r.height / 2 - 40);
  }
  camera.setViewOffset(w, h, dx, dy, w, h);
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

const clock = new THREE.Clock();
function frame() {
  const dt = Math.min(clock.getDelta(), 0.05);
  for (const d of Object.values(doors)) {
    if (d.t !== d.target) {
      const sp = dt / (d.linear ? 1.1 : 0.85);
      d.t = d.target > d.t ? Math.min(d.target, d.t + sp) : Math.max(d.target, d.t - sp);
    }
  }
  if (rearWide.v !== rearWide.target) {
    rearWide.v += Math.sign(rearWide.target - rearWide.v) * Math.min(Math.abs(rearWide.target - rearWide.v), dt / 0.9);
  }
  for (const d of Object.values(doors)) d.apply(d.linear ? d.t : smooth(d.t), smooth(rearWide.v));

  if (tween) {
    tween.t += tween.dur ? dt / tween.dur : 1;
    const k = smooth(Math.min(1, tween.t));
    tween.step(k);
    if (tween.t >= 1) tween = null;
  }
  keyboardStep(dt);
  if (mode === 'inside') applyLook();
  else controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

goView('outside', true);
syncUI();
requestAnimationFrame(frame);
document.body.classList.add('ready');

// Доступ из консоли и для автоматических снимков.
// Мгновенно довести анимации дверей до конечного положения (для снимков и тестов).
function snap() {
  for (const d of Object.values(doors)) d.t = d.target;
  rearWide.v = rearWide.target;
}
window.doblo = { snap, goView, setDoor, toggleDoor, setAll, setRoof, setXray, setWide, setSpin, setColor, setPanel, doors, camera, controls, look };
