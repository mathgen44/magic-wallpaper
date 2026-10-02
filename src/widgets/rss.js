import { el, fmtRelative } from "../util.js";

export default {
  type: "rss",
  name: "Flux RSS",
  description: "Les derniers articles d'un ou plusieurs flux RSS / Atom.",
  icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M5 11a8 8 0 0 1 8 8M5 5a14 14 0 0 1 14 14"/><circle cx="6" cy="18" r="1.5" fill="currentColor"/></svg>`,
  size: { w: 13, h: 11 },
  minSize: { w: 4, h: 2 },
  options: [
    { key: "title", label: "Titre", type: "text", default: "Actualités" },
    { key: "feeds", label: "Flux (une adresse par ligne)", type: "list", default: ["https://www.lemonde.fr/rss/une.xml", "https://www.numerama.com/feed/"] },
    { key: "mode", label: "Affichage", type: "select", default: "list", choices: [["list", "Liste"], ["cards", "Article à la une (rotation)"], ["ticker", "Bandeau défilant"]] },
    { key: "max", label: "Nombre d'articles", type: "number", default: 8, min: 1, max: 50 },
    { key: "refresh", label: "Actualisation (min)", type: "number", default: 15, min: 1, max: 1440 },
    { key: "rotate", label: "Rotation (s)", type: "number", default: 12, min: 3, max: 600, showIf: (o) => o.mode === "cards" },
    { key: "speed", label: "Vitesse du bandeau", type: "range", default: 1, min: 0.3, max: 3, step: 0.1, showIf: (o) => o.mode === "ticker" },
    { key: "images", label: "Afficher les vignettes", type: "toggle", default: true, showIf: (o) => o.mode !== "ticker" },
    { key: "summary", label: "Afficher le résumé", type: "toggle", default: false, showIf: (o) => o.mode !== "ticker" },
    { key: "source", label: "Afficher la source", type: "toggle", default: true },
    { key: "date", label: "Afficher la date", type: "toggle", default: true },
  ],
  mount(body, o, ctx) {
    const root = el("div", { class: `rss rss-${o.mode}` });
    const content = el("div", { class: "rss-content" });
    if (o.title && o.mode !== "ticker") root.append(el("div", { class: "widget-title" }, o.title));
    root.append(content);
    body.append(root);
    let items = [];
    let refreshTimer, rotateTimer;
    let cardIdx = 0;

    const meta = (it) => {
      const parts = [o.source && it.source, o.date && fmtRelative(it.date)].filter(Boolean);
      return parts.length ? el("div", { class: "rss-meta" }, parts.join(" · ")) : null;
    };
    const thumb = (it) => (o.images && it.image ? el("div", { class: "rss-thumb", style: { backgroundImage: `url("${it.image}")` } }) : null);

    const renderList = () => {
      content.replaceChildren(
        ...items.map((it) =>
          el("div", { class: "rss-item" }, thumb(it), el("div", { class: "rss-text" }, el("div", { class: "rss-title" }, it.title), o.summary && it.summary && el("div", { class: "rss-summary" }, it.summary), meta(it))),
        ),
      );
    };
    const renderCard = () => {
      if (!items.length) return;
      const it = items[cardIdx % items.length];
      const card = el("div", { class: "rss-card" }, thumb(it), el("div", { class: "rss-card-text" }, el("div", { class: "rss-title" }, it.title), o.summary && it.summary && el("div", { class: "rss-summary" }, it.summary), meta(it)));
      content.replaceChildren(card);
      cardIdx++;
    };
    const renderTicker = () => {
      const track = el("div", { class: "rss-track" });
      const seq = () => items.map((it) => el("span", { class: "rss-tick" }, o.source ? el("b", {}, it.source + " ") : "", it.title, o.date ? el("i", {}, " " + fmtRelative(it.date)) : ""));
      track.append(...seq(), ...seq()); // doublé pour une boucle continue
      const chars = items.reduce((n, it) => n + it.title.length + 12, 0);
      track.style.animationDuration = `${Math.max(10, chars / 6 / o.speed)}s`;
      content.replaceChildren(track);
    };
    const render = () => {
      if (!items.length) return;
      if (o.mode === "cards") renderCard();
      else if (o.mode === "ticker") renderTicker();
      else renderList();
    };

    const refresh = async () => {
      const feeds = (o.feeds || []).filter(Boolean);
      if (!feeds.length) {
        content.replaceChildren(el("div", { class: "widget-empty" }, "Ajoutez l'adresse d'un flux RSS"));
        return;
      }
      try {
        const r = await ctx.api.fetchFeeds(feeds, o.max);
        if (ctx.signal.aborted) return;
        items = r.items;
        if (!items.length) content.replaceChildren(el("div", { class: "widget-empty" }, r.errors.length ? "Flux injoignable(s) : " + r.errors[0] : "Aucun article"));
        else render();
      } catch (e) {
        if (!items.length) content.replaceChildren(el("div", { class: "widget-empty" }, "Erreur : " + e));
      }
    };

    content.append(el("div", { class: "widget-empty" }, "Chargement…"));
    refresh();
    refreshTimer = setInterval(refresh, Math.max(1, o.refresh) * 60 * 1000);
    if (o.mode === "cards") rotateTimer = setInterval(renderCard, Math.max(3, o.rotate) * 1000);
    return {
      destroy() {
        clearInterval(refreshTimer);
        clearInterval(rotateTimer);
      },
    };
  },
};
