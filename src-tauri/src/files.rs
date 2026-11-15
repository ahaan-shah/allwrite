//! Reading, atomic writing, image import, recent files.

use serde::Serialize;
use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

pub const IMAGE_EXTS: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "avif", "ico"];

#[derive(Serialize, Clone, Debug)]
pub struct OpenedFile {
    pub path: String,
    pub name: String,
    pub dir: String,
    pub content: String,
    /// Not valid UTF-8: shown lossily, must not be saved over.
    pub readonly: bool,
    pub exists: bool,
}

pub fn hash(bytes: &[u8]) -> u64 {
    let mut h = DefaultHasher::new();
    bytes.hash(&mut h);
    h.finish()
}

/// Make a path absolute and remove `.` / `..` without touching the filesystem.
pub fn absolute(path: &Path) -> PathBuf {
    let joined = if path.is_absolute() {
        path.to_path_buf()
    } else {
        std::env::current_dir().unwrap_or_default().join(path)
    };
    let mut out = PathBuf::new();
    for c in joined.components() {
        match c {
            Component::CurDir => {}
            Component::ParentDir => {
                out.pop();
            }
            other => out.push(other),
        }
    }
    out
}

/// Returns the file and the hash of its on-disk bytes.
pub fn read(path: &Path) -> Result<(OpenedFile, u64), String> {
    let path = absolute(path);
    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    let dir = path.parent().map(|d| d.to_string_lossy().into_owned()).unwrap_or_default();
    let mk = |content: String, readonly: bool, exists: bool| OpenedFile {
        path: path.to_string_lossy().into_owned(),
        name: name.clone(),
        dir: dir.clone(),
        content,
        readonly,
        exists,
    };
    if !path.exists() {
        return Ok((mk(String::new(), false, false), hash(b"")));
    }
    if path.is_dir() {
        return Err(format!("{} is a directory", path.display()));
    }
    let bytes = fs::read(&path).map_err(|e| format!("{}: {e}", path.display()))?;
    let h = hash(&bytes);
    Ok(match String::from_utf8(bytes) {
        Ok(s) => (mk(s, false, true), h),
        Err(e) => (mk(String::from_utf8_lossy(e.as_bytes()).into_owned(), true, true), h),
    })
}

/// Write to a temp file in the same directory, fsync, then rename over the target.
pub fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    // Write through symlinks rather than replacing them.
    let target = fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let dir = target.parent().ok_or("path has no parent directory")?;
    fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let fname = target.file_name().ok_or("path has no file name")?.to_string_lossy();
    let tmp = dir.join(format!(".{fname}.allwrite-tmp"));
    let res = (|| -> std::io::Result<()> {
        let mut f = fs::File::create(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
        if let Ok(meta) = fs::metadata(&target) {
            let _ = fs::set_permissions(&tmp, meta.permissions());
        }
        fs::rename(&tmp, &target)
    })();
    if res.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    res.map_err(|e| format!("{}: {e}", target.display()))
}

pub fn is_image(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| IMAGE_EXTS.contains(&e.to_ascii_lowercase().as_str()))
        .unwrap_or(false)
}

/// UTC timestamp like 20261115-130455.
pub fn timestamp(secs: u64) -> String {
    let days = (secs / 86400) as i64;
    let rem = secs % 86400;
    // Civil-from-days (Howard Hinnant).
    let z = days + 719468;
    let era = z.div_euclid(146097);
    let doe = z.rem_euclid(146097);
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + if m <= 2 { 1 } else { 0 };
    format!("{y:04}{m:02}{d:02}-{:02}{:02}{:02}", rem / 3600, rem % 3600 / 60, rem % 60)
}

fn unique(dir: &Path, stem: &str, ext: &str) -> PathBuf {
    let mut p = dir.join(format!("{stem}.{ext}"));
    let mut n = 1;
    while p.exists() {
        p = dir.join(format!("{stem}-{n}.{ext}"));
        n += 1;
    }
    p
}

fn rel_string(doc_dir: &Path, target: &Path) -> Option<String> {
    let rel = target.strip_prefix(doc_dir).ok()?;
    Some(rel.components().map(|c| c.as_os_str().to_string_lossy()).collect::<Vec<_>>().join("/"))
}

/// Save pasted image bytes to `<doc dir>/assets/<timestamp>.<ext>`; returns the relative path.
pub fn save_pasted_image(doc: &Path, bytes: &[u8], ext: &str) -> Result<String, String> {
    let ext = ext.to_ascii_lowercase();
    if !IMAGE_EXTS.contains(&ext.as_str()) {
        return Err(format!("unsupported image type: {ext}"));
    }
    let doc_dir = doc.parent().ok_or("document has no folder")?;
    let assets = doc_dir.join("assets");
    fs::create_dir_all(&assets).map_err(|e| e.to_string())?;
    let secs = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    let dest = unique(&assets, &timestamp(secs), &ext);
    fs::write(&dest, bytes).map_err(|e| e.to_string())?;
    rel_string(doc_dir, &dest).ok_or_else(|| "bad path".to_string())
}

/// Reference an existing image from the document: reuse it if it already lives under the
/// document's folder, otherwise copy it into `assets/`. Returns the relative path.
pub fn import_image(doc: &Path, src: &Path) -> Result<String, String> {
    if !is_image(src) {
        return Err("not an image file".into());
    }
    let doc_dir = doc.parent().ok_or("document has no folder")?;
    let src = absolute(src);
    if let Some(rel) = rel_string(doc_dir, &src) {
        return Ok(rel);
    }
    let assets = doc_dir.join("assets");
    fs::create_dir_all(&assets).map_err(|e| e.to_string())?;
    let stem = src.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| "image".into());
    let ext = src.extension().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let dest = unique(&assets, &stem, &ext);
    fs::copy(&src, &dest).map_err(|e| e.to_string())?;
    rel_string(doc_dir, &dest).ok_or_else(|| "bad path".to_string())
}

