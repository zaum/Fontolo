use crate::font_types::{FontFace, FontSource};
use crate::parser;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
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
///
/// Memory bound: `CACHE_LIMIT` files *and* `CACHE_BYTES` bytes of parsed
/// faces. On a 40k-file library the face vectors alone can reach hundreds of
/// MB, so both caps are enforced together below.
struct CacheEntry {
    len: u64,
    /// Modification time as nanoseconds since the epoch. A plain integer rather
    /// than a `SystemTime`, so the same value can be compared against, and
    /// written to, the persisted copy below.
    mtime: Option<u64>,
    faces: Vec<FontFace>,
}

/// Estimated retained allocation, excluding allocator and hash-table overhead.
fn entry_bytes(path: &Path, entry: &CacheEntry) -> usize {
    use std::mem::size_of;
    path.as_os_str().len() + size_of::<CacheEntry>()
        + entry.faces.capacity() * size_of::<FontFace>()
        + entry.faces.iter().map(|f| {
            f.id.capacity() + f.path.capacity() + f.family.capacity() + f.style.capacity()
                + [&f.preview_path, &f.postscript_name, &f.foundry, &f.license, &f.license_url]
                    .iter().map(|s| s.as_ref().map_or(0, |s| s.capacity())).sum::<usize>()
                + f.axes.capacity() * size_of::<crate::font_types::VariationAxis>()
                + f.axes.iter().map(|a| a.tag.capacity()).sum::<usize>()
                + f.scripts.capacity() * size_of::<String>()
                + f.scripts.iter().map(|s| s.capacity()).sum::<usize>()
        }).sum::<usize>()
}

#[derive(Default)]
struct ParseCache {
    entries: HashMap<PathBuf, CacheEntry>,
    bytes: usize,
}

impl std::ops::Deref for ParseCache {
    type Target = HashMap<PathBuf, CacheEntry>;
    fn deref(&self) -> &Self::Target { &self.entries }
}

impl ParseCache {
    fn insert(&mut self, path: PathBuf, entry: CacheEntry) {
        self.insert_bounded(path, entry, CACHE_LIMIT, CACHE_BYTES);
    }

    fn insert_bounded(&mut self, path: PathBuf, entry: CacheEntry, limit: usize, budget: usize) {
        // Invalidate changed files even when their new metadata cannot fit.
        if let Some(old) = self.entries.remove(&path) {
            self.bytes -= entry_bytes(&path, &old);
        }
        let bytes = entry_bytes(&path, &entry);
        // Retain a stable subset instead of evicting entries that a sequential
        // scan will need next. Overflow files still appear in the scan result.
        if self.entries.len() >= limit || bytes > budget.saturating_sub(self.bytes) {
            return;
        }
        self.bytes += bytes;
        self.entries.insert(path, entry);
    }

    fn retain(&mut self, mut keep: impl FnMut(&PathBuf, &mut CacheEntry) -> bool) {
        let bytes = &mut self.bytes;
        self.entries.retain(|path, entry| {
            if keep(path, entry) { true } else {
                *bytes -= entry_bytes(path, entry);
                false
            }
        });
    }
}

static PARSE_CACHE: std::sync::OnceLock<Mutex<ParseCache>> = std::sync::OnceLock::new();

fn parse_cache() -> &'static Mutex<ParseCache> {
    PARSE_CACHE.get_or_init(|| Mutex::new(ParseCache::default()))
}

/// Bump when the persisted layout changes: a mismatch discards the file.
const CACHE_FORMAT: u32 = 1;

/// Bump when parsing or metadata extraction changes: otherwise an older build's
/// faces would be reused and hide the fix.
const CACHE_REVISION: u32 = 1;

/// Admission limits for retained parsed metadata, not for the visible library.
const CACHE_LIMIT: usize = 40_000;
const CACHE_BYTES: usize = 256 * 1024 * 1024;

/// Set whenever the cache no longer matches what is on disk, so the writer can
/// skip pointless writes when a rescan found nothing new.
static CACHE_DIRTY: AtomicBool = AtomicBool::new(false);

