import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { LITE, measures, meters } from './config.js';
import { renderer, scene, sceneries, surroundings, skyEnv } from './scene.js';
import { castBump, std, phys } from './materials.js';
import { carRoot } from './layers.js';
import { dimLamps } from './lamps.js';
import { UP, V, rod, rbox, ball, mergeMeshes } from './geometry.js';
import {
  SUN, HAZE, PAVED, seeded, hash2, fbm, smooth, sharedSky, paverTextures, lawnTexture, tuftTexture,
  clumpTexture, barkTextures, woodTextures, blobTexture,
} from './praca-textures.js';
import { DUSK, NIGHT_HAZE, SUNLIGHT, MOONLIGHT, nightSky, showHeavens } from './night.js';
import { Sketch, outline, paperFloor, groundFade, sprout, materialize, castsAsDrawn, progressAt, setReach, dressPlan, whole } from './blueprint.js';
import { prepare, strip } from './post.js';
import { schedule } from './pace.js';

// ---------- Praça ----------
// Cenário externo gerado por código, em metros: céu, sol com sombras, calçadão de blocos, gramado, bancos, árvores e postes
// de luz, que acendem à noite. Tudo isso só até 24 m do carro: dali para fora o chão vira o piso do estúdio, e o calçadão
// e as árvores que continuam além do raio ficam apenas desenhados (ver blueprint.js)
const REACH = {
  full: 24, drawn: 40, edge: 56, band: 6, wave: 12,
  outline: [PAVED.x0 - 0.12, PAVED.x0, PAVED.x1, PAVED.x1 + 0.12],   // guias e bordas do calçadão, que seguem desenhadas no piso
};
const GROUND = REACH.full + REACH.band;   // até onde há chão de verdade
const TREE_RISE = 10.5;                   // altura que o volume de uma árvore percorre ao se materializar
let praca = null;

// A praça é montada aos poucos (ver pace.js), na primeira vez em que é pedida ou quando sobra tempo. O grupo entra logo na
// cena, com o sol e o piso; as peças vão chegando, ainda sem aparecer, e `ready` se cumpre quando ela está pronta.
// `urgent` diz que alguém está esperando por ela
function ensurePraca(urgent = false) {
  if (!praca) {
    praca = pracaShell();
    outdoors(praca, buildPraca(praca), urgent);
  } else if (urgent) praca.hurry();
  return praca;
}

// Leva a montagem de um cenário até o fim. As peças são montadas nos bastidores (`stage`), fora da cena; depois as texturas
// sobem para a placa de vídeo e os materiais são compilados com as luzes dele, em paralelo. Só então as peças entram na cena
// e ele fica `built`: nenhum quadro para à espera de um programa de desenho
function outdoors(scenery, steps, urgent) {
  scenery.built = false;
  scenery.stage = new THREE.Group();
  const job = schedule((function* () {
    yield* steps;
    for (const texture of texturesOf(scenery.stage)) {
      renderer.initTexture(texture);
      yield;
    }
    yield prepare(scenery.group, [carRoot], scenery.stage);
    scenery.group.add(scenery.stage);
    scenery.built = true;
    yield strip(scenery.group, [carRoot]);   // as luzes apagadas, se houver, já podem sair
  })(), urgent);
  scenery.ready = job.promise;
  scenery.hurry = job.hurry;
}
function texturesOf(group) {
  const found = new Set();
  group.traverse((o) => {
    for (const material of [o.material].flat()) {
      if (material) for (const value of Object.values(material)) if (value?.isTexture) found.add(value);
    }
  });
  return found;
}

