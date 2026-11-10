"""EchoBot 12-second logo intro (Blender 5.2).

EchoBot drops in, lands with a squish, looks around, does a happy hop, slides aside while the
"EchoBot" letters pop in, says hello in robot babble and ends on a happy face with a chime.

Run headless (needs echobot_build.py and the Fredoka font next to this file):
    blender -b -P echobot_intro.py -- --out <folder> [--engine EEVEE|CYCLES] [--samples 32]
                                      [--res 1280x720] [--frames 1-288] [--blend 1]
Writes <out>/frames/*.png, <out>/echobot_intro_audio.wav and, with ffmpeg on PATH,
<out>/EchoBot_intro.mp4. Add "--blend 1" to also save EchoBot_intro.blend to tweak by hand.
"""
import bpy, math, os, random, struct, subprocess, sys, wave, shutil
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
for p in (HERE, os.path.dirname(HERE)):
    if os.path.exists(os.path.join(p, "echobot_build.py")):
        sys.path.insert(0, p)
import echobot_build as eb

args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
opt = {"out": ".", "engine": "EEVEE", "samples": "32", "res": "1280x720", "frames": "1-288", "blend": "0",
       "font": os.path.join(HERE, "Fredoka.ttf")}
for i in range(0, len(args) - 1, 2):
    opt[args[i].lstrip("-")] = args[i + 1]
OUT = os.path.abspath(opt["out"])
os.makedirs(OUT, exist_ok=True)
FPS, LENGTH = 24, 288
RATE = 44100
SLIDE_X = -1.95                      # where the bot ends up, left of the letters
LETTER_START, LETTER_GAP = 142, 4    # first letter pops at this frame, then one every 4 frames
TALK_AT = 162                        # Talk clip starts here (the voice starts TALK_DELAY frames later)
TEXT = "EchoBot"

bpy.ops.wm.read_factory_settings(use_empty=True)
babble = os.path.join(OUT, "echobot_babble.wav")
eb.TALK_ENV = eb.make_babble(babble)
ctrl, squash, body, eyes, rings = eb.build_bot("echo")
ctrl["Follow"] = 0.0
eb.build_camera()
eb.build_stage([o for o in bpy.data.objects if o.type in {"MESH", "CURVE"}])
sc = bpy.context.scene
sc.render.fps = FPS

# ---------- camera: wide 16:9 shot with room for the name ----------
cam = sc.camera
cam.data.lens = 40
cam.location = (0.15, -10.5, 2.35)
cam.rotation_euler = (Vector((0.15, 0, eb.FLOAT_Z - 0.05)) - cam.location).to_track_quat("-Z", "Y").to_euler()

# the bot rides on a mover so it can slide sideways
mover = eb.empty("Mover")
ctrl.parent = mover

# ---------- animation ----------
def happy_hop(f, d, at):
    if 0 <= f - at < 48:
        eb.clip_happy(f - at, d)


