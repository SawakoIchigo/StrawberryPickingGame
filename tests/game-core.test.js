import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG, createGame, startGame, pauseGame, advance, berryStage, pickBerry, shipPack } from '../game-core.js';

function running(seed = 123456789) { const game = createGame(seed); startGame(game); return game; }
function runningWithSpareLives(seed) {
  // Long-duration scheduling tests need to observe later plants independently
  // of the normal ten-life gameover rule. No production option bypasses it.
  const game = running(seed);
  game.lives = 10000;
  return game;
}
function advanceTo(game, time) { return advance(game, time - game.elapsed); }
function fillPack(game) {
  for (let seconds = 0; game.pack.length < CONFIG.packSize && seconds < 500; seconds++) {
    advance(game, 1);
    for (const plant of game.plants) for (const berry of [...plant.berries]) pickBerry(game, plant.id, berry.id);
  }
  assert.equal(game.pack.length, CONFIG.packSize);
}
function waitForRipe(game) {
  for (let seconds = 0; seconds < 100; seconds++) {
    for (const plant of game.plants) {
      const berry = plant.berries.find(item => berryStage(item, game.elapsed) >= 3 && berryStage(item, game.elapsed) <= 5);
      if (berry) return { plant, berry };
    }
    advance(game, .25);
  }
  assert.fail('a ripe berry should become available');
}
function inRange(value, baseline) {
  assert.ok(value >= baseline - 2 - 1e-9 && value <= baseline + 2 + 1e-9, `${value} must be within ${baseline} ± 2`);
}
function rotEvent(plantId, berry) {
  return { type: 'rot', plantId, berryId: berry.id, slot: berry.slot, points: -500, at: berry.stageEndsAt[6] };
}

test('initial farm has two independent stage-four plants with five initial berry stages, waiting for start', () => {
  const game = createGame();
  assert.equal(game.plants.length, 2);
  assert.deepEqual(game.plants.map(plant => plant.id), [1, 2]);
  assert.equal(new Set(game.plants.flatMap(plant => plant.berries.map(berry => berry.id))).size, 10);
  assert.notEqual(game.plants[0].nextGrowthAt, game.plants[1].nextGrowthAt);
  assert.notDeepEqual(game.plants[0].berries[0].stageEndsAt, game.plants[1].berries[0].stageEndsAt);
  assert.equal(game.score, 0);
  assert.equal(game.lives, 10);
  for (const plant of game.plants) {
    assert.equal(plant.stage, 4);
    assert.deepEqual(plant.berries.map(berry => berryStage(berry, 0)), [0, 1, 2, 3, 4]);
    assert.deepEqual(plant.berries.map(berry => berry.slot), [0, 1, 2, 3, 4]);
    assert.equal(plant.berries.length, CONFIG.plantCapacity[4]);
    assert.equal(plant.nextSpawnAt, CONFIG.spawnIntervalSeconds[4]);
  }
  assert.equal(game.pack.length, 0);
  const saved = structuredClone(game);
  assert.deepEqual(advance(game, 100), []);
  assert.deepEqual(game, saved);
});

