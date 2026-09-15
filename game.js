import { CONFIG, BERRY_NAMES, createGame, startGame, pauseGame, advance, berryStage, pickBerry, shipPack } from './game-core.js';
import { FIELD, fieldPlantOrigin, createFieldLayout, createPlantLayout, placeFruit, releaseFruit } from './visual-layout.js';

let game = createGame();
let visualField = createFieldLayout(Math.floor(Math.random() * 4294967296));
let previousFrame = null;
let renderAt = -Infinity;
let restartPreviousStatus = 'ready';
const $ = id => document.getElementById(id);
const fallback = ['🌱', '🌱', '🌿', '🌿', '🌳', '🌱', '🌼', '⚪', '🍓', '🍓', '🍓', '🥀'];
const plantElements = new Map();
const berryElements = new Map();
const berryPoints = CONFIG.berryPoints;
let hasShownHarvestTip = false;
let harvestTipTimer;
let guideWasRunning = false;
function sprite(index, stage) {
  const element = document.createElement('span');
  element.className = 'sprite';
  element.setAttribute('aria-hidden', 'true');
  element.style.setProperty('--sprite-column', index % 4);
  element.style.setProperty('--sprite-row', Math.floor(index / 4));
  element.textContent = fallback[index];
  if (stage !== undefined) element.dataset.stage = stage;
  return element;
}
// The game works with emoji while the optional local atlas loads.
const atlas = new Image();
atlas.onload = () => {
  document.documentElement.style.setProperty('--sprite-url', 'url("./assets/game-sprites.png")');
  document.documentElement.classList.add('sprites-ready');
};
atlas.src = './assets/game-sprites.png';
$('farm').style.width = `${FIELD.width}px`;
$('farm').style.height = `${FIELD.height}px`;
const pointEffects = new Map();
function showPoints(button, points) {
  if (!button?.isConnected) return;
  const rect = button.getBoundingClientRect();
  const frameRect = document.querySelector('.app').getBoundingClientRect();
  const element = document.createElement('span');
  element.className = `point-popup${points < 0 ? ' negative' : ''}`;
  element.textContent = `${points < 0 ? '−' : '+'}${Math.abs(points)}`;
  element.style.left = `${rect.left + rect.width / 2 - frameRect.left}px`;
  element.style.top = `${rect.top + rect.height / 2 - frameRect.top}px`;
  $('point-effects').append(element);
  const remove = () => { element.remove(); pointEffects.delete(element); };
  pointEffects.set(element, setTimeout(remove, 1300));
  if (pointEffects.size > 40) {
    const [old, timer] = pointEffects.entries().next().value;
    clearTimeout(timer); old.remove(); pointEffects.delete(old);
  }
}
function advanceAndShow(seconds) {
  for (const event of advance(game, seconds)) {
    const button = berryElements.get(event.berryId);
    if (button?.dataset.plantId === String(event.plantId)) showPoints(button, event.points);
  }
}
function fitFarm() {
  const viewport = document.querySelector('.farm-viewport');
  const scale = Math.min(viewport.clientWidth / FIELD.width, viewport.clientHeight / FIELD.height);
  $('farm').style.transform = `translate(-50%, -50%) scale(${scale})`;
}
new ResizeObserver(fitFarm).observe(document.querySelector('.farm-viewport'));

