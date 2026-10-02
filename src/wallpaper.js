// Page affichée en fond d'écran (une par écran).
import "./styles/widgets.css";
import { api } from "./api.js";
import { Board } from "./board.js";
import { layoutForScreen, normalize } from "./model.js";

const board = new Board(document.getElementById("board"));

// Nom de l'écran affiché (transmis par le backend) : choisit la disposition.
const screenName = new URLSearchParams(location.search).get("name") || "";

function show(cfg) {
  const layout = layoutForScreen(normalize(cfg), screenName);
  if (layout) board.render(layout);
}

async function start() {
  show(await api.getConfig());
  api.onConfigChanged(show);
}

// ---- Interactivité ----
// Les éléments portant `data-href` ouvrent une page ; `data-open` = "click" | "dblclick" | "none".
// Les clics arrivent soit du bureau (relayés par le backend, le fond étant derrière les icônes),
// soit directement (icônes du bureau masquées).
function activate(x, y, count) {
  const target = document.elementFromPoint(x, y)?.closest("[data-href]");
  if (!target) return;
  const mode = target.dataset.open || "click";
  if ((mode === "click" && count === 1) || (mode === "dblclick" && count === 2)) {
    target.classList.remove("activated");
    void target.offsetWidth; // relance l'animation
    target.classList.add("activated");
    api.openUrl(target.dataset.href).catch((e) => console.error(e));
  }
}
api.onDesktopClick((c) => activate(c.x, c.y, c.count));
document.addEventListener("click", (e) => activate(e.clientX, e.clientY, 1));
document.addEventListener("dblclick", (e) => activate(e.clientX, e.clientY, 2));

// Le fond d'écran n'a pas de menu contextuel ni de sélection de texte.
document.addEventListener("contextmenu", (e) => e.preventDefault());
start();
