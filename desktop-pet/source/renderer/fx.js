// Little 2D effects drawn over EchoBot: hearts, music notes, Zzz, sweat drops, confetti and snow.
const layer = document.getElementById("fx");
const CONFETTI = ["#ff5fa2", "#ffd84d", "#7ae7ff", "#9aff6b", "#b48cff", "#ff9b2e"];

function spawn(cls, x, y, text, vars = {}, life = 2500) {
  const el = document.createElement("div");
  el.className = "p " + cls;
  el.style.left = x + "%"; el.style.top = y + "%";
  if (text) el.textContent = text;
  for (const [k, v] of Object.entries(vars)) el.style.setProperty(k, v);
  layer.appendChild(el);
  setTimeout(() => el.remove(), life);
  return el;
}
const rnd = (a, b) => a + Math.random() * (b - a);

export function fx(type, opts = {}) {
  const n = opts.n || 1;
  for (let i = 0; i < n; i++) {
    const delay = i * (opts.spread || 120);
    setTimeout(() => {
      if (type === "hearts") spawn("heart", rnd(35, 60), rnd(38, 52), ["💜", "💖", "💗"][i % 3], { "--dx": rnd(-25, 25) + "px" }, 1700);
      else if (type === "notes") spawn("note", rnd(25, 70), rnd(30, 50), ["♪", "♫", "♬"][i % 3], { "--dx": rnd(-30, 30) + "px" }, 2300);
      else if (type === "zzz") spawn("zzz", 60, 32, "z", {}, 2700);
      else if (type === "sweat") spawn("sweat", rnd(62, 68), rnd(36, 42), "", {}, 1200);
      else if (type === "confetti") spawn("conf", rnd(45, 55), rnd(40, 50), "", {
        "--dx": rnd(-110, 110) + "px", "--dy": rnd(-90, 60) + "px", background: CONFETTI[i % CONFETTI.length] }, 1900);
      else if (type === "snow") spawn("snow", rnd(0, 100), 0, "", { "--dx": rnd(-30, 30) + "px" }, 4100);
      else if (type === "sparkle") spawn("note", rnd(30, 70), rnd(30, 55), "✦", { "--dx": rnd(-20, 20) + "px", color: "#ffd84d" }, 2000);
      else if (type === "coin") spawn("note", rnd(40, 60), 40, "🪙", { "--dx": rnd(-10, 10) + "px" }, 2000);
    }, delay);
  }
}
