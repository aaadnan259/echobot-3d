// One EchoBot on the desktop: its see-through window, how it moves (walk, hop, fall, get thrown, sit on
// windows, peek from screen edges) and its little self-directed decisions. The main EchoBot and the
// friend are both Pets; main.js decides what they do together.
const path = require("path");
const { BrowserWindow, screen } = require("electron");
const { G, displayAt, floorOf, stepAir, standingWindow } = require("./physics");
const { world } = require("./world");
const store = require("./store");

const SIZES = { Small: 170, Medium: 230, Large: 310 };
const FEET = 0.8;            // where EchoBot's hover-line is inside its window (fraction of the window height)

class Pet {
  constructor({ role = "main", colour = null, onEvent = () => {} }) {
    this.role = role;
    this.colour = colour;
    this.onEvent = onEvent;
    this.s = SIZES[store.get().size] || SIZES.Medium;
    this.body = { x: 0, y: 0, vx: 0, vy: 0, s: this.s, feet: FEET, bounce: 0.45 };
    this.state = "air";                  // "ground" | "air" | "held" | "peek" | "hidden" | "float"
    this.surface = { kind: "floor" };
    this.target = null;                  // { x, speed } while walking somewhere
    this.peek = null;                    // { side, until } while peeking from a screen edge
    this.drag = null;
    this.samples = [];                   // recent cursor positions while dragged, to work out a throw
    this.nextThink = Date.now() + 8000 + Math.random() * 8000;
    this.busy = 0;                       // timestamp until which wandering is paused (games, chatting…)
    this.facing = 1;
    this.lastSaved = 0;
    this.create();
  }

  create() {
    const st = store.get();
    const wa = screen.getPrimaryDisplay().workArea;
    const s = this.s;
    let x = this.role === "main" && st.x != null ? st.x : wa.x + wa.width - s - 40 - (this.role === "friend" ? s * 1.2 : 0);
    let y = this.role === "main" && st.y != null ? st.y : wa.y + wa.height - FEET * s;
    if (this.role === "friend") y = wa.y - s * 0.3;         // the friend drops in from the top
    Object.assign(this.body, { x, y });
    this.win = new BrowserWindow({
      width: s, height: s, x: Math.round(x), y: Math.round(y), transparent: true, frame: false, resizable: false, maximizable: false,
      minimizable: false, fullscreenable: false, skipTaskbar: true, show: false, hasShadow: false, focusable: true,
      alwaysOnTop: st.onTop, backgroundColor: "#00000000", title: "EchoBot", icon: path.join(__dirname, "icon.png"),
      webPreferences: { preload: path.join(__dirname, "preload.js"), backgroundThrottling: false },
    });
    if (st.onTop) this.win.setAlwaysOnTop(true, "floating");
    this.win.setIgnoreMouseEvents(true, { forward: true });   // clicks pass through, except on EchoBot itself
    this.win.once("ready-to-show", () => { this.win.showInactive(); });
    this.win.loadFile(path.join(__dirname, "index.html"), { query: { role: this.role } });
    this.win.on("closed", () => { this.win = null; });
    // place it right away on the floor or in the air depending on where it was
    this.state = store.get().physics ? "air" : "float";
  }

  alive() { return this.win && !this.win.isDestroyed(); }
  send(ch, data) { if (this.alive()) this.win.webContents.send(ch, data); }
  center() { return { x: this.body.x + this.s / 2, y: this.body.y + this.s / 2 }; }
  feetY() { return this.body.y + FEET * this.s; }

  setSize(name) {
    const s = SIZES[name] || SIZES.Medium;
    const cx = this.body.x + this.s / 2, feet = this.feetY();
    this.s = s; this.body.s = s;
    this.body.x = cx - s / 2; this.body.y = feet - FEET * s;
    this.apply(true);
  }

