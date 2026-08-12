//! In-game fixed-price USDC marketplace for Crossy World Core assets.
//! 90% seller / 10% team; asset transfer is atomic with payment; active
//! attempt locks and listings are mutually exclusive.
//!
//! Listing custody: listing freezes the asset with the game freeze-authority
//! PDA (the same delegate used for attempt locks), so the seller cannot
//! produce a stale listing by transferring the asset away. Purchase thaws
//! and transfers inside one transaction.

use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TransferChecked};

use crate::constants::{seeds, USDC_DECIMALS};
use crate::errors::CrossyError;
use crate::events::*;
use crate::external::mpl_core;
use crate::instructions::agent::FREEZE_AUTHORITY_SEED;
use crate::kernel::economy;
use crate::state::config::pause;
use crate::state::*;

// ---------------------------------------------------------------------------
// list_agent
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct ListAgent<'info> {
    #[account(
        seeds = [seeds::CONFIG],
        bump = config.bump,
        constraint = !config.is_paused(pause::MARKETPLACE) @ CrossyError::Paused
    )]
    pub config: Box<Account<'info, GlobalConfig>>,
    /// CHECK: the Core asset being listed.
    #[account(mut)]
    pub asset: UncheckedAccount<'info>,
    /// CHECK: configured collection.
    #[account(mut, address = config.collection @ CrossyError::WrongCollection)]
    pub collection: UncheckedAccount<'info>,
    /// Program-owned asset mapping (collection membership proof).
    #[account(
        seeds = [seeds::ASSET_MAP, asset.key().as_ref()],
        bump = asset_map.bump,
    )]
    pub asset_map: Box<Account<'info, AssetMap>>,
    #[account(
        init_if_needed,
        payer = seller,
        space = 8 + MarketplaceListing::INIT_SPACE,
        seeds = [seeds::LISTING, asset.key().as_ref()],
        bump
    )]
    pub listing: Box<Account<'info, MarketplaceListing>>,
    /// CHECK: freeze authority PDA (listing custody).
    #[account(seeds = [FREEZE_AUTHORITY_SEED], bump)]
    pub freeze_authority: UncheckedAccount<'info>,
    #[account(mut)]
    pub seller: Signer<'info>,
    pub system_program: Program<'info, System>,
    /// CHECK: mpl-core program.
    #[account(address = mpl_core::MPL_CORE_ID)]
    pub core_program: UncheckedAccount<'info>,
}

pub fn list_agent(ctx: Context<ListAgent>, price: u64, expiry_ts: i64) -> Result<()> {
    require!(price > 0, CrossyError::WrongAmount);
    let now = Clock::get()?.unix_timestamp;
    require!(
        expiry_ts == 0 || expiry_ts > now,
        CrossyError::TimeoutNotReached
    );

    // Seller must currently own the asset; a frozen asset (active attempt
    // lock or existing listing) cannot be listed.
    let owner = mpl_core::read_asset_owner(&ctx.accounts.asset.to_account_info())?;
    require_keys_eq!(
        owner,
        ctx.accounts.seller.key(),
        CrossyError::WrongAssetOwner
    );
    let listing = &mut ctx.accounts.listing;
    if listing.asset != Pubkey::default() {
        require!(
            listing.status != ListingStatus::Active,
            CrossyError::AgentListed
        );
    }

    // Listing custody: freeze under the game PDA (seller keeps ownership but
    // cannot transfer while listed — fails if already frozen for an attempt)
    // and approve the same PDA as TRANSFER delegate so a sale can move the
    // asset without the seller online.
    let freeze_seeds: &[&[&[u8]]] = &[&[FREEZE_AUTHORITY_SEED, &[ctx.bumps.freeze_authority]]];
    mpl_core::ensure_transfer_delegate(
        &ctx.accounts.asset.to_account_info(),
        Some(&ctx.accounts.collection.to_account_info()),
        &ctx.accounts.seller.to_account_info(),
        &ctx.accounts.seller.to_account_info(),
        &ctx.accounts.freeze_authority.to_account_info(),
        &ctx.accounts.system_program.to_account_info(),
        &ctx.accounts.core_program.to_account_info(),
    )?;
    mpl_core::ensure_frozen_under(
        &ctx.accounts.asset.to_account_info(),
        Some(&ctx.accounts.collection.to_account_info()),
        &ctx.accounts.seller.to_account_info(),
        &ctx.accounts.seller.to_account_info(),
        &ctx.accounts.freeze_authority.to_account_info(),
        &ctx.accounts.system_program.to_account_info(),
        &ctx.accounts.core_program.to_account_info(),
        freeze_seeds,
    )?;

    listing.seller = ctx.accounts.seller.key();
    listing.asset = ctx.accounts.asset.key();
    listing.price = price;
    listing.created_ts = now;
    listing.expiry_ts = expiry_ts;
    listing.status = ListingStatus::Active;
    listing.sale_nonce = listing
        .sale_nonce
        .checked_add(1)
        .ok_or(CrossyError::Overflow)?;
    listing.bump = ctx.bumps.listing;

    emit!(AgentListedEvent {
        listing: listing.key(),
        seller: listing.seller,
        asset: listing.asset,
        price,
    });
    Ok(())
}

