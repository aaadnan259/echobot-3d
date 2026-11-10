// Runs every phase's tests against the full build, then the light build (if it exists). Usage: node tests/run-all.mjs
import { spawnSync } from "child_process";
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
const here = path.dirname(fileURLToPath(import.meta.url));
const builds = [["full", path.resolve(here, "..", "..", "EchoBot Pet", "EchoBot.exe")], ["light", path.resolve(here, "..", "..", "EchoBot Pet Lite", "EchoBot.exe")]].filter(([, exe]) => existsSync(exe));
const phases = ["phase1-physics", "phase2-reactions", "phase3-useful", "phase4-fun", "phase5-settings"];
const summary = [];
for (const [name, exe] of builds) for (const ph of phases) {
  const r = spawnSync(process.execPath, [path.join(here, ph + ".mjs")], { env: { ...process.env, PET_EXE: exe }, encoding: "utf8", timeout: 400000 });
  const out = (r.stdout || "") + (r.stderr || "");
  const m = out.match(/(\d+)\/(\d+) passed/);
  const fails = out.split("\n").filter((l) => l.startsWith("FAIL"));
  summary.push(`${name.padEnd(5)} ${ph.padEnd(17)} ${m ? m[0] : "did not finish"}${fails.length ? "\n      " + fails.join("\n      ") : ""}`);
  console.log(summary[summary.length - 1]);
}
console.log("\n" + summary.join("\n"));