  // ---- input from the renderer ----
  dragStart() {
    const p = screen.getCursorScreenPoint();
    this.drag = { dx: p.x - this.body.x, dy: p.y - this.body.y };
    this.samples = [];
    this.state = "held"; this.target = null; this.peek = null;
  }
  dragEnd() {
    if (!this.drag) return;
    this.drag = null;
    // throw speed from the last ~90 ms of movement
    const now = Date.now(), recent = this.samples.filter((s) => now - s.t < 90);
    let vx = 0, vy = 0;
    if (recent.length >= 2) {
      const a = recent[0], b = recent[recent.length - 1], dt = Math.max(0.016, (b.t - a.t) / 1000);
      vx = (b.x - a.x) / dt; vy = (b.y - a.y) / dt;
    }
    const sp = Math.hypot(vx, vy);
    if (sp > 2200) { vx *= 2200 / sp; vy *= 2200 / sp; }
    if (store.get().physics) {
      Object.assign(this.body, { vx, vy });
      this.state = "air";
      if (sp > 900) this.onEvent(this, "thrown", { speed: sp });
    } else {
      this.state = "float";
    }
    this.nextThink = Date.now() + 15000;
    this.savePos(true);
  }

  // ---- movement ----
  walkTo(x, speed) {
    if (this.state !== "ground") return false;
    this.target = { x, speed: speed || 70 * (store.get().wanderSpeed || 1) * store.personality().speed };
    return true;
  }
  hop(height = 90, vx = 0) {
    if (this.state !== "ground" && this.state !== "float") return;
    this.body.vy = -Math.sqrt(2 * G * height);
    this.body.vx = vx;
    this.state = "air";
    this.target = null;
  }
  // Jump so we land on top of a window (or wherever x/topY is).
  jumpTo(cx, topY) {
    if (this.state !== "ground") return false;
    const feet = this.feetY();
    const rise = feet - topY;
    const apex = Math.max(60, rise + 70);
    const vy0 = -Math.sqrt(2 * G * apex);
    const tUp = -vy0 / G, tDown = Math.sqrt(2 * Math.max(10, apex - rise) / G);
    const T = tUp + tDown;
    this.body.vy = vy0;
    this.body.vx = (cx - (this.body.x + this.s / 2)) / T;
    this.state = "air"; this.target = null;
    this.onEvent(this, "jump");
    return true;
  }
  startPeek(side, ms = 6000) {
    const d = displayAt(this.center().x, this.center().y);
    const b = d.bounds, s = this.s;
    this.target = null;
    if (side === "left") { this.body.x = b.x - s * 0.62; this.body.y = Math.min(this.body.y, floorOf(d) - FEET * s); }
    else if (side === "right") { this.body.x = b.x + b.width - s * 0.38; this.body.y = Math.min(this.body.y, floorOf(d) - FEET * s); }
    else if (side === "top") { this.body.y = b.y - s * 0.55; }
    this.state = "peek";
    this.peek = { side, until: Date.now() + ms };
    this.apply(true);
  }
  endPeek() {
    if (!this.peek) return;
    const side = this.peek.side, d = displayAt(this.center().x, this.center().y), s = this.s;
    this.peek = null;
    if (side === "left") this.body.x = d.bounds.x - s * 0.2;
    if (side === "right") this.body.x = d.bounds.x + d.bounds.width - s * 0.8;
    if (side === "top") this.body.y = d.bounds.y - s * 0.2;
    this.body.vx = 0; this.body.vy = 0;
    this.state = store.get().physics ? "air" : "float";
  }
  hide() { if (this.alive()) this.win.hide(); this.state = this.state === "held" ? "air" : this.state; this.hidden = true; }
  show() { if (this.alive() && !this.win.isVisible()) this.win.showInactive(); this.hidden = false; }

