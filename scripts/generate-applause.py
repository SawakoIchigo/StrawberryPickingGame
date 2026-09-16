"""Synthesize original applause from seeded noise; no audio input or downloads."""

import math
from pathlib import Path
import random
import struct
import wave


RATE = 44100
DURATION = 2.55
OUTPUT = Path(__file__).resolve().parents[1] / 'assets' / 'sounds' / 'v1' / 'ship-applause.wav'


def smooth(value):
    value = max(0.0, min(1.0, value))
    return value * value * (3 - 2 * value)


def clap(rng, brightness, weight):
    # The fingers and palm make several soft, closely spaced contacts.
    # A broad midrange transient and a short airy tail avoid a pitched pop.
    count = round(.16 * RATE)
    lower = 1 - math.exp(-2 * math.pi * 640 / RATE)
    upper = 1 - math.exp(-2 * math.pi * brightness / RATE)
    low = pole1 = pole2 = 0.0
    samples = []
    contacts = [(0, 1), (.008, .32), (.018, .19)]
    for index in range(count):
        t = index / RATE
        noise = rng.uniform(-1, 1)
        low += lower * (noise - low)
        pole1 += upper * (noise - low - pole1)
        pole2 += upper * (pole1 - pole2)
        envelope = 0.0
        for offset, gain in contacts:
            age = t - offset
            if age >= 0:
                envelope += gain * smooth(age / .0035) * math.exp(-age / .018)
        envelope *= smooth((count - 1 - index) / (RATE * .035))
        samples.append(pole2 * envelope * weight)
    return samples


def main():
    rng = random.Random(812731)
    count = round(DURATION * RATE)
    channels = [[0.0] * count for _ in range(2)]
    # Eight independent clappers keep natural overlap without synchronized hits.
    for person in range(8):
        tempo = rng.uniform(.25, .38)
        at = rng.uniform(-.09, .13)
        brightness = rng.uniform(2500, 3900)
        weight = rng.uniform(.72, 1.0)
        pan = -.78 + person * 1.56 / 7
        gains = [math.sqrt((1 - pan) / 2), math.sqrt((1 + pan) / 2)]
        while at < 2.18:
            sound = clap(rng, brightness * rng.uniform(.9, 1.1), weight * rng.uniform(.7, 1.1))
            offset = round(at * RATE)
            for index, sample in enumerate(sound):
                frame = offset + index
                if 0 <= frame < count:
                    for channel in range(2):
                        channels[channel][frame] += sample * gains[channel]
            at += max(.2, min(.42, tempo + rng.uniform(-.047, .047)))
    # Quiet, asymmetric early reflections give a little room, without a long hiss.
    dry = [channel[:] for channel in channels]
    for delay, gain in [(.023, .13), (.041, .08), (.067, .045)]:
        offset = round(delay * RATE)
        for channel in range(2):
            for frame in range(offset, count):
                channels[channel][frame] += dry[1 - channel][frame - offset] * gain
    means = [sum(channel) / count for channel in channels]
    samples = []
    for frame in range(count):
        envelope = smooth(frame / (.065 * RATE)) * smooth((count - 1 - frame) / (.49 * RATE))
        for channel in range(2):
            samples.append(math.tanh((channels[channel][frame] - means[channel]) * 6) * envelope)
    peak = max(map(abs, samples))
    rms = math.sqrt(sum(value * value for value in samples) / len(samples))
    gain = min(.14 / rms, .68 / peak)
    pcm = [round(value * gain * 32767) for value in samples]
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with wave.open(str(OUTPUT), 'wb') as output:
        output.setnchannels(2)
        output.setsampwidth(2)
        output.setframerate(RATE)
        output.writeframes(struct.pack(f'<{len(pcm)}h', *pcm))


if __name__ == '__main__':
    main()
