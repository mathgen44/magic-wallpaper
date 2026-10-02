//! Dynamic Background — fond d'écran dynamique modulaire pour Windows.
//! © mathgen44 — licence MIT.
//!
//! Architecture :
//! * une fenêtre « wallpaper » par écran, attachée derrière les icônes du bureau (desktop.rs),
//!   qui affiche `wallpaper.html` ;
//! * une fenêtre « editor » (index.html) ouverte à la demande depuis l'icône de la zone de
//!   notification, pour composer le fond d'écran avec des briques ;
//! * des commandes Rust pour ce que la WebView ne sait pas faire seule : infos système,
//!   lecture des flux RSS (CORS), listing de dossiers d'images, stockage de la config.

mod config;
mod desktop;
mod feeds;
mod images;
mod sysmon;

use serde::Serialize;
use serde_json::Value;
use std::io::Write;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Mutex;
use std::time::Duration;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, RunEvent, State, WebviewUrl,
    WebviewWindowBuilder,
};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt};

// ---------------------------------------------------------------------------
// État global
// ---------------------------------------------------------------------------

struct Wall {
    label: String,
    hwnd: isize,
    parent: isize,
}

#[derive(Default)]
struct AppState {
    walls: Mutex<Vec<Wall>>,
    paused: AtomicBool,
    generation: AtomicU32,
    monitor_sig: Mutex<String>,
}

struct Http(reqwest::Client);

// ---------------------------------------------------------------------------
// Journal (utile pour diagnostiquer l'intégration au bureau sur une machine donnée)
// ---------------------------------------------------------------------------

fn log_path(app: &AppHandle) -> Option<std::path::PathBuf> {
    app.path().app_log_dir().ok().map(|d| d.join("dynamic-background.log"))
}

fn log(app: &AppHandle, msg: impl AsRef<str>) {
    let msg = msg.as_ref();
    eprintln!("{msg}");
    if let Some(p) = log_path(app) {
        let _ = std::fs::create_dir_all(p.parent().unwrap());
        // Rotation minimale : on repart de zéro au-delà de 256 Ko.
        if std::fs::metadata(&p).map(|m| m.len() > 256 * 1024).unwrap_or(false) {
            let _ = std::fs::remove_file(&p);
        }
        if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&p) {
            let ts = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_secs())
                .unwrap_or(0);
            let _ = writeln!(f, "[{ts}] {msg}");
        }
    }
}

// ---------------------------------------------------------------------------
// Fenêtres de fond d'écran
// ---------------------------------------------------------------------------

fn monitor_signature(app: &AppHandle) -> String {
    app.available_monitors()
        .unwrap_or_default()
        .iter()
        .map(|m| format!("{}:{}:{}x{}@{}", m.position().x, m.position().y, m.size().width, m.size().height, m.scale_factor()))
        .collect::<Vec<_>>()
        .join("|")
}

fn create_wall(app: &AppHandle, label: &str, index: usize, rect: desktop::Rect) -> Result<Wall, String> {
    let url = WebviewUrl::App(format!("wallpaper.html?screen={index}").into());
    let win = WebviewWindowBuilder::new(app, label, url)
        .title("Dynamic Background")
        .decorations(false)
        .resizable(false)
        .skip_taskbar(true)
        .focused(false)
        .visible(false)
        .shadow(false)
        .always_on_bottom(true)
        .build()
        .map_err(|e| e.to_string())?;
    let _ = win.set_position(PhysicalPosition::new(rect.x, rect.y));
    let _ = win.set_size(PhysicalSize::new(rect.w as u32, rect.h as u32));

    #[cfg(windows)]
    let hwnd = win.hwnd().map(|h| h.0 as isize).map_err(|e| e.to_string())?;
    #[cfg(not(windows))]
    let hwnd = 0isize;

    let parent = match desktop::attach(hwnd, rect) {
        Ok(p) => p,
        Err(e) => {
            log(app, format!("Attache au bureau impossible ({e}) : affichage en fenêtre de fond simple"));
            0
        }
    };
    let _ = win.show();
    if parent != 0 {
        desktop::check(hwnd, parent); // ré-ordonne après le show()
    }
    log(app, format!("{label} : écran {index} {rect:?}, parent={parent:#x}"));
    Ok(Wall { label: label.to_string(), hwnd, parent })
}

