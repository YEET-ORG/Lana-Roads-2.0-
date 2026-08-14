# Lana Roads 2.0 — Master Frontend Design and Engineering Specification

**Status:** Approved product direction; master frontend source of truth

**Product:** Lana Roads 2.0 / Crossy World

**Stack:** React, TypeScript, Vite, Three.js, Solana, MagicBlock Ephemeral Rollups

**Primary experience:** Mobile portrait, gesture-first, vibrant Voxel Arcade multiplayer game

**Date:** 2026-08-13

## 1. Purpose and authority

This is the master specification for the complete Lana Roads frontend. It combines product experience, information architecture, visual design, responsive layouts, controls, Three.js rendering, camera behavior, game feel, wallet flows, agents, UI assets, motion, audio, accessibility, performance, analytics, testing, and implementation sequencing into one document.

Frontend implementation agents must begin here. Supporting documents remain authoritative for deeper subsystem details:

- [Source asset catalog and runtime policy](./ASSETS.md)
- [Product and protocol design](./superpowers/specs/2026-08-13-crossy-world-design.md)
- [Contract and economy](./superpowers/specs/2026-08-13-crossy-world-contract-economy-spec.md)
- [MagicBlock gameplay integration](./superpowers/specs/2026-08-13-crossy-world-magicblock-integration-spec.md)
- [Detailed frontend and Three.js architecture](./superpowers/specs/2026-08-13-crossy-world-frontend-threejs-spec.md)
- [Visual UI and motion design](./superpowers/specs/2026-08-13-lana-roads-visual-ui-motion-design.md)
- [SDK, subscriptions, and indexing](./superpowers/specs/2026-08-13-crossy-world-sdk-indexing-spec.md)
- [Testing, security, and operations](./superpowers/specs/2026-08-13-crossy-world-testing-security-operations-spec.md)

If this document conflicts with an approved economic or gameplay invariant, the protocol specification wins. If a visual implementation detail conflicts with this master document, this document wins unless a newer accepted decision record explicitly changes it.

## 2. Product vision

Lana Roads is a persistent multiplayer voxel crossing world. The frontend must make a technically complex on-chain game feel immediate and playful:

- swipe to hop one tile;
- see other players moving in the same live world;
- avoid synchronized roads, trains, rivers, logs, and blockers;
- Kick nearby players and use one class ability;
- compete in a daily paid prize room or play free casual runs;
- collect and trade VoxelAnimals-derived agent NFTs;
- use gacha with visible odds and pity;
- understand every payment, lock, refund, and pending state without blockchain expertise.

The user should think “bright arcade game” before “Web3 application.” Wallet and chain mechanics are presented only when they affect a decision or recovery.

## 3. Approved experience direction

### 3.1 Voxel Arcade

The approved visual direction is **Voxel Arcade**:

- vibrant flat colors;
- full-screen voxel world;
- chunky block display typography;
- large tactile controls with hard lower-edge depth;
- compact bottom navigation;
- character carousel centered on real 3D agents;
- punchy score and record overlays;
- square confetti, block dust, stepped warning shapes;
- fast camera-led screen transitions;
- highly readable economy information on solid panels.

Crossy Road is the principal interaction and game-presentation reference. Lana Roads may follow its broad grammar closely, including one-thumb play, world-first menus, large character presentation, simple score hierarchy, bottom icon navigation, and playful cards. It must not ship copied logos, proprietary icons, characters, screenshots, textures, audio, wordmarks, or exact branded artwork.

### 3.2 Non-goals

The finished frontend must not resemble:

- a generic crypto dashboard;
- a trading terminal;
- a casino website;
- a purple-gradient Web3 landing page;
- a desktop form application over a canvas;
- a glassmorphism template;
- the current functional devnet prototype styling;
- a pixel-for-pixel Crossy Road clone.

## 4. Current implementation baseline and migration

The repository contains a devnet vertical slice under `apps/web/`:

- app bootstrap and burner funding;
- paid/casual mode information;
- entry review;
- live Three.js world;
- Magic Router resolution and ER subscriptions;
- optimistic movement and reconciliation;
- keyboard and gesture movement;
- score/state HUD;
- paid revival modal with live authoritative countdown;
- a shared Voxel Arcade design system (`apps/web/src/design-system/`) with tokens, original SVG icons, and reusable components (Button, IconButton, Card, Modal, Sheet, Pill, StatGrid, Steps, Notice, Loader, Confetti, CountUp) applied to Home, identity onboarding, paid entry, gameplay HUD, death/revival, and practice mode.

**2026-08-13 redesign status:** the shipped UI now follows the approved Voxel Arcade direction via the design system above. Known divergences from this document, to be closed by later phases:

- Onboarding is lightweight (polished identity/wallet gate plus contextual first-run hints); the full §17 tutorial sequence is not yet implemented.
- Routing remains the hand-rolled `Route` union; the §7 route map, bottom navigation, and the missing product surfaces (leaderboards, gacha, marketplace, profile, settings, admin) are not yet built.
- Kick/ability side buttons (§9.3) are not yet in the mobile HUD; Kick is keyboard-only.
- The design system keeps motion in CSS (`tokens.css`/`components.css`) rather than a `motion.ts` module, and icons are hand-drawn inline SVG (`icons.tsx`) rather than extracted atlas sprites.

This code proves networking and gameplay integration. It is not the final frontend architecture or visual quality bar.

### 4.1 Preserve

