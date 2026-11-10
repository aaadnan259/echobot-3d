// Phase 3: focus timer, reminders, calendar pop-ups, chat (against a local stand-in for the Claude API),
// hiding for fullscreen apps and the Do Not Disturb hotkey.
import { launch, sleep, check } from "./harness.mjs";
import http from "http";
import fs from "fs";
import path from "path";
import os from "os";
import { spawn } from "child_process";

const results = [];
// a local stand-in for the Claude API: records requests, answers like Claude would
const seen = [];
const server = http.createServer((req, res) => {
  let body = ""; req.on("data", (c) => (body += c)); req.on("end", () => {
    seen.push({ url: req.url, headers: req.headers, body: JSON.parse(body || "{}") });
    const auth = req.headers["x-api-key"] || String(req.headers["authorization"] || "").replace(/^Bearer /, "");
    if (auth !== "test-key-not-real") { res.writeHead(401, { "content-type": "application/json" }); res.end(JSON.stringify({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } })); return; }
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ id: "msg_test", type: "message", role: "assistant", model: "claude-opus-5-5", stop_reason: "end_turn",
      content: [{ type: "text", text: "[happy] [do:dance] [color:green] [name:Adnan] [remember:likes robots]\nHi Adnan! Watch me dance in green!" }],
      usage: { input_tokens: 10, output_tokens: 10 } }));
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

// a local stand-in for the EchoBot website: sessions, SSE replies, a slow first wake-up, an expiring token, rate limits
const site = { sessions: 0, chats: [], mode: "ok", slowFirst: true };
const siteServer = http.createServer((req, res) => {
  let body = ""; req.on("data", (c) => (body += c)); req.on("end", async () => {
    if (req.url === "/api/session") {
      if (site.slowFirst) { site.slowFirst = false; await new Promise((r) => setTimeout(r, 6000)); }
      site.sessions++;
      res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ token: "tok" + site.sessions, expiresIn: 3600 })); return;
    }
    if (req.url === "/api/gemini/chat") {
      const b = JSON.parse(body); site.chats.push({ auth: req.headers.authorization, body: b });
      if (site.mode === "expire" && req.headers.authorization === "Bearer tok1") { res.writeHead(401); res.end('{"detail":"Invalid or expired token"}'); return; }
      if (site.mode === "429") { res.writeHead(429, { "content-type": "application/json" }); res.end('{"error":"rate limited"}'); return; }
      res.writeHead(200, { "content-type": "text/event-stream" });
      const sse = (o) => "data: " + JSON.stringify(o) + "\n\n";
      if (site.mode === "safety") { res.end(sse({ error: "safety" })); return; }
      res.write(sse({ text: "[happy] [do:hop] [name:Sam]\nHello Sam, " }));
      res.write(sse({ text: "nice to meet you!" }));
      res.end(sse({ done: true }));
      return;
    }
    res.writeHead(404); res.end();
  });
});
await new Promise((r) => siteServer.listen(0, "127.0.0.1", r));
const siteBase = `http://127.0.0.1:${siteServer.address().port}`;

