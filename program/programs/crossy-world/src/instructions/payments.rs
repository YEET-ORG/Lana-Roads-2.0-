//! USDC payment flows: entry, revival, reconciliation, refunds, void claims.
//!
//! Base USDC transfer and ER tile reservation are not falsely atomic — the
//! receipt state machine (`Pending -> Consumed` XOR `Pending -> Refundable ->
//! Refunded`) exposes the real stages, and permissionless reconciliation
//! moves value between liability categories only against committed run state.

use anchor_lang::prelude::*;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TransferChecked};

use crate::constants::{seeds, ENTRY_PRICE, REVIVE_WINDOW_SECONDS, USDC_DECIMALS};
use crate::cross_plane::read_committed_run;
use crate::errors::CrossyError;
use crate::events::*;
use crate::kernel::{economy, time};
use crate::state::config::pause;
use crate::state::*;

// ---------------------------------------------------------------------------
// begin_paid_attempt
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct BeginPaidAttempt<'info> {
    #[account(
        seeds = [seeds::CONFIG],
        bump = config.bump,
        constraint = !config.is_paused(pause::PAID_ADMISSION) @ CrossyError::Paused
    )]
    pub config: Box<Account<'info, GlobalConfig>>,
    #[account(
        mut,
        seeds = [seeds::DAILY, &daily.day.to_le_bytes()],
        bump = daily.bump,
        constraint = matches!(daily.status, DayStatus::Prepared | DayStatus::Open)
            @ CrossyError::DayNotOpen
    )]
    pub daily: Box<Account<'info, DailyCompetition>>,
    #[account(mut, address = daily.vault @ CrossyError::WrongVault)]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        seeds = [seeds::PLAYER, wallet.key().as_ref()],
        bump = profile.bump,
        constraint = profile.wallet == wallet.key() @ CrossyError::NotWallet
    )]
    pub profile: Box<Account<'info, PlayerProfile>>,
    /// CHECK: committed run representation (may be delegated). Validated by
    /// PDA + discriminator in the handler.
    pub run: UncheckedAccount<'info>,
    /// Payer's USDC account.
    #[account(
        mut,
        constraint = payer_token.owner == wallet.key() @ CrossyError::WrongTokenOwner,
        constraint = payer_token.mint == config.usdc_mint @ CrossyError::WrongMint
    )]
    pub payer_token: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(address = config.usdc_mint @ CrossyError::WrongMint)]
    pub usdc_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        init,
        payer = wallet,
        space = 8 + PaymentReceipt::INIT_SPACE,
        seeds = [
            seeds::PAYMENT,
            &[ReceiptKind::Entry as u8],
            &daily.day.to_le_bytes(),
            wallet.key().as_ref(),
            &profile.receipt_count.to_le_bytes(),
        ],
        bump
    )]
    pub receipt: Box<Account<'info, PaymentReceipt>>,
    #[account(
        init_if_needed,
        payer = wallet,
        space = 8 + DailyContribution::INIT_SPACE,
        seeds = [seeds::CONTRIBUTION, &daily.day.to_le_bytes(), wallet.key().as_ref()],
        bump
    )]
    pub contribution: Box<Account<'info, DailyContribution>>,
    #[account(mut)]
    pub wallet: Signer<'info>,
    pub system_program: Program<'info, System>,
    /// CHECK: configured token program.
    #[account(address = config.token_program @ CrossyError::WrongTokenProgram)]
    pub token_program: UncheckedAccount<'info>,
}

