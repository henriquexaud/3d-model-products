import * as THREE from 'three';
import { measures, mm } from '../../config.js';
import { X0, AX_F, AX_R, WHEEL_Y } from './spec.js';
import { mats } from '../../materials.js';
import { G, M } from '../../layers.js';
import { V, S, rod, unitRod, pose, cyl, rbox, ball, tube, spring, boot, mergeMeshes } from '../../geometry.js';
import { BRAKE_BRACKETS } from './mechanics.js';
import { CAR } from '../../physics.js';
import { RIDE } from '../../ride.js';

// ---------- Suspensão, direção e o que acompanha cada roda ----------
// Braços triangulares sobrepostos nas quatro rodas. Cada peça é montada onde fica com o carro parado e, a cada quadro,
// `poseSuspension` a leva para a posição que o curso da roda pede: os braços giram em torno das buchas, a manga sobe e desce,
// a mola encolhe, a haste do amortecedor entra no tubo, a barra estabilizadora torce e o semieixo inclina. Nas rodas
// da frente, a manga também esterça em torno do pino mestre, levando junto a pinça e a ponta da barra de direção.
// Medidas do lado direito, em metros; o lado esquerdo é o espelho
const AXLES = {
  front: {
    z: AX_F, hub: 0.765,
    lower: { ball: [0.755, 0.185, AX_F], pivots: [[0.40, 0.205, -1.36], [0.40, 0.205, -1.14]], ear: [0.76, 0.31, AX_F] },
    upper: { ball: [0.725, 0.535, AX_F - 0.01], pivots: [[0.50, 0.555, -1.30], [0.50, 0.555, -1.14]], ear: [0.755, 0.41, AX_F] },
    steer: { ball: [0.745, 0.275, AX_F - 0.145], ear: [0.76, 0.33, AX_F - 0.05], inner: [0.40, 0.275, -1.30] },   // barra de direção
    strut: { low: [0.64, 0.21, -1.215], top: [0.50, 0.70, -1.205] },
    bar: { pts: [[0.36, 0.305, -1.395], [0.44, 0.305, -1.39], [0.50, 0.305, -1.34], [0.52, 0.305, -1.25]], r: 0.012, foot: [0.56, 0.21, -1.265], on: 'lower' },
  },
  rear: {
    z: AX_R, hub: 0.745,
    lower: { ball: [0.735, 0.19, AX_R], pivots: [[0.47, 0.225, 1.31], [0.47, 0.225, 1.71]], ear: [0.74, 0.31, AX_R] },
    upper: { ball: [0.705, 0.535, AX_R + 0.004], pivots: [[0.50, 0.56, 1.40], [0.50, 0.56, 1.76]], ear: [0.735, 0.41, AX_R] },
    steer: { ball: [0.72, 0.30, AX_R + 0.159], ear: [0.74, 0.33, AX_R + 0.05], inner: [0.47, 0.30, 1.70] },        // braço de convergência
    strut: { low: [0.65, 0.215, 1.57], top: [0.50, 0.80, 1.585] },
    bar: { pts: [[0.36, 0.555, 1.79], [0.42, 0.557, 1.785], [0.44, 0.565, 1.74], [0.44, 0.58, 1.66]], r: 0.011, foot: [0.53, 0.557, 1.72], on: 'upper' },
    shaft: { inner: 0.315, outer: 0.685 },   // centros das juntas homocinéticas do semieixo
  },
};
const DOWN = new THREE.Vector3(0, -1, 0);
const corners = [];   // na ordem DE, DD, TE, TD

// Reúne peças que se movem juntas em um grupo com a origem em `origin` e as funde em poucas malhas
function assembly(parent, origin, meshes) {
  const group = new THREE.Group();
  group.position.copy(origin);
  parent.add(group);
  for (const mesh of meshes) { mesh.position.sub(origin); group.add(mesh); }
  mergeMeshes(group);
  return group;
}
// Flexível de comprimento 1, com uma barriga para o lado; `pose` o estica entre as duas pontas
const hoseShape = (r) => new THREE.TubeGeometry(new THREE.CatmullRomCurve3([V(0, 0, 0), V(0.03, 0.5, 0.01), V(0, 1, 0)]), 12, r, 6);

