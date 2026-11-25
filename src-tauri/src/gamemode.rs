//! Mode jeu : quand un jeu tourne, le fond d'écran passe en fond uni (briques et vidéo arrêtées)
//! ou est fermé, pour laisser le processeur, la carte graphique et la mémoire au jeu.
//!
//! Un jeu est reconnu :
//! * à son exécutable, situé dans une bibliothèque Steam, un dossier de jeu Epic ou un dossier
//!   de jeux classique (GOG, Xbox, Riot, Ubisoft, EA, Battle.net…), hors lanceurs ;
//! * à son nom, si l'utilisateur l'a ajouté à la liste « Autres jeux » ;
//! * à l'état « jeu Direct3D en plein écran » signalé par Windows ;
//! * en option, à toute application en plein écran (vidéo, présentation…).
//!
//! Le jeu n'a pas besoin d'être au premier plan : le mode reste actif tant qu'il tourne.

use serde::Serialize;
use serde_json::Value;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

const TICK: Duration = Duration::from_secs(3);
/// Vérifications négatives consécutives avant de quitter le mode jeu (~9 s).
const EXIT_AFTER: u32 = 3;

/// Exécutables situés dans des dossiers de jeux qui ne sont pas des jeux.
const NOT_GAMES: &[&str] = &[
    "steam", "steamwebhelper", "steamservice", "gameoverlayui", "epicgameslauncher", "epicwebhelper",
    "epiconlineservices", "eosoverlayrenderer", "battle.net", "agent.exe", "blizzard", "riotclient", "ubisoftconnect", "upc.exe",
    "uplaywebcore", "ubisoftgamelauncher", "eadesktop", "ealauncher", "eabackgroundservice", "ealocalhost",
    "eaconnect", "galaxy", "goggalaxy",
    "minecraftlauncher", "unitycrashhandler", "crashreport", "crashpad", "easyanticheat", "beservice",
    "unins", "setup", "installer", "vc_redist", "dxsetup", "dotnet",
];

/// Dossiers de services des lanceurs (overlays, launcher) : rien n'y est un jeu.
const NOT_GAME_DIRS: &[&str] = &["\\launcher\\", "\\epic online services\\"];

#[derive(Clone, Default)]
pub struct Settings {
    pub enabled: bool,
    pub fullscreen: bool,
    /// Fermer les fenêtres du fond (au lieu d'un fond uni).
    pub close: bool,
    /// Noms d'exécutables ajoutés par l'utilisateur (en minuscules, avec .exe).
    pub extra: Vec<String>,
}

impl Settings {
    pub fn load(app: &AppHandle) -> Self {
        let cfg = crate::config::load(app);
        let g = cfg.as_ref().and_then(|c| c.pointer("/settings/gameMode"));
        let get = |k: &str| g.and_then(|g| g.get(k));
        Settings {
            enabled: get("enabled").and_then(Value::as_bool).unwrap_or(true),
            fullscreen: get("fullscreen").and_then(Value::as_bool).unwrap_or(false),
            close: get("action").and_then(Value::as_str) == Some("close"),
            extra: get("extra")
                .and_then(Value::as_array)
                .map(|a| {
                    a.iter()
                        .filter_map(Value::as_str)
                        .map(|s| {
                            let s = s.trim().to_lowercase();
                            if s.ends_with(".exe") { s } else { format!("{s}.exe") }
                        })
                        .filter(|s| s.len() > 4)
                        .collect()
                })
                .unwrap_or_default(),
        }
    }
}

#[derive(Serialize, Clone, Default, PartialEq)]
pub struct GameStatus {
    pub active: bool,
    /// Jeu détecté (nom de l'exécutable) ou « plein écran ».
    pub game: String,
    /// Les fenêtres du fond sont fermées pendant le jeu.
    pub close: bool,
}

#[derive(Default)]
pub struct GameState(pub Mutex<GameStatus>);

/// Les fenêtres du fond doivent-elles être fermées (mode jeu actif avec l'action « fermer ») ?
pub fn closes_wallpaper(app: &AppHandle) -> bool {
    let s = app.state::<GameState>().0.lock().unwrap().clone();
    s.active && s.close
}

/// `path` et `name` en minuscules.
pub fn is_game(path: &str, name: &str, dirs: &[String], extra: &[String]) -> bool {
    if extra.iter().any(|e| e == name) {
        return true;
    }
    if NOT_GAMES.iter().any(|n| name.starts_with(n)) || NOT_GAME_DIRS.iter().any(|d| path.contains(d)) {
        return false;
    }
    dirs.iter().any(|d| path.starts_with(d.as_str())) || crate::apps::GAME_PATHS.iter().any(|t| path.contains(t))
}

#[cfg(windows)]
fn fullscreen_state(any_app: bool) -> Option<String> {
    use windows::Win32::UI::Shell::*;
    let s = unsafe { SHQueryUserNotificationState() }.ok()?;
    if s == QUNS_RUNNING_D3D_FULL_SCREEN {
        return Some("jeu en plein écran".into());
    }
    if any_app && (s == QUNS_BUSY || s == QUNS_PRESENTATION_MODE) {
        return Some("application en plein écran".into());
    }
    None
}

