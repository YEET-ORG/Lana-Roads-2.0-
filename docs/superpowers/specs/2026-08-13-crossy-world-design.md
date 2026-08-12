# Crossy World: Contract-First Product and Protocol Design

**Status:** Approved design, pending user review of this written specification  
**Date:** 2026-08-13  
**Target:** Solana + MagicBlock Ephemeral Rollups, React/Vite/Three.js client  
**Working program name:** `crossy_world`

**Companion specifications:**

- [Specification suite and reading order](./2026-08-13-crossy-world-spec-suite.md)
- [Contract and economy](./2026-08-13-crossy-world-contract-economy-spec.md)
- [MagicBlock gameplay and integration](./2026-08-13-crossy-world-magicblock-integration-spec.md)
- [Frontend and Three.js](./2026-08-13-crossy-world-frontend-threejs-spec.md)
- [Client SDK, subscriptions, and indexing](./2026-08-13-crossy-world-sdk-indexing-spec.md)
- [Testing, security, and operations](./2026-08-13-crossy-world-testing-security-operations-spec.md)

## 1. Executive summary

Crossy World is a persistent, shared, multiplayer grid-crossing game inspired by Crossy Road. Up to 500 players occupy one synchronized 64-column world, move one tile at a time, avoid deterministic roads, rivers, logs, trains, and other hazards, and use player-versus-player abilities. Every player has a universal one-tile Kick with a five-second cooldown. Collectible agent classes add one class ability with a ten-to-thirty-second cooldown.

Two rooms run for every fixed UTC day:

- A paid competition room. A fresh run costs 1 USDC. A dead run may continue for 10 USDC, then 20, 40, 80, and so on, doubling without a game-rule cap. The highest row reached by one continuing run is the authoritative score. The incumbent record changes only when another run strictly exceeds it. At the UTC cutoff, the winner receives 90% of the day’s pool and the team receives 10%, with payout initiated by the V1 admin.
- A free casual room. It uses the same world chunks and supports every agent class without NFT ownership. Death ends the casual run, but the player may immediately begin another free run from the safe zone. Casual has a separate non-prize leaderboard.

The architecture uses one purpose-built Anchor program with two internal planes:

- Durable assets, USDC, NFT ownership, gacha, refunds, seasons, and settlement remain on Solana’s base layer.
- Realtime movement, occupancy, hazards, combat, scores, and live leaderboards execute on delegated MagicBlock accounts.

The existing solsocket codebase supplies useful connection, session, subscription, transaction, codec, delegation, and recovery patterns. Its generic room program is not the game authority because it permits client-authored state and does not enforce the economic or spatial rules required by a paid competition.

## 2. Product decisions

### 2.1 Daily competition

- One paid room per UTC day, from `00:00:00 UTC` until the next `00:00:00 UTC`.
- The authoritative day identifier is `floor(Clock.unix_timestamp / 86_400)`.
- The on-chain clock, not a browser clock, determines opening, revival deadlines, and cutoff.
- The cutoff is hard. No movement, Kick, ability, entry, or revival may execute after it.
- A run’s score is its furthest forward row. Sideways movement, backward movement, and revisiting rows do not increase score.
- Scores from different attempts are never added together.
- A new room record requires `candidate_score > record_score`. An equal score leaves the incumbent unchanged.
- If nobody reaches row 1, no winner or team fee is paid. The entire pool rolls into the next day.
- The V1 admin is the only settlement caller. The program fixes the winner, recipient, 90/10 split, and amounts; the admin cannot substitute values.

### 2.2 Paid runs and revivals

- Fresh paid attempt: 1 USDC.
- First successful revival: 10 USDC.
- Later successful revivals: `10 USDC * 2^successful_revive_count`.
- Revival has no game-rule count cap. Checked arithmetic rejects a value that cannot be represented safely.
- Only the dead player’s wallet can approve USDC. A session key can never spend USDC.
- Death opens a 60-second revival window.
- The dead player cannot move, Kick, use an ability, or occupy a tile.
- Revival preserves score, cooldowns, agent selection, and attempt identity.
- Revival returns the player to the last verified safe tile, or the nearest valid free tile on that safe row when occupied.
- Missing the revival window permanently ends that attempt. The player may start a new 1 USDC attempt with score zero and select a different agent.

### 2.3 Casual mode

- No entry fee, prize pool, paid revival, NFT ownership requirement, or settlement.
- Every agent class is available for testing.
- Death ends the current casual attempt; there is no continuation revival.
- A new casual attempt can start immediately and resets score.
- Casual uses the same daily chunk definitions as paid mode, with separate occupancy, run, and leaderboard accounts.

### 2.4 Agents and collection economy

- Every wallet may claim a non-transferable starter entitlement.
- The starter has normal movement and universal Kick, with no additional class ability.
- Collectible agents are freely transferable Metaplex Core NFTs.
- A selected NFT is frozen in its owner’s wallet for an entire active attempt, including every revival, and thawed after permanent completion.
- One agent is selected per attempt and cannot be switched mid-attempt.
- Multiple animal models and cosmetic variants may share one gameplay class.
- NFTs in the same class have exactly the same gameplay behavior.
- Rarity controls supply and visual prestige, not per-NFT stat rolls.
- Stronger gameplay classes may be available only through Epic or Legendary variants. The resulting pay-to-win relationship is intentional and must be disclosed.
- Duplicate pulls mint duplicate tradable NFTs. There are no shards or NFT power levels.
- NFTs remain permanently usable after their release season.
- Metadata declares a 10% team royalty. The in-game marketplace enforces it; external marketplaces or direct wallet transfers may bypass it.

### 2.5 Seasons and gacha