function buildCorner(A, s, discBox) {
  const m = mats('susp'), mv = M('susp'), X = (p) => V(s * p[0], p[1], p[2]), ZERO = V(0, 0, 0);
  const c = { s, front: A === AXLES.front };

  // manga de eixo, com as três orelhas e as rótulas: sobe e desce com a roda
  const balls = [X(A.lower.ball), X(A.upper.ball), X(A.steer.ball)];
  c.steer = balls[2];
  // pino mestre: a reta que passa pelas rótulas dos dois braços. É em torno dela que a manga da frente esterça
  c.pin = balls[0].clone();
  c.axis = balls[1].clone().sub(balls[0]).normalize();
  c.turn = new THREE.Quaternion();
  c.hub = assembly(mv, ZERO, [
    cyl(0.07, 0.07, 'x', s * A.hub, WHEEL_Y, A.z, m.alu, 20),
    cyl(0.085, 0.012, 'x', s * (A.hub + 0.03), WHEEL_Y, A.z, m.steel, 24),            // flange do cubo
    rod(X(A.lower.ear), balls[0], 0.028, m.alu, 0.02, 10), rod(X(A.upper.ear), balls[1], 0.028, m.alu, 0.018, 10),
    rod(X(A.steer.ear), balls[2], 0.02, m.alu, 0.014, 8), ...balls.map((p) => ball(p, 0.02, m.steel)),
  ]);

  // braços: giram em torno do eixo que passa pelas duas buchas
  for (const name of ['lower', 'upper']) {
    const a = A[name], tip = X(a.ball), pivots = a.pivots.map(X), r = name === 'lower' ? 0.017 : 0.014;
    const o = V(pivots[0].x, pivots[0].y, (pivots[0].z + pivots[1].z) / 2), reach = Math.hypot(tip.x - o.x, tip.y - o.y);
    c[name] = { o, reach, rise: tip.y - o.y, group: assembly(mv, o, pivots.map((p) => rod(tip, p, r, m.alu, r, 10))) };
    for (const p of pivots) G('susp').add(cyl(name === 'lower' ? 0.024 : 0.022, 0.05, 'z', p.x, p.y, p.z, m.rubber, 12));   // buchas, presas à estrutura
  }

  // mola e amortecedor em um só conjunto, do braço inferior à estrutura. A parte de cima fica presa pela ponta;
  // o tubo acompanha o braço e a mola é esticada ou encolhida entre os dois pratos
  const top = X(A.strut.top), low = X(A.strut.low), L = top.distanceTo(low);
  c.strut = {
    top, low, cap: 0.045 * L, free: 0.535 * L, seat: 0.42 * L,
    upper: assembly(mv, top, [rod(top, V(top.x, top.y - 0.5 * L, top.z), 0.007, m.steel, 0.007, 8),
      rod(top, V(top.x, top.y - 0.045 * L, top.z), 0.048, m.darkSteel, 0.048, 18)]),
    tube: assembly(mv, top, [rod(top, V(top.x, top.y + 0.56 * L, top.z), 0.023, m.darkSteel, 0.023, 14),
      rod(V(top.x, top.y + 0.40 * L, top.z), V(top.x, top.y + 0.42 * L, top.z), 0.046, m.aluSatin, 0.046, 18), ball(top, 0.02, m.steel)]),
    coil: assembly(mv, top, [spring(top, V(top.x, top.y - 0.535 * L, top.z), 0.036, 0.006, 7, m.spring)]),
  };

  // barra de direção (na frente) ou braço de convergência (atrás): uma haste entre a estrutura e a manga
  c.inner = X(A.steer.inner);
  c.link = unitRod(c.front ? 0.009 : 0.011, m.steel, 8);
  mv.add(c.link);

  // ponta da barra estabilizadora: gira em torno da barra e empurra o braço por uma bieleta
  const pts = A.bar.pts.map(X), axis = pts[0], tipOfBar = pts[pts.length - 1];
  c.bar = {
    axis, tip: tipOfBar, foot: X(A.bar.foot), arm: c[A.bar.on], group: assembly(mv, axis, [tube(pts, A.bar.r, m.darkSteel)]),
    link: unitRod(0.006, m.steel, 6),
  };
  mv.add(c.bar.link);

  // semieixo: inclina em torno da junta de dentro; a ponta de fora vai com a manga
  if (A.shaft) {
    const t = mats('trans'), at = (x) => V(s * x, WHEEL_Y, A.z);
    c.shaft = { reach: A.shaft.outer - A.shaft.inner, group: assembly(M('trans'), at(A.shaft.inner), [
      boot(at(0.28), at(0.35), 0.042, 0.02, t.rubber), rod(at(0.35), at(0.62), 0.016, t.steel), boot(at(0.69), at(0.62), 0.042, 0.02, t.rubber)]) };
    c.stub = assembly(M('trans'), ZERO, [rod(at(0.69), at(0.75), 0.045, t.steel, 0.045, 18)]);
  }

  // freio: pinça fixa abraçando a borda do disco do modelo, à frente do eixo, com os pistões e o flexível
  const b = mats('brakes'), box = discBox;
  const r = (box.max.y - box.min.y) / 2, cy = (box.min.y + box.max.y) / 2, cz = (box.min.z + box.max.z) / 2;
  const inner = Math.min(Math.abs(box.min.x), Math.abs(box.max.x)) - s * X0, outer = Math.max(Math.abs(box.min.x), Math.abs(box.max.x)) - s * X0;
  measures[c.front ? 'discF' : 'discR'] = `Ø ${mm(2 * r)} × ${mm(outer - inner)} mm`;
  const span = c.front ? 1.15 : 0.95, r1 = r - 0.085, r2 = r + 0.035, a0 = Math.PI - span / 2, a1 = Math.PI + span / 2;
  const x0 = inner - (c.front ? 0.055 : 0.048), x1 = outer + 0.008;
  const shape = new THREE.Shape();
  shape.moveTo(r2 * Math.cos(a0), r2 * Math.sin(a0));
  shape.absarc(0, 0, r2, a0, a1, false);
  shape.lineTo(r1 * Math.cos(a1), r1 * Math.sin(a1));
  shape.absarc(0, 0, r1, a1, a0, true);
  const caliper = new THREE.Mesh(new THREE.ExtrudeGeometry(shape, {
    depth: x1 - x0, bevelEnabled: true, bevelSize: 0.004, bevelOffset: -0.004, bevelThickness: 0.004, bevelSegments: 2, curveSegments: 16,
  }), b.caliper);
  caliper.rotation.y = -Math.PI / 2;   // o perfil fica no plano da roda
  caliper.position.set(s > 0 ? x1 : -x0, cy, cz);
  const parts = [caliper];
  for (let k = 0; k < (c.front ? 3 : 2); k++) {   // pistões
    const a = Math.PI + (k - (c.front ? 1 : 0.5)) * 0.36;
    parts.push(cyl(0.022, 0.014, 'x', s * (x0 - 0.005), cy + (r - 0.035) * Math.sin(a), cz + (r - 0.035) * Math.cos(a), b.steel, 12));
    // do lado de fora, o alojamento de cada pistão aparece como um ressalto na face da pinça
    parts.push(cyl(0.027, 0.012, 'x', s * (x1 + 0.003), cy + (r - 0.04) * Math.sin(a), cz + (r - 0.04) * Math.cos(a), b.caliper, 24));
  }
  for (const a of [a0 + 0.07, a1 - 0.07]) {   // parafusos que unem as duas metades
    parts.push(cyl(0.007, 0.008, 'x', s * (x1 + 0.002), cy + (r + 0.012) * Math.sin(a), cz + (r + 0.012) * Math.cos(a), b.steel, 6));
  }
  c.caliper = assembly(M('brakes'), ZERO, parts);
  c.inlet = V(s * (x0 - 0.008), cy + 0.02, cz - (r - 0.03));
  c.bracket = BRAKE_BRACKETS[c.front ? 'front' : 'rear'][s];
  c.hose = new THREE.Mesh(hoseShape(0.005), b.rubber);
  M('brakes').add(c.hose);

  // sensor de rotação da roda (ABS), com o cabo que vai até a estrutura
  const e = mats('electric');
  c.sensorAt = V(s * (A.hub - 0.045), WHEEL_Y + 0.075, A.z + 0.03);
  c.sensor = assembly(M('electric'), ZERO, [rbox(0.022, 0.03, 0.018, c.sensorAt.x, c.sensorAt.y, c.sensorAt.z, e.black, 0.004)]);
  c.wireFrom = c.bracket.clone().add(V(0, 0.03, 0.02));
  c.wire = new THREE.Mesh(hoseShape(0.003), e.black);
  M('electric').add(c.wire);
  for (const mesh of [c.link, c.bar.link, c.hose, c.wire]) mesh.castShadow = mesh.receiveShadow = true;
  return c;
}

