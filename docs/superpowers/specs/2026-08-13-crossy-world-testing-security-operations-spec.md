# Crossy World: Testing, Security, and Operations Specification

**Status:** Draft for user review  
**Parent:** [Crossy World product and protocol design](./2026-08-13-crossy-world-design.md)  
**Contract:** [Contract and economy specification](./2026-08-13-crossy-world-contract-economy-spec.md)  
**Realtime:** [MagicBlock gameplay integration specification](./2026-08-13-crossy-world-magicblock-integration-spec.md)  
**Frontend:** [Frontend and Three.js specification](./2026-08-13-crossy-world-frontend-threejs-spec.md)  
**SDK:** [Client SDK, subscriptions, and indexing specification](./2026-08-13-crossy-world-sdk-indexing-spec.md)  
**Date:** 2026-08-13

## 1. Purpose

This document defines the quality, security, deployment, observability, reconciliation, and incident-response requirements for Crossy World. Because the product combines real-money custody, tradable NFTs, delegated realtime state, and competitive scoring, passing ordinary unit tests is not sufficient. Every release must prove economic conservation, deterministic gameplay, cross-plane recovery, and safe operation under concurrency and partial failure.

## 2. Release principles

1. Base-layer state is authoritative for money, ownership, settlement, refunds, configuration, and durable records.
2. Delegated MagicBlock state is authoritative for active gameplay only while its delegation is valid.
3. The indexer and frontend are projections, never authorities.
4. No real-money feature launches without automated invariants, adversarial tests, operational runbooks, and an independent security review.
5. Every asynchronous workflow must be retryable without double payment, double minting, rerolling, or duplicate state transitions.
6. A release is blocked by unexplained balance differences, nondeterministic simulation results, unresolved high-severity findings, or failed cutoff/recovery drills.

## 3. Environments

### 3.1 Local deterministic environment

Used for rapid program, SDK, and simulation tests:

- local Solana validator;
- local/test MagicBlock-compatible execution environment where available;
- test USDC mint with six decimals;
- deterministic mock VRF adapter for most tests;
- synthetic clock control at day, revival, pity, and timeout boundaries;
- seeded fixture collection and agent inventory;
- isolated indexer database reset for every suite.

Mocks may prove local logic but do not qualify a MagicBlock integration release.

### 3.2 Devnet integration environment

Used for real delegation, router, session, VRF, commit, and undelegation behavior. It contains no valuable assets and may be reset. Every integration test records the base RPC, ER endpoint, router decision, transaction signatures, account owners, and observed commit slot.

### 3.3 Staging environment

Staging mirrors production configuration with separate program IDs, collection, treasury, admin, indexer, RPC credentials, and asset bucket. It uses a low-value or valueless payment mint and executes full UTC rollover, settlement, void, refund, gacha, marketplace, and NFT-lock rehearsals.

### 3.4 Production environment

Production has unique secrets and authorities. No staging or developer key is accepted. Program IDs, USDC mint, Metaplex program IDs, collection, treasury, router endpoints, and supported client versions are published in a signed deployment manifest.

## 4. Toolchain and dependency policy

The implementation begins from the repository's verified baseline:

- Anchor CLI/program dependency: `1.0.2`;
- `ephemeral-rollups-sdk`: `0.16.2`;
- TypeScript Anchor client: `0.32.1`;
- pnpm workspace managed by the pinned `packageManager` field.

These versions are an initial compatibility baseline, not a permanent requirement. Any upgrade must include:

- release-note and migration review;
- regenerated IDL/bindings diff;
- full program and SDK tests;
- devnet delegation/session/VRF/commit tests;
- account-layout compatibility decision;
- rollback plan.

Rust and JavaScript lockfiles are committed. CI uses exact lockfiles and fails on an unreviewed generated-code diff.

## 5. Test pyramid

### 5.1 Pure unit tests

Pure Rust and TypeScript implementations use shared golden vectors for:

- UTC day ID and cutoff boundaries;
- revival price doubling and overflow rejection;
- 90/10 settlement rounding;
- score comparison with strict greater-than tie behavior;
- pity transitions and effective odds;
- sold-out rarity renormalization;
- deterministic spawn scan;
- chunk derivation and hazard phase;
- Kick and ability target resolution;
- tile/sector/chunk coordinate conversion.

The same vectors must produce byte-for-byte equivalent outputs in the program, SDK, indexer, and renderer helpers.

### 5.2 Property and model-based tests

Generated action sequences assert:

