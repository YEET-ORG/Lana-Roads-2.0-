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