- Router-based ER resolution.
- Push subscriptions and authoritative reconciliation.
- Fire-and-forget movement path with bounded prediction.
- World/run/chunk data integration.
- Entry/revival transaction review architecture.
- Clean scene and subscription teardown.
- Devnet diagnostic access in development builds.

### 4.2 Replace or refactor

Done in the 2026-08-13 redesign: production emoji/text-symbol icons removed (original SVG set); generic styling replaced by the token/type system in `design-system/`; ad-hoc per-screen buttons/modals replaced by shared components.

Still open:

- Replace the single `Route` union with a typed route/state hierarchy.
- Break the remaining large `GameScreen` responsibilities into focused modules.
- Remove desktop maximum-width shell behavior from the game experience.
- Add side buttons (Kick/ability) to the mobile HUD.
- Separate development diagnostics from player HUD.
- Add persistent canvas/app shell and camera-led route transitions.
- Add the missing product surfaces described below.

## 5. Experience principles

1. **World first:** the game world is the background and context for core navigation.
2. **One-thumb fast:** primary mobile actions are reachable and movement is swipe-first.
3. **Authoritative honesty:** prediction feels fast but never lies about score, death, money, ownership, or outcomes.
4. **Money is explicit:** exact USDC and consequences appear before signature.
5. **Game language first:** explain player outcomes before technical chain details.
6. **Physical feedback:** controls press, cards snap, agents hop, and cameras move with short intentional timing.
7. **Original assets:** no production emoji or copied reference-game artwork.
8. **Adaptive quality:** gameplay remains readable and responsive across supported mobile hardware.
9. **Recoverable workflows:** closing, reconnecting, or retrying never loses financial state.
10. **Accessible alternatives:** gesture, motion, sound, haptics, and color all have usable alternatives.

## 6. Frontend architecture

### 6.1 Runtime layers

```text
React product shell
  -> routes, sheets, transaction state, collection, settings

Game presentation controller
  -> camera states, HUD model, input ownership, effects, audio

Three.js world runtime
  -> chunks, lanes, hazards, agents, interpolation, culling

Crossy World SDK
  -> PDA derivation, account readers, transactions, ER routing, subscriptions

Authoritative state
  -> base Solana + MagicBlock ER
```

React does not own frame-by-frame transforms. Three.js does not own money, wallet, navigation, or transaction workflows.

### 6.2 Recommended source shape

```text
apps/web/src/
  app/
    App.tsx
    routes.ts
    providers.tsx
    boot.ts
  shell/
    GameShell.tsx
    CanvasHost.tsx
    GlobalOverlay.tsx
    SafeArea.ts
  design-system/
    tokens.css
    typography.css
    motion.ts
    icons/
    ArcadeButton.tsx
    ArcadeCard.tsx
    Sheet.tsx
    StatusPill.tsx
    Progress.tsx
  input/
    GestureSurface.ts
    PointerOwnership.ts
    KeyboardInput.ts
    InputQueue.ts
  game/
    WorldRuntime.ts
    CameraController.ts
    AgentRenderer.ts
    ChunkRenderer.ts
    HazardRenderer.ts
    EffectsPool.ts
    AudioController.ts
    Reconciler.ts
  features/
    home/
    rooms/
    entry/
    agents/
    gameplay/
    death/
    leaderboard/
    gacha/
    marketplace/
    profile/
    settings/
    admin/
  data/
    queryKeys.ts
    authoritative.ts
    indexed.ts
  assets/
    manifest.ts
    loaders.ts
    generated/
```

No monolithic `App.tsx`, `GameScreen.tsx`, scene manager, or stylesheet may own the entire product.

### 6.3 State ownership

| State                           | Owner                                                |
| ------------------------------- | ---------------------------------------------------- |
| Wallet/network/session          | App providers + SDK                                  |
| Route and open sheets           | React shell                                          |
| Payment/gacha/market workflow   | Feature state machine persisted by authoritative IDs |
| Authoritative run/world         | Realtime client store                                |
| Predicted local visual position | Reconciler/game runtime                              |
| Remote interpolated transforms  | Three.js runtime                                     |
| Frame effects and particles     | Three.js pools                                       |
| Leaderboards/history            | Indexed query cache with provenance                  |
| Settings                        | Versioned local profile, synced where appropriate    |

## 7. Routing and screen map

### 7.1 Primary destinations

- `/` — living home and room selection
- `/play/:mode/:day` — active/recovering run
- `/agents` — collection and carousel
- `/agents/:assetOrClass` — agent detail
- `/leaderboards` — daily, season, all-time
- `/gacha` — banner lobby
- `/gacha/:banner` — pull review/result recovery
- `/market` — marketplace browse
- `/market/:asset` — listing detail
- `/profile` — wallet, history, pity, receipts, sessions
- `/settings` — controls, audio, haptics, quality, accessibility
- `/admin` — gated operations

Deep links must recover wallet/network and workflow state safely. URL parameters never override authoritative account relationships.

### 7.2 Bottom navigation

Five original-icon destinations:

1. Leaderboards
2. Play/Home
3. Agents
4. Gacha
5. Marketplace

The active item lifts above the dock. The dock hides during gameplay, signature requests, and blocking transaction stages.

## 8. Complete screen specification

### 8.1 Boot

