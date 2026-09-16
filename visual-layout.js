// Visual randomness never changes the game clock, growth rules, or harvest state.
export const SCENE = Object.freeze({ width: 300, height: 330, minimumWidth: 250, hitSize: 48 });
// minimumScale is the supported 320×568-and-larger phone baseline for tests;
// the UI may scale further on unusually small screens instead of clipping.
export const FIELD = Object.freeze({ width: 300, height: 360, renderWidth: 350, potRotation: 15, hitSize: 30, minimumScale: .8, leafScale: .22, leafSize: 1.35 });
export function fieldPlantOrigin(index, field) {
  const position = field ? field.plantOrder[index] : index;
  return [{ x: 150, y: 200 }, { x: 150, y: 100 }, { x: 225, y: 150 }, { x: 225, y: 250 }, { x: 150, y: 300 }, { x: 75, y: 250 }, { x: 75, y: 150 }][position];
}
export function createPlantOrder(seed) {
  const random = createRandom(seed);
  const order = [0, 1, 2, 3, 4, 5, 6];
  // The first crown stays central; later crowns use the six outer positions once.
  for (let index = order.length - 1; index > 1; index--) {
    const other = 1 + Math.floor(random() * index);
    [order[index], order[other]] = [order[other], order[index]];
  }
  return Object.freeze(order);
}
// Match the SVG soil after rotating only the planter around its center.
export const SOIL_HEX = Object.freeze([[150, 12], [290, 88], [286, 270], [148, 338], [10, 266], [14, 86]].map(([x, y]) => {
  const angle = FIELD.potRotation * Math.PI / 180;
  return Object.freeze([150 + (x - 150) * Math.cos(angle) - (y - 180) * Math.sin(angle),
    180 + (x - 150) * Math.sin(angle) + (y - 180) * Math.cos(angle)]);
}));
export function insideSoil(x, y) {
  return SOIL_HEX.every(([ax, ay], index) => {
    const [bx, by] = SOIL_HEX[(index + 1) % SOIL_HEX.length];
    return (bx - ax) * (y - ay) - (by - ay) * (x - ax) >= -1e-8;
  });
}
export function fruitInsideSoil(x, y) {
  const half = FIELD.hitSize / 2 + 1;
  return [-half, half].every(dx => [-half, half].every(dy => insideSoil(x + dx, y + dy)));
}
export const FRUIT_CLEARANCE = 32;
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
  return fruitInsideSoil(x, y) && points.every((point, index) => index === ignore || Math.abs(point.x - x) >= FRUIT_CLEARANCE || Math.abs(point.y - y) >= FRUIT_CLEARANCE);
}
function alignmentCost(points, x, y, ignore) {
  // Penalize shared horizontal/vertical bands without prescribing new rows.
  return points.reduce((cost, point, index) => cost + (index === ignore ? 0
    : Math.max(0, 1 - Math.abs(point.x - x) / 10) ** 2 + Math.max(0, 1 - Math.abs(point.y - y) / 10) ** 2), 0);
}
export function createFieldLayout(seed) {
  const random = createRandom(seed);
  const plantOrder = createPlantOrder(seed);
  const points = [];
  // Vacant cells give the collision-safe relaxation room to break up rows.
  const cells = [];
  for (let y = 15; y < FIELD.height; y += FRUIT_CLEARANCE) {
    for (let x = 8; x < FIELD.width; x += FRUIT_CLEARANCE) {
      if (fruitInsideSoil(x, y)) cells.push({ x, y });
    }
  }
  for (let index = cells.length - 1; index > 0; index--) {
    const other = Math.floor(random() * (index + 1));
    [cells[index], cells[other]] = [cells[other], cells[index]];
  }
  points.push(...cells.slice(0, 49));
  for (let step = 0; step < 50000; step++) {
    const index = Math.floor(random() * points.length);
    const point = points[index];
    const globalMove = step % 4 === 0;
    const x = globalMove ? between(random, 16, 284) : point.x + between(random, -6, 6);
    const y = globalMove ? between(random, 16, 322) : point.y + between(random, -6, 6);
    if (!clearPoint(points, x, y, index)) continue;
    const improvement = alignmentCost(points, point.x, point.y, index) - alignmentCost(points, x, y, index);
    // Keep some less favorable moves so the packing can escape local ruts.
    if (random() < Math.exp(improvement * 4)) { point.x = x; point.y = y; }
  }
  const cost = (point, plant) => {
    const crown = fieldPlantOrigin(plant, { plantOrder });
    return (point.x - crown.x) ** 2 + (point.y - crown.y) ** 2;
  };
  const edges = points.flatMap((point, index) => Array.from({ length: 7 }, (_, plant) => ({ index, plant, cost: cost(point, plant) }))).sort((a, b) => a.cost - b.cost);
  const counts = Array(7).fill(0);
  for (const edge of edges) if (points[edge.index].owner === undefined && counts[edge.plant] < 7) {
    points[edge.index].owner = edge.plant; counts[edge.plant]++;
  }
  for (let pass = 0; pass < 8; pass++) for (let a = 0; a < points.length; a++) for (let b = a + 1; b < points.length; b++) {
    const first = points[a], second = points[b];
    if (first.owner !== second.owner && cost(first, second.owner) + cost(second, first.owner) < cost(first, first.owner) + cost(second, second.owner)) [first.owner, second.owner] = [second.owner, first.owner];
  }
  for (const point of points) { point.homeX = point.x; point.homeY = point.y; }
  return { points, plantOrder };
}

