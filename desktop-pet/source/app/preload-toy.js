const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("toy", {
  dragStart: () => ipcRenderer.send("toy:drag-start"),
  dragEnd: () => ipcRenderer.send("toy:drag-end"),
  click: () => ipcRenderer.send("toy:click"),
});
