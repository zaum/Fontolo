

//! Standalone preview files for font collections.
//!
//! A `.ttc` / `.otc` file packs several faces into one file, and the webview
//! cannot choose between them: it decodes the first face and every card would
//! show those same glyphs. Collections are also the big files — a CJK one is
//! 10-36 MB — and a local font above the frontend's automatic decode budget is
//! never handed to the renderer at all.
//!
//! Both problems have the same answer: the face a card asks for is written out
//! as a standalone, single-face font into a cache folder that is never scanned
//! as a library, and the preview then loads that file instead of the original.
//!
//! Assets are generated on request, not during a scan: a library can hold
//! hundreds of collections, and copying every face of every one of them would
//! write hundreds of megabytes nobody asked to see. What is looked at gets
//! written, and the folder stays inside its budget on its own.

use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

/// Ceiling for one generated asset. The decoded face stays in the renderer for
/// as long as a card is on screen, so its size is a long-lived allocation. This
/// admits every collection face found on a normal system (the CJK ones reach
/// about 20 MiB) and keeps a single preview proportionate.
const MAX_ASSET_BYTES: u64 = 24 * 1024 * 1024;

/// Ceiling for the whole folder. Assets are generated only for the faces
/// actually looked at, so this is the disk the cache may hold for them; the
/// least recently generated file goes first, and asking for it again simply
/// writes it out once more.
const CACHE_BUDGET_BYTES: u64 = 256 * 1024 * 1024;

/// Generated assets between two folder checks. A check walks the folder, and
/// only a folder that has just gained a batch of faces needs one.
const PRUNE_EVERY: u32 = 16;

/// The asset cache. Deliberately *not* a font folder: these files exist for the
/// app's own previews and must never be scanned as library fonts.
pub fn preview_dir() -> PathBuf {
    crate::store::app_data_dir().join("PreviewFonts")
}

fn u16_at(data: &[u8], offset: usize) -> Option<u16> {
    let bytes = data.get(offset..offset + 2)?;
    Some(u16::from_be_bytes([bytes[0], bytes[1]]))
}

fn u32_at(data: &[u8], offset: usize) -> Option<u32> {
    let bytes = data.get(offset..offset + 4)?;
    Some(u32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]))
}

/// `true` when the file is a font collection, i.e. several faces in one file.
pub fn is_collection(data: &[u8]) -> bool {
    data.len() >= 4 && &data[0..4] == b"ttcf"
}

/// `true` for a CFF collection (`OTTO`), which is written back out as `.otf`.
fn is_cff(data: &[u8]) -> bool {
    data.len() >= 4 && &data[0..4] == b"OTTO"
}

/// The OpenType checksum: the sum of the file's 32-bit big-endian words, with a
/// short final word zero-padded.
fn checksum(data: &[u8]) -> u32 {
    let mut sum = 0u32;
    for chunk in data.chunks(4) {
        let mut word = [0u8; 4];
        word[..chunk.len()].copy_from_slice(chunk);
        sum = sum.wrapping_add(u32::from_be_bytes(word));
    }
    sum
}

/// `searchRange`, `entrySelector` and `rangeShift` of an offset table.
fn search_fields(num_tables: u16) -> (u16, u16, u16) {
    let num_tables = num_tables.max(1);
    let entry_selector = num_tables.ilog2();
    let search_range = (1u32 << entry_selector) * 16;
    let range_shift = num_tables as u32 * 16 - search_range;
    (search_range as u16, entry_selector as u16, range_shift as u16)
}

/// One table of a face directory, pointing into the source file.
struct Record {
    tag: [u8; 4],
    offset: usize,
    len: usize,
}


