import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { LITE, SHUTTER, AX_F } from './config.js';
import { renderer, scene, sceneries, unlit, shadowsDirty } from './scene.js';
import { std } from './materials.js';
import { UP } from './geometry.js';
import { SUN, seeded, hash2, fbm, smooth, paint, textureOf, lawnTexture, tuftTexture } from './praca-textures.js';
import { cards, buildTree, treeMaterials, daylight, outdoors } from './praca.js';
import { LOOP, FEATURES, TO_FRONT } from './ride.js';
import { Sketch, paperFloor, groundFade, sprout, materialize, castsAsDrawn, plan, wave } from './blueprint.js';

// ---------- Estrada ----------
// Pista de mão única com duas faixas, em metros. O carro fica na origem, na faixa da direita, e é o cenário que corre para trás.
// Só os primeiros 40 m em volta do carro são desenhados por inteiro: dali a pista segue desenhada no piso de prancheta até
// o horizonte, e o que vem chegando, árvores, defensa e postes, aparece primeiro em traços, ganha volume e fica inteiro ao
// cruzar o raio; depois de passar pelo carro, se desfaz do mesmo jeito (ver blueprint.js)
const LANE = 3.6;                                                       // largura de cada faixa
const EDGE = { left: -(1.5 * LANE + 0.6), right: 0.5 * LANE + 2.5 };    // bordas do asfalto: acostamentos de 0,6 m e de 2,5 m
const DASH = 16;                                                        // um traço de 4 m mais um intervalo de 12 m
const RAIL = EDGE.left - 0.45;                                          // onde fica a defensa metálica
const POSTS = 4;                                                        // distância entre os postes da defensa
const WRAP = LOOP;                                                      // trecho em que árvores e irregularidades se repetem
const TILE = 2.5, TUFTS = 40;                                           // ladrilho do asfalto e do gramado; trecho em que os tufos se repetem
const REACH = {
  full: 40, rise: 64, drawn: 64, edge: 118, band: 8, wave: 16,
  outline: [EDGE.left, EDGE.right, LANE / 2, EDGE.left + 0.6, RAIL],   // bordas do asfalto, faixas pintadas e defensa, desenhadas no piso
};
const GROUND = REACH.full + REACH.band;   // até onde há chão de verdade
const SPAN = 2 * GROUND;                  // comprimento da pista desenhada por inteiro
const RUN = REACH.rise + 4;               // até onde a defensa e os postes chegam a ter volume
const SKETCHED = REACH.edge + 4;          // até onde chegam os traços
// a tracejada do piso continua exatamente a pintada: o traço ocupa de 65,2% a 90,2% de cada período na textura (ver markingsTexture)
REACH.dash = { x: -LANE / 2, phase: SPAN / 2 - (1 - 712 / 2048) * DASH, period: DASH, share: 0.25 };
let road = null;

// A estrada é montada aos poucos (ver pace.js), na primeira vez em que é pedida ou quando sobra tempo. O piso, a luz e a pista
// desenhada já aparecem e correm com o carro; o resto vai chegando, e `ready` se cumpre quando ela está pronta
function ensureRoad(urgent = false) {
  if (!road) {
    road = roadShell();
    outdoors(road, buildRoad(road), urgent);
  } else if (urgent) road.hurry();
  return road;
}