/// The persisted copy of [`PARSE_CACHE`], shared with the next run so it can
/// skip parsing unchanged files and paint the previous library immediately.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DiskCache {
    format: u32,
    revision: u32,
    app_version: String,
    entries: Vec<DiskEntry>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DiskEntry {
    path: String,
    len: u64,
    mtime_ns: Option<u64>,
    faces: Vec<FontFace>,
}

/// Writing view of [`DiskCache`]: borrows the faces instead of cloning the
/// whole library into an owned tree just to serialize it. Kept in step with
/// the struct above by the disk-cache round-trip test.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DiskCacheRef<'a> {
    format: u32,
    revision: u32,
    app_version: &'a str,
    entries: Vec<DiskEntryRef<'a>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DiskEntryRef<'a> {
    path: String,
    len: u64,
    mtime_ns: Option<u64>,
    faces: &'a [FontFace],
}
fn cache_file() -> PathBuf {
    crate::store::app_data_dir().join("scan-cache.json")
}

/// Modification time as nanoseconds since the epoch, or `None` when the
/// platform cannot report one.
fn mtime_ns(meta: Option<&std::fs::Metadata>) -> Option<u64> {
    meta.and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_nanos() as u64)
}

/// Loads the persisted cache into memory, once per run. Every failure is a
/// silent miss: a truncated or stale file must never keep the app from
/// starting, it only costs one slow scan.
fn load_disk_cache_once() {
    static LOADED: std::sync::Once = std::sync::Once::new();
    LOADED.call_once(|| {
        let Ok(file) = std::fs::File::open(cache_file()) else {
            return;
        };
        // Reject oversized snapshots before allocating the deserialized tree.
        if file.metadata().map_or(true, |m| m.len() > CACHE_BYTES as u64) {
            return;
        }
        let reader = std::io::BufReader::new(std::io::Read::take(file, CACHE_BYTES as u64));
        let Ok(disk) = serde_json::from_reader::<_, DiskCache>(reader) else {
            return;
        };
        // A different format, a bumped revision or another app version all
        // mean the recorded metadata may be out of date.
        if disk.format != CACHE_FORMAT
            || disk.revision != CACHE_REVISION
            || disk.app_version != env!("CARGO_PKG_VERSION")
        {
            return;
        }
        let Ok(mut cache) = parse_cache().lock() else {
            return;
        };
        for entry in disk.entries.into_iter().take(CACHE_LIMIT) {
            cache.insert(
                PathBuf::from(entry.path),
                CacheEntry {
                    len: entry.len,
                    mtime: entry.mtime_ns,
                    faces: entry.faces,
                },
            );
        }
    });
}

/// The library as the previous run recorded it, for an instant first paint.
/// Only as good as the cache: files added or deleted since are still missing
/// or stale here, which is why a real scan follows and replaces it.
pub fn warm_faces(managed: &Path) -> Vec<FontFace> {
    load_disk_cache_once();
    let Ok(cache) = parse_cache().lock() else {
        return Vec::new();
    };
    warm_from_cache(&cache, managed)
}

/// Turns cached entries into a library: sorted and de-duplicated exactly like
/// [`scan_all`] does, so a warm paint and a real scan order the same way.
fn warm_from_cache(cache: &HashMap<PathBuf, CacheEntry>, managed: &Path) -> Vec<FontFace> {
    let mut faces: Vec<FontFace> = cache
        .iter()
        .flat_map(|(path, entry)| {
            entry.faces.iter().map(move |face| {
                let mut face = face.clone();
                // The library-folder setting may have changed since the file
                // was parsed, so re-derive what depends on it.
                let source = classify(path, face.source, managed);
                face.source = source;
                face.deactivatable = crate::activation::can_deactivate(source);
                face
            })
        })
        .collect();
    faces.sort_by(|a, b| a.id.cmp(&b.id));
    faces.dedup_by(|a, b| a.id == b.id);
    faces
}

