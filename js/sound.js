import * as THREE from 'three';
import { state } from './config.js';
import { spec } from './cars/index.js';
import { camera } from './scene.js';
import { CAR } from './physics.js';
import { TO_FRONT, TO_REAR } from './ride.js';
import { jointsBetween } from './relief.js';

// ---------- Som ----------
// Só na Estrada, onde o carro anda: a partida, o motor, os estalos do escape, os pneus no asfalto, o vento e as juntas
// da pista sob as rodas. Tudo o que é do motor vem de gravações de carros de verdade (ver `sound` na ficha do carro):
// a partida é tocada inteira; depois, a cada quadro, tocam os dois loops de rotação constante mais próximos da rotação
// do motor, cada um acelerado ou freado na medida exata. O pé no acelerador decide o timbre: com carga o ronco é cheio
// e aberto; com o pé fora, abafado, mais baixo, irregular e com estalos no escape. O câmbio corta a ignição por um
// instante ao subir de marcha e dá uma acelerada ao reduzir. O som sai do lugar dele no carro e chega à câmera como a um
// par de ouvidos, com os reflexos do asfalto e da defensa; de dentro do carro, a cabine engrossa os graves e abafa os agudos

const SOUND = spec.sound, START = SOUND.start, POPS = SOUND.pops;
const LOOPS = [SOUND.idle, ...SOUND.loops];   // em ordem de rotação
const LEVEL = 2.2;                            // volume geral
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

let ctx = null, nodes = null, loading = null;
// `wanted`: o carro está na estrada; `gear`: a marcha do quadro anterior; `x`: distância já percorrida, para saber
// quando as rodas passam por uma junta; `blip`: a acelerada da redução; `clock`: segundos de estrada
const sound = { wanted: false, muted: false, ready: false, gear: 1, x: 0, blip: 0, clock: 0, starting: null, onPop: null };

// Ruído de 2 s que se repete sem emenda, mais forte nos graves (cai 3 dB por oitava, como o de pneu e de vento)
function noiseBuffer() {
  const length = 2 * ctx.sampleRate, buffer = ctx.createBuffer(1, length, ctx.sampleRate), data = buffer.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < length; i++) {
    const white = Math.random() * 2 - 1;
    b0 = 0.99765 * b0 + white * 0.099;
    b1 = 0.963 * b1 + white * 0.2965;
    b2 = 0.57 * b2 + white * 1.0526;
    data[i] = (b0 + b1 + b2 + white * 0.1848) * 0.11;
  }
  const fade = 2048;   // o fim desemboca no começo
  for (let i = 0; i < fade; i++) data[length - fade + i] = data[length - fade + i] * (1 - i / fade) + data[i] * (i / fade);
  return buffer;
}

// O espaço em volta do carro na estrada, como resposta a um estalo: o asfalto devolve o som quase na hora, a defensa e
// as árvores logo depois, e o resto se espalha e some em poucos décimos de segundo
function roadside() {
  const rate = ctx.sampleRate, length = Math.round(0.9 * rate), buffer = ctx.createBuffer(2, length, rate);
  const early = [[0.004, 0.55], [0.011, 0.22], [0.019, 0.3], [0.027, 0.14], [0.041, 0.18], [0.058, 0.1], [0.083, 0.08]];
  for (let c = 0; c < 2; c++) {
    const data = buffer.getChannelData(c);
    let low = 0;
    for (let i = 0; i < length; i++) {
      const t = i / rate;
      low += 0.35 * ((Math.random() * 2 - 1) - low);   // ruído já sem os agudos mais finos
      data[i] = 0.07 * low * Math.exp(-t / 0.22) * smooth(0, 0.02, t);
    }
    for (const [at, level] of early) data[Math.round((at * (c ? 1.07 : 0.94)) * rate)] += level * (c ? 0.9 : 1);
  }
  return buffer;
}

