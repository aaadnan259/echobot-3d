"""Make EchoBot.usdz for AR (iPhone / iPad AR Quick Look) from EchoBot_web.glb (Blender 5.2).

AR viewers don't read vertex colours, so the body's colour gradient is baked into a texture first.
EchoBot hovers a few centimetres above whatever surface you place it on, playing its idle loop.

Run:  blender -b -P ar/echobot_ar.py -- --glb EchoBot_web.glb --out ar --width_cm 22
"""
import bpy, bmesh, math, os, sys

args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
opt = {"glb": "EchoBot_web.glb", "out": "ar", "width_cm": "22"}
for i in range(0, len(args) - 1, 2):
    opt[args[i].lstrip("-")] = args[i + 1]
OUT = os.path.abspath(opt["out"]); os.makedirs(OUT, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=os.path.abspath(opt["glb"]))
sc = bpy.context.scene

# drop the bits that are invisible at rest (tears, blush, mouth) and the look target helper
for o in list(bpy.data.objects):
    if o.name.startswith(("Tear", "Blush", "LookTarget")) or o.name == "Mouth":
        bpy.data.objects.remove(o)

# play the Idle loop on every animated object
idle = bpy.data.actions["Idle"]
for o in bpy.data.objects:
    ad = o.animation_data
    if not ad:
        continue
    for tr in list(ad.nla_tracks):
        ad.nla_tracks.remove(tr)
    ad.action = idle
    slot = next((s for s in idle.slots if s.target_id_type == "OBJECT" and s.name_display == o.name), None)
    if slot:
        ad.action_slot = slot
    else:
        ad.action = None
fr = idle.frame_range
sc.frame_start, sc.frame_end = int(fr[0]), int(fr[1])
sc.render.fps = 24

# ---------- bake the body gradient (vertex colours) into a texture ----------
body = bpy.data.objects["Body"]
me = body.data
bm = bmesh.new(); bm.from_mesh(me)
uv = bm.loops.layers.uv.new("UVMap")
for f in bm.faces:
    us = []
    for l in f.loops:
        p = l.vert.co.normalized()
        us.append(0.5 + math.atan2(p.y, p.x) / (2 * math.pi))
    wrap = max(us) - min(us) > 0.5            # face straddles the seam: keep it on one side
    for l, u in zip(f.loops, us):
        p = l.vert.co.normalized()
        l[uv].uv = ((u + 1.0) if (wrap and u < 0.5) else u, 0.5 + math.asin(max(-1, min(1, p.z))) / math.pi)
bm.to_mesh(me); bm.free()

img = bpy.data.images.new("EchoBot_body", 1024, 512)
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
bpy.ops.object.select_all(action="DESELECT")
body.select_set(True); bpy.context.view_layer.objects.active = body
sc.render.bake.margin = 8
bpy.ops.object.bake(type="EMIT")
img.filepath_raw = os.path.join(OUT, "EchoBot_body.png"); img.file_format = "PNG"; img.save()

# final body material: the baked colours on a glossy surface
for n in list(nt.nodes):
    if n not in (outn, tex):
        nt.nodes.remove(n)
bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
bsdf.inputs["Roughness"].default_value = 0.28
bsdf.inputs["Coat Weight"].default_value = 0.5
nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
nt.links.new(tex.outputs["Color"], bsdf.inputs["Emission Color"])
bsdf.inputs["Emission Strength"].default_value = 0.15     # a little inner glow
nt.links.new(bsdf.outputs["BSDF"], outn.inputs["Surface"])

# rings: soft glowing violet, half see-through
for o in bpy.data.objects:
    if o.name.startswith("EchoRing"):
        m = o.data.materials[0]
        b = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
        b.inputs["Base Color"].default_value = (0.62, 0.42, 1.0, 1)
        b.inputs["Emission Color"].default_value = (0.62, 0.42, 1.0, 1)
        b.inputs["Emission Strength"].default_value = 1.5
        b.inputs["Alpha"].default_value = 0.55

# ---------- size and placement: hover a little above the surface ----------
root = bpy.data.objects["EchoBot"]
holder = bpy.data.objects.new("EchoBot_AR", None)
sc.collection.objects.link(holder)
root.parent = holder
width_m = float(opt["width_cm"]) / 100
s = width_m / body.dimensions.x
holder.scale = (s, s, s)
holder.location.z = -(1.7 - 1.47 - 0.02) * s         # rings just clear the floor; the body hovers above it

usdz = os.path.join(OUT, "EchoBot.usdz")
bpy.ops.wm.usd_export(filepath=usdz, export_animation=True, export_materials=True, export_uvmaps=True,
                      export_normals=True, generate_preview_surface=True, export_textures_mode="NEW",
                      convert_orientation=True, export_global_forward_selection="NEGATIVE_Z", export_global_up_selection="Y")
print("wrote", usdz, os.path.getsize(usdz))
