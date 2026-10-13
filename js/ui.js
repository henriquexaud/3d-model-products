import * as THREE from 'three';
import { COLORS, ENVS, X0, measures, LAYERS, layers, state, $, hintText } from './config.js';
import { renderer, shadowsDirty, scene, studioEnv, camera, controls } from './scene.js';
import { studio, applyStudio } from './studio.js';
import { bodyMaterial, LIGHTS, highlight, ghost } from './materials.js';
import { bodyMeshes } from './layers.js';
import { HAZE } from './praca-textures.js';
import { praca, ensurePraca } from './praca.js';
import { road, ensureRoad } from './road.js';
import { CAR } from './physics.js';
import { RIDE, SPRUNG, CORNERS } from './ride.js';
import { setDriving } from './drive.js';

// ---------- Interface ----------
function buildSwatches(containerId, labelId, items, toCss, apply) {
  const container = $(containerId), label = $(labelId);
  const select = (i) => {
    apply(items[i]);
    label.textContent = items[i].name;
    [...container.children].forEach((b, j) => b.setAttribute('aria-pressed', String(i === j)));
  };
  items.forEach((item, i) => {
    const b = document.createElement('button');
    b.style.setProperty('--c', toCss(item));
    b.title = item.name;
    b.setAttribute('aria-label', item.name);
    b.addEventListener('click', () => select(i));
    container.appendChild(b);
  });
  select(0);
}
buildSwatches('colors', 'colorName', COLORS,
  (c) => '#' + c.hex.toString(16).padStart(6, '0'),
  (c) => { state.color = c; bodyMaterial.color.setHex(c.hex); });
// Ambiente: a praça ou a estrada, com céu, sol e cenário, ou o estúdio claro ou escuro
function applyEnv(e) {
  state.env = e;
  // um cenário novo é montado com os outros escondidos, para não aparecerem nos reflexos dele
  if (praca) praca.group.visible = false;
  if (road) road.group.visible = false;
  const set = e.scenery === 'praca' ? ensurePraca() : e.scenery === 'road' ? ensureRoad() : null;
  studio.visible = !set;
  if (set) {
    set.group.visible = true;
    scene.background = set.sky;
    scene.environment = set.env;
    scene.fog.color.copy(HAZE);
  } else {
    scene.environment = studioEnv;
    applyStudio(e);
  }
  renderer.toneMappingExposure = e.exposure;
  ghost.uniforms.uColor.value.setHex(e.ghost);
  if (state.view === 'exterior') controls.maxDistance = Math.max(set ? 16 : 9, state.fit * 1.3);
  setDriving(e.scenery === 'road');
  shadowsDirty();
}
buildSwatches('envs', 'envName', ENVS, (e) => e.swatch, applyEnv);

const press = (el, on) => el.setAttribute('aria-pressed', String(on));
const layerVisible = (L) => (L.id === 'body' ? state.body !== 'hidden' : state.on[L.id]);

// Vistas
function setView(view) {
  state.view = view;
  if (view === 'interior') {
    // Câmera na posição do motorista; arrastar olha em volta
    controls.target.set(-0.36, 0.97, 0.17);
    camera.position.set(-0.36, 0.98, 0.22);
    camera.fov = 70;
    controls.minDistance = controls.maxDistance = 0.05;
    controls.maxPolarAngle = Math.PI * 0.75;
    controls.minPolarAngle = Math.PI * 0.25;
    controls.rotateSpeed = -0.4;
    controls.enablePan = controls.enableZoom = false;
    controls.autoRotate = false;
    hintText.textContent = 'Arraste para olhar em volta';
    closeCard();
  } else {
    // em telas estreitas a câmera abre o ângulo e se afasta até o carro caber na largura
    const portrait = camera.aspect < 1;
    camera.fov = portrait ? 50 : 40;
    const halfWidth = Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect);
    const distance = Math.max(6.25, 2.5 / Math.tan(halfWidth));
    controls.target.set(0, 0.5, 0);
    camera.position.set(4.25, 0.9, -4.5).setLength(distance).add(controls.target);
    state.fit = distance;
    controls.maxDistance = Math.max(state.env.scenery ? 16 : 9, distance * 1.3);   // ao ar livre dá para recuar e ver o cenário
    controls.minPolarAngle = 0;
    controls.maxPolarAngle = THREE.MathUtils.degToRad(88);
    controls.rotateSpeed = 1;
    controls.enablePan = controls.enableZoom = true;
    hintText.textContent = 'Arraste para girar · Role ou faça pinça para dar zoom · Toque em + para ver as medidas';
  }
  applyBodyMode();
  camera.updateProjectionMatrix();
  controls.update();
  for (const b of $('views').children) press(b, b.dataset.view === view);
}
$('views').addEventListener('click', (e) => {
  if (e.target.dataset.view) setView(e.target.dataset.view);
});

// Carroceria sólida, em raio-X ou oculta
function applyBodyMode() {
  for (const o of bodyMeshes) {
    // em raio-X ficam só os painéis externos; forros e assoalho esconderiam as peças
    o.visible = state.body === 'solid' || (state.body === 'xray' && !o.userData.inner);
    o.material = state.body === 'xray' ? ghost : o.userData.solid;
    o.castShadow = state.body === 'solid' && o.name !== 'glass';
  }
  shadowsDirty();
  // sem a carroceria no caminho, a câmera pode chegar mais perto das peças
  if (state.view === 'exterior') controls.minDistance = state.body === 'solid' ? 2.5 : 1.2;
  for (const b of $('bodyMode').children) press(b, b.dataset.mode === state.body);
  if (state.open && !spotAllowed(state.open)) closeCard();
}
$('bodyMode').addEventListener('click', (e) => {
  if (!e.target.dataset.mode) return;
  state.body = e.target.dataset.mode;
  applyBodyMode();
});

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

