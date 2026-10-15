import * as THREE from 'three';
import { measures, LAYERS } from '../../config.js';
import { AX_R, WHEEL_Y } from './spec.js';
import { mats } from '../../materials.js';
import { G } from '../../layers.js';
import { V, S, rod, cyl, rbox, beam, tube, polyPipe, extrude, hull, mergeMeshes } from '../../geometry.js';

// ---------- Peças mecânicas ----------
// Tudo em metros, nas proporções reais de um esportivo V8 de motor central, encaixado nos vãos do modelo.
// Aqui ficam as peças paradas; as que se movem estão em suspension.js e extras.js

// Motor V8 a 90°: virabrequim ao longo de z, a 335 mm do solo; bloco entre z = 0,62 e z = 1,10
const CY = 0.335, Z0 = 0.62, LEN = 0.48, ZC = Z0 + LEN / 2;
const zCyl = [0, 1, 2, 3].map((i) => Z0 + 0.084 + i * 0.104);   // centros dos cilindros, a cada 104 mm
const bankZ = (s) => (s < 0 ? -0.02 : 0);                        // a bancada esquerda fica 20 mm à frente
const ENGINE = { CY, Z0, LEN, ZC, zCyl, bankZ };
// Onde as linhas rígidas de freio terminam e começam os flexíveis de cada roda
const BRAKE_BRACKETS = { front: { '-1': V(-0.47, 0.545, -1.345), 1: V(0.47, 0.545, -1.345) }, rear: { '-1': V(-0.49, 0.50, 1.33), 1: V(0.49, 0.50, 1.33) } };

