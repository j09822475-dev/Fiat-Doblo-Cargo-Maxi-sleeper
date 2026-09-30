// 3D-вьюер: детали в координатах кузова, слои, прозрачность, разнесённый вид,
// сечения с заливкой среза, подсветка замечаний, карта зазоров, измерения.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { GapProfile, Issue, PartDef, Project, Vec3 } from '../core/types';
import { previewMatrix } from '../core/kinematics';
import type { PartMesh } from '../geometry/mesh';
import { materialTitle } from '../checks/norms';

export type ColorMode = 'layer' | 'material' | 'thickness' | 'status';

interface PartView {
  def: PartDef;
  mesh: THREE.Mesh;
  mat: THREE.MeshStandardMaterial;
  center: THREE.Vector3;
}

/** Перевод координат кузова (X назад, Y вправо, Z вверх) в сцену three.js (Y вверх). */
const VEHICLE_TO_SCENE = new THREE.Matrix4().set(-1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 1);

const MATERIAL_COLORS: Record<string, string> = {
  DC04: '#dfe3e8', DX54D: '#e9ecef', DC03: '#b8c0c9', HX340LAD: '#8f9bab', DP600: '#6f7f94',
  'PP-EPDM': '#3b4048', PC: '#f2c14e', GLASS: '#7fb3d5', RUBBER: '#2d3436', ENVELOPE: '#a47551',
};

