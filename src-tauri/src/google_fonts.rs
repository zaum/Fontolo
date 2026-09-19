//! Google Fonts as a two-stage provider.
//!
//! Stage 1 (browsing) is metadata only: `catalog.json` describes every family,
//! and the few families actually on screen fetch a tiny WOFF2 web font on
//! demand into the preview cache. Nothing is scanned, nothing is installed.
//!
//! Stage 2 (activation) is the desktop file: the full TTF/OTF of a style is
//! downloaded into the library folder and registered with the system, so every
//! other application sees it too.

use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::font_types::{FontFace, FontSource};
use crate::store::{AppState, Store};

/// The catalogue: one lightweight JSON document describing every family.
const METADATA_URL: &str = "https://fonts.google.com/metadata/fonts";
/// The CSS API: the only place WOFF2 preview files can be fetched from.
const CSS_URL: &str = "https://fonts.googleapis.com/css2?family=";
/// Google's own repository, which holds the desktop file of every style.
const GITHUB_RAW: &str = "https://raw.githubusercontent.com/google/fonts/main/";
/// Licence folders inside that repository, probed in order.
const LICENSE_DIRS: &[&str] = &["ofl", "apache", "ufl", "cc-by-sa"];
/// A browser User-Agent, so the CSS API answers with WOFF2 web fonts instead of
/// a full desktop TTF. The gstatic file names it returns reach 238 characters,
/// so they are never reused as local file names - see `preview_file_name`.
const BROWSER_AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
/// A plain client for the JSON catalogue and Google's own repository.
const APP_AGENT: &str = "Fontolo/0.3";
/// Cache layout: 1 was the old flat TTF mirror, 2 is WOFF2 previews.
const CACHE_VERSION: u32 = 2;
/// Subsets fetched for an on-screen preview. `latin` alone stops below U+0100,
/// so Hungarian o- and u-acute (U+0151/U+0171) would render as tofu boxes.
const PREVIEW_SUBSETS: &[&str] = &["latin", "latin-ext"];
/// Ceiling for the preview cache; least recently used files go first.
const PREVIEW_CACHE_BYTES: u64 = 300 * 1024 * 1024;
/// Longest file name stem derived from a family name.
const SLUG_MAX: usize = 60;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleFontFamily {
    pub family: String,
    pub category: Option<String>,
    #[serde(default)]
    pub designers: Vec<String>,
    #[serde(default)]
    pub subsets: Vec<String>,
    #[serde(default)]
    pub axes: Vec<serde_json::Value>,
    #[serde(default)]
    pub last_modified: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct Catalog {
    #[serde(default)]
    family_metadata_list: Vec<GoogleFontFamily>,
}

/// One downloadable style of a family, as Google's own desktop file describes
/// it: `METADATA.pb` names the file, the weight and the italic flag.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleStyle {
    /// Stable key the frontend passes back: `400`, `700`, `400i`.
    pub key: String,
    pub label: String,
    pub weight: u16,
    pub italic: bool,
    #[serde(default)]
    pub postscript: Option<String>,
    #[serde(default)]
    pub file_name: Option<String>,
}

/// Everything known about one family beyond the catalogue entry. Cached next to
/// the previews, so opening a family costs one network round trip at most.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleFamilyInfo {
    pub family: String,
    #[serde(default)]
    pub license: Option<String>,
    #[serde(default)]
    pub styles: Vec<GoogleStyle>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct FamilyCache {
    #[serde(default)]
    license: Option<String>,
    #[serde(default)]
    license_dir: Option<String>,
    #[serde(default)]
    styles: Vec<GoogleStyle>,
}

/// Connection to a provider's catalogue: which families exist and when they
/// were last checked. The version field drives the one-time cleanup of the old
/// flat TTF mirror.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct Manifest {
    #[serde(default)]
    version: u32,
    #[serde(default)]
    last_sync: Option<String>,
}

/// One preview file the webview should load, and the Unicode ranges it covers.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewFile {
    pub path: String,
    pub unicode_range: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleFontsProgress {
    pub phase: String,
    pub done: usize,
    pub total: usize,
    pub family: Option<String>,
    /// Families the last refresh added to the catalogue.
    pub downloaded: usize,
    pub failed: usize,
    pub error: Option<String>,
}

/// Root of everything Google Fonts keeps on disk for this app.
pub fn directory() -> PathBuf {
    crate::store::app_data_dir().join("GoogleFonts")
}

/// The preview cache. Deliberately *not* inside a font folder: these files are
/// for the app's own previews and must never be scanned as library fonts.
pub fn preview_dir() -> PathBuf {
    directory().join("previews")
}

fn catalog_path() -> PathBuf {
    directory().join("catalog.json")
}

fn manifest_path() -> PathBuf {
    directory().join("manifest.json")
}

fn family_cache_path(family: &str) -> PathBuf {
    preview_dir().join(format!("{}.json", slug(family)))
}

fn css_cache_path(family: &str, style_key: &str) -> PathBuf {
    preview_dir().join(format!("{}-{}.css", slug(family), style_key))
}

/// File name stem for anything derived from a family name: ASCII alphanumerics
/// kept, everything else collapsed to `_`, capped so long names stay far below
/// every path limit. The gstatic file names (up to 238 characters) are never
/// reused: that is what used to make a download fail with "file name too long".
fn slug(value: &str) -> String {
    let stem: String = value
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
        .take(SLUG_MAX)
        .collect();
    if stem.is_empty() {
        "font".to_string()
    } else {
        stem
    }
}

