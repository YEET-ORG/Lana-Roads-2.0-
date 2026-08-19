//! Crossy World — contract-first realtime grid competition on Solana +
//! MagicBlock Ephemeral Rollups.
//!
//! One Anchor program with two planes:
//! - Base layer: USDC custody, receipts, refunds, settlement, seasons,
//!   gacha, NFTs, marketplace, profiles, day lifecycle.
//! - Delegated ER accounts: worlds, sectors, runs, chunks — movement,
//!   occupancy, hazards, Kick, abilities, live records.
//!
//! Specifications: docs/superpowers/specs/. Non-negotiable invariants are
//! listed in AGENTS.md; every economic transition emits an event.

use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::ephemeral;

pub mod constants;
pub mod cross_plane;
pub mod errors;
pub mod events;
pub mod external;
pub mod instructions;
pub mod kernel;
pub mod state;

use instructions::*;

declare_id!("5FBMHsiUcRZ5RiKYWd6XhRGkA3FifP4nji9RKijLYuLx");

#[ephemeral]
#[program]
pub mod crossy_world {
    use super::*;

    // ---- admin / config -------------------------------------------------
    pub fn initialize_config(
        ctx: Context<InitializeConfig>,
        max_paid_players: u16,
        max_casual_players: u16,
    ) -> Result<()> {
        instructions::admin::initialize_config(ctx, max_paid_players, max_casual_players)
    }

    pub fn propose_admin(ctx: Context<AdminOnly>, new_admin: Pubkey) -> Result<()> {
        instructions::admin::propose_admin(ctx, new_admin)
    }

    pub fn cancel_admin_proposal(ctx: Context<AdminOnly>) -> Result<()> {
        instructions::admin::cancel_admin_proposal(ctx)
    }

    pub fn accept_admin(ctx: Context<AcceptAdmin>) -> Result<()> {
        instructions::admin::accept_admin(ctx)
    }

    pub fn set_validator(
        ctx: Context<AdminOnly>,
        region: u8,
        new_validator: Pubkey,
    ) -> Result<()> {
        instructions::admin::set_validator(ctx, region, new_validator)
    }

    pub fn set_pause(ctx: Context<AdminOnly>, scope: u16, paused: bool) -> Result<()> {
        instructions::admin::set_pause(ctx, scope, paused)
    }

    pub fn create_season(
        ctx: Context<CreateSeason>,
        season_index: u16,
        start_day: u64,
        weights_hash: [u8; 32],
        class_balance_version: u16,
        metadata_version: u16,
    ) -> Result<()> {
        instructions::admin::create_season(
            ctx,
            season_index,
            start_day,
            weights_hash,
            class_balance_version,
            metadata_version,
        )
    }

    pub fn create_banner(
        ctx: Context<CreateBanner>,
        season_index: u16,
        tier: u8,
        base_weights: [u16; 4],
    ) -> Result<()> {
        instructions::admin::create_banner(ctx, season_index, tier, base_weights)
    }

    pub fn activate_season(ctx: Context<ActivateSeason>, season_index: u16) -> Result<()> {
        instructions::admin::activate_season(ctx, season_index)
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
        instructions::admin::create_variant(
            ctx,
            season_index,
            variant_id,
            rarity,
            model_id,
            cosmetic_id,
            metadata_uri_hash,
            supply_cap,
        )
    }

    #[allow(clippy::too_many_arguments)]
    pub fn create_class_config(
        ctx: Context<CreateClassConfig>,
        class_id: u16,
        version: u16,
        ability: state::AbilityKind,
        cooldown_seconds: u16,
        range: u8,
        duration_seconds: u16,
        displacement: u8,
        param_a: u16,
        param_b: u16,
        min_rarity: u8,
        activation_day: u64,
    ) -> Result<()> {
        instructions::admin::create_class_config(
            ctx,
            class_id,
            version,
            ability,
            cooldown_seconds,
            range,
            duration_seconds,
            displacement,
            param_a,
            param_b,
            min_rarity,
            activation_day,
        )
    }

    // ---- profile --------------------------------------------------------
    pub fn ensure_profile(ctx: Context<EnsureProfile>) -> Result<()> {
        instructions::profile::ensure_profile(ctx)
    }

    pub fn set_identity(ctx: Context<SetIdentity>, name: String, agent: u16) -> Result<()> {
        instructions::profile::set_identity(ctx, name, agent)
    }

    pub fn claim_starter(ctx: Context<ClaimStarter>) -> Result<()> {
        instructions::profile::claim_starter(ctx)
    }

    // ---- day lifecycle --------------------------------------------------
    pub fn prepare_day(ctx: Context<PrepareDay>, region: u8, day: u64) -> Result<()> {
        instructions::day::prepare_day(ctx, region, day)
    }

    pub fn consume_rollover(ctx: Context<ConsumeRollover>) -> Result<()> {
        instructions::day::consume_rollover(ctx)
    }

