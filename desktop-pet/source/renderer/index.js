// The EchoBot you see: loads the 3D model, plays its moods, squishes when it lands, leans when it moves,
// follows your cursor with its eyes, reacts to petting, music, typing and the battery, wears its hats,
// and talks in a speech bubble (optionally out loud).
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { Wardrobe } from "./accessories.js";
import { fx } from "./fx.js";
import { Ears } from "./audio.js";

// collect errors so automated checks (and anyone debugging) can see them
window.__errs = [];
addEventListener("error", (e) => window.__errs.push(String(e.message)));
addEventListener("unhandledrejection", (e) => window.__errs.push(String(e.reason)));

const pet = window.pet || { onTick() {}, onPlay() {}, onSay() {}, onConfig() {}, onLand() {}, onFx() {}, clickThrough() {}, dragStart() {}, dragEnd() {}, menu() {}, event() {} };
const bubble = document.getElementById("bubble");

// ---------- scene ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setClearColor(0, 0);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(26, 1, 0.1, 100);
// EchoBot sits in the lower part of its window, leaving room above for hats, bubbles and hops.
camera.position.set(0, 2.3, 9.4);
camera.lookAt(0, 2.05, 0);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = (() => {
  const s = new THREE.Scene();
  s.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, uniforms: { top: { value: new THREE.Color(0xffffff) }, bottom: { value: new THREE.Color(0x9c87e0) } },
    vertexShader: "varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: "uniform vec3 top; uniform vec3 bottom; varying vec3 vP; void main(){ gl_FragColor = vec4(mix(bottom, top, smoothstep(-0.7, 0.9, vP.y)), 1.0); }",
  })));
  const panel = (w, h, pos, k) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(k, k, k) })); m.position.set(...pos); m.lookAt(0, 0, 0); s.add(m); };
  panel(5, 3.5, [-5, 6, 5], 3.2); panel(3, 5, [6, 3, -4], 1.8);
  return pmrem.fromScene(s, 0.03).texture;
})();
scene.environmentIntensity = 0.75;
const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(-3.5, 5.5, 4); scene.add(key);
const rim = new THREE.DirectionalLight(0xc9b4ff, 1.6); rim.position.set(3, 3.5, -3.5); scene.add(rim);
scene.add(new THREE.HemisphereLight(0xf2eeff, 0x9a86d8, 0.9));

// ---------- state ----------
let cfg = { colour: { hue: 0 }, hat: "none", outfit: "none", chattiness: 1, pers: { chatter: 1, moods: 1 }, sound: "off", typing: true, battery: true, quiet: false };
let model, mixer, idle, current = null, eyesPivot, bodyMesh, squashNode, bounce, wardrobe;
const actions = {}, rings = [], eyeMeshes = [], blush = [];
let mouth = null, bodyUniforms = null;
let sleeping = false, danceStart = -1, stretchStart = -1, spinStart = -1, waveStart = -1;
let lastActive = performance.now(), nextIdle = performance.now() + 60000;
let tick = { x: -1, y: -1, w: 230, h: 230, vx: 0, vy: 0, state: "ground", peek: null, typing: 0 };
const look = new THREE.Vector2(), lookTarget = new THREE.Vector2();
let squash = 0, squashV = 0, lean = 0, hoverOver = false, speaking = 0, sleepyBase = 0, happyBase = 0, glowMul = 1;
const ears = new Ears();

