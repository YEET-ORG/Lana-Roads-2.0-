//! Minimal hand-rolled Metaplex Core CPI layer.
//!
//! Deliberately avoids the `mpl-core` crate to keep the dependency tree
//! pinned to Anchor 1.x. Discriminators, account orders, writability, and
//! Borsh layouts are verified against the official generated client
//! (@metaplex-foundation/mpl-core 1.10.0) and exercised in the integration
//! suite against the real dumped program binary.
//!
//! Plugin lifecycle handled here:
//! - `AddPluginV1` fails when the plugin already exists, and `TransferV1`
//!   resets owner-managed plugin authorities to Owner — so lock/list flows
//!   read the asset's actual plugin registry (`read_asset_state`) and
//!   dispatch add / approve / update accordingly.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::instruction::{AccountMeta, Instruction};
use anchor_lang::solana_program::program::invoke_signed;

use crate::errors::CrossyError;

pub const MPL_CORE_ID: Pubkey = pubkey!("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d");

// Instruction discriminators (shank, single byte).
const IX_ADD_PLUGIN_V1: u8 = 2;
const IX_REMOVE_PLUGIN_V1: u8 = 4;
const IX_UPDATE_PLUGIN_V1: u8 = 6;
const IX_APPROVE_PLUGIN_AUTHORITY_V1: u8 = 8;
const IX_TRANSFER_V1: u8 = 14;
const IX_CREATE_V2: u8 = 20;

// PluginType / Plugin enum variant indices.
pub const PLUGIN_TYPE_FREEZE_DELEGATE: u8 = 1;
pub const PLUGIN_TYPE_TRANSFER_DELEGATE: u8 = 3;

// PluginAuthority enum variant indices.
const AUTHORITY_NONE: u8 = 0;
const AUTHORITY_OWNER: u8 = 1;
const AUTHORITY_UPDATE_AUTHORITY: u8 = 2;
const AUTHORITY_ADDRESS: u8 = 3;

/// Parsed plugin authority.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum PluginAuthority {
    None,
    Owner,
    UpdateAuthority,
    Address(Pubkey),
}

/// Parsed on-chain state of the plugins this program manages.
#[derive(Clone, Copy, Debug, Default)]
pub struct AssetState {
    pub owner: Pubkey,
    /// (authority, frozen) when a FreezeDelegate plugin exists.
    pub freeze: Option<(PluginAuthority, bool)>,
    /// authority when a TransferDelegate plugin exists.
    pub transfer: Option<PluginAuthority>,
}

fn read_u32(data: &[u8], off: usize) -> Result<u32> {
    let bytes: [u8; 4] = data
        .get(off..off + 4)
        .and_then(|s| s.try_into().ok())
        .ok_or(CrossyError::NotReconcilable)?;
    Ok(u32::from_le_bytes(bytes))
}

fn read_u64(data: &[u8], off: usize) -> Result<u64> {
    let bytes: [u8; 8] = data
        .get(off..off + 8)
        .and_then(|s| s.try_into().ok())
        .ok_or(CrossyError::NotReconcilable)?;
    Ok(u64::from_le_bytes(bytes))
}

fn read_pubkey(data: &[u8], off: usize) -> Result<Pubkey> {
    let bytes: [u8; 32] = data
        .get(off..off + 32)
        .and_then(|s| s.try_into().ok())
        .ok_or(CrossyError::NotReconcilable)?;
    Ok(Pubkey::new_from_array(bytes))
}

fn read_authority(data: &[u8], off: usize) -> Result<(PluginAuthority, usize)> {
    let tag = *data.get(off).ok_or(CrossyError::NotReconcilable)?;
    Ok(match tag {
        AUTHORITY_NONE => (PluginAuthority::None, off + 1),
        AUTHORITY_OWNER => (PluginAuthority::Owner, off + 1),
        AUTHORITY_UPDATE_AUTHORITY => (PluginAuthority::UpdateAuthority, off + 1),
        AUTHORITY_ADDRESS => (
            PluginAuthority::Address(read_pubkey(data, off + 1)?),
            off + 33,
        ),
        _ => return err!(CrossyError::NotReconcilable),
    })
}