- A season lasts 30 UTC days.
- Each cosmetic variant has a fixed seasonal supply cap.
- Three banner tiers cost 5, 10, and 20 USDC.
- Banner base weights are immutable during a season.
- Sold-out variants leave selection. Effective rarity probabilities are recalculated across available inventory and displayed before payment.
- Gacha revenue belongs entirely to the team treasury and never enters competition accounting.
- MagicBlock VRF supplies randomness.
- A pending VRF request is refundable after five minutes if no authenticated result has been assigned.

Initial banner weights:

| Banner   |   Price | Common | Rare | Epic | Legendary |
| -------- | ------: | -----: | ---: | ---: | --------: |
| Standard |  5 USDC |    70% |  22% |   7% |        1% |
| Enhanced | 10 USDC |    45% |  35% |  17% |        3% |
| Premium  | 20 USDC |    20% |  35% |  35% |       10% |

Each wallet has separate pity counters for each banner tier:

- The tenth consecutive pull without Epic-or-better is forced to at least Epic.
- The hundredth consecutive pull without Legendary is forced to Legendary.
- Epic resets the Epic counter for that banner.
- Legendary resets both counters for that banner.
- Failed and refunded pulls do not advance pity.
- Pity progress carries across seasons for the same banner tier.
- If the required pity inventory is unavailable, the banner rejects payment and pauses instead of violating the guarantee.

## 3. Goals and non-goals

### 3.1 Goals

- Contract-authoritative movement, occupancy, score, collisions, cooldowns, and daily winner.
- A realtime shared world for up to 500 concurrent players.
- One-player-per-tile spatial competition.
- Wallet signatures only for asset and USDC operations; session-signed gameplay after entry.
- Transparent USDC liabilities, refunds, rollover, and settlement.
- Verifiable, replay-safe gacha and world generation.
- Permanent, freely transferable agent collectibles with escrowless life locking.
- Spatial subscriptions and efficient Three.js rendering.
- Recoverable asynchronous workflows with explicit pending, fulfilled, failed, and refunded states.

### 3.2 Non-goals for V1

- Multisig administration. V1 uses one rotatable admin; V2 migrates to multisig.
- Enforced royalties on arbitrary external transfers.
- Private game state. All world, player, score, and gacha result state is public.
- Direct lethal player abilities or kill-based scoring.
- Energy or mana systems. Abilities use cooldowns only.
- Analog movement. V1 uses deterministic grid steps.
- Cross-region interaction inside one daily room. A room is pinned to one compatible ER placement.
- Prevention of valid bots, multiple wallets, alliances, or coordinated chain kicking.
- Mainnet deployment without external security and jurisdiction-specific legal review.

## 4. Trust and authority model

### 4.1 Program guarantees

The program enforces:

- Canonical USDC mint and token program.
- Exact entry, revive, banner, refund, and settlement amounts.
- Vault conservation and one-time receipt consumption.
- Daily cutoff and revival deadline.
- Winner identity and immutable 90/10 settlement split.
- NFT collection membership, ownership, and active-attempt lock.
- Session authority, scope, expiry, wallet binding, attempt nonce, and action sequence.
- Legal grid movement, occupancy, scoring, cooldowns, targets, effects, collisions, and death.
- One authenticated chunk result per chunk index.
- One authenticated gacha result per pull.
- Seasonal mint caps and pity behavior.

### 4.2 V1 admin powers

The admin may:

- Prepare future daily rooms.
- Prepare future seasons and banners.
- Pause one subsystem or the protocol.
- Void a paid day, activating deterministic refunds.
- Trigger daily settlement after the final record is committed.
- Rotate the admin authority.
- Schedule class-balance changes for a future UTC day or season boundary.

The admin may not:

- Change the winner or payout split during settlement.
- Withdraw pending entry, revive, refund, or prize liabilities.
- Alter a banner’s base weights or supply caps after its season starts.
- Replace or reroll a fulfilled VRF outcome.
- Modify an active day’s class rules.

V1 users trust the admin for settlement liveness. There is no public settlement timeout. NFT cleanup and valid refunds do not depend on admin availability.

### 4.3 MagicBlock and service trust

- Delegated execution follows MagicBlock’s ER sequencing, commitment, and fraud-proof model.
- VRF callbacks are accepted only through the scoped authenticated callback identity.
- A successful VRF request is not treated as a successful result; callback completion is monitored separately.
- A successful Magic Action schedule is not treated as completed base settlement; every action is observed and reconciled.
- Router status determines the ER endpoint for delegated accounts.

## 5. High-level architecture

```text
Solana base layer
  GlobalConfig
  Season / Banner / VariantInventory
  PlayerProfile / Pity
  GachaPull / marketplace listings
  DailyCompetition / DailyVault / DailyContribution
  PaymentReceipt / AgentLock
  Metaplex Core agent assets
          |
          | initialize + delegate / commit + undelegate
          v
MagicBlock Ephemeral Rollup
  WorldHeader (paid)
  WorldHeader (casual)
  ChunkDefinition accounts shared by both modes
  OccupancySector accounts per mode
  PlayerRun accounts per mode and wallet
  DailyBest accounts per mode and wallet
  TemporaryEffect and scheduled hazard state
```

One Anchor program implements both sets of instructions. Base-only economic accounts are never delegated. Realtime game accounts are initialized on base when durable identity is required, delegated to a common ER, mutated on the ER, and committed according to policy.

## 6. Account model

Names are conceptual Anchor account names. Exact byte layouts and rent sizes belong in the implementation plan.

### 6.1 Base-layer accounts

#### `GlobalConfig`

- `admin`
- pending admin for two-step rotation
- canonical USDC mint and token program
- team treasury USDC account
- agent collection address and update authority
- protocol, paid-room, casual-room, gacha, and marketplace pause flags
- winner basis points: 9,000
- team basis points: 1,000
- maximum concurrent paid and casual players: 500 each
- current configuration version

PDA: `[b"config"]`

#### `Season`

- season index
- inclusive start day and exclusive end day
- immutable base banner weights hash
- class-balance version
- metadata base URI/version
- active, closed, or paused status

