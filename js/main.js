import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { ASSETS, DRACO, ENVS, layers, state, statusEl } from './config.js';
import { renderer, scene, camera, controls, studioEnv } from './scene.js';
import { carRoot, prepareModel } from './layers.js';
import { buildMechanics, finishMechanics } from './mechanics.js';
import { buildSuspension } from './suspension.js';
import { buildExtras } from './extras.js';
import { praca, blow } from './praca.js';
import { road, ensureRoad } from './road.js';
import { studio } from './studio.js';
import { nightSky } from './night.js';
import { addDetails } from './details.js';
import { buildCluster } from './cluster.js';
import { buildMirrors, updateMirrors, warmMirrors } from './mirrors.js';
import { sim, ride, helm, updateDrive, boardCamera, leaveCamera } from './drive.js';
import { updateLamps } from './lamps.js';
import { applyBodyMode, updateSpots, say, curtain } from './ui.js';
import { render, prepare, strip, warmPost } from './post.js';
import { invalidate, consume, measure, governResolution, settle, gauge, schedule, later } from './pace.js';
import { plan, tickPlan, wave } from './blueprint.js';

// ---------- Modelo ----------
const shadowTexture = new THREE.TextureLoader().load(ASSETS + 'ferrari_ao.png');
const dracoLoader = new DRACOLoader();
dracoLoader.setDecoderPath(DRACO);
const loader = new GLTFLoader();
loader.setDRACOLoader(dracoLoader);
const outdoor = () => (state.env.scenery === 'praca' ? praca : state.env.scenery === 'road' ? road : null);

loader.load(
  ASSETS + 'ferrari.glb',
  async (gltf) => {
    const discs = prepareModel(gltf.scene.children[0]);
    buildMechanics();
    buildSuspension(discs);
    buildExtras();
    finishMechanics();
    addDetails();
    buildCluster();
    buildMirrors();

    // Sombra de contato sob o carro
    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(0.655 * 4, 1.3 * 4),
      new THREE.MeshBasicMaterial({
        map: shadowTexture, blending: THREE.MultiplyBlending, toneMapped: false, transparent: true, fog: false
      })
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.002;
    shadow.renderOrder = 2;
    carRoot.add(shadow);
    applyBodyMode();

    // Ainda atrás do véu, os programas de desenho do carro, do cenário e do acabamento são compilados em paralelo,
    // e o primeiro quadro já sai sem tropeço
    await Promise.all([prepare(outdoor()?.group ?? studio, [carRoot]), warmPost()]);
    warmMirrors();

    // o véu da carga se desfaz, a interface entra e o cenário se desdobra em volta do carro
    statusEl.classList.add('done');
    document.body.classList.remove('loading');
    say('Arraste para girar · role para aproximar', 0);
    curtain();
    invalidate();
    if (location.search.includes('debug')) window.viewer = { THREE, scene, camera, controls, renderer, carRoot, layers, state, applyBodyMode, frame, invalidate, sim, ride, helm, gauge, plan, wave, get praca() { return praca; }, get road() { return road; } };

    // Nas sobras de tempo fica pronto o que falta, para a troca de ambiente ser imediata: a estrada, o céu da noite e o
    // estúdio, com os programas do carro sob a luz de cada um
    schedule((function* () {
      yield* waitFor(() => !wave.active && plan.uWave.value.x > 1e4);
      yield strip(studio, [carRoot]);
      studioEnv(ENVS.find((e) => !e.scenery).day);
      yield;
      studioEnv(ENVS.find((e) => !e.scenery).night);
      yield;
      nightSky();
      yield;
      ensureRoad();
    })());
  },
  (e) => {
    if (!e.total) return;
    const done = Math.min(1, e.loaded / e.total);   // servido comprimido, o arquivo chega maior do que o tamanho anunciado
    statusEl.firstElementChild.textContent = Math.round(done * 100);
    statusEl.style.setProperty('--p', done);
  },
  (err) => {
    console.error(err);
    statusEl.textContent = 'Não foi possível carregar o modelo. Verifique a conexão e recarregue a página.';
  }
);
// Dentro de um trabalho em pedaços, espera até `ready()` valer
function* waitFor(ready) {
  while (!ready()) yield later(250);
}

// Cada volta do laço atualiza o que se move, mas só desenha quando algo mudou (ver pace.js). A medição da fluidez começa
// depois que o primeiro cenário terminou de aparecer
const clock = new THREE.Clock();
governResolution((ratio) => renderer.setPixelRatio(ratio));
function frame() {
  if (!renderer.domElement.width || !renderer.domElement.height) return;
  const dt = clock.getDelta();
  if (controls.update()) invalidate(1);
  updateDrive(dt);
  updateLamps(dt, camera);
  const waving = wave.active;
  tickPlan(dt);
  if (waving) outdoor()?.onWave?.();   // inclusive no quadro em que a onda termina, para tudo ficar no ponto final
  if (renderer.shadowMap.needsUpdate) invalidate(1);
  if (state.env.scenery === 'praca' && praca.built) blow(dt);   // o vento nas árvores da praça
  if (!gauge.ready && statusEl.classList.contains('done') && !wave.active && plan.uWave.value.x > 1e4) settle(true);
  const drew = consume();
  measure(drew);
  if (!drew) return;
  if (state.env.scenery === 'road') {
    scene.fog.near = 60;
    scene.fog.far = 260;
  } else if (state.env.scenery === 'praca') {
    // ao ar livre a bruma só encobre o horizonte
    scene.fog.near = 30;
    scene.fog.far = 170;
    // uma árvore some enquanto a câmera está dentro da copa ou colada ao tronco; a sombra é sempre refeita com todas
    if (praca.built) for (const tree of praca.trees) {
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
  render();
  if (aboard) leaveCamera(camera);
  updateSpots();
}
renderer.setAnimationLoop(frame);
