# Crossy World: Contract and Economy Specification

**Status:** Draft for user review  
**Parent:** [Crossy World product and protocol design](./2026-08-13-crossy-world-design.md)  
**Date:** 2026-08-13

## 1. Purpose

This document specifies the durable Solana program surface: configuration, UTC competitions, USDC custody, entry and revival receipts, refunds, rollover, settlement, player profiles, agent NFTs, gacha, capped inventory, pity, and marketplace trades.

Realtime movement and hazards are defined in the MagicBlock integration specification. Frontend transaction presentation is defined in the frontend specification.

## 2. Program boundaries

One Anchor program, `crossy_world`, owns application state. It CPIs into:

- SPL Token for canonical USDC transfers.
- Associated Token Account where canonical ATAs are required.
- Metaplex Core for agent creation, transfer, freeze, and thaw.
- MagicBlock delegation, commit, scheduling, and VRF programs.

The program never accepts an arbitrary payment mint, treasury, collection, or payout recipient. Every external program and asset identity is checked against `GlobalConfig` or a derivation fixed by program state.

## 3. Numeric conventions

- All USDC values are unsigned integer base units using the mint’s verified decimals.
- No floating-point arithmetic exists in program logic.
- Basis points use denominator 10,000.
- UTC day is `floor(unix_timestamp / 86_400)` for nonnegative production timestamps.
- Timestamps are signed `i64`; deadlines use checked addition.
- Identifiers and counters use checked increments.
- Revival cost uses checked exponentiation/multiplication and rejects overflow before token transfer.
- Scores and rows use bounded unsigned integers selected during account-layout implementation.

## 4. Account relationships

```text
GlobalConfig
├── Season
│   ├── Banner x3
│   ├── ClassConfig versions
│   └── VariantInventory[]
├── PlayerProfile(wallet)
│   └── GachaPull(wallet, nonce)[]
├── DailyCompetition(day)
│   ├── DailyVault ATA
│   ├── DailyContribution(day, wallet)[]
│   └── PaymentReceipt(day, wallet, nonce)[]
├── AgentLock(world, wallet, attempt)
└── MarketplaceListing(asset)
```

All PDA seeds include explicit domain prefixes. Variable strings are never used directly as unbounded seeds; identifiers are fixed-width values or validated hashes.

## 5. Global configuration

### 5.1 Initialization

`initialize_config` creates exactly one `GlobalConfig` and validates:

- Admin signer.
- Canonical USDC mint owner and decimals.
- Supported token program.
- Team treasury token account mint and authority.
- Metaplex collection and update authority configuration.
- Winner/team basis points sum to 10,000.
- Paid and casual caps are nonzero and at most compiled safety maxima.

### 5.2 Admin rotation

Use two-step rotation:

1. Current admin calls `propose_admin(new_admin)`.
2. Proposed key calls `accept_admin()`.

Rotation emits both addresses. A proposal may be canceled by current admin before acceptance. V1 uses a single admin key; the two-step interface permits later transfer to a multisig without a program migration.

### 5.3 Pause controls

Independent flags:

- Protocol
- Paid admission
- Paid gameplay
- Casual admission/gameplay
- Gacha
- Marketplace

Pause never blocks:

- Valid refund claims
- Terminal NFT unlock
- Completion/retry of already-fixed payouts
- Read-only operations

## 6. Daily competition lifecycle

### 6.1 States

```text
Uninitialized -> Prepared -> Open -> Closed -> Committed -> Settled
                                  \-> Voided -> Refunding
```

Allowed transitions are one-way. `Voided` and `Settled` are mutually exclusive.

### 6.2 Preparation

`prepare_day(day, validator)` is admin-only and may execute only before or during that day while no duplicate exists. Production automation prepares tomorrow before midnight.

It creates:

- `DailyCompetition`
- Daily USDC vault authority/PDA and canonical vault ATA
- Paid and casual world identities
- Initial delegated gameplay accounts through the integration flow

It records exact start/end timestamps derived from `day` and the intended validator. The account becomes `Prepared`; a later readiness reconciliation marks it `Open` only after router/ER conditions and initial chunk readiness are proven.

