# Dynamic Background

Fond d'écran dynamique et modulaire pour Windows 10 / 11. On compose son bureau avec des **briques** (horloge, carrousel d'images, flux RSS, infos système façon Rainmeter, texte…) dans un éditeur visuel, et le résultat s'affiche **derrière les icônes du bureau**.

- Éditeur glisser-déposer : on place, déplace et redimensionne les briques sur une grille aimantée
- Thèmes prêts à l'emploi (Nuit, Aurore, Forêt, Néon, Graphite, Océan, Terminal), entièrement personnalisables : couleurs, transparence, flou, arrondis, police, fond (couleur, dégradé ou image)
- Multi-écrans : plusieurs dispositions nommées, chacune affectée à un ou plusieurs écrans (ou aucun fond sur un écran donné)
- Léger : application Tauri (Rust + WebView2), installeur de quelques Mo, sans droits administrateur
- Vit dans la zone de notification : éditeur, pause, rechargement, démarrage avec Windows

## Installation (utilisateurs)

1. Téléchargez `Dynamic Background_x.y.z_x64-setup.exe` depuis la page **Releases** du dépôt.
2. Lancez-le. L'installation se fait pour votre compte uniquement, sans droits administrateur.
3. Au premier lancement, l'éditeur s'ouvre et le démarrage automatique avec Windows est activé (désactivable dans *Réglages*).

> L'installeur n'est pas signé numériquement : Windows SmartScreen peut afficher « Windows a protégé votre ordinateur ». Cliquez sur **Informations complémentaires → Exécuter quand même**.

WebView2 est déjà présent sur Windows 10 (à jour) et 11 ; sinon l'installeur le télécharge automatiquement.

## Utilisation

- **Icône de la zone de notification** : clic gauche = éditeur ; clic droit = pause, recharger, quitter.
- **Ajouter une brique** : cliquez dessus dans la palette de gauche, ou glissez-la sur l'aperçu.
- **Une disposition par écran** : choisissez l'écran dans la barre du haut puis cliquez sur **+** pour lui créer sa propre disposition (copie de l'actuelle). Les affectations se règlent dans *Réglages → Écrans*.
- **Déplacer / redimensionner** : à la souris sur l'aperçu, ou avec les champs *Position* de l'inspecteur.
- **Raccourcis** : flèches (Maj = ×4), Suppr, Ctrl+D (dupliquer), Ctrl+Z / Ctrl+Y, Ctrl+S (appliquer).
- Par défaut, chaque modification est appliquée en direct sur le bureau (désactivable dans *Réglages*).
- **Exporter / Importer** une disposition (`.json`) pour la sauvegarder ou la partager.

## Compiler l'installeur

### Avec GitHub Actions (recommandé)

Le workflow `.github/workflows/release.yml` compile l'installeur sur un runner Windows :

```bash
git tag v0.1.0
git push origin v0.1.0
```

Une release **brouillon** est créée avec le `setup.exe` ; il reste à la publier. On peut aussi lancer le workflow à la main (onglet *Actions → Release → Run workflow*) : l'installeur est alors dans les *artifacts* du run.

Pensez à aligner le numéro de version dans `package.json`, `src-tauri/Cargo.toml` et `src-tauri/tauri.conf.json` avant de taguer.

### En local (Windows)

