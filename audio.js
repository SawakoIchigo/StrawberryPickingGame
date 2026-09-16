// User-provided local audio. No game randomness or game state is consumed here.
export const AUDIO_FILES = Object.freeze({
  harvest1: '苺収穫_ランダム用001.mp3', harvest2: '苺収穫_ランダム用002.mp3',
  harvest3: '苺収穫_ランダム用003.mp3', harvest4: '苺収穫_ランダム用004.mp3',
  full: '苺出荷可能.mp3', ship1: 'クラッカー_ランダム用001.mp3', ship2: 'クラッカー_ランダム用002.mp3',
  rot: '苺腐った時.mp3', start: 'ゲーム開始.mp3', end: 'ゲーム終了.mp3',
  farm: 'BGM_農場.mp3', rain: 'BGM_雨が降る.mp3',
});

export function createGameAudio({
  createContext = () => new (globalThis.AudioContext ?? globalThis.webkitAudioContext)(),
  fetchFile = url => fetch(url), random = Math.random,
} = {}) {
  let context, effectsGain, musicGain;
  let status = 'ready', raining = false, unlocked = false;
  let epoch = 0;
  const musicTracks = ['farm', 'rain'].map(name => ({ name, epoch: 0, pending: false, source: null, failed: false, retiring: false, fadeIn: false, gain: null }));
  const rainFadeSeconds = .8;
  let unlockAttempt = 0;
  const bags = { harvest: { names: ['harvest1', 'harvest2', 'harvest3', 'harvest4'], remaining: [], last: null },
    ship: { names: ['ship1', 'ship2'], remaining: [], last: null } };
  const volumes = { sfx: .55, bgm: .25 };
  const buffers = new Map(), voices = new Set();
  const limit = 8;

  function dispose(voice) {
    voice.cancelled = true;
    try { voice.source?.stop(); } catch { /* Already ended. */ }
    voice.source?.disconnect();
    voices.delete(voice);
  }
  function stopMusic(track) {
    track.epoch++;
    track.pending = false;
    track.retiring = false;
    if (track.source) {
      const source = track.source;
      track.source = null;
      try { source.stop(); } catch { /* Already stopped. */ }
      source.disconnect();
    }
  }
  function stop() {
    unlockAttempt++;
    epoch++;
    for (const voice of voices) dispose(voice);
    for (const track of musicTracks) stopMusic(track);
  }
  function buffer(name) {
    if (!buffers.has(name)) {
      const url = new URL(`./assets/sounds/v2/${AUDIO_FILES[name]}`, import.meta.url);
      buffers.set(name, Promise.resolve().then(() => fetchFile(url)).then(response => {
        if (!response.ok) throw new Error('Unavailable local audio');
        return response.arrayBuffer();
      }).then(data => context.decodeAudioData(data)).catch(() => null));
    }
    return buffers.get(name);
  }
  function wantsMusic(track) { return unlocked && status === 'running' && volumes.bgm > 0 && (track.name === 'farm' || raining); }
  function syncMusic() {
    for (const track of musicTracks) {
      if (!wantsMusic(track)) {
        if (track.name === 'rain' && track.source && unlocked && status === 'running' && volumes.bgm > 0) {
          if (!track.retiring) {
            track.retiring = true;
            const now = context.currentTime;
            track.gain.gain.cancelAndHoldAtTime(now);
            track.gain.gain.linearRampToValueAtTime(0, now + rainFadeSeconds);
            track.source.stop(now + rainFadeSeconds);
          }
        } else if (track.source || track.pending) stopMusic(track);
        continue;
      }
      // A scheduled stop cannot be unscheduled. Replace a fading-out rain loop
      // only after stopping it immediately, keeping at most one rain source.
      if (track.retiring) stopMusic(track);
      if (track.source || track.pending || track.failed) continue;
      const ticket = ++track.epoch;
      track.pending = true;
      buffer(track.name).then(decoded => {
        if (ticket !== track.epoch) return;
        track.pending = false;
        if (!decoded) { track.failed = true; return; }
        if (!wantsMusic(track)) return;
        try {
          track.source = context.createBufferSource();
          track.source.buffer = decoded;
          track.source.loop = true;
          if (track.gain) {
            const now = context.currentTime;
            track.gain.gain.cancelScheduledValues(now);
            track.gain.gain.setValueAtTime(track.fadeIn ? 0 : 1, now);
            if (track.fadeIn) track.gain.gain.linearRampToValueAtTime(1, now + rainFadeSeconds);
          }
          track.source.connect(track.gain ?? musicGain);
          const source = track.source;
          source.onended = () => {
            source.disconnect();
            if (track.source === source) { track.source = null; track.retiring = false; }
          };
          track.source.start();
        } catch { stopMusic(track); track.failed = true; }
      });
    }
  }
  function unlock() {
    const attempt = ++unlockAttempt;
    try {
      if (!context) {
        context = createContext();
        effectsGain = context.createGain(); musicGain = context.createGain();
        effectsGain.gain.value = volumes.sfx; musicGain.gain.value = volumes.bgm;
        effectsGain.connect(context.destination); musicGain.connect(context.destination);
        const rainTrack = musicTracks[1];
        rainTrack.gain = context.createGain();
        rainTrack.gain.connect(musicGain);
      }
      // resume is called synchronously from the user's gesture, before loading.
      const resumed = context.resume();
      unlocked = true;
      Promise.resolve(resumed).then(() => { if (attempt === unlockAttempt) syncMusic(); }).catch(() => {
        if (attempt === unlockAttempt) { unlocked = false; stop(); }
      });
      for (const name of Object.keys(AUDIO_FILES)) buffer(name);
    } catch { unlocked = false; }
  }
  function play(name) {
    if (!unlocked || !AUDIO_FILES[name] || name === 'rain' || name === 'farm' || volumes.sfx === 0) return;
    if (status !== 'running' && !(name === 'end' && status === 'gameover')) return;
    while (voices.size >= limit) dispose(voices.values().next().value);
    const voice = { epoch, cancelled: false, source: null };
    voices.add(voice);
    buffer(name).then(decoded => {
      if (!decoded || voice.cancelled || voice.epoch !== epoch || !unlocked || volumes.sfx === 0) { dispose(voice); return; }
      try {
        voice.source = context.createBufferSource();
        voice.source.buffer = decoded;
        voice.source.connect(effectsGain);
        voice.source.onended = () => { voice.source.disconnect(); voices.delete(voice); };
        voice.source.start();
      } catch { dispose(voice); }
    });
  }
  function setState(nextStatus, rain) {
    if (status !== nextStatus || raining !== rain) musicTracks[1].fadeIn = status === 'running' && nextStatus === 'running' && !raining && rain;
    if (status !== nextStatus && nextStatus !== 'running') stop();
    status = nextStatus; raining = rain;
    syncMusic();
  }
  function setVolume(kind, value) {
    if (!(kind in volumes) || !Number.isFinite(value)) return;
    volumes[kind] = Math.max(0, Math.min(1, value));
    if (kind === 'sfx') {
      if (effectsGain) effectsGain.gain.value = volumes.sfx;
      if (volumes.sfx === 0) for (const voice of voices) dispose(voice);
    } else {
      if (musicGain) musicGain.gain.value = volumes.bgm;
      syncMusic();
    }
  }
  function playGroup(group) {
    if (!unlocked || status !== 'running' || volumes.sfx === 0) return;
    const bag = bags[group];
    if (!bag.remaining.length) {
      bag.remaining = [...bag.names];
      for (let index = bag.remaining.length - 1; index > 0; index--) {
        const value = random();
        const other = Math.floor(Math.max(0, Math.min(.9999999999999999, Number.isFinite(value) ? value : 0)) * (index + 1));
        [bag.remaining[index], bag.remaining[other]] = [bag.remaining[other], bag.remaining[index]];
      }
      if (bag.remaining[0] === bag.last) [bag.remaining[0], bag.remaining[1]] = [bag.remaining[1], bag.remaining[0]];
    }
    bag.last = bag.remaining.shift();
    play(bag.last);
  }
  return { unlock, setState, play, setVolume, stop,
    ship: () => playGroup('ship'), harvest: () => playGroup('harvest'),
  };
}
