import { spec } from './cars/index.js';
import { CAR } from './physics.js';
import { roadHeight } from './relief.js';

// ---------- Suspensão em movimento ----------
// A carroceria sobe, desce, inclina para a frente e para os lados sobre quatro conjuntos de mola e amortecedor;
// cada roda, com o seu peso, fica entre a suspensão e o pneu, que também é uma mola. Quem move tudo é o relevo
// da pista sob cada roda, a força de acelerar ou frear e a pressão do ar. Unidades do SI; rodas na ordem DE, DD, TE, TD
// As medidas são as do carro escolhido (ver `ride` na ficha dele)
const RIDE = spec.ride;
const SPRUNG = CAR.mass - RIDE.unsprung.reduce((a, b) => a + b);   // massa apoiada nas molas
const TO_FRONT = CAR.wheelbase * CAR.rearShare, TO_REAR = CAR.wheelbase - TO_FRONT;   // do centro de massa a cada eixo
// ponto em torno do qual a carroceria inclina, nas coordenadas do modelo: baixo, sob o centro de massa
const PIVOT = [0, RIDE.pivotHeight, spec.frame.axleFront + TO_FRONT];
const CORNERS = [0, 1, 2, 3].map((i) => {
  const front = i < 2, load = SPRUNG * (front ? 1 - CAR.rearShare : CAR.rearShare) / 2;   // massa sobre cada canto
  const k = load * (2 * Math.PI * RIDE.frequency[front ? 0 : 1]) ** 2;
  return {
    x: (i % 2 ? 1 : -1) * RIDE.track[front ? 0 : 1] / 2, z: front ? -TO_FRONT : TO_REAR,   // posição em relação ao centro de massa
    k, c: 2 * RIDE.damping * Math.sqrt(k * load), bar: RIDE.antiRoll[front ? 0 : 1], mass: RIDE.unsprung[i],
  };
});

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

export { RIDE, SPRUNG, CORNERS, TO_FRONT, TO_REAR, PIVOT, createRide };