### 6.3 Hard cutoff

Every day-scoped instruction checks `Clock` directly. Cached frontend state cannot extend a day. At `end_ts`:

- Admissions and revival payments are rejected.
- Gameplay instructions reject independently on the ER.
- Existing runs become terminal for unlock after committed closure.
- Settlement remains blocked until final record commitment is reconciled.

### 6.4 No-winner rollover

Valid winner requires `record_score >= 1`. Otherwise:

- Team amount is zero.
- Winner amount is zero.
- Entire active pool is recorded as `rollover_out`.
- Admin prepares/reconciles next day with exact `rollover_in`.
- A rollover PDA/accounting field prevents one amount from being attached to multiple days.

## 7. Daily vault accounting

### 7.1 Liability equation

For each daily vault:

```text
vault token balance
= pending payments
 + active prize pool
 + rollover held
 + refund liability
 + unpaid winner amount
 + unpaid team amount
```

Transitions move value between categories; they do not create or destroy accounting value except an actual token transfer into or out of the vault.

### 7.2 Required counters

`DailyCompetition` stores:

- `rollover_in`
- `pending_total`
- `active_pool`
- `refund_liability`
- `winner_unpaid`
- `team_unpaid`
- `total_deposited`
- `total_refunded`
- `total_settled`

An invariant helper verifies the counters with checked arithmetic at every economic transition.

### 7.3 Contributions

`DailyContribution(day, wallet)` stores consumed entry and revival payments. Pending receipts are not added until activation succeeds. On void, claimable refund equals consumed contribution minus already-refunded amount.

This design avoids storing an unbounded payer list in `DailyCompetition`.

## 8. Payment receipt protocol

### 8.1 Receipt states

```text
Pending -> Consumed
Pending -> Refundable -> Refunded
```

No other transitions are legal.

### 8.2 Entry receipt

`begin_paid_attempt`:

- Requires wallet signer.
- Requires day Prepared/Open and before cutoff.
- Validates no active or revive-pending run for wallet.
- Validates exactly 1 USDC.
- Transfers USDC to daily vault.
- Increments `pending_total` and `total_deposited`.
- Creates receipt bound to day, wallet, run, attempt nonce, and selected agent.
- Begins agent lock and run preparation.

After ER spawn is committed, `reconcile_entry` is permissionless:

- Success: subtract pending, add active pool, add wallet contribution, mark Consumed.
- Failure: subtract pending, add refund liability, mark Refundable.

`refund_receipt` transfers only a Refundable receipt to its wallet’s canonical USDC account and marks Refunded.

### 8.3 Revival receipt

`begin_revive` additionally validates:

- Run belongs to wallet and day.
- Committed run state is `DeadAwaitingRevive`.
- Attempt and death nonces match.
- Current base `Clock` is before revival deadline.
- Amount equals checked next revival price.

Reconciliation mirrors entry. A stale or late ER result cannot consume a receipt for another death nonce.

### 8.4 Token transfer rules

- Use transfer-checked CPI.
- Source token account authority must be wallet signer.
- Source and vault mint must equal configured USDC mint.
- Token program must equal configured program.
- No delegate allowance is granted to a gameplay session.
- Client-supplied amount is compared to program-derived amount before CPI.

## 9. Settlement

### 9.1 Preconditions

`finalize_day` is admin-only and requires:

- Day after cutoff.
- Daily state Committed.
- Final world record commitment reconciled.
- Not Voided or already Settled.
- No unresolved accounting inconsistency.

### 9.2 Split

For valid winner:

```text
team = floor(active_pool * 1000 / 10000)
winner = active_pool - team
```

This assigns any indivisible base unit to the winner and allocates the full pool.

### 9.3 Retryable legs

Winner and team transfers have separate completion flags and stored amounts. If one transfer succeeds and the second fails, retry executes only the incomplete leg. Recipient accounts are revalidated on each retry but cannot be substituted.

