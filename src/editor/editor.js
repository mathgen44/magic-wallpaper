// Éditeur de fond d'écran : palette de briques, scène (glisser / redimensionner),
// inspecteur (réglages de la brique, thème, réglages généraux).
import "../styles/widgets.css";
import "../styles/editor.css";
import { api, isTauri } from "../api.js";
import { Board } from "../board.js";
import { defaultConfig, makeWidget, normalize } from "../model.js";
import { FONTS, PRESETS, presetConfig } from "../themes.js";
import { WIDGETS, WIDGET_LIST } from "../widgets/index.js";
import { clamp, clone, el, uid } from "../util.js";
import { buildForm } from "./fields.js";

// ===========================================================================
// État + historique
// ===========================================================================
const S = {
  cfg: defaultConfig(),
  saved: "",
  selected: null,
  tab: "widget",
  past: [],
  future: [],
  monitors: [],
  monitor: 0,
  showGrid: true,
  live: true,
};
const $ = (sel) => document.querySelector(sel);
const selectedWidget = () => S.cfg.widgets.find((w) => w.id === S.selected);

let coalesceKey = null;
let coalesceTimer;
/** Enregistre un point d'annulation. Les changements continus (même `key`) sont regroupés. */
function snapshot(key = null) {
  if (key && key === coalesceKey) {
    clearTimeout(coalesceTimer);
  } else {
    S.past.push(JSON.stringify(S.cfg));
    if (S.past.length > 150) S.past.shift();
    S.future = [];
  }
  coalesceKey = key;
  if (key) coalesceTimer = setTimeout(() => (coalesceKey = null), 1200);
}
function undo() {
  if (!S.past.length) return;
  S.future.push(JSON.stringify(S.cfg));
  S.cfg = JSON.parse(S.past.pop());
  coalesceKey = null;
  if (!selectedWidget()) S.selected = null;
  changed({ rebuild: true });
}
function redo() {
  if (!S.future.length) return;
  S.past.push(JSON.stringify(S.cfg));
  S.cfg = JSON.parse(S.future.pop());
  coalesceKey = null;
  if (!selectedWidget()) S.selected = null;
  changed({ rebuild: true });
}

// ===========================================================================
// Rendu
// ===========================================================================
let board;
let liveTimer;

/** À appeler après toute modification de S.cfg. */
function changed({ rebuild = false, inspector = false } = {}) {
  board.render(S.cfg);
  renderFrames();
  renderLayers();
  if (rebuild) renderInspector();
  else if (inspector) refreshInspector();
  updateStatus();
  if (S.live) {
    clearTimeout(liveTimer);
    liveTimer = setTimeout(apply, 700);
  }
}

function isDirty() {
  return JSON.stringify(S.cfg) !== S.saved;
}

function updateStatus() {
  const dirty = isDirty();
  $("#status").textContent = dirty ? (S.live ? "Enregistrement…" : "Modifications non appliquées") : "Fond d'écran à jour";
  $("#status").classList.toggle("dirty", dirty);
  $("#btn-apply").disabled = !dirty;
  $("#btn-undo").disabled = !S.past.length;
  $("#btn-redo").disabled = !S.future.length;
}

async function apply() {
  try {
    await api.saveConfig(S.cfg);
    S.saved = JSON.stringify(S.cfg);
  } catch (e) {
    toast("Enregistrement impossible : " + e, true);
  }
  updateStatus();
}

function toast(msg, error = false) {
  const t = el("div", { class: `toast${error ? " error" : ""}` }, msg);
  document.body.append(t);
  setTimeout(() => t.classList.add("out"), 2600);
  setTimeout(() => t.remove(), 3000);
}

// ===========================================================================
// Scène : mise à l'échelle de l'aperçu
// ===========================================================================
function screenSize() {
  const m = S.monitors[S.monitor];
  if (!m) return { w: 1920, h: 1080 };
  return { w: Math.round(m.width / m.scale), h: Math.round(m.height / m.scale) };
}

function fitStage() {
  const { w, h } = screenSize();
  const stage = $("#stage");
  const pad = 48;
  const k = Math.min((stage.clientWidth - pad) / w, (stage.clientHeight - pad) / h);
  const screen = $("#screen");
  screen.style.width = `${w}px`;
  screen.style.height = `${h}px`;
  screen.style.transform = `translate(-50%, -50%) scale(${k})`;
  $("#zoom").textContent = `${w} × ${h} · ${Math.round(k * 100)} %`;
  const { cols, rows } = S.cfg.grid;
  $("#grid").style.backgroundSize = `${100 / cols}% ${100 / rows}%`;
}

