import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { LITE, look } from './config.js';
import { renderer, scene, camera } from './scene.js';

// ---------- Acabamento da imagem ----------
// A cena é desenhada fora da tela, com a luz de cada ponto guardada sem limite de brilho, e só no fim vira imagem.
// No caminho ela ganha a sombra suave que as peças fazem umas nas outras em cantos e frestas (oclusão do ambiente)
// e o clarão que as luzes fortes deixam na objetiva; por último vêm o mapeamento de tons e um leve escurecimento
// dos cantos. No celular (LITE) nada disso existe: a cena vai direto para a tela

// Oclusão do ambiente: mede, pela profundidade da imagem, o quanto cada ponto está encoberto pelo que tem em volta.
// A profundidade é a que o quadro já tem, e as normais saem dela: a cena não é desenhada outra vez. Como ela é a do que
// se vê, o que fica atrás de um vidro não escurece por causa da moldura dele, e a folhagem conta folha por folha
class Occlusion extends GTAOPass {
  constructor(depth) {
    super(scene, camera, 1, 1, undefined,
      { radius: 0.28, distanceExponent: 1.5, thickness: 0.5, scale: 1, samples: 16 },
      { lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 4, rings: 2, samples: 8 });
    this._renderGBuffer = false;
    for (const material of [this.gtaoMaterial, this.pdMaterial]) {
      material.defines.NORMAL_VECTOR_TYPE = 0;
      material.uniforms.tDepth.value = depth;
      material.needsUpdate = true;
    }
  }
  setSize(width, height) {
    this.gtaoRenderTarget.setSize(width, height);
    this.pdRenderTarget.setSize(width, height);
    this.gtaoMaterial.uniforms.resolution.value.set(width, height);
    this.pdMaterial.uniforms.resolution.value.set(width, height);
  }
  // só mede e alisa o resultado; quem o aplica à imagem é a revelação, mais abaixo
  render(renderer) {
    const measure = this.gtaoMaterial.uniforms, eye = this.camera;
    measure.cameraNear.value = eye.near;
    measure.cameraFar.value = eye.far;
    measure.cameraProjectionMatrix.value.copy(eye.projectionMatrix);
    measure.cameraProjectionMatrixInverse.value.copy(eye.projectionMatrixInverse);
    measure.cameraWorldMatrix.value.copy(eye.matrixWorld);
    this.renderPass(renderer, this.gtaoMaterial, this.gtaoRenderTarget, 0xffffff, 1.0);
    this.pdMaterial.uniforms.cameraProjectionMatrixInverse.value.copy(eye.projectionMatrixInverse);
    this.renderPass(renderer, this.pdMaterial, this.pdRenderTarget, 0xffffff, 1.0);
  }
}

const pass = (uniforms, fragmentShader) => new FullScreenQuad(new THREE.ShaderMaterial({
  uniforms, fragmentShader, toneMapped: false, depthTest: false, depthWrite: false,
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
}));

