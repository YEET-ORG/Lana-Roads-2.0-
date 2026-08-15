# ADR 0001: V1 program implementation decisions

**Date:** 2026-08-12
**Status:** Accepted (implementation of the approved spec suite)

Decisions made while implementing `programs/crossy-world`, with the spec
invariants they preserve and the follow-ups they require.

> **2026-08-15 implementation update:** Sections 1, 8, and 10 preserve the
> historical state of the first prototype. The current code no longer trusts
> a configured `vrf_authority`: chunk and gacha requests use MagicBlock scoped
> VRF (`#[vrf]` + `#[vrf_callback]`) through `ephemeral-rollups-sdk 0.16.2` and
> `ephemeral-vrf-sdk 0.4.1`. The current release baseline is documented in
> [`../DEPLOYMENT_READINESS.md`](../DEPLOYMENT_READINESS.md). A fresh
> program ID must pass real devnet chunk and gacha callback smoke tests before
> paid flows are enabled.

## 1. Randomness transport: configured `vrf_authority` signer

The spec requires MagicBlock VRF with `#[vrf]`/`#[vrf_callback]` binding.
V1 implements the full _authorization and state machine_ — request
generations, (day, chunk index, generation) and (pull, generation) binding,
idempotent duplicate rejection, permissionless timeout retry that
invalidates prior generations, never-reroll — behind one authenticated
callback identity stored in `GlobalConfig.vrf_authority`. The transport
(who signs the callback) is thus swappable: pointing `vrf_authority` at the
ephemeral-vrf program identity (available via
`ephemeral_rollups_sdk::vrf` = `ephemeral-vrf-sdk 0.4.1`) or an interim
oracle worker requires no state-machine changes.

**Gate:** real MagicBlock VRF transport must be wired and devnet-verified
before mainnet (testing/security spec §9). Until then the vrf key holder is
trusted for randomness _liveness and value_; all binding/no-reroll rules
are still program-enforced.

## 2. Metaplex Core CPIs are hand-rolled in `external/mpl_core.rs`

The `mpl-core` crate's Anchor feature would pin a conflicting anchor-lang
version against the workspace's Anchor 1.x (resolved 1.1.2). Instruction
bytes (discriminators, Borsh layouts for FreezeDelegate/TransferDelegate
plugins, CreateV2, TransferV1) are built manually in one isolated module.

**Gate:** byte-level verification against mpl-core on devnet before any
NFT flow ships; swapping to the official crate is a one-file change.

## 3. `claim_record` is decoupled from movement

Writing `WorldHeader` on every accepted move would serialize 500 players on
one account — exactly the hot-account pattern the specs prohibit. Movement
writes only run + sector(s) + the wallet's own `DailyBest`; a separate
permissionless `claim_record` propagates a strictly-greater score into the
world record. Equal scores can never replace the incumbent (enforced in
`claim_record`); the SDK auto-fires it when the local score beats the
observed record, and any crank can sweep laggards.

## 4. Worlds are born `Open`; time gates authority

`prepare_day` creates world headers already `Open`. Every gameplay
instruction independently enforces `start_ts <= now < end_ts` from the
authoritative clock, and paid admission additionally requires
`DailyCompetition` to be `Open`ed by readiness reconciliation. This avoids
an extra write to already-delegated accounts at day start; the hard cutoff
never depends on any automation.

## 5. Temporary-effect locality is sector-scoped

Trap/TimeSlow/AreaStun/LaneShift effects live in one sector's bounded slots
and apply to tiles of that sector only (radius ≤ 2). Stun zones immobilize
movement; run-level timed statuses (stun/slow/shield/anchor) gate all
actions. Full slots reject placement rather than evict.

## 6. Same-account passing uses Anchor optional accounts

Anchor rejects duplicate mutable accounts, so `dest_sector` (movement,
kick, abilities) and `target` (abilities) are `Option<...>` — `None` means
"same as source/caster". The SDK derives this automatically.

## 7. Dependency resolution note

`anchor-lang = "1.0.2"` resolves to 1.1.2 (semver): `CpiContext::new`
takes a program id, `Context` has a single lifetime. Toolchain: Solana CLI
4.2.0 (agave), Anchor CLI 1.0.2, `ephemeral-rollups-sdk 0.16.2`. All
sizable Anchor accounts are boxed — SBF's 4KB stack frame overflows
otherwise (the build surfaces this only as warnings; treat any
`Stack offset ... exceeded` in `anchor build` output as a release blocker).

## 8. V1 test coverage status

- 34 Rust kernel unit tests (day/cutoff, revive doubling + overflow, splits,
  spawn scan, chunk generation bounds, hazard windows, unbiased sampling,
  largest-remainder redistribution, pity).
- 25 base-suite integration tests on a local validator
  (`tests/crossy-world.ts`): config, rotation, pause,
  season/banner/variant/class + negatives, starter, day prep, entry
  receipts, deterministic spawn + occupancy, movement + sequence + session
  negatives, tile contention, record strict-improvement, gacha
  request/assign/pity/refund guards, vault conservation.
