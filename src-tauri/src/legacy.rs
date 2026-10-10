//! Reprise des données de l'ancienne version, nommée « Dynamic Background » (≤ v0.4).

use tauri::{AppHandle, Manager};

const OLD_IDENTIFIER: &str = "com.mathgen44.dynamicbackground";
const OLD_NAMES: &[&str] = &["Dynamic Background", "dynamic-background"];

/// Copie l'ancienne configuration si la nouvelle n'existe pas encore et retire l'ancienne
/// entrée de démarrage automatique. Retourne `true` si celle-ci était active.
pub fn migrate(app: &AppHandle) -> bool {
    let new = crate::config::config_path(app);
    if !new.exists() {
        if let Ok(dir) = app.path().config_dir() {
            let old = dir.join(OLD_IDENTIFIER).join("layout.json");
            if old.exists() {
                if let Some(parent) = new.parent() {
                    let _ = std::fs::create_dir_all(parent);
                }
                match std::fs::copy(&old, &new) {
                    Ok(_) => crate::log(app, "Configuration de « Dynamic Background » reprise"),
                    Err(e) => crate::log(app, format!("Reprise de l'ancienne configuration impossible : {e}")),
                }
            }
        }
    }
    // Toutes les entrées sont supprimées (pas de court-circuit).
    OLD_NAMES.iter().map(|n| remove_run_value(n)).collect::<Vec<_>>().contains(&true)
}

#[cfg(windows)]
fn remove_run_value(name: &str) -> bool {
    use windows::core::{w, HSTRING};
    use windows::Win32::System::Registry::*;
    unsafe {
        let key = w!("Software\\Microsoft\\Windows\\CurrentVersion\\Run");
        let value = HSTRING::from(name);
        let mut size = 0u32;
        let exists = RegGetValueW(HKEY_CURRENT_USER, key, &value, RRF_RT_REG_SZ, None, None, Some(&mut size)).is_ok();
        if exists {
            let _ = RegDeleteKeyValueW(HKEY_CURRENT_USER, key, &value);
        }
        exists
    }
}

#[cfg(not(windows))]
fn remove_run_value(_name: &str) -> bool {
    false
}
