use crate::font_types::FontSource;
use crate::store::AppState;

pub fn can_deactivate(source: FontSource) -> bool {
    #[cfg(target_os = "linux")]
    {
        let _ = source;
        true
    }
    #[cfg(target_os = "macos")]
    {
        source != FontSource::System
    }
    #[cfg(target_os = "windows")]
    {
        source != FontSource::System
    }
}

pub fn sync(state: &mut AppState, path: &str, active: bool) -> Result<(), String> {
    set_state(state, path, active);
    apply(state, path, active)
}

/// Apply the same activation state to many paths with a single platform
/// commit. Bulk callers (install, family toggle, session revert) used to call
/// [`sync`] per path, which re-wrote the fontconfig file and spawned an
/// `fc-cache` process every time. This updates the bookkeeping for all paths
/// first, then commits once — and skips duplicate paths (a TTC family lists
/// the same file once per face).
pub fn sync_many(state: &mut AppState, paths: &[String], active: bool) -> Result<(), String> {
    let mut ordered: Vec<&str> = Vec::with_capacity(paths.len());
    let mut seen: std::collections::HashSet<&str> =
        std::collections::HashSet::with_capacity(paths.len());
    for p in paths {
        if seen.insert(p.as_str()) {
            ordered.push(p.as_str());
        }
    }
    for path in &ordered {
        set_state(state, path, active);
    }
    apply_many(state, &ordered, active)
}

fn set_state(state: &mut AppState, path: &str, active: bool) {
    if active {
        state.deactivated.remove(path);
    } else {
        state.deactivated.insert(path.to_string());
    }
}

/// Single-path back-ends (macOS file moves, Windows registry) still apply
/// per path, but the bookkeeping above is already de-duplicated.
#[cfg(target_os = "macos")]
fn apply_many(state: &mut AppState, paths: &[&str], active: bool) -> Result<(), String> {
    let mut first_err = None;
    for path in paths {
        if let Err(e) = apply(state, path, active) {
            first_err.get_or_insert(e);
        }
    }
    first_err.map_or(Ok(()), Err)
}

#[cfg(target_os = "linux")]
fn apply_many(state: &mut AppState, _paths: &[&str], _active: bool) -> Result<(), String> {
    // One file write + one fc-cache run for the whole batch.
    apply(state, "", true)
}

#[cfg(target_os = "windows")]
fn apply_many(state: &mut AppState, paths: &[&str], active: bool) -> Result<(), String> {
    apply_batch(state, paths, active)
}

