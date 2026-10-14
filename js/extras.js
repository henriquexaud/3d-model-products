import * as THREE from 'three';
import { X0, layers } from './config.js';
import { mats, emblem } from './materials.js';
import { G, M, carve } from './layers.js';
import { V, S, rod, cyl, rbox, beam, tube, polyPipe, mergeMeshes } from './geometry.js';
import { ENGINE } from './mechanics.js';

// ---------- Detalhes de funcionamento ----------
// O que completa os sistemas do carro (acessórios do motor, fiação, ar-condicionado, limpador, pedais) e as peças
// que se mexem com ele ligado: polias, eletroventiladores, pedais e o próprio motor, que balança nos coxins
const { CY, ZC, zCyl, bankZ } = ENGINE;
const FRONT_FACE = 0.5505;   // plano logo à frente das polias
const spinning = [];         // { group, ratio }: giram com o virabrequim, cada um na sua relação
const fans = [];
const pedals = {};
const helm = { pivot: null, axis: new THREE.Vector3() };   // o volante: o grupo que gira e o eixo da coluna
let fanSpeed = 0, clock = 0;

// Referencial de uma bancada de cilindros: +y segue o eixo dos cilindros e +x aponta para o lado do escape
function bank(g, s) {
  const side = new THREE.Group(), b = new THREE.Group();
  side.scale.x = s;
  side.position.set(0, CY, bankZ(s));
  b.rotation.z = -Math.PI / 4;
  side.add(b);
  g.add(side);
  return b;
}
const bankPoint = (s, x, y, z) => V(s * (x + y) * Math.SQRT1_2, CY + (y - x) * Math.SQRT1_2, z + bankZ(s));
// Grupo que gira em torno de z, com as peças fundidas em poucas malhas
function rotor(parent, x, y, z, parts) {
  const group = new THREE.Group();
  group.position.set(x, y, z);
  parent.add(group);
  group.add(...parts);
  mergeMeshes(group);
  return group;
}
const ring = (n, r, make, phase = 0) => Array.from({ length: n }, (_, k) => make(Math.cos(phase + k * 2 * Math.PI / n) * r, Math.sin(phase + k * 2 * Math.PI / n) * r));

