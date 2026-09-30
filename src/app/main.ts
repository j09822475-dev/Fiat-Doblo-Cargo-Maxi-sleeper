// Интерфейс системы проектирования кузова.
import type { Issue, PartDef, Project, Severity, Vec3 } from '../core/types';
import { createDobloProject } from '../parts/doblo-project';
import { DEFAULT_HARDPOINTS } from '../geometry/bodyform';
import { buildAll, formOf, toInput } from './build';
import { buildPart } from '../parts/generators';
import { Viewer, type ColorMode } from '../viewer/viewer';
import { CheckClient } from '../checks/client';
import type { CheckResult } from '../checks/engine';
import { NORM_BOOKS, gapNorm, materialDensity, materialTitle } from '../checks/norms';
import { isMovable } from '../core/kinematics';
import type { PartMesh } from '../geometry/mesh';

// ------------------------------------------------------------ утилиты DOM
type Child = Node | string | number | null | undefined | false;
function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, unknown> = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'class') el.className = String(v);
    else if (k === 'text') el.textContent = String(v);
    else if (k === 'html') el.innerHTML = String(v);
    else if (k in el && typeof v !== 'string') (el as unknown as Record<string, unknown>)[k] = v;
    else el.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(typeof c === 'number' ? String(c) : c);
  return el;
}
/** append с пропуском пустых детей. */
function put(el: Element, ...c: Child[]) {
  el.append(...(c.filter((x) => x !== null && x !== undefined && x !== false).map((x) => (typeof x === 'number' ? String(x) : x)) as (Node | string)[]));
}
function fill(el: Element, ...c: Child[]) {
  el.replaceChildren();
  put(el, ...c);
}
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const fmt = (v: number, d = 1) => (Math.round(v * 10 ** d) / 10 ** d).toLocaleString('ru-RU', { maximumFractionDigits: d });
const EYE = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8Z"/><circle cx="8" cy="8" r="2"/></svg>';
const EYE_OFF = '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M2 2l12 12M6.6 3.7C7 3.6 7.5 3.5 8 3.5c4.1 0 6.5 4.5 6.5 4.5a11 11 0 0 1-1.9 2.5M4.1 5.1A11 11 0 0 0 1.5 8s2.4 4.5 6.5 4.5c1 0 1.9-.3 2.7-.7"/></svg>';

// ------------------------------------------------------------ состояние
// v2: кузов сверен с чертежом Doblò 2015 Cargo LWB — старое автосохранение не подхватываем
const STORAGE_KEY = 'doblo-body-project-v2';
/** Проект из файла или хранилища: базовые точки, которых не было в старых версиях, — по умолчанию. */
function normalize(p: Project): Project {
  p.hardpoints = { ...(DEFAULT_HARDPOINTS as unknown as Record<string, number>), ...p.hardpoints };
  return p;
}
function loadStored(): Project | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Project;
    return p.format === 'doblo-body/1' ? normalize(p) : null;
  } catch {
    return null;
  }
}
function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(project));
  } catch {
    /* хранилище недоступно — работаем без автосохранения */
  }
}

let project: Project = loadStored() ?? createDobloProject();
let meshes: Map<string, PartMesh> = buildAll(project);
const viewer = new Viewer($('view'));
viewer.setProject(project, meshes);
const client = new CheckClient();

const ui = {
  result: null as CheckResult | null,
  stale: true,
  running: false,
  progress: { share: 0, stage: '' },
  selected: null as string | null,
  hiddenParts: new Set<string>(),
  hiddenLayers: new Set<string>(),
  ghostLayers: new Set<string>(),
  isolated: null as Set<string> | null,
  leftTab: 'tree' as 'tree' | 'layers',
  rightTab: 'props' as 'props' | 'checks' | 'norms' | 'body',
  filter: 'all' as Severity | 'all',
  activeIssue: null as string | null,
  heat: false,
  tool: 'select' as 'select' | 'measure',
  meas: [] as Vec3[],
  hover: null as { p: Vec3 | null; part: string | null } | null,
  collapsed: new Set<string>(),
  search: '',
  explode: 0,
  section: { axis: null as 'x' | 'y' | 'z' | null, pos: 0, flip: false },
  colorMode: 'layer' as ColorMode,
  wide: false,
  drawer: null as 'left' | 'right' | null,
};

const partById = (id: string) => project.parts.find((p) => p.id === id)!;
const title = (id: string) => project.parts.find((p) => p.id === id)?.title ?? id;

function markStale() {
  ui.stale = true;
  save();
  renderToolbar();
  renderRight();
}

function applyVisibility() {
  const hidden = new Set(ui.hiddenParts);
  const ghost = new Set<string>();
  for (const p of project.parts) {
    if (ui.hiddenLayers.has(p.layer)) hidden.add(p.id);
    if (ui.ghostLayers.has(p.layer)) ghost.add(p.id);
  }
  viewer.setVisibility(hidden, ghost, ui.isolated);
}

function partStatus(id: string): 'error' | 'warning' | 'ok' | null {
  if (!ui.result) return null;
  let s: 'error' | 'warning' | 'ok' = 'ok';
  for (const i of ui.result.issues) {
    if (!i.parts.includes(id)) continue;
    if (i.severity === 'error') return 'error';
    if (i.severity === 'warning') s = 'warning';
  }
  return s;
}

// ------------------------------------------------------------ действия
function select(id: string | null, focus = false) {
  ui.selected = id;
  viewer.setSelection(id);
  if (id && focus) viewer.focusPart(id);
  if (id) ui.rightTab = 'props';
  renderLeft();
  renderRight();
  renderHud();
}

function rebuildPart(part: PartDef) {
  const mesh = buildPart(part, project, formOf(project));
  meshes.set(part.id, mesh);
  viewer.updatePart(part, mesh);
  applyVisibility();
  markStale();
}

function rebuildAll() {
  meshes = buildAll(project);
  viewer.setProject(project, meshes);
  applyVisibility();
  viewer.setSelection(ui.selected);
  markStale();
}

