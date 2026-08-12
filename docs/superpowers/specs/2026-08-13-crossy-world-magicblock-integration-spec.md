# Crossy World: MagicBlock Gameplay and Integration Specification

**Status:** Draft for user review  
**Parent:** [Crossy World product and protocol design](./2026-08-13-crossy-world-design.md)  
**Economy:** [Contract and economy specification](./2026-08-13-crossy-world-contract-economy-spec.md)  
**Date:** 2026-08-13

## 1. Purpose

This document specifies the delegated account topology, ER routing, session authority, deterministic world generation, spatial occupancy, movement, hazards, Kick, class abilities, cranks, cross-plane receipts, commits, cutoff, and failure recovery.

## 2. MagicBlock product selection

V1 uses:

- Public Ephemeral Rollup for low-latency public gameplay state.
- Scoped session keys for frequent player actions.
- MagicBlock VRF for just-in-time chunks and gacha randomness.
- Cranks/scheduled execution for time-dependent hazards and room maintenance.
- MagicIntentBundleBuilder for commit and commit-and-undelegate.
- Commit fee-vault sponsorship once free commit quota is exceeded.

V1 does not require Private ER because game state is intentionally public. Ephemeral SPL Token is not used for prize custody; USDC remains base-layer durable custody. This prevents delegated token balance complexity from entering winner settlement.

## 3. Delegation groups

Logical groups:

- `daily-shared-chunks:<day>`: chunk definitions read by paid and casual modes.
- `paid-world:<day>`: paid WorldHeader, sectors, runs, best accounts, effects.
- `casual-world:<day>`: casual equivalents.

All accounts written together must resolve to one compatible ER FQDN. World preparation pins a validator and verifies co-location through router status.

Chunk definitions are shared read-only across modes after reveal. If runtime constraints make cross-group reads unreliable, identical committed chunk data is cloned into each mode during preparation/reveal; the randomness hash and generation must match.

## 4. Account ownership invariants

For each delegated application PDA:

- Base layer owner: MagicBlock Delegation Program while delegated.
- Router: delegated status with expected validator/FQDN.
- ER owner: `crossy_world` program.
- ER data: valid discriminator, PDA fields, day/mode, and delegated state.

The client does not infer an ER from a static region string after delegation. It resolves by a root account such as WorldHeader and verifies other writable accounts co-locate.

## 5. World preparation sequence

1. Admin initializes tomorrow’s base DailyCompetition, paid/casual WorldHeaders, initial sectors, commit payer, and first ChunkDefinition.
2. Program delegates gameplay PDAs with explicit validator.
3. Automation queries router until status is delegated and captures FQDN.
4. Automation checks base and ER ownership invariants.
5. Initial chunk VRF request executes against the queue matching the runtime.
6. Authenticated callback reveals spawn/safe chunk.
7. Chunk is committed and both worlds verify it.
8. Required crank tasks are scheduled.
9. Readiness evidence is reconciled to base; DailyCompetition becomes Open at its start time.

Admission stays disabled on any incomplete step.

## 6. Session model

### 6.1 Session token fields

- Wallet
- Ephemeral signer
- Cluster/program
- World
- PlayerRun
- Attempt nonce
- Allowed action bitmap: move, Kick, class ability, heartbeat/reconnect
- Issued and expiry timestamps
- Revoked/rotation nonce

### 6.2 Prohibited scope

Session may never authorize:

- USDC transfer
- Gacha request/refund
- NFT approval, freeze, thaw, list, sale, or transfer
- Admin actions
- Prize settlement
- Marketplace purchase

### 6.3 Rotation

Wallet-authorized recovery rotates session authority while preserving run state. Old signer and action domain become invalid. Rotation is rate-limited and bound to current attempt.

### 6.4 Storage

Browser session key storage key includes application, cluster, wallet, and optionally device profile. It is not one global origin key. Session key never holds funds.

## 7. Spatial model

### 7.1 Coordinates