// Variação suave de tom ao longo de um plano grande, para a textura repetida não parecer azulejo
function tinted(geometry, freq, amount) {
  const p = geometry.attributes.position, colors = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    colors.fill(1 - amount + 2 * amount * fbm(p.getX(i) * freq + 40, p.getY(i) * freq + 40, 3) / 0.875, i * 3, i * 3 + 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geometry;
}
// Cartões de vegetação: retângulos em pé com a base na origem, visíveis dos dois lados; `crossed` cruza dois deles
function cards(w, h, crossed) {
  const parts = [];
  for (const turn of crossed ? [0, Math.PI / 2] : [0]) {
    const front = new THREE.PlaneGeometry(w, h).translate(0, h / 2, 0).rotateY(turn), back = front.clone();
    const idx = back.index.array, n = back.attributes.normal.array;
    for (let i = 0; i < idx.length; i += 3) [idx[i], idx[i + 2]] = [idx[i + 2], idx[i]];
    for (let i = 0; i < n.length; i++) n[i] = -n[i];
    parts.push(front, back);
  }
  return mergeGeometries(parts);
}

// Banco de praça: laterais de ferro fundido e ripas de madeira. Frente para +z, 1,60 m de comprimento, assento a 44 cm
function buildBench() {
  const bench = new THREE.Group(), wood = woodTextures(), rand = seeded(66);
  const timber = materialize(std({ map: wood.map, bumpMap: wood.bump, bumpScale: 0.6, roughness: 0.7 }), { height: 0.9 });
  const iron = materialize(std({ color: 0x1b241e, metalness: 0.35, roughness: 0.55, bumpMap: castBump, bumpScale: 0.3 }), { height: 0.9 });
  // perfil da lateral (x: profundidade, y: altura): pé dianteiro, pé traseiro, encosto inclinado a 17° e apoio de braço
  const side = new THREE.Shape();
  side.moveTo(0.300, 0);
  side.lineTo(0.300, 0.012);
  side.quadraticCurveTo(0.266, 0.200, 0.262, 0.395);
  side.quadraticCurveTo(0.288, 0.500, 0.300, 0.585);
  side.quadraticCurveTo(0.298, 0.652, 0.255, 0.660);
  side.lineTo(-0.273, 0.660);
  side.lineTo(-0.335, 0.860);
  side.quadraticCurveTo(-0.345, 0.888, -0.372, 0.880);
  side.lineTo(-0.390, 0.860);
  side.lineTo(-0.2476, 0.400);
  side.quadraticCurveTo(-0.300, 0.200, -0.372, 0.012);
  side.lineTo(-0.372, 0);
  side.lineTo(-0.305, 0);
  side.quadraticCurveTo(-0.250, 0.160, -0.205, 0.335);
  side.lineTo(0.195, 0.345);
  side.quadraticCurveTo(0.222, 0.190, 0.240, 0.012);
  side.lineTo(0.240, 0);
  side.closePath();
  const opening = new THREE.Path();   // vão entre o assento e o apoio de braço
  opening.moveTo(-0.196, 0.412);
  opening.lineTo(0.212, 0.428);
  opening.quadraticCurveTo(0.250, 0.500, 0.248, 0.585);
  opening.quadraticCurveTo(0.243, 0.618, 0.215, 0.618);
  opening.lineTo(-0.260, 0.618);
  opening.closePath();
  side.holes.push(opening);
  for (const x of [-0.73, 0.77]) {
    const frame = new THREE.Mesh(new THREE.ExtrudeGeometry(side, {
      depth: 0.04, bevelEnabled: true, bevelSize: 0.004, bevelThickness: 0.004, bevelOffset: -0.004, bevelSegments: 2, curveSegments: 10,
    }), iron);
    frame.rotation.y = -Math.PI / 2;   // o perfil passa a ficar no plano de profundidade × altura
    frame.position.x = x;
    bench.add(frame);
  }
  const slat = (thick, width, y, z, tilt, boltY, boltZ) => {
    const g = new RoundedBoxGeometry(1.6, thick, width, 3, 0.008), uv = g.attributes.uv, du = rand(), dv = rand();
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 1.5 + du, uv.getY(i) * 0.3 + dv);   // cada ripa com um trecho diferente dos veios
    const m = new THREE.Mesh(g, timber);
    m.position.set(0, y, z);
    m.rotation.x = tilt;
    bench.add(m);
    for (const x of [-0.75, 0.75]) bench.add(ball(V(x, y + boltY, z + boltZ), 0.008, iron));   // parafusos
  };
  for (let i = 0; i < 5; i++) {   // assento: 5 ripas de 7 cm, levemente inclinado para trás
    const z = 0.225 - i * 0.088;
    slat(0.03, 0.07, 0.403 + (z + 0.19) / 0.452 * 0.027, z, -0.06, 0.015, 0);
  }
  for (let i = 0; i < 4; i++) {   // encosto: 4 ripas de 7,8 cm apoiadas na frente das laterais
    const s = 0.039 + i * 0.1045;
    slat(0.022, 0.078, 0.4733 + 0.9552 * s, -0.2038 - 0.2961 * s, 1.2706, 0.0033, 0.0105);
  }
  bench.add(rod(V(-0.75, 0.325, 0), V(0.75, 0.325, 0), 0.011, iron));          // travessas
  bench.add(rod(V(-0.75, 0.16, -0.285), V(0.75, 0.16, -0.285), 0.011, iron));
  mergeMeshes(bench);
  bench.add(outline(bench, 0.9).lines());   // o desenho que antecede o volume, quando a praça aparece
  return bench;
}

