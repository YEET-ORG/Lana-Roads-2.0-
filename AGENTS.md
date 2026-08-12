# AGENTS.md — Crossy World Coding-Agent Guide

> Copy this file to the repository root as `AGENTS.md` when the standalone Crossy World repository is created. Do not install it at the root of the solsocket starter repository.

## Mission

Build Crossy World as a contract-first, real-money multiplayer grid game on Solana and MagicBlock. Preserve player funds, NFT ownership, deterministic gameplay, and recoverability before optimizing convenience or visual polish.

This repository is the standalone Crossy World product. The open-source solsocket project is reference/starter material only. Do not use solsocket program IDs, remotes, package publication identity, credentials, or release history.

## Sources of truth

Read the specification suite before changing architecture or behavior:

1. `docs/specs/crossy-world-design.md` — approved product rules.
2. `docs/specs/contract-economy.md` — durable accounts, payments, NFTs, gacha, marketplace, settlement.
3. `docs/specs/magicblock-integration.md` — realtime accounts, sessions, movement, hazards, VRF, cranks.
4. `docs/specs/frontend-threejs.md` — React/Vite/Three.js UX and rendering.
5. `docs/specs/sdk-indexing.md` — client workflows, subscriptions, indexer boundaries.
6. `docs/specs/testing-security-operations.md` — verification and launch requirements.

When documents conflict, the approved product design wins. The contract specification owns durable money/NFT state; the MagicBlock specification owns active delegated gameplay. Frontend, SDK, indexer, and operator services may project authority but cannot redefine it.

Do not silently invent missing product rules. Record material ambiguities and request a decision before implementing behavior that changes economics, fairness, custody, authority, or NFT value.

## Non-negotiable product invariants

- Paid room runs on fixed UTC days with a hard authoritative cutoff.
- A fresh paid attempt costs exactly 1 USDC.
- Revival prices are 10, 20, 40, 80 USDC and continue doubling with checked arithmetic.
- Death opens a 60-second revival window. A successful revival preserves attempt, score, position policy, agent, and cooldown deadlines.
- Score is the highest row reached by one continuing attempt. A candidate must strictly exceed the incumbent; equal scores never replace it.
- The winner receives 90% and team treasury receives 10%. Program state fixes winner, destinations, and values.
- If no player reaches row 1, the complete pool rolls to the next day without a team cut.
- Casual mode is free, has no revival, no prize pool, and grants gameplay access to every class.
- One live player occupies one tile; movement into an occupied or blocked tile fails.
- Kick is universal: adjacent facing target, one-tile knockback, five-second cooldown, no direct kill credit.
- Collectible classes have one active ability with a versioned 10–30 second cooldown. No ability directly kills a player.
- The starter entitlement is non-transferable and Kick-only.
- Collectible agents are tradable Metaplex Core NFTs. One selected NFT remains locked for the full attempt, including revivals.
- Rarity and cosmetic variant never alter the mechanics of a class. Stronger classes may have higher minimum rarity as explicitly disclosed.
- Gacha randomness uses bound MagicBlock VRF requests. A valid result is never rerolled.
- Epic pity guarantees Epic-or-better after 10 misses; Legendary pity guarantees Legendary after 100 misses, separately per banner.
- Indexers, browsers, RPC responses, session keys, and crank callers are untrusted.

## Architecture boundaries

### Base Solana program

Authoritative for:

- global configuration and pause scopes;
- UTC day lifecycle and durable final record;
- USDC custody, liabilities, receipts, refunds, rollover, and settlement;
- profiles and durable statistics;
- seasons, class versions, variants, supply, pity, and gacha state;
- NFT collection validation, lock/freeze, thaw, and marketplace trades.

### MagicBlock Ephemeral Rollup

Authoritative for active gameplay:

- spawn, position, occupancy, movement, and action sequence;
- deterministic hazards and temporary effects;
- Kick, class abilities, cooldowns, death, and live score;
- live record before its durable commitment;
- delegated account routing and session-authorized actions.

### SDK

Provides typed, narrow workflows. It must not expose generic arbitrary state writes. Financial and NFT workflows return a human-readable transaction review before requesting a wallet signature.

### Indexer and API

Provide leaderboards, history, search, and cached projections. They are disposable and rebuildable. Critical writes reread authoritative accounts and never trust indexed values.

### React/Three.js client

Collects player intent, predicts only safe presentation, renders authoritative state, and explains transactions. It never calculates authoritative scores, payouts, randomness, collisions, or ownership.

### Crank/operator services

