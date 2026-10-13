// ---------- Física do carro em linha reta ----------
// O motor empurra pelas rodas traseiras, através do câmbio; o ar, a rolagem dos pneus e os freios seguram.
// Um "motorista" dosa acelerador e freio para levar o carro à velocidade pedida. Tudo em unidades do SI
const GRAVITY = 9.81;
const CAR = {
  mass: 1610,                           // kg, com motorista e meio tanque
  wheelbase: 2.651, cgHeight: 0.46,     // m
  rearShare: 0.58,                      // parte do peso sobre o eixo traseiro, que é o que traciona
  wheelRadius: 0.358,                   // m
  dragArea: 0.36 * 2.03,                // coeficiente de arrasto × área frontal (m²), com a capota aberta
  downforceArea: 0.74,                  // o ar também aperta o carro contra o chão: ~140 kg a 200 km/h
  airDensity: 1.2,                      // kg/m³
  rolling: 0.011, rollingSpeed: 44.4,   // rolagem dos pneus: f · (1 + v / 160 km/h) · peso
  grip: 1.1,                            // aderência pneu-asfalto seco
  gears: [3.08, 2.19, 1.63, 1.29, 1.03, 0.84, 0.69], finalDrive: 5.14, efficiency: 0.88,
  idle: 900, redline: 9000,             // rpm
  torque: [[900, 320], [2000, 400], [3000, 450], [4000, 490], [5000, 525], [6000, 540], [7000, 530], [8000, 495], [9000, 445]],   // N·m
  topSpeed: 320 / 3.6,                  // m/s
};
const DRIVER = { gain: 0.8, accel: 4.5, decel: 5.5 };   // o quanto ele pede de aceleração (1/s) e os limites (m/s²)

function torqueAt(rpm) {
  const T = CAR.torque;
  if (rpm <= T[0][0]) return T[0][1];
  for (let i = 1; i < T.length; i++) {
    if (rpm <= T[i][0]) return T[i - 1][1] + (T[i][1] - T[i - 1][1]) * (rpm - T[i - 1][0]) / (T[i][0] - T[i - 1][0]);
  }
  return T[T.length - 1][1];
}
const engineBrake = (rpm) => -(25 + 0.011 * rpm);   // torque do motor com o acelerador solto (N·m)
const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
const ease = (h, tau) => 1 - Math.exp(-h / tau);

function createSim() {
  const s = {
    target: 0,          // velocidade pedida (m/s)
    v: 0, a: 0, x: 0,   // velocidade, aceleração e distância percorrida
    gear: 1, rpm: CAR.idle, throttle: 0, brake: 0,
    wheels: 0, air: 0, road: 0, downforce: 0,   // forças (N): nas rodas (motor menos freios), do ar e da rolagem
    shifting: 0, sinceShift: 1,
  };
  const ratioOf = (gear) => CAR.gears[gear - 1] * CAR.finalDrive;
  const pull = (rpm, gear) => torqueAt(rpm) * ratioOf(gear) * CAR.efficiency / CAR.wheelRadius;   // força máxima nas rodas

  function advance(h) {
    const ratio = ratioOf(s.gear);
    const locked = s.v / CAR.wheelRadius * 30 / Math.PI * ratio;   // rotação do motor com a embreagem fechada
    // saindo da imobilidade a embreagem patina e o motor gira mais do que as rodas pedem
    const slipping = s.gear === 1 && locked < CAR.idle + 2300 * s.throttle;
    const rpm = Math.min(CAR.redline, slipping ? CAR.idle + 2300 * s.throttle : Math.max(locked, CAR.idle));

    const air = 0.5 * CAR.airDensity * CAR.dragArea * s.v * s.v;
    s.downforce = 0.5 * CAR.airDensity * CAR.downforceArea * s.v * s.v;
    const weight = CAR.mass * GRAVITY + s.downforce;
    const road = s.v > 0.05 ? CAR.rolling * (1 + s.v / CAR.rollingSpeed) * weight : 0;
    const inertia = CAR.mass * (1.04 + 0.0012 * ratio * ratio);   // as peças que giram também precisam ser aceleradas
    const most = pull(rpm, s.gear), least = slipping ? 0 : engineBrake(rpm) * ratio / CAR.wheelRadius;

    // motorista: pede uma aceleração proporcional ao que falta e descobre a força necessária nas rodas
    const stopping = s.target < 0.1 && s.v < 1;
    const want = stopping ? -2 : clamp((s.target - s.v) * DRIVER.gain, -DRIVER.decel, DRIVER.accel);
    const need = inertia * want + air + road;
    const throttle = clamp((need - least) / (most - least), 0, 1);
    // só freia quando soltar o acelerador não basta: ar, rolagem e freio-motor fazem a primeira parte
    const brake = throttle > 0 ? 0 : clamp((least - need) / (CAR.grip * weight), 0, 1);
    s.throttle += (throttle - s.throttle) * ease(h, brake > 0 ? 0.06 : 0.18);
    s.brake += (brake - s.brake) * ease(h, 0.12);

    // força nas rodas traseiras, limitada pela aderência (a aceleração joga peso para trás)
    let drive = (least + s.throttle * (most - least)) * (s.shifting > 0 ? 0.5 : 1);   // a troca de marcha quase não interrompe a força
    const rear = weight * CAR.rearShare + CAR.mass * Math.max(0, s.a) * CAR.cgHeight / CAR.wheelbase;
    drive = Math.min(drive, CAR.grip * rear);
    const braking = s.brake * CAR.grip * weight;
    let net = drive - braking - air - road;
    const held = s.v <= 0 && net < 0;   // parado, os freios apenas seguram o carro
    if (held) net = 0;
    s.a = net / inertia;
    s.v += s.a * h;
    if (s.v < 0 || (stopping && s.v < 0.05)) { s.v = 0; s.a = 0; }
    s.x += s.v * h;
    s.wheels = held ? 0 : drive - braking;
    s.air = -air;
    s.road = -road;
    s.rpm += (rpm - s.rpm) * ease(h, 0.07);

    // câmbio automático: sobe de marcha mais cedo com pouco acelerador e reduz quando falta força ou rotação
    s.shifting -= h;
    s.sinceShift += h;
    if (s.sinceShift < 0.45) return;
    const up = 1700 + 7100 * Math.pow(throttle, 1.3), down = 1200 + 2200 * throttle + 2500 * Math.min(1, s.brake * 3);
    const next = s.gear < 7 ? locked * CAR.gears[s.gear] / CAR.gears[s.gear - 1] : 0;
    const prev = s.gear > 1 ? locked * CAR.gears[s.gear - 2] / CAR.gears[s.gear - 1] : Infinity;
    let gear = s.gear;
    if (s.gear < 7 && (locked > 8800 || (throttle > 0.02 && locked > up && pull(next, s.gear + 1) >= need * 1.15))) gear++;
    else if (prev < 8400 && (locked < down || (need > most * 1.03 && pull(prev, s.gear - 1) > most))) gear--;
    if (gear !== s.gear) { s.gear = gear; s.shifting = 0.06; s.sinceShift = 0; }
  }

  s.step = (dt) => {
    for (let left = Math.min(dt, 0.25); left > 1e-6; left -= 1 / 120) advance(Math.min(left, 1 / 120));
  };
  s.reset = () => Object.assign(s, { v: 0, a: 0, x: 0, gear: 1, rpm: CAR.idle, throttle: 0, brake: 0, wheels: 0, air: 0, road: 0, downforce: 0, shifting: 0, sinceShift: 1 });
  return s;
}

export { CAR, GRAVITY, createSim };
