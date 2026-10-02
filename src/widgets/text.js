import { el } from "../util.js";

export default {
  type: "text",
  name: "Texte",
  description: "Un titre, une citation ou un pense-bête.",
  icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M5 6h14M12 6v13M8 19h8"/></svg>`,
  size: { w: 12, h: 4 },
  minSize: { w: 2, h: 1 },
  options: [
    { key: "content", label: "Texte", type: "textarea", default: "Bonjour !" },
    { key: "size", label: "Taille", type: "range", default: 2.2, min: 0.6, max: 8, step: 0.1 },
    { key: "weight", label: "Graisse", type: "select", default: "600", choices: [["300", "Fine"], ["400", "Normale"], ["600", "Semi-grasse"], ["800", "Grasse"]] },
    { key: "align", label: "Alignement", type: "select", default: "left", choices: [["left", "Gauche"], ["center", "Centré"], ["right", "Droite"]] },
    { key: "valign", label: "Vertical", type: "select", default: "center", choices: [["start", "Haut"], ["center", "Milieu"], ["end", "Bas"]] },
    { key: "accent", label: "Couleur d'accent", type: "toggle", default: false },
  ],
  mount(body, o) {
    body.append(
      el("div", {
        class: "text-widget",
        style: { fontSize: `${o.size}em`, fontWeight: o.weight, textAlign: o.align, justifyContent: o.valign, color: o.accent ? "var(--w-accent)" : "" },
      }, o.content),
    );
    return { destroy() {} };
  },
};
