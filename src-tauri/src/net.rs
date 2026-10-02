//! Requêtes HTTP pour les briques (météo, géolocalisation, températures, agenda).
//!
//! Les fenêtres n'ont pas accès au réseau (CSP) : elles passent par ces commandes.
//! Un cache partagé évite que plusieurs écrans / briques interrogent le même service.

use serde_json::Value;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// Services JSON autorisés (en plus de localhost, pour LibreHardwareMonitor).
const JSON_HOSTS: &[&str] = &[
    "api.open-meteo.com",
    "geocoding-api.open-meteo.com",
    "ipwho.is",
    "get.geojs.io",
];

#[derive(Default)]
pub struct NetCache(Mutex<HashMap<String, (Instant, String)>>);

impl NetCache {
    fn get(&self, key: &str, ttl: Duration) -> Option<String> {
        let map = self.0.lock().unwrap();
        map.get(key).filter(|(t, _)| t.elapsed() < ttl).map(|(_, v)| v.clone())
    }
    fn put(&self, key: String, value: String) {
        let mut map = self.0.lock().unwrap();
        if map.len() > 200 {
            map.retain(|_, (t, _)| t.elapsed() < Duration::from_secs(3600));
        }
        map.insert(key, (Instant::now(), value));
    }
}

pub fn is_local(url: &reqwest::Url) -> bool {
    matches!(url.host_str(), Some("localhost") | Some("127.0.0.1") | Some("[::1]"))
}

pub fn json_allowed(url: &reqwest::Url) -> bool {
    match url.scheme() {
        "https" => url.host_str().is_some_and(|h| JSON_HOSTS.contains(&h)),
        "http" => is_local(url),
        _ => false,
    }
}

/// Télécharge un texte (avec cache de `ttl`).
pub async fn get_text(client: &reqwest::Client, cache: &NetCache, url: &str, ttl: Duration) -> Result<String, String> {
    if let Some(v) = cache.get(url, ttl) {
        return Ok(v);
    }
    let resp = client.get(url).send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    let text = resp.text().await.map_err(|e| e.to_string())?;
    cache.put(url.to_string(), text.clone());
    Ok(text)
}

/// Télécharge un JSON depuis un service autorisé.
pub async fn get_json(client: &reqwest::Client, cache: &NetCache, url: &str, ttl: Duration) -> Result<Value, String> {
    let parsed = reqwest::Url::parse(url).map_err(|e| e.to_string())?;
    if !json_allowed(&parsed) {
        return Err(format!("Service non autorisé : {}", parsed.host_str().unwrap_or("?")));
    }
    let text = get_text(client, cache, url, ttl).await?;
    serde_json::from_str(&text).map_err(|e| format!("Réponse invalide : {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn allowlist() {
        let ok = |u: &str| json_allowed(&reqwest::Url::parse(u).unwrap());
        assert!(ok("https://api.open-meteo.com/v1/forecast?x=1"));
        assert!(ok("http://localhost:8085/data.json"));
        assert!(!ok("http://api.open-meteo.com/v1/forecast"));
        assert!(!ok("https://example.com/a.json"));
        assert!(!ok("file:///c:/x"));
    }
}
