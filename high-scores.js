export const HIGH_SCORE_KEY = 'sawako-strawberry-high-scores-v1';
const MAX_ENTRIES_TO_READ = 1000;
const MAX_STORED_CHARACTERS = 65536;

export function normalizeScores(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(0, MAX_ENTRIES_TO_READ)
    .filter(score => Number.isSafeInteger(score))
    .sort((a, b) => b - a)
    .slice(0, 5);
}

export function createHighScoreStore(getStorage = () => globalThis.localStorage) {
  let scores = [];
  function refresh() {
    try {
      const raw = getStorage()?.getItem(HIGH_SCORE_KEY);
      if (typeof raw !== 'string' || raw.length > MAX_STORED_CHARACTERS) return;
      const latest = normalizeScores(JSON.parse(raw));
      // Shared baseline entries are the same records, not additional plays.
      // Keep the greater multiplicity for each score, including genuine ties
      // and local records retained after a failed write.
      const remaining = [...scores];
      const merged = [...scores];
      for (const score of latest) {
        const index = remaining.indexOf(score);
        if (index >= 0) remaining.splice(index, 1);
        else merged.push(score);
      }
      scores = normalizeScores(merged);
    } catch {
      // Unavailable or damaged storage must not interrupt the game.
    }
  }
  refresh();
  const completedGames = new WeakMap();
  return {
    getScores: () => [...scores],
    record(game, score) {
      if (completedGames.has(game)) return completedGames.get(game);
      let rank = null;
      let newRecord = false;
      if (Number.isSafeInteger(score)) {
        refresh();
        const previousBest = Math.max(0, scores[0] ?? 0);
        // Existing equal scores stay first: a tie below the fifth entry is not new.
        let index = scores.findIndex(previous => score > previous);
        if (index < 0) index = scores.length;
        if (index < 5) {
          scores = [...scores.slice(0, index), score, ...scores.slice(index)].slice(0, 5);
          rank = index + 1;
          newRecord = score > previousBest;
          try {
            getStorage()?.setItem(HIGH_SCORE_KEY, JSON.stringify(scores));
          } catch {
            // Keep the ranking in memory when saving is blocked or storage is full.
          }
        }
      }
      const result = Object.freeze({ scores: Object.freeze([...scores]), rank, newRecord });
      completedGames.set(game, result);
      return result;
    },
  };
}