function buildEngine() {
  const g = G('engine'), m = mats('engine');
  for (const s of S) {
    const b = bank(g, s);
    for (const z of zCyl) b.add(rbox(0.030, 0.016, 0.022, 0.005, 0.402, z, m.black, 0.004));        // conectores das bobinas
    for (let k = -2; k <= 2; k++) for (const x of [-0.098, 0.108]) b.add(cyl(0.005, 0.008, 'y', x, 0.349, ZC + k * 0.105, m.steel, 6));   // parafusos da tampa de válvulas
    // respiro da tampa de válvulas até o coletor de admissão, corpo de borboleta e medidor de ar
    g.add(tube([[s * 0.215, 0.60, 0.69 + bankZ(s)], [s * 0.19, 0.68, 0.70], [s * 0.13, 0.74, 0.705], [s * 0.105, 0.765, 0.715]], 0.007, m.rubber, 6));
    g.add(rbox(0.045, 0.05, 0.04, s * 0.16, 0.775, 1.09, m.black, 0.006));
    g.add(rbox(0.03, 0.03, 0.05, s * 0.215, 0.79, 1.235, m.black, 0.005));
    // coxim: braço sob os tubos de escape, apoiado em borracha na longarina
    g.add(rbox(0.25, 0.022, 0.07, s * 0.265, 0.214, 0.90, m.alu, 0.006));
    g.add(rbox(0.05, 0.05, 0.09, s * 0.385, 0.232, 0.90, m.rubber, 0.01));
    g.add(rbox(0.004, 0.20, 0.42, s * 0.405, 0.38, 0.92, m.aluSatin, 0.002));                       // defletor de calor entre o escape e o tanque
  }
  // cárter seco: tampa rasa sob o bloco, bomba de recalque e as duas linhas até o reservatório de óleo
  g.add(rbox(0.25, 0.022, 0.46, 0, 0.206, ZC, m.alu, 0.008));
  g.add(cyl(0.01, 0.006, 'y', 0.05, 0.197, ZC + 0.1, m.steel, 6));
  g.add(cyl(0.032, 0.12, 'z', -0.165, 0.245, 1.03, m.alu, 16));
  g.add(polyPipe([[-0.165, 0.245, 1.09], [-0.20, 0.25, 1.11], [-0.24, 0.30, 1.13], [-0.24, 0.39, 1.17], [-0.22, 0.41, 1.19]], 0.008, m.steel, 0.03, 6));
  g.add(polyPipe([[-0.14, 0.235, 1.09], [-0.19, 0.228, 1.12], [-0.265, 0.28, 1.14], [-0.265, 0.385, 1.185], [-0.245, 0.41, 1.20]], 0.008, m.steel, 0.03, 6));
  // parafusos da tampa dianteira
  for (const [x, y] of [[0.13, -0.095], [0.145, -0.02], [0.215, 0.07], [0.29, 0.15], [0.16, 0.275], [0.055, 0.19]]) {
    for (const s of S) g.add(cyl(0.006, 0.008, 'z', s * x, CY + y, 0.582, m.steel, 6));
  }

  // faces das polias: são elas que mostram o giro. Virabrequim, bomba d'água e compressor do ar-condicionado
  const mv = M('engine'), disc = (r, mat) => cyl(r, 0.003, 'z', 0, 0, 0, mat, 24);
  const bolts = (n, r, size) => ring(n, r, (x, y) => cyl(size, 0.006, 'z', x, y, -0.003, m.steel, 6));
  spinning.push({ ratio: 1, group: rotor(mv, 0, CY, FRONT_FACE, [disc(0.062, m.darkSteel), cyl(0.016, 0.012, 'z', 0, 0, -0.005, m.steel, 6),
    ...bolts(6, 0.04, 0.005), rbox(0.014, 0.004, 0.004, 0.07, 0, 0, m.aluSatin, 0.001)]) });
  spinning.push({ ratio: 1.6, group: rotor(mv, 0, 0.50, FRONT_FACE, [disc(0.036, m.darkSteel), ...bolts(4, 0.022, 0.004), cyl(0.008, 0.01, 'z', 0, 0, -0.004, m.steel, 6)]) });
  spinning.push({ ratio: 1.6, group: rotor(mv, -0.245, 0.30, FRONT_FACE, [disc(0.04, m.steel), ...bolts(3, 0.026, 0.005), cyl(0.011, 0.012, 'z', 0, 0, -0.005, m.darkSteel, 6)]) });

  // sondas de oxigênio no escape, antes e depois de cada catalisador
  const x = mats('exhaust');
  for (const s of S) {
    G('exhaust').add(rod(V(s * 0.3275, 0.305, 1.22), V(s * 0.338, 0.36, 1.22), 0.008, x.steel, 0.008, 8));
    G('exhaust').add(rod(V(s * 0.27, 0.34, 1.825), V(s * 0.27, 0.395, 1.825), 0.008, x.steel, 0.008, 8));
    G('exhaust').add(rbox(0.05, 0.045, 0.04, s * 0.165, 0.555, 2.04, x.black, 0.006));              // atuador da válvula do escape
  }
}

