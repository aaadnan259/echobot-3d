// Phase 1: gravity, bounce, throw, landing on and riding windows, edge peeking.
import { launch, sleep, openTestWindow, findWindow, moveWindow, minimizeWindow, check } from "./harness.mjs";

const results = [];
const pet = await launch({ name: "physics", settings: { wander: false } });
try {
  const main = (s) => s.pets.find((p) => p.role === "main");
  const floorInfo = await pet.main("const { screen } = require('electron'); const d = screen.getPrimaryDisplay(); return { wa: d.workArea, b: d.bounds, scale: d.scaleFactor };");
  const floor = floorInfo.wa.y + floorInfo.wa.height;
  console.log("display", JSON.stringify(floorInfo));

  // 1. settles on the floor at start
  let s = await pet.waitFor((s) => main(s).state === "ground", 8000, "landing at start");
  let m = main(s);
  check(results, "starts on the floor", m.surface.kind === "floor" && Math.abs(m.y + 0.8 * m.s - floor) <= 2, `y=${m.y} floor=${floor}`);
  await pet.capture("rest.png");

  // 2. drop from high up: falls, bounces, lands
  pet.send({ cmd: "place", x: 600, y: 50, state: "air" });
  await pet.waitFor((s) => main(s).state === "air", 3000, "in the air");
  let sawBounceUp = false, t0 = Date.now();
  while (Date.now() - t0 < 4000) { const st = pet.state(); const mm = st && main(st); if (mm && mm.state === "air" && mm.vy < -100 && mm.y > 300) sawBounceUp = true; if (mm && mm.state === "ground" && Date.now() - t0 > 500) break; await sleep(40); }
  s = pet.state(); m = main(s);
  check(results, "falls and lands on the floor", m.state === "ground" && Math.abs(m.y + 0.8 * m.s - floor) <= 2, `state=${m.state} y=${m.y}`);
  check(results, "bounces when dropped from high", sawBounceUp);

  // 3. throw sideways: hits the screen edge, comes back, lands
  pet.send({ cmd: "place", x: floorInfo.wa.width - 400, y: 300, vx: 2200, vy: -900, state: "air" });
  await pet.waitFor((s) => main(s).state === "air", 3000, "in the air");
  s = await pet.waitFor((s) => main(s).state === "ground", 6000, "landing after throw");
  m = main(s);
  check(results, "thrown at the edge stays on screen", m.x + m.s / 2 <= floorInfo.b.x + floorInfo.b.width && m.x + m.s / 2 >= floorInfo.b.x, `x=${m.x}`);

  // 4. sit on a window title bar
  const winProc = openTestWindow();
  let hwnd = "";
  for (let i = 0; i < 40 && !hwnd; i++) { await sleep(250); hwnd = findWindow("EchoBot test window"); }
  check(results, "test window opened", !!hwnd && hwnd !== "0", hwnd);
  moveWindow(hwnd, 300, 450, 700, 400);
  await pet.waitFor((s) => s.world.windows.some((w) => Math.abs(w.y - 450) < 12 && Math.abs(w.x - 300) < 12), 5000, "helper sees the window");
  const w = pet.state().world.windows.find((w) => Math.abs(w.y - 450) < 12);
  pet.send({ cmd: "place", x: w.x + 200, y: 80, state: "air" });
  await pet.waitFor((s) => main(s).state === "air", 3000, "in the air");
  s = await pet.waitFor((s) => main(s).state === "ground", 5000, "landing on window");
  m = main(s);
  check(results, "lands on the window's title bar", m.surface.kind === "win" && Math.abs(m.y + 0.8 * m.s - w.y) <= 2, `surface=${m.surface.kind} feet=${m.y + 0.8 * m.s} top=${w.y}`);
  await pet.capture("on-window.png");

  // 5. ride along when the window moves
  const before = m.x;
  moveWindow(hwnd, 500, 380, 700, 400);
  s = await pet.waitFor((s) => { const mm = main(s); return mm.state === "ground" && Math.abs(mm.x - (before + 200)) <= 3; }, 4000, "riding along");
  m = main(s);
  const w2 = s.world.windows.find((x) => Math.abs(x.x - 500) < 12) || {};
  check(results, "rides along when the window moves", Math.abs(m.x - (before + 200)) <= 3 && Math.abs(m.y + 0.8 * m.s - w2.y) <= 3, `x ${before}→${m.x}, feet=${m.y + 0.8 * m.s} top=${w2.y}`);

  // 6. window minimised: falls to the floor
  minimizeWindow(hwnd);
  s = await pet.waitFor((s) => { const mm = main(s); return mm.state === "ground" && mm.surface.kind === "floor"; }, 5000, "falling after minimise");
  check(results, "falls when the window is minimised", true);
  try { winProc.kill(); } catch {}
  await sleep(500);

  // 7. jump up onto a window from the floor
  const winProc2 = openTestWindow("EchoBot test window 2");
  let h2 = "";
  for (let i = 0; i < 40 && !h2; i++) { await sleep(250); h2 = findWindow("EchoBot test window 2"); }
  moveWindow(h2, 900, 560, 600, 300);
  await pet.waitFor((s) => s.world.windows.some((w) => Math.abs(w.y - 560) < 12), 5000, "helper sees window 2");
  m = main(pet.state());
  pet.send({ cmd: "place", x: 1000, y: floor - 0.8 * m.s, state: "ground" });
  await sleep(300);
  pet.send({ cmd: "jumpTo", x: 1200, y: 560 });
  await pet.waitFor((s) => main(s).state === "air", 3000, "jumping");
  s = await pet.waitFor((s) => { const mm = main(s); return mm.state === "ground" && mm.surface.kind === "win"; }, 5000, "jumping onto window");
  check(results, "jumps up onto a window", true);
  try { winProc2.kill(); } catch {}
  await sleep(600);
  s = await pet.waitFor((s) => main(s).surface.kind === "floor" && main(s).state === "ground", 5000, "falling after window closes");
  check(results, "falls when the window closes", true);

  // 8. peek from the right edge, then come back
  pet.send({ cmd: "peek", side: "right", ms: 1500 });
  s = await pet.waitFor((s) => main(s).state === "peek", 3000, "peeking");
  m = main(s);
  check(results, "peeks from the screen edge", m.x + m.s * 0.38 >= floorInfo.b.x + floorInfo.b.width - 2, `x=${m.x}`);
  await pet.capture("peek.png");
  s = await pet.waitFor((s) => main(s).state === "ground", 5000, "back from peeking");
  check(results, "comes back after peeking", true);

  // 9. a normal wander decision doesn't crash and keeps it on screen
  for (let i = 0; i < 6; i++) { pet.send({ cmd: "think" }); await sleep(1800); }
  s = pet.state(); m = main(s);
  check(results, "wandering keeps it on screen", m.x > -m.s && m.x < floorInfo.b.width, `x=${m.x} state=${m.state}`);
} catch (e) {
  check(results, "no errors", false, e.message);
} finally {
  console.log("debug folder:", pet.dir);
  await pet.quit();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
