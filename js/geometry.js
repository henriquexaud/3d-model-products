import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// ---------- Geometria das peças mecânicas ----------
const UP = new THREE.Vector3(0, 1, 0);
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const toV = (p) => (p.isVector3 ? p : V(p[0], p[1], p[2]));
const S = [-1, 1];   // lado esquerdo e lado direito

// Cilindro (ou cone, com r2) do ponto a ao ponto b
function rod(a, b, r, mat, r2 = r, seg = 12) {
  const d = b.clone().sub(a), len = d.length();
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r2, r, len, seg), mat);
  m.position.copy(a).addScaledVector(d, 0.5);
  m.quaternion.setFromUnitVectors(UP, d.normalize());
  return m;
}
// Cilindro centrado em (x, y, z) com o eixo indicado; r2 é o raio na ponta positiva do eixo
function cyl(r, len, axis, x, y, z, mat, seg = 20, r2 = r) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r2, r, len, seg), mat);
  if (axis === 'x') m.rotation.z = -Math.PI / 2;
  else if (axis === 'z') m.rotation.x = Math.PI / 2;
  m.position.set(x, y, z);
  return m;
}
function rbox(w, h, d, x, y, z, mat, radius = 0.008) {
  const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, Math.min(radius, w / 2, h / 2, d / 2)), mat);
  m.position.set(x, y, z);
  return m;
}
function ball(p, r, mat) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 8), mat);
  m.position.copy(p);
  return m;
}
// Perfil retangular do ponto a ao ponto b
function beam(a, b, w, h, mat) {
  const d = b.clone().sub(a), len = d.length();
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, len, h), mat);
  m.position.copy(a).addScaledVector(d, 0.5);
  m.quaternion.setFromUnitVectors(UP, d.normalize());
  return m;
}
// Tubo de curvas suaves passando pelos pontos
function tube(pts, r, mat, radial = 8) {
  const curve = new THREE.CatmullRomCurve3(pts.map(toV), false, 'centripetal');
  return new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(8, Math.ceil(curve.getLength() / 0.012)), r, radial), mat);
}
// Tubulação de trechos retos com cantos arredondados
function polyPipe(pts, r, mat, fillet = 0.03, radial = 8) {
  const p = pts.map(toV), path = new THREE.CurvePath();
  const line = (a, b) => { if (a.distanceTo(b) > 1e-5) path.add(new THREE.LineCurve3(a, b)); };
  let cur = p[0];
  for (let i = 1; i < p.length - 1; i++) {
    const a = p[i].clone().sub(p[i - 1]), b = p[i + 1].clone().sub(p[i]);
    const d = Math.min(fillet, a.length() / 2, b.length() / 2);
    const start = p[i].clone().addScaledVector(a.normalize(), -d), end = p[i].clone().addScaledVector(b.normalize(), d);
    line(cur, start);
    path.add(new THREE.QuadraticBezierCurve3(start, p[i], end));
    cur = end;
  }
  line(cur, p[p.length - 1]);
  const len = path.getLength();
  const m = new THREE.Mesh(new THREE.TubeGeometry(path, Math.max(4, Math.ceil(len / 0.015)), r, radial), mat);
  m.userData.length = len;
  return m;
}
// Mola helicoidal do ponto a ao ponto b
function spring(a, b, coilR, wireR, turns, mat) {
  const d = b.clone().sub(a), len = d.length();
  class Helix extends THREE.Curve {
    getPoint(t, target = new THREE.Vector3()) {
      const ang = t * turns * Math.PI * 2;
      return target.set(Math.cos(ang) * coilR, t * len, Math.sin(ang) * coilR);
    }
  }
  const m = new THREE.Mesh(new THREE.TubeGeometry(new Helix(), turns * 18, wireR, 6), mat);
  m.position.copy(a);
  m.quaternion.setFromUnitVectors(UP, d.normalize());
  return m;
}
// Coifa sanfonada (junta homocinética, caixa de direção) do ponto a (raio r1) ao ponto b (raio r2)
function boot(a, b, r1, r2, mat, ribs = 4) {
  const d = b.clone().sub(a), len = d.length(), profile = [];
  for (let i = 0; i <= ribs * 6; i++) {
    const t = i / (ribs * 6);
    profile.push(new THREE.Vector2(THREE.MathUtils.lerp(r1, r2, t) * (0.84 + 0.16 * Math.abs(Math.sin(t * ribs * Math.PI))), t * len));
  }
  const m = new THREE.Mesh(new THREE.LatheGeometry(profile, 14), mat);
  m.position.copy(a);
  m.quaternion.setFromUnitVectors(UP, d.normalize());
  return m;
}
// Perfil 2D (x, y) extrudado ao longo de z
function extrude(points, depth, mat, bevel = 0.004) {
  const shape = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
  return new THREE.Mesh(new THREE.ExtrudeGeometry(shape, {
    depth, bevelEnabled: bevel > 0, bevelSize: bevel, bevelOffset: -bevel, bevelThickness: bevel, bevelSegments: 2,
  }), mat);
}
// Contorno convexo de um conjunto de pontos 2D (usado para a correia em volta das polias)
function hull(pts) {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list) => {
    const h = [];
    for (const q of list) {
      while (h.length >= 2 && cross(h[h.length - 2], h[h.length - 1], q) <= 0) h.pop();
      h.push(q);
    }
    h.pop();
    return h;
  };
  return half(p).concat(half(p.slice().reverse()));
}

// Junta as peças de um grupo em uma malha por material, para a cena custar poucas chamadas de desenho
function mergeMeshes(root) {
  root.updateWorldMatrix(true, true);
  const inverse = root.matrixWorld.clone().invert(), local = new THREE.Matrix4(), byMaterial = new Map();
  root.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry;
    if (!g.index) g.setIndex([...Array(g.attributes.position.count).keys()]);
    g.applyMatrix4(local.multiplyMatrices(inverse, o.matrixWorld));
    if (local.determinant() < 0) {   // peça espelhada: inverte o sentido dos triângulos
      const idx = g.index.array;
      for (let i = 0; i < idx.length; i += 3) [idx[i], idx[i + 2]] = [idx[i + 2], idx[i]];
    }
    if (!byMaterial.has(o.material)) byMaterial.set(o.material, []);
    byMaterial.get(o.material).push(g);
  });
  root.clear();
  for (const [material, list] of byMaterial) {
    const mesh = new THREE.Mesh(mergeGeometries(list), material);
    mesh.castShadow = mesh.receiveShadow = true;
    root.add(mesh);
  }
}

export { UP, V, S, rod, cyl, rbox, ball, beam, tube, polyPipe, spring, boot, extrude, hull, mergeMeshes };
