"""Rebuild ten voice-free sound candidates using only Python 3.11.

Run from any directory: python scripts/generate-sound-samples.py
All oscillators, envelopes and echoes are deterministic; no recorded audio.
"""

import math
import random
from pathlib import Path
import struct
import wave


RATE = 44100
TAU = 2 * math.pi
DESTINATION = Path(__file__).resolve().parents[1] / 'assets' / 'sounds' / 'v1'


def smooth(value):
    value = max(0.0, min(1.0, value))
    return value * value * (3 - 2 * value)


def note(midi):
    return 440 * 2 ** ((midi - 69) / 12)


def voice(duration, frequency, partials, decay, attack=.004, sweep=0.0):
    """Decaying modes: (frequency ratio, amplitude, relative decay time).

    The exponential pitch bend is integrated to keep phase continuous.
    Higher modes decay first, leaving a soft fundamental in the tail.
    """
    count = round(duration * RATE)
    samples = []
    for index in range(count):
        t = index / RATE
        phase = TAU * frequency * (t + sweep * .028 * (1 - math.exp(-t / .028)))
        envelope = smooth(t / attack) * smooth((duration - t - 1 / RATE) / .045)
        value = sum(amplitude * math.exp(-t / (decay * persistence)) * math.sin(phase * ratio)
                    for ratio, amplitude, persistence in partials)
        samples.append(value * envelope)
    return samples


ROUND = [(1, 1, 1), (2, .19, .5), (3, .045, .28)]
WOOD = [(1, 1, 1), (2, .27, .48), (3.01, .11, .3), (4.02, .035, .2)]
BELL = [(1, 1, 1), (2, .22, .7), (3, .07, .42), (4.03, .035, .25)]
CHIME = [(1, 1, 1), (2.01, .3, .7), (3.98, .06, .35)]
WARM = [(1, 1, 1), (2, .16, .6), (3, .045, .38)]


def mix(target, sound, start, gain=1.0):
    offset = round(start * RATE)
    for index, value in enumerate(sound[:max(0, len(target) - offset)]):
        target[offset + index] += value * gain


def echo(samples, seconds, gain):
    original = samples[:]
    offset = round(seconds * RATE)
    for index in range(offset, len(samples)):
        samples[index] += original[index - offset] * gain


def paper_noise(duration, seed, decay, low_cut=650, high_cut=3600, attack=.003):
    """Soft band-limited noise, with two low-pass poles and a smooth envelope."""
    rng = random.Random(seed)
    upper = 1 - math.exp(-TAU * high_cut / RATE)
    lower = 1 - math.exp(-TAU * low_cut / RATE)
    low = pole1 = pole2 = 0.0
    samples = []
    count = round(duration * RATE)
    for index in range(count):
        t = index / RATE
        noise = rng.uniform(-1, 1)
        low += lower * (noise - low)
        pole1 += upper * (noise - low - pole1)
        pole2 += upper * (pole1 - pole2)
        envelope = smooth(t / attack) * math.exp(-t / decay)
        envelope *= smooth((count - 1 - index) / (RATE * .025))
        samples.append(pole2 * envelope)
    return samples


def cracker(target, start, seed, gain=1.0):
    # A short rounded body gives the paper crack weight, without a sharp click.
    mix(target, paper_noise(.16, seed, .037, 340, 3300, .0028), start, 3.3 * gain)
    mix(target, voice(.14, 170, ROUND, .035, .003, sweep=.85), start, .52 * gain)


def confetti(target, seed, start, duration, gain=1.0):
    # Many separate, quiet paper flutters rather than a continuous hiss.
    rng = random.Random(seed)
    at = start
    index = 0
    while at < start + duration:
        progress = (at - start) / duration
        length = rng.uniform(.038, .075)
        flutter = paper_noise(length, seed + index + 1, .023,
                              rng.uniform(700, 1100), rng.uniform(2400, 3400), .006)
        mix(target, flutter, at, gain * (1 - progress) ** 1.2 * rng.uniform(.5, 1))
        at += rng.uniform(.025, .055)
        index += 1


def finish(samples, target_rms):
    # Remove any tiny pitch-sweep bias, then fade the complete mix to exact zero.
    mean = sum(samples) / len(samples)
    samples = [(value - mean) * smooth(index / (RATE * .003))
               * smooth((len(samples) - 1 - index) / (RATE * .045))
               for index, value in enumerate(samples)]
    peak = max(map(abs, samples))
    rms = math.sqrt(sum(value * value for value in samples) / len(samples))
    gain = min(target_rms / rms, .68 / peak)
    return [round(value * gain * 32767) for value in samples]


