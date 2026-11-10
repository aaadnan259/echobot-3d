// Light build: loaded first in every EchoBot page. It provides the same window.pet / window.echo /
// window.chat / window.toy / window.overlay objects the full build's preload scripts provide, carried over
// Tauri events to the hidden brain page.
import { emitTo, listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

const label = new URLSearchParams(location.search).get("__label") || getCurrentWindow().label;
const send = (ch, ...args) => emitTo("brain", "ipc", { label, ch, args });
const pending = new Map();
const ask = (ch, ...args) => new Promise((resolve, reject) => {
  const id = Math.random().toString(36).slice(2);
  pending.set(id, { resolve, reject });
  emitTo("brain", "ipc", { label, ch, args, id });
});
const subs = {};
const on = (ch) => (fn) => { (subs[ch] ||= []).push(fn); };
listen("msg", (e) => { if (e.payload.to !== label) return; for (const fn of subs[e.payload.ch] || []) fn(e.payload.data); });
listen("ipc-reply", (e) => { if (e.payload.to !== label) return; const p = pending.get(e.payload.id); if (!p) return; pending.delete(e.payload.id); e.payload.error ? p.reject(new Error(e.payload.error)) : p.resolve(e.payload.result); });
listen("eval", async (e) => {
  if (e.payload.to !== label) return;
  try { const result = await (0, eval)(e.payload.js); emitTo("brain", "eval-reply", { id: e.payload.id, result: result === undefined ? null : result }); }
  catch (err) { emitTo("brain", "eval-reply", { id: e.payload.id, error: String(err.message || err) }); }
});

window.pet = {
  onTick: on("tick"), onPlay: on("play"), onSay: on("say"), onConfig: on("config"), onLand: on("land"), onFx: on("fx"),
  clickThrough: (v) => send("click-through", v), dragStart: () => send("drag-start"), dragEnd: () => send("drag-end"),
  menu: () => send("menu"), event: (type, data) => send("pet-event", type, data),
};
window.echo = {
  get: () => ask("settings:get"), set: (p) => ask("settings:set", p), action: (n, a) => ask("settings:action", n, a),
  onSettings: on("settings"), onTab: on("tab"),
};
window.chat = { send: (t) => ask("chat:send", t), info: () => ask("chat:info"), close: () => send("chat:close"), settings: () => send("chat:settings") };
window.toy = { dragStart: () => send("toy:drag-start"), dragEnd: () => send("toy:drag-end"), click: () => send("toy:click") };
window.overlay = { clickThrough: (on) => send("overlay:click-through", on), pop: () => send("overlay:pop"), done: (s) => send("overlay:done", s) };
window.__lightBuild = true;

// The game overlay ignores the mouse except over its rings; Tauri doesn't pass mouse moves through to an
// ignoring window, so feed the page the cursor position ourselves.
if (/overlay\.html/.test(location.pathname)) {
  (async () => {
    const w = getCurrentWindow();
    const pos = await w.outerPosition(), scale = await w.scaleFactor();
    setInterval(async () => {
      const [x, y] = await invoke("cursor_pos");
      const cx = (x - pos.x) / scale, cy = (y - pos.y) / scale;
      window.dispatchEvent(new MouseEvent("mousemove", { clientX: cx, clientY: cy }));
    }, 30);
  })();
}

if (document.readyState === "loading") addEventListener("DOMContentLoaded", () => send("__ready", document.title));
else send("__ready", document.title);