  // ---- the physics step, called ~60 times a second ----
  step(dt) {
    if (!this.alive()) return;
    const b = this.body, st = store.get();
    let vx = 0;
    if (this.state === "held") {
      const p = screen.getCursorScreenPoint();
      const nx = p.x - this.drag.dx, ny = p.y - this.drag.dy;
      vx = (nx - b.x) / dt;
      b.x = nx; b.y = ny;
      this.samples.push({ t: Date.now(), x: p.x, y: p.y });
      if (this.samples.length > 12) this.samples.shift();
    } else if (this.state === "air") {
      const hit = stepAir(b, dt, { useWindows: st.sitOnWindows });
      vx = b.vx;
      if (hit) {
        b.y = hit.y - FEET * this.s;
        if (hit.impact > 700) {           // bounce
          b.vy = -hit.impact * 0.36; b.vx *= 0.75;
          this.send("land", { impact: Math.min(1, hit.impact / 2200) });
        } else {
          b.vy = 0;
          this.state = "ground";
          this.surface = hit.surface.kind === "win" ? { kind: "win", hwnd: hit.surface.hwnd } : { kind: "floor" };
          this.send("land", { impact: Math.min(1, hit.impact / 2200) });
          this.onEvent(this, "landed", { surface: this.surface.kind });
          this.savePos();
        }
      }
    } else if (this.state === "ground") {
      // slide off any leftover speed
      if (Math.abs(b.vx) > 5) { b.x += b.vx * dt; b.vx *= Math.exp(-7 * dt); vx = b.vx; } else b.vx = 0;
      if (this.target) {
        const cx = b.x + this.s / 2, dx = this.target.x - cx;
        const step = Math.sign(dx) * Math.min(Math.abs(dx), this.target.speed * dt);
        b.x += step; vx = step / dt;
        if (Math.abs(dx) < 1) { const done = this.target.then; this.target = null; if (done) done(); }
      }
      if (this.surface.kind === "win") {
        const w = standingWindow(b, this.surface.hwnd);
        if (!w) { this.fall(); }
        else {
          if (this.surface.dx === undefined || this.surface.wx !== w.x) {
            // first frame on this window, or the window moved: ride along with it
            if (this.surface.dx === undefined) this.surface.dx = b.x - w.x;
            else b.x = w.x + this.surface.dx;
            this.surface.wx = w.x;
          }
          this.surface.dx = b.x - w.x;
          b.y = w.y - FEET * this.s;
          // walked off the edge?
          const cx = b.x + this.s / 2;
          if (cx < w.x + 4 || cx > w.x + w.w - 4) this.fall();
        }
      } else {
        const d = displayAt(b.x + this.s / 2, b.y + this.s / 2);
        b.y = floorOf(d) - FEET * this.s;
        const minX = d.workArea.x - this.s * 0.25, maxX = d.workArea.x + d.workArea.width - this.s * 0.75;
        if (b.x < minX || b.x > maxX) { b.x = Math.max(minX, Math.min(maxX, b.x)); this.target = null; }
      }
      if (!st.physics) this.state = "float";
    } else if (this.state === "peek") {
      if (Date.now() > this.peek.until) this.endPeek();
    } else if (this.state === "float") {
      if (this.target) {
        const cx = b.x + this.s / 2, dx = this.target.x - cx;
        const step = Math.sign(dx) * Math.min(Math.abs(dx), this.target.speed * dt);
        b.x += step; vx = step / dt;
        if (Math.abs(dx) < 1) this.target = null;
      }
      if (st.physics) this.state = "air";
    }
    if (Math.abs(vx) > 3) this.facing = Math.sign(vx);
    this.vxOut = vx;
    this.apply();
  }
  fall() { this.state = "air"; this.body.vy = 0; this.target = null; this.surface = { kind: "floor" }; }

  apply(force) {
    if (!this.alive()) return;
    const x = Math.round(this.body.x), y = Math.round(this.body.y);
    const cur = this.win.getBounds();
    if (force || cur.x !== x || cur.y !== y || cur.width !== this.s) this.win.setBounds({ x, y, width: this.s, height: this.s });
  }
  savePos(now) {
    if (this.role !== "main") return;
    if (!now && Date.now() - this.lastSaved < 5000) return;
    this.lastSaved = Date.now();
    store.patch({ x: Math.round(this.body.x), y: Math.round(this.body.y) });
  }