// Árvore de copa arredondada: tronco e galhos em tubos que afinam, folhas em cartões espalhados pelos ramos finos.
// Ela também traz o próprio desenho: o eixo do tronco e dos galhos e o contorno de parte das folhas, exatamente onde o volume
// vai aparecer. Com `sketchOnly`, ela é só o desenho, para ficar além do raio
function buildTree(o, bark, foliage, card) {
  const rand = seeded(o.seed), P = [], N = [], U = [], I = [], anchors = [], limbs = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), n = new THREE.Vector3();
  const lengths = [o.height * 0.31, o.height * 0.37, o.height * 0.23, o.height * 0.13];
  (function grow(start, dir, r0, level) {
    const len = lengths[level] * (0.85 + rand() * 0.3), steps = [8, 7, 5, 4][level], sides = Math.max(4, o.sides - level * 3);
    const pts = [start.clone()], dirs = [dir.clone()], d = dir.clone(), wobble = level === 0 ? 0.07 : 0.22;
    for (let i = 1; i <= steps; i++) {
      // entorta um pouco a cada passo; os galhos principais buscam a luz, os ramos finos pendem
      d.x += (rand() - 0.5) * wobble;
      d.z += (rand() - 0.5) * wobble;
      d.y += (rand() - 0.5) * wobble + [0.02, 0.13, 0.05, -0.02][level];
      d.normalize();
      pts.push(pts[i - 1].clone().addScaledVector(d, len / steps));
      dirs.push(d.clone());
    }
    // o tronco alarga na base, como raiz; os demais galhos afinam até a ponta
    const radius = (t) => (level === 0 ? r0 * (1 - 0.28 * t) * (1 + 0.5 * Math.exp(-t * 11)) : Math.max(0.006, r0 * (1 - 0.62 * t)));
    const first = P.length / 3, wrap = Math.max(1, Math.round(r0 * 9)), solid = level < 3 || o.twigs;
    n.set(1, 0, 0);
    if (Math.abs(dirs[0].x) > 0.9) n.set(0, 0, 1);
    for (let i = 0; solid && i <= steps; i++) {
      const T = dirs[i], t = i / steps, r = radius(t);
      n.addScaledVector(T, -n.dot(T)).normalize();
      b.crossVectors(T, n);
      for (let j = 0; j <= sides; j++) {
        const ang = j / sides * Math.PI * 2;
        a.copy(n).multiplyScalar(Math.cos(ang)).addScaledVector(b, Math.sin(ang));
        const rr = r * (level === 0 ? 1 + 0.12 * Math.exp(-t * 9) * Math.sin(ang * 5 + o.seed) : 1);
        P.push(pts[i].x + a.x * rr, pts[i].y + a.y * rr, pts[i].z + a.z * rr);
        N.push(a.x, a.y, a.z);
        U.push(j / sides * wrap, t * len / 0.9);
      }
    }
    for (let i = 0; solid && i < steps; i++) for (let j = 0; j < sides; j++) {
      const q = first + i * (sides + 1) + j, s = q + sides + 1;
      I.push(q, q + 1, s, q + 1, s + 1, s);
    }
    if (level >= 2) for (let i = 1; i <= steps; i++) if (pts[i].y > 2.8) anchors.push([pts[i], dirs[i], level === 3 ? 1 : 0.45]);
    if (level < 3) limbs.push(pts);
    if (level === 3) return;
    const kids = level === 0 ? 4 : level === 1 ? 5 : 4, turn0 = rand() * 6.28;
    for (let c = 0; c < kids; c++) {
      const t = level === 0 ? 0.86 + 0.14 * c / (kids - 1) : 0.32 + 0.68 * (c + rand() * 0.7) / kids;
      const i = Math.min(steps, Math.max(1, Math.round(t * steps))), parent = dirs[i];
      const spread = level === 0 ? 0.36 + rand() * 0.28 : 0.48 + rand() * 0.4, turn = turn0 + c * 2.4 + (rand() - 0.5) * 0.7;
      // o galho filho se afasta do pai por um ângulo, cada um virado para um lado
      a.set(0, 1, 0);
      if (Math.abs(parent.y) > 0.9) a.set(1, 0, 0);
      const e1 = new THREE.Vector3().crossVectors(parent, a).normalize(), e2 = new THREE.Vector3().crossVectors(parent, e1);
      const child = parent.clone().multiplyScalar(Math.cos(spread))
        .addScaledVector(e1, Math.cos(turn) * Math.sin(spread)).addScaledVector(e2, Math.sin(turn) * Math.sin(spread));
      grow(pts[i], child, radius(i / steps) * 0.61 * (0.9 + rand() * 0.2), level + 1);
    }
    if (level > 0) grow(pts[steps], dirs[steps].clone(), radius(1) * 0.95, level + 1);   // a ponta continua em um ramo mais fino
  })(new THREE.Vector3(), new THREE.Vector3((rand() - 0.5) * 0.08, 1, (rand() - 0.5) * 0.08).normalize(), o.trunk, 0);

  const wood = new THREE.BufferGeometry();
  wood.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  wood.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  wood.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  wood.setIndex(I);

  // folhas: cartões presos aos ramos finos, virados para fora da copa
  const centre = new THREE.Vector3();
  for (const [p] of anchors) centre.add(p);
  centre.divideScalar(anchors.length);
  let top = 0, low = Infinity, spread = 0;
  for (const [p] of anchors) {
    top = Math.max(top, p.y);
    low = Math.min(low, p.y);
    spread = Math.max(spread, Math.hypot(p.x - centre.x, p.z - centre.z));
  }
  const leafGeo = new THREE.BufferGeometry(), spheres = new Float32Array(o.leaves * 3);
  leafGeo.setIndex(card.index);
  for (const name in card.attributes) leafGeo.setAttribute(name, card.attributes[name]);
  leafGeo.setAttribute('aSphere', new THREE.InstancedBufferAttribute(spheres, 3));
  const leaves = o.sketchOnly ? null : new THREE.InstancedMesh(leafGeo, foliage, o.leaves);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), roll = new THREE.Quaternion(), pos = new THREE.Vector3(), scale = new THREE.Vector3(), tint = new THREE.Color();
  const warm = 0.86 + rand() * 0.3, deep = 0.88 + rand() * 0.2;   // cada árvore tem o seu tom de verde
  // desenho: primeiro o tronco e os galhos, de baixo para cima; depois o contorno das folhas, também de baixo para cima
  const sketch = new Sketch(), foot = new THREE.Vector3(), reach = top + o.leaf, every = Math.max(1, Math.round(o.leaves / 260));
  const corners = [V(-0.475, 0, 0), V(0.475, 0, 0), V(0.475, 1, 0), V(-0.475, 1, 0)], drawn = corners.map(() => new THREE.Vector3());
  for (const pts of limbs) sketch.path(pts, foot, TREE_RISE, (p) => 0.7 * p.y / reach);
  for (let k = 0; k < o.leaves; k++) {
    let pick;
    do { pick = anchors[(rand() * anchors.length) | 0]; } while (rand() > pick[2]);
    pos.set(rand() - 0.5, rand() - 0.5, rand() - 0.5).multiplyScalar(0.55).add(pick[0]);
    a.subVectors(pos, centre).normalize();
    b.set(rand() - 0.5, rand() - 0.5, rand() - 0.5).multiplyScalar(1.6).addScaledVector(pick[1], 0.5).addScaledVector(a, 0.7);
    b.y -= 0.2;
    q.setFromUnitVectors(UP, b.normalize()).multiply(roll.setFromAxisAngle(UP, rand() * 6.28));
    // as folhas de dentro e de baixo da copa recebem menos luz do que as de fora: é isso que dá volume à copa
    const inside = Math.hypot(pos.x - centre.x, (pos.y - centre.y) * 1.2, pos.z - centre.z) / spread;
    const shade = (0.55 + 0.45 * smooth(0.3, 0.95, inside)) * (0.8 + 0.2 * smooth(low, top, pos.y));
    const s = o.leaf * (0.75 + rand() * 0.5), v = (0.78 + rand() * 0.34) * deep * shade;
    m4.compose(pos, q, scale.set(s, s, s));
    tint.setRGB(v * warm * (0.92 + rand() * 0.2), v, v * (0.85 + rand() * 0.2));
    if (k % every === 0) sketch.loop(corners.map((c, i) => drawn[i].copy(c).applyMatrix4(m4)), foot, TREE_RISE, (p) => 0.25 + 0.75 * p.y / reach);
    if (!leaves) continue;
    leaves.setMatrixAt(k, m4);
    leaves.setColorAt(k, tint);
    spheres.set([a.x, a.y * 0.8 + 0.25, a.z], k * 3);   // normal "de esfera": a copa é iluminada como um volume
  }
  const tree = new THREE.Group(), lines = sketch.lines();
  tree.add(lines);
  tree.userData = { centre, top: top + 0.3, low, spread: spread + 0.3, height: top + o.leaf * 0.5, crown: 2 * spread + o.leaf, lines, solids: [] };
  if (leaves) {
    const trunk = new THREE.Mesh(wood, bark);
    trunk.castShadow = trunk.receiveShadow = leaves.castShadow = leaves.receiveShadow = true;
    tree.add(trunk, leaves);
    tree.userData.solids.push(trunk, leaves);
  }
  return tree;
}

