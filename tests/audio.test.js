import test from 'node:test';
import assert from 'node:assert/strict';
import { AUDIO_FILES, createGameAudio } from '../audio.js';

const flush = () => new Promise(resolve => setImmediate(resolve));
function harness({ delayed = false, random = () => .3, fail = false, resume } = {}) {
  const sources = [], pending = [], gains = [], requests = [], decodes = [];
  let contexts = 0;
  const context = {
    currentTime: 0,
    destination: {}, resume: resume ?? (() => Promise.resolve()),
    createGain() {
      const gain = { gain: { value: 0, ramps: [],
        cancelScheduledValues() {}, cancelAndHoldAtTime() {},
        setValueAtTime(value, at) { this.value = value; this.ramps.push([value, at]); },
        linearRampToValueAtTime(value, at) { this.ramps.push([value, at]); },
      }, connect() {} };
      gains.push(gain); return gain;
    },
    decodeAudioData(data) {
      decodes.push(data);
      if (delayed) return new Promise(resolve => pending.push(() => resolve(data)));
      return Promise.resolve(data);
    },
    createBufferSource() {
      const source = { loop: false, started: false, stopped: false, connect() {}, disconnect() {},
        start() { this.started = true; }, stop(at) {
          if (at > context.currentTime) { this.stopAt = at; return; }
          this.stopped = true; this.onended?.();
        } };
      sources.push(source); return source;
    },
  };
  const audio = createGameAudio({ createContext: () => { contexts++; return context; }, random,
    fetchFile: async url => {
      requests.push(decodeURIComponent(url.pathname).split('/').at(-1));
      if (fail) throw new Error('offline');
      return { ok: true, arrayBuffer: async () => decodeURIComponent(url.pathname).split('/').at(-1) };
    },
  });
  return { audio, sources, pending, gains, requests, decodes, contexts: () => contexts,
    active: () => sources.filter(source => source.started && !source.stopped),
    tick(seconds) {
      context.currentTime += seconds;
      for (const source of sources) if (!source.stopped && source.stopAt <= context.currentTime) source.stop();
    },
  };
}

test('loading is silent; cancelled decodes cannot start effects or either music track after a pause', async () => {
  const h = harness({ delayed: true });
  h.audio.setState('running', true); h.audio.play('start');
  assert.equal(h.contexts(), 0);
  h.audio.unlock(); h.audio.play('start');
  await flush();
  h.audio.setState('paused', true);
  h.pending.forEach(resolve => resolve());
  await flush();
  assert.equal(h.sources.length, 0);
  h.audio.setState('running', true);
  await flush();
  assert.equal(h.active().length, 2);
  assert.equal(h.active()[0].loop, true);
  h.audio.setState('running', false);
  h.tick(.8);
  assert.deepEqual(h.active().map(source => source.buffer), [AUDIO_FILES.farm]);
});

test('repeated state synchronization never duplicates rain, and ending stops it before the end cue', async () => {
  const h = harness(); h.audio.unlock(); h.audio.setState('running', true);
  await flush();
  for (let i = 0; i < 30; i++) h.audio.setState('running', true);
  await flush();
  assert.equal(h.active().length, 2);
  h.audio.setState('gameover', true); h.audio.play('end');
  await flush();
  assert.deepEqual(h.active().map(source => source.buffer), [AUDIO_FILES.end]);
  h.audio.setState('gameover', true);
  assert.equal(h.active().length, 1);
  h.audio.stop(); await flush();
  assert.equal(h.active().length, 0);
});

test('rapid effects have a finite voice budget including pending decodes; mute cancels pending audio', async () => {
  const h = harness({ delayed: true }); h.audio.unlock(); h.audio.setState('running', false);
  h.audio.setVolume('bgm', 0);
  for (let i = 0; i < 40; i++) h.audio.harvest();
  await flush(); h.pending.forEach(resolve => resolve()); await flush();
  assert.equal(h.active().length, 8);
  h.audio.setVolume('sfx', 0); assert.equal(h.active().length, 0);
  h.audio.harvest(); h.audio.ship(); await flush(); assert.equal(h.active().length, 0);
  h.audio.setVolume('sfx', .4); h.audio.play('full'); h.audio.stop();
  await flush(); assert.equal(h.active().length, 0);
});

test('each random group uses every supplied variant each round without adjacent repeats, even at RNG edges', async () => {
  for (const value of [0, .999999999, 1, -1, NaN]) {
    const h = harness({ random: () => value }); h.audio.unlock(); h.audio.setState('running', false);
    await flush();
    for (const [group, names] of [['harvest', ['harvest1', 'harvest2', 'harvest3', 'harvest4']], ['ship', ['ship1', 'ship2']]]) {
      const played = [];
      for (let i = 0; i < names.length * 3; i++) {
        h.audio.setVolume('sfx', 0); h.audio[group]();
        h.audio.setVolume('sfx', .55); h.audio[group](); await flush();
        played.push(h.sources.at(-1).buffer);
      }
      for (let round = 0; round < 3; round++) assert.deepEqual(new Set(played.slice(round * names.length, (round + 1) * names.length)), new Set(names.map(name => AUDIO_FILES[name])));
      assert.ok(played.every((name, index) => index === 0 || name !== played[index - 1]));
    }
  }
});

