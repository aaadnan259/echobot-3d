// EchoBot desktop pet: the main process. It owns the pets (EchoBot and, if invited, its friend), runs the
// physics loop, the tray menu and hotkey, and wires up the features in ./features/.
const { app, BrowserWindow, screen, ipcMain, Menu, Tray, nativeImage, globalShortcut, session, desktopCapturer, shell } = require("electron");
const path = require("path");
const store = require("./store");
const catalog = require("./catalog");
const worldMod = require("./world");
const { world } = worldMod;
const { Pet } = require("./pet");

// Automated tests run with their own settings folder so they never touch yours.
if (process.env.PET_DEBUG) app.setPath("userData", path.join(process.env.PET_DEBUG, "userdata"));
if (!app.requestSingleInstanceLock()) { app.quit(); }
app.commandLine.appendSwitch("disable-renderer-backgrounding");

const MOODS = [["Happy", "Happy"], ["Surprised", "Surprised"], ["LookAround", "Look around"], ["Talk", "Chatter"],
  ["Dance", "Dance"], ["Angry", "Grumpy"], ["Cry", "Cry"], ["Sleep", "Nap"]];

let tray = null;
const pets = [];                     // [main, friend?]
const features = [];
let hiddenUntil = 0, fullscreenHidden = false;
const mainPet = () => pets[0];

// ---------- the API features use ----------
const api = {
  store, catalog, world,
  pets: () => pets.filter((p) => p.alive()),
  main: () => mainPet(),
  petFor(sender) { return pets.find((p) => p.alive() && p.win.webContents === sender); },
  say(text, opts = {}) { const p = opts.pet || mainPet(); if (p) p.send("say", { text, ms: opts.ms || Math.max(4000, text.length * 90), speak: !!opts.speak, voice: opts.voice }); },
  play(mood, opts = {}) { const p = opts.pet || mainPet(); if (p) p.send("play", { name: mood, loop: !!opts.loop }); },
  fx(type, opts = {}) { const p = opts.pet || mainPet(); if (p) p.send("fx", { type, ...opts, pet: undefined }); },
  // true while EchoBot should keep quiet: Do Not Disturb, focus, hidden for 30 minutes, fullscreen apps
  quiet() { return store.get().dnd || hiddenUntil > Date.now() || fullscreenHidden || features.some((f) => f.isQuiet && f.isQuiet()); },
  visible() { return !store.get().dnd && hiddenUntil <= Date.now() && !fullscreenHidden; },
  refresh() { pushConfig(); refreshTray(); },
  feature: (name) => features.find((f) => f.name === name),
  openSettings: (tab) => openSettings(tab),
};

// The look and behaviour switches the renderer needs, merged from settings and every feature.
function configFor(pet) {
  const st = store.get();
  const colourId = pet.role === "friend" ? st.friendColour : st.colour;
  const cfg = {
    role: pet.role,
    colour: catalog.find("colour", colourId),
    hat: pet.role === "friend" ? "none" : st.hat,
    outfit: pet.role === "friend" ? "none" : st.outfit,
    chattiness: st.chattiness, personality: st.personality, pers: store.personality(),
    sound: pet.role === "main" ? st.sound : "off",
    typing: st.typing, battery: st.battery && pet.role === "main", physics: st.physics,
    quiet: api.quiet(),
    voice: st.chat.voice, mute: st.chat.mute,
  };
  for (const f of features) if (f.config) Object.assign(cfg, f.config(pet, cfg) || {});
  return cfg;
}
function pushConfig() { for (const p of api.pets()) p.send("config", configFor(p)); }

// ---------- pets ----------
function onPetEvent(pet, type, data) {
  let handled = false;
  for (const f of features) if (f.onPetEvent && f.onPetEvent(pet, type, data) === true) handled = true;
  if (handled) return;
  // the basics, unless a feature (a game, a reminder…) used the click for something else
  if (type === "click" && store.get().physics) pet.hop(45);
  if (type === "dblclick" && !store.get().chat.on) {
    const moods = ["Surprised", "LookAround", "Talk", "Dance", "Angry", "Cry", "Spin"];
    api.play(moods[Math.floor(Math.random() * moods.length)], { pet });
  }
}
function addPet(role) {
  const st = store.get();
  const pet = new Pet({ role, onEvent: onPetEvent });
  pet.win.webContents.on("did-finish-load", () => {
    pet.send("config", configFor(pet));
    if (role === "main" && st.firstRun) { api.say("Hi! Drag me anywhere, or throw me! Right-click me for options."); store.patch({ firstRun: false }); }
    for (const f of features) if (f.onPetReady) f.onPetReady(pet);
  });
  pets.push(pet);
  return pet;
}
function removePet(role) {
  const i = pets.findIndex((p) => p.role === role);
  if (i > 0) { pets[i].destroy(); pets.splice(i, 1); }
}
api.addFriend = () => { if (!pets.some((p) => p.role === "friend")) { addPet("friend"); store.patch({ friend: true }); refreshTray(); } };
api.removeFriend = () => { removePet("friend"); store.patch({ friend: false }); refreshTray(); };

