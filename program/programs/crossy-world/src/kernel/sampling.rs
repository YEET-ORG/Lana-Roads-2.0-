//! Unbiased randomness consumption for gacha: weighted rarity selection and
//! uniform variant selection, both via rejection sampling (no modulo bias),
//! plus deterministic largest-remainder weight redistribution when a rarity
//! sells out.

use crate::errors::CrossyError;

pub const RARITIES: usize = 4; // Common, Rare, Epic, Legendary

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug)]
#[repr(u8)]
pub enum Rarity {
    Common = 0,
    Rare = 1,
    Epic = 2,
    Legendary = 3,
}

impl Rarity {
    pub fn from_u8(v: u8) -> Option<Self> {
        match v {
            0 => Some(Self::Common),
            1 => Some(Self::Rare),
            2 => Some(Self::Epic),
            3 => Some(Self::Legendary),
            _ => None,
        }
    }
}

/// A deterministic 64-bit stream over VRF output for selection decisions.
/// Same construction as chunk generation but domain-separated by purpose tag.
pub struct SelectionRng {
    state: u64,
    counter: u64,
}

impl SelectionRng {
    pub fn new(randomness: &[u8; 32], domain: u64) -> Self {
        let mut s: u64 = 0x6a09_e667_f3bc_c908 ^ domain;
        for (i, chunk) in randomness.chunks(8).enumerate() {
            let mut b = [0u8; 8];
            b[..chunk.len()].copy_from_slice(chunk);
            s ^= u64::from_le_bytes(b).rotate_left((i as u32 * 17) % 64);
        }
        Self {
            state: s,
            counter: 0,
        }
    }

    fn next_u64(&mut self) -> u64 {
        self.counter = self.counter.wrapping_add(1);
        let mut z = self
            .state
            .wrapping_add(self.counter.wrapping_mul(0x9e37_79b9_7f4a_7c15));
        z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
        z ^ (z >> 31)
    }

    /// Unbiased [0, bound) by rejection.
    pub fn below(&mut self, bound: u64) -> u64 {
        debug_assert!(bound > 0);
        let zone = u64::MAX - (u64::MAX % bound);
        loop {
            let v = self.next_u64();
            if v < zone {
                return v % bound;
            }
        }
    }
}

/// Redistribute base weights when some rarities have zero eligible inventory,
/// using the deterministic largest-remainder method (documented for the
/// client, tested against this implementation).
///
/// `base_weights` are percentages summing to 100. Unavailable rarities get 0;
/// their weight is spread across available ones proportionally, remainders
/// assigned by largest fractional part (ties broken by lower rarity index).
/// Returns weights summing to exactly 100. Errors when nothing is available.
pub fn effective_weights(
    base_weights: [u16; RARITIES],
    available: [bool; RARITIES],
) -> Result<[u16; RARITIES], CrossyError> {
    let avail_total: u64 = (0..RARITIES)
        .filter(|&i| available[i])
        .map(|i| base_weights[i] as u64)
        .sum();
    if avail_total == 0 {
        return Err(CrossyError::SoldOut);
    }
    const TOTAL: u64 = 100;
    // quota_i = base_i * 100 / avail_total for available rarities.
    let mut result = [0u16; RARITIES];
    let mut remainders: [(u64, usize); RARITIES] = [(0, 0); RARITIES];
    let mut assigned: u64 = 0;
    for i in 0..RARITIES {
        if !available[i] || base_weights[i] == 0 {
            remainders[i] = (0, i);
            continue;
        }
        let numer = base_weights[i] as u64 * TOTAL;
        let floor = numer / avail_total;
        let rem = numer % avail_total;
        result[i] = floor as u16;
        assigned += floor;
        remainders[i] = (rem, i);
    }
    // Distribute the remaining units by largest remainder, tie -> lower index.
    let mut left = TOTAL - assigned;
    let mut order: Vec<(u64, usize)> = remainders
        .iter()
        .copied()
        .filter(|&(_, i)| available[i] && base_weights[i] > 0)
        .collect();
    order.sort_by(|a, b| b.0.cmp(&a.0).then(a.1.cmp(&b.1)));
    let mut k = 0;
    while left > 0 {
        let (_, idx) = order[k % order.len()];
        result[idx] += 1;
        left -= 1;
        k += 1;
    }
    Ok(result)
}

