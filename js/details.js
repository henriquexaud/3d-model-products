import * as THREE from 'three';
import { LITE, X0, layers } from './config.js';
import { std } from './materials.js';
import { toLayer } from './layers.js';
import { paint, textureOf } from './praca-textures.js';

// ---------- Detalhes acrescentados ao modelo ----------
// Peças e texturas que o modelo original não traz: pneus com banda de rodagem e inscrições, e placas

const RIM = 0.2825;   // raio da borda da roda, medido no modelo
const wheels = [];    // uma entrada por roda: { pivot, discPivot, centre, front }; os dois grupos giram em torno do eixo
const tyres = {};     // borracha dos pneus dianteiros e traseiros

// Pneu: o perfil (flanco, ombro e banda de rodagem) dá a volta em torno do eixo da roda, que é o eixo x.
// Na textura, v vai de um talão ao outro: 0–0,25 é o flanco do lado +x, 0,25–0,75 a banda e 0,75–1 o flanco do lado -x
function tyreGeometry(width, radius) {
  const W = width / 2, turns = 112, samples = 30;
  // meio perfil, do talão (escondido atrás da borda da roda) até o centro da banda: [afastamento lateral, raio]
  const path = new THREE.CatmullRomCurve3([
    [W - 0.016, RIM - 0.008], [W - 0.004, RIM + 0.002], [W, RIM + 0.016], [W + 0.001, RIM + 0.034], [W - 0.004, radius - 0.024],
    [W - 0.014, radius - 0.010], [W - 0.030, radius - 0.003], [W - 0.048, radius - 0.0006], [W * 0.5, radius], [0, radius],
  ].map(([l, r]) => new THREE.Vector3(l, r, 0)), false, 'centripetal');
  const pts = path.getSpacedPoints(samples);
  // o ombro, onde o flanco vira banda de rodagem, separa as duas zonas da textura
  let shoulder = 0;
  while (pts[shoulder].y < radius - 0.008) shoulder++;
  const profile = [];
  for (let i = 0; i <= samples; i++) {
    const t = path.getTangentAt(i / samples);
    const v = i <= shoulder ? 0.25 * i / shoulder : 0.25 + 0.25 * (i - shoulder) / (samples - shoulder);
    profile.push({ l: pts[i].x, r: pts[i].y, nl: t.y, nr: -t.x, v });
  }
  for (let i = samples - 1; i >= 0; i--) { const p = profile[i]; profile.push({ l: -p.l, r: p.r, nl: -p.nl, nr: p.nr, v: 1 - p.v }); }

  const P = [], N = [], U = [], I = [], rows = profile.length;
  for (let i = 0; i <= turns; i++) {
    const a = i / turns * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    for (const p of profile) {
      P.push(p.l, p.r * c, p.r * s);
      N.push(p.nl, p.nr * c, p.nr * s);
      U.push(i / turns, p.v);
    }
  }
  for (let i = 0; i < turns; i++) for (let j = 0; j < rows - 1; j++) {
    const a = i * rows + j, b = a + rows;
    I.push(a, a + 1, b, a + 1, b + 1, b);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(U, 2));
  geo.setIndex(I);
  return geo;
}

