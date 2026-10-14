import * as THREE from 'three';
import { renderer } from './scene.js';

// ---------- Texturas da praça ----------
const SUN = new THREE.Vector3(0.50, 0.78, -0.38).normalize();  // de onde vem a luz do sol
const HAZE = new THREE.Color(0.50, 0.62, 0.79);                // bruma do horizonte
const PAVED = { x0: -3.75, x1: 6.2, z0: -75, z1: 75 };         // calçadão onde o carro está parado

// Números pseudoaleatórios com semente, para o cenário sair sempre igual
function seeded(seed) {
  return () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function hash2(a, b) {
  let n = Math.imul(a, 374761393) + Math.imul(b, 668265263);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
// Ruído suave em 2D e a soma dele em várias escalas (nuvens, manchas de cor no chão)
function valueNoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  return (hash2(xi, yi) * (1 - u) + hash2(xi + 1, yi) * u) * (1 - v)
       + (hash2(xi, yi + 1) * (1 - u) + hash2(xi + 1, yi + 1) * u) * v;
}
function fbm(x, y, octaves = 5) {
  let sum = 0, amp = 0.5;
  for (let i = 0; i < octaves; i++) { sum += amp * valueNoise(x, y); x = x * 2.03 + 17.1; y = y * 2.03 + 9.2; amp *= 0.5; }
  return sum;
}
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

function paint(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  return c;
}
function textureOf(canvas, srgb = true, wrap = THREE.RepeatWrapping) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = wrap;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Céu em projeção equirretangular, em valores lineares: azul mais claro no horizonte, nuvens e o brilho do sol
function skyTexture() {
  const W = 1536, H = 768, data = new Uint16Array(W * H * 4), half = THREE.DataUtils.toHalfFloat, one = half(1);
  for (let j = 0; j < H; j++) {
    const lat = ((j + 0.5) / H - 0.5) * Math.PI, y = Math.sin(lat), flat = Math.cos(lat);
    const horizon = Math.exp(-Math.abs(y) * 14);
    for (let i = 0; i < W; i++) {
      const lon = ((i + 0.5) / W - 0.5) * 2 * Math.PI, x = Math.cos(lon) * flat, z = Math.sin(lon) * flat;
      let r = 0.36, g = 0.36, b = 0.32;   // abaixo do horizonte: o tom médio do chão, que só aparece nos reflexos
      if (y > 0) {
        const f = Math.pow(1 - y, 2.4);
        r = 0.07 + 0.35 * f; g = 0.19 + 0.39 * f; b = 0.60 + 0.22 * f;
        // nuvens: ruído projetado em um plano alto, mais miúdo perto do horizonte
        const s = 1.3 / (y + 0.1), n = fbm(x * s + 3.7, z * s + 1.3);
        const cover = smooth(0.49, 0.70, n) * smooth(0.04, 0.26, y) * 0.95;
        if (cover > 0) {
          const shade = 1.3 - 0.5 * smooth(0.58, 0.9, n);
          r += (shade - r) * cover; g += (shade - g) * cover; b += (shade * 1.03 - b) * cover;
        }
        const toSun = Math.max(0, x * SUN.x + y * SUN.y + z * SUN.z);
        const glow = 0.25 * Math.pow(toSun, 30) + 1.2 * Math.pow(toSun, 600) + 24 * smooth(0.99955, 0.99988, toSun);
        r += glow; g += glow * 0.92; b += glow * 0.78;
      }
      const o = (j * W + i) * 4;
      data[o] = half(r + (HAZE.r - r) * horizon);
      data[o + 1] = half(g + (HAZE.g - g) * horizon);
      data[o + 2] = half(b + (HAZE.b - b) * horizon);
      data[o + 3] = one;
    }
  }
  const t = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.HalfFloatType);
  t.mapping = THREE.EquirectangularReflectionMapping;
  t.colorSpace = THREE.LinearSRGBColorSpace;
  t.minFilter = t.magFilter = THREE.LinearFilter;
  t.wrapS = THREE.RepeatWrapping;
  t.needsUpdate = true;
  return t;
}

