//! Applications installées, pour la brique Lanceur.
//!
//! * Dossier « Applications » de Windows (`shell:AppsFolder`) : programmes classiques et
//!   applications du Microsoft Store, avec leur icône — c'est la liste du menu Démarrer.
//! * Jeux Steam (bibliothèques + jaquettes du cache Steam) et Epic Games (manifestes).
//!
//! Chaque application reçoit une catégorie devinée (jeux, musique & vidéo…), que
//! l'utilisateur peut changer dans l'éditeur.
#![cfg_attr(not(windows), allow(dead_code))]

use serde::Serialize;

#[derive(Serialize, Clone, Debug, Default)]
pub struct AppEntry {
    /// Identifiant stable : `win:<nom d'analyse>`, `steam:<appid>`, `epic:<AppName>`.
    pub id: String,
    pub name: String,
    /// windows | steam | epic
    pub source: String,
    /// Catégorie devinée : games, media, creative, office, internet, dev, utils, other.
    pub category: String,
    /// Icône en data URL (PNG), si extraite.
    pub icon: Option<String>,
    /// Fichier image local (icône Steam) — servi par le protocole asset.
    pub icon_path: Option<String>,
    /// Jaquette verticale (jeux Steam).
    pub cover: Option<String>,
    /// Ce qui est lancé : nom d'analyse AppsFolder, URL steam:// ou com.epicgames.launcher://.
    #[serde(skip)]
    pub target: String,
}

// ---------------------------------------------------------------------------
// Catégories
// ---------------------------------------------------------------------------

const RULES: &[(&str, &[&str])] = &[
    (
        "games",
        &[
            "steam", "epic games", "battle.net", "ea app", "origin", "ubisoft connect", "uplay", "gog galaxy", "xbox", "playnite",
            "heroic", "itch", "rockstar games", "minecraft", "prism launcher", "retroarch", "dolphin", "ryujinx", "pcsx2", "rpcs3",
            "cemu", "duckstation", "ppsspp", "riot client", "league of legends", "valorant", "fortnite", "game", "jeu",
        ],
    ),
    (
        "dev",
        &[
            "visual studio", "vscodium", "cursor", "jetbrains", "intellij", "pycharm", "webstorm", "rider", "clion", "goland",
            "android studio", "git", "github", "sourcetree", "docker", "postman", "insomnia", "wsl", "ubuntu", "debian", "terminal",
            "powershell", "python", "node.js", "putty", "winscp", "mobaxterm", "filezilla", "dbeaver", "heidisql", "sql server",
            "notepad++", "sublime text", "vim", "neovim", "unity", "unreal", "godot", "arduino", "wireshark", "virtualbox", "vmware",
            "hyper-v", "developer", "développeur", "cmake", "msys2",
        ],
    ),
    (
        "creative",
        &[
            "photoshop", "illustrator", "lightroom", "premiere", "after effects", "indesign", "gimp", "krita", "inkscape", "blender",
            "affinity", "davinci", "resolve", "obs studio", "paint", "clip studio", "figma", "canva", "audacity", "fl studio",
            "ableton", "reaper", "cubase", "bitwig", "darktable", "rawtherapee", "kdenlive", "shotcut", "handbrake", "sketchup",
            "fusion 360", "freecad", "autocad", "meshroom", "cura", "prusaslicer", "orcaslicer", "bambu studio", "capture one",
            "clipchamp", "comfyui", "stable diffusion",
        ],
    ),
    (
        "media",
        &[
            "spotify", "deezer", "tidal", "itunes", "apple music", "music", "musique", "vlc", "mpc-hc", "mpc-be", "potplayer",
            "foobar", "musicbee", "winamp", "aimp", "plex", "jellyfin", "kodi", "netflix", "prime video", "disney", "media player",
            "lecteur multimédia", "films", "groove", "podcast", "radio", "youtube",
        ],
    ),
    (
        "office",
        &[
            "word", "excel", "powerpoint", "outlook", "onenote", "access", "publisher", "libreoffice", "openoffice", "onlyoffice",
            "acrobat", "pdf", "notion", "obsidian", "evernote", "joplin", "wps office", "calendrier", "calendar", "courrier",
            "to do", "sticky notes", "pense-bête", "xmind", "teams",
        ],
    ),
    (
        "internet",
        &[
            "chrome", "firefox", "edge", "opera", "brave", "vivaldi", "tor browser", "discord", "slack", "zoom", "skype", "whatsapp",
            "telegram", "signal", "messenger", "thunderbird", "qbittorrent", "transmission", "nordvpn", "protonvpn", "proton",
            "parsec", "browser", "navigateur",
        ],
    ),
    (
        "utils",
        &[
            "7-zip", "winrar", "everything", "powertoys", "ccleaner", "revo", "cpu-z", "gpu-z", "hwinfo", "hwmonitor",
            "librehardwaremonitor", "afterburner", "rivatuner", "nvidia", "geforce", "amd", "radeon", "intel", "logitech", "razer",
            "corsair", "steelseries", "icue", "armoury", "crystaldisk", "rufus", "balena", "veracrypt", "keepass", "bitwarden",
            "1password", "calculator", "calculatrice", "notepad", "bloc-notes", "snipping", "capture", "sharex", "greenshot",
            "task manager", "gestionnaire", "control panel", "panneau de configuration", "settings", "paramètres", "explorer",
            "explorateur", "microsoft store", "teamviewer", "anydesk", "rustdesk", "wireguard", "openvpn", "onedrive", "dropbox",
            "google drive", "nextcloud", "syncthing", "windows",
        ],
    ),
];

