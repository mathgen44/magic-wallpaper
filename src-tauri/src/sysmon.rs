//! Informations système façon Rainmeter (CPU, mémoire, disques, réseau, uptime).

use serde::Serialize;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use sysinfo::{Disks, Networks, System};

#[derive(Serialize, Clone)]
pub struct DiskInfo {
    pub name: String,
    pub mount: String,
    pub total: u64,
    pub used: u64,
}

#[derive(Serialize, Clone)]
pub struct SysInfo {
    pub cpu_usage: f32,
    pub cpu_cores: Vec<f32>,
    pub cpu_brand: String,
    pub cpu_freq_mhz: u64,
    pub mem_total: u64,
    pub mem_used: u64,
    pub swap_total: u64,
    pub swap_used: u64,
    pub disks: Vec<DiskInfo>,
    /// octets / seconde
    pub net_rx: u64,
    pub net_tx: u64,
    pub uptime: u64,
    pub host: String,
    pub os: String,
    pub processes: usize,
}

pub struct SysMonitor {
    sys: System,
    disks: Disks,
    nets: Networks,
    last_refresh: Instant,
    last_disk_refresh: Instant,
    cached: Option<SysInfo>,
}

pub struct SysState(pub Mutex<SysMonitor>);

impl SysState {
    pub fn new() -> Self {
        let mut sys = System::new();
        sys.refresh_cpu_all();
        sys.refresh_memory();
        SysState(Mutex::new(SysMonitor {
            sys,
            disks: Disks::new_with_refreshed_list(),
            nets: Networks::new_with_refreshed_list(),
            last_refresh: Instant::now(),
            last_disk_refresh: Instant::now(),
            cached: None,
        }))
    }
}

impl SysMonitor {
    /// Plusieurs widgets / écrans peuvent interroger en même temps :
    /// on ne rafraîchit pas plus d'une fois toutes les 700 ms.
    pub fn snapshot(&mut self) -> SysInfo {
        let elapsed = self.last_refresh.elapsed();
        if let (Some(c), true) = (&self.cached, elapsed < Duration::from_millis(700)) {
            return c.clone();
        }
        self.sys.refresh_cpu_all();
        self.sys.refresh_memory();
        self.sys.refresh_processes(sysinfo::ProcessesToUpdate::All, true);
        self.nets.refresh(true);
        if self.last_disk_refresh.elapsed() > Duration::from_secs(30) {
            self.disks.refresh(true);
            self.last_disk_refresh = Instant::now();
        }
        let secs = elapsed.as_secs_f64().max(0.001);
        let (rx, tx) = self.nets.iter().fold((0u64, 0u64), |(r, t), (_, n)| {
            (r + n.received(), t + n.transmitted())
        });
        self.last_refresh = Instant::now();

        let cpus = self.sys.cpus();
        let info = SysInfo {
            cpu_usage: self.sys.global_cpu_usage(),
            cpu_cores: cpus.iter().map(|c| c.cpu_usage()).collect(),
            cpu_brand: cpus.first().map(|c| c.brand().trim().to_string()).unwrap_or_default(),
            cpu_freq_mhz: cpus.first().map(|c| c.frequency()).unwrap_or(0),
            mem_total: self.sys.total_memory(),
            mem_used: self.sys.used_memory(),
            swap_total: self.sys.total_swap(),
            swap_used: self.sys.used_swap(),
            disks: self
                .disks
                .iter()
                .map(|d| DiskInfo {
                    name: d.name().to_string_lossy().to_string(),
                    mount: d.mount_point().to_string_lossy().to_string(),
                    total: d.total_space(),
                    used: d.total_space().saturating_sub(d.available_space()),
                })
                .collect(),
            net_rx: (rx as f64 / secs) as u64,
            net_tx: (tx as f64 / secs) as u64,
            uptime: System::uptime(),
            host: System::host_name().unwrap_or_default(),
            os: System::long_os_version().unwrap_or_default(),
            processes: self.sys.processes().len(),
        };
        self.cached = Some(info.clone());
        info
    }
}
