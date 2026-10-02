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

/// Un fond doit-il être affiché sur l'écran `name` ?
/// * `screens[name] == "none"` : non (le papier peint Windows reste visible) ;
/// * écran absent de `screens` : oui, sauf ancien réglage « écran principal uniquement ».
pub fn screen_enabled(cfg: &Option<Value>, name: &str, primary: bool) -> bool {
    let Some(c) = cfg.as_ref() else { return true };
    if let Some(v) = c.get("screens").and_then(|s| s.get(name)) {
        return v.as_str() != Some("none");
    }
    let legacy = c.pointer("/settings/monitors").and_then(|v| v.as_str());
    primary || legacy != Some("primary")
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn screens() {
        assert!(screen_enabled(&None, "A", false));
        let c = Some(json!({ "screens": { "A": "none", "B": "l2" } }));
        assert!(!screen_enabled(&c, "A", true));
        assert!(screen_enabled(&c, "B", false));
        assert!(screen_enabled(&c, "C", false));
        let legacy = Some(json!({ "settings": { "monitors": "primary" } }));
        assert!(screen_enabled(&legacy, "X", true));
        assert!(!screen_enabled(&legacy, "Y", false));
    }
}
