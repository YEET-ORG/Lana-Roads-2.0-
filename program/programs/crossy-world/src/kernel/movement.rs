//! Bounded catch-up cadence. Slots are provided by the runtime, never clients.
pub const MAX_MOVE_BATCH: usize = 4;

/// Spend one elapsed slot interval, retaining at most four moves of credit.
/// A new run has no stored credit. A backwards clock cannot create credit.
pub fn next_move_slot(last: u64, now: u64, gap: u64) -> Option<u64> {
    if gap == 0 || now == 0 || now < last {
        return None;
    }
    if last == 0 {
        return Some(now);
    }
    let window = gap.checked_mul(MAX_MOVE_BATCH as u64)?;
    let next = last.max(now.saturating_sub(window)).checked_add(gap)?;
    (next <= now).then_some(next)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bounded_credit_normal_and_slowed() {
        for gap in [1, 2] {
            for elapsed in 0..100 {
                let now = 100 + elapsed;
                let mut last = 100;
                let mut accepted = 0;
                while let Some(slot) = next_move_slot(last, now, gap) {
                    assert!(slot > last && slot <= now);
                    last = slot;
                    accepted += 1;
                }
                assert_eq!(accepted, (elapsed / gap).min(MAX_MOVE_BATCH as u64));
            }
        }
    }

    #[test]
    fn no_credit_on_spawn_clock_reversal_or_overflow() {
        assert_eq!(next_move_slot(0, 100, 1), Some(100));
        assert_eq!(next_move_slot(0, 0, 1), None);
        assert_eq!(next_move_slot(100, 100, 1), None);
        assert_eq!(next_move_slot(100, 99, 1), None);
        assert_eq!(next_move_slot(u64::MAX, u64::MAX, 1), None);
        assert_eq!(next_move_slot(1, 100, u64::MAX), None);
    }
}
