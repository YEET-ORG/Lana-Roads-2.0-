# Crossy World: Client SDK, Subscriptions, and Indexing Specification

**Status:** Draft for user review  
**Parent:** [Crossy World product and protocol design](./2026-08-13-crossy-world-design.md)  
**Contract:** [Contract and economy specification](./2026-08-13-crossy-world-contract-economy-spec.md)  
**Realtime:** [MagicBlock gameplay integration specification](./2026-08-13-crossy-world-magicblock-integration-spec.md)  
**Frontend:** [Frontend and Three.js specification](./2026-08-13-crossy-world-frontend-threejs-spec.md)  
**Date:** 2026-08-13

## 1. Purpose

This document specifies the TypeScript client package, generated instruction bindings, connection/routing adapters, transaction workflows, subscriptions, deterministic game-data helpers, indexer responsibilities, API surfaces, cache consistency, and backwards compatibility.

## 2. Package strategy

Create a focused package, tentatively `@crossy-world/sdk`, rather than growing the generic `solsocket` package with game-specific finance and rules.

The package may reuse/adapt solsocket concepts:

- Base and ER connection separation
- Router/region configuration
- Session persistence and rotation
- Transaction sending and retries
- Account/log subscriptions
- Codec and interpolation patterns

It must not reuse unsafe behavior unchanged:

- Origin-global session key
- Unix-only build cleanup
- Byte-identical transaction deduplication for distinct logical events
- Listener removal without websocket teardown
- Unconditional `skipPreflight`
- Generic unchecked client-authored room state

## 3. Layering

```text
Generated program client
        |
Low-level Crossy client
  accounts, PDAs, instructions, decoding
        |
Workflow services
  entry, revive, gacha, NFT, marketplace, settlement
        |
Realtime world client
  routing, session, subscriptions, actions
        |
Indexer/query client
  leaderboards, profiles, history, inventory
```

Each layer exposes types without leaking internal provider/wallet implementation broadly.

## 4. Generated bindings

- Generate instruction/account/event/error bindings from the canonical IDL.
- Do not hand-copy discriminators or account offsets where generation can provide them.
- IDL hash/version is exported.
- CI fails when program/IDL/generated client drift.
- Legacy web3.js types are isolated at adapter boundaries required by Anchor/MagicBlock dependencies.
- Application-facing API prefers stable primitives and readonly data objects.

## 5. Configuration

```ts
interface CrossyClientOptions {
  cluster: "local" | "devnet" | "mainnet" | CustomCluster;
  wallet: WalletSigner;
  preferredRegion?: "asia" | "eu" | "us";
  sessionStore?: SessionStore;
  indexer?: IndexerClient;
}
```

Custom cluster explicitly supplies:

- Base RPC/WS
- Router RPC
- Program IDs/config address
- Expected MagicBlock service/network

Preferred region is used only during room preparation/selection where valid. Active delegated account routing comes from router status.

## 6. Connection manager

Maintains:

- Base connection at confirmed/finalized policy suitable for finance.
- Router client.
- ER connection cache by FQDN.
- Websocket health and reconnect state.
- Clock/slot synchronization estimates.

Rules:

- Fetch blockhash from the connection receiving the transaction.
- Base financial flows preserve simulation/preflight unless a documented incompatibility exists.
- ER skip-preflight is scoped by instruction/workaround and execution logs are observed.
- Endpoint changes tear down old subscriptions.

## 7. PDA and time helpers

Exports canonical helpers:

- `utcDayFromUnix(timestamp)`
- `dayStart(day)` / `dayEnd(day)`
- Config, season, banner, variant, profile, pull, daily, contribution, receipt, lock, listing PDAs
- World, chunk, sector, run, DailyBest PDAs
- Coordinate-to-sector mapping
- Revival price using checked bigint
- Settlement split

Helpers have test vectors shared with program tests.

## 8. Account readers

Typed readers validate:

