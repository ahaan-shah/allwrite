//! Stops WebKit from waking a sleeping GPU.
//!
//! When a page loads, WebKitGTK opens every `/dev/dri/card*` node to find the display's DRM
//! device. On a hybrid-graphics laptop that powers up the suspended discrete GPU, which blocks
//! the main thread for about two seconds (measured: 2.5 s start instead of 0.35 s) and costs
//! battery. An editor that renders in software has no use for that GPU.
//!
//! libdrm opens the node through glibc's fortified `__open_2`. The executable exports its own
//! `__open_2` (see build.rs), which the dynamic linker resolves ahead of glibc's. It answers
//! "no such file" for DRM nodes whose device is runtime-suspended and forwards everything else.

use std::ffi::{c_char, c_int, CStr};
use std::sync::atomic::{AtomicBool, Ordering};

static ENABLED: AtomicBool = AtomicBool::new(false);

extern "C" {
    fn open(path: *const c_char, flags: c_int, ...) -> c_int;
    fn __errno_location() -> *mut c_int;
}

const ENOENT: c_int = 2;

pub fn enable() {
    ENABLED.store(true, Ordering::Relaxed);
}

/// `card0` for `/dev/dri/card0`, `renderD129` for `/dev/dri/renderD129`; None for anything else.
pub fn drm_node(path: &[u8]) -> Option<&str> {
    let name = std::str::from_utf8(path.strip_prefix(b"/dev/dri/")?).ok()?;
    let digits = name.strip_prefix("card").or_else(|| name.strip_prefix("renderD"))?;
    (!digits.is_empty() && digits.bytes().all(|b| b.is_ascii_digit())).then_some(name)
}

fn is_suspended(node: &str) -> bool {
    std::fs::read_to_string(format!("/sys/class/drm/{node}/device/power/runtime_status"))
        .map(|s| s.trim() == "suspended")
        .unwrap_or(false)
}

/// # Safety
/// Called by C code with the contract of glibc's `__open_2`: `path` is a NUL-terminated string.
#[no_mangle]
pub unsafe extern "C" fn __open_2(path: *const c_char, flags: c_int) -> c_int {
    if ENABLED.load(Ordering::Relaxed) && !path.is_null() {
        if let Some(node) = drm_node(CStr::from_ptr(path).to_bytes()) {
            if is_suspended(node) {
                *__errno_location() = ENOENT;
                return -1;
            }
        }
    }
    open(path, flags)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognizes_drm_nodes_only() {
        assert_eq!(drm_node(b"/dev/dri/card0"), Some("card0"));
        assert_eq!(drm_node(b"/dev/dri/renderD129"), Some("renderD129"));
        assert_eq!(drm_node(b"/dev/dri/card"), None);
        assert_eq!(drm_node(b"/dev/dri/card0/../x"), None);
        assert_eq!(drm_node(b"/dev/dri/by-path/pci-0000:00:02.0-card"), None);
        assert_eq!(drm_node(b"/home/u/dev/dri/card0"), None);
        assert_eq!(drm_node(b"/etc/passwd"), None);
    }

    #[test]
    fn passes_ordinary_opens_through() {
        let fd = unsafe { __open_2(c"/dev/null".as_ptr(), 0) };
        assert!(fd >= 0);
        drop(unsafe { <std::fs::File as std::os::fd::FromRawFd>::from_raw_fd(fd) });
        assert_eq!(unsafe { __open_2(c"/nonexistent/x".as_ptr(), 0) }, -1);
    }
}
