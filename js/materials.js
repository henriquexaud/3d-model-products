import * as THREE from 'three';
import { LITE } from './config.js';
import { renderer } from './scene.js';

// ---------- Texturas e materiais ----------
// Texturas procedurais (desenhadas em canvas, sem arquivos externos)
function canvasTexture(size, draw, repeat, srgb = false) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
// Granulado: manchas claras/escuras sobre cinza médio, usado como relevo
function grain(count, minR, maxR, contrast) {
  return (g, s) => {
    g.fillStyle = '#808080';
    g.fillRect(0, 0, s, s);
    for (let i = 0; i < count; i++) {
      const v = 128 + (Math.random() - 0.5) * contrast;
      g.fillStyle = `rgba(${v},${v},${v},0.6)`;
      const r = minR + Math.random() * (maxR - minR);
      const x = Math.random() * s, y = Math.random() * s;
      // repete nas bordas para a textura emendar sem costura
      for (const dx of [-s, 0, s]) for (const dy of [-s, 0, s]) {
        g.beginPath();
        g.ellipse(x + dx, y + dy, r, r * (0.6 + Math.random() * 0.6), Math.random() * 3, 0, 7);
        g.fill();
      }
    }
  };
}
// Trama de fibra de carbono (sarja 2x2)
function carbonWeave(g, s) {
  const n = 8, cell = s / n;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const horizontal = ((x + y) >> 1) % 2 === 0;
    const grad = horizontal
      ? g.createLinearGradient(0, y * cell, 0, (y + 1) * cell)
      : g.createLinearGradient(x * cell, 0, (x + 1) * cell, 0);
    grad.addColorStop(0, '#101012');
    grad.addColorStop(0.5, horizontal ? '#3a3b3f' : '#2a2b2e');
    grad.addColorStop(1, '#101012');
    g.fillStyle = grad;
    g.fillRect(x * cell, y * cell, cell, cell);
  }
}
// Colmeia de radiador: aletas verticais finas cortadas pelos tubos
function radiatorFins(g, s) {
  g.fillStyle = '#7b8086';
  g.fillRect(0, 0, s, s);
  g.fillStyle = '#2d3034';
  for (let x = 0; x < s; x += 4) g.fillRect(x, 0, 2, s);
  g.fillStyle = '#9499a0';
  for (let y = 0; y < s; y += 16) g.fillRect(0, y, s, 3);
}

const leatherBump = canvasTexture(512, grain(5000, 1.5, 4, 150), 14);
const plasticBump = canvasTexture(256, grain(9000, 0.6, 1.4, 120), 30);
const carpetBump = canvasTexture(256, grain(12000, 0.5, 1.2, 255), 24);
const rubberBump = canvasTexture(256, grain(6000, 0.6, 1.5, 100), 6);
const castBump = canvasTexture(256, grain(7000, 0.8, 2.2, 110), 6);
const carbonMap = canvasTexture(256, carbonWeave, 10, true);
const finMap = canvasTexture(64, radiatorFins, 1, true);
finMap.repeat.set(8, 2);

const std = (p) => new THREE.MeshStandardMaterial(p);
const phys = (p) => new THREE.MeshPhysicalMaterial(p);

// Pintura metálica com verniz
const bodyMaterial = phys({
  metalness: 0.75, roughness: 0.38, clearcoat: 1.0, clearcoatRoughness: 0.04, envMapIntensity: 1.1
});
const alloy = std({ color: 0x8f9399, metalness: 1.0, roughness: 0.28 });
const darkMetal = std({ color: 0x2a2b2e, metalness: 1.0, roughness: 0.35 });
const headGlass = std({ color: 0xffffff, roughness: 0.1, emissive: 0xf2f6ff });
const ledGlass = std({ color: 0xffffff, roughness: 0.2, emissive: 0xfff3e0 });
const tailGlass = phys({ color: 0x7a0508, roughness: 0.15, clearcoat: 1.0, emissive: 0x8a0000 });
const LIGHTS = [[headGlass, 1.2], [ledGlass, 0.9], [tailGlass, 0.35]];

