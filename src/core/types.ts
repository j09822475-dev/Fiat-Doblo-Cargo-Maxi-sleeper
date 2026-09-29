// Модель данных проекта. Все размеры — в миллиметрах, система координат кузова:
// X — назад от передней оси, Y — вправо, Z — вверх от дороги.

export type Vec3 = [number, number, number];

export type LayerId =
  | 'biw' | 'outer' | 'closures' | 'glazing' | 'lighting'
  | 'trim' | 'chassis' | 'powertrain' | 'interior' | 'seals';

export interface LayerDef {
  id: LayerId;
  title: string;
  color: string;
}

export interface Assembly {
  id: string;
  title: string;
  parent: string | null;
}

/** Движение детали. Для шарнира угол задаётся в градусах. */
export type Joint =
  | { type: 'fixed' }
  | { type: 'mounted'; to: string }
  | { type: 'hinge'; origin: Vec3; axis: Vec3; min: number; max: number; open: number }
  | { type: 'slide'; out: Vec3; travel: Vec3; outShare: number }
  | { type: 'wheel'; center: Vec3; steer: number; bump: number; rebound: number };

export type PartStatus = 'draft' | 'checked' | 'approved';

export interface PartDef {
  id: string;
  title: string;
  layer: LayerId;
  assembly: string;
  generator: string;
  params: Record<string, number>;
  material: string;
  /** Толщина листа, мм. У габаритных объёмов — 0. */
  thickness: number;
  joint: Joint;
  status: PartStatus;
  /** Роль для нормативных проверок: headlamp, tailLamp и т. п. */
  role?: string;
  note?: string;
}

/** Правило проверки пары деталей или групп. */
export type Rule =
  | { id: string; kind: 'gap'; a: string; b: string; norm: string }
  | { id: string; kind: 'clearance'; a: string; b: string; norm: string; motion?: boolean }
  | { id: string; kind: 'motion'; part: string; norm: string };

export interface NormOverride {
  normId: string;
  values: Record<string, number>;
  reason: string;
}

export interface VehicleParams {
  length: number;
  width: number;
  height: number;
  wheelbase: number;
  frontOverhang: number;
  trackFront: number;
  trackRear: number;
  tireRadius: number;
  tireWidth: number;
  archRadius: number;
  bodyBottom: number;
}

export interface Project {
  format: 'doblo-body/1';
  title: string;
  vehicle: VehicleParams;
  /** Базовые точки кузова (см. Hardpoints в geometry/bodyform.ts), мм. */
  hardpoints: Record<string, number>;
  layers: LayerDef[];
  assemblies: Assembly[];
  parts: PartDef[];
  /** Пары деталей, соединённых конструктивно (сварка, клей, крепёж): коллизии между ними не ищутся. */
  joined: [string, string][];
  rules: Rule[];
  overrides: NormOverride[];
}

export type Severity = 'error' | 'warning' | 'info';

export interface Issue {
  id: string;
  severity: Severity;
  kind: 'collision' | 'clearance' | 'gap-small' | 'gap-large' | 'gap-spread' | 'flush' | 'no-seam' | 'regulation';
  title: string;
  parts: string[];
  /** Точка в координатах кузова, мм. */
  at: Vec3;
  value?: number;
  limit?: string;
  norm?: string;
  source?: string;
  /** Положение подвижной детали, при котором найдено замечание. */
  pose?: { part: string; t: number; label: string };
}

export interface GapProfile {
  rule: string;
  a: string;
  b: string;
  samples: { p: Vec3; gap: number; flush: number }[];
}
