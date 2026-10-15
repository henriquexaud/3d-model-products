import * as THREE from 'three';
import { COLORS, ENVS, LITE, measures, LAYERS, state, look, $, hintEl, hintText } from './config.js';
import { spec } from './cars/index.js';
import { renderer, shadowsDirty, setExposure, camera, controls } from './scene.js';
import { studio, applyStudio } from './studio.js';
import { bodyMaterial, paintFlake, highlight, ghost, tintGhost } from './materials.js';
import { bodyMeshes } from './layers.js';
import { praca, ensurePraca } from './praca.js';
import { road, ensureRoad } from './road.js';
import { showHeavens } from './night.js';
import { CAR, GRAVITY } from './physics.js';
import { RIDE, SPRUNG, CORNERS } from './ride.js';
import { setDriving } from './drive.js';
import { engineSound } from './sound.js';
import { hold, unfold } from './blueprint.js';

// ---------- Interface ----------
const press = (el, on) => el.setAttribute('aria-pressed', String(on));

// Legenda acima da barra. Os botões são só ícones: ela diz o que cada um faz quando o mouse passa por ele
// e o que mudou depois de um toque. Com `hold` zero, fica até ser trocada ou escondida
let fading = 0;
function say(text, hold = 1600) {
  hintText.textContent = text;
  hintEl.classList.remove('hidden');
  clearTimeout(fading);
  if (hold) fading = setTimeout(() => hintEl.classList.add('hidden'), hold);
}
document.addEventListener('pointerover', (e) => {
  const el = e.pointerType === 'mouse' && e.target.closest?.('[data-tip]');
  if (el) say(el.dataset.tip, 0);
});
document.addEventListener('pointerout', (e) => {
  if (e.pointerType === 'mouse' && e.target.closest?.('[data-tip]')) hintEl.classList.add('hidden');
});

// Seletor de uma opção entre várias: um botão por nome e uma marca que desliza até o escolhido.
// Devolve a função que marca a opção `i`
function segmented(el, names, pick) {
  el.style.setProperty('--n', names.length);
  names.forEach((name, i) => {
    const b = document.createElement('button');
    b.textContent = name;
    b.addEventListener('click', () => pick(i));
    el.appendChild(b);
  });
  return (i) => {
    el.style.setProperty('--i', i);
    [...el.children].forEach((b, j) => press(b, i === j));
  };
}

// Cores
COLORS.forEach((c, i) => {
  const b = document.createElement('button');
  b.style.setProperty('--c', '#' + c.hex.toString(16).padStart(6, '0'));
  b.dataset.tip = c.name;
  b.setAttribute('aria-label', c.name);
  b.addEventListener('click', () => { setColor(i); say(c.name); });
  $('colors').appendChild(b);
});
function setColor(i) {
  state.color = COLORS[i];
  bodyMaterial.color.setHex(state.color.hex);
  bodyMaterial.metalness = state.color.metal;
  bodyMaterial.roughness = state.color.rough;
  paintFlake.value = state.color.flake;
  [...$('colors').children].forEach((b, j) => press(b, i === j));
}

// Ambiente: a praça, a estrada ou o estúdio de projeto, cada um de dia ou de noite
function applyEnv() {
  const e = state.env, tune = look();
  setExposure(tune.exposure);   // antes de tudo: as cores fixas do cenário são acertadas para esta exposição
  // um cenário novo é montado com os outros escondidos, para não aparecerem nos reflexos dele
  if (praca) praca.group.visible = false;
  if (road) road.group.visible = false;
  const set = e.scenery === 'praca' ? ensurePraca(true) : e.scenery === 'road' ? ensureRoad(true) : null;
  studio.visible = !set;
  if (set) {
    set.group.visible = true;
    set.dress(state.night);
  } else {
    showHeavens(false);
    applyStudio(tune);
  }
  enter(set);
  tintGhost(tune.ghost);
  if (state.view === 'exterior') controls.maxDistance = Math.max(set ? 16 : 9, state.fit * 1.3);
  setDriving(e.scenery === 'road');
  shadowsDirty();
  // a interface acompanha a hora do dia
  document.documentElement.dataset.theme = state.night ? 'dark' : 'light';
  markEnv(ENVS.indexOf(e));
  press($('btnNight'), state.night);
}
// Um cenário ao ar livre aparece na hora como prancheta, com o piso e o céu, e se desdobra a partir do carro assim que está
// montado (ver blueprint.js). Trocar o dia pela noite não repete a entrada. A primeira de todas espera o véu da carga sair
let curtain = null, shown = null;
const lifted = new Promise((resolve) => { curtain = resolve; });
function enter(set) {
  if (set === shown) return;
  shown = set;
  if (!set) return;
  hold();
  Promise.all([set.ready, lifted]).then(() => {
    if (shown !== set) return;
    set.dress(state.night);   // agora com os reflexos do cenário pronto
    unfold(set === road ? 2.8 : 2.4, set !== road);   // na estrada, o que se desdobra fica longe da sombra do carro
  });
}