function buildSuspension(discBoxes) {
  const g = G('susp'), m = mats('susp');
  const joint = (p, r = 0.02) => g.add(ball(p, r, m.steel));
  const discOf = (front, s) => discBoxes.find((box) => (box.min.z < 0) === front && Math.sign(box.min.x + box.max.x) === s);
  for (const A of [AXLES.front, AXLES.rear]) for (const s of S) corners.push(buildCorner(A, s, discOf(A === AXLES.front, s)));

  // o que fica preso à estrutura: barras estabilizadoras, caixa e coluna de direção
  for (const s of S) {
    g.add(boot(V(s * 0.30, 0.275, -1.30), V(s * 0.40, 0.275, -1.30), 0.027, 0.014, m.rubber, 5));   // coifas da caixa de direção
    g.add(rbox(0.05, 0.04, 0.04, s * 0.36, 0.285, -1.395, m.rubber, 0.006));                        // mancais das barras
    g.add(rbox(0.045, 0.04, 0.04, s * 0.36, 0.575, 1.79, m.rubber, 0.006));
    joint(V(s * 0.47, 0.30, 1.70), 0.016);
    joint(V(s * 0.40, 0.275, -1.30), 0.014);
  }
  g.add(rod(V(-0.36, 0.305, -1.395), V(0.36, 0.305, -1.395), 0.012, m.darkSteel));
  g.add(rod(V(-0.36, 0.555, 1.79), V(0.36, 0.555, 1.79), 0.011, m.darkSteel));
  g.add(cyl(0.0275, 0.60, 'x', 0, 0.275, -1.30, m.alu, 16));                         // caixa de direção
  g.add(rod(V(-0.27, 0.275, -1.30), V(-0.295, 0.335, -1.262), 0.022, m.alu));
  // coluna: do volante até a parede dianteira e de lá, por um eixo articulado, à caixa de direção
  g.add(rod(V(-0.346, 0.776, -0.52), V(-0.346, 0.60, -1.03), 0.022, m.black, 0.022, 12));
  g.add(rod(V(-0.346, 0.60, -1.03), V(-0.346, 0.59, -1.06), 0.012, m.steel, 0.012, 8));
  joint(V(-0.346, 0.59, -1.06), 0.018);
  g.add(rod(V(-0.346, 0.59, -1.06), V(-0.30, 0.345, -1.255), 0.011, m.steel, 0.011, 8));
  joint(V(-0.30, 0.345, -1.255), 0.018);
  poseSuspension([0, 0, 0, 0]);
}