/// Rebuilds one face of a collection as a standalone font.
///
/// Table bytes are copied verbatim — a collection shares them between faces, so
/// they already belong to this face — while the directory, the table offsets
/// and every checksum are rewritten for the new file. `head.checkSumAdjustment`
/// is only correct for the file it was written for, so it is recalculated; the
/// sanitizer the browser runs before decoding checks what it finds there.
pub fn extract_face(data: &[u8], index: u32) -> Result<Vec<u8>, String> {
    if !is_collection(data) {
        return Err("not a font collection".to_string());
    }
    let count = u32_at(data, 8).ok_or("truncated collection header")?;
    if index >= count {
        return Err(format!("face index {index} is out of range ({count} faces)"));
    }
    let dir = u32_at(data, 12 + index as usize * 4).ok_or("truncated collection offsets")? as usize;
    let version = data.get(dir..dir + 4).ok_or("truncated face offset table")?;
    if version != [0x00, 0x01, 0x00, 0x00] && version != *b"true" && version != *b"OTTO" {
        return Err("unsupported face version".to_string());
    }
    let num_tables = u16_at(data, dir + 4).ok_or("truncated face offset table")?;
    let mut records = Vec::with_capacity(num_tables as usize);
    for i in 0..num_tables as usize {
        let base = dir + 12 + i * 16;
        let tag: [u8; 4] = data
            .get(base..base + 4)
            .ok_or("truncated table directory")?
            .try_into()
            .map_err(|_| "truncated table directory".to_string())?;
        let offset = u32_at(data, base + 8).ok_or("truncated table directory")? as usize;
        let len = u32_at(data, base + 12).ok_or("truncated table directory")? as usize;
        // An empty table carries no bytes to copy and no checksum to verify.
        if len == 0 {
            continue;
        }
        if data.get(offset..offset + len).is_none() {
            return Err(format!(
                "table {} of face {index} is out of bounds",
                String::from_utf8_lossy(&tag)
            ));
        }
        records.push(Record { tag, offset, len });
    }
    if records.is_empty() {
        return Err("face has no tables".to_string());
    }
    // The directory must be sorted by tag, and a repeated tag would make the
    // file ambiguous for every reader.
    records.sort_by(|a, b| a.tag.cmp(&b.tag));
    if records.windows(2).any(|pair| pair[0].tag == pair[1].tag) {
        return Err("face repeats a table tag".to_string());
    }
    let head = records.iter().position(|r| &r.tag == b"head");
    if head.is_some_and(|i| records[i].len < 12) {
        return Err("head table is too short".to_string());
    }

    // Layout first: every table starts on a 4-byte boundary, and a checksum is
    // computed from the bytes as they will be written.
    let mut layout: Vec<(usize, u32)> = Vec::with_capacity(records.len());
    let mut cursor = 12 + records.len() * 16;
    for (i, record) in records.iter().enumerate() {
        let body = &data[record.offset..record.offset + record.len];
        let sum = if Some(i) == head {
            // Zero the adjustment before summing: it describes the file it was
            // written for, not this one.
            let mut copy = body.to_vec();
            copy[8..12].fill(0);
            checksum(&copy)
        } else {
            checksum(body)
        };
        layout.push((cursor, sum));
        cursor += (record.len + 3) & !3;
    }

    let num_tables = records.len() as u16;
    let mut out = Vec::with_capacity(cursor);
    out.extend_from_slice(version);
    out.extend_from_slice(&num_tables.to_be_bytes());
    let (search_range, entry_selector, range_shift) = search_fields(num_tables);
    out.extend_from_slice(&search_range.to_be_bytes());
    out.extend_from_slice(&entry_selector.to_be_bytes());
    out.extend_from_slice(&range_shift.to_be_bytes());
    for (record, (offset, sum)) in records.iter().zip(&layout) {
        out.extend_from_slice(&record.tag);
        out.extend_from_slice(&sum.to_be_bytes());
        out.extend_from_slice(&(*offset as u32).to_be_bytes());
        out.extend_from_slice(&(record.len as u32).to_be_bytes());
    }

    let mut head_at = None;
    for (i, record) in records.iter().enumerate() {
        let (offset, _) = layout[i];
        out.resize(offset, 0);
        let body = &data[record.offset..record.offset + record.len];
        if Some(i) == head {
            head_at = Some(out.len());
            out.extend_from_slice(&body[..8]);
            out.extend_from_slice(&[0, 0, 0, 0]);
            out.extend_from_slice(&body[12..]);
        } else {
            out.extend_from_slice(body);
        }
    }
    out.resize(cursor, 0);

    if let Some(at) = head_at {
        // The adjustment is taken over the whole file with its own field still
        // zero — exactly how it was written above.
        let adjustment = 0xB1B0_AFBAu32.wrapping_sub(checksum(&out));
        out[at + 8..at + 12].copy_from_slice(&adjustment.to_be_bytes());
    }
    Ok(out)
}