async function runChecks() {
  if (ui.running) return;
  ui.running = true;
  ui.progress = { share: 0, stage: 'Подготовка' };
  ui.rightTab = 'checks';
  renderToolbar();
  renderRight();
  const inputs = project.parts.map((p) => toInput(project, p, meshes.get(p.id)!));
  try {
    const res = await client.run(structuredClone(project), inputs, (share, stage) => {
      ui.progress = { share, stage };
      const bar = document.querySelector<HTMLElement>('.progress i');
      if (bar) bar.style.width = `${Math.round(share * 100)}%`;
      const st = document.getElementById('progress-stage');
      if (st) st.textContent = stage;
    });
    ui.result = res;
    ui.stale = false;
    viewer.setStatus(res.issues);
    if (ui.heat) viewer.showHeatmap(res.profiles, ruleLimits);
  } catch (e) {
    alertBox(`Проверка не выполнена: ${(e as Error).message}`);
  }
  ui.running = false;
  renderToolbar();
  renderLeft();
  renderRight();
}

function ruleLimits(ruleId: string) {
  const r = project.rules.find((x) => x.id === ruleId);
  if (!r || r.kind !== 'gap') return { min: 0, max: Infinity };
  const n = gapNorm(r.norm, project);
  return { min: n.gapMin, max: n.gapMax };
}

function showIssue(i: Issue) {
  ui.activeIssue = i.id;
  viewer.setHighlight(i.parts);
  if (i.pose) {
    // показываем деталь в том положении, где найдено замечание
    const part = partById(i.pose.part);
    const j = part.joint;
    if (j.type === 'hinge') {
      const angle = i.pose.t * j.max;
      ui.wide = angle > j.open + 0.5;
      viewer.setWide(ui.wide);
      viewer.setMotion(part.id, ui.wide ? i.pose.t : angle / j.open);
    } else if (j.type === 'slide') viewer.setMotion(part.id, i.pose.t);
  }
  viewer.focusPoint(i.at);
  renderRight();
  renderHud();
}

function clearIssue() {
  ui.activeIssue = null;
  viewer.setHighlight([]);
  viewer.clearMarker();
  renderRight();
  renderHud();
}

function download(name: string, text: string, type: string) {
  const a = h('a', { href: URL.createObjectURL(new Blob([text], { type })), download: name });
  document.body.append(a);
  a.click();
  a.remove();
}

function alertBox(msg: string) {
  const hud = $('hud');
  const card = h('div', { class: 'hud-card', role: 'alert' }, msg);
  hud.append(card);
  setTimeout(() => card.remove(), 5000);
}