function announce(message) { $('feedback').textContent = message; }
function syncTime() {
  const now = performance.now();
  if (previousFrame !== null) advanceAndShow((now - previousFrame) / 1000);
  previousFrame = now;
}
function begin() {
  if (document.hidden) return false;
  if (game.status === 'ready' && !hasShownHarvestTip) {
    hasShownHarvestTip = true;
    $('harvest-tip').hidden = false;
    harvestTipTimer = setTimeout(() => { $('harvest-tip').hidden = true; }, 3000);
  }
  startGame(game);
  previousFrame = performance.now();
  if ($('welcome').open) $('welcome').close();
  if ($('pause-dialog').open) $('pause-dialog').close();
  render();
  return true;
}
function pause() {
  syncTime();
  pauseGame(game);
  if (game.status === 'paused' && !$('restart-dialog').open && !$('pause-dialog').open) $('pause-dialog').showModal();
  render();
}
function harvest(plantId, berryId) {
  syncTime();
  const berry = game.plants.find(plant => plant.id === plantId)?.berries.find(item => item.id === berryId);
  const points = berry ? berryPoints[berryStage(berry, game.elapsed)] : 0;
  if (!pickBerry(game, plantId, berryId)) return false;
  showPoints(berryElements.get(berryId), points);
  announce(`+${points}ポイント！ ${game.pack.length === CONFIG.packSize ? '8こそろった！ 出荷しよう' : `あと${CONFIG.packSize - game.pack.length}こ`}`);
  render();
  return true;
}
function ship() {
  syncTime();
  if (!shipPack(game)) return false;
  announce(`${game.shipments}パック出荷できたよ！ ありがとう！`);
  render();
  return true;
}
function buildPlant(plant) {
  const anatomy = createPlantLayout(Math.floor(Math.random() * 4294967296), plant.id - 1, visualField);
  const article = document.createElement('article');
  article.className = 'plant';
  article.setAttribute('aria-label', `${plant.id}ばんの株`);
  article.style.transformOrigin = `${anatomy.fieldCrown.x}px ${anatomy.fieldCrown.y}px`;
  article.style.setProperty('--wind-angle', `${anatomy.wind.angle}deg`);
  article.style.setProperty('--wind-duration', `${anatomy.wind.duration}s`);
  article.style.setProperty('--wind-phase', `${anatomy.wind.phase}s`);
  const origin = fieldPlantOrigin(plant.id - 1);
  article.innerHTML = '<div class="plant-scene"><svg class="leaf-stalks" viewBox="0 0 300 360" aria-hidden="true" focusable="false"></svg><svg class="plant-art" viewBox="0 0 300 360" aria-hidden="true" focusable="false"></svg><svg class="fruit-stalks" viewBox="0 0 300 360" aria-hidden="true" focusable="false"></svg><div class="berries"></div></div>';
  const leaves = anatomy.leaves.map(leaf => {
    const element = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    element.classList.add('leaf-group');
    element.setAttribute('transform', `translate(${origin.x + (leaf.x - anatomy.crown.x) * FIELD.leafScale} ${origin.y + (leaf.y - anatomy.crown.y) * FIELD.leafScale}) rotate(${leaf.angle}) scale(${leaf.size * FIELD.leafScale})`);
    // All blades start at their branch endpoint; the midrib shares that base.
    for (const { x, y, angle, length, width } of leaf.blades) {
      const branch = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      branch.classList.add('leaf-branch');
      const angleRadians = angle * Math.PI / 180;
      branch.setAttribute('d', `M0 0 C0 -3 ${x - Math.sin(angleRadians) * 5} ${y + Math.cos(angleRadians) * 5} ${x} ${y}`);
      element.append(branch);
      const blade = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      blade.setAttribute('transform', `translate(${x} ${y}) rotate(${angle}) scale(${width} ${length})`);
      blade.innerHTML = '<path class="leaf-blade" d="M0 0 C-10 -3 -16 -11 -15 -18 L-18 -20 L-14 -23 L-16 -26 L-11 -29 L-12 -32 L-7 -34 Q-3 -40 0 -44 Q3 -40 7 -34 L12 -32 L11 -29 L16 -26 L14 -23 L18 -20 L15 -18 C16 -11 10 -3 0 0Z"/><path class="leaf-vein" d="M0 -1 L0 -39 M0 -10 L-9 -17 M0 -18 L-11 -26 M0 -27 L-7 -33 M0 -10 L9 -17 M0 -18 L11 -26 M0 -27 L7 -33"/>';
      element.append(blade);
    }
    article.querySelector('.plant-art').append(element);
    const stalk = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    stalk.setAttribute('d', leaf.path);
    stalk.setAttribute('transform', `translate(${origin.x - anatomy.crown.x * FIELD.leafScale} ${origin.y - anatomy.crown.y * FIELD.leafScale}) scale(${FIELD.leafScale})`);
    stalk.classList.add('leaf-stalk');
    article.querySelector('.leaf-stalks').append(stalk);
    return { element, stalk, stage: leaf.stage };
  });
  const slots = [];
  const stalks = [];
  for (let i = 0; i < 7; i++) {
    const stalk = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    stalk.classList.add('fruit-stalk');
    article.querySelector('.fruit-stalks').append(stalk);
    stalks.push(stalk);
    const slot = document.createElement('div');
    slot.className = 'berry-slot';
    article.querySelector('.berries').append(slot);
    slots.push(slot);
  }
  $('farm').append(article);
  const view = { article, slots, stalks, leaves, anatomy, stage: 0 };
  plantElements.set(plant.id, view);
  return view;
}
function render() {
  document.documentElement.dataset.gameStatus = game.status;
  const minutes = Math.floor(game.elapsed / 60);
  $('elapsed').textContent = `${minutes}:${String(Math.floor(game.elapsed % 60)).padStart(2, '0')}`;
  $('shipments').textContent = game.shipments;
  $('missed').textContent = game.missed;
  $('score').textContent = game.score;
  $('plant-count').textContent = `${game.plants.length} / ${CONFIG.maxPlants} 株`;
  $('pause').disabled = game.status !== 'running';
  const liveBerryIds = new Set(game.plants.flatMap(plant => plant.berries.map(berry => berry.id)));
  for (const [id, button] of berryElements) {
    if (!liveBerryIds.has(id)) { button.remove(); berryElements.delete(id); }
  }
  for (const plant of game.plants) {
    const view = plantElements.get(plant.id) ?? buildPlant(plant);
    if (view.stage !== plant.stage) {
      view.article.dataset.plantStage = plant.stage;
      view.article.setAttribute('aria-label', `${plant.id}ばんの株、レベル${plant.stage}`);
      for (const leaf of view.leaves) {
        const visible = leaf.stage <= plant.stage;
        leaf.element.style.display = visible ? '' : 'none';
        leaf.stalk.style.display = visible ? '' : 'none';
      }
      view.stage = plant.stage;
    }
    const occupiedSlots = new Set(plant.berries.map(berry => berry.slot));
    const plantBerryIds = new Set(plant.berries.map(berry => berry.id));
    for (const id of view.anatomy.occupiedCells.keys()) if (!plantBerryIds.has(id)) releaseFruit(view.anatomy, id);
    view.stalks.forEach((stalk, index) => stalk.classList.toggle('occupied', occupiedSlots.has(index)));
    for (const berry of plant.berries) {
      const stage = berryStage(berry, game.elapsed);
      let button = berryElements.get(berry.id);
      if (!button) {
        const attachment = placeFruit(view.anatomy, berry.id, berry.slot);
        view.slots[berry.slot].style.left = `${attachment.x / 3}%`;
        view.slots[berry.slot].style.top = `${attachment.y / 3.6}%`;
        view.stalks[berry.slot].setAttribute('d', attachment.path);
        button = document.createElement('button');
        button.type = 'button';
        button.dataset.plantId = plant.id;
        button.addEventListener('click', () => harvest(plant.id, berry.id));
        view.slots[berry.slot].append(button);
        berryElements.set(berry.id, button);
      }
      const ripe = stage >= 3 && stage <= 5;
      if (button.dataset.stage !== String(stage)) {
        button.dataset.stage = stage;
        button.className = `berry${ripe ? ' ripe' : ''}${stage === 6 ? ' rotten' : ''}`;
        button.replaceChildren(sprite(stage + 5, stage));
      }
      button.disabled = !ripe || game.status !== 'running' || game.pack.length === CONFIG.packSize;
      button.setAttribute('aria-label', `${plant.id}ばんの株、${BERRY_NAMES[stage]}${ripe ? 'を収穫' : ''}`);
    }
  }
  $('pack-count').textContent = `${game.pack.length} / ${CONFIG.packSize}`;
  const signature = game.pack.map(berry => berry.id).join(',');
  if ($('pack').dataset.signature !== signature) {
    $('pack').dataset.signature = signature;
    $('pack').replaceChildren(...Array.from({ length: CONFIG.packSize }, (_, i) => {
      const slot = document.createElement('div'); slot.className = 'pack-slot';
      if (game.pack[i]) { slot.append(sprite(game.pack[i].stage + 5, game.pack[i].stage)); slot.setAttribute('aria-label', `${i + 1}こめ、${BERRY_NAMES[game.pack[i].stage]}`); }
      else { slot.textContent = i + 1; slot.setAttribute('aria-label', `${i + 1}こめ、から`); }
      return slot;
    }));
  }
  $('ship').disabled = game.pack.length !== CONFIG.packSize || game.status !== 'running';
  $('ship').textContent = game.pack.length === CONFIG.packSize ? '出荷する！' : `あと${CONFIG.packSize - game.pack.length}こで出荷`;
}
for (let i = 0; i < BERRY_NAMES.length; i++) {
  const item = document.createElement('div');
  item.className = `legend-item${i >= 3 && i <= 5 ? ' pickable' : ''}${i === 4 ? ' best-ripeness' : ''}`;
  const name = document.createElement('span'); name.className = 'legend-name'; name.textContent = BERRY_NAMES[i];
  const detail = document.createElement('span'); detail.className = 'legend-detail';
  detail.textContent = i < 3 ? 'まだ収穫できない' : i === 6 ? '腐ると減点' : i === 4 ? 'いちばん高得点！' : '収穫できるよ';
  const points = document.createElement('strong'); points.className = 'legend-points';
  points.textContent = berryPoints[i] ? `${berryPoints[i] > 0 ? '+' : '−'}${Math.abs(berryPoints[i])}点` : '—';
  item.append(sprite(i + 5, i), name, detail, points);
  $('legend').append(item);
}
$('start').addEventListener('click', begin);
$('pause').addEventListener('click', pause);
$('resume').addEventListener('click', begin);
$('ship').addEventListener('click', ship);
$('show-guide').addEventListener('click', () => {
  syncTime(); guideWasRunning = game.status === 'running'; pauseGame(game);
  $('guide-dialog').showModal(); render();
});
function closeGuide() {
  $('guide-dialog').close();
  if (guideWasRunning) begin();
}
$('close-guide').addEventListener('click', closeGuide);
$('guide-dialog').addEventListener('cancel', event => { event.preventDefault(); closeGuide(); });
$('restart').addEventListener('click', () => {
  syncTime();
  restartPreviousStatus = game.status;
  pauseGame(game);
  $('restart-dialog').showModal();
  render();
});
function cancelRestart() {
  $('restart-dialog').close();
  if (restartPreviousStatus === 'running') begin();
}
$('cancel-restart').addEventListener('click', cancelRestart);
$('restart-dialog').addEventListener('cancel', event => { event.preventDefault(); cancelRestart(); });
$('confirm-restart').addEventListener('click', () => {
  $('restart-dialog').close();
  clearTimeout(harvestTipTimer); $('harvest-tip').hidden = true;
  for (const [element, timer] of pointEffects) { clearTimeout(timer); element.remove(); }
  pointEffects.clear();
  game = createGame();
  visualField = createFieldLayout(Math.floor(Math.random() * 4294967296));
  plantElements.clear(); berryElements.clear(); $('farm').replaceChildren();
  announce('おいしいいちごを集めよう');
  previousFrame = performance.now();
  render();
  $('welcome').showModal();
});
for (const id of ['welcome', 'pause-dialog']) $(id).addEventListener('cancel', event => event.preventDefault());
document.addEventListener('visibilitychange', () => {
  if (document.hidden && game.status === 'running') pause();
  previousFrame = performance.now();
});
function frame(now) {
  if (previousFrame !== null) advanceAndShow((now - previousFrame) / 1000);
  previousFrame = now;
  if (now - renderAt >= 100) { render(); renderAt = now; }
  requestAnimationFrame(frame);
}
render();
$('welcome').showModal();
requestAnimationFrame(frame);

