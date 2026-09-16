use crate::font_types::{FontFace, FontSource};
use crate::parser;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::Emitter;
use walkdir::WalkDir;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ScanProgress {
    pub done: usize,
    pub total: usize,
}

/// Parse cache: a full rescan re-reads thousands of files, but the watcher
/// fires on every save. Unchanged files (same size + mtime) reuse the faces
/// parsed last time instead of hitting the disk again.
struct CacheEntry {
    len: u64,
    mtime: Option<std::time::SystemTime>,
    faces: Vec<FontFace>,
}

static PARSE_CACHE: std::sync::OnceLock<Mutex<std::collections::HashMap<PathBuf, CacheEntry>>> =
    std::sync::OnceLock::new();

fn parse_cache() -> &'static Mutex<std::collections::HashMap<PathBuf, CacheEntry>> {
    PARSE_CACHE.get_or_init(|| Mutex::new(std::collections::HashMap::new()))
}

/// Default folder moved imports are stored in (per-user fonts on Windows).
pub fn managed_font_dir() -> PathBuf {
    #[cfg(target_os = "linux")]
    {
        dirs::data_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("fonts")
            .join("ZFontManager")
    }
    #[cfg(target_os = "macos")]
    {
        dirs::home_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("Library/Fonts")
    }
    #[cfg(target_os = "windows")]
    {
        dirs::data_local_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("Microsoft\\Windows\\Fonts")
    }
}

/// Effective library folder: the settings override when set, else the default.
pub fn effective_managed_dir(library_dir: Option<&str>) -> PathBuf {
    match library_dir.map(str::trim).filter(|s| !s.is_empty()) {
        Some(dir) => PathBuf::from(dir),
        None => managed_font_dir(),
    }
}

fn font_dirs() -> Vec<(PathBuf, FontSource)> {
    let mut dirs_list: Vec<(PathBuf, FontSource)> = Vec::new();
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));

    #[cfg(target_os = "linux")]
    {
        dirs_list.push((PathBuf::from("/usr/share/fonts"), FontSource::System));
        dirs_list.push((PathBuf::from("/usr/local/share/fonts"), FontSource::System));
        dirs_list.push((home.join(".local/share/fonts"), FontSource::User));
        dirs_list.push((home.join(".fonts"), FontSource::User));
    }
    #[cfg(target_os = "macos")]
    {
        dirs_list.push((PathBuf::from("/System/Library/Fonts"), FontSource::System));
        dirs_list.push((PathBuf::from("/Library/Fonts"), FontSource::System));
        dirs_list.push((home.join("Library/Fonts"), FontSource::User));
    }
    #[cfg(target_os = "windows")]
    {
        dirs_list.push((PathBuf::from("C:\\Windows\\Fonts"), FontSource::System));
        if let Some(local) = dirs::data_local_dir() {
            dirs_list.push((local.join("Microsoft\\Windows\\Fonts"), FontSource::User));
        }
        let _ = home;
    }

    dirs_list
}

fn classify(path: &std::path::Path, base_source: FontSource, managed: &Path) -> FontSource {
    if base_source == FontSource::User && path.starts_with(managed) {
        FontSource::Managed
    } else {
        base_source
    }
}

pub fn all_dirs(extra: &[String]) -> Vec<(PathBuf, FontSource)> {
    let mut dirs_list = font_dirs();
    for d in extra {
        dirs_list.push((PathBuf::from(d), FontSource::User));
    }
    dirs_list
}

pub fn scan_all(app: &tauri::AppHandle, extra: &[String], managed: &Path) -> Vec<FontFace> {
    let files: Vec<(PathBuf, FontSource)> = all_dirs(extra)
        .into_iter()
        .flat_map(|(dir, source)| {
            WalkDir::new(dir)
                .follow_links(true)
                .into_iter()
                .filter_map(|e| e.ok())
                .filter(|e| e.file_type().is_file())
                .map(move |e| (e.into_path(), source))
                .filter(|(p, _)| parser::is_font_file(p))
                .collect::<Vec<_>>()
        })
        .collect();

    let total = files.len();
    let mut seen: std::collections::HashSet<PathBuf> = std::collections::HashSet::with_capacity(total);
    let mut faces = Vec::with_capacity(total);
    for (done, (path, base_source)) in files.into_iter().enumerate() {
        seen.insert(path.clone());
        let source = classify(&path, base_source, managed);
        faces.extend(cached_parse(&path, source));
        if done % 25 == 0 || done + 1 == total {
            let _ = app.emit("scan:progress", ScanProgress { done: done + 1, total });
        }
    }
    prune_cache(&seen);

    faces.sort_by(|a, b| a.id.cmp(&b.id));
    faces.dedup_by(|a, b| a.id == b.id);
    faces
}

fn cached_parse(path: &Path, source: FontSource) -> Vec<FontFace> {
    let meta = std::fs::metadata(path).ok();
    let len = meta.as_ref().map(|m| m.len()).unwrap_or(0);
    let mtime = meta.and_then(|m| m.modified().ok());
    let key = path.to_path_buf();

    if let Ok(cache) = parse_cache().lock() {
        if let Some(entry) = cache.get(&key) {
            if entry.len == len && entry.mtime == mtime {
                // Cache hit: same bytes as last time. Re-apply `source`
                // because it depends on the current library-dir setting.
                let mut faces = entry.faces.clone();
                for f in &mut faces {
                    f.source = source;
                    f.deactivatable = crate::activation::can_deactivate(source);
                }
                return faces;
            }
        }
    }

    let faces = parser::parse_font_file(path, source);
    if let Ok(mut cache) = parse_cache().lock() {
        // Bound memory: a big library can hold tens of thousands of files.
        if cache.len() > 20_000 {
            cache.clear();
        }
        cache.insert(key, CacheEntry { len, mtime, faces: faces.clone() });
    }
    faces
}

/// Drop cache entries for files that no longer exist (e.g. after uninstall).
fn prune_cache(seen: &std::collections::HashSet<PathBuf>) {
    if let Ok(mut cache) = parse_cache().lock() {
        cache.retain(|path, _| seen.contains(path));
    }
}
