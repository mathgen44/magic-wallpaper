//! Températures CPU / GPU lues dans HWiNFO.
//!
//! Deux sources, essayées dans cet ordre :
//! 1. la mémoire partagée (« Shared Memory Support » dans les réglages de HWiNFO) :
//!    tous les capteurs, sans rien sélectionner ; limitée à 12 h dans la version gratuite ;
//! 2. le registre `HKCU\Software\HWiNFO64\VSB` (« Report value in Gadget » coché sur
//!    les capteurs voulus) : sans limite de durée, mais capteur par capteur.

use serde::Serialize;

/// Un relevé de température.
#[derive(Debug, Clone, PartialEq)]
pub struct Temp {
    pub sensor: String,
    pub label: String,
    pub value: f32,
}

#[derive(Serialize, Clone, Default, Debug)]
pub struct HwinfoTemps {
    pub cpu: Option<f32>,
    pub gpu: Option<f32>,
    /// "shared-memory", "gadget" ou absent si HWiNFO n'est pas lisible.
    pub source: Option<&'static str>,
    /// Libellés des capteurs de température trouvés (aide au réglage).
    pub sensors: Vec<String>,
}

const SIGNATURE: u32 = 0x5369_5748; // "HWiS"
const SENSOR_TYPE_TEMP: u32 = 1;
const HEADER_LEN: usize = 44;
// Élément « relevé » : type, index du capteur, id, libellé d'origine [128],
// libellé utilisateur [128], unité [16], valeur, min, max, moyenne (f64).
const READING_MIN_LEN: usize = 12 + 128 + 128 + 16 + 8;
// Élément « capteur » : id, instance, nom d'origine [128], nom utilisateur [128].
const SENSOR_MIN_LEN: usize = 8 + 128 + 128;

fn u32_at(b: &[u8], at: usize) -> Option<u32> {
    b.get(at..at + 4).map(|s| u32::from_le_bytes(s.try_into().unwrap()))
}

fn cstr(b: &[u8]) -> String {
    let n = b.iter().position(|&c| c == 0).unwrap_or(b.len());
    // Chaînes ANSI (Windows-1252) : le latin-1 suffit pour les libellés de capteurs.
    b[..n].iter().map(|&c| c as char).collect::<String>().trim().to_string()
}

/// Lit les températures dans une copie du bloc de mémoire partagée.
pub fn parse_shared(b: &[u8]) -> Option<Vec<Temp>> {
    if b.len() < HEADER_LEN || u32_at(b, 0)? != SIGNATURE {
        return None;
    }
    let (s_off, s_len, s_num) = (u32_at(b, 20)? as usize, u32_at(b, 24)? as usize, u32_at(b, 28)? as usize);
    let (r_off, r_len, r_num) = (u32_at(b, 32)? as usize, u32_at(b, 36)? as usize, u32_at(b, 40)? as usize);
    if s_len < SENSOR_MIN_LEN || r_len < READING_MIN_LEN {
        return None;
    }
    let name_of = |i: usize| -> String {
        let at = s_off + i * s_len;
        match b.get(at..at + SENSOR_MIN_LEN) {
            Some(e) => {
                let user = cstr(&e[136..264]);
                if user.is_empty() { cstr(&e[8..136]) } else { user }
            }
            None => String::new(),
        }
    };
    let mut out = Vec::new();
    for i in 0..r_num {
        let at = r_off + i * r_len;
        let Some(e) = b.get(at..at + READING_MIN_LEN) else { break };
        if u32_at(e, 0)? != SENSOR_TYPE_TEMP {
            continue;
        }
        let sensor_idx = u32_at(e, 4)? as usize;
        let user = cstr(&e[140..268]);
        let label = if user.is_empty() { cstr(&e[12..140]) } else { user };
        let value = f64::from_le_bytes(e[284..292].try_into().unwrap()) as f32;
        out.push(Temp { sensor: if sensor_idx < s_num { name_of(sensor_idx) } else { String::new() }, label, value });
    }
    Some(out)
}

/// Valeur brute du registre « Gadget » (« 45 », « 45.0 » ou « 45,0 »).
pub fn parse_raw(s: &str) -> Option<f32> {
    s.trim().replace(',', ".").parse::<f32>().ok()
}

fn plausible(t: &Temp) -> bool {
    t.value.is_finite() && t.value > 0.0 && t.value < 150.0
}

