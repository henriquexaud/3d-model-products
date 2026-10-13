import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { LITE, AX_F } from './config.js';
import { scene } from './scene.js';
import { std } from './materials.js';
import { UP } from './geometry.js';
import {
  SUN, seeded, hash2, fbm, smooth, paint, textureOf, lawnTexture, tuftTexture, treelineTexture,
} from './praca-textures.js';
import { cards, buildTree, treeMaterials, daylight } from './praca.js';
import { LOOP, FEATURES, TO_FRONT } from './ride.js';

// ---------- Estrada ----------
// Pista de mão única com duas faixas, em metros. O carro fica na origem, na faixa da direita, e é o cenário que corre para trás
const LANE = 3.6;                                                       // largura de cada faixa
const EDGE = { left: -(1.5 * LANE + 0.6), right: 0.5 * LANE + 2.5 };    // bordas do asfalto: acostamentos de 0,6 m e de 2,5 m
const DASH = 16;                                                        // um traço de 4 m mais um intervalo de 12 m
const RAIL = EDGE.left - 0.45;                                          // onde fica a defensa metálica
const POSTS = 4;                                                        // distância entre os postes da defensa
const SPAN = 520, WRAP = LOOP;                                          // comprimento desenhado e trecho em que árvores e irregularidades se repetem
const TILE = 2.5, TUFTS = 40;                                           // ladrilho do asfalto e do gramado; trecho em que os tufos se repetem
let road = null;

// A estrada só é montada na primeira vez em que é pedida
function ensureRoad() {
  return road ??= buildRoad();
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
// Chão que corre. A mesma textura, ampliada, clareia e escurece trechos largos, para o ladrilho não se repetir à vista;
// e com a velocidade ela se desfaz em riscos no sentido do movimento, como numa foto com o obturador aberto
function streaked(material, blur) {
  const mean = { value: meanTone(material.map) };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uBlur = blur;
    shader.uniforms.uMean = mean;
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uBlur, uMean;')
      .replace('#include <map_fragment>', `
        vec4 sharp = texture2D(map, vMapUv);
        vec4 smear = 0.5 * (texture2D(map, vec2(vMapUv.x, vMapUv.y * 0.03)) + texture2D(map, vec2(vMapUv.x + 0.37, vMapUv.y * 0.017 + 0.5)));
        float wide = texture2D(map, vMapUv * 0.0731 + 0.31).g / uMean;
        diffuseColor *= mix(sharp, smear, uBlur) * mix(1.0, wide, 0.35);`);
  };
  return material;
}

