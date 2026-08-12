//! Money math: revival doubling, settlement split, marketplace split.
//! Checked arithmetic only; overflow rejects the operation before any token
//! transfer.

use crate::constants::{BPS_DENOMINATOR, MARKET_TEAM_BPS, REVIVE_BASE_PRICE, TEAM_BPS};

/// Price of the next revival given the number of *successful* revivals so
/// far: 10, 20, 40, 80 … USDC. No game-rule cap — `None` only when the value
/// cannot be represented in u64, which rejects the revival.
pub fn revive_price(successful_revives: u16) -> Option<u64> {
    // 10 USDC * 2^n with checked shift. 10e6 < 2^24, so n >= 40 always
    // overflows u64; checked_shl + checked_mul covers every case.
    if successful_revives >= 64 {
        return None;
    }
    1u64.checked_shl(successful_revives as u32)
        .and_then(|m| m.checked_mul(REVIVE_BASE_PRICE))
}

/// 90/10 settlement split. Team gets `floor(pool * 1000 / 10000)`; the winner
/// receives the exact remainder so every indivisible base unit goes to the
/// winner and the full pool is allocated.
pub fn settlement_split(active_pool: u64) -> Option<(u64, u64)> {
    let team = active_pool
        .checked_mul(TEAM_BPS as u64)?
        .checked_div(BPS_DENOMINATOR)?;
    let winner = active_pool.checked_sub(team)?;
    Some((winner, team))
}

/// Marketplace split: 10% team royalty floor, residual 90% (plus rounding
/// units) to the seller.
pub fn market_split(price: u64) -> Option<(u64, u64)> {
    let team = price
        .checked_mul(MARKET_TEAM_BPS as u64)?
        .checked_div(BPS_DENOMINATOR)?;
    let seller = price.checked_sub(team)?;
    Some((seller, team))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn revive_prices_double() {
        assert_eq!(revive_price(0), Some(10_000_000)); // 10 USDC
        assert_eq!(revive_price(1), Some(20_000_000));
        assert_eq!(revive_price(2), Some(40_000_000));
        assert_eq!(revive_price(3), Some(80_000_000));
        assert_eq!(revive_price(10), Some(10_240_000_000));
        // Largest representable doubling: 2^40 * 1e7 < u64::MAX < 2^41 * 1e7
        assert_eq!(revive_price(40), Some(10_995_116_277_760_000_000));
        assert_eq!(revive_price(41), None);
        assert_eq!(revive_price(63), None);
        assert_eq!(revive_price(64), None);
    }

    #[test]
    fn settlement_split_conserves_pool() {
        for pool in [
            0u64,
            1,
            9,
            10,
            999,
            1_000_000,
            123_456_789,
            u64::MAX / 10_000,
        ] {
            let (winner, team) = settlement_split(pool).unwrap();
            assert_eq!(winner + team, pool, "pool must be fully allocated");
            assert_eq!(team, pool / 10, "team gets floor(10%)");
            assert!(winner >= team * 9, "rounding units go to the winner");
        }
    }

    #[test]
    fn market_split_conserves_price() {
        for price in [1u64, 10, 55, 5_000_000, 20_000_000] {
            let (seller, team) = market_split(price).unwrap();
            assert_eq!(seller + team, price);
        }
    }
}