const markEnv = segmented($('scenes'), ENVS.map((e) => e.name), (i) => {
  state.env = ENVS[i];
  applyEnv();
  if (ENVS[i].scenery === 'road' && !LITE) say('↑ ↓ velocidade · ← → trocar de faixa', 3600);
});
$('btnNight').addEventListener('click', () => {
  state.night = !state.night;
  applyEnv();
  say(state.night ? 'Noite' : 'Dia');
});

const layerVisible = (L) => (L.id === 'body' ? state.body !== 'hidden' : state.on[L.id]);

// Vistas
function setView(view) {
  state.view = view;
  if (view === 'interior') {
    // Câmera na posição do motorista; arrastar olha em volta
    controls.target.set(...spec.view.seat.target);
    camera.position.set(...spec.view.seat.eye);
    camera.fov = 70;
    controls.minDistance = controls.maxDistance = 0.05;
    controls.maxPolarAngle = Math.PI * 0.75;
    controls.minPolarAngle = Math.PI * 0.25;
    controls.rotateSpeed = -0.4;
    controls.enablePan = controls.enableZoom = false;
    controls.autoRotate = false;
    closeCard();
  } else {
    // em telas estreitas a câmera abre o ângulo e se afasta até o carro caber na largura
    const portrait = camera.aspect < 1;
    camera.fov = portrait ? 50 : 40;
    const halfWidth = Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect);
    const distance = Math.max(spec.view.fit, spec.view.halfLength / Math.tan(halfWidth));
    controls.target.set(...spec.view.target);
    camera.position.set(...spec.view.from).setLength(distance).add(controls.target);
    state.fit = distance;
    controls.maxDistance = Math.max(state.env.scenery ? 16 : 9, distance * 1.3);   // ao ar livre dá para recuar e ver o cenário
    controls.minPolarAngle = 0;
    controls.maxPolarAngle = THREE.MathUtils.degToRad(88);
    controls.rotateSpeed = 1;
    controls.enablePan = controls.enableZoom = true;
  }
  applyBodyMode();
  camera.updateProjectionMatrix();
  controls.update();
  press($('btnView'), view === 'interior');
}
$('btnView').addEventListener('click', () => {
  setView(state.view === 'interior' ? 'exterior' : 'interior');
  say(state.view === 'interior' ? 'Interior · arraste para olhar em volta' : 'Exterior', 2400);
});

// Carroceria sólida, em raio-X ou oculta
const BODY = ['solid', 'xray', 'hidden'];
function applyBodyMode() {
  for (const o of bodyMeshes) {
    // em raio-X ficam só os painéis externos; forros e assoalho esconderiam as peças
    o.visible = state.body === 'solid' || (state.body === 'xray' && !o.userData.inner);
    o.material = state.body === 'xray' ? ghost : o.userData.solid;
    o.castShadow = state.body === 'solid' && o.name !== 'glass';
  }
  shadowsDirty();
  // sem a carroceria no caminho, a câmera pode chegar mais perto das peças
  if (state.view === 'exterior') controls.minDistance = state.body === 'solid' ? spec.view.near.solid : spec.view.near.open;
  markBody(BODY.indexOf(state.body));
  if (state.open && !spotAllowed(state.open)) closeCard();
}
const markBody = segmented($('bodyMode'), ['Sólida', 'Raio-X', 'Oculta'], (i) => { state.body = BODY[i]; applyBodyMode(); });

// Demais camadas: um botão e um ponto de informação para cada uma
for (const L of LAYERS) {
  if (L.chip) {
    const b = document.createElement('button');
    b.textContent = L.chip;
    b.title = L.name;
    press(b, true);
    b.addEventListener('click', () => {
      state.on[L.id] = !state.on[L.id];
      L.group.visible = state.on[L.id];
      shadowsDirty();
      press(b, state.on[L.id]);
      if (state.open === L && !state.on[L.id]) closeCard();
    });
    b.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') highlight(L.id, true); });
    b.addEventListener('pointerleave', () => { if (state.open !== L) highlight(L.id, false); });
    $('layers').appendChild(b);
  }
  if (L.spot) {
    L.spotEl = document.createElement('button');
    L.spotEl.className = 'spot';
    L.spotEl.hidden = true;
    L.spotEl.title = L.name;
    L.spotEl.setAttribute('aria-label', `Medidas: ${L.name}`);
    press(L.spotEl, false);
    L.spotEl.addEventListener('click', () => (state.open === L ? closeCard() : openCard(L)));
    $('spots').appendChild(L.spotEl);
  }
}
// As camadas abrem em um quadro acima da barra, que se fecha quando o carro volta a ser tocado
const pop = $('layersPop');
function showLayers(on) {
  pop.hidden = !on;
  $('btnLayers').setAttribute('aria-expanded', String(on));
}
$('btnLayers').addEventListener('click', () => showLayers(pop.hidden));
renderer.domElement.addEventListener('pointerdown', () => showLayers(false));

