mod activation;
mod adobe;
mod affinity;
mod font_types;
mod google_fonts;
mod installer;
mod parser;
mod preview;
mod registry;
mod scanner;
mod sound;
mod store;
mod watcher;

use font_types::{FontFace, FontSource, TrashEntry};
use serde::Serialize;
use std::collections::HashMap;
use store::Store;
use tauri::{Emitter, Manager, State};

/// Faces from a completed scan, shared behind an `Arc` so handing them around
/// is a pointer copy. The cache lock is therefore held only for that copy, not
/// during a deep clone of every face in the library. Serializes as the plain
/// face array, so the shape the frontend receives is unchanged.
#[derive(Clone)]
pub struct FontSnapshot(std::sync::Arc<Vec<FontFace>>);

impl FontSnapshot {
    fn new(faces: Vec<FontFace>) -> Self {
        Self(std::sync::Arc::new(faces))
    }

    /// A private copy of the faces, so a caller can modify them (activation
    /// stamping) without touching what the cache hands out.
    fn owned(&self) -> Vec<FontFace> {
        (*self.0).clone()
    }
}

impl Serialize for FontSnapshot {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        self.0.as_slice().serialize(serializer)
    }
}

/// Cached scan result plus the error of the last finished scan. Held in one
/// place so a waiter can tell "the scan I was waiting for failed" apart from
/// "a fresh snapshot landed" — previously a failed scan silently served the
/// stale library as if the rescan had succeeded.
struct ScanState {
    snapshot: Option<FontSnapshot>,
    error: Option<String>,
}

fn scan_state() -> &'static std::sync::Mutex<ScanState> {
    static CELL: std::sync::OnceLock<std::sync::Mutex<ScanState>> = std::sync::OnceLock::new();
    CELL.get_or_init(|| {
        std::sync::Mutex::new(ScanState {
            snapshot: None,
            error: None,
        })
    })
}

/// Single-flight guard for library scans. An async mutex rather than an atomic
/// flag on purpose: if the task that holds it is dropped mid-scan (webview
/// reload, panic, shutdown), the runtime releases the guard, so the next caller
/// can still scan instead of waiting forever on a flag nobody resets.
fn scan_lock() -> &'static tokio::sync::Mutex<()> {
    static CELL: std::sync::OnceLock<tokio::sync::Mutex<()>> = std::sync::OnceLock::new();
    CELL.get_or_init(|| tokio::sync::Mutex::new(()))
}

/// Completion counter of scans. A caller that arrived while a scan was already
/// running waits here until the counter advances instead of scanning the whole
/// library a second time. The counter also advances on failure, so waiters are
/// never left blocked on a scan that is already over.
fn scan_watch() -> &'static tokio::sync::watch::Sender<u64> {
    static CELL: std::sync::OnceLock<tokio::sync::watch::Sender<u64>> = std::sync::OnceLock::new();
    CELL.get_or_init(|| tokio::sync::watch::channel(0u64).0)
}

/// How long a caller waits for an in-flight scan before concluding it is dead
/// and running its own. Generous: a large library on a slow drive may take a
/// while, and giving up early would only duplicate the work.
const SCAN_WAIT_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(120);

/// Re-applies the current activation state to faces served from the cache:
/// activations may have changed since the scan completed. The copy happens off
/// the async runtime thread and without holding the cache lock, since a library
/// can hold tens of thousands of faces.
async fn stamp_active(app: &tauri::AppHandle, snap: FontSnapshot) -> Result<FontSnapshot, String> {
    let probe = activation::probe();
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || -> Result<FontSnapshot, String> {
        let store: State<Store> = app.state();
        let state = store.0.lock().map_err(|e| e.to_string())?;
        let mut faces = snap.owned();
        for f in &mut faces {
            f.active = activation::is_active(&probe, &state, &f);
        }
        Ok(FontSnapshot::new(faces))
    })
    .await
    .map_err(|e| e.to_string())?
}

