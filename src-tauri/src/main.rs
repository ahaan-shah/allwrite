#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod clipboard;
mod config;
mod files;
mod fonts;
mod gpu_guard;
mod theme;

use notify::{EventKind, RecursiveMode, Watcher};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};

static PORTAL: Mutex<theme::PortalState> = Mutex::new(theme::PortalState { scheme: None, accent: None });

#[derive(Default)]
struct Doc {
    path: Option<PathBuf>,
    /// Hash of the bytes we last read from or wrote to disk.
    hash: u64,
    watched_dir: Option<PathBuf>,
}

struct AppState {
    doc: Mutex<Doc>,
    config: Mutex<config::Config>,
    watcher: Mutex<Option<notify::RecommendedWatcher>>,
}

fn current_theme(state: &AppState) -> theme::Theme {
    let map = state.config.lock().unwrap().theme.clone();
    theme::current(*PORTAL.lock().unwrap(), &map)
}

/// Point the watcher and the asset scope at the folder of the open document.
fn track(app: &AppHandle, state: &AppState, path: &Path, hash: u64) {
    let dir = path.parent().map(Path::to_path_buf);
    let mut doc = state.doc.lock().unwrap();
    if doc.watched_dir != dir {
        let mut guard = state.watcher.lock().unwrap();
        if let Some(w) = guard.as_mut() {
            if let Some(old) = &doc.watched_dir {
                let _ = w.unwatch(old);
            }
            doc.watched_dir = None;
            if let Some(d) = &dir {
                if d.is_dir() && w.watch(d, RecursiveMode::NonRecursive).is_ok() {
                    doc.watched_dir = dir.clone();
                }
            }
        }
    }
    if let Some(d) = &dir {
        let _ = app.asset_protocol_scope().allow_directory(d, true);
    }
    doc.path = Some(path.to_path_buf());
    doc.hash = hash;
}

fn open_path(app: &AppHandle, state: &AppState, path: &Path) -> Result<files::OpenedFile, String> {
    let (file, hash) = files::read(path)?;
    track(app, state, Path::new(&file.path), hash);
    if file.exists {
        files::add_recent(&file.path);
    }
    Ok(file)
}

#[derive(Serialize)]
struct Init {
    config: config::Config,
    theme: theme::Theme,
    file: Option<files::OpenedFile>,
    error: Option<String>,
}

#[tauri::command]
fn init(app: AppHandle, state: State<AppState>) -> Init {
    let arg = std::env::args().skip(1).find(|a| !a.starts_with('-'));
    let (file, error) = match arg {
        Some(a) => match open_path(&app, &state, Path::new(&a)) {
            Ok(f) => (Some(f), None),
            Err(e) => (None, Some(e)),
        },
        None => (None, None),
    };
    // Take the config in its own statement: the guard must drop before current_theme locks again.
    let config = state.config.lock().unwrap().clone();
    Init { config, theme: current_theme(&state), file, error }
}

#[tauri::command]
fn read_file(app: AppHandle, state: State<AppState>, path: String) -> Result<files::OpenedFile, String> {
    open_path(&app, &state, Path::new(&path))
}

#[tauri::command]
fn write_file(app: AppHandle, state: State<AppState>, path: String, content: String) -> Result<files::OpenedFile, String> {
    let path = files::absolute(Path::new(&path));
    let hash = files::hash(content.as_bytes());
    // Record the hash first so the watcher ignores our own write.
    track(&app, &state, &path, hash);
    files::atomic_write(&path, content.as_bytes())?;
    track(&app, &state, &path, hash); // folder may not have existed before the write
    let s = path.to_string_lossy().into_owned();
    files::add_recent(&s);
    Ok(files::OpenedFile {
        name: path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
        dir: path.parent().map(|d| d.to_string_lossy().into_owned()).unwrap_or_default(),
        path: s,
        content: String::new(),
        readonly: false,
        exists: true,
    })
}

/// The frontend calls this for "New": stop tracking the previous document.
#[tauri::command]
fn close_file(state: State<AppState>) {
    let mut doc = state.doc.lock().unwrap();
    doc.path = None;
    doc.hash = 0;
}

fn doc_path(state: &AppState) -> Result<PathBuf, String> {
    state.doc.lock().unwrap().path.clone().ok_or_else(|| "Save the document first".to_string())
}

/// Raw body = image bytes, header `ext` = file extension.
#[tauri::command]
fn save_image(request: tauri::ipc::Request<'_>, state: State<AppState>) -> Result<String, String> {
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("expected raw image bytes".into());
    };
    let ext = request.headers().get("ext").and_then(|v| v.to_str().ok()).unwrap_or("png");
    files::save_pasted_image(&doc_path(&state)?, bytes, ext)
}