// Asfalto: pedrinhas de vários tons presas no betume, em um ladrilho que se repete
function asphaltTextures() {
  const S = 1024, rand = seeded(7), stones = [];
  for (let i = 0; i < 34000; i++) stones.push([rand() * S, rand() * S, 0.5 + rand() * rand() * 2.2, rand()]);
  const around = (p) => (p < 4 ? [0, S] : p > S - 4 ? [0, -S] : [0]);   // o que encosta na borda reaparece do outro lado
  const scatter = (g, tone) => {
    for (const [x, y, r, t] of stones) {
      g.fillStyle = tone(t);
      for (const dx of around(x)) for (const dy of around(y)) {
        g.beginPath();
        g.arc(x + dx, y + dy, r, 0, 7);
        g.fill();
      }
    }
  };
  const map = textureOf(paint(S, S, (g) => {
    g.fillStyle = 'rgb(62, 63, 66)';
    g.fillRect(0, 0, S, S);
    // manchas largas, umas mais claras e outras mais escuras, para o piso não ficar chapado
    for (let i = 0; i < 70; i++) {
      const x = rand() * S, y = rand() * S, r = 50 + rand() * 150, v = rand() < 0.5 ? 0 : 255;
      for (const dx of [-S, 0, S]) for (const dy of [-S, 0, S]) {
        const grad = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
        grad.addColorStop(0, `rgba(${v},${v},${v},0.03)`);
        grad.addColorStop(1, `rgba(${v},${v},${v},0)`);
        g.fillStyle = grad;
        g.fillRect(x + dx - r, y + dy - r, 2 * r, 2 * r);
      }
    }
    scatter(g, (t) => { const v = t > 0.97 ? 150 : 44 + t * 62; return `rgba(${v},${v},${v + 2},0.85)`; });
  }));
  const bump = textureOf(paint(S, S, (g) => {
    g.fillStyle = '#707070';
    g.fillRect(0, 0, S, S);
    scatter(g, (t) => { const v = 70 + t * 150; return `rgb(${v},${v},${v})`; });
  }), false);
  return { map, bump };
}

// Tudo o que fica sobre o asfalto e se repete a cada 16 m: faixas pintadas, tacha, trilhas dos pneus e a terra das margens.
// A imagem cobre de x0 até x0 + width, em metros; o alto dela aponta para a frente
function markingsTexture(x0, width) {
  const W = 1024, H = 2048, px = W / width, pz = H / DASH, rand = seeded(19);
  const X = (x) => (x - x0) * px;
  return textureOf(paint(W, H, (g) => {
    // terra e brita nas margens, com contorno irregular (o ruído emenda no fim da imagem)
    const image = g.createImageData(W, H), d = image.data;
    const noise = (i, j) => {
      const n = fbm(i * 0.035, j * 0.02 + 5, 4), t = (j - H + 320) / 320;
      return (t > 0 ? n * (1 - t) + fbm(i * 0.035, (j - H) * 0.02 + 5, 4) * t : n) / 0.94;
    };
    for (const [edge, side] of [[EDGE.left, -1], [EDGE.right, 1]]) {
      const a = X(edge - 0.5 * side), b = X(edge + 1.3 * side);
      for (let j = 0; j < H; j++) for (let i = Math.max(0, Math.floor(Math.min(a, b))); i < Math.min(W, Math.ceil(Math.max(a, b))); i++) {
        const out = (i / px + x0 - edge) * side, n = noise(i, j);   // `out`: metros para fora da borda do asfalto
        const cover = smooth(-0.40, 0.02, out + (n - 0.5) * 0.5) * (1 - smooth(0.25, 0.95, out + (n - 0.5) * 0.6));
        const o = (j * W + i) * 4, v = 0.8 + 0.4 * hash2(i, j);
        d[o] = 122 * v; d[o + 1] = 108 * v; d[o + 2] = 88 * v; d[o + 3] = 255 * Math.min(1, cover * 1.15);
      }
    }
    g.putImageData(image, 0, 0);

    const band = (x, half, alpha, tone = '0,0,0') => {   // faixa macia ao longo da pista
      const grad = g.createLinearGradient(X(x - half), 0, X(x + half), 0);
      grad.addColorStop(0, `rgba(${tone},0)`);
      grad.addColorStop(0.5, `rgba(${tone},${alpha})`);
      grad.addColorStop(1, `rgba(${tone},0)`);
      g.fillStyle = grad;
      g.fillRect(X(x - half), 0, 2 * half * px, H);
    };
    // sombra da defensa, do lado oposto ao sol
    band(RAIL - SUN.x / SUN.y * 0.6, 0.2, 0.42, '10,14,8');
    // por onde os pneus passam o asfalto escurece; no meio de cada faixa fica o rastro de óleo
    for (const lane of [0, -LANE]) {
      band(lane - 0.78, 0.38, 0.13);
      band(lane + 0.78, 0.38, 0.13);
      band(lane, 0.22, 0.06);
    }
    // emenda entre as duas faixas e duas trincas seladas com betume, atravessadas na pista
    g.fillStyle = 'rgba(24,24,26,0.4)';
    g.fillRect(X(-LANE / 2 + 0.34), 0, 2, H);
    g.strokeStyle = 'rgba(22,22,24,0.55)';
    g.lineWidth = 2.5;
    g.lineJoin = 'round';
    for (const [from, to, y] of [[-LANE / 2 + 0.4, EDGE.right - 0.1, 1630], [EDGE.left + 0.1, -LANE / 2 + 0.3, 520]]) {
      g.beginPath();
      g.moveTo(X(from), y);
      for (let x = from + 0.25; x < to; x += 0.25) g.lineTo(X(x), y + (rand() - 0.5) * 26);
      g.stroke();
    }

    // pintura: bordo direito branco, bordo esquerdo amarelo e a linha tracejada que separa as faixas
    const lines = [[LANE / 2, '216,216,209', 0, H], [EDGE.left + 0.6, '214,166,40', 0, H], [-LANE / 2, '216,216,209', 200, 200 + 4 * pz]];
    for (const [x, tone, y0, y1] of lines) {
      g.fillStyle = `rgba(${tone},0.9)`;
      g.fillRect(X(x - 0.075), y0, 0.15 * px, y1 - y0);
    }
    // tacha refletiva no meio do intervalo entre dois traços
    g.fillStyle = 'rgb(205,206,200)';
    g.fillRect(X(-LANE / 2 - 0.05), 200 + 10 * pz - 0.045 * pz, 0.10 * px, 0.09 * pz);
    g.fillStyle = 'rgb(246,246,240)';
    g.fillRect(X(-LANE / 2 - 0.035), 200 + 10 * pz - 0.02 * pz, 0.07 * px, 0.04 * pz);
    // tinta gasta: pontinhos e falhas onde o asfalto reaparece
    g.globalCompositeOperation = 'destination-out';
    for (const [x, , y0, y1] of lines) for (let i = 0; i < (y1 - y0) * 0.9; i++) {
      g.globalAlpha = 0.15 + rand() * 0.5;
      g.beginPath();
      g.arc(X(x) + (rand() - 0.5) * 0.17 * px, y0 + rand() * (y1 - y0), 0.4 + rand() * rand() * 1.5, 0, 7);
      g.fill();
    }
    g.globalAlpha = 1;
    g.globalCompositeOperation = 'source-over';
  }));
}