The winner destination is the canonical ATA for the recorded winner and configured USDC mint. The team destination is `GlobalConfig.team_treasury`.

### 9.4 Admin limitation

Admin supplies accounts needed to execute but supplies no winner, score, split, or arbitrary amount argument. Program-derived values are authoritative.

## 10. Void and refund

`void_day` is admin-only before settlement and irreversible.

Effects:

- Stops admission and gameplay.
- Converts active pool into refund liability based on contribution accounts.
- Keeps pending receipts independently refundable through their receipt state.
- Sets winner/team amounts to zero.
- Prohibits rollover and settlement.

`claim_void_refund`:

- Is wallet-authorized or permissionlessly sponsored with fixed wallet recipient.
- Reads wallet contribution.
- Computes unclaimed amount.
- Transfers exact amount.
- Updates contribution and daily counters atomically.
- Is idempotent after full claim.

Unclaimed refund funds remain liabilities; V1 has no admin sweep.

## 11. Player profile

`PlayerProfile` is created idempotently and tracks durable progression only:

- Starter claim status
- Pity counters by banner tier
- Paid wins
- Current season wins
- Highest paid/casual record
- Completed attempts
- Successful revival count

High-frequency position and cooldown data never lives here.

Profile statistics update from committed, program-verifiable outcomes. Admin and client cannot submit arbitrary stats.

## 12. Agent NFT specification

### 12.1 Standard

Use Metaplex Core assets in one collection. Program-owned `VariantInventory` and `ClassConfig` determine gameplay. Off-chain metadata is display-only.

### 12.2 Metadata fields

- Display name
- Description
- Rendered image and optional animation
- Season
- Rarity
- Animal/model identifier
- Cosmetic variant identifier
- Gameplay class identifier/version reference
- Creator royalty declaration: 10%

Raw Unity source files are never exposed.

### 12.3 Starter

Starter is a non-transferable profile entitlement, not a minted collectible. `claim_starter` may execute once per wallet. Paid entry passes a starter marker instead of an asset address.

### 12.4 Attempt lock

NFT entry validates:

- Asset belongs to configured collection.
- Current owner equals wallet.
- Asset’s program mapping resolves to active VariantInventory/ClassConfig.
- Asset is not already frozen for another attempt or listed.

The flow approves the game PDA as Freeze Delegate and freezes the asset. `AgentLock` binds owner, asset, world, and attempt nonce.

### 12.5 Terminal thaw

`unlock_agent` is permissionless with fixed owner/asset and requires:

- Committed run terminal marker, or
- Committed day closure proving the attempt cannot continue.

It thaws the asset, marks AgentLock complete, and closes disposable lock state when safe. Repeated calls are harmless.

## 13. Seasons, classes, and variants

### 13.1 Season immutability

After `start_ts`, these fields cannot change:

- Banner base prices and rarity weights
- Variant supply caps
- Variant rarity and class mapping
- Pity thresholds
- Season boundaries

Admin may pause a banner but cannot alter odds mid-season.

### 13.2 Class balance

Gameplay parameters may require balance patches. A new `ClassConfig` version:

- Is created in advance.
- Has an activation UTC day.
- Applies equally to all NFTs in that class.
- Cannot activate inside an ongoing daily competition.
- Is snapshotted by each WorldHeader at preparation.

Rarity never modifies class parameters.

### 13.3 Inventory counters

For every variant:

```text
reserved + minted <= supply_cap
```

Assignment increments reserved. Successful mint decrements reserved and increments minted atomically. Refund before assignment changes neither. A post-assignment claim cannot be refunded merely because the player dislikes the result.

## 14. Banner and pity behavior

### 14.1 Counters

Each of Standard, Enhanced, and Premium stores:

- Pulls since Epic-or-better
- Pulls since Legendary

Interpretation:

- If Epic miss count is 9, next assigned result is at least Epic.
- If Legendary miss count is 99, next assigned result is Legendary.
- A Legendary result satisfies both guarantees.

### 14.2 Update rules

- Common/Rare: increment both counters.
- Epic: reset Epic, increment Legendary.
- Legendary: reset both.
- Refunded or unassigned: no update.

