# Som do motor — créditos e licença

## Loops do motor

Os loops desta pasta foram recortados de gravações reais do V8 de virabrequim plano da família Ferrari F136,
feitas por **Edvvc** no Goodwood Festival of Speed e publicadas no Wikimedia Commons sob a licença
[Creative Commons Atribuição-CompartilhaIgual 3.0 (CC BY-SA 3.0)](https://creativecommons.org/licenses/by-sa/3.0/deed.pt_BR).

| Arquivo | Rotação | Origem |
|---|---|---|
| `idle.mp3` | 1.060 rpm, marcha lenta | [Ferrari F430 (2010).ogg](https://commons.wikimedia.org/wiki/File:Ferrari_F430_(2010).ogg), 0,25–2,25 s |
| `on2000.mp3` | 2.043 rpm, sob carga | [Ferrari Scuderia Spider 16M.ogg](https://commons.wikimedia.org/wiki/File:Ferrari_Scuderia_Spider_16M.ogg), 2,22–2,62 s |
| `on3000.mp3` | 2.983 rpm | [Ferrari 458 Italia.ogg](https://commons.wikimedia.org/wiki/File:Ferrari_458_Italia.ogg), 0,55–1,85 s (rotação segurada antes da largada) |
| `on3900.mp3` … `on8850.mp3` | 3.870 a 8.924 rpm, sob carga | [Ferrari 458 Italia.ogg](https://commons.wikimedia.org/wiki/File:Ferrari_458_Italia.ogg), 2,2–4,45 s (arrancada em 1ª marcha) |

**Modificações:** mixagem em mono, filtro passa-altas em 28 Hz, correção da variação de rotação dentro de cada trecho
(reamostragem com velocidade variável, para a rotação ficar constante), fechamento do loop em um número inteiro de ciclos
do motor com cruzamento suave, normalização de volume e repetição do loop três vezes em cada arquivo. A rotação de cada
loop foi medida pela frequência de ignição (4ª ordem: rpm = 15 × Hz).

Estes loops derivados são distribuídos sob a mesma licença CC BY-SA 3.0.

## Partida e estalos

| Arquivo | O que é | Origem e licença |
|---|---|---|
| `start.mp3` | Partida de uma Ferrari: motor de partida, o motor pega, sobe de giro e assenta na marcha lenta fria (0–4,4 s) | [“Ferrari Engine On Front”](https://freesound.org/people/Oscar_Patrick/sounds/812434/), de **Oscar_Patrick**, no Freesound — [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/deed.pt_BR) |
| `pops.mp3` | 7 estalos de escape isolados, um a cada 0,3 s (cada um começa 0,06 s depois do início da sua vaga) | [“Car Antilag (No cleanup, 32float)”](https://freesound.org/people/modusmogulus/sounds/797835/), de **modusmogulus**, no Freesound — [CC0](https://creativecommons.org/publicdomain/zero/1.0/deed.pt_BR) |

**Modificações:** mixagem em mono, filtro passa-altas, recorte dos trechos, entrada e saída suaves e normalização de volume
(a marcha lenta da partida no mesmo volume dos loops; cada estalo com o mesmo pico).

O restante do som (pneus, vento, juntas da pista e os reflexos da estrada) é sintetizado no navegador, em `js/sound.js`.