// Materiais e cartões de folha das árvores, os mesmos em todos os cenários
let treeKit = null;
function treeMaterials() {
  if (treeKit) return treeKit;
  const barkMaps = barkTextures();
  const bark = materialize(std({ map: barkMaps.map, bumpMap: barkMaps.bump, bumpScale: 2.5, roughness: 0.95 }), { height: TREE_RISE });
  // um pouco de luz atravessa as folhas, por isso elas nunca ficam totalmente escuras
  const foliage = phys({ map: clumpTexture(), alphaTest: 0.5, alphaToCoverage: true, roughness: 0.9, specularIntensity: 0.15, emissive: 0x3f5427, emissiveIntensity: 0.32 });
  foliage.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aSphere;')
      .replace('#include <defaultnormal_vertex>', `#include <defaultnormal_vertex>
        transformedNormal = normalMatrix * normalize(mix(normalize(mat3(instanceMatrix) * objectNormal), normalize(aSphere), 0.8));`);
  };
  foliage.customProgramCacheKey = () => 'foliage';
  materialize(foliage, { height: TREE_RISE });
  // mancha no chão que faz o papel da sombra das árvores que ficam fora do mapa de sombras
  const blob = materialize(new THREE.MeshBasicMaterial({ map: blobTexture(), color: 0x0c1408, transparent: true, opacity: 0.5, depthWrite: false }), { height: 1 });
  return treeKit = { bark, foliage, blob, fineCard: cards(0.95, 1, true), coarseCard: cards(0.95, 1, false) };
}