/// Chemins typiques des jeux installés hors Steam / Epic.
const GAME_PATHS: &[&str] = &[
    "steamapps", "\\epic games\\", "gog games", "\\xboxgames\\", "riot games", "ubisoft game launcher\\games", "\\ea games\\",
    "\\games\\", "\\jeux\\", "battle.net", "minecraft",
];

fn matches(hay: &str, tokens: &[&str], kw: &str) -> bool {
    if kw.contains(' ') || kw.contains('.') || kw.contains('-') || kw.contains('+') {
        hay.contains(kw)
    } else if kw.chars().count() <= 6 {
        tokens.contains(&kw)
    } else {
        tokens.iter().any(|t| t.starts_with(kw))
    }
}

/// Catégorie devinée à partir du nom et de la cible (chemin de l'exécutable…).
pub fn categorize(name: &str, target: &str) -> &'static str {
    let name_l = name.to_lowercase();
    let target_l = target.to_lowercase();
    if GAME_PATHS.iter().any(|p| target_l.contains(p)) {
        return "games";
    }
    let tokens: Vec<&str> = name_l.split(|c: char| !c.is_alphanumeric() && c != '+').filter(|t| !t.is_empty()).collect();
    for (cat, kws) in RULES {
        if kws.iter().any(|k| matches(&name_l, &tokens, k)) {
            return cat;
        }
    }
    // Deuxième passe sur la cible (ex. « …\Adobe\Photoshop.exe » pour un raccourci renommé).
    let ttokens: Vec<&str> = target_l.split(|c: char| !c.is_alphanumeric()).filter(|t| !t.is_empty()).collect();
    for (cat, kws) in RULES {
        if *cat != "games" && kws.iter().any(|k| k.len() > 4 && matches(&target_l, &ttokens, k)) {
            return cat;
        }
    }
    "other"
}