PDA: `[b"season", season_index_le]`

#### `Banner`

- season and tier identifier
- price in USDC base units
- Common/Rare/Epic/Legendary base weights
- epic pity threshold: 10
- legendary pity threshold: 100
- active inventory revision
- status

PDA: `[b"banner", season, tier]`

#### `VariantInventory`

- season
- variant identifier
- class identifier
- rarity
- model/cosmetic identifiers
- metadata URI hash
- supply cap
- reserved count
- minted count
- active flag

PDA: `[b"variant", season, variant_id]`

#### `ClassConfig`

- class identifier and version
- ability kind
- cooldown seconds
- range, duration, displacement, and bounded effect parameters
- minimum rarity that may reference the class
- activation day

PDA: `[b"class", class_id, version]`

Class changes become active only at a future room boundary. All NFTs referencing one class use that class’s active daily version equally.

#### `PlayerProfile`

- player wallet
- starter entitlement claimed flag
- per-banner-tier Epic and Legendary pity counters
- total paid wins
- current-season wins
- highest paid and casual scores
- completed attempts and total successful revivals
- profile bump and version

PDA: `[b"player", wallet]`

#### `GachaPull`

- player, season, banner tier, pull nonce
- payment receipt
- price and probability snapshot
- inventory revision/hash
- request timestamp and timeout
- VRF request identity/generation
- state: Pending, Assigned, Claimed, Refundable, Refunded
- assigned rarity and variant
- reserved inventory flag
- minted asset address

PDA: `[b"pull", player, pull_nonce_le]`

#### `DailyCompetition`

- UTC day index
- prepared/open/closed/committed/settled/void status
- paid world address
- daily vault address
- rollover in and rollover out
- pending-entry total
- active prize-pool total
- refund liability
- settled winner and score
- winner and team amount
- winner/team transfer completion flags
- final committed world slot/signature reference

PDA: `[b"daily", utc_day_le]`

#### `DailyContribution`

- UTC day and wallet
- consumed entry total
- consumed revival total
- refunded total
- claim-complete flag for a voided day

PDA: `[b"contribution", utc_day, wallet]`

This account makes void refunds independent and idempotent.

#### `PaymentReceipt`

- kind: Entry or Revival
- day, wallet, player run, attempt nonce
- death/revive nonce where applicable
- exact USDC amount
- state: Pending, Consumed, Refundable, Refunded
- created time
- associated committed run transition

PDA: `[b"payment", kind, day, wallet, receipt_nonce]`

#### `AgentLock`

- owner wallet
- asset address or starter marker
- paid/casual world
- attempt nonce
- frozen flag
- terminal run transition needed for thaw

PDA: `[b"agent_lock", world, wallet, attempt_nonce]`

#### `MarketplaceListing`

- seller
- asset
- asking USDC amount
- expiry or no-expiry marker
- status
- sale nonce

PDA: `[b"listing", asset]`

The in-game marketplace rejects locked assets. Sale sends 90% to the seller and 10% to the configured team treasury, then transfers the asset. Direct transfers outside the marketplace remain possible when the asset is not frozen.

### 6.2 Delegated gameplay accounts

#### `WorldHeader`

- day and mode
- start and end timestamps
- prepared/open/closed state
- 64-column width
- safe-zone row range
- active-player count and cap
- current chunk frontier
- current record score, holder, attempt nonce, and reached slot
- next chunk request state
- class-balance version/hash
- action-sequence domain
- commit and crank payer references

PDA: `[b"world", mode, utc_day]`

#### `ChunkDefinition`

- day and chunk index
- row start and row count: 16
- VRF request identity/generation
- randomness commitment/hash
- generated lane descriptors
- generation version
- status: Requested, Revealed, Closed

PDA: `[b"chunk", utc_day, chunk_index]`

One revealed definition is read by both paid and casual world modes.

#### `OccupancySector`

- world
- sector x/y index
- fixed 8x8 occupancy grid
- static blocker bits
- temporary local effect slots with expiry
- sector sequence number

PDA: `[b"sector", world, sector_x, sector_y]`

#### `PlayerRun`

- world and wallet
- registered session authority and expiry
- attempt nonce
- state: PendingSpawn, Active, DeadAwaitingRevive, EntryFailed, Ended
- selected agent asset or starter marker
- class identifier and active balance version
- x/y tile and facing
- furthest row/score
- last verified safe tile and row
- last accepted movement slot
- next action sequence
- Kick ready timestamp
- class ability ready timestamp
- temporary status effects
- successful revive count
- death nonce and revival deadline
- current payment receipt references
- scheduled hazard nonce/deadline

PDA: `[b"run", world, wallet]`

One account is reused for the wallet’s attempts within a day by incrementing `attempt_nonce`. It can never hold two active attempts simultaneously.

#### `DailyBest`

- world and wallet
- best score
- attempt nonce
- reached slot
- class and asset used

PDA: `[b"best", world, wallet]`

Every wallet writes its own best account. The full ranking may be indexed and sorted off-chain; the prize record remains in `WorldHeader`.

## 7. Transaction routing

| Operation                                | Route        | Signer                          |
| ---------------------------------------- | ------------ | ------------------------------- |
| Initialize config/season/day             | Solana base  | Admin                           |
| Transfer USDC for entry/revival/gacha    | Solana base  | Wallet                          |
| Mint/freeze/thaw/transfer agent          | Solana base  | Wallet and/or program PDA       |
| Initialize and delegate run/world/sector | Solana base  | Wallet or admin as defined      |
| Resolve delegation endpoint              | Magic Router | Read-only client                |
| Spawn/move/Kick/ability/collision        | Room ER      | Session key or crank authority  |
| Chunk VRF request/callback               | Room ER      | Scoped VRF flow                 |
| Gacha VRF request/callback               | Solana base  | Wallet request/scoped callback  |
| Commit/undelegate gameplay state         | Room ER      | Authorized payer/crank/admin    |
| Reconcile payment receipt                | Solana base  | Permissionless fixed transition |
| Settle daily pool                        | Solana base  | Admin only                      |

