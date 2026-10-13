const ASSETS = 'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r160/examples/models/gltf/';
const DRACO = 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/libs/draco/gltf/';

const COLORS = [
  { name: 'Vermelho Rubi', hex: 0xb00012 },
  { name: 'Preto Ônix', hex: 0x0b0b0d },
  { name: 'Cinza Urbano', hex: 0x4a4f57 },
  { name: 'Branco Pérola', hex: 0xe9e9e6 },
  { name: 'Azul Noturno', hex: 0x0d2a5c },
];
const ENVS = [
  // ao ar livre: a praça, com o carro parado, e a estrada, com ele em movimento
  { name: 'Praça', swatch: 'linear-gradient(#7fb2e5 55%, #5c8a3c 55%)', scenery: 'praca', exposure: 0.56, ghost: 0x16202b },
  { name: 'Estrada', swatch: 'linear-gradient(#7fb2e5 52%, #4b4d51 52%)', scenery: 'road', exposure: 0.56, ghost: 0x16202b },
  // estúdio: cor do piso, traço e força da malha, luz sob o carro e o degradê do fundo (horizonte, parede, teto)
  { name: 'Estúdio', swatch: '#c9ccd2', exposure: 0.95, ghost: 0x1b2330,
    floor: 0xb9bcc3, line: 0x4f6480, grid: 0.24, pool: 1.08, horizon: 0xd3d6db, wall: 0xb4b7be, zenith: 0x8d9097 },
  { name: 'Noite', swatch: '#15171c', exposure: 0.8, ghost: 0xdce6ff,
    floor: 0x0e0f13, line: 0x7f9fd0, grid: 0.09, pool: 2.2, horizon: 0x262a33, wall: 0x14161b, zenith: 0x060709 },
];

// Celulares e tablets recebem uma cena mais leve: vidro simples, menos folhas e grama, sombras menores
const LITE = window.matchMedia('(pointer: coarse)').matches;

// Referências do modelo original, em metros (x: lateral, y: altura, z: comprimento; a frente aponta para -z)
const X0 = -0.006;                        // desvio lateral do modelo em relação ao centro
const AX_F = -1.155, AX_R = 1.496;        // eixos dianteiro e traseiro
const WHEEL_Y = 0.358;                    // altura do centro das rodas

