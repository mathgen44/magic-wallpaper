// Page affichée en fond d'écran (une par écran).
import "./styles/widgets.css";
import { api } from "./api.js";
import { Board } from "./board.js";
import { layoutForScreen, normalize } from "./model.js";

const root = document.getElementById("board");
let board = new Board(root);
let layout = null;
let gaming = false; // mode jeu : fond uni, briques et vidéo arrêtées

// Nom de l'écran affiché (transmis par le backend) : choisit la disposition.
const screenName = new URLSearchParams(location.search).get("name") || "";

/** Couleur du fond uni en mode jeu : la couleur de fond, ou la plus sombre du dégradé. */
function solidColor(l) {
  const b = l?.background || {};
  return b.type === "color" ? b.color : b.to || b.color || "#000";
}

function show(cfg) {
  layout = layoutForScreen(normalize(cfg), screenName);
  if (gaming) root.style.background = solidColor(layout);
  else if (layout) board.render(layout);
}

/** Mode jeu : on détruit tout (minuteries, vidéo, requêtes) et on ne garde qu'une couleur. */
function setGameMode(st) {
  const on = !!st?.active && !st.close; // « fermer » : le backend retire la fenêtre elle-même
  if (on === gaming) return;
  gaming = on;
  if (on) {
    board.destroy();
    root.style.background = solidColor(layout);
  } else {
    root.style.background = "";
    board = new Board(root);
    if (layout) board.render(layout);
  }
}

async function start() {
  const cfg = await api.getConfig();
  setGameMode(await api.gameMode().catch(() => null));
  show(cfg);
  api.onConfigChanged(show);
  api.onGameMode(setGameMode);
}

// ---- Interactivité ----
// Les éléments portant `data-href` ouvrent une page, `data-action` lance une commande ; `data-open` = "click" | "dblclick" | "none".
// Les clics arrivent soit du bureau (relayés par le backend, le fond étant derrière les icônes),
// soit directement (icônes du bureau masquées).
// `data-action="media:playpause"` déclenche une commande (lecteur multimédia…).
function activate(x, y, count) {
  const target = document.elementFromPoint(x, y)?.closest("[data-href], [data-action]");
  if (!target) return;
  const mode = target.dataset.open || "click";
  if ((mode === "click" && count === 1) || (mode === "dblclick" && count === 2)) {
    target.classList.remove("activated");
    void target.offsetWidth; // relance l'animation
    target.classList.add("activated");
    if (target.dataset.href) api.openUrl(target.dataset.href).catch((e) => console.error(e));
    const [ns, act] = (target.dataset.action || "").split(":");
    if (ns === "media") api.mediaControl(act).catch((e) => console.error(e));
    // Autres actions : traitées par la brique elle-même.
    else if (ns) target.dispatchEvent(new CustomEvent("wp-action", { bubbles: true, detail: { action: target.dataset.action } }));
  }
}
api.onDesktopClick((c) => activate(c.x, c.y, c.count));
document.addEventListener("click", (e) => activate(e.clientX, e.clientY, 1));
document.addEventListener("dblclick", (e) => activate(e.clientX, e.clientY, 2));

// Le fond d'écran n'a pas de menu contextuel ni de sélection de texte.
document.addEventListener("contextmenu", (e) => e.preventDefault());
start();
