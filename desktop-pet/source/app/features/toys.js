// Toys that live in their own little windows: a ball EchoBot chases and kicks, batteries it eats, and the
// sticky notes it leaves around when mischief is on. They fall, bounce and land on windows like EchoBot.
const path = require("path");
const { BrowserWindow, ipcMain, screen } = require("electron");
const { stepAir, standingWindow, displayAt, floorOf } = require("../physics");
let api;
const toys = [];
const SIZE = { ball: 54, battery: 46, note: 180 };

class Toy {
  constructor(kind, { x, y, text } = {}) {
    this.kind = kind; this.text = text || "";
    const s = SIZE[kind];
    this.body = { x, y, vx: 0, vy: 0, s, feet: kind === "note" ? 0.75 : 0.98, bounce: kind === "ball" ? 0.75 : 0.3 };
    this.state = kind === "note" ? "still" : "air";
    this.born = Date.now(); this.lastPlay = Date.now();
    this.win = new BrowserWindow({
      width: s, height: kind === "note" ? 130 : s, x: Math.round(x), y: Math.round(y), frame: false, transparent: true, resizable: false,
      skipTaskbar: true, alwaysOnTop: true, show: false, focusable: false, hasShadow: false, backgroundColor: "#00000000",
      webPreferences: { preload: path.join(__dirname, "..", "preload-toy.js") },
    });
    this.win.setAlwaysOnTop(true, "floating");
    this.win.loadFile(path.join(__dirname, "..", "toy.html"), { query: { kind, text: this.text } });
    this.win.once("ready-to-show", () => this.win.showInactive());
    this.win.on("closed", () => { this.win = null; });
  }
  alive() { return this.win && !this.win.isDestroyed(); }
  centerX() { return this.body.x + this.body.s / 2; }
  step(dt) {
    if (!this.alive()) return;
    const b = this.body;
    if (this.state === "held") {
      const p = screen.getCursorScreenPoint();
      b.x = p.x - this.drag.dx; b.y = p.y - this.drag.dy;
      this.samples.push({ t: Date.now(), x: p.x, y: p.y }); if (this.samples.length > 10) this.samples.shift();
    } else if (this.state === "air") {
      const hit = stepAir(b, dt, { useWindows: api.store.get().sitOnWindows });
      if (hit) {
        b.y = hit.y - b.feet * b.s;
        if (hit.impact > 300 && this.kind === "ball") { b.vy = -hit.impact * 0.62; b.vx *= 0.85; }
        else { b.vy = 0; this.state = "ground"; this.surface = hit.surface; }
      }
    } else if (this.state === "ground") {
      if (Math.abs(b.vx) > 4) { b.x += b.vx * dt; b.vx *= Math.exp(-(this.kind === "ball" ? 1.6 : 6) * dt); } else b.vx = 0;
      if (this.surface && this.surface.kind === "win") { const w = standingWindow(b, this.surface.hwnd); if (!w) { this.state = "air"; } else b.y = w.y - b.feet * b.s; }
      else {
        const d = displayAt(this.centerX(), b.y);
        b.y = floorOf(d) - b.feet * b.s;
        const lo = d.bounds.x, hi = d.bounds.x + d.bounds.width - b.s;
        if (b.x < lo || b.x > hi) { b.x = Math.max(lo, Math.min(hi, b.x)); b.vx = -b.vx * 0.6; }
      }
    }
    this.win.setBounds({ x: Math.round(b.x), y: Math.round(b.y), width: b.s, height: this.kind === "note" ? 130 : b.s });
  }
  kick(dir) {
    const b = this.body;
    b.vx = dir * (450 + Math.random() * 500); b.vy = -(550 + Math.random() * 600);
    this.state = "air"; this.lastPlay = Date.now();
  }
  destroy() { if (this.alive()) this.win.destroy(); }
}

function spawn(kind, opts = {}) {
  const pet = api.main();
  const pb = pet ? pet.win.getBounds() : screen.getPrimaryDisplay().workArea;
  const d = displayAt(pb.x + pb.width / 2, pb.y + pb.height / 2);
  if (kind === "ball") { const old = toys.find((t) => t.kind === "ball"); if (old) return old; }
  if (kind === "note" && toys.filter((t) => t.kind === "note").length >= 3) return null;
  const x = opts.x ?? Math.max(d.workArea.x, Math.min(d.workArea.x + d.workArea.width - 80, pb.x + pb.width / 2 + (Math.random() < 0.5 ? -1 : 1) * (150 + Math.random() * 200)));
  const y = opts.y ?? d.workArea.y + 20;
  const t = new Toy(kind, { x, y, text: opts.text });
  toys.push(t);
  if (pet) pet.busy = 0;
  return t;
}
function remove(t) { t.destroy(); const i = toys.indexOf(t); if (i >= 0) toys.splice(i, 1); api.refreshTray(); }
const toyFor = (sender) => toys.find((t) => t.alive() && t.win.webContents === sender);