// Material por nome do material original do modelo
const MATERIALS = {
  Body_Color: bodyMaterial,
  Glass_Gray: LITE
    ? phys({ color: 0x9fb4bd, metalness: 0, roughness: 0, transparent: true, opacity: 0.3, envMapIntensity: 1.5 })
    : phys({
      color: 0xcfd8dc, metalness: 0, roughness: 0, transmission: 1.0, ior: 1.5, thickness: 0.01,
      envMapIntensity: 1.2
    }),
  Leather: std({ color: 0x26262a, roughness: 0.6, bumpMap: leatherBump, bumpScale: 0.6 }),
  Leather_red: std({ color: 0x5a4030, roughness: 0.62, bumpMap: leatherBump, bumpScale: 0.6 }),
  Interior_dark: std({ color: 0x141416, roughness: 0.78, bumpMap: plasticBump, bumpScale: 0.3 }),
  Interior_light: std({ color: 0x2c2d31, roughness: 0.72, bumpMap: plasticBump, bumpScale: 0.3 }),
  plastic_gray: std({ color: 0x18181a, roughness: 0.6, bumpMap: plasticBump, bumpScale: 0.2 }),
  Carpet: std({ color: 0x101012, roughness: 1.0, bumpMap: carpetBump, bumpScale: 1.0 }),
  Carbon_Fiber: phys({
    map: carbonMap, metalness: 0.3, roughness: 0.45, clearcoat: 1.0, clearcoatRoughness: 0.08
  }),
  metal_gray: alloy,
  metal_chrome: std({ color: 0xc9ccd1, metalness: 1.0, roughness: 0.14 }),
  Tires: std({ color: 0x0c0c0d, roughness: 0.85 }),
  Taillight_Glass: tailGlass,
  Projector_Glass: headGlass,
  Turn_Signal_LED: ledGlass,
  Ferrari_Yellow: darkMetal,
};
// Exceções por nome da peça (peças que compartilham material no modelo original)
const MESH_OVERRIDES = [
  [/^tire/, std({ color: 0x0b0b0c, roughness: 0.92, bumpMap: rubberBump, bumpScale: 0.5 })],
  [/^brake(_\d)?$/, std({ color: 0x55585d, metalness: 0.75, roughness: 0.48 })],
  [/^(nuts|centre)/, darkMetal],
];

// Materiais das peças mecânicas. Cada camada recebe cópias próprias, para poder ser destacada sozinha
const MECH = {
  alu: () => std({ color: 0xa9adb3, metalness: 0.9, roughness: 0.52, bumpMap: castBump, bumpScale: 0.35 }),
  aluSatin: () => std({ color: 0xbcc0c6, metalness: 1.0, roughness: 0.34 }),
  steel: () => std({ color: 0x7e8187, metalness: 1.0, roughness: 0.36 }),
  darkSteel: () => std({ color: 0x1c1d20, metalness: 0.85, roughness: 0.45 }),
  black: () => std({ color: 0x141517, roughness: 0.62, bumpMap: plasticBump, bumpScale: 0.2 }),
  rubber: () => std({ color: 0x0c0c0d, roughness: 0.9 }),
  plenum: () => std({ color: 0x2c2f34, metalness: 0.2, roughness: 0.85, bumpMap: castBump, bumpScale: 0.6 }),
  carbon: () => phys({ map: carbonMap, metalness: 0.3, roughness: 0.45, clearcoat: 1.0, clearcoatRoughness: 0.08 }),
  inox: () => std({ color: 0xb3b3b1, metalness: 1.0, roughness: 0.27 }),
  inoxHot: () => std({ color: 0x8a7e70, metalness: 1.0, roughness: 0.4 }),
  core: () => std({ map: finMap, metalness: 0.7, roughness: 0.6 }),
  white: () => std({ color: 0xd9d7cd, roughness: 0.5 }),
  copper: () => std({ color: 0x9c7150, metalness: 1.0, roughness: 0.4 }),
  cable: () => std({ color: 0x7c1d18, roughness: 0.6 }),
  spring: () => std({ color: 0x262b33, metalness: 0.7, roughness: 0.4 }),
  caliper: () => std({ color: 0x61656c, metalness: 0.8, roughness: 0.36 }),
};
const layerMats = {};
function mats(id) {
  const cache = (layerMats[id] ??= {});
  return new Proxy({}, { get: (_, key) => (cache[key] ??= MECH[key]()) });
}
function highlight(id, on) {
  for (const m of Object.values(layerMats[id] ?? {})) {
    m.emissive.setHex(on ? 0x3b82f6 : 0x000000);
    m.emissiveIntensity = on ? 0.22 : 1;
  }
}

// Carroceria em raio-X: casca translúcida que só aparece nos contornos
const ghost = new THREE.ShaderMaterial({
  uniforms: { uColor: { value: new THREE.Color() }, uBase: { value: 0.02 }, uRim: { value: 0.42 } },
  vertexShader: `
    varying vec3 vN; varying vec3 vV;
    void main() {
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vN = normalMatrix * normal; vV = -mv.xyz;
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: `
    uniform vec3 uColor; uniform float uBase; uniform float uRim;
    varying vec3 vN; varying vec3 vV;
    void main() {
      float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
      gl_FragColor = vec4(uColor, uBase + uRim * f * f);
      #include <colorspace_fragment>
    }`,
  transparent: true, depthWrite: false, side: THREE.DoubleSide,
});

export { castBump, std, phys, bodyMaterial, LIGHTS, MATERIALS, MESH_OVERRIDES, mats, highlight, ghost };
