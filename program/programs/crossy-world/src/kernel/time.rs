//! UTC day arithmetic. The authoritative day id is `floor(unix_ts / 86_400)`;
//! browser clocks are never consulted.

use crate::constants::DAY_SECONDS;

/// Day id for a nonnegative production timestamp. Returns `None` for
/// pre-epoch timestamps, which are impossible in production and rejected
/// rather than mis-bucketed.
pub const fn utc_day_from_unix(unix_ts: i64) -> Option<u64> {
    if unix_ts < 0 {
        return None;
    }
    Some((unix_ts as u64) / (DAY_SECONDS as u64))
}

/// Inclusive first second of a UTC day.
pub const fn day_start(day: u64) -> Option<i64> {
    match day.checked_mul(DAY_SECONDS as u64) {
        Some(v) if v <= i64::MAX as u64 => Some(v as i64),
        _ => None,
    }
}

/// Exclusive end of a UTC day: the hard cutoff. No gameplay, entry, or
/// revival executes at or after this instant.
pub const fn day_end(day: u64) -> Option<i64> {
    match day.checked_add(1) {
        Some(next) => day_start(next),
        None => None,
    }
}

/// True while `now` is inside the day's [start, end) window.
pub fn within_day(day: u64, now: i64) -> bool {
    match (day_start(day), day_end(day)) {
        (Some(start), Some(end)) => now >= start && now < end,
        _ => false,
    }
}

/// True at or after the hard cutoff.
pub fn cutoff_passed(day: u64, now: i64) -> bool {
    match day_end(day) {
        Some(end) => now >= end,
        // Unrepresentable day end means the day can never be live.
        None => true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn day_id_boundaries() {
        assert_eq!(utc_day_from_unix(0), Some(0));
        assert_eq!(utc_day_from_unix(86_399), Some(0));
        assert_eq!(utc_day_from_unix(86_400), Some(1));
        assert_eq!(utc_day_from_unix(-1), None);
        // 2026-08-13 00:00:00 UTC
        assert_eq!(utc_day_from_unix(1_786_924_800), Some(20_682));
    }

    #[test]
    fn cutoff_is_hard_and_exclusive() {
        let day = 20_682u64;
        let end = day_end(day).unwrap();
        assert!(within_day(day, end - 1));
        assert!(!within_day(day, end));
        assert!(!cutoff_passed(day, end - 1));
        assert!(cutoff_passed(day, end)); // exactly at cutoff: rejected
        assert!(cutoff_passed(day, end + 1));
    }

    #[test]
    fn start_end_relationship() {
        for day in [0u64, 1, 20_682, 1_000_000] {
            assert_eq!(day_end(day).unwrap(), day_start(day + 1).unwrap());
            assert_eq!(day_end(day).unwrap() - day_start(day).unwrap(), DAY_SECONDS);
        }
    }
}
