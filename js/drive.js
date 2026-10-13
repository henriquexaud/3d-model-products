import * as THREE from 'three';
import { AX_F, LAYERS, $ } from './config.js';
import { discSpin } from './materials.js';
import { setBrake } from './lamps.js';
import { smooth } from './praca-textures.js';
import { CAR, createSim } from './physics.js';
import { TO_FRONT, createRide } from './ride.js';
import { road } from './road.js';
import { wheels, tyres } from './details.js';
import { showCluster } from './cluster.js';
import { poseSuspension } from './suspension.js';
import { poseExtras } from './extras.js';

// ---------- Condução ----------
// Liga a física ao que se vê na estrada: o cenário corre, as rodas giram e sobem e descem com o relevo da pista,
// a carroceria balança sobre a suspensão, as luzes de freio acendem e a barra mostra a velocidade
const sim = createSim(), ride = createRide();
const SPRUNG = LAYERS.filter((L) => L.id !== 'wheels');   // tudo o que fica apoiado nas molas
const PIVOT = new THREE.Vector3(0, 0.12, AX_F + TO_FRONT);   // a carroceria inclina em torno de um ponto baixo, sob o centro de massa
const STILL = [0, 0, 0, 0];
const el = { hud: $('drive'), input: $('speedInput'), speed: $('speedNow') };
const lean = new THREE.Euler(), shift = new THREE.Vector3();
let driving = false, raised = 0;

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
  setTarget(+el.input.value);
  if (on) return;
  settle(0, 0, 0);
  poseSuspension(STILL);
  poseExtras(null, 0);
  for (const w of wheels) w.pivot.position.y = w.discPivot.position.y = w.centre.y;
  setBrake(0);
  for (const rubber of Object.values(tyres)) rubber.bumpScale = rubber.userData.relief;
  showCluster(0, 'N', 0);
  discSpin.value = 0;
}

function updateDrive(dt) {
  if (!driving) return;
  dt = Math.min(dt, 0.05);
  sim.step(dt);
  ride.step(dt, sim.x, sim.v, sim.a, sim.downforce);
  if (!Number.isFinite(ride.z + ride.pitch + ride.roll)) ride.reset();   // nunca deixa um número inválido chegar à cena
  road.update(sim.x, sim.v);

  // A pista desenhada é plana, então tudo é mostrado em relação ao plano que acompanha as ondulações longas dela:
  // o que se vê é a carroceria subindo, descendo e inclinando sobre as rodas, sem o tremor dos ressaltos miúdos
  const lift = ride.z - ride.base[0], pitch = ride.pitch + ride.base[1], roll = ride.roll - ride.base[2];
  settle(lift, pitch, roll);
  poseSuspension(ride.travel);

  // rodas e discos giram no ritmo da estrada. Em alta velocidade o passo por quadro é contido,
  // senão os raios pareceriam parados ou girando para trás
  const turn = 0.55 * Math.tanh(sim.v / CAR.wheelRadius * dt / 0.55);
  wheels.forEach((w, i) => {
    w.pivot.rotation.x = w.discPivot.rotation.x = (w.pivot.rotation.x - turn) % (2 * Math.PI);
    // a roda acompanha o canto da carroceria mais o curso da suspensão; o disco, que está na carroceria, só o curso
    w.pivot.position.y = w.centre.y + lift - (w.centre.z - PIVOT.z) * pitch + w.centre.x * roll + ride.travel[i];
    w.discPivot.position.y = w.centre.y + ride.travel[i];
  });
  for (const rubber of Object.values(tyres)) rubber.bumpScale = rubber.userData.relief * (1 - smooth(2, 22, sim.v));   // o relevo do pneu vira um borrão
  discSpin.value = smooth(1, 10, sim.v);                                                                              // e os furos dos discos também
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

setTarget(+el.input.value);
el.input.addEventListener('input', () => setTarget(+el.input.value));
window.addEventListener('keydown', (e) => {
  if (!driving || e.target === el.input || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
  setTarget(+el.input.value + (e.key === 'ArrowUp' ? 10 : -10));
  e.preventDefault();
});

export { sim, ride, setDriving, updateDrive, boardCamera, leaveCamera };
