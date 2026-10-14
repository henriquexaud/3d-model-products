import { LITE, ASKED } from './config.js';

// ---------- Ritmo ----------
// Um quadro só é desenhado quando há algo novo para mostrar: a câmera se mexeu, o carro anda, uma luz acende, a interface
// trocou alguma coisa. Com tudo parado, a tela continua mostrando o último quadro e o aparelho descansa. Se ele não dá conta
// de manter o movimento fluido, a definição da imagem cede um degrau, e volta quando sobra fôlego. E o trabalho longo,
// como montar um cenário, é feito em pedaços entre um quadro e outro, para a página nunca travar

let due = 2;   // quadros que ainda precisam ser desenhados
function invalidate(frames = 2) {
  if (frames > due) due = frames;
}
// Gasta um dos quadros pedidos; diz se este precisa ser desenhado
function consume() {
  if (due <= 0) return false;
  due--;
  return true;
}
// qualquer toque, clique ou tecla pode mudar o que se vê: por meio segundo tudo é redesenhado
const wake = () => invalidate(30);
for (const type of ['pointerdown', 'pointerup', 'pointerover', 'pointerout', 'wheel', 'keydown', 'keyup', 'click', 'input', 'change']) {
  window.addEventListener(type, wake, { capture: true, passive: true });
}
window.addEventListener('pointermove', (e) => { if (e.buttons) wake(); }, { capture: true, passive: true });
window.addEventListener('resize', wake);
document.addEventListener('visibilitychange', wake);

// Definição: parte da do aparelho (até 2 pixels por ponto) e desce por degraus. Contam só os intervalos entre dois quadros
// desenhados um depois do outro, e só depois que a cena está pronta (montar e compilar não é falta de fôlego). Se a mediana
// passa do limite, cai um degrau; depois de alguns segundos folgados tenta subir, mas não volta logo a um degrau que falhou.
// O limite é de 45 quadros por segundo, ou um pouco abaixo do que a tela permite, se ela for mais lenta que isso
const BEST = Math.min(window.devicePixelRatio || 1, 2);
const STEPS = [1, 0.86, 0.74, 0.62];
const pixel = { value: BEST };   // pixels por ponto em uso, para o que é medido em pixels na tela (as estrelas)
// (`fixed` congela a definição, para medir o custo de um quadro sem que ela mude no meio)
const gauge = { level: 0, ready: false, fixed: ASKED.has('fixed'), gaps: [], calm: 0, last: 0, drew: false, vsync: Infinity, failed: new Map(), apply: null };
function setLevel(level) {
  gauge.level = level;
  pixel.value = BEST * STEPS[level];
  gauge.apply?.(pixel.value);
  gauge.gaps.length = 0;
  invalidate(2);
}
// Chamado a cada volta do laço de quadros, tenha ele desenhado ou não
function measure(drew) {
  const now = performance.now(), gap = now - gauge.last;
  if (drew && gauge.drew && gauge.ready && gap < 120 && !jobs.some((j) => j.urgent)) {
    gauge.gaps.push(gap);
    gauge.vsync = Math.min(gauge.vsync, gap);
  }
  gauge.last = now;
  gauge.drew = drew;
  if (gauge.gaps.length < 40 || gauge.fixed) return;
  const sorted = gauge.gaps.slice().sort((a, b) => a - b), median = sorted[sorted.length >> 1], spent = gauge.gaps.reduce((a, b) => a + b, 0);
  gauge.gaps.length = 0;
  const limit = Math.max(1000 / 45, gauge.vsync * 1.35);
  if (median > limit && gauge.level < STEPS.length - 1) {
    gauge.failed.set(gauge.level, now);
    gauge.calm = 0;
    setLevel(gauge.level + 1);
  } else if (median < limit * 0.72) {
    gauge.calm += spent;
    const lastFail = gauge.failed.get(gauge.level - 1) ?? -Infinity;
    if (gauge.level > 0 && gauge.calm > 4000 && now - lastFail > 20000) {
      gauge.calm = 0;
      setLevel(gauge.level - 1);
    }
  } else gauge.calm = 0;
}
// `apply` troca a definição do desenho; `ready` liga a medição, depois que a cena está montada e compilada
function governResolution(apply) {
  gauge.apply = apply;
  apply(pixel.value);
}
function settle(ready) {
  gauge.ready = ready;
  gauge.gaps.length = 0;
}

// Trabalho em pedaços. Cada trabalho é um gerador: entre um `yield` e outro, a página volta a respirar. Um `yield` de uma
// promessa espera por ela (a compilação dos materiais, por exemplo). O trabalho urgente, aquele que a pessoa está esperando,
// avança em pedaços maiores e na frente dos outros; o resto anda só quando o navegador está ocioso
const jobs = [];
let kicked = false;
function kick() {
  if (kicked) return;
  kicked = true;
  const next = jobs.find((j) => !j.waiting);
  if (!next) { kicked = false; return; }
  if (next.urgent || !window.requestIdleCallback) setTimeout(work, next.urgent ? 0 : 30);
  else requestIdleCallback(work, { timeout: 400 });
}
function work(idle) {
  kicked = false;
  const job = jobs.find((j) => j.urgent && !j.waiting) ?? jobs.find((j) => !j.waiting);
  if (!job) return;
  const start = performance.now();
  const budget = job.urgent ? (LITE ? 30 : 22) : Math.min(idle?.timeRemaining?.() ?? 8, 10);
  try {
    do {
      const { done, value } = job.steps.next();
      if (done) {
        jobs.splice(jobs.indexOf(job), 1);
        job.resolve(value);
        break;
      }
      if (value && typeof value.then === 'function') {
        job.waiting = true;
        value.then(() => { job.waiting = false; kick(); }, (error) => { jobs.splice(jobs.indexOf(job), 1); job.reject(error); kick(); });
        break;
      }
    } while (performance.now() - start < budget);
  } catch (error) {
    jobs.splice(jobs.indexOf(job), 1);
    job.reject(error);
  }
  kick();
}
// Põe um trabalho na fila. Devolve uma promessa com o resultado dele e `hurry()`, que o torna urgente
function schedule(steps, urgent = false) {
  const job = { steps, urgent, waiting: false };
  job.promise = new Promise((resolve, reject) => { job.resolve = resolve; job.reject = reject; });
  jobs.push(job);
  kick();
  return { promise: job.promise, hurry() { job.urgent = true; kick(); } };
}
// Uma pausa de `ms` milissegundos; num trabalho, `yield later(ms)` espera mais do que um `yield` vazio
const later = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export { invalidate, consume, measure, governResolution, settle, pixel, gauge, schedule, later };