// ===========================================================================
// Cadres de sélection, déplacement et redimensionnement
// ===========================================================================
const HANDLES = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];

function renderFrames() {
  const overlay = $("#frames");
  const { cols, rows } = S.cfg.grid;
  const existing = new Map([...overlay.children].map((f) => [f.dataset.id, f]));
  S.cfg.widgets.forEach((w, i) => {
    let f = existing.get(w.id);
    existing.delete(w.id);
    if (!f) {
      f = el("div", { class: "frame", "data-id": w.id }, el("div", { class: "frame-tag" }), ...HANDLES.map((h) => el("div", { class: `handle h-${h}`, "data-h": h })));
      f.addEventListener("pointerdown", onFramePointerDown);
      overlay.append(f);
    }
    Object.assign(f.style, {
      left: `${(w.x / cols) * 100}%`,
      top: `${(w.y / rows) * 100}%`,
      width: `${(w.w / cols) * 100}%`,
      height: `${(w.h / rows) * 100}%`,
      zIndex: String(i + 1 + (w.id === S.selected ? 1000 : 0)),
    });
    f.classList.toggle("selected", w.id === S.selected);
    f.firstChild.textContent = `${WIDGETS[w.type].name} · ${w.w}×${w.h}`;
  });
  for (const f of existing.values()) f.remove();
}

/** Convertit un déplacement en pixels écran → cases de grille. */
function cellPx() {
  const r = $("#screen").getBoundingClientRect();
  return { cw: r.width / S.cfg.grid.cols, ch: r.height / S.cfg.grid.rows, rect: r };
}

function onFramePointerDown(e) {
  if (e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  const frame = e.currentTarget;
  const id = frame.dataset.id;
  if (S.selected !== id) select(id);
  const w = selectedWidget();
  const def = WIDGETS[w.type];
  const min = def.minSize || { w: 2, h: 2 };
  const handle = e.target.dataset.h || null;
  const start = { x: w.x, y: w.y, w: w.w, h: w.h };
  const { cw, ch } = cellPx();
  const { cols, rows } = S.cfg.grid;
  const p0 = { x: e.clientX, y: e.clientY };
  let moved = false;
  frame.setPointerCapture(e.pointerId);
  document.body.classList.add(handle ? "resizing" : "dragging");

  const onMove = (ev) => {
    const dx = Math.round((ev.clientX - p0.x) / cw);
    const dy = Math.round((ev.clientY - p0.y) / ch);
    let { x, y, w: ww, h } = start;
    if (!handle) {
      x = clamp(start.x + dx, 0, cols - start.w);
      y = clamp(start.y + dy, 0, rows - start.h);
    } else {
      if (handle.includes("e")) ww = clamp(start.w + dx, min.w, cols - start.x);
      if (handle.includes("s")) h = clamp(start.h + dy, min.h, rows - start.y);
      if (handle.includes("w")) {
        x = clamp(start.x + dx, 0, start.x + start.w - min.w);
        ww = start.w + (start.x - x);
      }
      if (handle.includes("n")) {
        y = clamp(start.y + dy, 0, start.y + start.h - min.h);
        h = start.h + (start.y - y);
      }
    }
    if (x === w.x && y === w.y && ww === w.w && h === w.h) return;
    if (!moved) snapshot();
    moved = true;
    Object.assign(w, { x, y, w: ww, h });
    board.render(S.cfg);
    renderFrames();
    refreshInspector();
  };
  const onUp = () => {
    frame.removeEventListener("pointermove", onMove);
    frame.removeEventListener("pointerup", onUp);
    frame.removeEventListener("pointercancel", onUp);
    document.body.classList.remove("dragging", "resizing");
    if (moved) changed();
  };
  frame.addEventListener("pointermove", onMove);
  frame.addEventListener("pointerup", onUp);
  frame.addEventListener("pointercancel", onUp);
}

function select(id) {
  S.selected = id;
  if (id) S.tab = "widget";
  renderFrames();
  renderLayers();
  renderInspector();
}

// ===========================================================================
// Ajout de briques (clic ou glisser-déposer depuis la palette)
// ===========================================================================
function overlaps(a, b) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function findFreeSpot(w, h) {
  const { cols, rows } = S.cfg.grid;
  for (let y = 0; y <= rows - h; y++)
    for (let x = 0; x <= cols - w; x++) {
      const r = { x, y, w, h };
      if (!S.cfg.widgets.some((o) => overlaps(r, o))) return { x, y };
    }
  return { x: Math.round((cols - w) / 2), y: Math.round((rows - h) / 2) };
}

function addWidget(type, at = null) {
  const w = makeWidget(type);
  const { cols, rows } = S.cfg.grid;
  w.w = Math.min(w.w, cols);
  w.h = Math.min(w.h, rows);
  const pos = at || findFreeSpot(w.w, w.h);
  w.x = clamp(pos.x, 0, cols - w.w);
  w.y = clamp(pos.y, 0, rows - w.h);
  snapshot();
  S.cfg.widgets.push(w);
  S.selected = w.id;
  S.tab = "widget";
  changed({ rebuild: true });
}

function renderPalette() {
  const list = $("#palette");
  for (const def of WIDGET_LIST) {
    const item = el(
      "button",
      { class: "palette-item", draggable: "true", title: def.description, onclick: () => addWidget(def.type) },
      el("span", { class: "pi-icon", html: def.icon }),
      el("span", { class: "pi-text" }, el("span", { class: "pi-name" }, def.name), el("span", { class: "pi-desc" }, def.description)),
    );
    item.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("application/x-dynbg-widget", def.type);
      e.dataTransfer.effectAllowed = "copy";
      dragType = def.type;
    });
    item.addEventListener("dragend", () => {
      dragType = null;
      $("#ghost").hidden = true;
    });
    list.append(item);
  }
}

