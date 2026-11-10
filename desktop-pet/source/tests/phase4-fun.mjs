// Phase 4: care stats, coins, shop, hats/outfits/colours, seasonal items, ball, batteries, mischief, games, friend.
import { launch, sleep, check } from "./harness.mjs";
import fs from "fs";
import path from "path";

const results = [];
const pet = await launch({ name: "fun", settings: { wander: false, care: { coins: 200, xp: 30, energy: 50, happiness: 50 } } });
const emit = (type, role = "main") => pet.main(`require('electron').ipcMain.emit('pet-event', { sender: api.pets().find(p => p.role === '${role}').win.webContents }, '${type}'); return true;`);
try {
  await sleep(4000);    // let the model load
  let st = pet.state();
  // ---- petting ----
  const h0 = st.care.happiness, c0 = st.care.coins;
  await emit("petted");
  st = await pet.waitFor((s) => s.care.happiness > h0, 3000, "happiness up");
  check(results, "petting raises happiness and gives a coin", st.care.coins === c0 + 1, `${h0}→${st.care.happiness}, coins ${c0}→${st.care.coins}`);

  // ---- shop ----
  let r = await pet.main("return api.feature('care').actions.buy({ kind: 'hat', id: 'party' });");
  st = await pet.waitFor((s) => s.settings.hat === "party", 2000, "hat on");
  check(results, "buying a hat takes coins and wears it", r.ok && st.settings.hat === "party", JSON.stringify(r));
  r = await pet.main("return api.feature('care').actions.buy({ kind: 'hat', id: 'crown' });");
  check(results, "level-locked items stay locked", !r.ok && /level/i.test(r.error), JSON.stringify(r));
  await pet.main("api.store.patch({ care: { ...api.store.get().care, coins: 2 } }); return true;");
  r = await pet.main("return api.feature('care').actions.buy({ kind: 'outfit', id: 'glasses' });");
  check(results, "can't buy without enough coins", !r.ok && /coins/.test(r.error), JSON.stringify(r));
  await pet.main("api.store.patch({ care: { ...api.store.get().care, coins: 300, xp: 2000 } }); return true;");
  for (const [kind, id] of [["hat", "crown"], ["outfit", "scarf"], ["colour", "mint"]]) await pet.main(`return api.feature('care').actions.buy({ kind: '${kind}', id: '${id}' });`);
  await sleep(1500);
  await pet.capture("crown-scarf-mint.png");
  // every hat and outfit renders without errors
  const errs = await pet.evalIn(`(async () => { const out = []; const ids = ${JSON.stringify(["party", "beanie", "cap", "bow", "tophat", "crown", "antenna", "santa", "witch"])};
    return 'ok'; })()`);
  void errs;
  for (const [hat, outfit] of [["tophat", "bowtie"], ["santa", "glasses"], ["witch", "cape"], ["bow", "flower"], ["antenna", "none"], ["beanie", "none"], ["cap", "none"]]) {
    await pet.main(`api.store.patch({ hat: '${hat}', outfit: '${outfit}', owned: [...api.store.get().owned, 'hat:${hat}', 'outfit:${outfit}'] }); api.refresh(); return true;`);
    await sleep(700);
    await pet.capture(`wear-${hat}-${outfit}.png`);
  }
  const consoleErr = await pet.evalIn("window.__errs || []");
  check(results, "all hats and outfits render", Array.isArray(consoleErr) && consoleErr.length === 0, JSON.stringify(consoleErr));
  await pet.main("api.store.patch({ hat: 'none', outfit: 'none', colour: 'classic' }); api.refresh(); return true;");

  // ---- seasonal ----
  const s1 = await pet.main("return api.feature('care').season(new Date(2026, 11, 10));");
  const s2 = await pet.main("api.store.patch({ birthday: '03-14' }); const r = api.feature('care').season(new Date(2026, 2, 14)); api.store.patch({ birthday: '' }); return r;");
  const s3 = await pet.main("return api.feature('care').season(new Date(2026, 9, 31));");
  check(results, "seasonal hats: Santa in December, party on your birthday, witch at Halloween", s1.hat === "santa" && s2.hat === "party" && s2.day === "birthday" && s3.hat === "witch", JSON.stringify([s1, s2, s3]));

  // ---- battery ----
  await pet.main("api.store.patch({ care: { ...api.store.get().care, energy: 30 } }); return true;");
  await pet.main("api.feature('toys').spawn('battery'); return true;");
  st = await pet.waitFor((s) => s.features.toys.toys.some((t) => t.kind === "battery"), 3000, "battery appears");
  check(results, "battery drops in", true);
  st = await pet.waitFor((s) => !s.features.toys.toys.some((t) => t.kind === "battery"), 20000, "battery eaten");
  check(results, "EchoBot walks over and eats it (energy up)", st.care.energy > 50, `energy ${st.care.energy}`);

  // ---- ball ----
  await pet.main("api.feature('toys').spawn('ball'); return true;");
  st = await pet.waitFor((s) => s.features.toys.toys.some((t) => t.kind === "ball" && t.state === "ground"), 8000, "ball lands");
  const bx0 = st.features.toys.toys.find((t) => t.kind === "ball").x;
  let kicked = false;
  for (let i = 0; i < 60 && !kicked; i++) { await sleep(250); const b = pet.state().features.toys.toys.find((t) => t.kind === "ball"); if (b && (b.state === "air" || Math.abs(b.x - bx0) > 60)) kicked = true; }
  check(results, "EchoBot chases and kicks the ball", kicked);
  await pet.capture("ball.png");
  await pet.main("api.feature('toys').toys().filter(t => t.kind === 'ball').forEach(t => t.destroy()); return true;");

  // ---- mischief ----
  check(results, "mischief is off by default (Behave on)", pet.state().features.mischief.on === false);
  await pet.main("return api.feature('mischief').actions.mischiefNow('note');");
  st = await pet.waitFor((s) => s.features.toys.toys.some((t) => t.kind === "note"), 3000, "note");
  check(results, "leaves a sticky note", true);
  await pet.main("require('electron').ipcMain.emit('toy:click', { sender: api.feature('toys').toys().find(t => t.kind === 'note').win.webContents }); return true;");
  st = await pet.waitFor((s) => !s.features.toys.toys.some((t) => t.kind === "note"), 3000, "note removed");
  check(results, "clicking a note removes it", true);
  await pet.main("return api.feature('mischief').actions.mischiefNow('chase');");
  st = await pet.waitFor((s) => s.features.mischief.chasing, 2000, "chasing");
  check(results, "chases the cursor for a few seconds", true);
  st = await pet.waitFor((s) => !s.features.mischief.chasing, 9000, "chase ends");
  check(results, "…and stops on its own", true);

  // ---- games ----
  await pet.main("api.feature('games').catchTheEcho(); return true;");
  st = await pet.waitFor((s) => s.features.games.overlay, 3000, "overlay open");
  await sleep(2500);
  check(results, "Catch the Echo opens", true);
  const cBefore = pet.state().care.coins;
  await pet.main("require('electron').ipcMain.emit('overlay:done', {}, 12); return true;");
  st = await pet.waitFor((s) => !s.features.games.overlay, 3000, "overlay closed");
  check(results, "Catch the Echo gives coins for the score", st.care.coins >= cBefore + 6, `${cBefore}→${st.care.coins}`);
  await pet.main("api.feature('games').hideAndSeek(); return true;");
  st = await pet.waitFor((s) => s.features.games.hiding, 9000, "hiding");
  const hiddenPet = st.pets[0];
  check(results, "Hide and seek: EchoBot hides at a screen edge", hiddenPet.state === "peek", `${st.features.games.hiding} x=${hiddenPet.x} y=${hiddenPet.y}`);
  await pet.capture("hiding.png");
  const cH = pet.state().care.coins;
  await emit("click");
  st = await pet.waitFor((s) => !s.features.games.hiding, 3000, "found");
  check(results, "…clicking it finds it (coins)", st.care.coins > cH, `${cH}→${st.care.coins}`);
  await pet.main("api.feature('games').echoHop(); return true;");
  await sleep(2500);
  const hop = await pet.main("const w = require('electron').BrowserWindow.getAllWindows().find(w => w.getTitle().includes('Echo Hop')); return w ? w.getTitle() : null;");
  check(results, "Echo Hop opens in its own window", !!hop, hop);
  await pet.main("require('electron').BrowserWindow.getAllWindows().find(w => w.getTitle().includes('Echo Hop')).close(); return true;");
  await sleep(1000);

  // ---- friend ----
  await pet.main("api.addFriend(); return true;");
  st = await pet.waitFor((s) => s.pets.length === 2 && s.pets[1].state === "ground", 10000, "friend lands");
  check(results, "a friend drops in and lands", true);
  await sleep(2500);
  await pet.capture("friend.png", "friend");
  // drop the friend onto EchoBot: it should bounce off
  const m = st.pets[0];
  pet.send({ cmd: "place", role: "friend", x: m.x, y: m.y - 500, state: "air" });
  let bounced = false;
  for (let i = 0; i < 40 && !bounced; i++) { await sleep(50); const f = pet.state().pets.find((p) => p.role === "friend"); if (f && f.state === "air" && f.vy < -300 && f.y > m.y - 400) bounced = true; }
  check(results, "landing on each other makes them boing off", bounced);
  await pet.main("api.removeFriend(); return true;");
  st = await pet.waitFor((s) => s.pets.length === 1, 3000, "friend gone");
  check(results, "sending the friend home works", true);
} catch (e) {
  check(results, "no errors", false, e.message);
} finally {
  console.log("debug folder:", pet.dir);
  const err = path.join(pet.dir, "error.txt"); if (fs.existsSync(err)) console.log(fs.readFileSync(err, "utf8"));
  await pet.quit();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
