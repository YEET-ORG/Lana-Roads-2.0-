//! Cross-plane state reading.
//!
//! Base instructions must validate *committed* delegated gameplay state
//! (e.g. a run's death before pricing a revival). While delegated, the
//! account's base owner is the MagicBlock delegation program; its data is the
//! last committed application state. We accept either owner (undelegated =
//! this program, delegated = delegation program), verify the PDA address and
//! discriminator, and deserialize — never trusting a client-passed address.

use anchor_lang::prelude::*;
use anchor_lang::Discriminator;
use ephemeral_rollups_sdk::consts::DELEGATION_PROGRAM_ID;

use crate::constants::seeds;
use crate::errors::CrossyError;
use crate::state::{ChunkDefinition, PlayerRun, WorldHeader};

pub fn read_committed_chunk(
    account: &AccountInfo,
    region: u8,
    day: u64,
    chunk_index: u32,
) -> Result<ChunkDefinition> {
    let (expected, _) = Pubkey::find_program_address(
        &[seeds::CHUNK, &[region], &day.to_le_bytes(), &chunk_index.to_le_bytes()],
        &crate::ID,
    );
    require_keys_eq!(*account.key, expected, CrossyError::NotReconcilable);
    let owner_ok = *account.owner == crate::ID || *account.owner == DELEGATION_PROGRAM_ID;
    require!(owner_ok, CrossyError::NotReconcilable);
    let data = account.try_borrow_data()?;
    require!(data.len() > 8, CrossyError::NotReconcilable);
    require!(
        data[..8] == ChunkDefinition::DISCRIMINATOR[..],
        CrossyError::NotReconcilable
    );
    ChunkDefinition::try_deserialize(&mut &data[..])
        .map_err(|_| error!(CrossyError::NotReconcilable))
}

/// Read the committed representation of a `PlayerRun`, validating:
/// - PDA address for (world, wallet),
/// - account owner is this program or the delegation program,
/// - Anchor discriminator.
pub fn read_committed_run(
    account: &AccountInfo,
    world: &Pubkey,
    wallet: &Pubkey,
) -> Result<PlayerRun> {
    let (expected, _bump) =
        Pubkey::find_program_address(&[seeds::RUN, world.as_ref(), wallet.as_ref()], &crate::ID);
    require_keys_eq!(*account.key, expected, CrossyError::NotReconcilable);
    let owner_ok = *account.owner == crate::ID || *account.owner == DELEGATION_PROGRAM_ID;
    require!(owner_ok, CrossyError::NotReconcilable);

    let data = account.try_borrow_data()?;
    require!(data.len() > 8, CrossyError::NotReconcilable);
    require!(
        data[..8] == PlayerRun::DISCRIMINATOR[..],
        CrossyError::NotReconcilable
    );
    PlayerRun::try_deserialize(&mut &data[..]).map_err(|_| error!(CrossyError::NotReconcilable))
}

/// Read a committed `WorldHeader` validating only owner + discriminator;
/// callers must separately pin the address (against trusted state or the
/// self-describing mode/day PDA).
pub fn read_committed_world_any(account: &AccountInfo) -> Result<WorldHeader> {
    let owner_ok = *account.owner == crate::ID || *account.owner == DELEGATION_PROGRAM_ID;
    require!(owner_ok, CrossyError::NotReconcilable);
    let data = account.try_borrow_data()?;
    require!(data.len() > 8, CrossyError::NotReconcilable);
    require!(
        data[..8] == WorldHeader::DISCRIMINATOR[..],
        CrossyError::NotReconcilable
    );
    WorldHeader::try_deserialize(&mut &data[..]).map_err(|_| error!(CrossyError::NotReconcilable))
}

/// Read the committed representation of a `WorldHeader` by address (the
/// caller supplies the expected address from trusted state, e.g. an
/// AgentLock). Validates owner and discriminator; the immutable day window
/// (start_ts/end_ts) is trustworthy from any committed copy.
pub fn read_committed_world(account: &AccountInfo, expected: &Pubkey) -> Result<WorldHeader> {
    require_keys_eq!(*account.key, *expected, CrossyError::NotReconcilable);
    let owner_ok = *account.owner == crate::ID || *account.owner == DELEGATION_PROGRAM_ID;
    require!(owner_ok, CrossyError::NotReconcilable);
    let data = account.try_borrow_data()?;
    require!(data.len() > 8, CrossyError::NotReconcilable);
    require!(
        data[..8] == WorldHeader::DISCRIMINATOR[..],
        CrossyError::NotReconcilable
    );
    WorldHeader::try_deserialize(&mut &data[..]).map_err(|_| error!(CrossyError::NotReconcilable))
}
