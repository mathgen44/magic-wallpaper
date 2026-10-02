// Rendu d'une configuration (thème + fond + briques) dans un conteneur.
// Utilisé à l'identique par le fond d'écran et par l'aperçu de l'éditeur.
import { api } from "./api.js";
import { applyBackground, applyTheme } from "./themes.js";
import { WIDGETS } from "./widgets/index.js";
import { el } from "./util.js";

export class Board {
  constructor(root, { editing = false } = {}) {
    this.root = root;
    this.editing = editing;
    root.classList.add("board");
    this.bg = el("div", { class: "board-bg" });
    this.dim = el("div", { class: "board-dim" });
    this.layer = el("div", { class: "board-layer" });
    root.append(this.bg, this.dim, this.layer);
    this.cells = new Map(); // id -> { cell, card, body, key, inst, ctrl }
    this.bgKey = "";
    new ResizeObserver(() => this.updateScale()).observe(root);
    this.updateScale();
  }

  updateScale() {
    // --ui : facteur d'échelle par rapport à un écran de 1080 px de haut.
    const h = this.root.clientHeight || 1080;
    this.root.style.setProperty("--ui", (h / 1080).toFixed(4));
  }

  cellOf(id) {
    return this.cells.get(id)?.cell;
  }

  render(cfg) {
    this.cfg = cfg;
    applyTheme(this.root, cfg.theme);
    const g = cfg.grid;
    this.root.style.setProperty("--gap", g.gap);
    const bgKey = JSON.stringify(cfg.background);
    if (bgKey !== this.bgKey) {
      this.bgKey = bgKey;
      applyBackground(this.bg, cfg.background);
    }

    const seen = new Set();
    cfg.widgets.forEach((w, i) => {
      seen.add(w.id);
      let rec = this.cells.get(w.id);
      if (!rec) {
        const body = el("div", { class: "wbody" });
        const card = el("div", { class: "card" }, body);
        const cell = el("div", { class: "cell", "data-id": w.id }, card);
        this.layer.append(cell);
        rec = { cell, card, body, key: "" };
        this.cells.set(w.id, rec);
      }
      this.position(rec.cell, w);
      rec.cell.style.zIndex = String(i + 1);
      const st = w.style || {};
      rec.cell.classList.toggle("no-card", st.card === false);
      rec.cell.style.setProperty("--w-accent", st.accent || "var(--accent)");
      rec.cell.style.setProperty("--wscale", st.scale ?? 1);
      rec.cell.style.opacity = st.opacity ?? 1;
      rec.cell.dataset.type = w.type;

      const key = w.type + JSON.stringify(w.options);
      if (key !== rec.key) {
        rec.key = key;
        this.mount(rec, w);
      }
    });
    for (const [id, rec] of this.cells) {
      if (!seen.has(id)) {
        this.unmount(rec);
        rec.cell.remove();
        this.cells.delete(id);
      }
    }
  }

  position(cell, w) {
    const { cols, rows } = this.cfg.grid;
    Object.assign(cell.style, {
      left: `${(w.x / cols) * 100}%`,
      top: `${(w.y / rows) * 100}%`,
      width: `${(w.w / cols) * 100}%`,
      height: `${(w.h / rows) * 100}%`,
    });
  }

  mount(rec, w) {
    this.unmount(rec);
    rec.body.replaceChildren();
    rec.body.className = `wbody w-${w.type}`;
    const def = WIDGETS[w.type];
    rec.ctrl = new AbortController();
    try {
      rec.inst = def.mount(rec.body, w.options, { api, editing: this.editing, signal: rec.ctrl.signal });
    } catch (e) {
      console.error(e);
      rec.body.replaceChildren(el("div", { class: "widget-empty" }, `Erreur dans « ${def.name} » : ${e.message}`));
    }
  }

  unmount(rec) {
    rec.ctrl?.abort();
    try {
      rec.inst?.destroy?.();
    } catch (e) {
      console.error(e);
    }
    rec.inst = null;
  }

  destroy() {
    for (const rec of this.cells.values()) this.unmount(rec);
    this.cells.clear();
    this.root.replaceChildren();
  }
}
