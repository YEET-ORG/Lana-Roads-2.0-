# Crossy World build context

## Product

Contract-first realtime multiplayer grid game using Solana and MagicBlock Ephemeral Rollups. The ER is authoritative for active world/run/sector state; immutable chunk definitions are published on base and consumed by the ER and clients.

## Current debug session

- Issue: clients report server map synchronization problems and need realtime map updates.
- Scope: `packages/crossy-world-sdk` subscriptions/routing and `apps/web` ordered chunk loading/reconciliation.
- Status: resolved locally and read-only probed on devnet.
- Last debug session: 2026-08-15.
- Issues resolved:
  - Error: gameplay/map subscriptions remained on a pre-router ER connection. Cause: asynchronous retarget race and cleanup through the mutable replacement connection. Fix: gate gameplay on routing and track raw subscriptions against their source connection.
  - Error: map chunks could be stale/missing. Cause: immutable base-published chunks were read through the ER program. Fix: base-plane reads and base websocket subscriptions.
  - Error: a transient missing chunk produced permanent map holes. Cause: the loader continued and advanced its cursor. Fix: contiguous ordered loader with push-assisted retry.
  - Error: obstacle animation could rewind. Cause: the HTTP slot seed raced newer websocket slots. Fix: monotonic slot acceptance.
  - Error: restart could render only the player. Cause: the run bootstrap could succeed while the independent world-header read missed, leaving no chunk target; existing-state subscriptions do not replay. Fix: derive the minimum map range from every valid run, batch cold map reads, and use a validated revealed ER fallback when base is unavailable.