test('missing files and unavailable audio leave lifecycle calls usable without unhandled rejection', async () => {
  const h = harness({ fail: true }); h.audio.unlock(); h.audio.setState('running', true); h.audio.harvest();
  await flush();
  h.audio.setState('paused', true); h.audio.setState('running', true); h.audio.ship();
  await flush(); assert.equal(h.sources.length, 0);
  const unavailable = createGameAudio({ createContext: () => { throw new Error('unsupported'); } });
  assert.doesNotThrow(() => { unavailable.unlock(); unavailable.setState('running', true); unavailable.harvest(); unavailable.stop(); });
});

test('a late resume resolution cannot resurrect audio after an explicit stop or page departure', async () => {
  let resolveResume;
  const h = harness({ resume: () => new Promise(resolve => { resolveResume = resolve; }) });
  h.audio.unlock(); h.audio.setState('running', true);
  await flush();
  assert.equal(h.active().length, 2);
  h.audio.stop();
  assert.equal(h.active().length, 0);
  resolveResume(); await flush();
  assert.equal(h.active().length, 0);
  h.audio.setState('paused', true);
  for (let i = 0; i < 5; i++) h.audio.setState('paused', true);
  await flush(); assert.equal(h.active().length, 0);
});

test('rain layers over the same farm loop, and both tracks reuse one fetch and decode across weather and pauses', async () => {
  const h = harness(); h.audio.unlock(); h.audio.setState('running', false);
  await flush();
  const farm = h.active()[0];
  assert.equal(farm.buffer, AUDIO_FILES.farm);
  for (let shower = 0; shower < 5; shower++) {
    for (let frame = 0; frame < 50; frame++) h.audio.setState('running', true);
    await flush();
    assert.equal(h.active().length, 2);
    assert.ok(h.active().includes(farm));
    h.audio.setState('running', false);
    h.tick(.8);
    assert.deepEqual(h.active(), [farm]);
  }
  assert.equal(h.sources.filter(source => source.buffer === AUDIO_FILES.farm).length, 1);
  h.audio.setState('running', true); await flush();
  h.audio.setVolume('bgm', 0); assert.equal(h.active().length, 0);
  h.audio.setVolume('bgm', .25); await flush(); assert.equal(h.active().length, 2);
  h.audio.setState('paused', true); assert.equal(h.active().length, 0);
  h.audio.setState('running', true); await flush(); assert.equal(h.active().length, 2);
  for (const name of [AUDIO_FILES.farm, AUDIO_FILES.rain]) {
    assert.equal(h.requests.filter(file => file === name).length, 1);
    assert.equal(h.decodes.filter(file => file === name).length, 1);
  }
});

test('muting before either music decode finishes prevents both late loops', async () => {
  const h = harness({ delayed: true }); h.audio.unlock(); h.audio.setState('running', true);
  await flush(); h.audio.setVolume('bgm', 0);
  h.pending.forEach(resolve => resolve()); await flush();
  assert.equal(h.active().length, 0);
  h.audio.setVolume('bgm', .25); await flush();
  assert.deepEqual(new Set(h.active().map(source => source.buffer)), new Set([AUDIO_FILES.farm, AUDIO_FILES.rain]));
});

test('weather fades only rain, rapid reversals keep one rain source, and pause or mute stops fades immediately', async () => {
  const h = harness(); h.audio.unlock(); h.audio.setState('running', false); await flush();
  const farm = h.active()[0];
  h.audio.setState('running', true); await flush();
  const rainGain = h.gains[2].gain;
  assert.deepEqual(rainGain.ramps.slice(-2), [[0, 0], [1, .8]]);
  h.tick(.2); h.audio.setState('running', false);
  assert.deepEqual(rainGain.ramps.at(-1), [0, 1]);
  assert.equal(h.active().length, 2, 'rain continues quietly during its fade-out');
  h.tick(.2); h.audio.setState('running', true); await flush();
  assert.equal(h.active().length, 2, 'reversing weather replaces the scheduled-to-stop source without overlap');
  assert.ok(h.active().includes(farm));
  h.tick(.8); assert.equal(h.active().length, 2, 'the old scheduled stop cannot kill the new rain loop');
  h.audio.setState('running', false); h.audio.setVolume('bgm', 0);
  assert.equal(h.active().length, 0);
  h.audio.setState('running', true); h.audio.setVolume('bgm', .25); await flush();
  h.audio.setState('running', false); h.audio.setState('paused', false);
  assert.equal(h.active().length, 0);
});
