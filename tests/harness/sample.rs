use std::collections::HashMap;

/// Counts words in a string.
fn count(text: &str) -> HashMap<&str, usize> {
    let mut map = HashMap::new();
    for word in text.split_whitespace() {
        *map.entry(word).or_insert(0) += 1; // increment
    }
    map
}

fn main() {
    let n = 42;
    println!("{:?} {n}", count("a b a"));
}
