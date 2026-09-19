use crate::parser;
use notify::{Event, RecursiveMode, Watcher};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::Emitter;

pub struct WatchHandle(pub Mutex<Option<notify::RecommendedWatcher>>);

/// Paths the app itself has just written. Files land in the library as part of
/// an action (install, activation, Google style install) whose result is
/// already known: rescanning the whole library for them is pure waste, and it
/// is exactly what made style activation feel like two full scans in a row.
type SelfChangeSet = std::sync::Mutex<std::collections::HashSet<PathBuf>>;

fn self_change() -> &'static SelfChangeSet {
    static CELL: std::sync::OnceLock<SelfChangeSet> = std::sync::OnceLock::new();
    CELL.get_or_init(|| std::sync::Mutex::new(std::collections::HashSet::new()))
}

/// Marks a path as written by the app itself, so the arriving filesystem event
/// is swallowed instead of triggering a rescan.
pub fn own_write(path: &std::path::Path) {
    if let Ok(mut set) = self_change().lock() {
        set.insert(path.to_path_buf());
    }
}

/// True when the event belongs to a file the app just wrote itself.
fn is_own(path: &std::path::Path) -> bool {
    self_change()
        .lock()
        .map(|mut set| set.remove(path))
        .unwrap_or(false)
}

pub fn start(
    app: tauri::AppHandle,
    dirs: Vec<PathBuf>,
) -> Result<notify::RecommendedWatcher, String> {
    let mut watcher = notify::recommended_watcher(move |res: Result<Event, notify::Error>| {
        let Ok(event) = res else { return };

        let mutating = event.kind.is_create() || event.kind.is_modify() || event.kind.is_remove();
        if mutating && event.paths.iter().any(|p| parser::is_font_file(p) && !is_own(p)) {
            let _ = app.emit("fonts:changed", ());
        }
    })
    .map_err(|e| e.to_string())?;

    for dir in dirs {
        if dir.is_dir() {
            let _ = watcher.watch(&dir, RecursiveMode::Recursive);
        }
    }
    Ok(watcher)
}
