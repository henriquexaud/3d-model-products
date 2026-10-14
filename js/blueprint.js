import * as THREE from 'three';
import { LITE, ENVS } from './config.js';
import { onScreen, shadowsDirty } from './scene.js';
import { invalidate } from './pace.js';

// ---------- Prancheta ----------
// Os cenários ao ar livre só são desenhados por inteiro até um raio em volta do carro. Dali para fora o chão vira o piso
// do estúdio, com a mesma malha e as mesmas cores, sob o mesmo céu, e o que fica longe aparece apenas em traços, na cor
// da malha, como num projeto. Na estrada, o que vem chegando é desenhado aos poucos: primeiro os traços, de baixo para cima;
// depois o volume, que sobe por trás de uma linha de luz até a peça ficar inteira ao cruzar o raio. Quando um cenário aparece,
// ele se desdobra a partir do carro do mesmo jeito. Tudo é decidido no próprio desenho, pela distância de cada peça ao carro,
// que fica na origem: a CPU não refaz nada a cada quadro, e o que está longe demais nem chega a ser rasterizado

const STUDIO = ENVS.find((e) => !e.scenery);   // as cores da prancheta são as do estúdio

// Valores compartilhados por todos os materiais da prancheta. Só um cenário aparece por vez, e é ele quem os acerta
const plan = {
  uReach: { value: new THREE.Vector4(24, 24, 44, 60) },   // até onde tudo é inteiro, onde o volume começa a subir, até onde os traços ficam completos e até onde há traços
  uGround: { value: new THREE.Vector2(24, 6) },            // onde o chão de verdade começa a virar piso e a largura dessa passagem
  uWave: { value: new THREE.Vector2(1e5, 14) },            // frente da onda que revela o cenário e quanto ela anda até cada peça ficar pronta
  uInk: { value: new THREE.Color() },                      // cor dos traços, acertada para chegar assim à tela
  uPaper: { value: new THREE.Color() },                    // cor do piso
  uLine: { value: new THREE.Color() },                     // cor da malha no piso
  uStrength: { value: new THREE.Vector2() },               // quanto a malha e o contorno aparecem no piso
  uGlow: { value: 0 },                                     // quanto eles brilham por conta própria (à noite)
  uFrame: { value: new THREE.Matrix4() },                  // leva a cena para o referencial do cenário (a estrada desliza e gira)
  uPlanScroll: { value: 0 },                               // quanto o chão já correu (m)
  uPlanTrail: { value: 0 },                                // rastro do movimento durante a exposição de um quadro (m)
  uLinesA: { value: new THREE.Vector4().setScalar(1e5) },  // até oito linhas do contorno do cenário, ao longo de z (posição x)
  uLinesB: { value: new THREE.Vector4().setScalar(1e5) },
  uDash: { value: new THREE.Vector4(1e5, 0, 16, 0.25) },   // linha tracejada: posição x, fase, período e fração ocupada pelo traço
};

// Progresso de uma peça à distância `d` do carro: zero é nada; até 0,5 os traços vão sendo desenhados; daí até 1 o volume sobe.
// A onda de entrada limita esse progresso enquanto passa. `paperAt` é o quanto o chão ali já virou piso de prancheta
const REACH = `
  uniform vec4 uReach;
  uniform vec2 uGround, uWave;
  float progressAt(float d) {
    float p = d <= uReach.x ? 1.0
      : d <= uReach.y ? 0.5 + 0.5 * (uReach.y - d) / max(uReach.y - uReach.x, 0.001)
      : d <= uReach.z ? 0.5
      : 0.5 * clamp((uReach.w - d) / max(uReach.w - uReach.z, 0.001), 0.0, 1.0);
    return min(p, clamp((uWave.x - d) / uWave.y, 0.0, 1.0));
  }
  float paperAt(float d) {
    return max(smoothstep(uGround.x, uGround.x + uGround.y, d), smoothstep(uWave.x - uGround.y, uWave.x, d));
  }`;