function buildElectrics() {
  const g = G('electric'), m = mats('electric');
  // caixa de fusíveis sem a tampa: três fileiras de fusíveis coloridos e os relés
  const tones = [m.cable, m.blue, m.yellow, m.green, m.white];
  for (let i = 0; i < 9; i++) for (let k = 0; k < 3; k++) g.add(rbox(0.011, 0.010, 0.004, 0.135 + i * 0.016, 0.409, -1.275 + k * 0.02, tones[(i * 2 + k) % 5], 0.001));
  for (let k = 0; k < 3; k++) g.add(rbox(0.026, 0.024, 0.026, 0.292, 0.416, -1.272 + k * 0.032, m.black, 0.003));
  // bateria: trava, cabo até a caixa de fusíveis e malha de aterramento na estrutura
  g.add(rbox(0.20, 0.012, 0.02, 0.22, 0.414, -1.565, m.steel, 0.003));
  g.add(polyPipe([[0.24, 0.43, -1.47], [0.24, 0.44, -1.36], [0.24, 0.41, -1.305]], 0.006, m.cable, 0.02, 6));
  g.add(polyPipe([[0.20, 0.43, -1.66], [0.20, 0.47, -1.70], [0.20, 0.50, -1.715]], 0.006, m.steel, 0.02, 6));
  // chicote dianteiro: da caixa de fusíveis até a travessa, e dela para os faróis, os eletroventiladores e as buzinas
  g.add(polyPipe([[0.20, 0.405, -1.305], [0.14, 0.44, -1.38], [0.11, 0.47, -1.55], [0.11, 0.545, -1.70], [0.11, 0.545, -1.745]], 0.009, m.black, 0.03, 6));
  g.add(rod(V(-0.47, 0.545, -1.745), V(0.47, 0.545, -1.745), 0.008, m.black, 0.008, 6));
  for (const s of S) {
    g.add(polyPipe([[s * 0.47, 0.545, -1.745], [s * 0.56, 0.56, -1.74], [s * 0.64, 0.585, -1.735], [s * 0.68, 0.60, -1.75]], 0.006, m.black, 0.02, 6));
    g.add(polyPipe([[s * 0.40, 0.545, -1.745], [s * 0.42, 0.50, -1.78], [s * 0.485, 0.39, -1.815]], 0.005, m.black, 0.02, 6));
    g.add(cyl(0.027, 0.06, 'z', s * 0.68, 0.61, -1.805, m.aluSatin, 16));                           // projetor do farol, atrás da lente
    g.add(rbox(0.05, 0.05, 0.025, s * 0.68, 0.61, -1.765, m.black, 0.004));
    g.add(cyl(0.045, 0.028, 'z', s * 0.27, 0.285, -1.985, m.black, 20));                            // buzina
    g.add(cyl(0.016, 0.02, 'z', s * 0.27, 0.285, -2.005, m.darkSteel, 12));
    g.add(polyPipe([[s * 0.27, 0.33, -1.985], [s * 0.27, 0.42, -1.90], [s * 0.30, 0.52, -1.78], [s * 0.30, 0.545, -1.745]], 0.004, m.black, 0.02, 5));
    // chicote das bobinas ao longo de cada bancada, até a central do motor
    const b = bank(g, s);
    b.add(rod(V(0.06, 0.385, ZC - 0.19), V(0.06, 0.385, ZC + 0.19), 0.006, m.black, 0.006, 6));
    for (const z of zCyl) b.add(rod(V(0.06, 0.385, z), V(0.02, 0.402, z), 0.004, m.black, 0.004, 5));
    g.add(polyPipe([bankPoint(s, 0.06, 0.385, ZC - 0.19), V(s * 0.30, 0.60, 0.60), V(s * 0.26, 0.615, 0.572)], 0.006, m.black, 0.02, 6));
    // chicote traseiro: sobre a longarina, até as lanternas
    g.add(polyPipe([[s * 0.30, 0.70, 0.585], [s * 0.40, 0.80, 0.60], [s * 0.455, 0.835, 0.66], [s * 0.455, 0.835, 1.93], [s * 0.50, 0.815, 2.01],
      [s * 0.60, 0.82, 2.06]], 0.007, m.black, 0.03, 6));
    g.add(rbox(0.035, 0.025, 0.03, s * 0.615, 0.82, 2.07, m.black, 0.004));
    // alto-falante dentro da porta
    g.add(cyl(0.075, 0.03, 'x', s * 0.845, 0.40, -0.30, m.black, 24));
    g.add(cyl(0.04, 0.03, 'x', s * 0.875, 0.40, -0.30, m.darkSteel, 16));
  }
  // cabo do alternador ao motor de partida e malha de aterramento do motor
  g.add(polyPipe([[0.245, 0.36, 0.705], [0.235, 0.30, 0.745], [0.215, 0.232, 0.80], [0.215, 0.232, 1.04], [0.215, 0.29, 1.10]], 0.006, m.cable, 0.03, 6));
  g.add(polyPipe([[-0.15, 0.26, 0.70], [-0.25, 0.215, 0.705], [-0.40, 0.245, 0.71]], 0.006, m.steel, 0.03, 6));
  // limpador de para-brisa: motor, redutor e a haste que liga os dois eixos
  g.add(cyl(0.032, 0.08, 'x', -0.08, 0.71, -1.255, m.darkSteel, 14));
  g.add(rbox(0.06, 0.045, 0.06, -0.015, 0.71, -1.255, m.alu, 0.008));
  g.add(rod(V(-0.015, 0.735, -1.25), V(0.05, 0.75, -1.235), 0.006, m.steel, 0.006, 6));
  g.add(rod(V(-0.33, 0.75, -1.235), V(0.33, 0.75, -1.235), 0.006, m.steel, 0.006, 6));
  for (const s of S) g.add(cyl(0.012, 0.04, 'y', s * 0.33, 0.762, -1.235, m.steel, 10));
  // reservatório do lavador, com a bomba e a mangueira até o para-brisa
  g.add(rbox(0.10, 0.16, 0.14, -0.30, 0.52, -1.62, m.white, 0.02));
  g.add(cyl(0.022, 0.015, 'y', -0.30, 0.607, -1.60, m.blue, 14));
  g.add(cyl(0.014, 0.04, 'y', -0.265, 0.455, -1.54, m.black, 10));
  g.add(tube([[-0.265, 0.475, -1.54], [-0.33, 0.60, -1.46], [-0.36, 0.69, -1.38], [-0.35, 0.72, -1.36]], 0.004, m.rubber, 5));
  // face da polia do alternador, que gira com as outras
  spinning.push({ ratio: 2.67, group: rotor(M('electric'), 0.245, 0.30, FRONT_FACE, [cyl(0.022, 0.003, 'z', 0, 0, 0, m.darkSteel, 18), cyl(0.009, 0.01, 'z', 0, 0, -0.004, m.steel, 6),
    ...ring(5, 0.014, (x, y) => cyl(0.003, 0.005, 'z', x, y, -0.002, m.steel, 6))]) });
}

