// The slice of Electron's API that EchoBot's shared code uses, implemented on Tauri. This is what lets the
// light build run exactly the same pet, feature and settings code as the full build.
import { invoke } from "@tauri-apps/api/core";
import { emitTo, listen } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { Menu as TMenu, MenuItem, CheckMenuItem, Submenu, PredefinedMenuItem } from "@tauri-apps/api/menu";
import { TrayIcon } from "@tauri-apps/api/tray";
import { defaultWindowIcon } from "@tauri-apps/api/app";
import { LogicalPosition } from "@tauri-apps/api/dpi";
import * as shortcuts from "@tauri-apps/plugin-global-shortcut";
import * as notify from "@tauri-apps/plugin-notification";
import * as dialogPlugin from "@tauri-apps/plugin-dialog";
import { openUrl } from "@tauri-apps/plugin-opener";
import * as autostart from "@tauri-apps/plugin-autostart";
import { native, toDip, toPhysical, display } from "./native.js";

// ---------- small event helper ----------
class Emitter {
  constructor() { this._h = {}; }
  on(ev, fn) { (this._h[ev] ||= []).push(fn); return this; }
  once(ev, fn) { const w = (...a) => { this.off(ev, w); fn(...a); }; return this.on(ev, w); }
  off(ev, fn) { this._h[ev] = (this._h[ev] || []).filter((f) => f !== fn); return this; }
  emit(ev, ...a) { for (const f of [...(this._h[ev] || [])]) f(...a); return true; }
}

// ---------- app ----------
const willQuit = [];
let resolveReady;
const readyPromise = new Promise((r) => (resolveReady = r));
export const app = {
  _ready: () => resolveReady(),
  whenReady: () => readyPromise,
  setPath() {}, getPath: () => native.userData,
  requestSingleInstanceLock: () => true,
  commandLine: { appendSwitch() {} },
  on(ev, fn) {
    if (ev === "second-instance") listen("second-instance", () => fn());
    if (ev === "will-quit") willQuit.push(fn);
  },
  quit() { for (const f of willQuit) { try { f(); } catch {} } setTimeout(() => invoke("quit"), 300); },
  exit() { invoke("quit"); },
  getLoginItemSettings: () => ({ openAtLogin: native.autostart }),
  setLoginItemSettings({ openAtLogin }) { native.autostart = !!openAtLogin; (openAtLogin ? autostart.enable() : autostart.disable()).catch(() => {}); },
};

// ---------- screen ----------
export const screen = {
  getCursorScreenPoint() { const p = toDip(native.cursor[0], native.cursor[1]); return { x: p.x, y: p.y }; },
  getAllDisplays: () => native.monitors.map(display),
  getPrimaryDisplay() { const i = Math.max(0, native.monitors.findIndex((m) => m.primary)); return display(native.monitors[i], i); },
  getDisplayNearestPoint({ x, y }) {
    const ds = screen.getAllDisplays();
    let best = ds[0], bd = Infinity;
    for (const d of ds) {
      const b = d.bounds, dx = Math.max(b.x - x, 0, x - (b.x + b.width - 1)), dy = Math.max(b.y - y, 0, y - (b.y + b.height - 1)), dist = dx * dx + dy * dy;
      if (dist < bd) { bd = dist; best = d; }
    }
    return best;
  },
  screenToDipRect(_w, r) { return toDip(r.x, r.y, r.width, r.height); },
  on() {},
};

