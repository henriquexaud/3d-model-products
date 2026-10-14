import * as THREE from 'three';
import { AX_F, LAYERS, LITE, SHUTTER, state, $ } from './config.js';
import { shadowsDirty } from './scene.js';
import { discSpin } from './materials.js';
import { setBrake } from './lamps.js';
import { smooth } from './praca-textures.js';
import { CAR, createSim } from './physics.js';
import { TO_FRONT, createRide } from './ride.js';
import { road, LANE } from './road.js';
import { wheels, tyres, spinBlur } from './details.js';
import { showCluster } from './cluster.js';
import { poseSuspension, steerMount } from './suspension.js';
import { poseExtras, turnWheel } from './extras.js';
import { invalidate } from './pace.js';

// ---------- Condução ----------
// Liga a física ao que se vê na estrada: o cenário corre, as rodas giram, esterçam e sobem e descem com o relevo da pista,
// a carroceria balança sobre a suspensão, as luzes de freio acendem e a barra mostra a velocidade
const sim = createSim(), ride = createRide();
const SPRUNG = LAYERS.filter((L) => L.id !== 'wheels');   // tudo o que fica apoiado nas molas
const PIVOT = new THREE.Vector3(0, 0.12, AX_F + TO_FRONT);   // a carroceria inclina em torno de um ponto baixo, sob o centro de massa
const STILL = [0, 0, 0, 0];
const STEERING = 11.9;   // quanto o volante gira para cada grau das rodas da frente
const GRIP = 3.2;        // o motorista não passa disto de aceleração para o lado (m/s²), cerca de um terço de g
const el = { hud: $('drive'), input: $('speedInput'), speed: $('speedNow') };
const lean = new THREE.Euler(), shift = new THREE.Vector3();
// Direção: esterço médio das rodas da frente (rad, positivo para a esquerda), faixa pedida (0 é a da direita),
// o quanto o carro está à esquerda dela (m) e o rumo em relação à estrada (rad)
const helm = { angle: 0, lane: 0, side: 0, heading: 0, parked: false };
let driving = false, raised = 0, rolled = 0;

// Carroceria `lift` metros acima do repouso, inclinada para trás (`pitch`) e para o lado (`roll`); as rodas ficam por conta própria
function settle(lift, pitch, roll) {
  raised = lift;
  lean.set(pitch, 0, roll);
  shift.copy(PIVOT).applyEuler(lean).negate().add(PIVOT);
  for (const L of SPRUNG) {
    L.group.rotation.copy(lean);
    L.group.position.set(shift.x, shift.y + lift, shift.z);
  }
}
// Suspensão, rodas, discos e volante no lugar que o curso de cada roda e o esterço pedem.
// A roda acompanha o canto da carroceria mais o curso da suspensão; o disco, que está na carroceria, só o curso
function poseRunningGear(travel, lift, pitch, roll) {
  poseSuspension(travel, helm.angle);
  wheels.forEach((w, i) => {
    steerMount(i, w.mount, w.centre, lift - (w.centre.z - PIVOT.z) * pitch + w.centre.x * roll + travel[i]);
    steerMount(i, w.discMount, w.centre, travel[i]);
  });
  turnWheel(helm.angle * STEERING);
}
const text = (node, value) => { if (node.textContent !== value) node.textContent = value; };
function setTarget(kmh) {
  const value = Math.min(320, Math.max(0, kmh));
  el.input.value = value;
  el.input.style.setProperty('--at', value / 320);   // trecho do trilho que fica preenchido
  sim.target = driving ? value / 3.6 : 0;
}

function setDriving(on) {
  if (on === driving) return;   // trocar o dia pela noite não faz o carro recomeçar do zero
  driving = on;
  el.hud.hidden = !on;
  sim.reset();
  ride.reset();
  Object.assign(helm, { lane: 0, side: 0, heading: 0 });
  setTarget(+el.input.value);
  if (on) return;
  road?.shift(0, 0);
  settle(0, 0, 0);
  poseRunningGear(STILL, 0, 0, 0);
  poseExtras(null, 0);
  rolled = 0;
  spinBlur(0);
  setBrake(0);
  for (const rubber of Object.values(tyres)) rubber.bumpScale = rubber.userData.relief;
  showCluster(0, 'N', 0);
  discSpin.value = 0;
}

