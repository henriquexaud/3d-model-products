import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { LITE, measures, meters } from './config.js';
import { renderer, scene, pmrem } from './scene.js';
import { castBump, std, phys } from './materials.js';
import { carRoot } from './layers.js';
import { dimLamps } from './lamps.js';
import { UP, V, rod, cyl, rbox, ball, mergeMeshes } from './geometry.js';
import {
  SUN, HAZE, PAVED, seeded, hash2, fbm, smooth, sharedSky, paverTextures, lawnTexture, tuftTexture,
  clumpTexture, barkTextures, woodTextures, blobTexture, treelineTexture,
} from './praca-textures.js';
import { DUSK, SUNLIGHT, MOONLIGHT, nightSky, showHeavens } from './night.js';

// ---------- Praça ----------
// Cenário externo gerado por código, em metros: céu, sol com sombras, calçadão de blocos, gramado, bancos, árvores
// e postes de luz, que acendem à noite
let praca = null;

// A praça só é montada na primeira vez em que é pedida
function ensurePraca() {
  return praca ??= buildPraca();
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
  const timber = std({ map: wood.map, bumpMap: wood.bump, bumpScale: 0.6, roughness: 0.7 });
  const iron = std({ color: 0x1b241e, metalness: 0.35, roughness: 0.55, bumpMap: castBump, bumpScale: 0.3 });
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
  return bench;
}

// Árvore de copa arredondada: tronco e galhos em tubos que afinam, folhas em cartões espalhados pelos ramos finos
function buildTree(o, bark, foliage, card) {
  const rand = seeded(o.seed), P = [], N = [], U = [], I = [], anchors = [];
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
  const leaves = new THREE.InstancedMesh(leafGeo, foliage, o.leaves);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), roll = new THREE.Quaternion(), pos = new THREE.Vector3(), scale = new THREE.Vector3(), tint = new THREE.Color();
  const warm = 0.86 + rand() * 0.3, deep = 0.88 + rand() * 0.2;   // cada árvore tem o seu tom de verde
  for (let k = 0; k < o.leaves; k++) {
    let pick;
    do { pick = anchors[(rand() * anchors.length) | 0]; } while (rand() > pick[2]);
    pos.set(rand() - 0.5, rand() - 0.5, rand() - 0.5).multiplyScalar(0.55).add(pick[0]);
    a.subVectors(pos, centre).normalize();
    b.set(rand() - 0.5, rand() - 0.5, rand() - 0.5).multiplyScalar(1.6).addScaledVector(pick[1], 0.5).addScaledVector(a, 0.7);
    b.y -= 0.2;
    q.setFromUnitVectors(UP, b.normalize()).multiply(roll.setFromAxisAngle(UP, rand() * 6.28));
    const s = o.leaf * (0.75 + rand() * 0.5), v = (0.78 + rand() * 0.34) * deep;
    leaves.setMatrixAt(k, m4.compose(pos, q, scale.set(s, s, s)));
    leaves.setColorAt(k, tint.setRGB(v * warm * (0.92 + rand() * 0.2), v, v * (0.85 + rand() * 0.2)));
    spheres.set([a.x, a.y * 0.8 + 0.25, a.z], k * 3);   // normal "de esfera": a copa é iluminada como um volume
  }
  const tree = new THREE.Group(), trunk = new THREE.Mesh(wood, bark);
  trunk.castShadow = trunk.receiveShadow = leaves.castShadow = leaves.receiveShadow = true;
  tree.add(trunk, leaves);
  tree.userData = { centre, top: top + 0.3, low, spread: spread + 0.3, height: top + o.leaf * 0.5, crown: 2 * spread + o.leaf };
  return tree;
}