let dragType = null;
function dropPosition(e) {
  const def = WIDGETS[dragType];
  if (!def) return null;
  const { cw, ch, rect } = cellPx();
  const { cols, rows } = S.cfg.grid;
  const x = clamp(Math.round((e.clientX - rect.left) / cw - def.size.w / 2), 0, cols - def.size.w);
  const y = clamp(Math.round((e.clientY - rect.top) / ch - def.size.h / 2), 0, rows - def.size.h);
  return { x, y, w: def.size.w, h: def.size.h };
}
function setupDrop() {
  const stage = $("#stage");
  const ghost = $("#ghost");
  stage.addEventListener("dragover", (e) => {
    const p = dropPosition(e);
    if (!p) return;
    e.preventDefault();
    const { cols, rows } = S.cfg.grid;
    Object.assign(ghost.style, { left: `${(p.x / cols) * 100}%`, top: `${(p.y / rows) * 100}%`, width: `${(p.w / cols) * 100}%`, height: `${(p.h / rows) * 100}%` });
    ghost.hidden = false;
  });
  stage.addEventListener("dragleave", (e) => {
    if (!stage.contains(e.relatedTarget)) ghost.hidden = true;
  });
  stage.addEventListener("drop", (e) => {
    const p = dropPosition(e);
    ghost.hidden = true;
    if (!p) return;
    e.preventDefault();
    addWidget(dragType, p);
    dragType = null;
  });
  // clic dans le vide = désélection
  stage.addEventListener("pointerdown", (e) => {
    if (!e.target.closest(".frame")) select(null);
  });
}

// ===========================================================================
// Calques (liste des briques, ordre d'empilement)
// ===========================================================================
function renderLayers() {
  const list = $("#layers");
  list.replaceChildren(
    ...[...S.cfg.widgets].reverse().map((w) =>
      el(
        "button",
        { class: `layer${w.id === S.selected ? " active" : ""}`, onclick: () => select(w.id) },
        el("span", { class: "pi-icon", html: WIDGETS[w.type].icon }),
        el("span", { class: "layer-name" }, layerName(w)),
      ),
    ),
  );
  $("#layers-empty").hidden = S.cfg.widgets.length > 0;
}
function layerName(w) {
  const o = w.options;
  const extra = o.title || o.label || (w.type === "text" && o.content?.slice(0, 24)) || "";
  return WIDGETS[w.type].name + (extra ? ` — ${extra}` : "");
}

