import { el } from "../util.js";
import { allApps, appsIn, catIcon, launcherConfig } from "./launcher-data.js";

export default {
  type: "launcher",
  name: "Lanceur d'applications",
  description: "Vos applications et jeux rangés par catégories, dans des tiroirs à ouvrir d'un clic.",
  icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="3.5" y="3.5" width="7" height="7" rx="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2"/><path d="M17 14v6M14 17h6"/></svg>`,
  size: { w: 16, h: 10 },
  minSize: { w: 4, h: 3 },
  options: [
    { key: "title", label: "Titre", type: "text", default: "" },
    { key: "mode", label: "Fonctionnement", type: "select", default: "drawers", choices: [["drawers", "Tiroirs (s'ouvrent d'un clic)"], ["tabs", "Onglets (une catégorie toujours ouverte)"]] },
    { key: "position", label: "Catégories", type: "select", default: "top", choices: [["top", "En haut"], ["left", "À gauche"]] },
    { key: "tiles", label: "Tuiles (tiroirs fermés)", type: "select", default: "compact", choices: [["compact", "Compactes (la brique se réduit)"], ["fill", "Remplir toute la brique"]], showIf: (o) => o.mode === "drawers" },
    { key: "tileHeight", label: "Hauteur des tuiles", type: "range", default: 1, min: 0.5, max: 2.5, step: 0.05, showIf: (o) => o.mode === "drawers" && o.tiles !== "fill" },
    { key: "launch", label: "Lancer une application", type: "select", default: "dblclick", choices: [["dblclick", "Double-clic"], ["click", "Clic"]] },
    { key: "iconSize", label: "Taille des icônes", type: "range", default: 1, min: 0.6, max: 2, step: 0.05 },
    { key: "names", label: "Afficher les noms", type: "toggle", default: true },
    { key: "covers", label: "Jaquettes pour les jeux Steam", type: "toggle", default: true },
    { key: "hideEmpty", label: "Masquer les catégories vides", type: "toggle", default: true },
    { key: "autoClose", label: "Refermer le tiroir après (s)", type: "number", default: 20, min: 0, max: 600, hint: "0 = jamais", showIf: (o) => o.mode === "drawers" },
    { key: "preview", label: "Aperçu dans l'éditeur", type: "select", default: "open", choices: [["open", "Premier tiroir ouvert"], ["closed", "Tiroirs fermés"]], showIf: (o) => o.mode === "drawers" },
    { key: "apps", label: "Catégories et applications", type: "launcher", default: {} },
  ],
  mount(body, o, ctx) {
    const cfg = launcherConfig(o.apps);
    const root = el("div", { class: `launcher lc-pos-${o.position} lc-mode-${o.mode}${o.tiles === "fill" ? "" : " lc-compact"}`, style: { "--lc-scale": o.iconSize, "--lc-tile-h": o.tileHeight ?? 1 } });
    const card = body.closest(".card");
    body.append(root);
    let detected = null;
    let open = null; // catégorie ouverte
    let page = 0;
    let closeTimer;
    let refreshTimer;
    let pageItems = [];
    const tiles = el("div", { class: "lc-tiles" });
    const drawer = el("div", { class: "lc-drawer" });
    const grid = el("div", { class: "lc-grid" });
    const head = el("div", { class: "lc-head" });
    drawer.append(head, grid);
    root.append(...[o.title ? el("div", { class: "widget-title" }, o.title) : null, el("div", { class: "lc-body" }, tiles, drawer)].filter(Boolean));

    // Tuiles compactes : quand tout est fermé, la carte se réduit à la hauteur des tuiles
    // et reprend toute la hauteur de la brique à l'ouverture d'un tiroir.
    const fit = () => {
      if (!card) return;
      if (open || o.tiles === "fill" || !detected) {
        card.style.height = "";
        return;
      }
      const pad = parseFloat(getComputedStyle(body).paddingBottom) || 0;
      const border = parseFloat(getComputedStyle(card).borderBottomWidth) || 0;
      const h = Math.ceil(tiles.getBoundingClientRect().bottom - card.getBoundingClientRect().top + pad + border);
      if (h > 0 && card.style.height !== `${h}px`) card.style.height = `${h}px`;
    };

    const apps = () => allApps(detected, cfg);
    const visibleCats = () =>
      cfg.cats
        .filter((c) => c.visible !== false)
        .map((c) => ({ ...c, list: appsIn(c.key, apps(), cfg) }))
        .filter((c) => !o.hideEmpty || c.list.length);

    const armClose = () => {
      clearTimeout(closeTimer);
      if (o.mode === "drawers" && o.autoClose > 0 && !ctx.editing) closeTimer = setTimeout(() => setOpen(null), o.autoClose * 1000);
    };

    const setOpen = (key) => {
      open = key;
      page = 0;
      render();
      armClose();
    };

    const appIcon = (a, useCover) => {
      if (useCover && a.cover) return el("div", { class: "lc-cover", style: { backgroundImage: `url("${ctx.api.fileSrc(a.cover)}")` } });
      const src = a.icon || (a.icon_path ? ctx.api.fileSrc(a.icon_path) : "");
      const ico = src ? el("img", { class: "lc-ico", src, alt: "", draggable: "false" }) : el("div", { class: "lc-ico lc-ico-empty" }, (a.name || "?").charAt(0));
      // Sans jaquette dans une grille de jaquettes : carte de même format avec l'icône au centre.
      return useCover ? el("div", { class: "lc-cover lc-cover-icon" }, ico) : ico;
    };

    const renderGrid = (cat) => {
      const useCover = o.covers && cat.list.some((a) => a.cover) && cat.list.filter((a) => a.cover).length >= cat.list.length / 2;
      grid.classList.toggle("covers", useCover);
      grid.classList.toggle("no-names", !o.names);
      // Capacité d'une page d'après la taille disponible (pas de défilement possible sur le bureau).
      const fs = parseFloat(getComputedStyle(grid).fontSize) || 16;
      const cellW = (useCover ? 5.4 : 5) * o.iconSize * fs;
      const cellH = useCover ? cellW * 1.5 + (o.names ? 1.6 * fs : 0) : (o.names ? 5.6 : 4) * o.iconSize * fs;
      const gap = 0.5 * fs;
      const W = grid.clientWidth || 1;
      const H = grid.clientHeight || 1;
      const cols = Math.max(1, Math.floor((W + gap) / (cellW + gap)));
      const rows = Math.max(1, Math.floor((H + gap) / (cellH + gap)));
      const per = cols * rows;
      const pages = Math.max(1, Math.ceil(cat.list.length / per));
      page = Math.min(page, pages - 1);
      grid.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
      grid.style.gridAutoRows = `${cellH}px`;
      pageItems = cat.list.slice(page * per, (page + 1) * per);
      grid.replaceChildren(
        ...pageItems.map((a, i) =>
          el(
            "div",
            { class: "lc-app", title: a.name, "data-action": `launcher:launch:${i}`, "data-open": o.launch },
            appIcon(a, useCover),
            o.names ? el("div", { class: "lc-name" }, a.name) : null,
          ),
        ),
        ...(cat.list.length ? [] : [el("div", { class: "lc-empty" }, "Aucune application dans cette catégorie")]),
      );
      const nav = [];
      if (pages > 1) {
        nav.push(
          el("span", { class: "lc-nav", "data-action": "launcher:page:-1", "data-open": "click" }, "‹"),
          el("span", { class: "lc-page" }, `${page + 1} / ${pages}`),
          el("span", { class: "lc-nav", "data-action": "launcher:page:1", "data-open": "click" }, "›"),
        );
      }
      head.replaceChildren(
        ...[
          el("span", { class: "lc-head-ico", html: catIcon(cat.key), style: { color: cat.color } }),
          el("span", { class: "lc-head-name" }, cat.label),
          el("span", { class: "lc-head-count" }, String(cat.list.length)),
          el("span", { class: "lc-spacer" }),
          ...nav,
          o.mode === "drawers" ? el("span", { class: "lc-close", "data-action": "launcher:close", "data-open": "click", title: "Fermer" }, "×") : null,
        ].filter(Boolean),
      );
    };

    const render = () => {
      if (!detected) return;
      const cats = visibleCats();
      if (o.mode === "tabs" && (!open || !cats.some((c) => c.key === open))) open = cats[0]?.key || null;
      if (open && !cats.some((c) => c.key === open)) open = null;
      root.classList.toggle("open", !!open);
      tiles.replaceChildren(
        ...cats.map((c) =>
          el(
            "div",
            { class: `lc-tile${c.key === open ? " active" : ""}`, style: { "--c": c.color }, title: c.label, "data-action": `launcher:drawer:${c.key}`, "data-open": "click" },
            el("span", { class: "lc-tile-ico", html: catIcon(c.key) }),
            el("span", { class: "lc-tile-name" }, c.label),
            el("span", { class: "lc-tile-count" }, String(c.list.length)),
          ),
        ),
      );
      if (!cats.length) tiles.replaceChildren(el("div", { class: "lc-empty" }, "Aucune catégorie à afficher"));
      const cat = cats.find((c) => c.key === open);
      drawer.hidden = !cat;
      fit();
      if (cat) {
        drawer.style.setProperty("--c", cat.color);
        // La taille de la grille n'est connue qu'une fois le tiroir affiché.
        requestAnimationFrame(() => renderGrid(cat));
      }
    };

    root.addEventListener("wp-action", (e) => {
      const [, act, arg] = e.detail.action.split(":");
      armClose();
      if (act === "drawer") setOpen(open === arg && o.mode === "drawers" ? null : arg);
      else if (act === "close") setOpen(null);
      else if (act === "page") {
        page = Math.max(0, page + Number(arg));
        render();
      } else if (act === "launch") {
        const a = pageItems[Number(arg)];
        if (a) ctx.api.launchApp(a.source === "custom" ? { target: a.target } : { id: a.id }).catch((err) => console.error(err));
      }
    });

    const ro = new ResizeObserver(() => (open ? render() : fit()));
    ro.observe(root);

    const load = async (refresh = false) => {
      try {
        detected = await ctx.api.listApps(refresh);
      } catch (e) {
        detected = [];
        console.error(e);
      }
      if (ctx.signal.aborted) return;
      if (ctx.editing && o.mode === "drawers" && o.preview === "open" && !open) open = visibleCats()[0]?.key || null;
      render();
    };
    tiles.append(el("div", { class: "lc-empty" }, "Recherche des applications…"));
    drawer.hidden = true;
    load();
    refreshTimer = setInterval(() => load(), 15 * 60 * 1000);
    return {
      destroy() {
        clearTimeout(closeTimer);
        clearInterval(refreshTimer);
        ro.disconnect();
        if (card) card.style.height = "";
      },
    };
  },
};
