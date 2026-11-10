"""EchoBot scene builder v4 for Blender 5.2.

Run inside Blender (Scripting tab > Open > Run Script), or headless:
    blender -b -P echobot_build.py -- --variant echo --blend EchoBot.blend

Options (after --):
    --variant  classic | echo | visor      (default echo)
    --blend    path to save the .blend
    --render   path for a still render (Cycles)
    --frames   path prefix to render the whole animation loop (Cycles)
    --engine   EEVEE | CYCLES               (engine saved in the file, default EEVEE)
    --frame    frame to show/render         (default 1)
    --pose     k=v,k=v  set controls for a still, e.g. Happy=1,LookX=0.5
    --stickers folder   render transparent PNG stickers of each mood
    --turntable prefix  render a 360 spin (frames, then encode with ffmpeg)
    --glb      path     export a .glb web model
    --anim_stickers folder  render transparent PNG frames of each clip (for animated stickers)

The "EchoBot" empty carries the controls (Object Properties > Custom Properties):
    LookX, LookY   where the eyes look (-1..1)
    Blink          0 open .. 1 closed
    Happy, Sleepy, Surprised   eye moods (0..1, mix freely)
    RingGlow       echo ring brightness multiplier
    Hue            shift the body colour (-0.5..0.5, 0 = purple)
    Talk           mouth open + rings pulse (keyframe it, or use the talk-from-audio script)
    Blush          cheek blush (Happy also adds some)
    Follow         how much the eyes/body follow the LookTarget object (drag it around)
    HoverGlow      the purple glow under the bot
    Angry, Sad, Cry  more moods (Cry adds tears)
    InnerGlow      soft "powered on" glow from inside the body
    Squash         squash (-) / stretch (+) the body

Animation clips (Dope Sheet > Action editor, or the NLA editor): Showreel (default),
Idle, LookAround, Happy, Talk, Surprised, Sleep, Angry, Cry.
"""
import bpy, bmesh, math, sys, os, wave, struct, random
from mathutils import Vector

# ---------- tweakables ----------
BODY_TOP = (0.58, 0.40, 1.00)      # lilac highlight
BODY_MID = (0.30, 0.03, 0.95)      # main violet
BODY_LOW = (0.09, 0.00, 0.40)      # deep purple
RIM = (0.80, 0.62, 1.00)
EYE_COLOR = (0.012, 0.015, 0.04)
GLOW = (0.75, 0.95, 1.0)           # visor eye glow
BODY_SCALE = Vector((1.04, 1.0, 0.96))  # slight squash = friendlier
FLOAT_Z = 1.7
VIEW, LOOK, EXPOSURE = "Standard", "None", -0.55
TALK_DELAY = 8                     # frames into the Talk clip before the voice starts

CONTROLS = {  # name: (default, min, max, description)
    "LookX": (0.0, -1.0, 1.0, "Eyes look left (-) / right (+)"),
    "LookY": (0.0, -1.0, 1.0, "Eyes look down (-) / up (+)"),
    "Blink": (0.0, 0.0, 1.0, "Close the eyes"),
    "Happy": (0.0, 0.0, 1.0, "Happy ^ ^ eyes"),
    "Sleepy": (0.0, 0.0, 1.0, "Half-closed eyes"),
    "Surprised": (0.0, 0.0, 1.0, "Wide eyes"),
    "RingGlow": (1.0, 0.0, 3.0, "Echo ring brightness"),
    "Hue": (0.0, -0.5, 0.5, "Shift the body colour"),
    "Talk": (0.0, 0.0, 1.0, "Open the mouth / pulse the rings"),
    "Blush": (0.0, 0.0, 1.0, "Cheek blush"),
    "Follow": (1.0, 0.0, 1.0, "Eyes and body follow the LookTarget object"),
    "HoverGlow": (1.0, 0.0, 3.0, "Glow under the bot"),
    "Angry": (0.0, 0.0, 1.0, "Angry slanted eyes and frown"),
    "Sad": (0.0, 0.0, 1.0, "Sad droopy eyes and frown"),
    "Cry": (0.0, 0.0, 1.0, "Tears"),
    "InnerGlow": (0.5, 0.0, 2.0, "Glow from inside the body"),
    "Squash": (0.0, -0.3, 0.3, "Squash (-) / stretch (+)"),
}


def args():
    a = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    opts = {"variant": "echo", "render": None, "blend": None, "frames": None, "samples": 96,
            "res": 1080, "engine": "EEVEE", "frame": 1, "pose": "", "stickers": None,
            "turntable": None, "glb": None, "anim_stickers": None, "transparent": "0", "still_engine": "CYCLES"}
    for i in range(0, len(a) - 1, 2):
        opts[a[i].lstrip("-")] = a[i + 1]
    return opts


# ---------- helpers ----------
def link(obj, parent=None):
    if obj.name not in bpy.context.collection.objects:
        bpy.context.collection.objects.link(obj)
    if parent:
        obj.parent = parent
    return obj


def empty(name, parent=None, loc=(0, 0, 0)):
    o = bpy.data.objects.new(name, None)
    o.empty_display_size = 0.3
    link(o, parent)
    o.location = loc
    return o


def mat(name, color=(1, 1, 1), rough=0.4, emit=None, emit_str=0.0, coat=0.0):
    m = bpy.data.materials.new(name)
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Coat Weight"].default_value = coat
    if emit:
        b.inputs["Emission Color"].default_value = (*emit, 1)
        b.inputs["Emission Strength"].default_value = emit_str
    return m


def drive(owner, path, expr, ctrl, names, index=-1, xforms=()):
    """Add a driver that reads custom props of the control object (simple expressions only).
    xforms: (var_name, object, 'LOC_X'|'LOC_Z'...) world-space transform channels."""
    fc = owner.driver_add(path, index) if index >= 0 else owner.driver_add(path)
    d = fc.driver
    d.type = "SCRIPTED"
    for vn, ob, chan in xforms:
        v = d.variables.new()
        v.name, v.type = vn, "TRANSFORMS"
        v.targets[0].id = ob
        v.targets[0].transform_type = chan
        v.targets[0].transform_space = "WORLD_SPACE"
    for n in names:
        v = d.variables.new()
        v.name = n.lower()
        v.type = "SINGLE_PROP"
        v.targets[0].id = ctrl
        v.targets[0].data_path = f'["{n}"]'
    d.expression = expr
    return fc


def sphere_mesh(name, segs=48, rings=24):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=rings, radius=1.0)
    bm.to_mesh(me); bm.free()
    for p in me.polygons:
        p.use_smooth = True
    return me


def sphere_obj(name, scale, material, parent, loc=(0, 0, 0), segs=48, rings=24, me=None):
    o = bpy.data.objects.new(name, me or sphere_mesh(name, segs, rings))
    link(o, parent)
    o.location, o.scale = loc, scale
    if material and not o.data.materials:
        o.data.materials.append(material)
    return o


def subsurf(obj, levels=1):
    m = obj.modifiers.new("Subsurf", "SUBSURF")
    m.levels = m.render_levels = levels


def on_body(x, z):
    """Point + outward normal on the squashed body surface, front side (-Y), body-local."""
    y = -math.sqrt(max(0.0, 1 - x * x - z * z))
    pu = Vector((x, y, z))
    p = Vector((pu.x * BODY_SCALE.x, pu.y * BODY_SCALE.y, pu.z * BODY_SCALE.z))
    n = Vector((pu.x / BODY_SCALE.x, pu.y / BODY_SCALE.y, pu.z / BODY_SCALE.z)).normalized()
    return p, n


