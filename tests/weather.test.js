import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG, createGame, startGame, pauseGame, advance, berryStage } from '../game-core.js';

function running(seed = 42) {
  const game = createGame(seed);
  startGame(game);
  game.lives = 10000;
  return game;
}
function advanceTo(game, at) { return advance(game, at - game.elapsed); }
function close(actual, expected) { assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} should equal ${expected}`); }
function between(value, [minimum, maximum]) {
  assert.ok(value >= minimum && value <= maximum, `${value} should be within ${minimum}–${maximum}`);
}
function isolatedRain() {
  const game = running();
  const plant = game.plants[0];
  plant.stage = 5;
  plant.nextGrowthAt = Infinity;
  plant.nextSpawnAt = Infinity;
  plant.berries = [];
  game.rain.nextStartsAt = 10;
  return { game, plant };
}
function berry(id, stageEndsAt, countedRotten = false) {
  return { id, bornAt: 0, stageEndsAt, countedRotten, slot: id - 1, rainBoostedStages: [] };
}
function assertCredit(original, watered, at, bonus) {
  const current = berryStage(original, at);
  const remaining = original.stageEndsAt[current] - at;
  const credit = Math.min(bonus, Math.max(0, remaining - CONFIG.minimumBerryStageSeconds));
  close(original.stageEndsAt[current] - watered.stageEndsAt[current], credit);
  for (let stage = 0; stage < 7; stage++) {
    const before = original.stageEndsAt[stage];
    const after = watered.stageEndsAt[stage];
    if (before <= at) assert.equal(after, before, 'past transitions must not change');
    if (stage > 0) assert.ok(after > watered.stageEndsAt[stage - 1], 'boundaries remain strictly increasing');
    if (stage >= current) close(before - after, credit);
    if (stage > current) close(after - watered.stageEndsAt[stage - 1], before - original.stageEndsAt[stage - 1]);
  }
}

test('weather keeps the original growth seed sequence and has an independent saved random stream', () => {
  const initial = createGame(42);
  assert.equal(initial.rngState, 1635343518, 'one plant and five complete seven-stage schedules consume the growth stream');
  assert.equal(initial.plants[0].nextGrowthAt, 14.009380699135363);
  assert.deepEqual(initial.plants[0].berries[0].stageEndsAt,
    [2.352500181645155, 6.661624974571168, 10.55184203851968, 15.054482826963067,
      20.157138446345925, 24.94626358989626, 27.420103604905307]);
  for (const seed of [0, 1, 42, 0xffffffff]) {
    const farm = running(seed), empty = running(seed);
    empty.plants = [];
    const growthRng = empty.rngState;
    advance(farm, 1200);
    advance(empty, 1200);
    assert.deepEqual(farm.rain, empty.rain, 'growth activity cannot alter the weather');
    assert.equal(farm.weatherRngState, empty.weatherRngState);
    assert.equal(empty.rngState, growthRng, 'weather must not draw from the growth stream');
  }
});

test('showers start every 30–60 game seconds, last 5–10 seconds, and keep one 1–3 second credit', () => {
  for (const seed of [0, 42, 123456789, 0xffffffff]) {
    const game = running(seed);
    game.plants = [];
    assert.equal(game.rain.active, false);
    assert.equal(game.rain.startedAt, null);
    assert.equal(game.rain.endsAt, null);
    assert.equal(game.rain.bonusSeconds, 0);
    between(game.rain.nextStartsAt, CONFIG.rainIntervalSeconds);
    for (let shower = 0; shower < 40; shower++) {
      const startsAt = game.rain.nextStartsAt;
      advanceTo(game, startsAt - .001);
      assert.equal(game.rain.active, false);
      assert.deepEqual(advanceTo(game, startsAt), [], 'weather does not add rot events');
      assert.equal(game.rain.active, true);
      assert.equal(game.rain.startedAt, startsAt);
      between(game.rain.endsAt - startsAt, CONFIG.rainDurationSeconds);
      between(game.rain.bonusSeconds, CONFIG.rainBonusSeconds);
      between(game.rain.nextStartsAt - startsAt, CONFIG.rainIntervalSeconds);
      const weather = structuredClone(game.rain);
      const rng = game.weatherRngState;
      advanceTo(game, game.rain.endsAt - .001);
      assert.deepEqual(game.rain, weather);
      assert.equal(game.weatherRngState, rng);
      advanceTo(game, game.rain.endsAt);
      assert.equal(game.rain.active, false);
      assert.equal(game.rain.bonusSeconds, 0);
      assert.equal(game.rain.nextStartsAt, weather.nextStartsAt);
      assert.equal(game.weatherRngState, rng, 'ending rain does not redraw its schedule');
    }
  }
});

test('the five backdated initial stages receive rain once without changing past boundaries or growth RNG', () => {
  const game = running();
  const initial = structuredClone(game.plants[0].berries);
  const rng = game.rngState;
  game.rain.nextStartsAt = .5;
  advanceTo(game, .5);
  for (const [stage, berry] of game.plants[0].berries.entries()) {
    assert.equal(berryStage(berry, game.elapsed), stage);
    assertCredit(initial[stage], berry, .5, game.rain.bonusSeconds);
    assert.deepEqual(berry.rainBoostedStages, [stage]);
  }
  const watered = structuredClone(game.plants[0].berries);
  advance(game, .001);
  assert.deepEqual(game.plants[0].berries, watered);
  assert.equal(game.rngState, rng);
  assert.equal(game.score, 0);
});

test('rain credits each of the seven current stages once and preserves past and later stage durations', () => {
  const { game, plant } = isolatedRain();
  plant.berries = Array.from({ length: 7 }, (_, stage) => berry(stage + 1,
    Array.from({ length: 7 }, (_, boundary) => boundary < stage ? boundary + 1 : 30 + (boundary - stage) * 8), stage === 6));
  const before = structuredClone(plant.berries);
  const rng = game.rngState;
  assert.deepEqual(advanceTo(game, 10), []);
  const bonus = game.rain.bonusSeconds;
  for (let i = 0; i < 7; i++) {
    assert.equal(berryStage(plant.berries[i], 10), i, 'watering cannot instantly skip a stage');
    assertCredit(before[i], plant.berries[i], 10, bonus);
    assert.deepEqual(plant.berries[i].rainBoostedStages, [i]);
  }
  const watered = structuredClone(plant.berries);
  for (let frame = 0; frame < 100; frame++) advance(game, .01);
  assert.deepEqual(plant.berries, watered, 'frequent updates cannot apply the credit again');
  advanceTo(game, game.rain.endsAt);
  assert.deepEqual(plant.berries, watered, 'the water already received is retained after rain');
  assert.equal(game.rngState, rng);
  assert.equal(game.score, 0);
  assert.equal(game.lives, 10000);
});

test('each nearly finished stage stays ordered without being skipped or having its remaining time lengthened', () => {
  for (let stage = 0; stage < 7; stage++) for (const remaining of [.05, .1, .2, 1]) {
    const { game, plant } = isolatedRain();
    const original = berry(1, Array.from({ length: 7 }, (_, boundary) => boundary < stage ? boundary + 1
      : 10 + remaining + (boundary - stage) * 8), stage === 6);
    plant.berries = [structuredClone(original)];
    advanceTo(game, 10);
    const watered = plant.berries[0];
    assertCredit(original, watered, 10, game.rain.bonusSeconds);
    close(watered.stageEndsAt[stage] - 10, Math.min(remaining, .1));
    assert.equal(berryStage(watered, 10), stage);
    advanceTo(game, watered.stageEndsAt[stage]);
    assert.equal(berryStage(watered, game.elapsed), stage === 6 ? -1 : stage + 1);
  }
});

test('every stage entered during rain receives its own credit, with one rot event at disappearance', () => {
  const { game, plant } = isolatedRain();
  plant.berries = [berry(1, [11, 12, 13, 14, 15, 16, 17])];
  const item = plant.berries[0];
  const events = [];
  let at = 10;
  for (let stage = 0; stage < 7; stage++) {
    const before = structuredClone(item);
    events.push(...advanceTo(game, at));
    assert.equal(berryStage(item, at), stage);
    assert.deepEqual(item.rainBoostedStages, Array.from({ length: stage + 1 }, (_, i) => i));
    assertCredit(before, item, at, game.rain.bonusSeconds);
    close(item.stageEndsAt[stage] - at, .1);
    const credited = structuredClone(item);
    advanceTo(game, item.stageEndsAt[stage] - .001);
    assert.deepEqual(item, credited, 'a second update in the same stage cannot credit it again');
    at = item.stageEndsAt[stage];
  }
  events.push(...advanceTo(game, at));
  assert.equal(berryStage(item, at), -1);
  assert.equal(plant.berries.length, 0);
  assert.deepEqual(events, [{ type: 'rot', plantId: plant.id, berryId: item.id, slot: 0, points: -500, at: item.stageEndsAt[6] }]);
  assert.equal(game.missed, 1);
  assert.equal(game.lives, 9999);
  assert.equal(game.score, -500);
});

test('a transition at rain start gets the next-stage credit, while rain end and later transitions do not', () => {
  for (const boundaryAtEnd of [true, false]) {
    const { game, plant } = isolatedRain();
    plant.berries = [berry(1, [10, 30, 40, 50, 60, 70, 80])];
    const item = plant.berries[0];
    const before = structuredClone(item);
    advanceTo(game, 10);
    assert.equal(berryStage(item, 10), 1);
    assertCredit(before, item, 10, game.rain.bonusSeconds);
    assert.deepEqual(item.rainBoostedStages, [1]);
    // Put the credited stage's end exactly at, or after, the real rain end.
    // Its later durations are a controlled baseline for the dry transition.
    const next = game.rain.endsAt + (boundaryAtEnd ? 0 : 1);
    item.stageEndsAt = [10, next, next + 4, next + 9, next + 16, next + 21, next + 25];
    const saved = structuredClone(item);
    advanceTo(game, game.rain.endsAt);
    assert.equal(game.rain.active, false);
    assert.deepEqual(item, saved, 'ending rain does not undo an earlier credit');
    advanceTo(game, next);
    assert.equal(berryStage(item, game.elapsed), 2);
    assert.deepEqual(item, saved, 'a stage that begins after the rain receives no credit');
  }
});

test('five-second stages become three seconds with a two-second rain credit only while rain is active', () => {
  const { game, plant } = isolatedRain();
  advanceTo(game, 10);
  game.rain.bonusSeconds = 2;
  game.rain.endsAt = 17;
  plant.berries = [berry(1, [15, 20, 25, 30, 35, 40, 45])];
  const item = plant.berries[0];
  item.bornAt = 10;
  advance(game, .001);
  assert.deepEqual(item.stageEndsAt, [13, 18, 23, 28, 33, 38, 43]);
  advanceTo(game, 13);
  assert.deepEqual(item.stageEndsAt, [13, 16, 21, 26, 31, 36, 41]);
  advanceTo(game, 16);
  assert.deepEqual(item.stageEndsAt, [13, 16, 19, 24, 29, 34, 39]);
  const credited = structuredClone(item);
  advanceTo(game, 17);
  assert.equal(game.rain.active, false);
  assert.deepEqual(item, credited, 'the three-second stage retains its credit when rain stops');
  advanceTo(game, 19);
  assert.equal(berryStage(item, 19), 3);
  assert.equal(item.stageEndsAt[3] - 19, 5, 'the next dry stage keeps all five seconds');
  assert.deepEqual(item, credited);
});

test('new buds receive rain at its start and during rain, but not at its exact end', () => {
  const { game, plant } = isolatedRain();
  plant.nextSpawnAt = 10;
  const dry = structuredClone(game);
  dry.rain.nextStartsAt = Infinity;
  const dryPlant = dry.plants[0];
  for (const at of [10, 12.5]) {
    advanceTo(game, at);
    advanceTo(dry, at);
    const watered = plant.berries.at(-1);
    const original = dryPlant.berries.at(-1);
    assert.equal(watered.bornAt, at);
    assert.equal(original.bornAt, at);
    assertCredit(original, watered, at, game.rain.bonusSeconds);
    assert.equal(game.rngState, dry.rngState, 'rain does not redraw the seven baseline durations');
    assert.equal(plant.nextSpawnAt, dryPlant.nextSpawnAt, 'rain does not accelerate new bud production');
  }
  const endsAt = game.rain.endsAt;
  plant.nextSpawnAt = endsAt;
  dryPlant.nextSpawnAt = endsAt;
  advanceTo(game, endsAt);
  advanceTo(dry, endsAt);
  assert.equal(game.rain.active, false);
  assert.equal(plant.berries.at(-1).bornAt, endsAt);
  assert.deepEqual(plant.berries.at(-1), dryPlant.berries.at(-1), 'end-of-rain weather is processed before spawning');
  assert.equal(game.rngState, dry.rngState);
});

test('ready, pause and gameover freeze weather, while a clone resumes the same active rain', () => {
  const game = createGame(42);
  const ready = structuredClone(game);
  advance(game, 1200);
  assert.deepEqual(game, ready);
  startGame(game);
  game.lives = 10000;
  advanceTo(game, game.rain.nextStartsAt + 1);
  assert.equal(game.rain.active, true);
  pauseGame(game);
  const paused = structuredClone(game);
  advance(game, 1200);
  assert.deepEqual(game, paused);
  startGame(game);
  const clone = structuredClone(game);
  assert.deepEqual(advance(game, 300), advance(clone, 300));
  assert.deepEqual(game, clone);
  const ending = isolatedRain();
  advanceTo(ending.game, 10);
  ending.game.lives = 1;
  ending.plant.berries = [berry(1, [1, 2, 3, 4, 5, 9, 11])];
  assert.equal(advanceTo(ending.game, 11).length, 1);
  assert.equal(ending.game.status, 'gameover');
  assert.equal(ending.game.rain.active, true);
  const stopped = structuredClone(ending.game);
  startGame(ending.game);
  advance(ending.game, 1200);
  assert.deepEqual(ending.game, stopped);
});

test('multiple showers give identical schedules, weather, RNG and ordered rot events for large or small updates', () => {
  for (const seed of [0, 1, 42, 123456789, 0xffffffff]) {
    const large = running(seed), small = running(seed);
    const largeEvents = advance(large, 600);
    const smallEvents = [];
    for (let step = 0; step < 2400; step++) smallEvents.push(...advance(small, .25));
    assert.deepEqual(large, small, `full state for seed ${seed}`);
    assert.deepEqual(largeEvents, smallEvents, `rot events for seed ${seed}`);
    assert.ok(large.rain.startedAt > 500);
    assert.equal(new Set(largeEvents.map(event => event.berryId)).size, largeEvents.length);
    assert.equal(largeEvents.length, large.missed);
    assert.equal(large.score, large.missed * -500);
  }
});