test('each initial stage has its full saved duration and both plants are immediately harvestable after start', () => {
  for (const seed of [0, 1, 42, 123456789, 0xffffffff]) {
    const game = createGame(seed);
    for (const plant of game.plants) for (const [stage, berry] of plant.berries.entries()) {
      assert.equal(berryStage(berry, 0), stage);
      assert.equal(berry.stageEndsAt[stage - 1] ?? berry.bornAt, 0);
      inRange(berry.stageEndsAt[stage], CONFIG.berryStageSeconds[stage]);
      for (let boundary = 0; boundary < 7; boundary++) {
        inRange(berry.stageEndsAt[boundary] - (berry.stageEndsAt[boundary - 1] ?? berry.bornAt), CONFIG.berryStageSeconds[boundary]);
      }
      assert.equal(berry.countedRotten, false);
      assert.deepEqual(berry.rainBoostedStages, []);
    }
    for (const plant of game.plants) assert.equal(pickBerry(game, plant.id, plant.berries[4].id), false);
    startGame(game);
    for (const plant of game.plants) {
      const [bud, flower, white, pink, red] = plant.berries;
      for (const berry of [bud, flower, white]) assert.equal(pickBerry(game, plant.id, berry.id), false);
      const scoreBefore = game.score;
      assert.equal(pickBerry(game, plant.id, red.id), true);
      assert.equal(game.score, scoreBefore + 150);
      assert.equal(pickBerry(game, plant.id, pink.id), true);
      assert.equal(game.score, scoreBefore + 200);
    }
    assert.deepEqual(game.pack.map(berry => berry.stage), [4, 3, 4, 3]);
    assert.equal(game.lives, 10);
    assert.equal(game.missed, 0);
    advance(game, 8);
    for (const plant of game.plants) {
      assert.equal(plant.berries.length, 5);
      assert.deepEqual(plant.berries.slice(-2).map(berry => [berry.slot, berry.bornAt]), [[3, 4], [4, 8]]);
    }
    assert.equal(new Set(game.plants.flatMap(plant => plant.berries.map(berry => berry.id))).size, 10);
  }
});

test('all ten initial berries naturally expire once and a new game restores both initial plants', () => {
  const game = runningWithSpareLives(42);
  game.rain.nextStartsAt = Infinity;
  const originals = game.plants.flatMap(plant => plant.berries);
  const sourcePlants = new Map(game.plants.flatMap(plant => plant.berries.map(berry => [berry.id, plant.id])));
  const ids = new Set(originals.map(berry => berry.id));
  const at = Math.max(...originals.map(berry => berry.stageEndsAt[6]));
  const events = advanceTo(game, at).filter(event => ids.has(event.berryId));
  assert.equal(events.length, 10);
  assert.equal(new Set(events.map(event => event.berryId)).size, 10);
  for (const berry of originals) assert.deepEqual(events.find(event => event.berryId === berry.id), rotEvent(sourcePlants.get(berry.id), berry));
  assert.ok(game.plants.every(plant => plant.berries.every(berry => !ids.has(berry.id))));
  assert.ok(advance(game, 10).every(event => !ids.has(event.berryId)));
  const restarted = createGame(42);
  assert.equal(restarted.plants.length, 2);
  for (const plant of restarted.plants) {
    assert.equal(plant.stage, 4);
    assert.deepEqual(plant.berries.map(berry => berryStage(berry, 0)), [0, 1, 2, 3, 4]);
  }
});

test('each plant transition uses saved 13–17 seconds and spawns its neighbor at stage five', () => {
  const game = runningWithSpareLives();
  const initial = game.plants[0];
  // Isolate one lineage while retaining the second initial plant.
  game.plants[1].nextGrowthAt = Infinity;
  const durations = [];
  function grow(plant, expectedStage) {
    const at = plant.nextGrowthAt;
    const duration = at - plant.stageStartedAt;
    inRange(duration, 15);
    durations.push(duration);
    advanceTo(game, at - .001);
    assert.equal(plant.stage, expectedStage - 1);
    advanceTo(game, at);
    assert.equal(plant.stage, expectedStage);
    assert.equal(plant.stageStartedAt, at);
  }
  grow(initial, 5);
  assert.equal(initial.nextGrowthAt, Infinity);
  assert.deepEqual(game.plants.map(plant => plant.stage), [5, 4, 1]);
  const child = game.plants[2];
  assert.equal(child.stageStartedAt, initial.stageStartedAt);
  grow(child, 2);
  assert.equal(child.berries.length, 0);
  grow(child, 3);
  assert.equal(child.berries.length, 1);
  assert.equal(child.berries[0].bornAt, child.stageStartedAt);
  grow(child, 4);
  grow(child, 5);
  assert.deepEqual(game.plants.map(plant => plant.stage), [5, 4, 5, 1]);
  assert.equal(game.plants[3].stageStartedAt, child.stageStartedAt);
  assert.equal(new Set(durations).size, durations.length);
});

