import { CONFIG, BERRY_NAMES, createGame, startGame, pauseGame, advance, berryStage, pickBerry, shipPack } from './game-core.js';
import { FIELD, fieldPlantOrigin, createFieldLayout, createPlantLayout, placeFruit, releaseFruit, sampleBreeze, leafPose, stepScoreDisplay } from './visual-layout.js';
import { createHighScoreStore } from './high-scores.js';

let game = createGame();
const highScores = createHighScoreStore();
let visualField = createFieldLayout(Math.floor(Math.random() * 4294967296));
let previousFrame = null;
let renderAt = -Infinity;
let restartPreviousStatus = 'ready';
const $ = id => document.getElementById(id);
const lifeHearts = Array.from({ length: CONFIG.initialLives }, () => {
  const heart = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  heart.classList.add('life-heart');
  heart.setAttribute('viewBox', '0 0 24 24');
  heart.setAttribute('focusable', 'false');
  heart.innerHTML = '<path d="M12 21C9 18.5 2 13.5 2 8a5.5 5.5 0 0 1 10-3.2A5.5 5.5 0 0 1 22 8c0 5.5-7 10.5-10 13Z"/>';
  $('life-hearts').append(heart);
  return heart;
});
const fallback = ['🌱', '🌱', '🌿', '🌿', '🌳', '🌱', '🌼', '⚪', '🍓', '🍓', '🍓', '🥀'];
const plantElements = new Map();
const berryElements = new Map();
const berryPoints = CONFIG.berryPoints;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const scoreValue = $('score');
const scoreGroup = document.querySelector('.score-stat strong');
let scoreDisplay = { value: game.score, at: performance.now(), active: false };
function renderScore(now = performance.now(), immediate = false) {
  const next = stepScoreDisplay(scoreDisplay, game.score, now, immediate || reducedMotion.matches);
  if (next.value !== scoreDisplay.value) scoreValue.textContent = next.value;
  if (next.active !== scoreDisplay.active) scoreGroup.classList.toggle('is-counting', next.active);
  scoreDisplay = next;
}
const rainCurtain = document.querySelector('.rain-curtain');
const rainFarm = document.querySelector('.farm-panel');
const rainParticles = Array.from(document.querySelectorAll('.rain-drop'), element => ({ element }));
let rainWidth = 0;
let rainHeight = 0;
let rainWasActive = false;
let rainWasReduced = reducedMotion.matches;

// Visual randomness never consumes either of the game's saved random streams.
function seedRainParticle(particle, now, initial) {
  const gentle = reducedMotion.matches;
  particle.duration = gentle ? 2.6 + Math.random() * 1.4 : 1.1 + Math.random() * 1.25;
  particle.start = initial
    ? now - Math.random() * particle.duration
    : now + .04 + Math.random() * (gentle ? .65 : .4);
  particle.x = .025 + Math.random() * .91;
  particle.drift = .025 + Math.random() * .065;
  particle.size = 9 + Math.random() * 3;
  particle.element.style.width = `${particle.size}px`;
  particle.element.style.height = `${particle.size * 1.75}px`;
  particle.element.style.opacity = String(.55 + Math.random() * .2);
}

