"""Build EchoBot for AR on iPhone / iPad (AR Quick Look), from EchoBot_web.glb (Blender 5.2).

Step 1 of 2 (this file, inside Blender): bake every mood clip onto one timeline that uses only
plain transform animation, then export a USD layer.
Step 2 of 2 (echobot_ar_pack.py, plain Python with usd-core): wrap that layer with the
tap / sound / face-you behaviours and zip the two .usdz files.

Why transform-only: AR Quick Look misplaces meshes that carry blend shapes (it turns them into
skinned meshes), and EchoBot's right eye is mirrored with a negative scale, which it also handles
badly. So each eye / mouth expression becomes its own small mesh, and the timeline shows one of
them at a time by scaling the others to almost nothing.

Run:  blender -b -P ar/echobot_ar.py -- --glb EchoBot_web.glb --out ar_work --width_cm 22
"""
import bpy, bmesh, math, os, sys, json
from mathutils import Matrix, Vector, Quaternion
from bpy_extras import anim_utils

args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
opt = {"glb": "EchoBot_web.glb", "out": "ar_work", "width_cm": "22"}
for i in range(0, len(args) - 1, 2):
    opt[args[i].lstrip("-")] = args[i + 1]
OUT = os.path.abspath(opt["out"]); os.makedirs(OUT, exist_ok=True)

# order of the clips on the shared timeline. Idle first: the simple .usdz just loops it.
CLIPS = ["Idle", "Happy", "Talk", "Surprised", "LookAround", "Sleep", "Angry", "Cry"]
HIDDEN = 1e-4          # scale used to hide an expression mesh (0 can upset some viewers)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=os.path.abspath(opt["glb"]))
sc = bpy.context.scene
sc.render.fps = 24
for o in list(bpy.data.objects):
    if o.name == "LookTarget":
        bpy.data.objects.remove(o)

objs = list(bpy.data.objects)
shape_objs = [o for o in objs if o.type == "MESH" and o.data.shape_keys]
# rest pose straight from the file (nothing has been evaluated yet)
rest = {o.name: (o.location.copy(), o.rotation_quaternion.copy() if o.rotation_mode == "QUATERNION"
                 else o.rotation_euler.to_quaternion(), o.scale.copy()) for o in objs}
for o in objs:
    o.rotation_mode = "QUATERNION"


def clear_anim(idb):
    ad = idb.animation_data
    if ad:
        for tr in list(ad.nla_tracks):
            ad.nla_tracks.remove(tr)
        ad.action = None


def use_clip(name):
    act = bpy.data.actions[name]
    for o in objs:
        clear_anim(o)
        loc, rot, scl = rest[o.name]
        o.location, o.rotation_quaternion, o.scale = loc, rot, scl
        slot = next((s for s in act.slots if s.target_id_type == "OBJECT" and s.name_display == o.name), None)
        if slot:
            ad = o.animation_data_create(); ad.action = act; ad.action_slot = slot
    for o in shape_objs:
        key = o.data.shape_keys
        clear_anim(key)
        for kb in key.key_blocks[1:]:
            kb.value = 0.0
        slot = next((s for s in act.slots if s.target_id_type == "KEY" and s.name_display == o.name), None)
        if slot:
            ad = key.animation_data_create(); ad.action = act; ad.action_slot = slot
    return act


# ---------- 1. sample every clip, frame by frame ----------
samples = {o.name: [] for o in objs}            # per frame: (loc, quat, scale)
weights = {o.name: [] for o in shape_objs}      # per frame: [w per key]
timeline = []                                    # (clip, first frame, last frame) on the new timeline
frame = 1
for clip in CLIPS:
    act = use_clip(clip)
    f0, f1 = int(act.frame_range[0]), int(act.frame_range[1])
    timeline.append((clip, frame, frame + (f1 - f0)))
    for f in range(f0, f1 + 1):
        sc.frame_set(f)
        for o in objs:
            loc, rot, scl = o.matrix_basis.decompose()
            samples[o.name].append((loc, rot, scl))
        for o in shape_objs:
            weights[o.name].append([kb.value for kb in o.data.shape_keys.key_blocks[1:]])
    frame += (f1 - f0) + 1 + 2                   # two spare frames between clips
    for o in objs:                               # pad the gap by holding the last pose
        samples[o.name] += [samples[o.name][-1]] * 2
    for o in shape_objs:
        weights[o.name] += [weights[o.name][-1]] * 2
NFR = len(samples[objs[0].name])
for o in objs:
    clear_anim(o)
for o in shape_objs:
    clear_anim(o.data.shape_keys)