# ---------- materials ----------
def body_material(ctrl):
    m = bpy.data.materials.new("EchoBot_Body")
    nt = m.node_tree
    n, l = nt.nodes, nt.links
    b = n["Principled BSDF"]
    tc = n.new("ShaderNodeTexCoord")
    dot = n.new("ShaderNodeVectorMath"); dot.operation = "DOT_PRODUCT"
    dot.inputs[1].default_value = (-0.45, 0.25, 0.85)   # light comes from top-left
    l.new(tc.outputs["Object"], dot.inputs[0])
    mr = n.new("ShaderNodeMapRange")
    mr.inputs["From Min"].default_value, mr.inputs["From Max"].default_value = -1.0, 1.0
    l.new(dot.outputs["Value"], mr.inputs["Value"])
    ramp = n.new("ShaderNodeValToRGB"); ramp.name = ramp.label = "BodyColours"
    e = ramp.color_ramp.elements
    e[0].position, e[0].color = 0.08, (*BODY_LOW, 1)
    e[1].position, e[1].color = 0.95, (*BODY_TOP, 1)
    e.new(0.5).color = (*BODY_MID, 1)
    l.new(mr.outputs["Result"], ramp.inputs["Fac"])
    hs = n.new("ShaderNodeHueSaturation"); hs.name = hs.label = "HueShift"
    l.new(ramp.outputs["Color"], hs.inputs["Color"])
    l.new(hs.outputs["Color"], b.inputs["Base Color"])
    drive(hs.inputs["Hue"], "default_value", "0.5 + hue", ctrl, ["Hue"])
    # glowing rim (fresnel)
    lw = n.new("ShaderNodeLayerWeight"); lw.inputs["Blend"].default_value = 0.2
    pw = n.new("ShaderNodeMath"); pw.operation = "POWER"; pw.inputs[1].default_value = 4.0
    l.new(lw.outputs["Facing"], pw.inputs[0])
    mul = n.new("ShaderNodeMath"); mul.operation = "MULTIPLY"; mul.inputs[1].default_value = 1.2
    mul.label = "Rim strength"
    l.new(pw.outputs[0], mul.inputs[0])
    # inner glow: brightest where the surface faces the camera, gently pulsing
    inv = n.new("ShaderNodeMath"); inv.operation = "SUBTRACT"; inv.inputs[0].default_value = 1.0
    l.new(lw.outputs["Facing"], inv.inputs[1])
    ipw = n.new("ShaderNodeMath"); ipw.operation = "POWER"; ipw.inputs[1].default_value = 3.0
    l.new(inv.outputs[0], ipw.inputs[0])
    gv = n.new("ShaderNodeValue"); gv.name = gv.label = "InnerGlow"
    drive(gv.outputs[0], "default_value", "innerglow * 0.35 * (0.85 + 0.15 * sin(frame * 0.13))", ctrl, ["InnerGlow"])
    imul = n.new("ShaderNodeMath"); imul.operation = "MULTIPLY"
    l.new(ipw.outputs[0], imul.inputs[0]); l.new(gv.outputs[0], imul.inputs[1])
    add = n.new("ShaderNodeMath"); add.operation = "ADD"
    l.new(mul.outputs[0], add.inputs[0]); l.new(imul.outputs[0], add.inputs[1])
    l.new(add.outputs[0], b.inputs["Emission Strength"])
    rimhs = n.new("ShaderNodeHueSaturation")
    rimhs.inputs["Color"].default_value = (*RIM, 1)
    drive(rimhs.inputs["Hue"], "default_value", "0.5 + hue", ctrl, ["Hue"])
    l.new(rimhs.outputs["Color"], b.inputs["Emission Color"])
    b.inputs["Roughness"].default_value = 0.32
    b.inputs["Subsurface Weight"].default_value = 0.12
    b.inputs["Subsurface Radius"].default_value = (0.9, 0.4, 1.0)
    b.inputs["Subsurface Scale"].default_value = 0.12
    b.inputs["Coat Weight"].default_value = 0.3
    b.inputs["Coat Roughness"].default_value = 0.06
    return m


# ---------- eyes with mood shape keys ----------
def eye_mesh():
    me = sphere_mesh("EyeMesh", 48, 32)
    o = bpy.data.objects.new("_tmp", me)
    link(o)
    o.shape_key_add(name="Basis")
    base = [v.co.copy() for v in me.vertices]

    def key(name, fn):
        k = o.shape_key_add(name=name, from_mix=False)
        for i, c in enumerate(base):
            k.data[i].co = fn(c.copy())

    def blink(c):  # lid-style: closes top-down onto a soft curved lash line
        x = c.x * 1.08
        line = -0.28 - 0.22 * (1 - x * x)
        c.x, c.z = x, line + (c.z + 1) * 0.09
        return c

    def angry(c):  # lid slants down toward the nose (+x is always the inner side)
        lid = 0.25 - 0.6 * c.x
        if c.z > lid:
            c.z = lid + (c.z - lid) * 0.06
        return c

    def sad(c):    # lid slants down toward the outside
        lid = 0.3 + 0.55 * c.x
        if c.z > lid:
            c.z = lid + (c.z - lid) * 0.06
        c.z -= 0.05
        return c

    def happy(c):  # ^ shaped arc
        x = c.x * 1.2
        c.x, c.z = x, 0.25 - 0.75 * x * x + c.z * 0.22
        return c

    def sleepy(c):  # heavy lids: flatten the top half
        if c.z > -0.1:
            c.z = -0.1 + (c.z + 0.1) * 0.12
        c.x *= 1.06
        return c

    def surprised(c):
        c.x *= 1.22; c.z *= 1.15; c.y *= 1.1
        return c

    for nm, fn in (("Blink", blink), ("Happy", happy), ("Sleepy", sleepy), ("Surprised", surprised),
                   ("Angry", angry), ("Sad", sad)):
        key(nm, fn)
    bpy.data.objects.remove(o)
    return me


def build_bot(variant):
    ctrl = empty("EchoBot", loc=(0, 0, FLOAT_Z))
    ctrl.empty_display_type = "SPHERE"; ctrl.empty_display_size = 1.25
    for k, (dv, lo, hi, desc) in CONTROLS.items():
        ctrl[k] = dv
        ctrl.id_properties_ui(k).update(min=lo, max=hi, soft_min=lo, soft_max=hi, description=desc)

    squash = empty("Squash", ctrl)          # squash & stretch happens here (driven by the Squash control)
    for i, ex in enumerate(("1 - squash * 0.6", "1 - squash * 0.6", "1 + squash")):
        drive(squash, "scale", ex, ctrl, ["Squash"], i)
    body = sphere_obj("Body", BODY_SCALE, body_material(ctrl), squash, segs=64, rings=32)
    subsurf(body, 1)

    target = empty("LookTarget", loc=(0, -4.5, FLOAT_Z))   # drag me around!
    target.empty_display_type = "SPHERE"; target.empty_display_size = 0.15
    pivot = empty("EyesPivot", squash)       # rotates to make the eyes look around
    pivot.empty_display_size = 0.1
    tv = (("tx", target, "LOC_X"), ("tz", target, "LOC_Z"), ("bx", ctrl, "LOC_X"), ("bz", ctrl, "LOC_Z"))
    gx = "(lookx * 0.42 + follow * max(-0.5, min(0.5, (tx - bx) * 0.14)))"
    gz = "(looky * 0.3 + follow * max(-0.35, min(0.35, (tz - bz) * 0.12)))"
    drive(pivot, "rotation_euler", gx, ctrl, ["LookX", "Follow"], 2, tv)
    drive(pivot, "rotation_euler", "-" + gz, ctrl, ["LookY", "Follow"], 0, tv)
    # the whole body leans a little toward where it looks
    drive(squash, "rotation_euler", gx + " * 0.25", ctrl, ["LookX", "Follow"], 2, tv)
    drive(squash, "rotation_euler", "-" + gz + " * 0.3", ctrl, ["LookY", "Follow"], 0, tv)

    if variant == "visor":
        build_visor(pivot)
        eye_m = mat("EyeGlow", GLOW, emit=GLOW, emit_str=6.0)
        sx, sz, inset, lift = 0.075, 0.13, 0.0, 0.04
    else:
        eye_m = mat("Eye", EYE_COLOR, rough=0.06, coat=1.0)
        sx, sz, inset, lift = 0.105, 0.165, 0.012, 0.0
    hi_m = mat("Catchlight", (1, 1, 1), emit=(1, 1, 1), emit_str=5.0)

    me = eye_mesh()
    me.materials.append(eye_m)
    for nm in ("Blink", "Happy", "Sleepy", "Surprised", "Angry", "Sad"):
        drive(me.shape_keys.key_blocks[nm], "value", nm.lower(), ctrl, [nm])

    eyes = []
    for side, tag in ((-1, "L"), (1, "R")):
        p, n = on_body(side * 0.27, 0.06)
        loc = p + n * (lift - inset)
        # the right eye is mirrored so slanted moods (angry/sad) point the right way on both sides
        e = sphere_obj(f"Eye.{tag}", (sx * -side, 0.07, sz), None, pivot, loc, me=me)
        e.rotation_mode = "QUATERNION"
        e.rotation_quaternion = (-n).to_track_quat("Y", "Z")
        eyes.append(e)
        if variant != "visor":
            # catchlight lives in eye space and hides when the eye closes or changes shape
            h = sphere_obj(f"Catchlight.{tag}", (0.24, 0.3, 0.17), hi_m, e, (0.32 * side, -0.95, 0.45), 16, 8)
            for i in range(3):
                drive(h, "scale", f"{h.scale[i]:.3f} * max(0, 1 - blink*1.6 - happy*1.6 - sleepy*1.2)",
                      ctrl, ["Blink", "Happy", "Sleepy"], i)

    if variant != "visor":
        build_mouth(ctrl, pivot)
        build_blush(ctrl, pivot)
        build_tears(ctrl, pivot)
    build_hover_glow(ctrl)
    rings = build_rings(ctrl) if variant == "echo" else []
    return ctrl, squash, body, eyes, rings