// Malha do estúdio: traço de um pixel de largura, que se apaga quando as linhas ficam juntas demais na tela.
// `gridLines` separa as duas famílias (x são as linhas ao longo de z, y as atravessadas) e recebe o tamanho de um pixel
// no chão (`fw`, o `fwidth` de `at`), calculado antes, fora de qualquer desvio
const GRID = `
  vec2 gridLines(vec2 at, vec2 fw, float cell) {
    vec2 p = at / cell, w = fw / cell;
    vec2 d = abs(fract(p - 0.5) - 0.5) / w;
    return (1.0 - min(d, 1.0)) * (1.0 - smoothstep(0.12, 0.45, max(w.x, w.y)));
  }
  float gridLine(vec2 at, float cell) {
    vec2 l = gridLines(at, fwidth(at), cell);
    return max(l.x, l.y);
  }`;

// Piso de prancheta no ponto `at` do referencial do cenário, a `away` metros do carro; `fw` é o tamanho de um pixel ali.
// Devolve o quanto há de malha (x) e de contorno do cenário (y): as bordas da pista e a linha tracejada, ou as do calçadão.
// Na estrada tudo corre com o chão: cada linha atravessada se espalha pelo rastro do movimento e quase some, e a tracejada
// vira a média do que passa
const PAPER = `
  ${GRID}
  uniform vec3 uPaper, uLine, uInk;
  uniform vec2 uStrength;
  uniform float uGlow, uPlanScroll, uPlanTrail;
  uniform mat4 uFrame;
  uniform vec4 uLinesA, uLinesB, uDash;
  float stripe(float x, float at, float w) { return 1.0 - min(abs(x - at) / w, 1.0); }
  float dashSum(float u) { return floor(u) * uDash.w + min(fract(u), uDash.w); }
  vec2 paperInk(vec2 at, vec2 fw, float away) {
    vec2 run = vec2(at.x, at.y - uPlanScroll);
    float along = max(fw.y, 1e-4), blur = along / (along + uPlanTrail);
    vec2 fine = gridLines(run, fw, 0.1), bold = gridLines(run, fw, 1.0);
    fine.y *= blur;
    bold.y *= blur;
    float grid = max(max(fine.x, fine.y) * 0.45, max(bold.x, bold.y)) * (1.0 - smoothstep(70.0, 220.0, away));
    float w = max(fw.x, 1e-4) * 1.2;
    float edge = max(
      max(max(stripe(at.x, uLinesA.x, w), stripe(at.x, uLinesA.y, w)), max(stripe(at.x, uLinesA.z, w), stripe(at.x, uLinesA.w, w))),
      max(max(stripe(at.x, uLinesB.x, w), stripe(at.x, uLinesB.y, w)), max(stripe(at.x, uLinesB.z, w), stripe(at.x, uLinesB.w, w))));
    float u = (uDash.y - at.y + uPlanScroll) / uDash.z, h = max(uPlanTrail, along) / uDash.z * 0.5;
    edge = max(edge, stripe(at.x, uDash.x, w) * (dashSum(u + h) - dashSum(u - h)) / (2.0 * h));
    return vec2(grid, edge * (1.0 - smoothstep(140.0, 320.0, away)));
  }
  float paperAmount(vec2 ink) { return clamp(ink.x * uStrength.x + ink.y * uStrength.y, 0.0, 1.0); }
  vec3 paperTone(vec2 ink) { return mix(uPaper, uLine, paperAmount(ink)); }
  vec3 paperGlow(vec2 ink) { return uInk * paperAmount(ink) * uGlow; }`;

// Acrescenta uma edição ao shader de um material, depois das que ele já tem, com uma chave própria para o programa
function extend(material, key, edit) {
  const before = material.onBeforeCompile;
  const prior = Object.hasOwn(material, 'customProgramCacheKey') ? material.customProgramCacheKey() : before.toString();
  material.onBeforeCompile = (shader, renderer) => {
    before.call(material, shader, renderer);
    edit(shader);
  };
  material.customProgramCacheKey = () => `${prior}|${key}`;
  return material;
}
// Posição de cada ponto na cena, para os materiais que dependem de onde ele está
const where = (shader) => {
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vPlanAt;')
    .replace('#include <project_vertex>', `#include <project_vertex>
      #ifdef USE_INSTANCING
        vPlanAt = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
      #else
        vPlanAt = (modelMatrix * vec4(transformed, 1.0)).xyz;
      #endif`);
};

