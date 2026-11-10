// Mini-games: Catch the Echo (pop the rings EchoBot sends across your screen), Hide and Seek (EchoBot hides
// at a screen edge; find it and click it) and Echo Hop (the full game, in its own window). All give coins.
const path = require("path");
const { BrowserWindow, ipcMain, screen } = require("electron");
const { displayAt } = require("../physics");
let api, overlay = null, hide = null, hop = null, lastScore = null;

function catchTheEcho() {
  if (overlay && !overlay.isDestroyed()) return;
  const pet = api.main(); if (!pet) return;
  const d = displayAt(pet.center().x, pet.center().y);
  overlay = new BrowserWindow({
    ...d.workArea, frame: false, transparent: true, resizable: false, skipTaskbar: true, alwaysOnTop: true, show: false, focusable: false,
    hasShadow: false, backgroundColor: "#00000000", webPreferences: { preload: path.join(__dirname, "..", "preload-overlay.js") },
  });
  overlay.setAlwaysOnTop(true, "screen-saver");
  overlay.setIgnoreMouseEvents(true, { forward: true });
  const pb = pet.win.getBounds();
  overlay.loadFile(path.join(__dirname, "..", "overlay.html"), { query: { px: String(pb.x - d.workArea.x + pb.width / 2), py: String(pb.y - d.workArea.y + pb.height * 0.55) } });
  overlay.once("ready-to-show", () => overlay.showInactive());
  overlay.on("closed", () => { overlay = null; });
  pet.busy = Date.now() + 40000;
  api.say("Catch my echoes! Click the rings before they fade! 🎯", { ms: 4000 });
  api.play("Happy");
}

function hideAndSeek() {
  if (hide) return;
  const pet = api.main(); if (!pet || pet.state === "held") return;
  api.say("Let's play hide and seek! Close your eyes… 🙈", { ms: 3000 });
  pet.busy = Date.now() + 90000;
  setTimeout(() => {
    if (!pet.alive()) return;
    pet.win.hide(); pet.hidden = true;
    setTimeout(() => {
      const d = displayAt(pet.center().x, pet.center().y), b = d.workArea, s = pet.s;
      const side = ["left", "right", "top", "bottom"][Math.floor(Math.random() * 4)];
      const along = 0.15 + Math.random() * 0.7;
      if (side === "left") { pet.body.x = b.x - s * 0.68; pet.body.y = b.y + (b.height - s) * along; }
      if (side === "right") { pet.body.x = b.x + b.width - s * 0.32; pet.body.y = b.y + (b.height - s) * along; }
      if (side === "top") { pet.body.x = b.x + (b.width - s) * along; pet.body.y = b.y - s * 0.6; }
      if (side === "bottom") { pet.body.x = b.x + (b.width - s) * along; pet.body.y = b.y + b.height - s * 0.5; }
      pet.state = "peek"; pet.peek = { side: side === "bottom" ? "top-up" : side, until: Date.now() + 70000 };
      pet.apply(true);
      pet.hidden = false; pet.win.showInactive();
      hide = { started: Date.now(), side, hinted: 0 };
      api.refreshTray();
    }, 2500);
  }, 2600);
}
function endHide(found) {
  if (!hide) return;
  const pet = api.main(), secs = (Date.now() - hide.started) / 1000;
  hide = null;
  if (pet) { pet.endPeek(); pet.busy = 0; }
  if (found) {
    const coins = secs < 10 ? 5 : secs < 30 ? 3 : 1;
    const care = api.feature("care"); if (care) { care.reward(2, coins, "hide"); care.played(10); }
    api.say(`You found me in ${Math.round(secs)} seconds! +${coins} coins 🎉`, { ms: 4500 });
    api.play("Surprised"); setTimeout(() => api.play("Happy"), 900);
  } else {
    api.say("Here I am! 😜 Too sneaky?", { ms: 4000 }); api.play("Happy");
  }
}

function echoHop() {
  if (hop && !hop.isDestroyed()) { hop.show(); hop.focus(); return; }
  hop = new BrowserWindow({ width: 480, height: 760, title: "Echo Hop", icon: path.join(__dirname, "..", "icon.png"), autoHideMenuBar: true, backgroundColor: "#140f24" });
  hop.loadFile(path.join(__dirname, "..", "games", "echo-hop.html"));
  hop.webContents.on("did-finish-load", async () => { lastScore = Number(await hop.webContents.executeJavaScript('localStorage.getItem("echohop-best") || 0').catch(() => 0)); });
  hop.on("close", async (e) => {
    if (hop.__checked) return;
    e.preventDefault(); hop.__checked = true;
    const best = Number(await hop.webContents.executeJavaScript('localStorage.getItem("echohop-best") || 0').catch(() => 0));
    if (lastScore !== null && best > lastScore) {
      const care = api.feature("care"); if (care) { care.reward(3, 4, "echohop"); care.played(10); }
      api.say(`New Echo Hop record: ${best}! +4 coins 🏆`, { ms: 5000 }); api.play("Dance");
    } else { const care = api.feature("care"); if (care) care.played(6); }
    hop.destroy();
  });
  hop.on("closed", () => { hop = null; });
}

module.exports = {
  init(a) {
    api = a;
    ipcMain.on("overlay:click-through", (_e, on) => { if (overlay && !overlay.isDestroyed()) overlay.setIgnoreMouseEvents(on, { forward: true }); });
    ipcMain.on("overlay:pop", () => { if (Math.random() < 0.3) api.play("Happy"); });
    ipcMain.on("overlay:done", (_e, score) => {
      if (overlay && !overlay.isDestroyed()) overlay.close();
      const coins = Math.floor(score / api.catalog.GAME_COIN_DIVISOR);
      const care = api.feature("care");
      if (care) { care.reward(Math.min(10, score), coins, "catch"); care.played(10); }
      api.say(score ? `You caught ${score} echoes! +${coins} coins 🎉` : "Aww, none this time. Again?", { ms: 5000 });
      api.play(score >= 10 ? "Dance" : "Happy");
      const pet = api.main(); if (pet) pet.busy = 0;
    });
  },
  catchTheEcho, hideAndSeek, echoHop,
  isQuiet: () => !!overlay || !!hide,
  menu() {
    if (hide) return [{ label: "Give up hide and seek", click: () => endHide(false) }];
    return [{ label: "Play", submenu: [
      { label: "Catch the Echo (30 seconds)", click: catchTheEcho },
      { label: "Hide and seek", click: hideAndSeek },
      { label: "Echo Hop", click: echoHop },
    ] }];
  },
  tick(now) {
    if (!hide) return;
    const secs = (now - hide.started) / 1000, pet = api.main();
    if (secs > 20 && hide.hinted === 0 && pet) { hide.hinted = 1; api.fx("sparkle", { n: 4 }); api.play("LookAround"); }
    if (secs > 40 && hide.hinted === 1 && pet) { hide.hinted = 2; api.fx("notes", { n: 3 }); api.play("Happy"); }
    if (secs > 60) endHide(false);
  },
  onPetEvent(pet, type) {
    if (hide && pet.role === "main" && (type === "click" || type === "grabbed")) { endHide(true); return true; }
  },
  status: () => ({ overlay: !!overlay, hiding: hide ? hide.side : null }),
  actions: { playGame: (name) => { ({ catch: catchTheEcho, hide: hideAndSeek, hop: echoHop })[name](); return true; } },
};
