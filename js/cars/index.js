import ferrari458 from './ferrari-458/spec.js';

// ---------- Catálogo de carros ----------
// Cada carro é uma pasta com a ficha (`spec.js`: só dados) e a montagem (`rig.js`: as peças e como elas se movem).
// Os cenários, a física, a interface e o som leem só a ficha do carro escolhido, sem saber qual é. Para trazer outro
// modelo, basta uma pasta nova com os dois arquivos, a ficha aqui e a montagem em car.js; `?car=<id>` no endereço o escolhe
const CARS = [ferrari458];
const asked = new URLSearchParams(location.search).get('car');
const spec = CARS.find((c) => c.id === asked) ?? CARS[0];

export { CARS, spec };
