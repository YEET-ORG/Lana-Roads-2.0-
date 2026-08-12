//! Player profile creation and the one-time starter entitlement claim.

use anchor_lang::prelude::*;

use crate::constants::seeds;
use crate::errors::CrossyError;
use crate::events::StarterClaimed;
use crate::state::*;

#[derive(Accounts)]
pub struct EnsureProfile<'info> {
    #[account(
        init_if_needed,
        payer = wallet,
        space = 8 + PlayerProfile::INIT_SPACE,
        seeds = [seeds::PLAYER, wallet.key().as_ref()],
        bump
    )]
    pub profile: Box<Account<'info, PlayerProfile>>,
    #[account(mut)]
    pub wallet: Signer<'info>,
    pub system_program: Program<'info, System>,
}

/// Idempotently create the caller's profile.
pub fn ensure_profile(ctx: Context<EnsureProfile>) -> Result<()> {
    let profile = &mut ctx.accounts.profile;
    if profile.wallet == Pubkey::default() {
        profile.wallet = ctx.accounts.wallet.key();
        profile.version = 1;
        profile.bump = ctx.bumps.profile;
    }
    Ok(())
}

#[derive(Accounts)]
pub struct ClaimStarter<'info> {
    #[account(
        mut,
        seeds = [seeds::PLAYER, wallet.key().as_ref()],
        bump = profile.bump,
        constraint = profile.wallet == wallet.key() @ CrossyError::NotWallet
    )]
    pub profile: Box<Account<'info, PlayerProfile>>,
    pub wallet: Signer<'info>,
}

/// One-time, non-transferable starter entitlement (Kick-only class).
pub fn claim_starter(ctx: Context<ClaimStarter>) -> Result<()> {
    let profile = &mut ctx.accounts.profile;
    require!(!profile.starter_claimed, CrossyError::StarterAlreadyClaimed);
    profile.starter_claimed = true;
    emit!(StarterClaimed {
        wallet: profile.wallet
    });
    Ok(())
}