All writable accounts in one ER transaction must be delegated to a compatible validator. The client queries router delegation status and uses the returned FQDN. A regional endpoint may be a configured preference during room preparation, but delegated-account placement is authoritative.

## 8. Paid entry state machine

Base USDC transfer and ER tile reservation cannot be made falsely atomic. The protocol exposes the actual stages.

```text
No attempt
  -> Entry payment pending + agent frozen + run prepared/delegated
  -> ER spawn evaluation
       -> Active + activation committed -> receipt consumed into prize pool
       -> EntryFailed + failure committed -> receipt refundable + agent thaw
```

Detailed flow:

1. Wallet calls `begin_paid_attempt` on base.
2. Program validates day open-for-admission, canonical USDC accounts, player profile, selected starter/NFT, and absence of another active attempt.
3. For an NFT, owner grants the game PDA the required Freeze Delegate authority and the asset is frozen in the same reviewed transaction flow.
4. Exactly 1 USDC moves to the day vault and is recorded as pending, not active prize accounting.
5. A unique payment receipt and agent lock are created. The run is initialized or prepared for its next attempt and delegated.
6. On ER, `spawn_paid_attempt` checks current time, active-player cap, and safe-zone occupancy.
7. Spawn scanning begins at a wallet-and-attempt-derived deterministic offset and finds the first free safe tile in wrapped scan order.
8. Success sets the run Active, reserves occupancy, increments active population, and commits the activation marker.
9. A permissionless base reconciliation validates the committed run transition and moves the receipt amount from pending to active prize-pool accounting.
10. Failure sets EntryFailed and commits it. Base refund returns the pending 1 USDC and thaws the agent.

The safe zone has 64 columns and 16 hazard-free rows, providing 1,024 tiles for a 500-player cap. Full-capacity behavior remains explicitly refundable rather than relying only on this margin.

## 9. Death and revival state machine

### 9.1 Death

An authoritative hazard transition:

- Removes the wallet from occupancy immediately.
- Decrements active population.
- Sets `DeadAwaitingRevive`.
- Stores the exact death nonce and 60-second deadline.
- Preserves score, cooldown deadlines, class, agent, and last safe tile.
- Invalidates movement and scheduled-action nonces.
- Commits the death marker so a base revive payment can validate the current price and deadline.

### 9.2 Revival payment

1. Wallet calls `begin_revive` on base.
2. Program reads and validates the committed delegated run representation, death nonce, player wallet, deadline, and next price.
3. Price uses checked USDC base-unit arithmetic.
4. Exact USDC enters pending day accounting and a receipt binds day, run, attempt, death nonce, and revive index.
5. On ER, `complete_revive` verifies receipt ownership, amount, nonce, deadline, and that it was not previously consumed.
6. It reserves the saved safe tile or nearest valid tile on the same safe row.
7. It sets Active, increments active population, increments successful revive count, and commits the result.
8. Base reconciliation consumes the receipt into the pool and contribution ledger.

If the deadline passes or no tile can be reserved, an ER terminal transition commits failure. The payment receipt becomes refundable. A successful receipt can never be refunded, and a refunded receipt can never revive.

### 9.3 Permanent completion

When the deadline expires without revival, the run moves to Ended. A user may invoke deterministic base cleanup after the terminal marker is committed:

- Thaw the NFT.
- Close the AgentLock and refundable temporary accounts where safe.
- Preserve DailyBest and profile history.

At the UTC cutoff, every nonterminal attempt is treated as ended by instruction guards. Cleanup can use the cutoff itself plus the committed world/day state; admin payout liveness is not required.

## 10. World generation

### 10.1 Chunk pipeline

- World width is fixed at 64 columns.
- Chunk height is fixed at 16 rows.
- The first chunk includes the 16-row safe spawn zone.
- When the record/frontier leader comes within eight rows of the revealed boundary, anyone may request the next chunk if no live request exists.
- The boundary is closed and safe until an authenticated callback publishes the chunk.
- There is no client fallback map.

### 10.2 VRF lifecycle

```text
Unrequested
  -> Requested(request_generation, request_identity, requested_at)
  -> Revealed(randomness_hash, lane_data)

Requested past timeout
  -> Retried(new generation)
```

- `#[vrf]` protects the request account context.
- `#[vrf_callback]` authenticates the callback identity.
- Callback arguments bind day, chunk index, and request generation.
- A duplicate callback is idempotently rejected.
- A late callback from an invalidated generation cannot replace the current request.
- Retry is permissionless after an objective timeout, preventing selective admin rerolls.
- The first valid current-generation callback permanently determines the chunk.
- The revealed chunk is committed once for auditability.

### 10.3 Lane descriptors

A chunk stores bounded descriptors, not per-frame vehicle coordinates:

- Safe grass and static blockers
- Road and highway lanes
- Cars and trucks with direction, cadence, spacing, phase, and footprint
- River lanes with logs, platforms, sinking windows, direction, and cadence
- Railway lanes with warning, closure, train window, direction, and footprint
- Local environmental modifier hooks used by class abilities

Generated data is validated against bounds so VRF cannot produce an impossible or unbounded account layout. Difficulty rises through template stages and parameter ranges but remains within audited limits.

### 10.4 Deterministic position

Rendered and validated hazard state derives from:

```text
generation_version
+ chunk randomness
+ lane descriptor
+ authoritative ER slot/time
+ active bounded temporary effects
```

The frontend interpolates visual positions. The contract evaluates discrete tile occupancy and transition windows.

## 11. Authoritative simulation

### 11.1 Movement

