// Builds the desktop pet: bundles the renderer with esbuild, compiles the tiny Windows helper, and copies
// everything into "../EchoBot Pet/resources/app", which is the folder EchoBot.exe runs.
import { build } from "esbuild";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "fs";
import { execFileSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, "..", "EchoBot Pet", "resources", "app");
mkdirSync(out, { recursive: true });

// 1. the Windows helper (only rebuilt when its source changes)
const exe = path.join(here, "native", "winwatch.exe"), cs = path.join(here, "native", "winwatch.cs");
if (!existsSync(exe) || statSync(cs).mtimeMs > statSync(exe).mtimeMs) {
  const csc = "C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe";
  execFileSync(csc, ["-nologo", "-optimize", "-target:winexe", "-out:" + exe, cs], { stdio: "inherit" });
}

// 2. clear old app files (keep nothing stale), then copy the app folder and the helper
for (const f of readdirSync(out)) rmSync(path.join(out, f), { recursive: true, force: true });
cpSync(path.join(here, "app"), out, { recursive: true });
cpSync(exe, path.join(out, "winwatch.exe"));

// Echo Hop, copied in without its web-font links so the pet's copy works fully offline
const hopSrc = path.resolve(here, "..", "..", "game", "echo-hop.html");
if (existsSync(hopSrc)) {
  mkdirSync(path.join(out, "games"), { recursive: true });
  const html = readFileSync(hopSrc, "utf8").replace(/<link[^>]+fonts\.(googleapis|gstatic)\.com[^>]*>\s*/g, "");
  writeFileSync(path.join(out, "games", "echo-hop.html"), html);
}

// 3. bundle the renderers
const common = { bundle: true, minify: true, legalComments: "eof", target: "chrome130", format: "iife", logLevel: "warning" };
await build({ ...common, entryPoints: [path.join(here, "renderer", "index.js")], outfile: path.join(out, "renderer.js") });
for (const page of ["settings", "toy", "overlay", "chatbox"]) {
  const entry = path.join(here, "renderer", page + ".js");
  if (existsSync(entry)) await build({ ...common, entryPoints: [entry], outfile: path.join(out, page + ".js") });
}
// 4. the Claude SDK for the opt-in chat (main process, Node)
await build({ bundle: true, minify: true, platform: "node", format: "cjs", target: "node20", logLevel: "warning", legalComments: "eof",
  entryPoints: [path.join(here, "mainlib", "claude-sdk.js")], outfile: path.join(out, "claude-sdk.js") });
console.log("Built into", out);
