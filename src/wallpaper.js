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

// Le fond d'écran n'a pas de menu contextuel ni de sélection de texte.
document.addEventListener("contextmenu", (e) => e.preventDefault());
start();
