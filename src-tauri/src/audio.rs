//! Spectre audio de ce que joue le PC (capture « loopback » WASAPI de la sortie par défaut),
//! pour la brique Visualiseur. Le thread de capture ne tourne que tant qu'une brique le
//! demande (`audio_keepalive`) et s'arrête de lui-même sinon.
#![cfg_attr(not(windows), allow(dead_code))]

use std::f32::consts::PI;

/// Nombre de bandes de fréquences envoyées à l'interface (échelle logarithmique).
pub const BANDS: usize = 64;
const N: usize = 2048;

/// FFT radix-2 en place (re, im de longueur puissance de 2).
pub fn fft(re: &mut [f32], im: &mut [f32]) {
    let n = re.len();
    let mut j = 0;
    for i in 1..n {
        let mut bit = n >> 1;
        while j & bit != 0 {
            j ^= bit;
            bit >>= 1;
        }
        j |= bit;
        if i < j {
            re.swap(i, j);
            im.swap(i, j);
        }
    }
    let mut len = 2;
    while len <= n {
        let ang = -2.0 * PI / len as f32;
        let (wr, wi) = (ang.cos(), ang.sin());
        for start in (0..n).step_by(len) {
            let (mut cr, mut ci) = (1.0f32, 0.0f32);
            for k in 0..len / 2 {
                let (a, b) = (start + k, start + k + len / 2);
                let (tr, ti) = (re[b] * cr - im[b] * ci, re[b] * ci + im[b] * cr);
                re[b] = re[a] - tr;
                im[b] = im[a] - ti;
                re[a] += tr;
                im[a] += ti;
                let ncr = cr * wr - ci * wi;
                ci = cr * wi + ci * wr;
                cr = ncr;
            }
        }
        len <<= 1;
    }
}

/// Spectre en `BANDS` bandes (0–1) des `N` derniers échantillons mono.
pub fn spectrum(samples: &[f32], rate: f32) -> Vec<f32> {
    let mut re: Vec<f32> = samples
        .iter()
        .enumerate()
        .map(|(i, s)| s * (0.5 - 0.5 * (2.0 * PI * i as f32 / (N as f32 - 1.0)).cos())) // fenêtre de Hann
        .collect();
    re.resize(N, 0.0);
    let mut im = vec![0.0f32; N];
    fft(&mut re, &mut im);
    let mag: Vec<f32> = (0..N / 2).map(|k| (re[k] * re[k] + im[k] * im[k]).sqrt() / (N as f32 / 4.0)).collect();
    let (fmin, fmax) = (30.0f32, 16000.0f32.min(rate / 2.0));
    let bin = |f: f32| ((f / rate * N as f32) as usize).clamp(1, N / 2 - 1);
    (0..BANDS)
        .map(|b| {
            let f0 = fmin * (fmax / fmin).powf(b as f32 / BANDS as f32);
            let f1 = fmin * (fmax / fmin).powf((b + 1) as f32 / BANDS as f32);
            let (k0, k1) = (bin(f0), bin(f1).max(bin(f0) + 1));
            let peak = mag[k0..k1].iter().cloned().fold(0.0f32, f32::max);
            // Légère accentuation des aigus (spectre musical ~1/f).
            let tilt = 1.0 + 3.0 * b as f32 / BANDS as f32;
            let db = 20.0 * (peak * tilt).max(1e-9).log10();
            ((db + 70.0) / 60.0).clamp(0.0, 1.0)
        })
        .collect()
}

#[cfg(windows)]
mod imp {
    use super::{spectrum, N};
    use std::sync::{Arc, Mutex};
    use std::time::{Duration, Instant};
    use tauri::{AppHandle, Emitter};
    use windows::Win32::Media::Audio::*;
    use windows::Win32::System::Com::*;

    #[derive(Default)]
    struct Shared {
        last_request: Option<Instant>,
        running: bool,
    }

    #[derive(Default)]
    pub struct AudioState(Arc<Mutex<Shared>>);

    fn wanted(shared: &Arc<Mutex<Shared>>) -> bool {
        shared.lock().unwrap().last_request.is_some_and(|t| t.elapsed() < Duration::from_secs(5))
    }

