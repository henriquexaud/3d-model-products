import * as THREE from 'three';
import { LITE, state } from '../../config.js';
import { G } from '../../layers.js';
import { renderer } from '../../scene.js';

// ---------- Fogo no escape ----------
// Um estalo é combustível que queima já fora do motor. Filmado de perto, ele sai do tubo como um jato curto e liso,
// logo se abre numa bola de fogo que rola e se desfaz, e tudo dura uma fração de segundo. A cor conta a química: a
// chama azul é a da combustão limpa, que se vê na boca do tubo; o amarelo e o laranja são fuligem incandescente, que
// esfria para o vermelho escuro antes de sumir. E a força do estalo muda tudo: um pipoco de desaceleração é só uma
// lambida azulada na ponta de um tubo; um estalo de troca de marcha é uma língua alaranjada; um estouro forte vira uma
// bola de fogo amarela que cresce e sobe. Com o carro andando, o vento deita o fogo para trás.
// O fogo são partículas: cada uma é um disco virado para a câmera, esticado no sentido em que anda, com borda
// turbulenta e cor dada pela temperatura, que cai com a idade. A boca do tubo acende por dentro e o asfalto logo atrás
// recebe o clarão. Nada disso é luz da cena: os programas de desenho dos outros materiais não mudam.
// Posições medidas no modelo, em metros; o jato sai no sentido +z
const OUTLETS = [-0.109, 0.001, 0.111];   // as três ponteiras, no plano y = 0,41, terminando em z = 2,178
const MOUTH_Y = 0.41, MOUTH_Z = 2.185, PIPE = 0.03;
const POOL = 256;                         // partículas vivas ao mesmo tempo, no máximo

const vertexShader = `
  uniform float uHalo;
  attribute vec3 aCenter, aVel;
  attribute vec4 aState;   // tamanho (m), idade (0 a 1), temperatura inicial, semente
  attribute vec2 aLook;    // quanto da chama ainda é azul e o quanto ela pesa na imagem
  varying vec2 vUv;
  varying vec4 vState;
  varying vec2 vLook;
  void main() {
    vUv = uv;
    vState = aState;
    vLook = aLook;
    vec4 mv = modelViewMatrix * vec4(aCenter, 1.0);
    // esticada no sentido em que anda, como numa foto com o obturador aberto um instante
    vec3 dir = mat3(modelViewMatrix) * aVel;
    float speed = length(dir.xy);
    vec2 along = speed > 1e-3 ? dir.xy / speed : vec2(1.0, 0.0), across = vec2(-along.y, along.x);
    float stretch = 1.0 + min(2.2, speed * 0.045);
    mv.xy += (position.x * stretch * along + position.y * across) * aState.x * (1.0 + 0.9 * uHalo);
    gl_Position = aState.x > 0.0 ? projectionMatrix * mv : vec4(2.0, 2.0, 2.0, 1.0);
  }`;

const fragmentShader = `
  uniform float uGain, uHalo;
  varying vec2 vUv;
  varying vec4 vState;
  varying vec2 vLook;
  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
  }
  float fbm(vec2 p) { return 0.55 * noise(p) + 0.3 * noise(p * 2.1 + 3.7) + 0.15 * noise(p * 4.3 - 1.9); }
  // cor do fogo pela temperatura: vermelho escuro, laranja, amarelo e, no mais quente, quase branco
  vec3 glow(float t) {
    vec3 c = mix(vec3(0.4, 0.02, 0.0), vec3(1.0, 0.24, 0.02), smoothstep(0.1, 0.45, t));
    c = mix(c, vec3(1.0, 0.48, 0.06), smoothstep(0.45, 0.85, t));
    return mix(c, vec3(1.0, 0.7, 0.3), smoothstep(0.95, 1.3, t)) * (0.6 + 1.5 * t);
  }
  void main() {
    float age = vState.y, heat = vState.z, seed = vState.w;
    vec2 p = vUv * 2.0 - 1.0;
    // a borda é turbulenta, e mais ainda quanto mais velha a bola de fogo
    float n = fbm(p * 2.8 + vec2(seed * 7.13, seed * 3.31 - age * 2.6));
    float r = length(p) + (n - 0.5) * (0.55 + 0.7 * age);
    // o brilho em volta (uHalo) é a mesma partícula, maior e mais suave, somando luz em vez de cobrir
    float body = 1.0 - smoothstep(mix(0.45, 0.0, uHalo), mix(0.85, 1.0, uHalo), r);
    if (body <= 0.0) discard;
    float t = heat * (1.0 - age) * (0.55 + 0.75 * n) * (1.1 - 0.6 * r);
    vec3 color = mix(glow(t), vec3(0.35, 0.55, 1.0) * (1.0 + 0.9 * heat), vLook.x * (1.0 - smoothstep(0.0, 0.5, age)));
    // o que esfria fica transparente: o fogo não escurece o que está atrás dele
    float alpha = body * smoothstep(0.08, 0.35, t) * pow(1.0 - age, 1.4) * vLook.y * mix(1.0, 0.06 * t, uHalo);
    gl_FragColor = vec4(color * uGain, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }`;