// Desenho do pneu aberto em uma tira: a largura da imagem dá a volta completa. Serve para o relevo e para a cor,
// mudando só os tons: `tone` devolve o tom do fundo, dos sulcos, dos cortes finos e do que fica em alto-relevo
function drawTyre(g, W, H, label, tone) {
  const side = H / 4, tread = H / 2, k = W / 4096;
  g.fillStyle = tone.base;
  g.fillRect(0, 0, W, H);

  // banda de rodagem: quatro sulcos ao longo da volta e cortes inclinados nos ombros e nas nervuras
  g.save();
  g.translate(0, side);
  g.strokeStyle = tone.cut;
  g.lineCap = 'round';
  for (let x = 0; x < W; x += 56 * k) {
    g.lineWidth = Math.max(1, 5 * k);
    for (const [y0, y1, lean] of [[0.0, 0.13, 26], [0.87, 1.0, 26], [0.22, 0.34, -16], [0.66, 0.78, -16]]) {
      g.beginPath();
      g.moveTo(x, y0 * tread);
      g.lineTo(x + lean * k * (y0 < 0.5 ? 1 : -1), y1 * tread);
      g.stroke();
    }
    g.lineWidth = Math.max(1, 3 * k);
    g.beginPath();
    g.moveTo(x + 28 * k, 0.43 * tread);
    g.lineTo(x + 40 * k, 0.57 * tread);
    g.stroke();
  }
  g.fillStyle = tone.groove;
  for (const y of [0.16, 0.38, 0.62, 0.84]) g.fillRect(0, (y - 0.022) * tread, W, 0.044 * tread);
  g.restore();

  // flancos: friso de proteção junto à roda, linhas finas junto ao ombro, serrilhado e inscrições em alto-relevo.
  // Cada flanco é desenhado virado para ser lido por quem olha a roda de fora
  for (const outer of [true, false]) {
    g.save();
    if (outer) { g.translate(W, H - side); g.scale(-1, 1); } else { g.translate(0, side); g.scale(1, -1); }
    g.fillStyle = tone.raised;
    for (let x = 0; x < W; x += 22 * k) g.fillRect(x, 0, 9 * k, 0.09 * side);
    g.fillRect(0, 0.15 * side, W, Math.max(1, 0.022 * side));
    g.fillRect(0, 0.21 * side, W, Math.max(1, 0.022 * side));
    g.fillRect(0, 0.80 * side, W, 0.07 * side);
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const write = (text, x, size) => {
      g.save();
      g.translate(x * W, 0.51 * side);
      g.scale(1.36, 1);   // a tira é mais comprida do que alta em relação ao pneu, então as letras são alargadas
      g.font = `bold ${size * side}px "Arial Narrow", Arial, sans-serif`;
      g.fillText(text, 0, 0);
      g.restore();
    };
    write(label, 0.125, 0.40);
    write(label, 0.625, 0.40);
    write('RADIAL · TUBELESS', 0.375, 0.22);
    write('TREADWEAR 220 · TRACTION AA · TEMPERATURE A', 0.875, 0.17);
    g.restore();
  }
}
function tyreMaterial(label) {
  const big = LITE ? 2048 : 4096;
  const bump = textureOf(paint(big, big / 8, (g, W, H) => drawTyre(g, W, H, label,
    { base: 'rgb(128,128,128)', groove: 'rgb(26,26,26)', cut: 'rgb(60,60,60)', raised: 'rgb(214,214,214)' })), false);
  const map = textureOf(paint(1024, 128, (g, W, H) => drawTyre(g, W, H, label,
    { base: 'rgb(27,27,28)', groove: 'rgb(8,8,8)', cut: 'rgb(15,15,15)', raised: 'rgb(35,35,37)' })));
  const rubber = std({ map, bumpMap: bump, bumpScale: 2.4, roughness: 0.9 });
  rubber.userData.relief = rubber.bumpScale;   // em movimento o relevo é atenuado
  return rubber;
}

// Agrupa as peças de cada roda em torno do eixo, para que possam girar, e troca os pneus lisos do modelo pelos novos
function setupWheels() {
  const W = layers.wheels.group, B = layers.brakes.group, v = new THREE.Vector3();
  tyres.front = tyreMaterial('235/35 ZR20 88Y');
  tyres.rear = tyreMaterial('295/35 ZR20 101Y');
  for (const old of W.children.filter((o) => o.name.startsWith('tire'))) {
    const box = new THREE.Box3().setFromObject(old), centre = box.getCenter(new THREE.Vector3()), size = box.getSize(v);
    const front = centre.z < 0, pivot = new THREE.Group(), discPivot = new THREE.Group();
    pivot.position.copy(centre);
    discPivot.position.copy(centre);
    W.add(pivot);
    B.add(discPivot);
    const tyre = new THREE.Mesh(tyreGeometry(size.x, size.y / 2), front ? tyres.front : tyres.rear);
    tyre.castShadow = tyre.receiveShadow = true;
    pivot.add(tyre);
    old.removeFromParent();
    old.geometry.dispose();
    wheels.push({ pivot, discPivot, centre, front });
  }
  // na mesma ordem usada pela física da suspensão: dianteira esquerda, dianteira direita, traseira esquerda, traseira direita
  const order = (w) => (w.centre.z < 0 ? 0 : 2) + (w.centre.x > 0 ? 1 : 0);
  wheels.sort((a, b) => order(a) - order(b));
  const owner = (o) => {
    new THREE.Box3().setFromObject(o).getCenter(v);
    return wheels.reduce((a, b) => (v.distanceToSquared(a.centre) < v.distanceToSquared(b.centre) ? a : b));
  };
  for (const o of [...W.children]) if (o.isMesh) owner(o).pivot.attach(o);
  for (const o of [...B.children]) if (o.isMesh && o.name.startsWith('brake')) owner(o).discPivot.attach(o);
}