// ---------- load the model ----------
const glb = Uint8Array.from(atob(window.ECHOBOT_GLB), (c) => c.charCodeAt(0));
new GLTFLoader().parse(glb.buffer, "", (gltf) => {
  model = gltf.scene;
  scene.add(model);
  model.traverse((o) => {
    if (!o.isMesh) return;
    if (o.name === "Body") {
      bodyMesh = o;
      const old = o.material;
      const m = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.3, clearcoat: 0.55, clearcoatRoughness: 0.08, sheen: 0.25, sheenColor: new THREE.Color(0xd8c4ff) });
      m.onBeforeCompile = (sh) => {
        sh.uniforms.rimColor = { value: new THREE.Color(0xb995ff) };
        sh.uniforms.hueShift = { value: THREE.MathUtils.degToRad(cfg.colour?.hue || 0) };
        sh.uniforms.glowMul = { value: 1 };
        bodyUniforms = sh.uniforms;
        sh.fragmentShader = "uniform vec3 rimColor; uniform float hueShift; uniform float glowMul;\n"
          + "vec3 hueRot(vec3 c, float a) { const vec3 k = vec3(0.57735); float ca = cos(a); return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca); }\n"
          + sh.fragmentShader
            .replace("#include <color_fragment>", "#include <color_fragment>\n diffuseColor.rgb = max(hueRot(diffuseColor.rgb, hueShift), 0.0);")
            .replace("#include <emissivemap_fragment>", `#include <emissivemap_fragment>
              float facing = clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
              vec3 rc = hueRot(rimColor, hueShift) * glowMul;
              totalEmissiveRadiance += rc * pow(1.0 - facing, 3.0) * 0.9;
              totalEmissiveRadiance += rc * pow(facing, 3.0) * 0.18;`);
      };
      o.material = m; old.dispose();
    }
    if (o.name.startsWith("EchoRing")) {
      o.material = o.material.clone();
      o.material.transparent = true; o.material.depthWrite = false;
      o.material.emissive = new THREE.Color(0x8f5bff); o.material.emissiveIntensity = 2.2;
      o.userData.baseColor = o.material.color.clone();
      rings.push(o);
    }
    if (o.morphTargetDictionary && o.morphTargetDictionary.Blink !== undefined) eyeMeshes.push(o);
    if (o.morphTargetDictionary && o.morphTargetDictionary.Open !== undefined) mouth = o;
  });
  eyesPivot = model.getObjectByName("EyesPivot");
  squashNode = model.getObjectByName("Squash");
  for (const n of ["Blush.L", "Blush.R"]) { const b = model.getObjectByName(n); if (b) blush.push(b); }
  // Put our own "bounce" group between the bot and its animated Squash node, so landing squish and music
  // bobbing add on top of the built-in animations instead of fighting them.
  const root = model.getObjectByName("EchoBot");
  bounce = new THREE.Group();
  root.add(bounce); bounce.add(squashNode);
  wardrobe = new Wardrobe(squashNode);
  mixer = new THREE.AnimationMixer(model);
  for (const clip of gltf.animations) actions[clip.name] = mixer.clipAction(clip);
  idle = actions.Idle; idle.play();
  mixer.addEventListener("finished", (e) => { if (e.action !== idle && !sleeping) backToIdle(); });
  applyConfig();
  play("Happy");
}, (err) => console.error(err));

// ---------- moods ----------
function play(name, loop = false) {
  if (name === "Dance") { danceStart = now(); return; }
  if (name === "Stretch") { stretchStart = now(); return; }
  if (name === "Spin") { spinStart = now(); return; }
  if (name === "Wave") { waveStart = now(); play("Happy"); return; }
  const a = actions[name];
  if (!a) return;
  sleeping = name === "Sleep" && loop;
  a.reset();
  a.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
  a.clampWhenFinished = true;
  (current || idle).crossFadeTo(a, 0.25, false);
  a.play();
  current = a;
}
function backToIdle() {
  if (!current) return;
  idle.reset().play();
  current.crossFadeTo(idle, 0.3, false);
  current = null; sleeping = false;
}
function wake() { if (sleeping) { sleeping = false; play("Surprised"); } }
const now = () => performance.now() / 1000;

