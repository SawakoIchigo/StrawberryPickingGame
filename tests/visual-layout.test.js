import test from 'node:test';
import assert from 'node:assert/strict';
import { FIELD, FRUIT_CLEARANCE, fieldPlantOrigin, createFieldLayout, createPlantLayout, placeFruit, releaseFruit } from '../visual-layout.js';

function checkPositions(positions) {
  const scale = FIELD.minimumScale;
  for (const point of positions) {
    assert.ok(point.x >= 26 && point.x <= FIELD.width - 26);
    assert.ok(point.y >= 26 && point.y <= FIELD.height - 26);
    for (const other of positions) {
      if (other === point) continue;
      assert.ok(Math.abs(point.x - other.x) >= FIELD.hitSize || Math.abs(point.y - other.y) >= FIELD.hitSize);
      assert.ok(Math.abs(point.x - other.x) * scale >= 32 || Math.abs(point.y - other.y) * scale >= 32);
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

test('all five plants fit the continuous field without overlapping fruit hitboxes', () => {
  const initialOrigin = fieldPlantOrigin(0);
  assert.ok(Math.abs(initialOrigin.x - FIELD.width / 2) < 20 && Math.abs(initialOrigin.y - FIELD.height / 2) < 35,
    'the first plant grows near the center of the planter');
  for (let seed = 0; seed < 100; seed++) {
    const points = [];
    const field = createFieldLayout(seed);
    const envelopes = [];
    for (let plant = 0; plant < 5; plant++) {
      const origin = fieldPlantOrigin(plant);
      assert.ok(origin.x > 0 && origin.x < FIELD.width);
      assert.ok(origin.y > 0 && origin.y < FIELD.height);
      const layout = createPlantLayout(seed * 5 + plant, plant, field);
      for (let slot = 0; slot < 7; slot++) {
        const point = placeFruit(layout, slot + 1, slot);
        points.push(point);
        const rotated = [];
        for (const sign of [-1, 0, 1]) for (const dx of [-20, 20]) for (const dy of [-20, 20]) {
          const angle = layout.wind.angle * sign * Math.PI / 180;
          const x = point.x + dx - origin.x, y = point.y + dy - origin.y;
          rotated.push({ x: origin.x + x * Math.cos(angle) - y * Math.sin(angle), y: origin.y + x * Math.sin(angle) + y * Math.cos(angle) });
        }
        envelopes.push({ left: Math.min(...rotated.map(point => point.x)), right: Math.max(...rotated.map(point => point.x)), top: Math.min(...rotated.map(point => point.y)), bottom: Math.max(...rotated.map(point => point.y)) });
      }
    }
    for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) {
      assert.ok(Math.abs(points[i].x - points[j].x) >= FIELD.hitSize || Math.abs(points[i].y - points[j].y) >= FIELD.hitSize);
    }
    checkPositions(points);
    for (let a = 0; a < envelopes.length; a++) for (let b = a + 1; b < envelopes.length; b++) {
      const one = envelopes[a], two = envelopes[b];
      assert.ok(one.right <= two.left || two.right <= one.left || one.bottom <= two.top || two.bottom <= one.top, 'independent wind extremes preserve clear touch boxes');
    }
  }
});

test('seeded field packing has varied gaps rather than recurring aligned rows and columns', () => {
  const first = createFieldLayout(42), same = createFieldLayout(42), other = createFieldLayout(43);
  assert.deepEqual(first, same);
  assert.notDeepEqual(first, other);
  assert.equal(first.points.length, 35);
  for (let owner = 0; owner < 5; owner++) assert.equal(first.points.filter(point => point.owner === owner).length, 7);
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
    const layouts = Array.from({ length: 5 }, (_, plant) => createPlantLayout(seed * 5 + plant, plant, field));
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
