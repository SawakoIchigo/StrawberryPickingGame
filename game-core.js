export const CONFIG = Object.freeze({
  plantStageSeconds: 15,
  growthJitterSeconds: 2,
  maxPlants: 7,
  packSize: 8,
  initialLives: 10,
  berryStageSeconds: Object.freeze([4, 4, 5, 5, 7, 5, 4]),
  berryPoints: Object.freeze([0, 0, 0, 50, 150, 50, -500]),
  plantCapacity: Object.freeze({ 3: 3, 4: 5, 5: 7 }),
  spawnIntervalSeconds: Object.freeze({ 3: 6, 4: 4, 5: 2.5 }),
  rainIntervalSeconds: Object.freeze([30, 60]),
  rainDurationSeconds: Object.freeze([5, 10]),
  rainBonusSeconds: Object.freeze([1, 3]),
  minimumBerryStageSeconds: .1,
});
export const BERRY_NAMES = ['つぼみ', '花', '白い実', 'うすピンク', '赤い実', 'こい赤', 'くさった実'];
export function berryStage(berry, elapsed) {
  return berry.stageEndsAt.findIndex(boundary => elapsed < boundary);
}
function growthDuration(game, baseline) {
  // This game-owned PRNG is independent of rendering and survives structuredClone.
  game.rngState = (Math.imul(1664525, game.rngState) + 1013904223) >>> 0;
  return baseline + (game.rngState / 0x100000000 * 2 - 1) * CONFIG.growthJitterSeconds;
}
function weatherDuration(game, [minimum, maximum]) {
  // Weather has its own saved stream, so rain never consumes growth randomness.
  game.weatherRngState = (Math.imul(1664525, game.weatherRngState) + 1013904223) >>> 0;
  return minimum + game.weatherRngState / 0x100000000 * (maximum - minimum);
}
function waterBerry(game, berry) {
  if (!game.rain.active) return;
  const stage = berryStage(berry, game.elapsed);
  if (stage < 0 || berry.rainBoostedStages.includes(stage)) return;
  berry.rainBoostedStages.push(stage);
  const remaining = berry.stageEndsAt[stage] - game.elapsed;
  const bonus = Math.min(game.rain.bonusSeconds, Math.max(0, remaining - CONFIG.minimumBerryStageSeconds));
  if (bonus <= 0) return;
  // Credit only the current stage, once. Move its later deadlines together so
  // future stages keep their baseline duration until they also receive rain.
  berry.stageEndsAt = berry.stageEndsAt.map((at, index) => index >= stage ? at - bonus : at);
}
function processWeather(game) {
  const rain = game.rain;
  if (rain.active && rain.endsAt <= game.elapsed) {
    rain.active = false;
    rain.bonusSeconds = 0;
  }
  if (!rain.active && rain.nextStartsAt <= game.elapsed) {
    rain.active = true;
    rain.startedAt = game.elapsed;
    rain.endsAt = game.elapsed + weatherDuration(game, CONFIG.rainDurationSeconds);
    rain.bonusSeconds = weatherDuration(game, CONFIG.rainBonusSeconds);
    rain.nextStartsAt = game.elapsed + weatherDuration(game, CONFIG.rainIntervalSeconds);
  }
}
function addPlant(game, stage) {
  const plant = { id: game.nextPlantId++, stage, stageStartedAt: game.elapsed,
    nextGrowthAt: game.elapsed + growthDuration(game, CONFIG.plantStageSeconds),
    nextSpawnAt: stage >= 3 ? game.elapsed : Infinity, berries: [] };
  game.plants.push(plant);
  return plant;
}
function addBerry(game, plant, slot, initialStage = 0) {
  let boundary = game.elapsed;
  const stageEndsAt = CONFIG.berryStageSeconds.map(duration => (boundary += growthDuration(game, duration)));
  // Backdate the entire saved schedule, leaving a full current-stage duration.
  // Later berries use stage zero and therefore retain the normal birth rules.
  const past = initialStage === 0 ? 0 : stageEndsAt[initialStage - 1] - game.elapsed;
  const berry = { id: game.nextBerryId++, bornAt: game.elapsed - past,
    stageEndsAt: stageEndsAt.map(at => at - past), countedRotten: false, slot, rainBoostedStages: [] };
  waterBerry(game, berry);
  plant.berries.push(berry);
}
export function createGame(seed = Math.floor(Math.random() * 0x100000000)) {
  const game = { status: 'ready', elapsed: 0, shipments: 0, missed: 0, score: 0, lives: CONFIG.initialLives, pack: [], plants: [], nextPlantId: 1, nextBerryId: 1, rngState: seed >>> 0,
    weatherRngState: (seed ^ 0x9e3779b9) >>> 0,
    rain: { active: false, startedAt: null, endsAt: null, nextStartsAt: null, bonusSeconds: 0 } };
  game.rain.nextStartsAt = weatherDuration(game, CONFIG.rainIntervalSeconds);
  const plant = addPlant(game, 4);
  for (let stage = 0; stage <= 4; stage++) addBerry(game, plant, stage, stage);
  plant.nextSpawnAt = game.elapsed + CONFIG.spawnIntervalSeconds[plant.stage];
  return game;
}
export function startGame(game) { if (game.status === 'ready' || game.status === 'paused') game.status = 'running'; }
export function pauseGame(game) { if (game.status === 'running') game.status = 'paused'; }
function processEvents(game, events = []) {
  // Update weather first: a berry born exactly as rain ends receives no credit.
  processWeather(game);
  for (const plant of [...game.plants]) {
    if (plant.nextGrowthAt <= game.elapsed && plant.stage < 5) {
      plant.stage++;
      plant.stageStartedAt = game.elapsed;
      plant.nextGrowthAt = plant.stage < 5 ? game.elapsed + growthDuration(game, CONFIG.plantStageSeconds) : Infinity;
      if (plant.stage === 3) plant.nextSpawnAt = game.elapsed;
      if (plant.stage > 3) plant.nextSpawnAt = Math.min(plant.nextSpawnAt, game.elapsed + CONFIG.spawnIntervalSeconds[plant.stage]);
      if (plant.stage === 5 && game.plants.length < CONFIG.maxPlants) addPlant(game, 1);
    }
    for (const berry of plant.berries) {
      waterBerry(game, berry);
      const stage = berryStage(berry, game.elapsed);
      if ((stage === 6 || stage === -1) && !berry.countedRotten) {
        berry.countedRotten = true;
        game.missed++;
        game.score += CONFIG.berryPoints[6];
        game.lives = Math.max(0, game.lives - 1);
        events.push({ type: 'rot', plantId: plant.id, berryId: berry.id, slot: berry.slot,
          points: CONFIG.berryPoints[6], at: game.elapsed });
        if (game.lives === 0) { game.status = 'gameover'; return; }
      }
    }
    plant.berries = plant.berries.filter(berry => berryStage(berry, game.elapsed) !== -1);
    if (plant.nextSpawnAt <= game.elapsed) {
      if (plant.berries.length < CONFIG.plantCapacity[plant.stage]) {
        const slot = Array.from({ length: CONFIG.plantCapacity[plant.stage] }, (_, i) => i)
          .find(i => !plant.berries.some(berry => berry.slot === i));
        addBerry(game, plant, slot);
      }
      plant.nextSpawnAt = game.elapsed + CONFIG.spawnIntervalSeconds[plant.stage];
    }
  }
}
export function advance(game, seconds) {
  const events = [];
  if (game.status !== 'running' || !Number.isFinite(seconds) || seconds <= 0) return events;
  const target = game.elapsed + seconds;
  while (game.status === 'running' && game.elapsed < target) {
    let next = Math.min(target, game.rain.active ? game.rain.endsAt : game.rain.nextStartsAt);
    for (const plant of game.plants) {
      next = Math.min(next, plant.nextGrowthAt, plant.nextSpawnAt);
      for (const berry of plant.berries) {
        const boundary = berry.stageEndsAt.find(value => value > game.elapsed);
        if (boundary !== undefined) next = Math.min(next, boundary);
      }
    }
    game.elapsed = next;
    processEvents(game, events);
  }
  return events;
}
export function pickBerry(game, plantId, berryId) {
  if (game.status !== 'running' || game.pack.length >= CONFIG.packSize) return false;
  const plant = game.plants.find(item => item.id === plantId);
  const berry = plant?.berries.find(item => item.id === berryId);
  if (!berry) return false;
  const stage = berryStage(berry, game.elapsed);
  if (stage < 3 || stage > 5) return false;
  game.pack.push({ id: berry.id, stage });
  game.score += CONFIG.berryPoints[stage];
  plant.berries = plant.berries.filter(item => item.id !== berryId);
  return true;
}
export function shipPack(game) {
  if (game.status !== 'running' || game.pack.length !== CONFIG.packSize) return false;
  game.shipments++;
  game.pack = [];
  return true;
}
