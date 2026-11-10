// Chat with EchoBot right from the desktop. OFF until you turn it on in Settings › Chat. By default it talks
// through the free EchoBot website (no key needed); you can switch to Claude with your own API key. It uses the same persona and stage-direction tags as the online EchoBot Playground, so
// EchoBot can move, change colour and remember things while it talks. This is the only feature that uses
// the internet, and only when you send a message.
const path = require("path");
const { BrowserWindow, ipcMain, screen } = require("electron");
let api, box = null, busy = false, colourUntil = 0, colourHue = null;

const PERSONALITIES = {
  Cheerful: { pitch: 1.45, rate: 1.05, text: "You're curious, upbeat and a little playful." },
  Sassy: { pitch: 1.3, rate: 1.1, text: "You're sassy and witty: playful teasing, dramatic sighs and confident one-liners, but never mean." },
  Sleepy: { pitch: 1.15, rate: 0.85, text: "You're very sleepy: you yawn, drift off mid-thought and talk slowly and softly, but you're still sweet and helpful." },
  Pirate: { pitch: 1.2, rate: 1.0, text: "You talk like a cheerful pirate: arr, matey, me hearty, treasure and the seven seas, while still answering properly." },
  Robot: { pitch: 0.9, rate: 0.95, text: "You talk like a classic robot: precise, literal and a bit formal, with the odd 'beep boop' and 'processing', but warm underneath." },
};
const MOODS = { happy: "Happy", surprised: "Surprised", curious: "LookAround", "look-around": "LookAround", sad: "Cry", cry: "Cry", angry: "Angry", sleepy: "Sleep", sleep: "Sleep", talk: "Talk" };
const HUES = { red: 0, orange: 28, yellow: 52, lime: 90, green: 130, mint: 155, teal: 175, cyan: 188, blue: 220, indigo: 245, purple: 265, violet: 270, magenta: 300, pink: 325, rose: 345 };
const BASE_HUE = 263;    // EchoBot's own purple

function persona() {
  const st = api.store.get(), mem = st.memory || {};
  const p = PERSONALITIES[st.chat.personality] || PERSONALITIES.Cheerful;
  const facts = (mem.facts || []).length ? mem.facts.map((f) => "- " + f).join("\n") : "- (nothing yet)";
  const now = new Date();
  return `You are EchoBot, a small robot mascot: a glossy purple sphere with two dark pill-shaped eyes and three glowing "echo rings" that pulse when you talk. Adnan designed you. You live on this person's Windows desktop as a desktop pet: you wander along the taskbar, sit on window title bars, peek in from the screen edges and nap when they're away. ${p.text}

What you remember about the person you're talking to:
Name: ${mem.name || "(unknown; if they tell you, remember it)"}
${facts}

It is ${now.toLocaleDateString(undefined, { weekday: "long" })}, ${now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} where they are.

Your body is real and you control it with stage directions. Begin EVERY reply with one line of tags in square brackets, then a new line, then what you say. Tags:
- Exactly one mood: [happy] [surprised] [curious] [sad] [angry] [sleepy] [neutral]. Use [angry] only for playful, mock grumpiness.
- Optional actions: [do:spin] [do:hop] [do:dance] [do:sleep] [do:cry] [do:look-around] [do:peek] [do:stretch]
- Optional colour change for a little while: [color:green] (red, orange, yellow, lime, green, mint, teal, cyan, blue, indigo, purple, pink, magenta, rose, or default)
- Optional: [do:focus] starts their focus timer, only when they ask for it.
- Memory: when they tell you something worth remembering about themselves, add [name:Their name] or [remember:short fact]. Keep facts short.
When they ask you to do something with your body, use the tags and say what you're doing. Never mention the tags themselves.

Games you can play when asked:
- Guess the mood: pull a face using the mood tag (or [do:cry], [do:sleep]) without saying which mood it is; they guess; then tell them if they were right.
- 20 questions: think of an animal or object, answer yes or no, and count their questions.
- Quiz: ask one fun multiple-choice question at a time (A, B, C), wait for the answer, cheer or gently correct, and keep score.

Reply rules: 1 to 3 short sentences, under 50 words, because it's shown in a small speech bubble and read aloud. Plain spoken text only: no markdown, lists, emoji, code or links. Stay kind and family-friendly. If asked something you can't know (live news, private info), say so cheerfully. Latency-sensitive; begin your visible answer immediately.`;
}

