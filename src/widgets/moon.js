import { moonAge, moonIllumination, moonLitPath, moonTimes, nextPhase, phaseName } from "../astro.js";
import { el } from "../util.js";
import { LOCATION_DEFAULT, resolveLocation } from "./location.js";

const hm = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" });
const dayFmt = new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", month: "short" });
const nf0 = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });

function inDays(d) {
  const a = new Date();
  a.setHours(0, 0, 0, 0);
  const b = new Date(d);
  b.setHours(0, 0, 0, 0);
  const n = Math.round((b - a) / 864e5);
  return n === 0 ? "aujourd'hui" : n === 1 ? "demain" : `dans ${n} j`;
}

const PHASES = [
  [0, "Nouvelle lune"],
  [0.25, "Premier quartier"],
  [0.5, "Pleine lune"],
  [0.75, "Dernier quartier"],
];

export default {
  type: "moon",
  name: "Lune",
  description: "Phase de la lune, illumination, prochaines pleine et nouvelle lunes.",
  icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z"/></svg>`,
  size: { w: 9, h: 9 },
  minSize: { w: 3, h: 3 },
  options: [
    { key: "label", label: "Titre", type: "text", default: "Lune" },
    { key: "next", label: "Prochaines phases", type: "select", default: "fullnew", choices: [["none", "Masquer"], ["fullnew", "Pleine et nouvelle lune"], ["all", "Les quatre phases"]] },
    { key: "times", label: "Lever et coucher de la lune", type: "toggle", default: false },
    { key: "location", label: "Lieu (lever, coucher, hémisphère)", type: "location", default: LOCATION_DEFAULT, showIf: (o) => o.times },
    { key: "details", label: "Illumination et âge", type: "toggle", default: true },
  ],
  mount(body, o, ctx) {
    const root = el("div", { class: "moon" });
    body.append(root);
    let place = null;
    let timer;

    const disk = (phase, southern) => {
      const NS = "http://www.w3.org/2000/svg";
      const s = document.createElementNS(NS, "svg");
      s.setAttribute("viewBox", "-1.15 -1.15 2.3 2.3");
      s.setAttribute("class", "moon-disk");
      s.innerHTML = `<circle class="moon-dark" r="1"/><path class="moon-lit" d="${moonLitPath(phase, 1, southern)}"/><circle class="moon-rim" r="1"/>`;
      return s;
    };

    const render = () => {
      const now = new Date();
      const m = moonIllumination(now);
      const southern = !!place && place.lat < 0;
      const info = [el("div", { class: "moon-name" }, phaseName(m.phase))];
      if (o.details) info.push(el("div", { class: "moon-sub" }, `${nf0.format(m.fraction * 100)} % éclairée · ${nf0.format(moonAge(m.phase))} j`));
      if (o.times && place) {
        const t = moonTimes(now, place.lat, place.lon);
        const f = (d) => (d ? hm.format(d) : "—");
        info.push(el("div", { class: "moon-sub" }, t.alwaysUp ? "Visible toute la journée" : t.alwaysDown ? "Ne se lève pas aujourd'hui" : `Lever ${f(t.rise)} · coucher ${f(t.set)}`));
      }
      let next = null;
      if (o.next !== "none") {
        const list = PHASES.filter(([p]) => o.next === "all" || p === 0 || p === 0.5)
          .map(([p, name]) => [nextPhase(now, p), name])
          .filter(([d]) => d)
          .sort((a, b) => a[0] - b[0]);
        next = el(
          "div",
          { class: "moon-next" },
          ...list.map(([d, name]) =>
            el(
              "div",
              { class: "moon-np" },
              el("span", { class: "moon-np-ico", html: `<svg viewBox="-1.1 -1.1 2.2 2.2"><circle class="moon-dark" r="1"/><path class="moon-lit" d="${moonLitPath(PHASES.find((x) => x[1] === name)[0], 1, southern)}"/></svg>` }),
              el("span", { class: "moon-np-name" }, name),
              el("span", { class: "moon-np-date" }, `${dayFmt.format(d)} · ${inDays(d)}`),
            ),
          ),
        );
      }
      root.replaceChildren(...[
        o.label ? el("div", { class: "widget-title" }, o.label) : null,
        el("div", { class: "moon-main" }, disk(m.phase, southern), el("div", { class: "moon-info" }, ...info)),
        next,
      ].filter(Boolean));
    };

    render();
    timer = setInterval(render, 10 * 60 * 1000);
    if (o.times) {
      resolveLocation(o.location, ctx.api)
        .then((p) => {
          if (ctx.signal.aborted) return;
          place = p;
          render();
        })
        .catch(() => {});
    }
    return { destroy: () => clearInterval(timer) };
  },
};