// Disco de brilho suave, para a boca dos tubos e o clarão no chão
const softDisc = (() => {
  const S = 64, data = new Uint8Array(S * S * 4);
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const r = Math.hypot((i + 0.5) / S - 0.5, (j + 0.5) / S - 0.5) * 2, v = Math.max(0, 1 - r) ** 2;
    data.set([255, 255, 255, 255 * v], (j * S + i) * 4);
  }
  const t = new THREE.DataTexture(data, S, S);
  t.needsUpdate = true;
  return t;
})();
const additive = (extra) => ({ blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: !LITE, fog: false, ...extra });

const parts = [];      // { x, y, z, vx, vy, vz, age, life, wait, size, grow, heat, blue, seed, alive }
const mouths = [];     // a boca de cada tubo, que acende por dentro
let mesh = null, halo = null, attrs = null, ground = null, wind = 0;

function buildFlames() {
  const g = G('exhaust');
  const geometry = new THREE.InstancedBufferGeometry(), quad = new THREE.PlaneGeometry(2, 2);
  geometry.index = quad.index;
  geometry.setAttribute('position', quad.attributes.position);
  geometry.setAttribute('uv', quad.attributes.uv);
  attrs = {
    aCenter: new THREE.InstancedBufferAttribute(new Float32Array(POOL * 3), 3),
    aVel: new THREE.InstancedBufferAttribute(new Float32Array(POOL * 3), 3),
    aState: new THREE.InstancedBufferAttribute(new Float32Array(POOL * 4), 4),
    aLook: new THREE.InstancedBufferAttribute(new Float32Array(POOL * 2), 2),
  };
  for (const [name, attr] of Object.entries(attrs)) { attr.setUsage(THREE.DynamicDrawUsage); geometry.setAttribute(name, attr); }
  geometry.instanceCount = POOL;
  for (let i = 0; i < POOL; i++) parts.push({ alive: false });
  mesh = new THREE.Mesh(geometry, new THREE.ShaderMaterial({
    // cada partícula cobre o que está atrás, em vez de somar luz: muitas juntas continuam amarelas e laranja, sem estourar
    // para o branco
    uniforms: { uGain: { value: 1 }, uHalo: { value: 0 } }, vertexShader, fragmentShader,
    transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: !LITE, fog: false,
  }));
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  g.add(mesh);
  // o brilho do fogo em volta dele, que de noite acende o ar e deixa o clarão na imagem
  halo = new THREE.Mesh(geometry, new THREE.ShaderMaterial({
    uniforms: { uGain: mesh.material.uniforms.uGain, uHalo: { value: 1 } }, vertexShader, fragmentShader,
    ...additive({ side: THREE.DoubleSide }),
  }));
  halo.frustumCulled = false;
  halo.renderOrder = 6;
  g.add(halo);

  for (const x of OUTLETS) {
    const mouth = new THREE.Sprite(new THREE.SpriteMaterial({ map: softDisc, color: 0xff7a30, opacity: 0, ...additive() }));
    mouth.position.set(x, MOUTH_Y, MOUTH_Z - 0.01);
    mouth.scale.setScalar(0.09);
    mouth.renderOrder = 5;
    mouth.userData.hot = 0;
    g.add(mouth);
    mouths.push(mouth);
  }
  // o clarão no asfalto, logo atrás do carro
  ground = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.3).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: softDisc, color: 0xff6a20, opacity: 0, ...additive() }));
  ground.position.set(0, 0.012, MOUTH_Z + 0.35);
  ground.renderOrder = 3;
  ground.userData.hot = 0;
  g.add(ground);
  // tudo fica à vista até o primeiro quadro, para os programas de desenho serem compilados junto com os do carro
}

const rand = (a, b) => a + (b - a) * Math.random();
function emit(outlet, o) {
  const p = parts.find((q) => !q.alive);
  if (!p) return;
  const spread = o.spread * rand(0.3, 1), angle = rand(0, 2 * Math.PI), speed = o.speed * rand(0.7, 1.15);
  Object.assign(p, {
    alive: true, age: 0, wait: o.wait, life: o.life * rand(0.7, 1.3),
    x: OUTLETS[outlet] + rand(-1, 1) * PIPE * 0.5, y: MOUTH_Y + rand(-1, 1) * PIPE * 0.5, z: MOUTH_Z,
    vx: Math.cos(angle) * spread * speed, vy: Math.sin(angle) * spread * speed, vz: speed,
    size: o.size * rand(0.75, 1.2), grow: o.grow * rand(0.7, 1.3), heat: o.heat * rand(0.85, 1.1), blue: o.blue, weight: o.weight, seed: Math.random(),
  });
}

