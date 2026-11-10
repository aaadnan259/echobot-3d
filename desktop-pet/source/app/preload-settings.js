const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("echo", {
  get: () => ipcRenderer.invoke("settings:get"),
  set: (patch) => ipcRenderer.invoke("settings:set", patch),
  action: (name, arg) => ipcRenderer.invoke("settings:action", name, arg),
  onSettings: (fn) => ipcRenderer.on("settings", (_e, s) => fn(s)),
  onTab: (fn) => ipcRenderer.on("tab", (_e, t) => fn(t)),
});