async fn scan_all_faces(app: &tauri::AppHandle) -> Result<Vec<FontFace>, String> {
    let (extra, library_dir, linked) = {
        let store: State<Store> = app.state();
        let state = store.0.lock().map_err(|e| e.to_string())?;
        (
            state.extra_dirs.clone(),
            state.active_library_dir().map(|s| s.to_owned()),
            state.linked.clone(),
        )
    };
    let managed = scanner::effective_managed_dir(library_dir.as_deref());
    let mut faces = tauri::async_runtime::spawn_blocking({
        let app = app.clone();
        move || scanner::scan_all(&app, &extra, &managed)
    })
    .await
    .map_err(|e| e.to_string())?;

    // Linked fonts live outside the scanned dirs: parse them in place.
    // A linked file keeps its library (managed) identity over a scanned hit.
    let mut linked_faces = Vec::new();
    for path in &linked {
        let p = std::path::Path::new(path);
        if !p.is_file() {
            continue;
        }
        linked_faces.extend(parser::parse_font_file(p, FontSource::Managed));
    }
    if !linked_faces.is_empty() {
        let ids: std::collections::HashSet<&str> =
            linked_faces.iter().map(|f| f.id.as_str()).collect();
        faces.retain(|f| !ids.contains(f.id.as_str()));
        faces.extend(linked_faces);
    }

    let probe = activation::probe();
    let store: State<Store> = app.state();
    let mut state = store.0.lock().map_err(|e| e.to_string())?;
    // Drop links whose file is gone.
    let before = state.linked.len();
    state.linked.retain(|p| std::path::Path::new(p).is_file());
    if state.linked.len() != before {
        let _ = store::save(&state);
    }
    if google_fonts::retain_installed(&mut state) {
        let _ = store::save(&state);
    }
    google_fonts::decorate_faces(&mut faces);
    let mut faces: Vec<FontFace> = faces
        .into_iter()
        .map(|mut f| {
            // A Google font installed from the catalogue lives in the ordinary
            // library folder, so the folder cannot say where it came from: the
            // recorded path does. (The file has to be there - on macOS a font
            // in any other directory is invisible to the system.)
            if google_fonts::is_installed_path(&state, &f.path) {
                f.source = FontSource::Google;
            }
            f.active = activation::is_active(&probe, &state, &f);
            f
        })
        .collect();

    for (orig, parked) in &state.parked {
        for mut f in parser::parse_font_file(std::path::Path::new(parked), FontSource::User) {
            f.id = format!("{}#{}", orig, f.face_index);
            f.path = orig.clone();
            f.preview_path = Some(parked.clone());
            f.active = false;
            faces.push(f);
        }
    }
    Ok(faces)
}

/// Runs a full scan. Caller must hold [`scan_lock`], which keeps the library
/// from being walked twice at once. Publishes the result in the shared cache;
/// command callers receive that snapshot directly. Avoid also emitting the
/// full library to the WebView because that duplicates a large serialized
/// payload and the frontend no longer consumes the old `fonts:ready` event.
async fn run_scan(app: &tauri::AppHandle) -> Result<FontSnapshot, String> {
    let out = match scan_all_faces(app).await {
        Ok(faces) => {
            let snap = FontSnapshot::new(faces);
            if let Ok(mut state) = scan_state().lock() {
                state.snapshot = Some(snap.clone());
                state.error = None;
            }
            Ok(snap)
        }
        Err(e) => {
            if let Ok(mut state) = scan_state().lock() {
                state.error = Some(e.clone());
            }
            // Tell the frontend that no snapshot is coming, so it does not sit
            // on its skeleton until its own timeout expires.
            let _ = app.emit("fonts:failed", &e);
            Err(e)
        }
    };
    let gen = *scan_watch().borrow();
    let _ = scan_watch().send(gen + 1);
    // Hand the parse cache to the next run on its own thread: whatever this
    // scan parsed or pruned is worth keeping, and never worth delaying the
    // result the UI is waiting for.
    scanner::save_disk_cache();
    out
}

/// Single-flight scan: either performs the full scan (holding the scan lock) or
/// waits for the one already in flight and serves its snapshot, so the library
/// is never read twice at the same time.
async fn scan_coalesced(app: &tauri::AppHandle) -> Result<FontSnapshot, String> {
    let mut rx = scan_watch().subscribe();
    let start_gen = *rx.borrow();
    // try_lock: nothing is scanning, so this caller does the work.
    if let Ok(_guard) = scan_lock().try_lock() {
        return run_scan(app).await;
    }
    // A scan is already in flight (usually the startup one): wait for its
    // completion instead of walking every file a second time. The timeout is
    // the safety net — a waiter must never block forever on a scan that died.
    let finished = loop {
        match tokio::time::timeout(SCAN_WAIT_TIMEOUT, rx.changed()).await {
            Ok(Ok(())) => {
                if *rx.borrow() > start_gen {
                    break true;
                }
            }
            Ok(Err(_)) => break false,
            Err(_elapsed) => break false,
        }
    };
    if finished {
        // Take what the waiter needs out of the state and release the lock
        // before the first await — a std MutexGuard must not live across one.
        enum Outcome {
            Failed(String),
            Ready(FontSnapshot),
            Empty,
        }
        let outcome = {
            let state = scan_state().lock().map_err(|e| e.to_string())?;
            // Failures are reported as failures: serving the previous library
            // here would make a broken rescan look successful.
            if let Some(err) = &state.error {
                Outcome::Failed(err.clone())
            } else if let Some(snap) = &state.snapshot {
                Outcome::Ready(snap.clone())
            } else {
                Outcome::Empty
            }
        };
        match outcome {
            Outcome::Failed(err) => return Err(err),
            Outcome::Ready(snap) => return stamp_active(app, snap).await,
            Outcome::Empty => {}
        }
    }
    // No result and no scan running: the lock is free, so the scan we waited
    // for is gone. Recover by scanning instead of reporting a stale failure.
    if let Ok(_guard) = scan_lock().try_lock() {
        return run_scan(app).await;
    }
    Err("scan timed out".into())
}