// Piso de prancheta, do raio `inner` até o horizonte: o material do piso do estúdio, sob a luz do cenário
function paperFloor(inner) {
  const material = extend(new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.1 }), 'paperFloor', (shader) => {
    Object.assign(shader.uniforms, plan);
    where(shader);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vPlanAt;\n${PAPER}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec2 planeAt = (uFrame * vec4(vPlanAt, 1.0)).xz;
        vec2 paperHere = paperInk(planeAt, fwidth(planeAt), length(vPlanAt.xz));
        diffuseColor.rgb = paperTone(paperHere);`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += paperGlow(paperHere);');
  });
  const floor = new THREE.Mesh(new THREE.RingGeometry(inner, 420, 160, 1), material);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.03;   // logo abaixo do chão de verdade, que se sobrepõe a ele na borda
  floor.receiveShadow = true;
  floor.renderOrder = 3;      // entre os opacos, por último: quase todo ele fica atrás do carro e do chão de perto
  return floor;
}

// Chão de verdade que, perto do raio, vira piso de prancheta: a cor, o brilho e o relevo passam aos do piso. Uma marca
// pintada sobre o chão (`decal`) apenas some. Onde o chão ainda é só chão, o desenho do piso nem é calculado
function groundFade(material, decal = false) {
  return extend(material, decal ? 'groundDecal' : 'ground', (shader) => {
    Object.assign(shader.uniforms, plan);
    where(shader);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>\nvarying vec3 vPlanAt;\n${REACH}\n${PAPER}`);
    if (decal) {
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.a *= 1.0 - paperAt(length(vPlanAt.xz));');
      return;
    }
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
        float paper = paperAt(length(vPlanAt.xz));
        vec2 planeAt = (uFrame * vec4(vPlanAt, 1.0)).xz, planeFw = fwidth(planeAt), paperHere = vec2(0.0);
        if (paper > 0.0) {
          paperHere = paperInk(planeAt, planeFw, length(vPlanAt.xz));
          diffuseColor.rgb = mix(diffuseColor.rgb, paperTone(paperHere), paper);
        }`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.6, paper);')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, 0.1, paper);')
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nnormal = normalize(mix(normal, nonPerturbedNormal, paper));')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += paperGlow(paperHere) * paper;');
  });
}

// O que nasce do chão (os tufos de grama) encolhe para dentro dele quando o chão vira piso
function sprout(material) {
  return extend(material, 'sprout', (shader) => {
    Object.assign(shader.uniforms, plan);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${REACH}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          float sprouted = 1.0 - paperAt(length((modelMatrix * instanceMatrix)[3].xz));
        #else
          float sprouted = 1.0 - paperAt(length(modelMatrix[3].xz));
        #endif
        transformed.y *= sprouted;`)
      .replace('#include <project_vertex>', '#include <project_vertex>\nif (sprouted <= 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);');
  });
}

