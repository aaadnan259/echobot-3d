// Phase 5: the settings window and personality presets, driven through the real UI.
import { launch, sleep, check } from "./harness.mjs";
import fs from "fs";
import path from "path";

const results = [];
const pet = await launch({ name: "settings", settings: { wander: false, care: { coins: 100, xp: 0, energy: 70, happiness: 70 } } });
const inSettings = (js) => pet.main(`const w = require('electron').BrowserWindow.getAllWindows().find(w => w.getTitle() === 'EchoBot settings'); return await w.webContents.executeJavaScript(${JSON.stringify("{ " + js + " }")});`, 8000);
try {
  await pet.main("api.openSettings(); return true;");
  await sleep(2500);
  let title = await inSettings("document.title");
  check(results, "settings window opens", title === "EchoBot settings");
  for (const tab of ["general", "reactions", "focus", "chat", "shop", "fun", "calendar"]) {
    await inSettings(`document.querySelector('nav button[data-tab="${tab}"]').click(); true`);
    await sleep(400);
    await pet.main(`const w = require('electron').BrowserWindow.getAllWindows().find(w => w.getTitle() === 'EchoBot settings'); const img = await w.webContents.capturePage(); require('fs').writeFileSync(require('path').join(process.env.PET_DEBUG, 'settings-${tab}.png'), img.toPNG()); return true;`);
  }

  // personality presets
  await inSettings(`document.querySelector('nav button[data-tab="general"]').click(); document.querySelector('.preset[data-p="Chaotic"]').click(); true`);
  await sleep(600);
  let s = await pet.main("const s = api.store.get(); return { p: s.personality, c: s.chattiness, w: s.wanderSpeed, pers: api.store.personality() };");
  check(results, "Chaotic preset applies", s.p === "Chaotic" && s.c === 1.6 && s.pers.mischief === 2.5, JSON.stringify(s));
  await inSettings(`document.querySelector('.preset[data-p="Calm"]').click(); true`);
  await sleep(600);
  s = await pet.main("return api.store.get().personality;");
  check(results, "Calm preset applies", s === "Calm");

  // size
  await inSettings(`const el = document.querySelector('[data-key="size"]'); el.value = 'Large'; el.dispatchEvent(new Event('change')); true`);
  await sleep(800);
  let st = pet.state();
  check(results, "size change resizes EchoBot", st.pets[0].s === 310, st.pets[0].s);
  await inSettings(`const el = document.querySelector('[data-key="size"]'); el.value = 'Medium'; el.dispatchEvent(new Event('change')); true`);

  // sound segmented control
  await inSettings(`document.querySelector('#soundSeg button[data-v="music"]').click(); true`);
  await sleep(500);
  check(results, "sound: PC music option", pet.state().settings.sound === "music");
  await inSettings(`document.querySelector('#soundSeg button[data-v="off"]').click(); true`);

  // nested setting (reminders)
  await inSettings(`const el = document.querySelector('[data-key="water.on"]'); el.checked = true; el.dispatchEvent(new Event('change')); true`);
  await sleep(500);
  s = await pet.main("return api.store.get().water;");
  check(results, "reminder switches save (and keep the interval)", s.on === true && s.every === 60, JSON.stringify(s));
  await inSettings(`document.getElementById('addReminder').click(); true`);
  await sleep(500);
  s = await pet.main("return api.store.get().customReminders;");
  check(results, "add your own reminder", s.length === 1);

  // shop through the UI
  await inSettings(`document.querySelector('nav button[data-tab="shop"]').click(); true`);
  await sleep(400);
  const before = (await pet.main("return api.store.get().care.coins;"));
  await inSettings(`[...document.querySelectorAll('#shopHat .item')].find(d => d.textContent.includes('Party hat')).querySelector('button').click(); true`);
  await sleep(900);
  s = await pet.main("const s = api.store.get(); return { hat: s.hat, coins: s.care.coins };");
  check(results, "buy a hat from the shop", s.hat === "party" && s.coins === before - 15, JSON.stringify(s));
  const lockedDisabled = await inSettings(`[...document.querySelectorAll('#shopHat .item')].find(d => d.textContent.includes('Crown')).querySelector('button').disabled`);
  check(results, "locked items can't be bought", lockedDisabled === true);

  // behave / mischief
  await inSettings(`document.querySelector('nav button[data-tab="fun"]').click(); const b = document.getElementById('behave'); b.checked = false; b.dispatchEvent(new Event('change')); true`);
  await sleep(500);
  check(results, "Behave off turns mischief on", pet.state().features.mischief.on === true);
  await inSettings(`const b = document.getElementById('behave'); b.checked = true; b.dispatchEvent(new Event('change')); true`);

  // friend switch
  await inSettings(`const el = document.querySelector('[data-key="friend"]'); el.checked = true; el.dispatchEvent(new Event('change')); true`);
  st = await pet.waitFor((s) => s.pets.length === 2, 5000, "friend from settings");
  check(results, "friend switch adds a friend", true);
  await inSettings(`const el = document.querySelector('[data-key="friend"]'); el.checked = false; el.dispatchEvent(new Event('change')); true`);
  st = await pet.waitFor((s) => s.pets.length === 1, 5000, "friend removed");

  // birthday
  await inSettings(`document.getElementById('bdMonth').value = '03'; document.getElementById('bdDay').value = '14'; document.getElementById('bdDay').dispatchEvent(new Event('change')); true`);
  await sleep(500);
  check(results, "birthday saves", (await pet.main("return api.store.get().birthday;")) === "03-14");

  // chat key through the UI stays hidden
  await inSettings(`document.getElementById('apiKey').value = 'sk-ant-test-123'; document.getElementById('saveKey').click(); true`);
  await sleep(800);
  const view = await inSettings(`document.getElementById('keyState').textContent`);
  const pub = await pet.main("return JSON.stringify(api.store.publicView());");
  check(results, "API key saved, never shown back to the page", view.includes("Key saved") && !pub.includes("sk-ant-test"), view);
  const uiErrors = await pet.main("const w = require('electron').BrowserWindow.getAllWindows().find(w => w.getTitle() === 'EchoBot settings'); return w ? 'open' : 'closed';");
  check(results, "settings window still healthy", uiErrors === "open");
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