Submit bounded, predefined, idempotent work. They cannot invent winners, scores, random results, balances, or destinations.

## Expected repository shape

```text
program/
  programs/crossy-world/       Anchor program
packages/
  crossy-world-sdk/            bindings, workflows, routing, subscriptions
apps/
  web/                         React/Vite/Three.js client
  indexer/                     authoritative ingestion and query API
  crank/                       scheduled and recovery work
assets/
  manifests/                   public optimized asset manifests
VoxelAnimals/                  purchased private Unity Asset Store source pack
docs/
  specs/                       approved specifications
  decisions/                   architecture decision records
tests/
  vectors/                     shared Rust/TypeScript golden vectors
```

Keep modules focused. Avoid monolithic program handlers, SDK clients, React components, scene managers, and operator workers. Separate validation, state transition, external calls, rendering, and projection.

## Contract-first development order

For every feature:

1. Identify the authoritative state and plane.
2. Write or update invariants and shared golden vectors.
3. Add failing Rust/program tests, including invalid-account and concurrency cases.
4. Implement the smallest authoritative instruction/state transition.
5. Generate and inspect IDL and typed bindings.
6. Add safe SDK workflow and transaction review.
7. Add indexer/crank support if required.
8. Add frontend state and rendering last.
9. Run cross-plane recovery and end-to-end tests.
10. Update specifications or decision records when behavior changes.

Do not build a frontend-only simulation and later attempt to retrofit contract authority.

## Solana and Anchor rules

- Use checked arithmetic for money, counters, timestamps, scores, coordinates, supply, pity, and revival doubling.
- Use integer/fixed-point values only in authoritative logic.
- Validate signer, owner, discriminator, data length, PDA seeds/bump, mint, token program, collection, external program ID, and writable relationships.
- Never accept a client-provided winner, score, payout amount, treasury, token mint, class mapping, random result, or receipt status when it can be derived.
- Keep account growth, vectors, strings, batches, iteration, effect slots, and remaining accounts bounded.
- Make asynchronous transitions idempotent and mutually exclusive at terminal states.
- Emit reconstructable events for every economic transition.
- Preserve upgrade/account-layout compatibility through explicit versions and migrations.
- Add negative tests for every account constraint, not only happy-path tests.
- Never add an admin withdrawal path for tracked player liabilities.

## Money and receipt rules

- USDC uses the configured canonical mint and six-decimal integer amounts.
- Every vault unit must belong to a versioned liability category.
- Payment receipt consumption and refund are mutually exclusive.
- Entry/revival activation requires authenticated durable receipt evidence; a client assertion or transaction signature string is insufficient.
- Settlement legs are retryable and cannot exceed the distributable pool.
- Admin may trigger V1 settlement but cannot choose the winner, split, recipients, or amount.
- A pause must not strand otherwise valid refunds unless the refund path itself is unsafe.
- Any unexplained vault/liability difference blocks release and affected financial writes.

## MagicBlock rules

- Resolve active routing from account owner/router state; do not hardcode the ER endpoint as authority.
- All accounts written by one ER transaction must be delegated and co-located as required.
- Session keys are short-lived gameplay authorities. They cannot spend USDC, move NFTs, rotate admin, settle, or upgrade.
- Use action nonces and attempt/session binding to reject replay and byte-identical logical actions.
- Enforce occupancy atomically. Sequencer order resolves concurrent moves; never merge conflicting positions client-side.
- Derive hazards from committed chunk definitions and authoritative ER time.
- Use event/deadline-driven collision checks, not a global writable 500-player frame tick.
- Bind VRF callbacks to request, season, banner/chunk, payer/world, and nonce. Retry must not create a reroll.
- Fail closed at an unrevealed chunk frontier.
- Reject all gameplay at or after authoritative UTC cutoff even if automation is late.
- Commit the final record before settlement can begin.

## Gameplay implementation rules

- A movement action is a cardinal one-tile intent unless a closed, versioned ability handler defines otherwise.
- Never permit two live players on one tile, including spawn, movement, swaps, pulls, pushes, dashes, and revival placement.
- Ability dispatch uses a closed enum and bounded arguments; no uploaded scripts or arbitrary effect payloads.
- Cooldowns use authoritative timestamps and survive disconnect, device change, death, and paid revival.
- Forced movement checks every destination and then reevaluates environmental hazards.
- An ability may cause environmental danger but cannot directly set another player to dead.
- Temporary effects are local, bounded, expiring, and deterministic. Full effect storage fails safely rather than evicting unpredictably.
- Chunk definitions are immutable after valid reveal. Abilities cannot edit permanent world generation.

