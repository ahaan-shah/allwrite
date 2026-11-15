fn main() {
    // Let the dynamic linker see our `__open_2` (src/gpu_guard.rs) ahead of glibc's.
    println!("cargo:rustc-link-arg-bins=-Wl,--export-dynamic-symbol=__open_2");
    tauri_build::build()
}
