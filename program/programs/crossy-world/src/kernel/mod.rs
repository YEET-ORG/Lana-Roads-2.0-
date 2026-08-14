//! Pure deterministic game kernel.
//!
//! Everything in this module is side-effect-free integer logic shared (as
//! golden vectors) with the TypeScript SDK, indexer, and renderer helpers.
//! No account access, no Clock, no floating point — callers pass authoritative
//! time/slot values in.

pub mod chunkgen;
pub mod economy;
pub mod grid;
pub mod hazard;
pub mod name;
pub mod pity;
pub mod sampling;
pub mod time;
pub mod vehicle;