// ---------- speech bubble and voice ----------
let bubbleTimer;
function say(text, ms = 7000, speak = false, voiceName) {
  bubble.textContent = text;
  bubble.classList.add("show");
  clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => bubble.classList.remove("show"), ms);
  if (speak && !cfg.mute && "speechSynthesis" in window) {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text.replace(/\*[^*]+\*/g, ""));
    const vs = speechSynthesis.getVoices();
    const v = vs.find((x) => x.name === (voiceName || cfg.voice)) || vs.find((x) => /en/i.test(x.lang));
    if (v) u.voice = v;
    u.pitch = cfg.voicePitch || 1.4; u.rate = cfg.voiceRate || 1.05;
    u.onstart = () => { speaking = 1; };
    u.onboundary = () => { speaking = 1; };
    u.onend = () => { speaking = 0; };
    speechSynthesis.speak(u);
    speaking = 1;
  }
  lastActive = performance.now();
}

// ---------- messages from the main process ----------
pet.onPlay((d) => { const name = typeof d === "string" ? d : d.name; const loop = typeof d === "object" && d.loop; if (name === "Sleep") play("Sleep", true); else { sleeping = false; play(name, loop); } lastActive = performance.now(); });
pet.onSay((d) => { if (typeof d === "string") say(d); else say(d.text, d.ms || 7000, d.speak, d.voice); });
pet.onLand((d) => { squashV -= 9 * (0.25 + d.impact); if (d.impact > 0.5 && !sleeping) play("Surprised"); });
pet.onFx((d) => fx(d.type, d));
pet.onConfig((c) => { cfg = { ...cfg, ...c }; applyConfig(); });

function applyConfig() {
  if (!model) return;
  if (bodyUniforms) bodyUniforms.hueShift.value = THREE.MathUtils.degToRad(cfg.colour?.hue || 0);
  for (const r of rings) {
    const c = new THREE.Color(0x8f5bff); c.offsetHSL((cfg.colour?.hue || 0) / 360, 0, 0);
    r.material.emissive.copy(c);
    r.material.color.copy(r.userData.baseColor).offsetHSL((cfg.colour?.hue || 0) / 360, 0, 0);
  }
  try { wardrobe.set({ hat: cfg.seasonalHat && cfg.hat === "none" ? cfg.seasonalHat : cfg.hat, outfit: cfg.outfit, focus: !!cfg.focus }); } catch (e) { window.__errs.push("wardrobe: " + e.message); }
  sleepyBase = Math.max(cfg.nightSleepy || 0, cfg.lowEnergy ? 0.35 : 0, batteryLow ? 0.4 : 0);
  glowMul = cfg.night ? 0.6 : 1;
  ears.setMode(cfg.sound || "off").then(() => { if (ears.error) pet.event("sound-error", ears.error); });
}

// ---------- battery ----------
let batteryLow = false;
if (navigator.getBattery) navigator.getBattery().then((b) => {
  const check = (first) => {
    if (!cfg.battery || cfg.role === "friend") return;
    const low = !b.charging && b.level <= 0.2;
    if (low && !batteryLow) { say(b.level <= 0.1 ? "Battery's almost empty! Plug me in? 🔌" : "My battery's getting low… and so is yours.", 6000); play("Cry"); }
    if (!low && batteryLow && b.charging && !first) { say("Ahh, charging. That's the stuff ⚡", 4000); play("Happy"); }
    batteryLow = low; applyConfig();
  };
  b.addEventListener("levelchange", () => check(false));
  b.addEventListener("chargingchange", () => check(false));
  setTimeout(() => check(true), 4000);
});