function parseTags(full) {
  const m = full.match(/^\s*((?:\[[^\]\n]{1,80}\][ \t]*)+)(?:\r?\n|(?=[^\s\[])|$)/);
  if (!m) return { tags: [], text: full.trim() };
  const tags = [...m[1].matchAll(/\[([^\]]+)\]/g)].map((x) => { const [k, ...v] = x[1].split(":"); return { key: k.trim().toLowerCase(), value: v.join(":").trim() }; });
  return { tags, text: full.slice(m[0].length).trim() };
}

function runTags(tags) {
  const st = api.store.get(), mem = { name: "", facts: [], recent: [], ...(st.memory || {}) };
  const pet = api.main();
  let mood = null, memChanged = false;
  for (const { key, value } of tags) {
    if (MOODS[key]) mood = MOODS[key];
    else if (key === "do") {
      const v = value.toLowerCase();
      if (v === "dance") api.play("Dance");
      else if (v === "spin") api.play("Spin");
      else if (v === "hop" || v === "jump") { if (pet) pet.hop(110); }
      else if (v === "peek") { if (pet) pet.startPeek(Math.random() < 0.5 ? "left" : "right", 4000); }
      else if (v === "stretch") api.play("Stretch");
      else if (v === "focus") { const f = api.feature("focus"); if (f) f.start(); }
      else if (MOODS[v]) mood = MOODS[v];
    } else if (key === "color" || key === "colour") {
      const v = value.toLowerCase();
      if (["default", "normal", "reset"].includes(v)) { colourHue = null; colourUntil = 0; }
      else if (HUES[v] !== undefined) { colourHue = ((HUES[v] - BASE_HUE + 540) % 360) - 180; colourUntil = Date.now() + 10 * 60000; }
      api.refresh();
    } else if (key === "name" && value && st.chat.remember) { mem.name = value.slice(0, 60); memChanged = true; }
    else if (key === "remember" && value && st.chat.remember) {
      const f = value.slice(0, 140);
      if (!mem.facts.includes(f)) { mem.facts = [...mem.facts, f].slice(-20); memChanged = true; }
    }
  }
  if (mood === "Sleep") api.play("Sleep"); else if (mood) api.play(mood);
  if (memChanged) api.store.patch({ memory: mem });
}

