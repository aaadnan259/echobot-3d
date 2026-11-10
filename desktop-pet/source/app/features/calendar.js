// Calendar pop-ups: EchoBot tells you a few minutes before an event starts. OFF by default. It reads an
// iCalendar (.ics) feed: either a file on your PC or your calendar's private "secret address in iCal
// format" link (Google Calendar, Outlook.com and iCloud all offer one). It handles normal events and the
// common repeating ones (daily / weekly, with end dates and skipped days). Times with a time zone name are
// read as your local time. Nothing is sent anywhere; the link is only downloaded every 15 minutes.
const fs = require("fs");
const { Notification } = require("electron");
let api, events = [], lastLoad = 0, lastCheck = 0, loadedFrom = "", lastError = "", announced = {}, lastAnnounced = "";

function unfold(text) { return text.replace(/\r?\n[ \t]/g, "").split(/\r?\n/); }
function parseDate(value, params) {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, s, z] = m;
  if (h === undefined) return { date: new Date(+y, mo - 1, +d), allDay: true };
  if (z) return { date: new Date(Date.UTC(+y, mo - 1, +d, +h, +mi, +s)), allDay: false };
  return { date: new Date(+y, mo - 1, +d, +h, +mi, +s), allDay: false };   // floating or TZID: local time
}
function parseIcs(text) {
  const out = [];
  let cur = null;
  for (const line of unfold(text)) {
    if (line === "BEGIN:VEVENT") { cur = { exdates: [] }; continue; }
    if (line === "END:VEVENT") { if (cur && cur.start && cur.summary !== undefined) out.push(cur); cur = null; continue; }
    if (!cur) continue;
    const i = line.indexOf(":"); if (i < 0) continue;
    const [name, ...params] = line.slice(0, i).split(";"), value = line.slice(i + 1);
    if (name === "SUMMARY") cur.summary = value.replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\n/gi, " ").trim();
    else if (name === "DTSTART") { const d = parseDate(value, params); if (d) { cur.start = d.date; cur.allDay = d.allDay; } }
    else if (name === "RRULE") cur.rrule = Object.fromEntries(value.split(";").map((kv) => kv.split("=")));
    else if (name === "EXDATE") value.split(",").forEach((v) => { const d = parseDate(v, params); if (d) cur.exdates.push(d.date.getTime()); });
    else if (name === "STATUS" && value === "CANCELLED") cur.cancelled = true;
  }
  return out.filter((e) => !e.cancelled && !e.allDay);
}
const DAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
// Start times of an event between `from` and `to`.
function occurrences(ev, from, to) {
  const res = [];
  if (!ev.rrule) { if (ev.start >= from && ev.start <= to) res.push(ev.start); return res; }
  const r = ev.rrule, freq = r.FREQ, interval = +(r.INTERVAL || 1);
  if (freq !== "DAILY" && freq !== "WEEKLY") { if (ev.start >= from && ev.start <= to) res.push(ev.start); return res; }
  const until = r.UNTIL ? parseDate(r.UNTIL).date : null, count = r.COUNT ? +r.COUNT : Infinity;
  const byDay = r.BYDAY ? r.BYDAY.split(",").map((d) => DAYS.indexOf(d.slice(-2))) : [ev.start.getDay()];
  let n = 0;
  const day0 = new Date(ev.start.getFullYear(), ev.start.getMonth(), ev.start.getDate());
  for (let k = 0; k < 3700 && n < count; k++) {
    const day = new Date(day0.getFullYear(), day0.getMonth(), day0.getDate() + k);
    const daysFromStart = Math.round((day - day0) / 86400000);
    let hit;
    if (freq === "DAILY") hit = daysFromStart % interval === 0;
    else { const week = Math.floor((daysFromStart + day0.getDay()) / 7); hit = week % interval === 0 && byDay.includes(day.getDay()); }
    if (!hit) continue;
    const t = new Date(day.getFullYear(), day.getMonth(), day.getDate(), ev.start.getHours(), ev.start.getMinutes(), ev.start.getSeconds());
    if (t < ev.start) continue;
    if (until && t > until) break;
    n++;
    if (t > to) break;
    if (t >= from && !ev.exdates.includes(t.getTime())) res.push(t);
  }
  return res;
}

async function load() {
  const src = (api.store.get().calendar.source || "").trim();
  lastLoad = Date.now();
  if (!src) { events = []; return; }
  try {
    let text;
    if (/^(https|webcal):\/\//i.test(src)) {
      const res = await fetch(src.replace(/^webcal:/i, "https:"), { headers: { "User-Agent": "EchoBot-desktop-pet" } });
      if (!res.ok) throw new Error("the calendar link answered " + res.status);
      text = await res.text();
    } else text = await fs.promises.readFile(src.replace(/^"|"$/g, ""), "utf8");
    if (!/BEGIN:VCALENDAR/.test(text)) throw new Error("that doesn't look like a calendar (.ics) feed");
    events = parseIcs(text); loadedFrom = src; lastError = "";
  } catch (e) { lastError = String(e.message || e); }
}

function upcoming(hours = 24) {
  const now = new Date(), to = new Date(now.getTime() + hours * 3600000);
  return events.flatMap((e) => occurrences(e, now, to).map((t) => ({ title: e.summary || "Event", at: t }))).sort((a, b) => a.at - b.at);
}

module.exports = {
  init(a) { api = a; },
  parseIcs, occurrences,
  tick(now) {
    const cal = api.store.get().calendar;
    if (!cal.on || !cal.source) return;
    if (now - lastLoad > 15 * 60000 || loadedFrom !== cal.source) { lastLoad = now; loadedFrom = cal.source; load(); return; }
    if (now - lastCheck < 5000) return;      // check every 5 seconds
    lastCheck = now;
    for (const ev of upcoming(1)) {
      const mins = (ev.at - now) / 60000, key = ev.title + "|" + ev.at.getTime();
      if (mins <= cal.minutesBefore && mins > -1 && !announced[key]) {
        announced[key] = true;
        const m = Math.max(0, Math.round(mins));
        const text = m ? `📅 ${ev.title} in ${m} min` : `📅 ${ev.title} is starting now`;
        lastAnnounced = text;
        if (api.visible()) { api.say(text, { ms: 12000 }); api.play("Surprised"); }
        if (api.store.get().windowsNotifications && Notification.isSupported()) new Notification({ title: "EchoBot calendar", body: text }).show();
      }
    }
  },
  onSettings(p) { if (p.calendar) { lastLoad = 0; } },
  status: () => ({ events: events.length, error: lastError, announced: Object.keys(announced).length, lastAnnounced, next: upcoming(24).slice(0, 3).map((e) => ({ title: e.title, at: e.at.toISOString() })) }),
  actions: {
    reloadCalendar: async () => { await load(); return module.exports.status(); },
    pickIcs: async () => {
      const { dialog } = require("electron");
      const r = await dialog.showOpenDialog({ title: "Pick a calendar file", filters: [{ name: "Calendar", extensions: ["ics"] }], properties: ["openFile"] });
      return r.canceled ? null : r.filePaths[0];
    },
  },
};
