//! Heure du dernier allumage du PC, pour un « temps de fonctionnement » juste.
//!
//! Avec le démarrage rapide de Windows (activé par défaut), « Arrêter » met le noyau en veille
//! prolongée : le compteur d'uptime du noyau (GetTickCount64, celui du Gestionnaire des tâches)
//! continue alors sur plusieurs jours alors que le PC a été éteint et rallumé.
//! On lit donc dans le journal Système le dernier événement 27 de Kernel-Boot, écrit à chaque
//! démarrage : complet (0x0), rapide (0x1) ou sortie de veille prolongée (0x2).

use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

/// Relecture du journal au plus toutes les 5 min (sortie de veille prolongée pendant que l'appli tourne).
const REFRESH: Duration = Duration::from_secs(300);

static CACHE: Mutex<Option<(Instant, Option<i64>)>> = Mutex::new(None);

fn now_secs() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

/// Extrait `SystemTime='2026-11-20T09:35:32.1234567Z'` d'un événement rendu en XML.
pub fn time_created(xml: &str) -> Option<i64> {
    let i = xml.find("SystemTime=")? + "SystemTime=".len();
    let quote = xml[i..].chars().next()?;
    let rest = &xml[i + 1..];
    let value = &rest[..rest.find(quote)?];
    chrono::DateTime::parse_from_rfc3339(value).ok().map(|d| d.timestamp())
}

#[cfg(windows)]
fn read_last_boot_event() -> Option<i64> {
    use windows::core::w;
    use windows::Win32::System::EventLog::*;
    unsafe {
        let query = EvtQuery(
            None,
            w!("System"),
            w!("*[System[Provider[@Name='Microsoft-Windows-Kernel-Boot'] and EventID=27]]"),
            EvtQueryChannelPath.0 | EvtQueryReverseDirection.0,
        )
        .ok()?;
        let mut events = [0isize; 1];
        let mut returned = 0u32;
        let found = EvtNext(query, &mut events, 2000, 0, &mut returned).is_ok() && returned == 1;
        let mut result = None;
        if found {
            let event = EVT_HANDLE(events[0]);
            let mut used = 0u32;
            let mut count = 0u32;
            // 1er appel : taille nécessaire.
            let _ = EvtRender(None, event, EvtRenderEventXml.0, 0, None, &mut used, &mut count);
            if used > 0 {
                let mut buf = vec![0u16; (used as usize).div_ceil(2)];
                if EvtRender(None, event, EvtRenderEventXml.0, used, Some(buf.as_mut_ptr().cast()), &mut used, &mut count).is_ok() {
                    let n = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
                    result = time_created(&String::from_utf16_lossy(&buf[..n]));
                }
            }
            let _ = EvtClose(event);
        }
        let _ = EvtClose(query);
        result
    }
}

#[cfg(not(windows))]
fn read_last_boot_event() -> Option<i64> {
    None
}

/// Secondes écoulées depuis le dernier allumage (repli : uptime du noyau).
pub fn uptime(kernel_uptime: u64) -> u64 {
    let power_on = {
        let mut c = CACHE.lock().unwrap();
        match *c {
            Some((t, v)) if t.elapsed() < REFRESH => v,
            _ => {
                let v = read_last_boot_event();
                *c = Some((Instant::now(), v));
                v
            }
        }
    };
    let now = now_secs();
    match power_on {
        // L'événement doit être postérieur au démarrage du noyau et dans le passé.
        Some(t) if t <= now && now - t <= kernel_uptime as i64 + 120 => (now - t) as u64,
        _ => kernel_uptime,
    }
}

#[cfg(test)]
mod tests {
    use super::time_created;

    #[test]
    fn parse_xml_time() {
        let xml = "<Event><System><TimeCreated SystemTime='2026-11-20T09:35:32.1234567Z'/></System></Event>";
        assert_eq!(time_created(xml), Some(1795167332));
        let xml2 = r#"<TimeCreated SystemTime="2026-11-20T09:35:32.000Z"/>"#;
        assert_eq!(time_created(xml2), Some(1795167332));
        assert_eq!(time_created("<Event/>"), None);
    }

    /// `cargo test --lib boottime -- --ignored --nocapture` : valeur lue sur ce PC.
    #[test]
    #[ignore]
    fn on_this_pc() {
        let k = sysinfo::System::uptime();
        let u = super::uptime(k);
        println!("noyau : {} h {} min — depuis l'allumage : {} h {} min", k / 3600, k % 3600 / 60, u / 3600, u % 3600 / 60);
    }
}
