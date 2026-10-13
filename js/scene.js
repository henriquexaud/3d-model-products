import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { state, hintEl } from './config.js';

// ---------- Cena ----------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
// Só a praça tem sol e sombras. Como a cena é parada, o mapa de sombras é refeito apenas quando algo muda
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false;
const shadowsDirty = () => { renderer.shadowMap.needsUpdate = true; };
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x000000, 6, 18);
const pmrem = new THREE.PMREMGenerator(renderer);
const studioEnv = pmrem.fromScene(studioEnvironment(), 0.03).texture, studioBackground = new THREE.Color();

// Estúdio fotográfico usado só para iluminação e reflexos: sala neutra com softboxes
function studioEnvironment() {
  const env = new THREE.Scene();
  const room = new THREE.Mesh(
    new THREE.BoxGeometry(24, 12, 24),
    new THREE.MeshBasicMaterial({ color: 0x3a3d42, side: THREE.BackSide })
  );
  room.position.y = 5;
  env.add(room);
  const softbox = (w, h, intensity, pos) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: new THREE.Color().setScalar(intensity), side: THREE.DoubleSide })
    );
    m.position.set(...pos);
    m.lookAt(0, 0.5, 0);
    env.add(m);
  };
  softbox(5, 12, 7, [0, 9, 0]);         // teto, ao longo do carro
  softbox(1.5, 14, 5, [-9, 3.5, 0]);    // faixas laterais
  softbox(1.5, 14, 5, [9, 3.5, 0]);
  softbox(8, 2.5, 3.5, [0, 3.5, -11]);  // frente e traseira
  softbox(8, 2.5, 3.5, [0, 3.5, 11]);
  return env;
}

const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 400);   // a proporção é acertada em resize()
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.addEventListener('start', () => {
  controls.autoRotate = false;
  hintEl.classList.add('hidden');
});
// No exterior é possível deslocar o ponto de vista, mas sem sair de cima do carro
const PAN_MIN = new THREE.Vector3(-0.8, 0.2, -1.9), PAN_MAX = new THREE.Vector3(0.8, 0.9, 1.9);
controls.addEventListener('change', () => {
  if (state.view !== 'exterior') return;
  const t = controls.target, c = t.clone().clamp(PAN_MIN, PAN_MAX);
  if (!c.equals(t)) { camera.position.add(c.clone().sub(t)); t.copy(c); }
});

export { renderer, shadowsDirty, scene, pmrem, studioEnv, studioBackground, camera, controls };
