import * as THREE from 'three';
import { LITE, X0, layers } from './config.js';
import { renderer, scene, camera } from './scene.js';
import { std, emblem } from './materials.js';
import { toLayer } from './layers.js';
import { paint, textureOf } from './praca-textures.js';
import { seeThrough, behind, glance, beforeFrame } from './post.js';

// ---------- Detalhes acrescentados ao modelo ----------
// Peças e texturas que o modelo original não traz: pneus com banda de rodagem e inscrições, que cedem onde tocam o chão,
// calotas, o borrão dos raios quando a roda gira depressa e as placas

const RIM = 0.2825;     // raio da borda da roda, medido no modelo
const SQUASH = 0.007;   // quanto o pneu cede sob o peso do carro: solto, o raio dele é esse tanto maior do que a altura do eixo
const GHOSTS = 62;      // máximo de cópias dos raios de cada roda no borrão do giro (o estêncil numera até 255, para as quatro)
const PERIOD = 2 * Math.PI / 5;   // as rodas têm cinco raios: a cada 72° a imagem se repete
// uma entrada por roda: { mount, pivot, discMount, discPivot, centre, front }. `mount` e `discMount` ficam no centro da roda
// e sobem e descem com ela; dentro deles, `pivot` e `discPivot` giram em torno do eixo
const wheels = [];
const tyres = {};       // borracha dos pneus dianteiros e traseiros
const spinners = [];    // { solids, veil, ... }: os raios de cada roda, nítidos, e o véu de cópias que os substitui em movimento

