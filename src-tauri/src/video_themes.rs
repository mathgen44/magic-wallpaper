//! Thèmes vidéo : un dossier par thème, contenant une vidéo (jouée en permanence)
//! ou plusieurs vidéos nommées d'après le moment de la journée (aube, jour, coucher, nuit).
//!
//! Deux emplacements :
//! * `Vidéos\Magic Wallpaper\<thème>` — thèmes de l'utilisateur (dossier créé au besoin) ;
//! * `<ressources de l'application>\video-themes\<thème>` — thèmes fournis avec l'installeur.
//!
//! Un thème de l'utilisateur masque un thème fourni du même nom.

use serde::Serialize;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Serialize, Clone)]
pub struct VideoTheme {
    pub name: String,
    pub path: String,
    pub videos: Vec<String>,
    pub bundled: bool,
}

#[derive(Serialize)]
pub struct VideoThemes {
    /// Dossier des thèmes de l'utilisateur.
    pub root: String,
    pub themes: Vec<VideoTheme>,
}

/// Dossier des thèmes de l'utilisateur (créé s'il n'existe pas).
pub fn user_root(app: &AppHandle) -> Option<PathBuf> {
    let base = app
        .path()
        .video_dir()
        .ok()
        .or_else(|| app.path().app_data_dir().ok())?;
    let dir = base.join("Magic Wallpaper");
    let _ = std::fs::create_dir_all(&dir);
    Some(dir)
}

fn bundled_root(app: &AppHandle) -> Option<PathBuf> {
    let dir = app.path().resource_dir().ok()?.join("video-themes");
    dir.is_dir().then_some(dir)
}

fn scan(root: &PathBuf, bundled: bool, out: &mut Vec<VideoTheme>) {
    let Ok(entries) = std::fs::read_dir(root) else { return };
    for e in entries.flatten() {
        let path = e.path();
        if !path.is_dir() {
            continue;
        }
        let p = path.to_string_lossy().to_string();
        let videos = crate::images::list_videos(&p);
        if videos.is_empty() {
            continue;
        }
        let name = e.file_name().to_string_lossy().to_string();
        if out.iter().any(|t| t.name.eq_ignore_ascii_case(&name)) {
            continue;
        }
        out.push(VideoTheme { name, path: p, videos, bundled });
    }
}

pub fn list(app: &AppHandle) -> VideoThemes {
    let mut themes = Vec::new();
    let user = user_root(app);
    if let Some(dir) = &user {
        scan(dir, false, &mut themes);
    }
    if let Some(dir) = bundled_root(app) {
        scan(&dir, true, &mut themes);
    }
    themes.sort_by_key(|t| t.name.to_lowercase());
    let scope = app.asset_protocol_scope();
    for t in &themes {
        let _ = scope.allow_directory(&t.path, false);
    }
    VideoThemes {
        root: user.map(|d| d.to_string_lossy().to_string()).unwrap_or_default(),
        themes,
    }
}