- Immediate brand-color background.
- Original Lana Roads wordmark assembles from blocks.
- Hopping lane marker represents progress.
- Named stages after two seconds: loading world, connecting, syncing day, loading selected agent.
- No indefinite spinner.
- Core controls appear only when their assets and minimum data are ready.

### 8.2 Wallet onboarding

- Home world is visible before connection.
- Read-only leaderboards, odds, catalog, and marketplace may remain browsable.
- Paid or ownership action triggers connect.
- Explain wallet versus session key in plain language.
- Network mismatch offers one switch action.
- Production supports the selected Solana wallet adapter set; burner mode is dev-only.

### 8.3 Home

The camera frames the safe zone with the selected agent in front and nearby players idling behind.

Top utility:

- Lana Roads wordmark;
- shortened wallet or Connect;
- available USDC when known;
- unhealthy connection indicator;
- profile/settings entry.

Center room cards:

- `DAILY POT · PAID`;
- `CASUAL WORLD · FREE`.

Paid card shows exact entry, pool, current record, active players, and UTC remaining. Casual shows player count, free label, and no-prize label. Horizontal swipe or clear tabs switch cards. Paid never uses an ambiguous `PLAY` label.

### 8.4 Agent carousel

- One selected 3D VoxelAnimal centered at large scale.
- Neighboring variants partially visible.
- Horizontal swipe snaps one item at a time.
- Agent name, animal, rarity, season, class, ability, cooldown, ownership, lock, and listing state.
- Same-class variants show exactly identical mechanics.
- Paid mode allows starter or owned available NFT.
- Casual allows every class with clear preview/ownership labeling.
- Filter sheet: owned, available, class, rarity, season, listed.
- Paid confirmation explicitly states lifetime-of-attempt lock including revivals.

### 8.5 Paid entry

```text
Review 1 USDC + selected agent + lock + cutoff
  -> Awaiting wallet
  -> Base submitted
  -> Base confirmed
  -> Preparing/delegating run
  -> ER spawn confirmed
  -> Camera dive and HUD
```

Failure after payment exposes durable refund and unlock status. The player is not shown active before spawn confirmation.

### 8.6 Casual entry

- Clearly free.
- No wallet spending review.
- Session/delegation progress may display briefly.
- Spawn failure offers retry without suggesting payment/refund.

### 8.7 Gameplay

The world consumes at least 80% of visual attention.

Persistent HUD:

- top-left score;
- top-right incumbent record;
- compact paid pool in paid mode;
- right-edge Kick and ability;
- connection warning only when unhealthy.

Temporary feedback:

- tile blocked;
- cooldown ready;
- action rejected;
- record beaten;
- chunk frontier waiting;
- reconnecting;
- authoritative correction;
- train warning;
- target/effect feedback.

Developer coordinates, raw run state, and RPC region are hidden from production HUD and available through a dev panel.

One exception to that rule ships: a bottom-left presence strip showing live player count and rollup round-trip. In a real-money multiplayer game these are not diagnostics — they are what tells a player the world is populated and that a refused move was latency rather than the game breaking. Home carries the same pair before the player commits to a run. Both stay quiet: small chips, dimmed, never competing with the score, with the latency chip coloured only when it crosses into laggy (120ms) or painful (300ms).

### 8.8 Interruption sheet

The world does not pause. The sheet says `WORLD STILL LIVE` and contains Resume, Controls, Audio, Haptics, Graphics, Left-handed mode, and End attempt. Wallet/system dialogs do not make the player invulnerable.

### 8.9 Paid death and revival

- Hazard-specific playful headline.
- World remains visible but dimmed/desaturated.
- Score and incumbent record.
- Exact next USDC price.
- Numeric and linear authoritative countdown.
- Preserved attempt/score/agent/cooldown explanation.
- Primary `REVIVE · N USDC`.
- Secondary `END ATTEMPT`.
- Unlock/finalization state.
- Final ten seconds increase urgency without hiding facts.

### 8.10 Casual death

- No revive purchase.
- Score and personal/casual best.
- `RUN AGAIN · FREE`.
- `CHANGE AGENT`.
- Leaderboard position when available.

### 8.11 Results

- Personal best ribbon.
- Room-record celebration only after authoritative acceptance.
- Equal score copy: `MATCHED RECORD — BEAT N TO TAKE LEAD`.
- Daily winner card after finalization with 90% value and payout state.
- No-winner day explains full rollover.

### 8.12 Leaderboards

Tabs:

- Paid Today
- Casual Today
- Season Wins
- All Time

Top three use podium cards and real agent renders. Remaining rows are virtualized. Show rank, wallet/display name, portrait, class, score/wins, and provisional/final state. Sticky local-player row when offscreen.

### 8.13 Agent collection/detail

- Responsive collection grid.
- Three.js turntable detail.
- Metadata, rarity, season, class, ability, asset address.
- Owned/listed/locked state.
- Runs and top score where indexed.
- List/delist actions.
- Same-class mechanic disclosure.

### 8.14 Gacha

Three banners show 5/10/20 USDC, current effective odds, supply, inventory revision, and separate Epic/Legendary pity.

Flow:

```text
Odds/payment review
  -> wallet approval
  -> VRF request pending
  -> authoritative assignment
  -> visual reveal
  -> NFT claim/received
  -> or five-minute timeout refund
```

Animation never chooses or rerolls the result. Duplicate means another tradable NFT. Required-pity unavailability pauses the banner visibly.

### 8.15 Marketplace

