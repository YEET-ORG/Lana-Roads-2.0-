Original prompt: please check the codebase and all , check everything , we are having some issues with server map sync , we wanna make it realtime , please fix

## 2026-08-15 map synchronization investigation

- Tracing authoritative chunk publication, ER frontier updates, SDK subscriptions, and frontend rendering.
- Initial finding: the frontend chunk loader can advance its `loadedChunks` cursor past a chunk that temporarily failed to load, leaving permanent holes in the rendered map.
- Initial finding: live chunk definitions are published and remain on the base layer, while the SDK `getChunk` reader currently queries only the ER program connection.
- Root cause: router resolution could replace `erConnection` after raw gameplay/slot subscriptions had already attached to the old ER; their cleanup also targeted the replacement connection.
- Fixed: router resolution gates both paid and casual gameplay, raw subscriptions capture/close their source connection, chunk reads/subscriptions use base, and the frontend drains chunks contiguously with push-assisted retry.
- Fixed: stale/racing slot seeds can no longer rewind deterministic hazard animation.
- Verified: 20 SDK tests, SDK/web typechecks, production web build, browser gameplay screenshot, and a read-only live devnet routing/account-plane probe.
- TODO: run the funded two-browser devnet movement test when a disposable funded test identity is available; no write transaction was sent during this investigation.

## 2026-08-15 blank-map restart follow-up

- Symptom: after some reloads only the player appeared.
- Cause: own-run and world-header bootstrap reads are independent. A run could render while a transiently missed world header left `wantedChunks` at zero; subscriptions only emit future changes and therefore did not replay the existing frontier.
- Fixed: every valid run seeds map loading through its current row, the world header still expands to the full frontier, and cold-start chunks are fetched as bounded consistent base-layer batches.
- Resilience: base remains preferred, with a strictly bound revealed-chunk fallback from the router-selected ER when the public base RPC is throttled.
- Verified against live devnet with 20 repeated cold snapshots of all six revealed chunks (96 rows); zero missing chunks in every attempt.

## 2026-08-15 gacha pack-opening UI

- Added all three contract banner tiers to the pack shop instead of hard-coding tier 0.
- Added live USDC balance, banner odds/inventory, and independent Epic/Legendary pity progress per tier.
- Added a mobile-first animated voxel crate sequence for payment and MagicBlock VRF assignment.
- Added a real Three.js preview of the exact pulled gameplay GLB in reveal and minted states.
- Added recovery for pending, assigned, and refundable pulls after closing or refreshing the screen.
- Verified with frontend typecheck and production build.
- Verified with the web-game Playwright client plus custom desktop/390px interaction checks: three tiers render, exactly one remains selected, the sheet has no horizontal overflow, and the claim CTA is visible.
- Visually inspected the shop and Legendary Unicorn reveal screenshots; the real GLB, rarity lighting, confetti, and mobile layout render correctly with no reveal-route console errors.
- Public devnet RPC returned HTTP 429 during the live-account browser pass; run a funded end-to-end purchase after deploying the new program and using a non-rate-limited RPC.

## 2026-08-15 continuous-motion pass

- Removed the unfinished-hop tile-center snap. Chained inputs now retarget from the exact rendered pose with distance-aware timing and continuous height/squash blending.
- Decoupled kick/blocked-move recoil from locomotion, so recoil can overlap a hop without cancelling it or stranding the model between tiles.
- Changed large-correction detection to compare authoritative targets rather than the trailing render mesh, preventing fast legitimate input chains from being mistaken for teleports.
- Replaced per-slot obstacle clock nudges with a phase-locked render clock that preserves measured rollup rate and eases ordinary phase error every animation frame.
- Authoritative facing is now rendered on reconciliation. Blocked player/obstacle moves predict and submit a turn-in-place action so kick direction remains responsive and persistent.
- Added the same blocked-facing behavior to offline practice and a development-only motion probe for frame-level regression tests.
- Verified with frontend typecheck and production build.
- Verified in Chromium with the web-game Playwright workflow: rapid 45 ms chained inputs had a maximum 0.218-tile frame delta, settled with zero target gap, and emitted no console errors.
- Verified a kick 35 ms into a hop no longer cancels locomotion; it settled exactly at the target with zero gap.

## 2026-08-15 ten-chunk generation lookahead

