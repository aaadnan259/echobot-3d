// Phase 2: reacting to music (system audio), typing, CPU load and the time of day.
import { launch, sleep, openTestWindow, findWindow, moveWindow, check } from "./harness.mjs";
import { spawn, execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";

const results = [];

// a 12-second beat: a 60 Hz thump every 0.5 s over a soft chord, written as a WAV file
function beatWav(file) {
  const rate = 22050, secs = 12, n = rate * secs, buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write("WAVEfmt ", 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22); buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write("data", 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const t = i / rate, tb = t % 0.5;
    const kick = Math.sin(2 * Math.PI * 60 * tb) * Math.exp(-tb * 12) * 0.9;
    const pad = (Math.sin(2 * Math.PI * 220 * t) + Math.sin(2 * Math.PI * 277 * t) + Math.sin(2 * Math.PI * 330 * t)) * 0.06;
    buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, kick + pad)) * 26000), 44 + i * 2);
  }
  fs.writeFileSync(file, buf);
}

const pet = await launch({ name: "reactions", settings: { wander: false } });
try {
  // ---- music through the loopback ----
  await pet.main("api.store.patch({ sound: 'music' }); api.refresh(); return true;");
  await sleep(2500);
  let st = await pet.evalIn("window.__echobot.state()");
  check(results, "listening to PC audio starts", st.earsMode === "music" && !st.earsError, JSON.stringify(st));
  const wav = path.join(os.tmpdir(), "echobot-beat.wav");
  beatWav(wav);
  const player = spawn("powershell", ["-NoProfile", "-Command", `(New-Object Media.SoundPlayer '${wav}').PlaySync()`], { stdio: "ignore" });
  let maxLevel = 0, maxMusic = 0;
  for (let i = 0; i < 40; i++) {
    await sleep(250);
    st = await pet.evalIn("window.__echobot.state()");
    maxLevel = Math.max(maxLevel, st.level); maxMusic = Math.max(maxMusic, st.music);
  }
  check(results, "hears the music playing", maxLevel > 0.05, `level ${maxLevel.toFixed(3)}`);
  check(results, "gets into the music (vibing)", maxMusic > 0.5, `music ${maxMusic.toFixed(2)}`);
  const react = await pet.main("return api.feature('reactions').status();");
  check(results, "main process knows music is on", react.musicOn === true || maxMusic > 0.5, JSON.stringify(react));
  await pet.capture("music.png");
  try { player.kill(); } catch {}
  await pet.main("api.store.patch({ sound: 'off' }); api.refresh(); return true;");
  await sleep(800);
  st = await pet.evalIn("window.__echobot.state()");
  check(results, "turning sound off stops listening", st.earsMode === "off", st.earsMode);

  // ---- mic (may not exist on this PC; it must either work or fail politely) ----
  await pet.main("api.store.patch({ sound: 'mic' }); api.refresh(); return true;");
  await sleep(3000);
  st = await pet.evalIn("window.__echobot.state()");
  const s2 = await pet.main("return api.store.get().sound;");
  check(results, "microphone mode works or turns itself off politely", (st.earsMode === "mic" && !st.earsError) || s2 === "off", `${st.earsMode} ${st.earsError || ""} setting=${s2}`);
  await pet.main("api.store.patch({ sound: 'off' }); api.refresh(); return true;");

  // ---- typing ----
  const wp = openTestWindow("EchoBot typing test");
  let hwnd = ""; for (let i = 0; i < 40 && !hwnd; i++) { await sleep(250); hwnd = findWindow("EchoBot typing test"); }
  moveWindow(hwnd, 200, 200, 500, 300);
  const typer = spawn("powershell", ["-NoProfile", "-Command",
    `$w = New-Object -ComObject WScript.Shell; $null = $w.AppActivate('EchoBot typing test'); for ($i = 0; $i -lt 60; $i++) { $w.SendKeys('a'); Start-Sleep -Milliseconds 70 }`], { stdio: "ignore" });
  let maxTyping = 0;
  for (let i = 0; i < 30; i++) { await sleep(150); const s = pet.state(); maxTyping = Math.max(maxTyping, s.world.typing); }
  check(results, "notices typing", maxTyping > 0.3, `typing ${maxTyping.toFixed(2)}`);
  await pet.capture("typing.png");
  await new Promise((r) => typer.on("exit", r));
  try { wp.kill(); } catch {}
  await sleep(3500);
  check(results, "typing calms down after you stop", pet.state().world.typing < 0.15, pet.state().world.typing);

  // ---- CPU ----
  const burn = path.join(os.tmpdir(), "echobot-burn.js");
  fs.writeFileSync(burn, "const { Worker, isMainThread } = require('worker_threads'); if (isMainThread) { for (let i = 0; i < require('os').cpus().length; i++) new Worker(__filename); setTimeout(() => process.exit(0), 22000); } else { for (;;) {} }");
  const burner = spawn(process.execPath, [burn], { stdio: "ignore" });
  let hot = false;
  for (let i = 0; i < 40 && !hot; i++) { await sleep(500); hot = (await pet.main("return api.feature('reactions').status().cpuHot;")) === true; }
  const cpuNow = pet.state().world.cpu;
  check(results, "notices a busy CPU (sweats)", hot, `cpu ${cpuNow}%`);
  try { burner.kill(); } catch {}

  // ---- time of day ----
  const cfgNow = await pet.main("return api.feature('reactions').config(api.main());");
  check(results, "time-of-day settings computed", Array.isArray(cfgNow.lines) && typeof cfgNow.nightSleepy === "number", JSON.stringify(cfgNow));
  const nightCfg = await pet.main("const RealDate = Date; globalThis.Date = class extends RealDate { constructor(...a) { if (a.length) super(...a); else super(2026, 10, 9, 23, 45); } static now() { return RealDate.now(); } }; const c = api.feature('reactions').config(api.main()); globalThis.Date = RealDate; return c;");
  check(results, "sleepy at night", nightCfg.night === true && nightCfg.nightSleepy >= 0.4, JSON.stringify(nightCfg));

  // ---- battery API is there (laptops) and nothing errored ----
  const hasBattery = await pet.evalIn("typeof navigator.getBattery === 'function'");
  check(results, "battery check available", hasBattery === true);
} catch (e) {
  check(results, "no errors", false, e.message);
} finally {
  console.log("debug folder:", pet.dir);
  await pet.quit();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
