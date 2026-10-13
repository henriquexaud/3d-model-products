import * as THREE from 'three';
import { toLayer } from './layers.js';
import { paint, textureOf } from './praca-textures.js';

// ---------- Painel de instrumentos ----------
// O modelo traz o conta-giros e as duas telas como superfícies lisas. Aqui eles ganham mostrador, ponteiro e números,
// que acompanham o carro na estrada. Posições medidas no modelo, em metros
const TILT = THREE.MathUtils.degToRad(9.9);                    // o painel é inclinado para o motorista
const FACE = { x: -0.3457, y: 0.8209, z: -0.6825, r: 0.0522 };  // disco do conta-giros
const HUB = 0.0043;                                             // o eixo do ponteiro fica um pouco acima do centro do disco
const GEAR = { x: 0.0248, y: -0.0224 };                         // janela da marcha, em relação ao centro do disco
const SCREENS = { left: { x: -0.4772, y: 0.7905, z: -0.6681 }, right: { x: -0.2181, y: 0.7905, z: -0.6681 } };
const SWEEP = { from: 225, per1000: 22.5 };                     // 0 rpm embaixo à esquerda; cada 1.000 rpm gira 22,5° no sentido horário
const cluster = { needle: null, gear: null, speed: null };

// Coloca uma peça plana sobre o painel: (x, y, z) é um ponto da superfície e `lift` o quanto ela fica à frente
function mount(mesh, x, y, z, lift) {
  mesh.position.set(x, y + Math.sin(TILT) * lift, z + Math.cos(TILT) * lift);
  mesh.rotation.x = -TILT;
  mesh.updateMatrixWorld(true);
  toLayer(mesh, 'interior');
  mesh.castShadow = false;
  return mesh;
}

