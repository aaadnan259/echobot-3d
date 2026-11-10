// The light build's hidden "brain" page: starts the native bridge, then runs EchoBot's normal main code.
import { initNative, native } from "./native.js";
import { initElectronShim, startIpc, app } from "./electron.js";
import * as electron from "./electron.js";
import { fs, path, os, child_process } from "./node.js";

(async () => {
  await initNative();
  await initElectronShim();
  globalThis.process = { env: { ...native.env }, pid: 0, platform: "win32", execPath: "" };
  // lets the automated tests' main-process snippets reach the same modules
  globalThis.__testRequire = (m) => ({ electron, fs, path, os, child_process })[m] || null;
  await startIpc();
  require("../app/main.js");
  app._ready();
})().catch((e) => { document.title = "brain error"; console.error(e); });