/// Choisit un relevé : filtre de l'utilisateur, sinon libellés connus par ordre de préférence.
fn pick(temps: &[Temp], filter: &str, prefs: &[&str], scope: &dyn Fn(&Temp) -> bool) -> Option<f32> {
    let ok: Vec<&Temp> = temps.iter().filter(|t| plausible(t)).collect();
    let f = filter.trim().to_lowercase();
    if !f.is_empty() {
        // « Capteur » ou « Capteur > Libellé ».
        let (fs, fl) = match f.split_once('>') {
            Some((s, l)) => (s.trim().to_string(), l.trim().to_string()),
            None => (String::new(), f.clone()),
        };
        return ok
            .iter()
            .find(|t| t.label.to_lowercase().contains(&fl) && t.sensor.to_lowercase().contains(&fs))
            .map(|t| t.value);
    }
    let scoped: Vec<&&Temp> = ok.iter().filter(|t| scope(t)).collect();
    for p in prefs {
        if let Some(t) = scoped.iter().find(|t| t.label.to_lowercase() == *p) {
            return Some(t.value);
        }
    }
    for p in prefs {
        if let Some(t) = scoped.iter().find(|t| t.label.to_lowercase().contains(p)) {
            return Some(t.value);
        }
    }
    None
}

pub fn cpu_temp(temps: &[Temp], filter: &str) -> Option<f32> {
    let prefs = ["cpu package", "cpu (tctl/tdie)", "cpu die (average)", "cpu (tdie)", "cpu (tctl)", "core max", "cpu"];
    pick(temps, filter, &prefs, &|t| {
        let s = t.sensor.to_lowercase();
        let l = t.label.to_lowercase();
        !s.contains("gpu") && !l.contains("gpu")
    })
}

pub fn gpu_temp(temps: &[Temp], filter: &str) -> Option<f32> {
    let prefs = ["gpu temperature", "gpu core", "gpu"];
    pick(temps, filter, &prefs, &|t| {
        let l = t.label.to_lowercase();
        (l.contains("gpu") || t.sensor.to_lowercase().contains("gpu"))
            && !["hot spot", "hotspot", "memory", "junction", "vrm", "thermal limit"].iter().any(|k| l.contains(k))
    })
}

pub fn read(cpu_filter: &str, gpu_filter: &str) -> HwinfoTemps {
    let (temps, source) = match imp::shared_memory() {
        Some(t) if !t.is_empty() => (t, "shared-memory"),
        _ => match imp::gadget() {
            Some(t) if !t.is_empty() => (t, "gadget"),
            _ => return HwinfoTemps::default(),
        },
    };
    HwinfoTemps {
        cpu: cpu_temp(&temps, cpu_filter),
        gpu: gpu_temp(&temps, gpu_filter),
        source: Some(source),
        sensors: temps
            .iter()
            .map(|t| if t.sensor.is_empty() { t.label.clone() } else { format!("{} > {}", t.sensor, t.label) })
            .collect(),
    }
}

#[cfg(windows)]
mod imp {
    use super::{parse_raw, parse_shared, Temp};
    use std::ffi::c_void;
    use windows::core::{w, HSTRING};
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Memory::*;
    use windows::Win32::System::Registry::*;

    pub fn shared_memory() -> Option<Vec<Temp>> {
        unsafe {
            let h = OpenFileMappingW(FILE_MAP_READ.0, false, w!("Global\\HWiNFO_SENS_SM2")).ok()?;
            let view = MapViewOfFile(h, FILE_MAP_READ, 0, 0, 0);
            let res = if view.Value.is_null() {
                None
            } else {
                let mut mbi = MEMORY_BASIC_INFORMATION::default();
                let n = VirtualQuery(Some(view.Value as *const c_void), &mut mbi, std::mem::size_of::<MEMORY_BASIC_INFORMATION>());
                let r = if n == 0 {
                    None
                } else {
                    // Copie locale : HWiNFO réécrit le bloc en continu.
                    let bytes = std::slice::from_raw_parts(view.Value as *const u8, mbi.RegionSize).to_vec();
                    parse_shared(&bytes)
                };
                let _ = UnmapViewOfFile(view);
                r
            };
            let _ = CloseHandle(h);
            res
        }
    }

    fn reg_str(name: &str) -> Option<String> {
        unsafe {
            let mut buf = [0u16; 256];
            let mut size = (buf.len() * 2) as u32;
            let r = RegGetValueW(
                HKEY_CURRENT_USER,
                w!("Software\\HWiNFO64\\VSB"),
                &HSTRING::from(name),
                RRF_RT_REG_SZ,
                None,
                Some(buf.as_mut_ptr() as *mut c_void),
                Some(&mut size),
            );
            if r.is_err() {
                return None;
            }
            let n = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
            Some(String::from_utf16_lossy(&buf[..n]))
        }
    }