// Reflexos e luz ambiente de um cenário: uma foto em 360° tirada de onde o carro fica, já com o cenário inteiro, sem o carro,
// sem os traços (finos demais para a foto) e sem o que estiver em `hide`
const PROBE = new THREE.Vector3(0, 0.9, 0);
function snapshot(sky, group, hide) {
  scene.environment = skyEnv(sky);   // enquanto a foto é tirada, o céu sozinho serve de luz ambiente
  const unseen = [];
  group.traverse((o) => { if (o.userData.unseen) unseen.push(o); });
  const shown = [carRoot, ...hide, ...unseen].filter((o) => o.visible);
  for (const o of shown) o.visible = false;
  dimLamps(true);
  renderer.shadowMap.needsUpdate = true;
  const env = whole(() => surroundings(scene, PROBE, 0.3, 300));
  dimLamps(false);
  for (const o of shown) o.visible = true;
  return env;
}
// Hora do dia de um cenário ao ar livre. Devolve a função que o veste de dia ou de noite: troca o céu, a bruma e a luz
// (o sol vira a lua) e acerta a prancheta para ele (`reach`, ver blueprint.js). `fog` é onde a bruma começa e onde encobre
// tudo; `extra` cuida do que só aquele cenário tem. Enquanto ele não está montado, o céu sozinho dá a luz ambiente e os
// reflexos; pronto, a foto dos reflexos é tirada na primeira vez em que cada hora é pedida
function daylight(scenery, { sun, fog, reach, hide = [], extra }) {
  const envs = [];
  return (night) => {
    const sky = night ? nightSky() : sharedSky(), light = night ? MOONLIGHT : SUNLIGHT, kit = treeMaterials();
    sun.color.setHex(light.color);
    sun.intensity = light.intensity;
    kit.foliage.emissiveIntensity = night ? 0.02 : 0.32;
    kit.blob.opacity = night ? 0.3 : 0.5;
    setReach(reach);
    dressPlan(night);
    showHeavens(night);
    scene.background = sky;
    // a bruma tem a cor do céu no horizonte, para o chão sumir nele sem deixar uma linha. No celular ela não passa
    // pelo mapeamento de tons, e vale a cor que se quer ver na tela
    if (LITE) scene.fog.color.copy(night ? DUSK : HAZE); else scene.fog.color.copy(night ? NIGHT_HAZE : HAZE);
    [scene.fog.near, scene.fog.far] = fog;
    // a foto é tirada com o cenário inteiro, inclusive o que acende; depois isso volta a acompanhar a entrada dele
    if (scenery.built) envs[+night] ??= whole(() => { extra?.(night); return snapshot(sky, scenery.group, hide); });
    extra?.(night);
    scene.environment = scenery.built ? envs[+night] : skyEnv(sky);
  };
}

