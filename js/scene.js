import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { LITE, state, hintEl } from './config.js';
import { invalidate } from './pace.js';

// ---------- Cena ----------
// Fora do celular a cena é desenhada primeiro fora da tela (ver post.js), e é lá que as bordas são suavizadas
const renderer = new THREE.WebGLRenderer({ antialias: LITE, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
// As bordas são suavizadas juntando várias amostras em cada ponto da imagem. Se essa conta é feita com a luz ainda sem
// limite de brilho, uma única amostra muito forte (um reflexo do sol) vence as outras e a borda sai serrilhada. Por isso,
// fora do celular, cada material já grava a luz exposta e comprimida entre 0 e 1 — dividida por 1 mais o canal mais
// forte —, e o acabamento a expande de volta, sem perda, antes de aplicar o mapeamento de tons de verdade
if (!LITE) {
  renderer.toneMapping = THREE.CustomToneMapping;
  THREE.ShaderChunk.tonemapping_pars_fragment = THREE.ShaderChunk.tonemapping_pars_fragment.replace(
    'vec3 CustomToneMapping( vec3 color ) { return color; }',
    'vec3 CustomToneMapping( vec3 color ) { color *= toneMappingExposure; return color / ( 1.0 + max( color.r, max( color.g, color.b ) ) ); }');
  // a névoa é misturada depois dessa conta, então a cor dela passa pela mesma conta
  THREE.ShaderChunk.fog_fragment = THREE.ShaderChunk.fog_fragment.replace('gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );', `
    #ifdef TONE_MAPPING
      gl_FragColor.rgb = mix( gl_FragColor.rgb, toneMapping( fogColor ), fogFactor );
    #else
      gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
    #endif`);
}
// Só a praça tem sol e sombras. Como a cena é parada, o mapa de sombras é refeito apenas quando algo muda
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false;
const shadowsDirty = () => { renderer.shadowMap.needsUpdate = true; invalidate(); };
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x000000, 6, 18);
const pmrem = new THREE.PMREMGenerator(renderer);
// Grupos dos cenários que se revezam na cena: o estúdio, a praça e a estrada
const sceneries = new Set();
// Os programas de desenho dependem de quantas luzes há na cena. A praça tem as dos postes (no celular, uma a menos); os outros
// cenários começam com o mesmo número de luzes apagadas, e assim o carro usa os mesmos programas em todos: a troca de ambiente
// não espera nenhuma compilação. Como cada luz, mesmo apagada, custa um pouco a cada quadro, elas saem assim que os programas
// sem elas ficam prontos, em segundo plano (ver `strip`, em post.js)
const POST_LIGHTS = LITE ? 2 : 3;
function unlit(group) {
  group.userData.unlit = Array.from({ length: POST_LIGHTS }, () => {
    const light = new THREE.PointLight(0x000000, 0, 0, 2);
    light.position.set(0, -100, 0);
    group.add(light);
    return light;
  });
}

// Com o acabamento da imagem (post.js), tudo passa pela exposição e pelo mapeamento de tons no fim. Uma cor que deve
// chegar à tela exatamente como foi escrita (a névoa, o fundo do estúdio) precisa então entrar na cena como a luz que,
// depois dessa conta, dá essa cor: `onScreen` faz o caminho inverso do mapeamento ACES do three.js
const ACES_IN = new THREE.Matrix3().set(0.59719, 0.35458, 0.04823, 0.07600, 0.90834, 0.01566, 0.02840, 0.13383, 0.83777).invert();
const ACES_OUT = new THREE.Matrix3().set(1.60475, -0.53108, -0.07367, -0.10208, 1.10813, -0.00605, -0.00327, -0.07276, 1.07602).invert();
const light = new THREE.Vector3(), DARK = new THREE.Vector3();
function onScreen(color) {
  if (LITE) return color;
  light.set(color.r, color.g, color.b).applyMatrix3(ACES_OUT);
  for (const k of ['x', 'y', 'z']) {
    const y = Math.min(0.97, Math.max(0, light[k])), a = 1 - 0.983729 * y, b = 0.0245786 - 0.432951 * y, c = 0.000090537 + 0.238081 * y;
    light[k] = (Math.sqrt(b * b + 4 * a * c) - b) / (2 * a);
  }
  light.applyMatrix3(ACES_IN).multiplyScalar(0.6 / renderer.toneMappingExposure).max(DARK);
  return color.setRGB(light.x, light.y, light.z);
}
// O que brilha por conta própria, sem depender da luz da cena (telas do painel, halos, lua, estrelas), é registrado aqui:
// a cada troca de exposição a cor é reforçada na medida que mantém na tela o brilho que ela tinha
const selfLit = [];
function selfLight(color, boost = 1) {
  selfLit.push({ color, base: color.clone().multiplyScalar(boost) });
  setExposure(renderer.toneMappingExposure);
  return color;
}
function setExposure(value) {
  renderer.toneMappingExposure = value;
  if (!LITE) for (const s of selfLit) s.color.copy(s.base).multiplyScalar(1.4 / value);
}

// Reflexos e luz ambiente: uma foto em 360° de `world`, tirada do ponto `from`. O verniz da pintura e os vidros
// espelham essa foto quase sem borrar, então ela precisa de definição: cada face tem ENV_SIZE pixels de lado
const ENV_SIZE = LITE ? 256 : 512;
function surroundings(world, from, near, far) {
  const target = new THREE.WebGLCubeRenderTarget(ENV_SIZE, { type: THREE.HalfFloatType });
  const probe = new THREE.CubeCamera(near, far, target);
  probe.position.copy(from);
  probe.update(renderer, world);
  const env = pmrem.fromCubemap(target.texture).texture;
  target.dispose();
  return env;
}

// Luz ambiente e reflexos só do céu, para quando o cenário ainda não está montado. A foto tem o tamanho das fotos dos cenários:
// o tamanho entra na receita dos programas de desenho, e assim os materiais usam os mesmos programas com uma ou com a outra
const skyEnvs = new Map();
function skyEnv(sky) {
  if (!skyEnvs.has(sky)) {
    const world = new THREE.Scene();
    world.background = sky;
    skyEnvs.set(sky, surroundings(world, CENTRE, 0.1, 100));
  }
  return skyEnvs.get(sky);
}

// Luz ambiente e reflexos do estúdio de um ambiente (ver ENVS em config.js); cada um é montado na primeira vez em que é pedido
const studioBackground = new THREE.Color(), studioEnvs = new Map(), CENTRE = new THREE.Vector3();
function studioEnv(e) {
  if (!studioEnvs.has(e)) studioEnvs.set(e, surroundings(studioEnvironment(e.room, e.ground), CENTRE, 0.1, 100));
  return studioEnvs.get(e);
}

// Painel de luz difusa: o brilho cai aos poucos perto da moldura. É esse degradê, espelhado no verniz,
// que desenha as curvas da carroceria; um painel de bordas duras deixaria só manchas chapadas
const softGlow = (() => {
  const S = 64, data = new Uint8Array(S * S * 4), ramp = (t) => { const u = Math.min(1, Math.min(t, 1 - t) / 0.3); return u * u * (3 - 2 * u); };
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) data.fill(255 * ramp((i + 0.5) / S) * ramp((j + 0.5) / S), (j * S + i) * 4, (j * S + i) * 4 + 4);
  const t = new THREE.DataTexture(data, S, S);
  t.minFilter = t.magFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
})();

