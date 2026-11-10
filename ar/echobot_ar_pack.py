"""Step 2 of 2: turn the layer from echobot_ar.py into two AR Quick Look files.

  EchoBot.usdz         interactive: tap EchoBot to change mood (each mood has its own sound),
                       it turns to face you, and it jumps if you come really close.
  EchoBot_simple.usdz  no interaction, just the idle loop (fallback for viewers without behaviours).

Interactivity uses Apple's "USDZ schemas for AR" (Preliminary_Behavior / _Trigger / _Action),
the same ones Reality Composer writes. Quick Look has no variables, so the tap cycle keeps its
state in which copy of the body is visible: tapping Body_k plays mood k, hides Body_k and shows
Body_k+1, so the next tap lands on the next mood.

Run (needs `pip install usd-core numpy`):
  python ar/echobot_ar_pack.py --work ar_work --sounds ar/sounds --out ar
"""
import argparse, json, os, shutil, tempfile

# Quick Look reads a `sceneName` field on the scene prim (Reality Composer writes it). usd-core doesn't
# know that field, so it is declared in a tiny plugin before pxr loads.
_plug = tempfile.mkdtemp()
json.dump({"Plugins": [{"Name": "echobot_ar_fields", "Type": "resource", "Root": ".", "LibraryPath": "",
                        "ResourcePath": ".", "Info": {"SdfMetadata": {
                            "sceneName": {"type": "string", "appliesTo": ["prims"], "default": ""}}}}]},
          open(os.path.join(_plug, "plugInfo.json"), "w"))
os.environ["PXR_PLUGINPATH_NAME"] = _plug + os.pathsep + os.environ.get("PXR_PLUGINPATH_NAME", "")
from pxr import Sdf, Usd

ap = argparse.ArgumentParser()
ap.add_argument("--work", default="ar_work")
ap.add_argument("--sounds", default="ar/sounds")
ap.add_argument("--out", default="ar")
ap.add_argument("--near_m", type=float, default=0.25, help="camera distance that makes EchoBot jump")
A = ap.parse_args()
os.makedirs(A.out, exist_ok=True)
tl = json.load(open(os.path.join(A.work, "timeline.json")))
FPS = tl["fps"]
src = Sdf.Layer.FindOrOpen(os.path.join(A.work, "EchoBot_content.usdc"))

# tap order: mood clip and the sound it plays
MOODS = [("Happy", "happy.wav"), ("Talk", "talk.wav"), ("Surprised", "surprised.wav"),
         ("LookAround", "curious.wav"), ("Sleep", "sleep.wav"), ("Angry", "angry.wav"), ("Cry", "cry.wav")]
assert len(MOODS) == tl["states"], "body copies in the blend must match the moods"

ROOT = Sdf.Path("/StageRoot")
SCENE = ROOT.AppendPath("Scenes/Scene")
LOOK = SCENE.AppendChild("EchoBot_Look")
CONTENT = LOOK.AppendChild("EchoBot")                     # = /root of the Blender layer
BOT = CONTENT.AppendPath("EchoBot_AR/EchoBot")            # animated root
BODY = lambda k: BOT.AppendPath(f"Squash/Body_{k}")
BEH = SCENE.AppendChild("Behaviors")
T = Sdf.ValueTypeNames


def base_layer(start_frame, end_frame, interactive):
    lay = Sdf.Layer.CreateAnonymous(".usda")
    lay.defaultPrim = "StageRoot"
    lay.startTimeCode, lay.endTimeCode = start_frame, end_frame
    lay.timeCodesPerSecond = lay.framesPerSecond = FPS
    lay.pseudoRoot.SetInfo("upAxis", "Y")
    lay.pseudoRoot.SetInfo("metersPerUnit", 1.0)
    lay.customLayerData = {"creator": "EchoBot AR builder", "interactive": interactive}
    Sdf.CreatePrimInLayer(lay, ROOT).specifier = Sdf.SpecifierDef
    lay.GetPrimAtPath(ROOT).typeName = "Xform"
    sc = Sdf.PrimSpec(lay.GetPrimAtPath(ROOT), "Scenes", Sdf.SpecifierDef, "Scope")
    sc.kind = "sceneLibrary"
    scene = Sdf.PrimSpec(sc, "Scene", Sdf.SpecifierDef, "Xform")
    scene.SetInfo("apiSchemas", Sdf.TokenListOp.CreateExplicit(["Preliminary_AnchoringAPI"]))
    scene.customData = {"preliminary_collidesWithEnvironment": False, "sceneName": "Scene"}
    scene.SetInfo("sceneName", "Scene")
    a = Sdf.AttributeSpec(scene, "preliminary:anchoring:type", T.Token); a.default = "plane"
    a = Sdf.AttributeSpec(scene, "preliminary:planeAnchoring:alignment", T.Token); a.default = "horizontal"
    Sdf.PrimSpec(scene, "EchoBot_Look", Sdf.SpecifierDef, "Xform")
    assert Sdf.CopySpec(src, "/root", lay, CONTENT)
    _remap_targets(lay)
    return lay