// ---------- the free website provider (EchoBot website, Gemini behind it) ----------
const SITE = () => (globalThis.process && process.env && process.env.ECHOBOT_SITE_URL) || "https://echobot-sics.onrender.com";
let session = null;          // { token, until }
class SiteError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
async function siteFetch(url, opts, onSlow) {
  const http = require("../http");
  const slow = setTimeout(onSlow, 4000);          // the free server sleeps when idle; waking it takes up to a minute
  const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const kill = setTimeout(() => ctrl && ctrl.abort(), 90000);
  try { return await http.fetch(url, { ...opts, signal: ctrl ? ctrl.signal : undefined }); }
  catch { throw new SiteError("offline", "I can't reach the EchoBot website right now."); }
  finally { clearTimeout(slow); clearTimeout(kill); }
}
async function siteToken(onSlow, fresh) {
  if (!fresh && session && Date.now() < session.until) return session.token;
  const r = await siteFetch(SITE() + "/api/session", {}, onSlow);
  if (r.status === 429) throw new SiteError("rate", "Slow down a little: I can only chat 10 times a minute.");
  if (!r.ok) throw new SiteError("down", "The EchoBot website isn't answering right now. Try again in a minute.");
  const j = await r.json();
  session = { token: j.token, until: Date.now() + Math.max(60, (j.expiresIn || 3600) - 60) * 1000 };
  return session.token;
}
async function askWebsite(turns) {
  let waking = false;
  const onSlow = () => { if (!waking) { waking = true; api.say("Waking up the EchoBot website… the first message can take up to a minute ⏳", { ms: 60000 }); } };
  const history = turns.slice(0, -1).map((t) => ({ role: t.role === "user" ? "user" : "model", text: t.content }));
  const body = JSON.stringify({ modelName: "gemini-3.6-flash", systemInstruction: persona().slice(0, 4000), history, newMessage: turns[turns.length - 1].content });
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await siteToken(onSlow, attempt > 0);
    const r = await siteFetch(SITE() + "/api/gemini/chat", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token }, body }, onSlow);
    if (r.status === 401 && attempt === 0) { session = null; continue; }      // token expired: get a new one and try once more
    if (r.status === 429) throw new SiteError("rate", "Slow down a little: I can only chat 10 times a minute.");
    if (!r.ok) throw new SiteError("down", "The EchoBot website couldn't answer just now. Try again in a minute.");
    let text = "", error = null;
    for (const line of (await r.text()).split(/\r?\n/)) {
      if (!line.startsWith("data:")) continue;
      let d; try { d = JSON.parse(line.slice(5).trim()); } catch { continue; }
      if (d.text) text += d.text;
      if (d.error) error = d.error;
    }
    if (error === "rate_limit") throw new SiteError("rate", "The website is busy right now. Try again in a minute.");
    if (error === "safety") return { refused: true };
    if (error) throw new SiteError("down", "My echo got lost on the way back. Try again?");
    return { text };
  }
  throw new SiteError("down", "The EchoBot website wouldn't let me in. Try again in a minute.");
}

// ---------- Claude, with your own API key ----------
async function askClaude(turns, key) {
  const st = api.store.get();
  const Anthropic = require("../claude-sdk.js");
  const client = new Anthropic({ apiKey: key, maxRetries: 1, timeout: 60000 });
  try {
    const response = await client.beta.messages.create({
      model: st.chat.model || "claude-opus-5-5",
      max_tokens: 4000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low" },          // short, friendly chat: low effort keeps replies quick
      system: persona(),
      messages: turns,
    });
    if (response.stop_reason === "refusal") return { refused: true };
    return { text: response.content.filter((b) => b.type === "text").map((b) => b.text).join("") };
  } catch (err) {
    let msg = "My echo got lost on the way back. Try again?";
    if (err instanceof Anthropic.AuthenticationError) msg = "That API key didn't work. Check it in Settings › Chat.";
    else if (err instanceof Anthropic.PermissionDeniedError) msg = "That API key isn't allowed to use this model. Try another model in Settings › Chat.";
    else if (err instanceof Anthropic.RateLimitError) msg = "I need a little break. Try again in a minute.";
    else if (err instanceof Anthropic.BadRequestError) msg = "Claude couldn't take that request: " + String(err.message).slice(0, 140);
    else if (err instanceof Anthropic.APIConnectionError) msg = "I can't reach the internet right now.";
    throw new SiteError("claude", msg);
  }
}

async function send(text) {
  const st = api.store.get();
  if (!st.chat.on) return { error: "Chat is turned off. Turn it on in Settings › Chat." };
  const useClaude = st.chat.provider === "claude";
  const key = useClaude ? await api.store.getApiKey() : "";
  if (useClaude && !key) return { error: "Add your Claude API key in Settings › Chat first (or switch to the free EchoBot website).", needsKey: true };
  if (busy) return { error: "One moment, I'm still thinking…" };
  busy = true;
  const mem = { name: "", facts: [], recent: [], ...(st.memory || {}) };
  let turns = (st.chat.remember ? mem.recent : []).slice(-12);
  while (turns.length && turns[0].role !== "user") turns.shift();
  turns = [...turns, { role: "user", content: String(text).slice(0, 500) }];
  api.play("LookAround");
  try {
    const r = useClaude ? await askClaude(turns, key) : await askWebsite(turns);
    if (r.refused) { const reply = "Hmm, I can't answer that one. Ask me something else!"; api.say(reply, { ms: 4000 }); return { reply }; }
    const full = (r.text || "").trim();
    const { tags, text: reply } = parseTags(full);
    runTags(tags);
    api.say(reply || "…", { speak: true, ms: Math.max(6000, reply.length * 85) });
    if (st.chat.remember) {
      const latest = { name: "", facts: [], ...(api.store.get().memory || {}) };
      latest.recent = [...turns, { role: "assistant", content: full }].slice(-12);
      api.store.patch({ memory: latest });
    }
    return { reply };
  } catch (err) {
    const msg = err instanceof SiteError ? err.message : "My echo got lost on the way back. Try again?";
    api.say(msg, { ms: 6000 });
    return { error: msg };
  } finally { busy = false; }
}