export function createPlantLayout(seed, plantIndex = 0, field = createFieldLayout(seed)) {
  const random = createRandom(seed);
  // Separate streams preserve the existing leaf shapes and fruit placements.
  const leafSizeRandom = createRandom(seed ^ 0x4C454146);
  const fruitAppearanceRandom = createRandom(seed ^ 0x46525549);
  const crown = { x: between(random, 137, 163), y: between(random, 295, 302) };
  const leafRegions = [[85, 245], [215, 245], [150, 90], [57, 135], [242, 139]];
  const leaves = leafRegions.map(([baseX, baseY], index) => {
    const x = baseX + between(random, -5, 5);
    const y = baseY + between(random, -5, 5);
    const angle = between(random, -10, 10);
    const size = between(random, .86, 1);
    // Last control follows the group's downward axis, so the petiole enters
    // the junction smoothly and continues into the three short branches.
    const blades = [[-8, -4, -58], [0, -11, 0], [8, -4, 58]].map(([x, y, angle]) => ({ x, y, angle: angle + between(random, -5, 5), length: between(random, .93, 1.06), width: between(random, .91, 1.04), scale: between(leafSizeRandom, .85, 1.15) }));
    return { stage: index + 1, x, y, size, angle, radius: 61 * Math.max(1, ...blades.map(blade => blade.scale)), blades,
      path: petiolePath(crown, x, y, angle) };
  });
  const fieldCrown = fieldPlantOrigin(plantIndex, field);
  const regions = field.points.flatMap((point, index) => point.owner === plantIndex ? [index] : []);
  return { crown, leaves, random, fruitAppearanceRandom, plantIndex, field, regions, fieldCrown, occupiedCells: new Map(), previousCells: new Map() };
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
    const x = point.x + between(layout.random, -RELOCATION_RADIUS / 6, RELOCATION_RADIUS / 6);
    const y = point.y + between(layout.random, -RELOCATION_RADIUS / 6, RELOCATION_RADIUS / 6);
    if (clearPoint(layout.field.points, x, y, cell)) { point.x = x; point.y = y; break; }
  }
  const { x, y } = point;
  const endY = y - 12;
  const crown = layout.fieldCrown;
  // A convex soil polygon contains the whole curve when all controls are inside.
  const first = { x: crown.x * .65 + x * .35, y: crown.y * .65 + endY * .35 };
  const second = { x: x * .9 + 150 * .1, y: endY * .9 + 175 * .1 };
  return { x, y, cell, size: between(layout.fruitAppearanceRandom, .85, 1.15), angle: between(layout.fruitAppearanceRandom, -5, 5), path: `M${number(crown.x)} ${number(crown.y)} C${number(first.x)} ${number(first.y)} ${number(second.x)} ${number(second.y)} ${number(x)} ${number(endY)}` };
}

// Display-only score interpolation: no timers and no model mutations.
export function stepScoreDisplay(state, target, now, immediate = false) {
  if (immediate) return { value: target, target, settled: target, changes: [], active: false };
  let settled = state.settled ?? state.value;
  const previousTarget = state.target ?? state.value;
  const changes = [...(state.changes ?? [])];
  if (target !== previousTarget) changes.push({ delta: target - previousTarget, at: now });
  let moving = 0;
  const pending = [];
  for (const change of changes) {
    const progress = Math.max(0, (now - change.at) / 500);
    if (progress >= 1) {
      settled += change.delta;
    } else {
      // Each gain/loss has its own deadline: a later change cannot prolong it.
      moving += Math.sign(change.delta) * Math.floor(Math.abs(change.delta) * progress / 10) * 10;
      pending.push(change);
    }
  }
  return { value: settled + moving, target, settled, changes: pending, active: pending.length > 0 };
}