function fillSpecs(dl, specs) {
  dl.replaceChildren();
  for (const [key, value] of specs) {
    const dt = document.createElement('dt'), dd = document.createElement('dd');
    dt.textContent = key;
    dd.textContent = typeof value === 'function' ? value(measures) : value;
    dl.append(dt, dd);
  }
}
const card = $('card');
function openCard(L) {
  closeCard();
  state.open = L;
  card.querySelector('h3').textContent = L.name;
  card.querySelector('.text').textContent = L.text;
  fillSpecs(card.querySelector('dl'), L.specs);
  card.hidden = false;
  press(L.spotEl, true);
  highlight(L.id, true);
}
function closeCard() {
  if (!state.open) return;
  press(state.open.spotEl, false);
  highlight(state.open.id, false);
  state.open = null;
  card.hidden = true;
}
card.querySelector('.close').addEventListener('click', closeCard);

// Os pontos acompanham o modelo; por fora só aparecem os das camadas visíveis com a carroceria sólida
const spotAllowed = (L) =>
  state.spots && state.view === 'exterior' && layerVisible(L) && (L.exterior || state.body !== 'solid');
const anchor = new THREE.Vector3(), toCamera = new THREE.Vector3(), X0 = spec.frame.x0;
const SPOTS = LAYERS.filter((L) => L.spot);
function updateSpots() {
  const w = window.innerWidth, h = window.innerHeight;
  for (const L of SPOTS) {
    L.shown = spotAllowed(L);
    if (!L.shown) continue;
    L.dist = Infinity;
    for (const p of L.spot) {
      const d = camera.position.distanceToSquared(toCamera.set(p[0] + X0, p[1], p[2]));
      if (d < L.dist) { L.dist = d; anchor.copy(toCamera); }
    }
    // com a carroceria sólida, o ponto some quando a superfície onde ele está fica de costas para a câmera
    if (state.body === 'solid' && L.normal) {
      toCamera.subVectors(camera.position, anchor);
      L.shown = toCamera.x * L.normal[0] * Math.sign(anchor.x || 1) + toCamera.y * L.normal[1] + toCamera.z * L.normal[2] > 0;
    }
    anchor.project(camera);
    L.shown &&= anchor.z < 1 && Math.abs(anchor.x) < 1 && Math.abs(anchor.y) < 1;
    L.sx = (anchor.x * 0.5 + 0.5) * w;
    L.sy = (-anchor.y * 0.5 + 0.5) * h;
  }
  // quando dois pontos se sobrepõem na tela, fica o aberto ou o mais próximo da câmera
  const placed = [];
  for (const L of SPOTS.filter((L) => L.shown).sort((a, b) => (b === state.open) - (a === state.open) || a.dist - b.dist)) {
    if (placed.some((P) => Math.hypot(P.sx - L.sx, P.sy - L.sy) < 30)) L.shown = false; else placed.push(L);
  }
  for (const L of SPOTS) {
    L.spotEl.hidden = !L.shown;
    if (L.shown) L.spotEl.style.transform = `translate(${L.sx}px, ${L.sy}px)`;
  }
}

// Faróis e pontos de informação: os dois começam desligados. As lentes, os halos e os fachos seguem `state.lights` (ver lamps.js)
$('btnLights').addEventListener('click', () => {
  state.lights = !state.lights;
  press($('btnLights'), state.lights);
  say(state.lights ? 'Faróis ligados' : 'Faróis desligados');
});
$('btnSpots').addEventListener('click', () => {
  state.spots = !state.spots;
  press($('btnSpots'), state.spots);
  if (!state.spots) closeCard();
  say(state.spots ? 'Toque em + para ver as medidas' : 'Pontos de informação ocultos', 2400);
});