module.exports = {
  init(a) {
    api = a;
    ipcMain.on("toy:drag-start", (e) => {
      const t = toyFor(e.sender); if (!t || t.kind === "note") return;
      const p = screen.getCursorScreenPoint();
      t.drag = { dx: p.x - t.body.x, dy: p.y - t.body.y }; t.samples = []; t.state = "held";
    });
    ipcMain.on("toy:drag-end", (e) => {
      const t = toyFor(e.sender); if (!t || t.state !== "held") return;
      const now = Date.now(), r = t.samples.filter((s) => now - s.t < 90);
      if (r.length >= 2) { const a = r[0], b = r[r.length - 1], dt = Math.max(0.016, (b.t - a.t) / 1000); t.body.vx = (b.x - a.x) / dt; t.body.vy = (b.y - a.y) / dt; }
      t.state = "air"; t.lastPlay = now;
    });
    ipcMain.on("toy:click", (e) => {
      const t = toyFor(e.sender); if (!t) return;
      if (t.kind === "note") { remove(t); return; }
      if (t.kind === "ball") t.kick(Math.random() < 0.5 ? -1 : 1);
    });
  },
  spawn, toys: () => toys,
  menu() {
    const ball = toys.find((t) => t.kind === "ball");
    const items = [{ label: ball ? "Put the ball away" : "Throw a ball", click: () => (ball ? remove(ball) : spawn("ball")) }];
    if (toys.some((t) => t.kind === "note")) items.push({ label: "Clear EchoBot's notes", click: () => toys.filter((t) => t.kind === "note").forEach(remove) });
    return items;
  },
  tick(now, dt) {
    for (const t of [...toys]) {
      if (!t.alive()) { remove(t); continue; }
      t.step(dt);
      if (t.kind === "ball" && now - t.lastPlay > 3 * 60000) remove(t);
      if (t.kind === "note" && now - t.born > 30 * 60000) remove(t);
      if (t.kind === "battery" && now - t.born > 5 * 60000) remove(t);
    }
    // EchoBot goes after the ball and batteries
    const pet = api.main();
    if (!pet || pet.hidden || api.quiet()) return;
    const target = toys.find((t) => t.kind === "battery" && t.state === "ground") || toys.find((t) => t.kind === "ball" && t.state !== "held");
    if (!target) return;
    if (pet.state !== "ground" || now < pet.busy) return;
    const pcx = pet.center().x, dx = target.centerX() - pcx;
    const sameLevel = Math.abs((target.body.y + target.body.feet * target.body.s) - pet.feetY()) < 40;
    if (Math.abs(dx) < pet.s * 0.38 && sameLevel) {
      if (target.kind === "battery") {
        remove(target);
        const care = api.feature("care"); if (care) care.feed();
        api.say(["Mmm, crunchy electrons ⚡", "Nom! Fully charged 🔋", "Thanks! That hit the spot."][Math.floor(Math.random() * 3)], { ms: 3000 });
        api.play("Happy"); api.fx("hearts", { n: 3 });
      } else if (target.state === "ground" && Math.abs(target.body.vx) < 200) {
        target.kick(Math.sign(dx) || 1);
        api.play("Happy");
        const care = api.feature("care"); if (care) care.played(2);
        if (Math.random() < 0.15) { const c = api.feature("care"); if (c) c.reward(1, 1, "ball"); }
      }
      pet.target = null;
    } else if (target.state === "ground" || target.kind === "ball") {
      const speed = 170 * api.store.personality().speed;
      if (!pet.target || Math.abs(pet.target.x - target.centerX()) > 30) pet.target = { x: target.centerX() - Math.sign(dx) * pet.s * 0.2, speed };
      // ball on a different level: hop toward it now and then
      if (!sameLevel && target.state === "ground" && Math.random() < 0.01) pet.jumpTo(target.centerX(), target.body.y + target.body.feet * target.body.s);
    }
  },
  status: () => ({ toys: toys.map((t) => ({ kind: t.kind, state: t.state, x: Math.round(t.body.x), y: Math.round(t.body.y) })) }),
  actions: { spawnToy: (k) => { spawn(k); return true; } },
};