/// Pay exactly 1 USDC into the day vault as *pending*, creating the entry
/// receipt bound to the wallet's next attempt nonce. Agent lock/freeze runs
/// in the same reviewed transaction via `lock_agent` / starter marker.
pub fn begin_paid_attempt(ctx: Context<BeginPaidAttempt>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let daily = &mut ctx.accounts.daily;
    require!(
        !time::cutoff_passed(daily.day, now),
        CrossyError::CutoffPassed
    );

    // Committed run must not show a live attempt (authoritative enforcement
    // happens again at ER spawn; this blocks obvious double-entry).
    let committed = read_committed_run(
        &ctx.accounts.run.to_account_info(),
        &daily.paid_world,
        &ctx.accounts.wallet.key(),
    )?;
    require!(committed.is_terminal(), CrossyError::AttemptStillActive);
    let next_attempt = committed
        .attempt_nonce
        .checked_add(1)
        .ok_or(CrossyError::Overflow)?;

    // Exact 1 USDC, transfer-checked, into the day vault.
    token_interface::transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            TransferChecked {
                from: ctx.accounts.payer_token.to_account_info(),
                mint: ctx.accounts.usdc_mint.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.wallet.to_account_info(),
            },
        ),
        ENTRY_PRICE,
        USDC_DECIMALS,
    )?;

    daily.pending_total = daily
        .pending_total
        .checked_add(ENTRY_PRICE)
        .ok_or(CrossyError::Overflow)?;
    daily.total_deposited = daily
        .total_deposited
        .checked_add(ENTRY_PRICE)
        .ok_or(CrossyError::Overflow)?;

    let receipt = &mut ctx.accounts.receipt;
    receipt.kind = ReceiptKind::Entry;
    receipt.state = ReceiptState::Pending;
    receipt.day = daily.day;
    receipt.wallet = ctx.accounts.wallet.key();
    receipt.run = ctx.accounts.run.key();
    receipt.attempt_nonce = next_attempt;
    receipt.death_nonce = 0;
    receipt.revive_index = 0;
    receipt.amount = ENTRY_PRICE;
    receipt.created_ts = now;
    receipt.receipt_nonce = ctx.accounts.profile.receipt_count;
    receipt.bump = ctx.bumps.receipt;

    let profile = &mut ctx.accounts.profile;
    profile.receipt_count = profile
        .receipt_count
        .checked_add(1)
        .ok_or(CrossyError::Overflow)?;

    let contribution = &mut ctx.accounts.contribution;
    if contribution.wallet == Pubkey::default() {
        contribution.day = daily.day;
        contribution.wallet = ctx.accounts.wallet.key();
        contribution.bump = ctx.bumps.contribution;
    }

    emit!(PaymentPending {
        receipt: receipt.key(),
        day: daily.day,
        wallet: receipt.wallet,
        kind: ReceiptKind::Entry as u8,
        amount: ENTRY_PRICE,
        attempt_nonce: next_attempt,
        death_nonce: 0,
    });
    Ok(())
}

// ---------------------------------------------------------------------------
// begin_revive
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct BeginRevive<'info> {
    #[account(
        seeds = [seeds::CONFIG],
        bump = config.bump,
        constraint = !config.is_paused(pause::PAID_ADMISSION) @ CrossyError::Paused
    )]
    pub config: Box<Account<'info, GlobalConfig>>,
    #[account(
        mut,
        seeds = [seeds::DAILY, &daily.day.to_le_bytes()],
        bump = daily.bump,
        constraint = matches!(daily.status, DayStatus::Open) @ CrossyError::DayNotOpen
    )]
    pub daily: Box<Account<'info, DailyCompetition>>,
    #[account(mut, address = daily.vault @ CrossyError::WrongVault)]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        seeds = [seeds::PLAYER, wallet.key().as_ref()],
        bump = profile.bump,
        constraint = profile.wallet == wallet.key() @ CrossyError::NotWallet
    )]
    pub profile: Box<Account<'info, PlayerProfile>>,
    /// CHECK: committed run representation (delegated). Validated in handler.
    pub run: UncheckedAccount<'info>,
    #[account(
        mut,
        constraint = payer_token.owner == wallet.key() @ CrossyError::WrongTokenOwner,
        constraint = payer_token.mint == config.usdc_mint @ CrossyError::WrongMint
    )]
    pub payer_token: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(address = config.usdc_mint @ CrossyError::WrongMint)]
    pub usdc_mint: Box<InterfaceAccount<'info, Mint>>,
    #[account(
        init,
        payer = wallet,
        space = 8 + PaymentReceipt::INIT_SPACE,
        seeds = [
            seeds::PAYMENT,
            &[ReceiptKind::Revival as u8],
            &daily.day.to_le_bytes(),
            wallet.key().as_ref(),
            &profile.receipt_count.to_le_bytes(),
        ],
        bump
    )]
    pub receipt: Box<Account<'info, PaymentReceipt>>,
    #[account(mut)]
    pub wallet: Signer<'info>,
    pub system_program: Program<'info, System>,
    /// CHECK: configured token program.
    #[account(address = config.token_program @ CrossyError::WrongTokenProgram)]
    pub token_program: UncheckedAccount<'info>,
}

