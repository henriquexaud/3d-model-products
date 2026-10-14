import { CAR } from './physics.js';

// ---------- Suspensão em movimento ----------
// A carroceria sobe, desce, inclina para a frente e para os lados sobre quatro conjuntos de mola e amortecedor;
// cada roda, com o seu peso, fica entre a suspensão e o pneu, que também é uma mola. Quem move tudo é o relevo
// da pista sob cada roda, a força de acelerar ou frear e a pressão do ar. Unidades do SI; rodas na ordem DE, DD, TE, TD
const RIDE = {
  unsprung: [45, 45, 52, 52],          // kg de roda, pneu, freio e manga em cada canto
  track: [1.672, 1.638],               // bitola dianteira e traseira (m)
  pitchInertia: 2180, rollInertia: 430,   // kg·m²
  frequency: [1.75, 2.0],              // Hz: balanço próprio da carroceria sobre o eixo dianteiro e o traseiro
  damping: 0.7,                       // fração do amortecimento crítico nos movimentos lentos, que são os da carroceria...
  knee: 0.13, fast: 0.4,               // ...acima de 0,13 m/s o amortecedor cede, para a roda engolir os ressaltos sem sacudir o carro
  bump: 0.75, rebound: 1.25,           // mais macio quando a roda sobe, mais firme quando ela volta
  antiPitch: 0.3,                      // parte do peso transferido que os braços seguram sem comprimir as molas
  settle: 0.15,                        // s: tempo em que o carro "assenta" sobre as ondulações longas da pista
  antiRoll: [26000, 16000],            // N/m: barras estabilizadoras, que só agem quando um lado sobe mais que o outro
  tyre: 290000, tyreDamping: 350,      // N/m e N·s/m: o pneu
  stop: 0.06,                          // curso até o batente (m)
  aeroFront: 0.45,                     // parte da pressão do ar que cai sobre o eixo dianteiro
  rollArm: 0.34,                       // altura do centro de massa acima do eixo em torno do qual a carroceria rola nas curvas (m)
};
const SPRUNG = CAR.mass - RIDE.unsprung.reduce((a, b) => a + b);   // massa apoiada nas molas
const TO_FRONT = CAR.wheelbase * CAR.rearShare, TO_REAR = CAR.wheelbase - TO_FRONT;   // do centro de massa a cada eixo
const CORNERS = [0, 1, 2, 3].map((i) => {
  const front = i < 2, load = SPRUNG * (front ? 1 - CAR.rearShare : CAR.rearShare) / 2;   // massa sobre cada canto
  const k = load * (2 * Math.PI * RIDE.frequency[front ? 0 : 1]) ** 2;
  return {
    x: (i % 2 ? 1 : -1) * RIDE.track[front ? 0 : 1] / 2, z: front ? -TO_FRONT : TO_REAR,   // posição em relação ao centro de massa
    k, c: 2 * RIDE.damping * Math.sqrt(k * load), bar: RIDE.antiRoll[front ? 0 : 1], mass: RIDE.unsprung[i],
  };
});

// Relevo da pista. O asfalto bom tem ondulações de todos os comprimentos, mais altas quanto mais longas (norma ISO 8608,
// entre as classes A e B); os dois trilhos de roda são parecidos nas ondas longas e independentes nas curtas
const LOOP = 480;   // as irregularidades localizadas se repetem a cada volta do cenário (m)
const FEATURES = [
  { at: 46, kind: 'joint' },               // junta de dilatação: ressalto estreito de 8 mm nos dois trilhos
  { at: 121, kind: 'patch', side: 1 },     // remendo de 6 mm de altura e 3 m de comprimento, em um trilho só
  { at: 204, kind: 'dip' },                // depressão suave de 16 mm ao longo de 18 m
  { at: 268, kind: 'joint' },
  { at: 337, kind: 'patch', side: -1 },
  { at: 409, kind: 'joint' },
];
const waves = [];
{
  let seed = 20261;
  const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const count = 24, low = 0.08, high = 4;   // ciclos por metro: ondas de 12,5 m a 25 cm
  for (let i = 0; i < count; i++) {
    const n = low * (high / low) ** ((i + 0.5) / count), apart = Math.min(0.7, 0.25 + 0.5 * n);
    const amp = Math.sqrt(2 * 2.2e-7 / (n * n) * n * Math.log(high / low) / count);
    waves.push({ w: 2 * Math.PI * n, both: amp * Math.sqrt(1 - apart * apart), apart: amp * apart, p1: rand() * 6.283, p2: rand() * 6.283 });
  }
}
const ramp = (x, a, b) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
// Altura da pista (m) no ponto `x` do percurso, no trilho esquerdo (side = -1) ou direito (+1)
function roadHeight(x, side) {
  let h = 0;
  for (const wave of waves) h += wave.both * Math.sin(wave.w * x + wave.p1) + side * wave.apart * Math.sin(wave.w * x + wave.p2);
  h *= ramp(x, 0, 6);   // a saída é sempre de um trecho liso
  for (const f of FEATURES) {
    let u = (x - f.at) % LOOP;
    if (u > LOOP / 2) u -= LOOP; else if (u < -LOOP / 2) u += LOOP;
    if (f.kind === 'joint') h += 0.008 * Math.exp(-((u / 0.10) ** 2));
    else if (f.kind === 'patch' && f.side === side) h += 0.006 * ramp(u, 0, 0.4) * (1 - ramp(u, 2.6, 3));
    else if (f.kind === 'dip' && u > 0 && u < 18) h -= 0.008 * (1 - Math.cos(2 * Math.PI * u / 18));
  }
  return h;
}

