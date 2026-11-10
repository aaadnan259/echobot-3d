// Tiny stand-ins for the Node modules the shared code touches: fs, path, os and child_process.
import { invoke } from "@tauri-apps/api/core";
import { native, winwatchListeners } from "./native.js";

// ---- fs: synchronous reads come from files loaded at start-up; writes go to disk in the background ----
const writeQueue = new Map();
export const fs = {
  readFileSync(p) { if (p in native.files) return native.files[p]; const e = new Error("ENOENT: " + p); e.code = "ENOENT"; throw e; },
  writeFileSync(p, text) {
    native.files[p] = String(text);
    // coalesce rapid writes of the same file
    if (!writeQueue.has(p)) setTimeout(() => { const t = writeQueue.get(p); writeQueue.delete(p); invoke("write_text", { path: p, text: t }).catch(() => {}); }, 50);
    writeQueue.set(p, String(text));
  },
  existsSync: (p) => p in native.files,
  mkdirSync() {},
  promises: {
    readFile: async (p) => invoke("read_text", { path: p }),
    writeFile: async (p, data) => invoke("write_text", { path: p, text: typeof data === "string" ? data : new TextDecoder().decode(data) }),
    readdir: async (p) => invoke("list_dir", { path: p }),
    unlink: async (p) => invoke("remove_file", { path: p }),
    mkdir: async () => {},
  },
};

// ---- path (Windows style) ----
export const path = {
  sep: "\\",
  join: (...parts) => parts.filter((x) => x !== "" && x != null).join("\\").replace(/[\\/]+/g, "\\").replace(/\\\.\\/g, "\\"),
  resolve: (...parts) => path.join(...parts),
  dirname: (p) => String(p).replace(/[\\/][^\\/]*$/, ""),
  basename: (p) => String(p).split(/[\\/]/).pop(),
  extname: (p) => (String(p).match(/\.[^.\\/]*$/) || [""])[0],
};

// ---- os ----
export const os = {
  cpus() { const [idle, kernel, user] = native.cpu; return [{ times: { user, nice: 0, sys: Math.max(0, kernel - idle), irq: 0, idle } }]; },
  tmpdir: () => native.userData,
};

// ---- child_process: the only process EchoBot starts is its window watcher, which the native core runs instead ----
export const child_process = {
  spawn() {
    const out = { _fns: [], setEncoding() {}, on(ev, fn) { if (ev === "data") this._fns.push(fn); } };
    const listener = (line) => { for (const f of out._fns) f(line + "\n"); };
    winwatchListeners.add(listener);
    invoke("watch_start").catch(() => {});
    return { stdout: out, on() {}, kill() { winwatchListeners.delete(listener); } };
  },
};
