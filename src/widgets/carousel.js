import { el, shuffle } from "../util.js";

const safeDecode = (s) => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

export default {
  type: "carousel",
  name: "Carrousel d'images",
  description: "Fait défiler les images d'un dossier ou d'une liste d'adresses.",
  icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 16 5-5 4 4 3-3 6 6"/><circle cx="16" cy="9" r="1.5"/></svg>`,
  size: { w: 16, h: 9 },
  minSize: { w: 3, h: 2 },
  options: [
    { key: "source", label: "Source", type: "select", default: "folder", choices: [["folder", "Dossier local"], ["urls", "Adresses web"]] },
    { key: "folder", label: "Dossier", type: "folder", default: "", showIf: (o) => o.source === "folder" },
    { key: "recursive", label: "Inclure les sous-dossiers", type: "toggle", default: true, showIf: (o) => o.source === "folder" },
    { key: "urls", label: "Adresses d'images (une par ligne)", type: "list", default: [], showIf: (o) => o.source === "urls" },
    { key: "interval", label: "Durée par image (s)", type: "number", default: 20, min: 3, max: 3600 },
    { key: "transition", label: "Transition", type: "select", default: "fade", choices: [["fade", "Fondu"], ["slide", "Glissement"], ["zoom", "Fondu + zoom lent (Ken Burns)"], ["none", "Aucune"]] },
    { key: "fit", label: "Cadrage", type: "select", default: "cover", choices: [["cover", "Remplir (rogner)"], ["contain", "Image entière"]] },
    { key: "shuffle", label: "Ordre aléatoire", type: "toggle", default: true },
    { key: "caption", label: "Afficher le nom du fichier", type: "toggle", default: false },
  ],
  mount(body, o, ctx) {
    const root = el("div", { class: `carousel t-${o.transition}`, style: { "--dur": `${o.interval}s` } });
    const layers = [el("div", { class: "slide" }), el("div", { class: "slide" })];
    const caption = el("div", { class: "carousel-caption" });
    const empty = el("div", { class: "widget-empty" });
    root.append(...layers, o.caption ? caption : "", empty);
    body.append(root);

    let list = [];
    let idx = -1;
    let front = 0;
    let timer;
    let refreshTimer;

    const load = async () => {
      try {
        if (o.source === "urls") list = (o.urls || []).filter(Boolean);
        else list = o.folder ? await ctx.api.listImages(o.folder, o.recursive) : [];
      } catch (e) {
        list = [];
        empty.textContent = "Dossier illisible : " + e;
      }
      if (o.shuffle) list = shuffle(list);
      if (!list.length && !empty.textContent) {
        empty.textContent = o.source === "folder" ? (o.folder ? "Aucune image dans ce dossier" : "Choisissez un dossier d'images") : "Ajoutez des adresses d'images";
      }
      empty.hidden = list.length > 0;
    };

    const show = (url) =>
      new Promise((resolve) => {
        const img = new Image();
        img.onload = img.onerror = () => resolve(img.naturalWidth > 0);
        img.src = url;
      }).then((ok) => {
        if (!ok || ctx.signal.aborted) return;
        const next = layers[1 - front];
        const cur = layers[front];
        next.style.backgroundImage = `url("${url}")`;
        next.style.backgroundSize = o.fit;
        next.classList.remove("active", "leaving");
        void next.offsetWidth; // relance les animations CSS
        next.classList.add("active");
        cur.classList.remove("active");
        cur.classList.add("leaving");
        front = 1 - front;
        if (o.caption) caption.textContent = url.startsWith("data:") ? "" : safeDecode(url.split("?")[0]).split(/[\\/]/).pop();
      });

    const step = async () => {
      if (list.length) {
        idx = (idx + 1) % list.length;
        if (idx === 0 && o.shuffle && list.length > 2) list = shuffle(list);
        await show(list[idx]);
      }
      timer = setTimeout(step, Math.max(3, o.interval) * 1000);
    };

    load().then(step);
    // Re-scan du dossier toutes les 10 minutes (nouvelles images).
    refreshTimer = setInterval(load, 10 * 60 * 1000);
    return {
      destroy() {
        clearTimeout(timer);
        clearInterval(refreshTimer);
      },
    };
  },
};
