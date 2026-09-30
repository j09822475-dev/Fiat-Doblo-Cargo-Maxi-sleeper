// Проект по умолчанию: Fiat Doblò Cargo Maxi (кузов 263, L2H1), цельнометаллический фургон.
// Габариты: 4740 × 1832 × 1845 мм, база 3105 мм — по техническим данным и чертежу
// Doblò 2015 Cargo LWB. Остальные размеры — оценка по чертежу и фото.
import type { Assembly, Joint, LayerDef, PartDef, Project, Rule, Vec3 } from '../core/types';
import { BodyForm, DEFAULT_HARDPOINTS } from '../geometry/bodyform';
import gaps from '../../data/norms/gaps.json';

export const LAYERS: LayerDef[] = [
  { id: 'biw', title: 'Каркас кузова (BIW)', color: '#8a95a3' },
  { id: 'outer', title: 'Наружные панели', color: '#e7e9ec' },
  { id: 'closures', title: 'Двери, капот, створки', color: '#c9d6e3' },
  { id: 'glazing', title: 'Остекление', color: '#6fa3c7' },
  { id: 'lighting', title: 'Светотехника', color: '#f0b429' },
  { id: 'trim', title: 'Бамперы и наружная отделка', color: '#3a3f46' },
  { id: 'chassis', title: 'Шасси и колёса', color: '#26292e' },
  { id: 'powertrain', title: 'Силовой агрегат', color: '#b5651d' },
  { id: 'interior', title: 'Интерьер', color: '#7c6f9b' },
  { id: 'seals', title: 'Уплотнители', color: '#2f855a' },
];

const ASSEMBLIES: Assembly[] = [
  { id: 'vehicle', title: 'Fiat Doblò Cargo Maxi', parent: null },
  { id: 'body', title: 'Кузов', parent: 'vehicle' },
  { id: 'biw', title: 'Кузов в белом', parent: 'body' },
  { id: 'side-l', title: 'Боковина левая', parent: 'biw' },
  { id: 'side-r', title: 'Боковина правая', parent: 'biw' },
  { id: 'underbody', title: 'Основание (пол)', parent: 'biw' },
  { id: 'roof-asm', title: 'Крыша', parent: 'biw' },
  { id: 'front-end', title: 'Передок', parent: 'biw' },
  { id: 'rear-end', title: 'Задок', parent: 'biw' },
  { id: 'closures', title: 'Навесные детали', parent: 'body' },
  { id: 'door-fl', title: 'Дверь передняя левая', parent: 'closures' },
  { id: 'door-fr', title: 'Дверь передняя правая', parent: 'closures' },
  { id: 'slide-l', title: 'Дверь сдвижная левая', parent: 'closures' },
  { id: 'slide-r', title: 'Дверь сдвижная правая', parent: 'closures' },
  { id: 'rear-doors', title: 'Задние створки', parent: 'closures' },
  { id: 'hood-asm', title: 'Капот', parent: 'closures' },
  { id: 'exterior', title: 'Наружное оборудование', parent: 'body' },
  { id: 'lighting', title: 'Светотехника', parent: 'exterior' },
  { id: 'bumpers', title: 'Бамперы и облицовка', parent: 'exterior' },
  { id: 'glazing', title: 'Остекление', parent: 'body' },
  { id: 'chassis', title: 'Шасси', parent: 'vehicle' },
  { id: 'powertrain', title: 'Силовой агрегат', parent: 'vehicle' },
  { id: 'interior', title: 'Интерьер', parent: 'vehicle' },
];

const gapNom = (id: string) => gaps.items.find((g) => g.id === id)!.gap.nom;