def _remap_targets(lay):
    """Make relationship / connection targets that still point at /root/... point into the copy."""
    def fix(p):
        return p.ReplacePrefix(Sdf.Path("/root"), CONTENT) if p.HasPrefix("/root") else p

    def visit(path):
        spec = lay.GetObjectAtPath(path)
        if isinstance(spec, Sdf.RelationshipSpec):
            items = list(spec.targetPathList.explicitItems) or list(spec.targetPathList.prependedItems)
            if any(p.HasPrefix("/root") for p in items):
                spec.targetPathList.ClearEdits()
                spec.targetPathList.explicitItems = [fix(p) for p in items]
        elif isinstance(spec, Sdf.AttributeSpec):
            items = list(spec.connectionPathList.explicitItems) or list(spec.connectionPathList.prependedItems)
            if any(p.HasPrefix("/root") for p in items):
                spec.connectionPathList.ClearEdits()
                spec.connectionPathList.explicitItems = [fix(p) for p in items]
    lay.Traverse(CONTENT, visit)


# ---------- behaviour writers ----------
class B:
    """Tiny helper that writes one Preliminary_Behavior with its trigger(s) and action tree."""
    n = 0

    def __init__(self, lay, name, exclusive=False):
        B.n += 1
        self.lay = lay
        self.spec = Sdf.PrimSpec(lay.GetPrimAtPath(BEH), f"{name}_{B.n}", Sdf.SpecifierDef, "Preliminary_Behavior")
        a = Sdf.AttributeSpec(self.spec, "exclusive", T.Bool, Sdf.VariabilityUniform); a.default = exclusive
        self.k = 0

    def _prim(self, typ, parent=None):
        self.k += 1
        return Sdf.PrimSpec(parent or self.spec, f"{typ[12:]}_{self.k}", Sdf.SpecifierDef, typ)

    @staticmethod
    def attr(p, name, typ, val, uniform=False):
        a = Sdf.AttributeSpec(p, name, typ, Sdf.VariabilityUniform if uniform else Sdf.VariabilityVarying)
        a.default = val

    @staticmethod
    def rel(p, name, targets):
        r = Sdf.RelationshipSpec(p, name, custom=False)
        r.targetPathList.explicitItems = targets if isinstance(targets, list) else [targets]

    def trigger(self, token, objects=None, **kw):
        t = self._prim("Preliminary_Trigger")
        if objects is not None:
            self.rel(t, "affectedObjects", objects)
        self.attr(t, "info:id", T.Token, token)
        for k, v in kw.items():
            self.attr(t, k, T.Double, v)
        return t.path

    def set(self, triggers, action):
        self.rel(self.spec, "triggers", triggers if isinstance(triggers, list) else [triggers])
        self.rel(self.spec, "actions", [action])

    # actions are built as nested specs; `parent` is the spec they live under
    def group(self, parent, kind="serial", loops=False):
        g = self._prim("Preliminary_Action", parent)
        self.attr(g, "info:id", T.Token, "Group")
        self.attr(g, "loops", T.Bool, loops)
        self.attr(g, "performCount", T.Int, 0 if loops else 1)
        self.attr(g, "type", T.Token, kind)
        return g

    def finish_group(self, g, children):
        self.rel(g, "actions", [c.path for c in children])

    def anim(self, parent, clip):
        a, b = tl["clips"][clip]
        x = self._prim("Preliminary_Action", parent)
        self.rel(x, "affectedObjects", BOT)
        self.attr(x, "info:id", T.Token, "StartAnimation")
        self.attr(x, "start", T.Double, a / FPS)
        self.attr(x, "duration", T.Double, (b - a) / FPS)
        self.attr(x, "animationSpeed", T.Double, 1.0)
        self.attr(x, "reversed", T.Bool, False)
        self.attr(x, "reverses", T.Bool, False)
        self.attr(x, "multiplePerformOperation", T.Token, "allow")
        return x

    def visibility(self, parent, objects, show):
        x = self._prim("Preliminary_Action", parent)
        self.rel(x, "affectedObjects", objects)
        self.attr(x, "duration", T.Double, 0.0)
        self.attr(x, "easeType", T.Token, "none")
        self.attr(x, "info:id", T.Token, "Visibility")
        self.attr(x, "motionType", T.Token, "none")
        self.attr(x, "moveDistance", T.Double, 0.0)
        self.attr(x, "style", T.Token, "basic")
        self.attr(x, "type", T.Token, "show" if show else "hide")
        return x

    def audio(self, parent, wav, gain=1.0):
        x = self._prim("Preliminary_Action", parent)
        self.rel(x, "affectedObjects", BOT)
        self.attr(x, "info:id", T.Token, "Audio")
        self.attr(x, "type", T.Token, "play")
        self.attr(x, "audio", T.Asset, Sdf.AssetPath("audio/" + wav))
        self.attr(x, "gain", T.Double, gain)
        self.attr(x, "auralMode", T.Token, "spatial")
        self.attr(x, "multiplePerformOperation", T.Token, "allow")
        return x

    def look_at_camera(self, parent):
        x = self._prim("Preliminary_Action", parent)
        self.rel(x, "affectedObjects", LOOK)
        self.attr(x, "duration", T.Double, 9999999999.0)
        self.attr(x, "info:id", T.Token, "LookAtCamera")
        self.attr(x, "front", T.Vector3d, (0, 0, 1))
        self.attr(x, "upVector", T.Vector3d, (0, 1, 0))     # turn around the vertical axis only
        return x

    def mood_then_idle(self, clip, wav):
        """parallel: sound + (mood clip, then idle forever). Returns the outer group and its child list."""
        outer = self.group(self.spec, "parallel")
        kids = []
        if wav:
            kids.append(self.audio(outer, wav))
        seq = self.group(outer, "serial")
        loop = self.group(seq, "serial", loops=True)
        self.finish_group(loop, [self.anim(loop, "Idle")])
        self.finish_group(seq, [self.anim(seq, clip), loop])
        kids.append(seq)
        return outer, kids