// Pneu: o perfil (flanco, ombro e banda de rodagem) dá a volta em torno do eixo da roda, que é o eixo x.
// Na textura, v vai de um talão ao outro: 0–0,25 é o flanco do lado +x, 0,25–0,75 a banda e 0,75–1 o flanco do lado -x
function tyreGeometry(width, radius) {
  const W = width / 2, turns = 112, samples = 30;
  // meio perfil, do talão (escondido atrás da borda da roda) até o centro da banda: [afastamento lateral, raio]
  const path = new THREE.CatmullRomCurve3([
    [W - 0.016, RIM - 0.008], [W - 0.004, RIM + 0.002], [W, RIM + 0.016], [W + 0.001, RIM + 0.034], [W - 0.004, radius - 0.024],
    [W - 0.014, radius - 0.010], [W - 0.030, radius - 0.003], [W - 0.048, radius - 0.0006], [W * 0.5, radius], [0, radius],
  ].map(([l, r]) => new THREE.Vector3(l, r, 0)), false, 'centripetal');
  const pts = path.getSpacedPoints(samples);
  // o ombro, onde o flanco vira banda de rodagem, separa as duas zonas da textura
  let shoulder = 0;
  while (pts[shoulder].y < radius - 0.008) shoulder++;
  const profile = [];
  for (let i = 0; i <= samples; i++) {
    const t = path.getTangentAt(i / samples);
    const v = i <= shoulder ? 0.25 * i / shoulder : 0.25 + 0.25 * (i - shoulder) / (samples - shoulder);
    profile.push({ l: pts[i].x, r: pts[i].y, nl: t.y, nr: -t.x, v });
  }
  for (let i = samples - 1; i >= 0; i--) { const p = profile[i]; profile.push({ l: -p.l, r: p.r, nl: -p.nl, nr: p.nr, v: 1 - p.v }); }

  const P = [], N = [], U = [], I = [], rows = profile.length;
  for (let i = 0; i <= turns; i++) {
    const a = i / turns * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    for (const p of profile) {
      P.push(p.l, p.r * c, p.r * s);
      N.push(p.nl, p.nr * c, p.nr * s);
      U.push(i / turns, p.v);
    }
  }
  for (let i = 0; i < turns; i++) for (let j = 0; j < rows - 1; j++) {
    const a = i * rows + j, b = a + rows;
    I.push(a, a + 1, b, a + 1, b + 1, b);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  geo.setIndex(I);
  return geo;
}

// Desenho do pneu aberto em uma tira: a largura da imagem dá a volta completa. Serve para o relevo, para a cor e para
// o brilho, mudando só os tons: `tone` devolve o tom do flanco, da banda (se for diferente), dos sulcos, dos cortes finos
// e do que fica em alto-relevo
function drawTyre(g, W, H, label, tone) {
  const side = H / 4, tread = H / 2, k = W / 4096;
  g.fillStyle = tone.base;
  g.fillRect(0, 0, W, H);

  // banda de rodagem: quatro sulcos ao longo da volta e cortes inclinados nos ombros e nas nervuras
  g.save();
  g.translate(0, side);
  if (tone.tread) { g.fillStyle = tone.tread; g.fillRect(0, 0, W, tread); }
  g.strokeStyle = tone.cut;
  g.lineCap = 'round';
  for (let x = 0; x < W; x += 56 * k) {
    g.lineWidth = Math.max(1, 5 * k);
    for (const [y0, y1, lean] of [[0.0, 0.13, 26], [0.87, 1.0, 26], [0.22, 0.34, -16], [0.66, 0.78, -16]]) {
      g.beginPath();
      g.moveTo(x, y0 * tread);
      g.lineTo(x + lean * k * (y0 < 0.5 ? 1 : -1), y1 * tread);
      g.stroke();
    }
    g.lineWidth = Math.max(1, 3 * k);
    g.beginPath();
    g.moveTo(x + 28 * k, 0.43 * tread);
    g.lineTo(x + 40 * k, 0.57 * tread);
    g.stroke();
  }
  g.fillStyle = tone.groove;
  for (const y of [0.16, 0.38, 0.62, 0.84]) g.fillRect(0, (y - 0.022) * tread, W, 0.044 * tread);
  g.restore();

  // flancos: friso de proteção junto à roda, linhas finas junto ao ombro, serrilhado e inscrições em alto-relevo.
  // Cada flanco é desenhado virado para ser lido por quem olha a roda de fora
  for (const outer of [true, false]) {
    g.save();
    if (outer) { g.translate(W, H - side); g.scale(-1, 1); } else { g.translate(0, side); g.scale(1, -1); }
    g.fillStyle = tone.raised;
    for (let x = 0; x < W; x += 22 * k) g.fillRect(x, 0, 9 * k, 0.09 * side);
    g.fillRect(0, 0.15 * side, W, Math.max(1, 0.022 * side));
    g.fillRect(0, 0.21 * side, W, Math.max(1, 0.022 * side));
    g.fillRect(0, 0.80 * side, W, 0.07 * side);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const write = (text, x, size) => {
      g.save();
      g.translate(x * W, 0.51 * side);
      g.scale(1.36, 1);   // a tira é mais comprida do que alta em relação ao pneu, então as letras são alargadas
      g.font = `bold ${size * side}px "Arial Narrow", Arial, sans-serif`;
      g.fillText(text, 0, 0);
      g.restore();
    };
    write(label, 0.125, 0.40);
    write(label, 0.625, 0.40);
    write('RADIAL · TUBELESS', 0.375, 0.22);
    write('TREADWEAR 220 · TRACTION AA · TEMPERATURE A', 0.875, 0.17);
    g.restore();
  }
}
function tyreMaterial(label) {
  const big = LITE ? 2048 : 4096;
  const bump = textureOf(paint(big, big / 8, (g, W, H) => drawTyre(g, W, H, label,
    { base: 'rgb(128,128,128)', groove: 'rgb(26,26,26)', cut: 'rgb(60,60,60)', raised: 'rgb(214,214,214)' })), false);
  // a borracha não é preta de todo: é um cinza muito escuro, um pouco mais claro e fosco na banda, que o asfalto lixa
  const map = textureOf(paint(1024, 128, (g, W, H) => drawTyre(g, W, H, label,
    { base: 'rgb(31,31,33)', tread: 'rgb(37,37,38)', groove: 'rgb(10,10,10)', cut: 'rgb(18,18,18)', raised: 'rgb(42,42,45)' })));
  // o flanco tem o brilho baço da borracha moldada, que as letras em relevo acentuam
  const gloss = textureOf(paint(1024, 128, (g, W, H) => drawTyre(g, W, H, label,
    { base: 'rgb(178,178,178)', tread: 'rgb(238,238,238)', groove: 'rgb(250,250,250)', cut: 'rgb(250,250,250)', raised: 'rgb(140,140,140)' })), false);
  const rubber = std({ map, bumpMap: bump, bumpScale: 2.4, roughnessMap: gloss, roughness: 1 });
  rubber.userData.relief = rubber.bumpScale;   // em movimento o relevo é atenuado
  // O pneu cede onde toca o chão: a banda se achata numa área do tamanho de uma mão e o flanco estufa logo acima dela.
  // A conta é feita já no lugar em que a roda está na cena, então acompanha o giro, a suspensão e o esterço
  rubber.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', `
      vec4 onGround = modelMatrix * vec4(transformed, 1.0);
      float low = onGround.y, soft = 0.006;
      onGround.y += low < -soft ? -low : low < soft ? (soft - low) * (soft - low) / (4.0 * soft) : 0.0;
      float flank = uv.y < 0.25 ? uv.y / 0.25 : uv.y > 0.75 ? (1.0 - uv.y) / 0.25 : 1.0;   // 0 no talão, 1 no ombro
      float bulge = 0.0055 * smoothstep(0.0, 0.55, flank) * (1.0 - 0.6 * smoothstep(0.7, 1.0, flank)) * (1.0 - smoothstep(0.0, 0.1, onGround.y));
      onGround.xyz += normalize(modelMatrix[0].xyz) * (uv.y < 0.25 ? bulge : uv.y > 0.75 ? -bulge : 0.0);
      vec4 mvPosition = viewMatrix * onGround;
      gl_Position = projectionMatrix * mvPosition;`);
  };
  return rubber;
}

// Calota: tampa abaulada no centro da roda, com o mesmo emblema do volante
function hubCap() {
  const R = 0.0355, profile = [[0, 0.0042], [0.010, 0.0039], [0.020, 0.0028], [0.028, 0.0012], [0.0325, -0.0004], [R, -0.004]];
  const geo = new THREE.LatheGeometry(profile.map(([r, h]) => new THREE.Vector2(r, h)), 48);
  const pos = geo.attributes.position, uv = geo.attributes.uv;
  for (let i = 0; i < pos.count; i++) uv.setXY(i, 0.5 + pos.getX(i) / (2 * R), 0.5 + pos.getZ(i) / (2 * R));   // o desenho é visto de frente
  geo.computeVertexNormals();
  return geo;
}

// Triângulos de uma peça da roda que não são iguais em toda a volta (raios, porcas); os anéis (aro, tala, cubo) ficam
// de fora. Quem decide é a própria malha: em cada faixa de raio e de profundidade, conta-se em que fração dos 36 setores
// da volta há triângulos. Faixas largas separam os raios do aro; faixas finas apanham as pontas dos raios, que se
// confundem com a tala. `matrix` leva a peça para o referencial do eixo da roda
function spokeTriangles(geo, matrix) {
  const pos = geo.attributes.position, index = geo.index, tris = index.count / 3, p = new THREE.Vector3(), c = new THREE.Vector3(), at = [];
  for (let t = 0; t < tris; t++) {
    c.set(0, 0, 0);
    for (let k = 0; k < 3; k++) c.add(p.fromBufferAttribute(pos, index.getX(t * 3 + k)).applyMatrix4(matrix));
    c.divideScalar(3);
    at.push([Math.hypot(c.y, c.z), c.x, Math.floor((Math.atan2(c.z, c.y) + Math.PI) / (2 * Math.PI) * 36) % 36]);
  }
  const cover = (dr, dx) => {
    const bins = new Map(), key = ([r, x]) => Math.round(r / dr) * 1000 + Math.round(x / dx);
    for (const a of at) {
      if (!bins.has(key(a))) bins.set(key(a), new Set());
      bins.get(key(a)).add(a[2]);
    }
    return at.map((a) => bins.get(key(a)).size / 36);
  };
  const wide = cover(0.01, 0.02), fine = cover(0.003, 0.005);
  let ring = at.map((a, t) => wide[t] > 0.94 && fine[t] > 0.5);

  // Vizinhança: triângulos que dividem uma aresta (vértices na mesma posição contam como um só)
  const ids = new Map(), vertex = new Int32Array(pos.count), edges = new Map(), near = Array.from({ length: tris }, () => []);
  for (let i = 0; i < pos.count; i++) {
    const key = `${Math.round(pos.getX(i) * 1e4)},${Math.round(pos.getY(i) * 1e4)},${Math.round(pos.getZ(i) * 1e4)}`;
    if (!ids.has(key)) ids.set(key, ids.size);
    vertex[i] = ids.get(key);
  }
  for (let t = 0; t < tris; t++) for (let k = 0; k < 3; k++) {
    const a = vertex[index.getX(t * 3 + k)], b = vertex[index.getX(t * 3 + (k + 1) % 3)], key = a < b ? a * 1e6 + b : b * 1e6 + a;
    if (edges.has(key)) { near[t].push(edges.get(key)); near[edges.get(key)].push(t); } else edges.set(key, t);
  }
  // a fronteira entre anel e raio não pode ficar serrilhada: sai do anel o triângulo que avança sozinho entre os raios
  for (let pass = 0; pass < 3; pass++) ring = ring.map((is, t) => is && near[t].filter((n) => !ring[n]).length < 2);
  // e um anel é um conjunto de triângulos vizinhos que dá a volta inteira; o que sobra em pedaços soltos é ponta de raio
  const seen = new Uint8Array(tris);
  for (let t = 0; t < tris; t++) {
    if (!ring[t] || seen[t]) continue;
    const patch = [t], sectors = new Set();
    seen[t] = 1;
    for (let i = 0; i < patch.length; i++) {
      sectors.add(at[patch[i]][2]);
      for (const n of near[patch[i]]) if (ring[n] && !seen[n]) { seen[n] = 1; patch.push(n); }
    }
    if (sectors.size < 34) for (const i of patch) ring[i] = false;
  }
  const out = { ring: [], spokes: [] };
  ring.forEach((is, t) => (is ? out.ring : out.spokes).push(index.getX(t * 3), index.getX(t * 3 + 1), index.getX(t * 3 + 2)));
  return out;
}

// Tira de uma peça da roda os raios e os devolve como uma peça à parte, já em torno do eixo
const split = new Map();   // as quatro rodas podem usar a mesma malha: a separação é feita uma vez só
function loosen(mesh, pivot) {
  const geo = mesh.geometry;
  mesh.updateMatrix();
  if (!split.has(geo)) {
    const parts = spokeTriangles(geo, mesh.matrix);
    geo.setIndex(parts.ring);
    split.set(geo, parts.spokes);
  }
  const spokes = split.get(geo).slice();
  if (!geo.index.count) mesh.visible = false;
  if (!spokes.length) return null;
  if (mesh.matrix.determinant() < 0) for (let i = 0; i < spokes.length; i += 3) [spokes[i], spokes[i + 2]] = [spokes[i + 2], spokes[i]];   // peça espelhada
  const loose = geo.clone().applyMatrix4(mesh.matrix);
  loose.setIndex(spokes);
  const solid = new THREE.Mesh(loose, mesh.material);
  solid.castShadow = solid.receiveShadow = true;
  pivot.add(solid);
  return solid;
}

// Borrão do giro. Com a roda girando depressa, cada raio varre um arco durante a exposição do quadro e deixa de ser visto
// como raio: vira um véu, por trás do qual o disco e a pinça continuam nítidos. Aqui os raios são desenhados dezenas de vezes,
// espalhados por esse arco, e cada cópia soma à imagem a sua parte da diferença entre o raio e o que está atrás dele.
// A luz dos raios é calculada uma vez só: antes do quadro, os raios nítidos de todas as rodas são desenhados à parte, com os
// materiais de verdade (`shootSpokes`), e cada cópia pega ali a cor já iluminada do mesmo ponto do raio, onde ele estava.
// O que está atrás vem da cópia da imagem tirada quando a primeira cópia entra (ver post.js), já com o disco, a pinça e o chão.
// Cada cópia só pode contar uma vez em cada ponto da tela, mesmo onde a face torneada cobre o corpo do raio: quem garante
// é o estêncil, que guarda o número da última cópia desenhada ali. `solids` vêm na ordem de fora para dentro
const SHARP = 2;   // camada dos raios nítidos
const sharp = { eye: new THREE.PerspectiveCamera(), target: new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType }), size: new THREE.Vector2() };
sharp.target.texture.colorSpace = THREE.LinearSRGBColorSpace;
sharp.target.isXRRenderTarget = true;   // a luz sai exposta e comprimida como na imagem, com os mesmos programas de desenho
function addVeil(w, slot, solids) {
  const P = [];
  for (const solid of solids) {
    solid.layers.enable(SHARP);
    const g = solid.geometry, pos = g.attributes.position;
    for (let i = 0; i < g.index.count; i++) {
      const k = g.index.getX(i);
      P.push(pos.getX(k), pos.getY(k), pos.getZ(k));
    }
  }
  const geo = new THREE.BufferGeometry(), share = { value: 1 };
  geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  const look = new THREE.ShaderMaterial({
    uniforms: { uShare: share, tBehind: behind, tSharp: { value: sharp.target.texture }, uPivot: { value: w.pivot.matrixWorld } },
    vertexShader: `
      uniform mat4 uPivot;
      varying vec4 vSharp;
      void main() {
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        vSharp = projectionMatrix * viewMatrix * uPivot * vec4(position, 1.0);   // onde este ponto do raio está na vista nítida
      }`,
    fragmentShader: `
      uniform sampler2D tBehind, tSharp;
      uniform float uShare;
      varying vec4 vSharp;
      void main() {
        // a vista nítida tem fundo vazio: nas bordas, a cor já vem multiplicada pela cobertura
        vec4 spoke = texture2D(tSharp, vSharp.xy / vSharp.w * 0.5 + 0.5);
        vec3 behind = texelFetch(tBehind, ivec2(gl_FragCoord.xy), 0).rgb;
        gl_FragColor = vec4((spoke.rgb - behind * spoke.a) * uShare, 0.0);
      }`,
    toneMapped: false, fog: false, transparent: true, depthWrite: false,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
    stencilWrite: true, stencilFunc: THREE.NotEqualStencilFunc, stencilZPass: THREE.ReplaceStencilOp,
  });
  const veil = new THREE.Group();
  veil.visible = false;
  for (let k = 0; k < GHOSTS; k++) {
    const copy = new THREE.Mesh(geo, look);
    copy.renderOrder = 3;   // depois da sombra sob o carro, antes do vidro
    copy.onBeforeRender = () => { glance('spin'); look.stencilRef = 1 + slot * GHOSTS + k; };
    veil.add(copy);
  }
  w.pivot.add(veil);
  spinners.push({ solids, veil, share, centre: w.centre });
}
// Antes de um quadro com as rodas borradas, os raios nítidos são desenhados sozinhos, na vista da câmera, com metade da
// definição (o borrão não pede mais) e sobre fundo vazio. A sombra que eles recebem é a do último mapa de sombras
const lit = new THREE.Color();
function shootSpokes(eye) {
  if (!spinners.some((s) => s.veil.visible)) return;
  renderer.getDrawingBufferSize(sharp.size).multiplyScalar(0.5).floor();
  if (sharp.size.x !== sharp.target.width || sharp.size.y !== sharp.target.height) sharp.target.setSize(sharp.size.x, sharp.size.y);
  sharp.eye.copy(eye);
  sharp.eye.layers.set(SHARP);
  scene.traverse((o) => { if (o.isLight) o.layers.enable(SHARP); });   // a luz é a mesma da cena
  const background = scene.background, dirty = renderer.shadowMap.needsUpdate, alpha = renderer.getClearAlpha(), target = renderer.getRenderTarget();
  renderer.getClearColor(lit);
  for (const s of spinners) for (const solid of s.solids) solid.visible = true;
  scene.background = null;
  renderer.shadowMap.needsUpdate = false;
  renderer.setClearColor(0x000000, 0);
  renderer.setRenderTarget(sharp.target);
  renderer.render(scene, sharp.eye);
  renderer.setRenderTarget(target);
  renderer.setClearColor(lit, alpha);
  renderer.shadowMap.needsUpdate = dirty;
  scene.background = background;
  for (const s of spinners) for (const solid of s.solids) solid.visible = false;
}
beforeFrame(shootSpokes);
// `arc` é o ângulo, em radianos, que a roda gira durante a exposição de um quadro
function spinBlur(arc) {
  arc = Math.min(arc, PERIOD);   // além de um raio até o seguinte a imagem já não muda
  const on = arc > 0.03;
  // cópias bastantes para ficarem, na tela, a pouco mais de um pixel uma da outra: de perto são muitas, de longe bastam poucas
  const scale = renderer.domElement.height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
  for (const s of spinners) {
    for (const solid of s.solids) solid.visible = !on;
    s.veil.visible = on;
    if (!on) continue;
    const count = Math.max(12, Math.min(GHOSTS, Math.ceil(arc * RIM * scale / Math.max(0.4, camera.position.distanceTo(s.centre)) / 1.5)));
    s.share.value = 1 / count;
    s.veil.children.forEach((copy, k) => {
      copy.visible = k < count;
      copy.rotation.x = arc * ((k + 0.5) / count - 0.5);
    });
  }
}

// Agrupa as peças de cada roda em torno do eixo, para que possam girar, e troca os pneus lisos do modelo pelos novos
function setupWheels() {
  const W = layers.wheels.group, B = layers.brakes.group, v = new THREE.Vector3(), cap = hubCap();
  tyres.front = tyreMaterial('235/35 ZR20 88Y');
  tyres.rear = tyreMaterial('295/35 ZR20 101Y');
  for (const old of W.children.filter((o) => o.name.startsWith('tire'))) {
    const box = new THREE.Box3().setFromObject(old), centre = box.getCenter(new THREE.Vector3()), size = box.getSize(v);
    const front = centre.z < 0, mount = new THREE.Group(), pivot = new THREE.Group(), discMount = new THREE.Group(), discPivot = new THREE.Group();
    mount.position.copy(centre);
    discMount.position.copy(centre);
    mount.add(pivot);
    discMount.add(discPivot);
    W.add(mount);
    B.add(discMount);
    const tyre = new THREE.Mesh(tyreGeometry(size.x, size.y / 2 + SQUASH), front ? tyres.front : tyres.rear);
    tyre.castShadow = tyre.receiveShadow = true;
    pivot.add(tyre);
    old.removeFromParent();
    old.geometry.dispose();
    wheels.push({ mount, pivot, discMount, discPivot, centre, front });
  }
  // na mesma ordem usada pela física da suspensão: dianteira esquerda, dianteira direita, traseira esquerda, traseira direita
  const order = (w) => (w.centre.z < 0 ? 0 : 2) + (w.centre.x > 0 ? 1 : 0);
  wheels.sort((a, b) => order(a) - order(b));
  const owner = (o) => {
    new THREE.Box3().setFromObject(o).getCenter(v);
    return wheels.reduce((a, b) => (v.distanceToSquared(a.centre) < v.distanceToSquared(b.centre) ? a : b));
  };
  for (const o of [...W.children]) if (o.isMesh) owner(o).pivot.attach(o);
  for (const o of [...B.children]) if (o.isMesh && o.name.startsWith('brake')) owner(o).discPivot.attach(o);

  wheels.forEach((w, slot) => {
    w.pivot.updateWorldMatrix(true, false);
    const lid = w.pivot.children.find((o) => o.name.startsWith('centre'));
    if (lid) {
      // a tampa lisa do modelo dá lugar à calota, virada para fora
      const hub = new THREE.Mesh(cap, emblem);
      w.pivot.worldToLocal(new THREE.Box3().setFromObject(lid).getCenter(hub.position));
      hub.rotation.z = w.centre.x > 0 ? -Math.PI / 2 : Math.PI / 2;
      hub.castShadow = hub.receiveShadow = true;
      w.pivot.add(hub);
      lid.removeFromParent();
    }
    if (LITE || !seeThrough) return;
    // porcas, face torneada e corpo da roda, nessa ordem: é a de quem cobre quem para quem olha a roda de fora
    const solids = ['nuts', 'rim', 'wheel'].map((name) => w.pivot.children.find((o) => o.name.startsWith(name))).filter(Boolean)
      .map((mesh) => loosen(mesh, w.pivot)).filter(Boolean);
    if (solids.length) addVeil(w, slot, solids);
  });
  spinBlur(0);
}

// Placa no padrão Mercosul, 400 × 130 mm: faixa azul com o nome do país e sete caracteres pretos, estampados em relevo.
// O mesmo desenho dá a cor e, com `relief`, a altura de cada parte
function plateTexture(text, relief) {
  const tone = relief
    ? { edge: '#000000', sheet: '#707070', band: '#707070', word: '#707070', ink: '#f0f0f0', rim: '#d0d0d0' }
    : { edge: '#101012', sheet: 'rgb(236,236,231)', band: '#0b3a8f', word: '#ffffff', ink: '#0d0d0f', rim: 'rgb(236,236,231)' };
  return textureOf(paint(1024, 333, (g, W, H) => {
    const round = (x, y, w, h, r) => { g.beginPath(); g.roundRect(x, y, w, h, r); };
    g.fillStyle = tone.edge;
    g.fillRect(0, 0, W, H);
    g.fillStyle = tone.sheet;
    round(7, 7, W - 14, H - 14, 16);
    g.fill();
    g.save();
    g.clip();
    g.fillStyle = tone.band;
    g.fillRect(0, 0, W, 80);
    g.restore();
    // a chapa tem uma moldura estampada junto à borda
    g.strokeStyle = tone.rim;
    g.lineWidth = 5;
    round(14, 14, W - 28, H - 28, 11);
    g.stroke();
    g.fillStyle = tone.word;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = 'bold 50px Arial, sans-serif';
    g.fillText('BRASIL', W / 2, 46);
    if (!relief) {
      // bandeira à direita da faixa
      g.fillStyle = '#1f9d49';
      g.fillRect(W - 112, 22, 70, 46);
      g.fillStyle = '#f4d21f';
      g.beginPath();
      g.moveTo(W - 77, 26); g.lineTo(W - 47, 45); g.lineTo(W - 77, 64); g.lineTo(W - 107, 45);
      g.fill();
      g.fillStyle = '#17357a';
      g.beginPath();
      g.arc(W - 77, 45, 10, 0, 7);
      g.fill();
    }
    // sete caracteres, cada um ocupando no máximo 42 mm de largura
    g.fillStyle = tone.ink;
    g.font = 'bold 236px Bahnschrift, "DIN Alternate", "Arial Narrow", Arial, sans-serif';
    g.textBaseline = 'alphabetic';
    [...text].forEach((ch, i) => {
      const w = g.measureText(ch).width;
      g.save();
      g.translate(128 + i * 128, 292);
      g.scale(Math.min(1, 106 / w), 1);
      g.fillText(ch, 0, 0);
      g.restore();
    });
    g.font = 'bold 30px Arial, sans-serif';
    g.fillText('BR', 44, 302);
  }), !relief, THREE.ClampToEdgeWrapping);
}
function addPlates() {
  const face = std({ map: plateTexture('CAR3D26'), bumpMap: plateTexture('CAR3D26', true), bumpScale: 1.6, roughness: 0.38 });
  const dark = std({ color: 0x0d0d0f, roughness: 0.55 });
  const plate = () => new THREE.Mesh(new THREE.BoxGeometry(0.40, 0.13, 0.003), [dark, dark, dark, dark, face, dark]);
  const frame = (w, h, d) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), dark);
  // traseira: no rebaixo da tampa, que é inclinado
  const lean = new THREE.Vector3(0, 0.36, 0.933).normalize(), back = new THREE.Group();
  back.position.set(X0, 0.605, 2.2225).addScaledVector(lean, 0.004);
  back.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), lean);
  back.add(frame(0.412, 0.142, 0.006), plate());
  back.children[1].position.z = 0.005;
  // dianteira: em pé, num suporte preso ao centro do para-choque
  const front = new THREE.Group();
  front.position.set(X0, 0.362, -2.262);
  front.rotation.y = Math.PI;
  front.add(frame(0.412, 0.142, 0.008), plate(), frame(0.22, 0.07, 0.07));
  front.children[1].position.z = 0.006;
  front.children[2].position.set(0, -0.02, -0.036);
  for (const group of [back, front]) {
    layers.body.group.add(group);
    group.updateWorldMatrix(true, true);
    for (const mesh of [...group.children]) toLayer(mesh, 'body');
    group.removeFromParent();
  }
}

// Chamado depois que o modelo foi distribuído nas camadas e as peças mecânicas foram criadas
function addDetails() {
  setupWheels();
  addPlates();
}

export { wheels, tyres, spinners, PERIOD, spinBlur, addDetails };
