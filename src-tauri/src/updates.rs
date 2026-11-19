//! Recherche de mise à jour : compare la version de l'application à la dernière release
//! publiée sur GitHub (les brouillons et préversions sont ignorés par l'API).
//! Rien n'est téléchargé : l'utilisateur est simplement invité à ouvrir la page de la release.

use serde::Serialize;
use serde_json::Value;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

const LATEST: &str = "https://api.github.com/repos/mathgen44/magic-wallpaper/releases/latest";
pub const RELEASES: &str = "https://github.com/mathgen44/magic-wallpaper/releases/latest";
const FIRST_DELAY: Duration = Duration::from_secs(20);
const INTERVAL: Duration = Duration::from_secs(12 * 3600);

#[derive(Serialize, Clone)]
pub struct Release {
    pub version: String,
    pub url: String,
    pub name: String,
}

#[derive(Serialize, Clone, Default)]
pub struct UpdateStatus {
    pub current: String,
    /// Dernière release, si elle est plus récente que la version installée.
    pub available: Option<Release>,
    /// Date (ms) de la dernière vérification réussie.
    pub checked_ms: i64,
    pub error: Option<String>,
}

#[derive(Default)]
pub struct UpdateState(pub Mutex<UpdateStatus>);

/// "v0.10.1" > "0.9.3" : comparaison numérique composant par composant.
fn parse(v: &str) -> Vec<u64> {
    v.trim()
        .trim_start_matches(['v', 'V'])
        .split(['-', '+'])
        .next()
        .unwrap_or("")
        .split('.')
        .map(|p| p.parse().unwrap_or(0))
        .collect()
}

pub fn is_newer(latest: &str, current: &str) -> bool {
    let (mut a, mut b) = (parse(latest), parse(current));
    let n = a.len().max(b.len());
    a.resize(n, 0);
    b.resize(n, 0);
    a > b
}

async fn fetch(client: &reqwest::Client) -> Result<Option<Release>, String> {
    let res = client
        .get(LATEST)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if res.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(None); // aucune release publiée
    }
    if !res.status().is_success() {
        return Err(format!("GitHub a répondu {}", res.status()));
    }
    let body = res.text().await.map_err(|e| e.to_string())?;
    let v: Value = serde_json::from_str(&body).map_err(|e| e.to_string())?;
    let tag = v["tag_name"].as_str().unwrap_or_default().to_string();
    if tag.is_empty() {
        return Ok(None);
    }
    Ok(Some(Release {
        version: tag.trim_start_matches(['v', 'V']).to_string(),
        url: v["html_url"].as_str().unwrap_or(RELEASES).to_string(),
        name: v["name"].as_str().unwrap_or_default().to_string(),
    }))
}

/// Vérifie maintenant, met à jour l'état et prévient l'interface et la zone de notification.
pub async fn check(app: &AppHandle, client: &reqwest::Client) -> UpdateStatus {
    let current = app.package_info().version.to_string();
    let result = fetch(client).await;
    let status = {
        let st = app.state::<UpdateState>();
        let mut s = st.0.lock().unwrap();
        s.current = current.clone();
        match result {
            Ok(rel) => {
                s.available = rel.filter(|r| is_newer(&r.version, &current));
                s.checked_ms = now_ms();
                s.error = None;
            }
            Err(e) => s.error = Some(e),
        }
        s.clone()
    };
    if let Some(rel) = &status.available {
        crate::log(app, format!("Mise à jour disponible : v{} (installée : v{current})", rel.version));
        crate::show_update_in_tray(app, rel);
        let _ = app.emit("update-available", status.clone());
    } else if let Some(e) = &status.error {
        crate::log(app, format!("Recherche de mise à jour impossible : {e}"));
    }
    status
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

/// Réglage « Rechercher les mises à jour » (activé par défaut).
pub fn enabled(app: &AppHandle) -> bool {
    crate::config::load(app)
        .and_then(|c| c.pointer("/settings/checkUpdates").and_then(Value::as_bool))
        .unwrap_or(true)
}

/// Vérification peu après le démarrage, puis toutes les 12 h.
pub fn spawn(app: AppHandle, client: reqwest::Client) {
    tauri::async_runtime::spawn(async move {
        tokio_sleep(FIRST_DELAY).await;
        loop {
            if enabled(&app) {
                check(&app, &client).await;
            }
            tokio_sleep(INTERVAL).await;
        }
    });
}

async fn tokio_sleep(d: Duration) {
    // Pas de dépendance directe à tokio : attente dans un thread du pool bloquant.
    let _ = tauri::async_runtime::spawn_blocking(move || std::thread::sleep(d)).await;
}

#[cfg(test)]
mod tests {
    use super::is_newer;

    #[test]
    fn versions() {
        assert!(is_newer("v0.6.0", "0.5.2"));
        assert!(is_newer("0.10.0", "0.9.9"));
        assert!(is_newer("1.0", "0.99.1"));
        assert!(!is_newer("v0.5.2", "0.5.2"));
        assert!(!is_newer("0.5.1", "0.5.2"));
        assert!(!is_newer("0.5.2-beta", "0.5.2"));
    }
}
