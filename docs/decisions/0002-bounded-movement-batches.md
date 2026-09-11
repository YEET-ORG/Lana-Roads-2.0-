# Bounded movement batches and immediate acknowledgements

The movement queue previously updated its authoritative sequence on websocket
pushes but waited for a 450–1,100 ms retry timer before sending the next input.
It now wakes after each accepted snapshot. Timers are only a recovery mechanism.
Input prediction and the outbox are capped at eight actions. Blocked moves,
forced displacement, death and new attempts reconcile against authority.

`move_batch(attempt_nonce, action_seq, directions, uniq)` accepts one to four
cardinal steps. The instruction reuses the existing movement accounts and
validation. It changes no account layouts, IDs, economic rules or session scopes.

- A batch stays inside one 8×8 sector and one chunk. The client splits at a
  boundary and uses the existing single-move instruction to cross it.
- Each step validates occupancy, terrain, hazards, session, attempt and sequence.
  Blockage consumes a turn-in-place and stops the batch. Death stops immediately;
  the lethal row is not scored. Other players' occupancy is never overwritten.
- Available movement comes only from elapsed ER slots. The budget is capped at
  four intervals; slow effects cost two slots per step. There is no client clock
  or timestamp and a newly spawned run has no saved credit. A batch may accept a
  shorter prefix when its budget runs out.
- This deliberately permits a bounded catch-up burst at execution time. Hazards
  use the current authoritative clock for every tile, rather than replaying
  historical positions. Credit is not backdated hazard simulation. A single
  move consumes through the current slot, preserving its previous cadence.
- Run action sequence acknowledges the accepted prefix. Retrying the same
  envelope cannot move twice. Invalid envelopes or accounts roll back the
  transaction. Empty/oversized batches and invalid direction bytes are rejected.

Movement still writes WorldHeader because environmental death decrements its
active-player count. This remains a shared write bottleneck. Batching reduces
transaction overhead but does not prove 500-player capacity; that requires an
ER contention/load test and potentially a separately designed count partition.

## Verification and rollout

Local tests: Rust cadence/property cases, SDK grouping and signed transaction
encoding, and `program/tests/movement-batch.ts` against the compiled SBF binary
in LiteSVM. The latter checks occupancy, fatal prefix stopping, rate budgets,
replay, cutoff, session envelopes, bad accounts and single-move compatibility.
It also reports compute units for a four-step batch versus four single moves.
These are local execution measurements, not live network latency measurements.

Verified locally on 2026-09-11: 64 Rust tests, 26 SDK tests and 22 compiled-SBF
checks pass; strict Clippy, SDK/web typechecks and the devnet web build pass.
The four-step batch used approximately 57.8k CU versus 203.8k CU for four single
moves (about 72% less compute), with small fixture-dependent PDA cost variation.
The two-player test confirms that a second signed player cannot take an occupied
tile. Full browser/ER load and latency measurements remain a rollout check.

The web client's batch flag defaults off: `VITE_MOVE_BATCHES=true`. Upgrade the
matching Crossy World program and verify that the target MagicBlock rollup has
the new code before enabling it. Then rebuild SDK and web (Vite mode `devnet`)
and publish with the existing Wrangler configuration. Immediate acknowledgement
and bounded prediction work with the currently deployed single-move contract.

For example, after verifying the program upgrade, in PowerShell at repo root:

```powershell
pnpm --dir packages/crossy-world-sdk build
$env:VITE_MOVE_BATCHES = 'true'
pnpm --dir apps/web exec vite build --mode devnet
npx wrangler deploy --config apps/web/wrangler.jsonc
Remove-Item Env:VITE_MOVE_BATCHES
```

Before rollout, verify two clients on the same region: held movement, alternating
directions, contention for one tile, crossing sectors, Kick while moving, death,
reconnect and session displacement. Observe authoritative acceptance latency and
remote movement while checking sequence progress, not just returned signatures.