- Expected owner/delegation owner as appropriate.
- Data length and discriminator.
- PDA/address relation.
- Day/world/season references.

Readers include:

- `getConfig`
- `getCurrentDay`
- `getDailyCompetition`
- `getWorldHeader`
- `getPlayerProfile`
- `getPlayerRun`
- `getAgentLock`
- `getPull`
- `getBannerState`
- `getVariantInventory`
- `getMarketplaceListing`

Reads of delegated state use resolved ER. Durable economic reads use base.

## 9. Workflow API

### 9.1 Entry

```ts
const flow = await client.paid.beginAttempt({ agent });
flow.onStatus(...);
await flow.waitUntilActive();
// or flow.refund() when program state permits
```

Status union:

```text
reviewed
wallet-signing
payment-confirmed
agent-locked
delegation-pending
spawn-pending
active
refundable
refunded
failed
```

Workflow persists object addresses/signatures so page reload resumes instead of restarting.

### 9.2 Revival

```ts
await client.paid.quoteRevive(run);
const flow = await client.paid.beginRevive(run);
```

Quote includes exact USDC bigint, death nonce, and expiry. `beginRevive` revalidates immediately before transaction.

### 9.3 Gacha

```ts
const quote = await client.gacha.quote(tier);
const pull = await client.gacha.request(tier);
await pull.waitForAssignment();
await pull.claim();
// or pull.refund() after objective timeout
```

Quote includes effective weights, inventory revision, pity progress, and availability.

### 9.4 Marketplace

- `listAgent(asset, price)`
- `delistAgent(asset)`
- `buyListing(asset)`

Methods return transaction summaries before send and final typed result after confirmation.

## 10. Transaction builder and review

Every financial/NFT builder returns:

```ts
interface TransactionReview {
  cluster: string;
  feePayer: string;
  action: string;
  usdcTransfers: { from: string; to: string; amount: bigint }[];
  assets: { address: string; effect: "freeze" | "thaw" | "mint" | "transfer" }[];
  warnings: string[];
  transaction: TransactionLike;
}
```

UI reviews then explicitly submits. SDK does not auto-sign a financial transaction during a quote/read call.

## 11. Session store

Interface:

```ts
interface SessionStore {
  load(scope: SessionScope): Promise<SessionKey | null>;
  save(scope: SessionScope, key: SessionKey): Promise<void>;
  remove(scope: SessionScope): Promise<void>;
}
```

Scope includes program, cluster, wallet, and world/rotation domain. Browser implementation handles unavailable storage and corruption safely. Node implementation is explicit/in-memory unless caller supplies storage.

## 12. Realtime world client

```ts
const world = await client.world.joinPaid(day);
await world.move("forward");
await world.kick();
await world.useAbility(args);
```

Exposes:

- Canonical world/run snapshot
- Nearby sector snapshots
- Current/next chunks
- Connection/routing health
- Action result/rejection
- Sequence-gap recovery

It never exposes a generic `setState` that could bypass game rules.

## 13. Action sender

- Builds action envelope with exact attempt and next sequence.
- Adds uniqueness so distinct actions do not become duplicate transaction bytes under cached blockhash.
- Blockhash cache TTL is endpoint-aware and conservative.
- Optional processed confirmation by action class.
- Fire-and-observe actions track signature/log/account sequence, not assume `sendRawTransaction` means success.
- Retry only when instruction is idempotent or state is re-read first.

## 14. Subscription hub

One underlying websocket subscription per account/filter per connection, multiplexed to listeners.

Required behavior:

- First listener creates underlying subscription.
- Removing last listener tears it down.
- Reconnect recreates active subscriptions.
- Sequence gaps trigger refetch.
- Listener exceptions are isolated.
- Disposer is idempotent.
- `world.close()` releases every subscription/timer/worker hook.

## 15. Interest management

Given local player coordinate:

- Subscribe to configurable radius of sectors around player.
- Pre-subscribe adjacent sectors before crossing.
- Release distant sectors after hysteresis delay to avoid thrashing.
- Always subscribe own run, WorldHeader, and relevant chunks.
- Spectator/leaderboard mode uses separate bounded subscription policy.

SDK returns normalized nearby occupant records to renderer.

## 16. Deterministic game data helpers

A pure package/module implements versioned:

- Lane/hazard position from descriptor and time.
- Warning windows.
- Terrain/blocker lookup.
- Sector coordinate conversion.
- Visual next transition time.

It is not authoritative in browser, but exact shared test vectors reduce visible disagreement. Program remains final authority.

## 17. Indexer responsibilities

The indexer is a rebuildable read model, not authority.

Indexes:

- DailyBest accounts/events
- Daily winners and settlement
- Season wins and score history
- Gacha pulls/assignments/claims
- Variant supply
- Agent locks and marketplace listings/sales
- Player profile history
- NFT ownership via Metaplex DAS or verified chain source

Does not decide:

- Winner
- Score validity
- Gacha outcome
- Refund entitlement
- NFT lock state
- Payout amount

## 18. Indexer data model

Suggested entities:

- `days`
- `world_records`
- `daily_bests`
- `players`
- `season_rankings`
- `pulls`
- `variants`
- `assets`
- `listings`
- `sales`
- `operations`

Every row includes source account/event identity, slot, signature, and canonical sequence/version.

## 19. Reorg/finality handling

- Realtime ER views are marked provisional.
- Base financial views become confirmed/finalized according to configured policy.
- Indexer upserts idempotently by event/account identity.
- Rollback/replay tooling can rebuild from a checkpoint.
- UI labels pending versus final where financially relevant.

## 20. Query API

Read-only endpoints or typed calls:

- Current day summary
- Paid/casual leaderboard pages
- Season standings
- Player profile/history
- Agent inventory/collection
- Banner/variant supply and odds inputs
- Marketplace listings
- Operation status by wallet/object

API responses include freshness/slot metadata and authoritative account addresses.

## 21. Cache consistency

- Financial mutation invalidates exact daily/profile/pull/listing keys after confirmation.
- Subscription updates merge only if sequence/slot newer.
- Indexer data never overwrites a newer direct account snapshot.
- Wallet change clears private/pending workflow cache.
- Persistent pending-operation records are namespaced by cluster and wallet.

## 22. Version compatibility

SDK exports:

- Program ID and expected config
- IDL version/hash
- Game generation versions supported
- Class config decoder versions
- Asset manifest version compatibility

Client refuses financial actions when program/config version is unsupported. Read-only display may degrade gracefully.

## 23. Build and packaging

- Cross-platform build scripts; no shell-specific `rm -rf`.
- ESM-first browser package with verified CJS only if needed.
- Browser export avoids Node-only modules.
- Source maps and declarations generated.
- Package import smoke tests for native ESM, bundler, and supported Node environment.
- Bundle analysis tracks Anchor/web3 dependency weight.

## 24. SDK tests

- PDA/time/revival/split test vectors
- Session scope/storage/rotation
- Base vs ER routing
- Blockhash endpoint and uniqueness behavior
- Subscription create/multiplex/dispose/reconnect
- Sequence-gap refetch
- Workflow resume after reload
- Transaction review accuracy
- Gacha quote/pity/effective odds calculations against program vectors
- Indexer provisional/final merge
- ESM/CJS/browser package loading

## 25. SDK/indexer acceptance criteria

- No game API permits arbitrary state writes.
- Financial calls return explicit transaction review before signing.
- Active delegated routing always resolves through router state.
- Last listener removal closes underlying websocket subscription.
- Distinct logical actions cannot collapse into one byte-identical transaction.
- Indexer outage does not prevent authoritative gameplay, refund, claim, or settlement.
- Indexer rebuild reproduces leaderboards/history from authoritative sources.
- Unsupported program versions block writes safely.
