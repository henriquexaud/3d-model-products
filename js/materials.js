import * as THREE from 'three';
import { LITE } from './config.js';
import { renderer, onScreen } from './scene.js';
import { seeThrough, behind, glance } from './post.js';

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

// Emblema redondo, usado no centro do volante e nas calotas: alumínio acetinado com um friso escuro e um botão preto
function badge(g, s) {
  const ring = (r, width, tone) => { g.strokeStyle = tone; g.lineWidth = width * s; g.beginPath(); g.arc(s / 2, s / 2, r * s, 0, 7); g.stroke(); };
  g.fillStyle = 'rgb(168,170,175)';
  g.fillRect(0, 0, s, s);
  ring(0.405, 0.02, 'rgb(40,41,44)');
  g.fillStyle = 'rgb(14,14,16)';
  g.beginPath();
  g.arc(s / 2, s / 2, 0.225 * s, 0, 7);
  g.fill();
  ring(0.172, 0.016, 'rgb(205,207,211)');
}

const std = (p) => new THREE.MeshStandardMaterial(p);
const phys = (p) => new THREE.MeshPhysicalMaterial(p);
const emblem = phys({ map: canvasTexture(256, badge, 1, true), metalness: 0.9, roughness: 0.34, clearcoat: 1.0, clearcoatRoughness: 0.06 });

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

// Pintura automotiva em duas camadas. Por baixo, a tinta: dá a cor e espalha a luz, mais ou menos metálica conforme
// o acabamento de cada cor (COLORS, em config.js). Por cima, o verniz: liso, espelha o entorno com nitidez e é ele
// que mostra as curvas da carroceria
const paintFlake = { value: 1 };   // o quanto as lamelas da cor atual aparecem
const bodyMaterial = phys({
  metalness: 0.6, roughness: 0.45, clearcoat: 1.0, clearcoatRoughness: 0.03, envMapIntensity: 1.0
});
if (!LITE) bodyMaterial.onBeforeCompile = (shader) => {
  shader.uniforms.uFlake = paintFlake;
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vPaint;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPaint = position;');
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>
      varying vec3 vPaint;
      uniform float uFlake;
      vec3 flakeTilt(vec3 cell) {
        return fract(sin(vec3(dot(cell, vec3(127.1, 311.7, 74.7)), dot(cell, vec3(269.5, 183.3, 246.1)), dot(cell, vec3(113.5, 271.9, 124.6)))) * 43758.5453) - 0.5;
      }`)
    // Lamelas metálicas: cada grãozinho da tinta reflete numa direção um pouco diferente. De perto têm 0,2 mm; de longe
    // não dá para ver cada uma, só o cintilar do conjunto, por isso o grão acompanha o tamanho do pixel
    .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      float paintPixel = length(fwidth(vPaint));
      float grain = max(0.0, log2(paintPixel * 3600.0)), coarse = floor(grain);
      vec3 flake = mix(flakeTilt(floor(vPaint * 5000.0 * exp2(-coarse))), flakeTilt(floor(vPaint * 2500.0 * exp2(-coarse))), grain - coarse);
      normal = normalize(normal + flake * uFlake * 0.13 / (1.0 + 0.3 * grain));`)
    // Casca de laranja: o verniz seca com uma ondulação de poucos milímetros, que deforma de leve o que ele espelha
    .replace('#include <clearcoat_normal_fragment_maps>', `#include <clearcoat_normal_fragment_maps>
      vec3 peelAt = vPaint * 380.0;
      vec3 peel = sin(peelAt.yzx + 1.7 * sin(peelAt.zxy * 0.61));
      clearcoatNormal = normalize(clearcoatNormal + peel * 0.0022 * (1.0 - smoothstep(0.002, 0.008, paintPixel)));`);
};
const alloy = std({ color: 0x8f9399, metalness: 1.0, roughness: 0.28 });
// Rodas de liga leve em dois tons, sob verniz: a face torneada, clara e lustrosa, e o corpo pintado de grafite
const alloyFace = phys({ color: 0xb6b9be, metalness: 1.0, roughness: 0.24, clearcoat: 0.7, clearcoatRoughness: 0.05 });
const alloyBody = phys({ color: 0x4d5055, metalness: 0.85, roughness: 0.38, clearcoat: 0.7, clearcoatRoughness: 0.08 });
const darkMetal = std({ color: 0x2a2b2e, metalness: 1.0, roughness: 0.35 });
// Lentes dos faróis e das lanternas. Apagadas, são vidro escuro que espelha o entorno; o brilho de cada uma é dado em lamps.js
const headGlass = std({ color: 0x1c1f24, metalness: 0.85, roughness: 0.08, emissive: 0xe4edff, emissiveIntensity: 0 });
const ledGlass = std({ color: 0x8d939b, metalness: 0.4, roughness: 0.22, emissive: 0xeef3ff, emissiveIntensity: 0 });
const tailGlass = phys({ color: 0x7a0508, roughness: 0.15, clearcoat: 1.0, emissive: 0xff1a0c, emissiveIntensity: 0 });
// Botões vermelhos da cabine: no modelo original usam o material das lanternas, mas não acendem com elas
const redButton = phys({ color: 0x7a0508, roughness: 0.15, clearcoat: 1.0, emissive: 0x8a0000, emissiveIntensity: 0.35 });