function buildClimate() {
  const g = G('cooling'), m = mats('cooling');
  // ar-condicionado: condensador à frente do radiador esquerdo, filtro secador e as duas linhas até o compressor, pelo túnel
  const front = new THREE.Group();
  front.position.set(-0.50, 0.37, -1.88);
  front.rotation.order = 'YXZ';
  front.rotation.set(0.22, 0.25, 0);
  g.add(front);
  front.add(new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.26, 0.016), m.core));
  front.children[0].position.z = -0.045;
  for (const e of S) front.add(rbox(0.018, 0.26, 0.022, e * 0.199, 0, -0.045, m.aluSatin, 0.004));
  g.add(cyl(0.022, 0.20, 'y', -0.27, 0.40, -1.80, m.aluSatin, 14));
  const route = (y, x, r) => g.add(polyPipe([[-0.30, 0.44 + y, -1.84], [-0.20, 0.45 + y, -1.78], [-0.09, 0.45 + y, -1.70], [-0.055, 0.45 + y, -1.42],
    [-0.055, 0.45 + y, -1.25], [-0.055, 0.37 + y, -1.10], [x, 0.336 + y, -1.03], [x, 0.336 + y, 0.40], [-0.09, 0.31 + y, 0.50], [-0.20, 0.30 + y, 0.56],
    [-0.245, 0.335 + y, 0.60]], r, m.aluSatin, 0.03, 6));
  route(0, -0.050, 0.005);
  route(-0.018, -0.054, 0.007);

  // eletroventiladores: as pás giram atrás de cada radiador
  for (const s of S) {
    const holder = new THREE.Group(), blades = [];
    holder.position.set(s * 0.50, 0.37, -1.88);
    holder.rotation.order = 'YXZ';
    holder.rotation.set(0.22, -s * 0.25, 0);
    M('cooling').add(holder);
    for (let k = 0; k < 7; k++) {
      const a = k * Math.PI * 2 / 7, blade = new THREE.Mesh(new THREE.BoxGeometry(0.095, 0.036, 0.003), m.black);
      blade.position.set(Math.cos(a) * 0.082, Math.sin(a) * 0.082, 0);
      blade.rotation.z = a;
      blade.rotateX(0.5);
      blades.push(blade);
    }
    fans.push(rotor(holder, 0, 0, 0.05, blades));
  }
}

