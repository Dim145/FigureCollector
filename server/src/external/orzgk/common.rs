//! Shared parsing helpers used by both [`super::search`] and
//! [`super::detail`].

/// Collapse all whitespace runs into a single space, trim ends. Used so
/// "  €53.28  –  €133.21\n  " comes out as "€53.28 – €133.21".
pub(super) fn collapse_ws(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut prev_space = false;
    for c in s.chars() {
        if c.is_whitespace() {
            if !prev_space {
                out.push(' ');
            }
            prev_space = true;
        } else {
            out.push(c);
            prev_space = false;
        }
    }
    out.trim().to_string()
}

/// Look for "1/4", "1/6", "1/7", "1/8", "1/10", "1/12", "non-scale" in a
/// title. First match wins; case-insensitive on the "non-scale" branch.
pub(super) fn extract_scale(title: &str) -> Option<String> {
    let lower = title.to_lowercase();
    if lower.contains("non-scale") || lower.contains("non scale") {
        return Some("non-scale".into());
    }
    // 1/N up to a couple digits — handles "1/4 scale", "1/7 …", etc.
    for n in [4u8, 5, 6, 7, 8, 10, 12, 16, 24, 144] {
        let needle = format!("1/{n}");
        if title.contains(&needle) {
            return Some(needle);
        }
    }
    None
}