// Poste de luz: coluna de ferro fundido torneada, com base larga, anéis e, no alto, a taça onde se apoia o globo leitoso,
// fechado por uma tampa com ponteira. `GLOBE` é a altura do centro do globo. Os postes ficam na beira do gramado: dois do lado
// do banco e um do lado oposto, perto de quem olha o carro de frente
const GLOBE = 3.485;
const LAMPS = [[PAVED.x0 - 0.42, 5.2], [PAVED.x0 - 0.42, -5.4], [PAVED.x1 + 0.42, -1.6]];
function buildLampPost(iron, opal) {
  const post = new THREE.Group(), turned = (profile) => new THREE.Mesh(new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), 24), iron);
  const column = turned([[0, 0], [0.125, 0], [0.125, 0.05], [0.105, 0.07], [0.105, 0.2], [0.092, 0.23], [0.075, 0.42], [0.058, 0.56], [0.067, 0.585],
    [0.067, 0.615], [0.05, 0.64], [0.044, 1.2], [0.053, 1.22], [0.053, 1.25], [0.042, 1.27], [0.034, 3.02], [0.047, 3.05], [0.047, 3.09],
    [0.036, 3.12], [0.05, 3.2], [0.095, 3.27], [0.112, 3.3], [0.112, 3.315], [0, 3.315]]);
  const cap = turned([[0.078, GLOBE + 0.166], [0.07, GLOBE + 0.182], [0.03, GLOBE + 0.197], [0.013, GLOBE + 0.215], [0.017, GLOBE + 0.232], [0, GLOBE + 0.26]]);
  const globe = new THREE.Mesh(new THREE.SphereGeometry(0.19, 32, 20).translate(0, GLOBE, 0), opal);   // tudo com o pé na origem
  for (const part of [column, cap, globe]) part.castShadow = part.receiveShadow = true;
  post.add(column, cap, globe);
  post.add(outline(post, 3.75).lines());
  return post;
}

// O que a praça mostra de imediato: o sol e o piso de prancheta, que vai até o horizonte. O resto vem de `buildPraca`
function pracaShell() {
  const group = new THREE.Group();
  group.visible = false;
  scene.add(group);
  sceneries.add(group);
  const sun = new THREE.DirectionalLight(0xfff0dc, 6.5), focus = new THREE.Vector3(-0.5, 0, -1);
  sun.position.copy(focus).addScaledVector(SUN, 45);
  sun.target.position.copy(focus);
  sun.castShadow = true;
  sun.shadow.mapSize.setScalar(LITE ? 2048 : 4096);
  Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14, near: 15, far: 80 });
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  group.add(sun, sun.target, paperFloor(GROUND - 0.5));
  // a luz de cada poste já entra aqui, apagada, para a cena ter desde o início as luzes que vai ter (ver `unlit`, em scene.js).
  // No celular o poste mais distante só brilha, sem iluminar
  const bulbs = LAMPS.map(([x, z], i) => {
    if (LITE && !i) return null;
    const bulb = new THREE.PointLight(0xffc98f, 0, 0, 2);
    bulb.position.set(x, GLOBE, z);
    group.add(bulb);
    return bulb;
  });
  const self = { group, bulbs, trees: [], night: false };
  self.dress = daylight(self, { sun, fog: [30, 170], reach: REACH, extra: (night) => { self.night = night; self.light?.(); } });
  self.onWave = () => self.light?.();
  return self;
}