def interactive_layer():
    lay = base_layer(0, tl["frames"], True)
    Sdf.PrimSpec(lay.GetPrimAtPath(SCENE), "Behaviors", Sdf.SpecifierDef, "Scope")
    n = len(MOODS)

    # start: hide the spare bodies, loop the idle clip, keep facing the viewer
    b = B(lay, "HideSpareBodies")
    b.set(_start(b), b.visibility(b.spec, [BODY(k) for k in range(1, n)], False).path)
    b = B(lay, "IdleOnStart", exclusive=True)
    loop = b.group(b.spec, "serial", loops=True)
    b.finish_group(loop, [b.anim(loop, "Idle")])
    b.set(_start(b), loop.path)
    b = B(lay, "FaceTheViewer")
    b.set(_start(b), b.look_at_camera(b.spec).path)

    # tap cycle
    for k, (clip, wav) in enumerate(MOODS):
        b = B(lay, f"Tap_{clip}", exclusive=True)
        outer, kids = b.mood_then_idle(clip, wav)
        kids = [b.visibility(outer, BODY(k), False), b.visibility(outer, BODY((k + 1) % n), True)] + kids
        b.finish_group(outer, kids)
        b.set(b.trigger("TapGesture", BODY(k)), outer.path)

    # walk up really close: surprised jump
    b = B(lay, "TooClose", exclusive=True)
    outer, kids = b.mood_then_idle("Surprised", "surprised.wav")
    b.finish_group(outer, kids)
    b.set(b.trigger("ProximityToCamera", [BODY(k) for k in range(n)], distance=A.near_m), outer.path)
    return lay


def _start(b):
    t = b._prim("Preliminary_Trigger")
    b.attr(t, "info:id", T.Token, "SceneTransition")
    b.attr(t, "type", T.Token, "enter")
    return t.path


def package(lay, usdz, extra):
    tmp = tempfile.mkdtemp()
    main = os.path.join(tmp, "EchoBot.usdc")
    lay.Export(main)
    if os.path.exists(usdz):
        os.remove(usdz)
    w = Sdf.ZipFileWriter.CreateNew(usdz)
    w.AddFile(main, "EchoBot.usdc")
    for arc, path in extra:
        w.AddFile(path, arc)
    w.Save()
    shutil.rmtree(tmp)
    print("wrote", usdz, os.path.getsize(usdz))


tex = [("textures/" + f, os.path.join(A.work, "textures", f)) for f in sorted(os.listdir(os.path.join(A.work, "textures")))]
sounds = [("audio/" + w, os.path.join(A.sounds, w)) for w in sorted({w for _, w in MOODS} | {"surprised.wav"})]

package(interactive_layer(), os.path.join(A.out, "EchoBot.usdz"), tex + sounds)
simple = base_layer(*tl["clips"]["Idle"], False)          # Quick Look loops the whole (short) timeline
for k in range(1, len(MOODS)):                              # the spare bodies are only tap targets
    del simple.GetPrimAtPath(BODY(k).GetParentPath()).nameChildren[f"Body_{k}"]
package(simple, os.path.join(A.out, "EchoBot_simple.usdz"), tex)