export function createDobloProject(): Project {
  // Паспортные данные Doblò Cargo Maxi (2015, техническая спецификация Fiat Professional):
  // габарит 4756 мм, база 3105 мм, свесы 911 / 740 мм. Здесь length и frontOverhang — по кузову
  // без бамперов (передний бампер выступает на ~23 мм, задний — на 85 мм: по чертежу он образует ступеньку под створками).
  const vehicle = {
    length: 4648,
    width: 1832,
    height: 1845,
    wheelbase: 3105,
    frontOverhang: 888,
    trackFront: 1510,
    trackRear: 1530,
    tireRadius: 320,
    tireWidth: 195,
    archRadius: 400,
    bodyBottom: 275,
  };
  const hp = { ...DEFAULT_HARDPOINTS };
  const f = new BodyForm(vehicle, hp);
  const parts: PartDef[] = [];
  const add = (
    id: string, title: string, layer: PartDef['layer'], assembly: string, generator: string,
    params: Record<string, number>, material: string, thickness: number, joint: Joint = { type: 'fixed' }, role?: string,
  ) => parts.push({ id, title, layer, assembly, generator, params, material, thickness, joint, status: 'draft', role });

  const LR: [string, number, string][] = [['l', -1, 'левая'], ['r', 1, 'правая']];
  const LRm: [string, number, string][] = [['l', -1, 'левый'], ['r', 1, 'правый']];
  const LRn: [string, number, string][] = [['l', -1, 'левое'], ['r', 1, 'правое']];

  // ---- каркас и наружные панели
  for (const [k, s, t] of LR) {
    add(`side-outer-${k}`, `Боковина наружная ${t}`, 'outer', `side-${k}`, 'sideOuter', { side: s }, 'DC04', 0.8);
    add(`b-pillar-${k}`, `Стойка B ${t}`, 'biw', `side-${k}`, 'bPillar', { side: s }, 'HX340LAD', 1.5);
  }
  for (const [k, s, t] of LRm) {
    add(`sill-${k}`, `Порог ${t}`, 'biw', `side-${k}`, 'sill', { side: s }, 'DP600', 1.5);
    add(`wheelhouse-rear-${k}`, `Арка заднего колеса ${t === 'левый' ? 'левая' : 'правая'}`, 'biw', 'underbody', 'wheelhouseRear', { side: s, radius: 410, inner: 600 }, 'DC03', 1.0);
    add(`front-rail-${k}`, `Лонжерон передний ${t}`, 'biw', 'front-end', 'frontRail', { side: s }, 'DP600', 2.0);
  }
  add('roof', 'Крыша', 'outer', 'roof-asm', 'roof', {}, 'DX54D', 0.8);
  for (const [i, x] of [1600, 2300, 3000].entries()) {
    add(`roof-bow-${i + 1}`, `Дуга крыши ${i + 1}`, 'biw', 'roof-asm', 'roofBow', { x }, 'HX340LAD', 1.2);
  }
  add('floor-front', 'Пол кабины', 'biw', 'underbody', 'floorFront', {}, 'DC03', 1.0);
  add('floor-cargo', 'Пол грузового отсека', 'biw', 'underbody', 'floorCargo', {}, 'DC03', 1.0);
  add('firewall', 'Щит моторного отсека', 'biw', 'front-end', 'firewall', {}, 'DC03', 1.0);
  add('radiator-support', 'Рамка радиатора', 'biw', 'front-end', 'radiatorSupport', {}, 'HX340LAD', 1.2);
  add('rear-frame', 'Панель задка (рамка проёма)', 'outer', 'rear-end', 'rearFrame', {}, 'DC04', 0.8);
  for (const [k, s, t] of LRn) {
    add(`fender-${k}`, `Крыло переднее ${t}`, 'outer', 'front-end', 'fender', { side: s, gapLamp: 2.5, gapBumper: gapNom('bumper-body') }, 'DC04', 0.7);
  }

  // ---- навесные детали
  const doorGap = gapNom('door-body');
  for (const [k, s, t] of LR) {
    const hingeY = s * (f.halfWidth(hp.xDoorFront, 800) + 25);
    add(`door-f${k}`, `Дверь передняя ${t}`, 'closures', `door-f${k}`, 'frontDoor', { side: s, gap: doorGap, depth: 100, frontBevel: 0.9, archGap: 0 }, 'DC04', 0.75, {
      type: 'hinge', origin: [hp.xDoorFront + doorGap + 20, hingeY, 0], axis: [0, 0, s], min: 0, max: 70, open: 65,
    });
    add(`glass-f${k}`, `Стекло двери передней ${t === 'левая' ? 'левой' : 'правой'}`, 'glazing', `door-f${k}`, 'frontDoorGlass', { side: s, gap: doorGap }, 'GLASS', 4, { type: 'mounted', to: `door-f${k}` });
    add(`mirror-${k}`, `Зеркало наружное ${t === 'левая' ? 'левое' : 'правое'}`, 'trim', `door-f${k}`, 'mirror', { side: s }, 'PP-EPDM', 2.5, { type: 'mounted', to: `door-f${k}` });
    add(`moulding-f${k}`, `Молдинг двери ${t === 'левая' ? 'левой' : 'правой'}`, 'trim', `door-f${k}`, 'moulding', { side: s, gap: doorGap }, 'PP-EPDM', 2.5, { type: 'mounted', to: `door-f${k}` });
    add(`door-seal-${k}`, `Уплотнитель проёма двери ${t === 'левая' ? 'левой' : 'правой'} (стойка B)`, 'seals', `side-${k}`, 'doorSeal', { side: s }, 'RUBBER', 2);
  }
  // сдвижные двери с обеих сторон — как на чертеже Doblò 2015 Cargo LWB
  for (const [k, s, t] of LR) {
    add(`slide-${k}`, `Дверь сдвижная ${t}`, 'closures', `slide-${k}`, 'slideDoor', { side: s, gap: gapNom('slide-body'), depth: 70 }, 'DC04', 0.75, {
      type: 'slide', out: [0, s * 85, 0], travel: [980, 0, 0], outShare: 0.18,
    });
    add(`moulding-s${k}`, `Молдинг сдвижной двери ${t === 'левая' ? 'левой' : 'правой'}`, 'trim', `slide-${k}`, 'moulding', { side: s, gap: gapNom('slide-body'), slide: 1, end: 2280 }, 'PP-EPDM', 2.5, { type: 'mounted', to: `slide-${k}` });
  }
  const rg = gapNom('rear-doors');
  for (const [k, s, t] of LR) {
    add(`rear-door-${k}`, `Створка задняя ${t}`, 'closures', 'rear-doors', 'rearDoor', { side: s, gap: rg, gapCenter: rg, split: 110, depth: 60 }, 'DC04', 0.75, {
      type: 'hinge', origin: [f.xRear + 20, s * (f.rearEdge(1000) + 12), 0], axis: [0, 0, s], min: 0, max: 180, open: 90,
    });
  }
  // ось петель капота — на уровне его поверхности: при открывании задняя кромка
  // поднимается и почти не уходит назад, к стойкам и стеклу
  add('hood', 'Капот', 'closures', 'hood-asm', 'hood', { gap: gapNom('hood-fender'), depth: 45, flange: 1.5 }, 'DC04', 0.7, {
    type: 'hinge', origin: [hp.xCowl - 40, 0, f.topLine(hp.xCowl - 40) + 25], axis: [0, 1, 0], min: 0, max: 55, open: 50,
  });

  // ---- остекление, светотехника, облицовка
  add('windshield', 'Стекло ветровое', 'glazing', 'glazing', 'windshield', { gap: 3 }, 'GLASS', 5);
  for (const [k, s, t] of LRm) {
    add(`headlamp-${k}`, `Фара ${t === 'левый' ? 'левая' : 'правая'}`, 'lighting', 'lighting', 'headlamp', { side: s, gap: 3, depth: 60 }, 'PC', 2.5, { type: 'fixed' }, 'headlamp');
    add(`tail-${k}`, `Фонарь задний ${t}`, 'lighting', 'lighting', 'tailLamp', { side: s, gap: 3, depth: 40 }, 'PC', 2.5, { type: 'fixed' }, 'tailLamp');
    add(`fog-${k}`, `Фара противотуманная ${t === 'левый' ? 'левая' : 'правая'}`, 'lighting', 'lighting', 'fogLamp', { side: s, y: 720, z: 440 }, 'PC', 2.5, { type: 'fixed' }, 'fogFront');
    add(`liner-front-${k}`, `Подкрылок передний ${t}`, 'trim', 'bumpers', 'wheelLinerFront', { side: s, radius: 410, inner: 430 }, 'PP-EPDM', 2.5);
  }
  add('chmsl', 'Стоп-сигнал дополнительный', 'lighting', 'lighting', 'chmsl', {}, 'PC', 2.5, { type: 'fixed' }, 'chmsl');
  add('grille', 'Решётка радиатора', 'trim', 'bumpers', 'grille', { gap: 3, gapBumper: 1.5, depth: 40 }, 'PP-EPDM', 2.5);
  add('bumper-front', 'Бампер передний', 'trim', 'bumpers', 'bumperFront', { gapLamp: 2.0, depth: 50 }, 'PP-EPDM', 3);
  add('bumper-rear', 'Бампер задний', 'trim', 'bumpers', 'bumperRear', { protrusion: 85 }, 'PP-EPDM', 3);
  add('plate-front', 'Площадка переднего номера', 'trim', 'bumpers', 'plateFront', {}, 'PP-EPDM', 2.5);
  add('plate-rear', 'Место заднего номерного знака', 'trim', 'rear-doors', 'plateRear', {}, 'PP-EPDM', 2.5, { type: 'mounted', to: 'rear-door-l' }, 'plateRear');

  // ---- шасси, агрегат, интерьер
  for (const [axle, an] of [[0, 'передн'], [1, 'задн']] as [number, string][]) {
    for (const [k, s, t] of LRn) {
      const x = axle === 0 ? 0 : vehicle.wheelbase;
      const tr = axle === 0 ? vehicle.trackFront : vehicle.trackRear;
      const center: Vec3 = [x, (s * tr) / 2, vehicle.tireRadius];
      add(`wheel-${axle === 0 ? 'f' : 'r'}${k}`, `Колесо ${an}ее ${t} 195/60 R16`, 'chassis', 'chassis', 'wheel', { axle, side: s }, 'ENVELOPE', 0, {
        type: 'wheel', center, steer: axle === 0 ? 35 : 0, bump: 70, rebound: 80,
      });
    }
  }
  add('engine', 'Двигатель с КПП (габарит)', 'powertrain', 'powertrain', 'engine', {}, 'ENVELOPE', 0);
  add('instrument-panel', 'Панель приборов', 'interior', 'interior', 'instrumentPanel', {}, 'PP-EPDM', 3);
  add('steering-wheel', 'Рулевое колесо', 'interior', 'interior', 'steeringWheel', { x: 790, z: 1060 }, 'ENVELOPE', 0);
  for (const [k, s, t] of LRn) {
    add(`seat-${k}`, `Сиденье ${t} (крайнее заднее положение)`, 'interior', 'interior', 'seat', { side: s, x: 1020, recline: 0.2 }, 'ENVELOPE', 0);
  }
  add('bulkhead', 'Перегородка кабины', 'interior', 'interior', 'bulkhead', { x: 1545 }, 'DC03', 1.5);

  // ---- конструктивные соединения (сварка, болты, клей): коллизии между ними не ищутся
  const joined: [string, string][] = [];
  const j = (a: string, b: string) => joined.push([a, b]);
  for (const k of ['l', 'r']) {
    j(`side-outer-${k}`, 'roof');
    j(`side-outer-${k}`, `fender-${k}`);
    j(`side-outer-${k}`, 'rear-frame');
    j(`side-outer-${k}`, 'windshield');
    j(`side-outer-${k}`, `sill-${k}`);
    j(`side-outer-${k}`, `b-pillar-${k}`);
    j(`side-outer-${k}`, `wheelhouse-rear-${k}`);
    j(`side-outer-${k}`, 'bulkhead');
    j(`side-outer-${k}`, 'floor-cargo');
    j(`side-outer-${k}`, 'floor-front');
    j(`side-outer-${k}`, 'firewall');
    j(`sill-${k}`, 'floor-front');
    j(`sill-${k}`, 'floor-cargo');
    j(`b-pillar-${k}`, 'bulkhead');
    j(`b-pillar-${k}`, `sill-${k}`);
    j(`b-pillar-${k}`, 'floor-cargo');
    j(`b-pillar-${k}`, `door-seal-${k}`);
    j(`wheelhouse-rear-${k}`, 'floor-cargo');
    j(`front-rail-${k}`, 'firewall');
    j(`front-rail-${k}`, 'radiator-support');
    j(`front-rail-${k}`, 'floor-front');
    j(`fender-${k}`, `liner-front-${k}`);
    j(`fender-${k}`, 'radiator-support');
    j(`fender-${k}`, `headlamp-${k}`);
    j(`bumper-front`, `liner-front-${k}`);
    j(`bumper-front`, `fog-${k}`);
    j(`headlamp-${k}`, 'radiator-support');
    j(`tail-${k}`, 'rear-frame');
    j(`tail-${k}`, `side-outer-${k}`);
    j(`seat-${k}`, 'floor-front');
    j(`liner-front-${k}`, `front-rail-${k}`);
    j(`liner-front-${k}`, 'firewall');
    j(`liner-front-${k}`, 'radiator-support');
    for (const i of [1, 2, 3]) {
      j(`roof-bow-${i}`, `side-outer-${k}`);
    }
  }
  for (const i of [1, 2, 3]) j(`roof-bow-${i}`, 'roof');
  j('roof', 'rear-frame');
  j('roof', 'windshield');
  j('roof', 'bulkhead');
  j('floor-front', 'firewall');
  j('floor-front', 'floor-cargo');
  j('floor-cargo', 'bulkhead');
  j('floor-cargo', 'rear-frame');
  j('firewall', 'instrument-panel');
  j('radiator-support', 'bumper-front');
  j('radiator-support', 'grille');
  j('bumper-front', 'plate-front');
  j('rear-frame', 'chmsl');
  j('rear-frame', 'bumper-rear');
  j('engine', 'firewall');

  // ---- правила проверки
  const rules: Rule[] = [];
  let n = 0;
  const gap = (a: string, b: string, norm: string) => rules.push({ id: `g${++n}`, kind: 'gap', a, b, norm });
  for (const k of ['l', 'r']) {
    gap(`door-f${k}`, `fender-${k}`, 'door-body');
    gap(`door-f${k}`, `side-outer-${k}`, 'door-body');
    gap('hood', `fender-${k}`, 'hood-fender');
    gap('hood', `headlamp-${k}`, 'lamp-body');
    gap(`headlamp-${k}`, `fender-${k}`, 'lamp-body');
    gap(`headlamp-${k}`, 'bumper-front', 'bumper-body');
    gap('bumper-front', `fender-${k}`, 'bumper-body');
    gap(`tail-${k}`, `side-outer-${k}`, 'lamp-body');
    gap(`tail-${k}`, 'rear-frame', 'lamp-body');
    gap(`rear-door-${k}`, 'rear-frame', 'rear-doors');
  }
  for (const k of ['l', 'r']) gap(`slide-${k}`, `side-outer-${k}`, 'slide-body');
  gap('rear-door-l', 'rear-door-r', 'rear-doors');
  rules.push({ id: `c${++n}`, kind: 'clearance', a: 'engine', b: 'hood', norm: 'engine-hood' });
  for (const k of ['l', 'r']) rules.push({ id: `c${++n}`, kind: 'clearance', a: `seat-${k}`, b: 'bulkhead', norm: 'seat-bulkhead' });
  for (const id of ['door-fl', 'door-fr', 'slide-l', 'slide-r', 'rear-door-l', 'rear-door-r', 'hood']) {
    rules.push({ id: `m${++n}`, kind: 'motion', part: id, norm: 'moving-panel' });
  }
  for (const id of ['wheel-fl', 'wheel-fr', 'wheel-rl', 'wheel-rr']) {
    rules.push({ id: `m${++n}`, kind: 'motion', part: id, norm: 'tire-body' });
  }

  return {
    format: 'doblo-body/1',
    title: 'Fiat Doblò Cargo Maxi — кузов',
    vehicle,
    hardpoints: hp as unknown as Record<string, number>,
    layers: LAYERS,
    assemblies: ASSEMBLIES,
    parts,
    joined,
    rules,
    overrides: [],
  };
}