// Volume de uma peça que se materializa: ele sobe de baixo para cima conforme o progresso dela, com uma linha de luz na frente,
// e some de cima para baixo quando ela se afasta. `anchor` diz o que conta como a posição da peça: a origem do objeto ('model'),
// a de cada cópia ('instance') ou cada ponto ('surface'), para as peças compridas como a defensa. `height` é a altura que
// o volume percorre; nas peças compridas, ela começa em `floor`
const REVEAL_VERTEX = `
  #ifdef USE_INSTANCING
    mat4 revealModel = modelMatrix * instanceMatrix;
  #else
    mat4 revealModel = modelMatrix;
  #endif
  vec3 revealAt = (revealModel * vec4(transformed, 1.0)).xyz;
  #if REVEAL_ANCHOR == 0
    vRevealBase = modelMatrix[3].xyz;
    vRevealH = (revealAt.y - vRevealBase.y) / uRevealHeight;
  #elif REVEAL_ANCHOR == 1
    vRevealBase = revealModel[3].xyz;
    vRevealH = (revealAt.y - vRevealBase.y) / uRevealHeight;
  #else
    vRevealBase = revealAt;
    vRevealH = (revealAt.y - uRevealFloor) / uRevealHeight;
  #endif
  #if REVEAL_ANCHOR != 2
    if (progressAt(length(vRevealBase.xz)) <= 0.5) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);   // ainda sem volume: nem é rasterizada
  #endif`;
const REVEAL_FRAGMENT = `
  float revealFill = clamp(progressAt(length(vRevealBase.xz)) * 2.0 - 1.0, 0.0, 1.0);
  float revealTop = revealFill * 1.08 - 0.04;
  if (revealFill < 1.0 && vRevealH > revealTop) discard;
  float revealGlow = revealFill < 1.0 ? 1.0 - smoothstep(0.0, 0.04, revealTop - vRevealH) : 0.0;`;
function materialize(material, { anchor = 'model', height = 1, floor = 0 } = {}) {
  const mode = { model: 0, instance: 1, surface: 2 }[anchor];
  const head = `#define REVEAL_ANCHOR ${mode}\nuniform float uRevealHeight, uRevealFloor;\nvarying vec3 vRevealBase;\nvarying float vRevealH;\n${REACH}`;
  const own = { uRevealHeight: { value: height }, uRevealFloor: { value: floor } };
  material.userData.reveal = { anchor, height, floor };
  return extend(material, `reveal${mode}`, (shader) => {
    Object.assign(shader.uniforms, plan, own);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${head}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${REVEAL_VERTEX}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${head}\nuniform vec3 uInk;`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>\n${REVEAL_FRAGMENT}`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += uInk * revealGlow * 3.0;');
  });
}

// A sombra de uma peça que se materializa acompanha o volume dela: só faz sombra o que já subiu. O three.js passa a cada
// sombra o mapa e o recorte do material da peça (as folhas), então basta um material de sombra por material de peça
const shades = new WeakMap();
function castsAsDrawn(group) {
  group.traverse((o) => {
    const reveal = o.isMesh && o.castShadow && o.material?.userData?.reveal;
    if (!reveal) return;
    if (!shades.has(o.material)) shades.set(o.material, materialize(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }), reveal));
    o.customDepthMaterial = shades.get(o.material);
  });
}

// Traços: um material só para todos os desenhos. Cada ponto traz o pé da peça a que pertence (`aBase`, para saber a distância
// dela ao carro), a ordem em que é desenhado e a altura em que está na peça (`aStroke`, de 0 a 1). O traço aparece aos poucos,
// na ordem, até a peça estar desenhada; quando o volume sobe, some atrás dele
const ink = new THREE.ShaderMaterial({
  uniforms: { ...plan, ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog), uOpacity: { value: 0.85 } },
  vertexShader: `
    attribute vec3 aBase;
    attribute vec2 aStroke;
    varying vec3 vBase;
    varying vec2 vStroke;
    #include <fog_pars_vertex>
    void main() {
      vBase = (modelMatrix * vec4(aBase, 1.0)).xyz;
      vStroke = aStroke;
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * mvPosition;
      #include <fog_vertex>
    }`,
  fragmentShader: `
    ${REACH}
    uniform vec3 uInk;
    uniform float uOpacity;
    varying vec3 vBase;
    varying vec2 vStroke;
    #include <fog_pars_fragment>
    void main() {
      float p = progressAt(length(vBase.xz));
      if (vStroke.x >= p * 2.0) discard;
      float top = clamp(p * 2.0 - 1.0, 0.0, 1.0) * 1.08 - 0.04;
      float shown = smoothstep(top - 0.01, top + 0.03, vStroke.y) * smoothstep(0.0, 0.2, p);   // a tinta firma enquanto o desenho avança
      if (shown <= 0.0) discard;
      gl_FragColor = vec4(uInk, uOpacity * shown);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      #include <fog_fragment>
    }`,
  transparent: true, depthWrite: false, fog: true, toneMapped: !LITE,
});

