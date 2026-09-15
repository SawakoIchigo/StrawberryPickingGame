export const CONFIG = Object.freeze({
  plantStageSeconds: 15,
  growthJitterSeconds: 2,
  maxPlants: 5,
  packSize: 8,
  berryStageSeconds: Object.freeze([4, 4, 5, 5, 7, 5, 4]),
  berryPoints: Object.freeze([0, 0, 0, 50, 150, 50, -50]),
  plantCapacity: Object.freeze({ 3: 3, 4: 5, 5: 7 }),
  spawnIntervalSeconds: Object.freeze({ 3: 6, 4: 4, 5: 2.5 }),
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
function addPlant(game, stage) {
  const plant = { id: game.nextPlantId++, stage, stageStartedAt: game.elapsed,
    nextGrowthAt: game.elapsed + growthDuration(game, CONFIG.plantStageSeconds),
    nextSpawnAt: stage >= 3 ? game.elapsed : Infinity, berries: [] };
  game.plants.push(plant);
  return plant;
}
export function createGame(seed = Math.floor(Math.random() * 0x100000000)) {
  const game = { status: 'ready', elapsed: 0, shipments: 0, missed: 0, score: 0, pack: [], plants: [], nextPlantId: 1, nextBerryId: 1, rngState: seed >>> 0 };
  addPlant(game, 3);
  processEvents(game);
  return game;
}
export function startGame(game) { if (game.status === 'ready' || game.status === 'paused') game.status = 'running'; }
export function pauseGame(game) { if (game.status === 'running') game.status = 'paused'; }
function processEvents(game, events = []) {
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
      const stage = berryStage(berry, game.elapsed);
      if ((stage === 6 || stage === -1) && !berry.countedRotten) {
        berry.countedRotten = true;
        game.missed++;
        game.score += CONFIG.berryPoints[6];
        events.push({ type: 'rot', plantId: plant.id, berryId: berry.id, slot: berry.slot,
          points: CONFIG.berryPoints[6], at: game.elapsed });
      }
    }
    plant.berries = plant.berries.filter(berry => berryStage(berry, game.elapsed) !== -1);
    if (plant.nextSpawnAt <= game.elapsed) {
      if (plant.berries.length < CONFIG.plantCapacity[plant.stage]) {
        const slot = Array.from({ length: CONFIG.plantCapacity[plant.stage] }, (_, i) => i)
          .find(i => !plant.berries.some(berry => berry.slot === i));
        let boundary = game.elapsed;
        const stageEndsAt = CONFIG.berryStageSeconds.map(duration => (boundary += growthDuration(game, duration)));
        plant.berries.push({ id: game.nextBerryId++, bornAt: game.elapsed, stageEndsAt, countedRotten: false, slot });
      }
      plant.nextSpawnAt = game.elapsed + CONFIG.spawnIntervalSeconds[plant.stage];
    }
  }
}
export function advance(game, seconds) {
  const events = [];
  if (game.status !== 'running' || !Number.isFinite(seconds) || seconds <= 0) return events;
  const target = game.elapsed + seconds;
  while (game.elapsed < target) {
    let next = target;
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