#[tauri::command]
async fn scan_fonts(app: tauri::AppHandle) -> Result<FontSnapshot, String> {
    // Explicit refreshes must start after the request, not reuse a scan that
    // may have walked the changed directory before the mutation occurred.
    let _guard = scan_lock().lock().await;
    run_scan(&app).await
}

#[tauri::command]
async fn initial_fonts(app: tauri::AppHandle) -> Result<FontSnapshot, String> {
    // Acquiring the startup lock avoids event registration races and arbitrary
    // timeouts. A completed startup (including an empty library) is reusable.
    let guard = scan_lock().lock().await;
    let (snapshot, error) = {
        let state = scan_state().lock().map_err(|e| e.to_string())?;
        (state.snapshot.clone(), state.error.clone())
    };
    if let Some(error) = error {
        return Err(error);
    }
    if let Some(snapshot) = snapshot {
        drop(guard);
        return stamp_active(&app, snapshot).await;
    }
    run_scan(&app).await
}

/// The library recovered from the previous run's on-disk cache. Lets the UI
/// paint immediately on a cold start; a real scan follows and replaces it, so
/// what arrives here may be missing files added since the cache was written.
#[tauri::command]
async fn warm_fonts(app: tauri::AppHandle) -> Result<Option<FontSnapshot>, String> {
    let library_dir = {
        let store: State<Store> = app.state();
        let state = store.0.lock().map_err(|e| e.to_string())?;
        state.active_library_dir().map(|s| s.to_owned())
    };
    let managed = scanner::effective_managed_dir(library_dir.as_deref());
    let faces = tauri::async_runtime::spawn_blocking(move || scanner::warm_faces(&managed))
        .await
        .map_err(|e| e.to_string())?;
    if faces.is_empty() {
        return Ok(None);
    }
    Ok(Some(stamp_active(&app, FontSnapshot::new(faces)).await?))
}

/// The last completed scan result, if any. Lets the frontend show the
/// library instantly at startup instead of staring at a skeleton.
#[tauri::command]
async fn peek_fonts(app: tauri::AppHandle) -> Result<Option<FontSnapshot>, String> {
    let cached = scan_state()
        .lock()
        .map_err(|e| e.to_string())?
        .snapshot
        .clone();
    match cached {
        Some(snap) => Ok(Some(stamp_active(&app, snap).await?)),
        None => Ok(None),
    }
}

#[tauri::command]
fn set_font_active(store: State<Store>, path: String, active: bool) -> Result<(), String> {
    let mut state = store.0.lock().map_err(|e| e.to_string())?;
    activation::sync(&mut state, &path, active)?;
    store::save(&state)
}

#[tauri::command]
fn set_fonts_active(store: State<Store>, paths: Vec<String>, active: bool) -> Result<(), String> {
    let mut state = store.0.lock().map_err(|e| e.to_string())?;

    activation::sync_many(&mut state, &paths, active)?;
    store::save(&state)
}

#[tauri::command]
async fn install_fonts(
    app: tauri::AppHandle,
    store: State<'_, Store>,
    paths: Vec<String>,
    existing: Vec<String>,
    mode: String,
) -> Result<installer::InstallResult, String> {
    let mode = installer::InstallMode::parse(&mode)?;
    let library_dir = {
        let state = store.0.lock().map_err(|e| e.to_string())?;
        state.active_library_dir().map(|s| s.to_owned())
    };
    let library = scanner::effective_managed_dir(library_dir.as_deref());
    let known: std::collections::HashSet<String> = existing.into_iter().collect();
    let scope_app = app.clone();
    let mut result = tauri::async_runtime::spawn_blocking(move || {
        installer::install(&app, paths, &known, mode, &library)
    })
    .await
    .map_err(|e| e.to_string())?;
    // New fonts start deactivated on every OS: run them through the regular
    // deactivate path so a later toggle can bring them back.
    // The Settings toggle can opt back into auto-activation for small batches.
    let mut auto = false;
    if let Ok(mut state) = store.0.lock() {
        if mode == installer::InstallMode::Link {
            for face in &result.installed {
                state.linked.insert(face.path.clone());
            }
        }
        auto = state.auto_activate_imports && result.installed.len() < 64;
        // One platform commit for the whole batch (Linux: single fc-cache run).
        let paths: Vec<String> = result.installed.iter().map(|f| f.path.clone()).collect();
        let _ = activation::sync_many(&mut state, &paths, auto);
        let _ = store::save(&state);
    }
    // Previews load through the asset protocol: allow the folders new files live in.
    for face in &result.installed {
        let p = std::path::Path::new(&face.path);
        if let Some(parent) = p.parent() {
            allow_dir(&scope_app, parent);
        }
    }
    // Report the activation state that was actually applied above: with
    // auto-activation on these fonts are registered already, otherwise they
    // are deactivated and a later toggle can bring them back.
    for face in &mut result.installed {
        face.active = auto;
    }
    Ok(result)
}