// ---------- cursor, hover, petting ----------
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
let stroke = { len: 0, flips: 0, lastDx: 0, t: 0, lastX: 0, lastY: 0 }, lastPet = 0;
pet.onTick((d) => {
  if (Math.abs(d.x - tick.x) + Math.abs(d.y - tick.y) > 2) { lastActive = performance.now(); wake(); }
  // petting: rub the cursor back and forth over EchoBot without clicking
  if (hoverOver && !down) {
    const dx = d.x - tick.x, dy = d.y - tick.y;
    const t = performance.now();
    if (t - stroke.t > 700) stroke = { len: 0, flips: 0, lastDx: 0, t };
    if (Math.abs(dx) > 1) {
      stroke.len += Math.hypot(dx, dy); stroke.t = t;
      if (stroke.lastDx && Math.sign(dx) !== Math.sign(stroke.lastDx)) stroke.flips++;
      stroke.lastDx = dx;
    }
    if (stroke.flips >= 3 && stroke.len > 140 && t - lastPet > 2500) {
      lastPet = t; stroke = { len: 0, flips: 0, lastDx: 0, t };
      fx("hearts", { n: 3 }); petGlow = 1.5;
      if (!current) play("Happy");
      pet.event("petted");
    }
  }
  tick = d;
  const cx = d.x - d.w / 2, cy = d.y - d.h * 0.57;
  lookTarget.set(Math.max(-1, Math.min(1, cx / 500)), Math.max(-1, Math.min(1, -cy / 380)));
  if (model && !down) {
    ndc.set((d.x / d.w) * 2 - 1, -(d.y / d.h) * 2 + 1);
    const inside = d.x >= 0 && d.y >= 0 && d.x < d.w && d.y < d.h;
    ray.setFromCamera(ndc, camera);
    const hit = inside && bodyMesh && ray.intersectObject(bodyMesh, false).length > 0;
    if (hit !== hoverOver) { hoverOver = hit; pet.clickThrough(!hit); if (hit) pet.event("hover"); }
  }
});
let petGlow = 0;

let down = null;
addEventListener("mousedown", (e) => { if (e.button === 0) down = { x: e.screenX, y: e.screenY, dragging: false }; });
addEventListener("mousemove", (e) => {
  if (down && !down.dragging && Math.hypot(e.screenX - down.x, e.screenY - down.y) > 4) { down.dragging = true; pet.dragStart(); wake(); }
});
addEventListener("mouseup", (e) => {
  if (e.button !== 0 || !down) return;
  if (down.dragging) pet.dragEnd();
  else { sleeping = false; play("Happy"); pet.event("click"); }
  down = null; lastActive = performance.now();
});
addEventListener("blur", () => { if (down && down.dragging) pet.dragEnd(); down = null; });
addEventListener("dblclick", () => { pet.event("dblclick"); });
addEventListener("contextmenu", (e) => { e.preventDefault(); pet.menu(); });

// ---------- idle chatter ----------
const LINES = ["Beep boop.", "Still here!", "You're doing great.", "Time for a stretch?", "Drink some water!", "*hums an echo*",
  "I like it up here.", "Need a break? I'll guard the screen.", "Did you know echoes travel at 343 m/s?", "Boop."];
function idleThing(t) {
  if (cfg.quiet || sleeping || current || danceStart >= 0) { nextIdle = t + 30000; return; }
  const p = cfg.pers || {};
  nextIdle = t + (45000 + Math.random() * 90000) / Math.max(0.3, (p.moods || 1));
  const r = Math.random();
  if (r < 0.4) play("LookAround");
  else if (r < 0.6) play("Happy");
  else if (r < 0.6 + 0.4 * Math.min(1, (p.chatter || 1) * (cfg.chattiness ?? 1))) say((cfg.lines && cfg.lines.length && Math.random() < 0.5 ? cfg.lines : LINES)[Math.floor(Math.random() * (cfg.lines && cfg.lines.length ? cfg.lines.length : LINES.length))] || "Beep.", 5000);
}

