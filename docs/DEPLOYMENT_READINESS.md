# Crossy World deployment readiness

**Reviewed:** 2026-08-15
**Deployed to devnet:** 2026-08-15
**Scope:** `programs/crossy-world`, generated IDL/SDK, realtime map synchronization, keeper, settlement automation, and current web integration.

## Decision

The source is a **devnet release**, not a mainnet release. It is now deployed
to devnet under a fresh program identity. Real MagicBlock VRF and ER lifecycle
smoke tests remain mandatory before enabling any paid entry, revival, gacha,
or marketplace flow.

## Deployment identity

The program was redeployed under a new identity because account layouts and
PDA seeds changed incompatibly:

```text
AuCk8jXEWWDiSunY5LgdmjR1p2qFB9vESCyNtMj6qWha   (live)
GmwqXaYeTxukFCfnSwHiipYnY1mC6z9u8f7rAXjc62uX   (closed 2026-08-15, ID burned)
```

The earlier review recorded a local deployment keypair of `8F9V...` and
treated that as the blocker. That was an artifact of the reviewing
environment: `program/target/` is gitignored, so `anchor build` mints a
throwaway keypair there on any machine that has not deployed. The committed
identities were self-consistent, and `CKU3...` held the upgrade authority.

The real obstacle to upgrading in place was **account collision**. `Gmwq...`
owned 386 live accounts at PDAs the new code must create:

```text
AgentLock 180 · PlayerProfile 101 · ChunkDefinition 25 · OccupancySector 24
VariantInventory 13 · WorldHeader 7 · PlayerIdentity 7 · ClassConfig 5
PlayerRun 5 · DailyBest 4 · DailyCompetition 4 · … · GlobalConfig 1
```

Two of those are decisive:

- `GlobalConfig` existed at 278 bytes and `InitializeConfig` uses `init`, not
  `init_if_needed`. An upgraded program could never initialize it.
- `vrf_authority` → `validator` is a same-size field replaced at the same
  offset. An in-place upgrade would not error; it would silently reinterpret
  the retired randomness key as the ER validator identity and pass it to the
  delegation program.

Closing `Gmwq...` reclaimed `8.31406104` SOL, which funded the new deployment.
Its 386 accounts, and any test USDC held in its vault PDAs, are permanently
abandoned — intended, since no state is carried forward.

## Deployed artifact

```text
program/target/deploy/crossy_world.so
size:   1,311,520 bytes
sha256: 9cf547e8bfe6f682641d0d4873aa3b5c2e0bee48d69a3db2e4c4d4d2e6a633c5

program id:      AuCk8jXEWWDiSunY5LgdmjR1p2qFB9vESCyNtMj6qWha
programdata:     HNiS8FeLmVY25LNRMCECSSk9ZpvJ8NU3ugRjNXg12Gg3
upgrade auth:    CKU3bNrxCWm2kbKNWDdLXvJWuqBumAq8GscentVNFn7H
allocated:       1,450,000 bytes (~138 KB upgrade headroom)
deploy slot:     484032842
deploy tx:       552Ujr19MmR8seDn73JKYCMKiWtWXr2oiev5voKLiHNGkdTsjzH5xySJKHmeHpSGEmy9XSA1juvEDaw6wyhH96Jx
```

Verified after deployment: the first 1,311,520 bytes of `solana program dump`
hash to the same sha256 as the local artifact.

The checksum differs from the pre-deployment candidate
(`882dff63...`) only because `declare_id!` is compiled into the binary. Under
the retired ID, the same source produced `882dff63...` on two independent
machines, so the build is reproducible.

Recompute size and sha256 immediately before any future deployment. Any
rebuild invalidates this checksum.

## Security and correctness baseline

### Realtime world and map

- Chunk definitions are immutable base-layer accounts.
- Live world/run/occupancy state is read from the ER first.
- `state_seq`, `map_seq`, chunk index/hash, and contiguous snapshot loading
  detect missed subscriptions and restart gaps.
- The keeper checkpoints the live world to base before a base-layer chunk
  request and after frontier extension.
- The JIT condition is exact: request one next chunk when
  `record_score + 8 >= revealed_rows`.
- The contract rejects skipped indices, stale predecessors, early requests,
  stale generations, and unauthenticated callbacks.
- A restart rebuilds the visible map from chunk zero through the contiguous
  revealed frontier; a propagation hole closes the frontier instead of
  rendering empty traversable space.

### Movement and multiplayer

- One live player per tile is enforced by atomically updated occupancy sectors.
- Static blockers and occupied player tiles prevent movement.
- A blocked in-bounds intent still rotates the player toward the requested
  direction, enabling Kick without changing position, score, cooldowns, or
  hazard schedule.
- Accepted actions use exact action sequencing and attempt/session binding.
- Session keys expire consistently for movement, revive, and voluntary end.
- Vehicle/log/train state is derived from immutable lane descriptors and
  authoritative ER slot time; it does not require per-frame contract writes.
- World rows, sector rows, chunk indices, attempt scores, daily bests, and the
  winning score use 32-bit counters. The old 65,535-row ceiling is removed;
  V1 now supports more than 4.29 billion rows, far beyond a 24-hour room.

### Payments and settlement

- Only classic SPL USDC with six decimals is accepted; Token-2022 extensions
  cannot invalidate exact accounting assumptions.
- Entry costs exactly 1 USDC and is accepted only while the daily account is
  `Open` and before the UTC cutoff.
- Revival starts at 10 USDC and doubles with checked arithmetic.
- ER activation verifies the canonical program-owned receipt PDA plus exact
  owner, run, wallet, day, kind, nonce, state, and amount.
- Receipt races resolve to one consumed receipt; losing duplicates become
  refundable.