function buildRoad() {
  const group = new THREE.Group(), rand = seeded(57), blur = { value: 0 };
  scene.add(group);
  const flat = (mesh, x, y) => { mesh.rotation.x = -Math.PI / 2; mesh.position.set(x, y, 0); group.add(mesh); return mesh; };

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
  group.add(sun, sun.target);

  // asfalto e, por cima dele, a pintura e as margens de terra
  const width = EDGE.right - EDGE.left, middle = (EDGE.left + EDGE.right) / 2;
  const tar = asphaltTextures();
  tar.map.repeat.set(width / TILE, SPAN / TILE);
  tar.bump.repeat.copy(tar.map.repeat);
  const asphalt = flat(new THREE.Mesh(new THREE.PlaneGeometry(width, SPAN),
    streaked(std({ map: tar.map, bumpMap: tar.bump, bumpScale: 1.3, roughness: 0.88 }), blur)), middle, 0);
  const paintMap = markingsTexture(EDGE.left - 1.4, width + 2.8);
  paintMap.repeat.set(1, SPAN / DASH);
  const markings = flat(new THREE.Mesh(new THREE.PlaneGeometry(width + 2.8, SPAN),
    std({ map: paintMap, transparent: true, depthWrite: false, roughness: 0.8, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })), middle, 0.003);
  markings.renderOrder = 1;
  asphalt.receiveShadow = markings.receiveShadow = true;

  // juntas de dilatação e remendos: ficam onde a física da suspensão encontra as irregularidades da pista
  const tarry = (opacity) => std({ color: 0x202124, roughness: 0.75, transparent: true, opacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
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

  // gramado dos dois lados
  const lawnMap = lawnTexture();
  lawnMap.repeat.set(250 / TILE, SPAN / TILE);
  const lawn = streaked(std({ map: lawnMap, roughness: 1 }), blur);
  for (const side of [-1, 1]) {
    flat(new THREE.Mesh(new THREE.PlaneGeometry(250, SPAN), lawn), (side < 0 ? EDGE.left : EDGE.right) + side * 124.75, -0.02).receiveShadow = true;
  }

  // bosque distante, que fecha o horizonte
  const woods = treelineTexture();
  woods.repeat.set(14, 1);
  const treeline = new THREE.Mesh(new THREE.CylinderGeometry(210, 210, 17, 64, 1, true),
    new THREE.MeshBasicMaterial({ map: woods, alphaTest: 0.5, side: THREE.BackSide }));
  treeline.position.y = 8.4;
  group.add(treeline);

  // defensa metálica: lâmina de aço em "W" com o centro a 60 cm do chão. A lâmina é igual em todo o comprimento, só os postes correm
  const steel = std({ color: 0x9da2a6, metalness: 0.85, roughness: 0.42, side: THREE.DoubleSide });
  const P = [], I = [], steps = 24;
  for (let i = 0; i <= steps; i++) {
    const y = -0.155 + 0.31 * i / steps, x = 0.0405 * (1 - Math.cos(2 * Math.PI * (y + 0.155) / 0.155));
    P.push(RAIL + x, 0.6 + y, -SPAN / 2, RAIL + x, 0.6 + y, SPAN / 2);
    if (i < steps) I.push(2 * i, 2 * i + 2, 2 * i + 1, 2 * i + 1, 2 * i + 2, 2 * i + 3);
  }
  const beam = new THREE.BufferGeometry();
  beam.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  beam.setIndex(I);
  beam.computeVertexNormals();
  group.add(new THREE.Mesh(beam, steel));
  const postGeo = mergeGeometries([
    new THREE.BoxGeometry(0.06, 0.78, 0.13).translate(RAIL - 0.085, 0.39, 0),
    new THREE.BoxGeometry(0.055, 0.28, 0.13).translate(RAIL - 0.028, 0.6, 0),   // calço entre o poste e a lâmina
  ]);
  const posts = new THREE.InstancedMesh(postGeo, steel, SPAN / POSTS);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), scale = new THREE.Vector3(), tint = new THREE.Color();
  for (let i = 0; i < posts.count; i++) posts.setMatrixAt(i, m4.makeTranslation(0, 0, -SPAN / 2 + i * POSTS));
  posts.frustumCulled = false;
  group.add(posts);

  // tufos de grama nas margens, mais ralos longe da pista. O desenho se repete a cada 40 m
  const tuftGeo = cards(0.3, 0.14, true), base = LITE ? 700 : 2400, repeats = 4;
  tuftGeo.attributes.normal.array.fill(0);
  for (let i = 1; i < tuftGeo.attributes.normal.array.length; i += 3) tuftGeo.attributes.normal.array[i] = 1;   // iluminados como o chão
  const grass = new THREE.InstancedMesh(tuftGeo, std({ map: tuftTexture(), alphaTest: 0.5, roughness: 1 }), base * repeats);
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
  grass.frustumCulled = false;
  grass.receiveShadow = true;
  group.add(grass);

  // árvores espalhadas pelos dois lados; cada uma volta para o começo depois de passar
  const kit = treeMaterials(), trees = [], count = LITE ? 10 : 22;
  for (let i = 0; i < count; i++) {
    const seed = 40 + i, out = 15 + 46 * Math.pow(hash2(seed, 5), 1.5);
    const tree = buildTree({ seed, height: 6.5 + hash2(seed, 1) * 3, trunk: 0.19, sides: 8, leaves: LITE ? 300 : 520, leaf: 1.1 },
      kit.bark, kit.foliage, kit.coarseCard);
    tree.rotation.y = hash2(seed, 2) * 6.28;
    const shade = new THREE.Mesh(new THREE.PlaneGeometry(tree.userData.crown * 1.1, tree.userData.crown * 1.1), kit.blob);
    shade.rotation.x = -Math.PI / 2;
    shade.position.set(-SUN.x / SUN.y * tree.userData.height * 0.7, 0, -SUN.z / SUN.y * tree.userData.height * 0.7);
    const holder = new THREE.Group();
    holder.add(tree, shade);
    holder.position.x = i % 2 ? EDGE.right + out : RAIL - out;
    holder.userData.start = (i + hash2(seed, 3) * 0.8) / count * WRAP;
    group.add(holder);
    trees.push(holder);
  }

  // O cenário anda `distance` metros para trás; `speed` (m/s) define o quanto o chão se desfaz em riscos
  function update(distance, speed) {
    blur.value = smooth(0.4, 14, speed);
    asphalt.material.bumpScale = 1.3 * (1 - blur.value);
    tar.map.offset.y = tar.bump.offset.y = lawnMap.offset.y = (distance / TILE) % 1;
    paintMap.offset.y = (distance / DASH) % 1;
    posts.position.z = distance % POSTS;
    grass.position.z = distance % TUFTS;
    for (const holder of trees) holder.position.z = (holder.userData.start + distance) % WRAP - WRAP / 2;
    // cada irregularidade passa sob o centro de massa do carro quando a distância percorrida chega à posição dela
    for (const { mark, at } of marks) mark.position.z = AX_F + TO_FRONT + ((distance - at + WRAP / 2) % WRAP + WRAP) % WRAP - WRAP / 2;
  }
  update(0, 0);

  // os reflexos são fotografados com a estrada vazia: as árvores passam, e não poderiam ficar paradas neles
  return { group, update, dress: daylight(sun, treeline, [60, 260], trees) };
}

export { road, ensureRoad, LANE, DASH, POSTS };
