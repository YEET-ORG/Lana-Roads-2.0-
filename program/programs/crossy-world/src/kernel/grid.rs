//! Grid geometry: coordinates, sectors, movement derivation, deterministic
//! spawn scanning. One live player per tile is enforced by the occupancy
//! bitsets these helpers index into.

use crate::constants::{SECTORS_PER_ROW, SECTOR_EDGE, WORLD_WIDTH};

/// Cardinal one-tile movement intents. The client sends a direction; the
/// program derives the destination. Clients never supply destinations.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Direction {
    Forward,  // +y
    Backward, // -y
    Left,     // -x
    Right,    // +x
}

impl Direction {
    pub fn from_u8(v: u8) -> Option<Self> {
        match v {
            0 => Some(Self::Forward),
            1 => Some(Self::Backward),
            2 => Some(Self::Left),
            3 => Some(Self::Right),
            _ => None,
        }
    }
}

/// Destination of a one-tile step. `None` when it leaves the board (x edges
/// are hard boundaries; y below 0 is invalid; y has no upper bound here —
/// traversability at the frontier is checked against revealed chunks).
pub fn step(x: u8, y: u32, dir: Direction) -> Option<(u8, u32)> {
    match dir {
        Direction::Forward => y.checked_add(1).map(|ny| (x, ny)),
        Direction::Backward => y.checked_sub(1).map(|ny| (x, ny)),
        Direction::Left => x.checked_sub(1).map(|nx| (nx, y)),
        Direction::Right => {
            let nx = x.checked_add(1)?;
            if nx >= WORLD_WIDTH {
                None
            } else {
                Some((nx, y))
            }
        }
    }
}

/// Sector coordinates for a tile. Sectors are 8x8; sector_x in 0..8,
/// sector_y unbounded (grows with revealed rows).
pub const fn sector_of(x: u8, y: u32) -> (u8, u32) {
    (x / SECTOR_EDGE, y / SECTOR_EDGE as u32)
}

/// Bit index of a tile inside its 8x8 sector bitset (0..64).
pub const fn sector_bit(x: u8, y: u32) -> u8 {
    let lx = x % SECTOR_EDGE;
    let ly = (y % SECTOR_EDGE as u32) as u8;
    ly * SECTOR_EDGE + lx
}

/// True when the two tiles live in the same sector account.
pub fn same_sector(ax: u8, ay: u32, bx: u8, by: u32) -> bool {
    sector_of(ax, ay) == sector_of(bx, by)
}

/// Number of sector columns (constant, exported for clients).
pub const fn sectors_per_row() -> u8 {
    SECTORS_PER_ROW
}

/// Deterministic spawn scan start offset: hash(wallet, day, attempt) modulo
/// the safe-zone tile count. FNV-1a over the caller-provided bytes — stable,
/// documented, and reproduced by the SDK for spawn prediction.
pub fn spawn_scan_start(wallet: &[u8; 32], day: u64, attempt_nonce: u32, tile_count: u32) -> u32 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    const PRIME: u64 = 0x1_0000_0000_01b3;
    for b in wallet.iter() {
        h ^= *b as u64;
        h = h.wrapping_mul(PRIME);
    }
    for b in day.to_le_bytes() {
        h ^= b as u64;
        h = h.wrapping_mul(PRIME);
    }
    for b in attempt_nonce.to_le_bytes() {
        h ^= b as u64;
        h = h.wrapping_mul(PRIME);
    }
    (h % tile_count as u64) as u32
}

/// Convert a safe-zone scan index (0..tile_count) to tile coordinates.
/// Scanning wraps: index i maps to (i % width, i / width).
pub const fn scan_index_to_tile(index: u32) -> (u8, u32) {
    (
        (index % WORLD_WIDTH as u32) as u8,
        index / WORLD_WIDTH as u32,
    )
}

/// Manhattan-adjacent (4-neighborhood) test used by Kick/ability targeting.
pub fn is_adjacent(ax: u8, ay: u32, bx: u8, by: u32) -> bool {
    let dx = (ax as i32 - bx as i32).abs();
    let dy = (ay as i64 - by as i64).abs();
    dx as i64 + dy == 1
}

/// The facing-adjacent tile (Kick target tile).
pub fn facing_tile(x: u8, y: u32, facing: Direction) -> Option<(u8, u32)> {
    step(x, y, facing)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn steps_respect_bounds() {
        assert_eq!(step(0, 5, Direction::Left), None);
        assert_eq!(step(63, 5, Direction::Right), None);
        assert_eq!(step(62, 5, Direction::Right), Some((63, 5)));
        assert_eq!(step(5, 0, Direction::Backward), None);
        assert_eq!(step(5, 1, Direction::Backward), Some((5, 0)));
        assert_eq!(step(5, 1, Direction::Forward), Some((5, 2)));
        assert_eq!(step(5, 65_535, Direction::Forward), Some((5, 65_536)));
    }

    #[test]
    fn sector_coordinates_continue_beyond_u16_rows() {
        assert_eq!(sector_of(63, 1_000_000), (7, 125_000));
        assert_eq!(sector_bit(63, 1_000_000), 7);
    }

    #[test]
    fn sector_mapping() {
        assert_eq!(sector_of(0, 0), (0, 0));
        assert_eq!(sector_of(7, 7), (0, 0));
        assert_eq!(sector_of(8, 7), (1, 0));
        assert_eq!(sector_of(63, 8), (7, 1));
        assert_eq!(sector_bit(0, 0), 0);
        assert_eq!(sector_bit(7, 0), 7);
        assert_eq!(sector_bit(0, 1), 8);
        assert_eq!(sector_bit(7, 7), 63);
        assert_eq!(sector_bit(9, 9), 9); // (1,1) inside sector (1,1)
    }

    #[test]
    fn spawn_scan_is_deterministic_and_in_range() {
        let wallet = [7u8; 32];
        let a = spawn_scan_start(&wallet, 20_682, 0, 1024);
        let b = spawn_scan_start(&wallet, 20_682, 0, 1024);
        assert_eq!(a, b);
        assert!(a < 1024);
        // Different attempt changes the offset (overwhelmingly likely).
        let c = spawn_scan_start(&wallet, 20_682, 1, 1024);
        assert_ne!(a, c);
    }

    #[test]
    fn adjacency() {
        assert!(is_adjacent(5, 5, 5, 6));
        assert!(is_adjacent(5, 5, 4, 5));
        assert!(!is_adjacent(5, 5, 4, 6));
        assert!(!is_adjacent(5, 5, 5, 5));
    }
}