#[tauri::command]
fn uninstall_font(store: State<Store>, path: String, family: String) -> Result<TrashEntry, String> {
    {
        let mut state = store.0.lock().map_err(|e| e.to_string())?;
        if state.deactivated.contains(&path) {
            activation::sync(&mut state, &path, true)?;
            store::save(&state)?;
        }
        if state.linked.contains(&path) {
            // Linked file: never touch the original, only unregister.
            let entry = installer::unlink(&path, &family)?;
            state.linked.remove(&path);
            store::save(&state)?;
            return Ok(entry);
        }
    }
    installer::uninstall(&path, &family)
}

#[tauri::command]
fn list_trash() -> Vec<TrashEntry> {
    installer::list_trash()
}

#[tauri::command]
async fn affinity_connection() -> Result<affinity::AffinityConnection, String> {
    Ok(affinity::connection().await)
}

#[tauri::command]
fn affinity_session_activate(
    store: State<Store>,
    paths: Vec<String>,
) -> Result<Vec<String>, String> {
    let mut state = store.0.lock().map_err(|e| e.to_string())?;
    let mut activated = Vec::with_capacity(paths.len());
    let mut seen: std::collections::HashSet<&str> =
        std::collections::HashSet::with_capacity(paths.len());
    for path in &paths {
        if seen.insert(path.as_str()) {
            activated.push(path.clone());
        }
    }
    activation::sync_many(&mut state, &activated, true)?;
    store::save(&state)?;
    affinity::note_activated(activated.clone());
    Ok(activated)
}

#[tauri::command]
fn restore_from_trash(store: State<Store>, entry_id: String) -> Result<(), String> {
    match installer::restore(&entry_id)? {
        installer::RestoreOutcome::Moved => Ok(()),
        installer::RestoreOutcome::Relinked(path) => {
            let mut state = store.0.lock().map_err(|e| e.to_string())?;
            state.linked.insert(path);
            store::save(&state)
        }
    }
}

#[tauri::command]
fn delete_trash_entry(entry_id: String) -> Result<(), String> {
    installer::delete_trash_entry(&entry_id)
}

#[tauri::command]
fn empty_trash() -> Result<(), String> {
    installer::empty_trash()
}

#[tauri::command]
fn get_tags(store: State<Store>) -> Result<HashMap<String, Vec<String>>, String> {
    let state = store.0.lock().map_err(|e| e.to_string())?;
    Ok(state.tags.clone())
}

#[tauri::command]
fn get_protected_tags(store: State<Store>) -> Result<Vec<String>, String> {
    let state = store.0.lock().map_err(|e| e.to_string())?;
    Ok(state.protected_tags.iter().cloned().collect())
}

#[tauri::command]
fn set_tags(store: State<Store>, family: String, tags: Vec<String>) -> Result<(), String> {
    let mut state = store.0.lock().map_err(|e| e.to_string())?;
    let protected = state
        .tags
        .get(&family)
        .into_iter()
        .flatten()
        .filter(|tag| state.protected_tags.contains(*tag))
        .cloned()
        .collect::<Vec<_>>();
    let mut tags = tags;
    for tag in protected {
        if !tags.contains(&tag) {
            tags.push(tag);
        }
    }
    if tags.is_empty() {
        state.tags.remove(&family);
    } else {
        state.tags.insert(family, tags);
    }
    store::save(&state)
}

#[tauri::command]
fn get_collections(store: State<Store>) -> Result<HashMap<String, Vec<String>>, String> {
    let state = store.0.lock().map_err(|e| e.to_string())?;
    Ok(state.collections.clone())
}

#[tauri::command]
fn set_collection(store: State<Store>, name: String, families: Vec<String>) -> Result<(), String> {
    let mut state = store.0.lock().map_err(|e| e.to_string())?;
    state.collections.insert(name, families);
    store::save(&state)
}

#[tauri::command]
fn delete_collection(store: State<Store>, name: String) -> Result<(), String> {
    let mut state = store.0.lock().map_err(|e| e.to_string())?;
    state.collections.remove(&name);
    store::save(&state)
}