function renderRain() {
  if (!game.rain.active) {
    rainCurtain.style.opacity = '0';
    rainFarm.style.setProperty('--rain-alpha', '0');
    rainWasActive = false;
    return;
  }
  // Fade within the scheduled shower, so no rain lingers after its effect ends.
  const fadeProgress = Math.max(0, Math.min(1, game.elapsed - game.rain.startedAt, game.rain.endsAt - game.elapsed));
  const rainAlpha = String(fadeProgress * fadeProgress * (3 - 2 * fadeProgress));
  rainCurtain.style.opacity = rainAlpha;
  rainFarm.style.setProperty('--rain-alpha', rainAlpha);
  const gentle = reducedMotion.matches;
  const initialize = !rainWasActive || rainWasReduced !== gentle;
  if (!initialize && game.status !== 'running') return;
  rainWasActive = true;
  rainWasReduced = gentle;
  const distance = rainHeight + 64;
  for (let index = 0; index < rainParticles.length; index++) {
    const particle = rainParticles[index];
    if (gentle && index % 2 === 1) {
      particle.element.style.visibility = 'hidden';
      continue;
    }
    if (initialize) seedRainParticle(particle, game.elapsed, true);
    if (game.elapsed >= particle.start + particle.duration) {
      seedRainParticle(particle, game.elapsed, false);
    }
    const progress = (game.elapsed - particle.start) / particle.duration;
    particle.element.style.visibility = progress < 0 ? 'hidden' : 'visible';
    if (progress < 0) continue;
    const startX = particle.x * Math.max(0, rainWidth - particle.size);
    const drift = Math.min(distance * particle.drift, Math.max(0, rainWidth - particle.size - startX));
    const angle = -Math.atan2(drift, distance) * 180 / Math.PI;
    particle.element.style.transform = `translate3d(${startX + drift * progress}px,${distance * progress}px,0) rotate(${angle}deg)`;
  }
}
let hasShownHarvestTip = false;
let harvestTipTimer;
let guideWasRunning = false;
let deliverySuccessUntil = 0;
const effectTimers = new Map();
const praise = ['とれた！ じょうず！', 'いいね！ おいしそう！', 'ぽんっ！ できたね！', 'すてきな いちご！'];
function removeLater(element, milliseconds) {
  effectTimers.set(element, setTimeout(() => { element.remove(); effectTimers.delete(element); }, milliseconds));
  while (effectTimers.size > 40) {
    const [old, timer] = effectTimers.entries().next().value;
    clearTimeout(timer);
    old.remove();
    effectTimers.delete(old);
  }
}
function flyToPack(rect, stage, slotIndex) {
  if (reducedMotion.matches || !rect) return;
  const destination = $('pack').children[slotIndex]?.getBoundingClientRect();
  if (!destination) return;
  const appRect = document.querySelector('.app').getBoundingClientRect();
  const centerX = rect.left + rect.width / 2 - appRect.left;
  const centerY = rect.top + rect.height / 2 - appRect.top;
  const berrySize = rect.width * 36 / FIELD.hitSize;
  const burst = document.createElement('span');
  burst.className = 'harvest-burst';
  burst.setAttribute('aria-hidden', 'true');
  burst.style.left = `${centerX}px`;
  burst.style.top = `${centerY}px`;
  const burstSize = Math.max(26, berrySize);
  burst.style.setProperty('--burst-size', `${burstSize}px`);
  for (let i = 0; i < 8; i++) {
    const spark = document.createElement('i');
    spark.className = ['spark-berry', 'spark-leaf', 'spark-gold', 'spark-pink'][i % 4];
    const angle = (i * 45 - 90) * Math.PI / 180;
    const distance = burstSize * (i % 2 ? .95 : 1.2);
    spark.style.setProperty('--spark-x', `${Math.cos(angle) * distance}px`);
    spark.style.setProperty('--spark-y', `${Math.sin(angle) * distance}px`);
    spark.style.setProperty('--spark-delay', `${i % 3 * .025}s`);
    burst.append(spark);
  }
  const flight = document.createElement('span');
  flight.className = 'harvest-flight';
  flight.setAttribute('aria-hidden', 'true');
  flight.append(sprite(stage + 5, stage));
  flight.style.width = `${berrySize}px`;
  flight.style.height = `${berrySize}px`;
  flight.style.left = `${centerX - berrySize / 2}px`;
  flight.style.top = `${centerY - berrySize / 2}px`;
  flight.style.setProperty('--fly-x', `${destination.left + destination.width / 2 - rect.left - rect.width / 2}px`);
  flight.style.setProperty('--fly-y', `${destination.top + destination.height / 2 - rect.top - rect.height / 2}px`);
  // One visual berry pops at the harvest point before continuing to the pack.
  $('point-effects').append(burst, flight);
  removeLater(burst, 780);
  removeLater(flight, 950);
}
function celebrateDelivery() {
  if (reducedMotion.matches) return;
  const celebration = document.createElement('div');
  celebration.className = 'celebration';
  celebration.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 22; i++) {
    const piece = document.createElement('i');
    piece.style.setProperty('--x', `${15 + Math.random() * 70}%`);
    piece.style.setProperty('--y', `${20 + Math.random() * 20}%`);
    piece.style.setProperty('--color', ['#e76973', '#ecc458', '#79a475', '#faf4d5'][i % 4]);
    piece.style.setProperty('--delay', `${Math.random() * .25}s`);
    celebration.append(piece);
  }
  $('point-effects').append(celebration);
  removeLater(celebration, 1900);
}
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
  const previousStatus = game.status;
  for (const event of advance(game, seconds)) {
    const button = berryElements.get(event.berryId);
    if (button?.dataset.plantId === String(event.plantId)) showPoints(button, event.points);
  }
  if (previousStatus !== 'gameover' && game.status === 'gameover') render();
}
function fitFarm() {
  const viewport = document.querySelector('.farm-viewport');
  const scale = Math.min(viewport.clientWidth / FIELD.width, viewport.clientHeight / FIELD.height);
  viewport.style.setProperty('--farm-scale', scale);
  rainWidth = viewport.clientWidth;
  rainHeight = viewport.clientHeight;
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
  if (document.hidden || (game.status !== 'ready' && game.status !== 'paused')) return false;
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
  $('pause').focus({ preventScroll: true });
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
  const stage = berry ? berryStage(berry, game.elapsed) : 0;
  const points = berry ? berryPoints[stage] : 0;
  const button = berryElements.get(berryId);
  const rect = button?.getBoundingClientRect();
  const hadFocus = document.activeElement === button;
  if (!pickBerry(game, plantId, berryId)) return false;
  showPoints(berryElements.get(berryId), points);
  announce(game.pack.length === CONFIG.packSize ? '8こ そろった！ おとどけしよう！' : `${praise[(game.pack.length - 1) % praise.length]} あと ${CONFIG.packSize - game.pack.length}こ`);
  render();
  flyToPack(rect, stage, game.pack.length - 1);
  if (hadFocus) (game.pack.length === CONFIG.packSize ? $('ship') : document.querySelector('.berry:not(:disabled)') ?? $('pause')).focus({ preventScroll: true });
  return true;
}
function ship() {
  syncTime();
  if (!shipPack(game)) return false;
  const hadFocus = document.activeElement === $('ship');
  deliverySuccessUntil = performance.now() + 1900;
  announce(`${game.shipments}パック おとどけ！ また あつめよう！`);
  render();
  celebrateDelivery();
  if (hadFocus) (document.querySelector('.berry:not(:disabled)') ?? $('pause')).focus({ preventScroll: true });
  return true;
}
function buildPlant(plant) {
  const anatomy = createPlantLayout(Math.floor(Math.random() * 4294967296), plant.id - 1, visualField);
  const article = document.createElement('article');
  article.className = 'plant';
  article.setAttribute('aria-label', `${plant.id}ばんの株`);
  const origin = fieldPlantOrigin(plant.id - 1);
  article.innerHTML = '<div class="plant-scene"><svg class="leaf-stalks" viewBox="0 0 300 360" aria-hidden="true" focusable="false"></svg><svg class="plant-art" viewBox="0 0 300 360" aria-hidden="true" focusable="false"></svg><svg class="fruit-stalks" viewBox="0 0 300 360" aria-hidden="true" focusable="false"></svg><div class="berries"></div></div>';
  const leaves = anatomy.leaves.map(leaf => {
    const element = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    element.classList.add('leaf-group');
    element.setAttribute('transform', `translate(${origin.x + (leaf.x - anatomy.crown.x) * FIELD.leafScale} ${origin.y + (leaf.y - anatomy.crown.y) * FIELD.leafScale}) rotate(${leaf.angle}) scale(${leaf.size * FIELD.leafScale * FIELD.leafSize})`);
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
    return { element, stalk, model: leaf, stage: leaf.stage };
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
function renderBreeze() {
  if (game.status !== 'running' || reducedMotion.matches) return;
  const breeze = sampleBreeze(game.elapsed);
  for (const view of plantElements.values()) for (const leaf of view.leaves) {
    if (leaf.stage > view.stage) continue;
    const pose = leafPose(view.anatomy, leaf.model, breeze);
    const transform = `translate(${pose.x.toFixed(3)} ${pose.y.toFixed(3)}) rotate(${pose.angle.toFixed(3)}) scale(${leaf.model.size * FIELD.leafScale * FIELD.leafSize})`;
    if (leaf.transform !== transform) { leaf.element.setAttribute('transform', transform); leaf.transform = transform; }
    if (leaf.path !== pose.path) { leaf.stalk.setAttribute('d', pose.path); leaf.path = pose.path; }
  }
}
function render() {
  document.documentElement.dataset.gameStatus = game.status;
  const farmPanel = document.querySelector('.farm-panel');
  if (farmPanel.classList.contains('is-raining') !== game.rain.active) {
    farmPanel.classList.toggle('is-raining', game.rain.active);
    $('weather-sign').textContent = game.rain.active ? 'あめで すくすく！' : 'いちごの はたけ';
    document.querySelector('.farm-viewport').setAttribute('aria-label', game.rain.active ? 'いちご畑。あめで すくすく！ いちごの へんかが はやくなるよ' : '一つの鉢に育つ7株のいちご');
  }
  $('shipments').textContent = game.shipments;
  renderScore();
  if ($('lives').dataset.remaining !== String(game.lives)) {
    $('lives').dataset.remaining = game.lives;
    $('lives').setAttribute('aria-label', `残りライフ${game.lives} / ${CONFIG.initialLives}`);
    lifeHearts.forEach((heart, index) => heart.classList.toggle('lost', index >= game.lives));
  }
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
  const full = game.pack.length === CONFIG.packSize;
  if (full || game.status === 'gameover') deliverySuccessUntil = 0;
  const delivered = performance.now() < deliverySuccessUntil;
  document.querySelector('.workbench').classList.toggle('is-full', full);
  const pickableCount = [...berryElements.values()].filter(button => !button.disabled).length;
  $('field-hint').textContent = full ? 'パックが いっぱい！ おとどけしよう' : pickableCount ? 'いちごを タップしてね！' : 'ゆっくり そだっているよ';
  const signature = game.pack.map(berry => berry.id).join(',');
  if ($('pack').dataset.signature !== signature) {
    $('pack').dataset.signature = signature;
    $('pack').replaceChildren(...Array.from({ length: CONFIG.packSize }, (_, i) => {
      const slot = document.createElement('div'); slot.className = 'pack-slot';
      if (game.pack[i]) { slot.classList.add('filled'); slot.append(sprite(game.pack[i].stage + 5, game.pack[i].stage)); slot.setAttribute('aria-label', `${i + 1}こめ、${BERRY_NAMES[game.pack[i].stage]}`); }
      else { slot.textContent = i + 1; slot.setAttribute('aria-label', `${i + 1}こめ、から`); }
      return slot;
    }));
  }
  $('ship').disabled = game.pack.length !== CONFIG.packSize || game.status !== 'running';
  $('ship').classList.toggle('is-delivered', delivered);
  $('ship-label').textContent = delivered ? 'おとどけ できた！' : full ? 'おとどけする！' : `あと ${CONFIG.packSize - game.pack.length}こ`;
  $('ship').setAttribute('aria-label', delivered ? 'おとどけ できた！' : full ? 'おとどけする！' : `あと ${CONFIG.packSize - game.pack.length}こ あつめよう`);
  if (game.status === 'gameover' && !$('gameover-dialog').open) {
    clearTimeout(harvestTipTimer); $('harvest-tip').hidden = true;
    for (const id of ['welcome', 'pause-dialog', 'guide-dialog', 'restart-dialog']) if ($(id).open) $(id).close();
    $('gameover-result').textContent = `${game.shipments}パック おとどけ ／ ${game.score}てん`;
    const record = highScores.record(game, game.score);
    $('new-record').hidden = !record.newRecord;
    $('high-scores').replaceChildren(...record.scores.map((score, index) => {
      const item = document.createElement('li');
      const position = document.createElement('span');
      position.className = 'rank-position';
      position.setAttribute('aria-hidden', 'true');
      position.textContent = String(index + 1);
      const value = document.createElement('strong');
      value.textContent = `${score}てん`;
      item.classList.toggle('is-current', record.rank === index + 1);
      if (record.rank === index + 1) item.setAttribute('aria-current', 'true');
      item.append(position, value);
      return item;
    }));
    announce('おせわ ありがとう！ きょうの きろくを みよう。');
    $('gameover-dialog').showModal();
  }
}
for (let i = 0; i < BERRY_NAMES.length; i++) {
  const item = document.createElement('div');
  item.className = `legend-item${i >= 3 && i <= 5 ? ' pickable' : ''}${i === 4 ? ' best-ripeness' : ''}`;
  const name = document.createElement('span'); name.className = 'legend-name'; name.textContent = BERRY_NAMES[i];
  const detail = document.createElement('span'); detail.className = 'legend-detail';
  detail.textContent = i < 3 ? 'もうすこし まってね' : i === 6 ? 'ハートが ひとつ へるよ' : i === 4 ? 'いちばん おいしい！' : 'つめるよ！';
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
  syncTime();
  if (game.status === 'gameover') { render(); return; }
  guideWasRunning = game.status === 'running'; pauseGame(game);
  $('guide-dialog').showModal(); render();
});
function closeGuide() {
  $('guide-dialog').close();
  if (guideWasRunning) begin();
  $('show-guide').focus({ preventScroll: true });
}
$('close-guide').addEventListener('click', closeGuide);
$('guide-dialog').addEventListener('cancel', event => { event.preventDefault(); closeGuide(); });
$('restart').addEventListener('click', () => {
  syncTime();
  if (game.status === 'gameover') { render(); return; }
  restartPreviousStatus = game.status;
  pauseGame(game);
  $('restart-dialog').showModal();
  render();
});
function cancelRestart() {
  $('restart-dialog').close();
  if (restartPreviousStatus === 'running') begin();
  $('restart').focus({ preventScroll: true });
}
$('cancel-restart').addEventListener('click', cancelRestart);
$('restart-dialog').addEventListener('cancel', event => { event.preventDefault(); cancelRestart(); });
function resetGame() {
  deliverySuccessUntil = 0;
  for (const id of ['welcome', 'pause-dialog', 'guide-dialog', 'restart-dialog', 'gameover-dialog']) if ($(id).open) $(id).close();
  clearTimeout(harvestTipTimer); $('harvest-tip').hidden = true;
  hasShownHarvestTip = false; guideWasRunning = false; restartPreviousStatus = 'ready';
  for (const [element, timer] of pointEffects) { clearTimeout(timer); element.remove(); }
  pointEffects.clear();
  for (const [element, timer] of effectTimers) { clearTimeout(timer); element.remove(); }
  effectTimers.clear();
  game = createGame();
  renderScore(performance.now(), true);
  visualField = createFieldLayout(Math.floor(Math.random() * 4294967296));
  plantElements.clear(); berryElements.clear(); $('farm').replaceChildren();
  announce('いっしょに いちごを つもう！');
  previousFrame = performance.now();
  render();
  $('welcome').showModal();
}
$('confirm-restart').addEventListener('click', resetGame);
$('play-again').addEventListener('click', () => { resetGame(); begin(); });
for (const id of ['welcome', 'pause-dialog', 'gameover-dialog']) $(id).addEventListener('cancel', event => event.preventDefault());
document.addEventListener('visibilitychange', () => {
  if (document.hidden && game.status === 'running') pause();
  previousFrame = performance.now();
});
function frame(now) {
  if (previousFrame !== null) advanceAndShow((now - previousFrame) / 1000);
  previousFrame = now;
  if (now - renderAt >= 100) { render(); renderAt = now; }
  renderBreeze();
  renderRain();
  renderScore(now);
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
    { name: 'get_game_state', description: 'Read the strawberry farm and pickable berry IDs.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true }, execute: () => { syncTime(); return result({ status: game.status, elapsed: game.elapsed, rain: { ...game.rain }, shipments: game.shipments, missed: game.missed, score: game.score, lives: game.lives, packCount: game.pack.length, plants: game.plants.map(plant => ({ id: plant.id, stage: plant.stage, berries: plant.berries.map(berry => ({ id: berry.id, stage: berryStage(berry, game.elapsed), pickable: game.status === 'running' && game.pack.length < CONFIG.packSize && berryStage(berry, game.elapsed) >= 3 && berryStage(berry, game.elapsed) <= 5 })) })) }); } },
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