- A request contains direction, attempt nonce, and monotonically increasing action sequence.
- The client never supplies an authoritative destination, score, or collision result.
- The program derives destination from current tile and direction.
- Base movement allows one accepted step per ER slot.
- Destination must be in bounds, traversable at that slot, and unoccupied.
- Same-sector movement writes PlayerRun and one sector.
- Cross-sector movement writes PlayerRun, source sector, and destination sector atomically.
- The first transaction ordered by the sequencer claims a contested tile; later moves fail without changing position.
- Facing changes to the accepted movement direction.
- Score updates only when destination row is greater than the run’s previous furthest row.
- DailyBest updates only when score exceeds the wallet’s previous daily best.
- World record updates only when score strictly exceeds the incumbent.

### 11.2 Session authorization

- Gameplay uses a session signer registered by the wallet.
- The session is bound to wallet, world, run, allowed instruction scope, expiry, and attempt nonce.
- Every action presents the session token/account and signer.
- Entry, revival, marketplace, gacha, NFT, and USDC operations always require the wallet.
- Lost-session recovery rotates authority through a wallet-authorized path without changing score or economic ownership.
- Action sequence rejects replay and avoids byte-identical transaction deduplication.

### 11.3 Kick

- Cooldown: five seconds using authoritative ER time.
- Target: exactly one adjacent tile in facing direction.
- Effect: one tile of knockback.
- It fails when there is no target, destination is out of bounds, or destination is occupied/blocked.
- There is no post-kick immunity.
- Multiple players may coordinate chain kicks.
- Kick does not award score or kill credit.
- If knockback places the target in a hazard window, the environment kills the target.

### 11.4 Class ability interface

Every collectible class supplies one active ability. The starter is the sole Kick-only exception.

- Cooldown: fixed per class from ten to thirty seconds.
- Program validates class version, target, range, line/terrain constraints, destination occupancy, effect duration, and cooldown.
- No class ability applies direct lethal damage.
- Abilities may reposition players, prevent displacement, shield an environmental collision, stun, slow, or temporarily alter a local hazard.
- Temporary effects are bounded to nearby sectors and expire automatically.
- Changing devices, disconnecting, dying, or reviving does not reset cooldowns.

Initial class concepts:

| Availability | Class        | Ability                                        | Initial cooldown intent |
| ------------ | ------------ | ---------------------------------------------- | ----------------------: |
| Common       | Sprinter     | Two-tile forward dash through valid tiles      |                     10s |
| Common       | Guardian     | Brief one-collision environmental shield       |                     20s |
| Common       | Anchor       | Short forced-movement resistance               |                     15s |
| Rare         | Ram          | Bounded stronger directional push              |                     15s |
| Rare         | Hook         | Pull a valid nearby target one tile            |                     18s |
| Rare         | Acrobat      | Leap over one blocker into a free tile         |                     12s |
| Rare         | Trapper      | Temporary local slowing tile                   |                     20s |
| Epic         | Phantom      | Pass through a blocker and land on a free tile |                     20s |
| Epic         | Switcher     | Swap with a valid nearby player                |                     25s |
| Epic         | Engineer     | Briefly alter one nearby traffic lane          |                     25s |
| Legendary    | Chronomancer | Slow players and hazards in a local zone       |                     30s |
| Legendary    | Warden       | Short bounded area stun                        |                     30s |

These are launch balance definitions, not client-controlled metadata. Parameter changes are scheduled at day boundaries and apply equally to every NFT in the class.

### 11.5 Hazard checks without a global 500-player tick

Visual rendering may run at 60 FPS, but correctness does not require writing every player each frame.

- Entering a dangerous tile computes the next meaningful hazard deadline.
- The run stores a hazard nonce and schedules a bounded crank check against the run and relevant world accounts.
- Moving away changes the nonce, making an obsolete scheduled check harmless.
- If a player stops sending transactions, the scheduled check still resolves the hazard.
- A collision instruction recomputes current canonical hazard state; it never trusts precomputed client data.
- Moving-platform state materializes at discrete grid boundaries and schedules fall/sink/edge checks.
- The design supports one-slot player input while hazard transactions execute only at meaningful state transitions.

The exact crank partition and maximum accounts per check must be selected from load-test evidence. A 500-player, 50ms global writable tick is explicitly not assumed.

## 12. Agent NFT lifecycle

### 12.1 Minting

- Collectible agents are Metaplex Core assets in the verified Crossy World collection.
- Variant metadata includes season, class, rarity, cosmetic variant, model identifier, and visual attributes.
- Gameplay reads program-owned VariantInventory/ClassConfig relationships, not mutable off-chain metadata text.
- Raw Unity source models are never placed in public NFT metadata. Public media uses rendered and optimized derivatives allowed by the purchased license.

### 12.2 Lock for an attempt

- Current asset owner signs entry.
- Program validates collection and VariantInventory mapping.
- A Freeze Delegate is approved to the game-controlled PDA and the asset is frozen.
- Frozen assets cannot transfer or burn.
- The AgentLock binds asset, owner, world, and attempt nonce.
- The selected asset cannot be used in another run or listed in the in-game marketplace.

### 12.3 Unlock

- Run must be terminal or the daily cutoff must have passed.
- Unlock is permissionless but recipient and asset are fixed by AgentLock.
- Thaw is idempotent.
- Transfer after thaw resets owner-managed plugin delegation as defined by Metaplex Core; a future owner grants the game delegate again when entering.

## 13. Gacha protocol

### 13.1 Pull initiation

1. Wallet chooses one banner and sees price, base weights, effective odds, supply, and pity counters.
2. Program validates season active, banner active, required pity inventory available, and canonical USDC accounts.
3. Exact USDC moves into pending gacha accounting.
4. GachaPull snapshots price, weights, inventory revision/hash, pity state, and request nonce.
5. Program requests base-layer MagicBlock VRF using the correct queue constant.

### 13.2 Callback assignment