/// One background writer streams the borrowed cache to disk. No cloned face
/// tree or full JSON buffer is retained. The cache lock is held during writing;
/// a concurrent scan may wait, but cannot publish an older snapshot afterward.
pub fn save_disk_cache() {
    static WRITING: AtomicBool = AtomicBool::new(false);
    if WRITING.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst).is_err() {
        return;
    }
    std::thread::spawn(|| {
        while CACHE_DIRTY.swap(false, Ordering::SeqCst) {
            let result = (|| -> std::io::Result<()> {
                let cache = parse_cache().lock().map_err(|_| std::io::Error::other("cache lock poisoned"))?;
                let disk = DiskCacheRef {
                    format: CACHE_FORMAT,
                    revision: CACHE_REVISION,
                    app_version: env!("CARGO_PKG_VERSION"),
                    entries: cache.iter().map(|(path, entry)| DiskEntryRef {
                        path: path.to_string_lossy().into_owned(),
                        len: entry.len,
                        mtime_ns: entry.mtime,
                        faces: &entry.faces,
                    }).collect(),
                };
                let path = cache_file();
                if let Some(parent) = path.parent() { std::fs::create_dir_all(parent)?; }
                write_cache_with(&path, |file| {
                    let mut writer = std::io::BufWriter::new(file);
                    serde_json::to_writer(&mut writer, &disk)?;
                    std::io::Write::flush(&mut writer)
                })
            })();
            if result.is_err() {
                CACHE_DIRTY.store(true, Ordering::SeqCst);
                WRITING.store(false, Ordering::SeqCst);
                return; // Retry on the next save request, not in a busy loop.
            }
        }
        WRITING.store(false, Ordering::SeqCst);
        // Cover a request arriving between the last dirty check and release.
        if CACHE_DIRTY.load(Ordering::SeqCst) { save_disk_cache(); }
    });
}

/// Atomically replace `path` with `bytes`.
///
/// The temporary file gets a unique name per write and is created with
/// `create_new`, so two concurrent savers can never claim each other's temp
/// file (a fixed name would let the second rename steal the first writer's
/// unfinished snapshot).
#[cfg(test)]
fn write_cache_file(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
    write_cache_with(path, |file| std::io::Write::write_all(file, bytes))
}

fn write_cache_with(path: &Path, write: impl FnOnce(&mut std::fs::File) -> std::io::Result<()>) -> std::io::Result<()> {
    use std::sync::atomic::{AtomicU64, Ordering};
    static WRITES: AtomicU64 = AtomicU64::new(0);

    let mut last_err = None;
    for _ in 0..3 {
        let tmp = path.with_extension(format!(
            "json.tmp.{}.{}",
            std::process::id(),
            WRITES.fetch_add(1, Ordering::Relaxed)
        ));
        let file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&tmp);
        match file {
            Ok(mut file) => {
                let written = write(&mut file);
                drop(file);
                let written = written.and_then(|()| std::fs::rename(&tmp, path));
                if written.is_ok() {
                    return Ok(());
                }
                let _ = std::fs::remove_file(&tmp);
                return written;
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                last_err = Some(e);
                continue; // impossibly unlikely; retry with the next counter value
            }
            Err(e) => return Err(e),
        }
    }
    Err(last_err.unwrap_or_else(|| std::io::Error::other("temporary file collision")))
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
    // Reuse what the previous run left on disk, so unchanged files are not
    // parsed again on a cold start.
    load_disk_cache_once();
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
    let mut seen: std::collections::HashSet<PathBuf> =
        std::collections::HashSet::with_capacity(total);
    let mut faces = Vec::with_capacity(total);
    for (done, (path, base_source)) in files.into_iter().enumerate() {
        seen.insert(path.clone());
        let source = classify(&path, base_source, managed);
        faces.extend(cached_parse(&path, source));
        if done % 25 == 0 || done + 1 == total {
            let _ = app.emit(
                "scan:progress",
                ScanProgress {
                    done: done + 1,
                    total,
                },
            );
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
    let mtime = mtime_ns(meta.as_ref());
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
        cache.insert(
            key,
            CacheEntry {
                len,
                mtime,
                faces: faces.clone(),
            },
        );
    }
    // Freshly parsed faces are not on disk yet; the writer picks this up.
    CACHE_DIRTY.store(true, Ordering::SeqCst);
    faces
}