// Optional browser-provided WebMCP tools. All mutations use the same UI actions.
if (document.modelContext?.registerTool) {
  const lifetime = new AbortController();
  const registered = [];
  const result = value => ({ content: [{ type: 'text', text: JSON.stringify(value) }] });
  const definitions = [
    { name: 'get_game_state', description: 'Read the strawberry farm and pickable berry IDs.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true }, execute: () => { syncTime(); return result({ status: game.status, elapsed: game.elapsed, shipments: game.shipments, missed: game.missed, score: game.score, packCount: game.pack.length, plants: game.plants.map(plant => ({ id: plant.id, stage: plant.stage, berries: plant.berries.map(berry => ({ id: berry.id, stage: berryStage(berry, game.elapsed), pickable: berryStage(berry, game.elapsed) >= 3 && berryStage(berry, game.elapsed) <= 5 })) })) }); } },
    { name: 'start_game', description: 'Start the game from the initial welcome screen. Does not reset or resume.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, execute: () => result({ started: game.status === 'ready' && begin() }) },
    { name: 'pick_strawberries', description: 'Pick a batch of ripe strawberries, up to the eight-berry pack limit.', inputSchema: { type: 'object', properties: { berries: { type: 'array', maxItems: 8, items: { type: 'object', properties: { plantId: { type: 'integer', minimum: 1 }, berryId: { type: 'integer', minimum: 1 } }, required: ['plantId', 'berryId'], additionalProperties: false } } }, required: ['berries'], additionalProperties: false }, execute: input => { if (!input || !Array.isArray(input.berries) || input.berries.length > 8 || input.berries.some(berry => !berry || !Number.isInteger(berry.plantId) || berry.plantId < 1 || !Number.isInteger(berry.berryId) || berry.berryId < 1)) return result({ error: 'Expected up to eight positive integer plantId/berryId pairs.' }); return result({ picked: input.berries.map(berry => harvest(berry.plantId, berry.berryId)) }); } },
    { name: 'ship_pack', description: 'Ship only when the pack contains exactly eight strawberries.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, execute: () => result({ shipped: ship() }) },
  ];
  for (const definition of definitions) {
    if (!definition.annotations) definition.annotations = { readOnlyHint: false };
    try { Promise.resolve(document.modelContext.registerTool(definition, { signal: lifetime.signal })).catch(() => {}); registered.push(definition.name); }
    catch { /* Unsupported optional tools never prevent the game from starting. */ }
  }
  window.addEventListener('pagehide', () => {
    lifetime.abort();
    for (const name of registered) { try { document.modelContext.unregisterTool?.(name); } catch { /* Already unregistered. */ } }
  }, { once: true });
}
