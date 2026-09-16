import test from 'node:test';
import assert from 'node:assert/strict';
import { AUDIO_FILES, createGameAudio } from '../audio.js';

const flush = () => new Promise(resolve => setImmediate(resolve));
function harness({ delayed = false, random = () => .3, fail = false, resume } = {}) {
  const sources = [], pending = [], gains = [];
  let contexts = 0;
  const context = {
    destination: {}, resume: resume ?? (() => Promise.resolve()),
    createGain() { const gain = { gain: { value: 0 }, connect() {} }; gains.push(gain); return gain; },
    decodeAudioData(data) {
      if (delayed) return new Promise(resolve => pending.push(() => resolve(data)));
      return Promise.resolve(data);
    },
    createBufferSource() {
      const source = { loop: false, started: false, stopped: false, connect() {}, disconnect() {},
        start() { this.started = true; }, stop() { this.stopped = true; this.onended?.(); } };
      sources.push(source); return source;
    },
  };
  const audio = createGameAudio({ createContext: () => { contexts++; return context; }, random,
    fetchFile: async url => {
      if (fail) throw new Error('offline');
      return { ok: true, arrayBuffer: async () => decodeURIComponent(url.pathname).split('/').at(-1) };
    },
  });
  return { audio, sources, pending, gains, contexts: () => contexts,
    active: () => sources.filter(source => source.started && !source.stopped),
  };
}

test('loading is silent; cancelled decodes cannot start effects or rain after a pause', async () => {
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
  assert.equal(h.active().length, 1);
  assert.equal(h.active()[0].loop, true);
  h.audio.setState('running', false);
  assert.equal(h.active().length, 0);
});

test('repeated state synchronization never duplicates rain, and ending stops it before the end cue', async () => {
  const h = harness(); h.audio.unlock(); h.audio.setState('running', true);
  await flush();
  for (let i = 0; i < 30; i++) h.audio.setState('running', true);
  await flush();
  assert.equal(h.active().length, 1);
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
  assert.equal(h.active().length, 1);
  h.audio.stop();
  assert.equal(h.active().length, 0);
  resolveResume(); await flush();
  assert.equal(h.active().length, 0);
  h.audio.setState('paused', true);
  for (let i = 0; i < 5; i++) h.audio.setState('paused', true);
  await flush(); assert.equal(h.active().length, 0);
});
