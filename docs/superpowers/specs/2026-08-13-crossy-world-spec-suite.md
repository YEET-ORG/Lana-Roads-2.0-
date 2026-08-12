# Crossy World Specification Suite

**Status:** Draft suite for user review  
**Date:** 2026-08-13  
**Working program:** `crossy_world`

## 1. Reading order

1. [Product and protocol design](./2026-08-13-crossy-world-design.md) — approved product rules and overall architecture.
2. [Contract and economy](./2026-08-13-crossy-world-contract-economy-spec.md) — durable accounts, instructions, custody, NFTs, gacha, marketplace, refunds, and settlement.
3. [MagicBlock gameplay and integration](./2026-08-13-crossy-world-magicblock-integration-spec.md) — delegated realtime accounts, sessions, grid simulation, hazards, VRF chunks, cranks, and cross-plane workflows.
4. [Frontend and Three.js](./2026-08-13-crossy-world-frontend-threejs-spec.md) — React/Vite product UX, rendering, input, prediction, assets, admin UI, and performance.
5. [Client SDK, subscriptions, and indexing](./2026-08-13-crossy-world-sdk-indexing-spec.md) — typed client workflows, routing, realtime subscriptions, derived APIs, and indexer rules.
6. [Testing, security, and operations](./2026-08-13-crossy-world-testing-security-operations-spec.md) — verification, threat model, load gates, deployment, monitoring, reconciliation, and incident response.

## 2. Authority and precedence

The product and protocol design owns product decisions. A subsystem specification may make those decisions implementable but may not change them. If documents conflict:

1. explicit user-approved product decisions in the parent design win;
2. the contract specification wins for durable money, NFT, configuration, and settlement state;
3. the MagicBlock specification wins for active delegated gameplay state;
4. the SDK/frontend/indexer must represent authoritative program state and cannot redefine it;
5. the testing/operations specification may impose stricter release gates but cannot alter game economics.

Any unresolved conflict blocks implementation planning and must be corrected in the specifications first.

## 3. System ownership map

| Concern                              | Authority                              | Projection/consumer                     |
| ------------------------------------ | -------------------------------------- | --------------------------------------- |
| USDC custody and liabilities         | Base Solana program                    | SDK, indexer, frontend, reconciler      |
| Daily room lifecycle and cutoff      | Base clock + program state             | MagicBlock runtime, frontend, operators |
| Active movement and occupancy        | Delegated MagicBlock accounts          | Realtime SDK and Three.js client        |
| Hazards, Kick, abilities, live score | Delegated MagicBlock accounts          | Realtime SDK, renderer, indexer         |
| Final daily record and winner        | Committed program state                | Settlement, indexer, leaderboard UI     |
| Agent ownership, inventory, pity     | Base Solana + Metaplex                 | SDK, marketplace, frontend              |
| Leaderboard/search/history           | Indexer projection                     | Frontend; never used as write authority |
| Asset appearance                     | Versioned public asset manifest        | Three.js renderer                       |
| Operations and recovery              | Program-defined transitions + runbooks | Admin, cranks, monitoring               |

## 4. Cross-cutting invariants

- Browser, session key, indexer, RPC response, and crank caller are untrusted.
- A wallet signs every USDC, NFT, marketplace, and admin consequence.
- Session keys are narrowly scoped to gameplay and cannot spend or transfer assets.
- Every asynchronous transition is idempotent and has one terminal outcome.
- One player occupies at most one tile and one tile contains at most one live player.
- Score is the highest row reached by one attempt; an equal score never replaces the incumbent.
- Hard UTC cutoff is enforced by authoritative time, not automation timing.
- Randomness is bound to one request and never rerolled after a valid result.
- Indexer/frontend failures cannot change authoritative results.
- All financial balances remain explainable by versioned liability counters.

## 5. Implementation repository shape

The detailed implementation plan may adjust names, but should preserve these boundaries:

```text
program/
  programs/crossy-world/       Anchor authority and MagicBlock instructions
packages/
  crossy-world-sdk/            Generated bindings and safe workflows
apps/
  web/                         React/Vite/Three.js client
  indexer/                     Event/account ingestion and query API
  crank/                       Idempotent scheduled/recovery work
assets/
  manifests/                   Public optimized asset metadata
  source-private/              Not committed or publicly distributed
docs/
  superpowers/specs/           Product and subsystem specifications
```

If the existing generic `solsocket-engine` and `solsocket` SDK remain, Crossy World may reuse proven transport/session/subscription utilities. They must not become an alternate game authority or expose generic client-authored state mutation to Crossy World.

## 6. Required implementation-plan workstreams

After this suite is approved, the implementation plan must sequence:

1. workspace/toolchain and shared test-vector setup;
2. durable program accounts and economic invariants;
3. entry/revival receipt bridge and delegated attempt lifecycle;
4. deterministic grid, occupancy, chunks, hazards, Kick, and abilities;
5. NFT/gacha/marketplace state machines;
6. focused SDK and cross-plane workflows;
7. indexer, crank, and reconciliation services;
8. React/Vite shell and wallet transaction UX;
9. Three.js runtime and licensed asset conversion pipeline;
10. end-to-end, security, load, staging, and launch gates.

Contract and invariant tests precede frontend dependence on each feature. Financial production activation remains the last stage.

## 7. Review checklist

The suite is ready for implementation planning when the user confirms:

- the product/economic rules match the intended game;
- contract account and workflow boundaries are acceptable;
- MagicBlock realtime behavior and failure handling are acceptable;
- frontend experience and transaction presentation are acceptable;
- SDK/indexer authority boundaries are acceptable;
- security, operational, legal, and launch gates are acceptable;
- there are no remaining material choices that would reshape the architecture.
