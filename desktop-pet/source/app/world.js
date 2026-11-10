// What's going on around EchoBot: other windows (to sit on), fullscreen apps (to hide from), typing (to react to)
// and how busy the CPU is. Window info comes from winwatch.exe, a tiny helper that only reports rectangles
// and the time of the last input; it never sees what you type.
const { spawn } = require("child_process");
const path = require("path");
const os = require("os");
const { screen } = require("electron");

const world = {
  windows: [],          // [{ hwnd, x, y, w, h, maximized, caption }] in screen DIPs, topmost first
  fullscreen: false,
  typing: 0,            // 0..1, how busy the keyboard is right now
  cpu: 0,               // 0..100
  ok: false,            // false if the helper couldn't start (EchoBot still works, just without window tricks)
};

let helper = null, buf = "", last = null, lastCursor = null, typingHits = [], restartAt = 0;

function toDip(x, y, w, h) {
  try { return screen.screenToDipRect(null, { x, y, width: w, height: h }); } catch { return { x, y, width: w, height: h }; }
}

function onLine(line) {
  let d; try { d = JSON.parse(line); } catch { return; }
  world.ok = true;
  world.fullscreen = !!d.fs;
  world.windows = d.w.map(([hwnd, x, y, w, h, max, cap]) => {
    const r = toDip(x, y, w, h);
    return { hwnd, x: r.x, y: r.y, w: r.width, h: r.height, maximized: !!max, caption: !!cap };
  });
  // Typing: input happened (lastInput moved) while the mouse stayed still. Mouse wheel counts too, which is fine.
  const cur = screen.getCursorScreenPoint();
  const moved = lastCursor && (Math.abs(cur.x - lastCursor.x) + Math.abs(cur.y - lastCursor.y) > 1);
  if (last && d.li !== last.li && !moved) typingHits.push(Date.now());
  lastCursor = cur; last = d;
  const now = Date.now();
  typingHits = typingHits.filter((t) => now - t < 3000);
  world.typing = Math.min(1, typingHits.length / 15);   // 15 of the last 30 samples busy = full speed typing
}

function start(ownPid) {
  const exe = path.join(__dirname, "winwatch.exe");
  try {
    helper = spawn(exe, [String(ownPid)], { windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
  } catch { helper = null; return; }
  helper.stdout.setEncoding("utf8");
  helper.stdout.on("data", (chunk) => {
    buf += chunk;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) { onLine(buf.slice(0, i).trim()); buf = buf.slice(i + 1); }
  });
  helper.on("exit", () => {
    helper = null; world.ok = false;
    if (Date.now() > restartAt) { restartAt = Date.now() + 10000; setTimeout(() => start(ownPid), 2000); }   // restart once if it crashes
  });
  helper.on("error", () => { helper = null; world.ok = false; });
}
function stop() { if (helper) { try { helper.kill(); } catch {} helper = null; } }

// CPU use, sampled every 2 seconds from the OS counters.
let prevCpu = null;
const cpuTimer = setInterval(() => {
  const c = os.cpus().reduce((a, x) => { const t = x.times; a.idle += t.idle; a.total += t.user + t.nice + t.sys + t.irq + t.idle; return a; }, { idle: 0, total: 0 });
  if (prevCpu) { const dt = c.total - prevCpu.total; world.cpu = dt > 0 ? Math.round(100 * (1 - (c.idle - prevCpu.idle) / dt)) : 0; }
  prevCpu = c;
}, 2000);
if (cpuTimer.unref) cpuTimer.unref();

// Places EchoBot can stand: the top edge of each window, but only the parts not covered by windows above it.
// Returns the y of the highest surface under x that lies between yFrom and yTo (inclusive), or null.
function surfaceBetween(x, yFrom, yTo, ignoreHwnd) {
  let best = null;
  world.windows.forEach((win, i) => {
    if (win.hwnd === ignoreHwnd || win.maximized) return;
    if (x < win.x + 12 || x > win.x + win.w - 12) return;
    if (win.y < yFrom - 1 || win.y > yTo) return;
    if (!pointVisible(x, win.y - 2, i)) return;
    if (!best || win.y < best.y) best = { hwnd: win.hwnd, y: win.y, x: win.x, w: win.w };
  });
  return best;
}
// Is the point (x, y) on top of window #index, i.e. not hidden by any window above it in the stack?
function pointVisible(x, y, index) {
  for (let j = 0; j < index; j++) {
    const o = world.windows[j];
    if (x >= o.x && x <= o.x + o.w && y >= o.y && y <= o.y + o.h) return false;
  }
  return true;
}
function windowByHwnd(hwnd) {
  const i = world.windows.findIndex((w) => w.hwnd === hwnd);
  return i < 0 ? null : { win: world.windows[i], index: i };
}

module.exports = { world, start, stop, surfaceBetween, pointVisible, windowByHwnd };
