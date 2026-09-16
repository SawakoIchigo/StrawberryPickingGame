import test from 'node:test';
import { CONFIG } from '../game-core.js';
import assert from 'node:assert/strict';
import { FIELD, FRUIT_CLEARANCE, insideSoil, fruitInsideSoil, stepScoreDisplay, fieldPlantOrigin, createFieldLayout, createPlantLayout, placeFruit, releaseFruit, sampleBreeze, leafPose } from '../visual-layout.js';

function checkPositions(positions) {
  const scale = FIELD.minimumScale;
  for (const point of positions) {
    assert.ok(fruitInsideSoil(point.x, point.y));
    for (const other of positions) {
      if (other === point) continue;
      assert.ok(Math.abs(point.x - other.x) >= FIELD.hitSize || Math.abs(point.y - other.y) >= FIELD.hitSize);
      assert.ok(Math.abs(point.x - other.x) * scale >= FIELD.hitSize * scale || Math.abs(point.y - other.y) * scale >= FIELD.hitSize * scale);
    }
  }
}

test('dense plants and repeated regrowth keep touch boxes disjoint and inside narrow scenes', () => {
  for (let seed = 0; seed < 80; seed++) {
    const layout = createPlantLayout(seed);
    const fruit = Array.from({ length: 7 }, (_, slot) => ({ id: slot + 1, slot, ...placeFruit(layout, slot + 1, slot) }));
    checkPositions(fruit);
    let relocated = 0;
    for (let cohort = 0; cohort < 20; cohort++) {
      const slot = cohort % 7;
      const oldPosition = fruit[slot];
      releaseFruit(layout, fruit[slot].id);
      const id = 8 + cohort;
      fruit[slot] = { id, slot, ...placeFruit(layout, id, slot) };
      if (fruit[slot].x !== oldPosition.x || fruit[slot].y !== oldPosition.y) relocated++;
      checkPositions(fruit);
      assert.equal(layout.occupiedCells.size, 7);
    }
    assert.ok(relocated > 0, 'new fruit vary position; dense failures safely retain the reserved endpoint');
  }
});

test('anatomy is stable for a seed and visibly different between plant seeds', () => {
  const first = createPlantLayout(731);
  const same = createPlantLayout(731);
  const other = createPlantLayout(732);
  assert.deepEqual(first.leaves, same.leaves);
  assert.deepEqual(first.crown, same.crown);
  assert.notDeepEqual(first.leaves, other.leaves);
  assert.notDeepEqual(first.crown, other.crown);
  const snapshot = structuredClone(first.leaves);
  const position = placeFruit(first, 1, 0);
  assert.deepEqual(position, placeFruit(same, 1, 0));
  for (let i = 1; i < 7; i++) placeFruit(first, i + 1, i);
  assert.deepEqual(first.leaves, snapshot, 'growth/fruit placement do not regenerate existing leaves');
  assert.deepEqual(first.leaves.map(leaf => leaf.stage), [1, 2, 3, 4, 5], 'each growth stage adds one stable group');
});

test('three to five leaf groups stay separated with smoothly aligned petioles', () => {
  const field = createFieldLayout(1);
  for (let seed = 0; seed < 500; seed++) {
    const { leaves } = createPlantLayout(seed, 0, field);
    assert.ok(leaves.length >= 3 && leaves.length <= 5);
    for (const leaf of leaves) {
      const coordinates = leaf.path.match(/-?\d+(?:\.\d+)?/g).map(Number);
      assert.ok(coordinates[3] < coordinates[1], 'petiole leaves the crown upward without a downward loop');
      const [controlX, controlY, endX, endY] = coordinates.slice(-4);
      assert.ok(Math.abs(endX - leaf.x) < .01 && Math.abs(endY - leaf.y) < .01);
      const angle = leaf.angle * Math.PI / 180;
      const tangentCross = (endX - controlX) * -Math.cos(angle) - (endY - controlY) * Math.sin(angle);
      assert.ok(Math.abs(tangentCross) < .03, 'petiole tangent matches leaf junction axis');
      for (const other of leaves) {
        if (leaf === other) continue;
        assert.ok(Math.hypot(leaf.x - other.x, leaf.y - other.y) > 82, 'leaf groups occupy separate canopy regions');
      }
    }
    for (let a = 0; a < leaves.length; a++) for (let b = a + 1; b < leaves.length; b++) for (let c = b + 1; c < leaves.length; c++) {
      const triples = [[leaves[a], leaves[b]], [leaves[a], leaves[c]], [leaves[b], leaves[c]]];
      assert.ok(triples.some(([one, two]) => Math.hypot(one.x - two.x, one.y - two.y) > one.radius + two.radius), 'three leaf-group envelopes cannot overlap at one point');
    }
  }
});