/// Pay the exact doubling revival price against a committed death. The
/// receipt binds day, run, attempt, death nonce, and revive index; a stale
/// or late ER result can never consume it for another death.
pub fn begin_revive(ctx: Context<BeginRevive>) -> Result<()> {
    let now = Clock::get()?.unix_timestamp;
    let daily = &mut ctx.accounts.daily;
    require!(
        !time::cutoff_passed(daily.day, now),
        CrossyError::CutoffPassed
    );

    let committed = read_committed_run(
        &ctx.accounts.run.to_account_info(),
        &daily.paid_world,
        &ctx.accounts.wallet.key(),
    )?;
    require!(
        committed.state == RunState::DeadAwaitingRevive,
        CrossyError::BadRunState
    );
    // The 60-second window is enforced against the committed deadline.
    require!(
        now <= committed.revive_deadline
            && committed.revive_deadline
                <= now
                    .checked_add(REVIVE_WINDOW_SECONDS)
                    .ok_or(CrossyError::Overflow)?,
        CrossyError::RevivalExpired
    );

    let price = economy::revive_price(committed.successful_revives).ok_or(CrossyError::Overflow)?;

    token_interface::transfer_checked(
        CpiContext::new(
            ctx.accounts.token_program.key(),
            TransferChecked {
                from: ctx.accounts.payer_token.to_account_info(),
                mint: ctx.accounts.usdc_mint.to_account_info(),
                to: ctx.accounts.vault.to_account_info(),
                authority: ctx.accounts.wallet.to_account_info(),
            },
        ),
        price,
        USDC_DECIMALS,
    )?;

    daily.pending_total = daily
        .pending_total
        .checked_add(price)
        .ok_or(CrossyError::Overflow)?;
    daily.total_deposited = daily
        .total_deposited
        .checked_add(price)
        .ok_or(CrossyError::Overflow)?;

    let receipt = &mut ctx.accounts.receipt;
    receipt.kind = ReceiptKind::Revival;
    receipt.state = ReceiptState::Pending;
    receipt.day = daily.day;
    receipt.wallet = ctx.accounts.wallet.key();
    receipt.run = ctx.accounts.run.key();
    receipt.attempt_nonce = committed.attempt_nonce;
    receipt.death_nonce = committed.death_nonce;
    receipt.revive_index = committed.successful_revives;
    receipt.amount = price;
    receipt.created_ts = now;
    receipt.receipt_nonce = ctx.accounts.profile.receipt_count;
    receipt.bump = ctx.bumps.receipt;

    let profile = &mut ctx.accounts.profile;
    profile.receipt_count = profile
        .receipt_count
        .checked_add(1)
        .ok_or(CrossyError::Overflow)?;

    emit!(PaymentPending {
        receipt: receipt.key(),
        day: daily.day,
        wallet: receipt.wallet,
        kind: ReceiptKind::Revival as u8,
        amount: price,
        attempt_nonce: receipt.attempt_nonce,
        death_nonce: receipt.death_nonce,
    });
    Ok(())
}

// ---------------------------------------------------------------------------
// reconcile_receipt — permissionless cross-plane reconciliation
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct ReconcileReceipt<'info> {
    #[account(
        mut,
        seeds = [seeds::DAILY, &daily.day.to_le_bytes()],
        bump = daily.bump,
    )]
    pub daily: Box<Account<'info, DailyCompetition>>,
    #[account(
        mut,
        constraint = receipt.day == daily.day @ CrossyError::ReceiptMismatch,
        constraint = receipt.state == ReceiptState::Pending @ CrossyError::BadReceiptState
    )]
    pub receipt: Box<Account<'info, PaymentReceipt>>,
    /// CHECK: committed run representation. Validated in handler.
    pub run: UncheckedAccount<'info>,
    #[account(
        mut,
        seeds = [seeds::CONTRIBUTION, &daily.day.to_le_bytes(), receipt.wallet.as_ref()],
        bump = contribution.bump,
    )]
    pub contribution: Box<Account<'info, DailyContribution>>,
}

