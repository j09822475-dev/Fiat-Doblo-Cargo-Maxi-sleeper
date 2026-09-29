// Построение всех деталей проекта (общая часть для интерфейса и тестов).
import type { Project, PartDef } from '../core/types';
import { BodyForm, type Hardpoints } from '../geometry/bodyform';
import { buildPart } from '../parts/generators';
import type { PartMesh } from '../geometry/mesh';
import type { PartInput } from '../checks/engine';

export function formOf(project: Project) {
  return new BodyForm(project.vehicle, project.hardpoints as unknown as Hardpoints);
}

/** Версия детали: меняется при изменении её параметров или общих параметров кузова. */
export function partVersion(project: Project, part: PartDef) {
  return JSON.stringify([part.generator, part.params, part.joint, project.vehicle, project.hardpoints]);
}

export function buildAll(project: Project): Map<string, PartMesh> {
  const form = formOf(project);
  const out = new Map<string, PartMesh>();
  for (const p of project.parts) out.set(p.id, buildPart(p, project, form));
  return out;
}

export function toInput(project: Project, part: PartDef, mesh: PartMesh): PartInput {
  return {
    id: part.id,
    version: partVersion(project, part),
    position: new Float32Array(mesh.geometry.attributes.position.array),
    index: new Uint32Array(mesh.geometry.index!.array),
    edges: mesh.edges,
  };
}