// Camadas do carro. `spot` é onde fica o ponto de informação (escolhe-se o lado mais próximo da câmera)
const measures = {};
const mm = (v) => Math.round(v * 1000).toLocaleString('pt-BR');
const meters = (v) => v.toFixed(1).replace('.', ',');
const LAYERS = [
  { id: 'body', name: 'Carroceria', exterior: true, spot: [[0, 0.80, -1.45]], normal: [0, 0.97, -0.24],
    text: 'Conversível de dois lugares com motor central-traseiro. É a casca que cobre todas as outras camadas: escolha Raio-X ou Oculta para ver o que há por baixo.',
    specs: [['Comprimento', '4.523 mm'], ['Largura', '1.946 mm'], ['Largura com retrovisores', '2.270 mm'], ['Altura', '1.236 mm'],
            ['Entre-eixos', '2.651 mm'], ['Bitola diant. / tras.', '1.672 / 1.638 mm'], ['Vão livre do solo', '150 mm']] },
  { id: 'interior', name: 'Interior', chip: 'Interior' },
  { id: 'wheels', name: 'Rodas e pneus', chip: 'Rodas', exterior: true,
    spot: [[-0.985, 0.64, AX_F], [0.985, 0.64, AX_F]], normal: [1, 0, 0],
    text: 'Rodas de liga leve com pneus de perfil baixo. Os traseiros são mais largos, porque é por eles que passa toda a força do motor.',
    specs: [['Diâmetro da roda', '565 mm'], ['Diâmetro do pneu', '716 mm'], ['Largura diant. / tras.', '247 / 272 mm'],
            ['Inscrição diant. / tras.', '235/35 ZR20 · 295/35 ZR20'],
            ['Altura do eixo', '358 mm']] },
  { id: 'chassis', name: 'Chassi', chip: 'Chassi', spot: [[-0.765, 0.37, 0.10], [0.765, 0.37, 0.10]],
    text: 'Estrutura tubular de alumínio. Soleiras, colunas e travessas formam a célula da cabine; as longarinas dianteiras e traseiras sustentam suspensão, motor e barras de impacto.',
    specs: [['Soleiras', '100 × 160 mm · 1,84 m'], ['Longarinas dianteiras', '70 × 100 mm'], ['Longarinas traseiras', '60 × 80 mm'],
            ['Barras de impacto diant. / tras.', 'Ø 80 / 70 mm'], ['Arcos de proteção', 'Ø 44 mm']] },
  { id: 'engine', name: 'Motor', chip: 'Motor', spot: [[0, 0.85, 0.86]],
    text: 'V8 aspirado montado no sentido do comprimento, logo atrás da cabine. As bancadas formam um V de 90°, com a admissão no centro e o escape saindo pelas laterais.',
    specs: [['Arquitetura', 'V8 a 90°, 32 válvulas'], ['Cilindrada', '4.499 cm³'], ['Diâmetro × curso', '94 × 81 mm'],
            ['Entre centros dos cilindros', '104 mm'], ['Comprimento do bloco', '480 mm'], ['Conjunto (C × L × A)', '570 × 670 × 615 mm'],
            ['Lubrificação', 'Cárter seco, com bomba de recalque'], ['Reservatório de óleo', 'Ø 150 × 280 mm'],
            ['Acessórios', 'Bomba d\'água, compressor e alternador, em uma correia'], ['Coxins', '2, apoiados nas longarinas']] },
  { id: 'trans', name: 'Transmissão', chip: 'Câmbio', spot: [[0, 0.60, 1.47]],
    text: 'Caixa de dupla embreagem e diferencial em um só conjunto, fixado atrás do motor. Os semieixos saem alinhados com as rodas traseiras.',
    specs: [['Tipo', 'Dupla embreagem, 7 marchas'], ['Carcaça (C × L × A)', '760 × 360 × 320 mm'], ['Campana da embreagem', 'Ø 310 mm'],
            ['Semieixos', 'Ø 32 mm · 540 mm'], ['Juntas homocinéticas', 'Ø 90 mm']] },
  { id: 'exhaust', name: 'Escapamento', chip: 'Escape', spot: [[0, 0.71, 1.93]],
    text: 'Cada bancada tem quatro tubos primários que se unem em um coletor, passam pelo catalisador e chegam ao silencioso transversal, com três saídas centrais.',
    specs: [['Primários', '8 × Ø 43 mm'], ['Intermediários', 'Ø 65 mm'], ['Catalisadores', '2 × Ø 120 × 220 mm'],
            ['Silencioso', '780 × 190 × 160 mm'], ['Saídas', '3 × Ø 72 mm']] },
  { id: 'cooling', name: 'Arrefecimento', chip: 'Arrefecimento', spot: [[-0.50, 0.55, -1.88], [0.50, 0.55, -1.88]],
    text: 'Dois radiadores na dianteira recebem ar pelas entradas do para-choque; quando o carro anda devagar, os eletroventiladores puxam o ar. O líquido percorre o túnel central até o motor, e por ele também passam as linhas do ar-condicionado. Dois radiadores de óleo ficam nos cantos traseiros.',
    specs: [['Radiadores de água', '2 × 400 × 300 × 40 mm'], ['Eletroventiladores', '2 × Ø 270 mm'],
            ['Tubulação', () => `Ø 32 mm · ${meters(measures.coolant)} m por ramo`], ['Reservatório de expansão', '2 L'],
            ['Radiadores de óleo', '2 × 240 × 200 × 35 mm'], ['Condensador do ar-condicionado', '380 × 260 mm']] },
  { id: 'fuel', name: 'Combustível', chip: 'Combustível', spot: [[-0.59, 0.66, 0.82], [0.59, 0.66, 0.82]],
    text: 'Dois tanques de alumínio, um de cada lado, entre a cabine e as rodas traseiras — a região mais protegida do carro. Um tubo de equilíbrio mantém o mesmo nível nos dois.',
    specs: [['Capacidade', '86 L (2 × 43 L)'], ['Cada tanque', '240 × 390 × 460 mm'], ['Bocal de abastecimento', 'Ø 50 mm, lado esquerdo'],
            ['Injeção', 'Direta, 8 injetores'], ['Galerias de combustível', '2 × Ø 18 mm']] },
  { id: 'electric', name: 'Elétrica', chip: 'Elétrica', spot: [[0.22, 0.44, -1.565]],
    text: 'A bateria fica na dianteira para equilibrar o peso; o cabo principal atravessa o túnel até o motor de partida. O alternador é acionado pela correia do motor. Da caixa de fusíveis saem os chicotes para faróis, eletroventiladores, buzinas, bobinas e lanternas.',
    specs: [['Bateria de 12 V', '278 × 175 × 190 mm'], ['Cabo principal', () => `Ø 16 mm · ${meters(measures.cable)} m`],
            ['Alternador', 'Ø 130 × 120 mm'], ['Motor de partida', 'Ø 85 × 170 mm'], ['Centrais do motor', '2 × 200 × 150 × 35 mm'],
            ['Fusíveis e relés', '27 fusíveis · 3 relés'], ['Sensores de rotação das rodas', '4'], ['Limpador', 'Motor com redutor e haste entre os eixos']] },
  { id: 'susp', name: 'Suspensão e direção', chip: 'Suspensão', spot: [[-0.50, 0.76, -1.205], [0.50, 0.76, -1.205]],
    text: 'Braços triangulares sobrepostos nas quatro rodas, com mola e amortecedor em um só conjunto. Na Estrada, cada roda sobe e desce com o relevo da pista: os braços giram nas buchas, a mola encolhe e a barra estabilizadora torce. A caixa de direção fica à frente do eixo dianteiro e liga-se ao volante pela coluna.',
    specs: [['Braços', 'Triângulos sobrepostos'], ['Molas', 'Ø 84 mm, fio de 12 mm'], ['Amortecedores', 'Ø 46 mm'],
            ['Comprimento diant. / tras.', '510 / 605 mm'], ['Barras estabilizadoras', 'Ø 24 / 22 mm'], ['Cremalheira de direção', '600 mm'],
            ['Balanço próprio diant. / tras.', '1,75 / 2,0 Hz'], ['Curso até o batente', '60 mm']] },
  { id: 'brakes', name: 'Freios', chip: 'Freios', exterior: true,
    spot: [[-0.985, 0.50, AX_R], [0.985, 0.50, AX_R]], normal: [1, 0, 0],
    text: 'Discos nas quatro rodas com pinças fixas. O servo-freio e o módulo ABS ficam na dianteira, de onde saem as linhas rígidas para cada roda.',
    specs: [['Discos dianteiros', () => measures.discF], ['Discos traseiros', () => measures.discR],
            ['Pistões por pinça diant. / tras.', '6 / 4'], ['Servo-freio', 'Ø 240 mm'], ['Linhas rígidas', 'Ø 6 mm']] },
];
const layers = Object.fromEntries(LAYERS.map((L) => [L.id, L]));

const state = {
  view: 'exterior', body: 'solid', spots: true, lights: true, color: COLORS[0], env: ENVS[0], open: null, fit: 6.25,
  on: Object.fromEntries(LAYERS.filter((L) => L.id !== 'body').map((L) => [L.id, true])),
};

const $ = (id) => document.getElementById(id);
const statusEl = $('status');
const hintEl = $('hint'), hintText = hintEl.firstElementChild;

export {
  ASSETS, DRACO, COLORS, ENVS, LITE, X0, AX_F, AX_R, WHEEL_Y, measures, mm, meters, LAYERS, layers,
  state, $, statusEl, hintEl, hintText,
};