def build_mouth(ctrl, parent):
    """Hidden at rest (keeps the logo look); appears as a smile when happy, opens when talking."""
    me = sphere_mesh("MouthMesh", 32, 16)
    o = bpy.data.objects.new("Mouth", me)
    link(o, parent)
    o.shape_key_add(name="Basis")
    base = [v.co.copy() for v in me.vertices]
    for v, c in zip(me.vertices, base):  # basis = little smile arc
        v.co = Vector((c.x, c.y, c.z * 0.3 + 0.55 * c.x * c.x))
    o.data.shape_keys.key_blocks["Basis"].data.foreach_set("co", [x for v in me.vertices for x in v.co])
    k = o.shape_key_add(name="Open", from_mix=False)
    for i, c in enumerate(base):  # rounded open "o"
        k.data[i].co = Vector((c.x * 0.85, c.y, c.z * 2.0 + 0.1))
    fr = o.shape_key_add(name="Frown", from_mix=False)
    for i, c in enumerate(base):  # upside-down arc
        fr.data[i].co = Vector((c.x * 0.9, c.y, c.z * 0.3 - 0.6 * c.x * c.x + 0.25))
    drive(fr, "value", "max(sad, angry)", ctrl, ["Sad", "Angry"])
    m = mat("Mouth", (0.03, 0.005, 0.03), rough=0.3, coat=0.8)
    me.materials.append(m)
    p, n = on_body(0.0, -0.2)
    o.location = p - n * 0.01
    o.rotation_mode = "QUATERNION"
    o.rotation_quaternion = (-n).to_track_quat("Y", "Z")
    drive(k, "value", "talk", ctrl, ["Talk"])
    base_s = (0.1, 0.05, 0.075)
    vis = "min(1, talk * 4 + happy * 0.9 + sad * 0.8 + angry * 0.8)"
    for i in range(3):
        drive(o, "scale", f"{base_s[i]} * {vis}", ctrl, ["Talk", "Happy", "Sad", "Angry"], i)


def build_tears(ctrl, parent):
    m = bpy.data.materials.new("Tear")
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (0.55, 0.85, 1.0, 1)
    b.inputs["Roughness"].default_value = 0.05
    b.inputs["Coat Weight"].default_value = 1.0
    b.inputs["Emission Color"].default_value = (0.5, 0.85, 1.0, 1)
    b.inputs["Emission Strength"].default_value = 0.6
    for side, tag in ((-1, "L"), (1, "R")):
        for j, (dz, s_) in enumerate(((-0.2, (0.035, 0.03, 0.075)), (-0.36, (0.028, 0.025, 0.05)))):
            p, n = on_body(side * 0.25, dz)
            t = sphere_obj(f"Tear.{tag}{j}", s_, m, parent, p + n * 0.01, 16, 8)
            t.rotation_mode = "QUATERNION"
            t.rotation_quaternion = (-n).to_track_quat("Y", "Z")
            # second drop slides down and pops, looping while crying
            wob = "1" if j == 0 else "(0.6 + 0.4 * sin(frame * 0.4))"
            for i in range(3):
                drive(t, "scale", f"{s_[i]} * min(1, cry * 1.5) * {wob}", ctrl, ["Cry"], i)


def build_blush(ctrl, parent):
    m = bpy.data.materials.new("Blush")
    m.surface_render_method = "BLENDED"
    nn, l = m.node_tree.nodes, m.node_tree.links
    b = nn["Principled BSDF"]
    b.inputs["Base Color"].default_value = (1.0, 0.35, 0.65, 1)
    b.inputs["Emission Color"].default_value = (1.0, 0.35, 0.65, 1)
    b.inputs["Emission Strength"].default_value = 0.4
    b.inputs["Roughness"].default_value = 0.5
    tc = nn.new("ShaderNodeTexCoord")
    gr = nn.new("ShaderNodeTexGradient"); gr.gradient_type = "SPHERICAL"
    sep = nn.new("ShaderNodeSeparateXYZ"); l.new(tc.outputs["Object"], sep.inputs[0])
    cmb = nn.new("ShaderNodeCombineXYZ")   # flatten: falloff across the face of the disc
    l.new(sep.outputs["X"], cmb.inputs["X"]); l.new(sep.outputs["Z"], cmb.inputs["Z"])
    l.new(cmb.outputs[0], gr.inputs["Vector"])
    amt = nn.new("ShaderNodeValue"); amt.name = amt.label = "BlushAmount"
    drive(amt.outputs[0], "default_value", "max(blush, happy * 0.8)", ctrl, ["Blush", "Happy"])
    mul = nn.new("ShaderNodeMath"); mul.operation = "MULTIPLY"
    l.new(gr.outputs["Fac"], mul.inputs[0]); l.new(amt.outputs[0], mul.inputs[1])
    mul2 = nn.new("ShaderNodeMath"); mul2.operation = "MULTIPLY"; mul2.inputs[1].default_value = 1.6
    mul2.use_clamp = True
    l.new(mul.outputs[0], mul2.inputs[0]); l.new(mul2.outputs[0], b.inputs["Alpha"])
    for side, tag in ((-1, "L"), (1, "R")):
        p, n = on_body(side * 0.47, -0.13)
        o = sphere_obj(f"Blush.{tag}", (0.15, 0.025, 0.09), m, parent, p + n * 0.012, 24, 12)
        o.rotation_mode = "QUATERNION"
        o.rotation_quaternion = (-n).to_track_quat("Y", "Z")
        o.visible_shadow = False
        o["_base"] = list(o.scale)


def build_hover_glow(ctrl):
    ld = bpy.data.lights.new("HoverGlow", "POINT")
    ld.color = (0.6, 0.35, 1.0)
    ld.shadow_soft_size = 0.6
    ld.specular_factor = 0.0          # glow only, no hot spot on the body
    lo = link(bpy.data.objects.new("HoverGlow", ld), ctrl)
    lo.location = (0, 0, -1.15)
    drive(ld, "energy", "hoverglow * 22", ctrl, ["HoverGlow"])