function exportCsv() {
  if (!ui.result) return;
  const rows = [['Серьёзность', 'Тип', 'Замечание', 'Детали', 'Значение, мм', 'Норма', 'Положение', 'X', 'Y', 'Z', 'Источник']];
  for (const i of ui.result.issues) {
    rows.push([i.severity, i.kind, i.title, i.parts.join(' + '), i.value?.toString() ?? '', i.limit ?? '', i.pose?.label ?? '', ...i.at.map(String), i.source ?? '']);
  }
  download('doblo-proverka.csv', '﻿' + rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n'), 'text/csv');
}

// ------------------------------------------------------------ верхняя панель
function renderToolbar() {
  const tb = $('toolbar');
    const tbtn = (label: string, pressed: boolean | null, onclick: () => void, t?: string) =>
    h('button', { class: 'tb', type: 'button', 'aria-pressed': pressed === null ? undefined : String(pressed), title: t, onclick }, label);

  fill(tb,
    h('button', { class: 'tb mobile-only', type: 'button', onclick: () => toggleDrawer('left') }, 'Состав'),
    h('button', { class: 'tb mobile-only', type: 'button', onclick: () => toggleDrawer('right') }, 'Панель'),
    h('button', {
      class: 'btn-run', type: 'button', id: 'run', disabled: ui.running, 'data-stale': String(ui.stale && !!ui.result),
      title: 'Проверить коллизии, зазоры, движение и нормативы (Ctrl+Enter)', onclick: runChecks,
    }, h('span', { class: 'stale', title: 'Проект изменён после проверки' }), ui.running ? `Проверка ${Math.round(ui.progress.share * 100)}%` : 'Проверить'),
    h('div', { class: 'tgroup' }, ...(['iso', 'front', 'side', 'rear', 'top'] as const).map((v, k) =>
      tbtn(({ iso: 'Изо', front: 'Спереди', side: 'Справа', rear: 'Сзади', top: 'Сверху' })[v], null, () => viewer.view(v), `Вид: ${v} (${k + 1})`))),
    h('div', { class: 'tgroup' },
      h('label', { for: 'explode' }, 'Разнос'),
      h('input', { type: 'range', id: 'explode', min: '0', max: '1', step: '0.02', value: String(ui.explode), oninput: (e: Event) => { ui.explode = +(e.target as HTMLInputElement).value; viewer.setExplode(ui.explode); } }),
    ),
    h('div', { class: 'tgroup' },
      h('label', { for: 'sec-axis' }, 'Сечение'),
      h('select', { id: 'sec-axis', onchange: (e: Event) => { const v = (e.target as HTMLSelectElement).value; ui.section.axis = v ? (v as 'x') : null; ui.section.pos = v === 'x' ? 1500 : v === 'z' ? 900 : 0; viewer.setSection(ui.section.axis, ui.section.pos, ui.section.flip); renderToolbar(); } },
        ...[['', 'нет'], ['x', 'X (поперёк)'], ['y', 'Y (вдоль)'], ['z', 'Z (гориз.)']].map(([v, t]) => h('option', { value: v, selected: (ui.section.axis ?? '') === v }, t))),
      ui.section.axis && h('input', {
        type: 'range', id: 'sec-pos', 'aria-label': 'Положение сечения',
        min: String(ui.section.axis === 'x' ? -950 : ui.section.axis === 'y' ? -950 : 0),
        max: String(ui.section.axis === 'x' ? 3850 : ui.section.axis === 'y' ? 950 : 1900),
        step: '5', value: String(ui.section.pos),
        oninput: (e: Event) => { ui.section.pos = +(e.target as HTMLInputElement).value; viewer.setSection(ui.section.axis, ui.section.pos, ui.section.flip); renderStatus(); },
      }),
      ui.section.axis && tbtn('⇄', ui.section.flip, () => { ui.section.flip = !ui.section.flip; viewer.setSection(ui.section.axis, ui.section.pos, ui.section.flip); renderToolbar(); }, 'Сменить сторону сечения'),
    ),
    h('div', { class: 'tgroup' },
      h('label', { for: 'color-mode' }, 'Цвет'),
      h('select', { id: 'color-mode', onchange: (e: Event) => { ui.colorMode = (e.target as HTMLSelectElement).value as ColorMode; viewer.setColorMode(ui.colorMode); } },
        ...[['layer', 'по слоям'], ['material', 'по материалу'], ['thickness', 'по толщине'], ['status', 'по результату']].map(([v, t]) => h('option', { value: v, selected: ui.colorMode === v }, t))),
    ),
    h('div', { class: 'tgroup' },
      tbtn('Карта зазоров', ui.heat, () => { ui.heat = !ui.heat; viewer.showHeatmap(ui.heat && ui.result ? ui.result.profiles : null, ruleLimits); renderToolbar(); renderHud(); if (ui.heat && !ui.result) alertBox('Сначала запустите проверку — карта строится по её результатам.'); }, 'Точки вдоль стыков: зелёные — в норме, жёлтые — у границы, красные — вне нормы'),
      tbtn('Линейка', ui.tool === 'measure', () => { ui.tool = ui.tool === 'measure' ? 'select' : 'measure'; ui.meas = []; viewer.showMeasure(null, null); renderToolbar(); renderStatus(); }, 'Расстояние между двумя точками (M)'),
    ),
    h('div', { class: 'tgroup desktop-only' },
      tbtn('Сохранить', null, () => download('doblo-project.json', JSON.stringify(project, null, 2), 'application/json'), 'Скачать проект в JSON'),
      tbtn('Открыть', null, openProject, 'Загрузить проект из JSON'),
      tbtn('Сброс', null, resetProject, 'Вернуть проект по умолчанию'),
    ),
  );
}

function openProject() {
  const inp = h('input', { type: 'file', accept: '.json,application/json' });
  inp.addEventListener('change', async () => {
    const f = inp.files?.[0];
    if (!f) return;
    try {
      const p = JSON.parse(await f.text()) as Project;
      if (p.format !== 'doblo-body/1') throw new Error('неизвестный формат файла');
      project = normalize(p);
      ui.selected = null;
      ui.result = null;
      rebuildAll();
      renderAll();
    } catch (e) {
      alertBox(`Не удалось открыть проект: ${(e as Error).message}`);
    }
  });
  inp.click();
}

let resetArmed = 0;
function resetProject() {
  if (Date.now() - resetArmed > 3000) {
    resetArmed = Date.now();
    alertBox('Нажмите «Сброс» ещё раз, чтобы вернуть проект по умолчанию. Изменения будут потеряны.');
    return;
  }
  project = createDobloProject();
  ui.result = null;
  ui.selected = null;
  rebuildAll();
  renderAll();
}

function toggleDrawer(side: 'left' | 'right' | null) {
  ui.drawer = ui.drawer === side ? null : side;
  $('left').classList.toggle('open', ui.drawer === 'left');
  $('right').classList.toggle('open', ui.drawer === 'right');
  document.querySelector('.scrim')?.remove();
  if (ui.drawer) document.body.append(h('div', { class: 'scrim', onclick: () => toggleDrawer(null) }));
}

// ------------------------------------------------------------ левая панель
function renderLeft() {
  const el = $('left');
  fill(el, 
    h('div', { class: 'tabs', role: 'tablist' },
      h('button', { class: 'tab', role: 'tab', 'aria-selected': String(ui.leftTab === 'tree'), onclick: () => { ui.leftTab = 'tree'; renderLeft(); } }, 'Состав'),
      h('button', { class: 'tab', role: 'tab', 'aria-selected': String(ui.leftTab === 'layers'), onclick: () => { ui.leftTab = 'layers'; renderLeft(); } }, 'Слои'),
    ),
    ui.leftTab === 'tree' ? treePane() : layersPane(),
  );
}

function eyeBtn(hidden: boolean, onclick: () => void, label: string) {
  return h('button', { class: 'eye', type: 'button', 'aria-label': label, 'aria-pressed': String(!hidden), html: hidden ? EYE_OFF : EYE, onclick: (e: Event) => { e.stopPropagation(); onclick(); } });
}

function partRow(p: PartDef) {
  const st = partStatus(p.id);
  const hidden = ui.hiddenParts.has(p.id) || ui.hiddenLayers.has(p.layer);
  return h('li', {},
    h('div', { class: `node${ui.selected === p.id ? ' sel' : ''}`, 'data-part': p.id },
      h('span', { class: `dot ${st ?? ''}`, title: st === 'error' ? 'Есть ошибки' : st === 'warning' ? 'Есть предупреждения' : st === 'ok' ? 'Замечаний нет' : 'Не проверялась' }),
      h('span', { class: 'name', title: p.title, onclick: () => select(p.id), ondblclick: () => { ui.isolated = new Set([p.id]); applyVisibility(); select(p.id, true); } }, p.title),
      h('span', { class: 'code' }, p.id),
      eyeBtn(hidden, () => { if (ui.hiddenParts.has(p.id)) ui.hiddenParts.delete(p.id); else ui.hiddenParts.add(p.id); applyVisibility(); renderLeft(); }, `Показать или скрыть: ${p.title}`),
    ));
}

function treePane() {
  const pane = h('div', { class: 'pane' });
  const search = h('input', {
    class: 'search', type: 'search', placeholder: 'Поиск детали или кода', value: ui.search, 'aria-label': 'Поиск детали',
    oninput: (e: Event) => { ui.search = (e.target as HTMLInputElement).value; const list = pane.querySelector('.tree'); list?.replaceWith(treeList()); },
  });
  put(pane, 
    search,
    ui.isolated && h('div', { class: 'row', style: 'margin:0 0 8px' },
      h('button', { class: 'btn', type: 'button', onclick: () => { ui.isolated = null; applyVisibility(); renderLeft(); } }, `Показать всё (изолировано: ${ui.isolated.size})`)),
    treeList(),
  );
  return pane;
}

function treeList(): HTMLElement {
  const q = ui.search.trim().toLowerCase();
  if (q) {
    const found = project.parts.filter((p) => p.title.toLowerCase().includes(q) || p.id.includes(q));
    return h('ul', { class: 'tree' }, ...(found.length ? found.map(partRow) : [h('li', { class: 'hint' }, 'Ничего не найдено')]));
  }
  const sub = (asm: string): HTMLElement[] => {
    const kids = project.assemblies.filter((a) => a.parent === asm);
    const parts = project.parts.filter((p) => p.assembly === asm);
    return [
      ...kids.map((a) => {
        const all = partsIn(a.id);
        if (!all.length) return null;
        const open = !ui.collapsed.has(a.id);
        const allHidden = all.every((p) => ui.hiddenParts.has(p.id));
        return h('li', {},
          h('div', { class: 'node asm' },
            h('button', { class: 'caret', type: 'button', 'aria-label': open ? 'Свернуть' : 'Развернуть', 'aria-expanded': String(open), onclick: () => { if (open) ui.collapsed.add(a.id); else ui.collapsed.delete(a.id); renderLeft(); } }, open ? '▾' : '▸'),
            h('span', { class: 'name', onclick: () => { ui.isolated = new Set(all.map((p) => p.id)); applyVisibility(); renderLeft(); }, title: 'Щелчок — показать только этот узел' }, a.title),
            h('span', { class: 'code' }, String(all.length)),
            eyeBtn(allHidden, () => { for (const p of all) { if (allHidden) ui.hiddenParts.delete(p.id); else ui.hiddenParts.add(p.id); } applyVisibility(); renderLeft(); }, `Показать или скрыть узел ${a.title}`),
          ),
          open && h('ul', {}, ...sub(a.id)),
        );
      }).filter(Boolean) as HTMLElement[],
      ...parts.map(partRow),
    ];
  };
  return h('ul', { class: 'tree' }, ...sub('vehicle'));
}

function partsIn(asm: string): PartDef[] {
  const ids = new Set([asm]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const a of project.assemblies) if (a.parent && ids.has(a.parent) && !ids.has(a.id)) { ids.add(a.id); grew = true; }
  }
  return project.parts.filter((p) => ids.has(p.assembly));
}