- vault assets always equal or exceed tracked liabilities;
- a payment receipt is consumed or refundable, never both;
- payout legs never exceed distributable pool;
- each pull reaches at most one terminal state;
- pity cannot decrease except on its qualifying assignment reset;
- supply cannot become negative or exceed its season cap;
- two live players never own the same occupied tile;
- score never decreases within an attempt;
- equal scores never replace an incumbent;
- cooldown timestamps cannot be bypassed by reconnect, session rotation, or region movement;
- permanent attempt termination eventually permits NFT thaw.

The economic state machine should be compared with a small executable reference model across randomized instruction orderings.

### 5.3 Anchor program integration tests

Tests exercise real instructions and account constraints for:

- initialization and two-step admin rotation;
- valid and invalid USDC mint/token program/account combinations;
- entry and revival payment receipts;
- hard cutoff at `end_ts - 1`, `end_ts`, and `end_ts + 1`;
- settlement, rollover, void, refund, and retryable payout legs;
- starter entitlement and agent lock/thaw lifecycle;
- gacha request, callback, timeout, refund, pity, and sold-out races;
- marketplace ownership, lock, royalty, price, and expiry constraints;
- pause scopes and allowed recovery actions while paused.

Every signer, owner, PDA seed, bump, mint, external program ID, and writable-account relationship receives a negative test.

### 5.4 MagicBlock integration tests

Devnet tests cover:

- delegation preparation, delegation, routing, commit, and undelegation;
- account owner transitions and stale clone handling;
- session scope, expiry, revocation, and wallet/session separation;
- multi-account co-location requirements;
- concurrent movement into one tile;
- cross-sector movement and interest subscription changes;
- disconnected-player hazard death;
- chunk VRF request, retry, callback, frontier closure, and reveal;
- authenticated payment-receipt activation;
- death, revival, cutoff, record commit, and NFT unlock recovery;
- crank restart and duplicate work execution.

Tests intentionally kill clients, crank workers, indexers, RPC connections, and callback delivery at each workflow stage.

### 5.5 Frontend and SDK tests

- Component tests cover every transaction review and pending/error/retry state.
- Three.js simulation tests run without WebGL where possible and compare deterministic transforms against golden vectors.
- Browser tests cover wallet connect, cluster mismatch, entry, gameplay, death, revival, gacha, NFT selection, marketplace, reconnect, and admin settlement preview.
- Subscription tests prove listener deduplication and teardown.
- Accessibility tests cover keyboard-only play/navigation, touch controls, reduced motion, focus order, and warnings that do not rely on color alone.
- Asset tests reject missing variants, invalid manifests, oversized files, raw Unity source, and unlicensed files in public output.

### 5.6 End-to-end daily lifecycle test

A compressed-clock suite executes a complete day:

1. initialize day and shared chunk seed;
2. join paid and casual rooms;
3. exercise movement, hazards, Kick, abilities, and deaths;
4. complete successful and expired revivals;
5. create and strictly beat records;
6. cross hard cutoff;
7. commit final record and close active state;
8. settle 90/10 or test zero-score rollover;
9. thaw all terminal NFTs;
10. reconcile vault, receipts, attempts, and indexed history;
11. initialize the next day.

Separate variants cover void/refund and partial external-service failure.

## 6. Concurrency, load, and soak qualification

### 6.1 Required scenarios

The representative load harness must simulate at least 500 concurrently connected clients in one shared world with realistic clustering:

- safe-zone spawn burst at day opening;
- dense tile contention;
- forward-moving leaders causing chunk generation;
- mixed movement, Kick, and class abilities;
- vehicle, train, river, and platform hazards;
- disconnect/reconnect churn;
- death and paid revival bursts;
- UTC cutoff while actions are in flight.

### 6.2 Measurements

Capture p50, p95, and p99 for:

- action submission to ER acceptance;
- acceptance to authoritative subscription update;
- reconciliation correction frequency and magnitude;
- payment to gameplay activation;
- chunk request to usable reveal;
- death to frontend notification;
- commit and undelegation duration;
- websocket disconnects and resubscribe completion;
- crank queue age and retry count.

Also capture rejected contention, RPC error classes, compute use, account hot spots, frontend frame time, memory, draw calls, bandwidth, and indexer lag.

### 6.3 Initial release gates