def build_visor(parent):
    me = bpy.data.meshes.new("Visor")
    v = bpy.data.objects.new("Visor", me)
    link(v, parent)
    bm = bmesh.new()
    RX, RZ, CZ, RINGS, SEG = 0.64, 0.42, 0.04, 14, 128
    center = bm.verts.new((0, -1, CZ))
    prev = None
    for r in range(1, RINGS + 1):
        f = r / RINGS
        ring = []
        for k in range(SEG):
            a = 2 * math.pi * k / SEG
            c, s_ = math.cos(a), math.sin(a)
            x = RX * f * math.copysign(abs(c) ** 0.7, c)
            z = CZ + RZ * f * math.copysign(abs(s_) ** 0.7, s_)
            ring.append(bm.verts.new((x, -math.sqrt(max(0.0, 1 - x * x - z * z)), z)))
        if prev is None:
            for k in range(SEG):
                bm.faces.new((center, ring[k], ring[(k + 1) % SEG]))
        else:
            for k in range(SEG):
                bm.faces.new((prev[k], ring[k], ring[(k + 1) % SEG], prev[(k + 1) % SEG]))
        prev = ring
    bm.normal_update(); bm.to_mesh(me); bm.free()
    for p in me.polygons:
        p.use_smooth = True
    v.scale = BODY_SCALE * 1.006
    sol = v.modifiers.new("Thickness", "SOLIDIFY"); sol.thickness = 0.025; sol.offset = 0
    bev = v.modifiers.new("Bevel", "BEVEL"); bev.width = 0.01; bev.segments = 3
    me.materials.append(mat("Visor", (0.012, 0.008, 0.03), rough=0.12, coat=1.0))


def build_rings(ctrl):
    rings = []
    for i, r in enumerate((1.15, 1.3, 1.45)):
        cu = bpy.data.curves.new(f"EchoRing.{i}", "CURVE")
        cu.dimensions = "3D"; cu.bevel_depth = 0.013; cu.bevel_resolution = 3
        sp = cu.splines.new("NURBS")
        N = 16
        sp.points.add(N - 1)
        for k in range(N):
            a = 2 * math.pi * k / N
            sp.points[k].co = (r * math.cos(a), r * math.sin(a), 0, 1)
        sp.use_cyclic_u = True; sp.order_u = 4; sp.resolution_u = 12
        t = bpy.data.objects.new(f"EchoRing.{i}", cu)
        link(t, ctrl)
        t.location = (0, 0.45 + 0.12 * i, 0)
        t.rotation_euler = (math.radians(90), 0, 0)
        t.visible_shadow = False
        m = bpy.data.materials.new(f"Ring{i}")
        m.surface_render_method = "BLENDED"
        nn, l = m.node_tree.nodes, m.node_tree.links
        b = nn["Principled BSDF"]
        b.inputs["Base Color"].default_value = (*BODY_MID, 1)
        tint = nn.new("ShaderNodeHueSaturation")
        tint.inputs["Color"].default_value = (0.62, 0.36, 1.0, 1)
        drive(tint.inputs["Hue"], "default_value", "0.5 + hue", ctrl, ["Hue"])
        l.new(tint.outputs["Color"], b.inputs["Emission Color"])
        fade = nn.new("ShaderNodeValue"); fade.name = fade.label = "Fade"
        ph = f"(frame / 48 + {i / 3:.4f} - floor(frame / 48 + {i / 3:.4f}))"
        drive(fade.outputs[0], "default_value", f"pow(max(0, sin(pi * {ph})), 1.5)", ctrl, [])
        for ax in range(3):
            drive(t, "scale", f"0.78 + 0.36 * {ph}", ctrl, [], ax)
        glow = nn.new("ShaderNodeValue"); glow.name = glow.label = "Glow"
        drive(glow.outputs[0], "default_value", "ringglow + talk * 2.5", ctrl, ["RingGlow", "Talk"])
        m1 = nn.new("ShaderNodeMath"); m1.operation = "MULTIPLY"
        l.new(fade.outputs[0], m1.inputs[0]); l.new(glow.outputs[0], m1.inputs[1])
        m2 = nn.new("ShaderNodeMath"); m2.operation = "MULTIPLY"; m2.inputs[1].default_value = 2.2
        l.new(m1.outputs[0], m2.inputs[0]); l.new(m2.outputs[0], b.inputs["Emission Strength"])
        m3 = nn.new("ShaderNodeMath"); m3.operation = "MULTIPLY"; m3.inputs[1].default_value = 0.9
        m3.use_clamp = True
        l.new(m1.outputs[0], m3.inputs[0]); l.new(m3.outputs[0], b.inputs["Alpha"])
        cu.materials.append(m)
        rings.append(t)
    return rings


# ---------- stage ----------
def build_stage(bot_objects):
    me = bpy.data.meshes.new("Backdrop")
    bd = link(bpy.data.objects.new("Backdrop", me))
    bm = bmesh.new()
    W, steps = 30, 32
    prof = [(-20, 0.0)]
    for i in range(steps + 1):
        a = math.radians(90 * i / steps)
        prof.append((4 + 4 * math.sin(a), 4 - 4 * math.cos(a)))
    prof.append((8, 20))
    rows = [(bm.verts.new((-W, y, z)), bm.verts.new((W, y, z))) for y, z in prof]
    for (a0, a1), (b0, b1) in zip(rows, rows[1:]):
        bm.faces.new((a0, a1, b1, b0))
    bm.to_mesh(me); bm.free()
    for p in me.polygons:
        p.use_smooth = True
    m = bpy.data.materials.new("Backdrop")
    n, l = m.node_tree.nodes, m.node_tree.links
    b = n["Principled BSDF"]; b.inputs["Roughness"].default_value = 0.85
    # soft lavender gradient: brighter behind the bot, deeper toward the edges
    tc = n.new("ShaderNodeTexCoord")
    sub = n.new("ShaderNodeVectorMath"); sub.operation = "SUBTRACT"
    sub.inputs[1].default_value = (0, 4.0, 2.5)   # brightest point: on the wall behind the bot
    l.new(tc.outputs["Object"], sub.inputs[0])
    vm = n.new("ShaderNodeVectorMath"); vm.operation = "LENGTH"
    l.new(sub.outputs[0], vm.inputs[0])
    mr = n.new("ShaderNodeMapRange")
    mr.inputs["From Min"].default_value, mr.inputs["From Max"].default_value = 3.0, 12.0
    l.new(vm.outputs["Value"], mr.inputs["Value"])
    ramp = n.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = (0.97, 0.93, 1.0, 1)
    ramp.color_ramp.elements[1].color = (0.62, 0.52, 0.90, 1)
    l.new(mr.outputs["Result"], ramp.inputs["Fac"])
    l.new(ramp.outputs["Color"], b.inputs["Base Color"])
    me.materials.append(m)

    world = bpy.data.worlds.new("World")
    bpy.context.scene.world = world
    bg = world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (0.86, 0.84, 0.95, 1)
    bg.inputs["Strength"].default_value = 0.35

    bot_col = bpy.data.collections.new("EchoBot_Parts")  # used for light linking only
    for o in bot_objects:
        bot_col.objects.link(o)

    def area(name, loc, size, energy, color=(1, 1, 1), only_bot=False):
        ld = bpy.data.lights.new(name, "AREA")
        ld.size, ld.energy, ld.color = size, energy, color
        lo = link(bpy.data.objects.new(name, ld))
        lo.location = loc
        d = Vector((0, 0, FLOAT_Z)) - Vector(loc)
        lo.rotation_mode = "QUATERNION"
        lo.rotation_quaternion = d.to_track_quat("-Z", "Y")
        if only_bot:  # rim lights only touch the bot, never the backdrop
            lo.light_linking.receiver_collection = bot_col
        return lo
    area("Key", (-3.5, -4.0, 5.5), 3.5, 600)
    area("Fill", (4.5, -3.5, 2.0), 5.0, 110, (0.92, 0.9, 1.0))
    area("Rim", (3.0, 3.0, 4.0), 2.0, 600, (0.85, 0.75, 1.0), only_bot=True)
    area("Rim2", (-3.0, 3.0, 2.5), 2.0, 400, (0.8, 0.85, 1.0), only_bot=True)


def build_camera():
    cd = bpy.data.cameras.new("Camera"); cd.lens = 75
    cam = link(bpy.data.objects.new("Camera", cd))
    cam.location = (0, -10.0, 2.6)
    d = Vector((0, 0, FLOAT_Z - 0.1)) - cam.location
    cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    bpy.context.scene.camera = cam


