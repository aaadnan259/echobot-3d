// Settings and progress, saved as JSON in the app's user-data folder. Everything new is gentle by default:
// sound, chat, mischief and the calendar start OFF and only run once you turn them on.
const fs = require("fs");
const path = require("path");
const { app } = require("electron");
const secret = require("./secret");

const DEFAULTS = {
  size: "Medium", onTop: true, x: null, y: null, firstRun: true,
  // movement
  physics: true, wander: true, wanderSpeed: 1, sitOnWindows: true, edgePeek: true,
  personality: "Playful", chattiness: 1,
  // reactions
  sound: "off",            // "off" | "music" (what your PC plays) | "mic"
  typing: true, timeOfDay: true, battery: true, cpu: true,
  // useful
  hideFullscreen: true, dnd: false, dndHotkey: "Ctrl+Alt+E",
  focusMinutes: 25, breakMinutes: 5,
  water: { on: false, every: 60 }, stand: { on: false, every: 45 },
  customReminders: [],     // [{ time: "14:30", text: "Call mum", on: true }]
  windowsNotifications: false,
  calendar: { on: false, source: "", minutesBefore: 10 },
  // chat
  chat: { on: false, provider: "website", model: "claude-opus-5-5", personality: "Cheerful", voice: "", mute: false, remember: true },
  apiKey: "",              // encrypted with Windows' own data protection (safeStorage); never shown again
  memory: { name: "", facts: [], recent: [] },   // what EchoBot remembers from chats; "Forget me" clears it
  // fun
  care: { on: true, energy: 80, happiness: 80, xp: 0, coins: 20, last: 0, lastVisit: "", petsToday: 0 },
  owned: ["hat:none", "outfit:none", "colour:classic"],
  hat: "none", outfit: "none", colour: "classic",
  seasonal: true, birthday: "",      // "MM-DD"
  mischief: false,                   // the "Behave" switch is the opposite of this
  friend: false, friendColour: "mint",
};

// Personality presets scale how often EchoBot does things on its own.
const PERSONALITIES = {
  Calm:    { chatter: 0.4, moods: 0.5, wander: 0.5, speed: 0.75, mischief: 0.4, hops: 0.3 },
  Playful: { chatter: 1,   moods: 1,   wander: 1,   speed: 1,    mischief: 1,   hops: 1 },
  Chaotic: { chatter: 1.7, moods: 2,   wander: 2,   speed: 1.5,  mischief: 2.5, hops: 2.5 },
};

let data = null, saveTimer = null;
const file = () => path.join(app.getPath("userData"), "settings.json");

function merge(base, extra) {
  const out = { ...base };
  for (const k of Object.keys(extra || {})) {
    const v = extra[k];
    out[k] = v && typeof v === "object" && !Array.isArray(v) && base[k] && typeof base[k] === "object" && !Array.isArray(base[k])
      ? merge(base[k], v) : v;
  }
  return out;
}

function load() {
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(file(), "utf8")); } catch {}
  if (saved.onTop === undefined && saved.wander !== undefined) saved.onTop = true;   // settings from version 1 carry over
  data = merge(DEFAULTS, saved);
  return data;
}
function get() { return data || load(); }
function saveNow() {
  clearTimeout(saveTimer); saveTimer = null;
  try { fs.writeFileSync(file(), JSON.stringify(data, null, 2)); } catch {}
}
function save() { if (!saveTimer) saveTimer = setTimeout(saveNow, 400); }
function patch(p) { data = merge(get(), p); save(); return data; }

async function setApiKey(key) {
  key = (key || "").trim();
  if (!key) { data.apiKey = ""; save(); return; }
  data.apiKey = secret.available() ? "enc:" + (await secret.encrypt(key)) : "raw:" + key;
  save();
}
async function getApiKey() {
  const k = get().apiKey || "";
  try {
    if (k.startsWith("enc:")) return await secret.decrypt(k.slice(4));
    if (k.startsWith("raw:")) return k.slice(4);
  } catch {}
  return "";
}
function personality() { return PERSONALITIES[get().personality] || PERSONALITIES.Playful; }

// A copy that is safe to send to windows: no API key, just whether one is set.
function publicView() { const d = { ...get() }; d.hasApiKey = !!d.apiKey; delete d.apiKey; return d; }

module.exports = { DEFAULTS, PERSONALITIES, load, get, save, saveNow, patch, setApiKey, getApiKey, personality, publicView };
