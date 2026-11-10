// Automated-test hooks. Completely inactive unless EchoBot is started with the PET_DEBUG environment variable
// pointing at a folder: then it writes its state there and follows commands from cmd-*.json files.
const fs = require("fs");
const path = require("path");
const dir = process.env.PET_DEBUG;
let api;

function state() {
  return {
    t: Date.now(),
    pets: api.pets().map((p) => ({ role: p.role, state: p.state, surface: p.surface, x: Math.round(p.body.x), y: Math.round(p.body.y), s: p.s,
      hidden: !!p.hidden, visible: p.win.isVisible(), peek: p.peek && p.peek.side, vx: Math.round(p.body.vx), vy: Math.round(p.body.vy) })),
    world: { ok: api.world.ok, fullscreen: api.world.fullscreen, typing: api.world.typing, cpu: api.world.cpu, windows: api.world.windows.slice(0, 8) },
    quiet: api.quiet(), care: api.store.get().care, settings: { sound: api.store.get().sound, dnd: api.store.get().dnd, hat: api.store.get().hat },
    features: Object.fromEntries(["focus", "reminders", "toys", "games", "mischief", "chat", "calendar"].map((n) => {
      const f = api.feature(n); return [n, f && f.status ? f.status() : null];
    })),
  };
}

async function run(cmd) {
  const pet = api.pets().find((p) => p.role === (cmd.role || "main"));
  switch (cmd.cmd) {
    case "place": Object.assign(pet.body, { x: cmd.x, y: cmd.y, vx: cmd.vx || 0, vy: cmd.vy || 0 }); pet.state = cmd.state || "air"; pet.target = null; pet.surface = { kind: "floor" }; break;
    case "walk": pet.walkTo(cmd.x, cmd.speed); break;
    case "hop": pet.hop(cmd.h || 90, cmd.vx || 0); break;
    case "jumpTo": pet.jumpTo(cmd.x, cmd.y); break;
    case "peek": pet.startPeek(cmd.side, cmd.ms || 4000); break;
    case "think": pet.nextThink = 0; pet.think(Date.now() + 1, { quiet: false }); break;
    case "capture": {
      const img = await pet.win.webContents.capturePage();
      await fs.promises.writeFile(path.join(dir, cmd.file || "capture.png"), img.toPNG());
      break;
    }
    case "eval": {
      const r = await pet.win.webContents.executeJavaScript(cmd.js, true).catch((e) => "ERR " + e.message);
      await fs.promises.writeFile(path.join(dir, cmd.out || "eval.json"), JSON.stringify(r));
      break;
    }
    case "main": {   // run a snippet in the main process with `api` in scope
      let r; try { r = await (new Function("api", "require", "return (async () => { " + cmd.js + " })()"))(api, globalThis.__testRequire ? (m) => globalThis.__testRequire(m) || require(m) : require); } catch (e) { r = "ERR " + e.message; }
      await fs.promises.writeFile(path.join(dir, cmd.out || "main.json"), JSON.stringify(r === undefined ? null : r, null, 1));
      break;
    }
    case "quit": require("electron").app.quit(); break;
  }
}

module.exports = {
  init(a) {
    if (!dir) return;
    api = a;
    // async file calls only, so the same hooks work in both the full and the light build
    let busy = false;
    setInterval(() => { fs.promises.writeFile(path.join(dir, "state.json"), JSON.stringify(state(), null, 1)).catch(() => {}); }, 200);
    setInterval(async () => {
      if (busy) return; busy = true;
      try {
        const files = (await fs.promises.readdir(dir)).filter((f) => /^cmd-.*\.json$/.test(f)).sort();
        for (const f of files) {
          let cmd; try { cmd = JSON.parse(await fs.promises.readFile(path.join(dir, f), "utf8")); } catch { continue; }
          await fs.promises.unlink(path.join(dir, f));
          run(cmd).catch((e) => fs.promises.writeFile(path.join(dir, "error.txt"), String(e.stack)));
        }
      } catch {} finally { busy = false; }
    }, 100);
  },
};
