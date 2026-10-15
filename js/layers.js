import * as THREE from 'three';
import { LAYERS, layers } from './config.js';
import { spec } from './cars/index.js';
import { scene } from './scene.js';

// ---------- Camadas ----------
// O carro é um grupo na cena com um subgrupo por camada (ver `layers` na ficha do carro). Estas são as ferramentas
// genéricas para pôr peças em cada uma; quem distribui as peças de um modelo em particular é o `model.js` dele
const X0 = spec.frame.x0;   // desvio lateral do modelo: as peças criadas por código ficam centradas nele
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
// Grupo das peças de uma camada que se movem sozinhas; ao contrário das demais, não são fundidas em uma malha só
function M(id) {
  const L = layers[id];
  if (!L.moving) { L.moving = new THREE.Group(); L.moving.position.x = X0; L.group.add(L.moving); }
  return L.moving;
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

// Retira de uma peça do modelo os triângulos que ficam inteiros dentro de `box` (x, y, z mínimos e máximos)
// e os devolve como uma peça à parte, na mesma camada
function carve(layer, name, box) {
  const source = layers[layer].group.children.find((o) => o.name === name);
  const pos = source.geometry.attributes.position, index = source.geometry.index, p = new THREE.Vector3();
  const zone = new THREE.Box3(new THREE.Vector3(...box.slice(0, 3)), new THREE.Vector3(...box.slice(3)));
  const inside = [], rest = [];
  source.updateWorldMatrix(true, false);
  for (let t = 0; t < index.count; t += 3) {
    let all = true;
    for (let k = 0; k < 3 && all; k++) all = zone.containsPoint(p.fromBufferAttribute(pos, index.getX(t + k)).applyMatrix4(source.matrixWorld));
    (all ? inside : rest).push(index.getX(t), index.getX(t + 1), index.getX(t + 2));
  }
  source.geometry.setIndex(rest);
  const geo = new THREE.BufferGeometry();
  for (const key in source.geometry.attributes) geo.setAttribute(key, source.geometry.attributes[key]);
  geo.setIndex(inside);
  const piece = new THREE.Mesh(geo, source.material);
  piece.name = `${name}:piece`;
  piece.position.copy(source.position); piece.quaternion.copy(source.quaternion); piece.scale.copy(source.scale);
  source.parent.add(piece);
  piece.updateWorldMatrix(true, false);
  toLayer(piece, layer);
  return piece;
}

export { carRoot, bodyMeshes, G, M, toLayer, carve };
