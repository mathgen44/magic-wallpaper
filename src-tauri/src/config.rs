//! Lecture / écriture de la configuration (disposition des briques, thème, réglages).
//! Le fichier est un JSON libre : son schéma est défini côté interface (src/model.js).

use serde_json::Value;
use std::{fs, path::PathBuf};
use tauri::{AppHandle, Manager};

pub fn config_path(app: &AppHandle) -> PathBuf {
    app.path()
        .app_config_dir()
        .unwrap_or_else(|_| std::env::temp_dir().join("dynamic-background"))
        .join("layout.json")
}

pub fn exists(app: &AppHandle) -> bool {
    config_path(app).exists()
}

pub fn load(app: &AppHandle) -> Option<Value> {
    let raw = fs::read_to_string(config_path(app)).ok()?;
    serde_json::from_str(&raw).ok()
}

/// Écriture atomique : fichier temporaire puis renommage.
pub fn store(app: &AppHandle, value: &Value) -> Result<(), String> {
    let path = config_path(app);
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let tmp = path.with_extension("json.tmp");
    let data = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    fs::write(&tmp, data).map_err(|e| e.to_string())?;
    fs::rename(&tmp, &path).map_err(|e| e.to_string())
}

/// Mode d'affichage multi-écrans : "all" (défaut) ou "primary".
pub fn monitor_mode(cfg: &Option<Value>) -> String {
    cfg.as_ref()
        .and_then(|c| c.pointer("/settings/monitors"))
        .and_then(|v| v.as_str())
        .unwrap_or("all")
        .to_string()
}
