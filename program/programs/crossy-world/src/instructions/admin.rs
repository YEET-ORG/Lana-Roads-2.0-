//! Admin instructions: config initialization, two-step rotation, pause
//! scopes, season/banner/variant/class configuration.
//!
//! The admin prepares future state and triggers settlement but can never
//! choose winners, amounts, destinations, or alter live-season odds.

use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount};

use crate::constants::{
    seeds, BANNER_PRICES, HARD_MAX_PLAYERS, MAX_ABILITY_COOLDOWN_SECONDS, MAX_ABILITY_RANGE,
    MAX_EFFECT_DURATION_SECONDS, MAX_SEASON_VARIANTS, MIN_ABILITY_COOLDOWN_SECONDS, SEASON_DAYS,
    TEAM_BPS, USDC_DECIMALS, WINNER_BPS,
};
use crate::errors::CrossyError;
use crate::events::*;
use crate::kernel::time;
use crate::state::*;

// ---------------------------------------------------------------------------
// initialize_config
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(
        init,
        payer = admin,
        space = 8 + GlobalConfig::INIT_SPACE,
        seeds = [seeds::CONFIG],
        bump
    )]
    pub config: Box<Account<'info, GlobalConfig>>,
    /// Canonical USDC mint; decimals verified.
    pub usdc_mint: Box<InterfaceAccount<'info, Mint>>,
    /// Team treasury token account for the canonical mint.
    #[account(constraint = team_treasury.mint == usdc_mint.key() @ CrossyError::WrongMint)]
    pub team_treasury: Box<InterfaceAccount<'info, TokenAccount>>,
    /// CHECK: Metaplex Core collection address, validated operationally at
    /// collection creation; stored for later strict comparisons.
    pub collection: UncheckedAccount<'info>,
    /// CHECK: collection update / mint authority (program PDA or ops key).
    pub collection_authority: UncheckedAccount<'info>,
    /// CHECK: authenticated randomness callback identity.
    pub vrf_authority: UncheckedAccount<'info>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn initialize_config(
    ctx: Context<InitializeConfig>,
    max_paid_players: u16,
    max_casual_players: u16,
) -> Result<()> {
    require!(
        ctx.accounts.usdc_mint.decimals == USDC_DECIMALS,
        CrossyError::WrongMint
    );
    require!(
        max_paid_players > 0 && max_paid_players <= HARD_MAX_PLAYERS,
        CrossyError::CapacityExceeded
    );
    require!(
        max_casual_players > 0 && max_casual_players <= HARD_MAX_PLAYERS,
        CrossyError::CapacityExceeded
    );
    // Winner/team basis points are compile-time constants; assert the split.
    require!(
        WINNER_BPS as u64 + TEAM_BPS as u64 == 10_000,
        CrossyError::BadBasisPoints
    );

    let token_program = *ctx.accounts.usdc_mint.to_account_info().owner;
    require!(
        *ctx.accounts.team_treasury.to_account_info().owner == token_program,
        CrossyError::WrongTokenProgram
    );

    let config = &mut ctx.accounts.config;
    config.admin = ctx.accounts.admin.key();
    config.pending_admin = None;
    config.usdc_mint = ctx.accounts.usdc_mint.key();
    config.token_program = token_program;
    config.team_treasury = ctx.accounts.team_treasury.key();
    config.collection = ctx.accounts.collection.key();
    config.collection_authority = ctx.accounts.collection_authority.key();
    config.vrf_authority = ctx.accounts.vrf_authority.key();
    config.pause_flags = 0;
    config.winner_bps = WINNER_BPS;
    config.team_bps = TEAM_BPS;
    config.max_paid_players = max_paid_players;
    config.max_casual_players = max_casual_players;
    config.version = 1;
    config.bump = ctx.bumps.config;

    emit!(ConfigInitialized {
        admin: config.admin,
        usdc_mint: config.usdc_mint,
        treasury: config.team_treasury,
        collection: config.collection,
    });
    Ok(())
}

// ---------------------------------------------------------------------------
// two-step admin rotation
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct AdminOnly<'info> {
    #[account(
        mut,
        seeds = [seeds::CONFIG],
        bump = config.bump,
        constraint = config.admin == admin.key() @ CrossyError::NotAdmin
    )]
    pub config: Box<Account<'info, GlobalConfig>>,
    pub admin: Signer<'info>,
}

pub fn propose_admin(ctx: Context<AdminOnly>, new_admin: Pubkey) -> Result<()> {
    let config = &mut ctx.accounts.config;
    config.pending_admin = Some(new_admin);
    emit!(AdminRotationProposed {
        current: config.admin,
        proposed: new_admin
    });
    Ok(())
}

pub fn cancel_admin_proposal(ctx: Context<AdminOnly>) -> Result<()> {
    ctx.accounts.config.pending_admin = None;
    Ok(())
}

#[derive(Accounts)]
pub struct AcceptAdmin<'info> {
    #[account(
        mut,
        seeds = [seeds::CONFIG],
        bump = config.bump,
        constraint = config.pending_admin == Some(proposed.key()) @ CrossyError::NotProposedAdmin
    )]
    pub config: Box<Account<'info, GlobalConfig>>,
    pub proposed: Signer<'info>,
}