    pub fn open_day(ctx: Context<OpenDay>) -> Result<()> {
        instructions::day::open_day(ctx)
    }

    pub fn close_day(ctx: Context<CloseDay>) -> Result<()> {
        instructions::day::close_day(ctx)
    }

    pub fn close_world_base(ctx: Context<CloseWorldBase>) -> Result<()> {
        instructions::day::close_world_base(ctx)
    }

    pub fn record_final_commit(ctx: Context<RecordFinalCommit>) -> Result<()> {
        instructions::day::record_final_commit(ctx)
    }

    pub fn finalize_day(ctx: Context<FinalizeDay>) -> Result<()> {
        instructions::day::finalize_day(ctx)
    }

    pub fn void_day(ctx: Context<VoidDay>) -> Result<()> {
        instructions::day::void_day(ctx)
    }

    // ---- payments -------------------------------------------------------
    pub fn begin_paid_attempt(ctx: Context<BeginPaidAttempt>) -> Result<()> {
        instructions::payments::begin_paid_attempt(ctx)
    }

    pub fn begin_revive(ctx: Context<BeginRevive>) -> Result<()> {
        instructions::payments::begin_revive(ctx)
    }

    pub fn reconcile_receipt(ctx: Context<ReconcileReceipt>) -> Result<()> {
        instructions::payments::reconcile_receipt(ctx)
    }

    pub fn refund_receipt(ctx: Context<RefundReceipt>) -> Result<()> {
        instructions::payments::refund_receipt(ctx)
    }

    pub fn claim_void_refund(ctx: Context<ClaimVoidRefund>) -> Result<()> {
        instructions::payments::claim_void_refund(ctx)
    }

    // ---- agent NFTs -----------------------------------------------------
    pub fn lock_agent(ctx: Context<LockAgent>, attempt_nonce: u32) -> Result<()> {
        instructions::agent::lock_agent(ctx, attempt_nonce)
    }

    pub fn lock_starter(ctx: Context<LockStarter>, attempt_nonce: u32) -> Result<()> {
        instructions::agent::lock_starter(ctx, attempt_nonce)
    }

    pub fn unlock_agent(ctx: Context<UnlockAgent>) -> Result<()> {
        instructions::agent::unlock_agent(ctx)
    }

    // ---- gameplay (ER) --------------------------------------------------
    pub fn init_run(
        ctx: Context<InitRun>,
        session_authority: Pubkey,
        session_expiry: i64,
    ) -> Result<()> {
        instructions::gameplay::init_run(ctx, session_authority, session_expiry)
    }

    pub fn rotate_session(
        ctx: Context<RotateSession>,
        new_authority: Pubkey,
        new_expiry: i64,
    ) -> Result<()> {
        instructions::gameplay::rotate_session(ctx, new_authority, new_expiry)
    }

    pub fn end_session(ctx: Context<RotateSession>) -> Result<()> {
        instructions::gameplay::end_session(ctx)
    }