- Scoped VRF identity must authenticate the callback.
- Pull must be Pending and match player, pull nonce, banner, and request generation.
- Pity override is evaluated before ordinary rarity selection.
- Ordinary weighted selection uses unbiased bounded sampling; naive modulo bias is not accepted.
- Variant selection is uniform or explicitly weighted among in-stock variants in the selected rarity according to the snapshotted table.
- Solana account locking serializes concurrent inventory decrements.
- Assignment reserves one supply unit, updates pity, stores the assigned variant, and marks the pull Assigned.
- A callback does not mint the Core asset, keeping callback compute and account metas bounded.
- Duplicate callbacks cannot reserve another item or advance pity.

### 13.3 Claim

- Player or a permissionless sponsor may call claim, but the asset owner is fixed to the pull’s player.
- Claim mints the exact assigned variant.
- Successful mint increments minted count, clears reservation, records asset address, and marks Claimed.
- Claim is idempotent and retryable after transaction failure.
- Team revenue becomes final when a valid assignment reserves inventory; mint failure does not reroll the outcome.

### 13.4 Timeout and sold-out races

- Pending without assignment for five minutes becomes refundable.
- Refund invalidates the current request generation.
- Late callback fails without changing pity or supply.
- If snapshot inventory becomes unavailable due to a concurrent callback, the pull becomes refundable rather than downgraded or rerolled.
- Sold-out variants are excluded from future displayed effective odds.
- If an entire rarity becomes unavailable, its base weight is proportionally redistributed among available rarities for new pulls.
- Pity may never be downgraded. Missing required pity inventory pauses payment acceptance for that banner.

## 14. Marketplace

The in-game marketplace is a base-layer fixed-price USDC market for Crossy World Core assets.

- Seller must own an unfrozen, unlisted collection asset.
- Listing locks or escrows sale authority so the seller cannot produce an invalid stale listing.
- Buyer pays the exact listing amount in canonical USDC.
- 90% goes to seller and 10% to team treasury.
- Asset transfers to buyer atomically with payment.
- Listing, purchase, and delist are idempotent by listing nonce/status.
- Active-run assets cannot list or sell.
- External wallet transfers and external marketplaces remain allowed after thaw and may bypass royalty.

## 15. Leaderboards and profiles

### 15.1 Paid daily

- `WorldHeader.record_*` is the only prize authority.
- `DailyBest` accounts provide each wallet’s best score.
- An indexer sorts DailyBest accounts for UI pages and websocket updates.
- Indexer ordering cannot alter the winner.

### 15.2 Casual daily

- Same DailyBest structure under the casual world.
- No payout or pool.
- Clearly labeled separately from paid ranking.

### 15.3 Season

- Primary ranking: authoritative daily wins stored in PlayerProfile.
- Secondary display: highest winning score.
- Further non-prize display ordering may use indexed top placements and earliest achievement.
- V1 season leaderboard has no automatic pooled payout.

### 15.4 All-time profile

- Total daily wins
- Current-season wins
- Highest paid and casual scores
- Completed attempts and total successful revivals
- Historical winning days and scores through indexed program events
- Owned agent collection through Metaplex/DAS indexing

On-chain accounts and events are the source; indexers are rebuildable caches.

## 16. Daily room operations

### 16.1 Preparation

Before cutoff, admin automation:

1. Derives tomorrow’s paid and casual world PDAs.
2. Initializes DailyCompetition and world accounts.
3. Initializes/delegates required initial sectors and commit payer.
4. Pins intended validator placement.
5. Queries router status and verifies ER owner/clone state.
6. Requests/prepares the initial shared chunk.
7. Marks the day Prepared only after readiness checks pass.

Paid admission remains closed if the day is not prepared.

### 16.2 Cutoff

Instruction guards compare authoritative time against world end time. At cutoff:

- No new actions are accepted.
- Active attempts are terminal for cleanup purposes.
- Final WorldHeader and required leaderboard state are committed.
- The previous world transitions Closed then Committed.
- Clients resolve and switch to the next prepared world.

### 16.3 Settlement

After final commitment, admin calls `finalize_day`.

Valid record:

- Program reads immutable committed winner and score.
- Team amount is `floor(pool * 1_000 / 10_000)`.
- Winner amount is the exact pool balance minus the team amount, assigning any indivisible USDC rounding unit to the winner.
- Transfers go only to the winner’s canonical USDC token account and configured team treasury.
- Winner and team legs have independent completion flags for safe retries.
- Settled status requires both transfers.

No valid record:

- Entire active pool becomes rollover out.
- Next DailyCompetition records the exact rollover in.
- No team transfer occurs.

### 16.4 Void and refunds

Admin may irreversibly mark an unsettled day Voided.

- New activity is blocked.
- No winner or team fee is payable.
- DailyContribution defines each wallet’s exact consumed entry and revival amount.
- Player claims once; program records refunded amount.
- Pending receipts follow their own refund state and are not double-counted.
- Vault cannot close until refund liabilities are zero or a later audited policy handles abandoned balances. V1 does not confiscate unclaimed refunds.

## 17. Commit and sponsorship policy

- Realtime movement and temporary occupancy remain on ER.
- New global records commit immediately.
- Chunk publication commits once.
- Death, entry activation/failure, and revival success/failure commit for economic reconciliation.
- DailyBest checkpoints periodically and at cutoff.
- Final world state commits and undelegates after cutoff.

This exceeds the default sponsored commit allowance. Production setup includes:

- A delegated fee payer scoped to the room.
- The validator-specific magic fee vault.
- Base-layer top-up using the documented delegated lamports transfer path.
- Monitoring of payer balance, fee vault identity, commit signatures, and base confirmation.
- Idempotent reconciliation when Magic Actions are removed or fail during retry.

## 18. Pause, recovery, and idempotency

### 18.1 Pause levels

- Protocol-wide
- Paid admission only
- Casual admission only
- Gacha only
- Marketplace only
- Individual daily room

