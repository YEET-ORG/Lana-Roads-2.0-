//! Player profile creation and the one-time starter entitlement claim.

use anchor_lang::prelude::*;

use crate::constants::{seeds, MAX_AGENT_INDEX};
use crate::errors::CrossyError;
use crate::events::{IdentitySet, StarterClaimed};
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
        profile.version = 2;
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

#[derive(Accounts)]
pub struct SetIdentity<'info> {
    #[account(
        init_if_needed,
        payer = wallet,
        space = 8 + PlayerIdentity::INIT_SPACE,
        seeds = [seeds::IDENTITY, wallet.key().as_ref()],
        bump
    )]
    pub identity: Box<Account<'info, PlayerIdentity>>,
    #[account(mut)]
    pub wallet: Signer<'info>,
    pub system_program: Program<'info, System>,
}

/// Set the caller's display name and chosen agent.
///
/// Both are cosmetic, and both have to live here rather than in the
/// browser: another player's client is what draws them, so a choice kept
/// locally is a choice nobody else can see. Wallet-signed — a session key
/// moves a run, it does not get to rename its owner.
pub fn set_identity(ctx: Context<SetIdentity>, name: String, agent: u16) -> Result<()> {
    let (bytes, len) =
        crate::kernel::name::sanitize(name.as_bytes()).ok_or(CrossyError::InvalidName)?;
    require!(agent < MAX_AGENT_INDEX, CrossyError::InvalidName);

    let identity = &mut ctx.accounts.identity;
    identity.wallet = ctx.accounts.wallet.key();
    identity.name = bytes;
    identity.name_len = len;
    identity.agent = agent;
    identity.version = 1;
    identity.bump = ctx.bumps.identity;
    emit!(IdentitySet {
        wallet: identity.wallet,
        agent,
    });
    Ok(())
}
