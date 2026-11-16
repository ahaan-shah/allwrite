//! Read an image from the system clipboard. WebKitGTK often does not expose clipboard images
//! (screenshots, "Copy image" in a browser) to the page's paste event, so the frontend asks here.
//! Uses wl-paste on Wayland and xclip on X11; nothing runs until a paste asks for it.

use std::process::{Command, Stdio};

/// What the clipboard holds that we can turn into an image link.
#[derive(Debug, PartialEq)]
pub enum Clip {
    Image { bytes: Vec<u8>, ext: &'static str },
    Files(Vec<String>),
    Nothing,
}

const TYPES: &[(&str, &str)] = &[
    ("image/png", "png"),
    ("image/jpeg", "jpg"),
    ("image/webp", "webp"),
    ("image/gif", "gif"),
    ("image/avif", "avif"),
    ("image/bmp", "bmp"),
    ("image/svg+xml", "svg"),
];

fn run(cmd: &str, args: &[&str]) -> Option<Vec<u8>> {
    let out = Command::new(cmd).args(args).stdin(Stdio::null()).stderr(Stdio::null()).output().ok()?;
    out.status.success().then_some(out.stdout)
}

/// Pick the best image type from a list of offered MIME types.
pub fn best_image_type(types: &str) -> Option<(&'static str, &'static str)> {
    let offered: Vec<&str> = types.lines().map(str::trim).collect();
    TYPES.iter().find(|(mime, _)| offered.contains(mime)).copied()
}

/// Local file paths from a text/uri-list body.
pub fn uri_list_paths(body: &str) -> Vec<String> {
    body.lines()
        .map(str::trim)
        .filter(|l| !l.is_empty() && !l.starts_with('#'))
        .filter_map(|l| l.strip_prefix("file://"))
        .map(|p| p.strip_prefix("localhost").unwrap_or(p))
        .map(percent_decode)
        .collect()
}

fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        let hex = |c: u8| (c as char).to_digit(16).map(|d| d as u8);
        if b[i] == b'%' && i + 2 < b.len() {
            if let (Some(h), Some(l)) = (hex(b[i + 1]), hex(b[i + 2])) {
                out.push(h * 16 + l);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

pub fn read() -> Result<Clip, String> {
    let wayland = std::env::var_os("WAYLAND_DISPLAY").is_some();
    let (list, get): (Vec<&str>, Box<dyn Fn(&str) -> Option<Vec<u8>>>) = if wayland {
        (vec!["wl-paste", "--list-types"], Box::new(|t: &str| run("wl-paste", &["--no-newline", "--type", t])))
    } else {
        (
            vec!["xclip", "-selection", "clipboard", "-t", "TARGETS", "-o"],
            Box::new(|t: &str| run("xclip", &["-selection", "clipboard", "-t", t, "-o"])),
        )
    };
    let types = run(list[0], &list[1..]).ok_or_else(|| {
        if wayland { "Reading the clipboard needs wl-clipboard (pacman -S wl-clipboard)" } else { "Reading the clipboard needs xclip" }
            .to_string()
    })?;
    let types = String::from_utf8_lossy(&types);
    if let Some((mime, ext)) = best_image_type(&types) {
        let bytes = get(mime).filter(|b| !b.is_empty()).ok_or("could not read the image on the clipboard")?;
        return Ok(Clip::Image { bytes, ext });
    }
    if types.lines().any(|t| t.trim() == "text/uri-list") {
        if let Some(body) = get("text/uri-list") {
            let paths = uri_list_paths(&String::from_utf8_lossy(&body));
            if !paths.is_empty() {
                return Ok(Clip::Files(paths));
            }
        }
    }
    Ok(Clip::Nothing)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn picks_image_type() {
        assert_eq!(best_image_type("text/html\nimage/jpeg\nimage/png\n"), Some(("image/png", "png")));
        assert_eq!(best_image_type("text/plain\nUTF8_STRING"), None);
    }

    #[test]
    fn parses_uri_list() {
        let body = "# comment\r\nfile:///home/a/My%20Pics/shot.png\r\nfile://localhost/tmp/b.jpg\nhttps://x.y/z\n";
        assert_eq!(uri_list_paths(body), vec!["/home/a/My Pics/shot.png", "/tmp/b.jpg"]);
    }
}