// Um ponto do carro de onde sai som, nas coordenadas do modelo
function place(x, y, z) {
  const p = ctx.createPanner();
  Object.assign(p, { panningModel: 'equalpower', distanceModel: 'inverse', refDistance: 2.5, rolloffFactor: 0.9, maxDistance: 60 });
  p.positionX.value = x + spec.frame.x0;
  p.positionY.value = y;
  p.positionZ.value = z;
  p.connect(nodes.master);
  return p;
}
function filter(type, frequency, Q = 0.7, gainDb = 0) {
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = frequency;
  f.Q.value = Q;
  f.gain.value = gainDb;
  return f;
}
const gain = (value = 0) => { const g = ctx.createGain(); g.gain.value = value; return g; };
// uma fonte de ruído que toca para sempre, passando pelos filtros dados; devolve o último deles
function hiss(...chain) {
  const src = ctx.createBufferSource();
  src.buffer = nodes.noise;
  src.loop = true;
  src.start(0, Math.random() * 2);
  return chain.reduce((a, b) => (a.connect(b), b), src);
}
async function fetchSound(file) {
  const data = await (await fetch(SOUND.base + file + '.mp3')).arrayBuffer();
  return new Promise((resolve, reject) => ctx.decodeAudioData(data, resolve, reject));
}

function build() {
  ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
  nodes = {};
  // Saída: volume geral → cabine (só na vista interior) → seco e com os reflexos da estrada → compressor suave,
  // para os picos (estalos, juntas) não estourarem
  const squeeze = ctx.createDynamicsCompressor();
  squeeze.threshold.value = -12;
  squeeze.knee.value = 10;
  squeeze.ratio.value = 4;
  squeeze.attack.value = 0.004;
  squeeze.release.value = 0.2;
  squeeze.connect(ctx.destination);
  nodes.master = gain(0);
  nodes.cabinLow = filter('lowshelf', 160);
  nodes.cabinHigh = filter('highshelf', 3200);
  nodes.master.connect(nodes.cabinLow).connect(nodes.cabinHigh).connect(squeeze);
  const space = ctx.createConvolver();
  space.buffer = roadside();
  nodes.space = gain(0.16);
  nodes.cabinHigh.connect(space).connect(nodes.space).connect(squeeze);
  nodes.noise = noiseBuffer();

  // Motor: loops → timbre (o pé fora do acelerador abafa) → volume → irregularidade da desaceleração →
  // corte da ignição → saídas do escape
  const [ex, ey, ez] = SOUND.exhaust;
  nodes.exhaust = place(ex, ey, ez);
  nodes.cut = gain(1);
  nodes.cut.connect(nodes.exhaust);
  nodes.burble = gain(1);
  nodes.burble.connect(nodes.cut);
  // sem carga, a combustão falha e volta: o volume treme ao acaso, umas dezenas de vezes por segundo
  nodes.burbleDepth = gain(0);
  hiss(filter('lowpass', 45, 0.8), nodes.burbleDepth).connect(nodes.burble.gain);
  nodes.level = gain(0);
  nodes.level.connect(nodes.burble);
  nodes.tone = filter('lowpass', 12000, 0.5);
  nodes.tone.connect(nodes.level);
  nodes.mix = gain(1);
  nodes.mix.connect(nodes.tone);
  nodes.loops = [];
  // a partida e os estalos passam ao largo do abafador, direto para as saídas
  nodes.raw = gain(1);
  nodes.raw.connect(nodes.cut);
  nodes.pops = gain(1);
  nodes.pops.connect(nodes.exhaust);

  // Pneus no asfalto: um chiado largo em volta de 700 Hz e o ronco grave da rolagem, que crescem com a velocidade
  nodes.wheels = place(0, 0.3, 0);
  nodes.tyres = gain(0);
  hiss(filter('bandpass', 700, 0.6), filter('lowpass', 2400), nodes.tyres).connect(nodes.wheels);
  nodes.rumble = gain(0);
  hiss(filter('lowpass', 140, 0.9), nodes.rumble).connect(nodes.wheels);
  // o pneu chiando no limite da frenagem
  nodes.squeal = gain(0);
  nodes.squealTone = filter('bandpass', 1350, 9);
  hiss(filter('highpass', 600), nodes.squealTone, nodes.squeal).connect(nodes.wheels);

  // Vento: em volta de quem ouve, não sai de um ponto do carro; o centro dele oscila devagar, em rajadas
  nodes.wind = gain(0);
  nodes.windTone = filter('bandpass', 1000, 0.5);
  hiss(nodes.windTone, filter('lowpass', 5000), nodes.wind).connect(nodes.master);

  loading = Promise.all([...LOOPS.map((loop) => fetchSound(loop.file)), fetchSound(START.file), fetchSound(POPS.file)]).then((buffers) => {
    nodes.start = buffers[LOOPS.length];
    nodes.popBuffer = buffers[LOOPS.length + 1];
    // Cada arquivo de loop tem o loop três vezes: qualquer trecho de um período, no meio, emenda perfeito consigo mesmo,
    // mesmo que o decodificador acrescente um silêncio no começo. Cada loop começa num ponto qualquer, para não somarem em fase
    LOOPS.forEach((loop, i) => {
      const src = ctx.createBufferSource(), g = gain(0);
      src.buffer = buffers[i];
      src.loop = true;
      src.loopStart = loop.period;
      src.loopEnd = 2 * loop.period;
      src.connect(g).connect(nodes.mix);
      src.start(0, loop.period * (1 + Math.random()));
      nodes.loops.push({ ...loop, src, gain: g, weight: 0 });
    });
  }, (error) => console.warn('Som do motor indisponível:', error)).finally(() => { sound.ready = true; });
}