// ---------------------------------------------------------------------------
// delist_agent
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct DelistAgent<'info> {
    #[account(seeds = [seeds::CONFIG], bump = config.bump)]
    pub config: Box<Account<'info, GlobalConfig>>,
    /// CHECK: the listed asset.
    #[account(mut, address = listing.asset @ CrossyError::WrongAssetOwner)]
    pub asset: UncheckedAccount<'info>,
    /// CHECK: configured collection.
    #[account(mut, address = config.collection @ CrossyError::WrongCollection)]
    pub collection: UncheckedAccount<'info>,
    #[account(
        mut,
        seeds = [seeds::LISTING, listing.asset.as_ref()],
        bump = listing.bump,
        constraint = listing.status == ListingStatus::Active @ CrossyError::InvalidTransition,
        constraint = listing.seller == seller.key() @ CrossyError::NotWallet
    )]
    pub listing: Box<Account<'info, MarketplaceListing>>,
    /// CHECK: freeze authority PDA.
    #[account(seeds = [FREEZE_AUTHORITY_SEED], bump)]
    pub freeze_authority: UncheckedAccount<'info>,
    #[account(mut)]
    pub seller: Signer<'info>,
    pub system_program: Program<'info, System>,
    /// CHECK: mpl-core program.
    #[account(address = mpl_core::MPL_CORE_ID)]
    pub core_program: UncheckedAccount<'info>,
}

pub fn delist_agent(ctx: Context<DelistAgent>) -> Result<()> {
    // Thaw and restore unrestricted transfer.
    let signer_seeds: &[&[&[u8]]] = &[&[FREEZE_AUTHORITY_SEED, &[ctx.bumps.freeze_authority]]];
    mpl_core::set_frozen(
        &ctx.accounts.asset.to_account_info(),
        Some(&ctx.accounts.collection.to_account_info()),
        &ctx.accounts.seller.to_account_info(),
        &ctx.accounts.freeze_authority.to_account_info(),
        false,
        &ctx.accounts.system_program.to_account_info(),
        &ctx.accounts.core_program.to_account_info(),
        signer_seeds,
    )?;

    let listing = &mut ctx.accounts.listing;
    listing.status = ListingStatus::Delisted;
    emit!(AgentDelisted {
        listing: listing.key(),
        asset: listing.asset
    });
    Ok(())
}

// ---------------------------------------------------------------------------
// buy_listing
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct BuyListing<'info> {
    #[account(
        seeds = [seeds::CONFIG],
        bump = config.bump,
        constraint = !config.is_paused(pause::MARKETPLACE) @ CrossyError::Paused
    )]
    pub config: Box<Account<'info, GlobalConfig>>,
    /// CHECK: the listed asset.
    #[account(mut, address = listing.asset @ CrossyError::WrongAssetOwner)]
    pub asset: UncheckedAccount<'info>,
    /// CHECK: configured collection.
    #[account(mut, address = config.collection @ CrossyError::WrongCollection)]
    pub collection: UncheckedAccount<'info>,
    #[account(
        mut,
        seeds = [seeds::LISTING, listing.asset.as_ref()],
        bump = listing.bump,
        constraint = listing.status == ListingStatus::Active @ CrossyError::InvalidTransition,
        constraint = listing.seller != buyer.key() @ CrossyError::InvalidTransition
    )]
    pub listing: Box<Account<'info, MarketplaceListing>>,
    /// Buyer's USDC account.
    #[account(
        mut,
        constraint = buyer_token.owner == buyer.key() @ CrossyError::WrongTokenOwner,
        constraint = buyer_token.mint == config.usdc_mint @ CrossyError::WrongMint
    )]
    pub buyer_token: Box<InterfaceAccount<'info, TokenAccount>>,
    /// Seller proceeds: canonical USDC account owned by the listing seller.
    #[account(
        mut,
        constraint = seller_token.owner == listing.seller @ CrossyError::WrongTokenOwner,
        constraint = seller_token.mint == config.usdc_mint @ CrossyError::WrongMint
    )]
    pub seller_token: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(mut, address = config.team_treasury @ CrossyError::WrongTreasury)]
    pub team_treasury: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(address = config.usdc_mint @ CrossyError::WrongMint)]
    pub usdc_mint: Box<InterfaceAccount<'info, Mint>>,
    /// CHECK: freeze authority PDA (thaw + transfer custody).
    #[account(seeds = [FREEZE_AUTHORITY_SEED], bump)]
    pub freeze_authority: UncheckedAccount<'info>,
    #[account(mut)]
    pub buyer: Signer<'info>,
    pub system_program: Program<'info, System>,
    /// CHECK: mpl-core program.
    #[account(address = mpl_core::MPL_CORE_ID)]
    pub core_program: UncheckedAccount<'info>,
    /// CHECK: configured token program.
    #[account(address = config.token_program @ CrossyError::WrongTokenProgram)]
    pub token_program: UncheckedAccount<'info>,
}