test('individual berry and plant durations stay within range and vary independently', () => {
  const game = runningWithSpareLives(987654321);
  // Check the unwatered baseline here; weather tests separately compare the
  // saved schedules before and after a shower's one-time growth credit.
  game.rain.nextStartsAt = Infinity;
  const observed = new Set();
  const jitterByStage = CONFIG.berryStageSeconds.map(() => new Set());
  const plantDurations = new Set();
  for (let step = 0; step < 2400; step++) {
    for (const plant of game.plants) {
      if (plant.stage < 5) {
        const duration = plant.nextGrowthAt - plant.stageStartedAt;
        inRange(duration, 15);
        plantDurations.add(duration);
      }
      for (const berry of plant.berries) {
        if (observed.has(berry.id)) continue;
        observed.add(berry.id);
        assert.equal(berry.stageEndsAt.length, 7);
        const offsets = berry.stageEndsAt.map((end, stage) => {
          const duration = end - (berry.stageEndsAt[stage - 1] ?? berry.bornAt);
          inRange(duration, CONFIG.berryStageSeconds[stage]);
          const offset = duration - CONFIG.berryStageSeconds[stage];
          jitterByStage[stage].add(offset);
          return offset;
        });
        assert.ok(new Set(offsets).size > 1, 'stages must not share one random offset');
      }
    }
    advance(game, .25);
  }
  assert.ok(observed.size > 100);
  assert.ok(plantDurations.size >= 10);
  assert.ok(Math.min(...plantDurations) < 13.5 && Math.max(...plantDurations) > 16.5);
  for (const offsets of jitterByStage) {
    assert.ok(offsets.size > 100);
    assert.ok(Math.min(...offsets) < -1.9 && Math.max(...offsets) > 1.9);
  }
});

test('reading ripeness and pausing preserve schedules and RNG; clones resume identically', () => {
  const game = runningWithSpareLives();
  advance(game, 73);
  const saved = structuredClone(game);
  for (let read = 0; read < 100; read++) {
    for (const plant of game.plants) for (const berry of plant.berries) berryStage(berry, game.elapsed + read);
  }
  assert.deepEqual(game, saved);
  pauseGame(game);
  const paused = structuredClone(game);
  assert.deepEqual(advance(game, 3600), []);
  assert.deepEqual(game, paused);
  startGame(game);
  const clone = structuredClone(game);
  assert.deepEqual(advance(game, 100), advance(clone, 100));
  assert.deepEqual(game, clone);
  assert.deepEqual(createGame(42), createGame(42));
  assert.notDeepEqual(createGame(42), createGame(43));
});

test('a berry changes at each saved boundary, emits one rot event only when it disappears', () => {
  for (const seed of [1, 42, 123456789]) {
    const game = running(seed);
    const berry = game.plants[0].berries[0];
    const targetEvents = [];
    for (let boundary = 0; boundary < 7; boundary++) {
      const at = berry.stageEndsAt[boundary];
      targetEvents.push(...advanceTo(game, at - .001).filter(event => event.berryId === berry.id));
      assert.equal(berryStage(berry, game.elapsed), boundary);
      const scoreBefore = game.score;
      const livesBefore = game.lives;
      const events = advanceTo(game, at);
      targetEvents.push(...events.filter(event => event.berryId === berry.id));
      assert.equal(targetEvents.length, boundary === 6 ? 1 : 0);
      assert.equal(berryStage(berry, game.elapsed), boundary === 6 ? -1 : boundary + 1);
      assert.equal(game.score - scoreBefore, events.reduce((total, event) => total + event.points, 0));
      assert.equal(game.lives, livesBefore - events.length);
      assert.equal(game.plants[0].berries.some(item => item.id === berry.id), boundary < 6);
    }
    assert.deepEqual(targetEvents, [rotEvent(1, berry)]);
  }
});

