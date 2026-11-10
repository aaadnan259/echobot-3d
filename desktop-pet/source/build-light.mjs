// Builds the light (Tauri) EchoBot: run `node build.mjs` first (it makes the shared renderer bundle), then
// `node build-light.mjs`. Output: ../EchoBot Pet Lite/EchoBot.exe, a single ~15 MB file.
import { build } from "esbuild";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, statSync } from "fs";
import { execSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const full = path.resolve(here, "..", "EchoBot Pet", "resources", "app");       // the full build's output (shared pages + renderer)
const dist = path.join(here, "dist-tauri");
const shim = path.join(here, "tauri-shim");
if (!existsSync(path.join(full, "renderer.js"))) throw new Error("Run `node build.mjs` first.");
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

// 1. pages and assets, with the bridge loaded first and IPC allowed by the page's security policy
for (const f of ["echobot-model.js", "renderer.js", "icon.png"]) cpSync(path.join(full, f), path.join(dist, f));
cpSync(path.join(full, "games"), path.join(dist, "games"), { recursive: true });
for (const page of readdirSync(full).filter((f) => f.endsWith(".html"))) {
  let html = readFileSync(path.join(full, page), "utf8");
  html = html.replace(/content="default-src 'self';/, `content="default-src 'self'; connect-src 'self' ipc: http://ipc.localhost;`);
  html = html.replace(/<\/title>/, "</title>\n<script src=\"bridge.js\"></script>");
  writeFileSync(path.join(dist, page), html);
}
writeFileSync(path.join(dist, "brain.html"), '<!doctype html><html><head><meta charset="utf-8"><title>EchoBot brain</title></head><body><script src="brain.js"></script></body></html>');

// 2. the bridge (every page) and the brain (the shared main-process code on top of the shims)
const swap = {
  name: "light-build-swaps",
  setup(b) {
    const to = (file) => ({ path: path.join(shim, file) });
    b.onResolve({ filter: /^electron$/ }, () => to("electron.js"));
    for (const m of ["fs", "path", "os", "child_process"]) b.onResolve({ filter: new RegExp("^" + m + "$") }, () => to("mod-" + m + ".js"));
    b.onResolve({ filter: /claude-sdk\.js$/ }, () => to("claude-sdk.js"));
    b.onResolve({ filter: /^\.\/secret$/ }, () => to("secret.js"));
    b.onResolve({ filter: /^\.\.\/http$/ }, () => to("http.js"));
  },
};
const common = { bundle: true, minify: true, format: "iife", target: "chrome120", platform: "browser", logLevel: "warning", legalComments: "eof" };
await build({ ...common, entryPoints: [path.join(shim, "bridge.js")], outfile: path.join(dist, "bridge.js") });
await build({ ...common, entryPoints: [path.join(shim, "brain.js")], outfile: path.join(dist, "brain.js"), plugins: [swap], define: { __dirname: '"."' } });

// 3. compile the native core with the pages embedded, and copy the exe out
execSync("cargo build --release", { cwd: path.join(here, "tauri"), stdio: "inherit" });
const outDir = path.resolve(here, "..", "EchoBot Pet Lite");
mkdirSync(outDir, { recursive: true });
cpSync(path.join(here, "tauri", "target", "release", "echobot-pet.exe"), path.join(outDir, "EchoBot.exe"));
console.log("Built", path.join(outDir, "EchoBot.exe"), (statSync(path.join(outDir, "EchoBot.exe")).size / 1048576).toFixed(1) + " MB");
