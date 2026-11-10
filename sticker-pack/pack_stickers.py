"""Turn rendered EchoBot clip frames into chat-app sticker formats.

Input:  a folder with one sub-folder of transparent PNG frames per clip (echobot_build.py --anim_stickers)
Output: telegram/*.webm    512x512 VP9 with transparency, max 3 s (Telegram video stickers)
        whatsapp/*.webp    512x512 animated WebP (WhatsApp animated stickers)
        discord/*.png      320x320 APNG (Discord server stickers)
        emoji/*.gif        128x128 GIF on a dark-chat matte (Discord / Slack custom emoji)
Usage:  python pack_stickers.py <frames folder> <output folder>
"""
import glob, os, subprocess, sys, tempfile
from PIL import Image

SRC, OUT = sys.argv[1], sys.argv[2]
LIMITS = {"telegram": 256_000, "whatsapp": 500_000, "discord": 512_000, "emoji": 256_000}
MATTE = (49, 51, 56)            # Discord's dark theme: GIF edges blend into this


def frames_of(d):
    fs = sorted(glob.glob(os.path.join(d, "*.png")))
    ims = [Image.open(f).convert("RGBA") for f in fs]
    box = None
    for im in ims:
        b = im.getchannel("A").point(lambda v: 255 if v > 6 else 0).getbbox()
        if b:
            box = b if box is None else (min(box[0], b[0]), min(box[1], b[1]), max(box[2], b[2]), max(box[3], b[3]))
    w, h = box[2] - box[0], box[3] - box[1]
    side = int(max(w, h) * 1.06)
    cx, cy = (box[0] + box[2]) // 2, (box[1] + box[3]) // 2
    out = []
    for im in ims:
        c = Image.new("RGBA", (side, side), (0, 0, 0, 0))
        c.alpha_composite(im.crop((cx - side // 2, cy - side // 2, cx - side // 2 + side, cy - side // 2 + side)))
        out.append(c)
    return out


def ffmpeg(args):
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error"] + args, check=True)


def write_frames(ims, size, tmp):
    for i, im in enumerate(ims):
        im.resize((size, size), Image.LANCZOS).save(os.path.join(tmp, f"{i:04d}.png"))
    return os.path.join(tmp, "%04d.png")


def telegram(name, ims, fps):
    path = os.path.join(OUT, "telegram", name + ".webm")
    with tempfile.TemporaryDirectory() as tmp:
        pat = write_frames(ims, 512, tmp)
        for crf in (34, 40, 46, 52):
            ffmpeg(["-framerate", str(fps), "-i", pat, "-c:v", "libvpx-vp9", "-pix_fmt", "yuva420p", "-b:v", "0",
                    "-crf", str(crf), "-an", "-auto-alt-ref", "0", path])
            if os.path.getsize(path) <= LIMITS["telegram"]:
                break
    return path


def whatsapp(name, ims, fps):
    path = os.path.join(OUT, "whatsapp", name + ".webp")
    seq = [im.resize((512, 512), Image.LANCZOS) for im in ims]
    for q, step in ((80, 1), (65, 1), (60, 2), (45, 2)):
        part = seq[::step]
        part[0].save(path, save_all=True, append_images=part[1:], duration=int(1000 * step / fps), loop=0,
                     quality=q, alpha_quality=70, method=4, lossless=False)
        if os.path.getsize(path) <= LIMITS["whatsapp"]:
            break
    return path


def discord(name, ims, fps):
    path = os.path.join(OUT, "discord", name + ".png")
    for step, colors in ((1, 256), (2, 256), (2, 128), (3, 96)):
        seq = [im.resize((320, 320), Image.LANCZOS).quantize(colors, method=Image.Quantize.FASTOCTREE).convert("RGBA")
               for im in ims[::step]]
        seq[0].save(path, save_all=True, append_images=seq[1:], duration=int(1000 * step / fps), loop=0,
                    disposal=1, blend=0, optimize=True)
        if os.path.getsize(path) <= LIMITS["discord"]:
            break
    return path


def emoji(name, ims, fps):
    path = os.path.join(OUT, "emoji", name + ".gif")
    for step in (1, 2, 3):
        seq = []
        for im in ims[::step]:
            im = im.resize((128, 128), Image.LANCZOS)
            a = im.getchannel("A")
            bg = Image.new("RGBA", im.size, MATTE + (255,))
            bg.alpha_composite(im)
            p = bg.convert("RGB").quantize(255, method=Image.Quantize.MEDIANCUT)
            p.paste(255, mask=a.point(lambda v: 255 if v < 110 else 0))     # see-through where mostly empty
            p.info["transparency"] = 255
            seq.append(p)
        seq[0].save(path, save_all=True, append_images=seq[1:], duration=int(1000 * step / fps), loop=0,
                    transparency=255, disposal=2, optimize=False)
        if os.path.getsize(path) <= LIMITS["emoji"]:
            break
    return path


for kind in LIMITS:
    os.makedirs(os.path.join(OUT, kind), exist_ok=True)
report = []
for d in sorted(glob.glob(os.path.join(SRC, "*"))):
    if not os.path.isdir(d):
        continue
    name = "echobot_" + os.path.basename(d)
    ims = frames_of(d)
    fps = 16 if len(ims) * 1.0 / 24 > 3 or "lookaround" in d or "sleep" in d or "cry" in d or "talk" in d else 24
    sizes = []
    for fn in (telegram, whatsapp, discord, emoji):
        p = fn(name, ims, fps)
        sizes.append(f"{fn.__name__} {os.path.getsize(p) // 1000} KB")
    report.append(f"{name}: {len(ims)} frames @ {fps} fps ({len(ims) / fps:.1f} s) | " + ", ".join(sizes))
print("\n".join(report))