test('a rotten berry stays unpenalized through a pause and loses one life exactly at disappearance', () => {
  const game = running();
  const plant = game.plants[0];
  game.plants = [plant];
  const berry = plant.berries[0];
  plant.berries = [berry];
  plant.nextGrowthAt = Infinity; plant.nextSpawnAt = Infinity;
  game.rain.nextStartsAt = Infinity;
  assert.deepEqual(advanceTo(game, berry.stageEndsAt[5]), []);
  assert.equal(berryStage(berry, game.elapsed), 6);
  assert.deepEqual([game.score, game.lives, game.missed], [0, 10, 0]);
  pauseGame(game);
  const paused = structuredClone(game);
  assert.deepEqual(advance(game, 100), []);
  assert.deepEqual(game, paused);
  startGame(game);
  assert.deepEqual(advanceTo(game, berry.stageEndsAt[6] - .001), []);
  assert.deepEqual([game.score, game.lives, game.missed], [0, 10, 0]);
  assert.deepEqual(advanceTo(game, berry.stageEndsAt[6]), [rotEvent(plant.id, berry)]);
  assert.deepEqual([game.score, game.lives, game.missed], [-500, 9, 1]);
  assert.equal(plant.berries.length, 0);
  assert.deepEqual(advance(game, .001), []);
  assert.deepEqual([game.score, game.lives, game.missed], [-500, 9, 1]);
});

test('an expired berry loses points once even if its rotten stage was skipped', () => {
  const game = running();
  const berry = game.plants[0].berries[0];
  const lifetime = berry.stageEndsAt.at(-1);
  berry.bornAt -= lifetime;
  berry.stageEndsAt = berry.stageEndsAt.map(at => at - lifetime);
  assert.equal(berryStage(berry, game.elapsed), -1);
  assert.deepEqual(advance(game, 1), [{ ...rotEvent(1, berry), at: 1 }]);
  assert.equal(game.missed, 1);
  assert.equal(game.score, -500);
  assert.equal(game.lives, 9);
  assert.ok(!game.plants[0].berries.some(item => item.id === berry.id));
  assert.deepEqual(advance(game, 1), []);
  assert.equal(game.score, -500);
  assert.equal(game.lives, 9, 'expiry cannot remove another life for the same berry');
});

test('picked berries never produce a later rot notification', () => {
  const game = running();
  const berry = game.plants[0].berries[0];
  advanceTo(game, berry.stageEndsAt[3]);
  const scoreBefore = game.score;
  assert.equal(pickBerry(game, 1, berry.id), true);
  assert.equal(game.score, scoreBefore + 150);
  const events = advanceTo(game, berry.stageEndsAt[6]);
  assert.ok(events.every(event => event.berryId !== berry.id));
  assert.equal(game.score, scoreBefore + 150 + events.length * -500);
});

test('rot notifications belong only to their advance call and preserve source slots and times', () => {
  const game = running();
  game.plants = [game.plants[0]];
  const berries = [...game.plants[0].berries].sort((a, b) => a.stageEndsAt[6] - b.stageEndsAt[6]);
  const first = advanceTo(game, berries[0].stageEndsAt[6]);
  const savedFirst = structuredClone(first);
  assert.deepEqual(first, [rotEvent(1, berries[0])]);
  const second = advanceTo(game, berries[1].stageEndsAt[6]);
  assert.deepEqual(second.find(event => event.berryId === berries[1].id), rotEvent(1, berries[1]));
  assert.ok(second.every(event => event.berryId !== berries[0].id));
  assert.notEqual(first, second);
  assert.deepEqual(first, savedFirst);
});