- `x`: 0 through 63.
- `y`: nonnegative forward row within bounded account representation.
- Hard boundaries at x edges.
- No wraparound.
- One live player per tile.

### 7.2 Sectors

Initial sector size is 8x8 tiles. Each sector stores:

- 64 occupancy slots or bitset plus compact occupant references.
- Static blocker mask derived from chunk.
- Bounded temporary effect slots.
- Sequence number.

Sector layout may be tuned before account compatibility freezes. Program exposes constants through IDL/client so frontend never hardcodes mismatched values.

### 7.3 Spawn zone

- 64x16 hazard-free start area.
- 1,024 possible tiles for 500-player cap.
- Scan starts at deterministic hash(wallet, day, attempt) modulo tile count.
- First valid free tile in wrapped order wins.
- Spawn transaction atomically writes run and sector.
- No free tile or cap reached produces committed EntryFailed, never a charged active entry.

## 8. Action envelope

Every session gameplay request carries:

- World
- Wallet/run
- Attempt nonce
- Action sequence
- Action kind and bounded arguments

Program requires exact next sequence. Accepted action increments it. Rejected semantic actions may either consume or preserve sequence according to one consistent implementation rule; recommended behavior consumes only successfully executed actions, while transaction replay is already prevented by signature/blockhash. Client resynchronizes sequence after any rejection.

A client-generated unique memo/nonce may be included so two identical legal events cannot become byte-identical transactions under a cached blockhash.

## 9. Movement

### 9.1 Validation

`move(direction)` derives target and checks:

- World Open and before cutoff.
- Run Active.
- Valid session, attempt, and sequence.
- Movement cadence permits action this ER slot.
- No stun/immobilize status.
- Destination in bounds.
- Destination terrain traversable now.
- Destination occupancy empty.
- Required source/destination sectors match derived coordinates.

### 9.2 Atomic writes

- Clear source occupancy.
- Set destination occupancy.
- Update position and facing.
- Update safe tile if destination is safe.
- Increase furthest row/score if strictly forward record.
- Update DailyBest if strictly improved.
- Update WorldHeader record if strictly improved.
- Recalculate hazard schedule.

Cross-sector movement includes both sectors writable in one transaction. Clients precompute required account metas from canonical coordinates but program verifies them.

### 9.3 Contention

MagicBlock sequencer ordering determines first valid claim. The later transaction fails `TileOccupied`. No speculative merge is performed.

## 10. Chunk generation

### 10.1 Frontier rule

When highest reached row is within eight rows of current frontier, any caller can request the next chunk if state is Unrequested or timed-out. WorldHeader holds one next-index request to prevent gaps and selective skipping.

### 10.2 Callback binding

Request/callback bind:

- UTC day
- Chunk index
- Generation nonce
- World generation version
- Expected queue/runtime

Use both required VRF request and callback authentication macros. Callback accepts only current generation.

### 10.3 Generation algorithm

VRF bytes feed a deterministic, versioned generator that selects:

- Difficulty stage based on chunk index.
- Lane template sequence.
- Bounded lane parameters.
- Static blockers and safe-row spacing.
- Vehicle/log/train phase and cadence.

Generator guarantees:

- Exactly 16 rows.
- At least one theoretically traversable route under static geometry.
- Bounded account serialization.
- No invalid zero cadence or arithmetic overflow.
- Required warning period for trains.
- Difficulty maxima defined by version.

Dynamic multiplayer occupancy may still block a route; this is intentional PvP congestion.

### 10.4 Delayed callback

Unrevealed boundary is an impassable safe barrier. Players cannot move into it. Client displays generation status. Timeout retry increments generation; late previous callback fails.

## 11. Hazard representation

### 11.1 Road/highway

Descriptor:

- Direction
- Vehicle type/footprint pattern
- Period/cadence
- Speed in fixed-point tile units per slot/time quantum
- Initial phase
- Lane occupancy windows

### 11.2 River