/// A stable, filesystem-safe name for the asset of one face. The source's size
/// and modification time are part of it, so an edited font gets a new file
/// instead of silently previewing the old glyphs.
fn asset_name(source: &Path, index: u32, len: u64, mtime: Option<u64>, cff: bool) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    let mut mix = |bytes: &[u8]| {
        for byte in bytes {
            hash ^= *byte as u64;
            hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
        }
    };
    mix(source.to_string_lossy().as_bytes());
    mix(&index.to_be_bytes());
    mix(&len.to_be_bytes());
    mix(&mtime.unwrap_or(0).to_be_bytes());
    format!("{hash:016x}-{index}.{}", if cff { "otf" } else { "ttf" })
}

/// Writes `bytes` to `target` through a temporary file, so a reader never sees
/// a half-written asset and a crash leaves no half-written file behind.
fn write_atomically(target: &Path, bytes: &[u8]) -> Result<(), String> {
    use std::sync::atomic::{AtomicU64, Ordering};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let dir = target.parent().ok_or("asset path has no folder")?;
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let ticket = COUNTER.fetch_add(1, Ordering::Relaxed);
    let tmp = target.with_extension(format!("tmp-{}-{ticket}", std::process::id()));
    fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
    match fs::rename(&tmp, target) {
        Ok(()) => Ok(()),
        Err(e) => {
            let _ = fs::remove_file(&tmp);
            // Several scan workers can reach the same face at once; whoever
            // loses the race still finds the file it needs in place.
            if target.is_file() {
                Ok(())
            } else {
                Err(e.to_string())
            }
        }
    }
}

/// The standalone preview file of one face of a collection, generated on first
/// request. `None` for anything that is not a collection — a plain font is
/// previewed from its own file — and for a face that cannot be extracted or
/// would be too large for the renderer, so the card keeps its "preview
/// unavailable" state instead of loading a file the webview cannot decode.
///
/// The asset's size is reported with it: the frontend keeps its preview cache
/// inside a byte budget, and the collection's own size would count a whole
/// file against a single face.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewAsset {
    pub path: String,
    pub bytes: u64,
}

pub fn asset_for(source: &Path, index: u32) -> Option<PreviewAsset> {
    // Only the header decides this, so a plain font costs a four byte read
    // instead of loading the whole file into memory.
    let mut tag = [0u8; 4];
    {
        use std::io::Read;
        let mut file = fs::File::open(source).ok()?;
        file.read_exact(&mut tag).ok()?;
    }
    if &tag != b"ttcf" {
        return None;
    }
    let data = fs::read(source).ok()?;
    if !is_collection(&data) {
        return None;
    }
    let path = face_asset(source, &data, index)?;
    maybe_prune();
    let bytes = fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
    Some(PreviewAsset {
        path,
        bytes,
    })
}

/// Writes (or reuses) the asset of one face of a collection.
fn face_asset(source: &Path, data: &[u8], index: u32) -> Option<String> {
    let meta = fs::metadata(source).ok();
    let len = meta.as_ref().map(|m| m.len()).unwrap_or(0);
    let mtime = meta
        .as_ref()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_nanos() as u64);
    let target = preview_dir().join(asset_name(source, index, len, mtime, is_cff(data)));
    if fs::metadata(&target).is_ok_and(|m| m.len() > 0) {
        return Some(target.to_string_lossy().into_owned());
    }
    let bytes = extract_face(data, index).ok()?;
    if bytes.len() as u64 > MAX_ASSET_BYTES {
        return None;
    }
    write_atomically(&target, &bytes).ok()?;
    Some(target.to_string_lossy().into_owned())
}