/// Parse an AssetV1 account: owner + the managed-plugin registry entries.
///
/// AssetV1 layout: key u8 (=1 AssetV1), owner 32, update_authority enum
/// (None=0 | Address=1+32 | Collection=2+32), name string, uri string,
/// seq Option<u64>. If more data follows: PluginHeaderV1 { key u8 (=3),
/// plugin_registry_offset u64 }, and at that offset PluginRegistryV1
/// { key u8 (=4), registry: Vec<RegistryRecord{ plugin_type u8,
/// authority PluginAuthority, offset u64 }> ... }. Each record offset
/// points at the serialized Plugin enum (variant u8 + fields).
pub fn read_asset_state(asset: &AccountInfo) -> Result<AssetState> {
    let data = asset.try_borrow_data()?;
    require!(*asset.owner == MPL_CORE_ID, CrossyError::WrongCollection);
    require!(data.len() >= 34, CrossyError::NotReconcilable);
    require!(data[0] == 1, CrossyError::NotReconcilable); // Key::AssetV1

    let mut state = AssetState {
        owner: read_pubkey(&data, 1)?,
        ..Default::default()
    };
    let mut off = 33usize;
    // update_authority
    let ua_tag = *data.get(off).ok_or(CrossyError::NotReconcilable)?;
    off += 1 + if ua_tag == 0 { 0 } else { 32 };
    // name, uri
    for _ in 0..2 {
        let len = read_u32(&data, off)? as usize;
        off += 4 + len;
    }
    // seq Option<u64>
    let seq_tag = *data.get(off).ok_or(CrossyError::NotReconcilable)?;
    off += 1 + if seq_tag == 1 { 8 } else { 0 };

    if off >= data.len() {
        return Ok(state); // no plugin header
    }
    // PluginHeaderV1
    require!(data[off] == 3, CrossyError::NotReconcilable); // Key::PluginHeaderV1
    let registry_off = read_u64(&data, off + 1)? as usize;
    require!(registry_off < data.len(), CrossyError::NotReconcilable);
    require!(data[registry_off] == 4, CrossyError::NotReconcilable); // Key::PluginRegistryV1
    let count = read_u32(&data, registry_off + 1)? as usize;
    require!(count <= 32, CrossyError::NotReconcilable);
    let mut rec_off = registry_off + 5;
    for _ in 0..count {
        let plugin_type = *data.get(rec_off).ok_or(CrossyError::NotReconcilable)?;
        let (authority, next) = read_authority(&data, rec_off + 1)?;
        let plugin_off = read_u64(&data, next)? as usize;
        rec_off = next + 8;
        match plugin_type {
            PLUGIN_TYPE_FREEZE_DELEGATE => {
                // Plugin enum at offset: [variant u8, frozen u8]
                let variant = *data.get(plugin_off).ok_or(CrossyError::NotReconcilable)?;
                require!(
                    variant == PLUGIN_TYPE_FREEZE_DELEGATE,
                    CrossyError::NotReconcilable
                );
                let frozen = *data
                    .get(plugin_off + 1)
                    .ok_or(CrossyError::NotReconcilable)?
                    != 0;
                state.freeze = Some((authority, frozen));
            }
            PLUGIN_TYPE_TRANSFER_DELEGATE => {
                state.transfer = Some(authority);
            }
            _ => {}
        }
    }
    Ok(state)
}

/// Convenience: current owner of a Core asset.
pub fn read_asset_owner(asset: &AccountInfo) -> Result<Pubkey> {
    Ok(read_asset_state(asset)?.owner)
}

// ---------------------------------------------------------------------------
// instruction builders
// ---------------------------------------------------------------------------

fn account_meta(key: Pubkey, signer: bool, writable: bool) -> AccountMeta {
    if writable {
        AccountMeta::new(key, signer)
    } else {
        AccountMeta::new_readonly(key, signer)
    }
}

/// asset, collection?, payer, authority, system_program, log_wrapper(none)
/// — shared by plugin-level instructions (collection writable when present).
struct PluginCpi<'a, 'info> {
    asset: &'a AccountInfo<'info>,
    collection: Option<&'a AccountInfo<'info>>,
    payer: &'a AccountInfo<'info>,
    authority: &'a AccountInfo<'info>,
    system_program: &'a AccountInfo<'info>,
    core_program: &'a AccountInfo<'info>,
}