// Piso intertravado: blocos de 20 × 10 cm em espinha de peixe. O desenho cobre 2 m e se repete sem emenda
function paverTextures() {
  const size = 1024, u = size / 20, blocks = [], rand = seeded(5);
  for (let k = -24; k <= 44; k++) for (let m = -12; m <= 12; m++) {
    blocks.push([k + 2 * m, k - 2 * m, 2, 1], [k + 2 * m + 2, k - 2 * m - 1, 1, 2]);
  }
  const each = (fn) => {
    for (const [x, y, w, h] of blocks) {
      if (x + w <= 0 || y + h <= 0 || x >= 20 || y >= 20) continue;
      fn(x * u, y * u, w * u, h * u, hash2((((x % 20) + 20) % 20) * 7 + w, ((y % 20) + 20) % 20));   // mesma cor em toda repetição
    }
  };
  const block = (g, x, y, w, h, inset) => {
    g.beginPath();
    if (g.roundRect) g.roundRect(x + inset, y + inset, w - 2 * inset, h - 2 * inset, 3);
    else g.rect(x + inset, y + inset, w - 2 * inset, h - 2 * inset);
    g.fill();
  };
  const speckle = (g, light, dark) => {
    for (let i = 0; i < 26000; i++) {
      g.fillStyle = rand() > 0.5 ? light : dark;
      g.fillRect(rand() * size, rand() * size, 1 + rand() * 1.6, 1 + rand() * 1.6);
    }
  };
  const color = paint(size, size, (g) => {
    g.fillStyle = '#5b574f';   // rejunte de areia
    g.fillRect(0, 0, size, size);
    each((x, y, w, h, key) => {
      const v = 136 + key * 44, warm = (hash2((key * 1e6) | 0, 3) - 0.5) * 14;
      g.fillStyle = `rgb(${v + warm}, ${v}, ${v - warm * 0.8})`;
      block(g, x, y, w, h, 1.6);
    });
    speckle(g, 'rgba(255,255,255,0.10)', 'rgba(0,0,0,0.13)');
  });
  const bump = paint(size, size, (g) => {
    g.fillStyle = '#383838';
    g.fillRect(0, 0, size, size);
    each((x, y, w, h, key) => {
      const v = 150 + key * 30;
      g.fillStyle = `rgb(${v - 36}, ${v - 36}, ${v - 36})`;   // borda chanfrada
      block(g, x, y, w, h, 1.6);
      g.fillStyle = `rgb(${v}, ${v}, ${v})`;
      block(g, x, y, w, h, 4.5);
    });
    speckle(g, 'rgba(255,255,255,0.06)', 'rgba(0,0,0,0.08)');
  });
  return { map: textureOf(color), bump: textureOf(bump, false) };
}