// ---------- windows ----------
const windows = new Map();            // label -> BrowserWindow
let nextId = 1;
class WebContents extends Emitter {
  constructor(win) { super(); this.win = win; }
  send(ch, data) { if (!this.win._destroyed) emitTo(this.win.label, "msg", { to: this.win.label, ch, data }).catch(() => {}); }
  executeJavaScript(js) {
    const id = Math.random().toString(36).slice(2);
    return new Promise((resolve, reject) => {
      let un;
      listen("eval-reply", (e) => { if (e.payload.id !== id) return; un && un(); e.payload.error ? reject(new Error(e.payload.error)) : resolve(e.payload.result); }).then((u) => (un = u));
      setTimeout(() => emitTo(this.win.label, "eval", { to: this.win.label, id, js }), 50);
    });
  }
  capturePage() { return Promise.reject(new Error("capturePage isn't available in the light build")); }
}
export class BrowserWindow extends Emitter {
  constructor(opts = {}) {
    super();
    this.opts = opts;
    this.label = "w" + nextId++;
    this.bounds = { x: opts.x ?? 100, y: opts.y ?? 100, width: opts.width || 400, height: opts.height || 300 };
    if (opts.x === undefined) { const wa = screen.getPrimaryDisplay().workArea; this.bounds.x = Math.round(wa.x + (wa.width - this.bounds.width) / 2); this.bounds.y = Math.round(wa.y + (wa.height - this.bounds.height) / 2); }
    this._visible = false; this._destroyed = false; this._ignore = false;
    this.webContents = new WebContents(this);
    this.title = opts.title || "EchoBot";
    windows.set(this.label, this);
  }
  static getAllWindows() { return [...windows.values()].filter((w) => !w._destroyed); }
  loadFile(file, { query } = {}) {
    const name = String(file).split(/[\\/]/).pop();
    const qs = new URLSearchParams({ ...(query || {}), __label: this.label }).toString();
    this._create(name + "?" + qs);
  }
  loadURL(url) { this._create(url); }
  _create(url) {
    const o = this.opts, b = this.bounds;
    this.tw = new WebviewWindow(this.label, {
      url, x: b.x, y: b.y, width: b.width, height: b.height, title: this.title,
      transparent: !!o.transparent, decorations: o.frame !== false, resizable: o.resizable !== false, skipTaskbar: !!o.skipTaskbar,
      alwaysOnTop: !!o.alwaysOnTop, visible: false, focus: false, shadow: o.hasShadow !== false && o.frame !== false,
      minWidth: o.minWidth, minHeight: o.minHeight, backgroundColor: o.transparent ? [0, 0, 0, 0] : undefined,
    });
    this.tw.once("tauri://error", (e) => console.error("window error", e));
    this.tw.listen("tauri://destroyed", () => this._gone()).catch(() => {});
    this.tw.onCloseRequested(async (event) => {
      let prevented = false;
      const e = { preventDefault() { prevented = true; event.preventDefault(); } };
      this.emit("close", e);
      if (!prevented) setTimeout(() => this._gone(), 100);
    }).catch(() => {});
    this.tw.onFocusChanged(({ payload }) => { if (!payload) this.emit("blur"); }).catch(() => {});
  }
  _pageReady() {
    if (this._loaded) { this.webContents.emit("did-finish-load"); return; }
    this._loaded = true;
    if (this._pendingIgnore !== undefined) this.setIgnoreMouseEvents(this._pendingIgnore);
    this.webContents.emit("did-finish-load");
    this.emit("ready-to-show");
  }
  _gone() { if (this._destroyed) return; this._destroyed = true; windows.delete(this.label); this.emit("closed"); }
  isDestroyed() { return this._destroyed; }
  getBounds() { return { ...this.bounds }; }
  setBounds(b) {
    const nb = { x: Math.round(b.x ?? this.bounds.x), y: Math.round(b.y ?? this.bounds.y), width: Math.round(b.width ?? this.bounds.width), height: Math.round(b.height ?? this.bounds.height) };
    if (nb.x === this.bounds.x && nb.y === this.bounds.y && nb.width === this.bounds.width && nb.height === this.bounds.height && this._placed) return;
    this.bounds = nb; this._placed = true;
    const p = toPhysical(nb.x, nb.y, nb.width, nb.height);
    invoke("set_bounds", { label: this.label, x: p.x, y: p.y, w: p.w, h: p.h }).catch(() => {});
  }
  setPosition(x, y) { this.setBounds({ x, y }); }
  getPosition() { return [this.bounds.x, this.bounds.y]; }
  show() { this._visible = true; this.tw && this.tw.show().then(() => this.tw.setFocus()).catch(() => {}); }
  showInactive() { this._visible = true; invoke("show_inactive", { label: this.label }).catch(() => {}); }
  hide() { this._visible = false; this.tw && this.tw.hide().catch(() => {}); }
  isVisible() { return this._visible && !this._destroyed; }
  focus() { this.tw && this.tw.setFocus().catch(() => {}); }
  getTitle() { return this.title; }
  setIgnoreMouseEvents(on) {
    if (!this._loaded) { this._pendingIgnore = on; return; }
    if (this._ignore === on) return;
    this._ignore = on;
    this.tw && this.tw.setIgnoreCursorEvents(on).catch(() => {});
  }
  setAlwaysOnTop(on) { invoke("set_topmost", { label: this.label, on: !!on }).catch(() => {}); }
  close() { this.tw ? this.tw.close().catch(() => {}) : this._gone(); }
  destroy() { const tw = this.tw; this._gone(); tw && tw.destroy().catch(() => {}); }
}