Counters are updated atomically with inventory reservation.

### 14.3 Effective odds

Before payment, the client reads a program-computable inventory revision. Sold-out variants are absent. If a rarity has zero eligible variants, its base weight is redistributed proportionally among nonempty rarities using a deterministic largest-remainder method documented in the client and tested against the program implementation.

The pull snapshots revision and effective weights. If concurrent assignments invalidate its required selection before callback execution, it becomes refundable. The callback never silently changes to newer odds.

## 15. Gacha state machine

```text
PendingPayment/Requested
  -> Assigned -> Claimed
  -> Refundable -> Refunded
```

### 15.1 Request

- Wallet signs exact banner USDC transfer.
- Pull snapshots pity counters, odds, inventory revision, and request generation.
- VRF request is bound to pull PDA and callback discriminator.
- Team revenue remains pending until assignment.

### 15.2 Callback

- Authenticated scoped VRF identity required.
- Pull must be pending and current generation.
- Apply Legendary pity, then Epic pity, then weighted rarity selection.
- Select eligible variant without modulo bias.
- Reserve inventory and update pity atomically.
- Move payment from pending to earned team accounting.
- Store assignment; do not mint in callback.

### 15.3 Claim

- Mints exact assigned Core asset to player.
- Records asset address.
- Converts reserved inventory to minted.
- Is retryable and idempotent.

### 15.4 Timeout

After five minutes without assignment, player may mark/refund. This increments request generation or terminally invalidates it. Late callback fails. Refund returns exact price and does not change pity.

## 16. Marketplace specification

### 16.1 Listing

- Seller owns collection asset.
- Asset is thawed and has no active AgentLock.
- Price is nonzero USDC base units.
- Listing state prevents duplicate listings.
- Listing uses a Metaplex authority pattern that prevents transfer during an active listing or verifies ownership atomically at purchase.

### 16.2 Purchase

- Buyer signs.
- Buyer cannot equal seller.
- Validate listing active and asset ownership unchanged.
- Transfer-checked USDC: 10% team, residual 90% seller.
- Transfer Core asset to buyer in same transaction.
- Mark listing sold.

### 16.3 Delist

Seller may delist before sale. Delist restores unrestricted transfer. Active attempt lock and listing are mutually exclusive.

## 17. Events

Program emits structured events for rebuildable indexing:

- Config initialized/updated/admin rotated
- Season/banner/variant/class configured
- Day prepared/opened/closed/committed/voided/settled
- Payment pending/consumed/refundable/refunded
- Attempt activated/ended
- Revival paid/consumed/refunded
- Record changed
- Rollover created/consumed
- Pull requested/assigned/claimed/refunded
- Agent locked/unlocked/transferred/listed/sold
- Payout leg completed

Events include stable object IDs and nonces, never secrets.

## 18. Error taxonomy

Errors are grouped for client handling:

- Authorization: wrong admin, wallet, session, or callback
- Time: not started, cutoff passed, revival expired, timeout not reached
- Asset: wrong mint, collection, owner, class, lock, listing
- Payment: wrong amount, token program, vault, receipt state
- Accounting: invariant violation, overflow, liability mismatch
- Inventory: sold out, stale revision, pity unavailable
- Lifecycle: invalid state transition, already consumed/refunded/settled
- Integration: delegation/commit/callback state unavailable

The SDK maps numeric errors to user-safe messages while preserving raw logs for diagnostics.

## 19. Contract acceptance criteria

- Every USDC unit is assigned to exactly one accounting category.
- Receipt consume and refund are mutually exclusive.
- Admin cannot choose payout winner, destination, split, or amount.
- No settlement occurs before final record commitment.
- Equal score never replaces the incumbent.
- No agent remains ununlockable after a committed terminal attempt/day.
- Pity and capped supply hold under concurrent callbacks.
- Gacha timeout cannot race into both refund and assignment.
- Marketplace cannot sell a locked or nonowned asset.
- Every instruction validates external program IDs, owners, PDAs, mints, and signers.