/// Directory name of a family inside Google's repository: the family name in
/// lowercase with every separator removed ("Big Shoulders Text" ->
/// "bigshoulderstext").
fn repo_slug(family: &str) -> String {
    family
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .collect::<String>()
        .to_lowercase()
}

/// Percent-encodes one URL path segment. Google's own file names contain `[`,
/// `,` and spaces, all of which have to be escaped to fetch them.
fn encode_segment(segment: &str) -> String {
    let mut out = String::with_capacity(segment.len());
    for byte in segment.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(byte as char)
            }
            other => out.push_str(&format!("%{other:02X}")),
        }
    }
    out
}

/// Family name for a CSS API query: spaces become `+`, everything else that is
/// not URL-safe is escaped.
fn encode_family(family: &str) -> String {
    let mut out = String::with_capacity(family.len());
    for byte in family.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' => {
                out.push(byte as char)
            }
            b' ' => out.push('+'),
            other => out.push_str(&format!("%{other:02X}")),
        }
    }
    out
}

fn write_json<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let temp = path.with_extension("tmp");
    let bytes = serde_json::to_vec_pretty(value).map_err(|e| e.to_string())?;
    fs::write(&temp, bytes).map_err(|e| e.to_string())?;
    fs::rename(temp, path).map_err(|e| e.to_string())
}

fn read_json<T: for<'de> Deserialize<'de>>(path: &Path) -> Option<T> {
    fs::read(path)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
}

/// Never overwrites: a name already taken gets a `1-` prefix, exactly like the
/// importer does for dropped files.
fn unique_dest(dir: &Path, file_name: &str) -> PathBuf {
    let mut dest = dir.join(file_name);
    let mut n = 1;
    while dest.exists() {
        dest = dir.join(format!("{n}-{file_name}"));
        n += 1;
    }
    dest
}

fn emit(app: &AppHandle, progress: GoogleFontsProgress) {
    let _ = app.emit("google-fonts:progress", progress);
}
fn now_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_secs())
        .unwrap_or(0)
}

fn client(agent: &str) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .user_agent(agent)
        .timeout(Duration::from_secs(30))
        .connect_timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())
}

/// GET with a small retry. Transient failures (timeouts, 429, 5xx) are worth a
/// second attempt; a 404 is not, so it returns immediately.
async fn get_bytes(client: &reqwest::Client, url: &str) -> Result<Vec<u8>, String> {
    let mut last = String::from("no attempt");
    for attempt in 0..3u32 {
        if attempt > 0 {
            tokio::time::sleep(Duration::from_millis(400 << attempt)).await;
        }
        match client.get(url).send().await {
            Ok(response) if response.status().is_success() => match response.bytes().await {
                Ok(bytes) => return Ok(bytes.to_vec()),
                Err(e) => last = e.to_string(),
            },
            Ok(response) => {
                let status = response.status();
                last = format!("HTTP {status}");
                if status.as_u16() != 429 && !status.is_server_error() {
                    break;
                }
            }
            Err(e) => last = e.to_string(),
        }
    }
    Err(format!("{last}"))
}

