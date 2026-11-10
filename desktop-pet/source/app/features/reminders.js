// Gentle reminders: drink water, stand up, and your own reminders at set times. EchoBot says them in its
// bubble (and as a Windows notification if you turn that on). Click EchoBot while it's reminding you to
// mark it done (+1 coin). Reminders wait while Do Not Disturb is on or a focus session is running, except
// your own timed ones, which still show quietly.
const { Notification } = require("electron");
let api, pending = null, lastWater = Date.now(), lastStand = Date.now(), firedToday = {}, day = "";

const WATER = ["Sip of water? 💧", "Hydration check! 💧", "Water break! Your brain will thank you. 💧"];
const STAND = ["Time to stand up and stretch! 🙆", "Stand up, shake it out! 🕺", "Up you get — quick stretch? 🙆"];
const pick = (a) => a[Math.floor(Math.random() * a.length)];

function remind(kind, text, { urgent = false } = {}) {
  if (!api.visible() || (api.quiet() && !urgent)) return false;
  pending = { kind, text, at: Date.now() };
  api.say(text + "  (click me when done)", { ms: 15000 });
  api.play(kind === "stand" ? "Stretch" : "Surprised");
  if (api.store.get().windowsNotifications && Notification.isSupported()) new Notification({ title: "EchoBot", body: text, silent: true }).show();
  return true;
}

module.exports = {
  init(a) { api = a; },
  tick(now) {
    const st = api.store.get();
    if (st.water.on && now - lastWater > st.water.every * 60000) { if (remind("water", pick(WATER))) lastWater = now; }
    if (st.stand.on && now - lastStand > st.stand.every * 60000) { if (remind("stand", pick(STAND))) lastStand = now; }
    // own reminders at a time of day, once each day
    const d = new Date(), today = d.toDateString();
    if (today !== day) { day = today; firedToday = {}; }
    const hm = String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
    (st.customReminders || []).forEach((r, i) => {
      if (!r.on || !r.time || !r.text) return;
      const key = i + "|" + r.time + "|" + r.text;
      const late = minutesBetween(r.time, hm);       // fires on time, or up to 10 minutes late if EchoBot was hidden
      if (!firedToday[key] && late >= 0 && late <= 10 && remind("custom", "⏰ " + r.text, { urgent: true })) firedToday[key] = true;
    });
    if (pending && now - pending.at > 120000) pending = null;
  },
  onPetEvent(pet, type) {
    if (type === "click" && pending && pet.role === "main") {
      const care = api.feature("care");
      const c = care ? care.reward(1, 1, "reminder") : 0;
      api.say(pending.kind === "water" ? "Refreshing! 💜" : pending.kind === "stand" ? "Nice stretch! 💜" : "Done! 💜", { ms: 2500 });
      if (c) api.fx("coin");
      pending = null;
      return true;
    }
  },
  status: () => ({ pending: pending && pending.kind, nextWaterMin: Math.max(0, Math.round((lastWater + api.store.get().water.every * 60000 - Date.now()) / 60000)) }),
  actions: { testReminder: (kind) => remind(kind || "water", kind === "stand" ? pick(STAND) : pick(WATER), { urgent: true }) },
};
function minutesBetween(a, b) { const [ah, am] = a.split(":").map(Number), [bh, bm] = b.split(":").map(Number); return (bh * 60 + bm) - (ah * 60 + am); }
