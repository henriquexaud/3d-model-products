import { spec } from './cars/index.js';

// Cores da carroceria: as do carro escolhido (ver a ficha dele, em cars/)
const COLORS = spec.colors;

// Três ambientes, cada um com a versão de dia e a de noite. `beam` é o quanto o facho dos faróis aparece no chão
// e `glow` o tamanho do halo em volta das lentes: sob o sol quase não se nota um farol aceso.
// `bloom` (opcional) é a partir de quanto brilho, já com a exposição, uma luz deixa clarão na imagem
const ENVS = [
  // ao ar livre: a praça, com o carro parado, e a estrada, com ele em movimento
  // `steer` é como as rodas da frente ficam com o carro parado: na praça, um pouco viradas, como quem acabou de estacionar
  { name: 'Praça', scenery: 'praca', steer: 0.12,
    day: { exposure: 0.56, ghost: 0x16202b, beam: 0.04, glow: 0.4 },
    night: { exposure: 1.0, ghost: 0xdce6ff, beam: 0.45, glow: 1 } },   // o calçadão é claro e devolve bem mais luz do que o asfalto
  { name: 'Estrada', scenery: 'road',
    day: { exposure: 0.56, ghost: 0x16202b, beam: 0.04, glow: 0.4 },
    night: { exposure: 1.15, ghost: 0xdce6ff, beam: 1, glow: 1 } },
  // estúdio de projeto, branco de dia e preto à noite: cor do piso, traço e força da malha, luz sob o carro
  // e o degradê do fundo (horizonte, parede, teto); `room` e `ground` são a cor da sala e do chão nos reflexos,
  // `fill` o quanto dessa luz difusa chega ao piso e `key` a força do refletor principal, o único que faz sombra
  { name: 'Estúdio',
    day: { exposure: 0.9, ghost: 0x1b2330, beam: 0.1, glow: 0.5, bloom: 3.4,   // o fundo branco não pode brilhar, só os reflexos mais fortes
      floor: 0xd6d8dc, line: 0x4d6382, grid: 0.6, pool: 1.04, horizon: 0xf1f2f4, wall: 0xe3e5e9, zenith: 0xc6c9cf, room: 0x3a3d42, ground: 0x8a8d92, fill: 0.4, key: 3.2 },
    night: { exposure: 0.8, ghost: 0xdce6ff, beam: 6, glow: 1,
      floor: 0x0a0b0d, line: 0x7f9fd0, grid: 0.09, pool: 2.2, horizon: 0x111318, wall: 0x090a0c, zenith: 0x020203, room: 0x24262a, ground: 0x0a0b0d, fill: 1, key: 2.2 } },
];

// Celulares e tablets recebem uma cena mais leve: vidro simples, menos folhas e grama, sombras menores.
// `?lite` e `?full` no endereço forçam uma versão ou a outra, para conferir as duas no mesmo aparelho
const ASKED = new URLSearchParams(location.search);
const LITE = ASKED.has('lite') || (!ASKED.has('full') && window.matchMedia('(pointer: coarse)').matches);
// Tempo de exposição de cada quadro, em segundos, como o de uma câmera: é ele que dá o rastro do asfalto e o borrão das rodas
const SHUTTER = 1 / 60;

// Camadas do carro, como a ficha dele as descreve; cada uma ganha aqui o seu grupo na cena e o seu botão (ver layers.js e ui.js).
// `measures` guarda as medidas que só se conhecem depois de montadas as peças, do carro e dos cenários
const measures = {};
const mm = (v) => Math.round(v * 1000).toLocaleString('pt-BR');
const meters = (v) => v.toFixed(1).replace('.', ',');
const LAYERS = spec.layers.map((L) => ({ ...L }));
const layers = Object.fromEntries(LAYERS.map((L) => [L.id, L]));

// O carro abre com os pontos de informação e os faróis desligados
const state = {
  view: 'exterior', body: 'solid', spots: false, lights: false, night: false, color: COLORS[0], env: ENVS[0], open: null, fit: spec.view.fit,
  on: Object.fromEntries(LAYERS.filter((L) => L.id !== 'body').map((L) => [L.id, true])),
};
// Ajustes do ambiente atual na hora do dia escolhida
const look = () => state.env[state.night ? 'night' : 'day'];

const $ = (id) => document.getElementById(id);
const statusEl = $('status');
const hintEl = $('hint'), hintText = hintEl.firstElementChild;

export {
  COLORS, ENVS, ASKED, LITE, SHUTTER, measures, mm, meters, LAYERS, layers,
  state, look, $, statusEl, hintEl, hintText,
};