/// Entrées du menu Démarrer qui ne sont pas des applications.
pub fn is_noise(name: &str, target: &str) -> bool {
    let n = name.to_lowercase();
    let t = target.to_lowercase();
    const WORDS: &[&str] = &[
        "uninstall", "désinstall", "desinstall", "deinstall", "readme", "read me", "lisez-moi", "lisezmoi", "help", "aide de",
        "documentation", "manual", "manuel", "website", "site web", "release notes", "notes de version", "license", "licence",
        "changelog", "what's new", "nouveautés", "support", "faq", "online", "en ligne",
    ];
    WORDS.iter().any(|w| n.contains(w))
        || t.starts_with("http")
        || [".chm", ".pdf", ".txt", ".html", ".htm", ".url", ".rtf", ".md"].iter().any(|e| t.ends_with(e))
}

// ---------------------------------------------------------------------------
// Steam / Epic (fichiers texte, indépendants de Windows)
// ---------------------------------------------------------------------------

/// Paires "clé" "valeur" d'un fichier VDF/ACF de Steam (sans tenir compte de l'imbrication).
pub fn vdf_pairs(text: &str) -> Vec<(String, String)> {
    text.lines()
        .filter_map(|l| {
            let mut parts = l.split('"').skip(1).step_by(2);
            let k = parts.next()?;
            let v = parts.next()?;
            Some((k.to_lowercase(), v.replace("\\\\", "\\")))
        })
        .collect()
}

const STEAM_TOOLS: &[&str] = &["Steamworks Common Redistributables", "Proton", "Steam Linux Runtime", "SteamVR", "Steam Audio"];

/// (appid, nom) d'un appmanifest_*.acf, si c'est un jeu.
pub fn steam_manifest(text: &str) -> Option<(String, String)> {
    let pairs = vdf_pairs(text);
    let get = |k: &str| pairs.iter().find(|(kk, _)| kk == k).map(|(_, v)| v.clone());
    let id = get("appid")?;
    let name = get("name")?;
    if STEAM_TOOLS.iter().any(|t| name.starts_with(t)) || id == "228980" {
        return None;
    }
    Some((id, name))
}

#[cfg_attr(not(windows), allow(dead_code))]
fn steam_images(steam: &std::path::Path, id: &str) -> (Option<String>, Option<String>) {
    let lc = steam.join("appcache").join("librarycache");
    let find = |names: &[String]| -> Option<String> {
        for n in names {
            let p = lc.join(n);
            if p.is_file() {
                return Some(p.to_string_lossy().into_owned());
            }
        }
        // Nouvelle organisation : librarycache/<appid>/[<hash>/]fichier
        let dir = lc.join(id);
        let wanted: Vec<&str> = names.iter().filter_map(|n| n.rsplit(['/', '_']).next()).collect();
        let mut stack = vec![(dir, 0)];
        while let Some((d, depth)) = stack.pop() {
            let Ok(rd) = std::fs::read_dir(&d) else { continue };
            for e in rd.flatten() {
                let p = e.path();
                if p.is_dir() && depth < 2 {
                    stack.push((p, depth + 1));
                } else if let Some(f) = p.file_name().and_then(|f| f.to_str()) {
                    if wanted.iter().any(|w| f.eq_ignore_ascii_case(w)) {
                        return Some(p.to_string_lossy().into_owned());
                    }
                }
            }
        }
        None
    };
    let cover = find(&[format!("{id}_library_600x900.jpg"), format!("{id}/library_600x900.jpg")]);
    // L'icône porte un nom de hash (40 caractères hexadécimaux) dans le dossier du jeu.
    let mut icon = find(&[format!("{id}_icon.jpg")]);
    if icon.is_none() {
        if let Ok(rd) = std::fs::read_dir(lc.join(id)) {
            icon = rd
                .flatten()
                .map(|e| e.path())
                .find(|p| p.extension().is_some_and(|x| x == "jpg") && p.file_stem().is_some_and(|s| s.len() == 40))
                .map(|p| p.to_string_lossy().into_owned());
        }
    }
    (cover, icon)
}

