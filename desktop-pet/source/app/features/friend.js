// A second EchoBot in another colour. It wanders on its own; when the two meet they say hi, and if one lands
// on the other they boing off each other.
let api, nextHello = 0;
const HELLOS = [["Hi buddy!", "Beep!"], ["Nice hat.", "Thanks!"], ["Race you!", "You're on!"], ["*waves*", "*waves back*"], ["Echo!", "…echo!"]];

module.exports = {
  init(a) { api = a; },
  menu() {
    const has = api.pets().some((p) => p.role === "friend");
    return [{ label: has ? "Send the friend home" : "Invite a friend", click: () => {
      if (has) { api.say("Bye bye!", { pet: api.pets().find((p) => p.role === "friend"), ms: 1500 }); setTimeout(() => api.removeFriend(), 900); }
      else { api.addFriend(); setTimeout(() => api.say("A friend! 💜", { ms: 3000 }), 1500); }
    } }];
  },
  tick(now) {
    const [a, b] = [api.main(), api.pets().find((p) => p.role === "friend")];
    if (!a || !b || a.hidden || b.hidden) return;
    const dx = b.center().x - a.center().x, dy = b.feetY() - a.feetY();
    // bump: one falling onto the other bounces off
    for (const [top, bottom] of [[a, b], [b, a]]) {
      if (top.state === "air" && top.body.vy > 200 && Math.abs(top.center().x - bottom.center().x) < bottom.s * 0.35
        && top.feetY() > bottom.body.y + bottom.s * 0.35 && top.feetY() < bottom.feetY()) {
        top.body.vy = -Math.max(700, top.body.vy * 0.8); top.body.vx += (top.center().x < bottom.center().x ? -1 : 1) * 200;
        bottom.send("land", { impact: 0.6 }); top.send("land", { impact: 0.3 });
        api.play("Surprised", { pet: bottom });
      }
    }
    // meet and greet
    if (now > nextHello && a.state === "ground" && b.state === "ground" && Math.abs(dy) < 30 && Math.abs(dx) < a.s * 1.6 && !api.quiet()) {
      nextHello = now + 60000 + Math.random() * 60000;
      const [l1, l2] = HELLOS[Math.floor(Math.random() * HELLOS.length)];
      api.say(l1, { pet: a, ms: 2500 }); api.play("Happy", { pet: a });
      setTimeout(() => { api.say(l2, { pet: b, ms: 2500 }); api.play("Wave", { pet: b }); }, 1200);
    }
  },
  status: () => ({ present: api.pets().some((p) => p.role === "friend") }),
};