# ---------- animation ----------
def ease(a, b, x):
    if x <= a: return 0.0
    if x >= b: return 1.0
    t = (x - a) / (b - a)
    return t * t * (3 - 2 * t)


def env(f, a, b, c, d):
    """smooth trapezoid: 0 before a, 1 between b and c, 0 after d"""
    return ease(a, b, f) * (1 - ease(c, d, f))


def blink_at(f, at):
    return ease(at - 2, at, f) * (1 - ease(at + 2, at + 4, f))


def base_pose(f):
    w = 2 * math.pi * f / 48          # 2-second breathing/bob cycle; every clip is a multiple of 48 frames
    d = {k: v[0] for k, v in CONTROLS.items() if k not in ("Follow", "LookX", "LookY")}
    d.update(LookX=0.0, LookY=0.0, z=0.07 * math.sin(w), rx=2.5 * math.sin(w + 0.6), rz=0.0,
             Squash=0.012 * math.sin(w))
    return d


def clip_idle(f, d):
    d["Blink"] = blink_at(f, 28)


def clip_look(f, d):
    left, right = env(f, 4, 10, 28, 34), env(f, 44, 50, 66, 72)
    d["LookX"] = -0.8 * left + 0.75 * right
    d["LookY"] = 0.25 * left - 0.2 * right
    d["rz"] += 3 * d["LookX"]
    d["Blink"] = max(blink_at(f, 38), blink_at(f, 80))


def clip_happy(f, d):
    sq = 0.0
    if f < 9:                                   # anticipation
        k = ease(0, 7, f) * (1 - ease(7, 9, f))
        d["z"] -= 0.06 * k; sq = -0.09 * k
    elif f < 28:                                # airtime with stretch
        u = (f - 8) / 20
        d["z"] += 0.55 * math.sin(math.pi * u); sq = 0.08 * max(0.0, 1 - u * 3)
    else:                                       # landing jiggle
        u = (f - 28) / 20
        sq = -0.13 * math.exp(-3.5 * u) * math.cos(4 * math.pi * u)
        d["rz"] += 3 * math.exp(-3 * u) * math.sin(6 * math.pi * u)
    d["Squash"] += sq
    d["Happy"] = env(f, 0, 5, 40, 47)
    d["Blush"] = 0.6 * d["Happy"]
    d["RingGlow"] = 1 + 1.2 * env(f, 8, 14, 24, 34)


def clip_talk(f, d):
    e = TALK_ENV or []
    i = f - TALK_DELAY
    d["Talk"] = e[i] if 0 <= i < len(e) else 0.0
    d["LookY"] = 0.15 * env(f, 2, 8, 86, 92)
    d["rx"] += 4 * d["Talk"]
    d["Blink"] = blink_at(f, 60)


def clip_surprised(f, d):
    d["Surprised"] = env(f, 1, 4, 34, 42)
    d["LookY"] = 0.2 * d["Surprised"]
    if 2 <= f <= 16:
        d["z"] += 0.22 * math.sin(math.pi * (f - 2) / 14)
    d["Squash"] += 0.07 * env(f, 2, 4, 6, 10)
    if f > 16:
        u = (f - 16) / 20
        d["Squash"] += -0.08 * math.exp(-4 * u) * math.cos(3 * math.pi * min(u, 1))
    d["RingGlow"] = 1 + 1.5 * (math.exp(-(f - 3) / 6) if f >= 3 else 0)
    d["Blink"] = blink_at(f, 42)


def clip_sleep(f, d):
    k = env(f, 0, 24, 72, 94)
    d["Sleepy"] = env(f, 0, 16, 84, 94)
    d["Blink"] = env(f, 20, 30, 76, 84)
    d["z"] = d["z"] * (1 - 0.6 * k) - 0.12 * k
    d["rx"] += 6 * k
    d["Squash"] += 0.02 * math.sin(2 * math.pi * f / 48) * k
    d["HoverGlow"] = 1 - 0.6 * k
    d["InnerGlow"] = 0.5 - 0.35 * k
    d["RingGlow"] = 1 - 0.6 * k


def clip_angry(f, d):
    k = env(f, 0, 4, 40, 47)
    d["Angry"] = k
    d["rz"] += 3.5 * math.sin(2 * math.pi * f / 4) * env(f, 2, 6, 30, 40)
    d["Hue"] = 0.12 * env(f, 0, 6, 38, 47)
    d["RingGlow"] = 1 + 0.8 * k
    d["Squash"] -= 0.04 * k


def clip_cry(f, d):
    k = env(f, 0, 8, 86, 95)
    d["Sad"] = k
    d["Cry"] = env(f, 6, 14, 82, 92)
    d["z"] -= 0.08 * k
    d["rx"] += 5 * k
    d["Squash"] -= 0.04 * max(0, 1 - abs(f - 30) / 3) + 0.04 * max(0, 1 - abs(f - 58) / 3)
    d["Blink"] = blink_at(f, 50)
    d["RingGlow"] = 1 - 0.4 * k


CLIPS = [("Idle", 48, clip_idle), ("LookAround", 96, clip_look), ("Happy", 48, clip_happy),
         ("Talk", 96, clip_talk), ("Surprised", 48, clip_surprised), ("Sleep", 96, clip_sleep),
         ("Angry", 48, clip_angry), ("Cry", 96, clip_cry)]
SHOWREEL = ["Idle", "LookAround", "Happy", "Talk", "Surprised", "Idle"]


def sample_clip(name):
    L, fn = next((L, fn) for n, L, fn in CLIPS if n == name)
    out = []
    for f in range(L):
        d = base_pose(f)
        fn(f, d)
        out.append(d)
    return out


def write_action(ctrl, name, frames):
    """Write sampled frames into a new action on the control object (fast bulk keyframes)."""
    ad = ctrl.animation_data_create()
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    ad.action = act
    # one key at frame 1 creates every channel (and the action slot), then fill them in bulk
    chans = [("location", 2, "z"), ("rotation_euler", 0, "rx"), ("rotation_euler", 2, "rz")]
    chans += [(f'["{k}"]', -1, k) for k in frames[0] if k not in ("z", "rx", "rz")]
    for path, idx, _k in chans:
        if idx >= 0:
            ctrl.keyframe_insert(path, index=idx, frame=1)
        else:
            ctrl.keyframe_insert(path, frame=1)
    curves = {(fc.data_path, fc.array_index): fc for fc in iter_fcurves(act)}
    n = len(frames) + 1
    for path, idx, k in chans:
        fc = curves[(path, max(idx, 0))]
        vals = [fr[k] for fr in frames] + [frames[0][k]]   # last key = first, so clips loop
        if k == "z":
            vals = [FLOAT_Z + v for v in vals]
        elif k in ("rx", "rz"):
            vals = [math.radians(v) for v in vals]
        fc.keyframe_points.clear()
        fc.keyframe_points.add(n)
        co = []
        for i, v in enumerate(vals):
            co += [1 + i, v]
        fc.keyframe_points.foreach_set("co", co)
        fc.keyframe_points.foreach_set("interpolation", [2] * n)   # 2 = LINEAR (sampled every frame)
        fc.update()
    return act


def animate(ctrl, squash, rings):
    sc = bpy.context.scene
    sc.render.fps = 24
    ad = ctrl.animation_data_create()
    clip_actions = {}
    for name, L, fn in CLIPS:
        act = write_action(ctrl, name, sample_clip(name))
        clip_actions[name] = act
        tr = ad.nla_tracks.new()
        tr.name = name
        st = tr.strips.new(name, 1, act)
        tr.mute = True
    reel = []
    starts = {}
    for name in SHOWREEL:
        starts.setdefault(name, 1 + len(reel))
        reel += sample_clip(name)
    write_action(ctrl, "Showreel", reel)
    sc.frame_start, sc.frame_end = 1, len(reel)
    for k, (dv, *_r) in CONTROLS.items():
        ctrl[k] = dv
    sc.frame_set(1)
    return starts["Talk"] + TALK_DELAY