/// (Re)crée toutes les fenêtres de fond d'écran. À appeler sur le thread principal.
fn rebuild(app: &AppHandle) {
    let st = app.state::<AppState>();
    let old: Vec<Wall> = st.walls.lock().unwrap().drain(..).collect();
    for w in old {
        if let Some(win) = app.get_webview_window(&w.label) {
            let _ = win.destroy();
        }
    }
    *st.monitor_sig.lock().unwrap() = monitor_signature(app);
    if st.paused.load(Ordering::SeqCst) {
        desktop::refresh_wallpaper();
        return;
    }

    let mode = config::monitor_mode(&config::load(app));
    let monitors = app.available_monitors().unwrap_or_default();
    let primary = app.primary_monitor().ok().flatten();
    let gen = st.generation.fetch_add(1, Ordering::SeqCst) + 1;
    let mut walls = Vec::new();
    for (i, m) in monitors.iter().enumerate() {
        if mode == "primary" {
            if let Some(p) = &primary {
                if p.position() != m.position() {
                    continue;
                }
            }
        }
        let rect = desktop::Rect {
            x: m.position().x,
            y: m.position().y,
            w: m.size().width as i32,
            h: m.size().height as i32,
        };
        match create_wall(app, &format!("wallpaper-{gen}-{i}"), i, rect) {
            Ok(w) => walls.push(w),
            Err(e) => log(app, format!("Création de la fenêtre écran {i} impossible : {e}")),
        }
    }
    *st.walls.lock().unwrap() = walls;
}

fn schedule_rebuild(app: &AppHandle) {
    let a = app.clone();
    let _ = app.run_on_main_thread(move || rebuild(&a));
}

/// Surveille les changements d'écrans et les redémarrages d'Explorer.
fn spawn_watchdog(app: AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(3));
        let st = app.state::<AppState>();
        if st.paused.load(Ordering::SeqCst) {
            continue;
        }
        let sig_changed = *st.monitor_sig.lock().unwrap() != monitor_signature(&app);
        let broken = {
            let walls = st.walls.lock().unwrap();
            walls.iter().any(|w| {
                app.get_webview_window(&w.label).is_none()
                    || (w.parent != 0 && !desktop::check(w.hwnd, w.parent))
            })
        };
        if sig_changed || broken {
            log(&app, format!("Reconstruction des fonds (écrans modifiés={sig_changed}, fenêtre perdue={broken})"));
            schedule_rebuild(&app);
        }
    });
}

// ---------------------------------------------------------------------------
// Éditeur
// ---------------------------------------------------------------------------

fn open_editor(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("editor") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
        return;
    }
    let res = WebviewWindowBuilder::new(app, "editor", WebviewUrl::App("index.html".into()))
        .title("Dynamic Background — Éditeur")
        .inner_size(1440.0, 900.0)
        .min_inner_size(1100.0, 700.0)
        .center()
        // Sinon WebView2 intercepte le glisser-déposer HTML (palette → aperçu).
        .disable_drag_drop_handler()
        .build();
    if let Err(e) = res {
        log(app, format!("Ouverture de l'éditeur impossible : {e}"));
    }
}

// ---------------------------------------------------------------------------
// Commandes appelées depuis l'interface
// ---------------------------------------------------------------------------

#[tauri::command]
fn get_config(app: AppHandle) -> Option<Value> {
    config::load(&app)
}

#[tauri::command]
async fn save_config(app: AppHandle, config: Value) -> Result<(), String> {
    let before = config::monitor_mode(&config::load(&app));
    config::store(&app, &config)?;
    app.emit("config-changed", &config).map_err(|e| e.to_string())?;
    if before != config::monitor_mode(&Some(config)) {
        schedule_rebuild(&app);
    }
    Ok(())
}

#[derive(Serialize)]
struct MonitorInfo {
    name: String,
    width: u32,
    height: u32,
    scale: f64,
    primary: bool,
}

#[tauri::command]
fn get_monitors(app: AppHandle) -> Vec<MonitorInfo> {
    let primary = app.primary_monitor().ok().flatten().map(|p| *p.position());
    app.available_monitors()
        .unwrap_or_default()
        .iter()
        .map(|m| MonitorInfo {
            name: m.name().cloned().unwrap_or_default(),
            width: m.size().width,
            height: m.size().height,
            scale: m.scale_factor(),
            primary: Some(*m.position()) == primary,
        })
        .collect()
}