#[tauri::command]
fn rename_collection(store: State<Store>, from: String, to: String) -> Result<(), String> {
    let mut state = store.0.lock().map_err(|e| e.to_string())?;
    if state.collections.contains_key(&to) {
        return Err(format!("a collection named \"{to}\" already exists"));
    }
    let families = state
        .collections
        .remove(&from)
        .ok_or_else(|| format!("collection \"{from}\" not found"))?;
    state.collections.insert(to, families);
    store::save(&state)
}

#[tauri::command]
fn play_sound(kind: String, level: String) {
    sound::play(&kind, &level);
}

#[tauri::command]
fn get_notes(store: State<Store>) -> Result<HashMap<String, String>, String> {
    let state = store.0.lock().map_err(|e| e.to_string())?;
    Ok(state.notes.clone())
}

#[tauri::command]
fn set_note(store: State<Store>, family: String, note: String) -> Result<(), String> {
    let mut state = store.0.lock().map_err(|e| e.to_string())?;
    if note.trim().is_empty() {
        state.notes.remove(&family);
    } else {
        state.notes.insert(family, note);
    }
    store::save(&state)
}

#[tauri::command]
fn get_favorites(store: State<Store>) -> Result<Vec<String>, String> {
    let state = store.0.lock().map_err(|e| e.to_string())?;
    Ok(state.favorites.iter().cloned().collect())
}

#[tauri::command]
fn set_favorite(store: State<Store>, family: String, favorite: bool) -> Result<(), String> {
    let mut state = store.0.lock().map_err(|e| e.to_string())?;
    if favorite {
        state.favorites.insert(family);
    } else {
        state.favorites.remove(&family);
    }
    store::save(&state)
}

#[tauri::command]
fn get_charset(path: String, face_index: u32) -> Result<Vec<u32>, String> {
    let (data, _) = parser::read_font_bytes(std::path::Path::new(&path))?;
    let face = ttf_parser::Face::parse(&data, face_index).map_err(|e| e.to_string())?;
    let mut cps: Vec<u32> = Vec::new();
    if let Some(cmap) = face.tables().cmap {
        for sub in cmap.subtables {
            if !sub.is_unicode() {
                continue;
            }
            sub.codepoints(|cp| {
                if cp > 0x20 && cp != 0x7f {
                    cps.push(cp);
                }
            });
        }
    }
    cps.sort_unstable();
    cps.dedup();
    cps.truncate(4096);
    Ok(cps)
}

#[tauri::command]
fn export_font(src: String, dest: String) -> Result<(), String> {
    std::fs::copy(&src, &dest)
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn write_text_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, content).map_err(|e| e.to_string())
}