def iter_fcurves(act):
    if hasattr(act, "fcurves") and len(getattr(act, "fcurves", [])):
        yield from act.fcurves
        return
    for layer in getattr(act, "layers", []):
        for strip in layer.strips:
            for bag in strip.channelbags:
                yield from bag.fcurves


# ---------- sound ----------
TALK_ENV = None


def make_babble(path, seconds=3.2, rate=22050, seed=7):
    """Synthesize a cute robot 'babble' (chirpy syllables) and return per-frame loudness 0..1."""
    rnd = random.Random(seed)
    n = int(seconds * rate)
    buf = [0.0] * n
    t = 0.12
    while t < seconds - 0.25:
        dur = rnd.uniform(0.08, 0.22)
        f0, f1 = rnd.uniform(380, 720), rnd.uniform(380, 820)
        a, b = int(t * rate), int(min(seconds, t + dur) * rate)
        ph = 0.0
        for i in range(a, b):
            u = (i - a) / max(1, b - a)
            f = f0 + (f1 - f0) * u + 25 * math.sin(2 * math.pi * 28 * i / rate)
            ph += 2 * math.pi * f / rate
            env = math.sin(math.pi * u) ** 0.6
            # soft square-ish tone + a formant-y overtone
            v = math.tanh(2.2 * math.sin(ph)) * 0.55 + 0.25 * math.sin(2.01 * ph)
            buf[i] += 0.5 * env * v
        t += dur + (rnd.uniform(0.03, 0.07) if rnd.random() < 0.8 else rnd.uniform(0.18, 0.3))
    with wave.open(path, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(rate)
        w.writeframes(b"".join(struct.pack("<h", int(max(-1, min(1, x)) * 30000)) for x in buf))
    return loudness(buf, rate)


def loudness(samples, rate, fps=24):
    hop = rate // fps
    vals = []
    for i in range(0, len(samples), hop):
        chunk = samples[i:i + hop] or [0.0]
        vals.append(math.sqrt(sum(x * x for x in chunk) / len(chunk)))
    peak = max(vals) or 1.0
    out, prev = [], 0.0
    for v in vals:
        v = min(1.0, (v / peak) * 1.15)
        prev = v if v > prev else prev * 0.55 + v * 0.45   # fast open, softer close
        out.append(round(prev, 3))
    return out


def add_sound(path, frame):
    sc = bpy.context.scene
    se = sc.sequence_editor_create()
    coll = se.strips if hasattr(se, "strips") else se.sequences
    st = coll.new_sound("EchoBot_voice", path, 1, frame)
    try:
        st.sound.pack()
    except Exception as e:
        print("could not pack sound:", e)
    return st


TALK_HELPER = r'''"""EchoBot: make the bot talk along to YOUR audio.
1. Set AUDIO to a .wav file (16-bit PCM; convert mp3s to wav first) and START to a frame.
2. Press Run Script (Alt+P). It keyframes EchoBot["Talk"] from the loudness and adds the sound.
   Running it again replaces the previous take.
"""
import bpy, wave, struct, math, os

AUDIO = r"C:/path/to/your_voice.wav"
START = 1
GAIN = 1.2               # raise if the mouth barely opens
REPLACE_SAMPLE = True    # remove the built-in robot babble and its mouth keys

ctrl = bpy.data.objects["EchoBot"]
sc = bpy.context.scene
fps = sc.render.fps / sc.render.fps_base
path = bpy.path.abspath(AUDIO)
if not os.path.isfile(path):
    raise FileNotFoundError("Set AUDIO at the top of this script to your .wav file: " + path)
with wave.open(path) as w:
    ch, sw, rate, n = w.getnchannels(), w.getsampwidth(), w.getframerate(), w.getnframes()
    raw = w.readframes(n)
if sw != 2:
    raise ValueError("Please export your audio as a 16-bit PCM .wav")
data = struct.unpack("<%dh" % (len(raw) // 2), raw)[::ch]
hop = max(1, int(rate / fps))
vals = []
for i in range(0, len(data), hop):
    c = data[i:i + hop] or (0,)
    vals.append(math.sqrt(sum(x * x for x in c) / len(c)) / 32768)
peak = max(vals) or 1

# find the Talk curve (Blender 5 slotted actions, with a fallback for older layouts)
def talk_curve():
    act = ctrl.animation_data.action if ctrl.animation_data else None
    if not act:
        return None
    curves = list(getattr(act, "fcurves", []) or [])
    for layer in getattr(act, "layers", []):
        for strip in layer.strips:
            for bag in strip.channelbags:
                curves += list(bag.fcurves)
    return next((fc for fc in curves if fc.data_path == '["Talk"]'), None)

se = sc.sequence_editor_create()
coll = se.strips if hasattr(se, "strips") else se.sequences
fc = talk_curve()
if fc:
    for m in list(fc.modifiers):
        fc.modifiers.remove(m)            # no looping, so long clips play straight through
    if REPLACE_SAMPLE:
        fc.keyframe_points.clear()
for st in list(coll):
    if st.name.startswith("my_voice") or (REPLACE_SAMPLE and st.name.startswith("EchoBot_voice")):
        coll.remove(st)

prev = 0
for i, v in enumerate(vals):
    v = min(1.0, v / peak * GAIN)
    prev = v if v > prev else prev * 0.55 + v * 0.45
    ctrl["Talk"] = prev
    ctrl.keyframe_insert('["Talk"]', frame=START + i)
ctrl["Talk"] = 0
ctrl.keyframe_insert('["Talk"]', frame=START + len(vals) + 1)
if START > 1:
    ctrl.keyframe_insert('["Talk"]', frame=START - 1)
coll.new_sound("my_voice", path, 2, START)
if sc.frame_end < START + len(vals) + 2:
    sc.frame_end = START + len(vals) + 2
print("EchoBot talk keys added:", len(vals), "frames")
'''


# ---------- extra outputs ----------
def turntable(ctrl, frames=120):
    tt = empty("Turntable")
    ctrl.parent = tt
    sc = bpy.context.scene
    sc.frame_start, sc.frame_end = 1, frames
    tt.rotation_euler = (0, 0, 0); tt.keyframe_insert("rotation_euler", index=2, frame=1)
    tt.rotation_euler = (0, 0, math.radians(360)); tt.keyframe_insert("rotation_euler", index=2, frame=frames + 1)
    for fc in iter_fcurves(tt.animation_data.action):
        for kp in fc.keyframe_points:
            kp.interpolation = "LINEAR"


def set_pose(ctrl, pose):
    if ctrl.animation_data:
        ctrl.animation_data.action = None
    for k, (dv, *_r) in CONTROLS.items():
        ctrl[k] = dv
    if pose:
        for kv in pose.split(","):
            k, v = kv.split("=")
            ctrl[k] = float(v)


ANIM_STICKERS = [("Idle", 48), ("Happy", 48), ("Surprised", 48), ("Angry", 48), ("Talk", 96),
                 ("LookAround", 96), ("Sleep", 96), ("Cry", 96)]

STICKERS = {
    "neutral": "",
    "happy": "Happy=1,Blush=0.6",
    "sleepy": "Sleepy=1",
    "surprised": "Surprised=1,LookY=0.3",
    "talking": "Talk=0.75,RingGlow=1.4",
    "shy": "Blush=1,LookX=-0.7,LookY=-0.5",
    "side_eye": "LookX=0.9,Sleepy=0.45",
    "love": "Happy=1,Blush=1,Talk=0.2",
    "angry": "Angry=1,Hue=0.1,RingGlow=1.6",
    "crying": "Sad=1,Cry=1",
    "thinking": "LookX=0.6,LookY=0.7,Sleepy=0.25,Sad=0.2",
    "sleeping": "Blink=1,InnerGlow=0.15",
}


def ramp_color(t):
    pts = [(0.08, BODY_LOW), (0.5, BODY_MID), (0.95, BODY_TOP)]
    if t <= pts[0][0]:
        return pts[0][1]
    for (a, ca), (b, cb) in zip(pts, pts[1:]):
        if t <= b:
            k = (t - a) / (b - a)
            return tuple(x + (y - x) * k for x, y in zip(ca, cb))
    return pts[-1][1]


def bulk_action(owner, name, chans, insert):
    """chans: [(data_path, index, values)]; insert(path, index) creates each channel at frame 1."""
    ad = owner.animation_data_create()
    act = bpy.data.actions.new(name)
    ad.action = act
    for path, idx, _v in chans:
        insert(path, idx)
    curves = {(fc.data_path, fc.array_index): fc for fc in iter_fcurves(act)}
    for path, idx, vals in chans:
        fc = curves[(path, idx)]
        fc.keyframe_points.clear()
        fc.keyframe_points.add(len(vals))
        co = []
        for i, v in enumerate(vals):
            co += [1 + i, v]
        fc.keyframe_points.foreach_set("co", co)
        fc.keyframe_points.foreach_set("interpolation", [2] * len(vals))
        fc.update()
    ad.action = None
    tr = ad.nla_tracks.new()
    tr.name = name.split("|")[0]
    tr.strips.new(name, 1, act)
    return act


def export_glb(path, ctrl):
    """Bake everything the drivers do into plain keyframes, one glTF animation per clip."""
    sc = bpy.context.scene
    ob = bpy.data.objects
    O = lambda n: ob.get(n)
    xf_objs = [o for o in ob if o.name.startswith(("Squash", "EyesPivot", "Mouth", "Catchlight", "Tear",
                                                       "Blush", "EchoRing"))]
    keys = [k for k in (bpy.data.meshes.get("EyeMesh"), bpy.data.meshes.get("MouthMesh")) if k and k.shape_keys]
    ad = ctrl.animation_data
    clip_names = [n for n, *_ in CLIPS] + ["Showreel"]
    for tr in ad.nla_tracks:
        tr.mute = True
    samples = {}
    for cname in clip_names:
        act = bpy.data.actions[cname]
        ad.action = act
        f0, f1 = (int(x) for x in act.frame_range)
        rec = []
        for f in range(f0, f1 + 1):
            sc.frame_set(f)
            row = {}
            for o in xf_objs:
                if o.name.startswith("Blush"):
                    amt = min(1.0, max(ctrl["Blush"], ctrl["Happy"] * 0.8) * 1.4)
                    row[(o.name, "scale")] = tuple(v * amt for v in o.get("_base", o.scale))
                else:
                    row[(o.name, "scale")] = tuple(o.scale)
                row[(o.name, "rotation_euler")] = tuple(o.rotation_euler)
            for me in keys:
                for kb in me.shape_keys.key_blocks[1:]:
                    row[(me.name, kb.name)] = kb.value
            rec.append(row)
        samples[cname] = rec
    # drivers off: from here on everything is plain keyframes
    for o in xf_objs:
        if o.animation_data:
            for d in list(o.animation_data.drivers):
                o.animation_data.drivers.remove(d)
    for me in keys:
        if me.shape_keys.animation_data:
            for d in list(me.shape_keys.animation_data.drivers):
                me.shape_keys.animation_data.drivers.remove(d)
    # glTF exporter quirk: an object with its own transform tracks loses its shape-key tracks,
    # so the mouth's scale/rotation move onto a parent empty and the mesh keeps only Open/Frown
    mouth = O("Mouth")
    rig_of = {}
    if mouth:
        rig = bpy.data.objects.new("MouthRig", None)
        link(rig, mouth.parent)
        rig.matrix_parent_inverse = mouth.matrix_parent_inverse.copy()
        rig.location, rig.rotation_mode = mouth.location.copy(), mouth.rotation_mode
        rig.rotation_euler, rig.scale = mouth.rotation_euler.copy(), (1e-4, 1e-4, 1e-4)
        mouth.parent = rig
        mouth.matrix_parent_inverse.identity()
        mouth.location, mouth.rotation_euler, mouth.scale = (0, 0, 0), (0, 0, 0), (1, 1, 1)
        rig_of[mouth.name] = rig
    for cname, rec in samples.items():
        for src in xf_objs:
            o = rig_of.get(src.name, src)
            chans = []
            for prop in ("scale", "rotation_euler"):
                for i in range(3):
                    vals = [r[(src.name, prop)][i] for r in rec]
                    if o is not src and prop == "scale":   # a zero-scale parent breaks the child's exported transform
                        vals = [max(v, 1e-4) for v in vals]
                    chans.append((prop, i, vals))   # every clip writes every channel (clean switching)
            if chans:
                bulk_action(o, f"{cname}|{o.name}", chans, lambda p, i, o=o: o.keyframe_insert(p, index=i, frame=1))
        for me in keys:
            sk = me.shape_keys
            chans = []
            for kb in sk.key_blocks[1:]:
                vals = [r[(me.name, kb.name)] for r in rec]
                chans.append((f'key_blocks["{kb.name}"].value', 0, vals))
            bulk_action(sk, f"{cname}|{me.name}", chans,
                        lambda p, i, sk=sk: sk.key_blocks[p.split('"')[1]].keyframe_insert("value", frame=1))
    # the control object's own clips (position / sway): make sure every clip has a track
    tr = ad.nla_tracks.new(); tr.name = "Showreel"; tr.strips.new("Showreel", 1, bpy.data.actions["Showreel"])
    ad.action = None
    for o in list(ob) + [me.shape_keys for me in keys]:
        a = o.animation_data
        if a:
            a.action = None
            for t in a.nla_tracks:
                t.mute = False

    # materials: glTF only understands plain values, so swap the node tricks for simple stand-ins
    body = O("Body")
    me = body.data
    col = me.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
    dvec = Vector((-0.45, 0.25, 0.85))
    for v in me.vertices:
        t = (v.co.dot(dvec) + 1) / 2
        col.data[v.index].color = (*ramp_color(t), 1)
    bm = bpy.data.materials["EchoBot_Body"]
    nt = bm.node_tree
    b = nt.nodes["Principled BSDF"]
    for sock in ("Base Color", "Emission Strength", "Emission Color"):
        for lk in list(b.inputs[sock].links):
            nt.links.remove(lk)
    ca = nt.nodes.new("ShaderNodeVertexColor"); ca.layer_name = "Col"
    nt.links.new(ca.outputs["Color"], b.inputs["Base Color"])
    b.inputs["Emission Strength"].default_value = 0.0
    for m in bpy.data.materials:
        if m.name.startswith("Ring") or m.name == "Blush":
            mb = m.node_tree.nodes["Principled BSDF"]
            for sock in ("Alpha", "Emission Strength", "Emission Color"):
                for lk in list(mb.inputs[sock].links):
                    m.node_tree.links.remove(lk)
            if m.name == "Blush":
                mb.inputs["Alpha"].default_value = 0.55
            else:
                mb.inputs["Alpha"].default_value = 0.55
                mb.inputs["Emission Color"].default_value = (0.62, 0.36, 1.0, 1)
                mb.inputs["Emission Strength"].default_value = 1.5
    for n in ("Backdrop",):
        if O(n):
            ob.remove(O(n))
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", export_animations=True,
                              export_animation_mode="NLA_TRACKS", export_morph=True,
                              export_morph_animation=True, export_force_sampling=True,
                              export_lights=False, export_cameras=False, use_visible=False,
                              export_apply=True, export_vertex_color="MATERIAL",
                              export_optimize_animation_size=False)
    if mouth:
        clean_child_transform(path, "Mouth")