- Search/filter/sort/virtualized browse.
- Agent card with class equality information.
- Listing detail with seller, exact USDC, royalty, ownership, and state.
- Review before buy/list/delist signature.
- Sold/stale/locked/indexer-delay recovery.

### 8.16 Profile/history

- Wallet/network/USDC.
- Agent count and collection access.
- Paid/casual/season stats.
- Pity by banner.
- Active/refundable receipts.
- Gacha requests.
- Listings.
- Transaction signatures.
- Session revoke/rotate.
- Settings and accessibility.

### 8.17 Admin

Admin is visually restrained. It displays program-derived values and does not permit arbitrary winner, recipient, or payout fields. Every action has review, signature, verification, and durable status.

## 9. Mobile controls

### 9.1 Movement

- Swipe up/down/left/right on unobstructed gameplay surface.
- One gesture submits at most one cardinal grid-step intent.
- No default virtual joystick.
- No continuous movement while finger remains down.
- Dominant-axis lock rejects ambiguous diagonals.
- At most one bounded next movement is queued.

Initial recognition calibration:

- minimum travel 24 CSS px;
- axis dominance 1.35:1;
- maximum recognition window 420 ms;
- velocity may lower threshold to no less than 16 px.

These are frontend recognition values, not authoritative game rules.

### 9.2 Pointer ownership

Pointer ownership is fixed at touch-down: movement, Kick, ability, HUD, modal, or browser-safe region. A button touch never turns into movement after sliding away. Financial overlays suspend gameplay input.

### 9.3 Side buttons

- Kick and ability on lower right by default.
- Minimum 64 CSS px; target 72–80 px.
- Left-handed setting mirrors them.
- Kick icon remains universal.
- Ability icon is class-specific.
- States: ready, pressed, submitting, accepted, cooldown, rejected, disabled, dead, reconnecting.
- Cooldown uses mask plus seconds under ten.

### 9.4 Accessibility pad

An optional four-direction button pad can replace swipe recognition. It is off by default and does not alter authority or timing.

### 9.5 Desktop

- WASD/arrows move.
- Space Kicks.
- E or Q uses ability.
- Escape opens interruption sheet.
- Key repeat cannot create an unbounded queue.

## 10. Three.js world presentation

### 10.1 Camera

- Isometric three-quarter perspective matching voxel readability.
- Local player stays below vertical center during forward play to expose upcoming rows.
- Camera follows with critically damped motion, no elastic bouncing.
- Side movement receives limited lateral tracking.
- Backward movement does not reveal excessive closed world.
- Menu camera uses authored targets around the same world.
- Crowded safe zone may lift/zoom slightly to preserve local identity.

### 10.2 World rendering

- Endless 16-row chunks streamed around interest range.
- Road, rail, river, safe, and blocked terrain have unmistakable silhouettes and colors.
- Vehicles/logs/trains use deterministic transforms from canonical data/time.
- Vehicle model selection comes from a canonical visual variant ID; clients never choose a random model independently.
- Unrevealed frontier is visibly closed, not empty traversable space.
- Static blockers match occupancy exactly.
- World visuals never suggest a passable tile that authority rejects without a clear reason.

### 10.3 Agents

- GLB output generated from private `VoxelAnimals/` sources.
- Standard grid collider and occupancy regardless of visual size.
- Normalized scale, pivot, forward axis, ground contact, shadow, and animation anchor.
- Local player has a subtle ground marker or outline under crowding.
- Remote names are hidden by default; selected/contextual labels only.
- Legendary trails and rarity effects are quality/distance bounded.

### 10.4 Hazard readability

- Vehicles: strong lane contrast and direction cues.
- A curated vehicle roster is used instead of loading every source-pack model.
- Compact cars, pickups, and buses must remain recognizable from the gameplay camera at mobile resolution.
- Vehicle collision and occupied tile length come from canonical hazard data, never rendered mesh bounds.
- Police lights, spoilers, exhausts, and other decorative parts are cosmetic and cannot change speed, collision, score, or rewards.
- Trains: visual, audio, and optional haptic warning tied to canonical window.
- Rivers: water motion distinct from safe blue UI accents.
- Logs/platforms: clear support footprint and sinking phase.
- Ability-altered lanes show temporary local effect without changing permanent chunk appearance.

### 10.5 Curated vehicle asset roster

The private source workspace contains two newly supplied vehicle sources:

- `Low_Poly_Cars_DevilsWorkShop_V03/` — licensed low-poly vehicle pack with 11 model files across FBX, OBJ, and DAE formats.
- `SportsCar_Yellow/` — standalone 220-vertex yellow sports car supplied with FBX, OBJ, DAE, and texture sources.

The initial gameplay roster should deliberately use only a subset:

| Runtime role      | Preferred source                                                     | Canonical footprint            | Initial use                                                      |
| ----------------- | -------------------------------------------------------------------- | ------------------------------ | ---------------------------------------------------------------- |
| Compact car A     | `Low_Poly_Vehicles_car01`                                            | 1–2 tiles, fixed by simulation | common road traffic                                              |
| Compact car B     | `Low_Poly_Vehicles_car02`                                            | same as compact A              | color/visual variety                                             |
| Compact car C     | `Low_Poly_Vehicles_car03`                                            | same as compact A              | color/visual variety                                             |
| Police car        | `Low_Poly_Vehicles_carPolice`                                        | same as compact A              | uncommon visual variant                                          |
| Pickup            | choose one of `pickupTruck01` or `pickupTruck02` after camera review | simulation-defined             | medium silhouette traffic                                        |
| Bus               | `Low_Poly_Vehicles_bus`                                              | longer multi-tile hazard       | uncommon long traffic                                            |
| Yellow sports car | `SportsCar_Yellow`                                                   | simulation-defined             | candidate rare visual variant after provenance and camera review |