test('all seven plants fit the continuous field without overlapping fruit hitboxes', () => {
  const initialOrigin = fieldPlantOrigin(0);
  assert.ok(Math.abs(initialOrigin.x - FIELD.width / 2) < 20 && Math.abs(initialOrigin.y - FIELD.height / 2) < 35,
    'the first plant grows near the center of the planter');
  for (let seed = 0; seed < 100; seed++) {
    const points = [];
    const field = createFieldLayout(seed);
    for (let plant = 0; plant < 7; plant++) {
      const origin = fieldPlantOrigin(plant);
      assert.ok(origin.x > 0 && origin.x < FIELD.width);
      assert.ok(origin.y > 0 && origin.y < FIELD.height);
      const layout = createPlantLayout(seed * 7 + plant, plant, field);
      for (let slot = 0; slot < 7; slot++) {
        const point = placeFruit(layout, slot + 1, slot);
        points.push(point);
      }
    }
    checkPositions(points);
  }
});

test('breeze is slow and irregular, bending connected leaves while roots and fruit stay fixed', () => {
  assert.equal(sampleBreeze(0), 0, 'starting the game does not jump to a tilted pose');
  let previous = sampleBreeze(0);
  const peaks = new Set();
  for (let frame = 1; frame <= 180 * 60; frame++) {
    const value = sampleBreeze(frame / 60);
    assert.ok(value >= 0 && value <= 1);
    assert.ok(Math.abs(value - previous) < .003, 'no sudden gust or fast oscillation at display-frame intervals');
    previous = value;
    if (frame % 660 === 0) peaks.add(Math.round(value * 100));
  }
  assert.ok(peaks.size > 10, 'gust strength does not repeat one pendulum cycle');
  for (let join = 11; join < 180; join += 11) {
    assert.ok(Math.abs(sampleBreeze(join - .001) - sampleBreeze(join + .001)) < .000001, 'gust joins are smooth');
  }

  const field = createFieldLayout(42);
  const layouts = Array.from({ length: 7 }, (_, plant) => createPlantLayout(plant + 10, plant, field));
  for (const layout of layouts) for (let slot = 0; slot < 7; slot++) placeFruit(layout, slot + 1, slot);
  const savedField = structuredClone(field);
  const savedCrowns = layouts.map(layout => structuredClone(layout.fieldCrown));
  for (const layout of layouts) for (const leaf of layout.leaves) {
    const rest = leafPose(layout, leaf, 0);
    const root = leaf.path.match(/-?\d+(?:\.\d+)?/g).slice(0, 2).map(Number);
    for (const strength of [0, .1, .5, 1]) {
      const pose = leafPose(layout, leaf, strength);
      const path = pose.path.match(/-?\d+(?:\.\d+)?/g).map(Number);
      assert.deepEqual(path.slice(0, 2), root, 'petiole remains anchored in the soil');
      assert.ok(Math.hypot(pose.x - rest.x, pose.y - rest.y) <= 1.32);
      const endpointX = layout.fieldCrown.x + (path[6] - layout.crown.x) * FIELD.leafScale;
      const endpointY = layout.fieldCrown.y + (path[7] - layout.crown.y) * FIELD.leafScale;
      assert.ok(Math.hypot(endpointX - pose.x, endpointY - pose.y) < .003, 'leaf and petiole move together without a gap');
      for (const blade of leaf.blades) {
        const tip = leafPose => {
          const angle = leafPose.angle * Math.PI / 180;
          const bladeAngle = blade.angle * Math.PI / 180;
          const x = blade.x + Math.sin(bladeAngle) * blade.length * 44;
          const y = blade.y - Math.cos(bladeAngle) * blade.length * 44;
          const size = leaf.size * FIELD.leafScale * FIELD.leafSize;
          return { x: leafPose.x + (x * Math.cos(angle) - y * Math.sin(angle)) * size,
            y: leafPose.y + (x * Math.sin(angle) + y * Math.cos(angle)) * size };
        };
        const before = tip(rest), after = tip(pose);
        assert.ok(Math.hypot(after.x - before.x, after.y - before.y) < 1.9, 'even the blade tips move less than two field pixels');
      }
    }
  }
  assert.deepEqual(field, savedField, 'wind never changes fruit positions or ownership');
  assert.deepEqual(layouts.map(layout => layout.fieldCrown), savedCrowns);
});

