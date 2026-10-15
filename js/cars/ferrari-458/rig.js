import { PIVOT } from '../../ride.js';
import { discSpin } from '../../materials.js';
import { prepareModel } from './model.js';
import { buildMechanics, finishMechanics } from './mechanics.js';
import { buildSuspension, poseSuspension, steerMount } from './suspension.js';
import { buildExtras, poseExtras, turnWheel } from './extras.js';
import { wheels, tyres, spinBlur, addDetails } from './details.js';
import { buildCluster, showCluster } from './cluster.js';
import { buildMirrors, updateMirrors, warmMirrors } from './mirrors.js';
import { setBrake, dimLamps, updateLamps } from './lamps.js';
import { buildFlames, backfire, updateFlames, setWind } from './flames.js';
import spec from './spec.js';

// ---------- Montagem da Ferrari 458 ----------
// As peças feitas sob medida para este modelo (suspensão, motor, rodas, painel, espelhos, faróis) e como elas respondem
// ao que a condução pede. É a única parte do visualizador que conhece estas peças: o resto fala com o carro por car.js

const STILL = [0, 0, 0, 0];

export default {
  spec,

  // Distribui o modelo nas camadas e cria as peças que ele não traz
  build(gltf) {
    const discs = prepareModel(gltf.scene.children[0]);
    buildMechanics();
    buildSuspension(discs);
    buildExtras();
    finishMechanics();
    addDetails();
    buildCluster();
    buildMirrors();
    buildFlames();
  },
  get built() { return wheels.length > 0; },

  // Suspensão, rodas, discos e volante no lugar que o curso de cada roda (m) e o esterço das rodas da frente (rad) pedem,
  // com a carroceria `lift` metros acima do repouso e inclinada de `pitch` e `roll`.
  // A roda acompanha o canto da carroceria mais o curso da suspensão; o disco, que está na carroceria, só o curso
  pose(travel = STILL, lift = 0, pitch = 0, roll = 0, steer = 0) {
    poseSuspension(travel, steer);
    wheels.forEach((w, i) => {
      steerMount(i, w.mount, w.centre, lift - (w.centre.z - PIVOT[2]) * pitch + w.centre.x * roll + travel[i]);
      steerMount(i, w.discMount, w.centre, travel[i]);
    });
    turnWheel(steer * spec.physics.steering);
  },

  // Rodas e discos girados de `turned` radianos (sem ele, ficam onde pararam); `arc` é o quanto giram durante a exposição
  // de um quadro, e é isso que borra os raios, as letras dos pneus e os furos dos discos
  roll(turned, arc) {
    if (turned !== null) for (const w of wheels) w.pivot.rotation.x = w.discPivot.rotation.x = -(turned % (2 * Math.PI));
    spinBlur(arc);
    for (const rubber of Object.values(tyres)) rubber.bumpScale = rubber.userData.relief * (1 - Math.min(1, arc / 0.2));
    discSpin.value = Math.min(1, arc / 0.17);   // os furos se repetem a cada 10°
  },

  // O que depende do motor e dos pedais, as luzes de freio e o painel de instrumentos. Sem `sim`, o carro está desligado
  run(sim, dt) {
    poseExtras(sim, dt);
    setWind(sim ? sim.v : 0);   // o vento da velocidade deita o fogo do escape para trás
  },
  brake(amount) { setBrake(amount); },
  // um estalo do escape, de força `strength` (0 a 1): sai fogo das ponteiras
  backfire(strength) { backfire(strength); },
  cluster(rpm, gear, kmh) { showCluster(rpm, gear, kmh); },

  // A cada volta do laço: faróis, lanternas e o fogo do escape; antes de desenhar, os reflexos dos retrovisores
  update(dt, camera) {
    updateLamps(dt, camera);
    updateFlames(dt);
  },
  mirrors(camera, rolling) { updateMirrors(camera, rolling); },
  warm() { warmMirrors(); },
  // apaga os fachos enquanto um cenário é fotografado para os reflexos
  dim(dark) { dimLamps(dark); },
};
