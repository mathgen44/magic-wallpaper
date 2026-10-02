//! Cartes graphiques : utilisation, mémoire vidéo, température (Windows).
//!
//! * Liste des cartes et VRAM totale : DXGI.
//! * Utilisation et VRAM utilisée : compteurs de performance « GPU Engine » et
//!   « GPU Adapter Memory » (ceux du Gestionnaire des tâches) — tous fabricants.
//! * Température et ventilateur : D3DKMT (WDDM 2.4+), quand le pilote les fournit.

use serde::Serialize;

#[derive(Serialize, Clone, Debug, Default)]
pub struct GpuInfo {
    pub name: String,
    /// Utilisation en % (moteur le plus chargé, comme le Gestionnaire des tâches).
    pub usage: Option<f32>,
    pub vram_used: Option<u64>,
    pub vram_total: u64,
    /// °C
    pub temp: Option<f32>,
    pub fan_rpm: Option<u32>,
}

/// Clé « 0xHHHHHHHH_0xLLLLLLLL » extraite d'un nom d'instance PDH (`..._luid_0x…_0x…_phys_0…`).
#[cfg_attr(not(windows), allow(dead_code))]
pub fn luid_key(instance: &str) -> Option<String> {
    let i = instance.find("luid_")? + 5;
    let rest = &instance[i..];
    let mut parts = rest.splitn(3, '_');
    let hi = parts.next()?;
    let lo = parts.next()?;
    if !hi.starts_with("0x") || !lo.starts_with("0x") {
        return None;
    }
    Some(format!("{}_{}", hi, lo).to_uppercase())
}

/// Type de moteur (« 3D », « VideoDecode »…) d'une instance « GPU Engine ».
#[cfg_attr(not(windows), allow(dead_code))]
pub fn engine_type(instance: &str) -> &str {
    instance.rsplit_once("engtype_").map(|(_, t)| t).unwrap_or("")
}

#[cfg(windows)]
mod imp {
    use super::*;
    use std::collections::HashMap;
    use windows::core::w;
    use windows::Wdk::Graphics::Direct3D::*;
    use windows::Win32::Foundation::LUID;
    use windows::Win32::Graphics::Dxgi::*;
    use windows::Win32::System::Performance::*;

    struct Adapter {
        name: String,
        luid: LUID,
        key: String,
        vram_total: u64,
    }

    struct Pdh {
        query: PDH_HQUERY,
        engine: PDH_HCOUNTER,
        memory: PDH_HCOUNTER,
    }
    // Les handles PDH ne sont utilisés que sous le verrou de SysState.
    unsafe impl Send for Pdh {}

    pub struct GpuMonitor {
        adapters: Vec<Adapter>,
        pdh: Option<Pdh>,
    }

    fn list_adapters() -> Vec<Adapter> {
        let mut out = Vec::new();
        unsafe {
            let Ok(factory) = CreateDXGIFactory1::<IDXGIFactory1>() else { return out };
            let mut i = 0;
            while let Ok(a) = factory.EnumAdapters1(i) {
                i += 1;
                let Ok(d) = a.GetDesc1() else { continue };
                if d.Flags & (DXGI_ADAPTER_FLAG_SOFTWARE.0 as u32) != 0 {
                    continue;
                }
                let len = d.Description.iter().position(|&c| c == 0).unwrap_or(d.Description.len());
                let name = String::from_utf16_lossy(&d.Description[..len]).trim().to_string();
                let key = format!("0x{:08X}_0x{:08X}", d.AdapterLuid.HighPart as u32, d.AdapterLuid.LowPart).to_uppercase();
                // Un même GPU peut apparaître plusieurs fois (une entrée par sortie) : dédoublonnage.
                if out.iter().any(|x: &Adapter| x.key == key) {
                    continue;
                }
                out.push(Adapter { name, luid: d.AdapterLuid, key, vram_total: d.DedicatedVideoMemory as u64 });
            }
        }
        out
    }

    fn open_pdh() -> Option<Pdh> {
        unsafe {
            let mut query = PDH_HQUERY::default();
            if PdhOpenQueryW(None, 0, &mut query) != 0 {
                return None;
            }
            let mut engine = PDH_HCOUNTER::default();
            let mut memory = PDH_HCOUNTER::default();
            let a = PdhAddEnglishCounterW(query, w!("\\GPU Engine(*)\\Utilization Percentage"), 0, &mut engine);
            let b = PdhAddEnglishCounterW(query, w!("\\GPU Adapter Memory(*)\\Dedicated Usage"), 0, &mut memory);
            if a != 0 && b != 0 {
                let _ = PdhCloseQuery(query);
                return None;
            }
            let _ = PdhCollectQueryData(query);
            Some(Pdh { query, engine, memory })
        }
    }