    pub fn gadget() -> Option<Vec<Temp>> {
        let mut out = Vec::new();
        for i in 0..512 {
            let Some(label) = reg_str(&format!("Label{i}")) else { break };
            let shown = reg_str(&format!("Value{i}")).unwrap_or_default();
            if !shown.contains("°C") {
                continue;
            }
            let value = reg_str(&format!("ValueRaw{i}")).and_then(|s| parse_raw(&s)).or_else(|| parse_raw(shown.trim_end_matches("°C")));
            if let Some(value) = value {
                out.push(Temp { sensor: reg_str(&format!("Sensor{i}")).unwrap_or_default(), label, value });
            }
        }
        Some(out)
    }
}

#[cfg(not(windows))]
mod imp {
    use super::Temp;
    pub fn shared_memory() -> Option<Vec<Temp>> {
        None
    }
    pub fn gadget() -> Option<Vec<Temp>> {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn t(sensor: &str, label: &str, value: f32) -> Temp {
        Temp { sensor: sensor.into(), label: label.into(), value }
    }

    fn put(b: &mut [u8], at: usize, s: &str) {
        b[at..at + s.len()].copy_from_slice(s.as_bytes());
    }

    #[test]
    fn shared_block() {
        let (s_len, r_len) = (264usize + 256, 316usize + 128);
        let (s_off, r_off) = (HEADER_LEN, HEADER_LEN + 2 * s_len);
        let mut b = vec![0u8; r_off + 3 * r_len];
        b[0..4].copy_from_slice(&SIGNATURE.to_le_bytes());
        for (at, v) in [(20, s_off), (24, s_len), (28, 2), (32, r_off), (36, r_len), (40, 3)] {
            b[at..at + 4].copy_from_slice(&(v as u32).to_le_bytes());
        }
        put(&mut b, s_off + 8, "CPU [#0]: AMD Ryzen 7 7800X3D");
        put(&mut b, s_off + s_len + 8, "GPU [#0]: NVIDIA GeForce RTX 4070");
        let reading = |b: &mut Vec<u8>, i: usize, kind: u32, sensor: u32, label: &str, v: f64| {
            let at = r_off + i * r_len;
            b[at..at + 4].copy_from_slice(&kind.to_le_bytes());
            b[at + 4..at + 8].copy_from_slice(&sensor.to_le_bytes());
            put(b, at + 12, label);
            b[at + 284..at + 292].copy_from_slice(&v.to_le_bytes());
        };
        reading(&mut b, 0, 1, 0, "CPU (Tctl/Tdie)", 61.5);
        reading(&mut b, 1, 7, 0, "Total CPU Usage", 12.0);
        reading(&mut b, 2, 1, 1, "GPU Temperature", 48.0);
        let temps = parse_shared(&b).unwrap();
        assert_eq!(temps.len(), 2);
        assert_eq!(temps[0], t("CPU [#0]: AMD Ryzen 7 7800X3D", "CPU (Tctl/Tdie)", 61.5));
        assert_eq!(cpu_temp(&temps, ""), Some(61.5));
        assert_eq!(gpu_temp(&temps, ""), Some(48.0));
        b[0] = 0;
        assert!(parse_shared(&b).is_none());
    }

    #[test]
    fn choice() {
        let temps = vec![
            t("ASUS ROG STRIX B650", "CPU", 45.0),
            t("CPU [#0]: Intel Core i7", "Core Max", 70.0),
            t("CPU [#0]: Intel Core i7", "CPU Package", 66.0),
            t("GPU [#0]: AMD Radeon", "GPU Hot Spot", 80.0),
            t("GPU [#0]: AMD Radeon", "GPU Temperature", 55.0),
            t("S.M.A.R.T.: Samsung 990", "Drive Temperature", 38.0),
        ];
        assert_eq!(cpu_temp(&temps, ""), Some(66.0));
        assert_eq!(gpu_temp(&temps, ""), Some(55.0));
        assert_eq!(cpu_temp(&temps, "core max"), Some(70.0));
        assert_eq!(cpu_temp(&temps, "asus > cpu"), Some(45.0));
        assert_eq!(gpu_temp(&temps, "hot spot"), Some(80.0));
        assert_eq!(cpu_temp(&temps, "introuvable"), None);
        assert_eq!(parse_raw("45,5"), Some(45.5));
    }
}
