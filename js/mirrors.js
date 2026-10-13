import * as THREE from 'three';
import { LITE, layers, state } from './config.js';
import { renderer, scene } from './scene.js';
import { toLayer } from './layers.js';
import { UP } from './geometry.js';
import { sim } from './drive.js';

// ---------- Espelhos ----------
// Os vidros dos retrovisores mostram um reflexo de verdade: a cena é desenhada outra vez, vista por trás de cada espelho,
// só no recorte que ele ocupa. Posições medidas no modelo, em metros
const EYE = new THREE.Vector3(-0.36, 0.98, 0.22);   // olhos do motorista, para quem os espelhos estão regulados
// `box` delimita o vidro dentro da peça cromada; `aim` é para onde o motorista vê o reflexo;
// `wide` multiplica o campo de visão, como fazem os espelhos convexos (o do lado oposto ao motorista é o mais curvo);
// `clear` é a distância à frente do vidro a partir da qual a cena aparece, para a moldura do próprio espelho ficar de fora;
// `size` é a resolução do reflexo
const SPECS = [
  { mesh: 'chrome:body', layer: 'body', box: [-1.122, 0.805, -0.465, -0.94, 0.925, -0.372], aim: [-0.05, -0.01, 1], wide: 1.7, clear: 0.12, size: [384, 256] },
  { mesh: 'chrome:body', layer: 'body', box: [0.94, 0.805, -0.465, 1.122, 0.925, -0.372], aim: [0.06, -0.03, 1], wide: 3, clear: 0.12, size: [384, 256] },
  { mesh: 'chrome:interior', layer: 'interior', box: [-0.13, 1.06, -0.30, 0.116, 1.13, -0.262], aim: [0, 0.01, 1], wide: 1, clear: 0.01, size: [512, 128] },
];
// com a carroceria no lugar, estas camadas não aparecem nos reflexos e não precisam ser desenhadas neles
const UNSEEN = ['chassis', 'engine', 'trans', 'exhaust', 'cooling', 'fuel', 'electric', 'susp'];
const mirrors = [];
let tick = 0;

// Separa o vidro de um espelho da peça a que pertence e o devolve como uma peça própria, com o reflexo como textura
function buildMirror(spec) {
  const source = layers[spec.layer].group.children.find((o) => o.name === spec.mesh);
  const pos = source.geometry.attributes.position, index = source.geometry.index;
  const box = new THREE.Box3(new THREE.Vector3(...spec.box.slice(0, 3)), new THREE.Vector3(...spec.box.slice(3)));
  const p = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()], n = new THREE.Vector3(), e = new THREE.Vector3();
  const rest = [], glass = [], facing = new THREE.Vector3(), centre = new THREE.Vector3();
  source.updateWorldMatrix(true, false);
  for (let t = 0; t < index.count; t += 3) {
    for (let k = 0; k < 3; k++) p[k].fromBufferAttribute(pos, index.getX(t + k)).applyMatrix4(source.matrixWorld);
    if (!p.every((q) => box.containsPoint(q))) { rest.push(index.getX(t), index.getX(t + 1), index.getX(t + 2)); continue; }
    n.crossVectors(e.subVectors(p[1], p[0]), facing.subVectors(p[2], p[0]));
    if (n.z > 0) glass.push(p[0].clone(), p[1].clone(), p[2].clone());   // o vidro olha para trás; a face de dentro fica de fora
  }
  if (!glass.length) return;
  source.geometry.setIndex(rest);

  // plano do vidro: centro e direção para onde ele olha
  let area = 0;
  facing.set(0, 0, 0);
  for (let i = 0; i < glass.length; i += 3) {
    n.crossVectors(e.subVectors(glass[i + 1], glass[i]), p[0].subVectors(glass[i + 2], glass[i]));
    facing.add(n);
    centre.addScaledVector(p[0].copy(glass[i]).add(glass[i + 1]).add(glass[i + 2]), n.length() / 3);
    area += n.length();
  }
  facing.normalize();
  centre.divideScalar(area);
  // o reflexo é calculado como se o vidro estivesse regulado para o motorista: a direção fica a meio caminho
  // entre os olhos dele e o ponto para onde ele quer olhar
  const normal = EYE.clone().sub(centre).normalize().add(new THREE.Vector3(...spec.aim).normalize()).normalize();
  const right = new THREE.Vector3().crossVectors(UP, normal).normalize(), up = new THREE.Vector3().crossVectors(normal, right);

  // contorno do vidro nos eixos do espelho, para saber que recorte da cena desenhar
  const local = glass.map((q) => { e.subVectors(q, centre); return [e.dot(right), e.dot(up)]; });
  const xs = local.map((q) => q[0]), ys = local.map((q) => q[1]);
  const span = { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
  span.w = (Math.max(...xs) - Math.min(...xs)) / 2;
  span.h = (Math.max(...ys) - Math.min(...ys)) / 2;
  const P = [], N = [], U = [];
  glass.forEach((q, i) => {
    P.push(q.x - centre.x, q.y - centre.y, q.z - centre.z);
    N.push(facing.x, facing.y, facing.z);
    // a imagem inteira cabe no contorno do vidro; vista por trás, ela sai invertida de lado
    U.push(0.5 + (span.x - local[i][0]) / (2 * span.w), 0.5 + (local[i][1] - span.y) / (2 * span.h));
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));

  const target = new THREE.WebGLRenderTarget(spec.size[0], spec.size[1], {
    samples: 4, type: THREE.HalfFloatType, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter,
  });
  target.texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  const material = new THREE.MeshBasicMaterial({ map: target.texture, color: 0xdfe5e8, fog: false });   // o vidro tira um pouco da luz
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.copy(centre);
  mesh.updateMatrixWorld(true);
  toLayer(mesh, spec.layer);
  mesh.castShadow = false;
  const eye = new THREE.PerspectiveCamera();
  eye.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right.clone().negate(), up, normal.clone().negate()));
  mirrors.push({
    mesh, material, target, eye, centre, facing, normal, right, up, span, wide: spec.wide, clear: spec.clear,
    radius: Math.hypot(span.w, span.h), inside: spec.layer === 'interior', phase: mirrors.length, seen: -1, pixels: 0,
  });
}