    /// Valeurs (instance, valeur) d'un compteur à instances multiples.
    unsafe fn read_array(counter: PDH_HCOUNTER) -> Vec<(String, f64)> {
        let mut size = 0u32;
        let mut count = 0u32;
        let _ = PdhGetFormattedCounterArrayW(counter, PDH_FMT_DOUBLE, &mut size, &mut count, None);
        if size == 0 {
            return Vec::new();
        }
        // Tampon aligné sur 8 octets (les éléments contiennent des f64).
        let mut buf = vec![0u64; (size as usize).div_ceil(8)];
        let items = buf.as_mut_ptr() as *mut PDH_FMT_COUNTERVALUE_ITEM_W;
        if PdhGetFormattedCounterArrayW(counter, PDH_FMT_DOUBLE, &mut size, &mut count, Some(items)) != 0 {
            return Vec::new();
        }
        let slice = std::slice::from_raw_parts(items, count as usize);
        slice
            .iter()
            .filter(|it| it.FmtValue.CStatus <= 1) // PDH_CSTATUS_VALID_DATA / NEW_DATA
            .map(|it| (it.szName.to_string().unwrap_or_default(), it.FmtValue.Anonymous.doubleValue))
            .collect()
    }

    fn perf_data(luid: LUID) -> Option<D3DKMT_ADAPTER_PERFDATA> {
        unsafe {
            let mut open = D3DKMT_OPENADAPTERFROMLUID { AdapterLuid: luid, hAdapter: 0 };
            if D3DKMTOpenAdapterFromLuid(&mut open).is_err() {
                return None;
            }
            let mut data = D3DKMT_ADAPTER_PERFDATA::default();
            let mut q = D3DKMT_QUERYADAPTERINFO {
                hAdapter: open.hAdapter,
                Type: KMTQAITYPE_ADAPTERPERFDATA,
                pPrivateDriverData: &mut data as *mut _ as *mut core::ffi::c_void,
                PrivateDriverDataSize: std::mem::size_of::<D3DKMT_ADAPTER_PERFDATA>() as u32,
            };
            let ok = D3DKMTQueryAdapterInfo(&mut q).is_ok();
            let _ = D3DKMTCloseAdapter(&D3DKMT_CLOSEADAPTER { hAdapter: open.hAdapter });
            ok.then_some(data)
        }
    }

    impl GpuMonitor {
        pub fn new() -> Self {
            GpuMonitor { adapters: list_adapters(), pdh: open_pdh() }
        }

        pub fn sample(&mut self) -> Vec<GpuInfo> {
            let mut usage: HashMap<String, HashMap<String, f64>> = HashMap::new();
            let mut mem: HashMap<String, f64> = HashMap::new();
            if let Some(p) = &self.pdh {
                unsafe {
                    let _ = PdhCollectQueryData(p.query);
                    for (inst, v) in read_array(p.engine) {
                        if let Some(k) = luid_key(&inst) {
                            *usage.entry(k).or_default().entry(engine_type(&inst).to_string()).or_default() += v;
                        }
                    }
                    for (inst, v) in read_array(p.memory) {
                        if let Some(k) = luid_key(&inst) {
                            *mem.entry(k).or_default() += v;
                        }
                    }
                }
            }
            self.adapters
                .iter()
                .map(|a| {
                    let perf = perf_data(a.luid);
                    GpuInfo {
                        name: a.name.clone(),
                        usage: usage
                            .get(&a.key)
                            .map(|m| m.values().cloned().fold(0.0, f64::max).min(100.0) as f32),
                        vram_used: mem.get(&a.key).map(|v| *v as u64),
                        vram_total: a.vram_total,
                        temp: perf.filter(|p| p.Temperature > 0).map(|p| p.Temperature as f32 / 10.0),
                        fan_rpm: perf.filter(|p| p.FanRPM > 0).map(|p| p.FanRPM),
                    }
                })
                .collect()
        }
    }

    impl Drop for GpuMonitor {
        fn drop(&mut self) {
            if let Some(p) = &self.pdh {
                unsafe {
                    let _ = PdhCloseQuery(p.query);
                }
            }
        }
    }
}

#[cfg(not(windows))]
mod imp {
    use super::GpuInfo;
    pub struct GpuMonitor;
    impl GpuMonitor {
        pub fn new() -> Self {
            GpuMonitor
        }
        pub fn sample(&mut self) -> Vec<GpuInfo> {
            Vec::new()
        }
    }
}

pub use imp::GpuMonitor;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn instances() {
        let e = "pid_1234_luid_0x00000000_0x0000c3f2_phys_0_eng_0_engtype_3D";
        assert_eq!(luid_key(e).as_deref(), Some("0X00000000_0X0000C3F2"));
        assert_eq!(engine_type(e), "3D");
        assert_eq!(luid_key("luid_0x00000000_0x0000C3F2_phys_0").as_deref(), Some("0X00000000_0X0000C3F2"));
        assert_eq!(luid_key("autre"), None);
    }
}
