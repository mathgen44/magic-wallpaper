import { el } from "../util.js";

export default {
  type: "clock",
  name: "Horloge",
  description: "Heure et date, avec fuseau horaire au choix.",
  icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>`,
  size: { w: 14, h: 6 },
  minSize: { w: 4, h: 2 },
  options: [
    { key: "h24", label: "Format 24 h", type: "toggle", default: true },
    { key: "seconds", label: "Afficher les secondes", type: "toggle", default: false },
    { key: "showDate", label: "Afficher la date", type: "toggle", default: true },
    {
      key: "dateStyle", label: "Format de la date", type: "select", default: "full",
      choices: [["full", "jeudi 2 octobre 2026"], ["long", "2 octobre 2026"], ["medium", "2 oct. 2026"], ["short", "02/10/2026"]],
      showIf: (o) => o.showDate,
    },
    { key: "label", label: "Libellé (ex. ville)", type: "text", default: "" },
    { key: "timeZone", label: "Fuseau horaire", type: "text", default: "", hint: "Vide = heure locale. Ex. : America/New_York, Asia/Tokyo" },
    { key: "align", label: "Alignement", type: "select", default: "left", choices: [["left", "Gauche"], ["center", "Centré"], ["right", "Droite"]] },
  ],
  mount(body, o, ctx) {
    const tz = o.timeZone?.trim() || undefined;
    let timeFmt, dateFmt;
    try {
      timeFmt = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", second: o.seconds ? "2-digit" : undefined, hour12: !o.h24, timeZone: tz });
      dateFmt = new Intl.DateTimeFormat("fr-FR", { dateStyle: o.dateStyle, timeZone: tz });
    } catch {
      timeFmt = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" });
      dateFmt = new Intl.DateTimeFormat("fr-FR", { dateStyle: "full" });
    }
    const time = el("div", { class: "clock-time" });
    const date = el("div", { class: "clock-date" });
    const label = o.label ? el("div", { class: "clock-label" }, o.label) : null;
    body.append(el("div", { class: `clock align-${o.align}` }, label, time, o.showDate && date));
    let timer;
    const tick = () => {
      const now = new Date();
      time.textContent = timeFmt.format(now);
      const d = dateFmt.format(now);
      date.textContent = d.charAt(0).toUpperCase() + d.slice(1);
      timer = setTimeout(tick, 1000 - (Date.now() % 1000) + 5);
    };
    tick();
    return { destroy: () => clearTimeout(timer) };
  },
};