A pause blocks new mutations in scope but does not block valid refunds or NFT unlock.

### 18.2 Recovery matrix

| Failure                              | Visible state              | Recovery                                                             |
| ------------------------------------ | -------------------------- | -------------------------------------------------------------------- |
| Room not cloned to ER                | Prepared but not Ready     | Re-query router, retry clone nudge, keep admission closed            |
| Entry spawn full/fails               | EntryFailed committed      | Refund pending entry and thaw agent                                  |
| Revival misses deadline              | Terminal failure committed | Refund pending revival and end attempt                               |
| Chunk VRF delayed                    | Closed safe frontier       | Permissionless timeout retry                                         |
| Gacha VRF delayed                    | Pull Pending               | Five-minute refund and generation invalidation                       |
| Gacha mint claim fails               | Pull Assigned              | Retry exact claim; no reroll                                         |
| Magic Action fails                   | Unreconciled receipt       | Observe, rebuild idempotent action, retry                            |
| Record commit fails                  | Day Closed, not Committed  | Settlement blocked until reconciled                                  |
| Winner transfer succeeds, team fails | Partial settlement flags   | Retry only team leg                                                  |
| NFT thaw fails                       | Terminal lock remains      | Permissionless deterministic retry                                   |
| Admin/key incident                   | Paused                     | Rotate admin through configured authority path; V2 moves to multisig |

### 18.3 Idempotency keys

- Gameplay: world + wallet + attempt nonce + action sequence
- Entry/revival: payment receipt PDA and run transition nonce
- Gacha: pull PDA + VRF request generation
- Chunk: day + chunk index + request generation
- NFT claim: pull PDA and assigned asset
- Settlement: daily PDA and independent transfer flags
- Refund: contribution or receipt PDA state

## 19. Frontend architecture

### 19.1 Stack

- React 18
- Vite
- TypeScript
- Three.js
- Solana wallet-standard integration
- Generated Anchor/Codama-compatible instruction clients plus a focused Crossy World SDK
- Web Workers for deterministic rendering calculations and interpolation
- Rebuildable leaderboard/event index

The project contains legacy web3.js v1 patterns through solsocket and MagicBlock dependencies. New client code should isolate these behind adapters rather than spreading class-based types throughout the React application.

### 19.2 Screens

- Home/mode selection with UTC timer, current pool, rollover, champion, and score
- Wallet/profile and starter claim
- Agent inventory and class preview
- Paid entry review with exact 1 USDC transaction
- Casual entry
- Three.js game scene
- Death/revival dialog with exact next price and 60-second countdown
- Paid and casual daily leaderboards
- Season and all-time leaderboards
- Three gacha banners with odds, inventory, pity, pending state, reveal, and claim
- Agent marketplace
- Admin operations and health dashboard

### 19.3 Realtime client behavior

- Client sends intention: direction, Kick, or class ability.
- It predicts one visual grid transition.
- Authoritative subscription confirms or rejects.
- Rejection smoothly returns the model to canonical state.
- Obstacles render from committed chunk descriptors and synchronized ER slot/time.
- Client subscribes only to nearby sectors and relevant world/run accounts.
- Remote players interpolate between authoritative tile transitions.
- Network loss cannot prevent scheduled collision resolution.

### 19.4 Rendering performance

- Unity models export to optimized GLB/glTF derivatives.
- Mesh/material instancing groups repeated animal variants.
- Draco/meshopt and KTX2 are considered based on visual validation.
- Frustum and distance culling limit remote entities.
- Trails and particles have strict distance and count budgets.
- Nearby-interest radius, not all 500 full-detail models, drives active rendering.
- Main gameplay targets 60 FPS on supported desktop hardware, with adaptive effects for mobile.

## 20. Observability and operations

Production monitoring includes:

- Base owner, router delegation status, ER owner, and clone readiness
- MagicBlock network/region/service health
- Active-player counts and sector hot spots
- ER transaction p50/p95/p99 latency and rejection reasons
- Crank lag and missed hazard deadlines
- Pending chunk and gacha VRF age
- Callback failures and invalid generations
- Chunk frontier distance from leader
- Commit payer and fee vault balances
- Record and final commit confirmation
- Pending payment reconciliation
- Vault balance against pending, pool, rollover, refund, and settlement liabilities
- Locked NFTs awaiting terminal cleanup
- Admin room-preparation and settlement alerts

Every asynchronous operation persists base and ER signatures/identifiers needed for support and reconciliation.

## 21. Security requirements

### 21.1 Solana account validation

- Validate owner, discriminator, data length, PDA seeds, bump, signer, mutability, mint, and token program for every account.
- Treat delegated base accounts as intentionally delegation-program-owned and validate their delegation records before decoding committed application data.
- Never accept arbitrary unchecked room addresses without PDA and state validation.
- Use transfer-checked semantics for USDC decimals.
- Keep prize, pending, refund, rollover, and treasury accounting independently auditable.

### 21.2 Session safety

- Session has world, wallet, attempt, scope, and expiry.
- No USDC, NFT, admin, marketplace, or gacha authority is delegated to the session.
- Session rotation requires wallet authority.
- Session storage is scoped by wallet, cluster, and application, not one origin-global key.

### 21.3 VRF safety

- Both request and callback macros/checks are mandatory.
- Callback binds exact object and request generation.
- Callback processing is idempotent.
- Retry invalidates previous generations.
- Random sampling avoids modulo bias.
- Admin cannot reject valid unfavorable randomness.

### 21.4 Economic safety

- Checked arithmetic throughout.
- Basis-point totals equal 10,000.
- A payment is pending until its cross-plane result is reconciled.
- Refund and consume are mutually exclusive terminal states.
- Gacha inventory reservation and pity update are atomic.
- Partial payouts retry only incomplete legs.
- Emergency pause cannot withdraw liabilities.