## Agent and NFT rules

- Program-owned class/variant mappings determine gameplay; off-chain metadata is display-only.
- Every NFT in one class receives identical mechanics and active balance version.
- A cosmetic or rarity edit cannot modify gameplay.
- Class balance updates are created in advance and activate only at a future UTC day boundary.
- Selected assets must belong to the configured collection and current wallet owner, be unlocked, and not be listed.
- Agent locks bind asset, owner, world, and attempt nonce.
- Terminal unlock is permissionless and repeat-safe once committed terminal evidence exists.
- Duplicate gacha results produce separate tradable NFTs; do not add shards.
- Preserve the purchased Unity asset license/invoice privately. Do not commit or publicly distribute raw Unity source files.
- Public game assets are optimized exports such as GLB, textures, thumbnails, and manifests only when the license permits them.

### VoxelAnimals source pack

- Everything under `VoxelAnimals/` is the user-purchased Unity Asset Store voxel-animal pack approved for use in Crossy World.
- Treat the entire directory as licensed private source material, including all `.obj`, `.mtl`, `.png`, `.vox`, `.unity`, `.asset`, `.exr`, and Unity `.meta` files.
- The Crossy World repository must remain private while these raw files are tracked. Do not copy the raw pack to a public repository, npm package, website download, release archive, or public object-storage bucket.
- Do not delete, rename, optimize in place, or overwrite the source pack. Conversion output belongs in a separate generated asset directory.
- Use the source models to build the Three.js agent catalog. All included animals should be inventoried and considered for playable variants; visual duplicates may share one gameplay class.
- Prefer a reproducible conversion pipeline: source OBJ/MTL/PNG or VOX -> normalized scene -> optimized GLB -> optional mesh/texture compression -> thumbnail/preview -> versioned manifest.
- Normalize scale, pivot, forward axis, ground contact, material color handling, shadow settings, and animation anchors consistently across every animal.
- Runtime code loads optimized GLB/manifests, not Unity scenes, `.meta` files, raw `.vox`, or dozens of OBJ files.
- Generated files must record source filename, content hash, converter version, transform settings, output hash, model/variant ID, class ID, rarity, and license provenance.
- Do not infer gameplay class or rarity permanently from a filename. Maintain the approved mapping in a reviewed catalog/manifest and verify gameplay class IDs against program configuration.
- Keep collider and occupancy behavior standardized to the grid regardless of model shape. A larger-looking Legendary animal gets no larger hitbox, reach, speed, or tile advantage unless the approved class rules explicitly say so.
- Cosmetic trails, particles, emissive materials, and rarity effects are separate attachments and must obey frontend performance budgets.
- Before a public deployment, confirm that serving converted in-game assets is permitted by the purchased license and retain private proof of purchase. Never publish the invoice or personal purchase details.

## Gacha rules

- Display exact price, current effective odds, inventory revision, and pity progress before payment.
- Banner prices and base weights are season-immutable after activation.
- Sold-out variants leave eligibility; deterministic weights are recomputed exactly as the program does.
- Pity and supply mutation must remain correct under concurrent callbacks.
- A pull reaches one terminal state: assigned, refundable, or refunded.
- Failed/refunded pulls do not advance pity.
- A valid assigned result cannot be refunded merely because the user dislikes it.
- If required pity inventory is unavailable, pause the affected banner instead of violating pity.

## TypeScript and SDK conventions

- Keep generated bindings separate from handwritten workflows.
- Use explicit domain types for day IDs, raw USDC amounts, world/attempt IDs, action nonces, class IDs, and account versions.
- Centralize PDA derivation, clock calculations, routing, codecs, error mapping, and deterministic helpers.
- Avoid spreading legacy `web3.js` class instances through React state; isolate them behind adapters.
- All subscriptions return an unsubscribe handle. Removing the final listener closes the underlying websocket subscription.
- Sequence-check realtime updates and rebuild state after gaps.
- Financial methods expose preparation/review separately from signature submission.
- Unsupported program/account versions may be read if safe but must block writes.
- Never place wallet private keys, session key bytes, RPC secrets, or bearer tokens in logs/errors.

## React and Three.js conventions