/// Weighted rarity selection over effective weights (must sum to 100).
pub fn select_rarity(rng: &mut SelectionRng, weights: [u16; RARITIES]) -> Rarity {
    let total: u64 = weights.iter().map(|&w| w as u64).sum();
    debug_assert!(total > 0);
    let roll = rng.below(total);
    let mut acc = 0u64;
    #[allow(clippy::needless_range_loop)]
    for i in 0..RARITIES {
        acc += weights[i] as u64;
        if roll < acc {
            return Rarity::from_u8(i as u8).unwrap();
        }
    }
    Rarity::Legendary
}

/// Uniform selection among `eligible_count` in-stock variants of the chosen
/// rarity (index into the caller's snapshot-ordered eligible list).
pub fn select_variant_index(rng: &mut SelectionRng, eligible_count: u32) -> u32 {
    debug_assert!(eligible_count > 0);
    rng.below(eligible_count as u64) as u32
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn weights_pass_through_when_all_available() {
        let w = effective_weights([70, 22, 7, 1], [true; 4]).unwrap();
        assert_eq!(w, [70, 22, 7, 1]);
    }

    #[test]
    fn weights_redistribute_on_soldout() {
        // Legendary sold out on the standard banner: 70/22/7 over 99 -> 100.
        let w = effective_weights([70, 22, 7, 1], [true, true, true, false]).unwrap();
        assert_eq!(w.iter().map(|&x| x as u32).sum::<u32>(), 100);
        assert_eq!(w[3], 0);
        // Deterministic largest-remainder result:
        // 70*100/99 = 70.70 -> 70 r70 ; 22*100/99 = 22.22 -> 22 r22 ;
        // 7*100/99 = 7.07 -> 7 r7 ; one unit left -> largest remainder (70).
        assert_eq!(w, [71, 22, 7, 0]);
    }

    #[test]
    fn weights_error_when_everything_sold_out() {
        assert!(effective_weights([70, 22, 7, 1], [false; 4]).is_err());
    }

    #[test]
    fn rarity_selection_is_deterministic_and_in_distribution() {
        let mut rng = SelectionRng::new(&[1u8; 32], 7);
        let r1 = select_rarity(&mut rng, [70, 22, 7, 1]);
        let mut rng2 = SelectionRng::new(&[1u8; 32], 7);
        let r2 = select_rarity(&mut rng2, [70, 22, 7, 1]);
        assert_eq!(r1, r2);
    }

    #[test]
    fn rarity_distribution_roughly_matches_weights() {
        // Statistical smoke test with many seeds.
        let mut counts = [0u32; 4];
        for s in 0..10_000u32 {
            let mut seed = [0u8; 32];
            seed[..4].copy_from_slice(&s.to_le_bytes());
            let mut rng = SelectionRng::new(&seed, 3);
            counts[select_rarity(&mut rng, [70, 22, 7, 1]) as usize] += 1;
        }
        assert!(
            counts[0] > 6_500 && counts[0] < 7_500,
            "common ~70%: {counts:?}"
        );
        assert!(
            counts[3] > 40 && counts[3] < 220,
            "legendary ~1%: {counts:?}"
        );
    }

    #[test]
    fn variant_selection_in_range() {
        let mut rng = SelectionRng::new(&[9u8; 32], 11);
        for count in [1u32, 2, 7, 100] {
            let idx = select_variant_index(&mut rng, count);
            assert!(idx < count);
        }
    }
}