for a in list(bpy.data.actions):
    bpy.data.actions.remove(a)
sc.frame_set(1)

# ---------- 2. expressions become separate meshes ----------
def flip_mesh(me):
    for v in me.vertices:
        v.co = -v.co
    bm = bmesh.new(); bm.from_mesh(me)
    bmesh.ops.reverse_faces(bm, faces=bm.faces)
    bm.to_mesh(me); bm.free()


variants = {}      # holder name -> list of (variant object, key index or -1 for basis)
for o in shape_objs:
    loc, rot, scl = rest[o.name]
    flip = scl.x < 0 and scl.y < 0 and scl.z < 0        # point mirror (the right eye)
    holder = bpy.data.objects.new(o.name + "_tmp", None)
    sc.collection.objects.link(holder)
    holder.parent = o.parent
    holder.matrix_parent_inverse = o.matrix_parent_inverse.copy()
    holder.rotation_mode = "QUATERNION"
    holder.location, holder.rotation_quaternion = loc, rot
    holder.scale = Vector((abs(scl.x), abs(scl.y), abs(scl.z)))
    for ch in list(o.children):                         # catchlights: keep their pose on the new holder
        mpi = ch.matrix_parent_inverse.copy()
        ch.parent = holder
        ch.matrix_parent_inverse = mpi
        if flip:                                         # a sphere is unchanged by the point mirror
            ch.location = -ch.location
            samples[ch.name] = [(-l, r, s) for (l, r, s) in samples[ch.name]]
    kbs = o.data.shape_keys.key_blocks
    lst = []
    for ki, kb in enumerate(kbs):
        me = o.data.copy(); me.name = f"{o.name}_{kb.name}"
        v = bpy.data.objects.new(f"{o.name}_{kb.name}", me)
        sc.collection.objects.link(v)
        v.shape_key_clear()
        co = [0.0] * (len(me.vertices) * 3)
        kb.data.foreach_get("co", co)
        me.vertices.foreach_set("co", co)
        me.update()
        if flip:
            flip_mesh(me)
        v.parent = holder
        v.rotation_mode = "QUATERNION"
        lst.append((v, ki - 1))
    name = o.name
    bpy.data.objects.remove(o)
    holder.name = name
    variants[name] = lst


def pick(ws, name):
    """Which expression mesh shows on this frame: the strongest key at 0.5 or more, else the rest shape."""
    best = max(range(len(ws)), key=lambda i: ws[i])
    return best if ws[best] >= 0.5 else -1


# ---------- 3. write the new timeline ----------
def write_anim(idb, slot_type, channels, interp="LINEAR"):
    """channels: list of (data_path, index, [values per frame])."""
    act = bpy.data.actions.new(idb.name + "_AR")
    slot = act.slots.new(slot_type, idb.name)
    ad = idb.animation_data_create(); ad.action = act; ad.action_slot = slot
    bag = anim_utils.action_ensure_channelbag_for_slot(act, slot)
    for path, idx, vals in channels:
        fc = bag.fcurves.new(path, index=idx)
        fc.keyframe_points.add(len(vals))
        co = []
        for f, v in enumerate(vals):
            co += [f + 1, v]
        fc.keyframe_points.foreach_set("co", co)
        for kp in fc.keyframe_points:
            kp.interpolation = interp
        fc.update()


def changes(vals, eps=1e-5):
    return max(vals) - min(vals) > eps


for o in list(bpy.data.objects):
    if o.name not in samples:
        continue
    seq = samples[o.name]
    q_prev = None; quats = []
    for (_, q, _) in seq:                        # keep quaternions on one hemisphere for smooth blends
        q = q.copy()
        if q_prev is not None and q.dot(q_prev) < 0:
            q.negate()
        quats.append(q); q_prev = q
    ch = []
    for i in range(3):
        ch.append(("location", i, [s[0][i] for s in seq]))
        ch.append(("scale", i, [s[2][i] for s in seq]))
    for i in range(4):
        ch.append(("rotation_quaternion", i, [q[i] for q in quats]))
    if any(changes(v) for _, _, v in ch):
        o.location, o.rotation_quaternion, o.scale = seq[0][0], quats[0], seq[0][2]
        write_anim(o, "OBJECT", ch)

vis_log = {}
for name, lst in variants.items():
    picks = [pick(ws, name) for ws in weights[name]]
    vis_log[name] = picks
    for v, ki in lst:
        vals = [1.0 if p == ki else HIDDEN for p in picks]
        v.scale = (vals[0],) * 3
        if changes(vals):
            write_anim(v, "OBJECT", [("scale", i, vals) for i in range(3)], "CONSTANT")

