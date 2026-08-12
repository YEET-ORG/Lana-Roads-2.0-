# Crossy World: Frontend and Three.js Specification

**Status:** Draft for user review  
**Parent:** [Crossy World product and protocol design](./2026-08-13-crossy-world-design.md)  
**Contract:** [Contract and economy specification](./2026-08-13-crossy-world-contract-economy-spec.md)  
**Realtime:** [MagicBlock gameplay integration specification](./2026-08-13-crossy-world-magicblock-integration-spec.md)  
**Date:** 2026-08-13

## 1. Purpose

This document specifies the React/Vite application, Three.js game runtime, wallet and transaction UX, state ownership, realtime prediction/reconciliation, asset pipeline, accessibility, performance budgets, admin screens, and frontend acceptance criteria.

## 2. Product principles

- On-chain state is authoritative; frontend prediction is presentation only.
- Money and NFT actions always present exact reviewed consequences before wallet signature.
- Paid and casual modes are visually distinct and cannot be confused.
- Pending asynchronous work is shown explicitly instead of pretending completion.
- Users can verify prize pool, record holder, odds, pity, supply, and transaction signatures.
- The game remains playable with reduced effects and keyboard/touch controls.
- Raw purchased Unity assets are never redistributed.

## 3. Application architecture

```text
React application shell
├── Routing and page layouts
├── Wallet/session providers
├── Query/cache/indexer client
├── Transaction workflow controller
├── Game route
│   ├── Three.js renderer
│   ├── Realtime state adapter
│   ├── Prediction/reconciliation
│   ├── Input controller
│   ├── Audio/effects
│   └── HUD/overlays
├── Gacha route
├── Inventory/marketplace routes
├── Leaderboard/profile routes
└── Admin route
```

React owns navigation, forms, wallet workflows, and overlays. Three.js owns the scene and render loop. Neither directly constructs raw program instructions; both use the game SDK.

## 4. Recommended source boundaries

The implementation plan should converge on boundaries like:

```text
apps/web/src/
  app/                 routing, providers, layouts
  features/home/
  features/entry/
  features/game/
  features/gacha/
  features/inventory/
  features/marketplace/
  features/leaderboards/
  features/profile/
  features/admin/
  game/renderer/       Three.js-only code
  game/simulation/     prediction/interpolation, no program writes
  game/input/
  game/assets/
  components/
  lib/sdk/
  lib/query/
  lib/transactions/
```

No monolithic `App.tsx` comparable to the existing large Escape Duo file is accepted. Feature modules expose narrow public interfaces.

## 5. Routes

Suggested routes:

- `/` home and mode selection
- `/play/paid`
- `/play/casual`
- `/inventory`
- `/agents/:assetOrClass`
- `/gacha`
- `/market`
- `/leaderboards/daily`
- `/leaderboards/season`
- `/profile/:wallet?`
- `/admin`

Room/day identifiers are derived from chain state. Query parameters may carry intended region or referral metadata but cannot override canonical world routing.

## 6. Global providers

- Wallet-standard provider and connected signer.
- Cluster configuration provider.
- Crossy SDK/client provider.
- Session-key provider scoped by wallet/cluster/application.
- Query client with account/event cache.
- Transaction workflow/toast provider.
- Audio/accessibility/preferences provider.

Changing wallet or cluster tears down game subscriptions, clears wallet-scoped optimistic state, and reloads canonical profiles.

## 7. Home screen

Must show:

- Current UTC day and countdown to hard cutoff.
- Paid room status: Preparing, Open, Paused, Closed, Voided, Settled.
- Active prize pool and rollover breakdown.
- Current champion wallet display and record score.
- Approximate active population.
- Paid entry CTA with 1 USDC price.
- Casual CTA labeled free/no prize.
- Links to gacha, inventory, marketplace, and leaderboards.
- Service/degraded-state banner when ER, VRF, or admissions are unavailable.

The displayed pool is sourced from durable accounting, not summed client-side from events.

## 8. Agent selection

### 8.1 Inventory view

- Starter entitlement card.
- Owned Core agent assets grouped by class and rarity.
- Class ability, exact cooldown, and current balance version.
- Cosmetic preview, rarity, season, and serial/asset address.
- Locked, listed, or available status.
- External marketplace/open explorer actions.

### 8.2 Selection rules

- Paid mode: starter or currently owned, available NFT.
- Casual mode: every class available; cosmetics may default to owned/free preview policy.
- Listed/frozen NFT disabled with reason.
- Selected NFT remains fixed for the full attempt and revivals.

### 8.3 Disclosure

Before paid entry, UI states clearly that some stronger classes are available only through rarer agents and that the game intentionally has pay-to-win elements.

## 9. Paid entry workflow

The workflow is a visible state machine:

```text
Review
-> Wallet signing/payment
-> Payment confirmed on Solana
-> Agent locked
-> Run delegated/preparing
-> Spawn pending
-> Active

Failure branches -> Refund available -> Refunded/unlocked
```

### 9.1 Review panel

Shows:

- Exactly 1 USDC
- Current vault/pool and rollover
- Selected agent and class
- NFT lock duration: until attempt ends
- Daily cutoff
- Winner-takes-all 90/10 split
- Transaction recipient/program summary

No prechecked consent or hidden combined spend.

### 9.2 Pending UX

After payment, do not show the player as active until ER spawn confirms. Show signatures and retry-safe status. If capacity/spawn fails, present one-click refund and agent unlock.

## 10. Game screen layout

Desktop composition:

- Center: Three.js world.
- Top-left: score, personal best, current record.
- Top-center: UTC cutoff countdown and room mode.
- Bottom-left: movement controls/help.
- Bottom-right: Kick and class ability cooldowns.
- Side panel or collapsible overlay: nearby players/events and compact leaderboard.
- Status strip: connection, ER endpoint/region, pending input, degraded state.

Mobile composition uses touch controls and collapsible panels without reducing the playable viewport excessively.

## 11. Input

### 11.1 Keyboard

- WASD and arrow keys: grid direction.
- Space or configurable key: Kick.
- E/Q or configurable key: class ability.
- Escape: menu, never browser-dependent input loss without cleanup.

### 11.2 Touch

- Swipe or four-direction pad.
- Dedicated Kick and ability buttons.
- Haptic feedback where available.

### 11.3 Input queue

- At most one bounded next movement intent is buffered.
- No unbounded spam queue.
- Ability/Kick submit once per press, not key repeat.
- UI shows pending/rejected action feedback.
- Focused text inputs suspend gameplay shortcuts.

## 12. Prediction and reconciliation

### 12.1 Local movement

1. Read canonical PlayerRun/sector.
2. Predict one tile if locally plausible.
3. Animate immediately.
4. Submit action through SDK.
5. On authoritative update, confirm prediction.
6. On rejection or mismatch, smoothly correct within a bounded duration and display reason when useful.

Prediction never increments durable score display beyond a visually marked pending value. Prize/record UI changes only on authoritative state.

### 12.2 Remote players

- Subscribe to nearby sectors.
- Convert tile transitions into timestamped samples.
- Interpolate position and facing.
- Snap on teleport/swap/revival when interpolation would misrepresent state.
- Remove player when occupancy/run sequence proves departure or death.

### 12.3 Sequence gaps

Every world/run/sector update carries sequence. On gap:

- Pause optimistic progression for affected object.
- Refetch canonical accounts.
- Rebuild local occupancy.
- Resume after consistency check.

## 13. Hazard rendering

- Worker receives ChunkDefinition, temporary effects, and synchronized ER time model.
- Worker computes render transforms and discrete warning states.
- Main thread applies transforms via instanced meshes.
- Contract and renderer share versioned deterministic formulas through generated/common pure logic where feasible.
- Rendering may interpolate continuously; collision indicators use canonical windows.

Train warnings, sinking platforms, and chunk barriers must be visibly legible before lethal transitions according to the configured minimum windows.

## 14. Three.js scene

### 14.1 Camera

- Isometric/three-quarter perspective matching voxel art.
- Camera follows local player with damped motion.
- Forward look-ahead gives hazard visibility.
- Zoom bounded for fair visibility; no unrestricted far-future scouting.

### 14.2 World streaming

- Keep a bounded row window behind/ahead of player.
- Load revealed chunks only.
- Closed frontier renders as a clear safe barrier with generation status.
- Dispose geometry, materials, and subscriptions when rows leave window.

### 14.3 Player rendering

- Agent class and cosmetic choose model/material/effects.
- Repeated meshes use instancing when animation requirements permit.
- Legendary trails and particles are distance/quality bounded.
- Team/party markers are future scope; V1 shows wallet-short-name and status optionally.

### 14.4 Effects

- Kick telegraph and displacement.
- Ability cast/area/expiry.
- Shield and Anchor status.
- Hazard death without gore.
- Gacha visuals are separate from authoritative randomness outcome.

## 15. Unity asset pipeline

### 15.1 Source custody

- Purchased Unity package remains in private asset storage, not public repository.
- License invoice and terms are retained by the team.
- Confirm commercial, derivative, promotional, and NFT-render usage.

### 15.2 Export

- Convert selected models to GLB/glTF.
- Normalize scale, origin, facing, and animation names.
- Merge materials where practical.
- Generate LODs or simplified distant representation.
- Compress geometry/textures after visual review.
- Produce rendered NFT images/animations without exposing source meshes where license forbids redistribution.

### 15.3 Manifest

Build a versioned asset manifest:

```text
variant_id -> model URL, material set, effects preset, preview media, checksum
class_id -> animation/action mapping
```

Manifest cannot change gameplay class mapping independently of program state. Client verifies expected version/hash from season/config.

## 16. Death and revival UX

Paid death overlay shows:

- Score retained.
- Exact next revive price.
- 60-second authoritative countdown.
- Selected agent remains locked.
- Continue button requiring wallet signature.
- End attempt button.
- Clear note that later revival prices double.

After payment, show payment confirmed and revival pending separately. If ER revival fails or expires, show refund path.

Casual death shows final score and immediate Start New Run. There is no revive button or implied continuation.