export class Viewer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  private root = new THREE.Group();
  private parts = new Map<string, PartView>();
  private project!: Project;
  private explode = 0;
  private motion = new Map<string, number>();
  private wide = false;
  private colorMode: ColorMode = 'layer';
  private status = new Map<string, 'error' | 'warning' | 'ok'>();
  private selected: string | null = null;
  private highlighted = new Set<string>();
  private hidden = new Set<string>();
  private ghost = new Set<string>();
  private isolated: Set<string> | null = null;
  private clip = new THREE.Plane(new THREE.Vector3(1, 0, 0), 0);
  private clipAxis: 'x' | 'y' | 'z' | null = null;
  private marker = new THREE.Group();
  private heat = new THREE.Group();
  private measure = new THREE.Group();
  private raycaster = new THREE.Raycaster();
  private anim: { from: THREE.Vector3; to: THREE.Vector3; tFrom: THREE.Vector3; tTo: THREE.Vector3; t: number } | null = null;
  onHover: (p: Vec3 | null, part: string | null) => void = () => {};
  onPick: (part: string | null, p: Vec3 | null, additive: boolean) => void = () => {};

  constructor(private canvas: HTMLCanvasElement) {
    // логарифмическая глубина: сцена в миллиметрах от 20 мм до 60 м, а детали лежат в 1–2 мм друг от друга —
    // с обычным (особенно 16-битным на мобильных) буфером глубины внутренние детали просвечивают сквозь обшивку
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true, logarithmicDepthBuffer: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.localClippingEnabled = true;
    this.camera = new THREE.PerspectiveCamera(35, 1, 20, 60000);
    this.camera.position.set(5200, 3000, 6000);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.target.set(-1400, 800, 0);
    this.root.matrixAutoUpdate = false;
    this.root.matrix.copy(VEHICLE_TO_SCENE);
    this.scene.add(this.root);
    this.root.add(this.marker, this.heat, this.measure);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x6b7280, 1.4));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(3000, 6000, 4000);
    this.scene.add(sun);
    const back = new THREE.DirectionalLight(0xffffff, 0.6);
    back.position.set(-4000, 2000, -3000);
    this.scene.add(back);
    // сетка пола 500 мм
    const grid = new THREE.GridHelper(12000, 24, 0x94a3b8, 0xcbd5e1);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.35;
    grid.position.set(-1400, 0, 0);
    this.scene.add(grid);
    this.bindPointer();
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
    const loop = () => {
      this.tick();
      requestAnimationFrame(loop);
    };
    loop();
  }

  private resize() {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (!w || !h) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private tick() {
    if (this.anim) {
      this.anim.t = Math.min(1, this.anim.t + 0.06);
      const k = this.anim.t * this.anim.t * (3 - 2 * this.anim.t);
      this.camera.position.lerpVectors(this.anim.from, this.anim.to, k);
      this.controls.target.lerpVectors(this.anim.tFrom, this.anim.tTo, k);
      if (this.anim.t >= 1) this.anim = null;
    }
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  /** Загружает все детали проекта. */
  setProject(project: Project, meshes: Map<string, PartMesh>) {
    this.project = project;
    for (const v of this.parts.values()) {
      this.root.remove(v.mesh);
      v.mesh.geometry.dispose();
      v.mat.dispose();
    }
    this.parts.clear();
    for (const def of project.parts) this.addPart(def, meshes.get(def.id)!);
    this.refresh();
  }

  /** Заменяет геометрию одной детали (после изменения параметров). */
  updatePart(def: PartDef, mesh: PartMesh) {
    const v = this.parts.get(def.id);
    if (v) {
      this.root.remove(v.mesh);
      v.mesh.geometry.dispose();
      v.mat.dispose();
    }
    this.addPart(def, mesh);
    this.refresh();
  }

  private addPart(def: PartDef, pm: PartMesh) {
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.1, side: THREE.DoubleSide, clippingPlanes: [] });
    // заливка среза: у замкнутых сеток в сечении видны обратные грани — красим их в цвет среза
    // только в режиме сечения (иначе обратные грани видны сквозь зазоры)
    mat.userData.cap = false;
    mat.onBeforeCompile = (sh) => {
      if (!mat.userData.cap) return;
      sh.fragmentShader = sh.fragmentShader.replace(
        '#include <dithering_fragment>',
        '#include <dithering_fragment>\n if (!gl_FrontFacing) gl_FragColor = vec4(0.86, 0.18, 0.24, 1.0);',
      );
    };
    mat.customProgramCacheKey = () => (mat.userData.cap ? 'cap' : 'plain');
    const mesh = new THREE.Mesh(pm.geometry, mat);
    mesh.matrixAutoUpdate = false;
    mesh.userData.part = def.id;
    this.root.add(mesh);
    const center = pm.geometry.boundingBox!.getCenter(new THREE.Vector3());
    this.parts.set(def.id, { def, mesh, mat, center });
  }

  // ------------------------------------------------------------ состояние отображения
  setColorMode(m: ColorMode) {
    this.colorMode = m;
    this.refresh();
  }

  setStatus(issues: Issue[] | null) {
    this.status.clear();
    if (issues) {
      for (const id of this.parts.keys()) this.status.set(id, 'ok');
      for (const i of issues) {
        for (const p of i.parts) {
          const cur = this.status.get(p);
          if (i.severity === 'error') this.status.set(p, 'error');
          else if (i.severity === 'warning' && cur !== 'error') this.status.set(p, 'warning');
        }
      }
    }
    this.refresh();
  }

  setVisibility(hidden: Set<string>, ghost: Set<string>, isolated: Set<string> | null) {
    this.hidden = hidden;
    this.ghost = ghost;
    this.isolated = isolated;
    this.refresh();
  }

  setSelection(id: string | null) {
    this.selected = id;
    this.refresh();
  }

  setHighlight(ids: string[]) {
    this.highlighted = new Set(ids);
    this.refresh();
  }

  setExplode(k: number) {
    this.explode = k;
    this.refresh();
  }

  setMotion(id: string, t: number) {
    this.motion.set(id, t);
    this.refresh();
  }

  setWide(w: boolean) {
    this.wide = w;
    this.refresh();
  }

  motionOf(id: string) {
    return this.motion.get(id) ?? 0;
  }

  /** Сечение: ось и положение в координатах кузова, мм. */
  setSection(axis: 'x' | 'y' | 'z' | null, pos = 0, flip = false) {
    this.clipAxis = axis;
    if (axis) {
      const n = new THREE.Vector3(axis === 'x' ? 1 : 0, axis === 'y' ? 1 : 0, axis === 'z' ? 1 : 0).applyMatrix4(VEHICLE_TO_SCENE);
      if (flip) n.negate();
      this.clip.set(n, 0);
      const p = new THREE.Vector3(axis === 'x' ? pos : 0, axis === 'y' ? pos : 0, axis === 'z' ? pos : 0).applyMatrix4(VEHICLE_TO_SCENE);
      this.clip.constant = -this.clip.normal.dot(p);
    }
    this.refresh();
  }

  private color(v: PartView): string {
    const d = v.def;
    switch (this.colorMode) {
      case 'material':
        return MATERIAL_COLORS[d.material] ?? '#999999';
      case 'thickness': {
        if (!d.thickness) return '#9ca3af';
        const t = Math.min(1, Math.max(0, (d.thickness - 0.6) / 1.6));
        return new THREE.Color().setHSL(0.6 - 0.6 * t, 0.65, 0.5).getStyle();
      }
      case 'status': {
        const s = this.status.get(d.id);
        return s === 'error' ? '#dc2626' : s === 'warning' ? '#d97706' : s === 'ok' ? '#16a34a' : '#9ca3af';
      }
      default:
        return this.project.layers.find((l) => l.id === d.layer)?.color ?? '#999999';
    }
  }

  private refresh() {
    if (!this.project) return;
    const center = new THREE.Vector3(this.project.vehicle.wheelbase / 2, 0, 900);
    for (const v of this.parts.values()) {
      const id = v.def.id;
      const vis = !this.hidden.has(id) && (!this.isolated || this.isolated.has(id));
      v.mesh.visible = vis;
      v.mat.color.set(this.color(v));
      const glass = v.def.material === 'GLASS';
      const ghost = this.ghost.has(id) || (this.highlighted.size > 0 && !this.highlighted.has(id));
      v.mat.transparent = ghost || glass;
      v.mat.opacity = ghost ? 0.12 : glass ? 0.45 : 1;
      v.mat.depthWrite = !(ghost || glass);
      const sel = id === this.selected || this.highlighted.has(id);
      v.mat.emissive.set(sel ? (this.highlighted.has(id) ? '#b91c1c' : '#2563eb') : '#000000');
      v.mat.emissiveIntensity = sel ? 0.35 : 0;
      v.mat.clippingPlanes = this.clipAxis ? [this.clip] : [];
      v.mat.userData.cap = !!this.clipAxis;
      v.mat.needsUpdate = true;
      // положение: движение (своё или детали, на которой закреплена) + разнесение
      const j = v.def.joint;
      const moverId = j.type === 'mounted' ? j.to : id;
      const mover = this.project.parts.find((p) => p.id === moverId);
      const m = mover ? previewMatrix(mover, this.motion.get(moverId) ?? 0, this.wide) : new THREE.Matrix4();
      const expl = v.center.clone().sub(center).multiplyScalar(this.explode * 0.9);
      v.mesh.matrix.makeTranslation(expl.x, expl.y, expl.z).multiply(m);
    }
    this.syncHeat();
  }

  // ------------------------------------------------------------ камера
  private worldOf(p: Vec3) {
    return new THREE.Vector3(...p).applyMatrix4(VEHICLE_TO_SCENE);
  }

  view(name: 'iso' | 'front' | 'side' | 'top' | 'rear' | 'left') {
    const t = this.worldOf([this.project.vehicle.wheelbase / 2, 0, 900]);
    // на узком экране отъезжаем дальше, чтобы машина целиком помещалась по ширине
    const d = 9000 * Math.max(1, 0.95 / this.camera.aspect);
    const dirs: Record<string, [number, number, number]> = {
      iso: [0.55, 0.35, 0.75], front: [1, 0.08, 0], rear: [-1, 0.08, 0], side: [0, 0.08, 1], left: [0, 0.08, -1], top: [0.001, 1, 0],
    };
    const dv = new THREE.Vector3(...dirs[name]).normalize().multiplyScalar(d);
    this.flyTo(t.clone().add(dv), t);
  }

  /**
   * Ортогональный снимок в масштабе mmPerPx с центром кадра в точке c (система кузова).
   * Нужен для наложения на чертежи: пиксель кадра однозначно переводится в миллиметры.
   */
  orthoSnapshot(name: 'left' | 'right' | 'top' | 'front' | 'rear', c: Vec3, w: number, h: number, mmPerPx: number) {
    const dirs = {
      left: [[0, 0, -1], [0, 1, 0]], right: [[0, 0, 1], [0, 1, 0]], top: [[0, 1, 0], [0, 0, -1]],
      front: [[1, 0, 0], [0, 1, 0]], rear: [[-1, 0, 0], [0, 1, 0]],
    } as const;
    const [dir, up] = dirs[name];
    const cam = new THREE.OrthographicCamera(-w / 2, w / 2, h / 2, -h / 2, 10, 60000);
    const t = this.worldOf(c);
    cam.position.copy(t).add(new THREE.Vector3(dir[0], dir[1], dir[2]).multiplyScalar(20000));
    cam.up.set(up[0], up[1], up[2]);
    cam.lookAt(t);
    cam.updateProjectionMatrix();
    const hidden: THREE.Object3D[] = [];
    this.scene.traverse((o) => {
      const helper = o instanceof THREE.Line || o instanceof THREE.Points || (o instanceof THREE.Mesh && o.material instanceof THREE.MeshBasicMaterial);
      if (helper && o.visible) {
        o.visible = false;
        hidden.push(o);
      }
    });
    const size = this.renderer.getSize(new THREE.Vector2());
    const ratio = this.renderer.getPixelRatio();
    const bg = this.scene.background;
    this.scene.background = null;
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(Math.round(w / mmPerPx), Math.round(h / mmPerPx), false);
    this.renderer.render(this.scene, cam);
    const url = this.renderer.domElement.toDataURL('image/png');
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(size.x, size.y, false);
    this.scene.background = bg;
    for (const o of hidden) o.visible = true;
    return url;
  }

  flyTo(pos: THREE.Vector3, target: THREE.Vector3) {
    this.anim = { from: this.camera.position.clone(), to: pos, tFrom: this.controls.target.clone(), tTo: target, t: 0 };
  }

  /** Показать точку замечания: камера подлетает, ставится маркер. */
  focusPoint(p: Vec3, dist = 2600) {
    const w = this.worldOf(p);
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    this.flyTo(w.clone().add(dir.multiplyScalar(dist)), w);
    this.marker.clear();
    const s = new THREE.Mesh(new THREE.SphereGeometry(14, 20, 12), new THREE.MeshBasicMaterial({ color: 0xdc2626, depthTest: false, transparent: true }));
    s.position.set(...p);
    s.renderOrder = 10;
    const ring = new THREE.Mesh(new THREE.RingGeometry(26, 32, 32), new THREE.MeshBasicMaterial({ color: 0xdc2626, depthTest: false, transparent: true, side: THREE.DoubleSide }));
    ring.position.set(...p);
    ring.lookAt(new THREE.Vector3(...p).add(new THREE.Vector3(0, 1, 0)));
    ring.renderOrder = 10;
    this.marker.add(s, ring);
  }

  clearMarker() {
    this.marker.clear();
  }

  focusPart(id: string) {
    const v = this.parts.get(id);
    if (!v) return;
    const box = new THREE.Box3().setFromObject(v.mesh);
    const c = box.getCenter(new THREE.Vector3());
    const r = Math.max(400, box.getSize(new THREE.Vector3()).length() * 0.9);
    const dir = this.camera.position.clone().sub(this.controls.target).normalize();
    this.flyTo(c.clone().add(dir.multiplyScalar(r * 1.6)), c);
  }

  // ------------------------------------------------------------ карта зазоров и измерения
  showHeatmap(profiles: GapProfile[] | null, limits: (rule: string) => { min: number; max: number }) {
    this.heat.clear();
    this.heatProfiles = null;
    if (!profiles) return;
    const pos: number[] = [];
    const col: number[] = [];
    const c = new THREE.Color();
    for (const pr of profiles) {
      const { min, max } = limits(pr.rule);
      for (const s of pr.samples) {
        pos.push(...s.p);
        const bad = s.gap < min || s.gap > max;
        const near = s.gap < min + 0.3 || s.gap > max - 0.3;
        c.set(bad ? '#dc2626' : near ? '#f59e0b' : '#16a34a');
        col.push(c.r, c.g, c.b);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    const pts = new THREE.Points(g, new THREE.PointsMaterial({ size: 9, vertexColors: true, depthTest: false, sizeAttenuation: false, transparent: true }));
    pts.renderOrder = 5;
    this.heat.add(pts);
    this.heatProfiles = profiles;
    this.heatLimits = limits;
    this.syncHeat();
  }

  /** Точки карты зазоров следуют за деталью A стыка (разнесение, открывание). */
  private heatProfiles: GapProfile[] | null = null;
  private heatLimits: (rule: string) => { min: number; max: number } = () => ({ min: 0, max: Infinity });
  private syncHeat() {
    if (!this.heatProfiles) return;
    this.heat.clear();
    const c = new THREE.Color();
    for (const pr of this.heatProfiles) {
      const { min, max } = this.heatLimits(pr.rule);
      const pos: number[] = [];
      const col: number[] = [];
      for (const s of pr.samples) {
        pos.push(...s.p);
        const bad = s.gap < min || s.gap > max;
        const near = s.gap < min + 0.3 || s.gap > max - 0.3;
        c.set(bad ? '#dc2626' : near ? '#f59e0b' : '#16a34a');
        col.push(c.r, c.g, c.b);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      const pts = new THREE.Points(g, new THREE.PointsMaterial({ size: 8, vertexColors: true, depthTest: false, sizeAttenuation: false, transparent: true }));
      pts.renderOrder = 5;
      pts.matrixAutoUpdate = false;
      const v = this.parts.get(pr.a);
      if (v) {
        pts.matrix.copy(v.mesh.matrix);
        pts.visible = v.mesh.visible;
      }
      this.heat.add(pts);
    }
  }

  showMeasure(a: Vec3 | null, b: Vec3 | null) {
    this.measure.clear();
    const dot = (p: Vec3) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(8, 12, 8), new THREE.MeshBasicMaterial({ color: 0x2563eb, depthTest: false }));
      m.position.set(...p);
      m.renderOrder = 11;
      this.measure.add(m);
    };
    if (a) dot(a);
    if (b) dot(b);
    if (a && b) {
      const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...a), new THREE.Vector3(...b)]);
      const l = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0x2563eb, depthTest: false }));
      l.renderOrder = 11;
      this.measure.add(l);
    }
  }

  // ------------------------------------------------------------ указатель
  private pick(ev: PointerEvent): { id: string; p: Vec3 } | null {
    const r = this.canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const meshes = [...this.parts.values()].filter((v) => v.mesh.visible && !(v.mat.transparent && v.mat.opacity < 0.2)).map((v) => v.mesh);
    const hits = this.raycaster.intersectObjects(meshes, false);
    for (const h of hits) {
      if (this.clipAxis && this.clip.distanceToPoint(h.point) < 0) continue;
      const inv = new THREE.Matrix4().copy(VEHICLE_TO_SCENE).invert();
      const p = h.point.clone().applyMatrix4(inv);
      return { id: h.object.userData.part, p: [Math.round(p.x), Math.round(p.y), Math.round(p.z)] };
    }
    return null;
  }

  private bindPointer() {
    let down: { x: number; y: number } | null = null;
    let hoverRaf = 0;
    this.canvas.addEventListener('pointerdown', (e) => (down = { x: e.clientX, y: e.clientY }));
    this.canvas.addEventListener('pointerup', (e) => {
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 5) {
        const hit = this.pick(e);
        this.onPick(hit?.id ?? null, hit?.p ?? null, e.shiftKey);
      }
      down = null;
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse' || hoverRaf) return;
      hoverRaf = requestAnimationFrame(() => {
        hoverRaf = 0;
        const hit = this.pick(e);
        this.onHover(hit?.p ?? null, hit?.id ?? null);
      });
    });
  }

  partInfo(id: string) {
    const v = this.parts.get(id);
    if (!v) return null;
    const box = v.mesh.geometry.boundingBox!;
    return { box, material: materialTitle(v.def.material) };
  }

  snapshot() {
    return this.canvas.toDataURL('image/png');
  }
}