// Tom médio de uma textura, em valores lineares
function meanTone(texture) {
  const c = texture.image, d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
  let sum = 0, count = 0;
  for (let i = 1; i < d.length; i += 4 * 97, count++) sum += Math.pow(d[i] / 255, 2.2);
  return sum / count;
}
// Chão que corre. Com a velocidade a textura ganha o rastro do movimento: cada ponto é a média dela mesma ao longo do trecho
// que passa durante a exposição do quadro (`trail`, em metros; `span` é o comprimento de uma repetição da textura). Parado,
// o rastro é nulo e a textura é a mesma, sem troca nem salto. Com `vary`, a mesma textura, ampliada 13 vezes, clareia e
// escurece trechos largos, para o ladrilho não se repetir à vista; `tiles` conta os ladrilhos inteiros já percorridos,
// para essa variação correr junto com o chão em vez de pular a cada ladrilho
const TAPS = 12, WIDE = 13;
function streaked(material, motion, span = TILE, vary = true) {
  const mean = { value: vary ? meanTone(material.map) : 1 };
  // O filtro anisotrópico estica cada amostra no sentido do movimento, então elas cobrem o rastro sem deixar falhas. Bastam
  // amostras para o rastro caber nelas, até 12: ao longe, onde o rastro é menor que um pixel, uma só já dá a mesma cor
  const tap = renderer.capabilities.isWebGL2 ? 'textureGrad(map, vMapUv + vec2(0.0, at * streak), dx, dy)' : 'texture2D(map, vMapUv + vec2(0.0, at * streak))';
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTrail = motion.trail;
    shader.uniforms.uTiles = motion.tiles;
    shader.uniforms.uMean = mean;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uTrail, uTiles, uMean;')
      .replace('#include <map_fragment>', `
        vec2 dx = dFdx(vMapUv), dy = dFdy(vMapUv);
        float streak = uTrail / ${span.toFixed(2)}, foot = max(abs(dx.y), abs(dy.y));
        float taps = clamp(ceil(streak / max(foot, 1e-6)), 1.0, ${TAPS}.0), gap = streak / taps;
        if (gap > foot) { dx = vec2(max(abs(dx.x), abs(dy.x)), 0.0); dy = vec2(0.0, gap); }
        vec4 trail = vec4(0.0);
        for (int i = 0; i < ${TAPS}; i++) {
          if (float(i) >= taps) break;
          float at = (float(i) + 0.5) / taps - 0.5;
          trail += ${tap};
        }
        float wide = ${vary ? `texture2D(map, (vMapUv + vec2(0.0, uTiles)) / ${WIDE}.0 + 0.31).g / uMean` : '1.0'};
        diffuseColor *= trail / taps * mix(1.0, wide, 0.35);`);
  };
  material.customProgramCacheKey = () => `streaked${span}${vary}`;
  return material;
}