// ---------- menu ----------
function menuTemplate() {
  const st = store.get();
  const extra = features.flatMap((f) => (f.menu ? f.menu() : []));
  return [
    { label: "Moods", submenu: MOODS.map(([id, label]) => ({ label, click: () => api.play(id) })) },
    ...extra,
    { type: "separator" },
    { label: "Settings and shop…", click: () => openSettings() },
    { label: "Do not disturb", type: "checkbox", checked: st.dnd, accelerator: st.dndHotkey, click: () => toggleDnd() },
    { label: "Hide for 30 minutes", click: () => { hiddenUntil = Date.now() + 30 * 60000; updateVisibility(); } },
    { label: "Show EchoBot", visible: !api.visible(), click: () => { hiddenUntil = 0; store.patch({ dnd: false }); updateVisibility(); } },
    { label: "Quit EchoBot", click: () => app.quit() },
  ];
}
function withRefresh(items) {
  return items.map((it) => {
    const o = { ...it };
    if (o.submenu) o.submenu = withRefresh(o.submenu);
    if (o.click) { const c = o.click; o.click = (...a) => { c(...a); setTimeout(() => { refreshTray(); pushConfig(); }, 50); }; }
    return o;
  });
}
function popMenu(pet) { Menu.buildFromTemplate(withRefresh(menuTemplate())).popup({ window: pet.win }); }
function refreshTray() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate(withRefresh(menuTemplate())));
  const tip = features.map((f) => (f.tooltip ? f.tooltip() : "")).filter(Boolean);
  tray.setToolTip(["EchoBot", ...tip].join("\n"));
}
api.refreshTray = refreshTray;

// ---------- visibility: DND, hide-for-30, fullscreen apps ----------
function toggleDnd() {
  const on = !store.get().dnd;
  store.patch({ dnd: on });
  updateVisibility();
  if (!on) { api.play("Happy"); api.say("I'm back!", { ms: 2500 }); }
}
function updateVisibility() {
  const show = api.visible();
  for (const p of api.pets()) show ? p.show() : p.hide();
  refreshTray(); pushConfig();
}
function registerHotkey() {
  globalShortcut.unregisterAll();
  const key = store.get().dndHotkey;
  if (key) { try { globalShortcut.register(key, toggleDnd); } catch {} }
}
api.registerHotkey = registerHotkey;

// ---------- settings window ----------
let settingsWin = null;
function openSettings(tab) {
  if (settingsWin && !settingsWin.isDestroyed()) { settingsWin.show(); settingsWin.focus(); if (tab) settingsWin.webContents.send("tab", tab); return; }
  settingsWin = new BrowserWindow({
    width: 760, height: 640, minWidth: 560, minHeight: 480, title: "EchoBot settings", icon: path.join(__dirname, "icon.png"),
    autoHideMenuBar: true, backgroundColor: "#f6f2ff", webPreferences: { preload: path.join(__dirname, "preload-settings.js") },
  });
  settingsWin.loadFile(path.join(__dirname, "settings.html"), { query: { tab: tab || "" } });
  settingsWin.on("closed", () => { settingsWin = null; });
}
api.settingsChanged = () => { if (settingsWin && !settingsWin.isDestroyed()) settingsWin.webContents.send("settings", store.publicView()); };

// ---------- IPC from EchoBot windows ----------
ipcMain.on("click-through", (e, on) => { const p = api.petFor(e.sender); if (p) p.win.setIgnoreMouseEvents(on, { forward: true }); });
ipcMain.on("drag-start", (e) => { const p = api.petFor(e.sender); if (p) { p.dragStart(); onPetEvent(p, "grabbed"); } });
ipcMain.on("drag-end", (e) => { const p = api.petFor(e.sender); if (p) p.dragEnd(); });
ipcMain.on("menu", (e) => { const p = api.petFor(e.sender); if (p) popMenu(p); });
ipcMain.on("pet-event", (e, type, data) => { const p = api.petFor(e.sender); if (p) onPetEvent(p, type, data); });

// ---------- settings window IPC ----------
ipcMain.handle("settings:get", () => ({ settings: store.publicView(), catalog: { HATS: catalog.HATS, OUTFITS: catalog.OUTFITS, COLOURS: catalog.COLOURS }, level: catalog.levelFor(store.get().care.xp),
  features: Object.fromEntries(features.filter((f) => f.status).map((f) => { try { return [f.name, f.status()]; } catch { return [f.name, null]; } })) }));
