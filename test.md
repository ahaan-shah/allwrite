# allwrite test document

A paragraph with **bold**, *italic*, ~~strikethrough~~, `inline code` and a [link](https://example.com "title").
Bare URL: https://codemirror.net and an escaped \* star.

## Lists

- First bullet
- Second bullet with **bold**
  - Nested bullet
1. Ordered one
2. Ordered two

- [ ] Open task
- [x] Finished task

## Quote and rule

> A quoted line that is long enough to wrap around at the configured column width so the bar can be checked.
> Second quoted line.

---

### Code

```rust
fn main() {
    let greeting = "hello"; // comment
    println!("{greeting} {}", 42);
}
```

| Column | Value |
|--------|-------|
| a      | 1     |

## Images

Local (relative): ![blue logo](logos/markdown-reader-blue.svg)

Remote: ![remote](https://www.gstatic.com/webp/gallery/1.sm.jpg)

Broken: ![missing](does-not-exist.png)

Setext heading
--------------

Last line.