- No occupancy, score, payment, supply, or payout invariant violation.
- No action accepted after authoritative cutoff.
- At least 99% of accepted ordinary movement updates observed within 500 ms in the agreed production-like test region; tighter latency remains a product optimization target.
- No sustained crank backlog older than 10 seconds during steady state.
- Frontend sustains 50 FPS at the agreed desktop baseline and 30 FPS at the agreed supported mobile baseline using representative nearby entities.
- A six-hour soak has no unbounded memory, listener, account, or queue growth.

Final SLO numbers are frozen after deployment-region and device benchmarking; changing them requires a recorded release decision.

## 7. Security threat model

### 7.1 Protected assets

- USDC in day, refund, and gacha liabilities;
- tradable agent NFTs and lock state;
- season inventory and pity counters;
- authoritative attempts, scores, records, and winner identity;
- admin/upgrade/session authorities;
- VRF request/result binding;
- player privacy-sensitive telemetry and infrastructure credentials.

### 7.2 Trust boundaries

- wallet and browser;
- session key storage;
- base Solana program;
- MagicBlock router and ER execution;
- VRF callbacks;
- crank/operator services;
- Metaplex/token programs;
- RPC/websocket providers;
- indexer/API/cache;
- admin workstation and signing device.

The design assumes clients, indexer responses, RPC responses, and crank callers can be malicious or stale. Program constraints and deterministic state transitions provide authority.

### 7.3 Principal threats and controls

| Threat                             | Required controls                                                                                  |
| ---------------------------------- | -------------------------------------------------------------------------------------------------- |
| Forged payment activation          | Program-derived receipt, expected payer/day/attempt/kind/amount, one-time consume state            |
| Double spend/refund/settlement     | Terminal state machine, checked counters, idempotent payout legs, liability invariant              |
| Client-authored score or position  | Purpose-built instructions derive transitions and validate occupancy/hazards                       |
| Session wallet theft               | Narrow instruction scope, expiry/revocation, no token/NFT/admin authority                          |
| Stale or wrong ER routing          | Router/owner verification, co-location checks, sequence numbers, fail closed                       |
| VRF reroll or callback spoof       | Bind request ID/banner/season/payer/counter; validate callback authority; one terminal result      |
| Pity/supply race                   | Serialize canonical banner/inventory mutation; atomic reserve-or-refund                            |
| NFT sale during play               | Durable lock/freeze checked by game and marketplace; terminal recovery thaw                        |
| Fake external program/account      | Fixed allowlisted program IDs plus owner/mint/PDA/signer checks                                    |
| Front-running marketplace sale     | Exact asset, seller, buyer maximum, price, royalty, and expiry constraints                         |
| Admin theft or winner substitution | Program-derived payout destinations/amounts; pause cannot withdraw liabilities                     |
| Admin/upgrade key compromise       | Hardware-backed signing, minimal funded hot keys, alerts, rehearsed authority rotation             |
| Crank abuse or omission            | Permissionless/idempotent work where safe, bounded batches, duplicate-safe execution, queue alerts |
| Indexer manipulation               | UI labels projection status; critical writes reread authoritative accounts                         |
| Replay/duplicate action            | Attempt/session binding, monotonically increasing action nonce, expiry/slot bounds                 |
| Denial through account hot spots   | Sectorization, bounded instruction work, rate controls, load tests, backpressure                   |

### 7.4 Economic and game-abuse review

Security review includes non-code abuse:

- intentional player blocking in the safe zone or chokepoints;
- multi-wallet collusion and record obstruction;
- kick-chain griefing;
- last-second cutoff congestion;
- gacha/market botting;
- RPC or geography latency advantage;
- treasury/admin refusal to settle;
- pay-to-win disclosure and jurisdiction-specific prize/gacha requirements.

Gameplay mitigations must not silently change approved economics. Any material rule change returns to product design review.

## 8. Secure development requirements

- Use checked arithmetic for all value, score, counter, timestamp, and coordinate calculations.
- Bound all vectors, strings, batches, iteration counts, and account growth.
- Avoid floating-point arithmetic in authoritative logic.
- Validate account identity independently of client-supplied metadata.
- Keep instruction handlers small and separate validation, transition, and external calls.
- Emit enough event data to reconstruct economic transitions without exposing secrets.
- Never log private keys, session secrets, wallet-adapter internals, bearer tokens, or private RPC URLs.
- Run formatting, lint, unit/integration tests, dependency audit, secret scan, and Solana-focused static analysis in CI.
- Run the configured Solana vulnerability scanner/program autofixer in report-only review mode before audit; fixes require human review and tests.
- Require two-person review for program, SDK transaction-building, deployment, and admin-operation changes.