// Estúdio fotográfico usado só para iluminação e reflexos: sala escura, que dá contraste à pintura, chão claro ou escuro
// e os painéis de luz de um estúdio de automóveis
function studioEnvironment(walls, ground) {
  const env = new THREE.Scene();
  const room = new THREE.Mesh(
    new THREE.BoxGeometry(24, 12, 24),
    new THREE.MeshBasicMaterial({ color: walls, side: THREE.BackSide })
  );
  room.position.y = 5;
  env.add(room);
  // o chão clareia ou escurece a parte de baixo do carro
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(24, 24), new THREE.MeshBasicMaterial({ color: ground }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -0.9;
  env.add(floor);
  const softbox = (w, h, intensity, pos) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({
        map: softGlow, color: new THREE.Color().setScalar(intensity), side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
      })
    );
    m.position.set(...pos);
    m.lookAt(0, 0.5, 0);
    env.add(m);
  };
  softbox(7, 15, 5.5, [0, 9.5, 0]);                 // teto: a grande luz que corre por cima do carro, de ponta a ponta
  for (const s of [-1, 1]) {
    softbox(18, 3.2, 4.2, [s * 10.5, 2.6, 0]);      // faixas laterais, à altura da linha de cintura
    softbox(13, 1.6, 5, [s * 6.5, 8.2, 0]);          // réguas no alto, que marcam os ombros da carroceria
    softbox(9, 3, 3.2, [0, 3.2, s * 11.5]);         // frente e traseira
    softbox(3.5, 6, 2.2, [s * 9.5, 5.5, -9.5]);     // cantos da frente, para o para-choque não ficar apagado
  }
  return env;
}

const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 400);   // a proporção é acertada em resize()
camera.layers.enable(1);                                         // a camada das estrelas (ver night.js)
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

export { renderer, shadowsDirty, scene, sceneries, unlit, pmrem, onScreen, selfLight, setExposure, surroundings, skyEnv, studioEnv, studioBackground, camera, controls };