const pet = await launch({ name: "useful", settings: { wander: false }, env: { ANTHROPIC_BASE_URL: base, ECHOBOT_SITE_URL: siteBase } });
try {
  // ---- focus timer ----
  await pet.main("api.feature('focus').start(0.05); return true;");     // 3 seconds
  let st = pet.state();
  st = await pet.waitFor((s) => s.features.focus && s.features.focus.mode === "focus", 3000, "focus on");
  check(results, "focus starts and EchoBot goes quiet", st.quiet === true);
  const cfg = await pet.main("return api.feature('focus').config();");
  check(results, "headphones on during focus", cfg.focus === true);
  await pet.capture("focus.png");
  st = await pet.waitFor((s) => s.features.focus.mode === "break", 8000, "break after focus");
  check(results, "focus ends, celebrates and starts a break", st.care.coins > 20, `coins ${st.care.coins}`);
  await pet.main("api.feature('focus').stop(true); return true;");

  // ---- reminders ----
  await pet.main("api.store.patch({ water: { on: true, every: 0.02 } }); return true;");
  st = await pet.waitFor((s) => s.features.reminders.pending === "water", 6000, "water reminder");
  check(results, "water reminder appears", true);
  const coinsBefore = st.care.coins;
  pet.send({ cmd: "main", js: "require('electron').ipcMain.emit('pet-event', { sender: api.main().win.webContents }, 'click'); return true;", out: "x.json" });
  st = await pet.waitFor((s) => !s.features.reminders.pending, 4000, "reminder done");
  check(results, "clicking EchoBot marks the reminder done (+1 coin)", st.care.coins === coinsBefore + 1, `${coinsBefore}→${st.care.coins}`);
  await pet.main("api.store.patch({ water: { on: false, every: 60 } }); return true;");
  const hm = new Date(Date.now()); const t = `${String(hm.getHours()).padStart(2, "0")}:${String(hm.getMinutes()).padStart(2, "0")}`;
  await pet.main(`api.store.patch({ customReminders: [{ time: '${t}', text: 'Call mum', on: true }] }); return true;`);
  st = await pet.waitFor((s) => s.features.reminders.pending === "custom", 4000, "custom reminder");
  check(results, "own reminder at a set time appears", true);

  // ---- calendar ----
  const ics = path.join(os.tmpdir(), "echobot-test.ics");
  const pad = (n) => String(n).padStart(2, "0");
  const soon = new Date(Date.now() + 5 * 60000), fmt = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
  const weekly = new Date(Date.now() - 7 * 86400000 + 3 * 60000);
  fs.writeFileSync(ics, ["BEGIN:VCALENDAR", "VERSION:2.0",
    "BEGIN:VEVENT", "SUMMARY:Team sync", `DTSTART;TZID=Europe/London:${fmt(soon)}`, "END:VEVENT",
    "BEGIN:VEVENT", "SUMMARY:Weekly 1:1", `DTSTART:${fmt(weekly)}`, "RRULE:FREQ=WEEKLY", "END:VEVENT",
    "BEGIN:VEVENT", "SUMMARY:Old thing", "DTSTART:20200101T100000Z", "END:VEVENT",
    "END:VCALENDAR"].join("\r\n"));
  await pet.main(`api.store.patch({ calendar: { on: true, source: ${JSON.stringify(ics)}, minutesBefore: 10 } }); return true;`);
  const cal = await pet.main("return await api.feature('calendar').actions.reloadCalendar();");
  check(results, "calendar file is read", cal.events === 3 && !cal.error, JSON.stringify(cal));
  check(results, "repeating weekly event is found", cal.next.some((e) => e.title === "Weekly 1:1"), JSON.stringify(cal.next));
  await sleep(6000);
  const cal2 = await pet.main("return api.feature('calendar').status();");
  check(results, "pops up before the event", cal2.announced >= 2, JSON.stringify(cal2.lastAnnounced));

  // ---- chat ----
  let r = await pet.main("return await api.feature('chat').actions.testChat();");
  check(results, "chat is off until you turn it on", r.error && /off/i.test(r.error), JSON.stringify(r));
  await pet.main("api.store.patch({ chat: { on: true, provider: 'claude' } }); return true;");
  r = await pet.main("return await api.feature('chat').actions.testChat();");
  check(results, "chat asks for an API key first", r.needsKey === true, JSON.stringify(r));
  await pet.main("await api.store.setApiKey('wrong-key'); return true;");
  r = await pet.main("return await api.feature('chat').actions.testChat();", 15000);
  check(results, "a wrong key gives a clear message", r.error && /key/i.test(r.error), JSON.stringify(r));
  await sleep(800);
  const saved = fs.readFileSync(path.join(pet.dir, "userdata", "settings.json"), "utf8");
  check(results, "API key is stored encrypted, not in plain text", !saved.includes("wrong-key") && /"apiKey": "enc:/.test(saved));
  await pet.main("await api.store.setApiKey('test-key-not-real'); return true;");
  r = await pet.main("return await api.feature('chat').actions.testChat();", 15000);
  const last = seen[seen.length - 1];
  check(results, "chat reply comes back without its stage directions", r.reply === "Hi Adnan! Watch me dance in green!", JSON.stringify(r));
  check(results, "request: model, fallbacks and low effort", last.body.model === "claude-opus-5-5" && last.body.fallbacks === "default" && last.body.output_config?.effort === "low",
    JSON.stringify({ model: last.body.model, fallbacks: last.body.fallbacks, oc: last.body.output_config }));
  check(results, "request: fallback beta header", String(last.headers["anthropic-beta"] || "").includes("server-side-fallback-2026-07-01"), last.headers["anthropic-beta"]);
  check(results, "request: persona system prompt", typeof last.body.system === "string" && last.body.system.includes("desktop pet"));
  const mem = await pet.main("return api.store.get().memory;");
  check(results, "remembers your name and facts", mem.name === "Adnan" && mem.facts.includes("likes robots") && mem.recent.length === 2, JSON.stringify(mem));
  const colour = await pet.main("return api.feature('chat').config().colour;");
  check(results, "can change colour on request", colour && colour.hue !== 0, JSON.stringify(colour));
  r = await pet.main("return await api.feature('chat').actions.testChat();", 15000);
  check(results, "sends recent conversation for context", seen[seen.length - 1].body.messages.length === 3, seen[seen.length - 1].body.messages.length);
  await pet.main("api.feature('chat').actions.forgetMe(); return true;");
  const mem2 = await pet.main("return api.store.get().memory;");
  check(results, "Forget me wipes memory", !mem2.name && !mem2.facts.length && !mem2.recent.length);
  // ---- free website chat (the default) ----
  check(results, "the free EchoBot website is the default chat", (await pet.main("return api.store.DEFAULTS.chat.provider;")) === "website");
  await pet.main("api.store.patch({ chat: { provider: 'website' } }); return true;");
  const said = await pet.main("globalThis.__said = []; const o = api.say; api.say = (t, x) => { globalThis.__said.push(t); return o(t, x); }; return true;");
  void said;
  r = await pet.main("return await api.feature('chat').actions.testChat();", 30000);
  const wakeMsg = await pet.main("return globalThis.__said.find(t => /Waking up/.test(t)) || null;");
  check(results, "website chat replies (stream joined, tags removed)", r.reply === "Hello Sam, nice to meet you!", JSON.stringify(r));
  check(results, "shows 'waking up' while the website starts", !!wakeMsg, wakeMsg);
  const sent = site.chats[site.chats.length - 1];
  check(results, "website request: token, persona and message", sent.auth === "Bearer tok1" && sent.body.systemInstruction.includes("desktop pet") && sent.body.newMessage.includes("Say hi") && sent.body.modelName === "gemini-3.6-flash", JSON.stringify({ auth: sent.auth, model: sent.body.modelName }));
  check(results, "website chat also remembers and moves", (await pet.main("return api.store.get().memory.name;")) === "Sam");
  r = await pet.main("return await api.feature('chat').actions.testChat();", 15000);
  const sent2 = site.chats[site.chats.length - 1];
  check(results, "sends history in the website's format", sent2.body.history.length === 2 && sent2.body.history[1].role === "model" && !!sent2.body.history[1].text, JSON.stringify(sent2.body.history.map((h) => h.role)));
  check(results, "reuses its session token", site.sessions === 1, site.sessions);
  site.mode = "expire";
  r = await pet.main("return await api.feature('chat').actions.testChat();", 15000);
  check(results, "expired token: gets a new one and retries once", r.reply && site.sessions === 2, JSON.stringify(r) + " sessions " + site.sessions);
  site.mode = "429";
  r = await pet.main("return await api.feature('chat').actions.testChat();", 15000);
  check(results, "rate limit gives a friendly message", r.error && /10 times a minute/.test(r.error), JSON.stringify(r));
  site.mode = "safety";
  r = await pet.main("return await api.feature('chat').actions.testChat();", 15000);
  check(results, "declined replies are handled", r.reply && /can't answer/.test(r.reply), JSON.stringify(r));
  site.mode = "ok";
  await pet.main("api.feature('chat').open(); return true;");
  await sleep(1500);
  const boxes = await pet.main("return require('electron').BrowserWindow.getAllWindows().filter(w => w.getTitle() === 'Chat with EchoBot').length;");
  check(results, "chat box opens", boxes === 1);

  // ---- fullscreen apps ----
  const fs1 = spawn("powershell", ["-NoProfile", "-Command", "Add-Type -AssemblyName System.Windows.Forms; $f = New-Object Windows.Forms.Form; $f.Text = 'EchoBot fullscreen test'; $f.FormBorderStyle = 'None'; $f.WindowState = 'Maximized'; $f.TopMost = $true; $f.Add_Shown({ $f.Activate() }); [Windows.Forms.Application]::Run($f)"], { stdio: "ignore" });
  st = await pet.waitFor((s) => s.world.fullscreen && s.pets[0].hidden, 12000, "hidden for fullscreen");
  check(results, "hides while a fullscreen app is in front", true);
  fs1.kill();
  st = await pet.waitFor((s) => !s.world.fullscreen && !s.pets[0].hidden, 8000, "back after fullscreen");
  check(results, "comes back after the fullscreen app closes", true);

  // ---- Do Not Disturb hotkey ----
  const reg = await pet.main("return require('electron').globalShortcut.isRegistered('Ctrl+Alt+E');");
  check(results, "Do Not Disturb hotkey registered (Ctrl+Alt+E)", reg === true);
  spawn("powershell", ["-NoProfile", "-Command", "$w = New-Object -ComObject WScript.Shell; $w.SendKeys('^%e')"], { stdio: "ignore" });
  st = await pet.waitFor((s) => s.settings.dnd === true && s.pets[0].hidden, 5000, "DND on");
  check(results, "hotkey turns Do Not Disturb on (EchoBot hides)", true);
  spawn("powershell", ["-NoProfile", "-Command", "$w = New-Object -ComObject WScript.Shell; $w.SendKeys('^%e')"], { stdio: "ignore" });
  st = await pet.waitFor((s) => s.settings.dnd === false && !s.pets[0].hidden, 5000, "DND off");
  check(results, "pressing it again brings EchoBot back", true);
} catch (e) {
  check(results, "no errors", false, e.message);
} finally {
  console.log("debug folder:", pet.dir);
  const err = path.join(pet.dir, "error.txt"); if (fs.existsSync(err)) console.log(fs.readFileSync(err, "utf8"));
  await pet.quit(); server.close(); siteServer.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