def clean_child_transform(path, name):
    """The exporter bakes MouthRig's evaluated pose into Mouth's rest transform; Mouth should sit at identity."""
    import json
    data = open(path, "rb").read()
    jlen = struct.unpack_from("<I", data, 12)[0]
    gl = json.loads(data[20:20 + jlen])
    for n in gl["nodes"]:
        if n["name"] == name:
            for k in ("translation", "rotation", "scale"):
                n.pop(k, None)
    js = json.dumps(gl, separators=(",", ":")).encode()
    js += b" " * (-len(js) % 4)
    rest = data[20 + jlen:]
    out = struct.pack("<III", 0x46546C67, 2, 12 + 8 + len(js) + len(rest)) + struct.pack("<II", len(js), 0x4E4F534A) + js + rest
    open(path, "wb").write(out)



# ---------- render ----------
def setup_bloom(s):
    """Soft glow on the bright bits (rings, catchlights) via the compositor."""
    if s.get("_bloom"):
        return
    try:
        ng = bpy.data.node_groups.new("EchoBot_Bloom", "CompositorNodeTree")
        ng.interface.new_socket("Image", in_out="OUTPUT", socket_type="NodeSocketColor")
        rl = ng.nodes.new("CompositorNodeRLayers")
        gl = ng.nodes.new("CompositorNodeGlare")
        gl.inputs["Type"].default_value = "Bloom"
        gl.inputs["Threshold"].default_value = 1.6
        gl.inputs["Strength"].default_value = 0.3
        gl.inputs["Size"].default_value = 0.55
        out = ng.nodes.new("NodeGroupOutput")
        ng.links.new(rl.outputs["Image"], gl.inputs["Image"])
        ng.links.new(gl.outputs[0], out.inputs[0])
        s.compositing_node_group = ng
        s.render.use_compositing = True
        s["_bloom"] = 1
    except Exception as e:  # older/newer API: skip bloom rather than fail
        print("bloom skipped:", e)