// ---- recent files ----

const MAX_RECENT: usize = 12;

fn recent_path() -> Option<PathBuf> {
    Some(dirs::state_dir().or_else(dirs::cache_dir)?.join("allwrite").join("recent.json"))
}

pub fn recent() -> Vec<String> {
    recent_path()
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|t| serde_json::from_str::<Vec<String>>(&t).ok())
        .unwrap_or_default()
}

pub fn push_recent(list: &mut Vec<String>, path: &str) {
    list.retain(|p| p != path);
    list.insert(0, path.to_string());
    list.truncate(MAX_RECENT);
}

pub fn add_recent(path: &str) {
    let mut list = recent();
    if list.first().map(String::as_str) == Some(path) {
        return;
    }
    push_recent(&mut list, path);
    if let (Some(p), Ok(json)) = (recent_path(), serde_json::to_string(&list)) {
        let _ = atomic_write(&p, json.as_bytes());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmpdir(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("allwrite-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn atomic_write_creates_and_replaces() {
        let d = tmpdir("atomic");
        let f = d.join("a.md");
        atomic_write(&f, b"one").unwrap();
        assert_eq!(fs::read(&f).unwrap(), b"one");
        atomic_write(&f, b"two").unwrap();
        assert_eq!(fs::read(&f).unwrap(), b"two");
        // no temp files left behind
        assert_eq!(fs::read_dir(&d).unwrap().count(), 1);
        fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn atomic_write_keeps_symlink_and_mode() {
        use std::os::unix::fs::PermissionsExt;
        let d = tmpdir("symlink");
        let real = d.join("real.txt");
        let link = d.join("link.txt");
        fs::write(&real, "x").unwrap();
        fs::set_permissions(&real, fs::Permissions::from_mode(0o600)).unwrap();
        std::os::unix::fs::symlink(&real, &link).unwrap();
        atomic_write(&link, b"new").unwrap();
        assert!(fs::symlink_metadata(&link).unwrap().file_type().is_symlink());
        assert_eq!(fs::read(&real).unwrap(), b"new");
        assert_eq!(fs::metadata(&real).unwrap().permissions().mode() & 0o777, 0o600);
        fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn read_utf8_missing_and_binary() {
        let d = tmpdir("read");
        let f = d.join("a.txt");
        fs::write(&f, "héllo").unwrap();
        let (o, h) = read(&f).unwrap();
        assert_eq!(o.content, "héllo");
        assert!(!o.readonly && o.exists);
        assert_eq!(h, hash("héllo".as_bytes()));
        assert_eq!(o.name, "a.txt");

        let (m, _) = read(&d.join("missing.md")).unwrap();
        assert!(!m.exists && m.content.is_empty() && !m.readonly);

        let b = d.join("b.bin");
        fs::write(&b, [0xff, 0xfe, b'a']).unwrap();
        assert!(read(&b).unwrap().0.readonly);
        assert!(read(&d).is_err());
        fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn absolute_normalizes() {
        assert_eq!(absolute(Path::new("/a/b/../c/./d.md")), PathBuf::from("/a/c/d.md"));
        assert!(absolute(Path::new("x.md")).is_absolute());
    }

    #[test]
    fn timestamp_format() {
        assert_eq!(timestamp(0), "19700101-000000");
        assert_eq!(timestamp(1_794_747_895), "20261115-130455");
        assert_eq!(timestamp(951_782_400), "20000229-000000");
    }

    #[test]
    fn pasted_and_imported_images() {
        let d = tmpdir("img");
        let doc = d.join("notes").join("n.md");
        fs::create_dir_all(doc.parent().unwrap()).unwrap();
        let rel = save_pasted_image(&doc, b"png", "PNG").unwrap();
        assert!(rel.starts_with("assets/") && rel.ends_with(".png"));
        assert!(doc.parent().unwrap().join(&rel).exists());
        assert!(save_pasted_image(&doc, b"x", "exe").is_err());

        // already inside the doc folder: referenced in place
        let inside = doc.parent().unwrap().join("pics").join("p.jpg");
        fs::create_dir_all(inside.parent().unwrap()).unwrap();
        fs::write(&inside, "j").unwrap();
        assert_eq!(import_image(&doc, &inside).unwrap(), "pics/p.jpg");

        // outside: copied to assets, deduplicated by name
        let outside = d.join("o.gif");
        fs::write(&outside, "g").unwrap();
        assert_eq!(import_image(&doc, &outside).unwrap(), "assets/o.gif");
        assert_eq!(import_image(&doc, &outside).unwrap(), "assets/o-1.gif");
        assert!(import_image(&doc, &d.join("x.txt")).is_err());
        fs::remove_dir_all(&d).unwrap();
    }

    #[test]
    fn recent_ordering() {
        let mut l = vec!["a".to_string(), "b".to_string()];
        push_recent(&mut l, "b");
        assert_eq!(l, vec!["b", "a"]);
        for i in 0..20 {
            push_recent(&mut l, &format!("f{i}"));
        }
        assert_eq!(l.len(), MAX_RECENT);
        assert_eq!(l[0], "f19");
    }
}