#[cfg_attr(not(windows), allow(dead_code))]
fn scan_steam(steam: &std::path::Path) -> Vec<AppEntry> {
    let mut libs = vec![steam.to_path_buf()];
    if let Ok(t) = std::fs::read_to_string(steam.join("steamapps").join("libraryfolders.vdf")) {
        for (k, v) in vdf_pairs(&t) {
            if k == "path" {
                let p = std::path::PathBuf::from(v);
                if !libs.contains(&p) {
                    libs.push(p);
                }
            }
        }
    }
    let mut out = Vec::new();
    for lib in libs {
        let Ok(rd) = std::fs::read_dir(lib.join("steamapps")) else { continue };
        for e in rd.flatten() {
            let f = e.file_name().to_string_lossy().to_string();
            if !(f.starts_with("appmanifest_") && f.ends_with(".acf")) {
                continue;
            }
            let Ok(t) = std::fs::read_to_string(e.path()) else { continue };
            let Some((id, name)) = steam_manifest(&t) else { continue };
            if out.iter().any(|a: &AppEntry| a.id == format!("steam:{id}")) {
                continue;
            }
            let (cover, icon_path) = steam_images(steam, &id);
            out.push(AppEntry {
                id: format!("steam:{id}"),
                name,
                source: "steam".into(),
                category: "games".into(),
                icon: None,
                icon_path,
                cover,
                target: format!("steam://rungameid/{id}"),
            });
        }
    }
    out
}

/// Jeux Epic : (nom, lien de lancement, exécutable) depuis un manifeste .item.
pub fn epic_manifest(text: &str) -> Option<(String, String, String, String)> {
    let v: serde_json::Value = serde_json::from_str(text).ok()?;
    let s = |k: &str| v.get(k).and_then(|x| x.as_str()).unwrap_or("").to_string();
    if v.get("bIsIncompleteInstall").and_then(|x| x.as_bool()) == Some(true) {
        return None;
    }
    let cats = v.get("AppCategories").and_then(|x| x.as_array()).map(|a| a.iter().filter_map(|c| c.as_str()).collect::<Vec<_>>()).unwrap_or_default();
    if !cats.is_empty() && !cats.contains(&"games") {
        return None;
    }
    let (name, app, ns, item) = (s("DisplayName"), s("AppName"), s("CatalogNamespace"), s("CatalogItemId"));
    if name.is_empty() || app.is_empty() {
        return None;
    }
    let url = format!("com.epicgames.launcher://apps/{ns}%3A{item}%3A{app}?action=launch&silent=true");
    let exe = std::path::Path::new(&s("InstallLocation")).join(s("LaunchExecutable")).to_string_lossy().into_owned();
    Some((app, name, url, exe))
}

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------

#[cfg(windows)]
mod imp {
    use super::*;
    use std::ffi::c_void;
    use windows::core::{w, Interface, HSTRING, PWSTR};
    use windows::Win32::Foundation::SIZE;
    use windows::Win32::Graphics::Gdi::*;
    use windows::Win32::Storage::EnhancedStorage::PKEY_Link_TargetParsingPath;
    use windows::Win32::System::Com::*;
    use windows::Win32::System::Registry::*;
    use windows::Win32::UI::Shell::*;

    unsafe fn take(p: PWSTR) -> String {
        let s = p.to_string().unwrap_or_default();
        CoTaskMemFree(Some(p.0 as *const c_void));
        s
    }