test('pink, red and dark red at their random boundaries earn 50/150/50 once', () => {
  for (const seed of [0, 42, 987654321]) for (let stage = 0; stage <= 7; stage++) {
    const game = running(seed);
    const berry = game.plants[0].berries[0];
    advanceTo(game, stage === 0 ? 0 : berry.stageEndsAt[stage - 1]);
    const allowed = stage >= 3 && stage <= 5;
    const points = [0, 0, 0, 50, 150, 50, 0, 0][stage];
    const scoreBefore = game.score;
    assert.equal(pickBerry(game, 1, berry.id), allowed, `stage ${stage}, seed ${seed}`);
    assert.equal(game.pack.length, allowed ? 1 : 0);
    assert.equal(game.score, scoreBefore + points);
    if (allowed) {
      assert.equal(game.pack[0].stage, stage);
      assert.equal(pickBerry(game, 1, berry.id), false);
      assert.equal(game.score, scoreBefore + points);
    }
  }
});

test('pack limit is eight, shipping is explicit and picked ripeness and score are preserved', () => {
  const game = runningWithSpareLives();
  assert.equal(shipPack(game), false);
  fillPack(game);
  assert.equal(game.score, game.pack.reduce((total, berry) => total + CONFIG.berryPoints[berry.stage], 0) - game.missed * 500);
  const savedPack = structuredClone(game.pack);
  assert.equal(game.shipments, 0);
  advance(game, 400);
  assert.deepEqual(game.pack, savedPack);
  const { plant, berry } = waitForRipe(game);
  const scoreBefore = game.score;
  assert.equal(pickBerry(game, plant.id, berry.id), false);
  assert.equal(game.score, scoreBefore);
  assert.equal(shipPack(game), true);
  assert.equal(game.score, scoreBefore);
  assert.equal(game.pack.length, 0);
  assert.equal(game.shipments, 1);
  assert.equal(shipPack(game), false);
  assert.equal(game.score, scoreBefore);
  assert.equal(pickBerry(game, plant.id, berry.id), true);
  const scoreAfterPick = game.score;
  assert.equal(shipPack(game), false);
  assert.equal(game.score, scoreAfterPick);
});

test('pause freezes the farm and blocks harvest and shipment', () => {
  const game = running();
  fillPack(game);
  pauseGame(game);
  const saved = structuredClone(game);
  assert.deepEqual(advance(game, 3600), []);
  assert.equal(shipPack(game), false);
  assert.deepEqual(game, saved);
  startGame(game);
  assert.equal(shipPack(game), true);
  assert.equal(game.score, saved.score);
  advance(game, 1);
  assert.equal(game.elapsed, saved.elapsed + 1);
  const { plant, berry } = waitForRipe(game);
  pauseGame(game);
  const paused = structuredClone(game);
  assert.equal(pickBerry(game, plant.id, berry.id), false);
  assert.deepEqual(game, paused);
});

test('large random updates match small steps including RNG, schedules, score and ordered rot events', () => {
  for (const seed of [0, 1, 42, 123456789, 0xffffffff]) {
    const large = runningWithSpareLives(seed);
    const small = runningWithSpareLives(seed);
    const largeEvents = advance(large, 1200);
    const smallEvents = [];
    for (let i = 0; i < 4800; i++) smallEvents.push(...advance(small, .25));
    assert.deepEqual(large, small, `state for seed ${seed}`);
    assert.deepEqual(largeEvents, smallEvents, `events for seed ${seed}`);
    assert.equal(largeEvents.length, large.missed);
    assert.equal(new Set(largeEvents.map(event => event.berryId)).size, largeEvents.length);
    assert.ok(largeEvents.every((event, index) => event.type === 'rot' && event.points === -500
      && event.plantId >= 1 && event.plantId <= CONFIG.maxPlants && event.slot >= 0 && event.slot < 7
      && event.at >= (largeEvents[index - 1]?.at ?? 0) && event.at <= large.elapsed));
    assert.equal(largeEvents.reduce((score, event) => score + event.points, 0), large.score);
    assert.equal(large.plants.length, CONFIG.maxPlants);
    assert.ok(large.plants.every(plant => plant.stage === 5 && plant.berries.length <= 7));
    assert.ok(large.missed > 500);
    assert.equal(large.score, large.missed * -500);
    assert.equal(large.status, 'running');
  }
});