// Placa no padrão Mercosul, 400 × 130 mm: faixa azul com o nome do país e sete caracteres pretos
function plateTexture(text) {
  return textureOf(paint(1024, 333, (g, W, H) => {
    const round = (x, y, w, h, r) => { g.beginPath(); g.roundRect(x, y, w, h, r); };
    g.fillStyle = '#101012';
    g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgb(236,236,231)';
    round(7, 7, W - 14, H - 14, 16);
    g.fill();
    g.save();
    g.clip();
    g.fillStyle = '#0b3a8f';
    g.fillRect(0, 0, W, 80);
    g.restore();
    g.fillStyle = '#ffffff';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = 'bold 50px Arial, sans-serif';
    g.fillText('BRASIL', W / 2, 46);
    // bandeira à direita da faixa
    g.fillStyle = '#1f9d49';
    g.fillRect(W - 112, 22, 70, 46);
    g.fillStyle = '#f4d21f';
    g.beginPath();
    g.moveTo(W - 77, 26); g.lineTo(W - 47, 45); g.lineTo(W - 77, 64); g.lineTo(W - 107, 45);
    g.fill();
    g.fillStyle = '#17357a';
    g.beginPath();
    g.arc(W - 77, 45, 10, 0, 7);
    g.fill();
    // sete caracteres, cada um ocupando no máximo 42 mm de largura
    g.fillStyle = '#0d0d0f';
    g.font = 'bold 236px Bahnschrift, "DIN Alternate", "Arial Narrow", Arial, sans-serif';
    g.textBaseline = 'alphabetic';
    [...text].forEach((ch, i) => {
      const w = g.measureText(ch).width;
      g.save();
      g.translate(128 + i * 128, 292);
      g.scale(Math.min(1, 106 / w), 1);
      g.fillText(ch, 0, 0);
      g.restore();
    });
    g.font = 'bold 30px Arial, sans-serif';
    g.fillText('BR', 44, 302);
  }), true, THREE.ClampToEdgeWrapping);
}
function addPlates() {
  const face = std({ map: plateTexture('CAR3D26'), roughness: 0.42 }), dark = std({ color: 0x0d0d0f, roughness: 0.55 });
  const plate = () => new THREE.Mesh(new THREE.BoxGeometry(0.40, 0.13, 0.003), [dark, dark, dark, dark, face, dark]);
  const frame = (w, h, d) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), dark);
  // traseira: no rebaixo da tampa, que é inclinado
  const lean = new THREE.Vector3(0, 0.36, 0.933).normalize(), back = new THREE.Group();
  back.position.set(X0, 0.605, 2.2225).addScaledVector(lean, 0.004);
  back.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), lean);
  back.add(frame(0.412, 0.142, 0.006), plate());
  back.children[1].position.z = 0.005;
  // dianteira: em pé, num suporte preso ao centro do para-choque
  const front = new THREE.Group();
  front.position.set(X0, 0.362, -2.262);
  front.rotation.y = Math.PI;
  front.add(frame(0.412, 0.142, 0.008), plate(), frame(0.22, 0.07, 0.07));
  front.children[1].position.z = 0.006;
  front.children[2].position.set(0, -0.02, -0.036);
  for (const group of [back, front]) {
    layers.body.group.add(group);
    group.updateWorldMatrix(true, true);
    for (const mesh of [...group.children]) toLayer(mesh, 'body');
    group.removeFromParent();
  }
}

// Chamado depois que o modelo foi distribuído nas camadas e as peças mecânicas foram criadas
function addDetails() {
  setupWheels();
  addPlates();
}

export { wheels, tyres, addDetails };
