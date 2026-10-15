import * as THREE from 'three';
import { LAYERS, LITE, SHUTTER, state, $ } from './config.js';
import { shadowsDirty } from './scene.js';
import { smooth } from './praca-textures.js';
import { CAR, createSim } from './physics.js';
import { PIVOT as CENTRE, createRide } from './ride.js';
import { road, LANE } from './road.js';
import { car } from './car.js';
import { engineSound } from './sound.js';
import { invalidate } from './pace.js';

// ---------- Condução ----------
// Liga a física ao que se vê e se ouve na estrada: o cenário corre, as rodas giram, esterçam e sobem e descem com o relevo da pista,
// a carroceria balança sobre a suspensão, as luzes de freio acendem, o motor ronca e a barra mostra a velocidade.
// As peças do carro são movidas pela montagem dele (ver car.js); aqui só se decide o que cada uma deve fazer
const sim = createSim(), ride = createRide();
const SPRUNG = LAYERS.filter((L) => L.id !== 'wheels');   // tudo o que fica apoiado nas molas
const PIVOT = new THREE.Vector3(...CENTRE);   // a carroceria inclina em torno de um ponto baixo, sob o centro de massa
const STILL = [0, 0, 0, 0];
const shown = {};   // a física como as peças do motor a veem: durante a partida, com a rotação da partida
// quando o escape estala, sai fogo das ponteiras
engineSound.onPop = (strength) => car.backfire(strength);
const GRIP = 3.2;        // o motorista não passa disto de aceleração para o lado (m/s²), cerca de um terço de g
const el = { hud: $('drive'), input: $('speedInput'), speed: $('speedNow') };
const lean = new THREE.Euler(), shift = new THREE.Vector3();
// Direção: esterço médio das rodas da frente (rad, positivo para a esquerda), faixa pedida (0 é a da direita),
// o quanto o carro está à esquerda dela (m) e o rumo em relação à estrada (rad)
const helm = { angle: 0, lane: 0, side: 0, heading: 0, parked: false };
let driving = false, raised = 0, rolled = 0;

// Motor: ao chegar à estrada o carro está parado e desligado. Um instante depois vem a partida, gravada de um carro de
// verdade (ver `sound.start` na ficha): o motor de partida gira, o motor pega, sobe de giro e assenta na marcha lenta.
// Só então o motorista engata e sai. `phase` é 'off', 'start' ou 'on'; `t`, os segundos desde o começo da fase;
// `rpm` e `load`, a rotação e a carga que o painel, as peças e o som mostram
const START = car.spec.sound.start;
const WAIT = 0.9;   // s parado e desligado antes da partida
const engine = { phase: 'off', t: 0, rpm: 0, load: 0, at: null };
// Rotação durante a partida, `t` segundos depois de girar a chave
function startRpm(t) {
  if (t < START.catch) return 220 + 40 * Math.sin(t * 55);   // o motor de partida
  const [top, peak] = START.peak;
  if (t < top) return 600 + (peak - 600) * smooth(START.catch, top, t);
  return START.idle + (peak - START.idle) * Math.exp(-(t - top) / ((START.settled - top) / 3));
}
function runEngine(dt) {
  engine.t += dt;
  if (engine.phase === 'off') {
    engine.rpm = engine.load = 0;
    // a partida espera a estrada estar montada e o som carregado
    if (engine.t > WAIT && road?.built && engineSound.ready) Object.assign(engine, { phase: 'start', t: 0, at: engineSound.ignite() });
    return;
  }
  if (engine.phase === 'start') {
    // a partida segue o relógio do som, que é o da gravação: num quadro lento a física anda menos que o tempo
    if (engine.at !== null) engine.t = Math.max(0, engineSound.time - engine.at);
    engine.rpm = startRpm(engine.t);
    engine.load = engine.t > START.catch ? 0.7 * Math.exp(-(engine.t - START.catch) / 0.5) : 0.15;
    if (engine.t >= START.blend[1]) {
      Object.assign(engine, { phase: 'on', t: 0 });
      setTarget(+el.input.value);   // engata e sai
    }
    return;
  }
  // em movimento: a rotação é a da física; a marcha lenta fria da partida baixa aos poucos até a de sempre
  const warm = CAR.idle + (START.idle - CAR.idle) * Math.exp(-engine.t / 1.2);
  engine.rpm = Math.max(sim.rpm, sim.v < 0.5 ? warm : 0);
  engine.load = sim.throttle;
}

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
// Suspensão, rodas, discos e volante no lugar que o curso de cada roda e o esterço pedem
const poseRunningGear = (travel, lift, pitch, roll) => car.pose(travel, lift, pitch, roll, helm.angle);
const text = (node, value) => { if (node.textContent !== value) node.textContent = value; };
function setTarget(kmh) {
  const value = Math.min(320, Math.max(0, kmh));
  el.input.value = value;
  el.input.style.setProperty('--at', value / 320);   // trecho do trilho que fica preenchido
  sim.target = driving && engine.phase === 'on' ? value / 3.6 : 0;   // desligado, o carro espera
}

function setDriving(on) {
  if (on === driving) return;   // trocar o dia pela noite não faz o carro recomeçar do zero
  driving = on;
  el.hud.hidden = !on;
  sim.reset();
  ride.reset();
  Object.assign(helm, { lane: 0, side: 0, heading: 0 });
  Object.assign(engine, { phase: 'off', t: 0, rpm: 0, load: 0, at: null });
  setTarget(+el.input.value);
  // o som é preparado já, durante o toque que trouxe o carro à estrada: é quando o navegador permite tocar
  if (on) { engineSound.arm(); return; }
  engineSound.stop();
  road?.shift(0, 0);
  settle(0, 0, 0);
  poseRunningGear(STILL, 0, 0, 0);
  car.run(null, 0);
  rolled = 0;
  car.roll(null, 0);
  car.brake(0);
  car.cluster(0, 'N', 0);
}

function updateDrive(dt) {
  dt = Math.min(dt, 0.05);
  if (!driving) {
    // parado, as rodas da frente ficam como o ambiente pede; ao chegar da estrada, o volante vai até lá aos poucos
    const rest = state.env.steer ?? 0;
    if (!car.built || Math.abs(rest - helm.angle) < 1e-4) return;
    helm.angle = helm.parked ? helm.angle + (rest - helm.angle) * Math.min(1, dt * 4 + 2e-4 / Math.abs(rest - helm.angle)) : rest;
    helm.parked = true;
    poseRunningGear(STILL, 0, 0, 0);
    shadowsDirty();
    invalidate();
    return;
  }
  invalidate(1);   // na estrada tudo se move o tempo todo
  sim.step(dt);
  runEngine(dt);

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
  car.roll(rolled, arc);
  car.run(engine.phase === 'off' ? null : Object.assign(shown, sim, { rpm: engine.rpm }), dt);

  car.brake(smooth(0.004, 0.06, sim.brake));

  // a barra mostra só a velocidade; marcha e rotação ficam no painel de instrumentos do próprio carro
  const kmh = Math.round(sim.v * 3.6);
  text(el.speed, String(kmh));
  car.cluster(engine.rpm, sim.v < 0.05 && sim.target < 0.1 ? 'N' : String(sim.gear), kmh);
  engineSound.update(dt, sim, engine);
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

export { sim, ride, helm, engine, setDriving, updateDrive, boardCamera, leaveCamera };