test('bud spawn intervals stay fixed while individual growth times vary', () => {
  const game = runningWithSpareLives();
  const initial = game.plants[0];
  game.plants[1].nextGrowthAt = Infinity;
  assert.equal(initial.nextSpawnAt, 4);
  advanceTo(game, initial.nextGrowthAt);
  const plant = game.plants[2];
  advanceTo(game, plant.nextGrowthAt);
  advanceTo(game, plant.nextGrowthAt);
  assert.equal(plant.stage, 3);
  const birth = plant.stageStartedAt;
  advance(game, 12);
  assert.deepEqual(plant.berries.map(berry => berry.bornAt), [birth, birth + 6, birth + 12]);
  for (const stage of [4, 5]) {
    advanceTo(game, plant.nextGrowthAt);
    assert.equal(plant.stage, stage);
    const nextSpawn = plant.nextSpawnAt;
    advanceTo(game, nextSpawn);
    assert.equal(plant.nextSpawnAt - nextSpawn, CONFIG.spawnIntervalSeconds[stage]);
  }
});

test('invalid deltas and nonexistent IDs cannot change the game or consume randomness', () => {
  const game = running();
  const saved = structuredClone(game);
  for (const delta of [NaN, Infinity, -1, 0]) assert.deepEqual(advance(game, delta), []);
  assert.equal(pickBerry(game, 999, 1), false);
  assert.equal(pickBerry(game, 1, 999), false);
  assert.deepEqual(game, saved);
});

test('creating a new game resets points earned in the previous game', () => {
  const game = running();
  const berry = game.plants[0].berries[4];
  assert.equal(pickBerry(game, 1, berry.id), true);
  assert.equal(game.score, 150);
  const restarted = createGame();
  assert.equal(restarted.score, 0);
  assert.equal(restarted.missed, 0);
  assert.equal(restarted.shipments, 0);
  assert.equal(restarted.pack.length, 0);
  assert.equal(restarted.lives, 10);
});

test('each plant stays within seven unique fruit slots through growth, harvest, pause and regrowth', () => {
  for (const seed of [1, 42, 0xffffffff]) {
    const game = runningWithSpareLives(seed);
    const fullPlants = new Set();
    const observedStages = new Set();
    let harvested = 0;
    for (let step = 0; step < 3600; step++) {
      advance(game, .25);
      for (const plant of game.plants) {
        const capacity = CONFIG.plantCapacity[plant.stage] ?? 0;
        observedStages.add(plant.stage);
        assert.ok(plant.berries.length <= capacity && plant.berries.length <= 7);
        assert.equal(new Set(plant.berries.map(berry => berry.slot)).size, plant.berries.length);
        assert.ok(plant.berries.every(berry => Number.isInteger(berry.slot) && berry.slot >= 0 && berry.slot < capacity));
        if (plant.berries.length === 7) fullPlants.add(plant.id);
        // Alternate unattended growth with harvesting, so both expiry and
        // picking repeatedly release slots for new fruit on mature plants.
        if (game.elapsed % 90 >= 45) for (const berry of [...plant.berries]) {
          if (pickBerry(game, plant.id, berry.id)) harvested++;
          if (game.pack.length === CONFIG.packSize) shipPack(game);
        }
      }
      if (step % 720 === 0) {
        pauseGame(game);
        const paused = structuredClone(game);
        advance(game, 60);
        assert.deepEqual(game, paused);
        startGame(game);
      }
    }
    assert.deepEqual([...observedStages].sort(), [1, 2, 3, 4, 5]);
    assert.equal(fullPlants.size, CONFIG.maxPlants, 'all seven plants can reach the seven-fruit limit');
    assert.ok(harvested > 100 && game.missed > 100 && game.shipments > 10);
  }
});