    /// HBITMAP 32 bits (prémultiplié) → PNG en data URL.
    unsafe fn bitmap_png(hbm: HBITMAP) -> Option<String> {
        let mut bm = BITMAP::default();
        let ok = GetObjectW(HGDIOBJ(hbm.0), std::mem::size_of::<BITMAP>() as i32, Some(&mut bm as *mut _ as *mut c_void)) != 0;
        let (w, h) = (bm.bmWidth, bm.bmHeight.abs());
        let mut buf = vec![0u8; (w.max(0) * h * 4) as usize];
        let mut lines = 0;
        if ok && w > 0 && h > 0 {
            let mut bi = BITMAPINFO {
                bmiHeader: BITMAPINFOHEADER {
                    biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                    biWidth: w,
                    biHeight: -h, // de haut en bas
                    biPlanes: 1,
                    biBitCount: 32,
                    biCompression: BI_RGB.0,
                    ..Default::default()
                },
                ..Default::default()
            };
            let dc = GetDC(None);
            lines = GetDIBits(dc, hbm, 0, h as u32, Some(buf.as_mut_ptr() as *mut c_void), &mut bi, DIB_RGB_COLORS);
            ReleaseDC(None, dc);
        }
        let _ = DeleteObject(HGDIOBJ(hbm.0));
        if lines == 0 {
            return None;
        }
        let has_alpha = buf.chunks_exact(4).any(|p| p[3] != 0);
        for p in buf.chunks_exact_mut(4) {
            p.swap(0, 2);
            if !has_alpha {
                p[3] = 255;
            } else if p[3] > 0 && p[3] < 255 {
                let a = p[3] as u32;
                for c in p.iter_mut().take(3) {
                    *c = ((*c as u32 * 255 + a / 2) / a).min(255) as u8;
                }
            }
        }
        let mut out = Vec::new();
        {
            let mut enc = png::Encoder::new(&mut out, w as u32, h as u32);
            enc.set_color(png::ColorType::Rgba);
            enc.set_depth(png::BitDepth::Eight);
            let mut wr = enc.write_header().ok()?;
            wr.write_image_data(&buf).ok()?;
        }
        Some(format!("data:image/png;base64,{}", crate::media::base64(&out)))
    }

    unsafe fn item_icon(item: &IShellItem, size: i32) -> Option<String> {
        let f: IShellItemImageFactory = item.cast().ok()?;
        let hbm = f.GetImage(SIZE { cx: size, cy: size }, SIIGBF_ICONONLY | SIIGBF_BIGGERSIZEOK).ok()?;
        bitmap_png(hbm)
    }

    fn file_icon(path: &str, size: i32) -> Option<String> {
        unsafe {
            let item: IShellItem = SHCreateItemFromParsingName(&HSTRING::from(path), None).ok()?;
            item_icon(&item, size)
        }
    }

    fn steam_root() -> Option<std::path::PathBuf> {
        unsafe {
            let mut buf = [0u16; 512];
            let mut size = (buf.len() * 2) as u32;
            let r = RegGetValueW(
                HKEY_CURRENT_USER,
                w!("Software\\Valve\\Steam"),
                w!("SteamPath"),
                RRF_RT_REG_SZ,
                None,
                Some(buf.as_mut_ptr() as *mut c_void),
                Some(&mut size),
            );
            if r.is_ok() {
                let n = buf.iter().position(|&c| c == 0).unwrap_or(0);
                let p = std::path::PathBuf::from(String::from_utf16_lossy(&buf[..n]).replace('/', "\\"));
                if p.is_dir() {
                    return Some(p);
                }
            }
        }
        let p = std::path::PathBuf::from("C:\\Program Files (x86)\\Steam");
        p.is_dir().then_some(p)
    }

    fn scan_epic(size: i32) -> Vec<AppEntry> {
        let dir = std::path::Path::new("C:\\ProgramData\\Epic\\EpicGamesLauncher\\Data\\Manifests");
        let Ok(rd) = std::fs::read_dir(dir) else { return Vec::new() };
        rd.flatten()
            .filter(|e| e.path().extension().is_some_and(|x| x == "item"))
            .filter_map(|e| std::fs::read_to_string(e.path()).ok())
            .filter_map(|t| epic_manifest(&t))
            .map(|(app, name, url, exe)| AppEntry {
                id: format!("epic:{app}"),
                name,
                source: "epic".into(),
                category: "games".into(),
                icon: file_icon(&exe, size),
                icon_path: None,
                cover: None,
                target: url,
            })
            .collect()
    }

