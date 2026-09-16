// Visual randomness never changes the game clock, growth rules, or harvest state.
export const SCENE = Object.freeze({ width: 300, height: 330, minimumWidth: 250, hitSize: 48 });
// minimumScale is the supported 320×568-and-larger phone baseline for tests;
// the UI may scale further on unusually small screens instead of clipping.
export const FIELD = Object.freeze({ width: 300, height: 360, hitSize: 44, minimumScale: .8, leafScale: .4, leafSize: 1.35 });
export function fieldPlantOrigin(index) {
  return [{ x: 150, y: 205 }, { x: 84, y: 125 }, { x: 219, y: 125 }, { x: 84, y: 290 }, { x: 219, y: 290 }][index];
}
export const FRUIT_CLEARANCE = 46;
const RELOCATION_RADIUS = 18;

export function createRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}
const between = (random, low, high) => low + random() * (high - low);
const number = value => Math.round(value * 100) / 100;

export function sampleBreeze(elapsed) {
  // Slow, irregular gusts share one direction across the whole field. The
  // interpolation has zero velocity and acceleration at each join.
  const time = Math.max(0, elapsed) / 11;
  const segment = Math.floor(time);
  const fraction = time - segment;
  const eased = fraction ** 3 * (fraction * (fraction * 6 - 15) + 10);
  const strength = index => index === 0 ? 0 : .08 + .92 * createRandom(index + 29413)() ** 2;
  return strength(segment) + (strength(segment + 1) - strength(segment)) * eased;
}

function petiolePath(crown, x, y, angle) {
  const radians = angle * Math.PI / 180;
  return `M${number(crown.x)} ${number(crown.y)} C${number(crown.x + (x - crown.x) * .25)} ${number(Math.min(y + 70, crown.y - 30))} ${number(x - Math.sin(radians) * 28)} ${number(y + Math.cos(radians) * 28)} ${number(x)} ${number(y)}`;
}

export function leafPose(layout, leaf, breeze = 0) {
  const flexibility = Math.min(1, .45 + (layout.crown.y - leaf.y) * .003);
  const bend = Math.max(0, Math.min(1, breeze)) * flexibility;
  const x = leaf.x + bend * 1.3 / FIELD.leafScale;
  const y = leaf.y - bend * .22 / FIELD.leafScale;
  const angle = leaf.angle + bend * .65;
  return {
    x: layout.fieldCrown.x + (x - layout.crown.x) * FIELD.leafScale,
    y: layout.fieldCrown.y + (y - layout.crown.y) * FIELD.leafScale,
    angle,
    path: petiolePath(layout.crown, x, y, angle),
  };
}

function clearPoint(points, x, y, ignore) {
  return x >= 28 && x <= 272 && y >= 28 && y <= 326 && points.every((point, index) => index === ignore || Math.abs(point.x - x) >= FRUIT_CLEARANCE || Math.abs(point.y - y) >= FRUIT_CLEARANCE);
}
function alignmentCost(points, x, y, ignore) {
  // Penalize shared horizontal/vertical bands without prescribing new rows.
  return points.reduce((cost, point, index) => cost + (index === ignore ? 0
    : Math.max(0, 1 - Math.abs(point.x - x) / 10) ** 2 + Math.max(0, 1 - Math.abs(point.y - y) / 10) ** 2), 0);
}
export function createFieldLayout(seed) {
  const random = createRandom(seed);
  const points = [];
  // Seven random vacancies let fruit move between bands. A full 5-by-7
  // starting grid traps them in rows even after many collision-safe moves.
  const cells = Array.from({ length: 42 }, (_, index) => index);
  for (let index = cells.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [cells[index], cells[other]] = [cells[other], cells[index]];
  }
  for (const cell of cells.slice(0, 35)) {
    points.push({ x: 28 + cell % 6 * 244 / 5, y: 28 + Math.floor(cell / 6) * 298 / 6 });
  }
  for (let step = 0; step < 22000; step++) {
    const index = Math.floor(random() * points.length);
    const point = points[index];
    const globalMove = step % 4 === 0;
    const x = globalMove ? between(random, 28, 272) : point.x + between(random, -24, 24);
    const y = globalMove ? between(random, 28, 326) : point.y + between(random, -24, 24);
    if (!clearPoint(points, x, y, index)) continue;
    const improvement = alignmentCost(points, point.x, point.y, index) - alignmentCost(points, x, y, index);
    // Keep some less favorable moves so the packing can escape local ruts.
    if (random() < Math.exp(improvement * 4)) { point.x = x; point.y = y; }
  }
  const cost = (point, plant) => {
    const crown = fieldPlantOrigin(plant);
    return (point.x - crown.x) ** 2 + (point.y - crown.y) ** 2;
  };
  const edges = points.flatMap((point, index) => Array.from({ length: 5 }, (_, plant) => ({ index, plant, cost: cost(point, plant) }))).sort((a, b) => a.cost - b.cost);
  const counts = [0, 0, 0, 0, 0];
  for (const edge of edges) if (points[edge.index].owner === undefined && counts[edge.plant] < 7) {
    points[edge.index].owner = edge.plant; counts[edge.plant]++;
  }
  for (let pass = 0; pass < 8; pass++) for (let a = 0; a < points.length; a++) for (let b = a + 1; b < points.length; b++) {
    const first = points[a], second = points[b];
    if (first.owner !== second.owner && cost(first, second.owner) + cost(second, first.owner) < cost(first, first.owner) + cost(second, second.owner)) [first.owner, second.owner] = [second.owner, first.owner];
  }
  for (const point of points) { point.homeX = point.x; point.homeY = point.y; }
  return { points };
}