async fn get_text(client: &reqwest::Client, url: &str) -> Result<String, String> {
    let bytes = get_bytes(client, url).await?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

/// One `@font-face` block of a CSS API response.
#[derive(Debug, Clone)]
struct CssFace {
    /// The `/* latin */` comment that precedes the block, when present.
    subset: Option<String>,
    weight: u16,
    italic: bool,
    url: String,
    format: String,
    unicode_range: String,
}

fn parse_css(css: &str) -> Vec<CssFace> {
    let mut out: Vec<CssFace> = Vec::new();
    let mut subset: Option<String> = None;
    let mut block: Option<CssFace> = None;
    for raw in css.lines() {
        let line = raw.trim();
        if line.starts_with("/*") && line.ends_with("*/") {
            subset = Some(line.trim_start_matches("/*").trim_end_matches("*/").trim().to_string());
            continue;
        }
        if line.starts_with('}') {
            if let Some(mut done) = block.take() {
                done.subset = subset.clone();
                if !done.url.is_empty() {
                    out.push(done);
                }
            }
            continue;
        }
        if line.starts_with("@font-face") {
            block = Some(CssFace {
                subset: None,
                weight: 400,
                italic: false,
                url: String::new(),
                format: String::new(),
                unicode_range: String::new(),
            });
            continue;
        }
        let Some(face) = block.as_mut() else { continue };
        if let Some(value) = line.strip_prefix("font-style:") {
            let value = field_value(value);
            face.italic = value.starts_with("italic") || value.starts_with("oblique");
        } else if let Some(value) = line.strip_prefix("font-weight:") {
            let first = field_value(value).split(' ').next().unwrap_or("400").to_string();
            face.weight = first.parse().unwrap_or(400);
        } else if let Some(value) = line.strip_prefix("src:") {
            if let (Some(start), Some(end)) = (value.find("url("), value.find(')')) {
                face.url = value[start + 4..end].trim().trim_matches(['"', '\'']).to_string();
            }
            if let Some(start) = value.find("format(") {
                let rest = &value[start + 7..];
                if let Some(end) = rest.find(')') {
                    face.format = rest[..end].trim().trim_matches(['"', '\'']).to_string();
                }
            }
        } else if let Some(value) = line.strip_prefix("unicode-range:") {
            face.unicode_range = field_value(value).to_string();
        }
    }
    out
}

/// A `key: "value"` line of `METADATA.pb`, without the key and the quotes.
fn field_value(value: &str) -> &str {
    value.trim().trim_end_matches(';').trim().trim_matches('"')
}

fn style_key(weight: u16, italic: bool) -> String {
    format!("{weight}{}", if italic { "i" } else { "" })
}

fn style_label(weight: u16, italic: bool) -> String {
    let base = match weight {
        100 => "Thin",
        200 => "ExtraLight",
        300 => "Light",
        400 => "Regular",
        500 => "Medium",
        600 => "SemiBold",
        700 => "Bold",
        800 => "ExtraBold",
        900 => "Black",
        _ => "Regular",
    };
    if italic {
        format!("{base} Italic")
    } else {
        base.to_string()
    }
}

fn style_from_key(key: &str) -> (u16, bool) {
    let italic = key.ends_with('i');
    let digits = if italic { &key[..key.len() - 1] } else { key };
    (digits.parse().unwrap_or(400), italic)
}

/// Reads a family's `METADATA.pb` (protobuf text format). Returns every style
/// Google ships as a desktop file, plus the licence name.
fn parse_metadata_pb(text: &str) -> (Vec<GoogleStyle>, Option<String>) {
    let mut license: Option<String> = None;
    let mut styles: Vec<GoogleStyle> = Vec::new();
    let mut open: Option<(u16, bool, Option<String>, Option<String>)> = None;
    for raw in text.lines() {
        let line = raw.trim();
        if line.starts_with("license:") {
            if license.is_none() {
                license = Some(field_value(&line["license:".len()..]).to_string());
            }
            continue;
        }
        if line.starts_with("fonts {") {
            open = Some((400, false, None, None));
            continue;
        }
        if let Some(entry) = open.as_mut() {
            if line.starts_with('}') {
                if let Some((weight, italic, file_name, postscript)) = open.take() {
                    styles.push(GoogleStyle {
                        key: style_key(weight, italic),
                        label: style_label(weight, italic),
                        weight,
                        italic,
                        postscript,
                        file_name,
                    });
                }
                continue;
            }
            if let Some(value) = line.strip_prefix("style:") {
                entry.1 = field_value(value) == "italic";
            } else if let Some(value) = line.strip_prefix("weight:") {
                entry.0 = field_value(value).parse().unwrap_or(400);
            } else if let Some(value) = line.strip_prefix("filename:") {
                entry.2 = Some(field_value(value).to_string());
            } else if let Some(value) = line.strip_prefix("post_script_name:") {
                entry.3 = Some(field_value(value).to_string());
            }
        }
    }
    (styles, license)
}

pub fn catalog() -> Vec<GoogleFontFamily> {
    read_json::<Catalog>(&catalog_path())
        .map(|catalog| catalog.family_metadata_list)
        .unwrap_or_default()
}

/// Forgets installed Google fonts whose file is gone (uninstalled by hand, or
/// removed from the library folder outside the app).
pub fn retain_installed(state: &mut AppState) -> bool {
    let before = state.google_installed.len();
    state.google_installed.retain(|path| Path::new(path).is_file());
    before != state.google_installed.len()
}

pub fn is_installed_path(state: &AppState, path: &str) -> bool {
    state.google_installed.contains(path)
}

/// Fills in what only the catalogue knows: the canonical family name, category,
/// designers and script coverage.
pub fn decorate_faces(faces: &mut [FontFace]) {
    let catalog: Catalog = match read_json(&catalog_path()) {
        Some(catalog) => catalog,
        None => return,
    };
    let metadata: HashMap<&str, &GoogleFontFamily> = catalog
        .family_metadata_list
        .iter()
        .map(|family| (family.family.as_str(), family))
        .collect();
    for face in faces.iter_mut().filter(|face| face.source == FontSource::Google) {
        let family = metadata.get(face.family.as_str()).copied().or_else(|| {
            let postscript = face.postscript_name.as_deref()?;
            let stem = postscript.split('-').next()?;
            catalog
                .family_metadata_list
                .iter()
                .find(|family| family.family.eq_ignore_ascii_case(stem))
        });
        let Some(family) = family else { continue };
        face.family = family.family.clone();
        face.designers = family.designers.clone();
        face.category = family.category.clone();
        if face.scripts.is_empty() {
            face.scripts = family
                .subsets
                .iter()
                .filter(|subset| *subset != "menu")
                .cloned()
                .collect();
        }
    }
}

/// Refreshes the catalogue. Metadata only: no font file is downloaded here, so
/// the Settings button stays a quick check for new families.
pub async fn refresh(app: AppHandle) -> Result<usize, String> {
    fs::create_dir_all(directory()).map_err(|e| e.to_string())?;
    emit(&app, GoogleFontsProgress {
        phase: "checking".into(), done: 0, total: 0, family: None, downloaded: 0, failed: 0, error: None,
    });
    let previous: HashSet<String> = catalog().into_iter().map(|f| f.family).collect();
    let http = client(APP_AGENT)?;
    let bytes = get_bytes(&http, METADATA_URL).await.map_err(|e| {
        emit(&app, GoogleFontsProgress {
            phase: "ready".into(), done: 0, total: previous.len(), family: None,
            downloaded: 0, failed: 0, error: Some(e.clone()),
        });
        format!("Google Fonts catalogue: {e}")
    })?;
    let catalog: Catalog = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
    let added = catalog
        .family_metadata_list
        .iter()
        .filter(|family| !previous.contains(&family.family))
        .count();
    write_json(&catalog_path(), &catalog)?;
    update_tags(&app, &catalog)?;
    write_json(&manifest_path(), &Manifest { version: CACHE_VERSION, last_sync: Some(now_secs().to_string()) })?;
    emit(&app, GoogleFontsProgress {
        phase: "ready".into(),
        done: catalog.family_metadata_list.len(),
        total: catalog.family_metadata_list.len(),
        family: None,
        downloaded: added,
        failed: 0,
        error: None,
    });
    Ok(added)
}

/// Keeps the tag list in step with the catalogue: every family carries a
/// `Google Fonts` tag plus its category.
fn update_tags(app: &AppHandle, catalog: &Catalog) -> Result<(), String> {
    let store: State<Store> = app.state();
    let mut state = store.0.lock().map_err(|e| e.to_string())?;
    let google_tag = "Google Fonts".to_string();
    state.protected_tags.insert(google_tag.clone());
    let legacy_prefix = "Google Fonts / ";
    state.protected_tags.retain(|tag| !tag.starts_with(legacy_prefix));
    for family in &catalog.family_metadata_list {
        let mut tags = state.tags.remove(&family.family).unwrap_or_default();
        tags.retain(|tag| !tag.starts_with(legacy_prefix));
        if !tags.contains(&google_tag) {
            tags.push(google_tag.clone());
        }
        if let Some(category) = family.category.as_deref().filter(|value| !value.is_empty()) {
            let tag = category.to_string();
            state.protected_tags.insert(tag.clone());
            if !tags.contains(&tag) {
                tags.push(tag);
            }
        }
        state.tags.insert(family.family.clone(), tags);
    }
    crate::store::save(&state)
}

/// The styles of a family, taken from Google's own repository: that list is the
/// one the desktop files correspond to, so a variable family offers its
/// variable cuts and a static family every weight it ships.
pub async fn styles(app: &AppHandle, family: &str) -> Result<GoogleFamilyInfo, String> {
    let cache = ensure_family_info(app, family).await?;
    Ok(GoogleFamilyInfo {
        family: family.to_string(),
        license: cache.license,
        styles: cache.styles,
    })
}

async fn ensure_family_info(app: &AppHandle, family: &str) -> Result<FamilyCache, String> {
    let _ = app;
    if let Some(cache) = read_json::<FamilyCache>(&family_cache_path(family)) {
        if !cache.styles.is_empty() {
            return Ok(cache);
        }
    }
    let http = client(APP_AGENT)?;
    let repo = repo_slug(family);
    for dir in LICENSE_DIRS {
        let url = format!("{GITHUB_RAW}{dir}/{repo}/METADATA.pb");
        let Ok(text) = get_text(&http, &url).await else { continue };
        let (styles, license) = parse_metadata_pb(&text);
        if styles.is_empty() {
            continue;
        }
        let cache = FamilyCache {
            license,
            license_dir: Some((*dir).to_string()),
            styles,
        };
        write_json(&family_cache_path(family), &cache)?;
        return Ok(cache);
    }
    // Nothing in the repository under any licence folder: the CSS API still
    // answers, but only for the cuts it serves.
    let css = fetch_css(&http, family, None).await?;
    let styles = default_styles(&parse_css(&css));
    if styles.is_empty() {
        return Err(format!("no styles found for {family}"));
    }
    let cache = FamilyCache {
        license: None,
        license_dir: None,
        styles,
    };
    write_json(&family_cache_path(family), &cache)?;
    Ok(cache)
}

fn default_styles(faces: &[CssFace]) -> Vec<GoogleStyle> {
    let mut out: Vec<GoogleStyle> = Vec::new();
    for face in faces {
        let key = style_key(face.weight, face.italic);
        if out.iter().any(|style| style.key == key) {
            continue;
        }
        out.push(GoogleStyle {
            key,
            label: style_label(face.weight, face.italic),
            weight: face.weight,
            italic: face.italic,
            postscript: None,
            file_name: None,
        });
    }
    out
}

/// The CSS API query for one style. Weight 400 upright is the default cut, and
/// asking for it without axes keeps the URL identical to the plain family query.
async fn fetch_css(
    http: &reqwest::Client,
    family: &str,
    style: Option<(u16, bool)>,
) -> Result<String, String> {
    let query = match style {
        Some((weight, italic)) if italic || weight != 400 => format!(
            "{}:ital,wght@{},{}",
            encode_family(family),
            if italic { 1 } else { 0 },
            weight
        ),
        _ => encode_family(family),
    };
    get_text(http, &format!("{CSS_URL}{query}")).await
}

async fn ensure_css(
    http: &reqwest::Client,
    family: &str,
    key: &str,
    weight: u16,
    italic: bool,
) -> Result<String, String> {
    let path = css_cache_path(family, key);
    if let Ok(css) = fs::read_to_string(&path) {
        if !parse_css(&css).is_empty() {
            return Ok(css);
        }
    }
    let mut css = fetch_css(http, family, Some((weight, italic))).await?;
    if parse_css(&css).is_empty() {
        // Some families reject an explicit axis request; the default cut still
        // gives a usable preview.
        css = fetch_css(http, family, None).await?;
    }
    if parse_css(&css).is_empty() {
        return Err(format!("no web font available for {family} {key}"));
    }
    fs::create_dir_all(preview_dir()).map_err(|e| e.to_string())?;
    fs::write(&path, &css).map_err(|e| e.to_string())?;
    Ok(css)
}

fn ext_from_url(url: &str) -> String {
    url.rsplit('/')
        .next()
        .and_then(|name| name.split('?').next())
        .and_then(|name| name.rsplit_once('.'))
        .map(|(_, ext)| slug(ext))
        .filter(|ext| !ext.is_empty())
        .unwrap_or_else(|| "woff2".to_string())
}

/// Stage 1: the web font of one style, for the preview on screen. A couple of
/// tens of KB per style, cached, and only ever fetched for what is visible.
pub async fn preview(
    app: AppHandle,
    family: String,
    requested: String,
) -> Result<Vec<PreviewFile>, String> {
    let info = ensure_family_info(&app, &family).await?;
    let known: Vec<String> = info.styles.iter().map(|style| style.key.clone()).collect();
    let key = if known.is_empty() || known.iter().any(|k| *k == requested) {
        requested
    } else {
        known[0].clone()
    };
    let (weight, italic) = style_from_key(&key);
    let http = client(BROWSER_AGENT)?;
    let css = ensure_css(&http, &family, &key, weight, italic).await?;
    let faces = parse_css(&css);

    // The `latin` and `latin-ext` cuts together cover ASCII and Hungarian
    // accented letters; anything else on screen is drawn by the fallback font.
    let chosen = pick_preview_faces(&faces, weight, italic);

    let mut out: Vec<PreviewFile> = Vec::new();
    for (index, face) in chosen.into_iter().enumerate() {
        let subset = face.subset.clone().unwrap_or_else(|| index.to_string());
        let ext = if face.format.is_empty() {
            ext_from_url(&face.url)
        } else {
            slug(&face.format)
        };
        // The gstatic name is deliberately NOT used: it can be 238 characters
        // long, and `family-238-chars.ttf` is what broke this download before.
        let path = preview_dir().join(preview_file_name(&family, &key, &subset, &ext));
        if !path.is_file() {
            let bytes = get_bytes(&http, &face.url)
                .await
                .map_err(|e| format!("{family} {key}: {e}"))?;
            fs::create_dir_all(preview_dir()).map_err(|e| e.to_string())?;
            fs::write(&path, &bytes).map_err(|e| e.to_string())?;
            prune_preview_cache();
        }
        out.push(PreviewFile {
            path: path.to_string_lossy().into_owned(),
            unicode_range: face.unicode_range,
        });
    }
    if out.is_empty() {
        return Err(format!("no preview available for {family} {key}"));
    }
    Ok(out)
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleInstallResult {
    pub faces: Vec<FontFace>,
    pub installed: Vec<String>,
    pub errors: Vec<String>,
}

/// Stage 2: the desktop file of each requested style into the library folder,
/// then registered with the system, so Photoshop, Figma and Word see it too.
pub async fn install(
    app: AppHandle,
    family: String,
    style_keys: Vec<String>,
) -> Result<GoogleInstallResult, String> {
    let info = ensure_family_info(&app, &family).await?;
    let managed = {
        let store: State<Store> = app.state();
        let state = store.0.lock().map_err(|e| e.to_string())?;
        crate::scanner::effective_managed_dir(state.active_library_dir())
    };
    fs::create_dir_all(&managed).map_err(|e| e.to_string())?;
    let wanted: Vec<GoogleStyle> = if style_keys.is_empty() {
        info.styles.clone()
    } else {
        info.styles
            .iter()
            .filter(|style| style_keys.contains(&style.key))
            .cloned()
            .collect()
    };
    let wanted = if wanted.is_empty() { info.styles.clone() } else { wanted };
    if wanted.is_empty() {
        return Err(format!("no downloadable style for {family}"));
    }

    let http = client(APP_AGENT)?;
    let mut paths: Vec<String> = Vec::new();
    let mut errors: Vec<String> = Vec::new();
    for style in &wanted {
        match fetch_desktop_file(&http, &family, style, &info).await {
            Ok((bytes, ext)) => {
                let stem = style
                    .postscript
                    .clone()
                    .unwrap_or_else(|| format!("{}-{}", slug(&family), style.label.replace(' ', "-")));
                let dest = unique_dest(&managed, &format!("{}.{}", slug(&stem), ext));
                match fs::write(&dest, &bytes) {
                    Ok(()) => paths.push(dest.to_string_lossy().into_owned()),
                    Err(e) => errors.push(format!("{}: {e}", dest.display())),
                }
            }
            Err(e) => errors.push(format!("{} {}: {e}", family, style.key)),
        }
    }
    if paths.is_empty() {
        return Err(errors.join("; "));
    }

    {
        let store: State<Store> = app.state();
        let mut state = store.0.lock().map_err(|e| e.to_string())?;
        for path in &paths {
            state.google_installed.insert(path.clone());
        }
        if let Err(e) = crate::activation::sync_many(&mut state, &paths, true) {
            errors.push(e);
        }
        crate::store::save(&state)?;
    }
    let _ = app.emit("fonts:changed", ());
    let faces: Vec<FontFace> = paths
        .iter()
        .flat_map(|path| crate::parser::parse_font_file(Path::new(path), FontSource::Google))
        .collect();
    Ok(GoogleInstallResult {
        faces,
        installed: paths,
        errors,
    })
}

/// Google's own repository first (that is the file the designer published),
/// the CSS API's desktop cut as a fallback.
async fn fetch_desktop_file(
    http: &reqwest::Client,
    family: &str,
    style: &GoogleStyle,
    info: &FamilyCache,
) -> Result<(Vec<u8>, String), String> {
    if let (Some(dir), Some(file)) = (info.license_dir.as_deref(), style.file_name.as_deref()) {
        let url = format!(
            "{GITHUB_RAW}{dir}/{}/{}",
            repo_slug(family),
            encode_segment(file)
        );
        if let Ok(bytes) = get_bytes(http, &url).await {
            return Ok((bytes, ext_from_url(file)));
        }
    }
    let css = fetch_css(http, family, Some((style.weight, style.italic))).await?;
    let faces = parse_css(&css);
    if faces.is_empty() {
        let css = fetch_css(http, family, None).await?;
        if let Some(face) = parse_css(&css).into_iter().next() {
            let bytes = get_bytes(http, &face.url).await?;
            return Ok((bytes, ext_from_url(&face.url)));
        }
        return Err("no desktop file".to_string());
    }
    let face = faces
        .iter()
        .find(|face| face.weight == style.weight && face.italic == style.italic)
        .or_else(|| faces.first())
        .cloned()
        .ok_or_else(|| "no desktop file".to_string())?;
    let bytes = get_bytes(http, &face.url).await?;
    Ok((bytes, ext_from_url(&face.url)))
}

/// Bytes the preview cache currently occupies.
pub fn cache_bytes() -> u64 {
    let Ok(entries) = fs::read_dir(preview_dir()) else { return 0 };
    entries
        .filter_map(|entry| entry.ok())
        .filter_map(|entry| entry.metadata().ok())
        .filter(|meta| meta.is_file())
        .map(|meta| meta.len())
        .sum()
}

/// Drops the cached web fonts (and their stylesheets). The tiny per-family
/// metadata files stay: they are what keeps browsing free of network calls.
pub fn clear_cache() -> Result<u64, String> {
    let freed = cache_bytes();
    let Ok(entries) = fs::read_dir(preview_dir()) else { return Ok(0) };
    for entry in entries.filter_map(|entry| entry.ok()) {
        let path = entry.path();
        let removable = path
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| matches!(ext.to_ascii_lowercase().as_str(), "woff2" | "woff" | "ttf" | "otf" | "css"))
            .unwrap_or(false);
        if removable {
            fs::remove_file(&path).map_err(|e| e.to_string())?;
        }
    }
    Ok(freed)
}

/// Keeps the preview cache inside its budget by dropping the least recently
/// used web fonts first.
fn prune_preview_cache() {
    let Ok(entries) = fs::read_dir(preview_dir()) else { return };
    let mut files: Vec<(u64, u64, PathBuf)> = entries
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|path| {
            path.extension()
                .and_then(|ext| ext.to_str())
                .map(|ext| matches!(ext.to_ascii_lowercase().as_str(), "woff2" | "woff" | "ttf" | "otf"))
                .unwrap_or(false)
        })
        .filter_map(|path| {
            let meta = fs::metadata(&path).ok()?;
            let modified = meta
                .modified()
                .ok()
                .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|age| age.as_secs())
                .unwrap_or(0);
            Some((modified, meta.len(), path))
        })
        .collect();
    let total: u64 = files.iter().map(|(_, len, _)| *len).sum();
    if total <= PREVIEW_CACHE_BYTES {
        return;
    }
    files.sort_by_key(|(modified, _, _)| *modified);
    let mut freed = 0u64;
    for (_, len, path) in files {
        if total - freed <= PREVIEW_CACHE_BYTES {
            break;
        }
        if fs::remove_file(&path).is_ok() {
            freed += len;
        }
    }
}