// Materiais e cartões de folha das árvores, os mesmos em todos os cenários
let treeKit = null;
function treeMaterials() {
  if (treeKit) return treeKit;
  const barkMaps = barkTextures();
  const bark = std({ map: barkMaps.map, bumpMap: barkMaps.bump, bumpScale: 2.5, roughness: 0.95 });
  // um pouco de luz atravessa as folhas, por isso elas nunca ficam totalmente escuras
  const foliage = phys({ map: clumpTexture(), alphaTest: 0.5, alphaToCoverage: true, roughness: 0.9, specularIntensity: 0.15, emissive: 0x3f5427, emissiveIntensity: 0.5 });
  foliage.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 aSphere;')
      .replace('#include <defaultnormal_vertex>', `#include <defaultnormal_vertex>
        transformedNormal = normalMatrix * normalize(mix(normalize(mat3(instanceMatrix) * objectNormal), normalize(aSphere), 0.8));`);
  };
  // mancha no chão que faz o papel da sombra das árvores que ficam fora do mapa de sombras
  const blob = new THREE.MeshBasicMaterial({ map: blobTexture(), color: 0x0c1408, transparent: true, opacity: 0.5, depthWrite: false });
  return treeKit = { bark, foliage, blob, fineCard: cards(0.95, 1, true), coarseCard: cards(0.95, 1, false) };
}

// Reflexos e luz ambiente de um cenário: uma foto em 360° tirada de onde o carro fica, sem ele e sem o que estiver em `hide`
function snapshot(sky, hide) {
  const rough = pmrem.fromEquirectangular(sky);   // enquanto a foto é tirada, o céu sozinho serve de luz ambiente
  scene.environment = rough.texture;
  const target = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType });
  const probe = new THREE.CubeCamera(0.3, 300, target);
  probe.position.set(0, 0.9, 0);
  const shown = [carRoot, ...hide].filter((o) => o.visible);
  for (const o of shown) o.visible = false;
  dimLamps(true);
  renderer.shadowMap.needsUpdate = true;
  probe.update(renderer, scene);
  dimLamps(false);
  for (const o of shown) o.visible = true;
  const env = pmrem.fromCubemap(target.texture).texture;
  target.dispose();
  rough.dispose();
  return env;
}
// Hora do dia de um cenário ao ar livre. Devolve a função que o veste de dia ou de noite: troca o céu, a bruma e a luz
// (o sol vira a lua) e escurece o que não depende dela. `fog` é onde a bruma começa e onde encobre tudo; `extra` cuida
// do que só aquele cenário tem. A foto dos reflexos é tirada na primeira vez em que cada hora é pedida
function daylight(sun, treeline, fog, hide = [], extra) {
  const envs = [];
  return (night) => {
    const sky = night ? nightSky() : sharedSky(), light = night ? MOONLIGHT : SUNLIGHT, kit = treeMaterials();
    sun.color.setHex(light.color);
    sun.intensity = light.intensity;
    treeline.material.color.setHex(night ? 0x0d121b : 0xffffff);
    kit.foliage.emissiveIntensity = night ? 0.02 : 0.5;
    kit.blob.opacity = night ? 0.3 : 0.5;
    extra?.(night);
    showHeavens(night);
    scene.background = sky;
    scene.fog.color.copy(night ? DUSK : HAZE);
    [scene.fog.near, scene.fog.far] = fog;
    scene.environment = envs[+night] ??= snapshot(sky, hide);
  };
}

// Poste de luz: coluna de ferro fundido de 3,3 m com um globo leitoso no alto
function buildLampPost(iron, opal) {
  const post = new THREE.Group();
  post.add(cyl(0.085, 0.42, 'y', 0, 0.21, 0, iron, 20, 0.06));
  post.add(cyl(0.07, 0.035, 'y', 0, 0.44, 0, iron, 20));
  post.add(rod(V(0, 0.44, 0), V(0, 3.24, 0), 0.042, iron, 0.03, 16));
  post.add(cyl(0.05, 0.07, 'y', 0, 3.275, 0, iron, 20, 0.105));   // taça onde o globo se apoia
  mergeMeshes(post);
  const globe = new THREE.Mesh(new THREE.SphereGeometry(0.19, 32, 20), opal);
  globe.position.y = 3.47;
  globe.castShadow = true;
  post.add(globe);
  return post;
}