function buildMechanics() {
  { // Chassi: estrutura tubular de alumínio
    const g = G('chassis'), m = mats('chassis');
    for (const s of S) {
      g.add(rbox(0.10, 0.16, 1.84, s * 0.765, 0.275, 0.16, m.aluSatin, 0.012));     // soleira
      g.add(rbox(0.07, 0.46, 0.04, s * 0.77, 0.50, -0.733, m.aluSatin, 0.01));      // coluna dianteira
      g.add(rbox(0.08, 0.56, 0.08, s * 0.795, 0.55, 0.58, m.aluSatin, 0.01));       // coluna traseira
      g.add(rbox(0.07, 0.10, 0.60, s * 0.46, 0.48, -1.42, m.aluSatin, 0.01));       // longarinas dianteiras
      g.add(rbox(0.07, 0.07, 0.64, s * 0.36, 0.215, -1.44, m.aluSatin, 0.01));
      g.add(beam(V(s * 0.36, 0.215, -1.745), V(s * 0.46, 0.50, -1.745), 0.06, 0.06, m.aluSatin));
      g.add(rbox(0.08, 0.08, 0.34, s * 0.16, 0.47, -1.93, m.aluSatin, 0.01));       // absorvedor de impacto
      g.add(rbox(0.02, 0.22, 0.14, s * 0.435, 0.63, -1.205, m.alu, 0.006));         // torre do amortecedor
      g.add(rbox(0.11, 0.016, 0.14, s * 0.48, 0.735, -1.205, m.alu, 0.006));
      g.add(rbox(0.06, 0.08, 1.40, s * 0.455, 0.78, 1.28, m.aluSatin, 0.01));       // longarinas traseiras
      g.add(rbox(0.06, 0.08, 1.14, s * 0.43, 0.235, 1.17, m.aluSatin, 0.01));
      g.add(beam(V(s * 0.43, 0.235, 1.72), V(s * 0.43, 0.30, 1.97), 0.06, 0.06, m.aluSatin));  // sobe para passar acima do difusor
      g.add(beam(V(s * 0.43, 0.30, 1.97), V(s * 0.455, 0.78, 1.97), 0.05, 0.05, m.aluSatin));
      for (const z of [0.60, 1.03]) g.add(rbox(0.33, 0.04, 0.06, s * 0.575, 0.22, z, m.aluSatin, 0.008)); // apoios do tanque
      g.add(rbox(0.07, 0.07, 0.12, s * 0.45, 0.66, 2.045, m.aluSatin, 0.01));
      const hoop = [];                                                              // arco de proteção atrás do banco
      for (let i = 0; i <= 12; i++) {
        const a = Math.PI * i / 12;
        hoop.push(V(s * (0.50 - 0.13 * Math.cos(a)), 0.885 + 0.215 * Math.sin(a), 0.585));
      }
      g.add(tube(hoop, 0.022, m.steel));
    }
    g.add(rbox(1.44, 0.012, 1.22, 0, 0.198, -0.15, m.aluSatin, 0.004));             // assoalho
    g.add(rbox(1.04, 0.012, 0.30, 0, 0.198, -0.91, m.aluSatin, 0.004));
    g.add(rod(V(-0.74, 0.745, -0.80), V(0.74, 0.745, -0.80), 0.03, m.steel, 0.03, 14)); // travessa do painel
    g.add(rbox(1.00, 0.06, 0.06, 0, 0.50, -1.745, m.aluSatin, 0.01));               // quadro frontal
    g.add(rbox(0.80, 0.06, 0.06, 0, 0.215, -1.745, m.aluSatin, 0.01));
    g.add(tube([[-0.62, 0.46, -2.02], [-0.40, 0.46, -2.10], [0, 0.46, -2.16], [0.40, 0.46, -2.10], [0.62, 0.46, -2.02]], 0.04, m.aluSatin, 12));
    g.add(rbox(1.52, 0.07, 0.06, 0, 0.85, 0.585, m.aluSatin, 0.01));                // travessa atrás dos bancos
    g.add(rbox(0.97, 0.06, 0.06, 0, 0.78, 1.97, m.aluSatin, 0.01));
    g.add(rbox(0.92, 0.06, 0.06, 0, 0.30, 1.97, m.aluSatin, 0.01));
    g.add(tube([[-0.58, 0.66, 2.07], [-0.35, 0.66, 2.12], [0, 0.66, 2.145], [0.35, 0.66, 2.12], [0.58, 0.66, 2.07]], 0.035, m.aluSatin, 12));
  }

  {
    const g = G('engine'), m = mats('engine');
    const block = extrude([[-0.11, -0.12], [0.11, -0.12], [0.15, -0.06], [0.15, 0.02], [0.1874, 0.0954], [0.0954, 0.1874],
      [0, 0.092], [-0.0954, 0.1874], [-0.1874, 0.0954], [-0.15, 0.02], [-0.15, -0.06]], LEN, m.alu);
    block.position.set(0, CY, Z0);
    g.add(block);
    // tampas dianteira e traseira, com o contorno do bloco e dos dois cabeçotes
    const outline = [[-0.11, -0.12], [0.11, -0.12], [0.15, -0.06], [0.15, 0.02], [0.226, 0.0566], [0.3147, 0.1449], [0.152, 0.3076],
      [0.0636, 0.2192], [0, 0.16], [-0.0636, 0.2192], [-0.152, 0.3076], [-0.3147, 0.1449], [-0.226, 0.0566], [-0.15, 0.02], [-0.15, -0.06]];
    const front = extrude(outline, 0.035, m.alu), rear = extrude(outline, 0.02, m.alu);
    front.position.set(0, CY, Z0 - 0.035);
    rear.position.set(0, CY, Z0 + LEN);
    g.add(front, rear);
    for (const s of S) {
      // bancada: no seu referencial, +y segue o eixo dos cilindros e +x aponta para o lado do escape
      const side = new THREE.Group(), b = new THREE.Group();
      side.scale.x = s;
      side.position.set(0, CY, bankZ(s));
      b.rotation.z = -Math.PI / 4;
      side.add(b);
      g.add(side);
      b.add(rbox(0.23, 0.125, 0.47, 0.005, 0.2625, ZC, m.alu, 0.012));               // cabeçote
      b.add(rbox(0.225, 0.022, 0.465, 0.005, 0.336, ZC, m.black, 0.008));            // tampa de válvulas
      for (const x of [-0.058, 0.068]) b.add(cyl(0.043, 0.44, 'z', x, 0.343, ZC, m.black, 16)); // comandos
      for (const z of zCyl) {
        b.add(cyl(0.016, 0.05, 'y', 0.005, 0.37, z, m.rubber, 10));                  // bobinas
        b.add(rbox(0.014, 0.06, 0.07, 0.125, 0.26, z, m.steel, 0.003));              // flanges de escape
      }
      b.add(cyl(0.02, 0.02, 'y', 0.005, 0.362, Z0 + 0.03, m.aluSatin, 12));          // tampa de abastecimento de óleo

      // admissão: coletor sobre o V, dutos até os cabeçotes, borboleta e caixa de ar
      const plenum = new THREE.Mesh(new THREE.CapsuleGeometry(0.055, 0.30, 6, 16), m.plenum);
      plenum.rotation.x = Math.PI / 2;
      plenum.position.set(s * 0.105, 0.775, 0.86);
      g.add(plenum);
      for (const z of zCyl) g.add(rod(V(s * 0.108, 0.60, z + bankZ(s)), V(s * 0.105, 0.74, z + bankZ(s)), 0.023, m.alu));
      g.add(cyl(0.038, 0.05, 'z', s * 0.105, 0.775, 1.09, m.aluSatin, 16));
      g.add(polyPipe([[s * 0.105, 0.775, 1.11], [s * 0.15, 0.775, 1.20], [s * 0.27, 0.72, 1.27], [s * 0.33, 0.67, 1.33]], 0.04, m.rubber, 0.04, 10));
      g.add(rbox(0.16, 0.18, 0.44, s * 0.33, 0.65, 1.53, m.carbon, 0.03));
      g.add(polyPipe([[s * 0.40, 0.65, 1.42], [s * 0.44, 0.66, 1.30], [s * 0.455, 0.67, 1.14], [s * 0.52, 0.68, 1.04], [s * 0.60, 0.69, 0.98]], 0.038, m.black, 0.04, 10));
    }
    // acessórios na frente do motor, ligados por uma única correia
    g.add(cyl(0.08, 0.03, 'z', 0, CY, 0.567, m.darkSteel, 28));                      // polia do virabrequim
    g.add(cyl(0.03, 0.036, 'z', 0, CY, 0.567, m.steel, 14));
    g.add(cyl(0.05, 0.03, 'z', 0, 0.50, 0.567, m.darkSteel, 24));                    // bomba d'água
    g.add(cyl(0.06, 0.05, 'z', 0, 0.50, 0.605, m.alu, 20));
    g.add(cyl(0.05, 0.03, 'z', -0.245, 0.30, 0.567, m.darkSteel, 24));               // compressor do ar-condicionado
    g.add(cyl(0.06, 0.14, 'z', -0.245, 0.30, 0.67, m.alu, 20));
    const pulleys = [[0, CY, 0.08], [0.245, 0.30, 0.03], [0, 0.50, 0.05], [-0.245, 0.30, 0.05]];
    const loop = (pad) => hull(pulleys.flatMap(([x, y, r]) => Array.from({ length: 24 }, (_, k) =>
      [x + (r + pad) * Math.cos(k * Math.PI / 12), y + (r + pad) * Math.sin(k * Math.PI / 12)]))).map(([x, y]) => new THREE.Vector2(x, y));
    const beltShape = new THREE.Shape(loop(0.006));
    beltShape.holes.push(new THREE.Path(loop(0.001)));
    const belt = new THREE.Mesh(new THREE.ExtrudeGeometry(beltShape, { depth: 0.02, bevelEnabled: false }), m.rubber);
    belt.position.z = 0.557;
    g.add(belt);
    g.add(rbox(0.16, 0.05, 0.05, 0, 0.555, 0.615, m.alu, 0.012));                    // carcaça do termostato
    g.add(cyl(0.04, 0.10, 'y', -0.17, 0.25, 0.80, m.darkSteel, 16));                 // filtro de óleo
    g.add(cyl(0.075, 0.28, 'y', -0.22, 0.54, 1.19, m.aluSatin, 20));                 // reservatório de óleo do cárter seco
    g.add(cyl(0.03, 0.02, 'y', -0.22, 0.69, 1.19, m.black, 12));
  }

  { // Transmissão: embreagem dupla, diferencial e engrenagens em uma só carcaça, atrás do motor
    const g = G('trans'), m = mats('trans');
    g.add(cyl(0.155, 0.16, 'z', 0, CY, 1.19, m.alu, 28, 0.14));                      // campana da embreagem
    g.add(cyl(0.15, 0.02, 'z', 0, 0.345, 1.275, m.aluSatin, 28));
    for (const s of S) for (const z of [1.35, 1.45, 1.55]) g.add(rbox(0.012, 0.26, 0.012, s * 0.183, 0.37, z, m.alu, 0.004)); // nervuras
    for (const z of [1.67, 1.73, 1.79]) g.add(rbox(0.20, 0.012, 0.012, 0, 0.523, z, m.alu, 0.004));
    g.add(rbox(0.36, 0.32, 0.36, 0, 0.37, 1.45, m.alu, 0.05));                       // diferencial
    g.add(rbox(0.28, 0.30, 0.22, 0, 0.37, 1.73, m.alu, 0.05));                       // conjunto de engrenagens
    g.add(cyl(0.10, 0.03, 'z', 0, 0.37, 1.855, m.aluSatin, 20));
    g.add(rbox(0.20, 0.05, 0.24, 0, 0.555, 1.47, m.black, 0.01));                    // unidade de comando
    g.add(rbox(0.05, 0.03, 0.04, 0.06, 0.59, 1.40, m.black, 0.005));
    for (const s of S) {                                                             // saídas do diferencial para os semieixos
      const at = (x) => V(s * x, WHEEL_Y, AX_R);
      g.add(rod(at(0.18), at(0.21), 0.055, m.steel, 0.055, 18));
      g.add(rod(at(0.21), at(0.28), 0.045, m.steel, 0.045, 18));
    }
  }

  { // Escapamento: 4 primários por bancada, coletor, catalisador, silencioso e três saídas
    const g = G('exhaust'), m = mats('exhaust');
    for (const s of S) {
      zCyl.forEach((z0, i) => {
        const z = z0 + bankZ(s), ox = (i % 2 ? 1 : -1) * 0.022, oy = (i < 2 ? 1 : -1) * 0.022;
        g.add(tube([[s * 0.270, 0.433, z], [s * 0.305, 0.398, z + 0.005], [s * (0.345 + ox * 0.5), 0.335 + oy * 0.5, Math.min(z + 0.05, 1.07)],
          [s * (0.338 + ox), 0.292 + oy, Math.min(z + 0.12, 1.10)], [s * (0.335 + ox), 0.275 + oy, 1.14], [s * (0.335 + ox), 0.275 + oy, 1.175]], 0.0215, m.inox));
      });
      g.add(rod(V(s * 0.335, 0.275, 1.17), V(s * 0.32, 0.262, 1.27), 0.05, m.inox, 0.0325, 16));
      g.add(polyPipe([[s * 0.32, 0.262, 1.27], [s * 0.30, 0.258, 1.40], [s * 0.285, 0.262, 1.50], [s * 0.27, 0.30, 1.565]], 0.0325, m.inox, 0.04, 10));
      g.add(rod(V(s * 0.27, 0.30, 1.56), V(s * 0.27, 0.30, 1.59), 0.0325, m.inoxHot, 0.06, 18));
      g.add(cyl(0.06, 0.22, 'z', s * 0.27, 0.30, 1.70, m.inoxHot, 20));              // catalisador
      g.add(rod(V(s * 0.27, 0.30, 1.81), V(s * 0.27, 0.30, 1.84), 0.06, m.inoxHot, 0.0325, 18));
      g.add(polyPipe([[s * 0.27, 0.30, 1.84], [s * 0.28, 0.33, 1.885], [s * 0.32, 0.45, 1.92], [s * 0.34, 0.55, 1.93]], 0.0325, m.inox, 0.03, 10));
    }
    const muffler = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.78, 28), m.inox);
    muffler.rotation.z = Math.PI / 2;
    muffler.scale.set(0.095, 1, 0.08);
    muffler.position.set(0, 0.60, 1.93);
    g.add(muffler);
    for (const x of [-0.109, 0.001, 0.111]) {
      g.add(tube([[x, 0.565, 1.99], [x, 0.50, 2.05], [x, 0.425, 2.10], [x, 0.41, 2.13], [x, 0.41, 2.178]], 0.036, m.inox, 12));
    }
  }

  { // Arrefecimento: radiadores na dianteira, tubos pelo túnel central, radiadores de óleo atrás
    const g = G('cooling'), m = mats('cooling');
    for (const s of S) {
      const rad = new THREE.Group();
      rad.position.set(s * 0.50, 0.37, -1.88);
      rad.rotation.order = 'YXZ';
      rad.rotation.set(0.22, -s * 0.25, 0);
      g.add(rad);
      rad.add(new THREE.Mesh(new THREE.BoxGeometry(0.40, 0.30, 0.04), m.core));
      for (const e of S) rad.add(rbox(0.03, 0.30, 0.05, e * 0.215, 0, 0, m.black));
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.135, 0.01, 6, 28), m.black);  // eletroventilador
      ring.position.z = 0.05;
      rad.add(ring, cyl(0.035, 0.04, 'z', 0, 0, 0.05, m.black, 14));
      const pipe = polyPipe([[s * 0.29, 0.47, -1.91], [s * 0.25, 0.39, -1.87], [s * 0.10, 0.37, -1.84], [s * 0.045, 0.37, -1.76],
        [s * 0.045, 0.37, -1.40], [s * 0.03, 0.335, -1.28], [s * 0.026, 0.26, -1.13], [s * 0.026, 0.245, -1.03], [s * 0.026, 0.245, 0.40],
        [s * 0.07, 0.25, 0.50], [s * 0.115, 0.30, 0.535], [s * 0.115, 0.44, 0.538], [s * 0.10, 0.53, 0.545], [s * 0.07, 0.56, 0.58],
        [s * 0.05, 0.565, 0.615]], 0.016, m.aluSatin, 0.035);
      measures.coolant = pipe.userData.length;
      g.add(pipe);
      const oil = new THREE.Group();                                                 // radiador de óleo
      oil.position.set(s * 0.62, 0.62, 1.99);
      oil.rotation.y = s * 0.4;
      g.add(oil);
      oil.add(new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.20, 0.035), m.core));
      for (const e of S) oil.add(rbox(0.02, 0.20, 0.045, e * 0.13, 0, 0, m.black, 0.006));
    }
    g.add(rbox(0.15, 0.12, 0.11, 0.34, 0.74, 0.66, m.white, 0.02));                  // reservatório de expansão
    g.add(cyl(0.03, 0.02, 'y', 0.34, 0.81, 0.66, m.black, 14));
    g.add(polyPipe([[0.28, 0.69, 0.63], [0.20, 0.64, 0.61], [0.07, 0.585, 0.615]], 0.008, m.rubber, 0.02, 6));
    for (const o of [0, 0.025]) {                                                    // linhas dos radiadores de óleo
      g.add(polyPipe([[-0.52, 0.62 + o, 1.96], [-0.47, 0.66 + o, 1.84], [-0.445, 0.66 + o, 1.60], [-0.44, 0.66 + o, 1.30],
        [-0.36, 0.64 + o, 1.22], [-0.28, 0.62 + o, 1.19]], 0.009, m.rubber, 0.03, 6));
      g.add(polyPipe([[0.52, 0.62 + o, 1.96], [0.47, 0.66 + o, 1.84], [0.445, 0.64 + o, 1.80], [0.30, 0.60 + o, 1.80],
        [0.16, 0.54 + o, 1.775], [0.14, 0.46 + o, 1.76]], 0.009, m.rubber, 0.03, 6));
    }
  }

  { // Combustível: dois tanques de 43 L ao lado do motor, bocal à esquerda, galerias sobre os cabeçotes
    const g = G('fuel'), m = mats('fuel');
    for (const s of S) {
      g.add(rbox(0.24, 0.39, 0.46, s * 0.59, 0.435, 0.82, m.aluSatin, 0.03));
      for (const z of [0.70, 0.94]) g.add(rbox(0.248, 0.398, 0.02, s * 0.59, 0.435, z, m.darkSteel, 0.03)); // cintas
      g.add(cyl(0.055, 0.016, 'y', s * 0.59, 0.636, 0.80, m.black, 18));             // bomba, dentro do tanque
      g.add(rod(V(s * 0.150, 0.655, 0.67 + bankZ(s)), V(s * 0.150, 0.655, 1.05 + bankZ(s)), 0.009, m.steel, 0.009, 8)); // galeria
      for (const z of zCyl) g.add(rod(V(s * 0.150, 0.655, z + bankZ(s)), V(s * 0.132, 0.615, z + bankZ(s)), 0.008, m.darkSteel, 0.008, 8));
    }
    g.add(polyPipe([[0.47, 0.30, 0.64], [0.44, 0.30, 0.585], [0.33, 0.24, 0.542], [0.24, 0.225, 0.535], [-0.24, 0.225, 0.535],
      [-0.33, 0.24, 0.542], [-0.44, 0.30, 0.585], [-0.47, 0.30, 0.64]], 0.014, m.steel, 0.03));  // tubo de equilíbrio
    g.add(polyPipe([[-0.60, 0.62, 0.80], [-0.69, 0.72, 0.86], [-0.80, 0.80, 0.96], [-0.85, 0.83, 1.02]], 0.025, m.steel, 0.05, 10)); // bocal
    g.add(rod(V(-0.845, 0.827, 1.014), V(-0.862, 0.837, 1.034), 0.032, m.black, 0.032, 16));
    g.add(polyPipe([[0.59, 0.645, 0.80], [0.47, 0.67, 0.88], [0.30, 0.685, 0.92], [0.20, 0.68, 0.91], [0.152, 0.66, 0.90]], 0.005, m.steel, 0.03, 6));
    g.add(polyPipe([[0.150, 0.655, 0.67], [0.10, 0.665, 0.64], [-0.10, 0.665, 0.635], [-0.150, 0.655, 0.65]], 0.005, m.steel, 0.02, 6));
  }

  { // Elétrica: bateria na dianteira, cabo pelo túnel, alternador, motor de partida e centrais
    const g = G('electric'), m = mats('electric');
    g.add(rbox(0.175, 0.19, 0.278, 0.22, 0.305, -1.565, m.black, 0.008));            // bateria
    g.add(rbox(0.165, 0.012, 0.268, 0.22, 0.402, -1.565, m.darkSteel, 0.004));
    g.add(cyl(0.009, 0.018, 'y', 0.24, 0.415, -1.47, m.cable, 10), cyl(0.009, 0.018, 'y', 0.20, 0.415, -1.66, m.steel, 10));
    g.add(rbox(0.20, 0.06, 0.13, 0.22, 0.375, -1.24, m.black, 0.01));                // caixa de fusíveis
    const cable = polyPipe([[0.24, 0.42, -1.47], [0.20, 0.43, -1.38], [0.10, 0.41, -1.26], [0.07, 0.36, -1.16], [0.04, 0.30, -1.06],
      [0.04, 0.30, 0.40], [0.07, 0.28, 0.50], [0.13, 0.245, 0.60], [0.185, 0.225, 0.80], [0.19, 0.225, 1.04], [0.19, 0.262, 1.10]], 0.008, m.cable, 0.03, 6);
    measures.cable = cable.userData.length;
    g.add(cable);
    g.add(cyl(0.065, 0.12, 'z', 0.245, 0.30, 0.645, m.alu, 20));                     // alternador
    g.add(cyl(0.067, 0.03, 'z', 0.245, 0.30, 0.645, m.darkSteel, 20));
    g.add(cyl(0.03, 0.022, 'z', 0.245, 0.30, 0.567, m.darkSteel, 16));
    g.add(cyl(0.012, 0.03, 'z', 0.245, 0.30, 0.582, m.steel, 8));
    g.add(cyl(0.0425, 0.17, 'z', 0.19, 0.27, 1.175, m.darkSteel, 16));               // motor de partida
    g.add(cyl(0.022, 0.10, 'z', 0.215, 0.325, 1.16, m.steel, 12));
    for (const s of S) {                                                             // centrais eletrônicas do motor
      g.add(rbox(0.20, 0.15, 0.035, s * 0.24, 0.70, 0.565, m.aluSatin, 0.008));
      g.add(rbox(0.12, 0.03, 0.03, s * 0.24, 0.615, 0.565, m.black, 0.005));
    }
    g.add(polyPipe([[0.14, 0.375, -1.20], [0.02, 0.37, -1.14], [0, 0.345, -1.04], [0, 0.34, 0.40], [0, 0.45, 0.535], [0, 0.60, 0.54]], 0.011, m.black, 0.03, 6)); // chicote
    for (const s of S) g.add(polyPipe([[0, 0.60, 0.54], [s * 0.06, 0.635, 0.545], [s * 0.14, 0.66, 0.555]], 0.008, m.black, 0.02, 6));
  }

  { // Freios: servo-freio, ABS e linhas rígidas até perto de cada roda
    const g = G('brakes'), m = mats('brakes');
    g.add(cyl(0.12, 0.10, 'z', -0.19, 0.52, -1.195, m.darkSteel, 28));               // servo-freio
    g.add(cyl(0.10, 0.02, 'z', -0.19, 0.52, -1.255, m.darkSteel, 28));
    g.add(cyl(0.022, 0.14, 'z', -0.19, 0.52, -1.33, m.alu, 12));                     // cilindro-mestre
    g.add(rbox(0.09, 0.06, 0.07, -0.19, 0.575, -1.32, m.white, 0.012));
    g.add(cyl(0.02, 0.014, 'y', -0.19, 0.61, -1.32, m.black, 12));
    g.add(rbox(0.11, 0.09, 0.09, -0.26, 0.33, -1.52, m.alu, 0.008));                 // módulo ABS
    g.add(cyl(0.035, 0.07, 'x', -0.345, 0.33, -1.52, m.darkSteel, 14));
    g.add(rbox(0.035, 0.09, 0.09, -0.1875, 0.33, -1.52, m.black, 0.006));
    const line = (pts) => g.add(polyPipe(pts, 0.003, m.copper, 0.02, 5));
    for (const o of [-0.012, 0.012]) line([[-0.19 + o, 0.50, -1.37], [-0.20 + o, 0.44, -1.44], [-0.25 + o, 0.40, -1.50], [-0.25 + o, 0.375, -1.52]]);
    // dianteiras: sobem para as longarinas e descem por um flexível até cada pinça
    const bracketF = BRAKE_BRACKETS.front, bracketR = BRAKE_BRACKETS.rear;
    line([[-0.28, 0.375, -1.50], [-0.34, 0.45, -1.46], [-0.44, 0.545, -1.40], bracketF[-1]]);
    line([[-0.24, 0.375, -1.50], [-0.10, 0.47, -1.47], [0.34, 0.47, -1.47], [0.44, 0.545, -1.40], bracketF[1]]);
    // traseiras: túnel central, parede atrás dos bancos e longarinas superiores
    for (const s of S) {
      const x = -0.039 + s * 0.005;
      line([[-0.25 + s * 0.01, 0.375, -1.545], [-0.14, 0.40, -1.42], [-0.075, 0.40, -1.30], [-0.06, 0.34, -1.16], [x, 0.305, -1.06],
        [x, 0.305, 0.40], [x, 0.33, 0.52], [x, 0.80, 0.545], [s * 0.42, 0.80, 0.555], [s * 0.455, 0.733, 0.62], [s * 0.455, 0.733, 1.25], bracketR[s]]);
    }
  }
}

// Funde as peças paradas de cada camada, depois que todos os módulos acrescentaram as suas
function finishMechanics() {
  for (const L of LAYERS) if (L.mech) mergeMeshes(L.mech);
}

export { ENGINE, BRAKE_BRACKETS, buildMechanics, finishMechanics };