function layersPane() {
  const pane = h('div', { class: 'pane' },
    h('p', { class: 'hint' }, 'Слой можно скрыть, сделать прозрачным или показать отдельно. Порядок — от каркаса к интерьеру.'));
  for (const l of project.layers) {
    const n = project.parts.filter((p) => p.layer === l.id).length;
    const hidden = ui.hiddenLayers.has(l.id);
    const ghost = ui.ghostLayers.has(l.id);
    const only = ui.isolated !== null && project.parts.filter((p) => p.layer === l.id).every((p) => ui.isolated!.has(p.id)) && ui.isolated.size === n;
    put(pane, h('div', { class: 'layer' },
      h('span', { class: 'sw', style: `background:${l.color}` }),
      h('span', {}, l.title),
      h('span', { class: 'n' }, String(n)),
      h('button', { class: 'mini', type: 'button', 'aria-pressed': String(ghost), title: 'Прозрачно', onclick: () => { if (ghost) ui.ghostLayers.delete(l.id); else ui.ghostLayers.add(l.id); applyVisibility(); renderLeft(); } }, 'Проз.'),
      h('button', { class: 'mini', type: 'button', 'aria-pressed': String(only), title: 'Показать только этот слой', onclick: () => { ui.isolated = only ? null : new Set(project.parts.filter((p) => p.layer === l.id).map((p) => p.id)); applyVisibility(); renderLeft(); } }, 'Только'),
      eyeBtn(hidden, () => { if (hidden) ui.hiddenLayers.delete(l.id); else ui.hiddenLayers.add(l.id); applyVisibility(); renderLeft(); }, `Показать или скрыть слой ${l.title}`),
    ));
  }
  put(pane, h('div', { class: 'row' },
    h('button', { class: 'btn', type: 'button', onclick: () => { ui.hiddenLayers.clear(); ui.ghostLayers.clear(); ui.isolated = null; ui.hiddenParts.clear(); applyVisibility(); renderLeft(); } }, 'Показать всё'),
    h('button', { class: 'btn', type: 'button', onclick: () => { ui.ghostLayers = new Set(['outer', 'closures', 'glazing', 'trim', 'lighting']); applyVisibility(); renderLeft(); } }, 'Рентген кузова'),
  ));
  return pane;
}

// ------------------------------------------------------------ правая панель
function renderRight() {
  const el = $('right');
  const errors = ui.result?.issues.filter((i) => i.severity === 'error').length ?? 0;
  const total = ui.result?.issues.length ?? 0;
  const tab = (id: typeof ui.rightTab, label: string, extra?: Child) =>
    h('button', { class: 'tab', role: 'tab', 'aria-selected': String(ui.rightTab === id), onclick: () => { ui.rightTab = id; renderRight(); } }, label, extra);
  fill(el, 
    h('div', { class: 'tabs', role: 'tablist' },
      tab('props', 'Свойства'),
      tab('checks', 'Проверки', ui.result && h('span', { class: `count${errors ? ' err' : ''}` }, String(total))),
      tab('norms', 'Нормы'),
      tab('body', 'Кузов'),
    ),
    ui.rightTab === 'props' ? propsPane() : ui.rightTab === 'checks' ? checksPane() : ui.rightTab === 'norms' ? normsPane() : bodyPane(),
  );
}

const PARAM_LABELS: Record<string, string> = {
  gap: 'Зазор по кромкам, мм', depth: 'Глубина (толщина узла), мм', frontBevel: 'Скос передней кромки', archGap: 'Отступ от арки, мм',
  gapCenter: 'Зазор между створками, мм', split: 'Положение стыка створок Y, мм', gapLamp: 'Зазор до фары, мм', gapBumper: 'Зазор до бампера, мм',
  radius: 'Радиус арки, мм', inner: 'Внутренняя стенка Y, мм', x: 'Положение X, мм', z: 'Высота Z, мм', recline: 'Наклон спинки, рад', flange: 'Отбортовка кромки, мм',
  side: 'Сторона (−1 лев., 1 прав.)', axle: 'Ось (0 перед, 1 зад)',
};
const READONLY = new Set(['side', 'axle']);