// Ficha técnica: a configuração atual e, recolhidas, as medidas de cada camada e do cenário
const sheet = $('sheet');
function openSheet() {
  const body = $('sheetBody');
  body.replaceChildren();
  const add = (parent, tag, text) => { const el = document.createElement(tag); if (text) el.textContent = text; parent.appendChild(el); return el; };
  const specs = (parent, rows) => { const dl = add(parent, 'dl'); dl.className = 'specs'; fillSpecs(dl, rows); };
  const fold = (name, rows) => { const d = add(body, 'details'); add(d, 'summary', name); specs(d, rows); };
  add(body, 'h4', 'Sua configuração');
  specs(body, [
    ['Cor', state.color.name],
    ['Ambiente', `${state.env.name}, ${state.night ? 'noite' : 'dia'}`],
    ['Faróis', state.lights ? 'Ligados' : 'Desligados'],
    ['Carroceria', { solid: 'Sólida', xray: 'Raio-X', hidden: 'Oculta' }[state.body]],
  ]);
  add(body, 'h4', 'Carro');
  for (const L of LAYERS) if (L.specs) fold(L.name, L.specs);
  if (state.env.scenery === 'praca') {
    add(body, 'h4', 'Cenário');
    fold('Praça', [['Banco', measures.bench], ['Assento', '44 cm do chão'], ['Árvore', measures.tree], ['Tronco', 'Ø 40 cm'],
      ['Poste de luz', measures.lamp], ['Blocos do piso', '20 × 10 cm']]);
  }
  if (state.env.scenery === 'road') {
    add(body, 'h4', 'Cenário');
    fold('Estrada', [['Faixas', '2 × 3,60 m'], ['Acostamentos', '2,50 m e 0,60 m'], ['Linha tracejada', 'traço de 4 m a cada 16 m'],
      ['Largura das linhas', '15 cm'], ['Defensa metálica', '75 cm de altura, postes a cada 4 m']]);
    const n = (v) => v.toLocaleString('pt-BR');
    const pressed = 0.5 * CAR.airDensity * CAR.downforceArea * (200 / 3.6) ** 2 / GRAVITY;   // kg que o ar põe sobre o carro a 200 km/h
    fold('Como o movimento é calculado', [['Massa com motorista', `${CAR.mass.toLocaleString('pt-BR')} kg`], ['Arrasto do ar (Cx × área)', `${n(CAR.drag)} × ${n(CAR.frontalArea)} m²`],
      ['Pressão aerodinâmica', `${Math.round(pressed / 10) * 10} kg a 200 km/h`], ['Rolagem dos pneus', `${n(CAR.rolling * 100)}% do peso, mais a cada km/h`],
      ['Aderência dos pneus', `${CAR.grip.toLocaleString('pt-BR')} g`], ['Câmbio', `${CAR.gears.length} marchas, diferencial ${CAR.finalDrive.toLocaleString('pt-BR')}`],
      ['Velocidade máxima', `${Math.round(CAR.topSpeed * 3.6)} km/h`], ['Direção', `Volante ${n(CAR.steering)}:1 · a roda de dentro da curva esterça mais`],
      ['Rodas', `Giram a distância percorrida dividida pelo raio de ${Math.round(CAR.wheelRadius * 1000)} mm`]]);
    fold('Como a suspensão é calculada', [['Massa apoiada nas molas', `${SPRUNG.toLocaleString('pt-BR')} kg`], ['Massa de cada roda diant. / tras.', `${RIDE.unsprung[0]} / ${RIDE.unsprung[2]} kg`],
      ['Molas, medidas na roda', `${Math.round(CORNERS[0].k / 1000)} / ${Math.round(CORNERS[2].k / 1000)} N/mm`],
      ['Amortecimento', `${Math.round(RIDE.damping * 100)}% do crítico nos movimentos lentos`], ['Pneu', `${RIDE.tyre / 1000} N/mm`],
      ['Relevo da pista', 'Asfalto bom (ISO 8608, classes A–B)'], ['Irregularidades', 'Juntas de 8 mm, remendos de 6 mm e uma depressão de 16 mm']]);
  }
  closeCard();
  showLayers(false);
  sheet.hidden = false;
}
$('btnSheet').addEventListener('click', openSheet);
sheet.querySelector('.close').addEventListener('click', () => { sheet.hidden = true; });
// M liga e desliga o som (que só toca na Estrada)
window.addEventListener('keydown', (e) => {
  if (e.key.toLowerCase() !== 'm' || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return;
  say(engineSound.toggle() ? 'Som ligado' : 'Som desligado');
});
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!sheet.hidden) sheet.hidden = true; else if (!pop.hidden) showLayers(false); else closeCard();
});

// Ajusta a câmera e a área de desenho à janela. Se a página abrir sem tamanho (aba ou painel oculto),
// o enquadramento é refeito assim que ela aparecer
let sized = false;
function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  if (!w || !h) return;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
  if (!sized) { sized = true; setView(state.view); }
}
window.addEventListener('resize', resize);

setColor(0);
applyEnv();
setView('exterior');
resize();
controls.autoRotate = true;
controls.autoRotateSpeed = 0.8;

export { applyBodyMode, updateSpots, say, curtain };
