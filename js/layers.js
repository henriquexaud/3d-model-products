import * as THREE from 'three';
import { X0, LAYERS, layers } from './config.js';
import { scene } from './scene.js';
import { MATERIALS, MESH_OVERRIDES } from './materials.js';

// ---------- Camadas ----------
const carRoot = new THREE.Group();
scene.add(carRoot);
for (const L of LAYERS) {
  L.group = new THREE.Group();
  carRoot.add(L.group);
}
const bodyMeshes = [];
// Grupo das peças criadas por código dentro de uma camada, já alinhado ao centro do modelo
function G(id) {
  const L = layers[id];
  if (!L.mech) { L.mech = new THREE.Group(); L.mech.position.x = X0; L.group.add(L.mech); }
  return L.mech;
}
function toLayer(mesh, id) {
  layers[id].group.attach(mesh);
  mesh.receiveShadow = true;
  mesh.castShadow = mesh.name !== 'glass';   // o sol atravessa os vidros
  if (id === 'body') {
    mesh.userData.solid = mesh.material;
    mesh.userData.inner = mesh.name.startsWith('interior_');   // forros, caixas de roda e assoalho
    bodyMeshes.push(mesh);
  }
}

// Peças do modelo original que pertencem inteiras à cabine
const CABIN_MESHES = new Set(['leather', 'trim', 'carpet', 'carbon_fibre_trim', 'carbon_fibre', 'blue']);
// Peças que misturam cabine e carroceria e por isso são separadas em partes
const SPLIT_MESHES = new Set(['interior_light', 'interior_dark', 'chrome', 'metal', 'plastic_gray', 'yellow_trim', 'lights_red']);
const inCabin = (b) => b.min.z > -1.40 && b.max.z < 0.66 && b.min.x > -0.84 && b.max.x < 0.83 && b.min.y >= 0.185;
// A suspensão simplificada do modelo original é descartada; a camada de suspensão a substitui
const isOldSuspension = (b) =>
  (b.max.z < -0.85 && b.min.z > -1.6 && b.max.y < 0.75) || (b.min.z > 1.2 && b.max.z < 1.8 && b.max.y < 0.85);

// Separa uma malha em partes contíguas e devolve uma malha por destino ('interior' ou 'body')
function splitMesh(mesh) {
  const geo = mesh.geometry, pos = geo.attributes.position, index = geo.index;
  const n = pos.count, first = new Map(), parent = new Int32Array(n);
  // vértices na mesma posição contam como um só
  for (let i = 0; i < n; i++) {
    const key = (Math.round(pos.getX(i) * 2000) + 20000) * 1e10
              + (Math.round(pos.getY(i) * 2000) + 20000) * 1e5
              + (Math.round(pos.getZ(i) * 2000) + 20000);
    const j = first.get(key);
    if (j === undefined) { first.set(key, i); parent[i] = i; } else parent[i] = j;
  }
  const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  const tris = index.count / 3;
  for (let t = 0; t < tris; t++) {
    const a = find(index.getX(t * 3));
    parent[find(index.getX(t * 3 + 1))] = a;
    parent[find(index.getX(t * 3 + 2))] = a;
  }
  const parts = new Map(), v = new THREE.Vector3();
  for (let t = 0; t < tris; t++) {
    const root = find(index.getX(t * 3));
    let part = parts.get(root);
    if (!part) parts.set(root, part = { tris: [], box: new THREE.Box3() });
    part.tris.push(t);
    for (let k = 0; k < 3; k++) part.box.expandByPoint(v.fromBufferAttribute(pos, index.getX(t * 3 + k)).applyMatrix4(mesh.matrixWorld));
  }
  const out = { interior: [], body: [] };
  for (const part of parts.values()) {
    if (mesh.name === 'interior_light' && isOldSuspension(part.box)) continue;
    const dest = out[inCabin(part.box) ? 'interior' : 'body'];
    for (const t of part.tris) dest.push(index.getX(t * 3), index.getX(t * 3 + 1), index.getX(t * 3 + 2));
  }
  return Object.entries(out).filter(([, idx]) => idx.length).map(([dest, idx]) => {
    const g = new THREE.BufferGeometry();
    for (const name in geo.attributes) g.setAttribute(name, geo.attributes[name]);
    g.setIndex(idx);
    const sub = new THREE.Mesh(g, mesh.material);
    sub.name = `${mesh.name}:${dest}`;
    sub.position.copy(mesh.position); sub.quaternion.copy(mesh.quaternion); sub.scale.copy(mesh.scale);
    mesh.parent.add(sub);
    sub.updateWorldMatrix(true, false);
    return [dest, sub];
  });
}

// Distribui as peças do modelo original pelas camadas e devolve a posição dos discos de freio
function prepareModel(car) {
  car.updateMatrixWorld(true);
  const meshes = [], discs = [];
  car.traverse((o) => { if (o.isMesh) meshes.push(o); });
  for (const o of meshes) {
    const override = MESH_OVERRIDES.find(([re]) => re.test(o.name));
    o.material = override ? override[1] : (MATERIALS[o.material.name] ?? o.material);
    if (o.parent.name.startsWith('wheel_')) {
      const isDisc = o.name.startsWith('brake');
      if (isDisc) discs.push(new THREE.Box3().setFromObject(o));
      toLayer(o, isDisc ? 'brakes' : 'wheels');
    } else if (o.parent.name === 'steering_wheel' || CABIN_MESHES.has(o.name)) {
      toLayer(o, 'interior');
    } else if (SPLIT_MESHES.has(o.name)) {
      for (const [dest, sub] of splitMesh(o)) toLayer(sub, dest);
      o.removeFromParent();
    } else {
      toLayer(o, 'body');
    }
  }
  return discs;
}

export { carRoot, bodyMeshes, G, prepareModel };