function createRide() {
  // z, pitch e roll: carroceria; wheel: altura de cada roda; travel: quanto cada suspensão está comprimida; ground: pista sob cada roda;
  // base: o plano que acompanha só as ondulações longas da pista (altura sob o centro de massa, subida para trás e para a direita)
  const r = { z: 0, pitch: 0, roll: 0, wheel: [0, 0, 0, 0], travel: [0, 0, 0, 0], ground: [0, 0, 0, 0], base: [0, 0, 0] };
  let vz = 0, vp = 0, vr = 0, fresh = true;
  const vu = [0, 0, 0, 0], ground = r.ground, force = [0, 0, 0, 0];

  // Avança `dt` segundos. `x` é a distância percorrida ao fim do passo; velocidade, aceleração e pressão do ar vêm da física do carro.
  // `lateral` é a aceleração para a esquerda que a curva impõe (m/s²)
  r.step = (dt, x, speed, accel, downforce, lateral = 0) => {
    if (!(dt > 1e-6)) return;   // dois quadros no mesmo instante: nada a avançar
    const n = Math.ceil(dt / 0.001), h = dt / n;
    for (let k = 1; k <= n; k++) {
      const at = x - speed * dt * (1 - k / n);
      let lift = 0, tip = 0, lean = 0;
      for (let i = 0; i < 4; i++) {
        const c = CORNERS[i];
        const body = r.z - c.z * r.pitch + c.x * r.roll, bodySpeed = vz - c.z * vp + c.x * vr;   // altura da carroceria neste canto
        const s = r.wheel[i] - body, ds = vu[i] - bodySpeed;
        r.travel[i] = s;
        const quick = Math.abs(ds), damped = quick < RIDE.knee ? quick : RIDE.knee + RIDE.fast * (quick - RIDE.knee);
        force[i] = c.k * s + c.c * (ds > 0 ? RIDE.bump : -RIDE.rebound) * damped;
        if (Math.abs(s) > RIDE.stop) force[i] += 4e5 * (s - Math.sign(s) * RIDE.stop);   // batente de borracha
      }
      for (let i = 0; i < 4; i += 2) {   // a barra estabilizadora passa esforço de um lado para o outro
        const twist = CORNERS[i].bar * (r.travel[i] - r.travel[i + 1]);
        force[i] += twist;
        force[i + 1] -= twist;
      }
      for (let i = 0; i < 4; i++) {
        const c = CORNERS[i], height = roadHeight(at - c.z, i % 2 ? 1 : -1);
        const climb = fresh ? 0 : (height - ground[i]) / h;
        ground[i] = height;
        vu[i] += (-force[i] + RIDE.tyre * (height - r.wheel[i]) + RIDE.tyreDamping * (climb - vu[i])) / c.mass * h;
        r.wheel[i] += vu[i] * h;
        lift += force[i];
        tip -= c.z * force[i];
        lean += c.x * force[i];
      }
      fresh = false;
      // acelerar joga o peso para trás e frear, para a frente; o ar aperta os dois eixos, um pouco mais o traseiro
      tip += SPRUNG * accel * CAR.cgHeight * (1 - RIDE.antiPitch) + downforce * (TO_REAR * (1 - RIDE.aeroFront) - TO_FRONT * RIDE.aeroFront);
      lean -= SPRUNG * lateral * RIDE.rollArm;   // na curva a carroceria deita para o lado de fora
      vz += (lift - downforce) / SPRUNG * h;
      vp += tip / RIDE.pitchInertia * h;
      vr += lean / RIDE.rollInertia * h;
      r.z += vz * h;
      r.pitch += vp * h;
      r.roll += vr * h;
      // plano de referência: média lenta da pista sob as quatro rodas
      const blend = 1 - Math.exp(-h / RIDE.settle), front = (ground[0] + ground[1]) / 2, rear = (ground[2] + ground[3]) / 2;
      r.base[0] += ((front * TO_REAR + rear * TO_FRONT) / CAR.wheelbase - r.base[0]) * blend;
      r.base[1] += ((rear - front) / CAR.wheelbase - r.base[1]) * blend;
      r.base[2] += (((ground[1] + ground[3]) - (ground[0] + ground[2])) / (RIDE.track[0] + RIDE.track[1]) - r.base[2]) * blend;
    }
  };
  r.reset = () => {
    r.z = r.pitch = r.roll = vz = vp = vr = 0;
    fresh = true;
    for (let i = 0; i < 4; i++) r.wheel[i] = r.travel[i] = vu[i] = ground[i] = 0;
    r.base.fill(0);
  };
  return r;
}

export { RIDE, SPRUNG, CORNERS, TO_FRONT, TO_REAR, LOOP, FEATURES, roadHeight, createRide };