#[cfg(target_os = "windows")]
fn registered_set() -> HashSet<String> {
    crate::registry::registered_paths()
}

#[cfg(not(target_os = "windows"))]
fn registered_set() -> HashSet<String> {
    HashSet::new()
}

/// Whether a font file is currently visible to other applications. On Windows
/// that is the registry; elsewhere a file is visible unless it is deactivated.
#[cfg(target_os = "windows")]
fn locally_active(_state: &AppState, registered: &HashSet<String>, path: &str) -> bool {
    registered.contains(&crate::registry::normalize(path))
}

#[cfg(not(target_os = "windows"))]
fn locally_active(state: &AppState, _registered: &HashSet<String>, path: &str) -> bool {
    !state.deactivated.contains(path)
}

/// One-time cleanup of the version 1 mirror: it downloaded a full TTF for every
/// family of the catalogue just to draw previews, and it could not even finish
/// (the file name of a downloaded font was built from a gstatic name up to 238
/// characters long, which no Windows path can hold).
///
/// A file that is currently registered with the system is NOT deleted: it is
/// moved into the library folder and re-registered, so an active font survives
/// the upgrade. Everything else was a preview and is removed.
pub fn migrate(app: &AppHandle) {
    let Ok(entries) = fs::read_dir(directory()) else { return };
    let legacy: Vec<PathBuf> = entries
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|path| {
            path.is_file()
                && path
                    .extension()
                    .and_then(|ext| ext.to_str())
                    .map(|ext| ext.eq_ignore_ascii_case("ttf") || ext.eq_ignore_ascii_case("otf"))
                    .unwrap_or(false)
        })
        .collect();
    if legacy.is_empty() {
        return;
    }

    let store: State<Store> = app.state();
    let (managed, keep) = {
        let Ok(state) = store.0.lock() else { return };
        let registered = registered_set();
        let keep: Vec<PathBuf> = legacy
            .iter()
            .filter(|path| locally_active(&state, &registered, &path.to_string_lossy()))
            .cloned()
            .collect();
        (
            crate::scanner::effective_managed_dir(state.active_library_dir()),
            keep,
        )
    };

    let mut moved: Vec<String> = Vec::new();
    if !keep.is_empty() && fs::create_dir_all(&managed).is_ok() {
        for path in &keep {
            let Some(file_name) = path.file_name() else { continue };
            let dest = unique_dest(&managed, &file_name.to_string_lossy());
            let moved_ok = fs::rename(path, &dest).is_ok()
                || (fs::copy(path, &dest).is_ok() && fs::remove_file(path).is_ok());
            if moved_ok {
                moved.push(dest.to_string_lossy().into_owned());
            }
        }
    }
    for path in &legacy {
        if path.exists() {
            let _ = fs::remove_file(path);
        }
    }
    if !moved.is_empty() {
        if let Ok(mut state) = store.0.lock() {
            for path in &moved {
                state.google_installed.insert(path.clone());
            }
            let _ = crate::activation::sync_many(&mut state, &moved, true);
            let _ = crate::store::save(&state);
        }
    }
    let _ = write_json(
        &manifest_path(),
        &Manifest {
            version: CACHE_VERSION,
            last_sync: None,
        },
    );
    let _ = app.emit("fonts:changed", ());
}