/// Paste from the system clipboard: an image is saved to assets/, copied image files are imported.
/// Returns the relative paths to link (empty when the clipboard holds no image).
/// Async so the clipboard tools never block the GTK main thread.
#[tauri::command]
async fn paste_image(state: State<'_, AppState>) -> Result<Vec<String>, String> {
    let doc = doc_path(&state)?;
    match clipboard::read()? {
        clipboard::Clip::Image { bytes, ext } => Ok(vec![files::save_pasted_image(&doc, &bytes, ext)?]),
        clipboard::Clip::Files(paths) => paths
            .iter()
            .filter(|p| files::is_image(Path::new(p)))
            .map(|p| files::import_image(&doc, Path::new(p)))
            .collect(),
        clipboard::Clip::Nothing => Ok(vec![]),
    }
}

#[tauri::command]
fn import_image(state: State<AppState>, src: String) -> Result<String, String> {
    files::import_image(&doc_path(&state)?, Path::new(&src))
}

/// Allow one absolute image path outside the document folder to load via asset://.
#[tauri::command]
fn allow_image(app: AppHandle, path: String) -> Result<(), String> {
    let p = files::absolute(Path::new(&path));
    if !files::is_image(&p) {
        return Err("not an image".into());
    }
    app.asset_protocol_scope().allow_file(&p).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_theme(state: State<AppState>) -> theme::Theme {
    current_theme(&state)
}

#[tauri::command]
fn list_fonts() -> Vec<String> {
    fonts::list()
}

#[tauri::command]
fn recent_files() -> Vec<String> {
    files::recent().into_iter().filter(|p| Path::new(p).exists()).collect()
}

#[tauri::command]
fn set_config(state: State<AppState>, config: config::Config) -> Result<(), String> {
    *state.config.lock().unwrap() = config.clone();
    config::save(&config)
}

#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    let ok = ["http://", "https://", "mailto:"].iter().any(|p| url.starts_with(p));
    if !ok {
        return Err("only http(s) and mailto links can be opened".into());
    }
    let mut cmd = std::process::Command::new("xdg-open");
    cmd.arg(&url);
    // The browser must not inherit our memory-saving overrides.
    for (k, _) in LEAN_ENV {
        cmd.env_remove(k);
    }
    cmd.spawn()
        .map(|mut child| {
            // Reap in the background so no zombie is left behind.
            std::thread::spawn(move || {
                let _ = child.wait();
            });
        })
        .map_err(|e| e.to_string())
}

/// One inotify watcher for both the pywal cache and the open document's folder.
/// The debounce thread blocks on the channel, so it costs nothing while idle.
fn start_watcher(app: &AppHandle) {
    let (tx, rx) = mpsc::channel::<PathBuf>();
    let watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        if let Ok(ev) = res {
            if matches!(ev.kind, EventKind::Access(_)) {
                return;
            }
            for p in ev.paths {
                let _ = tx.send(p);
            }
        }
    });
    let Ok(mut watcher) = watcher else { return };
    let wal_dir = theme::wal_dir();
    if let Some(d) = wal_dir.as_ref().filter(|d| d.is_dir()) {
        let _ = watcher.watch(d, RecursiveMode::NonRecursive);
    }
    *app.state::<AppState>().watcher.lock().unwrap() = Some(watcher);

    let app = app.clone();
    std::thread::spawn(move || {
        let wal_file = theme::wal_file();
        while let Ok(first) = rx.recv() {
            let mut paths = vec![first];
            while let Ok(p) = rx.recv_timeout(Duration::from_millis(100)) {
                paths.push(p);
            }
            let state = app.state::<AppState>();
            if wal_file.as_ref().is_some_and(|w| paths.contains(w)) {
                let _ = app.emit("theme-changed", current_theme(&state));
            }
            let changed = {
                let mut doc = state.doc.lock().unwrap();
                match doc.path.clone().filter(|p| paths.contains(p)) {
                    Some(p) => match std::fs::read(&p) {
                        Ok(bytes) => {
                            let h = files::hash(&bytes);
                            let differs = h != doc.hash;
                            doc.hash = h;
                            differs.then(|| p.to_string_lossy().into_owned())
                        }
                        Err(_) => None,
                    },
                    None => None,
                }
            };
            if let Some(p) = changed {
                let _ = app.emit("file-changed", p);
            }
        }
    });
}

/// Trim WebKit's memory use: we show one local document, no media, no WebGL.
fn tune_webview(app: &AppHandle) {
    let Some(win) = app.get_webview_window("main") else { return };
    let gpu = std::env::var_os("ALLWRITE_GPU").is_some();
    let _ = win.with_webview(move |wv| {
        use webkit2gtk::{CacheModel, HardwareAccelerationPolicy, SettingsExt, WebContextExt, WebViewExt};
        let view = wv.inner();
        if let Some(ctx) = view.context() {
            ctx.set_cache_model(CacheModel::DocumentViewer);
        }
        if let Some(s) = view.settings() {
            if !gpu {
                s.set_hardware_acceleration_policy(HardwareAccelerationPolicy::Never);
            }
            s.set_enable_webgl(false);
            s.set_enable_webaudio(false);
            s.set_enable_media(false);
            s.set_enable_media_stream(false);
            s.set_enable_page_cache(false);
            s.set_enable_html5_database(false);
            s.set_enable_offline_web_application_cache(false);
        }
    });
}