function moveLayer(id, dir) {
  const arr = S.cfg.widgets;
  const i = arr.findIndex((w) => w.id === id);
  if (i < 0) return;
  snapshot();
  const [w] = arr.splice(i, 1);
  if (dir === "front") arr.push(w);
  else if (dir === "back") arr.unshift(w);
  changed();
}
function removeWidget(id) {
  snapshot();
  S.cfg.widgets = S.cfg.widgets.filter((w) => w.id !== id);
  if (S.selected === id) S.selected = null;
  changed({ rebuild: true });
}
function duplicateWidget(id) {
  const src = S.cfg.widgets.find((w) => w.id === id);
  if (!src) return;
  const copy = { ...clone(src), id: uid() };
  const { cols, rows } = S.cfg.grid;
  copy.x = clamp(src.x + 1, 0, cols - src.w);
  copy.y = clamp(src.y + 1, 0, rows - src.h);
  snapshot();
  S.cfg.widgets.push(copy);
  S.selected = copy.id;
  changed({ rebuild: true });
}

// ===========================================================================
// Inspecteur
// ===========================================================================
let forms = []; // formulaires actifs (pour rafraîchir les valeurs sans reconstruire)

function section(title, ...content) {
  return el("section", { class: "insp-section" }, el("h3", {}, title), ...content);
}

function renderInspector() {
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === S.tab));
  const body = $("#inspector-body");
  forms = [];
  body.replaceChildren();
  if (S.tab === "widget") body.append(...widgetPanel());
  if (S.tab === "theme") body.append(...themePanel());
  if (S.tab === "settings") body.append(...settingsPanel());
}
function refreshInspector() {
  for (const f of forms) f.refresh();
}
function form(defs, getObj, { key } = {}) {
  const f = buildForm(defs, getObj(), (k, v) => {
    const obj = getObj();
    if (!obj) return; // la cible a disparu (désélection pendant la saisie)
    snapshot(`${key}:${k}`);
    obj[k] = v;
    changed({ inspector: true });
  });
  forms.push({ refresh: () => getObj() && f.refresh(getObj()) });
  return f.node;
}