ipcMain.handle("settings:set", (_e, p) => {
  const before = store.get();
  const sizeChanged = p.size && p.size !== before.size;
  const hotkeyChanged = p.dndHotkey !== undefined && p.dndHotkey !== before.dndHotkey;
  store.patch(p);
  if (sizeChanged) api.pets().forEach((pet) => pet.setSize(p.size));
  if (hotkeyChanged) registerHotkey();
  if (p.onTop !== undefined) api.pets().forEach((pet) => pet.win.setAlwaysOnTop(p.onTop, "floating"));
  if (p.friend !== undefined) (p.friend ? api.addFriend() : api.removeFriend());
  if (p.dnd !== undefined) updateVisibility();
  for (const f of features) if (f.onSettings) f.onSettings(p);
  pushConfig(); refreshTray();
  return store.publicView();
});
ipcMain.handle("settings:action", async (_e, name, arg) => {
  if (name === "startWithWindows") { app.setLoginItemSettings({ openAtLogin: !!arg }); return app.getLoginItemSettings().openAtLogin; }
  if (name === "getStartWithWindows") return app.getLoginItemSettings().openAtLogin;
  if (name === "openUrl" && /^https:\/\//.test(arg)) { shell.openExternal(arg); return true; }
  for (const f of features) if (f.actions && f.actions[name]) return f.actions[name](arg);
  return null;
});

// ---------- system audio for the sound reactions (only used when the user turns "React to music" on) ----------
function setupAudioCapture() {
  session.defaultSession.setDisplayMediaRequestHandler((req, cb) => {
    if (store.get().sound !== "music") { cb({}); return; }
    desktopCapturer.getSources({ types: ["screen"] }).then((s) => cb({ video: s[0], audio: "loopback" })).catch(() => cb({}));
  });
  session.defaultSession.setPermissionRequestHandler((wc, perm, cb) => cb(perm === "media" ? store.get().sound !== "off" : false));
}

// ---------- the main loop ----------
let lastTick = Date.now(), frame = 0;
function loop() {
  const now = Date.now();
  const dt = Math.min(0.05, (now - lastTick) / 1000);
  lastTick = now;
  frame++;
  // auto-hide for fullscreen apps (games, videos, presentations)
  const wantHidden = store.get().hideFullscreen && world.fullscreen;
  if (wantHidden !== fullscreenHidden) { fullscreenHidden = wantHidden; updateVisibility(); }
  if (hiddenUntil && now > hiddenUntil) { hiddenUntil = 0; updateVisibility(); api.play("Surprised"); }
  const ctx = { quiet: api.quiet() };
  for (const p of api.pets()) {
    if (p.hidden) continue;
    p.step(dt);
    if (frame % 2 === 0) p.send("tick", { ...p.tickData(), typing: store.get().typing ? world.typing : 0 });
    p.think(now, ctx);
  }
  for (const f of features) if (f.tick) f.tick(now, dt);
}

app.whenReady().then(() => {
  store.load();
  setupAudioCapture();
  worldMod.start(process.pid);
  // features, in the order they get to add menu items
  const FEATURES = { focus: () => require("./features/focus"), reminders: () => require("./features/reminders"), calendar: () => require("./features/calendar"),
    chat: () => require("./features/chat"), care: () => require("./features/care"), toys: () => require("./features/toys"), games: () => require("./features/games"),
    mischief: () => require("./features/mischief"), reactions: () => require("./features/reactions"), friend: () => require("./features/friend"),
    testhooks: () => require("./features/testhooks") };
  for (const [name, load] of Object.entries(FEATURES)) {
    try { const f = load(); f.name = name; if (f.init) f.init(api); features.push(f); } catch (err) { console.error(name, err); }
  }
  addPet("main");
  if (store.get().friend) addPet("friend");
  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, "icon.png")).resize({ width: 16, height: 16 }));
  tray.on("click", () => { hiddenUntil = 0; if (store.get().dnd) store.patch({ dnd: false }); updateVisibility(); api.play("Happy"); });
  refreshTray();
  registerHotkey();
  setInterval(loop, 16);
  setInterval(refreshTray, 30000);
  screen.on("display-removed", () => api.pets().forEach((p) => { p.state = "air"; }));
});

app.on("second-instance", () => { hiddenUntil = 0; store.patch({ dnd: false }); updateVisibility(); api.play("Happy"); });
app.on("will-quit", () => { globalShortcut.unregisterAll(); worldMod.stop(); const p = mainPet(); if (p) p.savePos(true); store.saveNow(); });
app.on("window-all-closed", () => app.quit());