function buildCabin() {
  const g = G('interior'), m = mats('interior'), cabin = layers.interior.group;
  for (const s of S) {
    g.add(rbox(0.40, 0.006, 0.50, s * 0.30, 0.2235, -0.72, m.carpet, 0.003));                       // tapetes
    for (const dx of [-0.15, 0.15]) g.add(rbox(0.03, 0.022, 0.46, s * 0.36 + dx, 0.232, -0.05, m.steel, 0.004));   // trilhos dos bancos
    G('chassis').add(rod(V(s * 0.89, 0.50, -0.70), V(s * 0.895, 0.47, 0.45), 0.018, mats('chassis').steel, 0.018, 10));   // barra de proteção dentro da porta
  }
  g.add(rbox(0.15, 0.003, 0.11, -0.24, 0.228, -0.83, m.rubber, 0.001));                             // reforço sob o calcanhar
  // apoio do pé esquerdo, inclinado, com três frisos de borracha
  const foot = [V(-0.455, 0.226, -0.93), V(-0.455, 0.345, -1.05)];
  g.add(beam(foot[0], foot[1], 0.09, 0.006, m.aluSatin));
  for (const t of [0.25, 0.5, 0.75]) {
    const at = foot[0].clone().lerp(foot[1], t);
    g.add(rbox(0.08, 0.006, 0.008, at.x, at.y + 0.004, at.z + 0.003, m.rubber, 0.002));
  }

  // os pedais já vêm no modelo; aqui eles ganham dobradiça para acompanhar o pé do motorista
  const hinge = (at, pieces) => {
    const pivot = new THREE.Group();
    pivot.position.copy(at);
    cabin.add(pivot);
    cabin.updateWorldMatrix(true, true);
    for (const piece of pieces) pivot.attach(piece);
    return pivot;
  };
  pedals.throttle = hinge(V(-0.103, 0.208, -0.986), [carve('interior', 'metal:interior', [-0.126, 0.204, -1.039, -0.080, 0.391, -0.980])]);
  pedals.brake = hinge(V(-0.223, 0.66, -0.995), [carve('interior', 'metal:interior', [-0.302, 0.342, -0.943, -0.188, 0.433, -0.896]),
    carve('interior', 'interior_dark:interior', [-0.262, 0.367, -1.007, -0.185, 0.669, -0.911])]);

  // o volante gira em torno da coluna, junto com as rodas da frente. O centro e o eixo saem da tampa do cubo, que é
  // um disco plano; a coluna, com as borboletas do câmbio, fica parada. No lugar da tampa lisa entra o emblema
  const lid = cabin.children.find((o) => o.name === 'steering_centre');
  if (lid) {
    const normal = lid.geometry.attributes.normal, one = V(0, 0, 0);
    for (let i = 0; i < normal.count; i++) helm.axis.add(one.fromBufferAttribute(normal, i));
    helm.axis.transformDirection(lid.matrixWorld);
    if (helm.axis.z < 0) helm.axis.negate();   // aponta para o motorista
    helm.pivot = hinge(new THREE.Box3().setFromObject(lid).getCenter(V(0, 0, 0)), cabin.children.filter((o) => /^steering_(?!column)/.test(o.name)));
    const badge = new THREE.Mesh(new THREE.CircleGeometry(0.0205, 40), emblem);
    badge.position.copy(helm.axis).multiplyScalar(0.0012);
    badge.quaternion.setFromUnitVectors(V(0, 0, 1), helm.axis);
    badge.receiveShadow = true;
    helm.pivot.add(badge);
  }
}
// Gira o volante `angle` radianos; positivo para a esquerda, como o motorista o vê
function turnWheel(angle) {
  helm.pivot?.quaternion.setFromAxisAngle(helm.axis, angle);
}

function buildExtras() {
  buildEngine();
  buildElectrics();
  buildClimate();
  buildCabin();
}

// Põe em movimento o que depende do motor e dos pedais. Sem `sim`, o carro está desligado e tudo volta ao repouso
const shown = (step) => 0.5 * Math.tanh(step / 0.5);   // giro por quadro contido, como o das rodas
function poseExtras(sim, dt) {
  clock += dt;
  const crank = sim ? sim.rpm * Math.PI / 30 : 0;
  for (const p of spinning) p.group.rotation.z = (p.group.rotation.z - shown(crank * p.ratio * dt)) % (2 * Math.PI);
  // os eletroventiladores ligam quando o carro anda devagar e o ar não passa sozinho pelos radiadores
  fanSpeed += ((sim ? (sim.v < 14 ? 230 : sim.v * 2) : 0) - fanSpeed) * Math.min(1, dt * 1.5);
  for (const fan of fans) fan.rotation.z = (fan.rotation.z + shown(fanSpeed * dt)) % (2 * Math.PI);
  if (pedals.throttle) {
    pedals.throttle.rotation.x = sim ? -0.26 * sim.throttle : 0;
    pedals.brake.rotation.x = sim ? 0.14 * Math.min(1, sim.brake * 2.2) : 0;
  }
  // o motor gira sobre os coxins: torce com a força que faz e treme de leve em marcha lenta
  const rock = sim ? -0.0055 * sim.throttle + (sim.rpm < 1400 ? 0.0005 * Math.sin(clock * 47) : 0) : 0;
  for (const group of [layers.engine.mech, layers.engine.moving, layers.trans.mech, layers.exhaust.mech]) {
    if (!group) continue;
    group.rotation.z = rock;
    group.position.set(X0 + CY * Math.sin(rock), CY * (1 - Math.cos(rock)), 0);
  }
}

export { buildExtras, poseExtras, turnWheel };
