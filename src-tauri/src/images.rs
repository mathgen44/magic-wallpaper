//! Liste des images (carrousel) ou des vidéos (fond vidéo) d'un dossier local.

use std::path::Path;

const EXTS: &[&str] = &["jpg", "jpeg", "png", "gif", "webp", "bmp", "avif", "jfif"];
const VIDEO_EXTS: &[&str] = &["mp4", "m4v", "webm", "mov", "mkv"];
const MAX_FILES: usize = 5000;

fn walk(dir: &Path, recursive: bool, depth: u32, exts: &[&str], out: &mut Vec<String>) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        if out.len() >= MAX_FILES {
            return;
        }
        let path = entry.path();
        if path.is_dir() {
            if recursive && depth < 6 {
                walk(&path, recursive, depth + 1, exts, out);
            }
        } else if path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| exts.contains(&e.to_ascii_lowercase().as_str()))
            .unwrap_or(false)
        {
            out.push(path.to_string_lossy().to_string());
        }
    }
}

pub fn list(folder: &str, recursive: bool) -> Vec<String> {
    let mut out = Vec::new();
    walk(Path::new(folder), recursive, 0, EXTS, &mut out);
    out.sort();
    out
}

/// Vidéos d'un dossier (non récursif).
pub fn list_videos(folder: &str) -> Vec<String> {
    let mut out = Vec::new();
    walk(Path::new(folder), false, 0, VIDEO_EXTS, &mut out);
    out.sort();
    out
}