/// Atomic purchase: exact USDC split (90% seller, 10% team) + thaw +
/// asset transfer to the buyer in one transaction.
pub fn buy_listing(ctx: Context<BuyListing>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let listing = &ctx.accounts.listing;
    require!(
        listing.expiry_ts == 0 || now < listing.expiry_ts,
        CrossyError::TimeoutNotReached
    );
    // Ownership unchanged since listing (freeze makes this invariant, but
    // verify defensively).
    let owner = mpl_core::read_asset_owner(&ctx.accounts.asset.to_account_info())?;
    require_keys_eq!(owner, listing.seller, CrossyError::WrongAssetOwner);

    let (seller_amount, team_amount) =
        economy::market_split(listing.price).ok_or(CrossyError::Overflow)?;

    // Payment legs (buyer-signed).
    token_interface::transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            TransferChecked {
                from: ctx.accounts.buyer_token.to_account_info(),
                mint: ctx.accounts.usdc_mint.to_account_info(),
                to: ctx.accounts.seller_token.to_account_info(),
                authority: ctx.accounts.buyer.to_account_info(),
            },
        ),
        seller_amount,
        USDC_DECIMALS,
    )?;
    token_interface::transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            TransferChecked {
                from: ctx.accounts.buyer_token.to_account_info(),
                mint: ctx.accounts.usdc_mint.to_account_info(),
                to: ctx.accounts.team_treasury.to_account_info(),
                authority: ctx.accounts.buyer.to_account_info(),
            },
        ),
        team_amount,
        USDC_DECIMALS,
    )?;

    // Thaw (freeze delegate), then transfer via the approved TRANSFER
    // delegate — both the game PDA, approved at listing time. TransferV1
    // resets owner-managed plugin authorities to the new owner.
    let signer_seeds: &[&[&[u8]]] = &[&[FREEZE_AUTHORITY_SEED, &[ctx.bumps.freeze_authority]]];
    mpl_core::set_frozen(
        &ctx.accounts.asset.to_account_info(),
        Some(&ctx.accounts.collection.to_account_info()),
        &ctx.accounts.buyer.to_account_info(),
        &ctx.accounts.freeze_authority.to_account_info(),
        false,
        &ctx.accounts.system_program.to_account_info(),
        &ctx.accounts.core_program.to_account_info(),
        signer_seeds,
    )?;
    mpl_core::transfer(
        &ctx.accounts.asset.to_account_info(),
        Some(&ctx.accounts.collection.to_account_info()),
        &ctx.accounts.buyer.to_account_info(),
        &ctx.accounts.freeze_authority.to_account_info(),
        &ctx.accounts.buyer.to_account_info(),
        &ctx.accounts.system_program.to_account_info(),
        &ctx.accounts.core_program.to_account_info(),
        signer_seeds,
    )?;

    let listing = &mut ctx.accounts.listing;
    listing.status = ListingStatus::Sold;
    emit!(AgentSold {
        listing: listing.key(),
        seller: listing.seller,
        buyer: ctx.accounts.buyer.key(),
        asset: listing.asset,
        price: listing.price,
        seller_amount,
        team_amount,
    });
    Ok(())
}