function updateDrive(dt) {
  dt = Math.min(dt, 0.05);
  if (!driving) {
    // parado, as rodas da frente ficam como o ambiente pede; ao chegar da estrada, o volante vai até lá aos poucos
    const rest = state.env.steer ?? 0;
    if (!wheels.length || Math.abs(rest - helm.angle) < 1e-4) return;
    helm.angle = helm.parked ? helm.angle + (rest - helm.angle) * Math.min(1, dt * 4 + 2e-4 / Math.abs(rest - helm.angle)) : rest;
    helm.parked = true;
    poseRunningGear(STILL, 0, 0, 0);
    shadowsDirty();
    invalidate();
    return;
  }
  invalidate(1);   // na estrada tudo se move o tempo todo
  sim.step(dt);

  // Direção: o motorista mira um ponto da faixa pedida alguns metros à frente e esterça o que leva o carro até lá,
  // sem pedir dos pneus mais do que uma curva tranquila. Esterço, velocidade e entre-eixos dão a curva que o carro
  // faz, e dela saem o rumo, a posição na pista e a força que deita a carroceria
  const ahead = Math.max(8, 1.3 * sim.v), miss = helm.lane * LANE - (helm.side + ahead * helm.heading);
  const most = Math.min(0.45, Math.atan(CAR.wheelbase * GRIP / Math.max(1, sim.v * sim.v)));
  const want = Math.min(most, Math.max(-most, Math.atan(2 * CAR.wheelbase * miss / (ahead * ahead))));
  helm.angle += (want - helm.angle) * (1 - Math.exp(-dt / 0.18));
  const curve = Math.tan(helm.angle) / CAR.wheelbase;
  helm.heading += sim.v * curve * dt;
  helm.side += sim.v * Math.sin(helm.heading) * dt;
  if (sim.v < 0.05 && Math.abs(miss) < 0.02) helm.heading *= 1 - Math.min(1, dt * 2);   // parado na faixa, o carro acaba de se alinhar

  ride.step(dt, sim.x, sim.v, sim.a, sim.downforce, sim.v * sim.v * curve);
  if (!Number.isFinite(ride.z + ride.pitch + ride.roll)) ride.reset();   // nunca deixa um número inválido chegar à cena
  road.update(sim.x, sim.v);
  road.shift(helm.side, helm.heading);

  // A pista desenhada é plana, então tudo é mostrado em relação ao plano que acompanha as ondulações longas dela:
  // o que se vê é a carroceria subindo, descendo e inclinando sobre as rodas, sem o tremor dos ressaltos miúdos
  const lift = ride.z - ride.base[0], pitch = ride.pitch + ride.base[1], roll = ride.roll - ride.base[2];
  settle(lift, pitch, roll);
  poseRunningGear(ride.travel, lift, pitch, roll);

  // Rodas e discos giram exatamente o que a estrada pede: a distância percorrida dividida pelo raio de rolagem.
  // `arc` é o quanto giram durante a exposição de um quadro, e é isso que borra os raios, as letras dos pneus e os furos
  // dos discos. No celular não há borrão: lá o passo por quadro é contido, senão os raios pareceriam parados ou girando para trás
  const spin = sim.v / CAR.wheelRadius, arc = spin * SHUTTER;
  rolled = LITE ? rolled + 0.55 * Math.tanh(spin * dt / 0.55) : sim.x / CAR.wheelRadius;
  for (const w of wheels) w.pivot.rotation.x = w.discPivot.rotation.x = -(rolled % (2 * Math.PI));
  spinBlur(arc);
  for (const rubber of Object.values(tyres)) rubber.bumpScale = rubber.userData.relief * (1 - Math.min(1, arc / 0.2));
  discSpin.value = Math.min(1, arc / 0.17);   // os furos se repetem a cada 10°
  poseExtras(sim, dt);

  setBrake(smooth(0.004, 0.06, sim.brake));

  // a barra mostra só a velocidade; marcha e rotação ficam no painel de instrumentos do próprio carro
  const kmh = Math.round(sim.v * 3.6);
  text(el.speed, String(kmh));
  showCluster(sim.rpm, sim.v < 0.05 && sim.target < 0.1 ? 'N' : String(sim.gear), kmh);
}

// Na vista interior o motorista vai junto com a carroceria: a cabine fica quase parada diante dele e é a estrada que balança.
// `boardCamera` leva a câmera para onde o carro a carregou, só durante o desenho do quadro; `leaveCamera` a devolve aos controles
const FOLLOW = 0.85;   // a cabeça compensa uma pequena parte do movimento
const seat = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion() }, sway = new THREE.Quaternion(), part = new THREE.Euler();
function boardCamera(camera) {
  if (!driving) return false;
  seat.position.copy(camera.position);
  seat.quaternion.copy(camera.quaternion);
  sway.setFromEuler(part.set(lean.x * FOLLOW, 0, lean.z * FOLLOW));
  camera.position.sub(PIVOT).applyQuaternion(sway).add(PIVOT);
  camera.position.y += raised * FOLLOW;
  camera.quaternion.premultiply(sway);
  return true;
}
function leaveCamera(camera) {
  camera.position.copy(seat.position);
  camera.quaternion.copy(seat.quaternion);
}

// Teclado, na estrada: ↑ e ↓ pedem mais ou menos velocidade; ← e → trocam de faixa
setTarget(+el.input.value);
el.input.addEventListener('input', () => setTarget(+el.input.value));
window.addEventListener('keydown', (e) => {
  if (!driving || e.target === el.input) return;
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') setTarget(+el.input.value + (e.key === 'ArrowUp' ? 10 : -10));
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') helm.lane = e.key === 'ArrowLeft' ? 1 : 0;
  else return;
  e.preventDefault();
});

export { sim, ride, helm, setDriving, updateDrive, boardCamera, leaveCamera };