def candidates():
    pop = voice(.18, note(72), ROUND, .046, sweep=.68)
    wood = voice(.22, note(79), WOOD, .064, sweep=.025)
    echo(wood, .031, .12)
    yield 'harvest-a', pop, .145
    yield 'harvest-b', wood, .145

    full_a = [0.0] * round(.64 * RATE)
    for start, midi, gain in [(0, 76, .85), (.12, 79, .9), (.24, 84, 1)]:
        mix(full_a, voice(.4, note(midi), BELL, .095, .005), start, gain)
    echo(full_a, .045, .09)
    full_b = [0.0] * round(.64 * RATE)
    for start, midi, gain in [(0, 79, .9), (.075, 84, .72), (.235, 88, .88)]:
        mix(full_b, voice(.4, note(midi), CHIME, .092, .005), start, gain)
    mix(full_b, voice(.3, note(72), WOOD, .085), .235, .35)
    echo(full_b, .052, .1)
    yield 'full-a', full_a, .14
    yield 'full-b', full_b, .14

    ship_a = [0.0] * round(1.16 * RATE)
    for start, midi, gain, duration in [(0, 72, .85, .28), (.14, 76, .85, .28),
                                         (.28, 79, .9, .32), (.49, 84, 1, .65)]:
        mix(ship_a, voice(duration, note(midi), BELL, .15, .007), start, gain)
    for midi in [60, 64, 67]:
        mix(ship_a, voice(.65, note(midi), WARM, .18, .014), .49, .2)
    echo(ship_a, .065, .1)
    ship_b = [0.0] * round(1.22 * RATE)
    for midi in [60, 64, 67]:
        mix(ship_b, voice(.9, note(midi), WARM, .22, .018), 0, .32)
    for start, midi, gain in [(.07, 72, .7), (.21, 79, .75), (.35, 76, .65), (.54, 84, .85)]:
        mix(ship_b, voice(.66, note(midi), WOOD, .15, .006), start, gain)
    echo(ship_b, .072, .11)
    yield 'ship-a', ship_a, .135
    yield 'ship-b', ship_b, .135

    # A: a clear rising call, a brief dominant pickup, then a full tonic landing.
    # Stagger the chord attacks slightly so it blooms rather than clicks.
    finale_a = [0.0] * round(1.98 * RATE)
    fanfare = [(1, 1, 1), (2, .28, .72), (3, .12, .48), (4, .035, .3)]
    for start, midi, gain in [(0, 72, .68), (.15, 76, .73), (.30, 79, .8),
                              (.46, 79, .42), (.515, 83, .48), (.57, 86, .56)]:
        mix(finale_a, voice(.42, note(midi), fanfare, .145, .008), start, gain)
    for start, midi, gain in [(.67, 48, .45), (.676, 60, .4), (.688, 64, .36),
                              (.700, 67, .38), (.712, 72, .48), (.724, 84, .60)]:
        mix(finale_a, voice(1.20, note(midi), WARM if midi < 72 else BELL,
                            .30 if midi < 72 else .24, .014), start, gain)
    for start, midi, gain in [(1.02, 88, .19), (1.13, 91, .13), (1.27, 96, .065)]:
        mix(finale_a, voice(.65, note(midi), CHIME, .14, .006), start, gain)
    echo(finale_a, .076, .10)
    # Gently round coincident chord peaks before matching the audition volume.
    yield 'ship-finale-a', [math.tanh(value * 1.1) / 1.1 for value in finale_a], .135

    # B: overlapping, accelerating mallet particles open into a rolled chord.
    # The low C arrives with the chord, making the finish distinct from the run.
    finale_b = [0.0] * round(2.16 * RATE)
    for start, midi, gain in [(0, 67, .48), (.105, 72, .50), (.21, 76, .52),
                              (.31, 79, .55), (.405, 83, .49), (.49, 86, .48),
                              (.565, 91, .35), (.63, 86, .29)]:
        mix(finale_b, voice(.47, note(midi), WOOD, .13, .006), start, gain)
    for start, midi, gain in [(.78, 48, .43), (.79, 60, .39), (.815, 67, .37),
                              (.845, 72, .43), (.88, 76, .42), (.92, 79, .41),
                              (.96, 84, .53)]:
        mix(finale_b, voice(1.16, note(midi), WARM if midi < 72 else BELL,
                            .34 if midi < 72 else .28, .018), start, gain)
    for start, midi, gain in [(1.24, 91, .14), (1.38, 88, .11), (1.52, 84, .09)]:
        mix(finale_b, voice(.6, note(midi), CHIME, .14, .008), start, gain)
    echo(finale_b, .084, .12)
    yield 'ship-finale-b', [math.tanh(value * 1.1) / 1.1 for value in finale_b], .135

    # Party poppers match the game's paper launch; melody stays secondary.
    popper_a = [0.0] * round(.94 * RATE)
    cracker(popper_a, 0, 5401)
    confetti(popper_a, 6101, .065, .77, 1.4)
    echo(popper_a, .021, .09)
    yield 'ship-popper-a', [math.tanh(value * 4) / 4 for value in popper_a], .13

    popper_b = [0.0] * round(1.34 * RATE)
    cracker(popper_b, 0, 5501, .85)
    cracker(popper_b, .061, 5502, .95)
    confetti(popper_b, 6201, .11, 1.04, 1.25)
    for start, midi, gain in [(.22, 79, .095), (.31, 84, .10), (.42, 88, .07)]:
        mix(popper_b, voice(.8, note(midi), BELL, .18, .012), start, gain)
    echo(popper_b, .027, .08)
    yield 'ship-popper-b', [math.tanh(value * 4) / 4 for value in popper_b], .13


def main():
    DESTINATION.mkdir(parents=True, exist_ok=True)
    report = {}
    for name, samples, target_rms in candidates():
        pcm = finish(samples, target_rms)
        with wave.open(str(DESTINATION / f'{name}.wav'), 'wb') as output:
            output.setnchannels(1)
            output.setsampwidth(2)
            output.setframerate(RATE)
            output.writeframes(struct.pack(f'<{len(pcm)}h', *pcm))
        peak = max(map(abs, pcm)) / 32768
        rms = math.sqrt(sum(value * value for value in pcm) / len(pcm)) / 32768
        assert pcm[0] == pcm[-1] == 0
        assert peak <= .7 and all(abs(value) < 32767 for value in pcm)
        report[name] = {'seconds': len(pcm) / RATE, 'peak': round(peak, 6),
                        'rms': round(rms, 6), 'crest_db': round(20 * math.log10(peak / rms), 2),
                        'dc': round(sum(pcm) / len(pcm) / 32768, 8), 'clipped': 0,
                        'first': pcm[0], 'last': pcm[-1]}
    return report


if __name__ == '__main__':
    main()
