//! Média en cours de lecture (Spotify, navigateur, lecteur Windows…) via les
//! « contrôles de transport multimédia » de Windows (GlobalSystemMediaTransportControls).
//!
//! Un thread dédié (apartment WinRT multithread) interroge Windows toutes les secondes
//! tant qu'une brique le demande, puis s'arrête de lui-même.

use serde::Serialize;

#[derive(Serialize, Clone, Debug, Default)]
pub struct MediaInfo {
    pub available: bool,
    /// Identifiant de l'application (ex. « Spotify.exe »).
    pub app: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub playing: bool,
    pub position_ms: i64,
    pub duration_ms: i64,
    /// Instant (ms Unix) auquel `position_ms` était valable.
    pub updated_ms: i64,
    /// Pochette en data URL.
    pub thumbnail: Option<String>,
    pub can_prev: bool,
    pub can_next: bool,
    pub can_play_pause: bool,
}

#[cfg_attr(not(windows), allow(dead_code))]
pub fn base64(data: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    for c in data.chunks(3) {
        let n = (c[0] as u32) << 16 | (*c.get(1).unwrap_or(&0) as u32) << 8 | *c.get(2).unwrap_or(&0) as u32;
        out.push(T[(n >> 18) as usize & 63] as char);
        out.push(T[(n >> 12) as usize & 63] as char);
        out.push(if c.len() > 1 { T[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if c.len() > 2 { T[n as usize & 63] as char } else { '=' });
    }
    out
}

#[cfg(windows)]
mod imp {
    use super::{base64, MediaInfo};
    use std::sync::mpsc::{channel, RecvTimeoutError, Sender};
    use std::sync::{Arc, Mutex};
    use std::time::{Duration, Instant};
    use windows::Media::Control::*;
    use windows::Storage::Streams::DataReader;
    use windows::Win32::System::WinRT::{RoInitialize, RO_INIT_MULTITHREADED};

    enum Cmd {
        PlayPause,
        Next,
        Prev,
    }

    #[derive(Default)]
    struct Shared {
        info: MediaInfo,
        last_request: Option<Instant>,
        running: bool,
        tx: Option<Sender<Cmd>>,
    }

    #[derive(Default)]
    pub struct MediaState(Arc<Mutex<Shared>>);

    const TICKS_TO_MS: i64 = 10_000;
    /// Écart entre l'époque Windows (1601) et l'époque Unix, en unités de 100 ns.
    const EPOCH_DIFF: i64 = 116_444_736_000_000_000;

    fn read_thumbnail(props: &GlobalSystemMediaTransportControlsSessionMediaProperties) -> Option<String> {
        let r = props.Thumbnail().ok()?;
        let stream = r.OpenReadAsync().ok()?.get().ok()?;
        let size = stream.Size().ok()? as u32;
        if size == 0 || size > 8 * 1024 * 1024 {
            return None;
        }
        let mime = stream.ContentType().map(|s| s.to_string()).unwrap_or_default();
        let reader = DataReader::CreateDataReader(&stream).ok()?;
        let n = reader.LoadAsync(size).ok()?.get().ok()?;
        let mut buf = vec![0u8; n as usize];
        reader.ReadBytes(&mut buf).ok()?;
        let mime = if mime.starts_with("image/") { mime } else { "image/png".into() };
        Some(format!("data:{mime};base64,{}", base64(&buf)))
    }

    fn snapshot(mgr: &GlobalSystemMediaTransportControlsSessionManager, prev: &MediaInfo) -> MediaInfo {
        let Ok(s) = mgr.GetCurrentSession() else { return MediaInfo::default() };
        let mut info = MediaInfo { available: true, ..Default::default() };
        info.app = s.SourceAppUserModelId().map(|h| h.to_string()).unwrap_or_default();
        let props = s.TryGetMediaPropertiesAsync().ok().and_then(|op| op.get().ok());
        if let Some(p) = &props {
            info.title = p.Title().map(|h| h.to_string()).unwrap_or_default();
            info.artist = p.Artist().map(|h| h.to_string()).unwrap_or_default();
            info.album = p.AlbumTitle().map(|h| h.to_string()).unwrap_or_default();
        }
        if let Ok(pb) = s.GetPlaybackInfo() {
            info.playing = pb.PlaybackStatus().map(|st| st == GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing).unwrap_or(false);
            if let Ok(c) = pb.Controls() {
                info.can_prev = c.IsPreviousEnabled().unwrap_or(false);
                info.can_next = c.IsNextEnabled().unwrap_or(false);
                info.can_play_pause = c.IsPlayPauseToggleEnabled().unwrap_or(false);
            }
        }
        if let Ok(t) = s.GetTimelineProperties() {
            let start = t.StartTime().map(|x| x.Duration).unwrap_or(0);
            info.duration_ms = (t.EndTime().map(|x| x.Duration).unwrap_or(0) - start) / TICKS_TO_MS;
            info.position_ms = (t.Position().map(|x| x.Duration).unwrap_or(0) - start) / TICKS_TO_MS;
            info.updated_ms = t.LastUpdatedTime().map(|d| (d.UniversalTime - EPOCH_DIFF) / TICKS_TO_MS).unwrap_or(0);
        }
        // La pochette n'est relue que lorsque le morceau change.
        let same = prev.available && prev.app == info.app && prev.title == info.title && prev.artist == info.artist && prev.album == info.album;
        info.thumbnail = if same && prev.thumbnail.is_some() { prev.thumbnail.clone() } else { props.as_ref().and_then(read_thumbnail) };
        info
    }

    fn worker(shared: Arc<Mutex<Shared>>, rx: std::sync::mpsc::Receiver<Cmd>) {
        unsafe {
            let _ = RoInitialize(RO_INIT_MULTITHREADED);
        }
        let mgr = GlobalSystemMediaTransportControlsSessionManager::RequestAsync().and_then(|op| op.get());
        loop {
            let cmd = rx.recv_timeout(Duration::from_millis(1000));
            if let Ok(mgr) = &mgr {
                if let Ok(cmd) = &cmd {
                    if let Ok(s) = mgr.GetCurrentSession() {
                        let op = match cmd {
                            Cmd::PlayPause => s.TryTogglePlayPauseAsync(),
                            Cmd::Next => s.TrySkipNextAsync(),
                            Cmd::Prev => s.TrySkipPreviousAsync(),
                        };
                        let _ = op.and_then(|o| o.get());
                    }
                }
                let prev = shared.lock().unwrap().info.clone();
                let info = snapshot(mgr, &prev);
                shared.lock().unwrap().info = info;
            }
            let mut sh = shared.lock().unwrap();
            let idle = sh.last_request.map(|t| t.elapsed() > Duration::from_secs(20)).unwrap_or(true);
            if idle || matches!(cmd, Err(RecvTimeoutError::Disconnected)) {
                sh.running = false;
                sh.tx = None;
                sh.info = MediaInfo::default();
                return;
            }
        }
    }

    impl MediaState {
        fn ensure_running(&self) {
            let mut sh = self.0.lock().unwrap();
            sh.last_request = Some(Instant::now());
            if !sh.running {
                let (tx, rx) = channel();
                sh.tx = Some(tx);
                sh.running = true;
                let shared = self.0.clone();
                std::thread::spawn(move || worker(shared, rx));
            }
        }

        pub fn info(&self) -> MediaInfo {
            self.ensure_running();
            self.0.lock().unwrap().info.clone()
        }

        pub fn control(&self, action: &str) -> Result<(), String> {
            self.ensure_running();
            let cmd = match action {
                "playpause" => Cmd::PlayPause,
                "next" => Cmd::Next,
                "prev" => Cmd::Prev,
                _ => return Err("Action inconnue".into()),
            };
            let sh = self.0.lock().unwrap();
            sh.tx.as_ref().ok_or("Lecteur indisponible")?.send(cmd).map_err(|e| e.to_string())
        }
    }
}

#[cfg(not(windows))]
mod imp {
    use super::MediaInfo;
    #[derive(Default)]
    pub struct MediaState(());
    impl MediaState {
        pub fn info(&self) -> MediaInfo {
            MediaInfo::default()
        }
        pub fn control(&self, _action: &str) -> Result<(), String> {
            Err("Disponible uniquement sous Windows".into())
        }
    }
}

pub use imp::MediaState;

#[cfg(test)]
mod tests {
    #[test]
    fn b64() {
        assert_eq!(super::base64(b"Man"), "TWFu");
        assert_eq!(super::base64(b"Ma"), "TWE=");
        assert_eq!(super::base64(b"M"), "TQ==");
        assert_eq!(super::base64(b""), "");
    }
}