// Vidro liso, levemente tingido, que espelha o entorno. O que aparece através dele vem da cópia da imagem tirada no instante
// em que ele é desenhado (ver post.js): a luz guardada nela volta a ser a luz da cena, passa pelo tom do vidro e perde
// a parte que o reflexo leva. É a mesma conta da transmissão do three.js, sem desenhar a cena uma segunda vez
function clearGlass() {
  const glass = phys({ color: 0xcfd8dc, metalness: 0, roughness: 0, ior: 1.5, envMapIntensity: 1.0 });
  if (!seeThrough) return Object.assign(glass, { transmission: 1.0, thickness: 0.01 });
  glass.transparent = true;            // entra depois do que é opaco e do que, mesmo transparente, fica atrás dele
  glass.blending = THREE.NoBlending;   // a cor que ele dá já inclui o que está atrás
  glass.onBeforeRender = () => glance('glass');
  glass.onBeforeCompile = (shader) => {
    shader.uniforms.tBehind = behind;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D tBehind;')
      .replace('#include <transmission_fragment>', `
        vec3 seen = texelFetch(tBehind, ivec2(gl_FragCoord.xy), 0).rgb;
        seen /= max(1.0 - max(seen.r, max(seen.g, seen.b)), 0.02);
        #ifdef TONE_MAPPING
          seen /= toneMappingExposure;
        #endif
        vec3 kept = 1.0 - EnvironmentBRDF(normal, geometryViewDir, material.specularColor, material.specularF90, material.roughness);
        totalDiffuse = kept * material.diffuseColor * seen;`);
  };
  glass.customProgramCacheKey = () => 'clearGlass';
  return glass;
}

