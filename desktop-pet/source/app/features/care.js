// Needs and growth, kept gentle: EchoBot has energy and happiness that drift down slowly and go back up when
// you pet it, feed it a battery or play. It earns coins and XP (petting, focus sessions, games, reminders,
// a daily visit) and levels up, unlocking hats, outfits and colours in the shop. It never dies, never
// guilt-trips you, and stats stop dropping while it's hidden or in Do Not Disturb. Also: seasonal outfits.
let api, lastMinute = 0, lastAsk = 0;

const clamp = (v) => Math.max(5, Math.min(100, v));
const today = () => new Date().toDateString();
function care() { return api.store.get().care; }
function setCare(p) { api.store.patch({ care: { ...care(), ...p } }); api.settingsChanged(); }

// Adds XP and coins; returns the coins actually given. Announces level-ups.
function reward(xp = 0, coins = 0, why = "") {
  const c = care();
  if (!api.store.get().care.on) return 0;
  const before = api.catalog.levelFor(c.xp);
  setCare({ xp: c.xp + xp, coins: c.coins + coins });
  const after = api.catalog.levelFor(c.xp + xp);
  if (after > before) {
    const unlocks = [...api.catalog.HATS, ...api.catalog.OUTFITS, ...api.catalog.COLOURS].filter((i) => i.level === after).map((i) => i.name);
    setTimeout(() => {
      api.say(`Level up! I'm level ${after} 🎉${unlocks.length ? " New in the shop: " + unlocks.join(", ") + "." : ""}`, { ms: 7000 });
      api.play("Dance"); api.fx("confetti", { n: 26, spread: 20 });
    }, 1200);
  }
  if (coins > 0) api.fx("coin");
  return coins;
}

// Which seasonal hat (if any) to show today, plus special-day effects.
function season(d = new Date()) {
  const st = api.store.get();
  if (!st.seasonal) return {};
  const md = String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  if (st.birthday && st.birthday === md) return { hat: "party", day: "birthday" };
  if (md === "12-31" || md === "01-01") return { hat: "party", day: "newyear" };
  if (md >= "12-01" && md <= "12-26") return { hat: "santa", day: md === "12-25" ? "christmas" : "december" };
  if (md >= "10-24" && md <= "10-31") return { hat: "witch", day: md === "10-31" ? "halloween" : "october" };
  if (md === "02-14") return { day: "valentine" };
  return {};
}
const DAY_LINES = {
  birthday: "Happy birthday!! 🎂🎉 Today's all about you.", newyear: "Happy New Year! 🎆 Let's make it a good one.",
  christmas: "Merry Christmas! 🎄", halloween: "Happy Halloween! 🎃 Boo!", valentine: "Happy Valentine's Day 💜",
};

module.exports = {
  init(a) { api = a; },
  reward, season,
  config(pet) {
    const c = care(), s = season();
    const out = { lowEnergy: api.store.get().care.on && c.energy < 25 };
    if (pet.role === "main" && s.hat) out.seasonalHat = s.hat;
    return out;
  },
  tick(now) {
    if (now - lastMinute < 60000) return;
    const first = lastMinute === 0;
    lastMinute = now;
    const st = api.store.get(), c = care();
    // daily visit + special days
    if (c.lastVisit !== today()) {
      setCare({ lastVisit: today(), petsToday: 0 });
      reward(2, 3, "visit");
      const s = season();
      if (s.day && DAY_LINES[s.day]) setTimeout(() => { if (api.visible()) { api.say(DAY_LINES[s.day], { ms: 8000 }); api.play("Dance"); api.fx(s.day === "valentine" ? "hearts" : "confetti", { n: 24, spread: 30 }); } }, 6000);
    }
    const s = season();
    if (s.day === "december" || s.day === "christmas") { if (api.visible() && Math.random() < 0.3) api.fx("snow", { n: 12, spread: 250 }); }
    if (!st.care.on || !api.visible() || first) return;
    // slow drift: energy lasts ~20 hours awake, happiness ~1 day
    setCare({ energy: clamp(c.energy - 0.08), happiness: clamp(c.happiness - 0.07), last: now });
    // a gentle ask, at most every 2 hours, never during focus/DND
    if (now - lastAsk > 2 * 3600000 && !api.quiet()) {
      if (c.energy < 25) { lastAsk = now; api.say("I'm running a bit low… a battery would be lovely 🔋 (right-click me › Feed a battery)", { ms: 8000 }); api.play("Sleep"); }
      else if (c.happiness < 25) { lastAsk = now; api.say("Play with me sometime? Pet me or throw me the ball! 🥺", { ms: 7000 }); }
    }
  },
  onPetEvent(pet, type) {
    if (type === "petted") {
      const c = care();
      const coin = c.petsToday < 5 ? 1 : 0;
      setCare({ happiness: clamp(c.happiness + 4), petsToday: c.petsToday + 1 });
      reward(1, coin, "pet");
      if (c.petsToday === 0 && Math.random() < 0.6) api.say(["Hehe, that tickles!", "Aww 💜", "*happy beeps*"][Math.floor(Math.random() * 3)], { pet, ms: 2500 });
    }
  },
  feed() { const c = care(); setCare({ energy: clamp(c.energy + 30) }); reward(2, 0, "feed"); },
  played(amount = 8) { const c = care(); setCare({ happiness: clamp(c.happiness + amount) }); },
  menu() {
    const c = care();
    if (!api.store.get().care.on) return [];
    return [
      { label: "Feed a battery", click: () => { const t = api.feature("toys"); if (t) t.spawn("battery"); } },
      { label: `Energy ${Math.round(c.energy)} · Happiness ${Math.round(c.happiness)} · ${c.coins} coins · Level ${api.catalog.levelFor(c.xp)} (shop…)`, click: () => api.openSettings("shop") },
    ];
  },
  status: () => ({ ...care(), level: api.catalog.levelFor(care().xp), season: season() }),
  actions: {
    buy({ kind, id }) {
      const item = api.catalog.find(kind, id), st = api.store.get(), c = care(), key = kind + ":" + id;
      if (item.id !== id || item.seasonal) return { ok: false, error: "That isn't in the shop." };
      if (st.owned.includes(key)) return { ok: true, already: true };
      if (item.level && api.catalog.levelFor(c.xp) < item.level) return { ok: false, error: `Unlocks at level ${item.level}.` };
      if (c.coins < item.price) return { ok: false, error: `You need ${item.price - c.coins} more coins.` };
      setCare({ coins: c.coins - item.price });
      api.store.patch({ owned: [...st.owned, key], [kind]: id });
      api.refresh(); api.say(`Ooh, ${item.name.toLowerCase()}! Thank you! 💜`, { ms: 3500 }); api.play("Happy"); api.fx("sparkle", { n: 6 });
      return { ok: true };
    },
    equip({ kind, id }) {
      const st = api.store.get();
      if (!st.owned.includes(kind + ":" + id)) return { ok: false, error: "Buy it first." };
      api.store.patch({ [kind]: id }); api.refresh(); api.play("Happy");
      return { ok: true };
    },
  },
};