## 17. Gacha UX

### 17.1 Banner card

- 5/10/20 USDC exact price.
- Current effective Common/Rare/Epic/Legendary odds.
- Remaining supply by rarity/featured variant.
- Separate Epic and Legendary pity progress for this tier.
- Season end time.
- Legal/consumer disclosure link.

### 17.2 Pull flow

```text
Review -> Wallet payment -> VRF pending -> Assigned -> Reveal -> NFT claim -> Inventory
                              \-> Timeout -> Refund
```

The reveal animation starts only after Assigned and cannot influence result. Refresh/reconnect resumes the same pull. The UI never offers a reroll.

### 17.3 Sold out/pity

- Display recalculated effective odds.
- Disable banner when required pity tier inventory is unavailable.
- Explain why payment is unavailable.

## 18. Marketplace UX

- Browse filters: class, rarity, season, variant, price.
- Asset detail shows identical gameplay stats for same class.
- Listing review shows seller proceeds and 10% team royalty.
- Purchase review shows exact USDC and recipient split.
- Locked/listed assets display status and cannot enter conflicting flow.
- External royalty limitation is disclosed.

## 19. Leaderboards

### 19.1 Daily

- Paid and casual tabs are visually distinct.
- Paid record holder is highlighted from WorldHeader.
- Rows show wallet, score, class/agent, achieved time, and active/ended state where indexed.
- Equal display scores may sort by reached time, but UI clearly indicates only strict record replacement determines prize winner.

### 19.2 Season

- Rank primarily by daily wins.
- Secondary: highest winning score.
- Additional indexed display metrics may not be represented as payout authority.

### 19.3 All-time/profile

- Program-derived records and wins.
- Indexed history with explorer links.
- Owned agents through DAS/indexer.

## 20. Admin UI

Admin route is hidden for ordinary wallets but security does not depend on hiding.

Functions:

- Prepare tomorrow’s rooms.
- Verify base/router/ER readiness.
- Inspect initial chunk and crank status.
- Pause scopes.
- Void unsettled day with irreversible confirmation.
- Finalize daily payout.
- Retry incomplete payout leg.
- Create next season/banner/variant/class versions before activation.
- Monitor VRF, commits, liabilities, locks, and service health.
- Rotate admin.

Every admin transaction displays cluster, accounts, consequence, and simulation result before signature.

## 21. Transaction UX standard

For each wallet transaction:

- Display action name.
- Cluster.
- Fee payer.
- USDC amount and recipients.
- NFT affected.
- Irreversible consequences.
- Simulate base transactions when supported.
- Ask explicit confirmation.
- Show submitted and confirmed signatures.
- Expose retry when operation is idempotent.

Session gameplay actions do not open wallet prompts but connection status and rejection feedback remain visible.

## 22. Error handling

Errors map to categories:

- User action: rejected signature, insufficient USDC, asset unavailable.
- Competition: closed, paused, full, revive expired.
- Gameplay: occupied tile, cooldown, invalid target, stunned.
- Async: delegation pending, VRF pending, commit pending.
- Service: wrong endpoint, websocket disconnected, ER/VRF degraded.
- Integrity: stale sequence, accounting mismatch, unsupported client version.

Integrity failures stop the affected financial flow and direct the user to support; they are not silently retried.

## 23. Accessibility and preferences

- Remappable keyboard controls.
- Colorblind-safe hazard warnings independent of color alone.
- Reduced motion disables camera shake, intense trails, and long gacha animation.
- Master/music/effects volume and mute.
- Text scaling and high-contrast HUD.
- Cooldowns have numeric/text representation, not only radial color.
- Mobile touch targets meet minimum size.

## 24. Performance budgets

Initial budgets, refined through profiling:

- First route shell loads without full game assets.
- Game assets stream after mode/agent selection.
- Main-thread render work targets under 12ms on supported desktop baseline.
- Network/account decode work runs outside hot render path.
- Visible high-detail remote agents capped by radius/quality.
- Particle systems use pooled objects and hard counts.
- No React state update per frame.
- Three.js resources have explicit disposal ownership.

## 25. Frontend security

- Treat metadata, wallet names, logs, and indexer data as untrusted.
- Escape all rendered strings.
- Validate asset manifests and expected checksums/version.
- Never store wallet secret material.
- Session secret stays local and scoped; provide revoke/rotate control.
- Verify program IDs, collection, mint, cluster, and transaction summary before signature.
- Do not trust URL room/region parameters over on-chain/router state.

## 26. Frontend acceptance criteria

- Paid and casual flows cannot be confused.
- Every money/NFT transaction has explicit reviewed consequences.
- Entry/revival/gacha show cross-plane pending states accurately.
- Prediction correction never changes authoritative score locally.
- Reconnect rebuilds world from sequence-checked state.
- Nearby subscriptions and Three.js resources are released on route/wallet change.
- Gacha reveal cannot precede result assignment or trigger a reroll.
- Admin cannot submit arbitrary payout parameters through UI.
- 500-player representative scene meets measured performance using interest management.
- Keyboard, touch, reduced-motion, and color-independent warnings are tested.