// Material por nome do material original do modelo
const MATERIALS = {
  Body_Color: bodyMaterial,
  Glass_Gray: LITE
    ? phys({ color: 0x9fb4bd, metalness: 0, roughness: 0, transparent: true, opacity: 0.3, envMapIntensity: 1.5 })
    : clearGlass(),
  // couro: quase preto, de grão miúdo, com o brilho macio que ele ganha quando a luz bate de raspão
  Leather: triplanar(phys({ color: 0x1b1b1e, roughness: 0.52, bumpMap: leatherBump, bumpScale: 0.9, sheen: 0.4, sheenRoughness: 0.45, sheenColor: 0x66666c }), 7),
  Leather_red: triplanar(phys({ color: 0x6a4a31, roughness: 0.56, bumpMap: leatherBump, bumpScale: 0.9, sheen: 0.3, sheenRoughness: 0.5, sheenColor: 0x8a6a4e }), 7),
  Interior_dark: triplanar(std({ color: 0x141416, roughness: 0.78, bumpMap: plasticBump, bumpScale: 0.3 }), 9),
  Interior_light: triplanar(std({ color: 0x2c2d31, roughness: 0.72, bumpMap: plasticBump, bumpScale: 0.3 }), 9),
  plastic_gray: triplanar(std({ color: 0x18181a, roughness: 0.6, bumpMap: plasticBump, bumpScale: 0.2 }), 9),
  Carpet: triplanar(std({ color: 0x101012, roughness: 1.0, bumpMap: carpetBump, bumpScale: 1.0 }), 6),
  // fibra de carbono: a trama, com mechas de pouco mais de 2 mm, fica sob uma camada lisa de verniz
  Carbon_Fiber: triplanar(phys({
    map: carbonMap, bumpMap: carbonMap, bumpScale: 0.3, metalness: 0.35, roughness: 0.4, clearcoat: 1.0, clearcoatRoughness: 0.05
  }), 57, true),
  metal_gray: alloy,
  metal_chrome: std({ color: 0xcfd2d6, metalness: 1.0, roughness: 0.12 }),
  Tires: std({ color: 0x0c0c0d, roughness: 0.85 }),
  Taillight_Glass: tailGlass,
  Projector_Glass: headGlass,
  Turn_Signal_LED: ledGlass,
  Ferrari_Yellow: darkMetal,
};
// Discos de freio perfurados: os furos são desenhados pelo raio e pelo ângulo em torno do eixo, e viram um borrão quando a roda gira
const discSpin = { value: 0 };
const disc = std({ color: 0x4c4e52, metalness: 0.8, roughness: 0.44 });
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
      diffuseColor.rgb *= 1.0 - 0.85 * hole * (1.0 - uSpin);`)
    // a pastilha deixa a pista do disco riscada em círculos: cada faixa fina de raio brilha um pouco mais ou um pouco menos
    .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
      float scratch = fract(sin(floor(discR * 1400.0) * 91.7) * 43758.5453) - 0.5;
      roughnessFactor = clamp(roughnessFactor + 0.3 * scratch * step(0.8, vFlat) * (1.0 - smoothstep(0.0003, 0.0012, edge)), 0.06, 1.0);`);
};
// Exceções por nome da peça (peças que compartilham material no modelo original)
const MESH_OVERRIDES = [
  [/^brake(_\d)?$/, disc],
  [/^rim_/, alloyFace],
  [/^wheel(_\d)?$/, alloyBody],
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
  carbon: () => triplanar(phys({ map: carbonMap, bumpMap: carbonMap, bumpScale: 0.3, metalness: 0.35, roughness: 0.4, clearcoat: 1.0, clearcoatRoughness: 0.05 }), 57, true),
  inox: () => std({ color: 0xb3b3b1, metalness: 1.0, roughness: 0.27 }),
  inoxHot: () => std({ color: 0x8a7e70, metalness: 1.0, roughness: 0.4 }),
  core: () => std({ map: finMap, metalness: 0.7, roughness: 0.6 }),
  white: () => std({ color: 0xd9d7cd, roughness: 0.5 }),
  copper: () => std({ color: 0x9c7150, metalness: 1.0, roughness: 0.4 }),
  cable: () => std({ color: 0x7c1d18, roughness: 0.6 }),
  spring: () => std({ color: 0x262b33, metalness: 0.7, roughness: 0.4 }),
  caliper: () => phys({ color: 0xe2b100, roughness: 0.42, clearcoat: 1.0, clearcoatRoughness: 0.07 }),   // pinças pintadas de amarelo
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
  uniforms: { uColor: { value: new THREE.Color() }, uBase: { value: 0.02 }, uRim: { value: 0.42 }, uCurve: { value: 1 } },
  vertexShader: `
    varying vec3 vN; varying vec3 vV;
    void main() {
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vN = normalMatrix * normal; vV = -mv.xyz;
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: `
    uniform vec3 uColor; uniform float uBase; uniform float uRim; uniform float uCurve;
    varying vec3 vN; varying vec3 vV;
    void main() {
      float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
      gl_FragColor = vec4(uColor, pow(uBase + uRim * f * f, uCurve));
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
  transparent: true, depthWrite: false, side: THREE.DoubleSide, toneMapped: !LITE,
});
// Dá à casca a cor `hex`, acertada para a exposição atual. Uma casca escura só escurece o que está atrás dela, e a cor
// é convertida como qualquer outra. Uma casca clara soma luz à imagem, e pouca luz já aparece muito: para o contorno
// ficar branco e o meio continuar limpo, deixando ver as peças nas cores delas, a opacidade cai com a curva da tela (2,2)
// e a cor é acertada para o brilho que chega à borda, não para a cor cheia, que perto do branco pediria uma luz sem fim
function tintGhost(hex) {
  const u = ghost.uniforms, tone = u.uColor.value.setHex(hex), light = !LITE && tone.r + tone.g + tone.b > 1.5;
  u.uCurve.value = light ? 2.2 : 1;
  if (!light) return onScreen(tone);
  const rim = (u.uBase.value + u.uRim.value) ** 2.2;
  return onScreen(tone.multiplyScalar(rim)).multiplyScalar(1 / rim);
}

export { castBump, std, phys, emblem, bodyMaterial, paintFlake, headGlass, ledGlass, tailGlass, redButton, discSpin, MATERIALS, MESH_OVERRIDES, mats, highlight, ghost, tintGhost };