test('ten natural rot events end the game at the same exact instant for large and small updates', () => {
  for (const seed of [0, 1, 42, 123456789, 0xffffffff]) {
    const reference = runningWithSpareLives(seed);
    const expectedEvents = advance(reference, 1200).slice(0, 10);
    const large = running(seed), small = running(seed);
    const events = advance(large, 1200);
    const smallEvents = [];
    for (let step = 0; step < 4800; step++) smallEvents.push(...advance(small, .25));
    assert.deepEqual(events, expectedEvents);
    assert.deepEqual(smallEvents, expectedEvents);
    assert.deepEqual(large, small);
    assert.equal(large.elapsed, expectedEvents[9].at);
    assert.equal(large.status, 'gameover');
    assert.equal(large.lives, 0);
    assert.equal(large.missed, 10);
    assert.equal(large.score, -5000);
  }
});

test('the final loss stops same-timestamp rot processing, including already expired berries', () => {
  for (const expired of [false, true]) {
    const game = running();
    game.lives = 5; // Five of the initial ten lives have already been lost.
    const plant = game.plants[0];
    game.plants = [plant];
    plant.stage = 5; plant.nextGrowthAt = Infinity; plant.nextSpawnAt = Infinity;
    const template = plant.berries[0];
    plant.berries = Array.from({ length: 7 }, (_, slot) => ({ ...template, id: slot + 1, slot,
      stageEndsAt: expired ? [-7, -6, -5, -4, -3, -2, -1] : [-4, -3, -2, -1, 0, 1, 5] }));
    const originals = [...plant.berries];
    const at = expired ? 1 : 5;
    game.plants.push({ ...plant, id: 2, berries: [
      { ...template, id: 8, stageEndsAt: [...plant.berries[0].stageEndsAt] },
      { ...template, id: 9, stageEndsAt: [10, 11, 12, 13, 14, 15, 16] },
    ] });
    const events = advance(game, expired ? 1 : 10);
    assert.deepEqual(events.map(event => [event.berryId, event.at]), [[1, at], [2, at], [3, at], [4, at], [5, at]]);
    assert.deepEqual(originals.map(berry => berry.countedRotten), [true, true, true, true, true, false, false]);
    assert.equal(plant.berries.length, 0);
    assert.deepEqual(game.plants[1].berries.map(item => item.id), [9]);
    assert.equal(game.elapsed, at);
    assert.equal(game.lives, 0);
    assert.equal(game.missed, 5);
    assert.equal(game.score, -2500);
    assert.equal(game.status, 'gameover');
    const stopped = structuredClone(game);
    assert.deepEqual(advance(game, 100), []);
    assert.deepEqual(game, stopped);
  }
});

test('gameover blocks start, resume, pause, harvest and full-pack shipping until a new game', () => {
  const game = running();
  fillPack(game);
  advance(game, 1200);
  assert.equal(game.status, 'gameover');
  assert.equal(game.pack.length, 8);
  const { plant, berry } = waitForRipe(game);
  const stopped = structuredClone(game);
  startGame(game); pauseGame(game);
  assert.equal(pickBerry(game, plant.id, berry.id), false);
  assert.equal(shipPack(game), false);
  assert.deepEqual(advance(game, 1200), []);
  assert.deepEqual(game, stopped);
  const unfilled = running();
  advance(unfilled, 1200);
  assert.equal(unfilled.pack.length, 0);
  const pickable = waitForRipe(unfilled);
  const unfilledStopped = structuredClone(unfilled);
  assert.equal(pickBerry(unfilled, pickable.plant.id, pickable.berry.id), false, 'gameover also blocks a ripe berry when the pack has room');
  assert.deepEqual(unfilled, unfilledStopped);
  const restarted = createGame();
  assert.equal(restarted.status, 'ready');
  assert.equal(restarted.lives, 10);
  assert.equal(restarted.elapsed, 0);
  assert.equal(restarted.score, 0);
  assert.equal(restarted.missed, 0);
  assert.equal(restarted.pack.length, 0);
  startGame(restarted);
  assert.equal(restarted.status, 'running');
});
