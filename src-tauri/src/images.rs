//! Liste des images d'un dossier local pour le carrousel.

use std::path::Path;

const EXTS: &[&str] = &["jpg", "jpeg", "png", "gif", "webp", "bmp", "avif", "jfif"];
const MAX_FILES: usize = 5000;

fn walk(dir: &Path, recursive: bool, depth: u32, out: &mut Vec<String>) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        if out.len() >= MAX_FILES {
            return;
        }
        let path = entry.path();
        if path.is_dir() {
            if recursive && depth < 6 {
                walk(&path, recursive, depth + 1, out);
            }
        } else if path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| EXTS.contains(&e.to_ascii_lowercase().as_str()))
            .unwrap_or(false)
        {
            out.push(path.to_string_lossy().to_string());
        }
    }
}

pub fn list(folder: &str, recursive: bool) -> Vec<String> {
    let mut out = Vec::new();
    walk(Path::new(folder), recursive, 0, &mut out);
    out.sort();
    out
}