// Um estalo de força `strength` (0 a 1). Fraco, é uma lambida azulada em um ou dois tubos; médio, uma língua alaranjada;
// forte, um jato que se abre numa bola de fogo amarela, dos três tubos, e acende o asfalto
function backfire(strength) {
  if (!mesh) return;
  const s = Math.min(1, Math.max(0, strength));
  const crackle = s < 0.4, bang = s > 0.7;
  const outlets = crackle ? [Math.floor(Math.random() * 3), ...(Math.random() < 0.4 ? [Math.floor(Math.random() * 3)] : [])]
    : bang ? [0, 1, 2] : [0, 1, 2].filter((i) => i === 1 || Math.random() < 0.7);
  for (const i of new Set(outlets)) {
    const own = s * rand(0.75, 1.15) * (i === 1 ? 1.1 : 1);   // os tubos nunca soltam fogo igual
    const count = Math.round(crackle ? rand(4, 7) : bang ? rand(22, 30) : rand(10, 15));
    for (let k = 0; k < count; k++) {
      const front = k / count;   // as primeiras partículas são o jato; as últimas, a bola que se abre e fica para trás
      emit(i, {
        wait: front * (crackle ? 0.02 : bang ? 0.06 : 0.035) + rand(0, 0.006),
        life: crackle ? 0.055 : bang ? 0.16 + 0.08 * front : 0.09 + 0.03 * front,
        // o arrasto do ar para cada partícula em velocidade / DRAG metros: ~10 cm num pipoco, ~30 cm num estalo,
        // ~50 cm num estouro
        speed: (crackle ? 4 : bang ? 16 : 9) * (1 - 0.5 * front) * (0.8 + 0.4 * own),
        spread: crackle ? 0.15 : 0.12 + (bang ? 0.45 : 0.25) * front,
        size: crackle ? 0.02 : bang ? 0.028 : 0.022,
        grow: (crackle ? 0.032 : bang ? 0.12 : 0.055) * (0.6 + 0.6 * front) * (0.8 + 0.4 * own),
        heat: crackle ? 1.0 : bang ? 1.15 : 0.95,
        blue: crackle ? 0.5 : bang ? 0.25 * (1 - front) : 0.5 * (1 - front),
        weight: crackle ? 0.85 : bang ? 0.6 : 0.7,   // o quanto cada partícula cobre
      });
    }
    mouths[i].userData.hot = Math.max(mouths[i].userData.hot, crackle ? 0.35 : bang ? 1 : 0.65);
  }
  ground.userData.hot = Math.max(ground.userData.hot, crackle ? 0.1 : bang ? 1 : 0.45);
}

// A velocidade do carro (m/s): o ar leva o fogo para trás. Logo atrás da traseira o ar é a esteira do carro, que o
// acompanha em parte: ali ele passa a um terço da velocidade, não a ela inteira
const setWind = (v) => { wind = 0.35 * v; };

// O fogo brilha por conta própria: a exposição da cena quase não muda o quanto ele aparece na tela. De noite ele fica
// um pouco mais forte que de dia, como fica mesmo para quem olha
const DAY_EXPOSURE = 0.56, DRAG = 32, LIFT = 1.2;
function updateFlames(dt) {
  if (!mesh) return;
  const gain = Math.sqrt(DAY_EXPOSURE / renderer.toneMappingExposure);
  const C = attrs.aCenter.array, V = attrs.aVel.array, S = attrs.aState.array, L = attrs.aLook.array;
  let any = false;
  parts.forEach((p, i) => {
    if (p.alive && p.wait > 0) p.wait -= dt;
    else if (p.alive) {
      p.age += dt / p.life;
      if (p.age >= 1) p.alive = false;
      else {
        // o gás perde velocidade no ar parado e passa a andar com o vento; quente, sobe um pouco
        const k = 1 - Math.exp(-DRAG * dt);
        p.vx -= p.vx * k;
        p.vy += (LIFT * p.age - p.vy) * k;
        p.vz += (wind - p.vz) * k;
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      }
    }
    const shown = p.alive && p.wait <= 0;
    any ||= p.alive;
    C[i * 3] = p.x ?? 0; C[i * 3 + 1] = p.y ?? 0; C[i * 3 + 2] = p.z ?? 0;
    V[i * 3] = p.vx ?? 0; V[i * 3 + 1] = p.vy ?? 0; V[i * 3 + 2] = p.vz ?? 0;
    S[i * 4] = shown ? p.size + p.grow * Math.sqrt(p.age) : 0;
    S[i * 4 + 1] = p.age ?? 0; S[i * 4 + 2] = p.heat ?? 0; S[i * 4 + 3] = p.seed ?? 0;
    L[i * 2] = p.blue ?? 0; L[i * 2 + 1] = p.weight ?? 0;
  });
  for (const attr of Object.values(attrs)) attr.needsUpdate = true;
  mesh.visible = halo.visible = any;
  mesh.material.uniforms.uGain.value = gain;
  for (const m of mouths) {
    m.userData.hot *= Math.exp(-dt / 0.06);
    m.visible = m.userData.hot > 0.01;
    m.material.opacity = Math.min(1, m.userData.hot) * gain;
  }
  // de dia o clarão no chão quase não aparece; de noite, ilumina o asfalto atrás do carro
  ground.userData.hot *= Math.exp(-dt / 0.11);
  ground.visible = ground.userData.hot > 0.01;
  ground.material.opacity = Math.min(1, ground.userData.hot * (state.night ? 1.1 : 0.15)) * gain;
}

export { buildFlames, backfire, updateFlames, setWind };
