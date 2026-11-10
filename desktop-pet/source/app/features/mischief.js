// Mischief, OFF by default (the menu's "Behave" switch). When it's on, every so often EchoBot leaves a sticky
// note, chases your cursor for a few seconds, does the zoomies along the taskbar or hides at the screen edge.
// It never moves your mouse, touches your windows or does anything you can't undo with one click.
let api, next = Date.now() + 5 * 60000, chase = null;

const NOTES = ["Drink some water! 💧", "You're doing great 💜", "Stretch break? 🙆", "Beep boop.", "Hi :)", "Don't forget to blink!",
  "I was here. — E.", "Have a snack!", "Remember to save your work 💾", "Is it lunch yet?"];
const pick = (a) => a[Math.floor(Math.random() * a.length)];

function doSomething(kind) {
  const pet = api.main(); if (!pet || pet.state !== "ground") return false;
  kind = kind || pick(["note", "note", "chase", "zoomies", "peek"]);
  if (kind === "note") {
    const toys = api.feature("toys"); if (!toys) return false;
    const d = require("../physics").displayAt(pet.center().x, pet.center().y).workArea;
    const t = toys.spawn("note", { x: d.x + 80 + Math.random() * (d.width - 340), y: d.y + 60 + Math.random() * (d.height - 320), text: pick(NOTES) });
    if (t) { api.say("*sticks a note somewhere* 📝", { ms: 2500 }); api.play("Happy"); }
    return !!t;
  }
  if (kind === "chase") { chase = { until: Date.now() + 6000 }; api.say("I'm gonna get your cursor! 😈", { ms: 2500 }); return true; }
  if (kind === "zoomies") {
    const d = require("../physics").displayAt(pet.center().x, pet.center().y).workArea;
    const spots = [d.x + pet.s, d.x + d.width - pet.s, d.x + d.width / 2];
    let i = 0;
    const go = () => { if (i < spots.length && pet.state === "ground") pet.target = { x: spots[i++], speed: 650, then: go }; };
    go(); api.say("ZOOMIES!", { ms: 2000 });
    return true;
  }
  if (kind === "peek") { pet.startPeek(Math.random() < 0.5 ? "left" : "right", 6000); api.play("LookAround"); return true; }
  return false;
}

module.exports = {
  init(a) { api = a; },
  menu() {
    const st = api.store.get();
    return [{ label: "Behave", type: "checkbox", checked: !st.mischief, click: (m) => { api.store.patch({ mischief: !m.checked }); api.settingsChanged(); if (!m.checked) api.say("Hehehe… 😈", { ms: 2000 }); } }];
  },
  tick(now) {
    const st = api.store.get(), pet = api.main();
    if (chase && pet) {
      if (now > chase.until) chase = null;
      else if (pet.state === "ground") {
        const p = require("electron").screen.getCursorScreenPoint();
        pet.target = { x: p.x, speed: 380 * api.store.personality().speed };
        if (p.y < pet.body.y && Math.random() < 0.02) pet.hop(120);
      }
    }
    if (!st.mischief || api.quiet() || !api.visible() || now < next) return;
    next = now + (8 + Math.random() * 14) * 60000 / api.store.personality().mischief;
    doSomething();
  },
  status: () => ({ on: api.store.get().mischief, chasing: !!chase, nextInMin: Math.round((next - Date.now()) / 60000) }),
  actions: { mischiefNow: (kind) => doSomething(kind) },
};