#[tauri::command]
fn read_text_file(path: String) -> Result<String, String> {
    let meta = std::fs::metadata(&path).map_err(|e| e.to_string())?;
    if meta.len() > 8 * 1024 * 1024 {
        return Err("file is too large to be a library export".into());
    }
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

static SESSION_ACTIVATED: std::sync::Mutex<Vec<String>> = std::sync::Mutex::new(Vec::new());

#[tauri::command]
fn set_fonts_active_session(store: State<Store>, paths: Vec<String>) -> Result<(), String> {
    let mut state = store.0.lock().map_err(|e| e.to_string())?;
    // Best effort: keep every path that applied cleanly in the session list.
    let mut activated: Vec<String> = Vec::with_capacity(paths.len());
    let mut seen: std::collections::HashSet<&str> =
        std::collections::HashSet::with_capacity(paths.len());
    for path in &paths {
        if !seen.insert(path.as_str()) {
            continue;
        }
        match activation::sync(&mut state, path, true) {
            Ok(()) => activated.push(path.clone()),
            Err(e) => {
                store::save(&state)?;
                if let Ok(mut session) = SESSION_ACTIVATED.lock() {
                    session.extend(activated);
                }
                return Err(e);
            }
        }
    }
    store::save(&state)?;
    if let Ok(mut session) = SESSION_ACTIVATED.lock() {
        session.extend(activated);
    }
    Ok(())
}

fn revert_session_activations(app: &tauri::AppHandle) {
    use tauri::Manager;
    let paths: Vec<String> = match SESSION_ACTIVATED.lock() {
        Ok(mut s) => std::mem::take(&mut *s),
        Err(_) => return,
    };
    if paths.is_empty() {
        return;
    }
    let store = app.state::<Store>();
    let mut guard = match store.0.lock() {
        Ok(g) => g,
        Err(_) => return,
    };
    // Single platform commit for the whole session revert.
    let _ = activation::sync_many(&mut guard, &paths, false);
    affinity::revert_session(&mut guard);
    let _ = store::save(&guard);
}

#[tauri::command]
fn write_binary_file(path: String, data_base64: String) -> Result<(), String> {
    // Base64 arrives as ~1.37x the file size; a JSON number array would be
    // ~4x and stall the UI on multi-MB specimen PNGs.
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut rev = [u8::MAX; 256];
    for (i, &c) in TABLE.iter().enumerate() {
        rev[c as usize] = i as u8;
    }
    let clean: Vec<u8> = data_base64
        .bytes()
        .filter(|&b| b != b'=' && !b.is_ascii_whitespace())
        .collect();
    let mut out: Vec<u8> = Vec::with_capacity(clean.len() * 3 / 4);
    for chunk in clean.chunks(4) {
        let mut n: u32 = 0;
        for &c in chunk {
            let v = rev[c as usize];
            if v == u8::MAX {
                return Err("invalid base64 data".into());
            }
            n = (n << 6) | v as u32;
        }
        let pad = 4 - chunk.len();
        n <<= pad * 6;
        out.push((n >> 16) as u8);
        if pad < 2 {
            out.push((n >> 8) as u8);
        }
        if pad < 1 {
            out.push(n as u8);
        }
    }
    std::fs::write(&path, out).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_features(path: String, face_index: u32) -> Result<Vec<String>, String> {
    let (data, _) = parser::read_font_bytes(std::path::Path::new(&path))?;
    let face = ttf_parser::Face::parse(&data, face_index).map_err(|e| e.to_string())?;
    let mut tags: Vec<String> = Vec::new();
    let mut collect = |table: Option<ttf_parser::opentype_layout::LayoutTable>| {
        if let Some(t) = table {
            for f in t.features {
                tags.push(String::from_utf8_lossy(&f.tag.to_bytes()).into_owned());
            }
        }
    };
    collect(face.tables().gsub);
    collect(face.tables().gpos);
    tags.sort_unstable();
    tags.dedup();
    Ok(tags)
}

#[tauri::command]
fn export_fonts(paths: Vec<String>, dest_dir: String) -> Result<u32, String> {
    let dir = std::path::Path::new(&dest_dir);
    if !dir.is_dir() {
        return Err("destination is not a directory".into());
    }
    let mut n = 0;
    for p in paths {
        let src = std::path::Path::new(&p);
        let name = src.file_name().ok_or("invalid font path")?;
        std::fs::copy(src, dir.join(name)).map_err(|e| e.to_string())?;
        n += 1;
    }
    Ok(n)
}

#[derive(serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct Settings {
    extra_dirs: Vec<String>,
    watch_enabled: bool,
    auto_activate_imports: bool,
    library_dir: Option<String>,
    library_dir_enabled: bool,
    affinity_enabled: bool,
    affinity_deactivate_on_quit: bool,
    #[serde(default = "default_google_fonts_enabled")]
    google_fonts_enabled: bool,
}

fn default_google_fonts_enabled() -> bool {
    true
}

#[tauri::command]
fn get_settings(store: State<Store>) -> Result<Settings, String> {
    let state = store.0.lock().map_err(|e| e.to_string())?;
    Ok(Settings {
        extra_dirs: state.extra_dirs.clone(),
        watch_enabled: state.watch_enabled,
        auto_activate_imports: state.auto_activate_imports,
        library_dir: state.library_dir.clone(),
        library_dir_enabled: state.library_dir_enabled,
        affinity_enabled: state.affinity_enabled,
        affinity_deactivate_on_quit: state.affinity_deactivate_on_quit,
        google_fonts_enabled: state.google_fonts_enabled,
    })
}

#[tauri::command]
fn set_settings(
    app: tauri::AppHandle,
    store: State<Store>,
    settings: Settings,
) -> Result<(), String> {
    {
        let mut state = store.0.lock().map_err(|e| e.to_string())?;
        state.extra_dirs = settings.extra_dirs.clone();
        state.watch_enabled = settings.watch_enabled;
        state.auto_activate_imports = settings.auto_activate_imports;
        state.library_dir = settings.library_dir.clone();
        state.library_dir_enabled = settings.library_dir_enabled;
        state.affinity_enabled = settings.affinity_enabled;
        state.affinity_deactivate_on_quit = settings.affinity_deactivate_on_quit;
        state.google_fonts_enabled = settings.google_fonts_enabled;
        store::save(&state)?;
    }
    allow_dir(
        &app,
        &scanner::effective_managed_dir(
            settings
                .library_dir_enabled
                .then(|| settings.library_dir.as_deref())
                .flatten(),
        ),
    );
    allow_previews(&app, &settings.extra_dirs);
    apply_watch(&app, settings.watch_enabled, &settings.extra_dirs)
}

#[tauri::command]
fn default_library_dir() -> String {
    scanner::managed_font_dir().to_string_lossy().into_owned()
}

fn allow_dir(app: &tauri::AppHandle, dir: &std::path::Path) {
    let dir = std::fs::canonicalize(dir).unwrap_or_else(|_| dir.to_path_buf());
    let _ = app.asset_protocol_scope().allow_directory(&dir, true);
}

fn allow_previews(app: &tauri::AppHandle, extra: &[String]) {
    let scope = app.asset_protocol_scope();
    for (dir, _) in scanner::all_dirs(extra) {
        let dir = std::fs::canonicalize(&dir).unwrap_or(dir);
        let _ = scope.allow_directory(&dir, true);
    }
}

fn apply_watch(app: &tauri::AppHandle, enabled: bool, extra: &[String]) -> Result<(), String> {
    let handle: State<watcher::WatchHandle> = app.state();
    let mut slot = handle.0.lock().map_err(|e| e.to_string())?;
    *slot = None;
    if enabled {
        let dirs = scanner::all_dirs(extra)
            .into_iter()
            .map(|(d, _)| d)
            .collect();
        *slot = Some(watcher::start(app.clone(), dirs)?);
    }
    Ok(())
}

#[tauri::command]
fn get_prefs(store: State<Store>) -> Result<serde_json::Value, String> {
    let state = store.0.lock().map_err(|e| e.to_string())?;
    Ok(state.prefs.clone())
}

#[tauri::command]
fn set_prefs(store: State<Store>, prefs: serde_json::Value) -> Result<(), String> {
    let mut state = store.0.lock().map_err(|e| e.to_string())?;
    state.prefs = prefs;
    store::save(&state)
}

#[tauri::command]
fn adobe_available() -> bool {
    adobe::available()
}

#[tauri::command]
async fn apply_font_in_app(
    app: String,
    postscript_name: String,
    label: String,
) -> Result<String, String> {
    let target = adobe::Target::parse(&app)?;
    tauri::async_runtime::spawn_blocking(move || adobe::apply(target, &postscript_name, &label))
        .await
        .map_err(|e| e.to_string())?
}

/// The catalogue: every family Google Fonts offers, metadata only. Browsing it
/// costs no download at all.
#[tauri::command]
fn google_catalog() -> Vec<google_fonts::GoogleFontFamily> {
    google_fonts::catalog()
}

/// Checks the catalogue for new families. Returns how many were added.
#[tauri::command]
async fn refresh_google_catalog(app: tauri::AppHandle) -> Result<usize, String> {
    google_fonts::refresh(app).await
}

/// The desktop styles of one family, with its licence name.
#[tauri::command]
async fn google_styles(
    app: tauri::AppHandle,
    family: String,
) -> Result<google_fonts::GoogleFamilyInfo, String> {
    google_fonts::styles(&app, &family).await
}

/// Web fonts for the preview on screen, fetched on demand and cached.
#[tauri::command]
async fn google_preview(
    app: tauri::AppHandle,
    family: String,
    style: String,
) -> Result<Vec<google_fonts::PreviewFile>, String> {
    google_fonts::preview(app, family, style).await
}

/// Installs a style's desktop file into the library and activates it.
#[tauri::command]
async fn install_google_font(
    app: tauri::AppHandle,
    family: String,
    styles: Vec<String>,
) -> Result<google_fonts::GoogleInstallResult, String> {
    google_fonts::install(app, family, styles).await
}

#[tauri::command]
fn google_cache_bytes() -> u64 {
    google_fonts::cache_bytes()
}

/// The standalone preview file of one face of a collection, generated on first
/// request. `None` when the file is not a collection or the face cannot be
/// written out small enough for the renderer.
#[tauri::command]
fn face_preview_asset(path: String, face_index: u32) -> Option<preview::PreviewAsset> {
    preview::asset_for(std::path::Path::new(&path), face_index)
}

#[tauri::command]
fn clear_google_cache() -> Result<u64, String> {
    google_fonts::clear_cache()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut state = store::load();
    activation::reconcile(&mut state);

    let watch_enabled = state.watch_enabled;
    let extra_dirs = state.extra_dirs.clone();
    let library_dir = state.active_library_dir().map(|s| s.to_owned());
    let linked_dirs: Vec<String> = state.linked.iter().cloned().collect();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(Store(std::sync::Mutex::new(state)))
        .manage(watcher::WatchHandle(std::sync::Mutex::new(None)))
        .setup(move |app| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.center();
                let _ = window.show();
                let _ = window.set_focus();
            }
            allow_previews(app.handle(), &extra_dirs);
            // The preview cache is served to the webview through the asset
            // protocol, so its folder has to be in scope.
            allow_dir(app.handle(), &google_fonts::preview_dir());
            // Single-face preview files generated for font collections live
            // next to them, and are served the same way. They accumulate only
            // for what was actually looked at, so the folder is trimmed here
            // once per start instead of costing a check on every request.
            allow_dir(app.handle(), &preview::preview_dir());
            std::thread::spawn(preview::prune);
            // Clean up the version 1 Google Fonts mirror in the background: it
            // had downloaded a full TTF per family just to draw previews.
            let migrate_app = app.handle().clone();
            std::thread::spawn(move || google_fonts::migrate(&migrate_app));
            allow_dir(
                app.handle(),
                &scanner::effective_managed_dir(library_dir.as_deref()),
            );
            for path in &linked_dirs {
                if let Some(parent) = std::path::Path::new(path).parent() {
                    allow_dir(app.handle(), parent);
                }
            }
            if watch_enabled {
                let _ = apply_watch(app.handle(), true, &extra_dirs);
            }
            // Affinity watcher: session-activate doc fonts while it runs.
            let affinity_app = app.handle().clone();
            std::thread::spawn(move || loop {
                affinity::tick(&affinity_app);
                std::thread::sleep(std::time::Duration::from_secs(2));
            });
            // Scan the library in the background right away: by the time the
            // webview finishes loading, the result is usually cached and the
            // UI can start from it instead of a skeleton. scan_coalesced joins
            // a scan that is already in flight instead of starting a second.
            let scan_app = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let _ = scan_coalesced(&scan_app).await;
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            scan_fonts,
            peek_fonts,
            initial_fonts,
            warm_fonts,
            face_preview_asset,
            set_font_active,
            set_fonts_active,
            set_fonts_active_session,
            install_fonts,
            uninstall_font,
            list_trash,
            affinity_connection,
            affinity_session_activate,
            restore_from_trash,
            delete_trash_entry,
            empty_trash,
            get_tags,
            get_protected_tags,
            set_tags,
            get_collections,
            set_collection,
            delete_collection,
            rename_collection,
            export_font,
            export_fonts,
            write_text_file,
            read_text_file,
            write_binary_file,
            get_features,
            get_favorites,
            set_favorite,
            get_notes,
            set_note,
            play_sound,
            get_charset,
            get_prefs,
            set_prefs,
            get_settings,
            set_settings,
            default_library_dir,
            adobe_available,
            apply_font_in_app,
            google_catalog,
            refresh_google_catalog,
            google_styles,
            google_preview,
            install_google_font,
            google_cache_bytes,
            clear_google_cache
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                revert_session_activations(app);
                // Last chance to persist anything the exit path changed.
                scanner::save_disk_cache();
            }
        });
}
#[cfg(test)]
mod tests {
    use super::*;
    use font_types::{Classification, FontFormat};

