# Crossy World deployment readiness

**Reviewed:** 2026-08-15
**Scope:** `programs/crossy-world`, generated IDL/SDK, realtime map synchronization, keeper, settlement automation, and current web integration.

## Decision

The current source is a **devnet release candidate**, not a mainnet release.
It builds and its local verification suite passes, but it must not be deployed
until the program identity is made consistent. After deployment, real
MagicBlock VRF and ER lifecycle smoke tests are mandatory before enabling any
paid entry, revival, gacha, or marketplace flow.

## Current deployment identity blocker

All compiled source/config/client identities currently declare:

```text
GmwqXaYeTxukFCfnSwHiipYnY1mC6z9u8f7rAXjc62uX
```

The local deployment keypair resolves to:

```text
8F9VppM5M7JvoErFz2ucdGxo8YJzGZDdvdoenejru3sT
```

These identities are not interchangeable. Deploying the binary under the
local keypair without synchronizing `declare_id!`, Anchor, IDL, and SDK would
break PDA derivation and must not be attempted.

The existing devnet `Gmwq...` program currently has:

- upgrade authority `CKU3bNrxCWm2kbKNWDdLXvJWuqBumAq8GscentVNFn7H`;
- allocated data length `1,194,376` bytes;
- current candidate binary size `1,311,520` bytes.

Therefore choose exactly one path:

1. **Upgrade `Gmwq...`:** use the matching `CKU3...` authority and extend the
   program account by at least `117,144` bytes before upgrade.
2. **Fresh deployment (recommended during active development):** adopt
   `8F9V...`, run `anchor keys sync`, regenerate IDL/types, update the SDK
   constant and every environment manifest, then repeat all checks in this
   document.

Do not reuse any existing accounts after the fresh deployment. Account layouts
and instruction surfaces changed intentionally and backward compatibility is
not supported at this stage.

## Candidate artifact

```text
program/target/deploy/crossy_world.so
size:   1,311,520 bytes
sha256: 882dff63cdc756b95b5ff96c41fd18a1b5fac51d8ac89b6c60a4116b9697d866
```

Recompute and record both values immediately before deployment. Any rebuild
invalidates this checksum.

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

1. Freeze the intended commit and ensure the worktree contains no unknown
   generated or private files.
2. Choose the program ID path above and make source, Anchor, generated IDL,
   SDK, environment files, and deployment keypair agree.
3. Re-run formatting, Rust tests, strict Clippy, Anchor SBF build, SDK tests,
   program TypeScript check, and web production build.
4. Record the candidate `.so` size and SHA-256.
5. Deploy to devnet with a dedicated devnet authority and valueless/test USDC.
6. Initialize config with the exact USDC mint, treasury, collection, validator,
   and player caps. Verify every value by reading the account back.
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
