// Положения подвижных деталей. Всё в координатах кузова (мм, градусы).
import * as THREE from 'three';
import type { Joint, PartDef } from './types';

export interface Pose {
  /** Параметр движения 0…1 (для колеса — номер положения в огибающей). */
  t: number;
  label: string;
  matrix: THREE.Matrix4;
}

const deg = Math.PI / 180;

function hingeMatrix(j: Extract<Joint, { type: 'hinge' }>, angle: number) {
  const o = new THREE.Vector3(...j.origin);
  const axis = new THREE.Vector3(...j.axis).normalize();
  return new THREE.Matrix4()
    .makeTranslation(o.x, o.y, o.z)
    .multiply(new THREE.Matrix4().makeRotationAxis(axis, angle * deg))
    .multiply(new THREE.Matrix4().makeTranslation(-o.x, -o.y, -o.z));
}

function slideMatrix(j: Extract<Joint, { type: 'slide' }>, t: number) {
  const a = Math.min(1, t / j.outShare);
  const b = Math.max(0, (t - j.outShare) / (1 - j.outShare));
  return new THREE.Matrix4().makeTranslation(j.out[0] * a + j.travel[0] * b, j.out[1] * a + j.travel[1] * b, j.out[2] * a + j.travel[2] * b);
}

function wheelMatrix(j: Extract<Joint, { type: 'wheel' }>, steer: number, travel: number) {
  const [x, y, z] = j.center;
  return new THREE.Matrix4()
    .makeTranslation(x, y, z + travel)
    .multiply(new THREE.Matrix4().makeRotationZ(steer * deg))
    .multiply(new THREE.Matrix4().makeTranslation(-x, -y, -z));
}

/** Положение для просмотра: t = 0 — закрыто, 1 — открыто на рабочий угол. */
export function previewMatrix(part: PartDef, t: number, wide = false): THREE.Matrix4 {
  const j = part.joint;
  if (j.type === 'hinge') return hingeMatrix(j, (wide ? j.max : j.open) * t);
  if (j.type === 'slide') return slideMatrix(j, t);
  if (j.type === 'wheel') return wheelMatrix(j, j.steer * Math.sin(t * Math.PI * 2), 0);
  return new THREE.Matrix4();
}

export const isMovable = (part: PartDef) => ['hinge', 'slide', 'wheel'].includes(part.joint.type);

/** Набор положений для проверки движения. */
export function motionPoses(part: PartDef, steps = 18): Pose[] {
  const j = part.joint;
  const out: Pose[] = [];
  if (j.type === 'hinge') {
    for (let i = 1; i <= steps; i++) {
      const a = j.min + ((j.max - j.min) * i) / steps;
      out.push({ t: i / steps, label: `${a.toFixed(0)}°`, matrix: hingeMatrix(j, a) });
    }
  } else if (j.type === 'slide') {
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const travel = Math.max(0, (t - j.outShare) / (1 - j.outShare)) * Math.hypot(...j.travel);
      const outV = Math.min(1, t / j.outShare) * Math.hypot(...j.out);
      out.push({ t, label: `наружу ${outV.toFixed(0)} мм, назад ${travel.toFixed(0)} мм`, matrix: slideMatrix(j, t) });
    }
  } else if (j.type === 'wheel') {
    const steers = j.steer ? [-j.steer, -j.steer / 2, 0, j.steer / 2, j.steer] : [0];
    const travels = [-j.rebound, 0, j.bump / 2, j.bump];
    let k = 0;
    const total = steers.length * travels.length;
    for (const s of steers) {
      for (const tr of travels) {
        out.push({ t: k++ / (total - 1 || 1), label: `поворот ${s.toFixed(0)}°, ход ${tr > 0 ? '+' : ''}${tr} мм`, matrix: wheelMatrix(j, s, tr) });
      }
    }
  }
  return out;
}