### 21.5 Product and legal risk

Paid winner-takes-all competition, escalating revival spending, pay-to-win classes, tradable NFTs, and paid random gacha may be regulated differently by jurisdiction. Mainnet launch requires specialist legal analysis, age/access policy, geographic restrictions where required, consumer disclosures, published odds, and refund/support terms. The design does not claim that on-chain transparency alone resolves these obligations.

## 22. Performance targets and load gates

Design targets, subject to measured MagicBlock capacity:

- 500 concurrent players in paid mode.
- Casual mode also starts with a 500-player cap, and launch infrastructure must validate the combined paid-plus-casual load.
- One accepted movement per ER slot when legal.
- Same-region movement acknowledgement target: p95 under 100ms and p99 under 200ms under representative load.
- 60 FPS local rendering with adaptive effects.
- No duplicate occupancy under adversarial concurrent movement.
- No hazard deadline missed beyond the tested scheduler tolerance.
- Chunk callback completes before the leader reaches the eight-row closed frontier under normal service health.

The system does not assume that a single writable account or one 50ms global crank can serve 500 players. Sector sizes, hot-row partitioning, and crank strategy must be tuned from load tests.

## 23. Testing strategy

### 23.1 Pure logic and unit tests

- UTC day calculation and cutoff boundaries
- Revive price sequence and overflow rejection
- Weighted sampling and pity transitions
- Chunk generation bounds and deterministic lane state
- Grid movement, blockers, score monotonicity, and safe-tile tracking
- Kick and every class ability
- Hazard timing and moving-platform transitions
- Settlement rounding and conservation

### 23.2 Property and invariant tests

- At most one live occupant per tile.
- A score never decreases within an attempt.
- Equal score never replaces the record.
- No ability directly marks a player dead.
- Vault balance equals pending + prize pool + rollover + refund + unpaid settlement liabilities.
- A receipt cannot be both consumed and refunded.
- A pull cannot reserve or mint twice.
- Minted plus reserved inventory never exceeds cap.
- Pity cannot reset without a qualifying assigned result.
- A locked NFT cannot list, transfer, or enter another attempt.

### 23.3 Program tests

- Wrong USDC mint/token program/ATA owner
- Unauthorized config and settlement calls
- Entry at full capacity and after cutoff
- Revival by another wallet, wrong amount, stale death nonce, or expired deadline
- Session scope, expiry, replay, and recovery
- Concurrent movement into one tile
- Cross-sector movement atomicity
- Kick against blocked/out-of-bounds destinations
- Spoofed, duplicate, late, and wrong-generation VRF callbacks
- Sold-out inventory races
- Claim retry after mint failure
- Void/refund and rollover paths
- Partial winner/team transfer retry
- NFT freeze/thaw recovery

### 23.4 MagicBlock integration tests

- Base initialization and delegation
- Router FQDN resolution
- ER owner/clone invariants
- World/player/sector co-location
- Crank scheduling, cancellation by nonce, and delayed execution
- Chunk VRF on delegated queue
- Commit sponsorship and payer top-up
- Record commit and final undelegation
- Lost-session recovery
- Magic Action failure/reconciliation

### 23.5 Load and soak tests

- 500 simulated paid clients with realistic movement distribution
- Concentrated spawn-zone and choke-point contention
- Coordinated chain kicks
- Ability effects across sector boundaries
- Hazard checks while clients disconnect
- Leader racing the VRF frontier
- Paid and casual combined load
- 24-hour accelerated lifecycle and repeated UTC rollover
- RPC websocket reconnect and subscription resynchronization

### 23.6 Frontend tests

- Predicted move acceptance and rejection correction
- Nearby interest subscriptions
- Wallet rejection and insufficient USDC
- Pending entry/revival/gacha states
- Death countdown and cutoff
- NFT lock/list state
- Leaderboard cache rebuild
- Reduced effects and mobile controls

## 24. Delivery sequence

This is a contract-first project. Frontend game implementation starts only after the corresponding program interfaces and tests stabilize.

1. Repository/toolchain and CI baseline
2. Program account schemas, PDA derivation, config, UTC day, and pause controls
3. Pure deterministic game kernel
4. Delegated world, sectors, run state, sessions, movement, and occupancy
5. Hazards, scheduled checks, Kick, and class ability dispatch
6. JIT chunk VRF and recovery
7. USDC daily vault, pending receipts, entry, revival, contribution, refund, and rollover
8. Metaplex collection, NFT validation, attempt freeze, and permissionless thaw
9. Gacha banners, inventory, pity, VRF assignment, claim, and refund
10. In-game marketplace
11. Daily record, leaderboards, commits, admin settlement, and room rollover
12. Generated client and game-focused TypeScript SDK
13. React/Vite/Three.js vertical slice
14. Full product surfaces and admin dashboard
15. Devnet soak, 500-client load testing, security review, legal review, and mainnet readiness

The detailed implementation plan will decompose these phases into file-level, test-first tasks after this specification is reviewed and approved.

## 25. Launch acceptance criteria

- All program and invariant suites pass.
- Rust program passes the Solana program security analyzer with no unresolved critical/high findings.
- 500-client target passes measured latency and correctness gates on the selected MagicBlock environment.
- Two players never occupy one tile in adversarial tests.
- Stationary/disconnected players cannot evade deterministic hazards.
- Daily record and winner survive commit/undelegation.
- Settlement always conserves vault units and cannot change winner/split.
- Void refunds equal tracked contributions and cannot double-pay.
- Gacha odds, pity, supply, timeout, and callback replay behavior match the published rules.
- Every NFT lock has a tested permissionless terminal cleanup path.
- Tomorrow’s room preparation and hard cutoff survive admin automation delays.
- Frontend renders only canonical state and recovers from rejected predictions and websocket reconnects.
- Security and jurisdiction-specific legal reviews are complete before mainnet funds are accepted.