// ---------- Ruídos curtos ----------
// Um estalo no escape, de força `strength` (0 a 1): um dos estalos gravados, cada vez num tom um pouco diferente.
// Quem desenha o fogo fica sabendo pelo `onPop`
function pop(strength) {
  sound.onPop?.(strength);
  if (!nodes.popBuffer) return;
  const t = ctx.currentTime, src = ctx.createBufferSource(), g = gain(1.1 * strength), which = Math.floor(Math.random() * POPS.count);
  src.buffer = nodes.popBuffer;
  src.playbackRate.value = 0.82 + 0.36 * Math.random();
  src.connect(g).connect(nodes.pops);
  src.start(t, which * POPS.slot + POPS.lead - 0.02, POPS.slot - POPS.lead - 0.01);
}
// Uma roda passando por uma junta da pista, em `z` no carro: o pneu bate e a suspensão engole
function thump(z, strength) {
  const t = ctx.currentTime, at = place(0, 0.3, z);
  const knock = ctx.createOscillator(), g = gain(0);
  knock.frequency.setValueAtTime(70 + 25 * strength, t);
  knock.frequency.exponentialRampToValueAtTime(38, t + 0.09);
  knock.connect(g).connect(at);
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(strength, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
  knock.start(t);
  knock.stop(t + 0.18);
  const src = ctx.createBufferSource(), ng = gain(0);
  src.buffer = nodes.noise;
  src.connect(filter('lowpass', 900)).connect(ng).connect(at);
  ng.gain.setValueAtTime(0.7 * strength, t);
  ng.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
  src.start(t, Math.random() * 1.8, 0.06);
  knock.onended = () => at.disconnect();
}

// ---------- Câmbio ----------
// Subindo de marcha com o pé embaixo, a central corta a ignição por um instante: o ronco some e volta com um estalo
function upshift(load) {
  const t = ctx.currentTime, g = nodes.cut.gain, deep = load > 0.3;
  g.cancelScheduledValues(t);
  g.setValueAtTime(g.value, t);
  g.linearRampToValueAtTime(deep ? 0.15 : 0.7, t + 0.012);
  g.setValueAtTime(deep ? 0.15 : 0.7, t + 0.05);
  g.linearRampToValueAtTime(1, t + 0.11);
  if (deep && Math.random() < 0.75) setTimeout(() => sound.wanted && pop(0.5 + 0.5 * load * (0.55 + 0.45 * Math.random())), 45);
}
// Reduzindo, o câmbio acelera o motor até a rotação da marcha de baixo; na volta da acelerada, o escape pipoca
function downshift(rpm) {
  sound.blip = 1;
  if (rpm < 3500) return;
  const shots = 1 + Math.floor(Math.random() * 3);
  // o primeiro estalo é o mais forte; os seguintes, cada vez mais fracos
  for (let k = 0; k < shots; k++) setTimeout(() => sound.wanted && pop((k ? 0.18 : 0.42) + (k ? 0.3 : 0.45) * Math.random()), 160 + k * (60 + Math.random() * 90));
}

// ---------- A cada quadro ----------
const ear = new THREE.Vector3(), ahead = new THREE.Vector3(), up = new THREE.Vector3();
function listen() {
  const L = ctx.listener, t = ctx.currentTime;
  ear.copy(camera.position);
  ahead.set(0, 0, -1).applyQuaternion(camera.quaternion);
  up.set(0, 1, 0).applyQuaternion(camera.quaternion);
  if (L.positionX) {
    const set = (param, v) => param.setTargetAtTime(v, t, 0.02);
    set(L.positionX, ear.x); set(L.positionY, ear.y); set(L.positionZ, ear.z);
    set(L.forwardX, ahead.x); set(L.forwardY, ahead.y); set(L.forwardZ, ahead.z);
    set(L.upX, up.x); set(L.upY, up.y); set(L.upZ, up.z);
  } else {
    L.setPosition(ear.x, ear.y, ear.z);
    L.setOrientation(ahead.x, ahead.y, ahead.z, up.x, up.y, up.z);
  }
}

// `sim` é a física do carro; `engine`, o motor como a condução o vê (ver drive.js): a fase ('off', 'start', 'on'),
// os segundos desde o começo dela, a rotação e a carga
function update(dt, sim, engine) {
  if (!ctx || !sound.wanted || ctx.state !== 'running') return;
  const t = ctx.currentTime, toward = (param, value, tau) => param.setTargetAtTime(value, t, tau);
  sound.clock += dt;
  listen();

  // Os loops entram quando a gravação da partida chega à marcha lenta; antes disso, só ela toca
  const on = engine.phase === 'on';
  const life = engine.phase === 'off' ? 0 : on ? 1 : smooth(START.blend[0], START.blend[1], engine.t);
  let rpm = engine.rpm, load = engine.load;

  // Câmbio
  if (on && sim.gear !== sound.gear) {
    if (sim.gear > sound.gear) upshift(load); else downshift(rpm);
  }
  sound.gear = sim.gear;
  sound.blip *= Math.exp(-dt / 0.12);
  load = Math.max(load, 0.9 * sound.blip);
  // o motor nunca gira perfeitamente constante: em marcha lenta, menos ainda
  rpm *= 1 + 0.0025 * Math.sin(sound.clock * 13.7) * Math.sin(sound.clock * 3.1);
  if (rpm > 600 && rpm < 1300) rpm += 18 * Math.sin(sound.clock * 7.3) + 9 * Math.sin(sound.clock * 2.1);

  // Os dois loops mais próximos da rotação, misturados de modo que o volume não oscile entre um e outro
  const loops = nodes.loops;
  if (loops.length && rpm > 1) {
    let i = 0;
    while (i < loops.length - 2 && rpm > loops[i + 1].rpm) i++;
    const a = clamp((rpm - loops[i].rpm) / (loops[i + 1].rpm - loops[i].rpm), 0, 1);
    loops.forEach((loop, k) => {
      const weight = k === i ? Math.cos(a * Math.PI / 2) : k === i + 1 ? Math.sin(a * Math.PI / 2) : 0;
      if (weight || loop.weight) toward(loop.gain.gain, weight, 0.025);
      loop.weight = weight;
      toward(loop.src.playbackRate, rpm / loop.rpm, 0.012);
    });
  }
  // Timbre e volume: o ronco cresce com a rotação e com o pé; sem carga, acima da marcha lenta, fica abafado, baixo e irregular
  const dark = (1 - load) * smooth(1400, 4200, rpm);
  toward(nodes.tone.frequency, 11000 * Math.pow(1 - 0.86 * dark, 1.6) + 600, 0.04);
  const loud = (0.5 + 0.5 * Math.pow(rpm / CAR.redline, 0.8)) * (0.42 + 0.58 * load) * (1 - 0.3 * dark) * life;
  toward(nodes.level.gain, loud, 0.035);
  toward(nodes.burbleDepth.gain, 2.4 * dark, 0.08);

  // com o pé fora em alta rotação, o escape pipoca de vez em quando
  const crackle = on ? 1.6 * (1 - load) ** 2 * smooth(3800, 7200, rpm) * (sim.v > 3 ? 1 : 0) : 0;
  if (Math.random() < crackle * dt) pop(0.12 + 0.55 * Math.random() ** 2);   // quase sempre pipocos miúdos, às vezes um estalo

  // Pneus, vento e frenagem no limite
  const v = sim.v, inside = state.view === 'interior';
  toward(nodes.tyres.gain, 0.32 * Math.pow(v / 30, 1.25) * (1 + 0.5 * sim.brake), 0.08);
  toward(nodes.rumble.gain, 0.25 * Math.min(1.5, v / 30), 0.08);
  toward(nodes.squeal.gain, 0.05 * smooth(0.6, 0.95, sim.brake) * smooth(6, 16, v), 0.06);
  toward(nodes.squealTone.frequency, 1250 + 8 * v, 0.1);
  toward(nodes.wind.gain, (inside ? 0.6 : 0.3) * Math.min(1.8, (v / 55) ** 2), 0.15);
  toward(nodes.windTone.frequency, 700 + 9 * v + 180 * Math.sin(sound.clock * 0.7) * Math.sin(sound.clock * 0.23), 0.3);
  // de dentro do carro: a cabine reforça os graves e segura os agudos, e os reflexos de fora quase não chegam
  toward(nodes.cabinLow.gain, inside ? 4 : 0, 0.1);
  toward(nodes.cabinHigh.gain, inside ? -5 : 0, 0.1);
  toward(nodes.space.gain, inside ? 0.06 : 0.16, 0.1);

  // Juntas de dilatação: primeiro as rodas da frente, depois as de trás — o "ta-tum" que se sente no volante
  if (sim.x < sound.x) sound.x = sim.x;   // recomeçou
  const hit = (z) => (size) => thump(z, 0.55 * size * smooth(1, 18, v));
  jointsBetween(sound.x + TO_FRONT, sim.x + TO_FRONT, hit(spec.frame.axleFront));
  jointsBetween(sound.x - TO_REAR, sim.x - TO_REAR, hit(spec.frame.axleRear));
  sound.x = sim.x;
}

// ---------- Liga e desliga ----------
const audible = () => sound.wanted && !sound.muted;
function volume(tau = 0.08) {
  if (nodes) nodes.master.gain.setTargetAtTime(audible() ? LEVEL : 0, ctx.currentTime, tau);
}
// Chegando à estrada, com o carro ainda desligado: prepara o som. Chamado durante o toque que escolheu o ambiente,
// que é quando o navegador permite começar a tocar
function arm() {
  if (sound.wanted) return;
  if (!ctx) build();
  Object.assign(sound, { wanted: true, gear: 1, x: 0, blip: 0 });
  if (!document.hidden) ctx.resume().then(() => sound.wanted && volume(0.02));
}
// A partida: a gravação inteira, até a marcha lenta, quando os loops tomam o lugar dela. Devolve o instante, no relógio
// do som, em que ela começou (ou nada, sem som)
function ignite() {
  if (!ctx || !nodes.start || ctx.state !== 'running') return null;
  // a gravação foi acertada para a marcha lenta dela soar como a dos loops; a subida de giro, de perto, sai mais forte
  // que o motor a pleno, e fica um pouco mais baixa aqui
  const t = ctx.currentTime, src = ctx.createBufferSource(), g = gain(0.62);
  src.buffer = nodes.start;
  src.connect(g).connect(nodes.raw);
  g.gain.setValueAtTime(0.62, t + START.blend[0]);
  g.gain.linearRampToValueAtTime(0, t + START.blend[1]);
  src.start(t);
  sound.starting = src;
  src.onended = () => { if (sound.starting === src) sound.starting = null; };
  return t;
}
// Saindo da estrada: o motor desliga e, um instante depois, o som para de vez e o aparelho descansa
function stop() {
  if (!sound.wanted) return;
  sound.wanted = false;
  volume(0.12);
  sound.starting?.stop(ctx.currentTime + 0.4);
  setTimeout(() => { if (!sound.wanted) ctx.suspend(); }, 900);
}
function toggle() {
  sound.muted = !sound.muted;
  volume();
  return !sound.muted;
}
document.addEventListener('visibilitychange', () => {
  if (!ctx || !sound.wanted) return;
  if (document.hidden) ctx.suspend(); else ctx.resume().then(() => volume());
});

const engineSound = {
  arm, ignite, stop, update, toggle,
  get ready() { return sound.ready; },
  get time() { return ctx?.currentTime ?? 0; },
  set onPop(fn) { sound.onPop = fn; },
  get loaded() { return loading; }, get context() { return ctx; }, get nodes() { return nodes; },
};
export { engineSound };