// Leva as peças de cada canto para a posição pedida pelo curso da roda (m; positivo quando a suspensão comprime)
// e pelo esterço `steer` (rad; positivo para a esquerda), que é o ângulo médio das duas rodas da frente
const RACK = 0.145;   // braço de direção: distância da rótula da barra ao pino mestre (m)
const p = new THREE.Vector3(), q = new THREE.Vector3(), turn = new THREE.Quaternion(), inner = new THREE.Vector3();
function poseSuspension(travel, steer = 0) {
  const lock = Math.tan(steer);
  corners.forEach((c, i) => {
    const t = Math.max(-0.08, Math.min(0.08, travel[i]));
    // a roda de dentro da curva esterça mais do que a de fora, para as duas descreverem círculos com o mesmo centro
    c.turn.setFromAxisAngle(c.axis, c.front ? Math.atan(lock / (1 + c.s * RIDE.track[0] / (2 * CAR.wheelbase) * lock)) : 0);
    for (const part of [c.hub, c.caliper, c.sensor]) {
      part.quaternion.copy(c.turn);
      part.position.copy(c.pin).applyQuaternion(c.turn).negate().add(c.pin);
      part.position.y += t;
    }
    // onde vai parar um ponto preso à manga
    const knuckle = (from, to) => { to.copy(from).sub(c.pin).applyQuaternion(c.turn).add(c.pin); to.y += t; return to; };
    // ângulo de cada braço para a rótula subir `t`; `carry` leva junto um ponto preso ao braço
    for (const arm of [c.lower, c.upper]) {
      arm.angle = c.s * (Math.asin((arm.rise + t) / arm.reach) - Math.asin(arm.rise / arm.reach));
      arm.group.rotation.z = arm.angle;
    }
    const carry = (arm, from, to) => {
      const dx = from.x - arm.o.x, dy = from.y - arm.o.y, cos = Math.cos(arm.angle), sin = Math.sin(arm.angle);
      return to.set(arm.o.x + dx * cos - dy * sin, arm.o.y + dx * sin + dy * cos, from.z);
    };

    const st = c.strut, foot = carry(c.lower, st.low, p), axis = q.subVectors(foot, st.top), length = axis.length();
    turn.setFromUnitVectors(DOWN, axis.divideScalar(length));
    st.upper.quaternion.copy(turn);
    st.tube.position.copy(foot);
    st.tube.quaternion.copy(turn);
    st.coil.position.copy(st.top).addScaledVector(axis, st.cap);
    st.coil.quaternion.copy(turn);
    st.coil.scale.y = (length - st.cap - st.seat) / st.free;

    // a cremalheira corre para o lado e empurra a barra de direção, que gira a manga
    pose(c.link, c.front ? inner.copy(c.inner).setX(c.inner.x - RACK * steer) : c.inner, knuckle(c.steer, p));

    const bar = c.bar, lever = bar.tip.z - bar.axis.z, base = carry(bar.arm, bar.foot, p);
    const twist = -Math.asin(Math.max(-0.9, Math.min(0.9, (base.y - bar.foot.y) / lever)));
    bar.group.rotation.x = twist;
    const dy = bar.tip.y - bar.axis.y;
    q.set(bar.tip.x, bar.axis.y + dy * Math.cos(twist) - lever * Math.sin(twist), bar.axis.z + dy * Math.sin(twist) + lever * Math.cos(twist));
    pose(bar.link, q, base);

    if (c.shaft) {
      c.shaft.group.rotation.z = c.s * Math.asin(t / c.shaft.reach);
      c.stub.position.y = t;
    }
    pose(c.hose, c.bracket, knuckle(c.inlet, p));
    pose(c.wire, c.wireFrom, knuckle(c.sensorAt, p));
  });
}

// Leva ao lugar o conjunto de uma roda (`mount`, que em repouso fica em `rest`): esterçado junto com a manga do canto `i`
// e `rise` metros acima
const pinAt = new THREE.Vector3();
function steerMount(i, mount, rest, rise) {
  const c = corners[i];
  pinAt.copy(c.pin).setX(c.pin.x + X0);
  mount.quaternion.copy(c.turn);
  mount.position.copy(rest).sub(pinAt).applyQuaternion(c.turn).add(pinAt);
  mount.position.y += rise;
}

export { buildSuspension, poseSuspension, steerMount };