const finish = LITE ? null : (() => {
  const depth = new THREE.DepthTexture(1, 1);
  depth.format = THREE.DepthStencilFormat;
  depth.type = THREE.UnsignedInt248Type;
  // A cena, com as bordas suavizadas; o estêncil serve ao borrão das rodas (details.js). Os materiais gravam nela a luz
  // já exposta e comprimida (ver scene.js): o three.js só aplica essa conta fora da tela nos alvos marcados como de
  // realidade virtual, e é por isso que este leva a marca
  const frame = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4, stencilBuffer: true, depthTexture: depth });
  frame.texture.colorSpace = THREE.LinearSRGBColorSpace;
  frame.isXRRenderTarget = true;
  const work = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType });
  const occlusion = new Occlusion(depth);
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.16, 0.55, 2);
  bloom.highPassUniforms.smoothWidth.value = 0.5;   // o clarão entra aos poucos, sem recorte

  // Revelação: devolve à luz o brilho que tinha e aplica a oclusão. Ela é medida com metade da definição; cada ponto
  // da imagem a recebe dos vizinhos que estão à mesma distância da câmera, senão a sombra do que está atrás vazaria
  // em degraus pela borda do que está na frente. De longe ela some: é um acabamento do carro, não da paisagem
  const reveal = pass({
    tFrame: { value: frame.texture }, tDepth: { value: depth }, tOcclusion: { value: occlusion.pdRenderTarget.texture },
    uGrid: { value: new THREE.Vector2(1, 1) }, uNear: { value: 0.1 }, uFar: { value: 100 }, uStrength: { value: 0.72 },
  }, `
    #include <packing>
    uniform sampler2D tFrame, tOcclusion;
    uniform highp sampler2D tDepth;
    uniform vec2 uGrid;
    uniform float uNear, uFar, uStrength;
    varying vec2 vUv;
    float away(vec2 uv) { return -perspectiveDepthToViewZ(texture2D(tDepth, uv).x, uNear, uFar); }
    void main() {
      vec3 light = texture2D(tFrame, vUv).rgb;
      light /= max(1.0 - max(light.r, max(light.g, light.b)), 0.02);   // um clarão somado por cima pode passar de 1: o brilho tem teto
      float here = away(vUv), shade = 0.0, total = 0.0;
      vec2 at = vUv * uGrid - 0.5, corner = floor(at), part = at - corner;
      for (int i = 0; i < 4; i++) {
        vec2 side = vec2(float(i - i / 2 * 2), float(i / 2)), spot = (corner + side + 0.5) / uGrid;
        float gap = (away(spot) - here) / (0.02 * here + 0.01);
        float weight = (mix(1.0 - part.x, part.x, side.x) * mix(1.0 - part.y, part.y, side.y) + 0.02) * exp(-gap * gap);
        shade += weight * texture2D(tOcclusion, spot).r;
        total += weight;
      }
      shade = mix(shade / max(total, 1e-5), 1.0, max(step(total, 1e-5), smoothstep(14.0, 30.0, here)));
      gl_FragColor = vec4(light * mix(1.0, shade, uStrength), 1.0);
    }`);

  // Por fim o mapeamento de tons (o ACES do three.js; a exposição já foi aplicada pelos materiais), a conversão para a tela,
  // um pouco menos de luz nos cantos, como em qualquer objetiva, e ruído de um nível de cor, para os degradês não formarem faixas
  const develop = pass({ tDiffuse: { value: work.texture }, toneMappingExposure: { value: 1 } }, `
    #include <tonemapping_pars_fragment>
    uniform sampler2D tDiffuse;
    varying vec2 vUv;
    void main() {
      vec2 off = vUv - 0.5;
      gl_FragColor = vec4(ACESFilmicToneMapping(texture2D(tDiffuse, vUv).rgb * (1.0 - 0.34 * dot(off, off))), 1.0);
      #include <colorspace_fragment>
      gl_FragColor.rgb += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
    }`);
  return { frame, work, occlusion, bloom, reveal, develop, size: new THREE.Vector2() };
})();

// Desenha um quadro
function render() {
  if (!finish) { renderer.render(scene, camera); return; }
  const { frame, work, occlusion, bloom, reveal, develop, size } = finish, grid = reveal.material.uniforms.uGrid.value;
  renderer.getDrawingBufferSize(size);
  if (size.x !== frame.width || size.y !== frame.height) {
    frame.setSize(size.x, size.y);
    work.setSize(size.x, size.y);
    grid.set(Math.ceil(size.x / 2), Math.ceil(size.y / 2));   // sombra difusa não pede mais que metade da definição, e custa um quarto
    occlusion.setSize(grid.x, grid.y);
    bloom.setSize(size.x, size.y);
  }
  renderer.setRenderTarget(frame);
  renderer.render(scene, camera);
  occlusion.render(renderer);
  reveal.material.uniforms.uNear.value = camera.near;
  reveal.material.uniforms.uFar.value = camera.far;
  renderer.setRenderTarget(work);
  reveal.render(renderer);
  // só brilha o que passa bem do branco da imagem; `bloom` é esse limite em cada ambiente
  bloom.threshold = look().bloom ?? 1.7;
  bloom.render(renderer, null, work);
  renderer.setRenderTarget(null);
  develop.render(renderer);
}

export { render };
