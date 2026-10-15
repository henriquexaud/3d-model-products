import * as THREE from 'three';
import { layers } from '../../config.js';
import { toLayer } from '../../layers.js';
import {
  leatherBump, plasticBump, carpetBump, carbonMap, grilleMap, triplanar, std, phys, bodyMaterial,
  alloy, alloyFace, alloyBody, darkMetal, carGlass, headGlass, ledGlass, tailGlass, redButton, disc,
} from '../../materials.js';

// ---------- O modelo original ----------
// O arquivo da Ferrari do three.js chega com nomes próprios de materiais e de peças. Aqui cada material ganha o da biblioteca
// (materials.js) e cada peça vai para a sua camada; a cabine e a carroceria, que o arquivo mistura, são separadas

// Material por nome do material original do modelo
const MATERIALS = {
  Body_Color: bodyMaterial,
  Glass_Gray: carGlass,
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
// Exceções por nome da peça (peças que compartilham material no modelo original)
const MESH_OVERRIDES = [
  [/^brake(_\d)?$/, disc],
  [/^rim_/, alloyFace],
  [/^wheel(_\d)?$/, alloyBody],
  [/^grills/, triplanar(std({ map: grilleMap, bumpMap: grilleMap, bumpScale: 1.2, color: 0x4a4c50, metalness: 0.55, roughness: 0.5 }), 105, true)],
  [/^(nuts|centre)/, darkMetal],
];

// Peças do modelo original que pertencem inteiras à cabine
const CABIN_MESHES = new Set(['leather', 'trim', 'carpet', 'carbon_fibre_trim', 'carbon_fibre', 'blue']);
// Peças que misturam cabine e carroceria e por isso são separadas em partes
const SPLIT_MESHES = new Set(['interior_light', 'interior_dark', 'chrome', 'metal', 'plastic_gray', 'yellow_trim', 'lights_red']);
const inCabin = (b) => b.min.z > -1.40 && b.max.z < 0.66 && b.min.x > -0.84 && b.max.x < 0.83 && b.min.y >= 0.185;
// A suspensão simplificada do modelo original é descartada; a camada de suspensão a substitui
const isOldSuspension = (b) =>
  (b.max.z < -0.85 && b.min.z > -1.6 && b.max.y < 0.75) || (b.min.z > 1.2 && b.max.z < 1.8 && b.max.y < 0.85);

// O ponteiro fixo do conta-giros também sai: o painel de instrumentos ganha um que se move
const isOldPointer = (b) => b.max.x - b.min.x < 0.004 && b.min.x > -0.36 && b.max.x < -0.33 && b.min.y > 0.80 && b.max.y < 0.85 && b.max.z < -0.66;

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
    if (mesh.name === 'interior_light' && (isOldSuspension(part.box) || isOldPointer(part.box))) continue;
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
    // o vidro entra por último, depois das marcas no chão, da sombra sob o carro e do borrão das rodas, que se veem através dele
    if (o.material === MATERIALS.Glass_Gray) o.renderOrder = 4;
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
  for (const o of layers.interior.group.children) if (o.material === tailGlass) o.material = redButton;
  return discs;
}

export { prepareModel };