    fn scan_apps_folder(size: i32) -> Vec<AppEntry> {
        let mut out = Vec::new();
        unsafe {
            let Ok(folder) = SHGetKnownFolderItem::<IShellItem>(&FOLDERID_AppsFolder, KF_FLAG_DEFAULT, None) else { return out };
            let Ok(en) = folder.BindToHandler::<_, IEnumShellItems>(None, &BHID_EnumItems) else { return out };
            loop {
                let mut items = [None];
                let mut fetched = 0u32;
                if en.Next(&mut items, Some(&mut fetched)).is_err() || fetched == 0 {
                    break;
                }
                let Some(item) = items[0].take() else { break };
                let name = item.GetDisplayName(SIGDN_NORMALDISPLAY).map(|p| take(p)).unwrap_or_default();
                let parsing = item.GetDisplayName(SIGDN_PARENTRELATIVEPARSING).map(|p| take(p)).unwrap_or_default();
                if name.is_empty() || parsing.is_empty() {
                    continue;
                }
                let target = item
                    .cast::<IShellItem2>()
                    .ok()
                    .and_then(|i2| i2.GetString(&PKEY_Link_TargetParsingPath).ok())
                    .map(|p| take(p))
                    .unwrap_or_else(|| parsing.clone());
                if is_noise(&name, &target) {
                    continue;
                }
                out.push(AppEntry {
                    id: format!("win:{parsing}"),
                    category: categorize(&name, &target).into(),
                    name,
                    source: "windows".into(),
                    icon: item_icon(&item, size),
                    icon_path: None,
                    cover: None,
                    target: parsing,
                });
            }
        }
        out
    }

    pub fn scan() -> Vec<AppEntry> {
        unsafe {
            let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        }
        const SIZE_PX: i32 = 64;
        let mut games = steam_root().map(|p| scan_steam(&p)).unwrap_or_default();
        games.extend(scan_epic(SIZE_PX));
        let names: std::collections::HashSet<String> = games.iter().map(|g| g.name.to_lowercase()).collect();
        let mut all: Vec<AppEntry> = scan_apps_folder(SIZE_PX)
            .into_iter()
            .filter(|a| !names.contains(&a.name.to_lowercase())) // raccourci d'un jeu déjà listé
            .collect();
        // Un même nom peut apparaître deux fois (installation utilisateur + système).
        let mut seen = std::collections::HashSet::new();
        all.retain(|a| seen.insert(a.name.to_lowercase()));
        all.extend(games);
        all.sort_by_key(|a| a.name.to_lowercase());
        unsafe {
            CoUninitialize();
        }
        all
    }

    pub fn launch_shell(parsing: &str) -> Result<(), String> {
        std::process::Command::new("explorer.exe")
            .arg(format!("shell:AppsFolder\\{parsing}"))
            .spawn()
            .map(|_| ())
            .map_err(|e| e.to_string())
    }
}

#[cfg(not(windows))]
mod imp {
    use super::AppEntry;
    pub fn scan() -> Vec<AppEntry> {
        Vec::new()
    }
    pub fn launch_shell(_parsing: &str) -> Result<(), String> {
        Err("Disponible uniquement sous Windows".into())
    }
}

// ---------------------------------------------------------------------------
// État partagé + lancement
// ---------------------------------------------------------------------------

#[derive(Default)]
pub struct AppsState(std::sync::Mutex<Option<(std::time::Instant, Vec<AppEntry>)>>);

impl AppsState {
    /// Liste (mise en cache 10 min). L'analyse a lieu sur un thread dédié (COM, apartment STA).
    pub fn list(&self, refresh: bool) -> Vec<AppEntry> {
        if !refresh {
            if let Some((t, v)) = self.0.lock().unwrap().as_ref() {
                if t.elapsed() < std::time::Duration::from_secs(600) {
                    return v.clone();
                }
            }
        }
        let list = std::thread::spawn(imp::scan).join().unwrap_or_default();
        *self.0.lock().unwrap() = Some((std::time::Instant::now(), list.clone()));
        list
    }