// ---------- the frame loop ----------
function resize() { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
addEventListener("resize", resize); resize();
const clock = new THREE.Clock();
const savedQ = new THREE.Quaternion(), tmpQ = new THREE.Quaternion(), tmpE = new THREE.Euler();
let acc = 0, typingBob = 0, wasMusic = false, lastBeatPose = 0, voiceTilt = 0, loudCooldown = 0, zzzT = 0, sweatT = 0, notesT = 0;

renderer.setAnimationLoop(() => {
  const dt0 = Math.min(clock.getDelta(), 0.1);
  acc += dt0;
  const moving = tick.state !== "ground" || Math.abs(tick.vx) > 3 || Math.abs(squashV) > 0.05 || speaking || ears.ok;
  const fps = moving ? 50 : sleeping ? 15 : 30;          // draw less often when nothing much is happening (saves battery)
  if (acc < 1 / fps) return;
  const dt = acc; acc = 0;
  if (!model) return;
  const t = performance.now(), s = t / 1000;

  // falls asleep after 3 quiet minutes (not while music is on)
  if (!sleeping && !current && danceStart < 0 && t - lastActive > 180000 && ears.music < 0.3) { play("Sleep", true); say("Zzz…", 3000); }
  if (sleeping && (zzzT -= dt) < 0) { fx("zzz"); zzzT = 2.2; }
  if (t > nextIdle) idleThing(t);

  ears.update(dt);
  mixer.update(dt);

  // ---- eyes follow the cursor (or look at your work while you type, or inward while peeking) ----
  const typing = cfg.typing ? tick.typing || 0 : 0;
  let target = sleeping ? new THREE.Vector2() : lookTarget;
  if (typing > 0.25 && !hoverOver) target = new THREE.Vector2((tick.scx || -0.6), -0.55);
  if (tick.peek === "left") target = new THREE.Vector2(0.9, 0.1);
  if (tick.peek === "right") target = new THREE.Vector2(-0.9, 0.1);
  look.lerp(target, 1 - Math.pow(0.002, dt));
  savedQ.copy(eyesPivot.quaternion);
  tmpE.set(-look.y * 0.3, look.x * 0.45, 0);
  eyesPivot.quaternion.multiply(tmpQ.setFromEuler(tmpE));

  // ---- echo rings: gentle pulse, or the music's beat ----
  const beat = ears.beat, lvl = ears.level;
  rings.forEach((r, i) => {
    const ph = (s / 2 + i / 3) % 1;
    const extra = ears.ok ? lvl * 0.35 + beat * 0.15 : 0;
    r.scale.setScalar(0.78 + 0.36 * ph + extra);
    r.material.opacity = Math.min(1, Math.pow(Math.sin(Math.PI * ph), 1.5) * (sleeping ? 0.25 : 0.6) * glowMul + extra);
  });

  // ---- face extras on top of the animation: sleepy eyes at night / low battery, mouth while talking ----
  const music = ears.mode === "music" ? ears.music : 0;
  for (const m of eyeMeshes) {
    const d = m.morphTargetDictionary, inf = m.morphTargetInfluences;
    if (sleepyBase > 0 && !sleeping) inf[d.Sleepy] = Math.max(inf[d.Sleepy], sleepyBase);
    if (music > 0.6 && !sleeping) inf[d.Happy] = Math.max(inf[d.Happy], (music - 0.6) * 2);
  }
  if (mouth && speaking) {
    const d = mouth.morphTargetDictionary, inf = mouth.morphTargetInfluences;
    inf[d.Open] = Math.max(inf[d.Open], 0.25 + 0.55 * Math.abs(Math.sin(s * 16)) * (0.6 + Math.random() * 0.4));
    if (!speechSynthesis.speaking && !speechSynthesis.pending) speaking = 0;
  }
  petGlow = Math.max(0, petGlow - dt * 0.6);
  for (const b of blush) if (petGlow > 0) b.scale.setScalar(Math.max(b.scale.x, Math.min(1, petGlow)));
  if (bodyUniforms) bodyUniforms.hueShift.value = THREE.MathUtils.degToRad(cfg.colour?.hue || 0);
  if (bodyUniforms) bodyUniforms.glowMul.value = glowMul * (1 + beat * 0.5 * (ears.ok ? 1 : 0));

  // ---- music: bob on the beat, notes now and then; mic: tilt toward voices, jump at loud noises ----
  if (music > 0.4 && (notesT -= dt) < 0) { fx("notes", { n: 1 }); notesT = 1.6 + Math.random(); }
  if (music > 0.5 && !wasMusic) { wasMusic = true; pet.event("music-start"); }
  if (music < 0.1 && wasMusic) { wasMusic = false; pet.event("music-stop"); }
  if (beat === 1 && music > 0.3 && !sleeping) squashV -= 1.4 + lvl * 2;
  if (ears.mode === "mic") {
    voiceTilt += ((ears.voice > 0.18 ? 0.18 : 0) - voiceTilt) * Math.min(1, dt * 3);
    loudCooldown -= dt;
    if (lvl > 0.75 && loudCooldown < 0 && !sleeping) { play("Surprised"); loudCooldown = 8; }
    if (lvl > 0.2) lastActive = t;
  } else voiceTilt *= 0.9;
  if (ears.ok && music > 0.3) lastActive = t;

  // ---- CPU sweat ----
  if (cfg.cpuHot && (sweatT -= dt) < 0) { fx("sweat"); sweatT = 1.2; }

  // ---- squash and stretch: a little spring, kicked by landings and beats, stretched by falling ----
  const stretchTarget = tick.state === "air" ? Math.min(0.22, Math.abs(tick.vy) / 6000) * (tick.vy < 0 ? 1 : 0.7) : 0;
  squashV += (-140 * (squash - stretchTarget) - 11 * squashV) * dt;
  squash += squashV * dt;
  squash = Math.max(-0.45, Math.min(0.4, squash));
  let sy = 1 + squash, sxz = 1 - squash * 0.55;

  // typing along: a tiny busy bob
  typingBob = typing > 0.25 ? typingBob + dt * 14 : 0;

  // ---- whole-body pose ----
  lean += (-tick.vx / 400 * 0.35 - lean) * Math.min(1, dt * 6);
  let rotY = look.x * 0.25, rotZ = lean + (tick.state === "held" ? Math.sin(s * 14) * 0.06 : 0) + voiceTilt, y = 0, rotX = 0;
  if (tick.state === "air") rotZ += Math.max(-0.5, Math.min(0.5, tick.vx / 3000));
  if (typing > 0.25) y += Math.abs(Math.sin(typingBob)) * 0.03;
  if (danceStart >= 0) {
    const a = s - danceStart;
    if (a < 3.2) { y += Math.abs(Math.sin(a * Math.PI * 2.5)) * 0.22; rotZ += Math.sin(a * Math.PI * 2.5) * 0.18; rotY += Math.sin(a * Math.PI * 1.25) * 0.5; }
    else danceStart = -1;
  }
  if (spinStart >= 0) { const a = s - spinStart; if (a < 1.1) rotY += (a / 1.1) * Math.PI * 2; else spinStart = -1; }
  if (waveStart >= 0) { const a = s - waveStart; if (a < 1.6) rotZ += Math.sin(a * 12) * 0.15 * (1 - a / 1.6); else waveStart = -1; }
  if (stretchStart >= 0) {
    const a = s - stretchStart;
    if (a < 2.2) { const k = Math.sin(Math.min(1, a / 2.2) * Math.PI); sy *= 1 + 0.22 * k; sxz *= 1 - 0.1 * k; rotZ += Math.sin(a * 3) * 0.05 * k; }
    else stretchStart = -1;
  }
  if (tick.peek === "left") rotZ += -0.42;
  if (tick.peek === "right") rotZ += 0.42;
  if (tick.peek === "top") { rotZ += Math.PI; y -= 0.45; }
  bounce.scale.set(sxz, sy, sxz);
  bounce.position.y = (sy - 1) * 0.96;       // squash from the bottom, not the middle
  model.rotation.set(rotX, rotY, rotZ);
  model.position.y = y;
  wardrobe.update(dt, lean);

  renderer.render(scene, camera);
  eyesPivot.quaternion.copy(savedQ);
});

// expose a few things for automated checks
window.__echobot = { play, say, fx, state: () => ({ sleeping, hoverOver, squash, music: ears.music, level: ears.level, earsMode: ears.mode, earsError: ears.error }) };
