# Crossy World build context

## Product

Contract-first realtime multiplayer grid game using Solana and MagicBlock Ephemeral Rollups. The ER is authoritative for active world/run/sector state; immutable chunk definitions are published on base and consumed by the ER and clients.

## Current debug session

- Issue: the live map could end at the player's row and the character could disappear after restarting; casual play also depended on a new UTC-day world.
- Scope: `apps/web` map bootstrap/revive ordering and persistent casual routing, the frontier keeper's world-day handling, and contract-level persistent casual semantics.
- Status: resolved locally, built, tested, and visually verified against the live devnet casual world.
- Last debug session: 2026-09-17.
- Issues resolved:
  - Error: gameplay/map subscriptions remained on a pre-router ER connection. Cause: asynchronous retarget race and cleanup through the mutable replacement connection. Fix: gate gameplay on routing and track raw subscriptions against their source connection.
  - Error: map chunks could be stale/missing. Cause: immutable base-published chunks were read through the ER program. Fix: base-plane reads and base websocket subscriptions.
  - Error: a transient missing chunk produced permanent map holes. Cause: the loader continued and advanced its cursor. Fix: contiguous ordered loader with push-assisted retry.
  - Error: obstacle animation could rewind. Cause: the HTTP slot seed raced newer websocket slots. Fix: monotonic slot acceptance.
  - Error: restart could render only the player. Cause: the run bootstrap could succeed while the independent world-header read missed, leaving no chunk target; existing-state subscriptions do not replay. Fix: derive the minimum map range from every valid run, batch cold map reads, and use a validated revealed ER fallback when base is unavailable.
  - Error: automatic chunk generation process stayed alive but produced no chunks. Cause: the clean worker lacked the ignored target IDL, hard-coded the wrong MagicBlock validator, treated decode failures as missing worlds, and swallowed day-setup failures. Fix: tracked SDK IDL, on-chain validator discovery, raw existence checks, fatal compatibility errors, health endpoint, and restartable Docker worker.
  - Error: current devnet world fails with `Invalid bool: 114`. Cause: its 145-byte legacy account layout does not match the current IDL. Fix: fail loudly and require a fresh or explicitly migrated world after redeployment.
  - Error: at row 15 the terrain could end beneath the player even though the live world already had 208 revealed rows. Cause: the client initially requested no runway and a valid run only raised the target through its current row; a missed world-header read therefore loaded only chunk 0. Fix: always request the spawn chunk plus the ten-chunk gameplay runway, extend the target from each run, and refresh it from the world header before every ordered batch.
  - Error: after a death/restart the camera returned to spawn but the character sometimes vanished. Cause: authoritative positioning ran while `PlayerRig` was still dead, and the rig intentionally rejects corrections in that state; reviving afterward left its mesh on the old death tile. Fix: revive active attempts before applying their authoritative position.
  - Error: casual free play required a new world every UTC day. Cause: both Home and the keeper selected casual by wall-clock day. Fix: pin casual to persistent devnet day `20713` (configurable with `VITE_CASUAL_DAY` / `CASUAL_DAY`) while retaining daily paid worlds.
  - Error: a persistent or historical world's frontier could stop extending after UTC rollover. Cause: `extendFrontier` discarded the selected world's day and rebuilt its chunk PDA using the current day. Fix: pass the selected world day through the complete keeper pipeline.
  - Error: paid and persistent-casual frontiers could not safely use different days. Cause: every frontier pass initialized sectors for both mode PDAs using one day. Fix: prepare occupancy only for the world whose frontier is being advanced.
  - Error: pinning the client and keeper to one casual world was insufficient because the program still rejected gameplay/frontier writes at that world's original `end_ts`, and settlement could close it. Fix: make cutoff enforcement paid-only, reject casual close instructions, require committed terminal state for casual NFT unlocks, and settle only paid worlds.
  - Regression coverage: Rust verifies paid/casual cutoff semantics; the LiteSVM SBF test executes the real `move_batch` instruction at the cutoff and proves casual succeeds while paid returns `CutoffPassed`.
