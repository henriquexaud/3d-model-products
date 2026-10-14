import * as THREE from 'three';
import { LITE, X0, layers, state, look } from './config.js';
import { scene, selfLight } from './scene.js';
import { headGlass, ledGlass, tailGlass } from './materials.js';
import { M } from './layers.js';
import { smooth, paint, textureOf } from './praca-textures.js';

// ---------- Faróis e lanternas ----------
// Um farol aceso é mais do que uma lente clara: ela estoura de brilho, a câmera enxerga um halo em volta dela
// e o facho ilumina o chão à frente, com o corte horizontal do farol baixo. Posições medidas no modelo, em metros
const HEAD = 7, LED = 4.5, TAIL = 1.3, STOP = 5;   // brilho das lentes: farol, luz diurna, lanterna e luz de freio
const LAMP_Y = 0.6, NOSE = -2.3;                   // os fachos saem da altura dos faróis, mas da ponta do carro, para não iluminar a própria carroceria
const CONE = 0.72, AIM = 0.12;                     // meia abertura de cada facho e o quanto ele aponta para baixo, em radianos
const BEAM = LITE ? 5600 : 2800;                   // candelas de cada facho no ponto mais forte

// Desenho do farol baixo, visto de dentro do facho: escuro acima da linha de corte, mais forte logo abaixo dela
function beamPattern() {
  const S = 256, data = new Uint16Array(S * S * 4), half = THREE.DataUtils.toHalfFloat, one = half(1);
  const deg = Math.PI / 180, edge = Math.tan(CONE), cut = 0.7 * deg, sinA = Math.sin(AIM), cosA = Math.cos(AIM), spread = LITE ? 1.35 : 1;
  // luz que o chão recebe a `r` metros: começa pouco à frente do carro e se desfaz com a distância
  const reach = (r) => smooth(0.9, 6.5, r) / (1 + Math.pow(r / 10, 3.5));
  // para o chão ficar assim, o farol manda muito mais luz para longe do que para perto, porque lá ela chega rasante e espalhada
  const along = (pitch) => reach(LAMP_Y / Math.sin(pitch)) / Math.pow(Math.sin(pitch), 3);
  const top = along(cut);
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const x = ((i + 0.5) / S * 2 - 1) * edge, y = ((j + 0.5) / S * 2 - 1) * edge, len = Math.hypot(x, y, 1);
    // direção deste ponto: quanto abaixo do horizonte e quanto para a direita
    const pitch = Math.asin((sinA - y * cosA) / len), yaw = Math.atan2(x, y * sinA + cosA) / spread;
    const line = cut - Math.min(3 * deg, Math.max(0, yaw) * 0.27);   // do lado direito o corte sobe, para mostrar a margem da pista
    const side = 0.65 * Math.exp(-((yaw / (19 * deg)) ** 2)) + 0.35 * Math.exp(-((yaw / (36 * deg)) ** 2));
    let v = side * along(Math.max(pitch, cut)) / top * smooth(line - 0.25 * deg, line + 0.35 * deg, pitch);
    v += 0.01 * side * Math.exp(-Math.max(0, line - pitch) / (7 * deg));   // um resto de luz escapa acima do corte
    v *= 1 - smooth(0.72, 0.98, Math.hypot(x, y) / edge);                  // e o facho se apaga antes da borda do cone
    const o = (j * S + i) * 4;
    data[o] = data[o + 1] = data[o + 2] = half(v);
    data[o + 3] = one;
  }
  const t = new THREE.DataTexture(data, S, S, THREE.RGBAFormat, THREE.HalfFloatType);
  t.colorSpace = THREE.LinearSRGBColorSpace;
  t.minFilter = t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

// Os fachos ficam fora do carro, direto na cena, e continuam nela mesmo apagados: assim os materiais não precisam
// ser refeitos cada vez que o farol liga. O conjunto acompanha a carroceria, que na estrada balança sobre a suspensão
const rig = new THREE.Group(), beams = [], pattern = beamPattern();
for (const x of LITE ? [0] : [-0.66, 0.66]) {
  const beam = new THREE.SpotLight(0xe9f0ff, 0, 0, CONE, 0, 2);
  beam.map = pattern;
  beam.position.set(X0 + x, LAMP_Y, NOSE);
  beam.target.position.set(X0 + x, LAMP_Y - 10 * Math.sin(AIM), NOSE - 10 * Math.cos(AIM));
  rig.add(beam, beam.target);
  beams.push(beam);
}
scene.add(rig);