function fillSpecs(dl, specs) {
  dl.replaceChildren();
  for (const [key, value] of specs) {
    const dt = document.createElement('dt'), dd = document.createElement('dd');
    dt.textContent = key;
    dd.textContent = typeof value === 'function' ? value() : value;
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
const anchor = new THREE.Vector3(), toCamera = new THREE.Vector3();
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

// Destaques: pontos de informação e faróis
function setLights(on) {
  state.lights = on;
  for (const [m, intensity] of LIGHTS) m.emissiveIntensity = on ? intensity : 0;
  press($('btnLights'), on);
}
$('btnLights').addEventListener('click', () => setLights(!state.lights));
$('btnSpots').addEventListener('click', () => {
  state.spots = !state.spots;
  press($('btnSpots'), state.spots);
  if (!state.spots) closeCard();
});

// Resumo: a configuração atual e as medidas de todas as camadas
const sheet = $('sheet');
function openSheet() {
  const body = $('sheetBody');
  body.replaceChildren();
  const add = (tag, text) => { const el = document.createElement(tag); if (text) el.textContent = text; body.appendChild(el); return el; };
  const specs = (rows) => { const dl = add('dl'); dl.className = 'specs'; fillSpecs(dl, rows); };
  add('h4', 'Sua configuração');
  specs([
    ['Cor', state.color.name],
    ['Ambiente', state.env.name],
    ['Faróis', state.lights ? 'Ligados' : 'Desligados'],
    ['Carroceria', { solid: 'Sólida', xray: 'Raio-X', hidden: 'Oculta' }[state.body]],
    ['Camadas visíveis', LAYERS.filter((L) => L.chip && state.on[L.id]).map((L) => L.chip).join(', ') || 'Nenhuma'],
  ]);
  add('h4', 'Ficha técnica');
  for (const L of LAYERS) {
    if (!L.specs) continue;
    add('h5', L.name);
    specs(L.specs);
  }
  if (state.env.scenery === 'praca') {
    add('h5', 'Cenário da praça');
    specs([['Banco', measures.bench], ['Assento', '44 cm do chão'], ['Árvore', measures.tree], ['Tronco', 'Ø 40 cm'], ['Blocos do piso', '20 × 10 cm']]);
  }
  if (state.env.scenery === 'road') {
    add('h5', 'Cenário da estrada');
    specs([['Faixas', '2 × 3,60 m'], ['Acostamentos', '2,50 m e 0,60 m'], ['Linha tracejada', 'traço de 4 m a cada 16 m'],
      ['Largura das linhas', '15 cm'], ['Defensa metálica', '75 cm de altura, postes a cada 4 m']]);
    add('h5', 'Como o movimento é calculado');
    specs([['Massa com motorista', `${CAR.mass.toLocaleString('pt-BR')} kg`], ['Arrasto do ar (Cx × área)', '0,36 × 2,03 m²'],
      ['Pressão aerodinâmica', '140 kg a 200 km/h'], ['Rolagem dos pneus', '1,1% do peso, mais a cada km/h'],
      ['Aderência dos pneus', `${CAR.grip.toLocaleString('pt-BR')} g`], ['Câmbio', `${CAR.gears.length} marchas, diferencial ${CAR.finalDrive.toLocaleString('pt-BR')}`],
      ['Velocidade máxima', `${Math.round(CAR.topSpeed * 3.6)} km/h`]]);
    add('h5', 'Como a suspensão é calculada');
    specs([['Massa apoiada nas molas', `${SPRUNG.toLocaleString('pt-BR')} kg`], ['Massa de cada roda diant. / tras.', `${RIDE.unsprung[0]} / ${RIDE.unsprung[2]} kg`],
      ['Molas, medidas na roda', `${Math.round(CORNERS[0].k / 1000)} / ${Math.round(CORNERS[2].k / 1000)} N/mm`],
      ['Amortecimento', `${Math.round(RIDE.damping * 100)}% do crítico nos movimentos lentos`], ['Pneu', `${RIDE.tyre / 1000} N/mm`],
      ['Relevo da pista', 'Asfalto bom (ISO 8608, classes A–B)'], ['Irregularidades', 'Juntas de 8 mm, remendos de 6 mm e uma depressão de 16 mm']]);
  }
  closeCard();
  sheet.hidden = false;
}
$('btnSheet').addEventListener('click', openSheet);
sheet.querySelector('.close').addEventListener('click', () => { sheet.hidden = true; });
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!sheet.hidden) sheet.hidden = true; else closeCard();
});

// No celular o painel abre e fecha
$('panelToggle').addEventListener('click', () => {
  const open = $('panel').classList.toggle('open');
  $('panelToggle').setAttribute('aria-expanded', String(open));
  $('panelToggle').textContent = open ? 'Fechar' : 'Opções';
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

setLights(true);
setView('exterior');
resize();
controls.autoRotate = true;
controls.autoRotateSpeed = 0.8;

export { applyBodyMode, updateSpots };