## 9. Audit and launch gates

Before mainnet value is enabled:

1. internal threat-model review is complete;
2. all critical workflows and negative account tests pass;
3. 500-client load and soak gates pass;
4. an independent Solana/MagicBlock security audit is resolved;
5. no unresolved critical/high finding exists;
6. medium findings have explicit acceptance or remediation dates;
7. program binaries are reproducibly built and verified against reviewed source;
8. deployment manifest and authorities are independently checked;
9. staging settlement/refund/void/cutoff/VRF drills pass;
10. legal review covers paid competition, gacha, tradable NFTs, royalties, geographic restrictions, consumer disclosures, tax, and sanctions obligations;
11. asset license/invoice and redistribution boundaries are archived;
12. incident and player-support runbooks are rehearsed.

## 10. CI/CD pipeline

Required stages:

1. formatting and documentation link checks;
2. TypeScript lint/typecheck/unit tests;
3. Rust format/lint/unit tests;
4. Anchor build and generated IDL/binding diff;
5. local-validator integration tests;
6. frontend component/browser tests;
7. dependency, license, secret, and static-security scans;
8. deterministic build artifact and checksum creation.

Devnet/staging integration, load, and soak suites may run in controlled release pipelines because they need external infrastructure. Production deployment is manual, uses reviewed checksums, displays the exact program/config changes, and requires a separately recorded verification step.

## 11. Authority and secret management

### 11.1 V1 authorities

The approved V1 product has one admin wallet and admin-triggered settlement. Operationally:

- the admin and upgrade authority should use hardware-backed keys;
- routine crank/indexer/deployer credentials are separate and cannot settle or upgrade;
- treasury is separate from upgrade authority;
- session keys are browser-scoped, short-lived, and never exported to backend services;
- RPC, database, monitoring, and deployment secrets are environment-scoped and rotated.

The absence of a public settlement fallback is an explicit availability risk. Monitoring must page the admin before and after cutoff until settlement or a documented exceptional action completes.

### 11.2 V2 recommendation

Move admin, treasury, and upgrade control to appropriately separated multisig/governance authorities. This is not required for the approved V1 behavior but is the highest-priority governance hardening after launch.

## 12. Deployment and upgrade procedure

1. Freeze reviewed source and dependency locks.
2. Run all release gates and produce checksums, IDL, account schemas, and migration notes.
3. Deploy to staging and execute lifecycle/recovery drills.
4. Verify program binary and configuration against the release manifest.
5. Announce maintenance or client minimum version when required.
6. Deploy/upgrade program before enabling incompatible frontend writes.
7. Verify program data, authority, USDC mint, treasury, collection, router, and pause state from an independent RPC.
8. Deploy indexer/API, SDK consumers, and frontend with compatibility gates.
9. Execute smoke tests with controlled low-value transactions.
10. Monitor enhanced release dashboards through at least one UTC cutoff.

Account migrations must be explicit instructions with versioned layouts, resumable batches, and pre/post counts. An upgrade never reinterprets existing account bytes without a tested migration path.

## 13. Observability

### 13.1 Economic metrics

- vault token balance and calculated liabilities;
- paid entries and revival receipts by state;
- pool, rollover, refund, winner, and team counters;
- pending/failed settlement legs;
- gacha payments, assignments, refunds, pity distribution, and remaining supply;
- marketplace volume and requested royalty collected in the in-game path.

Any negative liability margin or unexplained reconciliation delta is a critical page and pauses affected financial writes.

### 13.2 Gameplay metrics

- connected and active players by room/sector;
- action acceptance/rejection and latency;
- tile contention and spawn failures;
- hazard deaths by type;
- Kick/ability use and cooldown rejection;
- chunk frontier distance, VRF age, and closed-frontier duration;
- ER routing, commit, undelegation, and websocket health;
- record commit age around cutoff.

### 13.3 Service metrics

- RPC/websocket errors and provider divergence;
- crank queue age, retries, and poison jobs;
- indexer finalized/provisional lag;
- API error/latency/cache age;
- frontend crash and reconnect rates;
- deployment version adoption.

Logs use correlation IDs for day, attempt, receipt, pull, VRF request, action nonce, and transaction signature. Metrics avoid unbounded wallet-address labels.

## 14. Reconciliation

Automated reconciliation runs continuously and after every cutoff:

```text
vault token balance
  = active day pools
  + rollover liabilities
  + refundable entry/revival receipts
  + unsettled winner/team obligations
  + refundable or unresolved gacha payments
  + other explicitly versioned liabilities
```

The exact implementation follows the counters in the contract specification. The job also verifies:

- indexed records match committed authoritative accounts/events;
- supply minted + reserved + remaining equals season cap;
- every active/terminal attempt has a valid agent-lock relationship;
- all permanently terminal attempts are thawable or already thawed;
- no stale delegated account remains after closure beyond its runbook threshold.

Reconciliation reports are immutable operational artifacts. The reconciler can alert or submit predefined idempotent recovery instructions; it cannot invent balances, winners, or state.

## 15. Runbooks

Each runbook contains detection, impact, authority, safe actions, prohibited actions, verification, and communication templates.

Required runbooks:

- admin unavailable near settlement;
- base RPC outage or divergent providers;
- MagicBlock router/ER outage;
- VRF request delayed or callback failure;
- crank backlog or worker compromise;
- chunk frontier closed;
- record commit/undelegation delayed at cutoff;
- settlement leg failed;
- vault reconciliation mismatch;
- gacha sold-out/pity invariant alarm;
- stuck NFT lock;
- indexer lag/corruption and full rebuild;
- frontend bad release/rollback;
- admin or upgrade key compromise;
- program pause and controlled resume;
- day void and player refunds.

## 16. Incident response

Severity is based on player funds/assets, authoritative integrity, and availability:

- **SEV-0:** active theft, unauthorized mint/upgrade, or authoritative corruption.
- **SEV-1:** funds/NFTs at material risk, liability mismatch, invalid winner/score, or inability to honor cutoff/settlement.
- **SEV-2:** major gameplay or service outage without evidence of asset/integrity loss.
- **SEV-3:** degraded noncritical feature or projection error.

Response sequence:

1. preserve evidence and identify affected program/version/day;
2. pause the narrowest affected write surface when a supported pause improves safety;
3. protect funds and prevent additional inconsistent transitions;
4. verify authoritative state through independent endpoints;
5. apply only predefined or reviewed recovery instructions;
6. communicate impact without exposing exploit details prematurely;
7. reconcile before reopening;
8. publish a post-incident review with root cause and prevention work.

Pausing must never disable player access to already-valid refunds unless the refund path itself is unsafe.

## 17. Data retention, backup, and privacy

- Authoritative chain history is not replaced by backups.
- Indexer database snapshots, schemas, deployment manifests, asset manifests, and reconciliation reports are retained and restoration-tested.
- The indexer supports full rebuild from program accounts/events plus registered metadata.
- Operational logs use minimum necessary wallet identifiers and documented retention.
- Analytics must not collect private keys, session secrets, full wallet-adapter payloads, or unnecessary personal data.
- User-facing privacy and analytics consent behavior follows launch jurisdictions.

## 18. Rollback and recovery boundaries

Frontend, API, indexer, and crank releases must support rollback to the last compatible version. Program upgrades cannot be treated as ordinary reversible deployments:

- prefer forward-fix or explicit migration;
- never downgrade across incompatible account layouts;
- keep writes paused if the only available client is incompatible;
- do not mutate on-chain truth to match an erroneous indexer/frontend projection;
- never rerun randomness to repair a presentation failure.

## 19. Launch sequence

Recommended staged activation:

1. casual-only closed test with valueless agents;
2. public casual load test;
3. test-mint paid-room lifecycle;
4. low-supply gacha and NFT-lock test on staging/devnet;
5. audited production deployment with financial writes paused;
6. production casual observation;
7. controlled low-value paid-room activation;
8. gacha/market activation only after custody, VRF, supply, and legal gates pass.

Feature flags can narrow exposure but cannot override program invariants or create undocumented economic behavior.

## 20. Operational acceptance criteria

- CI proves deterministic logic and account constraints on every release.
- Devnet proves real MagicBlock delegation, session, VRF, commit, and recovery behavior.
- A representative 500-client test and six-hour soak pass the release gates.
- Independent audit findings and legal launch gates are resolved.
- Production binaries and configuration match a signed, reviewed manifest.
- Vault liabilities reconcile continuously and after cutoff.
- Settlement, refund, void, VRF delay, ER outage, stuck lock, and key-compromise runbooks are rehearsed.
- No single routine service credential can move USDC, transfer NFTs, upgrade the program, or choose a winner.
- Indexer loss is recoverable from authoritative data.
- Mainnet financial features remain disabled until all applicable gates pass.