/// Drop cache entries for files that no longer exist (e.g. after uninstall).
fn prune_cache(seen: &std::collections::HashSet<PathBuf>) {
    if let Ok(mut cache) = parse_cache().lock() {
        let before = cache.len();
        cache.retain(|path, _| seen.contains(path));
        if cache.len() != before {
            CACHE_DIRTY.store(true, Ordering::SeqCst);
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::font_types::{Classification, FontFormat};

    struct TestDirectory(PathBuf);

    impl TestDirectory {
        fn new() -> Self {
            use std::sync::atomic::AtomicU64;
            static TEST_DIRS: AtomicU64 = AtomicU64::new(0);
            let root = std::env::temp_dir();
            loop {
                let path = root.join(format!("zfm-cache-test-{}-{}", std::process::id(), TEST_DIRS.fetch_add(1, Ordering::Relaxed)));
                match std::fs::create_dir(&path) {
                    Ok(()) => return Self(path),
                    Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
                    Err(e) => panic!("create test directory: {e}"),
                }
            }
        }
    }

    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn cache_save_preserves_another_writers_temporary_file() {
        let dir = TestDirectory::new();
        let path = dir.0.join("scan-cache.json");
        let occupied = path.with_extension("json.tmp");
        std::fs::write(&occupied, b"another writer's unfinished snapshot").unwrap();
        write_cache_file(&path, b"our complete snapshot").unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"our complete snapshot");
        assert_eq!(std::fs::read(&occupied).unwrap(), b"another writer's unfinished snapshot");
    }
    #[test]
    fn cache_save_preserves_numbered_temporary_files() {
        let dir = TestDirectory::new();
        let path = dir.0.join("scan-cache.json");
        let occupied = path.with_extension("json.tmp.other-writer.0");
        std::fs::write(&occupied, b"in progress").unwrap();
        write_cache_file(&path, b"first snapshot").unwrap();
        write_cache_file(&path, b"second snapshot").unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"second snapshot");
        assert_eq!(std::fs::read(&occupied).unwrap(), b"in progress");
    }

    #[test]
    fn cache_budget_rejects_oversized_entries_and_tracks_replacements() {
        let mut cache = ParseCache::default();
        let (path, value) = entry("fonts/a.ttf", "a");
        let budget = entry_bytes(&path, &value);
        cache.insert_bounded(path.clone(), value, 10, budget);
        assert_eq!(cache.bytes, budget);
        let (_, mut large) = entry("fonts/a.ttf", "a");
        large.faces[0].license = Some("x".repeat(2048));
        cache.insert_bounded(path.clone(), large, 10, budget);
        assert!(cache.is_empty());
        assert_eq!(cache.bytes, 0);
        let (_, value) = entry("fonts/a.ttf", "a");
        cache.insert_bounded(path, value, 10, budget);
        cache.retain(|_, _| false);
        assert_eq!(cache.bytes, 0);
    }

    #[test]
    fn cache_keeps_40000_entries_across_overflow_scans() {
        let mut cache = ParseCache::default();
        for _ in 0..2 {
            for i in 0..40_100 {
                let path = PathBuf::from(format!("fonts/{i}.ttf"));
                if !cache.contains_key(&path) {
                    cache.insert(path, CacheEntry {
                        len: 0, mtime: None, faces: Vec::new(),
                    });
                }
            }
            assert_eq!(cache.len(), CACHE_LIMIT);
            assert!(cache.contains_key(Path::new("fonts/0.ttf")));
            assert!(cache.contains_key(Path::new("fonts/39999.ttf")));
            assert!(!cache.contains_key(Path::new("fonts/40000.ttf")));
            assert!(cache.bytes <= CACHE_BYTES);
        }
    }

    #[test]
    fn failed_write_keeps_previous_snapshot_and_removes_own_temp() {
        let dir = TestDirectory::new();
        let path = dir.0.join("scan-cache.json");
        std::fs::write(&path, b"previous").unwrap();
        let result = write_cache_with(&path, |file| {
            std::io::Write::write_all(file, b"partial")?;
            Err(std::io::Error::other("simulated write failure"))
        });
        assert!(result.is_err());
        assert_eq!(std::fs::read(&path).unwrap(), b"previous");
        assert_eq!(std::fs::read_dir(&dir.0).unwrap().count(), 1);
    }

    fn face(id: &str) -> FontFace {
        FontFace {
            id: id.to_string(),
            path: format!("/fonts/{id}.ttf"),
            preview_path: None,
            face_index: 0,
            family: "Inter".to_string(),
            style: "Regular".to_string(),
            postscript_name: None,
            foundry: None,
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
            source: FontSource::User,
            deactivatable: true,
            active: false,
        }
    }

    fn entry(path: &str, id: &str) -> (PathBuf, CacheEntry) {
        (
            PathBuf::from(path),
            CacheEntry {
                len: 1024,
                mtime: Some(1_700_000_000_000_000_000),
                faces: vec![face(id)],
            },
        )
    }

    /// The writer borrows the faces where the reader owns them; both sides must
    /// still agree on field names and types, or a saved cache would be
    /// unreadable by the very next run (which would silently rescan every time).
    #[test]
    fn disk_cache_roundtrip_matches_writer() {
        let cache: HashMap<PathBuf, CacheEntry> =
            HashMap::from([entry("/fonts/a.ttf", "a"), entry("/fonts/b.ttf", "b")]);
        let written = DiskCacheRef {
            format: CACHE_FORMAT,
            revision: CACHE_REVISION,
            app_version: "9.9.9",
            entries: cache
                .iter()
                .map(|(path, e)| DiskEntryRef {
                    path: path.to_string_lossy().into_owned(),
                    len: e.len,
                    mtime_ns: e.mtime,
                    faces: &e.faces,
                })
                .collect(),
        };
        let json = serde_json::to_vec(&written).expect("writes");
        let read: DiskCache = serde_json::from_slice(&json).expect("reads back");

        assert_eq!(read.format, CACHE_FORMAT);
        assert_eq!(read.revision, CACHE_REVISION);
        assert_eq!(read.app_version, "9.9.9");
        assert_eq!(read.entries.len(), 2);
        let a = read
            .entries
            .iter()
            .find(|e| e.path.ends_with("a.ttf"))
            .expect("entry a survives the round-trip");
        assert_eq!(a.len, 1024);
        assert_eq!(a.mtime_ns, Some(1_700_000_000_000_000_000));
        assert_eq!(a.faces.len(), 1);
        assert_eq!(a.faces[0].id, "a");
        assert_eq!(a.faces[0].family, "Inter");
    }

    /// A warm paint must look like a real scan: same ordering, no duplicates.
    #[test]
    fn warm_library_is_sorted_and_deduplicated() {
        let managed = PathBuf::from("/fonts/managed");
        let cache: HashMap<PathBuf, CacheEntry> = HashMap::from([
            entry("/fonts/c.ttf", "c"),
            entry("/fonts/a.ttf", "a"),
            // Same face id from two paths: the real scan keeps one.
            entry("/other/a.ttf", "a"),
        ]);

        let faces = warm_from_cache(&cache, &managed);

        let ids: Vec<&str> = faces.iter().map(|f| f.id.as_str()).collect();
        assert_eq!(ids, vec!["a", "c"]);
    }

    /// The source depends on the current library-dir setting, so a cached face
    /// inside that folder must come back as managed even if it was stored as a
    /// plain user font.
    #[test]
    fn warm_library_reapplies_managed_source() {
        let managed = PathBuf::from("/fonts/managed");
        let cache: HashMap<PathBuf, CacheEntry> =
            HashMap::from([entry("/fonts/managed/a.ttf", "a")]);

        let faces = warm_from_cache(&cache, &managed);

        assert_eq!(faces.len(), 1);
        assert_eq!(faces[0].source, FontSource::Managed);
    }
}
