//! Display-name sanitising.
//!
//! A player's name is shown to everyone else — on the leaderboard and over
//! their head in the world — so what is allowed cannot be a client-side
//! opinion. A client that skips its own checks, or a wallet talking to the
//! program directly, must not be able to put control characters, invisible
//! spacing or a wall of text on someone else's screen.
//!
//! Deliberately conservative: printable ASCII only. Names are cosmetic and
//! never identify a player (the wallet does that), so nothing is lost by
//! refusing what cannot be rendered safely, and a rule that fits in one
//! screen is a rule that can be verified.

/// Longest accepted name, in bytes. Fits a leaderboard row and a nameplate.
pub const NAME_MAX: usize = 20;
/// Shortest accepted name, after trimming.
pub const NAME_MIN: usize = 2;

/// Is this byte allowed inside a name?
///
/// Letters, digits, and a small set of separators that read as part of a
/// name rather than as decoration.
fn allowed(b: u8) -> bool {
    b.is_ascii_alphanumeric() || matches!(b, b' ' | b'_' | b'-' | b'.' | b'\'')
}

/// Trim, validate and normalise a submitted name.
///
/// Returns the accepted bytes, or `None` when the name cannot be shown:
/// empty after trimming, too long, too short, containing anything outside
/// the allowed set, or made only of separators.
pub fn sanitize(raw: &[u8]) -> Option<([u8; NAME_MAX], u8)> {
    // Trim ASCII spaces from both ends. Interior runs are collapsed below.
    let start = raw.iter().position(|b| *b != b' ')?;
    let end = raw.iter().rposition(|b| *b != b' ')? + 1;
    let trimmed = &raw[start..end];
    if trimmed.len() > NAME_MAX || trimmed.len() < NAME_MIN {
        return None;
    }

    let mut out = [0u8; NAME_MAX];
    let mut len = 0usize;
    let mut last_space = false;
    let mut has_visible = false;
    for &b in trimmed {
        if !allowed(b) {
            return None;
        }
        // Collapse runs of spaces so padding cannot be used for layout.
        if b == b' ' {
            if last_space {
                continue;
            }
            last_space = true;
        } else {
            last_space = false;
            if b.is_ascii_alphanumeric() {
                has_visible = true;
            }
        }
        out[len] = b;
        len += 1;
    }
    // A name of nothing but dots and dashes is not a name.
    if !has_visible || len < NAME_MIN {
        return None;
    }
    Some((out, len as u8))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn accepted(s: &str) -> Option<String> {
        sanitize(s.as_bytes())
            .map(|(bytes, len)| String::from_utf8(bytes[..len as usize].to_vec()).unwrap())
    }

    #[test]
    fn keeps_ordinary_names() {
        assert_eq!(accepted("Lana").as_deref(), Some("Lana"));
        assert_eq!(accepted("hop_master-9").as_deref(), Some("hop_master-9"));
        assert_eq!(accepted("J. Frog").as_deref(), Some("J. Frog"));
    }

    #[test]
    fn trims_and_collapses_spacing() {
        assert_eq!(accepted("   Lana  ").as_deref(), Some("Lana"));
        assert_eq!(accepted("big    bird").as_deref(), Some("big bird"));
    }

    #[test]
    fn refuses_what_cannot_be_shown() {
        assert!(accepted("").is_none());
        assert!(accepted("   ").is_none());
        assert!(accepted("a").is_none(), "too short");
        assert!(accepted("this name is far too long to fit").is_none());
        assert!(accepted("bad\nname").is_none(), "control character");
        assert!(accepted("emoji \u{1F600}").is_none(), "non-ascii");
        assert!(accepted("...").is_none(), "no visible characters");
        assert!(accepted("\u{202E}flip").is_none(), "bidi override");
    }

    #[test]
    fn never_writes_past_the_buffer() {
        // Every accepted name reports a length inside the fixed array.
        for raw in ["ab", "abcdefghijklmnopqrst", "a b c d e f g h i j"] {
            let (bytes, len) = sanitize(raw.as_bytes()).expect(raw);
            assert!(len as usize <= NAME_MAX);
            assert!(bytes[len as usize..].iter().all(|b| *b == 0));
        }
    }
}