// ---- Brique sélectionnée ----
function widgetPanel() {
  const w = selectedWidget();
  if (!w) {
    return [
      el("div", { class: "insp-empty" },
        el("div", { class: "insp-empty-icon", html: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="8" height="8" rx="2"/><rect x="13" y="3" width="8" height="5" rx="2"/><rect x="13" y="10" width="8" height="11" rx="2"/><rect x="3" y="13" width="8" height="8" rx="2"/></svg>` }),
        el("p", {}, "Sélectionnez une brique sur l'aperçu, ou ajoutez-en une depuis la palette (clic ou glisser-déposer)."),
        el("p", { class: "muted" }, "Raccourcis : flèches pour déplacer (Maj = ×4), Suppr pour retirer, Ctrl+D pour dupliquer, Ctrl+Z / Ctrl+Y."),
      ),
    ];
  }
  const def = WIDGETS[w.type];
  const get = () => selectedWidget();
  const head = el(
    "div",
    { class: "insp-head" },
    el("span", { class: "pi-icon big", html: def.icon }),
    el("div", {}, el("div", { class: "insp-title" }, def.name), el("div", { class: "muted small" }, def.description)),
  );
  const actions = el(
    "div",
    { class: "insp-actions" },
    el("button", { class: "btn", onclick: () => duplicateWidget(w.id), title: "Ctrl+D" }, "Dupliquer"),
    el("button", { class: "btn", onclick: () => moveLayer(w.id, "front") }, "Premier plan"),
    el("button", { class: "btn", onclick: () => moveLayer(w.id, "back") }, "Arrière-plan"),
    el("button", { class: "btn danger", onclick: () => removeWidget(w.id), title: "Suppr" }, "Supprimer"),
  );
  const { cols, rows } = S.cfg.grid;
  const min = def.minSize || { w: 2, h: 2 };
  const posDefs = [
    { key: "x", label: "Colonne", type: "number", min: 0, max: cols - 1 },
    { key: "y", label: "Ligne", type: "number", min: 0, max: rows - 1 },
    { key: "w", label: "Largeur", type: "number", min: min.w, max: cols },
    { key: "h", label: "Hauteur", type: "number", min: min.h, max: rows },
  ];
  const posForm = buildForm(posDefs, w, (k, v) => {
    const cur = get();
    if (!cur) return;
    snapshot(`pos:${k}`);
    cur[k] = Math.round(v);
    cur.w = clamp(cur.w, min.w, cols);
    cur.h = clamp(cur.h, min.h, rows);
    cur.x = clamp(cur.x, 0, cols - cur.w);
    cur.y = clamp(cur.y, 0, rows - cur.h);
    changed({ inspector: true });
  });
  posForm.node.classList.add("grid-2");
  forms.push({ refresh: () => get() && posForm.refresh(get()) });

  const styleDefs = [
    { key: "card", label: "Fond de carte", type: "toggle" },
    { key: "accent", label: "Couleur d'accent", type: "color", resettable: true, placeholder: "thème" },
    { key: "scale", label: "Taille du texte", type: "range", min: 0.5, max: 3, step: 0.05 },
    { key: "opacity", label: "Opacité", type: "range", min: 0.1, max: 1, step: 0.05 },
  ];
  return [
    head,
    actions,
    section("Réglages", form(def.options, () => get()?.options, { key: `opt-${w.id}` })),
    section("Apparence", form(styleDefs, () => get()?.style, { key: `style-${w.id}` })),
    section("Position", posForm.node),
  ];
}

// ---- Thème ----
function themePanel() {
  const presets = el(
    "div",
    { class: "presets" },
    ...Object.entries(PRESETS).map(([key, p]) => {
      const bg = p.background.type === "gradient" ? `linear-gradient(${p.background.angle}deg, ${p.background.from}, ${p.background.to})` : p.background.color;
      return el(
        "button",
        {
          class: `preset${S.cfg.theme.preset === key ? " active" : ""}`,
          onclick: () => {
            snapshot();
            const keepImage = S.cfg.background.type === "image";
            const pc = presetConfig(key);
            S.cfg.theme = pc.theme;
            if (!keepImage) S.cfg.background = pc.background;
            changed({ rebuild: true });
          },
        },
        el("span", { class: "preset-swatch", style: { background: bg } },
          el("span", { class: "preset-card", style: { background: p.theme.card, color: p.theme.fg } },
            el("span", { class: "preset-dot", style: { background: p.theme.accent } }),
            el("span", { class: "preset-dot", style: { background: p.theme.accent2 } }))),
        el("span", { class: "preset-name" }, p.label),
      );
    }),
  );
  const colorDefs = [
    { key: "fg", label: "Texte", type: "color" },
    { key: "muted", label: "Texte secondaire", type: "color" },
    { key: "accent", label: "Accent", type: "color" },
    { key: "accent2", label: "Accent secondaire", type: "color" },
    { key: "card", label: "Fond des cartes", type: "color" },
  ];
  const cardDefs = [
    { key: "cardOpacity", label: "Opacité des cartes", type: "range", min: 0, max: 1, step: 0.01 },
    { key: "blur", label: "Flou d'arrière-plan (px)", type: "range", min: 0, max: 40, step: 1 },
    { key: "radius", label: "Arrondi des angles (px)", type: "range", min: 0, max: 40, step: 1 },
    { key: "border", label: "Bordure", type: "range", min: 0, max: 0.5, step: 0.01 },
    { key: "shadow", label: "Ombre portée", type: "toggle" },
    { key: "font", label: "Police", type: "select", choices: FONTS },
  ];
  const bgDefs = [
    { key: "type", label: "Type de fond", type: "select", choices: [["color", "Couleur unie"], ["gradient", "Dégradé"], ["image", "Image"]] },
    { key: "color", label: "Couleur", type: "color", showIf: (b) => b.type === "color" },
    { key: "from", label: "Couleur de départ", type: "color", showIf: (b) => b.type === "gradient" },
    { key: "to", label: "Couleur d'arrivée", type: "color", showIf: (b) => b.type === "gradient" },
    { key: "angle", label: "Angle (°)", type: "range", min: 0, max: 360, step: 5, showIf: (b) => b.type === "gradient" },
    { key: "image", label: "Image", type: "image", showIf: (b) => b.type === "image" },
    { key: "fit", label: "Ajustement", type: "select", choices: [["cover", "Remplir"], ["contain", "Ajuster"], ["tile", "Mosaïque"]], showIf: (b) => b.type === "image" },
    { key: "dim", label: "Assombrir", type: "range", min: 0, max: 0.9, step: 0.05, showIf: (b) => b.type === "image" },
    { key: "blurImg", label: "Flou de l'image (px)", type: "range", min: 0, max: 30, step: 1, showIf: (b) => b.type === "image" },
  ];
  return [
    section("Thèmes prédéfinis", presets),
    section("Couleurs", form(colorDefs, () => S.cfg.theme, { key: "theme" })),
    section("Cartes", form(cardDefs, () => S.cfg.theme, { key: "theme" })),
    section("Fond", form(bgDefs, () => S.cfg.background, { key: "bg" })),
  ];
}

// ---- Réglages ----
function settingsPanel() {
  const gridDefs = [
    { key: "cols", label: "Colonnes", type: "number", min: 6, max: 96 },
    { key: "rows", label: "Lignes", type: "number", min: 4, max: 64 },
    { key: "gap", label: "Espacement (px)", type: "number", min: 0, max: 60 },
  ];
  const gridForm = buildForm(gridDefs, S.cfg.grid, (k, v) => {
    snapshot();
    const old = { ...S.cfg.grid };
    S.cfg.grid[k] = Math.round(v);
    // Mise à l'échelle des briques pour conserver la disposition.
    if (k === "cols" || k === "rows") {
      const f = k === "cols" ? S.cfg.grid.cols / old.cols : S.cfg.grid.rows / old.rows;
      for (const w of S.cfg.widgets) {
        if (k === "cols") {
          w.x = Math.round(w.x * f);
          w.w = Math.max(1, Math.round(w.w * f));
        } else {
          w.y = Math.round(w.y * f);
          w.h = Math.max(1, Math.round(w.h * f));
        }
      }
    }
    fitStage();
    changed({ inspector: true });
  });
  gridForm.node.classList.add("grid-3");
  forms.push({ refresh: () => gridForm.refresh(S.cfg.grid) });

  const monDefs = [{ key: "monitors", label: "Écrans", type: "select", choices: [["all", "Tous les écrans (même disposition)"], ["primary", "Écran principal uniquement"]] }];

  const autostart = el("input", { type: "checkbox", id: "autostart" });
  api.autostart().then((v) => (autostart.checked = !!v)).catch(() => {});
  autostart.addEventListener("change", async () => {
    try {
      autostart.checked = await api.autostart(autostart.checked);
    } catch (e) {
      toast("Impossible de modifier le démarrage automatique : " + e, true);
    }
  });
  const toggle = (input, label) => el("label", { class: "toggle", for: input.id }, input, el("span", { class: "toggle-ui" }), el("span", {}, label));
  const live = el("input", { type: "checkbox", id: "live", checked: S.live });
  live.addEventListener("change", () => {
    S.live = live.checked;
    try { localStorage.setItem("dynbg:live", S.live ? "1" : "0"); } catch {}
    updateStatus();
  });
  const grid = el("input", { type: "checkbox", id: "showgrid", checked: S.showGrid });
  grid.addEventListener("change", () => {
    S.showGrid = grid.checked;
    $("#grid").hidden = !S.showGrid;
  });

  const logBox = el("pre", { class: "log" });
  const details = el("details", {}, el("summary", {}, "Journal de diagnostic"), logBox);
  details.addEventListener("toggle", async () => {
    if (details.open) logBox.textContent = (await api.readLog()) || "(vide)";
  });

  return [
    section("Affichage", form(monDefs, () => S.cfg.settings, { key: "settings" })),
    section("Grille", gridForm.node, el("p", { class: "muted small" }, "Les briques sont aimantées sur cette grille. Changer le nombre de colonnes ou de lignes redimensionne la disposition.")),
    section("Application", el("div", { class: "form" },
      toggle(autostart, "Lancer au démarrage de Windows"),
      toggle(live, "Appliquer les modifications en direct sur le bureau"),
      toggle(grid, "Afficher la grille dans l'éditeur"),
    )),
    section("Disposition",
      el("div", { class: "insp-actions" },
        el("button", { class: "btn", onclick: exportLayout }, "Exporter…"),
        el("button", { class: "btn", onclick: importLayout }, "Importer…"),
        el("button", { class: "btn", onclick: () => api.reloadWallpapers().then(() => toast("Fond d'écran rechargé")) }, "Recharger le fond"),
        el("button", { class: "btn danger", onclick: resetLayout }, "Réinitialiser"),
      ),
    ),
    section("À propos", el("p", { class: "muted small" }, "Dynamic Background — par mathgen44 · licence MIT"), details),
  ];
}

async function exportLayout() {
  if (!isTauri) {
    const blob = new Blob([JSON.stringify(S.cfg, null, 2)], { type: "application/json" });
    const a = el("a", { href: URL.createObjectURL(blob), download: "mon-fond.dynbg.json" });
    a.click();
    return;
  }
  const path = await api.pickSavePath();
  if (!path) return;
  try {
    await api.exportConfig(path, S.cfg);
    toast("Disposition exportée");
  } catch (e) {
    toast("Export impossible : " + e, true);
  }
}
async function importLayout() {
  const path = await api.pickOpenPath();
  if (!path) return;
  try {
    const cfg = normalize(await api.importConfig(path));
    snapshot();
    S.cfg = cfg;
    S.selected = null;
    fitStage();
    changed({ rebuild: true });
    toast("Disposition importée");
  } catch (e) {
    toast("Import impossible : " + e, true);
  }
}
function resetLayout() {
  if (!confirm("Remplacer la disposition actuelle par celle par défaut ?")) return;
  snapshot();
  S.cfg = defaultConfig();
  S.selected = null;
  fitStage();
  changed({ rebuild: true });
}

// ===========================================================================
// Clavier
// ===========================================================================
function setupKeyboard() {
  document.addEventListener("keydown", (e) => {
    const typing = e.target.closest("input, textarea, select, [contenteditable]");
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.key.toLowerCase() === "s") {
      e.preventDefault();
      apply();
      return;
    }
    if (typing) return;
    if (ctrl && e.key.toLowerCase() === "z" && !e.shiftKey) return e.preventDefault(), undo();
    if (ctrl && (e.key.toLowerCase() === "y" || (e.key.toLowerCase() === "z" && e.shiftKey))) return e.preventDefault(), redo();
    const w = selectedWidget();
    if (!w) return;
    if (ctrl && e.key.toLowerCase() === "d") return e.preventDefault(), duplicateWidget(w.id);
    if (e.key === "Delete" || e.key === "Backspace") return e.preventDefault(), removeWidget(w.id);
    if (e.key === "Escape") return select(null);
    const step = e.shiftKey ? 4 : 1;
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (d) {
      e.preventDefault();
      const { cols, rows } = S.cfg.grid;
      snapshot("arrows");
      w.x = clamp(w.x + d[0], 0, cols - w.w);
      w.y = clamp(w.y + d[1], 0, rows - w.h);
      changed({ inspector: true });
    }
  });
}

// ===========================================================================
// Démarrage
// ===========================================================================
async function init() {
  try {
    S.live = localStorage.getItem("dynbg:live") !== "0";
  } catch {}
  board = new Board($("#board"), { editing: true });
  const loaded = await api.getConfig().catch(() => null);
  S.cfg = normalize(loaded);
  S.saved = loaded ? JSON.stringify(S.cfg) : "";
  S.monitors = await api.getMonitors().catch(() => []);
  S.monitor = Math.max(0, S.monitors.findIndex((m) => m.primary));
  const sel = $("#monitor");
  if (S.monitors.length > 1) {
    sel.append(...S.monitors.map((m, i) => el("option", { value: i }, `${m.name || "Écran " + (i + 1)} (${m.width}×${m.height})`)));
    sel.value = S.monitor;
    sel.hidden = false;
    sel.addEventListener("change", () => {
      S.monitor = +sel.value;
      fitStage();
    });
  }

  renderPalette();
  setupDrop();
  setupKeyboard();
  document.querySelectorAll(".tab").forEach((t) =>
    t.addEventListener("click", () => {
      S.tab = t.dataset.tab;
      renderInspector();
    }),
  );
  $("#btn-undo").addEventListener("click", undo);
  $("#btn-redo").addEventListener("click", redo);
  $("#btn-apply").addEventListener("click", apply);
  new ResizeObserver(fitStage).observe($("#stage"));

  fitStage();
  board.render(S.cfg);
  renderFrames();
  renderLayers();
  renderInspector();
  updateStatus();
  // Premier lancement : on enregistre la disposition par défaut pour l'afficher sur le bureau.
  if (!loaded) apply();
}

init();
