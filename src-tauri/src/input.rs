//! Clics sur le bureau transmis au fond d'écran.
//!
//! Le fond est placé derrière les icônes : c'est la liste d'icônes d'Explorer
//! (`SysListView32`) qui reçoit les clics. Un hook souris bas niveau observe les
//! relâchements du bouton gauche ; si le clic a eu lieu sur une zone vide du bureau
//! (aucune icône sélectionnée ensuite), sa position est envoyée à la fenêtre de fond
//! concernée (événement `desktop-click`), qui décide quoi en faire (ouvrir un article…).
//! Le hook ne bloque ni ne modifie jamais le clic : le bureau fonctionne normalement.

use serde::Serialize;

#[derive(Clone, Serialize)]
#[cfg_attr(not(windows), allow(dead_code))]
pub struct DesktopClick {
    /// Position en pixels CSS dans la fenêtre de fond.
    pub x: f64,
    pub y: f64,
    /// 1 = clic simple, 2 = double-clic.
    pub count: u32,
}

#[cfg(windows)]
mod imp {
    use super::DesktopClick;
    use std::sync::{mpsc, Mutex, OnceLock};
    use std::time::{Duration, Instant};
    use tauri::{AppHandle, Emitter};
    use windows::Win32::Foundation::{HINSTANCE, HWND, LPARAM, LRESULT, POINT, WPARAM};
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::UI::Input::KeyboardAndMouse::GetDoubleClickTime;
    use windows::Win32::UI::WindowsAndMessaging::*;

    static TX: OnceLock<Mutex<mpsc::Sender<(i32, i32)>>> = OnceLock::new();
    const LVM_GETSELECTEDCOUNT: u32 = 0x1000 + 50;

    unsafe extern "system" fn hook(code: i32, wp: WPARAM, lp: LPARAM) -> LRESULT {
        if code >= 0 && wp.0 as u32 == WM_LBUTTONUP {
            let info = &*(lp.0 as *const MSLLHOOKSTRUCT);
            if let Some(Ok(tx)) = TX.get().map(|m| m.lock()) {
                let _ = tx.send((info.pt.x, info.pt.y));
            }
        }
        CallNextHookEx(None, code, wp, lp)
    }

    unsafe fn class_of(h: HWND) -> String {
        let mut buf = [0u16; 64];
        let n = GetClassNameW(h, &mut buf).max(0) as usize;
        String::from_utf16_lossy(&buf[..n])
    }

    /// Le point (coordonnées écran physiques) est-il sur une zone vide du bureau ?
    unsafe fn on_empty_desktop(x: i32, y: i32) -> bool {
        let w = WindowFromPoint(POINT { x, y });
        if w.is_invalid() || class_of(w) != "SysListView32" {
            return false;
        }
        match GetParent(w) {
            Ok(p) if class_of(p) == "SHELLDLL_DefView" => {}
            _ => return false,
        }
        let mut selected = 0usize;
        let ok = SendMessageTimeoutW(w, LVM_GETSELECTEDCOUNT, WPARAM(0), LPARAM(0), SMTO_ABORTIFHUNG, 200, Some(&mut selected));
        ok.0 != 0 && selected == 0
    }

    fn worker(app: AppHandle, rx: mpsc::Receiver<(i32, i32)>) {
        let (dbl, dx, dy) = unsafe {
            (
                Duration::from_millis(GetDoubleClickTime() as u64),
                GetSystemMetrics(SM_CXDOUBLECLK),
                GetSystemMetrics(SM_CYDOUBLECLK),
            )
        };
        let mut last: Option<(Instant, i32, i32)> = None;
        for (x, y) in rx {
            let now = Instant::now();
            let count = match last {
                Some((t, lx, ly)) if now - t <= dbl && (x - lx).abs() <= dx && (y - ly).abs() <= dy => 2,
                _ => 1,
            };
            last = if count == 2 { None } else { Some((now, x, y)) };
            // Laisse Explorer traiter le clic (sélection d'icône) avant de vérifier.
            std::thread::sleep(Duration::from_millis(40));
            if !unsafe { on_empty_desktop(x, y) } {
                continue;
            }
            if let Some((label, cx, cy)) = crate::wall_at(&app, x, y) {
                let _ = app.emit_to(label.as_str(), "desktop-click", DesktopClick { x: cx, y: cy, count });
            }
        }
    }

    /// À appeler sur le thread principal (qui possède une boucle de messages).
    pub fn install(app: AppHandle) {
        let (tx, rx) = mpsc::channel();
        if TX.set(Mutex::new(tx)).is_err() {
            return;
        }
        let hmod = unsafe { GetModuleHandleW(None) }.ok().map(|h| HINSTANCE(h.0));
        if let Err(e) = unsafe { SetWindowsHookExW(WH_MOUSE_LL, Some(hook), hmod, 0) } {
            crate::log(&app, format!("Clics sur le bureau indisponibles : {e}"));
            return;
        }
        std::thread::spawn(move || worker(app, rx));
    }
}

#[cfg(not(windows))]
mod imp {
    pub fn install(_app: tauri::AppHandle) {}
}

pub use imp::install;