    fn face(id: &str) -> FontFace {
        FontFace {
            id: id.to_string(),
            path: format!("/fonts/{id}.ttf"),
            preview_path: None,
            is_collection: false,
            face_index: 0,
            family: "Inter".to_string(),
            style: "Regular".to_string(),
            postscript_name: None,
            foundry: None,
            designers: Vec::new(),
            category: None,
            license: None,
            license_url: None,
            format: FontFormat::Ttf,
            is_variable: false,
            axes: Vec::new(),
            weight: 400,
            italic: false,
            monospaced: false,
            classification: Classification::Sans,
            scripts: vec!["latin".to_string()],
            file_size: 1024,
            source: FontSource::Managed,
            deactivatable: true,
            active: false,
        }
    }

    /// The frontend reads the scan result as a plain face array, so the shared
    /// snapshot must serialize exactly like the owned vector it wraps — an
    /// accidental object wrapper (e.g. `{"0":…}` or `{"faces":[…]}`) would
    /// break every view at once.
    #[test]
    fn snapshot_serializes_as_face_array() {
        let snap = FontSnapshot::new(vec![face("a"), face("b")]);
        let shared = serde_json::to_value(&snap).expect("snapshot serializes");
        let plain = serde_json::to_value(snap.owned()).expect("faces serialize");

        assert_eq!(shared, plain);
        assert_eq!(shared.as_array().map(|a| a.len()), Some(2));
        assert_eq!(shared[0]["id"], "a");
    }

    /// A clone of the snapshot must share the same faces rather than copy
    /// them: that is what keeps the cache lock held for a pointer copy only.
    #[test]
    fn snapshot_clone_shares_faces() {
        let snap = FontSnapshot::new(vec![face("a")]);
        let copy = snap.clone();

        assert_eq!(std::sync::Arc::strong_count(&snap.0), 2);
        assert_eq!(
            std::sync::Arc::as_ptr(&snap.0),
            std::sync::Arc::as_ptr(&copy.0)
        );
    }
}