// ---------- IPC from pages (they talk to us through the bridge script) ----------
class IpcMain extends Emitter {
  constructor() { super(); this.handlers = {}; }
  handle(ch, fn) { this.handlers[ch] = fn; }
}
export const ipcMain = new IpcMain();
export async function startIpc() {
  await listen("ipc", async (e) => {
    const { label, ch, args = [], id } = e.payload;
    const win = windows.get(label);
    if (ch === "__ready") { if (win) { if (args[0] && !win.opts.title) win.title = args[0]; win._pageReady(); } return; }
    const event = { sender: win ? win.webContents : { label } };
    if (id) {
      try { const result = await ipcMain.handlers[ch](event, ...args); emitTo(label, "ipc-reply", { to: label, id, result: result === undefined ? null : result }); }
      catch (err) { emitTo(label, "ipc-reply", { to: label, id, error: String(err && err.message || err) }); }
    } else ipcMain.emit(ch, event, ...args);
  });
}

// ---------- menus and tray ----------
async function buildItems(template) {
  const out = [];
  for (const it of template) {
    if (it.visible === false) continue;
    if (it.type === "separator") { out.push(await PredefinedMenuItem.new({ item: "Separator" })); continue; }
    if (it.submenu) { out.push(await Submenu.new({ text: it.label, items: await buildItems(it.submenu) })); continue; }
    if (it.type === "checkbox" || it.type === "radio") {
      const checked = !!it.checked;
      out.push(await CheckMenuItem.new({ text: it.label, checked, enabled: it.enabled !== false, action: () => it.click && it.click({ checked: it.type === "radio" ? true : !checked }) }));
      continue;
    }
    out.push(await MenuItem.new({ text: it.label, enabled: it.enabled !== false, action: () => it.click && it.click({}) }));
  }
  return out;
}
export const Menu = {
  buildFromTemplate(template) {
    return {
      template,
      build: async () => TMenu.new({ items: await buildItems(template) }),
      async popup({ window } = {}) {
        const m = await this.build();
        const w = window && window.tw;
        const [x, y] = native.cursor, d = toDip(x, y);
        await m.popup(new LogicalPosition(d.x - (window ? window.bounds.x : 0), d.y - (window ? window.bounds.y : 0)), w).catch(() => m.popup());
      },
    };
  },
};
export const nativeImage = { createFromPath: (p) => ({ path: p, resize() { return this; } }) };
export class Tray extends Emitter {
  constructor() {
    super();
    this.ready = (async () => {
      this.t = await TrayIcon.new({ icon: await defaultWindowIcon(), tooltip: "EchoBot", showMenuOnLeftClick: false,
        action: (e) => { if (e.type === "Click" && e.button === "Left" && e.buttonState === "Up") this.emit("click"); } });
    })();
  }
  async setContextMenu(menu) { await this.ready; this.t.setMenu(await menu.build()); }
  async setToolTip(t) { await this.ready; this.t.setTooltip(t); }
}

// ---------- everything else ----------
const registered = new Set();
export const globalShortcut = {
  register(key, fn) {
    registered.add(key);
    shortcuts.register(key, (e) => { if (!e || e.state === "Pressed") fn(); }).catch((err) => { registered.delete(key); console.error("shortcut", err); });
    return true;
  },
  unregisterAll() { registered.clear(); shortcuts.unregisterAll().catch(() => {}); },
  isRegistered: (key) => registered.has(key),
};
export const session = { defaultSession: { setDisplayMediaRequestHandler() {}, setPermissionRequestHandler() {} } };
export const desktopCapturer = { getSources: async () => [] };
export const shell = { openExternal: (url) => openUrl(url) };
export class Notification {
  static isSupported() { return true; }
  constructor(o) { this.o = o; }
  async show() {
    let ok = await notify.isPermissionGranted();
    if (!ok) ok = (await notify.requestPermission()) === "granted";
    if (ok) notify.sendNotification({ title: this.o.title, body: this.o.body });
  }
}
export const safeStorage = { isEncryptionAvailable: () => true };
export const dialog = {
  async showOpenDialog({ filters, title }) {
    const p = await dialogPlugin.open({ title, multiple: false, filters });
    return p ? { canceled: false, filePaths: [p] } : { canceled: true, filePaths: [] };
  },
};
export async function initElectronShim() {
  native.autostart = await autostart.isEnabled().catch(() => false);
}
