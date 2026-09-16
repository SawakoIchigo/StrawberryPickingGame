"""Rebuild the six original, voice-free sound candidates using only Python 3.11.

Run from any directory: python scripts/generate-sound-samples.py
All oscillators, envelopes and echoes are deterministic; no recorded audio.
"""

import math
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