    /// Une session de capture ; retourne quand on n'en veut plus ou en cas d'erreur
    /// (périphérique changé…).
    unsafe fn capture(app: &AppHandle, shared: &Arc<Mutex<Shared>>) -> windows::core::Result<()> {
        let enumerator: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
        let device = enumerator.GetDefaultAudioEndpoint(eRender, eConsole)?;
        let client: IAudioClient = device.Activate(CLSCTX_ALL, None)?;
        let fmt = client.GetMixFormat()?;
        let f = *fmt;
        let channels = f.nChannels.max(1) as usize;
        let rate = f.nSamplesPerSec as f32;
        let bits = f.wBitsPerSample;
        client.Initialize(AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_LOOPBACK, 200_000, 0, fmt, None)?;
        CoTaskMemFree(Some(fmt as *const core::ffi::c_void));
        let cap: IAudioCaptureClient = client.GetService()?;
        client.Start()?;

        let mut ring = vec![0.0f32; N];
        let mut pos = 0usize;
        let mut last_data = Instant::now();
        let mut last_emit = Instant::now();
        let mut silent_sent = false;
        loop {
            std::thread::sleep(Duration::from_millis(8));
            let mut packet = cap.GetNextPacketSize()?;
            while packet > 0 {
                let mut data: *mut u8 = std::ptr::null_mut();
                let mut frames = 0u32;
                let mut flags = 0u32;
                cap.GetBuffer(&mut data, &mut frames, &mut flags, None, None)?;
                let silent = flags & (AUDCLNT_BUFFERFLAGS_SILENT.0 as u32) != 0;
                for i in 0..frames as usize {
                    let mut s = 0.0f32;
                    if !silent && !data.is_null() {
                        for c in 0..channels {
                            let idx = i * channels + c;
                            s += match bits {
                                32 => *(data as *const f32).add(idx),
                                16 => *(data as *const i16).add(idx) as f32 / 32768.0,
                                _ => 0.0,
                            };
                        }
                    }
                    ring[pos] = s / channels as f32;
                    pos = (pos + 1) % N;
                }
                cap.ReleaseBuffer(frames)?;
                last_data = Instant::now();
                packet = cap.GetNextPacketSize()?;
            }
            // Sans son, Windows n'envoie plus rien : on vide le tampon.
            let idle = last_data.elapsed() > Duration::from_millis(150);
            if idle {
                ring.iter_mut().for_each(|x| *x = 0.0);
            }
            if last_emit.elapsed() >= Duration::from_millis(33) && !(idle && silent_sent) {
                last_emit = Instant::now();
                let ordered: Vec<f32> = ring[pos..].iter().chain(ring[..pos].iter()).cloned().collect();
                let _ = app.emit("audio-spectrum", spectrum(&ordered, rate));
                silent_sent = idle;
            }
            if !wanted(shared) {
                let _ = client.Stop();
                return Ok(());
            }
        }
    }

    impl AudioState {
        pub fn keepalive(&self, app: &AppHandle) {
            let mut sh = self.0.lock().unwrap();
            sh.last_request = Some(Instant::now());
            if sh.running {
                return;
            }
            sh.running = true;
            let shared = self.0.clone();
            let app = app.clone();
            std::thread::spawn(move || {
                unsafe {
                    let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
                }
                while wanted(&shared) {
                    if let Err(e) = unsafe { capture(&app, &shared) } {
                        crate::log(&app, format!("Capture audio interrompue : {e}"));
                        std::thread::sleep(Duration::from_secs(2));
                    }
                }
                shared.lock().unwrap().running = false;
            });
        }
    }
}

#[cfg(not(windows))]
mod imp {
    #[derive(Default)]
    pub struct AudioState(());
    impl AudioState {
        pub fn keepalive(&self, _app: &tauri::AppHandle) {}
    }
}

pub use imp::AudioState;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sine_peak() {
        let rate = 48000.0;
        let s: Vec<f32> = (0..N).map(|i| (2.0 * PI * 1000.0 * i as f32 / rate).sin() * 0.5).collect();
        let sp = spectrum(&s, rate);
        assert_eq!(sp.len(), BANDS);
        let max_band = sp.iter().enumerate().max_by(|a, b| a.1.partial_cmp(b.1).unwrap()).unwrap().0;
        // 1 kHz sur une échelle log 30 Hz–16 kHz : bande ~ 64 * ln(1000/30)/ln(16000/30) ≈ 35
        assert!((33..=37).contains(&max_band), "bande {max_band}");
        assert!(spectrum(&vec![0.0; N], rate).iter().all(|&v| v == 0.0));
    }
}