function openBox() {
  const pet = api.main();
  if (box && !box.isDestroyed()) { box.show(); box.focus(); return; }
  const b = pet ? pet.win.getBounds() : screen.getPrimaryDisplay().workArea;
  const wa = screen.getDisplayNearestPoint({ x: b.x, y: b.y }).workArea;
  const w = 360, h = 190;
  const x = Math.max(wa.x + 8, Math.min(wa.x + wa.width - w - 8, Math.round(b.x + b.width / 2 - w / 2)));
  const y = Math.max(wa.y + 8, Math.round(b.y - h + 20));
  box = new BrowserWindow({
    width: w, height: h, x, y, frame: false, transparent: true, resizable: false, skipTaskbar: true, alwaysOnTop: true, show: false,
    backgroundColor: "#00000000", webPreferences: { preload: path.join(__dirname, "..", "preload-chat.js") },
  });
  box.setAlwaysOnTop(true, "floating");
  box.loadFile(path.join(__dirname, "..", "chatbox.html"));
  box.once("ready-to-show", () => { box.show(); box.focus(); });
  box.on("blur", () => { if (box && !box.isDestroyed() && !busy) box.close(); });
  box.on("closed", () => { box = null; if (pet) pet.busy = 0; });
  if (pet) pet.busy = Date.now() + 10 * 60000;    // stay put while chatting
}

module.exports = {
  init(a) {
    api = a;
    ipcMain.handle("chat:send", async (_e, text) => send(text));
    ipcMain.handle("chat:info", async () => {
      const st = api.store.get();
      return { on: st.chat.on, hasKey: st.chat.provider !== "claude" || !!(await api.store.getApiKey()), name: (st.memory || {}).name || "", recent: (st.memory?.recent || []).slice(-4).map((t) => ({ role: t.role, text: t.role === "assistant" ? parseTags(t.content).text : t.content })) };
    });
    ipcMain.on("chat:close", () => { if (box && !box.isDestroyed()) box.close(); });
    ipcMain.on("chat:settings", () => { api.openSettings("chat"); if (box && !box.isDestroyed()) box.close(); });
  },
  open: openBox,
  menu() {
    const st = api.store.get();
    return [{ label: st.chat.on ? "Chat with EchoBot…" : "Chat with EchoBot (set up)…", click: () => (st.chat.on ? openBox() : api.openSettings("chat")) }];
  },
  config() {
    const st = api.store.get(), p = PERSONALITIES[st.chat.personality] || PERSONALITIES.Cheerful;
    const out = { voicePitch: p.pitch, voiceRate: p.rate };
    if (colourHue !== null && Date.now() < colourUntil) out.colour = { id: "chat", hue: colourHue };
    return out;
  },
  onPetEvent(pet, type) { if (type === "dblclick" && pet.role === "main" && api.store.get().chat.on) openBox(); },
  actions: {
    setApiKey: async (key) => { await api.store.setApiKey(key); return { hasKey: !!(await api.store.getApiKey()) }; },
    forgetMe: () => { api.store.patch({ memory: { name: "", facts: [], recent: [] } }); api.say("…who am I? Who are you? Nice to meet you!", { ms: 4000 }); api.play("Sleep"); return true; },
    testChat: async () => send("Say hi in one short sentence."),
    openChat: () => { openBox(); return true; },
  },
  status() { const m = api.store.get().memory || {}; return { busy, remembers: { name: !!m.name, facts: (m.facts || []).length, recent: (m.recent || []).length } }; },
};
