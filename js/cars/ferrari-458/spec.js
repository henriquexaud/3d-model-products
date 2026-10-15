// ---------- Ficha do carro: Ferrari 458 Italia ----------
// Tudo o que é próprio deste carro e que o resto do visualizador lê sem saber de qual carro se trata: o modelo 3D,
// as medidas de referência, as cores, as camadas com os textos e as medidas, a física, a suspensão, a câmera e o som.
// Só dados: quem monta e anima as peças é `rig.js`, ao lado

const meters = (v) => v.toFixed(1).replace('.', ',');

// Referências do modelo original, em metros (x: lateral, y: altura, z: comprimento; a frente aponta para -z)
const X0 = -0.006;                        // desvio lateral do modelo em relação ao centro
const AX_F = -1.155, AX_R = 1.496;        // eixos dianteiro e traseiro
const WHEEL_Y = 0.358;                    // altura do centro das rodas

export default {
  id: 'ferrari-458',
  name: 'Ferrari 458 Italia',

  model: {
    url: 'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r160/examples/models/gltf/ferrari.glb',
    draco: 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/libs/draco/gltf/',
    ao: 'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r160/examples/models/gltf/ferrari_ao.png',
    shadow: [0.655 * 4, 1.3 * 4],   // sombra de contato sob o carro: largura e comprimento (m)
  },

  frame: { x0: X0, axleFront: AX_F, axleRear: AX_R, wheelY: WHEEL_Y },

  // Cores da carroceria. Além do tom, cada tinta tem o seu acabamento sob o verniz: `metal` é o quanto ela reflete como metal,
  // `rough` o quanto espalha a luz e `flake` o quanto as lamelas cintilam (as tintas lisas quase não têm)
  colors: [
    { name: 'Vermelho Rubi', hex: 0xa4000f, metal: 0.42, rough: 0.46, flake: 0.6 },
    { name: 'Preto Ônix', hex: 0x08080a, metal: 0.55, rough: 0.5, flake: 0.6 },
    { name: 'Cinza Urbano', hex: 0x454a52, metal: 0.85, rough: 0.44, flake: 1 },
    { name: 'Branco Pérola', hex: 0xe4e4df, metal: 0.12, rough: 0.5, flake: 0.45 },
    { name: 'Azul Noturno', hex: 0x0b2552, metal: 0.72, rough: 0.44, flake: 1 },
  ],

  // Camadas do carro. `spot` é onde fica o ponto de informação (escolhe-se o lado mais próximo da câmera).
  // As medidas que só se conhecem depois de montadas as peças vêm em funções, que recebem o registro `measures`
  layers: [
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
              ['Tubulação', (m) => `Ø 32 mm · ${meters(m.coolant)} m por ramo`], ['Reservatório de expansão', '2 L'],
              ['Radiadores de óleo', '2 × 240 × 200 × 35 mm'], ['Condensador do ar-condicionado', '380 × 260 mm']] },
    { id: 'fuel', name: 'Combustível', chip: 'Combustível', spot: [[-0.59, 0.66, 0.82], [0.59, 0.66, 0.82]],
      text: 'Dois tanques de alumínio, um de cada lado, entre a cabine e as rodas traseiras — a região mais protegida do carro. Um tubo de equilíbrio mantém o mesmo nível nos dois.',
      specs: [['Capacidade', '86 L (2 × 43 L)'], ['Cada tanque', '240 × 390 × 460 mm'], ['Bocal de abastecimento', 'Ø 50 mm, lado esquerdo'],
              ['Injeção', 'Direta, 8 injetores'], ['Galerias de combustível', '2 × Ø 18 mm']] },
    { id: 'electric', name: 'Elétrica', chip: 'Elétrica', spot: [[0.22, 0.44, -1.565]],
      text: 'A bateria fica na dianteira para equilibrar o peso; o cabo principal atravessa o túnel até o motor de partida. O alternador é acionado pela correia do motor. Da caixa de fusíveis saem os chicotes para faróis, eletroventiladores, buzinas, bobinas e lanternas.',
      specs: [['Bateria de 12 V', '278 × 175 × 190 mm'], ['Cabo principal', (m) => `Ø 16 mm · ${meters(m.cable)} m`],
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
      specs: [['Discos dianteiros', (m) => m.discF], ['Discos traseiros', (m) => m.discR],
              ['Pistões por pinça diant. / tras.', '6 / 4'], ['Servo-freio', 'Ø 240 mm'], ['Linhas rígidas', 'Ø 6 mm']] },
  ],

  // Física em linha reta (ver physics.js). Unidades do SI
  physics: {
    mass: 1610,                           // kg, com motorista e meio tanque
    wheelbase: 2.651, cgHeight: 0.46,     // m
    rearShare: 0.58,                      // parte do peso sobre o eixo traseiro, que é o que traciona
    wheelRadius: 0.358,                   // m
    drag: 0.36, frontalArea: 2.03,        // coeficiente de arrasto e área frontal (m²), com a capota aberta
    downforceArea: 0.74,                  // o ar também aperta o carro contra o chão: ~140 kg a 200 km/h
    airDensity: 1.2,                      // kg/m³
    rolling: 0.011, rollingSpeed: 44.4,   // rolagem dos pneus: f · (1 + v / 160 km/h) · peso
    grip: 1.1,                            // aderência pneu-asfalto seco
    gears: [3.08, 2.19, 1.63, 1.29, 1.03, 0.84, 0.69], finalDrive: 5.14, efficiency: 0.88,
    idle: 900, redline: 9000,             // rpm
    torque: [[900, 320], [2000, 400], [3000, 450], [4000, 490], [5000, 525], [6000, 540], [7000, 530], [8000, 495], [9000, 445]],   // N·m
    topSpeed: 320 / 3.6,                  // m/s
    steering: 11.9,                       // quanto o volante gira para cada grau das rodas da frente
  },

  // Suspensão em movimento (ver ride.js). Rodas na ordem DE, DD, TE, TD
  ride: {
    unsprung: [45, 45, 52, 52],          // kg de roda, pneu, freio e manga em cada canto
    track: [1.672, 1.638],               // bitola dianteira e traseira (m)
    pitchInertia: 2180, rollInertia: 430,   // kg·m²
    frequency: [1.75, 2.0],              // Hz: balanço próprio da carroceria sobre o eixo dianteiro e o traseiro
    damping: 0.7,                       // fração do amortecimento crítico nos movimentos lentos, que são os da carroceria...
    knee: 0.13, fast: 0.4,               // ...acima de 0,13 m/s o amortecedor cede, para a roda engolir os ressaltos sem sacudir o carro
    bump: 0.75, rebound: 1.25,           // mais macio quando a roda sobe, mais firme quando ela volta
    antiPitch: 0.3,                      // parte do peso transferido que os braços seguram sem comprimir as molas
    settle: 0.15,                        // s: tempo em que o carro "assenta" sobre as ondulações longas da pista
    antiRoll: [26000, 16000],            // N/m: barras estabilizadoras, que só agem quando um lado sobe mais que o outro
    tyre: 290000, tyreDamping: 350,      // N/m e N·s/m: o pneu
    stop: 0.06,                          // curso até o batente (m)
    aeroFront: 0.45,                     // parte da pressão do ar que cai sobre o eixo dianteiro
    rollArm: 0.34,                       // altura do centro de massa acima do eixo em torno do qual a carroceria rola nas curvas (m)
    pivotHeight: 0.12,                   // a carroceria inclina em torno de um ponto baixo, sob o centro de massa (m)
  },

  // Câmera: de fora, o carro inteiro cabe na tela; de dentro, os olhos do motorista
  view: {
    target: [0, 0.5, 0], from: [4.25, 0.9, -4.5],   // para onde a câmera olha e de que direção, ao abrir
    fit: 6.25, halfLength: 2.5,                     // distância mínima ao abrir e meio comprimento a caber na largura da tela
    near: { solid: 2.5, open: 1.2 },                // quão perto a câmera chega com a carroceria sólida e sem ela
    pan: { min: [-0.8, 0.2, -1.9], max: [0.8, 0.9, 1.9] },   // o ponto de vista se desloca sem sair de cima do carro
    seat: { target: [-0.36, 0.97, 0.17], eye: [-0.36, 0.98, 0.22] },
  },

  // Som do motor (ver sound.js). Loops de rotação constante recortados de gravações reais do V8 de virabrequim plano
  // da família F136: a 458 Italia arrancando (de 3.000 a 8.900 rpm, sob carga), a F430 em marcha lenta e a Scuderia 16M
  // a 2.000 rpm. Cada arquivo tem o loop três vezes seguidas: `period` é a duração de um (ver audio/ferrari-458/CREDITOS.md)
  sound: {
    base: 'audio/ferrari-458/',
    cylinders: 8,
    idle: { file: 'idle', rpm: 1060, period: 1.92483 },
    loops: [
      { file: 'on2000', rpm: 2043, period: 0.352472 },
      { file: 'on3000', rpm: 2983, period: 1.247188 },
      { file: 'on3900', rpm: 3870, period: 0.372132 },
      { file: 'on5000', rpm: 5068, period: 0.142063 },
      { file: 'on6000', rpm: 6089, period: 0.137959 },
      { file: 'on7000', rpm: 7129, period: 0.134671 },
      { file: 'on8000', rpm: 7951, period: 0.211293 },
      { file: 'on8850', rpm: 8924, period: 0.457188 },
    ],
    exhaust: [0, 0.45, 2.05],   // de onde sai o som, no carro (m): as saídas do escape, atrás
    // A partida, gravada de uma Ferrari de verdade: o motor de partida gira até `catch`, o motor pega e sobe até `peak`
    // (s, rpm), assenta na marcha lenta fria (`idle`) em `settled`; entre `blend[0]` e `blend[1]` a gravação dá lugar aos loops
    start: { file: 'start', catch: 1.05, peak: [1.45, 1850], idle: 1190, settled: 2.7, blend: [3.3, 3.8] },
    // estalos do escape, gravados: `count` vagas de `slot` s seguidas, cada estalo `lead` s depois do começo da sua vaga
    pops: { file: 'pops', count: 7, slot: 0.3, lead: 0.06 },
  },
};

// as peças feitas sob medida para este modelo (nesta pasta) usam as referências diretamente
export { X0, AX_F, AX_R, WHEEL_Y };