/// Name of a cached preview file. Built from the family and the style only, so
/// its length is bounded no matter how long the provider's own file name is.
fn preview_file_name(family: &str, key: &str, subset: &str, ext: &str) -> String {
    format!("{}-{}-{}.{}", slug(family), key, slug(subset), ext)
}

/// Which blocks of a stylesheet actually serve an on-screen preview: the
/// `latin` and `latin-ext` cuts, falling back to whatever the style has.
fn pick_preview_faces(faces: &[CssFace], weight: u16, italic: bool) -> Vec<CssFace> {
    let mut chosen: Vec<CssFace> = Vec::new();
    for subset in PREVIEW_SUBSETS {
        if let Some(face) = faces.iter().find(|face| {
            face.subset.as_deref() == Some(*subset) && face.weight == weight && face.italic == italic
        }) {
            chosen.push(face.clone());
        }
    }
    if chosen.is_empty() {
        chosen = faces
            .iter()
            .filter(|face| face.weight == weight && face.italic == italic)
            .take(1)
            .cloned()
            .collect();
    }
    if chosen.is_empty() {
        chosen = faces.iter().take(1).cloned().collect();
    }
    chosen
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The exact gstatic name that used to break the download: 238 characters,
    /// and the old code prefixed it with the family name.
    const LONG_GSTATIC_NAME: &str = "55zMcCw3FN_jOGTSZJcl588VlZiMRBEu8MNfAa1hTmcIC-EgZzYwMlaO_awRPudtyc3Y6uQYyaHkeKGSq8TU4RVR7xpYN_MnWZejEGOGrT-NcapoFhvUOhVjLNJ2XCLrbMxtAR6SYY1mL-OvDnjOVsnRj34-p6VMvv549Lg7J4HRX7TqUxwskRMxVR7_3L-QRhDtbv8kM-EDNmBQr1-hsC1tMPJC0vkO2JhzR0_bFg.ttf";

    const SAMPLE_CSS: &str = r#"
/* vietnamese */
@font-face {
  font-family: 'Inter';
  font-style: normal;
  font-weight: 400;
  src: url(https://fonts.gstatic.com/s/inter/v20/vietnamese.woff2) format('woff2');
  unicode-range: U+0102-0103, U+1EA0-1EF9;
}
/* latin-ext */
@font-face {
  font-family: 'Inter';
  font-style: normal;
  font-weight: 400;
  src: url(https://fonts.gstatic.com/s/inter/v20/latin-ext.woff2) format('woff2');
  unicode-range: U+0100-02AF, U+1E00-1E9F;
}
/* latin */
@font-face {
  font-family: 'Inter';
  font-style: normal;
  font-weight: 400;
  src: url(https://fonts.gstatic.com/s/inter/v20/latin.woff2) format('woff2');
  unicode-range: U+0000-00FF, U+0131;
}
body { --x: 1; }
"#;

    const SAMPLE_PB: &str = r#"
name: "Inter"
designer: "Rasmus Andersson"
license: "OFL"
category: "SANS_SERIF"
fonts {
  name: "Inter"
  style: "normal"
  weight: 400
  filename: "Inter[opsz,wght].ttf"
  post_script_name: "Inter-Regular"
}
fonts {
  name: "Inter"
  style: "italic"
  weight: 400
  filename: "Inter-Italic[opsz,wght].ttf"
  post_script_name: "Inter-Italic"
}
subsets: "latin"
axes {
  tag: "wght"
  min_value: 100.0
  max_value: 900.0
}
"#;

    #[test]
    fn preview_names_stay_short_even_with_a_238_character_source_name() {
        assert_eq!(LONG_GSTATIC_NAME.len(), 238, "the source name that broke the download");
        let name = preview_file_name("Bitcount Grid Double Ink", "400", "latin-ext", "woff2");
        assert!(name.len() < 100, "preview file name grew to {}", name.len());
        assert_eq!(name, "Bitcount_Grid_Double_Ink-400-latin_ext.woff2");
        // The worst realistic app-data root, plus the name, stays far below the
        // 260-character Windows limit that the old naming scheme exceeded.
        assert!(name.len() + 90 < 259);
    }

    #[test]
    fn slug_is_bounded_and_never_empty() {
        assert_eq!(slug("Big Shoulders Text"), "Big_Shoulders_Text");
        assert_eq!(slug("!!!"), "___");
        assert_eq!(slug(""), "font");
        assert!(slug(&"x".repeat(500)).len() <= SLUG_MAX);
    }

    #[test]
    fn repo_slug_matches_googles_directory_names() {
        assert_eq!(repo_slug("Big Shoulders Text"), "bigshoulderstext");
        assert_eq!(repo_slug("BIZ UDPGothic"), "bizudpgothic");
        assert_eq!(repo_slug("M PLUS 1p"), "mplus1p");
        assert_eq!(repo_slug("ABeeZee"), "abeezee");
    }

    #[test]
    fn segments_are_escaped_for_the_repository_url() {
        assert_eq!(encode_segment("Inter[opsz,wght].ttf"), "Inter%5Bopsz%2Cwght%5D.ttf");
        assert_eq!(encode_segment("ABeeZee-Regular.ttf"), "ABeeZee-Regular.ttf");
    }

    #[test]
    fn css_blocks_are_parsed_with_their_subset_and_ranges() {
        let faces = parse_css(SAMPLE_CSS);
        assert_eq!(faces.len(), 3);
        assert_eq!(faces[0].subset.as_deref(), Some("vietnamese"));
        assert_eq!(faces[2].subset.as_deref(), Some("latin"));
        assert_eq!(faces[1].url, "https://fonts.gstatic.com/s/inter/v20/latin-ext.woff2");
        assert_eq!(faces[0].format, "woff2");
        assert_eq!(faces[0].weight, 400);
        assert!(!faces[0].italic);
        assert!(faces[2].unicode_range.starts_with("U+0000-00FF"));
        assert!(!faces[2].unicode_range.ends_with(';'));
    }

    #[test]
    fn preview_picks_latin_and_latin_ext() {
        let faces = parse_css(SAMPLE_CSS);
        let chosen = pick_preview_faces(&faces, 400, false);
        let subsets: Vec<&str> = chosen.iter().filter_map(|f| f.subset.as_deref()).collect();
        // latin carries ASCII; latin-ext carries the Hungarian o- and u-acute.
        // Both are loaded, each with its own Unicode range.
        assert_eq!(subsets, vec!["latin", "latin-ext"]);
    }

    #[test]
    fn preview_falls_back_to_the_first_block_when_no_subset_matches() {
        let faces = parse_css("/* cyrillic */\n@font-face {\n  font-weight: 700;\n  src: url(https://example.test/cyr.woff2) format('woff2');\n}\n");
        let chosen = pick_preview_faces(&faces, 400, false);
        assert_eq!(chosen.len(), 1);
        assert_eq!(chosen[0].subset.as_deref(), Some("cyrillic"));
    }

    #[test]
    fn italic_css_is_recognised() {
        let faces = parse_css("@font-face {\n  font-style: italic;\n  font-weight: 500;\n  src: url(https://example.test/i.woff2) format('woff2');\n}\n");
        assert!(faces[0].italic);
        assert_eq!(faces[0].weight, 500);
    }

    #[test]
    fn metadata_pb_yields_every_desktop_style() {
        let (styles, license) = parse_metadata_pb(SAMPLE_PB);
        assert_eq!(license.as_deref(), Some("OFL"));
        assert_eq!(styles.len(), 2);
        assert_eq!(styles[0].key, "400");
        assert_eq!(styles[0].label, "Regular");
        assert_eq!(styles[0].file_name.as_deref(), Some("Inter[opsz,wght].ttf"));
        assert_eq!(styles[0].postscript.as_deref(), Some("Inter-Regular"));
        assert_eq!(styles[1].key, "400i");
        assert_eq!(styles[1].label, "Regular Italic");
        assert!(styles[1].italic);
    }

    #[test]
    fn style_keys_round_trip() {
        assert_eq!(style_key(700, true), "700i");
        assert_eq!(style_from_key("700i"), (700, true));
        assert_eq!(style_from_key("400"), (400, false));
        assert_eq!(style_from_key("nonsense"), (400, false));
        assert_eq!(style_label(400, false), "Regular");
        assert_eq!(style_label(900, false), "Black");
    }

    #[test]
    fn extensions_come_from_the_file_itself() {
        assert_eq!(ext_from_url("https://x.test/a/b/thing.woff2"), "woff2");
        assert_eq!(ext_from_url("https://x.test/a/b/thing.ttf?x=1"), "ttf");
        assert_eq!(ext_from_url("https://x.test/a/b/thing"), "woff2");
    }
}
