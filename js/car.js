import { spec } from './cars/index.js';
import ferrari458 from './cars/ferrari-458/rig.js';

// ---------- O carro escolhido ----------
// A ponte entre o visualizador e um carro em particular. Cenários, condução, interface e som falam só com isto:
//   spec                      a ficha (cars/<id>/spec.js): modelo, medidas, cores, camadas, física, suspensão, câmera, som
//   build(gltf)               distribui o modelo carregado nas camadas e cria as peças que ele não traz; depois, `built`
//   pose(travel, lift, pitch, roll, steer)   suspensão, rodas e volante no lugar que a pista e o esterço pedem
//   roll(turned, arc)         rodas girando; `arc` é o giro durante um quadro, que borra os raios
//   run(sim, dt)              o que se move com o motor e os pedais (sem `sim`, desligado)
//   brake(amount), cluster(rpm, gear, kmh)   luzes de freio e painel de instrumentos
//   backfire(strength)        fogo saindo do escape, quando ele estala
//   update(dt, camera), mirrors(camera, rolling), warm(), dim(dark)   luzes e retrovisores
const RIGS = { [ferrari458.spec.id]: ferrari458 };
const car = RIGS[spec.id];

export { car };