// O que a estrada mostra de imediato: o sol e o piso de prancheta, com a pista desenhada nele, que já corre com o carro.
// O resto vem de `buildRoad`. O carro muda de faixa e de rumo, mas continua na origem: é a estrada inteira que se desloca
// e gira em volta dele (`shift`). `side` é o quanto ele está à esquerda da faixa da direita (m) e `heading` o rumo (rad,
// positivo para a esquerda). O sol vai junto, porque faz parte do cenário, e a sombra dele continua centrada no carro
function roadShell() {
  const group = new THREE.Group();
  group.visible = false;
  scene.add(group);
  sceneries.add(group);

  // sol: a sombra só precisa cobrir o carro, porque o resto do cenário passa depressa
  const sun = new THREE.DirectionalLight(0xfff0dc, 6.5), focus = new THREE.Vector3(-0.5, 0, 0);
  sun.position.copy(focus).addScaledVector(SUN, 45);
  sun.target.position.copy(focus);
  sun.castShadow = true;
  sun.shadow.mapSize.setScalar(LITE ? 1024 : 2048);
  Object.assign(sun.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6, near: 15, far: 80 });
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  group.add(sun, sun.target, paperFloor(GROUND - 0.5));
  unlit(group);

  // o piso é desenhado no referencial da estrada, que desliza e gira em volta do carro
  const frame = () => {
    group.updateMatrixWorld();
    plan.uFrame.value.copy(group.matrixWorld).invert();
  };
  let placed = 0;
  function shift(side, heading) {
    if (Math.abs(side + heading * 20 - placed) < 1e-5) return;
    placed = side + heading * 20;
    group.rotation.y = -heading;
    group.position.set(side * Math.cos(heading), 0, side * Math.sin(heading));
    frame();
    focus.set(-0.5 - side, 0, 0);
    sun.position.copy(focus).addScaledVector(SUN, 45);
    sun.target.position.copy(focus);
    shadowsDirty();
  }
  // O cenário anda `distance` metros para trás; `speed` (m/s) define o comprimento do rastro, o que passa durante a exposição
  function update(distance, speed) {
    plan.uPlanScroll.value = distance;
    plan.uPlanTrail.value = speed * SHUTTER;
    self.move?.(distance, speed * SHUTTER);
  }
  // os reflexos são fotografados com a estrada vazia: as árvores passam, e não poderiam ficar paradas neles
  const self = { group, update, shift, passing: [] };
  self.dress = daylight(self, { sun, fog: [60, 260], reach: REACH, hide: self.passing, extra: frame });
  return self;
}