function* buildPraca(praca) {
  const group = praca.stage, rand = seeded(90);

  // chão: gramado em volta e, sobre ele, o calçadão com guias de concreto, os dois até o raio, onde viram piso
  const pavers = paverTextures(), width = PAVED.x1 - PAVED.x0, depth = 2 * GROUND, midX = (PAVED.x0 + PAVED.x1) / 2;
  yield;
  pavers.map.repeat.set(width / 2, depth / 2);
  pavers.bump.repeat.copy(pavers.map.repeat);
  const paving = new THREE.Mesh(tinted(new THREE.PlaneGeometry(width, depth, 20, 60), 0.25, 0.1),
    groundFade(std({ map: pavers.map, bumpMap: pavers.bump, bumpScale: 1.5, roughness: 0.92, vertexColors: true })));
  paving.rotation.x = -Math.PI / 2;
  paving.position.x = midX;
  const grassMap = lawnTexture();
  grassMap.repeat.set(depth / 2.5, depth / 2.5);
  const lawn = new THREE.Mesh(tinted(new THREE.CircleGeometry(GROUND, 128), 0.05, 0.16),
    groundFade(std({ map: grassMap, roughness: 1, vertexColors: true })));
  lawn.rotation.x = -Math.PI / 2;
  lawn.position.y = -0.006;
  paving.receiveShadow = lawn.receiveShadow = true;
  paving.renderOrder = 1;   // depois do carro, que cobre parte do chão, e o calçadão antes do gramado que fica por baixo dele
  lawn.renderOrder = 2;
  group.add(lawn, paving);
  // as guias terminam no raio; dali em diante seguem só desenhadas no piso
  const concrete = materialize(std({ color: 0xa7a39a, roughness: 0.9, bumpMap: castBump, bumpScale: 0.4 }), { anchor: 'surface', height: 0.12, floor: -0.02 });
  for (const x of [PAVED.x0 - 0.06, PAVED.x1 + 0.06]) {
    const curb = rbox(0.12, 0.12, 2 * REACH.full, x, 0.04, 0, concrete, 0.012);
    curb.castShadow = curb.receiveShadow = true;
    group.add(curb);
  }
  yield;

  // tufos de grama em volta do carro, mais ralos à medida que se afastam
  const tufts = cards(0.3, 0.14, true), tuftCount = LITE ? 4500 : 13000;
  tufts.attributes.normal.array.fill(0);
  for (let i = 1; i < tufts.attributes.normal.array.length; i += 3) tufts.attributes.normal.array[i] = 1;   // iluminados como o chão
  const grass = new THREE.InstancedMesh(tufts, sprout(std({ map: tuftTexture(), alphaTest: 0.5, roughness: 1 })), tuftCount);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), scale = new THREE.Vector3(), tint = new THREE.Color();
  let placed = 0;
  for (let tries = 0; placed < tuftCount && tries < tuftCount * 30; tries++) {
    const ang = rand() * 6.28, dist = Math.sqrt(rand()) * 17, x = Math.cos(ang) * dist, z = Math.sin(ang) * dist;
    if ((x > PAVED.x0 - 0.2 && x < PAVED.x1 + 0.2) || rand() < smooth(9, 17, dist)) continue;
    const s = 0.7 + rand() * 0.9, v = 0.8 + rand() * 0.35;
    grass.setMatrixAt(placed, m4.compose(pos.set(x, -0.006, z), q.setFromAxisAngle(UP, rand() * 6.28), scale.set(s, s * (0.8 + rand() * 0.5), s)));
    grass.setColorAt(placed++, tint.setRGB(v, v, v * 0.9));
  }
  grass.count = placed;
  grass.receiveShadow = true;
  grass.userData.unseen = true;   // miúdos demais para a foto dos reflexos
  group.add(grass);
  yield;

  // bancos: um ao lado do carro, à beira do gramado, e outro do lado oposto do calçadão
  const bench = buildBench(), other = bench.clone();
  bench.position.set(-3.2, 0, -0.5);
  bench.rotation.y = Math.PI / 2;
  other.position.set(5.65, 0, 4.4);
  other.rotation.y = -Math.PI / 2;
  group.add(bench, other);
  yield;

  // árvores: três de perto, com sombra de verdade, outras ao longo do calçadão e pelo parque. As que ficam além do raio
  // são só o desenho delas
  const { bark, foliage, blob, fineCard, coarseCard } = treeMaterials();
  const plant = (x, z, close, seed) => {
    const sketchOnly = Math.hypot(x, z) > REACH.full;
    const tree = buildTree(close
      ? { seed, height: 8.2, trunk: 0.2, sides: 12, twigs: true, leaves: LITE ? 1500 : 3200, leaf: LITE ? 0.68 : 0.56 }
      : { seed, height: 7 + hash2(seed, 1) * 2.5, trunk: 0.19, sides: 8, leaves: LITE ? 300 : 520, leaf: 1.1, sketchOnly }, bark, foliage, close ? fineCard : coarseCard);
    tree.position.set(x, 0, z);
    tree.rotation.y = hash2(seed, 2) * 6.28;
    group.add(tree);
    if (sketchOnly) return tree;
    praca.trees.push(tree);
    if (close) return tree;
    // longe demais para o mapa de sombras: uma mancha no chão faz o papel da sombra
    const shade = new THREE.Mesh(new THREE.PlaneGeometry(tree.userData.crown * 1.1, tree.userData.crown * 1.1), blob);
    shade.rotation.x = -Math.PI / 2;
    shade.position.set(x - SUN.x / SUN.y * tree.userData.height * 0.7, 0.012, z - SUN.z / SUN.y * tree.userData.height * 0.7);
    group.add(shade);
    return tree;
  };
  const hero = plant(-6.9, 1.1, true, 3);
  yield;
  plant(7.9, 2.6, true, 8);
  yield;
  plant(10.5, -7, true, 14);
  yield;
  const spots = [[-6.3, -9.5], [-6.3, 11.5], [-6.3, 22], [-6.3, -20.5], [-6.3, 33], [-6.3, -32], [8.4, 12.5], [8.4, 22], [8.4, -20.5], [8.4, 32], [8.4, -31.5],
    [-15, -4.5], [-18, 9], [-13, 19], [-24, -14], [-27, 4], [17, 3.5], [20, -12], [16.5, 16], [27, -3], [25, 22], [-21, 28], [22, -27]];
  for (const [i, [x, z]] of spots.entries()) {
    plant(x, z, false, 20 + i);
    yield;
  }
  group.updateMatrixWorld(true);
  for (const tree of praca.trees) tree.userData.world = tree.localToWorld(tree.userData.centre.clone());

  // postes de luz: de dia ficam apagados; à noite cada globo acende, ganha um halo e ilumina o calçadão em volta.
  // Quando a praça aparece, cada um só acende depois de desenhado
  const opal = materialize(std({ color: 0xe9e6dc, roughness: 0.35, emissive: 0xffd9a8, emissiveIntensity: 0 }), { height: 3.75 });
  const iron = materialize(std({ color: 0x1b241e, metalness: 0.35, roughness: 0.55, bumpMap: castBump, bumpScale: 0.3 }), { height: 3.75 });
  const shine = new THREE.SpriteMaterial({ map: blobTexture(), color: 0xffc98f, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  const lamps = LAMPS.map(([x, z], i) => {
    const lamp = buildLampPost(iron, opal), halo = new THREE.Sprite(shine.clone());
    lamp.position.set(x, 0, z);
    halo.position.y = GLOBE;
    halo.scale.setScalar(1.5);
    lamp.add(halo);
    group.add(lamp);
    return { halo, bulb: praca.bulbs[i], away: Math.hypot(x, z) };
  });
  praca.light = () => {
    opal.emissiveIntensity = praca.night ? 5 : 0;
    for (const { halo, bulb, away } of lamps) {
      const lit = praca.night ? Math.min(1, Math.max(0, progressAt(away) * 2 - 1)) : 0;
      halo.material.visible = lit > 0;
      halo.material.opacity = 0.4 * lit;
      if (bulb) bulb.intensity = 36 * lit;
    }
  };
  praca.light();
  castsAsDrawn(group);

  measures.bench = '1,60 × 0,69 × 0,89 m';
  measures.tree = `${meters(hero.userData.height)} m de altura · copa de ${meters(hero.userData.crown)} m`;
  measures.lamp = '3,75 m de altura · globo de Ø 38 cm';
}

export { praca, ensurePraca, outdoors, cards, buildTree, treeMaterials, daylight, TREE_RISE };