pub fn accept_admin(ctx: Context<AcceptAdmin>) -> Result<()> {
    let config = &mut ctx.accounts.config;
    let previous = config.admin;
    config.admin = ctx.accounts.proposed.key();
    config.pending_admin = None;
    emit!(AdminRotated {
        previous,
        new_admin: config.admin
    });
    Ok(())
}

/// Rotate the authenticated randomness identity. Chunk and gacha callbacks
/// are bound to whatever key is current at the moment they land; already
/// revealed results are immutable, so a rotation can never rewrite history.
pub fn set_vrf_authority(ctx: Context<AdminOnly>, new_authority: Pubkey) -> Result<()> {
    ctx.accounts.config.vrf_authority = new_authority;
    Ok(())
}

// ---------------------------------------------------------------------------
// pause controls
// ---------------------------------------------------------------------------

pub fn set_pause(ctx: Context<AdminOnly>, scope: u16, paused: bool) -> Result<()> {
    let config = &mut ctx.accounts.config;
    if paused {
        config.pause_flags |= scope;
    } else {
        config.pause_flags &= !scope;
    }
    emit!(PauseChanged {
        scope: scope as u8,
        paused
    });
    Ok(())
}

// ---------------------------------------------------------------------------
// season / banner / variant / class configuration
// ---------------------------------------------------------------------------

#[derive(Accounts)]
#[instruction(season_index: u16)]
pub struct CreateSeason<'info> {
    #[account(
        seeds = [seeds::CONFIG],
        bump = config.bump,
        constraint = config.admin == admin.key() @ CrossyError::NotAdmin
    )]
    pub config: Box<Account<'info, GlobalConfig>>,
    #[account(
        init,
        payer = admin,
        space = 8 + Season::INIT_SPACE,
        seeds = [seeds::SEASON, &season_index.to_le_bytes()],
        bump
    )]
    pub season: Box<Account<'info, Season>>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn create_season(
    ctx: Context<CreateSeason>,
    season_index: u16,
    start_day: u64,
    weights_hash: [u8; 32],
    class_balance_version: u16,
    metadata_version: u16,
) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let today = time::utc_day_from_unix(now).ok_or(CrossyError::Overflow)?;
    // Seasons are prepared in advance (or activated on the current day at
    // launch) and immutable once started.
    require!(start_day >= today, CrossyError::ActivationNotReached);

    let season = &mut ctx.accounts.season;
    season.season_index = season_index;
    season.start_day = start_day;
    season.end_day = start_day
        .checked_add(SEASON_DAYS)
        .ok_or(CrossyError::Overflow)?;
    season.weights_hash = weights_hash;
    season.class_balance_version = class_balance_version;
    season.metadata_version = metadata_version;
    season.status = SeasonStatus::Configured;
    season.variant_count = 0;
    season.bump = ctx.bumps.season;

    emit!(SeasonConfigured {
        season: season_index,
        start_day,
        end_day: season.end_day
    });
    Ok(())
}

#[derive(Accounts)]
#[instruction(season_index: u16, tier: u8)]
pub struct CreateBanner<'info> {
    #[account(
        seeds = [seeds::CONFIG],
        bump = config.bump,
        constraint = config.admin == admin.key() @ CrossyError::NotAdmin
    )]
    pub config: Box<Account<'info, GlobalConfig>>,
    #[account(
        seeds = [seeds::SEASON, &season_index.to_le_bytes()],
        bump = season.bump,
        constraint = season.status == SeasonStatus::Configured @ CrossyError::InvalidTransition
    )]
    pub season: Box<Account<'info, Season>>,
    #[account(
        init,
        payer = admin,
        space = 8 + Banner::INIT_SPACE,
        seeds = [seeds::BANNER, &season_index.to_le_bytes(), &[tier]],
        bump
    )]
    pub banner: Box<Account<'info, Banner>>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn create_banner(
    ctx: Context<CreateBanner>,
    season_index: u16,
    tier: u8,
    base_weights: [u16; 4],
) -> Result<()> {
    require!(tier < 3, CrossyError::InvalidTransition);
    let total: u64 = base_weights.iter().map(|&w| w as u64).sum();
    require!(total == 100, CrossyError::BadBasisPoints);

    let banner = &mut ctx.accounts.banner;
    banner.season = season_index;
    banner.tier = tier;
    banner.price = BANNER_PRICES[tier as usize];
    banner.base_weights = base_weights;
    banner.inventory_revision = 0;
    banner.status = BannerStatus::Active;
    banner.bump = ctx.bumps.banner;

    emit!(BannerConfigured {
        season: season_index,
        tier,
        price: banner.price
    });
    Ok(())
}