The following files are not standalone traffic hazards and must not be registered as vehicles: `car_modeEngine`, `car_modLights`, `car_modPipes`, and `car_modSpoiler`. They are optional accessory meshes for authored cosmetic variants only. The unused pickup skin may be retained as a future visual variant without creating a new mechanical class.

Vehicle selection rules:

- Start with compact A/B/C, one pickup, and the bus; add police and sports variants only after gameplay-camera readability testing.
- A visual variant may share geometry, footprint, and motion behavior with another variant.
- Do not infer hazard speed or rarity from appearance. Canonical chunk/hazard state supplies archetype, direction, speed, timing, and footprint.
- All players resolve the same canonical vehicle asset ID for a hazard.
- If a client lacks an asset, it renders a footprint-correct fallback vehicle instead of hiding the hazard.
- Long vehicles must visually cover every occupied tile without extending misleadingly into safe tiles.
- Bright emissive police lights and headlights are quality-tiered, distance-capped, and never required to understand collision.
- Source models remain private. Only optimized runtime derivatives approved for distribution ship to the web client.

### 10.6 Vehicle conversion and optimization

Each selected source vehicle is converted into one normalized GLB derivative:

1. Import the FBX source when clean; use OBJ/DAE only as a recovery path.
2. Apply transforms and normalize forward axis, origin, wheel contact, and scale against the canonical tile grid.
3. Remove unused nodes, inaccessible interiors, duplicate materials, and hidden geometry.
4. Combine accessory meshes only when an authored variant explicitly requires them.
5. Bake or remap textures into the project color language; preserve strong roof/body contrast from the isometric camera.
6. Produce compressed GLB with quantized geometry and appropriately sized WebP/KTX2 textures.
7. Record source path, source license/provenance, output hash, dimensions, triangle count, material count, and runtime asset ID in the asset manifest.
8. Validate silhouette, footprint alignment, travel direction, shadows, pooling, and low-quality fallback on a real mobile viewport.

Recommended runtime IDs are stable semantic names such as `vehicle.compact.a`, `vehicle.compact.b`, `vehicle.pickup.a`, `vehicle.police.a`, `vehicle.bus.a`, and `vehicle.sport.yellow`. Filenames and pack-specific names must not leak into gameplay protocol fields.

### 10.7 Interest management

- Nearby players receive full models/animation.
- Mid-distance players use reduced animation/LOD.
- Far players use simple bust/silhouette/marker or are culled.
- Never render all 500 agents at full detail.
- Chunk, hazard, effect, and remote-player resources are pooled.

## 11. Prediction and reconciliation

- Predict one local legal-looking movement for responsiveness.
- Prediction never awards score, consumes money, declares death, decides occupancy, or starts authoritative cooldown.
- Track action nonce/sequence and predicted tile.
- Older pushes do not rubber-band over newer in-flight prediction.
- Authoritative catch-up confirms visual position.
- Rejected/silent action triggers bounded reconciliation instead of waiting indefinitely.
- Small correction reverses/snaps within 100–140 ms.
- Sequence gap rebuilds run, nearby occupancy, world header, and relevant chunks.
- Remote players interpolate between authoritative tiles without extrapolating through blockers.

## 12. Visual design system

### 12.1 Core colors

| Token      | Value     | Purpose             |
| ---------- | --------- | ------------------- |
| Sky        | `#57CFF2` | agent/info surfaces |
| Aqua       | `#22B9E6` | active navigation   |
| Grass      | `#4BE08F` | casual/success      |
| Grass dark | `#169B60` | depth/contrast      |
| Sun        | `#FFD23F` | primary play/reward |
| Sun dark   | `#C96F14` | button lower edge   |
| Coral      | `#F45169` | paid urgency/revive |
| Coral dark | `#A82443` | danger depth        |
| Violet     | `#8E63EA` | Epic/special        |
| Navy       | `#101827` | panels/navigation   |
| Deep navy  | `#08111F` | outline/shadow      |
| Slate      | `#B8C5D9` | secondary text      |
| Paper      | `#FFFDF5` | light cards         |

### 12.2 Rarity

- Common: silver/stone.
- Rare: blue plus square sparkle.
- Epic: violet plus diamond.
- Legendary: gold plus restrained glint/trail.

Rarity includes text/shape, never color alone. Rarity does not modify same-class mechanics.

### 12.3 Typography

- Licensed original block/pixel display face for logo, score, CTA, agent names, result headlines.
- Compact rounded grotesk for body, transaction details, odds, settings, and tables.
- Strong tabular numerals.
- Do not use Inter, Roboto, Arial, Segoe UI, or Crossy Road's exact branded typography as final identity.

Mobile scale:

- Hero 36–48 px.
- Score 32–40 px.
- Screen title 24–30 px.
- CTA 18–22 px.
- Body 14–16 px.
- Metadata 12–13 px.
- Minimum label 11 px.

### 12.4 Shape/depth

- 12–20 px radii with selective stepped corners.
- 2–4 px outlines.
- 5–8 px hard lower-edge button depth.
- One soft environmental card shadow at most.
- No pervasive blur/glass.
- Square, diamond, stair-step, chevron, and lane motifs.