// Halo: o clarão que uma luz forte deixa na lente da câmera, com um risco horizontal
const glare = textureOf(paint(256, 256, (g) => {
  const core = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  for (const [at, alpha] of [[0, 1], [0.04, 0.9], [0.1, 0.42], [0.25, 0.13], [0.5, 0.035], [1, 0]]) core.addColorStop(at, `rgba(255,255,255,${alpha})`);
  g.fillStyle = core;
  g.fillRect(0, 0, 256, 256);
  g.globalCompositeOperation = 'lighter';
  g.translate(128, 128);
  g.scale(1, 0.022);
  const streak = g.createRadialGradient(0, 0, 0, 0, 0, 128);
  streak.addColorStop(0, 'rgba(255,255,255,0.7)');
  streak.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = streak;
  g.fillRect(-128, -128 / 0.022, 256, 256 / 0.022);
}), true, THREE.ClampToEdgeWrapping);

// Um halo por lente. `facing` é para onde a lente aponta: de lado ou por trás o clarão some.
// `power` diz o quanto ele aparece, dado o brilho das luzes (de 0 a 1) e o do freio
const halos = [];
function halo(x, y, z, facing, size, color, power, boost = 1.6) {
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glare, color, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, toneMapped: !LITE, fog: false,
  }));
  selfLight(sprite.material.color, boost);
  sprite.position.set(x, y, z);
  sprite.renderOrder = 5;
  sprite.visible = false;
  M('body').add(sprite);
  halos.push({ sprite, facing: new THREE.Vector3(...facing).normalize(), size, power });
}
for (const s of [-1, 1]) {
  halo(s * 0.677, 0.609, -1.857, [s * 0.12, -0.04, -1], 1.25, 0xdfe9ff, (lit) => lit);                              // farol
  halo(s * 0.765, 0.72, -1.64, [s * 0.25, 0.3, -1], 0.5, 0xeaf1ff, (lit) => 0.4 * lit);                             // luz diurna
  // lanterna: menos reforço, porque um vermelho forte demais vira laranja no mapeamento de tons
  halo(s * 0.772, 0.875, 2.05, [s * 0.1, 0, 1], 0.8, 0xff1508, (lit, stop) => Math.min(1, 0.4 * lit + stop), 0.75);
}

const lamps = { level: 0, brake: 0, dark: false };
const setBrake = (amount) => { lamps.brake = amount; };
// Apaga os fachos enquanto um cenário é fotografado para os reflexos, para a luz deles não ficar gravada na foto
const dimLamps = (dark) => { lamps.dark = dark; for (const beam of beams) if (dark) beam.intensity = 0; };

const seen = new THREE.Vector3(), toCamera = new THREE.Vector3();
function updateLamps(dt, camera) {
  // as luzes acendem e apagam em uma fração de segundo, não de um quadro para o outro
  const want = state.lights ? 1 : 0;
  lamps.level += (want - lamps.level) * (1 - Math.exp(-dt * 11));
  if (Math.abs(want - lamps.level) < 0.003) lamps.level = want;
  const lit = lamps.level, body = layers.body.group, tune = look();
  headGlass.emissiveIntensity = HEAD * lit;
  ledGlass.emissiveIntensity = LED * lit;
  tailGlass.emissiveIntensity = TAIL * lit + STOP * lamps.brake;

  // em raio-X ou sem a carroceria as lentes não estão lá, e as luzes somem com elas
  const solid = state.body === 'solid';
  rig.position.copy(body.position);
  rig.rotation.copy(body.rotation);
  for (const beam of beams) beam.intensity = solid && !lamps.dark ? BEAM * lit * tune.beam : 0;
  for (const h of halos) {
    seen.copy(h.sprite.position).add(body.position);
    seen.x += X0;
    const distance = toCamera.subVectors(camera.position, seen).length();
    const strength = solid ? h.power(lit, lamps.brake) * smooth(0.2, 0.7, toCamera.dot(h.facing) / distance) : 0;
    h.sprite.visible = strength > 0.004;
    h.sprite.material.opacity = strength;
    // de longe o clarão encolhe menos do que o carro, como numa foto
    h.sprite.scale.setScalar(h.size * tune.glow * (0.55 + 0.075 * distance));
  }
}

export { setBrake, dimLamps, updateLamps };