impl<'a, 'info> PluginCpi<'a, 'info> {
    fn invoke(&self, data: Vec<u8>, signer_seeds: &[&[&[u8]]]) -> Result<()> {
        let metas = vec![
            account_meta(self.asset.key(), false, true),
            account_meta(
                self.collection.map(|c| c.key()).unwrap_or(MPL_CORE_ID),
                false,
                self.collection.is_some(),
            ),
            account_meta(self.payer.key(), true, true),
            account_meta(self.authority.key(), true, false),
            account_meta(anchor_lang::system_program::ID, false, false),
            account_meta(MPL_CORE_ID, false, false), // no log wrapper
        ];
        let ix = Instruction {
            program_id: MPL_CORE_ID,
            accounts: metas,
            data,
        };
        let infos = [
            self.asset.clone(),
            self.collection
                .cloned()
                .unwrap_or_else(|| self.core_program.clone()),
            self.payer.clone(),
            self.authority.clone(),
            self.system_program.clone(),
            self.core_program.clone(),
        ];
        invoke_signed(&ix, &infos, signer_seeds)?;
        Ok(())
    }
}

/// AddPluginV1 { plugin: FreezeDelegate{frozen}, init_authority:
/// Some(Address(delegate)) } — owner-signed; approves the game PDA and
/// freezes in one step. Fails if the plugin already exists.
#[allow(clippy::too_many_arguments)]
pub fn add_freeze_delegate<'info>(
    asset: &AccountInfo<'info>,
    collection: Option<&AccountInfo<'info>>,
    payer: &AccountInfo<'info>,
    owner_authority: &AccountInfo<'info>,
    delegate: Pubkey,
    frozen: bool,
    system_program: &AccountInfo<'info>,
    core_program: &AccountInfo<'info>,
) -> Result<()> {
    let mut data = vec![
        IX_ADD_PLUGIN_V1,
        PLUGIN_TYPE_FREEZE_DELEGATE,
        frozen as u8,
        1, // Option::Some
        AUTHORITY_ADDRESS,
    ];
    data.extend_from_slice(delegate.as_ref());
    PluginCpi {
        asset,
        collection,
        payer,
        authority: owner_authority,
        system_program,
        core_program,
    }
    .invoke(data, &[])
}

/// AddPluginV1 { plugin: TransferDelegate, init_authority:
/// Some(Address(delegate)) } — owner-signed; lets the game PDA transfer the
/// asset on a marketplace sale.
#[allow(clippy::too_many_arguments)]
pub fn add_transfer_delegate<'info>(
    asset: &AccountInfo<'info>,
    collection: Option<&AccountInfo<'info>>,
    payer: &AccountInfo<'info>,
    owner_authority: &AccountInfo<'info>,
    delegate: Pubkey,
    system_program: &AccountInfo<'info>,
    core_program: &AccountInfo<'info>,
) -> Result<()> {
    let mut data = vec![
        IX_ADD_PLUGIN_V1,
        PLUGIN_TYPE_TRANSFER_DELEGATE,
        1, // Option::Some
        AUTHORITY_ADDRESS,
    ];
    data.extend_from_slice(delegate.as_ref());
    PluginCpi {
        asset,
        collection,
        payer,
        authority: owner_authority,
        system_program,
        core_program,
    }
    .invoke(data, &[])
}

/// ApprovePluginAuthorityV1 { plugin_type, new_authority: Address(delegate) }
/// — owner-signed; re-delegates an existing plugin (authorities reset to
/// Owner on every transfer).
#[allow(clippy::too_many_arguments)]
pub fn approve_plugin_authority<'info>(
    asset: &AccountInfo<'info>,
    collection: Option<&AccountInfo<'info>>,
    payer: &AccountInfo<'info>,
    owner_authority: &AccountInfo<'info>,
    plugin_type: u8,
    delegate: Pubkey,
    system_program: &AccountInfo<'info>,
    core_program: &AccountInfo<'info>,
) -> Result<()> {
    let mut data = vec![
        IX_APPROVE_PLUGIN_AUTHORITY_V1,
        plugin_type,
        AUTHORITY_ADDRESS,
    ];
    data.extend_from_slice(delegate.as_ref());
    PluginCpi {
        asset,
        collection,
        payer,
        authority: owner_authority,
        system_program,
        core_program,
    }
    .invoke(data, &[])
}