/// Dev hook: `ALLWRITE_SNAPSHOT=/path/out.png` writes a PNG of the page a few seconds after
/// start, so the UI can be checked without the window being visible. Costs nothing when unset.
fn snapshot_hook(app: &AppHandle) {
    let Some(out) = std::env::var_os("ALLWRITE_SNAPSHOT") else { return };
    let delay = std::env::var("ALLWRITE_SNAPSHOT_DELAY").ok().and_then(|s| s.parse().ok()).unwrap_or(3000u64);
    let app = app.clone();
    std::thread::spawn(move || {
        // Optional `ALLWRITE_EVAL=<js>` runs in the page halfway through, to drive the UI in tests.
        std::thread::sleep(Duration::from_millis(delay / 2));
        let Some(win) = app.get_webview_window("main") else { return };
        if let Ok(js) = std::env::var("ALLWRITE_EVAL") {
            let _ = win.eval(js);
        }
        std::thread::sleep(Duration::from_millis(delay - delay / 2));
        let _ = win.with_webview(move |wv| {
            use webkit2gtk::{SnapshotOptions, SnapshotRegion, WebViewExt};
            let out = PathBuf::from(&out);
            wv.inner().snapshot(
                SnapshotRegion::Visible,
                SnapshotOptions::NONE,
                gtk::gio::Cancellable::NONE,
                move |res| match res {
                    Ok(surface) => {
                        let ok = std::fs::File::create(&out)
                            .ok()
                            .and_then(|mut f| surface.write_to_png(&mut f).ok())
                            .is_some();
                        eprintln!("snapshot {}: {}", out.display(), if ok { "written" } else { "failed" });
                    }
                    Err(e) => eprintln!("snapshot failed: {e}"),
                },
            );
        });
    });
}

/// Environment defaults that cut WebKitGTK's memory roughly in half (measured 2026-11-15:
/// ~300 MB -> ~170-185 MB at a 1426x761 @2x window). Applied before GTK starts, only where the
/// user has not set the variable. `ALLWRITE_GPU=1` skips all of them.
const LEAN_ENV: &[(&str, &str)] = &[
    // Software rendering: no GL compositor in the web process.
    ("WEBKIT_DISABLE_COMPOSITING_MODE", "1"),
    ("WEBKIT_DISABLE_DMABUF_RENDERER", "1"),
    // Stop the UI process loading the GPU driver stack (NVIDIA + Mesa/LLVM, ~40 MB) just to probe EGL.
    ("__EGL_VENDOR_LIBRARY_DIRS", "/nonexistent"),
    // Interpreter only: no JIT code or compiler threads (~40 MB). Plenty fast for an editor.
    ("JSC_useJIT", "0"),
    // System malloc instead of bmalloc's per-process caches (~20 MB).
    ("Malloc", "1"),
];

fn lean_env() {
    if std::env::var_os("ALLWRITE_GPU").is_some() {
        return;
    }
    for (k, v) in LEAN_ENV {
        if std::env::var_os(k).is_none() {
            std::env::set_var(k, v);
        }
    }
    gpu_guard::enable();
}

fn main() {
    lean_env();
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState {
            doc: Mutex::new(Doc::default()),
            config: Mutex::new(config::load()),
            watcher: Mutex::new(None),
        })
        .setup(|app| {
            let handle = app.handle().clone();
            // Paint the window in the palette background right away (no white flash).
            if let Some(win) = handle.get_webview_window("main") {
                let bg = current_theme(&handle.state::<AppState>()).bg;
                let ch = |i: usize| u8::from_str_radix(&bg[i..i + 2], 16).unwrap_or(0);
                if bg.len() == 7 {
                    let _ = win.set_background_color(Some(tauri::window::Color(ch(1), ch(3), ch(5), 255)));
                }
            }
            tune_webview(&handle);
            start_watcher(&handle);
            snapshot_hook(&handle);
            // The portal is only a fallback; skip the D-Bus round trip when pywal is present.
            if !theme::wal_file().is_some_and(|p| p.exists()) {
                let h = handle.clone();
                theme::init_portal(&PORTAL, move || {
                    let _ = h.emit("theme-changed", current_theme(&h.state::<AppState>()));
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            init,
            read_file,
            write_file,
            close_file,
            save_image,
            paste_image,
            import_image,
            allow_image,
            get_theme,
            list_fonts,
            recent_files,
            set_config,
            open_url
        ])
        .run(tauri::generate_context!())
        .expect("error while running allwrite");
}