function lawnTexture() {
  const size = 512, rand = seeded(21), tones = ['#40592a', '#4b6630', '#557036', '#465f2c', '#607a40', '#6d7c48'];
  return textureOf(paint(size, size, (g) => {
    g.fillStyle = '#465f2c';
    g.fillRect(0, 0, size, size);
    g.lineCap = 'round';
    for (let i = 0; i < 5200; i++) {
      const x = rand() * size, y = rand() * size, a = rand() * 6.28, len = 4 + rand() * 7;
      g.strokeStyle = tones[(rand() * rand() * tones.length) | 0];
      g.globalAlpha = 0.55 + rand() * 0.4;
      g.lineWidth = 0.8 + rand() * 0.9;
      for (const dx of [-size, 0, size]) for (const dy of [-size, 0, size]) {
        g.beginPath();
        g.moveTo(x + dx, y + dy);
        g.lineTo(x + dx + Math.cos(a) * len, y + dy + Math.sin(a) * len);
        g.stroke();
      }
    }
  }));
}
// Tufo de grama visto de lado, em fundo transparente
function tuftTexture() {
  const rand = seeded(33), tips = ['#5b7a3c', '#668442', '#73864a', '#526f36'];
  return textureOf(paint(256, 128, (g, w, h) => {
    for (let i = 0; i < 26; i++) {
      const x = 12 + rand() * (w - 24), top = h * (0.05 + rand() * 0.5), lean = (rand() - 0.5) * 46, base = 3 + rand() * 3;
      const grad = g.createLinearGradient(0, h, 0, top);
      grad.addColorStop(0, '#34501f');
      grad.addColorStop(1, tips[i % 4]);
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(x - base, h);
      g.quadraticCurveTo(x - base * 0.5 + lean * 0.4, (h + top) / 2, x + lean, top);
      g.quadraticCurveTo(x + base * 0.6 + lean * 0.4, (h + top) / 2, x + base, h);
      g.fill();
    }
  }), true, THREE.ClampToEdgeWrapping);
}
// Ramalhete de folhas de 7 a 12 cm, em fundo transparente; cada cartão da copa mostra um destes
function clumpTexture() {
  const size = 512, rand = seeded(11);
  return textureOf(paint(size, size, (g) => {
    g.lineCap = 'round';
    const leaf = (x, y, angle, len) => {
      const w = len * 0.3, v = 0.82 + rand() * 0.36, yellow = rand() > 0.9 ? 34 : 0;
      g.save();
      g.translate(x, y);
      g.rotate(angle);
      const grad = g.createLinearGradient(0, 0, len, 0);
      grad.addColorStop(0, `rgb(${50 * v + yellow}, ${92 * v + yellow * 0.6}, ${34 * v})`);
      grad.addColorStop(1, `rgb(${96 * v + yellow}, ${140 * v + yellow * 0.6}, ${56 * v})`);
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(0, 0);
      g.bezierCurveTo(len * 0.25, -w * 1.35, len * 0.72, -w, len, 0);
      g.bezierCurveTo(len * 0.72, w, len * 0.25, w * 1.35, 0, 0);
      g.fill();
      g.strokeStyle = 'rgba(190, 212, 140, 0.45)';   // nervura central
      g.lineWidth = 1.3;
      g.beginPath();
      g.moveTo(3, 0);
      g.lineTo(len * 0.92, 0);
      g.stroke();
      g.restore();
    };
    const twig = (x0, y0, angle, len, count) => {
      const x1 = x0 + Math.cos(angle) * len, y1 = y0 + Math.sin(angle) * len;
      g.strokeStyle = '#4d3c24';
      g.lineWidth = 4;
      g.beginPath();
      g.moveTo(x0, y0);
      g.lineTo(x1, y1);
      g.stroke();
      for (let i = 0; i < count; i++) {
        const t = (i + 0.5) / count, side = i % 2 ? 1 : -1;
        leaf(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, angle + side * (0.55 + rand() * 0.55), 66 + rand() * 50);
      }
      leaf(x1, y1, angle + (rand() - 0.5) * 0.4, 76 + rand() * 30);
    };
    const up = -Math.PI / 2;
    twig(250, 390, up - 0.62, 215, 9);
    twig(262, 350, up + 0.66, 225, 9);
    twig(254, 240, up - 0.36, 150, 6);
    twig(258, 210, up + 0.34, 150, 6);
    twig(256, 508, up, 310, 13);
  }), true, THREE.ClampToEdgeWrapping);
}
// Casca: fissuras verticais escuras e cristas claras. A mesma lista de traços gera a cor e o relevo
function barkTextures() {
  const size = 512, rand = seeded(44), strokes = [];
  for (let i = 0; i < 520; i++) strokes.push([rand() * size, rand() * size, 30 + rand() * 150, 1.5 + rand() * 5, (rand() - 0.5) * 14, rand()]);
  const draw = (base, dark, light) => (g) => {
    g.fillStyle = base;
    g.fillRect(0, 0, size, size);
    g.lineCap = 'round';
    for (const [x, y, len, width, bend, tone] of strokes) for (const dx of [-size, 0, size]) for (const dy of [-size, 0, size]) {
      g.strokeStyle = tone > 0.3 ? dark : light;
      g.globalAlpha = 0.35 + tone * 0.4;
      g.lineWidth = width;
      g.beginPath();
      g.moveTo(x + dx, y + dy);
      g.quadraticCurveTo(x + dx + bend, y + dy + len / 2, x + dx + bend * 0.3, y + dy + len);
      g.stroke();
    }
  };
  return {
    map: textureOf(paint(size, size, draw('#6b5a4a', '#2c231b', '#8d7a66'))),
    bump: textureOf(paint(size, size, draw('#8a8a8a', '#202020', '#c8c8c8')), false),
  };
}
// Madeira das ripas: veios ao longo do comprimento
function woodTextures() {
  const w = 1024, h = 256, rand = seeded(55), lines = [];
  for (let i = 0; i < 150; i++) lines.push([rand() * h, 0.6 + rand() * 2.2, rand(), (rand() - 0.5) * 10, rand() * 6.28]);
  const draw = (base, dark, light) => (g) => {
    g.fillStyle = base;
    g.fillRect(0, 0, w, h);
    for (const [y, width, tone, wave, phase] of lines) {
      g.strokeStyle = tone > 0.45 ? dark : light;
      g.globalAlpha = 0.18 + tone * 0.3;
      g.lineWidth = width;
      g.beginPath();
      g.moveTo(0, y + Math.sin(phase) * wave);
      for (let x = 32; x <= w; x += 32) g.lineTo(x, y + Math.sin(x / w * Math.PI * 4 + phase) * wave);
      g.stroke();
    }
  };
  return {
    map: textureOf(paint(w, h, draw('#76583f', '#473223', '#8f6f50'))),
    bump: textureOf(paint(w, h, draw('#909090', '#505050', '#b0b0b0')), false),
  };
}
// Mancha escura e macia, usada como sombra das árvores distantes
function blobTexture() {
  return textureOf(paint(128, 128, (g) => {
    const grad = g.createRadialGradient(64, 64, 6, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.55, 'rgba(255,255,255,0.75)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
  }), true, THREE.ClampToEdgeWrapping);
}

// Bosque distante, visto de lado: uma faixa de árvores que se repete sem emenda. Cada copa é feita de tufos de folhas,
// claros no alto, onde bate o sol, e escuros por baixo; entre uma copa e outra aparecem os troncos, na sombra, e ao pé
// deles os arbustos da beira da mata. Por trás, uma fileira mais escura fecha os vãos, e o céu só aparece no recorte do alto
function treelineTexture() {
  const rand = seeded(71), trees = [], bushes = [], behind = [];
  const tufts = (count, size) => Array.from({ length: count }, () => {
    const turn = rand() * 6.283, out = Math.sqrt(rand());
    return [Math.cos(turn) * out * 1.08, Math.sin(turn) * out * 0.82, size * (0.6 + rand() * 0.8)];
  }).sort((a, b) => b[1] - a[1]);   // de baixo para cima: os tufos claros do alto ficam por cima dos outros
  for (let x = 0; x < 2048; x += 30 + rand() * 58) {
    trees.push({ x, radius: 44 + rand() * 58, top: 0.06 + rand() * 0.34, tone: 0.84 + rand() * 0.3, back: rand(), trunk: rand() < 0.7, tufts: tufts(110, 0.12) });
  }
  for (let x = 0; x < 2048; x += 24 + rand() * 30) behind.push({ x, radius: 40 + rand() * 34, top: 0.26 + rand() * 0.16, tone: 0.42 + rand() * 0.2, tufts: tufts(46, 0.2) });
  for (let x = 0; x < 2048; x += 16 + rand() * 30) bushes.push({ x, radius: 16 + rand() * 20, top: 0.6 + rand() * 0.12, tone: 0.5 + rand() * 0.3, tufts: tufts(16, 0.3) });
  trees.sort((a, b) => a.back - b.back);
  const texture = textureOf(paint(2048, 256, (g, w, h) => {
    g.fillStyle = 'rgb(24, 40, 22)';   // o escuro de dentro da mata
    g.fillRect(0, h * 0.68, w, h * 0.32);
    const crown = (plant, cx, cy) => {
      for (const [ox, oy, size] of plant.tufts) {
        const lit = Math.min(1, Math.max(0, 0.5 - oy * 0.62)) * plant.tone;
        g.fillStyle = `rgb(${24 + 78 * lit}, ${42 + 92 * lit}, ${22 + 34 * lit})`;
        g.beginPath();
        g.ellipse(cx + ox * plant.radius, cy + oy * plant.radius, size * plant.radius, size * plant.radius * 0.82, 0, 0, 7);
        g.fill();
      }
    };
    for (const dx of [-w, 0, w]) for (const tree of behind) crown(tree, tree.x + dx, h * tree.top + tree.radius * 0.82);   // tudo emenda nas bordas
    for (const dx of [-w, 0, w]) {
      for (const tree of trees) {
        const cx = tree.x + dx, cy = h * tree.top + tree.radius * 0.82;
        if (tree.trunk) { g.fillStyle = 'rgb(38, 33, 27)'; g.fillRect(cx - 1.5, cy, 3, h - cy); }
        crown(tree, cx, cy);
      }
    }
    for (const dx of [-w, 0, w]) for (const bush of bushes) crown(bush, bush.x + dx, h * bush.top + bush.radius);
  }));
  texture.wrapT = THREE.ClampToEdgeWrapping;   // senão a base, que é cheia, vazaria em um fio na borda de cima
  return texture;
}
// Morros ao longe, já quase da cor da bruma: duas linhas de relevo suave, que se repetem sem emenda.
// A parte de baixo fica encoberta pela bruma, de onde só os cumes saem
function hillsTexture() {
  const rand = seeded(88);
  const texture = textureOf(paint(2048, 256, (g, w, h) => {
    for (const [height, tone] of [[0.82, 'rgb(152, 173, 204)'], [0.52, 'rgb(128, 152, 178)']]) {
      const waves = [1, 2, 3, 5, 8, 13].map((k) => [k, rand() * 6.283, (0.4 + rand() * 0.6) / k]);
      g.fillStyle = tone;
      g.beginPath();
      g.moveTo(0, h);
      for (let x = 0; x <= w; x += 4) {
        let n = 0;
        for (const [k, phase, amp] of waves) n += amp * Math.sin(k * x / w * 6.283 + phase);
        g.lineTo(x, h * (1 - height * (0.62 + 0.2 * n)));
      }
      g.lineTo(w, h);
      g.fill();
    }
    const haze = g.createLinearGradient(0, h * 0.42, 0, h * 0.68);
    haze.addColorStop(0, 'rgba(188, 206, 229, 0)');
    haze.addColorStop(1, 'rgba(188, 206, 229, 1)');
    g.globalCompositeOperation = 'source-atop';
    g.fillStyle = haze;
    g.fillRect(0, 0, w, h);
  }));
  texture.wrapT = THREE.ClampToEdgeWrapping;
  return texture;
}

// O céu é o mesmo na praça e na estrada, então é pintado uma vez só
let sky = null;
const sharedSky = () => (sky ??= skyTexture());

export {
  SUN, HAZE, PAVED, seeded, hash2, fbm, smooth, paint, textureOf, sharedSky, paverTextures, lawnTexture, tuftTexture,
  clumpTexture, barkTextures, woodTextures, blobTexture, treelineTexture, hillsTexture,
};
