//! Intégration au bureau Windows : place une fenêtre derrière les icônes du bureau.
//!
//! Deux organisations du bureau existent :
//! * **Classique** (Windows 10, Windows 11 < 24H2) : après le message 0x052C envoyé à
//!   `Progman`, Explorer crée une fenêtre `WorkerW` de premier niveau située derrière
//!   celle qui contient les icônes (`SHELLDLL_DefView`). On s'y attache comme enfant.
//! * **« Raised desktop »** (Windows 11 24H2+) : `SHELLDLL_DefView` et le `WorkerW` du
//!   papier peint sont des enfants de `Progman`. On devient un enfant *layered* de
//!   `Progman`, placé dans l'ordre Z juste sous les icônes et au-dessus du `WorkerW`.

#[derive(Clone, Copy, Debug)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}

#[cfg(windows)]
mod imp {
    use super::Rect;
    use std::ffi::c_void;
    use windows::core::{w, BOOL, PCWSTR};
    use windows::Win32::Foundation::{COLORREF, HWND, LPARAM, POINT, WPARAM};
    use windows::Win32::Graphics::Gdi::ClientToScreen;
    use windows::Win32::UI::WindowsAndMessaging::*;

    fn h(raw: isize) -> HWND {
        HWND(raw as *mut c_void)
    }
    fn raw(hwnd: HWND) -> isize {
        hwnd.0 as isize
    }

    unsafe fn find_child(parent: Option<HWND>, after: Option<HWND>, class: PCWSTR) -> Option<HWND> {
        FindWindowExW(parent, after, class, PCWSTR::null())
            .ok()
            .filter(|w| !w.is_invalid())
    }

    unsafe extern "system" fn enum_cb(top: HWND, lp: LPARAM) -> BOOL {
        if find_child(Some(top), None, w!("SHELLDLL_DefView")).is_some() {
            if let Some(ww) = find_child(None, Some(top), w!("WorkerW")) {
                *(lp.0 as *mut HWND) = ww;
                return BOOL(0);
            }
        }
        BOOL(1)
    }

