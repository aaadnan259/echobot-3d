"""EchoBot 3D print builder (Blender 5.2).

Makes print-ready STL files in millimetres:
  EchoBot_figure.stl  the body, with a flat base so it stands without supports and two
                      1 mm deep eye pockets (paint them, or glue in the eye pieces)
  EchoBot_eyes.stl    two pill-shaped eye pieces to print in black and glue into the pockets
                      (0.15 mm smaller all round so they press in)

Run headless:  blender -b -P echobot_print.py -- --out <folder> --size 60
(--size is the body width in mm; everything scales with it.)
"""
import bpy, bmesh, math, os, sys
from mathutils import Vector, Matrix

args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
opt = {"out": ".", "size": "60"}
for i in range(0, len(args) - 1, 2):
    opt[args[i].lstrip("-")] = args[i + 1]
OUT = os.path.abspath(opt["out"])
WIDTH_MM = float(opt["size"])

BODY_SCALE = Vector((1.04, 1.0, 0.96))        # same friendly squash as the animated model
MM = WIDTH_MM / (2 * BODY_SCALE.x)            # model units -> mm
BASE_CUT = 0.86                               # cut the bottom off at 86% of the radius: a flat, stable base
EYE_W, EYE_H = 0.21, 0.33                     # pill eye size (model units), as on the mascot
EYE_X, EYE_Z = 0.278, 0.13                    # eye centres (left/right, up), facing -Y; a bit higher than
                                              # on the floating mascot, since the base trims the bottom
POCKET_MM, CLEAR_MM, INSERT_MM = 1.0, 0.15, 1.0

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
sc.unit_settings.system = "METRIC"
sc.unit_settings.scale_length = 0.001
sc.unit_settings.length_unit = "MILLIMETERS"


def obj_from_bm(name, bm):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    o = bpy.data.objects.new(name, me)
    sc.collection.objects.link(o)
    return o


def body():
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=160, v_segments=80, radius=1.0)
    for v in bm.verts:
        v.co = Vector((v.co.x * BODY_SCALE.x, v.co.y * BODY_SCALE.y, v.co.z * BODY_SCALE.z)) * MM
    o = obj_from_bm("EchoBot_figure", bm)
    for p in o.data.polygons:
        p.use_smooth = True
    return o


def stadium(w, h, n=24):
    """2D outline of a vertical pill: two half circles joined by straight sides."""
    r = w / 2
    straight = max(0.0, h / 2 - r)
    pts = []
    for i in range(n + 1):                      # top arc
        a = math.pi * i / n
        pts.append((r * math.cos(a), straight + r * math.sin(a)))
    for i in range(n + 1):                      # bottom arc
        a = math.pi + math.pi * i / n
        pts.append((r * math.cos(a), -straight + r * math.sin(a)))
    return pts


def eye_frame(side):
    """Point on the body surface at the eye centre, and the outward surface normal there."""
    d = Vector((side * EYE_X, -1.0, EYE_Z))
    # walk along the direction until we hit the ellipsoid surface
    k = 1.0 / math.sqrt((d.x / BODY_SCALE.x) ** 2 + (d.y / BODY_SCALE.y) ** 2 + (d.z / BODY_SCALE.z) ** 2)
    p = d * k
    n = Vector((p.x / BODY_SCALE.x ** 2, p.y / BODY_SCALE.y ** 2, p.z / BODY_SCALE.z ** 2)).normalized()
    return p * MM, n


def prism(name, outline, center, normal, depth_in, height_out):
    """Extrude a 2D outline along the normal: from depth_in below the surface point to height_out above."""
    z = normal
    x = Vector((1, 0, 0)) - z * z.x
    x.normalize()
    y = z.cross(x)
    bm = bmesh.new()
    bot = [bm.verts.new(center + x * px + y * py - z * depth_in) for px, py in outline]
    top = [bm.verts.new(center + x * px + y * py + z * height_out) for px, py in outline]
    bm.faces.new(list(reversed(bot)))
    bm.faces.new(top)
    m = len(outline)
    for i in range(m):
        j = (i + 1) % m
        bm.faces.new((bot[i], bot[j], top[j], top[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return obj_from_bm(name, bm)


def boolean(target, cutter, op="DIFFERENCE"):
    m = target.modifiers.new("b", "BOOLEAN")
    m.operation, m.solver, m.object = op, "EXACT", cutter
    bpy.context.view_layer.objects.active = target
    bpy.ops.object.modifier_apply(modifier=m.name)
    bpy.data.objects.remove(cutter)


def check(o):
    bm = bmesh.new()
    bm.from_mesh(o.data)
    bad = sum(1 for e in bm.edges if not e.is_manifold)
    vol = bm.calc_volume()
    bm.free()
    return bad, vol


def export(objs, path):
    bpy.ops.object.select_all(action="DESELECT")
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.wm.stl_export(filepath=path, export_selected_objects=True, apply_modifiers=True, global_scale=1.0)


os.makedirs(OUT, exist_ok=True)
fig = body()

# flat base: slice off the bottom with a big box
zc = -BASE_CUT * BODY_SCALE.z * MM
bm = bmesh.new()
bmesh.ops.create_cube(bm, size=4 * WIDTH_MM)
for v in bm.verts:
    v.co.z += zc - 2 * WIDTH_MM
boolean(fig, obj_from_bm("cut", bm))

# eye pockets, and eye pieces that fit them
eyes = []
for side in (-1, 1):
    p, n = eye_frame(side)
    outline = [(x * MM, y * MM) for x, y in stadium(EYE_W, EYE_H)]
    boolean(fig, prism("pocket", outline, p, n, POCKET_MM, 3.0))
    shrink = [(x * (1 - 2 * CLEAR_MM / (EYE_W * MM)), y * (1 - 2 * CLEAR_MM / (EYE_H * MM))) for x, y in outline]
    eyes.append(prism(f"eye_{'L' if side < 0 else 'R'}", shrink, p, n, POCKET_MM, INSERT_MM - POCKET_MM))

# keep a copy of the eye pieces sitting in their pockets, for previews (not exported)
for e in eyes:
    c = e.copy(); c.data = e.data.copy(); c.name = e.name + "_in_place"
    c.data.transform(Matrix.Translation((0, 0, -zc)))
    sc.collection.objects.link(c); c.hide_render = True

# stand it on z = 0 and lay the eye pieces flat beside it, ready for the slicer
fig.location.z = -zc
bpy.context.view_layer.update()
fig.data.transform(Matrix.Translation(fig.location)); fig.location = (0, 0, 0)
for i, e in enumerate(eyes):
    me = e.data
    p, n = eye_frame(-1 if i == 0 else 1)
    rot = n.to_track_quat("Z", "Y").to_matrix().to_4x4().inverted()
    me.transform(Matrix.Translation(-p))
    me.transform(rot)
    zs = [v.co.z for v in me.vertices]
    me.transform(Matrix.Translation((WIDTH_MM * 0.75 + i * EYE_W * MM * 1.8, 0, -min(zs))))

for o in [fig] + eyes:
    bad, vol = check(o)
    cs = [v.co for v in o.data.vertices]
    dims = [max(c[i] for c in cs) - min(c[i] for c in cs) for i in range(3)]
    print(f"{o.name}: non-manifold edges {bad}, volume {vol / 1000:.2f} cm3, size "
          f"{dims[0]:.1f} x {dims[1]:.1f} x {dims[2]:.1f} mm")
export([fig], os.path.join(OUT, "EchoBot_figure.stl"))
export(eyes, os.path.join(OUT, "EchoBot_eyes.stl"))
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, "EchoBot_print.blend"))
print("done", OUT)
