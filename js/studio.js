import * as THREE from 'three';
import { LITE } from './config.js';
import { scene, onScreen, studioEnv, studioBackground } from './scene.js';

// ---------- Estúdio ----------
// Cenário vazio dos ambientes claro e escuro: piso com malha de papel de projeto, fundo infinito em degradê
// e um refletor principal, que dá ao carro o brilho e as sombras que ele tem ao ar livre
const studio = new THREE.Group();
scene.add(studio);

// Piso: a malha é desenhada no próprio material, com linhas a cada 10 cm e mais fortes a cada metro.
// Ela some com a distância, e uma área um pouco mais iluminada marca o lugar do carro
const grid = {
  uLine: { value: new THREE.Color() },   // cor do traço
  uStrength: { value: 0 },               // quanto o traço aparece
  uPool: { value: 1 },                   // ganho de luz sob o carro
};
const floor = new THREE.Mesh(
  new THREE.CircleGeometry(60, 64),
  new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.1 })
);
floor.material.onBeforeCompile = (shader) => {
  Object.assign(shader.uniforms, grid);
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec2 vGround;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGround = (modelMatrix * vec4(position, 1.0)).xz;');
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>
      varying vec2 vGround;
      uniform vec3 uLine;
      uniform float uStrength, uPool;
      // traço de um pixel de largura, que se apaga quando as linhas ficam juntas demais na tela
      float gridLine(float cell) {
        vec2 p = vGround / cell, w = fwidth(p);
        vec2 d = abs(fract(p - 0.5) - 0.5) / w;
        return (1.0 - min(min(d.x, d.y), 1.0)) * (1.0 - smoothstep(0.12, 0.45, max(w.x, w.y)));
      }`)
    .replace('#include <color_fragment>', `#include <color_fragment>
      float away = length(vGround);
      diffuseColor.rgb *= mix(1.0, uPool, exp(-away * away / 30.0));
      float ink = max(gridLine(0.1) * 0.45, gridLine(1.0)) * (1.0 - smoothstep(5.0, 22.0, away));
      diffuseColor.rgb = mix(diffuseColor.rgb, uLine, ink * uStrength);`);
};
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
studio.add(floor);

// Fundo infinito: uma cúpula presa à câmera, com a faixa do horizonte mais clara, a parede e o teto mais fechado.
// A cor do horizonte é a mesma da névoa, então o piso se desfaz nele sem deixar uma linha
const backdrop = new THREE.Mesh(
  new THREE.SphereGeometry(1, 48, 24),
  new THREE.ShaderMaterial({
    side: THREE.BackSide, depthTest: false, depthWrite: false, fog: false,
    toneMapped: !LITE,   // no celular, a névoa do piso também não passa pelo mapeamento de tons; assim as duas cores coincidem
    defines: LITE ? { DITHER: '' } : {},   // fora do celular esse ruído é aplicado no fim, à imagem pronta (post.js)
    uniforms: {
      uHorizon: { value: new THREE.Color() },
      uWall: { value: new THREE.Color() },
      uZenith: { value: new THREE.Color() },
    },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 uHorizon, uWall, uZenith;
      varying vec3 vDir;
      void main() {
        float h = max(normalize(vDir).y, 0.0);
        vec3 c = mix(uWall, uZenith, smoothstep(0.08, 0.8, h));
        c = mix(c, uHorizon, exp(-h * h / 0.018));
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        // ruído de um nível de cor, para o degradê não formar faixas
        #ifdef DITHER
          gl_FragColor.rgb += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
        #endif
      }`,
  })
);
backdrop.frustumCulled = false;
backdrop.renderOrder = -1;
studio.add(backdrop);

// Refletor principal: no alto, à frente e à esquerda do carro, para a sombra cair do lado de quem chega. Ela só precisa cobrir o carro
const key = new THREE.DirectionalLight(0xfff6ea, 0);
key.position.set(-2.6, 8.5, -2.2);
key.castShadow = true;
key.shadow.mapSize.setScalar(2048);
Object.assign(key.shadow.camera, { left: -3.5, right: 3.5, top: 3.5, bottom: -3.5, near: 2, far: 16 });
key.shadow.camera.updateProjectionMatrix();
key.shadow.bias = -0.0004;
key.shadow.normalBias = 0.02;
key.shadow.radius = 4;
studio.add(key, key.target);

// Aplica as cores e a luz de um ambiente de estúdio (ver ENVS em config.js)
function applyStudio(e) {
  floor.material.color.setHex(e.floor);
  grid.uLine.value.setHex(e.line);
  grid.uStrength.value = e.grid;
  grid.uPool.value = e.pool;
  // fundo e névoa têm de chegar à tela com a cor escolhida, qualquer que seja a exposição
  onScreen(backdrop.material.uniforms.uHorizon.value.setHex(e.horizon));
  onScreen(backdrop.material.uniforms.uWall.value.setHex(e.wall));
  onScreen(backdrop.material.uniforms.uZenith.value.setHex(e.zenith));
  key.intensity = e.key;
  floor.material.envMapIntensity = e.fill;
  scene.environment = studioEnv(e);
  scene.background = onScreen(studioBackground.setHex(e.horizon));
  onScreen(scene.fog.color.setHex(e.horizon));
}

export { studio, applyStudio };
