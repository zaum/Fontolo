use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, Manager, State};
use crate::font_types::FontFace;
use crate::store::Store;

const METADATA_URL: &str = "https://fonts.google.com/metadata/fonts";
const CSS_URL: &str = "https://fonts.googleapis.com/css2?family=";

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

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct Manifest {
    #[serde(default)]
    files: HashMap<String, String>,
    #[serde(default)]
    last_sync: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleFontsProgress {
    pub phase: String,
    pub done: usize,
    pub total: usize,
    pub family: Option<String>,
    pub downloaded: usize,
    pub error: Option<String>,
}

pub fn directory() -> PathBuf {
    crate::store::app_data_dir().join("GoogleFonts")
}

pub fn decorate_faces(faces: &mut [FontFace]) {
    let Ok(bytes) = fs::read(catalog_path()) else { return };
    let Ok(catalog) = serde_json::from_slice::<Catalog>(&bytes) else { return };
    let metadata: HashMap<&str, &GoogleFontFamily> = catalog
        .family_metadata_list
        .iter()
        .map(|family| (family.family.as_str(), family))
        .collect();
    for face in faces.iter_mut().filter(|face| face.source == crate::font_types::FontSource::Google) {
        let family = metadata.get(face.family.as_str()).copied().or_else(|| {
            let file_stem = Path::new(&face.path).file_stem()?.to_string_lossy();
            catalog.family_metadata_list.iter().find(|candidate| {
                let prefix = candidate
                    .family
                    .chars()
                    .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
                    .collect::<String>();
                file_stem.starts_with(&format!("{prefix}-"))
            })
        });
        let Some(family) = family else { continue };
        face.family = family.family.clone();
        face.designers = family.designers.clone();
        face.category = family.category.clone();
        if face.scripts.is_empty() {
            face.scripts = family.subsets.iter().filter(|subset| *subset != "menu").cloned().collect();
        }
    }
}

fn catalog_path() -> PathBuf {
    directory().join("catalog.json")
}

fn manifest_path() -> PathBuf {
    directory().join("manifest.json")
}

fn write_json<T: Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let temp = path.with_extension("tmp");
    let bytes = serde_json::to_vec_pretty(value).map_err(|e| e.to_string())?;
    fs::write(&temp, bytes).map_err(|e| e.to_string())?;
    fs::rename(temp, path).map_err(|e| e.to_string())
}

fn percent_encode_family(family: &str) -> String {
    family
        .bytes()
        .map(|byte| match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' => {
                (byte as char).to_string()
            }
            b' ' => "+".to_string(),
            other => format!("%{other:02X}"),
        })
        .collect()
}

fn css_urls(css: &str) -> Vec<String> {
    let mut urls = Vec::new();
    let mut rest = css;
    while let Some(start) = rest.find("url(") {
        let after = &rest[start + 4..];
        let Some(end) = after.find(')') else { break };
        let url = after[..end].trim().trim_matches(['"', '\'']);
        if url.starts_with("https://") && !urls.iter().any(|known| known == url) {
            urls.push(url.to_string());
        }
        rest = &after[end + 1..];
    }
    urls
}

fn safe_file_name(family: &str, index: usize, url: &str) -> String {
    let stem = family
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
        .collect::<String>();
    let suffix = url
        .rsplit('/')
        .next()
        .and_then(|name| name.split('?').next())
        .filter(|name| !name.is_empty())
        .unwrap_or("font.woff2");
    format!("{stem}-{index}-{suffix}")
}

fn emit(app: &AppHandle, progress: GoogleFontsProgress) {
    let _ = app.emit("google-fonts:progress", progress);
}

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

pub async fn sync(app: AppHandle) -> Result<(), String> {
    fs::create_dir_all(directory()).map_err(|e| e.to_string())?;
    emit(&app, GoogleFontsProgress {
        phase: "checking".into(), done: 0, total: 0, family: None, downloaded: 0, error: None,
    });

    let client = reqwest::Client::builder()
        .user_agent("Fontolo/0.3 Google Fonts sync")
        .build()
        .map_err(|e| e.to_string())?;
    let response = client.get(METADATA_URL).send().await.map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("Google Fonts metadata returned {}", response.status()));
    }
    let catalog: Catalog = response.json().await.map_err(|e| e.to_string())?;
    write_json(&catalog_path(), &catalog)?;
    update_tags(&app, &catalog)?;

    let mut manifest: Manifest = fs::read(manifest_path())
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default();
    let total = catalog.family_metadata_list.len();
    let mut downloaded = 0;

    for (index, family) in catalog.family_metadata_list.iter().enumerate() {
        emit(&app, GoogleFontsProgress {
            phase: "downloading".into(), done: index, total, family: Some(family.family.clone()),
            downloaded, error: None,
        });
        let css_url = format!("{}{}", CSS_URL, percent_encode_family(&family.family));
        let css = client
            .get(css_url)
            .header("Accept", "text/css")
            .send()
            .await
            .and_then(|response| response.error_for_status())
            .map_err(|e| e.to_string())?
            .text()
            .await
            .map_err(|e| e.to_string())?;
        for (file_index, url) in css_urls(&css).into_iter().enumerate() {
            if manifest
                .files
                .get(&url)
                .map(|path| Path::new(path).is_file())
                .unwrap_or(false)
            {
                continue;
            }
            let bytes = client
                .get(&url)
                .send()
                .await
                .and_then(|response| response.error_for_status())
                .map_err(|e| e.to_string())?
                .bytes()
                .await
                .map_err(|e| e.to_string())?;
            let path = directory().join(safe_file_name(&family.family, file_index, &url));
            fs::write(&path, &bytes).map_err(|e| e.to_string())?;
            manifest.files.insert(url, path.to_string_lossy().into_owned());
            downloaded += 1;
        }
    }
    manifest.last_sync = Some(chrono_like_now());
    write_json(&manifest_path(), &manifest)?;
    emit(&app, GoogleFontsProgress {
        phase: "ready".into(), done: total, total, family: None, downloaded, error: None,
    });
    Ok(())
}

fn chrono_like_now() -> String {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_secs().to_string())
        .unwrap_or_else(|_| "0".into())
}