#[cfg(not(windows))]
fn fullscreen_state(_any_app: bool) -> Option<String> {
    None
}

struct Detector {
    sys: sysinfo::System,
    dirs: Vec<String>,
    dirs_at: Option<Instant>,
}

impl Detector {
    fn running_game(&mut self, extra: &[String]) -> Option<String> {
        use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, UpdateKind};
        if self.dirs_at.is_none_or(|t| t.elapsed() > Duration::from_secs(600)) {
            self.dirs = crate::apps::game_dirs();
            self.dirs_at = Some(Instant::now());
        }
        self.sys.refresh_processes_specifics(
            ProcessesToUpdate::All,
            true,
            ProcessRefreshKind::nothing().with_exe(UpdateKind::OnlyIfNotSet),
        );
        self.sys.processes().values().find_map(|p| {
            let exe = p.exe()?;
            let path = exe.to_string_lossy().to_lowercase();
            let name = exe.file_name()?.to_string_lossy().to_lowercase();
            is_game(&path, &name, &self.dirs, extra).then(|| exe.file_name().unwrap().to_string_lossy().into_owned())
        })
    }
}

fn set(app: &AppHandle, next: GameStatus) {
    let prev = {
        let st = app.state::<GameState>();
        let mut s = st.0.lock().unwrap();
        std::mem::replace(&mut *s, next.clone())
    };
    if prev == next {
        return;
    }
    if next.active {
        crate::log(app, format!("Mode jeu activé ({})", next.game));
    } else {
        crate::log(app, "Mode jeu désactivé");
    }
    let _ = app.emit("game-mode", next.clone());
    crate::refresh_tray_tooltip(app);
    // Fermeture / réouverture des fenêtres du fond.
    if prev.active && prev.close || next.active && next.close {
        crate::schedule_rebuild(app);
    }
}

pub fn spawn(app: AppHandle) {
    std::thread::spawn(move || {
        let mut det = Detector { sys: sysinfo::System::new(), dirs: Vec::new(), dirs_at: None };
        let mut settings = Settings::default();
        let mut misses = 0u32;
        for tick in 0u64.. {
            std::thread::sleep(TICK);
            if tick % 5 == 0 {
                settings = Settings::load(&app); // relu toutes les 15 s
            }
            let active = app.state::<GameState>().0.lock().unwrap().active;
            if !settings.enabled {
                if active {
                    set(&app, GameStatus::default());
                }
                continue;
            }
            let found = det.running_game(&settings.extra).or_else(|| fullscreen_state(settings.fullscreen));
            match found {
                Some(game) => {
                    misses = 0;
                    set(&app, GameStatus { active: true, game, close: settings.close });
                }
                None if active => {
                    misses += 1;
                    if misses >= EXIT_AFTER {
                        set(&app, GameStatus::default());
                    }
                }
                None => {}
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::is_game;

    #[test]
    fn detection() {
        let dirs = vec!["d:\\steamlibrary\\steamapps\\common\\".to_string(), "e:\\jeux epic\\alanwake2\\".to_string()];
        let none: Vec<String> = vec![];
        assert!(is_game("d:\\steamlibrary\\steamapps\\common\\hades\\hades.exe", "hades.exe", &dirs, &none));
        assert!(is_game("e:\\jeux epic\\alanwake2\\alanwake2.exe", "alanwake2.exe", &dirs, &none));
        assert!(is_game("c:\\program files\\riot games\\valorant\\live\\valorant.exe", "valorant.exe", &dirs, &none));
        assert!(!is_game("c:\\program files (x86)\\steam\\steam.exe", "steam.exe", &dirs, &none));
        assert!(!is_game("c:\\program files (x86)\\epic games\\launcher\\portal\\binaries\\win64\\epicgameslauncher.exe", "epicgameslauncher.exe", &dirs, &none));
        assert!(!is_game("d:\\steamlibrary\\steamapps\\common\\hades\\unitycrashhandler64.exe", "unitycrashhandler64.exe", &dirs, &none));
        assert!(!is_game("c:\\program files (x86)\\epic games\\epic online services\\managedartifacts\\98bc\\eosoverlayrenderer-win64-shipping.exe", "eosoverlayrenderer-win64-shipping.exe", &dirs, &none));
        assert!(!is_game("c:\\windows\\explorer.exe", "explorer.exe", &dirs, &none));
        assert!(is_game("c:\\tools\\emu\\retroarch.exe", "retroarch.exe", &dirs, &["retroarch.exe".to_string()]));
    }
}

#[cfg(test)]
mod diagnostic {
    /// `cargo test --lib gamemode::diagnostic -- --ignored --nocapture` : jeux détectés sur ce PC.
    #[test]
    #[ignore]
    fn scan_now() {
        let dirs = crate::apps::game_dirs();
        println!("Dossiers de jeux : {dirs:#?}");
        let mut det = super::Detector { sys: sysinfo::System::new(), dirs, dirs_at: Some(std::time::Instant::now()) };
        println!("Jeu en cours : {:?}", det.running_game(&[]));
        println!("Plein écran : {:?}", super::fullscreen_state(true));
    }
}
