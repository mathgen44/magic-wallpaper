// Page affichée en fond d'écran (une par écran).
import "./styles/widgets.css";
import { api } from "./api.js";
import { Board } from "./board.js";
import { normalize } from "./model.js";

const board = new Board(document.getElementById("board"));

async function start() {
  board.render(normalize(await api.getConfig()));
  api.onConfigChanged((cfg) => board.render(normalize(cfg)));
}

// Le fond d'écran n'a pas de menu contextuel ni de sélection de texte.
document.addEventListener("contextmenu", (e) => e.preventDefault());
start();