/// Enforces the folder budget, but only once every [`PRUNE_EVERY`] generated
/// assets: walking the folder for each one would cost more than it saves.
fn maybe_prune() {
    use std::sync::atomic::{AtomicU32, Ordering};
    static GENERATED: AtomicU32 = AtomicU32::new(0);
    if GENERATED.fetch_add(1, Ordering::Relaxed) + 1 < PRUNE_EVERY {
        return;
    }
    GENERATED.store(0, Ordering::Relaxed);
    prune();
}

/// Keeps the asset folder inside its budget, least recently written first.
pub fn prune() {
    prune_in(&preview_dir(), CACHE_BUDGET_BYTES);
}

fn prune_in(dir: &Path, budget: u64) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    let mut files: Vec<(PathBuf, u64, std::time::SystemTime)> = Vec::new();
    let mut total = 0u64;
    for entry in entries.flatten() {
        let Ok(meta) = entry.metadata() else { continue };
        if !meta.is_file() {
            continue;
        }
        total += meta.len();
        files.push((
            entry.path(),
            meta.len(),
            meta.modified().unwrap_or(std::time::UNIX_EPOCH),
        ));
    }
    if total <= budget {
        return;
    }
    files.sort_by_key(|(_, _, written)| *written);
    for (path, len, _) in files {
        if total <= budget {
            break;
        }
        // A concurrent request may be writing one of these; a failed removal
        // only means it stays for the next check.
        if fs::remove_file(&path).is_ok() {
            total -= len;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn head_table() -> Vec<u8> {
        let mut head = vec![0u8; 54];
        head[0..4].copy_from_slice(&0x0001_0000u32.to_be_bytes());
        head[12..16].copy_from_slice(&0x5F0F_3CF5u32.to_be_bytes());
        head
    }

    /// A `ttcf` file with two faces that share most of their tables — like a
    /// real collection — while only the second one carries `glyf`.
    ///
    /// Returns the file and the table pool it was built from, so a test can
    /// check that the copied bytes are the source bytes.
    fn build_collection() -> (Vec<u8>, Vec<([u8; 4], Vec<u8>)>) {
        let pool: Vec<([u8; 4], Vec<u8>)> = vec![
            (*b"head", head_table()),
            (*b"hmtx", (0u8..32).collect()),
            (*b"maxp", vec![0x00, 0x01, 0x00, 0x00, 0x00, 0x02]),
            (*b"name", b"Fontolo Test\0".to_vec()),
            // An odd length, so the writer has to pad it to a 4-byte boundary.
            (*b"glyf", vec![0xAB; 23]),
        ];
        let faces: [&[[u8; 4]]; 2] = [
            &[*b"name", *b"head", *b"maxp", *b"hmtx"],
            &[*b"glyf", *b"head", *b"hmtx", *b"maxp", *b"name"],
        ];

        let dirs_at = 12 + faces.len() * 4;
        let dirs_len: usize = faces.iter().map(|tags| 12 + tags.len() * 16).sum();
        let mut table_offsets = Vec::with_capacity(pool.len());
        let mut cursor = dirs_at + dirs_len;
        for (_, bytes) in &pool {
            cursor = (cursor + 3) & !3;
            table_offsets.push(cursor);
            cursor += bytes.len();
        }

        let mut file = vec![0u8; cursor];
        for (i, (_, bytes)) in pool.iter().enumerate() {
            file[table_offsets[i]..table_offsets[i] + bytes.len()].copy_from_slice(bytes);
        }
        file[0..4].copy_from_slice(b"ttcf");
        file[4..8].copy_from_slice(&0x0001_0000u32.to_be_bytes());
        file[8..12].copy_from_slice(&(faces.len() as u32).to_be_bytes());

        let mut dir = dirs_at;
        for (i, tags) in faces.iter().enumerate() {
            file[12 + i * 4..16 + i * 4].copy_from_slice(&(dir as u32).to_be_bytes());
            file[dir..dir + 4].copy_from_slice(&0x0001_0000u32.to_be_bytes());
            file[dir + 4..dir + 6].copy_from_slice(&(tags.len() as u16).to_be_bytes());
            for (j, tag) in tags.iter().enumerate() {
                let at = dir + 12 + j * 16;
                let index = pool.iter().position(|(t, _)| t == tag).unwrap();
                let bytes = &pool[index].1;
                file[at..at + 4].copy_from_slice(tag);
                file[at + 4..at + 8].copy_from_slice(&checksum(bytes).to_be_bytes());
                file[at + 8..at + 12]
                    .copy_from_slice(&(table_offsets[index] as u32).to_be_bytes());
                file[at + 12..at + 16].copy_from_slice(&(bytes.len() as u32).to_be_bytes());
            }
            dir += 12 + tags.len() * 16;
        }
        (file, pool)
    }

    /// The written directory: version plus `(tag, offset, len, checksum)` rows.
    fn directory(font: &[u8]) -> ([u8; 4], Vec<([u8; 4], usize, usize, u32)>) {
        let version = font[0..4].try_into().unwrap();
        let count = u16::from_be_bytes([font[4], font[5]]) as usize;
        let mut rows = Vec::with_capacity(count);
        for i in 0..count {
            let at = 12 + i * 16;
            rows.push((
                font[at..at + 4].try_into().unwrap(),
                u32::from_be_bytes(font[at + 8..at + 12].try_into().unwrap()) as usize,
                u32::from_be_bytes(font[at + 12..at + 16].try_into().unwrap()) as usize,
                u32::from_be_bytes(font[at + 4..at + 8].try_into().unwrap()),
            ));
        }
        (version, rows)
    }

    fn table_bytes<'a>(font: &'a [u8], rows: &[([u8; 4], usize, usize, u32)], tag: &[u8; 4]) -> &'a [u8] {
        let row = rows.iter().find(|(t, ..)| t == tag).expect("table is missing");
        &font[row.1..row.1 + row.2]
    }

    #[test]
    fn extracts_a_face_with_a_sorted_directory_and_valid_checksums() {
        let (source, pool) = build_collection();
        let font = extract_face(&source, 0).expect("face 0 extracts");

        let (version, rows) = directory(&font);
        assert_eq!(&version, &0x0001_0000u32.to_be_bytes());
        let tags: Vec<[u8; 4]> = rows.iter().map(|(tag, ..)| *tag).collect();
        let mut sorted = tags.clone();
        sorted.sort();
        assert_eq!(tags, sorted, "the directory must be sorted by tag");
        assert_eq!(tags.len(), 4, "face 0 has no glyf table");

        // Every row points at the source table's own bytes, aligned to 4 bytes.
        for (tag, offset, len, sum) in &rows {
            assert_eq!(offset % 4, 0, "table {tag:?} is not 4-byte aligned");
            assert!(*offset + *len <= font.len());
            let source_bytes = &pool.iter().find(|(t, _)| t == tag).unwrap().1;
            let copied = &font[*offset..*offset + *len];
            if tag == b"head" {
                // Only the adjustment is rewritten; the rest must be verbatim.
                assert_eq!(&copied[..8], &source_bytes[..8]);
                assert_eq!(&copied[12..], &source_bytes[12..]);
            } else {
                assert_eq!(copied, source_bytes.as_slice(), "{tag:?}");
            }
            let mut copy = source_bytes.clone();
            if tag == b"head" {
                // The adjustment describes the file it was written for, so the
                // recorded checksum is taken with that field zeroed.
                copy[8..12].fill(0);
            }
            assert_eq!(*sum, checksum(&copy), "checksum of {tag:?}");
        }

        // `head.checkSumAdjustment` has to describe the new file exactly.
        let head_offset = rows.iter().find(|(tag, ..)| tag == b"head").unwrap().1;
        let recorded = u32::from_be_bytes(font[head_offset + 8..head_offset + 12].try_into().unwrap());
        assert_ne!(recorded, 0);
        let mut zeroed = font.clone();
        zeroed[head_offset + 8..head_offset + 12].fill(0);
        assert_eq!(recorded, 0xB1B0_AFBAu32.wrapping_sub(checksum(&zeroed)));

        // The offset table's own derived fields.
        let count = rows.len() as u16;
        let (search_range, entry_selector, range_shift) = search_fields(count);
        assert_eq!(u16::from_be_bytes([font[4], font[5]]), count);
        assert_eq!(u16::from_be_bytes([font[6], font[7]]), search_range);
        assert_eq!(u16::from_be_bytes([font[8], font[9]]), entry_selector);
        assert_eq!(u16::from_be_bytes([font[10], font[11]]), range_shift);
    }

    #[test]
    fn keeps_a_face_only_table_and_pads_the_file_to_four_bytes() {
        let (source, _) = build_collection();
        let font = extract_face(&source, 1).expect("face 1 extracts");
        let (_, rows) = directory(&font);
        assert_eq!(rows.len(), 5, "face 1 carries glyf as well");
        assert_eq!(table_bytes(&font, &rows, b"glyf"), &[0xAB; 23]);
        assert_eq!(font.len() % 4, 0);
        let last = rows.iter().max_by_key(|(_, offset, ..)| *offset).unwrap();
        let padding = font.len() - (last.1 + last.2);
        assert!(padding < 4, "padding is at most 3 bytes, got {padding}");
        assert!(
            font[last.1 + last.2..].iter().all(|byte| *byte == 0),
            "padding stays zeroed"
        );
    }

    #[test]
    fn rejects_anything_that_is_not_a_usable_collection() {
        assert!(extract_face(&[], 0).is_err());
        assert!(extract_face(b"\x00\x01\x00\x00\x00\x05", 0).is_err());
        let (source, _) = build_collection();
        assert!(extract_face(&source, 2).is_err(), "index is out of range");
        assert!(extract_face(&source[..14], 0).is_err(), "truncated header");
        assert!(extract_face(&source[..40], 0).is_err(), "truncated directory");

        // A table pointing past the end of the file must not be copied.
        let mut broken = source.clone();
        let dir = u32::from_be_bytes(broken[12..16].try_into().unwrap()) as usize;
        broken[dir + 12 + 8..dir + 12 + 12].copy_from_slice(&u32::MAX.to_be_bytes());
        assert!(extract_face(&broken, 0).is_err());
    }

    #[test]
    fn asset_names_are_stable_safe_and_follow_the_content() {
        let path = Path::new("/fonts/Example.ttc");
        let name = asset_name(path, 1, 1024, Some(7), false);
        assert_eq!(name, asset_name(path, 1, 1024, Some(7), false));
        assert!(name.ends_with("-1.ttf"), "{name}");
        assert!(!name.contains('/') && !name.contains('\\'));
        assert_ne!(name, asset_name(path, 2, 1024, Some(7), false));
        assert_ne!(name, asset_name(path, 1, 2048, Some(7), false));
        assert_ne!(name, asset_name(path, 1, 1024, Some(8), false));
        assert_ne!(name, asset_name(Path::new("/fonts/Other.ttc"), 1, 1024, Some(7), false));
        assert!(asset_name(path, 0, 1024, None, true).ends_with("-0.otf"));
    }

    #[test]
    fn detects_collections_and_cff_only() {
        let (source, _) = build_collection();
        assert!(is_collection(&source));
        assert!(!is_collection(b"OTTO"));
        assert!(!is_cff(&source));
        assert!(is_cff(b"OTTO"));
    }


    struct TestDirectory(PathBuf);

    impl TestDirectory {
        fn new() -> Self {
            use std::sync::atomic::{AtomicU64, Ordering};
            static TEST_DIRS: AtomicU64 = AtomicU64::new(0);
            let root = std::env::temp_dir();
            loop {
                let path = root.join(format!(
                    "zfm-preview-test-{}-{}",
                    std::process::id(),
                    TEST_DIRS.fetch_add(1, Ordering::Relaxed)
                ));
                match fs::create_dir(&path) {
                    Ok(()) => return Self(path),
                    Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
                    Err(e) => panic!("create test directory: {e}"),
                }
            }
        }
    }

    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn prune_enforces_the_budget_oldest_first() {
        let dir = TestDirectory::new();
        for name in ["a.ttf", "b.ttf", "c.ttf"] {
            fs::write(dir.0.join(name), vec![0u8; 1024]).unwrap();
        }
        let count = |dir: &TestDirectory| fs::read_dir(&dir.0).unwrap().count();

        prune_in(&dir.0, 4096);
        assert_eq!(count(&dir), 3, "inside the budget nothing goes");
        prune_in(&dir.0, 0);
        assert_eq!(count(&dir), 0, "over the budget everything can go");
    }

    #[test]
    fn prune_keeps_the_folder_within_its_budget() {
        let dir = TestDirectory::new();
        for name in ["a.ttf", "b.ttf"] {
            fs::write(dir.0.join(name), vec![0u8; 1024]).unwrap();
        }
        // Room for one file only: exactly one has to be dropped, never both.
        prune_in(&dir.0, 1024);
        assert_eq!(fs::read_dir(&dir.0).unwrap().count(), 1);
        // Nothing has been generated yet: a missing folder is not a failure.
        prune_in(&dir.0.join("does-not-exist"), 0);
    }

    fn family(face: &ttf_parser::Face) -> Option<String> {
        face.names()
            .into_iter()
            .filter(|n| n.name_id == ttf_parser::name_id::FAMILY)
            .find_map(|n| n.to_string())
    }

    fn installed_collection() -> Option<PathBuf> {
        let mut roots = vec![
            PathBuf::from("/usr/share/fonts"),
            PathBuf::from("/Library/Fonts"),
            PathBuf::from("/System/Library/Fonts"),
            PathBuf::from("C:\\Windows\\Fonts"),
        ];
        if let Some(home) = dirs::home_dir() {
            roots.push(home.join("Library/Fonts"));
            roots.push(home.join(".local/share/fonts"));
        }
        roots.into_iter().filter(|root| root.is_dir()).find_map(|root| {
            walkdir::WalkDir::new(root)
                .into_iter()
                .filter_map(|e| e.ok())
                .map(|e| e.into_path())
                .find(|p| {
                    p.extension()
                        .and_then(|e| e.to_str())
                        .is_some_and(|e| e.eq_ignore_ascii_case("ttc") || e.eq_ignore_ascii_case("otc"))
                })
        })
    }

    /// Every face of a real collection must survive the round trip as itself,
    /// and the browser only accepts a font whose checksums and `head` agree.
    #[test]
    fn extracts_every_face_of_an_installed_collection() {
        let Some(path) = installed_collection() else { return };
        let data = fs::read(&path).unwrap();
        let count = ttf_parser::fonts_in_collection(&data).unwrap_or(1);
        assert!(count > 0);
        for index in 0..count {
            let font = extract_face(&data, index)
                .unwrap_or_else(|e| panic!("face {index} of {path:?}: {e}"));
            assert!(
                font.len() <= data.len(),
                "face {index} of {path:?} grew beyond its collection"
            );
            let face = ttf_parser::Face::parse(&font, 0)
                .unwrap_or_else(|e| panic!("face {index} of {path:?} does not parse: {e}"));
            let original = ttf_parser::Face::parse(&data, index).unwrap();
            assert_eq!(family(&face), family(&original), "face {index} of {path:?}");
            assert_eq!(face.number_of_glyphs(), original.number_of_glyphs());
            assert_eq!(face.units_per_em(), original.units_per_em());
        }
    }
}
