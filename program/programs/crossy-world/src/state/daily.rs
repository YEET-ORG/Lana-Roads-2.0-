//! Daily competition, vault accounting, contributions, and payment receipts.
//!
//! Vault conservation invariant (contract spec §7.1):
//! `vault balance = pending + active_pool + rollover_held + refund_liability
//!                 + winner_unpaid + team_unpaid`

use anchor_lang::prelude::*;

use crate::errors::CrossyError;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
#[repr(u8)]
pub enum DayStatus {
    Prepared,
    Open,
    Closed,
    Committed,
    Settled,
    Voided,
}

/// PDA: ["daily", utc_day_le]
#[account]
#[derive(InitSpace)]
pub struct DailyCompetition {
    pub day: u64,
    pub status: DayStatus,
    /// Paid world PDA (delegated gameplay root).
    pub paid_world: Pubkey,
    /// Casual world PDA.
    pub casual_world: Pubkey,
    /// Canonical day vault token account (owned by the vault authority PDA).
    pub vault: Pubkey,
    pub vault_authority_bump: u8,

    // ---- liability counters (USDC base units) ----
    /// Rollover received from the previous day (part of active pool).
    pub rollover_in: u64,
    /// Rollover paid forward after a no-winner day.
    pub rollover_out: u64,
    /// Payments received but not yet reconciled to an ER outcome.
    pub pending_total: u64,
    /// Consumed entries/revivals forming the day's prize pool
    /// (includes rollover_in once opened).
    pub active_pool: u64,
    /// Refundable receipts + void-day contributions awaiting claims.
    pub refund_liability: u64,
    /// Fixed winner obligation after finalize (unpaid leg).
    pub winner_unpaid: u64,
    /// Fixed team obligation after finalize (unpaid leg).
    pub team_unpaid: u64,

    // ---- audit totals ----
    pub total_deposited: u64,
    pub total_refunded: u64,
    pub total_settled: u64,

    // ---- settlement record ----
    pub settled_winner: Pubkey,
    pub settled_score: u16,
    pub winner_amount: u64,
    pub team_amount: u64,
    pub winner_paid: bool,
    pub team_paid: bool,
    /// Set once the rollover was consumed into a successor day.
    pub rollover_consumed: bool,

    /// Slot at which the final world record commit was observed on base.
    pub final_commit_slot: u64,
    pub bump: u8,
}

impl DailyCompetition {
    /// Sum of all liability categories — must equal the vault token balance
    /// at every economic transition. Rollover-out counts as a held liability
    /// until the successor day consumes it.
    pub fn total_liabilities(&self) -> Result<u64> {
        let rollover_held = if self.rollover_consumed {
            0
        } else {
            self.rollover_out
        };
        self.pending_total
            .checked_add(self.active_pool)
            .and_then(|v| v.checked_add(self.refund_liability))
            .and_then(|v| v.checked_add(self.winner_unpaid))
            .and_then(|v| v.checked_add(self.team_unpaid))
            .and_then(|v| v.checked_add(rollover_held))
            .ok_or_else(|| error!(CrossyError::Overflow))
    }

    /// Enforce the conservation invariant against the actual vault balance.
    /// Any unexplained difference blocks the transition.
    pub fn assert_conservation(&self, vault_balance: u64) -> Result<()> {
        require!(
            vault_balance == self.total_liabilities()?,
            CrossyError::LiabilityMismatch
        );
        Ok(())
    }
}

/// PDA: ["contribution", utc_day_le, wallet]
/// Makes void refunds independent and idempotent per wallet without an
/// unbounded payer list in `DailyCompetition`.
#[account]
#[derive(InitSpace)]
pub struct DailyContribution {
    pub day: u64,
    pub wallet: Pubkey,
    /// Consumed (activated) entry payments.
    pub entry_total: u64,
    /// Consumed (activated) revival payments.
    pub revival_total: u64,
    /// Already refunded on a voided day.
    pub refunded_total: u64,
    pub bump: u8,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
#[repr(u8)]
pub enum ReceiptKind {
    Entry,
    Revival,
}

/// Receipt terminal-state machine:
/// `Pending -> Consumed` XOR `Pending -> Refundable -> Refunded`.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug, InitSpace)]
#[repr(u8)]
pub enum ReceiptState {
    Pending,
    Consumed,
    Refundable,
    Refunded,
}

/// PDA: ["payment", kind, day_le, wallet, receipt_nonce_le]
#[account]
#[derive(InitSpace)]
pub struct PaymentReceipt {
    pub kind: ReceiptKind,
    pub state: ReceiptState,
    pub day: u64,
    pub wallet: Pubkey,
    /// The PlayerRun this payment is bound to.
    pub run: Pubkey,
    pub attempt_nonce: u32,
    /// Revival only: the exact death this payment revives.
    pub death_nonce: u32,
    /// Revival only: successful revive count at purchase (prices the leg).
    pub revive_index: u16,
    /// Exact USDC amount moved into the vault.
    pub amount: u64,
    pub created_ts: i64,
    /// Wallet-scoped receipt nonce (from PlayerProfile counter or run state).
    pub receipt_nonce: u32,
    pub bump: u8,
}