- 12 NFT/gameplay E2E tests against the REAL mpl-core binary dumped from
  devnet (`tests/crossy-nft.ts`): collection under the mint-authority PDA,
  gacha claim (CreateV2), lock (AddPluginV1), thaw (UpdatePluginV1),
  re-lock, marketplace list/sell with delegate TransferV1 + exact 90/10,
  post-transfer re-approve (ApprovePluginAuthorityV1), spawn with an
  NFT-bound class, Sprinter Dash + cooldown, Kick + cooldown, chunk
  request/reveal with generation binding, hazard death via `check_hazard`,
  and a 10-USDC revival preserving score. This retires the "byte-level
  verification pending" caveat of §2 for the covered instructions.
- 5 compressed-clock lifecycle tests on solana-bankrun
  (`tests/crossy-lifecycle.ts` via `tests/run-lifecycle.ts`): cutoff at
  end_ts - 1 / end_ts, close -> commit -> settle with exact 90/10,
  no-winner full-pool rollover + consume, void + idempotent exact refunds,
  gacha five-minute timeout refund + late-callback generation rejection,
  expire-revival guards, and per-day vault conservation.
- 6 SDK golden-vector tests mirroring the kernel.

Bugs found and fixed by these suites: re-locking previously failed
(AddPluginV1 on an existing plugin), buy_listing previously transferred via
the freeze delegate (impossible — TransferDelegate now approved at listing),
never-spawned locks could strand NFTs (unlock now accepts world-cutoff
evidence), and no-winner settlement was unexecutable (winner_token owner
constraint unsatisfiable for the default pubkey).

Not yet covered (next phases): real ER delegation/commit/undelegation and
VRF transport on devnet, load/soak gates, remaining ability handlers
(Shield/Anchor/Ram/Hook/Leap/Phase/Swap/effects are implemented but only
Dash is E2E-tested).

## 9. Testing infrastructure notes

- The NFT suite requires a fresh validator ledger per run (config is a
  singleton) with mpl-core preloaded:
  `solana program dump CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d mpl_core.so -u devnet`
  then `--bpf-program <id> mpl_core.so`.
- litesvm was abandoned for the lifecycle suite: 0.8 corrupts its VM after
  executing the bundled ATA program before an SBF program, and 1.3 aborts
  (std::bad_alloc) after warp/init sequences. solana-bankrun executes the
  agave-4.2-built program reliably; the suite runs through a standalone
  tsx runner with a hard process.exit (native finalizer workaround).
- umi defaults to finalized commitment: test clients must pass
  "confirmed" or reads race the just-confirmed writes.
- Release profile uses `opt-level = "z"` (1.14MB .so, ~8 SOL devnet deploy
  rent vs 10.3 at opt 3) with the sha3/keccak dependency chain pinned back
  to `opt-level = 3` — under "z" its array code exceeds the SBF 4KB stack
  frame. All suites re-verified against the size-optimized artifact.

## 10. Devnet deployment and verification (2026-08-12)

Deployed to devnet as `GmwqXaYeTxukFCfnSwHiipYnY1mC6z9u8f7rAXjc62uX`
(upgrade authority `CKU3...Fn7H`, slot 483309393, tx `2QAL5Wr5...aBkEN2`).

- `tests/crossy-nft.ts` (`pnpm test:crossy-devnet`): **12/12 against the
  live deployment and the real on-chain mpl-core** — collection creation,
  gacha claim mint, freeze/thaw/re-lock, marketplace sale with delegate
  transfer + exact 90/10, post-transfer re-approve, NFT-class spawn, Dash,
  Kick, chunk VRF reveal, hazard death -> 10 USDC revival.
- `tests/crossy-er.ts` (`pnpm test:er-devnet`): **5/5 against the real
  MagicBlock devnet ER** (`devnet-as.magicblock.app`, validator
  `MAS1...zk57`): world + 16 sectors + run + best delegated (base owner ->
  delegation program, ER clone owned by this program), casual spawn on the
  ER reading the base-cloned agent lock, three session moves accepted at
  519-689 ms round trip from the test host, `commit_state` reflected
  byte-exact on base while still delegated, and undelegation returning
  ownership with ER progress preserved.

This retires the "real ER delegation/commit/undelegation untested" gap.
Still open before mainnet: real MagicBlock VRF transport (callbacks still
authenticated against the configured `vrf_authority` key), commit
sponsorship/fee-vault wiring, load/soak gates, audits, and legal review.

## 11. Program identity retired and redeployed (2026-08-15)

`GmwqXaYeTxukFCfnSwHiipYnY1mC6z9u8f7rAXjc62uX` was **closed** and the program
redeployed as `AuCk8jXEWWDiSunY5LgdmjR1p2qFB9vESCyNtMj6qWha`. Section 10 above
is kept as the historical record of the retired deployment; that ID is burned
and its 386 accounts are abandoned.

An in-place upgrade was not available. Account layouts and PDA seeds changed
incompatibly (`u16` → `u32` row/score counters, so `chunk` and `sector` seeds
derive differently), `GlobalConfig` is created with `init` and already
existed, and `vrf_authority` → `validator` is a same-size field swap that an
upgrade would silently reinterpret as an ER validator identity. Closing the
old program reclaimed 8.31 SOL, which paid for the new one.

This also retires the VRF gap named at the end of section 10: chunk reveal and
gacha assignment now use MagicBlock scoped VRF (`#[vrf]` request,
`#[vrf_callback]` delivery) instead of a configured `vrf_authority` signer.
No admin or caller supplies randomness any more. See
`docs/DEPLOYMENT_READINESS.md` for the artifact record and the gates that
remain.