function buildMirrors() {
  if (LITE) return;   // no celular os espelhos continuam cromados
  for (const spec of SPECS) buildMirror(spec);
}

// Desenha o reflexo de um espelho para quem olha da posição `from`
const toEye = new THREE.Vector3();
function reflect(m, from) {
  const depth = toEye.subVectors(from, m.centre).dot(m.normal);
  // a câmera do reflexo fica do outro lado do vidro, à mesma distância, olhando para fora através do contorno dele
  m.eye.position.copy(from).addScaledVector(m.normal, -2 * depth);
  m.eye.updateMatrixWorld();
  const near = depth + m.clear, k = near / depth;
  const x = -(m.span.x - toEye.dot(m.right)), y = m.span.y - toEye.dot(m.up), w = m.span.w * m.wide, h = m.span.h * m.wide;
  m.eye.projectionMatrix.makePerspective((x - w) * k, (x + w) * k, (y + h) * k, (y - h) * k, near, 400);
  m.eye.projectionMatrixInverse.copy(m.eye.projectionMatrix).invert();
  renderer.setRenderTarget(m.target);
  renderer.render(scene, m.eye);
}
function reflectAll(list, from) {
  // nos reflexos ficam de fora os vidros, que custam caro para desenhar, e o que a carroceria esconde;
  // os retrovisores de fora também não enxergam a cabine
  const cabin = layers.interior.group, hidden = [layers.body.group.children.find((o) => o.name === 'glass')];
  if (state.body === 'solid') for (const id of UNSEEN) hidden.push(layers[id].group);
  const was = hidden.map((o) => o.visible), cabinWas = cabin.visible;
  const target = renderer.getRenderTarget(), dirty = renderer.shadowMap.needsUpdate;
  for (const o of hidden) o.visible = false;
  renderer.shadowMap.needsUpdate = false;   // as sombras são refeitas no desenho principal, com a cena completa
  for (const m of list) {
    cabin.visible = cabinWas && (m.inside || state.body !== 'solid');
    reflect(m, from);
  }
  cabin.visible = cabinWas;
  hidden.forEach((o, i) => { o.visible = was[i]; });
  renderer.setRenderTarget(target);
  renderer.shadowMap.needsUpdate = dirty;
}

// A câmera se mexeu desde o quadro anterior?
const pose = new Float32Array(9);
function cameraMoved(camera) {
  const now = [...camera.position.toArray(), ...camera.quaternion.toArray(), camera.fov, camera.aspect];
  let moved = false;
  now.forEach((value, i) => { if (Math.abs(pose[i] - value) > 1e-5) moved = true; pose[i] = value; });
  return moved;
}

// Refaz os reflexos dos espelhos que aparecem na tela, gastando o mínimo: com o carro parado e a câmera quieta a imagem
// não muda, então basta conferi-la de vez em quando; em movimento, o maior espelho é refeito a cada quadro,
// os outros em quadros alternados e os que aparecem pequenos só algumas vezes por segundo
const frustum = new THREE.Frustum(), view = new THREE.Matrix4(), ball = new THREE.Sphere();
function updateMirrors(camera) {
  if (!mirrors.length) return;
  tick++;
  const moving = cameraMoved(camera) || sim.v > 0.01;
  camera.updateMatrixWorld();
  frustum.setFromProjectionMatrix(view.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
  const scale = renderer.domElement.height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
  const seen = mirrors.filter((m) => {
    if (!m.mesh.visible || !m.mesh.parent.visible || m.mesh.material !== m.material) return false;
    toEye.subVectors(camera.position, m.centre);
    if (toEye.dot(m.normal) < 0.05 || toEye.dot(m.facing) < 0.02) return false;   // a câmera está atrás do vidro
    m.pixels = 2 * m.span.w / toEye.length() * scale;
    return m.pixels > 10 && frustum.intersectsSphere(ball.set(m.centre, m.radius));
  }).sort((a, b) => b.pixels - a.pixels);
  const due = seen.filter((m, i) => {
    const fresh = m.seen !== tick - 1;   // acabou de entrar em cena
    m.seen = tick;
    const every = !moving ? 20 : m.pixels < 40 ? 8 : i === 0 ? 1 : 2;
    return fresh || (tick + m.phase) % every === 0;
  });
  if (due.length) reflectAll(due, camera.position);
}

// Primeiro reflexo de todos, feito ainda durante a carga, para os programas de desenho já ficarem prontos
function warmMirrors() {
  if (mirrors.length) reflectAll(mirrors, new THREE.Vector3(0, 1.2, 5));
}

export { buildMirrors, updateMirrors, warmMirrors };
