//! Installed font families, read from fontconfig via `fc-list`.

use std::process::Command;

pub fn parse_fc_list(out: &str) -> Vec<String> {
    let mut v: Vec<String> = out
        .lines()
        .map(|l| l.split(',').next().unwrap_or("").trim().to_string())
        .filter(|l| !l.is_empty() && !l.starts_with('.'))
        .collect();
    v.sort_by_key(|a| a.to_lowercase());
    v.dedup();
    v
}

pub fn list() -> Vec<String> {
    Command::new("fc-list")
        .args(["--format", "%{family[0]}\n"])
        .output()
        .ok()
        .map(|o| parse_fc_list(&String::from_utf8_lossy(&o.stdout)))
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_sorts_dedups() {
        let out = "JetBrains Mono\nInter\nJetBrains Mono\n\nNoto Serif,Noto Serif Light\n.Hidden\ninter display\n";
        assert_eq!(
            parse_fc_list(out),
            vec!["Inter", "inter display", "JetBrains Mono", "Noto Serif"]
        );
    }
}
