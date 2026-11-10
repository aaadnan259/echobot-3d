// Reactions to what's happening around EchoBot: the time of day, a busy CPU, long typing stints and music.
// (Sound itself and the battery are handled inside the EchoBot window; this decides what to say about them.)
let api;
const once = {};                      // things said once per day/night: key -> date string
let cpuHigh = 0, cpuHot = false, lastCpuSay = 0;
let typingSince = 0, lastTypingBreak = Date.now(), lastTyping = 0, musicOn = false, lastDance = 0, lastMusicSay = 0;
let lastMinute = -1;

const today = () => new Date().toDateString();
function chatty() { const st = api.store.get(); return (st.chattiness ?? 1) * api.store.personality().chatter; }
function sayOnce(key, text, opts = {}) {
  if (once[key] === today()) return false;
  once[key] = today();
  if (api.quiet()) return false;
  api.say(text, opts);
  if (opts.mood) api.play(opts.mood);
  return true;
}

function period(h) {
  if (h >= 5 && h < 11) return "morning";
  if (h >= 11 && h < 17) return "day";
  if (h >= 17 && h < 22) return "evening";
  return "night";
}

const LINES = {
  morning: ["Morning! Coffee first?", "Fresh day, fresh echoes.", "Rise and shine!"],
  day: ["Remember to blink!", "How's it going?", "Snack break soon?"],
  evening: ["Nearly done for the day?", "Cosy evening vibes.", "You did a lot today."],
  night: ["*yawn*", "It's getting late…", "The night is quiet. Echo… echo…"],
};

module.exports = {
  init(a) { api = a; },
  config(pet) {
    const st = api.store.get();
    const h = new Date().getHours(), p = period(h);
    const out = { cpuHot: st.cpu && cpuHot && pet.role === "main" };
    if (st.timeOfDay) {
      out.lines = LINES[p];
      out.night = p === "night";
      out.nightSleepy = p === "night" ? (h >= 23 || h < 5 ? 0.45 : 0.25) : p === "evening" && h >= 21 ? 0.15 : 0;
    }
    return out;
  },
  tick(now) {
    const st = api.store.get();
    const d = new Date(), h = d.getHours(), m = d.getMinutes();
    // ---- once a minute: time of day ----
    if (m !== lastMinute) {
      lastMinute = m;
      if (st.timeOfDay) {
        if (h >= 5 && h < 11 && api.visible()) {
          if (sayOnce("morning", ["Good morning! ☀️", "Morning! Ready for today?", "Good morning! Let's stretch."][d.getDay() % 3])) api.play("Stretch");
        }
        if (h === 12 && m >= 30 && chatty() > 0.3) sayOnce("lunch", "Lunch time? 🥪 Even robots need a recharge.");
        if (h === 21 && chatty() > 0.3) sayOnce("evening", "It's getting late. Wrap up soon?");
        if ((h >= 23 || h < 4) && api.visible()) { if (sayOnce("night", "It's way past bedtime… *yawn*")) api.play("Sleep"); }
      }
      api.refresh();
    }
    // ---- CPU ----
    const cpu = api.world.cpu;
    // a fully loaded PC often reads only 80–90% here, so 80 counts as busy
    if (cpu >= 80) cpuHigh += 1; else if (cpu < 60) cpuHigh = 0;
    const hot = cpuHigh > 60 * 10;            // ~10 seconds of the 60 Hz loop
    if (hot !== cpuHot) {
      cpuHot = hot; api.refresh();
      if (hot && st.cpu && now - lastCpuSay > 15 * 60000 && !api.quiet()) { lastCpuSay = now; api.say("Phew! Your computer's working hard. 🥵", { ms: 5000 }); }
    }
    // ---- typing ----
    if (st.typing) {
      const typing = api.world.typing > 0.15;
      if (typing) { if (!typingSince) typingSince = now; lastTyping = now; }
      if (!typing && typingSince && now - lastTyping > 5 * 60000) { typingSince = 0; lastTypingBreak = now; }  // a real 5-minute pause counts as a break
      if (typingSince && now - lastTypingBreak > 50 * 60000 && !api.quiet()) {
        lastTypingBreak = now;
        api.say("You've been typing for almost an hour. Stretch break? 🙆", { ms: 7000 });
        api.play("Stretch");
      }
    }
    // ---- music: a little dance now and then ----
    if (musicOn && now - lastDance > 25000 / api.store.personality().moods && !api.quiet()) { lastDance = now; api.play(Math.random() < 0.7 ? "Dance" : "Happy"); }
  },
  onPetEvent(pet, type, data) {
    if (pet.role !== "main") return;
    if (type === "music-start") {
      musicOn = true;
      if (Date.now() - lastMusicSay > 20 * 60000 && Math.random() < 0.6 * chatty() && !api.quiet()) { lastMusicSay = Date.now(); api.say(["Ooh, I like this one! 🎵", "Music! *wiggles*", "This one's a bop."][Math.floor(Math.random() * 3)], { ms: 3500 }); }
    }
    if (type === "music-stop") musicOn = false;
    if (type === "sound-error") {
      api.store.patch({ sound: "off" }); api.refresh(); api.settingsChanged();
      api.say("I couldn't listen to the sound, so I turned it off. Check the microphone permission in Windows settings.", { ms: 8000 });
    }
  },
  status() { return { cpuHot, musicOn, typingFor: typingSince ? Math.round((Date.now() - typingSince) / 60000) : 0 }; },
};
