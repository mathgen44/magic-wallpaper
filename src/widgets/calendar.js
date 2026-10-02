import { el } from "../util.js";

const COLORS = ["var(--accent)", "var(--accent2)", "#f5b84a", "#3ecf8e", "#ff6b9a", "#4ac7f5", "#b98cff"];
const hm = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" });
const dayLong = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long" });
const monthFmt = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" });
const startOfDay = (t) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.valueOf();
};
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export default {
  type: "calendar",
  name: "Agenda",
  description: "Prochains événements de vos agendas (Google, Outlook… au format iCal).",
  icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/><path d="M8 14h3"/></svg>`,
  size: { w: 11, h: 13 },
  minSize: { w: 4, h: 3 },
  options: [
    { key: "title", label: "Titre", type: "text", default: "Agenda" },
    {
      key: "calendars", label: "Agendas iCal (une adresse par ligne)", type: "list", default: [],
      hint: "Google Agenda : Paramètres → votre agenda → « Adresse secrète au format iCal ». Outlook : Paramètres → Calendrier → Calendriers partagés → Publier (lien ICS).",
    },
    { key: "days", label: "Période affichée (jours)", type: "number", default: 7, min: 1, max: 31 },
    { key: "max", label: "Nombre maximum d'événements", type: "number", default: 12, min: 1, max: 50 },
    { key: "location", label: "Afficher le lieu", type: "toggle", default: true },
    { key: "month", label: "Afficher le calendrier du mois", type: "toggle", default: false },
    { key: "refresh", label: "Actualisation (min)", type: "number", default: 15, min: 5, max: 240 },
  ],
  mount(body, o, ctx) {
    const root = el("div", { class: "agenda" });
    body.append(root);
    let data = null;
    let timer;
    let tick;

    const monthGrid = (events) => {
      const now = new Date();
      const first = new Date(now.getFullYear(), now.getMonth(), 1);
      const offset = (first.getDay() + 6) % 7; // lundi = 0
      const daysIn = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      const busy = new Map();
      for (const e of events) {
        for (let t = startOfDay(e.start); t < Math.max(e.end, e.start + 1); t += 864e5) {
          const d = new Date(t);
          if (d.getMonth() === now.getMonth()) busy.set(d.getDate(), e.calendar);
          if (busy.size > 40) break;
        }
      }
      const cells = ["L", "M", "M", "J", "V", "S", "D"].map((d) => el("div", { class: "cal-h" }, d));
      for (let i = 0; i < offset; i++) cells.push(el("div", { class: "cal-d empty" }));
      for (let d = 1; d <= daysIn; d++) {
        const cls = ["cal-d"];
        if (d === now.getDate()) cls.push("today");
        if (d < now.getDate()) cls.push("past");
        cells.push(el("div", { class: cls.join(" ") }, String(d), busy.has(d) ? el("span", { class: "cal-dot", style: { background: COLORS[busy.get(d) % COLORS.length] } }) : null));
      }
      return el("div", { class: "cal-month" }, el("div", { class: "cal-mtitle" }, cap(monthFmt.format(now))), el("div", { class: "cal-grid" }, ...cells));
    };

    const render = () => {
      if (!data) return;
      const now = Date.now();
      const today = startOfDay(now);
      const limit = today + o.days * 864e5;
      const list = data.events.filter((e) => e.end > now && e.start < limit).slice(0, o.max);
      const groups = new Map();
      for (const e of list) {
        const day = Math.max(startOfDay(e.start), today);
        if (!groups.has(day)) groups.set(day, []);
        groups.get(day).push(e);
      }
      const dayName = (t) => (t === today ? "Aujourd'hui" : t === today + 864e5 ? "Demain" : cap(dayLong.format(t)));
      const items = [];
      for (const [day, evs] of groups) {
        items.push(el("div", { class: "ag-day" }, dayName(day)));
        for (const e of evs) {
          const running = e.start <= now && e.end > now && !e.all_day;
          const multi = e.all_day && e.end - e.start > 864e5;
          const time = e.all_day ? (multi ? `jusqu'au ${new Date(e.end - 1).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}` : "Journée") : `${hm.format(e.start)} – ${hm.format(e.end)}`;
          items.push(
            el(
              "div",
              { class: `ag-ev${running ? " now" : ""}` },
              el("span", { class: "ag-bar", style: { background: COLORS[e.calendar % COLORS.length] } }),
              el("div", { class: "ag-body" }, el("div", { class: "ag-title" }, e.title || "(sans titre)"), el("div", { class: "ag-meta" }, running ? "En cours · " : "", time, o.location && e.location ? ` · ${e.location}` : "")),
            ),
          );
        }
      }
      const errors = data.errors.filter(Boolean);
      root.replaceChildren(...[
        o.title ? el("div", { class: "widget-title" }, o.title) : null,
        o.month ? monthGrid(data.events) : null,
        el("div", { class: "ag-list" }, ...(items.length ? items : [el("div", { class: "ag-empty" }, `Rien de prévu sur ${o.days} jour${o.days > 1 ? "s" : ""}`)])),
        errors.length ? el("div", { class: "ag-error" }, `⚠ ${errors[0]}`) : null,
      ].filter(Boolean));
    };

    const refresh = async () => {
      const urls = (o.calendars || []).filter(Boolean);
      if (!urls.length) {
        root.replaceChildren(el("div", { class: "widget-empty" }, "Ajoutez l'adresse iCal d'un agenda dans les réglages de la brique"));
        return;
      }
      try {
        data = await ctx.api.calendarEvents(urls, Math.max(o.days, o.month ? 42 : 0));
        if (!ctx.signal.aborted) render();
      } catch (e) {
        if (!data) root.replaceChildren(el("div", { class: "widget-empty" }, "Agenda indisponible : " + (e.message || e)));
      }
    };
    root.append(el("div", { class: "widget-empty" }, "Chargement de l'agenda…"));
    refresh();
    timer = setInterval(refresh, Math.max(5, o.refresh) * 60 * 1000);
    tick = setInterval(render, 60 * 1000); // « en cours », événements passés
    return {
      destroy() {
        clearInterval(timer);
        clearInterval(tick);
      },
    };
  },
};