#[derive(Accounts)]
#[instruction(season_index: u16, variant_id: u16)]
pub struct CreateVariant<'info> {
    #[account(
        seeds = [seeds::CONFIG],
        bump = config.bump,
        constraint = config.admin == admin.key() @ CrossyError::NotAdmin
    )]
    pub config: Box<Account<'info, GlobalConfig>>,
    #[account(
        mut,
        seeds = [seeds::SEASON, &season_index.to_le_bytes()],
        bump = season.bump,
        constraint = season.status == SeasonStatus::Configured @ CrossyError::InvalidTransition
    )]
    pub season: Box<Account<'info, Season>>,
    /// The class this variant maps to must exist (any version).
    pub class_config: Box<Account<'info, ClassConfig>>,
    #[account(
        init,
        payer = admin,
        space = 8 + VariantInventory::INIT_SPACE,
        seeds = [seeds::VARIANT, &season_index.to_le_bytes(), &variant_id.to_le_bytes()],
        bump
    )]
    pub variant: Box<Account<'info, VariantInventory>>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[allow(clippy::too_many_arguments)]
pub fn create_variant(
    ctx: Context<CreateVariant>,
    season_index: u16,
    variant_id: u16,
    rarity: u8,
    model_id: u16,
    cosmetic_id: u16,
    metadata_uri_hash: [u8; 32],
    supply_cap: u32,
) -> Result<()> {
    require!(rarity < 4, CrossyError::InvalidTransition);
    require!(supply_cap > 0, CrossyError::SupplyExceeded);
    let season = &mut ctx.accounts.season;
    require!(
        season.variant_count < MAX_SEASON_VARIANTS,
        CrossyError::CapacityExceeded
    );
    let class = &ctx.accounts.class_config;
    // Stronger classes may require a minimum rarity; enforce the disclosed
    // relationship at configuration time.
    require!(rarity >= class.min_rarity, CrossyError::BadClassMapping);

    season.variant_count = season
        .variant_count
        .checked_add(1)
        .ok_or(CrossyError::Overflow)?;

    let variant = &mut ctx.accounts.variant;
    variant.season = season_index;
    variant.variant_id = variant_id;
    variant.class_id = class.class_id;
    variant.rarity = rarity;
    variant.model_id = model_id;
    variant.cosmetic_id = cosmetic_id;
    variant.metadata_uri_hash = metadata_uri_hash;
    variant.supply_cap = supply_cap;
    variant.reserved = 0;
    variant.minted = 0;
    variant.active = true;
    variant.bump = ctx.bumps.variant;

    emit!(VariantConfigured {
        season: season_index,
        variant_id,
        class_id: class.class_id,
        rarity,
        supply_cap,
    });
    Ok(())
}

#[derive(Accounts)]
#[instruction(class_id: u16, version: u16)]
pub struct CreateClassConfig<'info> {
    #[account(
        seeds = [seeds::CONFIG],
        bump = config.bump,
        constraint = config.admin == admin.key() @ CrossyError::NotAdmin
    )]
    pub config: Box<Account<'info, GlobalConfig>>,
    #[account(
        init,
        payer = admin,
        space = 8 + ClassConfig::INIT_SPACE,
        seeds = [seeds::CLASS, &class_id.to_le_bytes(), &version.to_le_bytes()],
        bump
    )]
    pub class_config: Box<Account<'info, ClassConfig>>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[allow(clippy::too_many_arguments)]
pub fn create_class_config(
    ctx: Context<CreateClassConfig>,
    class_id: u16,
    version: u16,
    ability: AbilityKind,
    cooldown_seconds: u16,
    range: u8,
    duration_seconds: u16,
    displacement: u8,
    param_a: u16,
    param_b: u16,
    min_rarity: u8,
    activation_day: u64,
) -> Result<()> {
    // Class balance activates only at a future UTC day boundary; never
    // inside an active day.
    let now = Clock::get()?.unix_timestamp;
    let today = time::utc_day_from_unix(now).ok_or(CrossyError::Overflow)?;
    require!(activation_day > today, CrossyError::ActivationNotReached);
    if ability != AbilityKind::None {
        require!(
            (MIN_ABILITY_COOLDOWN_SECONDS..=MAX_ABILITY_COOLDOWN_SECONDS)
                .contains(&cooldown_seconds),
            CrossyError::BadAbility
        );
    }
    require!(range <= MAX_ABILITY_RANGE, CrossyError::BadAbility);
    require!(
        duration_seconds <= MAX_EFFECT_DURATION_SECONDS,
        CrossyError::BadAbility
    );
    require!(displacement <= 2, CrossyError::BadAbility);
    require!(min_rarity < 4, CrossyError::BadAbility);

    let class = &mut ctx.accounts.class_config;
    class.class_id = class_id;
    class.version = version;
    class.ability = ability;
    class.cooldown_seconds = cooldown_seconds;
    class.range = range;
    class.duration_seconds = duration_seconds;
    class.displacement = displacement;
    class.param_a = param_a;
    class.param_b = param_b;
    class.min_rarity = min_rarity;
    class.activation_day = activation_day;
    class.bump = ctx.bumps.class_config;

    emit!(ClassConfigured {
        class_id,
        version,
        activation_day
    });
    Ok(())
}
