"""EchoBot's little AR voice: one short sound per mood (22 kHz mono WAV, which Quick Look plays).

Run:  python ar/echobot_ar_sounds.py --babble echobot_babble.wav --out ar/sounds
"""
import argparse, os, wave
import numpy as np

ap = argparse.ArgumentParser()
ap.add_argument("--babble", required=True)
ap.add_argument("--out", default="ar/sounds")
A = ap.parse_args()
os.makedirs(A.out, exist_ok=True)
SR = 22050
rng = np.random.default_rng(7)


def env(n, a=0.01, r=0.08):
    e = np.ones(n)
    na, nr = int(a * SR), int(r * SR)
    e[:na] = np.linspace(0, 1, na)
    e[-nr:] *= np.linspace(1, 0, nr)
    return e


def tone(f0, f1, dur, vib=0.0, vib_hz=7.0, bright=0.35):
    """Gliding cartoon 'robot voice' note: sine + a little 2nd/3rd harmonic, optional vibrato."""
    n = int(dur * SR); t = np.arange(n) / SR
    f = np.geomspace(f0, f1, n) * (1 + vib * np.sin(2 * np.pi * vib_hz * t))
    ph = 2 * np.pi * np.cumsum(f) / SR
    return (np.sin(ph) + bright * np.sin(2 * ph) + bright * 0.4 * np.sin(3 * ph)) * env(n)


def gap(d):
    return np.zeros(int(d * SR))


def lowpass(x, k):
    return np.convolve(x, np.ones(k) / k, mode="same")


def save(name, x, peak=0.8):
    x = x / (np.abs(x).max() + 1e-9) * peak
    with wave.open(os.path.join(A.out, name), "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes((x * 32767).astype("<i2").tobytes())


def read_babble(path, seconds):
    with wave.open(path) as w:
        sr, ch = w.getframerate(), w.getnchannels()
        x = np.frombuffer(w.readframes(w.getnframes()), "<i2").astype(float) / 32767
    if ch > 1:
        x = x.reshape(-1, ch).mean(1)
    if sr != SR:
        x = np.interp(np.arange(0, len(x) * SR / sr) * sr / SR, np.arange(len(x)), x)
    x = x[: int(seconds * SR)]
    return x * env(len(x), 0.005, 0.15)


# happy: bright "do-di-DEE!" climb
save("happy.wav", np.concatenate([tone(520, 600, 0.11), gap(0.03), tone(660, 760, 0.11), gap(0.03),
                                  tone(800, 1250, 0.28, vib=0.02)]))
# talk: a stretch of the existing babble
save("talk.wav", read_babble(A.babble, 2.6))
# surprised: quick rising "whoop!"
save("surprised.wav", np.concatenate([tone(300, 1500, 0.22, bright=0.5), gap(0.02), tone(1400, 1600, 0.08)]))
# look around: curious "hm? hmm?"
save("curious.wav", np.concatenate([tone(420, 560, 0.18, vib=0.015), gap(0.35), tone(380, 620, 0.22, vib=0.015)]))
# sleep: two soft snores (filtered noise breathing) with a tiny whistle on the out-breath
sn = []
for _ in range(2):
    n = int(0.9 * SR); t = np.arange(n) / SR
    breath = lowpass(rng.standard_normal(n), 40) * np.sin(np.pi * t / 0.9) ** 2 * (1 + 0.6 * np.sin(2 * np.pi * 28 * t))
    sn += [breath * 3, tone(900, 700, 0.5) * 0.12, gap(0.25)]
save("sleep.wav", np.concatenate(sn), peak=0.6)
# angry: low buzzy "grrr-mph"
n = int(0.7 * SR); t = np.arange(n) / SR
grr = np.sign(np.sin(2 * np.pi * 110 * t)) * (0.6 + 0.4 * np.sin(2 * np.pi * 30 * t))
save("angry.wav", np.concatenate([lowpass(grr, 6) * env(n), gap(0.05), tone(240, 160, 0.25, bright=0.8)]), peak=0.7)
# cry: wobbly falling "waaah" twice
save("cry.wav", np.concatenate([tone(700, 420, 0.6, vib=0.05, vib_hz=9), gap(0.12), tone(650, 380, 0.75, vib=0.05, vib_hz=9)]))
print("sounds in", A.out, sorted(os.listdir(A.out)))