// Desenho de uma peça, montado traço a traço. `base` é o pé dela e `height`, a altura; a ordem do desenho é, por padrão,
// a altura de cada ponto, para o traço subir como o volume. `lines()` devolve os traços prontos para a cena
class Sketch {
  constructor() {
    this.position = [];
    this.base = [];
    this.stroke = [];
  }
  segment(a, b, base, height, orderA, orderB) {
    const rise = (p) => Math.min(1, Math.max(0, (p.y - base.y) / height));
    this.position.push(a.x, a.y, a.z, b.x, b.y, b.z);
    this.base.push(base.x, base.y, base.z, base.x, base.y, base.z);
    this.stroke.push(orderA ?? rise(a), rise(a), orderB ?? rise(b), rise(b));
  }
  // linha aberta pelos pontos; `order(p)` dá a ordem de cada ponto no desenho
  path(points, base, height, order) {
    for (let i = 1; i < points.length; i++) this.segment(points[i - 1], points[i], base, height, order?.(points[i - 1]), order?.(points[i]));
  }
  loop(points, base, height, order) {
    this.path([...points, points[0]], base, height, order);
  }
  // traços cujo pé é cada um dos próprios pontos: as peças compridas, que se materializam ponto a ponto
  span(a, b, floor, height) {
    this.position.push(a.x, a.y, a.z, b.x, b.y, b.z);
    this.base.push(a.x, a.y, a.z, b.x, b.y, b.z);
    this.stroke.push(0, (a.y - floor) / height, 0, (b.y - floor) / height);
  }
  lines() {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.position, 3));
    geometry.setAttribute('aBase', new THREE.Float32BufferAttribute(this.base, 3));
    geometry.setAttribute('aStroke', new THREE.Float32BufferAttribute(this.stroke, 2));
    const lines = new THREE.LineSegments(geometry, ink);
    lines.userData.unseen = true;   // fino demais para as fotos dos reflexos
    return lines;
  }
}

// Desenho de um objeto pelas suas arestas vivas, as que dobram mais de `angle` graus, no referencial dele. As superfícies
// curvas e lisas não deixam traço; ficam os contornos, como num desenho técnico
function outline(object, height, angle = 35, sketch = new Sketch()) {
  object.updateWorldMatrix(true, true);
  const inverse = object.matrixWorld.clone().invert(), local = new THREE.Matrix4(), base = new THREE.Vector3();
  const a = new THREE.Vector3(), b = new THREE.Vector3();
  object.traverse((o) => {
    if (!o.isMesh) return;
    const edges = new THREE.EdgesGeometry(o.geometry, angle), p = edges.attributes.position;
    local.multiplyMatrices(inverse, o.matrixWorld);
    for (let i = 0; i < p.count; i += 2) sketch.segment(a.fromBufferAttribute(p, i).applyMatrix4(local), b.fromBufferAttribute(p, i + 1).applyMatrix4(local), base, height);
    edges.dispose();
  });
  return sketch;
}

// O mesmo progresso do desenho, para o que é acertado fora dele (o halo e a luz dos postes, por exemplo)
function progressAt(d) {
  const r = plan.uReach.value, w = plan.uWave.value;
  const p = d <= r.x ? 1 : d <= r.y ? 0.5 + 0.5 * (r.y - d) / Math.max(r.y - r.x, 1e-3) : d <= r.z ? 0.5
    : 0.5 * Math.min(1, Math.max(0, (r.w - d) / Math.max(r.w - r.z, 1e-3)));
  return Math.min(p, Math.min(1, Math.max(0, (w.x - d) / w.y)));
}

