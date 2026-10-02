import { sunTimes } from "../astro.js";
import { el } from "../util.js";
import { LOCATION_DEFAULT, resolveLocation } from "./location.js";

const hm = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" });
const valid = (d) => d instanceof Date && !Number.isNaN(d.valueOf());
const fmtTime = (d) => (valid(d) ? hm.format(d) : "—");
function fmtDuration(ms) {
  const m = Math.round(ms / 60000);
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}`;
}
function fmtIn(ms) {
  const m = Math.max(0, Math.round(ms / 60000));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}`;
}

const EXTRAS = [
  ["length", "Durée du jour"],
  ["dawn", "Aube et crépuscule civils"],
  ["golden", "Heure dorée du soir"],
  ["noon", "Midi solaire"],
];

const ICON_RISE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 18h16M7 14a5 5 0 0 1 10 0M12 4v4M9.5 6.5 12 4l2.5 2.5"/></svg>`;
const ICON_SET = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M4 18h16M7 14a5 5 0 0 1 10 0M12 4v4M9.5 5.5 12 8l2.5-2.5"/></svg>`;

export default {
  type: "sun",
  name: "Soleil",
  description: "Lever et coucher du soleil, durée du jour et course du soleil.",
  icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M3 17h18M7 17a5 5 0 0 1 10 0M12 6v2M5.6 10.6l1.4 1.4M18.4 10.6 17 12"/></svg>`,
  size: { w: 10, h: 8 },
  minSize: { w: 4, h: 3 },
  options: [
    { key: "location", label: "Lieu", type: "location", default: LOCATION_DEFAULT },
    { key: "label", label: "Titre", type: "text", default: "Soleil", hint: "Vide = nom du lieu" },
    { key: "arc", label: "Afficher la course du soleil", type: "toggle", default: true },
    { key: "extras", label: "Informations", type: "checklist", default: ["length"], choices: EXTRAS },
  ],
  mount(body, o, ctx) {
    const root = el("div", { class: "sun" });
    body.append(root);
    const has = (k) => (o.extras || []).includes(k);
    let place = null;
    let timer;

    const arc = (frac, day) => {
      // Demi-ellipse : horizon en y = 46, sommet en y = 8.
      const pt = (f) => [50 - 44 * Math.cos(Math.PI * f), 46 - 38 * Math.sin(Math.PI * f)];
      const [x, y] = pt(Math.min(1, Math.max(0, frac)));
      const NS = "http://www.w3.org/2000/svg";
      const s = document.createElementNS(NS, "svg");
      s.setAttribute("viewBox", "0 0 100 50");
      s.setAttribute("class", "sun-arc");
      const path = `M6 46A44 38 0 0 1 94 46`;
      s.innerHTML =
        `<path class="sun-track" d="${path}"/>` +
        (day ? `<path class="sun-done" d="M6 46A44 38 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)}"/>` : "") +
        `<path class="sun-horizon" d="M0 46H100"/>` +
        (day ? `<circle class="sun-glow" cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="6"/><circle class="sun-dot" cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="3.2"/>` : "");
      return s;
    };

    const render = () => {
      if (!place) return;
      const now = new Date();
      const t = sunTimes(now, place.lat, place.lon);
      const y = sunTimes(new Date(now.valueOf() - 864e5), place.lat, place.lon);
      const tomorrow = sunTimes(new Date(now.valueOf() + 864e5), place.lat, place.lon);
      const day = valid(t.sunrise) && valid(t.sunset) && now >= t.sunrise && now <= t.sunset;
      const frac = valid(t.sunrise) ? (now - t.sunrise) / (t.sunset - t.sunrise) : 0;
      let status;
      if (!valid(t.sunrise)) status = "Pas de lever ni de coucher aujourd'hui";
      else if (day) status = `Coucher dans ${fmtIn(t.sunset - now)}`;
      else if (now < t.sunrise) status = `Lever dans ${fmtIn(t.sunrise - now)}`;
      else status = `Lever demain à ${fmtTime(tomorrow.sunrise)}`;

      const rows = [];
      if (has("length") && valid(t.sunrise)) {
        const len = t.sunset - t.sunrise;
        const delta = valid(y.sunrise) ? Math.round((len - (y.sunset - y.sunrise)) / 60000) : 0;
        rows.push(["Durée du jour", `${fmtDuration(len)}${delta ? ` (${delta > 0 ? "+" : "−"}${Math.abs(delta)} min)` : ""}`]);
      }
      if (has("dawn")) rows.push(["Aube / crépuscule", `${fmtTime(t.dawn)} · ${fmtTime(t.dusk)}`]);
      if (has("golden")) rows.push(["Heure dorée", `dès ${fmtTime(t.goldenHour)}`]);
      if (has("noon")) rows.push(["Midi solaire", fmtTime(t.solarNoon)]);

      root.replaceChildren(...[
        el("div", { class: "widget-title" }, o.label || place.name || "Soleil"),
        o.arc ? arc(frac, day) : null,
        el(
          "div",
          { class: "sun-times" },
          el("div", { class: "sun-t" }, el("span", { class: "sun-ico", html: ICON_RISE }), el("span", { class: "sun-v" }, fmtTime(t.sunrise))),
          el("div", { class: "sun-t" }, el("span", { class: "sun-ico", html: ICON_SET }), el("span", { class: "sun-v" }, fmtTime(t.sunset))),
        ),
        el("div", { class: "sun-status" }, status),
        rows.length ? el("div", { class: "sun-rows" }, ...rows.map(([k, v]) => el("div", { class: "kv" }, el("span", { class: "kv-k" }, k), el("span", { class: "kv-v" }, v)))) : null,
      ].filter(Boolean));
    };

    resolveLocation(o.location, ctx.api)
      .then((p) => {
        if (ctx.signal.aborted) return;
        place = p;
        render();
        timer = setInterval(render, 60 * 1000);
      })
      .catch((e) => root.replaceChildren(el("div", { class: "widget-empty" }, "Position inconnue : " + (e.message || e))));
    root.append(el("div", { class: "widget-empty" }, "Localisation…"));
    return { destroy: () => clearInterval(timer) };
  },
};
