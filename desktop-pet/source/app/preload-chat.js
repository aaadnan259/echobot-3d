const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("chat", {
  send: (text) => ipcRenderer.invoke("chat:send", text),
  info: () => ipcRenderer.invoke("chat:info"),
  close: () => ipcRenderer.send("chat:close"),
  settings: () => ipcRenderer.send("chat:settings"),
});