function* buildRoad(road) {
  const group = road.stage, rand = seeded(57), blur = { trail: { value: 0 }, tiles: { value: 0 } };
  const flat = (mesh, x, y) => { mesh.rotation.x = -Math.PI / 2; mesh.position.set(x, y, 0); group.add(mesh); return mesh; };

  // asfalto e, por cima dele, a pintura e as margens de terra, até o raio; dali a pista segue desenhada no piso
  const width = EDGE.right - EDGE.left, middle = (EDGE.left + EDGE.right) / 2;
  const tar = asphaltTextures();
  yield;
  tar.map.repeat.set(width / TILE, SPAN / TILE);
  tar.bump.repeat.copy(tar.map.repeat);
  const asphalt = flat(new THREE.Mesh(new THREE.PlaneGeometry(width, SPAN),
    groundFade(streaked(std({ map: tar.map, bumpMap: tar.bump, bumpScale: 1.3, roughness: 0.88 }), blur))), middle, 0);
  yield;
  const paintMap = markingsTexture(EDGE.left - 1.4, width + 2.8);
  paintMap.repeat.set(1, SPAN / DASH);
  yield;
  const markings = flat(new THREE.Mesh(new THREE.PlaneGeometry(width + 2.8, SPAN),
    groundFade(streaked(std({ map: paintMap, transparent: true, depthWrite: false, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), blur, DASH, false), true)), middle, 0.003);
  markings.renderOrder = 1;
  asphalt.receiveShadow = markings.receiveShadow = true;
  asphalt.renderOrder = 1;   // depois do carro, que esconde parte dele

  // juntas de dilatação e remendos: ficam onde a física da suspensão encontra as irregularidades da pista
  const tarry = (opacity) => groundFade(std({ color: 0x202124, roughness: 0.75, transparent: true, opacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }), true);
  const jointLook = tarry(0.8), patchLook = tarry(0.42), marks = [];
  for (const f of FEATURES) {
    if (f.kind === 'dip') continue;
    const joint = f.kind === 'joint';
    const mark = flat(new THREE.Mesh(joint ? new THREE.PlaneGeometry(width, 0.09) : new THREE.PlaneGeometry(1.15, 3), joint ? jointLook : patchLook),
      joint ? middle : f.side * 0.83, 0.004);
    mark.renderOrder = 1;
    mark.receiveShadow = true;
    marks.push({ mark, at: f.at + (joint ? 0 : 1.5) });   // o remendo começa em `at` e se estende por 3 m
  }
  yield;

  // gramado em volta, até o raio
  const lawnMap = lawnTexture();
  lawnMap.repeat.set(SPAN / TILE, SPAN / TILE);
  const lawn = flat(new THREE.Mesh(new THREE.CircleGeometry(GROUND, 128), groundFade(streaked(std({ map: lawnMap, roughness: 1 }), blur))), 0, -0.02);
  lawn.receiveShadow = true;
  lawn.renderOrder = 2;
  yield;

  // defensa metálica: lâmina de aço em "W" com o centro a 60 cm do chão. A lâmina é igual em todo o comprimento, só os postes
  // correm. Ela tem volume até onde chega o raio; os postes, cada um conforme a distância dele
  const steel = { color: 0x9da2a6, metalness: 0.85, roughness: 0.42, side: THREE.DoubleSide };
  const sheet = materialize(std(steel), { anchor: 'surface', height: 0.31, floor: 0.445 });
  const P = [], I = [], steps = 24, profile = [];
  for (let i = 0; i <= steps; i++) {
    const y = -0.155 + 0.31 * i / steps, x = 0.0405 * (1 - Math.cos(2 * Math.PI * (y + 0.155) / 0.155));
    P.push(RAIL + x, 0.6 + y, -RUN, RAIL + x, 0.6 + y, RUN);
    profile.push([RAIL + x, 0.6 + y]);
    if (i < steps) I.push(2 * i, 2 * i + 2, 2 * i + 1, 2 * i + 1, 2 * i + 2, 2 * i + 3);
  }
  const beam = new THREE.BufferGeometry();
  beam.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  beam.setIndex(I);
  beam.computeVertexNormals();
  group.add(new THREE.Mesh(beam, sheet));
  // poste em perfil "C", com o calço que afasta a lâmina e o parafuso que a prende, no vale do meio. A peça fica em volta
  // da origem, e cada cópia é levada até a linha da defensa: assim cada poste sabe a própria distância ao carro
  const postGeo = mergeGeometries([
    new THREE.BoxGeometry(0.006, 0.78, 0.12).translate(-0.113, 0.39, 0),
    new THREE.BoxGeometry(0.06, 0.78, 0.006).translate(-0.086, 0.39, -0.057),
    new THREE.BoxGeometry(0.06, 0.78, 0.006).translate(-0.086, 0.39, 0.057),
    new THREE.BoxGeometry(0.056, 0.28, 0.1).translate(-0.028, 0.6, 0),
    new THREE.CylinderGeometry(0.014, 0.014, 0.012, 6).rotateZ(Math.PI / 2).translate(0.006, 0.6, 0),
  ]);
  const posts = new THREE.InstancedMesh(postGeo, materialize(std(steel), { anchor: 'instance', height: 0.8 }), 2 * Math.ceil(RUN / POSTS));
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), scale = new THREE.Vector3(), tint = new THREE.Color();
  for (let i = 0; i < posts.count; i++) posts.setMatrixAt(i, m4.makeTranslation(RAIL, 0, (i - posts.count / 2) * POSTS));
  group.add(posts);
  // refletivos âmbar presos à lâmina, um a cada quatro postes
  const studs = new THREE.InstancedMesh(new THREE.BoxGeometry(0.004, 0.055, 0.085).translate(0.01, 0.6, 0.16),
    materialize(std({ color: 0xf0a31c, roughness: 0.3, emissive: 0xf0a31c, emissiveIntensity: 0.12 }), { anchor: 'instance', height: 0.8 }), 2 * Math.ceil(RUN / DASH));
  for (let i = 0; i < studs.count; i++) studs.setMatrixAt(i, m4.makeTranslation(RAIL, 0, (i - studs.count / 2) * DASH));
  group.add(studs);
  // o desenho da defensa: as quatro dobras da lâmina, de ponta a ponta, e as arestas de cada poste, que correm com eles
  const railSketch = new Sketch();
  for (const k of [0, 6, 18, steps]) {
    const [x, y] = profile[k];
    railSketch.span(new THREE.Vector3(x, y, -SKETCHED), new THREE.Vector3(x, y, SKETCHED), 0.445, 0.31);
  }
  group.add(railSketch.lines());
  // (os postes que nunca saem de dentro do raio, por mais que a defensa corra, não precisam de desenho)
  const postSketch = new Sketch(), edges = new THREE.EdgesGeometry(postGeo, 30).attributes.position, a = new THREE.Vector3(), b = new THREE.Vector3();
  for (let z = -Math.ceil(SKETCHED / POSTS) * POSTS; z <= SKETCHED; z += POSTS) {
    if (Math.hypot(RAIL, Math.abs(z) + POSTS) < REACH.full) continue;
    const foot = new THREE.Vector3(RAIL, 0, z);
    for (let i = 0; i < edges.count; i += 2) postSketch.segment(a.fromBufferAttribute(edges, i).add(foot), b.fromBufferAttribute(edges, i + 1).add(foot), foot, 0.8);
  }
  const postLines = postSketch.lines();
  group.add(postLines);
  yield;

  // tufos de grama nas margens, mais ralos longe da pista. O desenho se repete a cada 40 m
  const tuftGeo = cards(0.3, 0.14, true), base = LITE ? 700 : 2400, repeats = 3;
  tuftGeo.attributes.normal.array.fill(0);
  for (let i = 1; i < tuftGeo.attributes.normal.array.length; i += 3) tuftGeo.attributes.normal.array[i] = 1;   // iluminados como o chão
  const grass = new THREE.InstancedMesh(tuftGeo, sprout(std({ map: tuftTexture(), alphaTest: 0.5, roughness: 1 })), base * repeats);
  for (let i = 0; i < base; i++) {
    const out = 0.2 + 13 * Math.pow(rand(), 1.8), x = rand() < 0.5 ? EDGE.left - 0.5 - out : EDGE.right + out, z = rand() * TUFTS;
    const s = 0.7 + rand() * 0.9, v = 0.8 + rand() * 0.35;
    q.setFromAxisAngle(UP, rand() * 6.28);
    scale.set(s, s * (0.8 + rand() * 0.5), s);
    tint.setRGB(v, v, v * 0.9);
    for (let k = 0; k < repeats; k++) {
      grass.setMatrixAt(i * repeats + k, m4.compose(pos.set(x, -0.02, z + (k - repeats / 2) * TUFTS), q, scale));
      grass.setColorAt(i * repeats + k, tint);
    }
  }
  grass.frustumCulled = false;   // a malha inteira corre, e quase sempre há tufos à vista
  grass.receiveShadow = true;
  grass.userData.unseen = true;
  group.add(grass);
  yield;

  // árvores dos dois lados, perto o bastante da pista para ficarem inteiras quando passam; cada uma volta para o começo
  // depois de passar, e só é desenhada enquanto está ao alcance
  // árvores simples e paradas: passam correndo, e de longe não se nota a diferença
  const kit = treeMaterials(false), trees = [], count = LITE ? 16 : 26;
  for (let i = 0; i < count; i++) {
    const seed = 40 + i, out = 7 + 20 * Math.pow(hash2(seed, 5), 1.3);
    const tree = buildTree({ seed, height: 6.5 + hash2(seed, 1) * 3, trunk: 0.2, sides: 6, coarse: true, leaves: LITE ? 200 : 340, leaf: 1.3 },
      kit.bark, kit.foliage, kit.coarseCard);
    tree.rotation.y = hash2(seed, 2) * 6.28;
    const shade = new THREE.Mesh(new THREE.PlaneGeometry(tree.userData.crown * 1.1, tree.userData.crown * 1.1), kit.blob);
    shade.rotation.x = -Math.PI / 2;
    shade.position.set(-SUN.x / SUN.y * tree.userData.height * 0.7, 0, -SUN.z / SUN.y * tree.userData.height * 0.7);
    const holder = new THREE.Group();
    holder.add(tree, shade);
    holder.position.x = i % 2 ? EDGE.right + out : RAIL - out;
    holder.userData = { start: (i + hash2(seed, 3) * 0.8) / count * WRAP, solids: [...tree.userData.solids, shade], lines: tree.userData.lines };
    group.add(holder);
    trees.push(holder);
    road.passing.push(holder);
    yield;
  }

  // A cada quadro o cenário anda; o que está longe demais para ter volume ou traço nem entra no desenho
  road.move = (distance, trail) => {
    blur.trail.value = trail;
    blur.tiles.value = Math.floor(distance / TILE) % WIDE;
    asphalt.material.bumpScale = 1.3 / Math.hypot(1, trail / 0.012);   // o relevo das pedrinhas, de ~12 mm, se dilui no rastro
    tar.map.offset.y = tar.bump.offset.y = lawnMap.offset.y = (distance / TILE) % 1;
    paintMap.offset.y = (distance / DASH) % 1;
    posts.position.z = postLines.position.z = distance % POSTS;
    studs.position.z = distance % DASH;
    grass.position.z = distance % TUFTS;
    for (const holder of trees) {
      const z = (holder.userData.start + distance) % WRAP - WRAP / 2, away = Math.hypot(holder.position.x, z);
      holder.position.z = z;
      holder.visible = away < SKETCHED + 8;
      for (const solid of holder.userData.solids) solid.visible = away < RUN + 8;
      holder.userData.lines.visible = wave.active || away > REACH.full - 8;
    }
    // cada irregularidade passa sob o centro de massa do carro quando a distância percorrida chega à posição dela
    for (const { mark, at } of marks) mark.position.z = AX_F + TO_FRONT + ((distance - at + WRAP / 2) % WRAP + WRAP) % WRAP - WRAP / 2;
  };
  road.move(plan.uPlanScroll.value, plan.uPlanTrail.value);
  castsAsDrawn(group);
}

export { road, ensureRoad, LANE, DASH, POSTS };
