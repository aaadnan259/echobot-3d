const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("overlay", {
  clickThrough: (on) => ipcRenderer.send("overlay:click-through", on),
  pop: () => ipcRenderer.send("overlay:pop"),
  done: (score) => ipcRenderer.send("overlay:done", score),
});