#[tauri::command]
fn list_images(app: AppHandle, folder: String, recursive: bool) -> Result<Vec<String>, String> {
    app.asset_protocol_scope()
        .allow_directory(&folder, recursive)
        .map_err(|e| e.to_string())?;
    Ok(images::list(&folder, recursive))
}

#[tauri::command]
fn allow_file(app: AppHandle, path: String) -> Result<(), String> {
    app.asset_protocol_scope().allow_file(&path).map_err(|e| e.to_string())
}

#[tauri::command]
async fn fetch_feeds(http: State<'_, Http>, urls: Vec<String>, limit: usize) -> Result<feeds::FeedResult, String> {
    Ok(feeds::fetch_all(&http.0, urls, limit).await)
}

#[tauri::command]
fn system_info(state: State<'_, sysmon::SysState>) -> sysmon::SysInfo {
    state.0.lock().unwrap().snapshot()
}

#[tauri::command]
fn export_config(path: String, config: Value) -> Result<(), String> {
    let data = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    std::fs::write(path, data).map_err(|e| e.to_string())
}

#[tauri::command]
fn import_config(path: String) -> Result<Value, String> {
    let raw = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    serde_json::from_str(&raw).map_err(|e| format!("Fichier invalide : {e}"))
}

#[tauri::command]
async fn reload_wallpapers(app: AppHandle) {
    schedule_rebuild(&app);
}

#[tauri::command]
fn read_log(app: AppHandle) -> String {
    let raw = log_path(&app).and_then(|p| std::fs::read_to_string(p).ok()).unwrap_or_default();
    let lines: Vec<&str> = raw.lines().collect();
    lines[lines.len().saturating_sub(60)..].join("\n")
}

// ---------------------------------------------------------------------------
// Zone de notification
// ---------------------------------------------------------------------------

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let editor = MenuItem::with_id(app, "editor", "Ouvrir l'éditeur", true, None::<&str>)?;
    let pause = CheckMenuItem::with_id(app, "pause", "Mettre en pause", true, false, None::<&str>)?;
    let reload = MenuItem::with_id(app, "reload", "Recharger le fond d'écran", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quitter", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&editor, &pause, &reload, &sep, &quit])?;

    let pause_item = pause.clone();
    TrayIconBuilder::with_id("main")
        .icon(app.default_window_icon().cloned().expect("icône"))
        .tooltip("Dynamic Background")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(move |app, event| match event.id.as_ref() {
            "editor" => open_editor(app),
            "pause" => {
                let paused = pause_item.is_checked().unwrap_or(false);
                app.state::<AppState>().paused.store(paused, Ordering::SeqCst);
                rebuild(app);
            }
            "reload" => rebuild(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                open_editor(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Point d'entrée
// ---------------------------------------------------------------------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        // Doit être le premier plugin : une 2e instance ouvre simplement l'éditeur.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| open_editor(app)))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, Some(vec!["--autostart"])))
        .manage(AppState::default())
        .manage(sysmon::SysState::new())
        .manage(Http(feeds::client()))
        .invoke_handler(tauri::generate_handler![
            get_config,
            save_config,
            get_monitors,
            list_images,
            allow_file,
            fetch_feeds,
            system_info,
            export_config,
            import_config,
            reload_wallpapers,
            read_log,
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            let first_run = !config::exists(&handle);
            log(&handle, format!("Démarrage v{} (premier lancement : {first_run})", app.package_info().version));
            if first_run {
                // Lancement automatique avec Windows activé par défaut (désactivable dans l'éditeur).
                if let Err(e) = handle.autolaunch().enable() {
                    log(&handle, format!("Activation du démarrage automatique impossible : {e}"));
                }
            }
            build_tray(&handle)?;
            rebuild(&handle);
            spawn_watchdog(handle.clone());
            let autostarted = std::env::args().any(|a| a == "--autostart");
            if !autostarted {
                open_editor(&handle);
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("erreur au démarrage de l'application");

    app.run(|app, event| match event {
        // Fermer l'éditeur ne quitte pas l'application (elle vit dans la zone de notification).
        RunEvent::ExitRequested { api, code, .. } if code.is_none() => api.prevent_exit(),
        RunEvent::Exit => {
            let st = app.state::<AppState>();
            for w in st.walls.lock().unwrap().drain(..) {
                if let Some(win) = app.get_webview_window(&w.label) {
                    let _ = win.destroy();
                }
            }
            desktop::refresh_wallpaper();
        }
        _ => {}
    });
}