    pub fn spawn<'info>(ctx: Context<'info, Spawn<'info>>, attempt_nonce: u32) -> Result<()> {
        instructions::gameplay::spawn(ctx, attempt_nonce)
    }

    pub fn move_action(
        ctx: Context<MoveAction>,
        attempt_nonce: u32,
        action_seq: u64,
        direction: u8,
        uniq: u64,
    ) -> Result<()> {
        instructions::gameplay::move_action(ctx, attempt_nonce, action_seq, direction, uniq)
    }

    pub fn move_free(
        ctx: Context<MoveAction>,
        attempt_nonce: u32,
        direction: u8,
        uniq: u64,
    ) -> Result<()> {
        instructions::gameplay::move_free(ctx, attempt_nonce, direction, uniq)
    }

    pub fn move_batch(
        ctx: Context<MoveBatch>,
        attempt_nonce: u32,
        action_seq: u64,
        directions: Vec<u8>,
        uniq: u64,
    ) -> Result<()> {
        instructions::gameplay::move_batch(ctx, attempt_nonce, action_seq, directions, uniq)
    }

    pub fn claim_record(ctx: Context<ClaimRecord>) -> Result<()> {
        instructions::gameplay::claim_record(ctx)
    }

    pub fn complete_revive(ctx: Context<CompleteRevive>) -> Result<()> {
        instructions::gameplay::complete_revive(ctx)
    }

    pub fn expire_revival(ctx: Context<ExpireRevival>) -> Result<()> {
        instructions::gameplay::expire_revival(ctx)
    }

    pub fn end_attempt(ctx: Context<EndAttempt>) -> Result<()> {
        instructions::gameplay::end_attempt(ctx)
    }

    // ---- combat (ER) ----------------------------------------------------
    pub fn kick(ctx: Context<Kick>, attempt_nonce: u32, action_seq: u64, uniq: u64) -> Result<()> {
        instructions::combat::kick(ctx, attempt_nonce, action_seq, uniq)
    }

    pub fn use_ability(
        ctx: Context<UseAbility>,
        attempt_nonce: u32,
        action_seq: u64,
        args: AbilityArgs,
        uniq: u64,
    ) -> Result<()> {
        instructions::combat::use_ability(ctx, attempt_nonce, action_seq, args, uniq)
    }

    // ---- hazards (ER) ---------------------------------------------------
    pub fn check_hazard(ctx: Context<CheckHazard>, hazard_nonce: u32) -> Result<()> {
        instructions::hazards::check_hazard(ctx, hazard_nonce)
    }

    // ---- chunks (ER) ----------------------------------------------------
    pub fn request_chunk(
        ctx: Context<RequestChunk>,
        region: u8,
        day: u64,
        chunk_index: u32,
    ) -> Result<()> {
        instructions::chunks::request_chunk(ctx, region, day, chunk_index)
    }

    pub fn publish_chunk(
        ctx: Context<PublishChunk>,
        randomness: [u8; 32],
        region: u8,
        day: u64,
        chunk_index: u32,
        generation: u16,
    ) -> Result<()> {
        instructions::chunks::publish_chunk(ctx, randomness, region, day, chunk_index, generation)
    }

    pub fn extend_frontier(ctx: Context<ExtendFrontier>) -> Result<()> {
        instructions::chunks::extend_frontier(ctx)
    }

    pub fn mark_chunk_ready<'info>(
        ctx: Context<'info, MarkChunkReady<'info>>,
        chunk_index: u32,
    ) -> Result<()> {
        instructions::chunks::mark_chunk_ready(ctx, chunk_index)
    }

    pub fn init_sector(ctx: Context<InitSector>, sector_x: u8, sector_y: u32) -> Result<()> {
        instructions::chunks::init_sector(ctx, sector_x, sector_y)
    }

    // ---- gacha ----------------------------------------------------------
    pub fn request_pull<'info>(ctx: Context<'info, RequestPull<'info>>) -> Result<()> {
        instructions::gacha::request_pull(ctx)
    }

    pub fn consume_pull_randomness(
        ctx: Context<ConsumePullRandomness>,
        randomness: [u8; 32],
        generation: u16,
    ) -> Result<()> {
        instructions::gacha::consume_pull_randomness(ctx, randomness, generation)
    }

    pub fn assign_pull(ctx: Context<AssignPull>) -> Result<()> {
        instructions::gacha::assign_pull(ctx)
    }

    pub fn claim_pull(ctx: Context<ClaimPull>, uri: String) -> Result<()> {
        instructions::gacha::claim_pull(ctx, uri)
    }

    pub fn refund_pull(ctx: Context<RefundPull>) -> Result<()> {
        instructions::gacha::refund_pull(ctx)
    }

    // ---- marketplace ----------------------------------------------------
    pub fn list_agent(ctx: Context<ListAgent>, price: u64, expiry_ts: i64) -> Result<()> {
        instructions::marketplace::list_agent(ctx, price, expiry_ts)
    }

    pub fn delist_agent(ctx: Context<DelistAgent>) -> Result<()> {
        instructions::marketplace::delist_agent(ctx)
    }

    pub fn buy_listing(ctx: Context<BuyListing>) -> Result<()> {
        instructions::marketplace::buy_listing(ctx)
    }

    // ---- delegation / commits -------------------------------------------
    pub fn delegate_world(
        ctx: Context<DelegateWorld>,
        region: u8,
        mode: u8,
        day: u64,
    ) -> Result<()> {
        instructions::delegation::delegate_world(ctx, region, mode, day)
    }

    pub fn delegate_sector(
        ctx: Context<DelegateSector>,
        world: Pubkey,
        sector_x: u8,
        sector_y: u32,
    ) -> Result<()> {
        instructions::delegation::delegate_sector(ctx, world, sector_x, sector_y)
    }

    pub fn delegate_run(ctx: Context<DelegateRun>, world: Pubkey, wallet: Pubkey) -> Result<()> {
        instructions::delegation::delegate_run(ctx, world, wallet)
    }

    pub fn delegate_best(ctx: Context<DelegateBest>, world: Pubkey, wallet: Pubkey) -> Result<()> {
        instructions::delegation::delegate_best(ctx, world, wallet)
    }

    pub fn delegate_chunk(
        ctx: Context<DelegateChunk>,
        region: u8,
        day: u64,
        chunk_index: u32,
    ) -> Result<()> {
        instructions::delegation::delegate_chunk(ctx, region, day, chunk_index)
    }

    pub fn commit_state<'info>(ctx: Context<'info, CommitAccounts<'info>>) -> Result<()> {
        instructions::delegation::commit_state(ctx)
    }

    pub fn close_world(ctx: Context<CloseWorld>) -> Result<()> {
        instructions::delegation::close_world(ctx)
    }

    pub fn undelegate_state<'info>(ctx: Context<'info, UndelegateAccounts<'info>>) -> Result<()> {
        instructions::delegation::undelegate_state(ctx)
    }
}