function partMass(p: PartDef): number | null {
  const m = meshes.get(p.id);
  const rho = materialDensity(p.material);
  if (!m || !rho || !p.thickness) return null;
  const pos = m.geometry.attributes.position.array;
  const idx = m.geometry.index!;
  let area = 0;
  for (let i = 0; i < idx.count; i += 3) {
    const a = idx.getX(i) * 3, b = idx.getX(i + 1) * 3, c = idx.getX(i + 2) * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    area += Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2;
  }
  // для листовых деталей: площадь развёртки ≈ половина площади замкнутой оболочки
  const tube = ['sill', 'bPillar', 'frontRail'].includes(p.generator);
  return ((tube ? area : area / 2) * p.thickness * 1e-9 * rho);
}

function numberField(label: string, value: number, onchange: (v: number) => void, readonly = false, id?: string) {
  const inputId = id ?? `f-${Math.random().toString(36).slice(2, 8)}`;
  return [
    h('label', { for: inputId }, label),
    h('input', { id: inputId, type: 'number', step: 'any', value: String(Math.round(value * 1000) / 1000), readonly, onchange: (e: Event) => { const v = parseFloat((e.target as HTMLInputElement).value); if (Number.isFinite(v)) onchange(v); } }),
  ];
}

function propsPane() {
  const pane = h('div', { class: 'pane' });
  if (!ui.selected) {
    put(pane, h('div', { class: 'empty' }, 'Выберите деталь в дереве слева или щелчком по модели. Двойной щелчок в дереве показывает деталь отдельно.'));
    put(pane, h('h3', { class: 'section' }, 'Сводка проекта'));
    const tri = [...meshes.values()].reduce((s, m) => s + m.geometry.index!.count / 3, 0);
    const mass = project.parts.reduce((s, p) => s + (partMass(p) ?? 0), 0);
    put(pane, h('dl', { class: 'props' },
      h('dt', {}, 'Деталей'), h('dd', { class: 'num' }, String(project.parts.length)),
      h('dt', {}, 'Узлов'), h('dd', { class: 'num' }, String(project.assemblies.length)),
      h('dt', {}, 'Правил проверки'), h('dd', { class: 'num' }, String(project.rules.length)),
      h('dt', {}, 'Соединений'), h('dd', { class: 'num' }, String(project.joined.length)),
      h('dt', {}, 'Треугольников'), h('dd', { class: 'num' }, tri.toLocaleString('ru-RU')),
      h('dt', {}, 'Масса листовых деталей'), h('dd', { class: 'num' }, `≈ ${fmt(mass, 0)} кг (оценка по площади и толщине)`),
    ));
    return pane;
  }
  const p = partById(ui.selected);
  const info = viewer.partInfo(p.id);
  const size = info ? info.box.max.clone().sub(info.box.min) : null;
  const mass = partMass(p);
  const issues = ui.result?.issues.filter((i) => i.parts.includes(p.id)) ?? [];
  const j = p.joint;
  const jointText =
    j.type === 'hinge' ? `Петли, ось через (${j.origin.map((v) => fmt(v, 0)).join('; ')}), 0…${j.max}°`
    : j.type === 'slide' ? `Сдвижная: наружу ${Math.hypot(...j.out)} мм, назад ${Math.hypot(...j.travel)} мм`
    : j.type === 'wheel' ? `Колесо: поворот ±${j.steer}°, ход +${j.bump} / −${j.rebound} мм`
    : j.type === 'mounted' ? `Закреплена на детали «${title(j.to)}»` : 'Неподвижная';
  put(pane, 
    h('p', { class: 'part-title' }, p.title),
    h('p', { class: 'part-code', style: 'margin:0 0 10px' }, p.id),
    h('dl', { class: 'props' },
      h('dt', {}, 'Слой'), h('dd', {}, project.layers.find((l) => l.id === p.layer)?.title ?? p.layer),
      h('dt', {}, 'Узел'), h('dd', {}, project.assemblies.find((a) => a.id === p.assembly)?.title ?? p.assembly),
      h('dt', {}, 'Материал'), h('dd', {}, materialTitle(p.material)),
      h('dt', {}, 'Толщина'), h('dd', { class: 'num' }, p.thickness ? `${fmt(p.thickness, 2)} мм` : 'габаритный объём'),
      h('dt', {}, 'Масса'), h('dd', { class: 'num' }, mass ? `≈ ${fmt(mass, 2)} кг` : '—'),
      size && h('dt', {}, 'Габарит X×Y×Z'), size && h('dd', { class: 'num' }, `${fmt(size.x, 0)} × ${fmt(size.y, 0)} × ${fmt(size.z, 0)} мм`),
      h('dt', {}, 'Движение'), h('dd', {}, jointText),
      h('dt', {}, 'Замечания'), h('dd', {}, ui.result ? (issues.length ? h('a', { href: '#', onclick: (e: Event) => { e.preventDefault(); ui.rightTab = 'checks'; renderRight(); } }, `${issues.length} — открыть список`) : 'нет') : 'проверка не запускалась'),
      h('dt', {}, 'Статус'), h('dd', {}, h('select', { 'aria-label': 'Статус детали', onchange: (e: Event) => { p.status = (e.target as HTMLSelectElement).value as PartDef['status']; save(); } },
        ...[['draft', 'черновик'], ['checked', 'проверена'], ['approved', 'утверждена']].map(([v, t]) => h('option', { value: v, selected: p.status === v }, t)))),
    ),
    h('div', { class: 'row' },
      h('button', { class: 'btn', type: 'button', onclick: () => viewer.focusPart(p.id) }, 'Показать'),
      h('button', { class: 'btn', type: 'button', onclick: () => { ui.isolated = new Set([p.id, ...project.parts.filter((q) => q.joint.type === 'mounted' && q.joint.to === p.id).map((q) => q.id)]); applyVisibility(); renderLeft(); viewer.focusPart(p.id); } }, 'Только она'),
      h('button', { class: 'btn', type: 'button', onclick: () => { ui.hiddenParts.add(p.id); applyVisibility(); renderLeft(); } }, 'Скрыть'),
    ),
  );
  if (isMovable(p)) {
    const t = viewer.motionOf(p.id);
    put(pane, 
      h('h3', { class: 'section' }, 'Движение'),
      h('div', { class: 'slider' },
        h('label', { for: 'motion' }, j.type === 'wheel' ? 'Поворот' : 'Закрыто'),
        h('input', { type: 'range', id: 'motion', min: '0', max: '1', step: '0.01', value: String(t), oninput: (e: Event) => viewer.setMotion(p.id, +(e.target as HTMLInputElement).value) }),
        h('span', {}, j.type === 'wheel' ? '' : 'Открыто'),
      ),
      j.type === 'hinge' && j.max > j.open && h('label', { style: 'display:flex;gap:6px;align-items:center' },
        h('input', { type: 'checkbox', checked: ui.wide, onchange: (e: Event) => { ui.wide = (e.target as HTMLInputElement).checked; viewer.setWide(ui.wide); } }),
        `Полное открывание ${j.max}°`),
    );
    if (j.type === 'hinge') {
      put(pane, h('div', { class: 'fields', style: 'margin-top:8px' },
        ...numberField('Ось петель X, мм', j.origin[0], (v) => { j.origin[0] = v; rebuildPart(p); }),
        ...numberField('Ось петель Y, мм', j.origin[1], (v) => { j.origin[1] = v; rebuildPart(p); }),
        ...numberField('Ось петель Z, мм', j.origin[2], (v) => { j.origin[2] = v; rebuildPart(p); }),
        ...numberField('Рабочий угол, °', j.open, (v) => { j.open = v; markStale(); }),
        ...numberField('Предельный угол, °', j.max, (v) => { j.max = v; markStale(); }),
      ));
    }
  }
  const keys = Object.keys(p.params);
  if (keys.length) {
    put(pane, h('h3', { class: 'section' }, 'Параметры детали'),
      h('p', { class: 'hint' }, 'После изменения деталь перестраивается сразу. Проверку нужно запустить заново.'),
      h('div', { class: 'fields' }, ...keys.flatMap((k) => numberField(PARAM_LABELS[k] ?? k, p.params[k], (v) => { p.params[k] = v; rebuildPart(p); renderRight(); }, READONLY.has(k)))));
  }
  if (issues.length) {
    put(pane, h('h3', { class: 'section' }, 'Замечания по детали'), issueList(issues));
  }
  return pane;
}