def pose(f):
    d = eb.base_pose(f)
    d["LookX"] = 0.0
    d["LookY"] = 0.0
    # 1) drop in from above, eyes shut, stretched
    if f < 18:
        u = f / 18
        d["z"] += 4.6 * (1 - u * u)
        d["Squash"] += 0.06 + 0.12 * u
        d["Blink"] = 1.0
        d["rz"] += 8 * (1 - u)
    # 2) land: big squish and jiggle, rings flash, eyes pop open
    elif f < 46:
        u = (f - 18) / 28
        d["Squash"] += -0.24 * math.exp(-3.2 * u) * math.cos(4.5 * math.pi * u)
        d["z"] -= 0.18 * math.exp(-6 * u)
        d["Blink"] = 1 - eb.ease(29, 33, f)
        d["Surprised"] = eb.env(f, 31, 34, 40, 46)
    d["RingGlow"] = 1 + 2.2 * (math.exp(-(f - 18) / 7) if f >= 18 else 0) - 0.8 * (1 - eb.ease(0, 18, f))
    d["InnerGlow"] = 0.5 + 0.6 * (math.exp(-(f - 18) / 9) if f >= 18 else 0)
    # 3) look left, then right, then back at you
    d["LookX"] += -0.85 * eb.env(f, 48, 54, 60, 64) + 0.85 * eb.env(f, 62, 67, 75, 81)
    d["LookY"] += 0.1 * eb.env(f, 48, 54, 75, 81)
    d["Blink"] = max(d["Blink"], eb.blink_at(f, 84))
    # 4) happy hop
    happy_hop(f, d, 90)
    # 5) slide aside (lean into it), glance at the letters as they pop in
    k = eb.env(f, 136, 141, 146, 154)
    d["rz"] += -9 * k
    d["Squash"] += -0.05 * eb.env(f, 132, 136, 138, 142)
    d["LookX"] += 0.75 * eb.env(f, 144, 150, 162, 168)
    d["Surprised"] = max(d["Surprised"], 0.6 * eb.env(f, 146, 150, 156, 162))
    # 6) say hello
    t = f - TALK_AT
    if 0 <= t < 96:
        eb.clip_talk(t, d)
    # 7) happy ending, holds to the last frame
    d["Blink"] = max(d["Blink"], eb.blink_at(f, 246))
    e = eb.ease(256, 263, f)
    d["Happy"] = max(d["Happy"], e)
    d["Blush"] = max(d["Blush"], 0.7 * e)
    if 254 <= f < 278:
        u = (f - 254) / 24
        d["z"] += 0.18 * math.sin(math.pi * min(1, u * 1.6)) if u < 0.625 else 0
        d["Squash"] += -0.08 * math.exp(-5 * u) * math.cos(4 * math.pi * u) if u > 0.3 else 0.04
    d["RingGlow"] += 0.9 * eb.env(f, 256, 262, 280, 290)
    return d


eb.write_action(ctrl, "Intro", [pose(f) for f in range(LENGTH)])
mover.animation_data_create()
for f, x in ((1, 0.0), (134, 0.0), (152, SLIDE_X)):
    mover.location.x = x
    mover.keyframe_insert("location", index=0, frame=f)
for kp in mover.animation_data.action and eb.iter_fcurves(mover.animation_data.action) or []:
    for p in kp.keyframe_points:
        p.interpolation = "BEZIER"; p.easing = "AUTO"; p.handle_left_type = p.handle_right_type = "AUTO_CLAMPED"
    kp.update()

# ---------- the name: one object per letter so each can pop ----------
font = bpy.data.fonts.load(opt["font"])
text_m = bpy.data.materials.new("Lettering")
nn = text_m.node_tree.nodes
b = nn["Principled BSDF"]
b.inputs["Base Color"].default_value = (0.10, 0.01, 0.36, 1)
b.inputs["Roughness"].default_value = 0.28
b.inputs["Coat Weight"].default_value = 0.6


def text_obj(name, body, size):
    cu = bpy.data.curves.new(name, "FONT")
    cu.body, cu.font, cu.size = body, font, size
    cu.extrude, cu.bevel_depth, cu.bevel_resolution = 0.07, 0.018, 3
    cu.align_x = "LEFT"
    cu.offset = 0.022 * size             # a touch bolder than the regular weight
    o = eb.link(bpy.data.objects.new(name, cu))
    o.rotation_euler = (math.radians(90), 0, 0)
    cu.materials.append(text_m)
    return o


def bbox_x(o):
    bpy.context.view_layer.update()
    xs = [Vector(c).x for c in o.bound_box]
    return min(xs), max(xs)


