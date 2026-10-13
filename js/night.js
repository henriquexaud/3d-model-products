import * as THREE from 'three';
import { LITE } from './config.js';
import { renderer, scene } from './scene.js';
import { SUN, seeded, fbm, smooth, paint, textureOf } from './praca-textures.js';

// ---------- Noite ----------
// O que os cenários ao ar livre ganham ao anoitecer: céu escuro com nuvens ralas, estrelas e a lua,
// que fica onde de dia está o sol. Assim as sombras caem para o mesmo lado e só a luz muda
const DUSK = new THREE.Color(0.030, 0.046, 0.088);   // bruma do horizonte à noite
const SUNLIGHT = { color: 0xfff0dc, intensity: 6.5 }, MOONLIGHT = { color: 0x9db6ea, intensity: 1.5 };

// Quanto do céu as nuvens encobrem em uma direção
const clouds = (x, y, z) => {
  const s = 1.1 / (y + 0.1);
  return smooth(0.54, 0.76, fbm(x * s + 9.4, z * s + 5.1, 4)) * smooth(0.04, 0.3, y);
};

// Céu noturno em projeção equirretangular, em valores lineares: azul profundo, mais claro no horizonte e em volta da lua
function nightSkyTexture() {
  const W = 1024, H = 512, data = new Uint16Array(W * H * 4), half = THREE.DataUtils.toHalfFloat, one = half(1);
  for (let j = 0; j < H; j++) {
    const lat = ((j + 0.5) / H - 0.5) * Math.PI, y = Math.sin(lat), flat = Math.cos(lat);
    const horizon = Math.exp(-Math.abs(y) * 12);
    for (let i = 0; i < W; i++) {
      const lon = ((i + 0.5) / W - 0.5) * 2 * Math.PI, x = Math.cos(lon) * flat, z = Math.sin(lon) * flat;
      let r = 0.012, g = 0.014, b = 0.018;   // abaixo do horizonte: o chão escuro, que só aparece nos reflexos
      if (y > 0) {
        const f = Math.pow(1 - y, 3), toMoon = Math.max(0, x * SUN.x + y * SUN.y + z * SUN.z);
        r = 0.008 + 0.030 * f; g = 0.015 + 0.048 * f; b = 0.040 + 0.085 * f;
        const cover = clouds(x, y, z) * 0.85;
        if (cover > 0) {
          const lit = 0.055 + 0.16 * Math.pow(toMoon, 6);   // o luar clareia as nuvens perto da lua
          r += (lit * 0.85 - r) * cover; g += (lit * 0.94 - g) * cover; b += (lit * 1.2 - b) * cover;
        }
        const glow = 0.05 * Math.pow(toMoon, 40) + 0.3 * Math.pow(toMoon, 900);
        r += glow * 0.85; g += glow * 0.92; b += glow;
      }
      const o = (j * W + i) * 4;
      data[o] = half(r + (0.046 - r) * horizon);
      data[o + 1] = half(g + (0.070 - g) * horizon);
      data[o + 2] = half(b + (0.125 - b) * horizon);
      data[o + 3] = one;
    }
  }
  const t = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.HalfFloatType);
  t.mapping = THREE.EquirectangularReflectionMapping;
  t.colorSpace = THREE.LinearSRGBColorSpace;
  t.minFilter = t.magFilter = THREE.LinearFilter;
  t.wrapS = THREE.RepeatWrapping;
  t.needsUpdate = true;
  return t;
}

// Estrelas: pontos nítidos espalhados pela metade de cima do céu, poucos fortes e muitos fracos
function starField() {
  const count = LITE ? 600 : 1500, rand = seeded(404), position = new Float32Array(count * 3), look = new Float32Array(count * 2);
  for (let k = 0; k < count; k++) {
    const y = 0.03 + 0.97 * rand(), turn = rand() * 2 * Math.PI, flat = Math.sqrt(1 - y * y), x = Math.cos(turn) * flat, z = Math.sin(turn) * flat;
    const bright = Math.pow(rand(), 4);
    position.set([x * 290, y * 290, z * 290], k * 3);
    // tamanho em pixels e brilho; a bruma do horizonte e as nuvens encobrem
    look.set([1.1 + 2.1 * bright, (0.3 + 0.7 * bright) * smooth(0.03, 0.3, y) * (1 - clouds(x, y, z))], k * 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geometry.setAttribute('aLook', new THREE.BufferAttribute(look, 2));
  const stars = new THREE.Points(geometry, new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uPixel: { value: renderer.getPixelRatio() } },
    vertexShader: `
      attribute vec2 aLook;
      uniform float uPixel;
      varying float vBright;
      void main() {
        vBright = aLook.y;
        gl_PointSize = aLook.x * uPixel;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      varying float vBright;
      void main() {
        float away = length(gl_PointCoord - 0.5) * 2.0;
        gl_FragColor = vec4(0.86, 0.91, 1.0, vBright * (1.0 - smoothstep(0.3, 1.0, away)));
      }`,
  }));
  // só a câmera principal as enxerga (camada 1): nas fotos pequenas dos reflexos cada estrela viraria uma bola de luz
  stars.layers.set(1);
  return stars;
}

// Lua cheia: disco claro com as manchas dos mares
function moonDisc() {
  const rand = seeded(9);
  const face = textureOf(paint(128, 128, (g) => {
    g.fillStyle = '#eef1f6';
    g.beginPath();
    g.arc(64, 64, 61, 0, 7);
    g.fill();
    g.globalCompositeOperation = 'source-atop';
    for (let i = 0; i < 9; i++) {
      g.fillStyle = `rgba(118, 128, 150, ${0.10 + rand() * 0.16})`;
      g.beginPath();
      g.arc(24 + rand() * 80, 24 + rand() * 80, 7 + rand() * 17, 0, 7);
      g.fill();
    }
  }), true, THREE.ClampToEdgeWrapping);
  const moon = new THREE.Mesh(new THREE.CircleGeometry(3.6, 48),
    new THREE.MeshBasicMaterial({ map: face, transparent: true, depthWrite: false, fog: false, toneMapped: false }));
  moon.position.copy(SUN).multiplyScalar(280);
  moon.lookAt(0, 0, 0);
  return moon;
}

// O céu é o mesmo na praça e na estrada, então é pintado uma vez só, na primeira noite
let sky = null, heavens = null;
const nightSky = () => (sky ??= nightSkyTexture());
function showHeavens(on) {
  if (on && !heavens) {
    heavens = new THREE.Group();
    heavens.add(starField(), moonDisc());
    scene.add(heavens);
  }
  if (heavens) heavens.visible = on;
}

export { DUSK, SUNLIGHT, MOONLIGHT, nightSky, showHeavens };