function buildCluster() {
  // conta-giros: fundo escuro, traços e números claros, zona vermelha a partir de 9.000 rpm
  const S = 512, mm = S / (2 * FACE.r * 1000), cx = S / 2, cy = S / 2 - HUB * 1000 * mm;
  const at = (deg, r) => [cx + Math.cos(deg * Math.PI / 180) * r * mm, cy - Math.sin(deg * Math.PI / 180) * r * mm];
  const dial = paint(S, S, (g) => {
    g.fillStyle = 'rgb(15,15,17)';
    g.fillRect(0, 0, S, S);
    g.lineCap = 'butt';
    for (let i = 0; i <= 20; i++) {
      const deg = SWEEP.from - i * SWEEP.per1000 / 2, major = i % 2 === 0;
      g.strokeStyle = i >= 18 ? 'rgb(214,40,32)' : 'rgb(232,232,228)';
      g.lineWidth = (major ? 1.1 : 0.6) * mm;
      g.beginPath();
      g.moveTo(...at(deg, major ? 40.5 : 42.5));
      g.lineTo(...at(deg, 45.5));
      g.stroke();
    }
    g.strokeStyle = 'rgb(214,40,32)';
    g.lineWidth = 1.1 * mm;
    g.beginPath();
    g.arc(cx, cy, 45 * mm, -(SWEEP.from - 9 * SWEEP.per1000) * Math.PI / 180, -(SWEEP.from - 10 * SWEEP.per1000) * Math.PI / 180);
    g.stroke();
    g.fillStyle = 'rgb(232,232,228)';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `600 ${7.4 * mm}px Arial, sans-serif`;
    for (let i = 0; i <= 10; i++) g.fillText(String(i), ...at(SWEEP.from - i * SWEEP.per1000, 33.5));
    g.fillStyle = 'rgb(150,150,150)';
    g.font = `${3.2 * mm}px Arial, sans-serif`;
    g.fillText('rpm × 1000', cx, cy - 15 * mm);
  });
  const face = paint(S, S, () => {}), faceMap = textureOf(face, true, THREE.ClampToEdgeWrapping);
  mount(new THREE.Mesh(new THREE.CircleGeometry(FACE.r, 64),
    new THREE.MeshStandardMaterial({ map: faceMap, emissiveMap: faceMap, emissive: 0xffffff, emissiveIntensity: 0.5, roughness: 0.55 })),
  FACE.x, FACE.y, FACE.z, 0.0006);
  // a marcha engatada aparece na janela do canto do mostrador
  cluster.gear = (label) => {
    const g = face.getContext('2d');
    g.drawImage(dial, 0, 0);
    g.fillStyle = 'rgb(5,5,6)';
    g.fillRect(S / 2 + (GEAR.x - 0.017) * 1000 * mm, S / 2 - (GEAR.y + 0.015) * 1000 * mm, 34 * mm, 30 * mm);
    g.fillStyle = 'rgb(240,240,236)';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = `600 ${19 * mm}px Arial, sans-serif`;
    g.fillText(label, S / 2 + GEAR.x * 1000 * mm, S / 2 - GEAR.y * 1000 * mm + mm);
    faceMap.needsUpdate = true;
  };

  // ponteiro: gira em torno do eixo, à frente do mostrador
  const pointer = new THREE.Mesh(new THREE.BoxGeometry(0.0021, 0.047, 0.0008).translate(0, 0.0165, 0),
    new THREE.MeshBasicMaterial({ color: 0xe23a24, toneMapped: false }));
  mount(pointer, FACE.x, FACE.y + HUB * Math.cos(TILT), FACE.z - HUB * Math.sin(TILT), 0.0042);
  pointer.rotation.order = 'XYZ';
  cluster.needle = (rpm) => { pointer.rotation.z = THREE.MathUtils.degToRad(SWEEP.from - rpm / 1000 * SWEEP.per1000 - 90); };

  // telas: à esquerda as temperaturas, à direita a velocidade
  const screen = (place, draw) => {
    const canvas = paint(256, 180, draw), map = textureOf(canvas, true, THREE.ClampToEdgeWrapping);
    mount(new THREE.Mesh(new THREE.PlaneGeometry(0.094, 0.066), new THREE.MeshBasicMaterial({ map, toneMapped: false })), place.x, place.y, place.z, 0.0008);
    return { canvas, map };
  };
  const blank = (g) => { g.fillStyle = 'rgb(6,7,9)'; g.fillRect(0, 0, 256, 180); };
  screen(SCREENS.left, (g) => {
    blank(g);
    g.textBaseline = 'middle';
    [['ÁGUA', '90 °C', 0.52, 58], ['ÓLEO', '105 °C', 0.61, 122]].forEach(([name, value, level, y]) => {
      g.fillStyle = 'rgb(150,154,160)';
      g.font = '15px Arial, sans-serif';
      g.textAlign = 'left';
      g.fillText(name, 26, y - 16);
      g.textAlign = 'right';
      g.fillStyle = 'rgb(228,230,232)';
      g.fillText(value, 230, y - 16);
      g.fillStyle = 'rgb(48,51,56)';
      g.fillRect(26, y, 204, 7);
      g.fillStyle = 'rgb(214,218,222)';
      g.fillRect(26, y, 204 * level, 7);
    });
  });
  const speed = screen(SCREENS.right, blank);
  cluster.speed = (kmh) => {
    const g = speed.canvas.getContext('2d');
    blank(g);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillStyle = 'rgb(236,238,240)';
    g.font = '600 92px Arial, sans-serif';
    g.fillText(String(kmh), 128, 82);
    g.fillStyle = 'rgb(150,154,160)';
    g.font = '19px Arial, sans-serif';
    g.fillText('km/h', 128, 146);
    speed.map.needsUpdate = true;
  };
  showCluster(0, 'N', 0);
}

// Atualiza ponteiro, marcha e velocidade; as telas só são redesenhadas quando o valor muda
const shown = {};
function showCluster(rpm, gear, kmh) {
  if (!cluster.needle) return;
  cluster.needle(rpm);
  if (shown.gear !== gear) cluster.gear(shown.gear = gear);
  if (shown.kmh !== kmh) cluster.speed(shown.kmh = kmh);
}

export { buildCluster, showCluster };