SIZE = 1.0
probe = text_obj("probe", TEXT, SIZE)
w0 = bbox_x(probe)
SIZE = 3.55 / (w0[1] - w0[0])                # name is 3.55 units wide
bpy.data.objects.remove(probe)
left = SLIDE_X + 1.85                         # just right of the bot's rings
cap_mid = 0.36 * SIZE                         # roughly half the x-height above the baseline
letters = []
for i, ch in enumerate(TEXT):
    pre = text_obj("pre", TEXT[:i + 1], SIZE)
    pre_max = bbox_x(pre)[1]
    bpy.data.objects.remove(pre)
    o = text_obj(f"Letter.{i}", ch, SIZE)
    lo, hi = bbox_x(o)
    o.data.offset_x = -(lo + hi) / 2           # pop around the letter's own centre
    o.data.offset_y = -cap_mid
    x = left + (pre_max - hi) + (lo + hi) / 2
    o.location = (x, -0.25, eb.FLOAT_Z - 0.05)
    letters.append(o)

for i, o in enumerate(letters):
    at = LETTER_START + i * LETTER_GAP
    base_z = o.location.z
    for f in range(at - 1, at + 14):
        u = (f - at) / 8
        if f < at:
            s, dz = 0.0, 0.0
        elif u < 1:
            s = 1.18 * math.sin(math.pi / 2 * u)
            dz = 0.35 * (1 - u) ** 2
        else:
            v = (f - at - 8) / 6
            s = 1 + 0.18 * math.cos(math.pi * min(v, 1)) * (1 - min(v, 1))
            dz = 0.0
        s = max(s, 0.0001)
        o.scale = (s, s, s)
        o.location.z = base_z + dz
        o.keyframe_insert("scale", frame=f + 1)
        o.keyframe_insert("location", index=2, frame=f + 1)
    # little bob in time with the bot's voice
    for f in range(TALK_AT, LENGTH, 4):
        o.location.z = base_z + 0.035 * math.sin(2 * math.pi * (f / 48) - i * 0.6) * eb.env(f, TALK_AT, TALK_AT + 12, 236, 250)
        o.keyframe_insert("location", index=2, frame=f + 1)
    o.location.z = base_z
    o.keyframe_insert("location", index=2, frame=LENGTH)