test('seeded field packing has varied gaps rather than recurring aligned rows and columns', () => {
  const first = createFieldLayout(42), same = createFieldLayout(42), other = createFieldLayout(43);
  assert.deepEqual(first, same);
  assert.notDeepEqual(first, other);
  assert.equal(first.points.length, 49);
  for (let owner = 0; owner < 7; owner++) assert.equal(first.points.filter(point => point.owner === owner).length, 7);
  for (const point of first.points) {
    for (const other of first.points) if (point !== other) assert.ok(Math.abs(point.x - other.x) >= FRUIT_CLEARANCE || Math.abs(point.y - other.y) >= FRUIT_CLEARANCE);
  }
  assert.ok(new Set(first.points.map(point => Math.round(point.x / 4))).size > 15);
  assert.ok(new Set(first.points.map(point => Math.round(point.y / 4))).size > 15);
});

test('random fields do not repeatedly concentrate fruit into evenly spaced bands', () => {
  const concentration = (points, axis) => {
    let strongest = 0;
    // Small jitter can disguise rows in rounded-coordinate counts. Repeating
    // rows still share a phase at their pitch; scattered positions do not.
    for (let pitch = FIELD.hitSize; pitch <= FIELD.hitSize * 1.5; pitch++) {
      let cosine = 0, sine = 0;
      for (const point of points) {
        const phase = point[axis] / pitch * Math.PI * 2;
        cosine += Math.cos(phase); sine += Math.sin(phase);
      }
      strongest = Math.max(strongest, Math.hypot(cosine, sine) / points.length);
    }
    return strongest;
  };
  const scores = [];
  for (let seed = 0; seed < 32; seed++) {
    const field = createFieldLayout(seed);
    const layouts = Array.from({ length: 7 }, (_, plant) => createPlantLayout(seed * 7 + plant, plant, field));
    const fruit = layouts.flatMap(layout => Array.from({ length: 7 }, (_, slot) => ({ layout, id: slot + 1, slot, ...placeFruit(layout, slot + 1, slot) })));
    for (let cohort = 0; cohort < 20; cohort++) {
      const index = cohort % fruit.length;
      const { layout, id, slot } = fruit[index];
      const neighbors = fruit.filter((_, i) => i !== index).map(point => ({ cell: point.cell, x: point.x, y: point.y }));
      releaseFruit(layout, id);
      fruit[index] = { layout, id: 8 + cohort, slot, ...placeFruit(layout, 8 + cohort, slot) };
      for (const neighbor of neighbors) {
        assert.equal(field.points[neighbor.cell].x, neighbor.x, 'regrowth does not move existing fruit');
        assert.equal(field.points[neighbor.cell].y, neighbor.y, 'regrowth does not move existing fruit');
      }
      checkPositions(fruit);
    }
    scores.push(concentration(fruit, 'x'), concentration(fruit, 'y'));
  }
  assert.ok(scores.reduce((sum, score) => sum + score, 0) / scores.length < .6,
    'field and regrowth layouts avoid the strong repeating bands of a jittered grid');
});

test('seven owners match game capacity and all leaf envelopes remain inside hexagonal soil', () => {
  assert.equal(CONFIG.maxPlants, 7);
  assert.equal(fieldPlantOrigin(7), undefined);
  const field = createFieldLayout(9);
  assert.equal(new Set(field.points.map(point => point.owner)).size, CONFIG.maxPlants);
  for (let seed = 0; seed < 100; seed++) for (let plant = 0; plant < CONFIG.maxPlants; plant++) {
    const layout = createPlantLayout(seed, plant, field);
    for (const leaf of layout.leaves) for (const wind of [0, 1]) {
      const pose = leafPose(layout, leaf, wind);
      const radius = leaf.radius * leaf.size * FIELD.leafScale * FIELD.leafSize;
      for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 16) {
        assert.ok(insideSoil(pose.x + Math.cos(angle) * radius, pose.y + Math.sin(angle) * radius));
      }
    }
  }
});

test('score display counts ten points every 40ms toward the latest target and snaps on reset', () => {
  let state = { value: 100, at: 0, active: false };
  for (let index = 1; index <= 5; index++) {
    state = stepScoreDisplay(state, 150, index * 40);
    assert.equal(state.value, 100 + index * 10);
    assert.equal(state.active, index !== 5);
  }
  state = stepScoreDisplay(state, 300, 240);
  assert.equal(state.value, 160);
  state = stepScoreDisplay(state, -340, 280);
  assert.equal(state.value, 150);
  state = stepScoreDisplay(state, -340, 2240);
  assert.equal(state.value, -340);
  assert.equal(state.active, false);
  assert.deepEqual(stepScoreDisplay(state, 0, 2250, true), { value: 0, at: 2250, active: false });
  assert.equal(stepScoreDisplay(state, 999999, 2250, true).value, 999999);
});