def setup_viewports():
    """Make the saved file open looking through the camera in Rendered mode, bloom included."""
    for scr in bpy.data.screens:
        for area in scr.areas:
            if area.type != "VIEW_3D":
                continue
            for sp in area.spaces:
                if sp.type != "VIEW_3D":
                    continue
                try:
                    sp.shading.use_compositor = "CAMERA"
                except (AttributeError, TypeError):
                    pass
                if scr.name == "Layout":
                    sp.shading.type = "RENDERED"
                    sp.region_3d.view_perspective = "CAMERA"
                    sp.overlay.show_relationship_lines = False


def engine_tune(eevee):
    """Eevee has less bounced light than Cycles: give it a more lavender world/backdrop and a
    stronger hover glow so both engines land on the same look."""
    w = bpy.context.scene.world
    if w:
        bg = w.node_tree.nodes["Background"]
        bg.inputs["Color"].default_value = (0.80, 0.74, 0.98, 1) if eevee else (0.86, 0.84, 0.95, 1)
        bg.inputs["Strength"].default_value = 0.55 if eevee else 0.35
    bd = bpy.data.materials.get("Backdrop")
    if bd:
        ramp = next(n for n in bd.node_tree.nodes if n.type == "VALTORGB")
        e = ramp.color_ramp.elements
        e[0].color = (0.96, 0.90, 1.0, 1) if eevee else (0.97, 0.93, 1.0, 1)
        e[1].color = (0.56, 0.44, 0.90, 1) if eevee else (0.62, 0.52, 0.90, 1)
    hg = bpy.data.lights.get("HoverGlow")
    if hg and hg.animation_data:
        for d in hg.animation_data.drivers:
            d.driver.expression = "hoverglow * 60" if eevee else "hoverglow * 22"
    s = bpy.context.scene
    for attr, val in (("shadow_ray_count", 2), ("shadow_step_count", 8), ("use_shadow_jitter_viewport", True)):
        try:
            setattr(s.eevee, attr, val)
        except (AttributeError, TypeError):
            pass


def setup_render(engine, samples, res):
    s = bpy.context.scene
    s.render.resolution_x = s.render.resolution_y = int(res)
    s.view_settings.view_transform = VIEW
    s.view_settings.look = LOOK
    s.view_settings.exposure = EXPOSURE
    s.cycles.device = "CPU"
    s.cycles.samples = int(samples)
    s.cycles.use_denoising = True
    setup_bloom(s)
    engine_tune(engine.upper() != "CYCLES")
    if engine.upper() == "CYCLES":
        s.render.engine = "CYCLES"
        return
    for name in ("BLENDER_EEVEE", "BLENDER_EEVEE_NEXT"):
        try:
            s.render.engine = name
            break
        except TypeError:
            continue
    for attr, val in (("use_raytracing", True), ("taa_render_samples", max(16, int(samples) // 2)),
                      ("use_shadows", True)):
        try:
            setattr(s.eevee, attr, val)
        except AttributeError:
            pass


def main():
    global TALK_ENV
    o = args()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    out_dir = os.path.dirname(os.path.abspath(o["blend"] or o["render"] or o["glb"] or
                                              (o["frames"] or o["turntable"] or os.path.join(o["stickers"] or o["anim_stickers"] or ".", "x"))))
    os.makedirs(out_dir, exist_ok=True)
    wav = os.path.join(out_dir, "echobot_babble.wav")
    TALK_ENV = make_babble(wav)
    ctrl, squash, body, eyes, rings = build_bot(o["variant"])
    build_camera()
    build_stage([ob for ob in bpy.data.objects if ob.type in {"MESH", "CURVE"}])
    talk_start = animate(ctrl, squash, rings)
    add_sound(wav, talk_start)
    txt = bpy.data.texts.new("EchoBot_talk_from_audio.py")
    txt.write(TALK_HELPER)
    setup_render(o["engine"], o["samples"], o["res"])
    if o["blend"]:
        setup_viewports()
        bpy.ops.wm.save_as_mainfile(filepath=o["blend"])
    sc = bpy.context.scene
    if o["glb"]:
        export_glb(o["glb"], ctrl)
        return
    setup_render(o["still_engine"], o["samples"], o["res"])
    if o["transparent"] == "1" or o["stickers"] or o["anim_stickers"]:
        sc.render.film_transparent = True
        bpy.data.objects["Backdrop"].hide_render = True
    if o["stickers"] or o["anim_stickers"]:
        sc.render.use_compositing = False   # bloom messes with transparent edges
        cam = sc.camera.data
        cam.lens = 90 if o["stickers"] else 100  # clips get a little room to hop
        for ob_ in bpy.data.objects:        # stickers read cleaner without the rings
            if ob_.name.startswith("EchoRing"):
                ob_.hide_render = True
        for nm in ("Rim", "Rim2"):          # softer back highlights read better on any background
            bpy.data.objects[nm].data.energy *= 0.12
        hg = bpy.data.lights.get("HoverGlow")   # with no floor the glow just lit a flat-looking cap under the body
        if hg and hg.animation_data:
            for d in hg.animation_data.drivers:
                d.driver.expression = "hoverglow * 0"
        if o["anim_stickers"]:
            ad = ctrl.animation_data
            for tr in ad.nla_tracks:
                tr.mute = True
            for name, length in ANIM_STICKERS:
                set_pose(ctrl, "")
                ad.action = bpy.data.actions[name]
                sc.frame_start, sc.frame_end = 1, length
                sc.frame_step = 2 if length > 48 else 1      # 96-frame clips play at half the frame count
                d = os.path.join(o["anim_stickers"], name.lower())
                os.makedirs(d, exist_ok=True)
                sc.render.filepath = os.path.join(d, "f_")
                bpy.ops.render.render(animation=True)
            return
        os.makedirs(o["stickers"], exist_ok=True)
        for name, pose in STICKERS.items():
            set_pose(ctrl, pose)
            sc.frame_set(1)
            sc.render.filepath = os.path.join(o["stickers"], f"echobot_{name}.png")
            bpy.ops.render.render(write_still=True)
        return
    if o["turntable"]:
        turntable(ctrl)
        sc.render.filepath = o["turntable"]
        bpy.ops.render.render(animation=True)
        return
    if o["render"]:
        if o["pose"]:
            set_pose(ctrl, o["pose"])
        sc.frame_set(int(o["frame"]))
        sc.render.filepath = o["render"]
        bpy.ops.render.render(write_still=True)
    if o["frames"]:
        sc.render.filepath = o["frames"]
        bpy.ops.render.render(animation=True)


if __name__ == "__main__":
    main()