#[cfg(target_os = "linux")]
fn apply(state: &mut AppState, _path: &str, _active: bool) -> Result<(), String> {
    use std::fmt::Write as _;
    use std::fs;

    let dir = dirs::config_dir()
        .ok_or("no config dir")?
        .join("fontconfig")
        .join("conf.d");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let file = dir.join("99-fontolo.conf");

    if state.deactivated.is_empty() {
        if file.exists() {
            fs::remove_file(&file).map_err(|e| e.to_string())?;
        }
    } else {
        let mut globs = String::new();
        let mut paths: Vec<&String> = state.deactivated.iter().collect();
        paths.sort();
        for p in paths {
            let escaped = p
                .replace('&', "&amp;")
                .replace('<', "&lt;")
                .replace('>', "&gt;");
            let _ = writeln!(globs, "      <glob>{escaped}</glob>");
        }
        let xml = format!(
            "<?xml version=\"1.0\"?>\n<!DOCTYPE fontconfig SYSTEM \"fonts.dtd\">\n\
             <!-- Managed by Fontolo - do not edit; toggling fonts rewrites this file -->\n\
             <fontconfig>\n  <selectfont>\n    <rejectfont>\n{globs}    </rejectfont>\n  </selectfont>\n</fontconfig>\n"
        );

        let tmp = file.with_extension("conf.tmp");
        fs::write(&tmp, xml).map_err(|e| e.to_string())?;
        fs::rename(&tmp, &file).map_err(|e| e.to_string())?;
    }

    if let Ok(mut child) = std::process::Command::new("fc-cache").spawn() {
        std::thread::spawn(move || {
            let _ = child.wait();
        });
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn apply(state: &mut AppState, path: &str, active: bool) -> Result<(), String> {
    use std::fs;
    use std::path::{Path, PathBuf};

    let parked_dir = crate::store::app_data_dir().join("Deactivated");
    fs::create_dir_all(&parked_dir).map_err(|e| e.to_string())?;

    fn move_file(from: &Path, to: &Path) -> Result<(), String> {
        if fs::rename(from, to).is_ok() {
            return Ok(());
        }

        fs::copy(from, to).map_err(|e| e.to_string())?;
        fs::remove_file(from).map_err(|e| e.to_string())
    }

    if active {
        let parked = state
            .parked
            .remove(path)
            .ok_or_else(|| format!("no parked copy recorded for {path}"))?;
        move_file(Path::new(&parked), Path::new(path))?;
    } else {
        let file_name = Path::new(path).file_name().ok_or("invalid font path")?;
        let mut dest: PathBuf = parked_dir.join(file_name);

        let mut n = 1;
        while dest.exists() {
            dest = parked_dir.join(format!("{n}-{}", file_name.to_string_lossy()));
            n += 1;
        }
        move_file(Path::new(path), &dest)?;
        state
            .parked
            .insert(path.to_string(), dest.to_string_lossy().into_owned());
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn apply(state: &mut AppState, path: &str, active: bool) -> Result<(), String> {
    use crate::registry;

    // Single font toggle: snapshot is cheap (one enumeration) and keeps the
    // per-path logic identical to the batch path below.
    let snap = registry::UserSnapshot::load();
    apply_one(state, &snap, path, active)?;
    registry::broadcast_font_change();
    Ok(())
}

/// Batch entry for [`sync_many`]: one registry snapshot + one broadcast for
/// the whole batch instead of per-font enumeration and notification.
#[cfg(target_os = "windows")]
pub fn apply_batch(state: &mut AppState, paths: &[&str], active: bool) -> Result<(), String> {
    use crate::registry;

    let snap = registry::UserSnapshot::load();
    let mut first_err = None;
    for path in paths {
        if let Err(e) = apply_one(state, &snap, path, active) {
            first_err.get_or_insert(e);
        }
    }
    // One system-wide notification no matter how many fonts changed.
    registry::broadcast_font_change();
    first_err.map_or(Ok(()), Err)
}

#[cfg(target_os = "windows")]
fn apply_one(
    state: &mut AppState,
    snap: &crate::registry::UserSnapshot,
    path: &str,
    active: bool,
) -> Result<(), String> {
    use crate::registry;

    if active {
        let remembered = state
            .registry_backup
            .iter()
            .find(|(_, v)| v.as_str() == path)
            .map(|(k, _)| k.clone());
        let name = match remembered {
            Some(name) => name,
            None => {
                // Reuse the shared file cache instead of reading the font
                // file again just to derive the registry value name.
                let bytes = crate::parser::read_font_bytes(std::path::Path::new(path))
                    .map(|(d, _)| d)
                    .unwrap_or_default();
                let base = if bytes.is_empty() {
                    registry::value_name_for(path)
                } else {
                    registry::value_name_for_data(&bytes, std::path::Path::new(path))
                };
                snap.unique_name(&base, path)
            }
        };
        if snap.names_for(path).is_empty() {
            registry::set_user_entry(&name, path)?;
        }
        state.registry_backup.remove(&name);
        registry::add_font_resource(path);
    } else {
        if registry::is_machine_registered(path) {
            return Err(format!(
                "this font is installed for all users; deactivating it needs administrator rights: {path}"
            ));
        }

        let names = snap.names_for(path);
        for name in &names {
            registry::delete_user_entry(name)?;
        }
        if let Some(first) = names.into_iter().next() {
            state.registry_backup.insert(first, path.to_string());
        }
        registry::remove_font_resource(path);
    }
    Ok(())
}

#[cfg(target_os = "linux")]
pub fn reconcile(state: &mut AppState) {
    let _ = apply(state, "", true);
}

#[cfg(target_os = "windows")]
pub fn reconcile(state: &mut AppState) {
    let managed = crate::scanner::effective_managed_dir(state.active_library_dir());
    std::thread::spawn(move || {
        crate::registry::load_registered_outside(&managed);
    });
}

#[cfg(target_os = "macos")]
pub fn reconcile(_state: &mut AppState) {}

pub struct Probe {
    #[cfg(target_os = "windows")]
    registered: std::collections::HashSet<String>,
}

pub fn probe() -> Probe {
    Probe {
        #[cfg(target_os = "windows")]
        registered: crate::registry::registered_paths(),
    }
}

pub fn is_active(probe: &Probe, state: &AppState, face: &crate::font_types::FontFace) -> bool {
    #[cfg(target_os = "windows")]
    {
        let _ = state;

        face.source == FontSource::System
            || probe
                .registered
                .contains(&crate::registry::normalize(&face.path))
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = probe;
        is_active_path(state, &face.path)
    }
}

#[cfg(not(target_os = "windows"))]
fn is_active_path(state: &AppState, path: &str) -> bool {
    !state.deactivated.contains(path) && !state.parked.contains_key(path)
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::*;

    #[test]
    fn fragment_lifecycle() {
        let tmp = std::env::temp_dir().join(format!("zfm-test-{}", std::process::id()));
        std::fs::create_dir_all(&tmp).unwrap();

        unsafe { std::env::set_var("XDG_CONFIG_HOME", &tmp) };
        let fragment = tmp.join("fontconfig/conf.d/99-fontolo.conf");

        let mut state = AppState::default();
        let font = "/tmp/My <Fancy> & Font.ttf";

        sync(&mut state, font, false).unwrap();
        assert!(state.deactivated.contains(font));
        let xml = std::fs::read_to_string(&fragment).unwrap();
        assert!(xml.contains("<rejectfont>"));
        assert!(xml.contains("/tmp/My &lt;Fancy&gt; &amp; Font.ttf"));

        sync(&mut state, font, true).unwrap();
        assert!(!state.deactivated.contains(font));
        assert!(
            !fragment.exists(),
            "fragment should be removed when nothing is deactivated"
        );

        assert!(is_active_path(&state, font));
        let _ = std::fs::remove_dir_all(&tmp);
    }
}