/// UpdatePluginV1 { plugin: FreezeDelegate{frozen} } — signed by the plugin
/// authority (the game PDA): freeze / thaw.
#[allow(clippy::too_many_arguments)]
pub fn set_frozen<'info>(
    asset: &AccountInfo<'info>,
    collection: Option<&AccountInfo<'info>>,
    payer: &AccountInfo<'info>,
    delegate_authority: &AccountInfo<'info>,
    frozen: bool,
    system_program: &AccountInfo<'info>,
    core_program: &AccountInfo<'info>,
    signer_seeds: &[&[&[u8]]],
) -> Result<()> {
    let data = vec![
        IX_UPDATE_PLUGIN_V1,
        PLUGIN_TYPE_FREEZE_DELEGATE,
        frozen as u8,
    ];
    PluginCpi {
        asset,
        collection,
        payer,
        authority: delegate_authority,
        system_program,
        core_program,
    }
    .invoke(data, signer_seeds)
}

/// RemovePluginV1 { plugin_type } — owner- or authority-signed.
#[allow(clippy::too_many_arguments)]
pub fn remove_plugin<'info>(
    asset: &AccountInfo<'info>,
    collection: Option<&AccountInfo<'info>>,
    payer: &AccountInfo<'info>,
    authority: &AccountInfo<'info>,
    plugin_type: u8,
    system_program: &AccountInfo<'info>,
    core_program: &AccountInfo<'info>,
    signer_seeds: &[&[&[u8]]],
) -> Result<()> {
    let data = vec![IX_REMOVE_PLUGIN_V1, plugin_type];
    PluginCpi {
        asset,
        collection,
        payer,
        authority,
        system_program,
        core_program,
    }
    .invoke(data, signer_seeds)
}

/// TransferV1 { compression_proof: None } — signed by the owner or an
/// approved TRANSFER delegate (a freeze delegate cannot transfer).
#[allow(clippy::too_many_arguments)]
pub fn transfer<'info>(
    asset: &AccountInfo<'info>,
    collection: Option<&AccountInfo<'info>>,
    payer: &AccountInfo<'info>,
    authority: &AccountInfo<'info>,
    new_owner: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
    core_program: &AccountInfo<'info>,
    signer_seeds: &[&[&[u8]]],
) -> Result<()> {
    let data = vec![
        IX_TRANSFER_V1,
        0u8, /* Option<CompressionProof>::None */
    ];
    let metas = vec![
        account_meta(asset.key(), false, true),
        account_meta(
            collection.map(|c| c.key()).unwrap_or(MPL_CORE_ID),
            false,
            false,
        ),
        account_meta(payer.key(), true, true),
        account_meta(authority.key(), true, false),
        account_meta(new_owner.key(), false, false),
        account_meta(anchor_lang::system_program::ID, false, false),
        account_meta(MPL_CORE_ID, false, false), // no log wrapper
    ];
    let ix = Instruction {
        program_id: MPL_CORE_ID,
        accounts: metas,
        data,
    };
    let infos = [
        asset.clone(),
        collection.cloned().unwrap_or_else(|| core_program.clone()),
        payer.clone(),
        authority.clone(),
        new_owner.clone(),
        system_program.clone(),
        core_program.clone(),
    ];
    invoke_signed(&ix, &infos, signer_seeds)?;
    Ok(())
}

