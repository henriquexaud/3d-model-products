// ---------- Relevo da estrada ----------
// O chão sob as rodas, na Estrada. É do cenário, não do carro: a suspensão de qualquer carro (ride.js) o percorre igual,
// o cenário (road.js) desenha as marcas das irregularidades e o som (sound.js) ouve as rodas passando pelas juntas

// Relevo da pista. O asfalto bom tem ondulações de todos os comprimentos, mais altas quanto mais longas (norma ISO 8608,
// classe A, bem suave); os dois trilhos de roda são parecidos nas ondas longas e independentes nas curtas. O relevo é ruído,
// não uma soma de senos: nunca se repete, e o carro não balança no mesmo ritmo a cada tantos segundos
const LOOP = 480;   // as juntas e os remendos voltam a cada volta do cenário (m), mas cada passagem é um pouco diferente
const FEATURES = [
  { at: 46, kind: 'joint' },               // junta de dilatação: ressalto estreito de até 8 mm nos dois trilhos
  { at: 121, kind: 'patch', side: 1 },     // remendo de até 6 mm de altura e 3 m de comprimento, em um trilho só
  { at: 204, kind: 'dip' },                // depressão suave de até 16 mm ao longo de 18 m
  { at: 268, kind: 'joint' },
  { at: 337, kind: 'patch', side: -1 },
  { at: 409, kind: 'joint' },
];
// número pseudoaleatório entre -1 e 1 para o inteiro `i` da sequência `s`
const hash = (i, s) => {
  let h = Math.imul(i, 374761393) + Math.imul(s, 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 2147483647.5 - 1;
};
// ruído de valor: sorteia uma altura a cada metro e passa por elas em curva suave
const noise = (x, s) => {
  const i = Math.floor(x), f = x - i, u = f * f * f * (f * (f * 6 - 15) + 10);
  return hash(i, s) + (hash(i + 1, s) - hash(i, s)) * u;
};
const NOISE_STD = (() => {   // desvio do ruído, medido uma vez, para cada faixa de ondas ter a altura da norma
  let v = 0;
  for (let k = 0; k < 4096; k++) v += noise(k * 0.377, 9) ** 2;
  return Math.sqrt(v / 4096);
})();
const bands = [];
for (let k = 0; k < 6; k++) {   // faixas de uma oitava, de ondas de 12,5 m a 40 cm
  const wave = 12.5 / 2 ** k, n = 1.5 / wave, apart = Math.min(0.7, 0.25 + 0.5 * n);
  const amp = 0.85 * Math.sqrt(1.1e-7 / (1 / wave)) / NOISE_STD;   // variância da faixa: ∫ 2,2e-7/n² dn, com 15% a menos
  bands.push({ scale: 2 / wave, shift: k * 17.31, both: amp * Math.sqrt(1 - apart * apart), apart: amp * apart });
}
const ramp = (x, a, b) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
// Altura da pista (m) no ponto `x` do percurso, no trilho esquerdo (side = -1) ou direito (+1)
function roadHeight(x, side) {
  let h = 0;
  for (let k = 0; k < bands.length; k++) {
    const b = bands[k], at = x * b.scale + b.shift;
    h += b.both * noise(at, k) + b.apart * noise(at, side > 0 ? 40 + k : 80 + k);
  }
  h *= ramp(x, 0, 6);   // a saída é sempre de um trecho liso
  for (let j = 0; j < FEATURES.length; j++) {
    const f = FEATURES[j], lap = Math.round((x - f.at) / LOOP), u = x - f.at - lap * LOOP;
    const size = 0.25 + 0.75 * hash(lap, 200 + j) ** 2;   // a cada volta a junta assentou de um jeito: umas quase lisas, outras marcadas
    if (f.kind === 'joint') h += 0.008 * size * Math.exp(-((u / 0.10) ** 2));
    else if (f.kind === 'patch' && f.side === side) h += 0.006 * size * ramp(u, 0, 0.4) * (1 - ramp(u, 2.6, 3));
    else if (f.kind === 'dip' && u > 0 && u < 18) h -= 0.008 * size * (1 - Math.cos(2 * Math.PI * u / 18));
  }
  return h;
}

// Chama `visit(tamanho)` para cada junta de dilatação que fica entre os pontos `from` e `to` do percurso (m)
function jointsBetween(from, to, visit) {
  if (!(to > from)) return;
  for (let j = 0; j < FEATURES.length; j++) {
    const f = FEATURES[j];
    if (f.kind !== 'joint') continue;
    for (let lap = Math.ceil((from - f.at) / LOOP); f.at + lap * LOOP <= to; lap++) {
      if (f.at + lap * LOOP > from) visit(0.25 + 0.75 * hash(lap, 200 + j) ** 2);
    }
  }
}

export { LOOP, FEATURES, roadHeight, jointsBetween };