# ---------- soundtrack ----------
def synth():
    import numpy as np
    n = int(LENGTH / FPS * RATE) + RATE // 2
    out = np.zeros(n)
    t_all = np.arange(n) / RATE

    def at(frame):
        return int((frame - 1) / FPS * RATE)

    def add(start, sig, gain=1.0):
        a = at(start)
        sig = sig[:max(0, n - a)]
        out[a:a + len(sig)] += gain * sig

    def tone(f0, f1, dur, decay, shape="sine"):
        t = np.arange(int(dur * RATE)) / RATE
        f = f0 + (f1 - f0) * (t / dur)
        ph = 2 * np.pi * np.cumsum(f) / RATE
        s = np.sin(ph) if shape == "sine" else np.tanh(2.5 * np.sin(ph))
        return s * np.exp(-t / decay) * np.minimum(1, t / 0.004)

    rng = np.random.default_rng(3)
    # soft pad underneath (a gentle major chord that breathes in and out)
    pad = np.zeros(n)
    for fq in (130.81, 164.81, 196.0, 261.63):
        pad += np.sin(2 * np.pi * fq * t_all + rng.uniform(0, 6)) * (1 + 0.3 * np.sin(2 * np.pi * 0.25 * t_all))
    fade = np.clip(t_all / 1.5, 0, 1) * np.clip((n / RATE - 0.4 - t_all) / 1.5, 0, 1)
    out += 0.025 * pad * fade
    # whoosh while falling
    L = at(19)
    noise = rng.standard_normal(L)
    sm = np.convolve(noise, np.ones(18) / 18, mode="same")
    env_ = np.linspace(0, 1, L) ** 2
    add(1, sm * env_, 0.55)
    # landing: soft thump plus a springy boing
    add(18, tone(110, 45, 0.35, 0.09), 0.9)
    t = np.arange(int(0.55 * RATE)) / RATE
    boing = np.sin(2 * np.pi * np.cumsum(220 + 90 * np.sin(2 * np.pi * 9 * t) * np.exp(-t * 6)) / RATE)
    add(19, boing * np.exp(-t / 0.16), 0.35)
    # eyes pop open
    add(31, tone(900, 1500, 0.09, 0.03), 0.22)
    # glances
    add(50, tone(620, 520, 0.08, 0.03), 0.12)
    add(64, tone(520, 680, 0.08, 0.03), 0.12)
    # happy hop
    add(97, tone(300, 820, 0.22, 0.12, "soft"), 0.16)
    add(118, tone(180, 70, 0.2, 0.06), 0.45)
    # slide
    L = int(0.6 * RATE)
    sl = np.convolve(rng.standard_normal(L), np.ones(30) / 30, mode="same") * np.sin(np.linspace(0, np.pi, L))
    add(134, sl, 0.35)
    # letter pops, rising notes
    scale_hz = (523.25, 587.33, 659.25, 698.46, 783.99, 880.0, 987.77)
    for i in range(len(TEXT)):
        add(LETTER_START + i * LETTER_GAP + 1, tone(scale_hz[i] * 1.6, scale_hz[i], 0.18, 0.05), 0.2)
        add(LETTER_START + i * LETTER_GAP + 1, rng.standard_normal(200) * np.linspace(1, 0, 200), 0.05)
    # robot hello
    with wave.open(babble) as w:
        raw = np.frombuffer(w.readframes(w.getnframes()), dtype="<i2") / 32768.0
        sr = w.getframerate()
    voice = np.interp(np.arange(int(len(raw) * RATE / sr)) * sr / RATE, np.arange(len(raw)), raw)
    add(TALK_AT + eb.TALK_DELAY + 1, voice, 0.75)
    # closing chime
    for j, fq in enumerate((783.99, 987.77, 1174.66, 1567.98)):
        c = tone(fq, fq, 2.2, 0.55)
        c[:int(1.2 * RATE)] += 0.3 * tone(fq * 2, fq * 2, 1.2, 0.25)
        add(258 + j * 3, c, 0.13)
    out = out / max(1e-6, np.max(np.abs(out))) * 0.89
    path = os.path.join(OUT, "echobot_intro_audio.wav")
    with wave.open(path, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(RATE)
        w.writeframes((out * 32767).astype("<i2").tobytes())
    return path


audio = synth()
eb.add_sound(audio, 1)

# ---------- render ----------
eb.setup_render(opt["engine"], opt["samples"], 512)
rx, ry = (int(v) for v in opt["res"].lower().split("x"))
sc.render.resolution_x, sc.render.resolution_y = rx, ry
sc.render.resolution_percentage = 100
f0, f1 = (int(v) for v in opt["frames"].split("-"))
sc.frame_start, sc.frame_end = f0, f1
sc.render.image_settings.file_format = "PNG"
sc.render.filepath = os.path.join(OUT, "frames", "f_")
if opt["blend"] == "1":
    sc.frame_start, sc.frame_end = 1, LENGTH
    eb.setup_viewports()
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "EchoBot_intro.blend"))
    sc.frame_start, sc.frame_end = f0, f1
bpy.ops.render.render(animation=True)

if (f0, f1) == (1, LENGTH) and shutil.which("ffmpeg"):
    mp4 = os.path.join(OUT, "EchoBot_intro.mp4")
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-framerate", str(FPS), "-i",
                    os.path.join(OUT, "frames", "f_%04d.png"), "-i", audio, "-c:v", "libx264", "-pix_fmt", "yuv420p",
                    "-crf", "18", "-preset", "slow", "-c:a", "aac", "-b:a", "160k", "-shortest",
                    "-movflags", "+faststart", mp4], check=True)
    print("wrote", mp4)
print("done", OUT)