/// CreateV2 { data_state: AccountState, name, uri, plugins: None,
/// external_plugin_adapters: None } — mints a new collection asset owned by
/// `owner`, authorized by the collection's update authority (game PDA).
#[allow(clippy::too_many_arguments)]
pub fn create_asset<'info>(
    asset_signer: &AccountInfo<'info>,
    collection: &AccountInfo<'info>,
    collection_authority: &AccountInfo<'info>,
    payer: &AccountInfo<'info>,
    owner: &AccountInfo<'info>,
    name: &str,
    uri: &str,
    system_program: &AccountInfo<'info>,
    core_program: &AccountInfo<'info>,
    signer_seeds: &[&[&[u8]]],
) -> Result<()> {
    let mut data = vec![IX_CREATE_V2, 0u8 /* DataState::AccountState */];
    data.extend_from_slice(&(name.len() as u32).to_le_bytes());
    data.extend_from_slice(name.as_bytes());
    data.extend_from_slice(&(uri.len() as u32).to_le_bytes());
    data.extend_from_slice(uri.as_bytes());
    data.push(0u8); // plugins: None
    data.push(0u8); // external_plugin_adapters: None

    let metas = vec![
        account_meta(asset_signer.key(), true, true),
        account_meta(collection.key(), false, true),
        account_meta(collection_authority.key(), true, false),
        account_meta(payer.key(), true, true),
        account_meta(owner.key(), false, false),
        account_meta(MPL_CORE_ID, false, false), // update_authority: none (collection rules)
        account_meta(anchor_lang::system_program::ID, false, false),
        account_meta(MPL_CORE_ID, false, false), // no log wrapper
    ];
    let ix = Instruction {
        program_id: MPL_CORE_ID,
        accounts: metas,
        data,
    };
    let infos = [
        asset_signer.clone(),
        collection.clone(),
        collection_authority.clone(),
        payer.clone(),
        owner.clone(),
        core_program.clone(),
        system_program.clone(),
        core_program.clone(),
    ];
    invoke_signed(&ix, &infos, signer_seeds)?;
    Ok(())
}

/// Ensure the game PDA controls a (frozen or thawed) FreezeDelegate on the
/// asset, dispatching on the asset's actual plugin registry:
/// - no plugin        -> AddPluginV1 (owner signs), optionally frozen
/// - authority Owner  -> ApprovePluginAuthorityV1 (owner signs) then update
/// - authority == PDA -> UpdatePluginV1 (PDA signs)
///
/// Fails when the asset is already frozen (foreign lock).
#[allow(clippy::too_many_arguments)]
pub fn ensure_frozen_under<'info>(
    asset: &AccountInfo<'info>,
    collection: Option<&AccountInfo<'info>>,
    payer: &AccountInfo<'info>,
    owner_authority: &AccountInfo<'info>,
    delegate_account: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
    core_program: &AccountInfo<'info>,
    delegate_seeds: &[&[&[u8]]],
) -> Result<()> {
    let state = read_asset_state(asset)?;
    match state.freeze {
        Some((_, true)) => err!(CrossyError::AgentLocked),
        None => add_freeze_delegate(
            asset,
            collection,
            payer,
            owner_authority,
            delegate_account.key(),
            true,
            system_program,
            core_program,
        ),
        Some((PluginAuthority::Address(a), false)) if a == delegate_account.key() => set_frozen(
            asset,
            collection,
            payer,
            delegate_account,
            true,
            system_program,
            core_program,
            delegate_seeds,
        ),
        Some((_, false)) => {
            // Owner (or stale) authority: re-approve to the game PDA, then
            // freeze under the delegate.
            approve_plugin_authority(
                asset,
                collection,
                payer,
                owner_authority,
                PLUGIN_TYPE_FREEZE_DELEGATE,
                delegate_account.key(),
                system_program,
                core_program,
            )?;
            set_frozen(
                asset,
                collection,
                payer,
                delegate_account,
                true,
                system_program,
                core_program,
                delegate_seeds,
            )
        }
    }
}

/// Ensure the game PDA is an approved TransferDelegate on the asset
/// (marketplace custody), dispatching like `ensure_frozen_under`.
#[allow(clippy::too_many_arguments)]
pub fn ensure_transfer_delegate<'info>(
    asset: &AccountInfo<'info>,
    collection: Option<&AccountInfo<'info>>,
    payer: &AccountInfo<'info>,
    owner_authority: &AccountInfo<'info>,
    delegate_account: &AccountInfo<'info>,
    system_program: &AccountInfo<'info>,
    core_program: &AccountInfo<'info>,
) -> Result<()> {
    let state = read_asset_state(asset)?;
    match state.transfer {
        Some(PluginAuthority::Address(a)) if a == delegate_account.key() => Ok(()),
        None => add_transfer_delegate(
            asset,
            collection,
            payer,
            owner_authority,
            delegate_account.key(),
            system_program,
            core_program,
        ),
        Some(_) => approve_plugin_authority(
            asset,
            collection,
            payer,
            owner_authority,
            PLUGIN_TYPE_TRANSFER_DELEGATE,
            delegate_account.key(),
            system_program,
            core_program,
        ),
    }
}