function buildPraca() {
  const group = new THREE.Group(), rand = seeded(90);
  scene.add(group);

  // sol
  const sun = new THREE.DirectionalLight(0xfff0dc, 6.5), focus = new THREE.Vector3(-0.5, 0, -1);
  sun.position.copy(focus).addScaledVector(SUN, 45);
  sun.target.position.copy(focus);
  sun.castShadow = true;
  sun.shadow.mapSize.setScalar(LITE ? 2048 : 4096);
  Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14, near: 15, far: 80 });
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  group.add(sun, sun.target);

  // chão: gramado por toda parte e, sobre ele, o calçadão com guias de concreto
  const pavers = paverTextures(), width = PAVED.x1 - PAVED.x0, depth = PAVED.z1 - PAVED.z0, midX = (PAVED.x0 + PAVED.x1) / 2;
  pavers.map.repeat.set(width / 2, depth / 2);
  pavers.bump.repeat.copy(pavers.map.repeat);
  const paving = new THREE.Mesh(tinted(new THREE.PlaneGeometry(width, depth, 20, 150), 0.25, 0.1),
    std({ map: pavers.map, bumpMap: pavers.bump, bumpScale: 1.5, roughness: 0.92, vertexColors: true }));
  paving.rotation.x = -Math.PI / 2;
  paving.position.x = midX;
  const grassMap = lawnTexture();
  grassMap.repeat.set(120, 120);
  const lawn = new THREE.Mesh(tinted(new THREE.PlaneGeometry(300, 300, 64, 64), 0.05, 0.16),
    std({ map: grassMap, roughness: 1, vertexColors: true }));
  lawn.rotation.x = -Math.PI / 2;
  lawn.position.y = -0.006;
  paving.receiveShadow = lawn.receiveShadow = true;
  group.add(lawn, paving);
  const concrete = std({ color: 0xa7a39a, roughness: 0.9, bumpMap: castBump, bumpScale: 0.4 });
  for (const x of [PAVED.x0 - 0.06, PAVED.x1 + 0.06]) {
    const curb = rbox(0.12, 0.12, depth, x, 0.04, 0, concrete, 0.012);
    curb.castShadow = curb.receiveShadow = true;
    group.add(curb);
  }

  const woods = treelineTexture();
  woods.repeat.set(6, 1);
  const treeline = new THREE.Mesh(new THREE.CylinderGeometry(88, 88, 15, 64, 1, true),
    new THREE.MeshBasicMaterial({ map: woods, alphaTest: 0.5, side: THREE.BackSide }));
  treeline.position.y = 7.4;
  group.add(treeline);

  // tufos de grama em volta do carro, mais ralos à medida que se afastam
  const tufts = cards(0.3, 0.14, true), tuftCount = LITE ? 4500 : 13000;
  tufts.attributes.normal.array.fill(0);
  for (let i = 1; i < tufts.attributes.normal.array.length; i += 3) tufts.attributes.normal.array[i] = 1;   // iluminados como o chão
  const grass = new THREE.InstancedMesh(tufts, std({ map: tuftTexture(), alphaTest: 0.5, roughness: 1 }), tuftCount);
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
  group.add(grass);

  // bancos: um ao lado do carro, à beira do gramado, e outro do lado oposto do calçadão
  const bench = buildBench(), other = bench.clone();
  bench.position.set(-3.2, 0, -0.5);
  bench.rotation.y = Math.PI / 2;
  other.position.set(5.65, 0, 4.4);
  other.rotation.y = -Math.PI / 2;
  group.add(bench, other);

  // árvores: três de perto, com sombra de verdade, e outras ao longo do calçadão e pelo parque
  const { bark, foliage, blob, fineCard, coarseCard } = treeMaterials();
  const trees = [];
  const plant = (x, z, close, seed) => {
    const tree = buildTree(close
      ? { seed, height: 8.2, trunk: 0.2, sides: 12, twigs: true, leaves: LITE ? 1500 : 3200, leaf: LITE ? 0.68 : 0.56 }
      : { seed, height: 7 + hash2(seed, 1) * 2.5, trunk: 0.19, sides: 8, leaves: LITE ? 300 : 520, leaf: 1.1 }, bark, foliage, close ? fineCard : coarseCard);
    tree.position.set(x, 0, z);
    tree.rotation.y = hash2(seed, 2) * 6.28;
    group.add(tree);
    trees.push(tree);
    if (close) return tree;
    // longe demais para o mapa de sombras: uma mancha no chão faz o papel da sombra
    const shade = new THREE.Mesh(new THREE.PlaneGeometry(tree.userData.crown * 1.1, tree.userData.crown * 1.1), blob);
    shade.rotation.x = -Math.PI / 2;
    shade.position.set(x - SUN.x / SUN.y * tree.userData.height * 0.7, 0.012, z - SUN.z / SUN.y * tree.userData.height * 0.7);
    group.add(shade);
    return tree;
  };
  const hero = plant(-6.9, 1.1, true, 3);
  plant(7.9, 2.6, true, 8);
  plant(10.5, -7, true, 14);
  [[-6.3, -9.5], [-6.3, 11.5], [-6.3, 22], [-6.3, -20.5], [-6.3, 33], [-6.3, -32], [8.4, 12.5], [8.4, 22], [8.4, -20.5], [8.4, 32], [8.4, -31.5],
   [-15, -4.5], [-18, 9], [-13, 19], [-24, -14], [-27, 4], [17, 3.5], [20, -12], [16.5, 16], [27, -3], [25, 22], [-21, 28], [22, -27]]
    .forEach(([x, z], i) => plant(x, z, false, 20 + i));
  group.updateMatrixWorld(true);
  for (const tree of trees) tree.userData.world = tree.localToWorld(tree.userData.centre.clone());

  // postes de luz na beira do gramado: dois do lado do banco e um do lado oposto, perto de quem olha o carro de frente.
  // De dia ficam apagados; à noite cada globo acende, ganha um halo e ilumina o calçadão em volta
  const opal = std({ color: 0xe9e6dc, roughness: 0.35, emissive: 0xffd9a8, emissiveIntensity: 0 });
  const iron = std({ color: 0x1b241e, metalness: 0.35, roughness: 0.55, bumpMap: castBump, bumpScale: 0.3 });
  const shine = new THREE.SpriteMaterial({ map: blobTexture(), color: 0xffc98f, opacity: 0.4, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  const bulbs = [];
  [[PAVED.x0 - 0.42, 5.2], [PAVED.x0 - 0.42, -5.4], [PAVED.x1 + 0.42, -1.6]].forEach(([x, z], i) => {
    const lamp = buildLampPost(iron, opal), halo = new THREE.Sprite(shine);
    lamp.position.set(x, 0, z);
    halo.position.y = 3.47;
    halo.scale.setScalar(1.5);
    lamp.add(halo);
    if (!LITE || i) {   // no celular o poste mais distante só brilha, sem iluminar
      const bulb = new THREE.PointLight(0xffc98f, 0, 0, 2);
      bulb.position.y = 3.47;
      lamp.add(bulb);
      bulbs.push(bulb);
    }
    group.add(lamp);
  });
  const dress = daylight(sun, treeline, [30, 135], [], (night) => {
    opal.emissiveIntensity = night ? 5 : 0;
    shine.visible = night;
    for (const bulb of bulbs) bulb.intensity = night ? 36 : 0;
  });

  measures.bench = '1,60 × 0,69 × 0,89 m';
  measures.tree = `${meters(hero.userData.height)} m de altura · copa de ${meters(hero.userData.crown)} m`;
  measures.lamp = '3,66 m de altura · globo de Ø 38 cm';
  return { group, trees, dress };
}

export { praca, ensurePraca, cards, buildTree, treeMaterials, daylight };