const KIND_LABEL: Record<Issue['kind'], string> = {
  collision: 'Пересечение', clearance: 'Мин. зазор', 'gap-small': 'Зазор мал', 'gap-large': 'Зазор велик',
  'gap-spread': 'Неравномерность', flush: 'Перепад', 'no-seam': 'Нет стыка', regulation: 'Норматив', opening: 'Просвет',
};

function issueList(list: Issue[]) {
  return h('ul', { class: 'issues' }, ...list.map((i) =>
    h('li', {}, h('button', { type: 'button', class: `issue ${i.severity}${ui.activeIssue === i.id ? ' active' : ''}`, onclick: () => (ui.activeIssue === i.id ? clearIssue() : showIssue(i)) },
      h('div', { class: 't' }, i.title),
      h('div', { class: 'm' },
        h('span', {}, KIND_LABEL[i.kind]),
        i.value !== undefined && h('span', { class: 'v' }, `${fmt(i.value)} мм`),
        i.limit && h('span', {}, `норма ${i.limit}`),
        i.pose && h('span', {}, `при ${i.pose.label}`),
      ),
      i.source && h('div', { class: 'src' }, i.source),
    ))));
}

function checksPane() {
  const pane = h('div', { class: 'pane' });
  if (ui.running) {
    put(pane, h('div', { class: 'progress' }, h('i', { style: `width:${Math.round(ui.progress.share * 100)}%` })), h('p', { class: 'hint', id: 'progress-stage' }, ui.progress.stage));
  }
  if (!ui.result) {
    if (!ui.running) put(pane, h('div', { class: 'empty' }, 'Проверка ещё не запускалась. Нажмите «Проверить»: система найдёт пересечения деталей, зазоры меньше и больше нормы, перепады по стыкам, столкновения при открывании дверей и ходе колёс, отклонения от Правил ЕЭК ООН.'));
    return pane;
  }
  const r = ui.result;
  const count = (s: Severity) => r.issues.filter((i) => i.severity === s).length;
  const chip = (s: Severity | 'all', label: string, n: number, cls: string) =>
    h('button', { class: `chip ${cls}`, type: 'button', 'aria-pressed': String(ui.filter === s), onclick: () => { ui.filter = ui.filter === s ? 'all' : s; renderRight(); } }, h('b', {}, String(n)), h('span', {}, label));
  put(pane, 
    h('div', { class: 'summary' },
      chip('error', 'ошибки', count('error'), count('error') ? 'err' : 'ok'),
      chip('warning', 'предупреждения', count('warning'), count('warning') ? 'warn' : 'ok'),
      chip('info', 'сведения', count('info'), ''),
    ),
    h('p', { class: 'hint' }, `Проверено пар деталей: ${r.stats.pairs}, положений при движении: ${r.stats.poses}, стыков: ${r.profiles.length}. Время ${fmt(r.stats.ms / 1000, 1)} с.`),
    ui.stale && h('p', { class: 'hint', style: 'color:var(--warn)' }, 'Проект изменён после проверки — результаты могут быть устаревшими.'),
  );
  const list = r.issues.filter((i) => ui.filter === 'all' || i.severity === ui.filter);
  if (!r.issues.length) {
    put(pane, h('div', { class: 'empty good' }, 'Замечаний нет: коллизий, выходов зазоров за нормы и нарушений нормативов не найдено.'));
  } else if (!list.length) {
    put(pane, h('div', { class: 'empty' }, 'В этой категории замечаний нет.'));
  } else put(pane, issueList(list));
  put(pane, 
    h('h3', { class: 'section' }, 'Стыки'),
    h('div', { class: 'tbl-wrap' }, h('table', { class: 'ntable' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Стык'), h('th', {}, 'Зазор, мм'), h('th', {}, 'Норма'))),
      h('tbody', {}, ...r.profiles.map((pr) => {
        const g = pr.samples.map((s) => s.gap);
        const lim = ruleLimits(pr.rule);
        const lo = Math.min(...g), hi = Math.max(...g);
        const bad = lo < lim.min || hi > lim.max;
        return h('tr', { style: 'cursor:pointer', onclick: () => { viewer.setHighlight([pr.a, pr.b]); viewer.focusPoint(pr.samples[Math.floor(pr.samples.length / 2)].p, 1200); } },
          h('td', {}, `${title(pr.a)} — ${title(pr.b)}`),
          h('td', { class: 'n num', style: bad ? 'color:var(--err)' : '' }, `${fmt(lo)}…${fmt(hi)}`),
          h('td', { class: 'n num' }, `${lim.min}…${lim.max}`));
      })),
    )),
    h('div', { class: 'row' },
      h('button', { class: 'btn', type: 'button', onclick: exportCsv }, 'Скачать отчёт CSV'),
      ui.activeIssue && h('button', { class: 'btn', type: 'button', onclick: clearIssue }, 'Снять подсветку'),
    ),
  );
  return pane;
}

function override(normId: string, key: string, value: number, book: number) {
  let o = project.overrides.find((x) => x.normId === normId);
  if (!o) {
    o = { normId, values: {}, reason: 'изменено в проекте' };
    project.overrides.push(o);
  }
  if (Math.abs(value - book) < 1e-9) delete o.values[key];
  else o.values[key] = value;
  if (!Object.keys(o.values).length) project.overrides = project.overrides.filter((x) => x !== o);
  markStale();
}

function normInput(normId: string, key: string, book: number) {
  const cur = project.overrides.find((o) => o.normId === normId)?.values[key];
  const v = cur ?? book;
  return h('input', {
    type: 'number', step: 'any', value: String(v), class: cur !== undefined ? 'over' : '', 'aria-label': `${normId}: ${key}`,
    title: cur !== undefined ? `Изменено в проекте. По справочнику: ${book}` : 'Значение по справочнику',
    onchange: (e: Event) => { const x = parseFloat((e.target as HTMLInputElement).value); if (Number.isFinite(x)) override(normId, key, x, book); },
  });
}

function normsPane() {
  const { gaps, clearances, regulations, materials } = NORM_BOOKS;
  return h('div', { class: 'pane' },
    h('p', { class: 'hint' }, 'Значения по умолчанию — из справочных файлов проекта (data/norms). Изменённые в проекте значения подсвечены; исходное значение и источник сохраняются.'),
    h('h3', { class: 'section' }, gaps.title),
    h('p', { class: 'nsrc' }, gaps.note),
    h('div', { class: 'tbl-wrap' }, h('table', { class: 'ntable' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Стык'), h('th', {}, 'мин'), h('th', {}, 'ном'), h('th', {}, 'макс'), h('th', {}, 'перепад ±'))),
      h('tbody', {}, ...gaps.items.map((g) => h('tr', {},
        h('td', {}, g.title, h('div', { class: 'nsrc' }, g.source)),
        h('td', { class: 'n' }, normInput(g.id, 'gapMin', g.gap.min)),
        h('td', { class: 'n' }, normInput(g.id, 'gapNom', g.gap.nom)),
        h('td', { class: 'n' }, normInput(g.id, 'gapMax', g.gap.max)),
        h('td', { class: 'n' }, normInput(g.id, 'flushTol', g.flush.tol)),
      ))))),
    h('h3', { class: 'section' }, clearances.title),
    h('div', { class: 'tbl-wrap' }, h('table', { class: 'ntable' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Пара'), h('th', {}, 'мин, мм'))),
      h('tbody', {}, ...clearances.items.map((c) => h('tr', {},
        h('td', {}, c.title, h('div', { class: 'nsrc' }, c.source)),
        h('td', { class: 'n' }, normInput(c.id, 'min', c.min)),
      ))))),
    h('h3', { class: 'section' }, regulations.title),
    h('p', { class: 'nsrc' }, regulations.note),
    h('div', { class: 'tbl-wrap' }, h('table', { class: 'ntable' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Требование'), h('th', {}, 'мин'), h('th', {}, 'макс'))),
      h('tbody', {}, ...regulations.items.map((r) => {
        const rr = r as unknown as Record<string, number>;
        return h('tr', {},
          h('td', {}, r.title, h('div', { class: 'nsrc' }, r.source)),
          h('td', { class: 'n' }, rr.min !== undefined ? normInput(r.id, 'min', rr.min) : rr.minWidth !== undefined ? `${rr.minWidth}×${rr.minHeight}` : '—'),
          h('td', { class: 'n' }, rr.max !== undefined ? normInput(r.id, 'max', rr.max) : '—'));
      })))),
    h('h3', { class: 'section' }, materials.title),
    h('div', { class: 'tbl-wrap' }, h('table', { class: 'ntable' },
      h('thead', {}, h('tr', {}, h('th', {}, 'Марка'), h('th', {}, 'кг/м³'), h('th', {}, 'Предел текучести'))),
      h('tbody', {}, ...materials.items.map((m) => h('tr', {},
        h('td', {}, m.title, h('div', { class: 'nsrc' }, m.source)),
        h('td', { class: 'n num' }, m.density ? String(m.density) : '—'),
        h('td', { class: 'num' }, m.yield),
      ))))),
  );
}

const HP_LABELS: Record<string, string> = {
  xRoofFront: 'Верх лобового стекла X', xCowl: 'Низ лобового стекла X', xDoorFront: 'Проём двери: перед X', xDoorRear: 'Проём двери: зад X (стойка B)',
  xSlideFront: 'Сдвижная дверь: перед X', xSlideRear: 'Сдвижная дверь: зад X', zSill: 'Порог проёмов Z', zDoorBottom: 'Низ дверей Z', zBelt: 'Линия остекления у стойки A, Z', zBeltRear: 'Линия остекления у стойки B, Z',
  zRearSill: 'Задний проём: низ Z', zRearTop: 'Задний проём: верх Z', zBumperTop: 'Верх переднего бампера Z', yLampInner: 'Внутренний край фар Y',
  xNoseSeam: 'Шов носа и крыльев X', zGrilleTop: 'Верх решётки радиатора Z', roofRadius: 'Радиус скругления крыши', hoodRadius: 'Радиус кромок капота',
};
const VEH_LABELS: Record<string, string> = {
  length: 'Длина кузова без бамперов', width: 'Ширина', height: 'Высота', wheelbase: 'База', frontOverhang: 'Передний свес кузова (без бампера)', trackFront: 'Колея передняя',
  trackRear: 'Колея задняя', tireRadius: 'Радиус колеса', tireWidth: 'Ширина шины', archRadius: 'Радиус выреза арки', bodyBottom: 'Нижняя кромка кузова Z',
};

function bodyPane() {
  return h('div', { class: 'pane' },
    h('p', { class: 'hint' }, 'Общие размеры и базовые точки кузова. Все детали строятся от них: после изменения модель перестраивается целиком. Система координат: X — назад от передней оси, Y — вправо, Z — вверх от дороги, мм.'),
    h('h3', { class: 'section' }, 'Габариты и шасси'),
    h('div', { class: 'fields' }, ...Object.entries(project.vehicle).flatMap(([k, v]) => numberField(`${VEH_LABELS[k] ?? k}, мм`, v, (x) => { (project.vehicle as unknown as Record<string, number>)[k] = x; rebuildAll(); renderRight(); }))),
    h('h3', { class: 'section' }, 'Базовые точки'),
    h('div', { class: 'fields' }, ...Object.entries(project.hardpoints).flatMap(([k, v]) => numberField(`${HP_LABELS[k] ?? k}, мм`, v, (x) => { project.hardpoints[k] = x; rebuildAll(); renderRight(); }))),
  );
}

// ------------------------------------------------------------ сцена: подсказки и строка состояния
function renderHud() {
  const hud = $('hud');
  hud.querySelectorAll('.hud-card.fixed').forEach((n) => n.remove());
  if (ui.heat && ui.result) {
    hud.prepend(h('div', { class: 'hud-card fixed' },
      h('div', { class: 'k' }, 'Карта зазоров'),
      h('div', {}, h('span', { style: 'color:#16a34a' }, '● '), 'в норме  ', h('span', { style: 'color:#f59e0b' }, '● '), 'у границы (0,3 мм)  ', h('span', { style: 'color:#dc2626' }, '● '), 'вне нормы')));
  }
  const issue = ui.result?.issues.find((i) => i.id === ui.activeIssue);
  if (issue) {
    hud.prepend(h('div', { class: 'hud-card fixed' },
      h('div', { class: 'k' }, KIND_LABEL[issue.kind]),
      h('div', {}, issue.title),
      h('div', { class: 'mono' }, `${issue.value !== undefined ? `${fmt(issue.value)} мм · ` : ''}${issue.limit ?? ''}`),
      issue.pose && h('div', { class: 'mono' }, `положение: ${issue.pose.label}`),
      h('div', { class: 'mono', style: 'color:var(--muted)' }, `X ${Math.round(issue.at[0])} · Y ${Math.round(issue.at[1])} · Z ${Math.round(issue.at[2])} мм`),
    ));
  }
}

function renderStatus() {
  const sb = $('statusbar');
  const p = ui.hover?.p;
  const dist = ui.meas.length === 2 ? Math.hypot(ui.meas[0][0] - ui.meas[1][0], ui.meas[0][1] - ui.meas[1][1], ui.meas[0][2] - ui.meas[1][2]) : null;
  fill(sb, 
    h('span', {}, p ? h('span', {}, 'X ', h('b', {}, String(p[0])), '  Y ', h('b', {}, String(p[1])), '  Z ', h('b', {}, String(p[2])), ' мм') : 'Наведите на деталь — здесь будут координаты кузова'),
    ui.hover?.part && h('span', {}, h('b', {}, title(ui.hover.part))),
    ui.tool === 'measure' && h('span', {}, dist !== null ? h('span', {}, 'Расстояние ', h('b', {}, `${fmt(dist)} мм`)) : `Линейка: щёлкните ${ui.meas.length ? 'вторую' : 'первую'} точку`),
    ui.section.axis && h('span', {}, `Сечение ${ui.section.axis.toUpperCase()} = ${ui.section.pos} мм`),
  );
}

viewer.onHover = (p, part) => {
  ui.hover = { p, part };
  renderStatus();
};
viewer.onPick = (part, p) => {
  if (ui.tool === 'measure') {
    if (!p) return;
    ui.meas = ui.meas.length >= 2 ? [p] : [...ui.meas, p];
    viewer.showMeasure(ui.meas[0] ?? null, ui.meas[1] ?? null);
    renderStatus();
    return;
  }
  if (ui.activeIssue) clearIssue();
  select(part);
};

window.addEventListener('keydown', (e) => {
  const t = e.target as HTMLElement;
  if (t.closest('input, select, textarea')) return;
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); runChecks(); return; }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const views = ['iso', 'front', 'side', 'rear', 'top'] as const;
  if (/^[1-5]$/.test(e.key)) viewer.view(views[+e.key - 1]);
  else if (e.key === 'Escape') { ui.isolated = null; applyVisibility(); clearIssue(); select(null); }
  else if (e.key === 'h' && ui.selected) { ui.hiddenParts.add(ui.selected); applyVisibility(); renderLeft(); }
  else if (e.key === 'i' && ui.selected) { ui.isolated = ui.isolated ? null : new Set([ui.selected]); applyVisibility(); renderLeft(); }
  else if (e.key === 'f' && ui.selected) viewer.focusPart(ui.selected);
  else if (e.key === 'e') { ui.explode = ui.explode ? 0 : 0.6; viewer.setExplode(ui.explode); renderToolbar(); }
  else if (e.key === 'm') { ui.tool = ui.tool === 'measure' ? 'select' : 'measure'; ui.meas = []; viewer.showMeasure(null, null); renderToolbar(); renderStatus(); }
});

function renderAll() {
  renderToolbar();
  renderLeft();
  renderRight();
  renderHud();
  renderStatus();
  $('project-title').textContent = project.title.replace(' — кузов', '');
}

renderAll();
applyVisibility();
viewer.view('iso');

// Управление из консоли и для автоматических снимков экрана.
Object.assign(window, {
  app: {
    viewer, ui, runChecks, select, showIssue, renderAll, applyVisibility, rebuildAll,
    get project() { return project; },
    get result() { return ui.result; },
  },
});