// Alcance de um cenário: `full`, até onde tudo é inteiro; `rise`, de onde o volume começa a subir; `drawn`, até onde os traços
// ficam completos; `edge`, até onde há traços; `ground` e `band`, onde o chão começa a virar piso e em quantos metros.
// `outline` são as linhas do contorno do cenário no piso (até oito, ao longo de z) e `dash`, a tracejada, se houver
function setReach({ full, rise = full, drawn, edge, ground = full, band = 6, outline = [], dash = null, wave = 14 }) {
  plan.uReach.value.set(full, rise, drawn, edge);
  plan.uGround.value.set(ground, band);
  plan.uWave.value.y = wave;
  const xs = [...outline, ...Array(8).fill(1e5)];
  plan.uLinesA.value.fromArray(xs, 0);
  plan.uLinesB.value.fromArray(xs, 4);
  plan.uDash.value.set(dash?.x ?? 1e5, dash?.phase ?? 0, dash?.period ?? 16, dash?.share ?? 0.25);
  plan.uFrame.value.identity();
  plan.uPlanScroll.value = plan.uPlanTrail.value = 0;
}

// Cores da prancheta na hora do dia: as do estúdio. Chamado depois que a exposição foi acertada, porque o traço tem de chegar
// à tela com a cor da malha. Sob o sol o piso recebe mais luz do que no estúdio; um pouco mais escuro, ele chega à tela com
// o mesmo tom claro. À noite o piso é escuro como o do estúdio, e a malha e o contorno brilham um pouco
function dressPlan(night) {
  const tune = STUDIO[night ? 'night' : 'day'];
  onScreen(plan.uInk.value.setHex(tune.line));
  plan.uPaper.value.setHex(tune.floor).multiplyScalar(night ? 1 : 0.74);
  plan.uLine.value.setHex(tune.line);
  plan.uStrength.value.set(night ? 0.3 : tune.grid, night ? 0.8 : 0.9);
  plan.uGlow.value = night ? 0.5 : 0;
  ink.uniforms.uOpacity.value = night ? 0.75 : 0.85;
}

// Onda de entrada: quando um cenário aparece, ele se desdobra a partir do carro. Começa só com o piso e o céu; o chão de verdade
// se espalha em volta, as peças são desenhadas e ganham volume à medida que a onda passa por elas. Com `shadows`, as sombras
// são refeitas a cada quadro para crescerem junto (só vale a pena se o que se materializa cai no mapa de sombras)
const wave = { active: false, t: 0, duration: 2.4, end: 0, shadows: false };
function unfold(duration = 2.4, shadows = false) {
  Object.assign(wave, { active: true, t: 0, duration, shadows, end: plan.uReach.value.w + plan.uWave.value.y + plan.uGround.value.y });
  plan.uWave.value.x = 0;
  invalidate();
}
// Segura o cenário só como prancheta, até que ele esteja pronto para se desdobrar
function hold() {
  wave.active = false;
  plan.uWave.value.x = 0;
  shadowsDirty();
}
function tickPlan(dt) {
  if (!wave.active) return;
  wave.t += Math.min(dt, 1 / 30);
  const k = Math.min(1, wave.t / wave.duration);
  plan.uWave.value.x = wave.end * k * k * (3 - 2 * k);
  if (k >= 1) {
    wave.active = false;
    plan.uWave.value.x = 1e5;
  }
  if (wave.shadows || !wave.active) shadowsDirty();   // as sombras crescem com as peças
  else invalidate(1);
}
// Executa `fn` com o cenário inteiro, sem a onda (para a foto dos reflexos, que precisa do cenário pronto)
function whole(fn) {
  const was = plan.uWave.value.x;
  plan.uWave.value.x = 1e5;
  try {
    return fn();
  } finally {
    plan.uWave.value.x = was;
  }
}

export { plan, GRID, Sketch, outline, paperFloor, groundFade, sprout, materialize, castsAsDrawn, progressAt, setReach, dressPlan, hold, unfold, tickPlan, whole, wave };
