// Focus timer (Pomodoro): EchoBot puts on headphones and keeps quiet while you work, celebrates when the
// session ends, then reminds you to take a short break.
const { Notification } = require("electron");
let api, mode = null, endsAt = 0, total = 0, lastHoverSay = 0, sessionsToday = 0, day = "";

const left = () => Math.max(0, Math.ceil((endsAt - Date.now()) / 60000));
function notify(title, body) {
  if (api.store.get().windowsNotifications && Notification.isSupported()) new Notification({ title, body, silent: false }).show();
}
function start(minutes) {
  const m = minutes || api.store.get().focusMinutes || 25;
  mode = "focus"; total = m; endsAt = Date.now() + m * 60000;
  api.say(`Focus mode: ${m} minutes. I'll be quiet. 🎧`, { ms: 3500 });
  api.play("Happy");
  api.refresh();
}
function startBreak() {
  const m = api.store.get().breakMinutes || 5;
  mode = "break"; total = m; endsAt = Date.now() + m * 60000;
  api.refresh();
}
function stop(silent) {
  if (!mode) return;
  mode = null; endsAt = 0;
  if (!silent) api.say("Focus timer stopped.", { ms: 2500 });
  api.refresh();
}

module.exports = {
  init(a) { api = a; },
  start, stop,
  isQuiet: () => mode === "focus",
  config: () => ({ focus: mode === "focus" }),
  tooltip: () => (mode === "focus" ? `Focus: ${left()} min left` : mode === "break" ? `Break: ${left()} min left` : ""),
  menu() {
    const st = api.store.get();
    if (mode) return [{ label: mode === "focus" ? `Focus: ${left()} min left (stop)` : `Break: ${left()} min left (skip)`, click: () => stop() }];
    return [{ label: "Focus timer", submenu: [
      { label: `Focus ${st.focusMinutes} minutes`, click: () => start(st.focusMinutes) },
      ...[15, 25, 50].filter((m) => m !== st.focusMinutes).map((m) => ({ label: `Focus ${m} minutes`, click: () => start(m) })),
    ] }];
  },
  tick(now) {
    if (!mode || now < endsAt) return;
    const today = new Date().toDateString();
    if (today !== day) { day = today; sessionsToday = 0; }
    if (mode === "focus") {
      sessionsToday++;
      const care = api.feature("care");
      const coins = care ? care.reward(Math.max(1, Math.round(total / 5)), 3, "focus") : 0;
      api.say(`Focus done! 🎉${coins ? ` +${coins} coins.` : ""} Take a ${api.store.get().breakMinutes}-minute break.`, { ms: 8000, speak: false });
      api.play("Dance");
      api.fx("confetti", { n: 24, spread: 25 });
      notify("Focus session done", `Nice work! Take a ${api.store.get().breakMinutes}-minute break.`);
      startBreak();
    } else {
      mode = null;
      api.say("Break's over! Ready for another round? Right-click me › Focus timer.", { ms: 7000 });
      api.play("Surprised");
      notify("Break's over", "Ready for another focus session?");
      api.refresh();
    }
  },
  onPetEvent(pet, type) {
    if (type === "hover" && mode && pet.role === "main" && Date.now() - lastHoverSay > 15000) {
      lastHoverSay = Date.now();
      api.say(mode === "focus" ? `${left()} min of focus left 🎧` : `Break: ${left()} min left ☕`, { ms: 2200 });
    }
  },
  status: () => ({ mode, minutesLeft: mode ? left() : 0, sessionsToday }),
  actions: { startFocus: (m) => { start(m); return true; }, stopFocus: () => { stop(); return true; } },
};