sc.frame_start, sc.frame_end = 1, NFR

# ---------- 4. body: colour gradient baked to a texture (AR viewers ignore vertex colours) ----------
body = bpy.data.objects["Body"]
me = body.data
bpy.ops.object.select_all(action="DESELECT")
body.select_set(True); bpy.context.view_layer.objects.active = body
uvl = me.uv_layers.new(name="UVMap"); me.uv_layers.active = uvl
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.01)   # no poles, no dark dot on top
bpy.ops.object.mode_set(mode="OBJECT")

img = bpy.data.images.new("EchoBot_body", 1024, 1024)
mat = me.materials[0]
nt = mat.node_tree
for n in list(nt.nodes):
    nt.nodes.remove(n)
outn = nt.nodes.new("ShaderNodeOutputMaterial")
em = nt.nodes.new("ShaderNodeEmission")
ca = nt.nodes.new("ShaderNodeVertexColor"); ca.layer_name = "Color"
tex = nt.nodes.new("ShaderNodeTexImage"); tex.image = img
nt.links.new(ca.outputs["Color"], em.inputs["Color"])
nt.links.new(em.outputs["Emission"], outn.inputs["Surface"])
nt.nodes.active = tex
sc.render.engine = "CYCLES"; sc.cycles.samples = 4; sc.cycles.device = "CPU"
sc.render.bake.margin = 16
bpy.ops.object.bake(type="EMIT")
img.filepath_raw = os.path.join(OUT, "EchoBot_body.png"); img.file_format = "PNG"; img.save()
for n in list(nt.nodes):
    if n not in (outn, tex):
        nt.nodes.remove(n)
bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
bsdf.inputs["Roughness"].default_value = 0.28
bsdf.inputs["Coat Weight"].default_value = 0.5
nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
nt.links.new(tex.outputs["Color"], bsdf.inputs["Emission Color"])
bsdf.inputs["Emission Strength"].default_value = 0.15
nt.links.new(bsdf.outputs["BSDF"], outn.inputs["Surface"])
# drop the vertex colours: the texture has them now
for a in list(me.color_attributes):
    me.color_attributes.remove(a)


def simple_mat(m, color, emit=0.0, alpha=1.0, rough=0.4):
    m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    for l in list(b.inputs["Base Color"].links) + list(b.inputs["Alpha"].links):
        m.node_tree.links.remove(l)
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Emission Color"].default_value = (*color, 1)
    b.inputs["Emission Strength"].default_value = emit
    b.inputs["Alpha"].default_value = alpha
    b.inputs["Roughness"].default_value = rough


for o in bpy.data.objects:
    if o.name.startswith("EchoRing"):
        simple_mat(o.data.materials[0], (0.62, 0.42, 1.0), emit=1.5, alpha=0.55)
    elif o.name.startswith("Blush"):
        simple_mat(o.data.materials[0], (1.0, 0.35, 0.65), emit=0.4, alpha=0.55, rough=0.5)

# ---------- 5. tap targets: one copy of the body per mood step (the packer shows one at a time) ----------
n_states = int(opt.get("states", "7"))
for k in range(1, n_states):
    c = body.copy()                               # shares the mesh; the USD export writes each copy
    c.name = f"Body_{k}"
    sc.collection.objects.link(c)
    c.parent = body.parent
body.name = "Body_0"

# ---------- 6. size and placement ----------
root = bpy.data.objects["EchoBot"]
holder = bpy.data.objects.new("EchoBot_AR", None)
sc.collection.objects.link(holder)
root.parent = holder
width_m = float(opt["width_cm"]) / 100
s = width_m / body.dimensions.x
holder.scale = (s, s, s)
holder.location.z = -(1.7 - 1.47 - 0.02) * s     # rings just clear the floor; the body hovers above it

usd = os.path.join(OUT, "EchoBot_content.usdc")
bpy.ops.wm.usd_export(filepath=usd, export_animation=True, export_materials=True, export_uvmaps=True,
                      export_normals=True, generate_preview_surface=True, export_textures_mode="NEW",
                      export_shapekeys=False, export_armatures=False,
                      convert_orientation=True, export_global_forward_selection="NEGATIVE_Z",
                      export_global_up_selection="Y")
json.dump({"fps": 24, "frames": NFR, "states": n_states,
           "clips": {c: [a, b] for c, a, b in timeline}},
          open(os.path.join(OUT, "timeline.json"), "w"), indent=1)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "EchoBot_AR.blend"))
print("wrote", usd, os.path.getsize(usd), "frames", NFR, timeline)
