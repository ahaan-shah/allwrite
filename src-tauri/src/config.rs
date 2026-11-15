//! ~/.config/allwrite/config.toml

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::PathBuf;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(default)]
pub struct FontCfg {
    pub text: String,
    pub code: String,
    pub size: f32,
    pub line_height: f32,
    pub column_width: u32,
}

impl Default for FontCfg {
    fn default() -> Self {
        Self {
            text: "Inter".into(),
            code: "JetBrains Mono".into(),
            size: 16.0,
            line_height: 1.6,
            column_width: 72,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(default)]
pub struct AppCfg {
    pub autosave: bool,
    pub remote_images: bool,
}

impl Default for AppCfg {
    fn default() -> Self {
        Self { autosave: false, remote_images: true }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(default)]
pub struct Config {
    pub font: FontCfg,
    pub app: AppCfg,
    /// command id -> key combo, e.g. bold = "Ctrl+B"
    pub keys: BTreeMap<String, String>,
    /// theme slot -> pywal key or hex, e.g. accent = "color4"
    pub theme: BTreeMap<String, String>,
}

pub fn path() -> Option<PathBuf> {
    Some(dirs::config_dir()?.join("allwrite").join("config.toml"))
}

pub fn parse(text: &str) -> Config {
    toml::from_str(text).unwrap_or_default()
}

pub fn load() -> Config {
    path()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .map(|t| parse(&t))
        .unwrap_or_default()
}

pub fn save(cfg: &Config) -> Result<(), String> {
    let p = path().ok_or("no config directory")?;
    let text = toml::to_string_pretty(cfg).map_err(|e| e.to_string())?;
    crate::files::atomic_write(&p, text.as_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_gives_defaults() {
        let c = parse("");
        assert_eq!(c, Config::default());
        assert_eq!(c.font.column_width, 72);
        assert!(c.app.remote_images);
    }

    #[test]
    fn partial_overrides() {
        let c = parse("[font]\ntext = \"Literata\"\nsize = 18\n[keys]\nbold = \"Ctrl+Shift+B\"\n[theme]\naccent = \"color2\"\n");
        assert_eq!(c.font.text, "Literata");
        assert_eq!(c.font.size, 18.0);
        assert_eq!(c.font.code, "JetBrains Mono");
        assert_eq!(c.keys["bold"], "Ctrl+Shift+B");
        assert_eq!(c.theme["accent"], "color2");
    }

    #[test]
    fn invalid_falls_back() {
        assert_eq!(parse("this is [not toml"), Config::default());
    }

    #[test]
    fn roundtrip() {
        let mut c = Config::default();
        c.font.text = "Noto Serif".into();
        c.app.autosave = true;
        let text = toml::to_string_pretty(&c).unwrap();
        assert_eq!(parse(&text), c);
    }
}