- Water itself lethal unless supported by active platform/log.
- Moving supports use deterministic position windows.
- Player standing on support follows at discrete tile transitions.
- Sinking platforms expose deterministic warning and inactive interval.
- Being carried outside hard x bounds is death.

### 11.3 Railway

- Warning state begins before train occupancy.
- Train footprint/speed is deterministic.
- Crossing gates may be visual/static blockers during configured windows.
- Local abilities cannot remove mandatory minimum warning or globally stop trains.

### 11.4 Static blockers

Trees, rocks, barriers, and future geometry use chunk masks. Abilities may bypass only when their class rule explicitly allows it.

## 12. Scheduled collision model

### 12.1 Why event-driven

Writing all 500 runs every 50ms would serialize and overload shared accounts. The program schedules meaningful deadlines per run/sector.

### 12.2 Hazard schedule

After spawn, move, forced move, platform transition, or temporary effect:

- Compute earliest time current tile becomes unsafe.
- Increment run hazard nonce.
- Schedule a bounded collision instruction with run, sector/chunk, deadline, and nonce.

On execution:

- Reject harmlessly if nonce stale, run nonactive, or tile changed.
- Recompute hazard from canonical data and current ER time.
- If unsafe, execute death transition.
- If still safe but a future transition exists, schedule next bounded check.

### 12.3 Scheduler lag

Collision uses canonical effective time, not callback arrival time. If execution is late, it still determines whether player should have died. The game may display delayed correction, but score cannot continue through a logically lethal interval once checked.

Load tests define acceptable scheduler lag and partitioning. If public crank capacity cannot support target load, launch cap or cadence must be reduced rather than trusting clients.

## 13. Death transition

Death may result only from environmental validation:

- Vehicle/train collision
- Unsupported water tile
- Platform sink/fall
- Out-of-bounds carried state
- Future versioned environment type

Transition atomically:

- Clears occupancy.
- Decrements active count.
- Sets DeadAwaitingRevive in paid or Ended in casual.
- Stores death nonce and paid deadline.
- Invalidates scheduled hazards.
- Preserves score, cooldowns, class, and safe tile in paid.
- Emits authoritative death event.

Kick/ability event may be recorded as causal context for UI, but gives no score or payout credit.

## 14. Revival integration

The base receipt references exact run, attempt, death nonce, and price. ER `complete_revive` validates a committed/bridged receipt proof according to the selected cross-plane implementation.

Two acceptable integration mechanisms are evaluated during implementation planning:

1. Commit and clone the program-owned receipt/account so ER can read it.
2. Use a Magic Action or authenticated reconciliation marker tied to the base payment.

Selected mechanism must provide:

- No revival before finalized USDC payment.
- No receipt use by another run/death.
- One successful consumption.
- Refund when ER cannot consume before deadline.
- Observable base and ER signatures.

The implementation must not accept a client-signed assertion that payment happened.

## 15. Kick

- Five-second cooldown.
- One adjacent facing tile target.
- One-tile forced destination.
- Target must be Active.
- Destination must be in bounds, valid terrain position, and unoccupied.
- Source/target/destination sectors are validated and atomically updated.
- Kicked player’s facing may remain unchanged; this rule is fixed in class/game version.
- No immunity window.
- Environmental state is checked after displacement.
- Cooldown starts only on successful target displacement; empty/blocked attempts may use a short anti-spam rejection policy but do not consume full cooldown unless balance testing selects otherwise.

## 16. Class ability dispatch

The program uses a closed enum and versioned parameter accounts, not arbitrary script data.

Every ability handler enforces:

- Allowed class/version for run.
- Ready timestamp.
- Valid bounded args.
- Target/range/sector accounts.
- Occupancy invariants.
- Locality and maximum duration.
- No direct death mutation.

Initial handlers:

- Dash: sequentially validate up to two forward destinations; final rule determines whether partial movement is allowed. Recommended: all-or-nothing.
- Shield: one environmental collision absorption before expiry; forced movement still applies.
- Anchor: ignore forced movement while active; does not prevent hazards.
- Ram: directional multi-tile push with every intermediate/destination checked.
- Hook: pull one target toward caster if destination valid.
- Acrobat: leap one blocker, land exactly two tiles away if free.
- Trapper: bounded slow effect in one local tile/sector.
- Phantom: bypass one static blocker but cannot share occupied tile or ignore hazards at landing.
- Switcher: atomic position swap between valid nearby active players.
- Engineer: bounded local lane phase/speed modifier with minimum safety constraints.
- Chronomancer: local slow effect for players/hazards, represented as deterministic sector modifier.
- Warden: short local stun; no damage.

No ability can edit ChunkDefinition or permanent world generation.

## 17. Temporary effects

Sector stores a bounded number of effects:

- Effect type
- Origin run/class
- Center/radius within allowed local bound
- Start/end time
- Magnitude capped by class config
- Effect nonce

When slots are full, new effect fails rather than reallocating or evicting unpredictably. Expired slots are reusable. Crank cleanup is optional because validation ignores expired entries.

## 18. Commit policy

Commit triggers:

- New global paid record: immediate checkpoint.
- Chunk reveal: immediate checkpoint.
- Entry spawn success/failure: checkpoint for receipt reconciliation.
- Death/revival success/failure: checkpoint for economic and NFT cleanup.
- DailyBest: periodic batches plus cutoff.
- World closure: final commit and undelegation.

Movement/occupancy/effects do not commit every action.

MagicIntentBundleBuilder is used for commit intents. Deprecated free functions are prohibited.

## 19. Commit sponsorship

Each world has a delegated payer monitored for:

- Balance
- Correct validator fee-vault PDA
- Remaining sponsored quota assumptions
- Top-up status

Top-up uses documented base-layer delegated lamports transfer with fresh salt. No unresolved environment variable or copied PDA seed is used in operations scripts.

## 20. Cutoff and closure

At/after end timestamp:

- All gameplay handlers reject before mutation.
- A scheduled closure task marks WorldHeader Closed.
- Active occupancy sectors may be cleared lazily because all runs are logically terminal, but final record and required economic markers commit first.
- Record commitment is confirmed on base.
- Admin/automation undelegates durable world accounts.
- High-volume disposable sector accounts may follow a documented close/reclaim lifecycle after no economic dependency remains.

If closure crank fails, permissioned admin retry remains available. Cutoff correctness does not depend on timely crank execution because each instruction checks time.

## 21. Subscription model

Clients subscribe to:

- WorldHeader
- Own PlayerRun
- Nearby OccupancySectors
- Nearby TemporaryEffect sectors
- Current/next ChunkDefinitions
- Relevant transaction logs/events

Subscription filters include discriminators and world/sector offsets. Removing the last listener must release the underlying websocket subscription; the existing solsocket listener leak pattern is not carried forward.

## 22. Error and reconnect behavior

- Rejected predicted move: fetch/consume latest run and sector update, correct visual state.
- Websocket gap: compare sequence numbers, refetch subscribed accounts.
- Wrong endpoint: resolve router from WorldHeader again.
- Lost session: wallet-authorized rotation.
- ER service issue: disable new paid admission at base; preserve existing pending/refund state.
- Stale clone/authority: wait for exact owner and session authority, not mere account existence.
- Blockhash duplicate: action envelope uniqueness prevents semantically distinct actions from sharing identical transaction bytes.

## 23. Integration acceptance criteria

- Every writable ER transaction uses co-located delegated accounts.
- Client resolves routing from router status.
- Session cannot spend assets or USDC.
- Concurrent moves cannot create duplicate occupancy.
- Disconnected players remain subject to hazards.
- VRF retry cannot reroll a valid current result.
- Entry/revive cannot activate without authenticated durable payment evidence.
- New record is committed before payout can begin.
- Cutoff rejects actions even if closure automation is late.
- 500-client load target passes measured contention, crank, and latency gates.