- React owns product/navigation state; the game runtime owns frame-level scene state. Do not rerender React for every remote movement frame.
- Keep the authoritative network snapshot separate from predicted visual state.
- Prediction never increases authoritative score, declares death, consumes cooldown, or decides occupancy.
- Reconciliation uses action sequence/nonce and smooths presentation without hiding rejected actions.
- Dispose geometries, materials, textures, animation mixers, listeners, timers, workers, and subscriptions on scope exit.
- Use instancing, pooling, LOD, frustum/distance culling, and interest management. Do not render all 500 players at full detail.
- Load public assets through a versioned manifest whose gameplay mapping is verified against program configuration.
- Paid and casual modes must remain unmistakable in navigation and transaction UI.
- Show exact transaction consequences before wallet approval, including USDC amount, agent lock, gacha finality, or market royalty.
- Support keyboard, touch, reduced motion, focus visibility, and warnings independent of color.

## Indexer and service rules

- Maintain separate provisional and finalized observations where appropriate.
- Store source signature, slot, account version, sequence, and ingestion status for traceability.
- Make ingestion idempotent and tolerant of replay/out-of-order delivery.
- Never let an API cache authorize a program write.
- Bound crank batches and retry with stable work identifiers.
- Use structured correlation IDs for day, attempt, receipt, pull, VRF request, action, and signature.
- Do not use wallet addresses as unbounded metric labels.
- The indexer must be fully rebuildable from authoritative accounts/events and registered metadata.

## Testing requirements

Changes are incomplete without proportionate tests:

- pure unit tests and shared Rust/TypeScript vectors;
- property/model tests for economic and occupancy invariants;
- Anchor happy-path and negative account-constraint tests;
- MagicBlock devnet tests for delegation, routing, sessions, VRF, commit, and recovery;
- concurrency tests for movement, gacha supply/pity, receipts, and settlement;
- component/browser tests for transaction and reconnect states;
- deterministic Three.js/simulation tests where possible;
- compressed-clock end-to-end daily lifecycle tests;
- load/soak tests for changes affecting account contention, subscriptions, cranks, or rendering.

Before reporting completion, run the relevant formatter, typecheck, linter, test suites, generated-binding check, and `git diff --check`. State exactly what was run and identify anything that could not be verified.

## Security review triggers

Explicitly flag and threat-model any change involving:

- USDC transfers or liability counters;
- receipt/refund/settlement terminal states;
- signer or PDA authority;
- delegation, session scope, commit, or undelegation;
- VRF request/callback binding;
- NFT collection validation, lock, thaw, or transfer;
- pity, supply, variant selection, or marketplace pricing;
- cutoff, winner, record, death, revival, occupancy, or cooldown logic;
- admin, upgrade, treasury, pause, or migration authority;
- external program CPI or remaining-account handling.

No unresolved critical/high security finding may be waived by a coding agent.

## Git and change discipline

- Work only in the standalone Crossy World repository once it exists.
- Do not add or change Git remotes, publish packages, deploy programs, rotate authorities, or push branches unless explicitly requested.
- Preserve user changes and avoid destructive Git commands.
- Keep commits focused and use messages such as `program:`, `sdk:`, `web:`, `indexer:`, `crank:`, `assets:`, `test:`, or `docs:`.
- Do not commit secrets, private keys, wallet files, paid raw source assets, build output, or local environment configuration.
- Treat generated IDL/binding/account-schema diffs as security-relevant review material.
- Update documentation in the same change when public behavior, account layout, workflow, or operational requirements change.

## Prohibited shortcuts

Do not:

- reuse the generic solsocket room state as authoritative Crossy World gameplay;
- accept client-authored state blobs, scores, winners, collisions, odds, or payouts;
- use browser time for cutoff, revival, cooldown, or hazard authority;
- let a session key approve money, NFTs, admin operations, or upgrades;
- trust indexer/API data for a financial or ownership transition;
- reroll VRF because a callback, mint, animation, or frontend request failed;
- add unbounded loops/accounts/effects or a 500-player global writable tick;
- reset cooldowns on reconnect, death, or revival;
- permit admin mutation of active-day class rules or season odds;
- expose raw licensed Unity project assets in the public repository;
- claim a real-money feature is production-ready without applicable security, load, recovery, and legal gates.

## Definition of done

A change is done only when:

- behavior matches the approved specifications;
- authoritative boundaries and invariants remain intact;
- failure, retry, duplicate, timeout, and cutoff paths are handled;
- tests cover happy path, invalid inputs/accounts, and relevant races;
- generated artifacts and documentation are current;
- resources/subscriptions are cleaned up;
- security-sensitive consequences are called out in review;
- relevant commands pass with evidence;
- no unrelated user work is overwritten.

If any requirement cannot be met, report the exact blocker and leave the system in a safe, reviewable state.
