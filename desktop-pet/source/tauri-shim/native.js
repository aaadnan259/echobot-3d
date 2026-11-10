// State the light build's native core keeps sending us, cached so the shared code can read it synchronously
// (just like Electron's screen.getCursorScreenPoint() and friends).
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export const native = {
  cursor: [0, 0],          // physical pixels
  monitors: [],            // [{ x, y, w, h, wx, wy, ww, wh, scale, primary }] physical
  cpu: [0, 0, 0],          // cumulative ms: idle, kernel (incl. idle), user
  userData: "",
  env: {},
  files: {},               // text files read before start-up, so readFileSync works
  autostart: false,
};
export const winwatchListeners = new Set();

export async function initNative() {
  native.userData = await invoke("user_data_dir");
  native.monitors = await invoke("monitors");
  native.cursor = await invoke("cursor_pos");
  for (const name of ["PET_DEBUG", "ANTHROPIC_BASE_URL", "ECHOBOT_SITE_URL"]) { const v = await invoke("env_var", { name }); if (v) native.env[name] = v; }
  const userData = native.env.PET_DEBUG ? native.env.PET_DEBUG + "\\userdata" : native.userData;
  native.userData = userData;
  try { native.files[userData + "\\settings.json"] = await invoke("read_text", { path: userData + "\\settings.json" }); }
  catch {
    // first run of the light build: carry over the full build's settings and progress (not the API key,
    // which only the full build can decrypt)
    if (!native.env.PET_DEBUG) {
      try {
        const appdata = await invoke("env_var", { name: "APPDATA" });
        const old = JSON.parse(await invoke("read_text", { path: appdata + "\\EchoBot\\settings.json" }));
        delete old.apiKey;
        native.files[userData + "\\settings.json"] = JSON.stringify(old);
      } catch {}
    }
  }
  await listen("cursor", (e) => { native.cursor = e.payload; });
  await listen("cpu", (e) => { native.cpu = e.payload; });
  await listen("winwatch", (e) => { for (const fn of winwatchListeners) fn(e.payload); });
  setInterval(async () => { try { native.monitors = await invoke("monitors"); } catch {} }, 5000);
}

// ---- physical <-> DIP (Electron's "screen" coordinates) ----
export function monitorAtPhysical(x, y) {
  return native.monitors.find((m) => x >= m.x && x < m.x + m.w && y >= m.y && y < m.y + m.h) || native.monitors.find((m) => m.primary) || native.monitors[0];
}
const dipRect = (m, x, y, w, h) => ({ x: Math.round(m.x + (x - m.x) / m.scale), y: Math.round(m.y + (y - m.y) / m.scale), width: Math.round(w / m.scale), height: Math.round(h / m.scale) });
export function toDip(x, y, w = 0, h = 0) { return dipRect(monitorAtPhysical(x + w / 2, y + h / 2), x, y, w, h); }
export function monitorAtDip(x, y) {
  return native.monitors.find((m) => { const b = dipRect(m, m.x, m.y, m.w, m.h); return x >= b.x && x < b.x + b.width && y >= b.y && y < b.y + b.height; })
    || native.monitors.find((m) => m.primary) || native.monitors[0];
}
export function toPhysical(x, y, w, h) {
  const m = monitorAtDip(x + w / 2, y + h / 2) || { x: 0, y: 0, scale: 1 };
  return { x: Math.round(m.x + (x - m.x) * m.scale), y: Math.round(m.y + (y - m.y) * m.scale), w: Math.round(w * m.scale), h: Math.round(h * m.scale) };
}
export function display(m, i) {
  return { id: i, scaleFactor: m.scale, bounds: dipRect(m, m.x, m.y, m.w, m.h), workArea: dipRect(m, m.wx, m.wy, m.ww, m.wh), primary: m.primary };
}