/// Move a pending payment to its terminal accounting category based on the
/// committed run outcome. Permissionless; a fixed transition either way.
pub fn reconcile_receipt(ctx: Context<ReconcileReceipt>) -> Result<()> {
    let daily = &mut ctx.accounts.daily;
    let receipt = &mut ctx.accounts.receipt;
    require_keys_eq!(
        receipt.run,
        ctx.accounts.run.key(),
        CrossyError::ReceiptMismatch
    );

    let committed = read_committed_run(
        &ctx.accounts.run.to_account_info(),
        &daily.paid_world,
        &receipt.wallet,
    )?;

    // The committed run must have caught up to (or passed) the receipt's
    // attempt before any judgment is possible.
    let (consumed, failed) = match receipt.kind {
        ReceiptKind::Entry => {
            if committed.attempt_nonce == receipt.attempt_nonce
                && committed.entry_receipt == receipt.key()
            {
                match committed.state {
                    RunState::Active | RunState::DeadAwaitingRevive | RunState::Ended => {
                        (true, false)
                    }
                    RunState::EntryFailed => (false, true),
                    _ => (false, false),
                }
            } else if committed.attempt_nonce > receipt.attempt_nonce {
                // The run moved on without ever activating this receipt.
                (false, true)
            } else {
                (false, false)
            }
        }
        ReceiptKind::Revival => {
            if committed.attempt_nonce == receipt.attempt_nonce {
                if committed.revive_receipt == receipt.key()
                    && committed.successful_revives > receipt.revive_index
                {
                    (true, false)
                } else if committed.death_nonce > receipt.death_nonce
                    || committed.state == RunState::Ended
                    || committed.state == RunState::Idle
                {
                    // A later death or terminal end proves this revival never
                    // succeeded.
                    (false, true)
                } else {
                    (false, false)
                }
            } else if committed.attempt_nonce > receipt.attempt_nonce {
                (false, true)
            } else {
                (false, false)
            }
        }
    };
    require!(consumed || failed, CrossyError::NotReconcilable);

    daily.pending_total = daily
        .pending_total
        .checked_sub(receipt.amount)
        .ok_or(CrossyError::Overflow)?;

    if consumed {
        daily.active_pool = daily
            .active_pool
            .checked_add(receipt.amount)
            .ok_or(CrossyError::Overflow)?;
        let contribution = &mut ctx.accounts.contribution;
        match receipt.kind {
            ReceiptKind::Entry => {
                contribution.entry_total = contribution
                    .entry_total
                    .checked_add(receipt.amount)
                    .ok_or(CrossyError::Overflow)?;
            }
            ReceiptKind::Revival => {
                contribution.revival_total = contribution
                    .revival_total
                    .checked_add(receipt.amount)
                    .ok_or(CrossyError::Overflow)?;
            }
        }
        receipt.state = ReceiptState::Consumed;
        emit!(PaymentConsumed {
            receipt: receipt.key(),
            amount: receipt.amount
        });
    } else {
        daily.refund_liability = daily
            .refund_liability
            .checked_add(receipt.amount)
            .ok_or(CrossyError::Overflow)?;
        receipt.state = ReceiptState::Refundable;
        emit!(PaymentRefundable {
            receipt: receipt.key(),
            amount: receipt.amount
        });
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// refund_receipt
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct RefundReceipt<'info> {
    #[account(seeds = [seeds::CONFIG], bump = config.bump)]
    pub config: Box<Account<'info, GlobalConfig>>,
    #[account(
        mut,
        seeds = [seeds::DAILY, &daily.day.to_le_bytes()],
        bump = daily.bump,
    )]
    pub daily: Box<Account<'info, DailyCompetition>>,
    /// CHECK: vault authority PDA (transfer signer).
    #[account(
        seeds = [seeds::DAILY_VAULT, &daily.day.to_le_bytes()],
        bump = daily.vault_authority_bump
    )]
    pub vault_authority: UncheckedAccount<'info>,
    #[account(mut, address = daily.vault @ CrossyError::WrongVault)]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        constraint = receipt.day == daily.day @ CrossyError::ReceiptMismatch,
        constraint = receipt.state == ReceiptState::Refundable @ CrossyError::BadReceiptState
    )]
    pub receipt: Box<Account<'info, PaymentReceipt>>,
    /// Destination: the receipt wallet's canonical USDC account. Fixed
    /// recipient; the caller may be anyone (permissionless sponsorship).
    #[account(
        mut,
        constraint = wallet_token.owner == receipt.wallet @ CrossyError::WrongTokenOwner,
        constraint = wallet_token.mint == config.usdc_mint @ CrossyError::WrongMint
    )]
    pub wallet_token: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(address = config.usdc_mint @ CrossyError::WrongMint)]
    pub usdc_mint: Box<InterfaceAccount<'info, Mint>>,
    /// CHECK: configured token program.
    #[account(address = config.token_program @ CrossyError::WrongTokenProgram)]
    pub token_program: UncheckedAccount<'info>,
}