Prérequis : [Node.js 22+](https://nodejs.org), [Rust](https://rustup.rs) (toolchain MSVC) et les *Build Tools* Visual Studio (C++).

```bash
npm install
npm run tauri dev      # lance l'application en mode développement
npm run tauri build    # produit src-tauri/target/release/bundle/nsis/*-setup.exe
```

`npm run dev` seul ouvre l'éditeur dans un navigateur avec des données simulées : pratique pour travailler l'interface sans recompiler le Rust.

## Architecture

```
index.html / src/editor/     Éditeur (palette, aperçu, inspecteur, historique)
wallpaper.html / src/wallpaper.js   Page affichée en fond d'écran (une fenêtre par écran)
src/board.js                 Rendu d'une configuration — partagé par l'éditeur et le fond
src/widgets/                 Les briques (une par fichier) + registre index.js
src/themes.js, src/model.js  Thèmes prédéfinis, modèle de configuration
src/api.js                   Pont vers Rust (+ données simulées hors Tauri)
src-tauri/src/
  lib.rs                     Fenêtres, zone de notification, commandes, surveillance
  desktop.rs                 Intégration derrière les icônes (WorkerW / Progman)
  sysmon.rs                  CPU, RAM, disques, réseau (crate sysinfo)
  feeds.rs                   Récupération + analyse RSS/Atom/JSON Feed (feed-rs)
  images.rs                  Listing des dossiers d'images
```

La configuration est enregistrée dans `%APPDATA%\com.mathgen44.dynamicbackground\layout.json`, le journal dans `%LOCALAPPDATA%\com.mathgen44.dynamicbackground\logs\`.

### Placement derrière les icônes

`desktop.rs` gère les deux organisations du bureau Windows :

- **Classique** (Windows 10, Windows 11 avant 24H2) : le message `0x052C` envoyé à `Progman` fait créer à Explorer un calque `WorkerW` derrière les icônes ; la fenêtre du fond y est attachée.
- **Windows 11 24H2+** : les icônes (`SHELLDLL_DefView`) et le papier peint sont des enfants de `Progman`. La fenêtre devient un enfant *layered* de `Progman`, placé dans l'ordre Z juste sous les icônes.

Une surveillance toutes les 3 s répare sur place le style, la visibilité et l'ordre Z des fenêtres, les ré-attache si Explorer redémarre et ne les recrée que si les écrans changent ou si une fenêtre a disparu. En cas d'échec, le fond s'affiche comme une fenêtre « toujours en arrière-plan » et le journal (*Réglages → Journal de diagnostic*) indique pourquoi.

## Créer une nouvelle brique

1. Créez `src/widgets/ma-brique.js` :

```js
export default {
  type: "meteo",                     // identifiant unique
  name: "Météo",
  description: "Prévisions du jour.",
  icon: `<svg viewBox="0 0 24 24">…</svg>`,
  size: { w: 10, h: 6 },             // taille par défaut (cases de grille)
  options: [                         // génère automatiquement le panneau de réglages
    { key: "ville", label: "Ville", type: "text", default: "Nantes" },
    { key: "unite", label: "Unité", type: "select", default: "c", choices: [["c", "°C"], ["f", "°F"]] },
  ],
  mount(body, options, ctx) {
    body.textContent = options.ville;
    const timer = setInterval(() => { /* … */ }, 60_000);
    return { destroy: () => clearInterval(timer) };
  },
};
```

2. Ajoutez-la à `WIDGET_LIST` dans `src/widgets/index.js`.

Types de champs disponibles : `text`, `textarea`, `list`, `number`, `range`, `toggle`, `select`, `color`, `folder`, `checklist` (avec `showIf` pour les afficher selon les autres réglages). Les couleurs du thème sont accessibles en CSS via `var(--fg)`, `var(--muted)`, `var(--w-accent)`, `var(--accent2)`, `var(--track)`. Si la brique a besoin d'accès système ou réseau hors CORS, ajoutez une commande dans `src-tauri/src/lib.rs`.

## Limites connues / pistes

- Le fond d'écran n'est pas interactif (les clics vont au bureau) : les liens RSS ne sont pas cliquables.
- Pas encore de mise en pause automatique quand une application est en plein écran (jeux).
- Pas de température CPU/GPU (non exposée de façon fiable par Windows sans pilote dédié).
- Idées de briques : météo, calendrier, lecteur multimédia en cours, Zabbix / Proxmox, vidéo de fond, notes.

## Licence

MIT © mathgen44
