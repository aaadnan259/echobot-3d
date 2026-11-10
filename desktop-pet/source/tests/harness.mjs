// Starts the real EchoBot.exe with test hooks on (its own settings folder, so yours are untouched)
// and gives tests a way to send commands and read its state.
import { spawn, execFileSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const EXE = process.env.PET_EXE || path.resolve(here, "..", "..", "EchoBot Pet", "EchoBot.exe");
export const LIGHT = /Lite/.test(EXE);
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function launch({ settings = {}, name = "run", env = {} } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "echobot-" + name + "-"));
  fs.mkdirSync(path.join(dir, "userdata"), { recursive: true });
  fs.writeFileSync(path.join(dir, "userdata", "settings.json"), JSON.stringify({ firstRun: false, ...settings }));
  const proc = spawn(EXE, [], { env: { ...process.env, PET_DEBUG: dir, ...env }, stdio: "ignore" });
  let n = 0;
  const pet = {
    dir, proc,
    // the pet rewrites state.json 5 times a second; retry if we catch it mid-write
    state() { for (let i = 0; i < 20; i++) { try { return JSON.parse(fs.readFileSync(path.join(dir, "state.json"), "utf8")); } catch { const t = Date.now(); while (Date.now() - t < 15) {} } } return null; },
    send(cmd) { fs.writeFileSync(path.join(dir, `cmd-${String(++n).padStart(4, "0")}.json`), JSON.stringify(cmd)); },
    async waitFor(fn, ms = 8000, label = "condition") {
      const end = Date.now() + ms;
      while (Date.now() < end) { const s = pet.state(); if (s && fn(s)) return s; await sleep(100); }
      throw new Error("timed out waiting for " + label + "; last state: " + JSON.stringify(pet.state() && pet.state().pets));
    },
    async main(js, ms = 5000) {
      const out = `main-${++n}.json`;
      pet.send({ cmd: "main", js, out });
      const f = path.join(dir, out), end = Date.now() + ms;
      while (Date.now() < end) { if (fs.existsSync(f)) { await sleep(50); return JSON.parse(fs.readFileSync(f, "utf8")); } await sleep(80); }
      throw new Error("main() timed out: " + js);
    },
    async evalIn(js, role = "main", ms = 5000) {
      const out = `eval-${++n}.json`;
      pet.send({ cmd: "eval", js, out, role });
      const f = path.join(dir, out), end = Date.now() + ms;
      while (Date.now() < end) { if (fs.existsSync(f)) { await sleep(50); return JSON.parse(fs.readFileSync(f, "utf8")); } await sleep(80); }
      throw new Error("eval timed out");
    },
    async capture(file, role = "main") {
      if (LIGHT) {   // the light build can't screenshot its own window: grab that part of the screen instead
        const st = pet.state(); const p = st && st.pets.find((x) => x.role === role); if (!p) throw new Error("no pet to capture");
        const out = path.join(dir, file);
        execFileSync("powershell", ["-NoProfile", "-Command", `Add-Type -AssemblyName System.Drawing; $b = New-Object Drawing.Bitmap ${p.s}, ${p.s}; $g = [Drawing.Graphics]::FromImage($b); $g.CopyFromScreen(${p.x}, ${p.y}, 0, 0, $b.Size); $b.Save('${out}')`]);
        return out;
      }
      pet.send({ cmd: "capture", file, role });
      const f = path.join(dir, file), end = Date.now() + 5000;
      while (Date.now() < end) { if (fs.existsSync(f)) { await sleep(100); return f; } await sleep(100); }
      throw new Error("capture timed out");
    },
    async quit() { pet.send({ cmd: "quit" }); await sleep(1500); try { proc.kill(); } catch {} },
  };
  await pet.waitFor((s) => s.pets && s.pets.length, 20000, "startup");
  return pet;
}

// Windows helpers for tests: open a window we control and move it around.
const PS = (script) => execFileSync("powershell", ["-NoProfile", "-Command", script], { encoding: "utf8" }).trim();
const U32 = `Add-Type -Namespace W -Name U -MemberDefinition '[DllImport("user32.dll")] public static extern bool MoveWindow(System.IntPtr h, int x, int y, int w, int ht, bool r); [DllImport("user32.dll")] public static extern bool SetForegroundWindow(System.IntPtr h); [DllImport("user32.dll")] public static extern bool ShowWindow(System.IntPtr h, int c);';`;
export function openTestWindow(title = "EchoBot test window") {
  // a plain PowerShell-hosted WinForms window: predictable and closes cleanly
  const script = `Add-Type -AssemblyName System.Windows.Forms; $f = New-Object Windows.Forms.Form; $f.Text = '${title}'; $f.StartPosition = 'Manual'; $f.Left = 300; $f.Top = 400; $f.Width = 700; $f.Height = 400; $f.TopMost = $false; [Windows.Forms.Application]::Run($f)`;
  const p = spawn("powershell", ["-NoProfile", "-Command", script], { stdio: "ignore", detached: false });
  return p;
}
export function findWindow(title) {
  return PS(`(Get-Process | Where-Object { $_.MainWindowTitle -eq '${title}' } | Select-Object -First 1).MainWindowHandle`);
}
export function moveWindow(hwnd, x, y, w, h) { PS(`${U32} [W.U]::MoveWindow([IntPtr]${hwnd}, ${x}, ${y}, ${w}, ${h}, $true) | Out-Null; [W.U]::SetForegroundWindow([IntPtr]${hwnd}) | Out-Null`); }
export function minimizeWindow(hwnd) { PS(`${U32} [W.U]::ShowWindow([IntPtr]${hwnd}, 6) | Out-Null`); }

export function check(results, name, ok, info = "") {
  results.push({ name, ok: !!ok, info });
  console.log((ok ? "PASS " : "FAIL ") + name + (info ? "  (" + info + ")" : ""));
}