### 12.5 Components

Implemented in `apps/web/src/design-system/` (import from `design-system/index.ts`):

- Button (ArcadeButton: info/primary/play/danger/violet/ghost/link, sm/giant, busy state)
- IconButton
- Card (ArcadeCard)
- Sheet (BottomSheet) and Modal (FocusModal), both with Escape/backdrop dismiss and ARIA dialog semantics
- Pill (StatusPill)
- StatGrid (label/value tiles, tabular numerals)
- Steps (bounded progress track; grows into TransactionTimeline)
- Notice (durable banner), Loader (hopping-block async indicator)
- Confetti, CountUp
- Icon (original inline SVG set in `icons.tsx`)

Planned as product surfaces arrive: ModeCard, AgentCard, NumericDisplay, CooldownButton, ProgressTrack, TransactionTimeline, Toast/EventBanner, PodiumRow, VirtualizedAgentGrid.

Every component defines idle, hover, focus, press, loading, success, disabled, and error states where applicable.

## 13. UI asset system

### 13.1 Production rules

- No production emoji.
- No text-symbol icons.
- Original SVG for scalable semantic icons where practical.
- Transparent PNG/WebP for raster effects and generated decorative art.
- Three.js renders for agents.
- Nine-slice or CSS/SVG for resizable structural panels.
- Every asset has a stable ID, dimensions/viewbox, semantic role, hash, provenance, and preload group.

### 13.2 Generated source atlases

Initial Codex-generated transparent source sheets:

- [`lana-roads-ui-icons-v1.png`](../assets/generated/ui/voxel-arcade-v1/lana-roads-ui-icons-v1.png)
- [`lana-roads-ui-components-v1.png`](../assets/generated/ui/voxel-arcade-v1/lana-roads-ui-components-v1.png)
- [`lana-roads-ui-effects-v1.png`](../assets/generated/ui/voxel-arcade-v1/lana-roads-ui-effects-v1.png)
- [Atlas usage and extraction notes](../assets/generated/ui/voxel-arcade-v1/README.md)

These sheets are source concepts, not a final runtime atlas. Selected elements must be extracted, edge-cleaned, normalized, reviewed, and assigned stable IDs. Structural controls should be redrawn deterministically when stretching/accessibility requires it.

### 13.3 Required icon inventory

- Play/Home
- Leaderboard
- Agents
- Gacha
- Marketplace
- Wallet
- Settings
- Audio/Haptics/Graphics/Controls
- Kick
- One icon per class ability
- Lock/Unlock/Listed/Owned
- USDC/Price/Royalty
- Timer/Cooldown
- Warning/Error/Success/Refund/Pending
- Connection/Reconnect/Network
- Train/River/Blocked/Frontier
- Share/Copy/External transaction

Missing core assets fail production build validation.

### 13.4 VoxelAnimals output

For each source model generate:

- optimized GLB;
- transparent portrait;
- full-body card render;
- leaderboard bust;
- marketplace thumbnail;
- carousel configuration;
- optional Legendary preview.

Raw Unity/OBJ/VOX files never enter public build output.

## 14. Motion and transitions

### 14.1 Timing

| Token                     |   Duration |
| ------------------------- | ---------: |
| Press/reject              |  70–100 ms |
| Small UI                  | 140–190 ms |
| Screen/camera             | 220–300 ms |
| Celebration               | 360–520 ms |
| Assigned rarity spectacle | 600–900 ms |

Normal routes become interactive within 300 ms.

### 14.2 Families

- Hop: movement and active navigation.
- Press: button face compresses into depth.
- Slide: sheets/carousel.
- Pop: badge/card/reward.
- Stamp: death/error/sold out.
- Build: boot wordmark and assigned reveal.
- Camera travel: route context.

### 14.3 Route choreography

- Home to Agent: card drops, camera orbits to agent, carousel appears.
- Agent to Review: world dims, bottom review rises.
- Spawn: review stamps closed, camera dives into safe zone, HUD enters.
- Death: impact beat, world dims, revival card stamps.
- Leaderboard/Market/Gacha: camera moves toward themed landmark while sheet enters.
- Back reverses spatial relationship where safe.

Transforms and opacity are preferred. Avoid animated layout, full-screen white flashes, long crossfades, and unbounded particle creation.

## 15. Game feel

### 15.1 Hop

- 35–55 ms squash anticipation.
- 90–140 ms visual arc.
- 45–70 ms landing squash.
- Small camera nudge and optional light haptic.

### 15.2 Blocked move

- 70–100 ms directional bump-back.
- Dry blocked tick.
- Small edge spark when useful.
- No score/camera progress.

### 15.3 Kick

- Immediate button compression.
- Directional target telegraph.
- Authoritative acceptance triggers stretch, block dust, camera impulse, medium haptic.
- Rejection resets quickly with reason.

### 15.4 Abilities

Each closed ability type has an original telegraph, cast, accepted effect, cooldown, and rejection treatment. Visuals never imply direct lethal damage. Effects remain local and bounded.

### 15.5 Death

Hazard-specific reaction; short impact; no excessive gore. Death presentation must not delay the 60-second authoritative revival decision.

## 16. Audio and haptics

Original/licensed audio only:

- navigation block click;
- CTA confirmation;
- hop/land variations;
- blocked tick;
- Kick impact;
- class ability cues;
- vehicle/river/train warnings;
- death reactions;
- record fanfare;
- rarity reveal layers;
- transaction pending/resolution;
- refund/success/failure.

Haptics:

- light for navigation/hop;
- medium for Kick/ability/card snap;
- heavy for death/Legendary/record;
- warning pattern for final revival seconds and connection loss.

Separate music, effects, warnings, and haptic controls. Important audio has visual/text equivalent.

## 17. Tutorial and first-time experience

### 17.1 Order

1. Show living world without wallet.
2. Teach one swipe on a safe tile.
3. Teach four directions in a short safe sequence.
4. Show occupied tile rejection.
5. Teach Kick on a harmless dummy/volunteer context.
6. Preview a class ability in casual.
7. Complete a short casual run/death loop.
8. Introduce paid room only after controls are understood.
9. Explain 1 USDC, winner pool, revival escalation, and agent lock.
10. Introduce gacha/marketplace from separate optional surfaces.

### 17.2 Rules

- Tutorial is skippable and replayable.
- Never require paid entry to learn controls.
- Do not present gacha before basic game comprehension.
- Returning players bypass completed instruction.
- Tutorial overlays use the same gesture ownership and accessibility behavior as production.

## 18. Wallet and economy UX

### 18.1 Transaction review standard

Every signature surface shows:

- action;
- exact asset/USDC;
- payer and recipient consequence;
- selected agent and lock consequence;
- network;
- room/banner/listing;
- irreversible versus refundable state;
- expected next stage.

### 18.2 State restoration

Financial workflows persist identifiers and reconstruct from authoritative state after reload. A reveal animation, toast, or closed modal is never the only record of completion/failure.

### 18.3 Disclosure

- Intentional pay-to-win class access.
- Paid random gacha and exact odds.
- Separate pity counters.
- Duplicate tradable NFTs.
- Revival doubling.
- 90/10 prize split.
- Requested in-game royalty and external bypass possibility.
- Geographic/age restrictions where required.

No fake scarcity, confirm-shaming, hidden prices, or misleading reveal behavior.

## 19. Responsive design

Reference coverage:

- 360 x 640 phone portrait;
- 390 x 844 phone portrait;
- 430 x 932 large phone;
- 844 x 390 phone landscape;
- 768 x 1024 tablet portrait;
- 1024 x 768 tablet landscape;
- 1366 x 768 laptop;
- 1920 x 1080 desktop.

Rules:

- Respect safe-area insets plus 12 px.
- Use dynamic viewport units safely.
- Phone horizontal margin 14–18 px.
- Primary CTA 54–64 px high.
- Informational sheets scroll normally.
- Prevent overscroll/selection only on active game surface.
- Landscape relocates side buttons to reachable lower corners.
- Desktop centers the world and uses side panels, not a stretched phone.
- Keyboard hints appear only after keyboard detection.

## 20. Accessibility

- Keyboard-complete menus and financial flows.
- Visible stepped focus outline.
- Focus trap and restoration for dialogs.
- 200% text scaling on nongameplay surfaces.
- No hover-only controls.
- Reduced motion removes sweeps, overshoot, continuous idles, and confetti.
- Color-independent states and rarity.
- Caption/text equivalents for warning audio.
- No haptic-only information.
- Left-handed mode.
- Gesture sensitivity.
- Optional direction pad.
- Graphics quality and contrast options.
- Screen-reader summaries for score, state, death, transaction, and cooldown readiness without announcing every remote movement.

## 21. Performance

At 60 Hz target 16.67 ms:

- Three.js render/update <= 10 ms typical.
- UI layout/paint <= 3 ms during gameplay.
- Input/network/reconciliation <= 2 ms typical.
- > = 1.5 ms margin.

Rules:

- Keep frame state outside React renders.
- Pool particles/effects/labels.
- Use instancing, LOD, culling, atlases, and interest radius.
- Cap device pixel ratio.
- Preload selected/neighbor agents and core HUD only.
- Pause hidden menu animation.
- Avoid live blur and multi-shadow layers.
- Release geometries, textures, mixers, listeners, timers, subscriptions, workers, and audio nodes.

Quality tiers:

- High: full particles/trails/shadows.
- Balanced: reduced particles and standard transitions.
- Performance: minimal shadows/effects and simpler previews.
- Reduced motion: direct short state changes.

Gameplay authority and timing do not change with quality.

## 22. Connection and error handling

- Healthy connection is quiet.
- Degraded: small `SYNCING` indicator.
- Disconnected: persistent `RECONNECTING — WORLD STILL LIVE`.
- Restored: authoritative rebuild and brief success state.
- Wrong network: clear blocker before writes.
- Gameplay errors use local feedback.
- Financial failures use durable sheets/history with signature and recovery.
- Refundable state is never an ephemeral toast.
- Unsupported version blocks writes safely.
- Maintenance preserves valid refund/claim access when safe.

## 23. Data and indexing

- Critical write reviews reread authoritative accounts.
- Indexer provides leaderboards/search/history only.
- Provisional versus finalized is visible where relevant.
- Realtime updates are sequence-checked.
- Query keys include cluster/program/account version.
- Cache cannot authorize payment, ownership, score, or outcome.
- Indexer outage does not prevent gameplay, refund, claim, or settlement workflows that can use authoritative sources.

## 24. Analytics

Privacy-conscious product metrics:

- load to interactive;
- wallet and entry funnel;
- paid/casual card confusion/cancellation;
- swipe recognition/rejection;
- accidental action buttons;
- input latency and reconciliation;
- class pick/ability success;
- hazard deaths;
- revival review/approval/rejection;
- gacha odds view and cancellation;
- marketplace funnel;
- frame-time/quality tier;
- reconnect and restored workflows;
- tutorial completion/drop-off.

Never collect private/session keys, wallet-adapter payloads, unnecessary personal information, or keystroke-level telemetry.

## 25. Testing

### 25.1 Unit/component

- Gesture thresholds and pointer ownership.
- Input queue and key repeat.
- Transaction state machines.
- Countdown formatting/resync.
- Money and odds presentation.
- Component states.
- Asset manifest validation.
- Reduced motion and left-handed layout.

### 25.2 Browser/E2E

- Boot and connect.
- Wrong network.
- Paid/casual selection.
- Agent selection.
- Paid entry stages and refund.
- Casual spawn.
- Swipe and keyboard gameplay.
- Kick/ability states.
- Reconnect and sequence gap.
- Paid/casual death.
- Revival.
- Gacha assignment/timeout/refund.
- Marketplace buy/list/stale.
- Leaderboards/profile/admin.
- Reload during every financial stage.

### 25.3 Visual regression

Capture every reference viewport for loading, room cards, carousel rarities, transaction states, gameplay HUD, cooldown, blocked move, reconnect, death countdown values, results, leaderboards, gacha, market, settings, admin, reduced motion, and high contrast.

### 25.4 Performance

- Representative nearby players and hazards.
- p50/p95 frame time.
- input-to-visual response.
- 20-minute mobile thermal session.
- background/foreground recovery.
- address-bar resize.
- no unbounded DOM, listener, texture, particle, or queue growth.

## 26. Security requirements

- Never trust browser/indexer data for money, NFT, score, cooldown, death, or winner.
- Session keys cannot spend or transfer.
- Review exact program IDs, cluster, mint, collection, and transaction consequence.
- Prevent URL account substitution.
- Never log secrets/private RPC/session bytes.
- Sanitize metadata and external URLs.
- Apply CSP and safe link handling.
- Do not expose raw purchased VoxelAnimals source through Vite/public output.
- Production build contains no burner private key flow.

## 27. Delivery phases

### Phase 1 — Design-system foundation

- Final fonts and license.
- Tokens and base components.
- Original icon inventory.
- Asset manifest and source/runtime separation.
- Persistent canvas shell.

### Phase 2 — Mobile core loop

- Home room cards.
- Agent carousel.
- Gesture input and side buttons.
- Final HUD.
- Camera/game feel.
- Paid/casual entry and death/revival.

### Phase 3 — Collection and competition

- Leaderboards.
- Agent collection/detail.
- Profile/history/settings.
- Tutorial.

### Phase 4 — Economy surfaces

- Gacha.
- Marketplace.
- Refund/claim recovery center.
- Admin.

### Phase 5 — Polish and qualification

- Audio/haptics.
- Effects and transitions.
- Accessibility.
- Device quality tiers.
- Visual regression.
- Performance/load/thermal validation.

## 28. Definition of done

The frontend is complete only when:

- it looks and feels like the approved vibrant Voxel Arcade game;
- the Three.js world anchors core navigation;
- portrait mobile is first-class;
- swipe movement and side buttons pass usability testing;
- no production emoji or copied reference assets remain;
- real VoxelAnimals-derived runtime assets replace placeholders;
- every approved product surface and state exists;
- money and NFT consequences are explicit;
- prediction never overrides authority;
- reconnect and financial recovery survive reload;
- responsive, keyboard, accessibility, reduced-motion, and left-handed modes pass;
- representative gameplay meets measured frame budgets;
- subscriptions and resources clean up;
- visual, interaction, E2E, and security checks pass;
- development diagnostics are absent from player-facing production UI;
- generated UI sources have been reviewed and converted into optimized stable runtime assets.

## 29. Immediate implementation gap checklist

Against the current devnet vertical slice, the next frontend implementation work is:

- [ ] Establish persistent full-screen app shell and typed routes.
- [ ] Implement tokens, typography, and Arcade components.
- [ ] Replace emoji/logo placeholder and generic system font.
- [ ] Add original navigation/action icons.
- [ ] Implement mobile gesture recognizer and pointer ownership.
- [ ] Implement Kick and ability side buttons.
- [ ] Separate dev diagnostics from player HUD.
- [ ] Recompose Home as living-world room selection.
- [ ] Build agent carousel and asset manifest.
- [ ] Convert selected VoxelAnimals to GLB and portraits.
- [ ] Convert the curated compact cars, one pickup, and bus to normalized GLB vehicle variants.
- [ ] Add canonical vehicle asset IDs, footprint-correct fallback models, and a provenance manifest.
- [ ] Implement camera route states and transitions.
- [ ] Redesign entry and revival state machines visually.
- [ ] Add interruption/settings/accessibility controls.
- [ ] Build casual results and record celebrations.
- [ ] Add leaderboard, collection, profile, gacha, market, and admin surfaces.
- [ ] Add original audio/haptics and quality tiers.
- [ ] Add visual regression, mobile E2E, accessibility, and performance gates.

This checklist tracks missing frontend presentation and product surfaces only. It does not override contract, SDK, MagicBlock, security, audit, or legal launch gates.