/// Transfer a refundable receipt back to its wallet. Pause never blocks
/// valid refunds (only the refund path itself being unsafe would).
pub fn refund_receipt(ctx: Context<RefundReceipt>) -> Result<()> {
    let daily = &mut ctx.accounts.daily;
    let receipt = &mut ctx.accounts.receipt;

    let day_bytes = daily.day.to_le_bytes();
    let signer_seeds: &[&[&[u8]]] = &[&[
        seeds::DAILY_VAULT,
        &day_bytes,
        &[daily.vault_authority_bump],
    ]];
    token_interface::transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            TransferChecked {
                from: ctx.accounts.vault.to_account_info(),
                mint: ctx.accounts.usdc_mint.to_account_info(),
                to: ctx.accounts.wallet_token.to_account_info(),
                authority: ctx.accounts.vault_authority.to_account_info(),
            },
            signer_seeds,
        ),
        receipt.amount,
        USDC_DECIMALS,
    )?;

    daily.refund_liability = daily
        .refund_liability
        .checked_sub(receipt.amount)
        .ok_or(CrossyError::Overflow)?;
    daily.total_refunded = daily
        .total_refunded
        .checked_add(receipt.amount)
        .ok_or(CrossyError::Overflow)?;
    receipt.state = ReceiptState::Refunded;

    emit!(PaymentRefunded {
        receipt: receipt.key(),
        wallet: receipt.wallet,
        amount: receipt.amount,
    });
    Ok(())
}

// ---------------------------------------------------------------------------
// claim_void_refund
// ---------------------------------------------------------------------------

#[derive(Accounts)]
pub struct ClaimVoidRefund<'info> {
    #[account(seeds = [seeds::CONFIG], bump = config.bump)]
    pub config: Box<Account<'info, GlobalConfig>>,
    #[account(
        mut,
        seeds = [seeds::DAILY, &daily.day.to_le_bytes()],
        bump = daily.bump,
        constraint = daily.status == DayStatus::Voided @ CrossyError::InvalidTransition
    )]
    pub daily: Box<Account<'info, DailyCompetition>>,
    /// CHECK: vault authority PDA (transfer signer).
    #[account(
        seeds = [seeds::DAILY_VAULT, &daily.day.to_le_bytes()],
        bump = daily.vault_authority_bump
    )]
    pub vault_authority: UncheckedAccount<'info>,
    #[account(mut, address = daily.vault @ CrossyError::WrongVault)]
    pub vault: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(
        mut,
        seeds = [seeds::CONTRIBUTION, &daily.day.to_le_bytes(), contribution.wallet.as_ref()],
        bump = contribution.bump,
    )]
    pub contribution: Box<Account<'info, DailyContribution>>,
    /// Fixed recipient: the contribution wallet's canonical USDC account.
    #[account(
        mut,
        constraint = wallet_token.owner == contribution.wallet @ CrossyError::WrongTokenOwner,
        constraint = wallet_token.mint == config.usdc_mint @ CrossyError::WrongMint
    )]
    pub wallet_token: Box<InterfaceAccount<'info, TokenAccount>>,
    #[account(address = config.usdc_mint @ CrossyError::WrongMint)]
    pub usdc_mint: Box<InterfaceAccount<'info, Mint>>,
    /// CHECK: configured token program.
    #[account(address = config.token_program @ CrossyError::WrongTokenProgram)]
    pub token_program: UncheckedAccount<'info>,
}

/// One-shot (idempotent after full claim) refund of a wallet's consumed
/// contributions on a voided day. Permissionlessly sponsorable; recipient is
/// fixed by the contribution account.
pub fn claim_void_refund(ctx: Context<ClaimVoidRefund>) -> Result<()> {
    let daily = &mut ctx.accounts.daily;
    let contribution = &mut ctx.accounts.contribution;

    let consumed = contribution
        .entry_total
        .checked_add(contribution.revival_total)
        .ok_or(CrossyError::Overflow)?;
    let claimable = consumed
        .checked_sub(contribution.refunded_total)
        .ok_or(CrossyError::Overflow)?;
    require!(claimable > 0, CrossyError::AlreadyTerminal);

    let day_bytes = daily.day.to_le_bytes();
    let signer_seeds: &[&[&[u8]]] = &[&[
        seeds::DAILY_VAULT,
        &day_bytes,
        &[daily.vault_authority_bump],
    ]];
    token_interface::transfer_checked(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.key(),
            TransferChecked {
                from: ctx.accounts.vault.to_account_info(),
                mint: ctx.accounts.usdc_mint.to_account_info(),
                to: ctx.accounts.wallet_token.to_account_info(),
                authority: ctx.accounts.vault_authority.to_account_info(),
            },
            signer_seeds,
        ),
        claimable,
        USDC_DECIMALS,
    )?;

    contribution.refunded_total = consumed;
    daily.refund_liability = daily
        .refund_liability
        .checked_sub(claimable)
        .ok_or(CrossyError::Overflow)?;
    daily.total_refunded = daily
        .total_refunded
        .checked_add(claimable)
        .ok_or(CrossyError::Overflow)?;

    emit!(VoidRefundClaimed {
        day: daily.day,
        wallet: contribution.wallet,
        amount: claimable,
    });
    Ok(())
}
