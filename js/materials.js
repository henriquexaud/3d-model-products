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

// Tela das grades: losangos vazados em chapa escura
function grilleMesh(g, s) {
  g.fillStyle = '#b4b6ba';
  g.fillRect(0, 0, s, s);
  g.fillStyle = '#050506';
  for (const [cx, cy] of [[0, 0], [s, 0], [0, s], [s, s], [s / 2, s / 2]]) {
    g.beginPath();
    g.moveTo(cx - s * 0.36, cy); g.lineTo(cx, cy - s * 0.2); g.lineTo(cx + s * 0.36, cy); g.lineTo(cx, cy + s * 0.2);
    g.fill();
  }
}

const leatherBump = canvasTexture(512, grain(5000, 1.5, 4, 150), 14);
const plasticBump = canvasTexture(256, grain(9000, 0.6, 1.4, 120), 30);
const carpetBump = canvasTexture(256, grain(12000, 0.5, 1.2, 255), 24);
const castBump = canvasTexture(256, grain(7000, 0.8, 2.2, 110), 6);
const carbonMap = canvasTexture(256, carbonWeave, 10, true);
const finMap = canvasTexture(64, radiatorFins, 1, true);
const grilleMap = canvasTexture(64, grilleMesh, 1, true);
finMap.repeat.set(8, 2);

const std = (p) => new THREE.MeshStandardMaterial(p);
const phys = (p) => new THREE.MeshPhysicalMaterial(p);

// As peças do modelo original não trazem coordenadas de textura. Aqui o relevo (e, se pedido, a cor) é projetado
// pelos três eixos da própria peça, com `tiles` repetições por metro
const BUMP_CHUNK = THREE.ShaderChunk.bumpmap_pars_fragment.replace(/vec2 dHdxy_fwd\(\) \{[\s\S]*?\n\t\}/, `
  float triHeight(vec3 p, vec3 w) {
    return dot(w, vec3(texture2D(bumpMap, p.yz).x, texture2D(bumpMap, p.zx).x, texture2D(bumpMap, p.xy).x));
  }
  vec2 dHdxy_fwd() {
    vec3 w = triWeights(), p = vTriPos * uTiles, dx = dFdx(p), dy = dFdy(p);
    float h = triHeight(p, w);
    return bumpScale * vec2(triHeight(p + dx, w) - h, triHeight(p + dy, w) - h);
  }`);
function triplanar(material, tiles, colour = false) {
  if (LITE) return material;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTiles = { value: tiles };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTriPos, vTriNormal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTriPos = position; vTriNormal = normal;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vTriPos, vTriNormal;
        uniform float uTiles;
        vec3 triWeights() { vec3 w = abs(normalize(vTriNormal)); w *= w; w *= w; return w / (w.x + w.y + w.z); }`)
      .replace('#include <bumpmap_pars_fragment>', BUMP_CHUNK);
    if (colour) shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `
      vec3 triW = triWeights(), triP = vTriPos * uTiles;
      diffuseColor *= triW.x * texture2D(map, triP.yz) + triW.y * texture2D(map, triP.zx) + triW.z * texture2D(map, triP.xy);`);
  };
  material.customProgramCacheKey = () => `triplanar${colour}`;
  return material;
}

// Pintura metálica com verniz
const bodyMaterial = phys({
  metalness: 0.75, roughness: 0.38, clearcoat: 1.0, clearcoatRoughness: 0.04, envMapIntensity: 1.1
});
// Lamelas metálicas: sob o verniz, cada grãozinho da tinta reflete numa direção um pouco diferente. Só de perto dá para ver
if (!LITE) bodyMaterial.onBeforeCompile = (shader) => {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vFlake;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFlake = position * 1100.0;');
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vFlake;')
    .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      vec3 flake = floor(vFlake);
      vec3 tilt = fract(sin(vec3(dot(flake, vec3(127.1, 311.7, 74.7)), dot(flake, vec3(269.5, 183.3, 246.1)), dot(flake, vec3(113.5, 271.9, 124.6)))) * 43758.5453) - 0.5;
      normal = normalize(normal + tilt * 0.13 * (1.0 - smoothstep(0.7, 2.2, length(fwidth(vFlake)))));`);
};
const alloy = std({ color: 0x8f9399, metalness: 1.0, roughness: 0.28 });
const darkMetal = std({ color: 0x2a2b2e, metalness: 1.0, roughness: 0.35 });
// Lentes dos faróis e das lanternas. Apagadas, são vidro escuro que espelha o entorno; o brilho de cada uma é dado em lamps.js
const headGlass = std({ color: 0x1c1f24, metalness: 0.85, roughness: 0.08, emissive: 0xe4edff, emissiveIntensity: 0 });
const ledGlass = std({ color: 0x8d939b, metalness: 0.4, roughness: 0.22, emissive: 0xeef3ff, emissiveIntensity: 0 });
const tailGlass = phys({ color: 0x7a0508, roughness: 0.15, clearcoat: 1.0, emissive: 0xff1a0c, emissiveIntensity: 0 });
// Botões vermelhos da cabine: no modelo original usam o material das lanternas, mas não acendem com elas
const redButton = phys({ color: 0x7a0508, roughness: 0.15, clearcoat: 1.0, emissive: 0x8a0000, emissiveIntensity: 0.35 });

