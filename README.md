# Lana Roads 2.0 / Crossy World

This private repository is the standalone product workspace for the contract-first Solana + MagicBlock multiplayer game described in [`docs/superpowers/specs/2026-08-13-crossy-world-spec-suite.md`](docs/superpowers/specs/2026-08-13-crossy-world-spec-suite.md).

Frontend work starts with the consolidated [`docs/FRONTEND.md`](docs/FRONTEND.md).

Art and asset work starts with [`docs/ASSETS.md`](docs/ASSETS.md), which records every supplied source pack, licensing status, curation rule, and runtime conversion requirement.

Contract deployment starts with [`docs/DEPLOYMENT_READINESS.md`](docs/DEPLOYMENT_READINESS.md). It records the current verification evidence, program-ID mismatch, artifact checksum, required devnet VRF/ER smoke tests, and remaining mainnet gates.

It is bootstrapped from the open-source solsocket starter so its MagicBlock connection, session, delegation, and subscription patterns can be selectively adapted. The generic solsocket engine is reference code, not the authoritative Crossy World game contract. Read [`AGENTS.md`](AGENTS.md) before making changes.

`VoxelAnimals/` contains the privately purchased Unity Asset Store source pack approved for conversion into optimized Three.js game assets. Other supplied source packs are under `SourceAssets/`. Binary art payloads use Git LFS. Keep this repository private and do not redistribute raw packs.

Only the curated vehicle subset defined in [`docs/FRONTEND.md`](docs/FRONTEND.md) should be converted into distributable runtime derivatives; do not import every source model into the web bundle.

## Running a live world (devnet)

A day is a set of accounts, not a config flag. Until they exist and are
delegated, the client cannot tell the difference between "the day just rolled
over" and "the cluster is down", so it falls back to offline practice.

```bash
cd program
npx tsx scripts/open-day.ts              # today, casual world
MODES=0,1 npx tsx scripts/open-day.ts    # paid world as well
./scripts/run-keeper.sh                  # frontier + hazard crank, supervised
npx tsx scripts/presence-check.ts        # who is online, and ER round-trip
DRY_RUN=1 npx tsx scripts/settle-day.ts  # what settling yesterday would do
npx tsx scripts/settle-day.ts            # actually settle it
```

Settlement is the other half of the day: audit every permanent `DailyBest`,
claim the strict maximum, close and commit the worlds, reconcile pending
payments, record the final base commit, then `finalize_day` (90% winner / 10%
team, or the whole pool rolled forward when nobody scored). Every stage is
idempotent, so a half-finished settlement resumes where it stopped. The keeper
runs it for yesterday every five minutes; `SETTLE=0` leaves the payout to an
operator.

`open-day.ts` is idempotent — it only does what is still missing — and the
keeper calls the same routine itself when it finds no world on the rollup, so
a UTC boundary rolls over without an operator. Both need the admin/keeper
keypair (`ADMIN_KEYPAIR` / `KEEPER_KEYPAIR`, default
`~/.config/solana/id.json`). Randomness comes only from authenticated
MagicBlock scoped-VRF callbacks; there is no VRF signer keypair.

## Starter reference documentation

<p align="center">
  <img src="docs/public/logo.svg" width="88" alt="solsocket" />
</p>

# solsocket

