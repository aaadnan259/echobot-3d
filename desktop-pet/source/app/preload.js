// The small, fixed set of messages an EchoBot window may send to and receive from the main process.
const { contextBridge, ipcRenderer } = require("electron");
const on = (ch) => (fn) => ipcRenderer.on(ch, (_e, d) => fn(d));
contextBridge.exposeInMainWorld("pet", {
  onTick: on("tick"), onPlay: on("play"), onSay: on("say"), onConfig: on("config"), onLand: on("land"), onFx: on("fx"),
  clickThrough: (v) => ipcRenderer.send("click-through", v),
  dragStart: () => ipcRenderer.send("drag-start"),
  dragEnd: () => ipcRenderer.send("drag-end"),
  menu: () => ipcRenderer.send("menu"),
  event: (type, data) => ipcRenderer.send("pet-event", type, data),
});