- Root cause: authority allowed generation only at `leader + 8 >= frontier`, and the keeper generated one 16-row chunk per polling pass. A fast player could reach the closed frontier before VRF, sector creation, delegation, and ER publication completed.
- The contract now permits a bounded contiguous ten-chunk request window and enforces a 160-row lookahead margin. Every request still requires its immediately preceding chunk to be revealed.
- The keeper fills all missing immutable VRF chunks first, then creates/delegates sectors and advances each ER frontier strictly in order. Partial work is resumable and never exposes rows without occupancy accounts.
- The SDK mirrors the ten-chunk constants, and offline practice now preloads rows 0 through 175 at spawn and rolls the same buffer at chunk boundaries.
- Added direct policy tests for fresh-world fill, boundary replacement, catch-up bounds, invalid snapshots, and Rust request-window overflow.
- Verified 60 Rust contract tests, 23 SDK tests, 4 keeper policy tests, program TypeScript, the deployable Anchor build, SDK build, and production web build.
- Verified in Chromium with the required web-game workflow: 176 rows loaded at spawn (`0..175`), the rendered scene remained correct, and no browser console errors occurred.
- Operational requirement: `frontier-keeper.ts` must run continuously; a deployed Solana program cannot autonomously wake up to request VRF or bridge base/ER state.
- Read-only devnet status check found today's ER world account cannot be decoded by the current IDL (`Invalid bool: 114`), proving the currently deployed binary/account layout is stale. Redeployment must use fresh/migrated world accounts before the new keeper can operate.

## 2026-08-15 automatic keeper startup repair

- Reproduced the production keeper entrypoint with an unfunded throwaway signer, so no transaction could alter devnet.
- Root cause 1: the keeper loaded `program/target/idl/crossy_world.json`, but `target/` is ignored and absent from clean worker deployments. It now uses the tracked SDK IDL shared with the frontend, with a regression test for path and program ID.
- Root cause 2: the keeper hard-coded validator `MAS1...`, while deployed `GlobalConfig.validator` is `CKU3...`; startup exited before generation. It now discovers the validator from on-chain config unless an explicit safety override is supplied.
- Root cause 3: a world decode exception was treated as “account missing,” and `rollDay` swallowed its own setup failure. The daemon therefore remained alive while doing no work. It now checks raw account existence, distinguishes missing from incompatible state, propagates setup errors, and exits on fatal IDL/admin mismatches.
- Added a production Docker worker, required secret injection, automatic restart, `/healthz`, root keeper commands, tracked runtime configuration, and Compose validation.
- The current devnet worlds are confirmed incompatible legacy accounts (145 bytes; current decoder fails with `Invalid bool: 114`). This code fix intentionally fails loudly there; a fresh/migrated world after deployment is required.

## 2026-09-11 held-movement pacing

- Root cause: the batching client divided held-key repeat time by four, allowing predicted movement every 60 ms and making the character appear to fly.
- Changed held movement to wait 320 ms before repeating and repeat no faster than every 220 ms. Network batching remains enabled but no longer multiplies gameplay speed; individual presses remain immediate.
- Verified with the required web-game Playwright workflow and a focused browser timing probe: first movement remained immediate, held movement waited over 300 ms, and every subsequent repeat stayed above the 220 ms floor. Gameplay rendered correctly with no console errors.
- Published the client-only update to `lanaroads.mystic.cat` as Cloudflare Worker version `d3535bf3-d84b-4533-9758-a6a17cb811df`; the live JavaScript SHA-256 matches the local production artifact.

## 2026-09-17 persistent casual and atomic join reveal

- Updated contract behavior so casual worlds ignore the original daily cutoff, cannot be closed by daily settlement, and continue accepting gameplay/frontier writes. Paid worlds keep their cutoff unchanged.
- Added a real LiteSVM SBF regression: casual `move_batch` succeeds exactly at `end_ts`, while paid returns `CutoffPassed`.
- Added an opaque joining screen. The world stays hidden and input stays disabled until routing/joining has completed, the authoritative run is active, the player model exists, and the map chunk beneath the player has loaded.
- The same readiness gate now covers retry/respawn, preventing intermediate authoritative corrections from appearing as two or three visible teleports.
- Verified the joining transition in Chromium against the devnet-configured app: the branded screen rendered with the live phase label, the world canvas had computed opacity `0`, and no page errors were emitted. The live guest wallet was unfunded, so the readiness gate's final reveal is covered by the state conditions and build/type checks rather than a funded write transaction.
- TODO: after deploying the persistent-casual program upgrade, run one funded join to confirm the final reveal against the upgraded live account layout.
- Deployed the latest frontend to `lanaroads.mystic.cat` (Cloudflare Worker version `2f315c30-53dc-45fb-8136-0d6f7f1e45d5`). An earlier same-day deploy had built without `--mode devnet`, so the live bundle fell back to localhost RPC and showed "Can't reach the casual world"; `build:devnet` now produces the env-inlined production artifact and the live JavaScript SHA matches it.