**Socket.io for Solana.** Realtime multiplayer rooms — fully onchain, powered by
[MagicBlock Ephemeral Rollups](https://docs.magicblock.gg).

```bash
npm create solsocket   # scaffold a working realtime onchain app
```

```ts
import { SolSocket } from "solsocket";

const sock = SolSocket.connect({ wallet, cluster: "devnet" });
const room = await sock.joinOrCreate<State>("lobby"); // named rooms, no branching

room.onPresence(({ player, data }) => drawCursor(player, data)); // ~50ms updates
await room.broadcast({ x: 0.4, y: 0.7 }); // zero-fee, no wallet popup

room.onMessage("chat", ({ player, data }) => bubble(player, data));
await room.emit("chat", { text: "gm" }); // events in tx logs — no state write
```

One wallet signature to create/join a room. After that, every `broadcast()` is a
**zero-fee transaction signed by a throwaway session key** and every remote update
arrives over a websocket at **ephemeral-rollup slot time (~50ms)** — while all
state remains real Solana accounts you can commit back to the base layer.

## Why

Building realtime multiplayer on Solana today means hand-rolling: two RPC
connections, delegate→ER→undelegate sequencing, validator identities as remaining
accounts, commitment-level footguns (`confirmed` subscriptions silently don't fire
on ERs), and session-key plumbing. MagicBlock's BOLT framework is deprecated;
what's left is low-level. solsocket wraps all of it behind the API every web dev
already knows: **rooms, broadcast, subscribe**.

Naive Anchor round-trip on an ER: **4–8 s** perceived latency (HTTP confirm
polling). solsocket's `processed`-commitment websocket path: **~50 ms**. Measured
in [`packages/sdk/tests/e2e.ts`](packages/sdk/tests/e2e.ts) — cross-client
presence delivery in **54ms** and event delivery in **8ms** on a local ER.

The whole multiplayer integration in
[`cursor-canvas`](examples/cursor-canvas) is **~15 lines**; the
[`gather-lite`](examples/gather-lite) world — avatars, proximity chat, emotes,
a shared door — is **~40**. The raw equivalent is two connections, two
providers, hand-derived PDAs, delegate→ER→commit sequencing with validator
identities as remaining accounts, session-key plumbing, and
processed-commitment subscription wiring, before any game code.

## How it works

```
 base layer (Solana devnet)              ephemeral rollup (MagicBlock)
┌──────────────────────────┐   delegate  ┌────────────────────────────┐
│ Room PDA [room,creator,id]──────────▶  │ Room     (seq, state blob)  │
│ Presence PDA [room,player]──────────▶  │ Presence (seq, data blob)   │
│  · created + joined in     │           │  · session-key writes, 0 fee│
│    ONE wallet-signed tx    │◀──────────│  · processed-commitment WS  │
└──────────────────────────┘ commit /    └────────────────────────────┘
                             undelegate
```

- **Room** = shared state slot (last-write-wins, `seq`-ordered), delegated to an ER.
- **Presence** = one slot per player (cursor, status…) — concurrent players never
  contend on the same account. `onPresence` is a single `programSubscribe`
  filtered by room.
- **Session keys**: ER transactions are zero-fee, so a localStorage keypair
  registered at join signs all realtime writes. Losing it is fine — rejoin
  rotates the authority via a wallet-signed recovery path.

## Packages

| Path                                                     | What                                                                                                                                                                                           |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`packages/sdk`](packages/sdk)                           | [`solsocket`](https://www.npmjs.com/package/solsocket) — the TypeScript SDK (web3.js, dual CJS/ESM)                                                                                            |
| [`packages/create-solsocket`](packages/create-solsocket) | [`create-solsocket`](https://www.npmjs.com/package/create-solsocket) — `npm create solsocket` scaffolder; add `--template gather` for a walkable world                                         |
| [`program`](program)                                     | `solsocket-engine` — Anchor program, devnet: [`CrLS1Ry58q59AgmqbNVrqbfs2bWGJtjk12PezXh4LeYh`](https://explorer.solana.com/address/CrLS1Ry58q59AgmqbNVrqbfs2bWGJtjk12PezXh4LeYh?cluster=devnet) |
| [`examples/cursor-canvas`](examples/cursor-canvas)       | Shared-cursor demo — the whole integration is ~15 lines                                                                                                                                        |
| [`examples/gather-lite`](examples/gather-lite)           | A tiny Gather-style world: walking avatars, **proximity chat**, emotes, a shared door — every event an onchain transaction                                                                     |
| [`examples/escape-duo`](examples/escape-duo)             | **The Vault** — a two-player escape room where all four puzzles are impossible alone: shared plates, code relay, a held gate, keys turned in the same 2s                                       |

## Run it

```bash
pnpm install

# demo against devnet (uses the deployed program)
pnpm --filter @solsocket/cursor-canvas dev
# open http://localhost:5173, fund the burner (~0.01 devnet SOL), move your
# mouse, open the invite link in a second window.

# the flagship demo: a multiplayer world
pnpm --filter @solsocket/gather-lite dev

# the co-op escape room (grab a partner)
pnpm --filter @solsocket/escape-duo dev

# full local stack (base validator + ephemeral rollup)
npm i -g @magicblock-labs/ephemeral-validator
./scripts/local-stack.sh                          # terminal 1
pnpm --filter @solsocket/program test:local       # program lifecycle tests
pnpm --filter solsocket test:local                # SDK two-client e2e tests
```

Toolchain: Node ≥ 20, pnpm, and for program development Anchor **1.0.2** (avm),
Solana CLI 3.x, Rust 1.89+.

## API sketch

```ts
SolSocket.connect({ wallet, cluster, region?, session? })
sock.joinOrCreate<T>("name", opts?)  // named room: same name → same room
sock.createRoom<T>({ id?, maxPlayers?, initialState?, codec?, ... })  → Room
sock.joinRoom<T>(address)            // handles rejoin + lost-session recovery
sock.listRooms()                     // every live room on the ER, busiest first
room.broadcast(data)         // write own presence slot (fire-and-forget)
room.emit(name, data)        // ephemeral event in tx logs — no state write
room.setState(data)          // write shared room state
room.onPresence(cb)          // every player's updates, ~50ms
room.onMessage(name?, cb)    // emitted events, optionally filtered by name
room.onStateChange(cb)       // shared-state updates, ~50ms
room.getState()              // read from the ER
room.leave()                 // commit + undelegate own presence (session-signed)
room.closeToBase()           // creator: commit + undelegate the room
```

Helpers: `trackPresence(room, { onJoin, onUpdate, onLeave })` — roster with
staleness sweeping (no ghost avatars) — and `smoothPresence(room, render)` —
entity interpolation that turns 10Hz broadcasts into 60fps movement.

State, presence, and messages each take their own pluggable `Codec`
(`Room<TState, TPresence, TMessage>`): JSON by default, `structCodec` for
compact binary presence (a full avatar in ~20 bytes), `rawCodec` for bytes.

## Trust model

Be precise about what is and isn't enforced on-chain:

- **The program enforces**: room membership (you can only write presence,
  events, or shared state through a presence slot the program created for
  you), session authority (only the session key registered at join can sign
  as you — rejoining rotates it via a wallet-signed recovery), size caps on
  every payload, and creator-only room closure.
- **Clients self-report their own presence.** A position broadcast is
  client-authored, exactly like every mainstream game-netcode SDK
  (Socket.io, Colyseus, Photon) — solsocket makes movement _authenticated
  and attributable_ (every update is a signed transaction from a known
  wallet), not _validated_. Game-rule enforcement (speed limits, collision)
  belongs in your program's instructions; the engine is deliberately
  game-agnostic.
- **Delegation trust follows MagicBlock's ER model**: while delegated, the
  regional ER validator sequences and executes writes; state commits back
  to the base layer on `leave()` / `closeToBase()`. Session keys live in
  localStorage and can only write realtime room data — they never hold or
  move funds; your wallet signs only the base-layer create/join/close.

## Status & roadmap

Built for [MagicBlock Solana Blitz v7](https://build.magicblock.app)
(theme: Collaboration). Working now: everything above — including events,
named rooms, discovery, and multi-region — covered by the program lifecycle
suite plus a 16-test SDK e2e suite on the local MagicBlock stack, with the
events path verified on devnet. Docs live in [`docs/`](docs/) (VitePress —
`pnpm --filter docs docs:dev`). Next: mainnet endpoints, program-side
validation hooks for game rules.

## License

MIT © Pratik Kale