  // The cursor and motion info the renderer needs each frame.
  tickData() {
    const p = screen.getCursorScreenPoint(), b = this.win.getBounds();
    const d = displayAt(b.x + b.width / 2, b.y + b.height / 2).workArea;
    const scx = Math.max(-1, Math.min(1, ((d.x + d.width / 2) - (b.x + b.width / 2)) / (d.width / 2)));   // which way the middle of the screen is
    return { x: p.x - b.x, y: p.y - b.y, w: b.width, h: b.height, vx: this.vxOut || 0, vy: this.state === "air" ? this.body.vy : 0, scx,
      state: this.state, peek: this.peek ? this.peek.side : null, facing: this.facing, surface: this.surface.kind };
  }

  // ---- small decisions it makes on its own ----
  think(now, ctx) {
    if (this.state !== "ground" || this.hidden || this.target || now < this.nextThink || now < this.busy || ctx.quiet) return;
    const st = store.get(), pers = store.personality();
    this.nextThink = now + (18000 + Math.random() * 40000) / pers.wander;
    if (!st.wander) return;
    const d = displayAt(this.center().x, this.center().y);
    const r = Math.random();
    const cx = this.center().x;
    if (st.sitOnWindows && world.ok && r < 0.2) {
      // jump up onto a nearby window if one is in reach
      const feet = this.feetY();
      const options = world.windows.filter((w, i) => !w.maximized && w.y < feet - 40 && w.y > feet - 520 && Math.abs(w.x + w.w / 2 - cx) < 700
        && w.y - FEET * this.s > d.bounds.y - this.s * 0.2).filter((w) => {
          const tx = Math.max(w.x + this.s * 0.5, Math.min(w.x + w.w - this.s * 0.5, cx));
          const idx = world.windows.indexOf(w);
          return require("./world").pointVisible(tx, w.y - 2, idx) && w.hwnd !== this.surface.hwnd;
        });
      if (options.length) {
        const w = options[Math.floor(Math.random() * options.length)];
        const tx = Math.max(w.x + this.s * 0.5, Math.min(w.x + w.w - this.s * 0.5, cx + (Math.random() - 0.5) * 200));
        this.jumpTo(tx, w.y);
        return;
      }
    }
    if (this.surface.kind === "win" && r < 0.3) {          // hop down from the window
      this.hop(70, (Math.random() < 0.5 ? -1 : 1) * 260);
      return;
    }
    if (st.edgePeek && this.surface.kind === "floor" && r < 0.38) {
      const side = cx < d.bounds.x + d.bounds.width / 2 ? "left" : "right";
      const edgeX = side === "left" ? d.workArea.x + this.s * 0.3 : d.workArea.x + d.workArea.width - this.s * 0.3;
      this.target = { x: edgeX, speed: 110 * pers.speed, then: () => { this.startPeek(side, 4000 + Math.random() * 5000); this.onEvent(this, "peek"); } };
      return;
    }
    if (r < 0.38 + 0.1 * pers.hops) { this.hop(60 + Math.random() * 60); return; }
    // otherwise stroll somewhere on the current surface
    let lo, hi;
    if (this.surface.kind === "win") {
      const w = standingWindow(this.body, this.surface.hwnd);
      if (!w) return;
      lo = w.x + this.s * 0.45; hi = w.x + w.w - this.s * 0.45;
    } else { lo = d.workArea.x + this.s * 0.5; hi = d.workArea.x + d.workArea.width - this.s * 0.5; }
    const span = Math.min(500, (hi - lo) * 0.5);
    const tx = Math.max(lo, Math.min(hi, cx + (Math.random() * 2 - 1) * span));
    this.walkTo(tx);
  }

  destroy() { if (this.alive()) this.win.destroy(); }
}

module.exports = { Pet, SIZES, FEET };