    unsafe fn make_child(hwnd: HWND, layered: bool) {
        let style = GetWindowLongPtrW(hwnd, GWL_STYLE) as u32;
        let style = (style & !(WS_POPUP.0 | WS_CAPTION.0 | WS_THICKFRAME.0 | WS_SYSMENU.0)) | WS_CHILD.0;
        SetWindowLongPtrW(hwnd, GWL_STYLE, style as isize);
        let mut ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32;
        ex &= !WS_EX_APPWINDOW.0;
        ex |= WS_EX_TOOLWINDOW.0 | WS_EX_NOACTIVATE.0;
        if layered {
            ex |= WS_EX_LAYERED.0;
        }
        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, ex as isize);
        if layered {
            let _ = SetLayeredWindowAttributes(hwnd, COLORREF(0), 255, LWA_ALPHA);
        }
    }

    unsafe fn origin(parent: HWND) -> (i32, i32) {
        let mut p = POINT { x: 0, y: 0 };
        let _ = ClientToScreen(parent, &mut p);
        (p.x, p.y)
    }

    unsafe fn progman() -> Option<HWND> {
        FindWindowW(w!("Progman"), PCWSTR::null())
            .ok()
            .filter(|w| !w.is_invalid())
    }

    /// Attache la fenêtre `hwnd` au calque du bureau, aux coordonnées écran `r` (pixels physiques).
    /// Retourne le handle du parent utilisé.
    pub fn attach(hwnd_raw: isize, r: Rect) -> Result<isize, String> {
        unsafe {
            let hwnd = h(hwnd_raw);
            let progman = progman().ok_or("Progman introuvable (Explorer est-il lancé ?)")?;
            // Demande à Explorer de créer le calque WorkerW derrière les icônes.
            let mut res = 0usize;
            let _ = SendMessageTimeoutW(progman, 0x052C, WPARAM(0xD), LPARAM(0x1), SMTO_NORMAL, 1000, Some(&mut res));
            let _ = SendMessageTimeoutW(progman, 0x052C, WPARAM(0), LPARAM(0), SMTO_NORMAL, 1000, Some(&mut res));

            if let Some(defview) = find_child(Some(progman), None, w!("SHELLDLL_DefView")) {
                // --- Windows 11 24H2+ ---
                make_child(hwnd, true);
                SetParent(hwnd, Some(progman)).map_err(|e| e.to_string())?;
                let (ox, oy) = origin(progman);
                SetWindowPos(hwnd, Some(defview), r.x - ox, r.y - oy, r.w, r.h, SWP_NOACTIVATE | SWP_SHOWWINDOW)
                    .map_err(|e| e.to_string())?;
                fix_zorder(hwnd, progman, defview);
                return Ok(raw(progman));
            }

            // --- Organisation classique ---
            let mut workerw = HWND::default();
            let _ = EnumWindows(Some(enum_cb), LPARAM(&mut workerw as *mut HWND as isize));
            if workerw.is_invalid() {
                return Err("Calque WorkerW introuvable".into());
            }
            make_child(hwnd, false);
            SetParent(hwnd, Some(workerw)).map_err(|e| e.to_string())?;
            let (ox, oy) = origin(workerw);
            SetWindowPos(hwnd, Some(HWND_TOP), r.x - ox, r.y - oy, r.w, r.h, SWP_NOACTIVATE | SWP_SHOWWINDOW)
                .map_err(|e| e.to_string())?;
            Ok(raw(workerw))
        }
    }

    unsafe fn fix_zorder(hwnd: HWND, progman: HWND, defview: HWND) {
        // Notre fenêtre juste sous les icônes…
        if GetWindow(defview, GW_HWNDNEXT).ok() != Some(hwnd) {
            let _ = SetWindowPos(hwnd, Some(defview), 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
        }
        // …et le papier peint d'Explorer sous nous.
        if let Some(ww) = find_child(Some(progman), None, w!("WorkerW")) {
            if GetWindow(hwnd, GW_HWNDNEXT).ok() != Some(ww) {
                let _ = SetWindowPos(ww, Some(hwnd), 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
            }
        }
    }

    /// Vérifie que la fenêtre est toujours correctement attachée (Explorer peut redémarrer
    /// ou réorganiser l'ordre Z). Répare l'ordre Z si besoin. `false` = à recréer.
    pub fn check(hwnd_raw: isize, parent_raw: isize) -> bool {
        unsafe {
            let hwnd = h(hwnd_raw);
            let parent = h(parent_raw);
            if !IsWindow(Some(hwnd)).as_bool() || !IsWindow(Some(parent)).as_bool() {
                return false;
            }
            if GetParent(hwnd).ok() != Some(parent) {
                return false;
            }
            if let Some(defview) = find_child(Some(parent), None, w!("SHELLDLL_DefView")) {
                fix_zorder(hwnd, parent, defview);
            }
            true
        }
    }

    /// Ré-applique le papier peint Windows pour effacer les restes de notre rendu
    /// (mise en pause, fermeture).
    pub fn refresh_wallpaper() {
        unsafe {
            let mut buf = [0u16; 520];
            if SystemParametersInfoW(
                SPI_GETDESKWALLPAPER,
                buf.len() as u32,
                Some(buf.as_mut_ptr() as *mut c_void),
                SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS(0),
            )
            .is_ok()
            {
                let _ = SystemParametersInfoW(
                    SPI_SETDESKWALLPAPER,
                    0,
                    Some(buf.as_mut_ptr() as *mut c_void),
                    SPIF_SENDCHANGE,
                );
            }
        }
    }
}

#[cfg(not(windows))]
mod imp {
    //! Hors Windows (développement) : la fenêtre reste une fenêtre normale.
    use super::Rect;
    pub fn attach(_hwnd: isize, _r: Rect) -> Result<isize, String> {
        Ok(0)
    }
    pub fn check(_hwnd: isize, _parent: isize) -> bool {
        true
    }
    pub fn refresh_wallpaper() {}
}

pub use imp::*;