// Material por nome do material original do modelo
const MATERIALS = {
  Body_Color: bodyMaterial,
  Glass_Gray: LITE
    ? phys({ color: 0x9fb4bd, metalness: 0, roughness: 0, transparent: true, opacity: 0.3, envMapIntensity: 1.5 })
    : phys({
      color: 0xcfd8dc, metalness: 0, roughness: 0, transmission: 1.0, ior: 1.5, thickness: 0.01,
      envMapIntensity: 1.2
    }),
  Leather: triplanar(std({ color: 0x26262a, roughness: 0.6, bumpMap: leatherBump, bumpScale: 0.6 }), 7),
  Leather_red: triplanar(std({ color: 0x5a4030, roughness: 0.62, bumpMap: leatherBump, bumpScale: 0.6 }), 7),
  Interior_dark: triplanar(std({ color: 0x141416, roughness: 0.78, bumpMap: plasticBump, bumpScale: 0.3 }), 9),
  Interior_light: triplanar(std({ color: 0x2c2d31, roughness: 0.72, bumpMap: plasticBump, bumpScale: 0.3 }), 9),
  plastic_gray: triplanar(std({ color: 0x18181a, roughness: 0.6, bumpMap: plasticBump, bumpScale: 0.2 }), 9),
  Carpet: triplanar(std({ color: 0x101012, roughness: 1.0, bumpMap: carpetBump, bumpScale: 1.0 }), 6),
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
// Discos de freio perfurados: os furos são desenhados pelo raio e pelo ângulo em torno do eixo, e viram um borrão quando a roda gira
const discSpin = { value: 0 };
const disc = std({ color: 0x55585d, metalness: 0.75, roughness: 0.48 });
disc.onBeforeCompile = (shader) => {
  shader.uniforms.uSpin = discSpin;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vDisc; varying float vFlat;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvDisc = position; vFlat = abs(normal.x);');
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vDisc; varying float vFlat;\nuniform float uSpin;')
    .replace('#include <color_fragment>', `#include <color_fragment>
      float discR = length(vDisc.yz), column = atan(vDisc.z, vDisc.y) / 6.2831853 * 36.0;
      float row = 0.142 + 0.016 * mod(floor(column), 4.0), edge = fwidth(discR);
      float away = length(vec2((fract(column) - 0.5) * 6.2831853 / 36.0 * discR, discR - row));
      float hole = (1.0 - smoothstep(0.0036 - edge, 0.0036 + edge, away)) * step(0.8, vFlat) * (1.0 - smoothstep(0.0015, 0.005, edge));
      diffuseColor.rgb *= 1.0 - 0.85 * hole * (1.0 - uSpin);`);
};
// Exceções por nome da peça (peças que compartilham material no modelo original)
const MESH_OVERRIDES = [
  [/^brake(_\d)?$/, disc],
  [/^grills/, triplanar(std({ map: grilleMap, bumpMap: grilleMap, bumpScale: 1.2, color: 0x4a4c50, metalness: 0.55, roughness: 0.5 }), 105, true)],
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
  carpet: () => std({ color: 0x0c0c0e, roughness: 1.0, bumpMap: carpetBump, bumpScale: 1.0 }),
  blue: () => std({ color: 0x2456a8, roughness: 0.5 }),
  yellow: () => std({ color: 0xc9a227, roughness: 0.5 }),
  green: () => std({ color: 0x2f8a4c, roughness: 0.5 }),
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

export { castBump, std, phys, bodyMaterial, headGlass, ledGlass, tailGlass, redButton, discSpin, MATERIALS, MESH_OVERRIDES, mats, highlight, ghost };
