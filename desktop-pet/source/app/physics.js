// Shared physics for EchoBot and its toys: gravity, bouncing off screen edges, and landing on the floor
// (the top of the taskbar) or on the title bar of a window. A "body" is { x, y, vx, vy, s, feet, bounce }:
// x/y is the window's top-left corner, s its size, feet the fraction of s where it touches the ground.
const { screen } = require("electron");
const { world, surfaceBetween, windowByHwnd, pointVisible } = require("./world");

const G = 2600;               // px/s², gravity
const MAX_SPEED = 2600;

function displayAt(x, y) { return screen.getDisplayNearestPoint({ x: Math.round(x), y: Math.round(y) }); }
function inAnyDisplay(x, y) {
  return screen.getAllDisplays().some((d) => x >= d.bounds.x && x < d.bounds.x + d.bounds.width && y >= d.bounds.y && y < d.bounds.y + d.bounds.height);
}
function floorOf(d) { return d.workArea.y + d.workArea.height; }

// Is a body standing on a window still OK? Returns the window, or null if it vanished, got covered or maximised.
function standingWindow(body, hwnd) {
  const found = windowByHwnd(hwnd);
  if (!found || found.win.maximized) return null;
  const cx = body.x + body.s / 2;
  if (cx < found.win.x + 6 || cx > found.win.x + found.win.w - 6) return null;
  if (!pointVisible(cx, found.win.y - 2, found.index)) return null;
  return found.win;
}

// One step of free flight. Returns null while still flying, or a landing { y, surface, impact } once it hits ground.
function stepAir(body, dt, { useWindows = true, ignoreHwnd = null } = {}) {
  const oldFeet = body.y + body.feet * body.s;
  body.vy = Math.min(MAX_SPEED, body.vy + G * dt);
  body.vx = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, body.vx));
  let nx = body.x + body.vx * dt, ny = body.y + body.vy * dt;
  const ocx = body.x + body.s / 2, ocy = body.y + body.s / 2;
  const d = displayAt(ocx, ocy);
  // side walls: bounce unless another monitor continues that way
  const ncx = nx + body.s / 2;
  if (!inAnyDisplay(ncx, Math.min(Math.max(ocy, d.bounds.y + 1), d.bounds.y + d.bounds.height - 1))) {
    const left = d.bounds.x - body.s * 0.5, right = d.bounds.x + d.bounds.width - body.s * 0.5;
    nx = Math.max(left, Math.min(right, nx));
    body.vx = -body.vx * (body.bounce ?? 0.5);
  }
  // ceiling
  const top = d.bounds.y - body.s * 0.35;
  if (ny < top && !inAnyDisplay(ncx, ny)) { ny = top; body.vy = Math.max(0, body.vy); }
  body.x = nx; body.y = ny;
  if (body.vy <= 0) return null;
  const newFeet = ny + body.feet * body.s;
  const cx = nx + body.s / 2;
  const nd = displayAt(cx, newFeet - 1);
  const floor = floorOf(nd);
  let hit = null;
  if (useWindows && world.ok) {
    const w = surfaceBetween(cx, oldFeet, newFeet, ignoreHwnd);
    if (w && w.y < floor - 20 && w.y - body.feet * body.s * 0.9 > nd.bounds.y - body.s * 0.3) hit = { y: w.y, surface: { kind: "win", hwnd: w.hwnd } };
  }
  if (!hit && newFeet >= floor) hit = { y: floor, surface: { kind: "floor" } };
  if (!hit) return null;
  return { ...hit, impact: body.vy };
}

module.exports = { G, displayAt, inAnyDisplay, floorOf, stepAir, standingWindow };
