import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { ASSETS, DRACO, layers, state, statusEl } from './config.js';
import { renderer, scene, camera, controls } from './scene.js';
import { carRoot, prepareModel } from './layers.js';
import { buildMechanics, finishMechanics } from './mechanics.js';
import { buildSuspension } from './suspension.js';
import { buildExtras } from './extras.js';
import { praca } from './praca.js';
import { road } from './road.js';
import { addDetails } from './details.js';
import { buildCluster } from './cluster.js';
import { buildMirrors, updateMirrors, warmMirrors } from './mirrors.js';
import { sim, ride, updateDrive, boardCamera, leaveCamera } from './drive.js';
import { updateLamps } from './lamps.js';
import { applyBodyMode, updateSpots, say } from './ui.js';

// ---------- Modelo ----------
const shadowTexture = new THREE.TextureLoader().load(ASSETS + 'ferrari_ao.png');
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath(DRACO);
const loader = new GLTFLoader();
loader.setDRACOLoader(dracoLoader);

loader.load(
  ASSETS + 'ferrari.glb',
  (gltf) => {
    const discs = prepareModel(gltf.scene.children[0]);
    buildMechanics();
    buildSuspension(discs);
    buildExtras();
    finishMechanics();
    addDetails();
    buildCluster();
    buildMirrors();
    warmMirrors();

    // Sombra de contato sob o carro
    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(0.655 * 4, 1.3 * 4),
      new THREE.MeshBasicMaterial({
        map: shadowTexture, blending: THREE.MultiplyBlending, toneMapped: false, transparent: true
      })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.002;
    shadow.renderOrder = 2;
    carRoot.add(shadow);

    applyBodyMode();
    // o véu da carga se desfaz e a interface entra
    statusEl.classList.add('done');
    document.body.classList.remove('loading');
    say('Arraste para girar · role para aproximar', 0);
    if (location.search.includes('debug')) window.viewer = { THREE, scene, camera, controls, renderer, carRoot, layers, state, applyBodyMode, frame, sim, ride, get praca() { return praca; }, get road() { return road; } };
  },
  (e) => {
    if (!e.total) return;
    statusEl.firstElementChild.textContent = Math.round(e.loaded / e.total * 100);
    statusEl.style.setProperty('--p', e.loaded / e.total);
  },
  (err) => {
    console.error(err);
    statusEl.textContent = 'Não foi possível carregar o modelo. Verifique a conexão e recarregue a página.';
  }
);

const clock = new THREE.Clock();
function frame() {
  if (!renderer.domElement.width || !renderer.domElement.height) return;
  controls.update();
  const dt = clock.getDelta();
  updateDrive(dt);
  updateLamps(dt, camera);
  if (state.env.scenery === 'road') {
    scene.fog.near = 60;
    scene.fog.far = 260;
  } else if (state.env.scenery === 'praca') {
    // ao ar livre a bruma só encobre o horizonte
    scene.fog.near = 30;
    scene.fog.far = 135;
    // uma árvore some enquanto a câmera está dentro da copa ou colada ao tronco; a sombra é sempre refeita com todas
    for (const tree of praca.trees) {
      const p = camera.position, u = tree.userData;
      const inside = (p.y > u.low && p.y < u.top && Math.hypot(p.x - u.world.x, p.z - u.world.z) < u.spread)
        || Math.hypot(p.x - tree.position.x, p.z - tree.position.z) < 0.7;
      tree.visible = renderer.shadowMap.needsUpdate || !inside;
    }
  } else {
    // no estúdio a névoa começa logo depois do carro, qualquer que seja a distância da câmera
    scene.fog.near = Math.max(6, camera.position.distanceTo(controls.target));
    scene.fog.far = scene.fog.near + 12;
  }
  const aboard = state.view === 'interior' && boardCamera(camera);
  updateMirrors(camera);
  renderer.render(scene, camera);
  if (aboard) leaveCamera(camera);
  updateSpots();
}
renderer.setAnimationLoop(frame);
