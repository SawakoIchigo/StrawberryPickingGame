import test from 'node:test';
import assert from 'node:assert/strict';
import { HIGH_SCORE_KEY, createHighScoreStore, normalizeScores } from '../high-scores.js';

function storage(initial = null) {
  let raw = initial;
  const writes = [];
  return {
    writes,
    getItem(key) { assert.equal(key, HIGH_SCORE_KEY); return raw; },
    setItem(key, value) { assert.equal(key, HIGH_SCORE_KEY); raw = value; writes.push(value); },
  };
}

test('normalization retains signed safe integers, sorts descending and keeps at most five', () => {
  const input = [100, -2500, 0, 50, 300, 150, 100, '900', null, {}, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1];
  assert.deepEqual(normalizeScores(input), [300, 150, 100, 100, 50]);
  assert.equal(input.length, 14);
  assert.deepEqual(normalizeScores([-500, -1000, -750]), [-500, -750, -1000]);
  assert.deepEqual(normalizeScores({ scores: [100] }), []);
  assert.deepEqual(normalizeScores(Array.from({ length: 10000 }, (_, i) => i)), [999, 998, 997, 996, 995]);
});

test('missing, damaged, oversized and wrong-shaped storage safely start an empty ranking', () => {
  for (const raw of [null, '{broken', '{}', '"text"', 'null', ' '.repeat(65537), '["100",null,1.5]']) {
    const store = createHighScoreStore(() => storage(raw));
    assert.deepEqual(store.getScores(), []);
    assert.deepEqual(store.record({}, -2500), { scores: [-2500], rank: 1, newRecord: true });
  }
});

test('first and subsequent signed scores survive recreating the store', () => {
  const disk = storage();
  const first = createHighScoreStore(() => disk);
  assert.equal(first.record({}, -2500).newRecord, true);
  const reloaded = createHighScoreStore(() => disk);
  assert.deepEqual(reloaded.getScores(), [-2500]);
  assert.equal(reloaded.record({}, 0).rank, 1);
  assert.deepEqual(JSON.parse(disk.writes.at(-1)), [0, -2500]);
  const negative = createHighScoreStore(() => storage('[-500,-1000]'));
  assert.equal(negative.record({}, -750).rank, 2);
  assert.deepEqual(negative.getScores(), [-500, -750, -1000]);
});

test('a full ranking changes only when the new play fits in its first five positions', () => {
  const disk = storage('[500,400,300,200,100]');
  const store = createHighScoreStore(() => disk);
  assert.equal(store.record({}, 99).newRecord, false);
  assert.equal(store.record({}, 100).newRecord, false);
  assert.equal(disk.writes.length, 0);
  assert.deepEqual(store.record({}, 300), { scores: [500, 400, 300, 300, 200], rank: 4, newRecord: true });
  assert.equal(disk.writes.length, 1);
});

test('equal scores from separate plays fill available places, but never exceed five', () => {
  const store = createHighScoreStore(() => storage());
  for (let i = 1; i <= 5; i++) assert.equal(store.record({}, 0).rank, i);
  assert.deepEqual(store.record({}, 0), { scores: [0, 0, 0, 0, 0], rank: null, newRecord: false });
});

test('one game is recorded once even when result rendering repeats; a new game can record', () => {
  const disk = storage();
  const store = createHighScoreStore(() => disk);
  const game = {};
  const first = store.record(game, 150);
  assert.strictEqual(store.record(game, 150), first);
  assert.strictEqual(store.record(game, 900), first);
  assert.equal(disk.writes.length, 1);
  assert.equal(store.record({}, 150).rank, 2);
  assert.equal(disk.writes.length, 2);
  const copy = store.getScores();
  copy.push(999);
  assert.deepEqual(store.getScores(), [150, 150]);
});

test('storage access and write failures preserve an in-memory ranking without duplicate retries', () => {
  for (const getStorage of [
    () => { throw new Error('denied'); },
    () => ({ getItem() { throw new Error('read'); }, setItem() { throw new Error('write'); } }),
    () => undefined,
  ]) {
    const store = createHighScoreStore(getStorage);
    assert.equal(store.record({}, 50).newRecord, true);
    assert.deepEqual(store.record({}, 100).scores, [100, 50]);
  }
  let attempts = 0;
  const store = createHighScoreStore(() => ({
    getItem: () => '[150]',
    setItem() { attempts++; throw new Error('quota'); },
  }));
  const game = {};
  assert.deepEqual(store.record(game, 200).scores, [200, 150]);
  store.record(game, 200);
  assert.equal(attempts, 1);
  assert.deepEqual(store.getScores(), [200, 150]);
});

test('invalid current scores cannot enter or rewrite the ranking', () => {
  const disk = storage('[100]');
  const store = createHighScoreStore(() => disk);
  for (const score of [NaN, Infinity, '200', 1.1, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(store.record({}, score).newRecord, false);
  }
  assert.deepEqual(store.getScores(), [100]);
  assert.equal(disk.writes.length, 0);
});

test('sequential records from stores opened together preserve the latest shared ranking', () => {
  const disk = storage();
  const first = createHighScoreStore(() => disk);
  const second = createHighScoreStore(() => disk);
  first.record({}, 1000);
  assert.deepEqual(second.record({}, 500).scores, [1000, 500]);
  assert.deepEqual(JSON.parse(disk.writes.at(-1)), [1000, 500]);
  first.record({}, 750);
  assert.deepEqual(JSON.parse(disk.writes.at(-1)), [1000, 750, 500]);
});

test('refresh preserves distinct equal plays without duplicating the shared baseline', () => {
  const disk = storage('[1000,500,500]');
  const first = createHighScoreStore(() => disk);
  const second = createHighScoreStore(() => disk);
  assert.deepEqual(first.record({}, 500).scores, [1000, 500, 500, 500]);
  assert.deepEqual(second.record({}, 500).scores, [1000, 500, 500, 500, 500]);
  assert.equal(first.record({}, 500).newRecord, false);
  assert.equal(disk.writes.length, 2);
  assert.deepEqual(first.getScores(), [1000, 500, 500, 500, 500]);
});

test('refresh failures retain local scores and repeating a game never retries storage', () => {
  for (const bad of [null, '{broken', '{}', ' '.repeat(65537), new Error('read')]) {
    let raw = '[150]';
    let reads = 0, writes = 0;
    const store = createHighScoreStore(() => ({
      getItem() { reads++; if (raw instanceof Error) throw raw; return raw; },
      setItem() { writes++; throw new Error('quota'); },
    }));
    store.record({}, 200);
    raw = bad;
    const game = {};
    assert.deepEqual(store.record(game, 100).scores, [200, 150, 100]);
    const before = reads;
    store.record(game, 100);
    assert.equal(reads, before);
    assert.equal(writes, 2);
  }
});