    pub fn find(&self, id: &str) -> Option<AppEntry> {
        self.0.lock().unwrap().as_ref().and_then(|(_, v)| v.iter().find(|a| a.id == id).cloned())
    }
}

/// Comment lancer une application détectée.
pub enum Launch {
    Shell(String),
    Url(String),
}

pub fn launch_of(a: &AppEntry) -> Launch {
    match a.source.as_str() {
        "windows" => Launch::Shell(a.target.clone()),
        _ => Launch::Url(a.target.clone()),
    }
}

pub use imp::launch_shell;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn categories() {
        assert_eq!(categorize("Spotify", "C:\\Users\\x\\AppData\\Roaming\\Spotify\\Spotify.exe"), "media");
        assert_eq!(categorize("Visual Studio Code", ""), "dev");
        assert_eq!(categorize("Adobe Photoshop 2025", ""), "creative");
        assert_eq!(categorize("Word", "C:\\Program Files\\Microsoft Office\\root\\Office16\\WINWORD.EXE"), "office");
        assert_eq!(categorize("Discord", ""), "internet");
        assert_eq!(categorize("Cyberpunk 2077", "D:\\GOG Games\\Cyberpunk 2077\\bin\\x64\\Cyberpunk2077.exe"), "games");
        assert_eq!(categorize("7-Zip File Manager", ""), "utils");
        assert_eq!(categorize("Blender 4.2", ""), "creative");
        assert_eq!(categorize("Obscure Tool", "C:\\Tools\\obscure.exe"), "other");
        // « code » seul ne doit pas tout classer en développement
        assert_eq!(categorize("Barcode Reader", ""), "other");
        assert_eq!(categorize("Steam", ""), "games");
    }

    #[test]
    fn noise() {
        assert!(is_noise("Uninstall Foo", "C:\\foo\\unins000.exe"));
        assert!(is_noise("Foo Website", "https://foo.example"));
        assert!(is_noise("Lisez-moi", "C:\\foo\\readme.txt"));
        assert!(!is_noise("Foo", "C:\\foo\\foo.exe"));
    }

    #[test]
    fn steam_files() {
        let lib = "\"libraryfolders\"\n{\n\t\"0\"\n\t{\n\t\t\"path\"\t\t\"D:\\\\SteamLibrary\"\n\t}\n}";
        assert!(vdf_pairs(lib).contains(&("path".into(), "D:\\SteamLibrary".into())));
        let acf = "\"AppState\"\n{\n\t\"appid\"\t\t\"1091500\"\n\t\"name\"\t\t\"Cyberpunk 2077\"\n}";
        assert_eq!(steam_manifest(acf), Some(("1091500".into(), "Cyberpunk 2077".into())));
        let tool = "\"AppState\"\n{\n\t\"appid\"\t\t\"228980\"\n\t\"name\"\t\t\"Steamworks Common Redistributables\"\n}";
        assert_eq!(steam_manifest(tool), None);
    }

    #[test]
    fn epic() {
        let m = r#"{"DisplayName":"Alan Wake 2","AppName":"Dill","CatalogNamespace":"ns","CatalogItemId":"it","InstallLocation":"C:\\Games\\AW2","LaunchExecutable":"AlanWake2.exe","AppCategories":["public","games","applications"]}"#;
        let (app, name, url, exe) = epic_manifest(m).unwrap();
        assert_eq!((app.as_str(), name.as_str()), ("Dill", "Alan Wake 2"));
        assert_eq!(url, "com.epicgames.launcher://apps/ns%3Ait%3ADill?action=launch&silent=true");
        assert!(exe.ends_with("AlanWake2.exe"));
    }
}