export function createPlantLayout(seed, plantIndex = 0, field = createFieldLayout(seed)) {
  const random = createRandom(seed);
  const crown = { x: between(random, 137, 163), y: between(random, 295, 302) };
  const leafRegions = [[85, 245], [215, 245], [150, 90], [57, 135], [242, 139]];
  const leaves = leafRegions.map(([baseX, baseY], index) => {
    const x = baseX + between(random, -5, 5);
    const y = baseY + between(random, -5, 5);
    const angle = between(random, -10, 10);
    const size = between(random, .86, 1);
    // Last control follows the group's downward axis, so the petiole enters
    // the junction smoothly and continues into the three short branches.
    const blades = [[-8, -4, -58], [0, -11, 0], [8, -4, 58]].map(([x, y, angle]) => ({ x, y, angle: angle + between(random, -5, 5), length: between(random, .93, 1.06), width: between(random, .91, 1.04) }));
    return { stage: index + 1, x, y, size, angle, radius: 61, blades,
      path: petiolePath(crown, x, y, angle) };
  });
  const fieldCrown = fieldPlantOrigin(plantIndex);
  const regions = field.points.flatMap((point, index) => point.owner === plantIndex ? [index] : []);
  return { crown, leaves, random, plantIndex, field, regions, fieldCrown, occupiedCells: new Map(), previousCells: new Map() };
}

export function releaseFruit(layout, berryId) { layout.occupiedCells.delete(berryId); }

export function placeFruit(layout, berryId, slot) {
  // Separate global regions reserve seven non-overlapping targets per plant.
  const taken = new Set(layout.occupiedCells.values());
  let available = layout.regions.filter(i => !taken.has(i));
  if (!available.length) throw new RangeError('No free visual fruit region');
  const previous = layout.previousCells.get(slot);
  if (available.length > 1) available = available.filter(i => i !== previous);
  const cell = available[Math.floor(layout.random() * available.length)];
  layout.occupiedCells.set(berryId, cell);
  layout.previousCells.set(slot, cell);
  const point = layout.field.points[cell];
  for (let attempt = 0; attempt < 64; attempt++) {
    const x = point.homeX + between(layout.random, -RELOCATION_RADIUS, RELOCATION_RADIUS);
    const y = point.homeY + between(layout.random, -RELOCATION_RADIUS, RELOCATION_RADIUS);
    if (clearPoint(layout.field.points, x, y, cell)) { point.x = x; point.y = y; break; }
  }
  const { x, y } = point;
  const endY = y - 17;
  const swing = between(layout.random, -12, 12);
  const archY = Math.max(25, endY - between(layout.random, 25, 55));
  const crown = layout.fieldCrown;
  return { x, y, cell, path: `M${number(crown.x)} ${number(crown.y)} C${number(crown.x + swing)} ${number(archY)} ${number(x + swing * .3)} ${number(archY)} ${number(x)} ${number(endY)}` };
}