- Unresolved receipts become refundable only after a final world commit or a
  void, when no later gameplay action can consume them.
- Vault liabilities use checked arithmetic and require solvency. Unsolicited
  SPL deposits are harmless surplus and cannot grief settlement.
- A void refunds same-day consumed contributions while preserving inherited
  rollover for the successor day.
- Settlement uses permanent `DailyBest`, strict improvement, a 90/10 split,
  fixed destinations, and admin-triggered execution.
- Only the world's recorded commit payer can close it. The settlement script
  audits every paid-world `DailyBest`, claims the strict maximum, then closes,
  commits, undelegates, records the final commit, and settles.

### Gacha and NFTs

- Seasons are configured in advance and frozen by a one-way activation.
- Activation proves all three banners, four non-empty rarity pools, total
  variant count, and canonical weights commitment.
- Paid pulls use MagicBlock scoped VRF; no admin or caller supplies randomness.
- One pending pull per profile prevents pity-counter reuse.
- Pity guarantees Epic on pull 10 and Legendary on pull 100.
- Variant selection uses the immutable catalog. A concurrently sold-out exact
  result refunds and never rerolls.
- Randomness-ready pulls can be refunded after the objective timeout if
  assignment automation stalls.
- Assignment reserves supply and advances pity atomically.
- NFT claim requires an active reservation and a URI whose SHA-256 matches the
  configured immutable metadata commitment.

## Verification completed for this candidate

- `cargo check -p crossy-world`: pass.
- `cargo test -p crossy-world --lib`: **58 passed**.
- `cargo clippy -p crossy-world --lib -- -D warnings -A unexpected-cfgs`: pass.
  (`unexpected_cfgs` originates in the Anchor/Solana entrypoint macro.)
- `anchor build --ignore-keys`: pass for both workspace programs; no SBF stack
  overflow warning.
- Program TypeScript integration suite typecheck: pass.
- Keeper/open/settlement/gacha/map-status script syntax check: pass.
- SDK typecheck/build: pass.
- SDK realtime and golden-vector tests: **22 passed**.
- Web TypeScript check and production Vite build: pass.
- `git diff --check`: pass; only platform line-ending notices were emitted.

The frontend build emits a non-blocking performance warning for a roughly
1.52 MB minified game bundle. Code splitting is recommended before production,
but it does not affect contract correctness.

## Mandatory fresh-deployment sequence

1. ~~Freeze the intended commit and ensure the worktree contains no unknown
   generated or private files.~~ **Done.**
2. ~~Choose the program ID path above and make source, Anchor, generated IDL,
   SDK, environment files, and deployment keypair agree.~~ **Done** — 20 files
   carried the program ID; `.env.devnet` does not (the web app reads the SDK
   constant).
3. ~~Re-run formatting, Rust tests, strict Clippy, Anchor SBF build, SDK tests,
   program TypeScript check, and web production build.~~ **Done, twice** —
   before the ID change and again after.
4. ~~Record the candidate `.so` size and SHA-256.~~ **Done.**
5. ~~Deploy to devnet with a dedicated devnet authority and valueless/test
   USDC.~~ **Done.**
6. Initialize config with the exact USDC mint, treasury, collection, validator,
   and player caps. Verify every value by reading the account back.
   **Outstanding, and blocking everything below.** There is no operator script
   for `initialize_config` — only the integration tests call it. The chain
   currently holds a deployed program and zero accounts, so nothing runs until
   a bootstrap script exists.
7. Seed and activate a future season; independently recompute the weights hash
   before activation.
8. Prepare a fresh UTC day, delegate both worlds and sectors, mark spawn ready,
   then open the daily account.
9. Run real scoped-VRF smoke tests for both gacha and a JIT map chunk. Confirm
   callback authentication, generation binding, persisted result, and timeout
   behavior.
10. Run an ER smoke lifecycle: two clients, contention, blocked rotation, Kick,
    hazard death, paid revival, disconnect/restart map reconstruction, commit,
    undelegate, and base-state equality.
11. Run a compressed full-day lifecycle: entries, duplicate receipt race,
    winner sweep, hard cutoff, 90/10 settlement, no-winner rollover, void, and
    exact refunds.
12. Keep paid feature flags disabled until all smoke signatures and resulting
    account snapshots are reviewed.

## Mainnet gates still open

- Independent Solana/Anchor security review of the final program ID and binary.
- **Player-electable rerolls during an assignment outage.** Once VRF lands,
  `pull.randomness` is public and the selection is fully derivable off chain,
  yet `refund_pull` accepts a `RandomnessReady` pull after the 300 s timeout.
  A player can therefore compute the outcome and refund only the bad ones.
  This is closed in practice because `assign_pull` is permissionless and fires
  immediately, so the exposure window is exactly an assigner outage — but the
  timeout exists to survive that outage, which is when the hole opens. Either
  restrict post-randomness refunds to an authority, or make an expired
  `RandomnessReady` pull assignable by anyone before it becomes refundable.
- Real MagicBlock VRF callback verification against the fresh deployed binary.
- Sustained ER load and soak at the intended 500-player cap, including websocket
  reconnect storms and keeper failover.
- Operational rehearsal of admin loss/unavailability, RPC/ER outage, delayed
  callback, stuck receipt, stuck NFT lock, and settlement failure.
- Monitoring for frontier distance, callback age, commit lag, pending receipts,
  liability deficits, and cutoff/settlement completion.
- License/legal release check for every redistributed game asset and NFT
  metadata object.
- Production key custody. The V1 single-admin design is an explicit
  availability and compromise risk; migrate to multisig in V2 as planned.

Passing local tests is evidence, not an audit. Do not describe this contract as
"foolproof" or enable real-money mainnet play until the external gates above
are complete.
