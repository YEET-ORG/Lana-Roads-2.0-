# Lana Roads 2.0: Visual UI and Motion Design

**Status:** Approved direction, written specification pending user review

**Master frontend:** [Lana Roads master frontend specification](../../FRONTEND.md)

**Parent:** [Crossy World product and protocol design](./2026-08-13-crossy-world-design.md)

**Frontend architecture:** [Frontend and Three.js specification](./2026-08-13-crossy-world-frontend-threejs-spec.md)

**Asset source:** `VoxelAnimals/` private purchased source pack

**Date:** 2026-08-13

## 1. Purpose

This document defines the complete visual language, responsive screen system, touch interaction model, motion grammar, component states, original iconography, game HUD, wallet/economy presentation, performance budgets, accessibility rules, and visual acceptance criteria for Lana Roads 2.0.

The approved direction is **Voxel Arcade**: a vibrant, tactile, mobile-first game interface inspired by the clarity and energy of Crossy Road. Lana Roads may follow the reference game's broad interaction grammar closely—full-screen voxel world, chunky type, large physical buttons, character carousel, compact HUD, bottom navigation, celebratory reward cards, and fast camera-led transitions—but it must use original branding, icons, layouts, component artwork, written copy, effects, and VoxelAnimals-derived agent imagery.

The interface must feel like a game from the first frame. It must never look like a generic dashboard, casino website, crypto trading product, glassmorphism template, or ordinary React application placed over a game canvas.

## 2. Experience principles

### 2.1 World first

The Three.js world remains the dominant full-screen background through home, agent selection, room selection, gameplay, death, and results. Navigation changes camera framing, depth of field, lighting emphasis, and overlays rather than replacing the game with flat pages.

Heavy informational surfaces such as marketplace inventory, gacha details, leaderboards, settings, and transaction history may use full-height sheets, but the world remains faintly visible or represented by a rendered environmental backdrop.

### 2.2 One-thumb immediacy

Primary mobile actions sit within comfortable thumb reach. A player can select a room, choose an agent, enter casual play, move, Kick, use an ability, revive, and begin another run without precision tapping or two-handed operation.

### 2.3 Tactile, not ornamental

Controls communicate weight through short travel, crisp scale, color change, shadow compression, sound, and optional haptics. Motion explains state changes. It does not delay control or decorate every element continuously.

### 2.4 Money is explicit

Paid entry, revival, gacha, listing, buying, refunds, and claims retain the playful visual language but never hide their consequences. Every financial action displays exact USDC value, asset consequence, wallet approval state, and terminal outcome in readable text.

### 2.5 Familiar grammar, original identity

The product may be immediately legible to a Crossy Road player, but no proprietary Crossy Road logo, character, icon, sound, texture, screenshot, UI image, exact card design, or branded type treatment is shipped. The reference is a benchmark, not a source-asset library.

## 3. Art direction: Voxel Arcade

### 3.1 Character

The visual character is:

- joyful and arcade-like;
- saturated without becoming fluorescent everywhere;
- blocky, crisp, and spatial;
- slightly mischievous rather than childish;
- friendly at first glance while supporting serious competition;
- physical, with layered panels and short hard shadows;
- readable over a visually busy shared world.

### 3.2 Shape language

- Most controls use 12–20 px radii, never fully pill-shaped unless representing a compact status.
- Panels use broad rectangles with clipped, stepped, or slightly uneven voxel corners where practical.
- Primary buttons have a visible 5–8 px lower edge that compresses during press.
- Strokes are 2–4 CSS px at mobile reference width.
- Decorative shapes use squares, diamonds, stair steps, chevrons, lane markings, and voxel confetti.
- Components may tilt by at most 1–2 degrees for playful emphasis; body text and financial values remain level.
- Thin hairlines and large translucent glass panes are not part of the core direction.

### 3.3 Depth language

Depth comes from:

1. hard colored lower-edge shadows;
2. one soft environmental shadow for floating cards;
3. contrasting borders;
4. world-camera parallax;
5. scale and overlap.

Avoid stacking multiple blurred shadows. Blur is expensive and visually inconsistent with voxel geometry.

## 4. Color system

### 4.1 Core palette

| Token        | Value     | Use                                                       |
| ------------ | --------- | --------------------------------------------------------- |
| `sky-400`    | `#57CFF2` | Agent selection, informational headers, clear-sky accents |
| `aqua-500`   | `#22B9E6` | Active navigation, links, neutral progress                |
| `grass-400`  | `#4BE08F` | Casual mode, success, safe zones                          |
| `grass-600`  | `#169B60` | Green lower edges, success contrast                       |
| `sun-400`    | `#FFD23F` | Primary play CTA, rewards, attention                      |
| `sun-700`    | `#C96F14` | Yellow button lower edge                                  |
| `coral-500`  | `#F45169` | Paid/revive urgency, dangerous action                     |
| `coral-700`  | `#A82443` | Coral button lower edge                                   |
| `violet-500` | `#8E63EA` | Epic rarity and special effects                           |
| `navy-950`   | `#08111F` | Deep shadow, modal scrim                                  |
| `navy-900`   | `#101827` | Navigation and base panels                                |
| `navy-800`   | `#18243A` | Cards and HUD controls                                    |
| `slate-300`  | `#B8C5D9` | Secondary text on dark surfaces                           |
| `paper`      | `#FFFDF5` | Light cards, inventory and result surfaces                |

Final tokens must be tested in the rendered environment and may receive small calibration changes. Their semantic relationships are fixed.

### 4.2 Mode colors

- Paid competition: sun yellow CTA with coral price/urgency accents.
- Casual: grass green CTA with sky accents.
- Gacha: banner-specific accent, but financial confirmation returns to standard money colors.
- Marketplace: sky/aqua for browse, sun for buy, coral for delist/destructive actions.
- Admin: neutral navy/slate, avoiding visual similarity to player Play actions.

Mode color never replaces a textual label. `PAID · 1 USDC` and `CASUAL · FREE` are always written.

### 4.3 Rarity colors

| Rarity    | Primary   | Secondary treatment                        |
| --------- | --------- | ------------------------------------------ |
| Common    | `#A7B2C4` | Matte silver/stone                         |
| Rare      | `#32A9F4` | Blue edge and small square sparkle         |
| Epic      | `#9765ED` | Violet edge, diamond motif                 |
| Legendary | `#FFC83D` | Gold edge, restrained animated glint/trail |

Rarity is always accompanied by text or an icon shape. Color alone is insufficient. Rarity visuals never imply different mechanics for two variants in the same class.

### 4.4 Contrast

- Small text targets WCAG AA contrast.
- Display text over the world receives a dark hard shadow or solid backing plate.
- World saturation/brightness is locally reduced behind dense overlays with a noninteractive scrim.
- Danger and success are differentiated by icon, wording, shape, and motion in addition to color.

## 5. Typography

### 5.1 Roles

Use an original or appropriately licensed block/pixel display face with strong numerals for:

- logo and wordmark;
- room names;
- score and record;
- CTA labels;
- agent names;
- result headlines;
- short numeric counters.

Use a compact, highly readable rounded grotesk for:

- descriptions;
- wallet addresses;
- transaction states;
- odds and disclosures;
- settings;
- tables and history.

The production choice must support required languages and tabular numerals. `Inter`, `Roboto`, `Arial`, and the exact Crossy Road proprietary typography are not accepted as the visual identity.

### 5.2 Type scale

At the 390 px mobile reference width:

| Role                |     Size | Weight/behavior                     |
| ------------------- | -------: | ----------------------------------- |
| Hero/result display | 36–48 px | Block face, tight line height       |
| Gameplay score      | 32–40 px | Tabular/block numerals              |
| Screen title        | 24–30 px | Block face                          |
| CTA                 | 18–22 px | Block face, short uppercase label   |
| Card title          | 16–20 px | Block or bold body face             |
| Body                | 14–16 px | Readable face, 1.4–1.55 line height |
| Metadata            | 12–13 px | Bold body face                      |
| Minimum label       |    11 px | Only short secondary labels         |

Financial values never use the minimum size.

### 5.3 Copy style

- Short, energetic, concrete phrases: `JOIN DAILY POT`, `SWIPE TO HOP`, `KICK READY`, `RECONNECTING`.
- Avoid crypto jargon in primary flows. Say `Wallet approval`, not `invoke transaction`.
- Pair playful death/result headlines with exact factual subtext.
- Never use countdown pressure copy that obscures revival price or encourages accidental spending.
- Use `USDC`, never a bare dollar sign, in signature and confirmation surfaces.

## 6. Original icon and image system

### 6.1 No production emoji

Emoji are forbidden in production UI, public marketing captures, tests representing final visuals, and shipped icon fallbacks. They were used only in early wireframes.

Every icon must be one of:

- original SVG built on a pixel/voxel-aligned grid;
- rendered VoxelAnimals portrait or silhouette;
- original Three.js render;
- licensed and documented audio/visual asset appropriate for redistribution.

Missing production icons fail CI/asset-manifest validation and show a neutral development placeholder only in nonproduction builds.

### 6.2 Icon grammar

- Design on a 24 x 24 or 32 x 32 square grid.
- Use blocky stepped contours and square terminals.
- Use white or paper foreground on a mode-colored tile for primary navigation.
- Use two tones plus outline at most for small icons.
- Maintain separate silhouettes for wallet, leaderboard, agent, gacha ticket, marketplace bag, settings, Kick, class ability, revive, timer, lock, USDC, warning, success, and reconnect.
- Icons include accessible labels; unfamiliar economy icons retain adjacent text.

### 6.3 Agent presentation

Every VoxelAnimals variant generates:

- transparent square portrait;
- three-quarter full-body card render;
- neutral carousel scene model;
- small leaderboard bust/silhouette;
- marketplace thumbnail;
- optional Legendary animated preview.

Camera, scale, ground contact, key light, shadow softness, and background framing are normalized across variants. Rarity effects are separate overlays so source renders remain reusable.

## 7. Spatial and responsive system

### 7.1 Reference viewports

Design and test at minimum:

- 360 x 640 small Android portrait;
- 390 x 844 modern phone portrait;
- 430 x 932 large phone portrait;
- 844 x 390 phone landscape;
- 768 x 1024 tablet portrait;
- 1024 x 768 tablet landscape;
- 1366 x 768 laptop;
- 1920 x 1080 desktop.

Portrait mobile is the primary product experience. Desktop and landscape are first-class adaptations, not stretched portrait layouts.

### 7.2 Safe areas

- Respect `env(safe-area-inset-*)` around every interactive edge.
- Add at least 12 px visual padding beyond safe areas.
- The browser address bar changing height must not jump gameplay controls.
- Use dynamic viewport units with a tested fallback.
- Prevent browser pull-to-refresh, text selection, image drag, double-tap zoom, and overscroll only inside the active game surface; informational sheets retain normal accessible scrolling.

### 7.3 Layout scales

- Base spacing unit: 4 px.
- Common gaps: 8, 12, 16, 24, 32 px.
- Phone horizontal margin: 14–18 px.
- Minimum interactive target: 48 x 48 CSS px.
- Gameplay Kick/ability targets: at least 64 x 64; preferred 72–80 x 72–80.
- Primary mobile CTA: 54–64 px high.
- Main sheet width on desktop: 420–560 px for focused flows, up to 1120 px for inventory/market grids.

### 7.4 Desktop adaptation

- Center the isometric world; preserve game camera scale rather than showing an excessive map area.
- Place focused panels left or right of the agent, not across the complete screen.
- Bottom navigation becomes a compact left rail or centered bottom dock depending on aspect ratio.
- Keyboard legends appear only when keyboard input is detected.
- Mouse movement is click/tap-to-cardinal only if later approved; launch movement remains keyboard/swipe, avoiding accidental world clicks.

## 8. Persistent application shell

### 8.1 Living backdrop

The shell owns:

- one persistent Three.js canvas;
- route-specific camera targets;
- environmental lighting/theme;
- foreground UI overlay root;
- global toast/transaction queue;
- wallet and network status;
- audio/haptic state;
- responsive safe-area metrics.

The canvas is not destroyed between ordinary routes. Heavy world resources are reused while overlay components mount/unmount cleanly.

### 8.2 Bottom dock

Primary destinations:

1. Leaderboards
2. Play/Home
3. Agents
4. Gacha
5. Marketplace

Settings, wallet, help, and transaction history live in a top utility menu or profile sheet rather than expanding the dock.

Rules:

- Active item lifts 8–14 px, gains a colored tile, and compresses on press.
- Inactive items remain readable but subordinate.
- Badges indicate actionable items, not general marketing.
- Dock hides during active gameplay and financial signing.
- Navigation retains screen reader labels and visible keyboard focus.

### 8.3 Top utility area

Home screens show:

- Lana Roads original wordmark;
- wallet connect or shortened address;
- available USDC when permission/data is available;
- network/connection status when unhealthy;
- settings/profile entry.

The utility area must not resemble an exchange header. Wallet address and balance are compact status, not the hero content.

## 9. Screen inventory and behavior

### 9.1 Boot and loading

Sequence:

1. solid brand color immediately;
2. original wordmark blocks assemble in 180–260 ms;
3. asset/connection progress shown through a hopping lane marker;
4. world appears from low-detail to final detail;
5. home controls enter only after minimum interaction assets are ready.

Do not use an indefinite spinner. Show named phases when loading exceeds two seconds: `Loading world`, `Checking wallet`, `Syncing daily room`.

### 9.2 First visit and wallet connect

- Let users see the living home world before connecting.
- Casual preview, agent catalog, odds, marketplace browse, and leaderboards may be read-only without a wallet where technically possible.
- Paid Play prompts wallet connection only at the point it is needed.
- Explain that the gameplay session key cannot spend USDC or transfer NFTs.
- Unsupported network displays a single clear switch-network action.

### 9.3 Home and room selection

The home hero is a camera-framed safe-zone scene with nearby players and the selected agent idling in the foreground.

Room selection uses two snap cards:

- `DAILY POT · PAID` with exact `1 USDC`, current pool, player count, leading score, and UTC time remaining;
- `CASUAL WORLD · FREE` with player count and no-prize label.

Horizontal card swipe or clear tabs switch modes. The primary CTA changes label and color. The user never enters paid mode from a button labeled only `PLAY`.

### 9.4 Agent carousel

The carousel is inspired by an arcade character selector:

- selected 3D agent is centered and largest;
- neighboring agents are partially visible as silhouettes/renders;
- horizontal swipe advances one variant with snap and short camera orbit;
- tap/swipe does not spin indefinitely or use slot-machine behavior;
- name, rarity, ownership, class, ability, exact cooldown, and active lock/listing state are visible;
- variants sharing a class display identical mechanic text;
- filters open in a bottom sheet: owned, class, rarity, season, available, listed;
- Casual can preview/use every class while clearly labeling unowned paid variants.

Entry confirmation is a separate deliberate action. Paid confirmation states the asset will be locked for the complete attempt including revivals.

### 9.5 Paid entry transaction

Stages are visually distinct:

1. Review: `1 USDC`, selected agent, lock consequence, room end time.
2. Wallet approval: UI frozen from game gestures; wallet interaction instructions.
3. Base confirmation: signature and progress lane.
4. Preparing realtime run: delegation/spawn progress.
5. Spawn confirmed: camera dives into player and HUD appears.
6. Failed/refundable: exact reason, refund CTA, agent unlock status.

Never show a player as active after payment but before confirmed spawn.

### 9.6 Active gameplay HUD

The world receives at least 80% of visual attention.

Persistent HUD:

- top-left current score;
- top-right incumbent record and compact prize-pool value in paid mode;
- right edge Kick and class ability buttons;
- connection degradation indicator only when needed;
- optional local-player marker when crowding makes identity unclear.

Temporary HUD:

- record-beaten banner;
- blocked movement tick;
- cooldown-ready pulse;
- chunk frontier/wait warning;
- reconnect state;
- authoritative correction signal;
- Kick/ability target feedback;
- train or high-risk hazard warning where gameplay rules permit.

Do not show wallet balance, dock navigation, quests, marketplace promotions, or gacha during an active run.

### 9.7 Pause and interruption

Multiplayer world simulation does not pause. The pause sheet says `WORLD STILL LIVE` and provides:

- resume;
- controls;
- audio/haptics;
- graphics quality;
- left-handed controls;
- leave/end attempt consequences.

Opening wallet/system dialogs does not grant hazard protection. This is disclosed before paid play and in the pause sheet.

### 9.8 Death and paid revival

Death uses a humorous, hazard-specific headline and a short camera reaction, then darkens the live world beneath a high-contrast revival card.

Card contents:

- exact cause;
- run score and incumbent record;
- exact next revival price in USDC;
- large numeric seconds remaining plus linear progress;
- statement that score/attempt/agent/cooldowns are preserved;
- `REVIVE · 10 USDC` or current doubled amount;
- `END ATTEMPT` secondary action;
- agent unlock/finalization explanation.

Countdown derives from authoritative deadline and resynchronizes after backgrounding. Color and motion intensify only in the final ten seconds. No false urgency or hidden doubling.

### 9.9 Casual death

Casual death has no revival purchase. It shows:

- score and personal/casual daily best;
- `RUN AGAIN · FREE`;
- `CHANGE AGENT`;
- leaderboard position where available.

It must not visually imply a missing or disabled paid revival.

### 9.10 Results and record celebration

- New personal best: compact ribbon and score count-up.
- New room record: larger world-visible beam/banner, camera beat, original fanfare, and record holder card.
- Equal score: `MATCHED RECORD — BEAT 391 TO TAKE LEAD`; never present as a tie win.
- Daily winner after finalized settlement: 90% prize value, winning agent, score, date, and claim/paid status.
- Zero-score day: rollover explanation rather than winner celebration.

Celebrations never preempt authoritative confirmation.

### 9.11 Leaderboards

Primary tabs:

- Paid Today
- Casual Today
- Season Wins
- All Time

Top three receive spatial podium cards with agent renders. Remaining rows are compact and virtualized. Each row includes rank, shortened wallet/display name, agent portrait, class, score/wins, and active/final status. The player's row sticks near the viewport edge when outside the visible range.

Provisional data is labeled. Equal score ordering reflects authoritative incumbent behavior rather than pretending normal tie sorting determines the winner.

### 9.12 Agent collection and detail

Collection uses a responsive grid of original character cards. Detail includes:

- large Three.js turntable;
- name, animal, variant, season, rarity, asset address;
- class and ability with exact mechanics/cooldown;
- owned/listed/locked state;
- runs and top score if indexed;
- trade/list action;
- clear statement that same-class variants share mechanics.

Raw `VoxelAnimals/` filenames and Unity metadata are never shown to users.

### 9.13 Gacha lobby and pull

The gacha may be exciting but not deceptive.

Lobby shows all three tiers with:

- 5/10/20 USDC prices;
- effective current rarity probabilities;
- inventory revision/availability;
- Epic and Legendary pity progress for that tier;
- remaining featured supply;
- explicit no-general-guarantee statement.

Pull flow:

1. review exact payment and odds;
2. wallet approval;
3. VRF request waiting state with request identity;
4. deterministic reveal animation after assignment only;
5. agent card and duplicate disclosure;
6. NFT claim/received state;
7. timeout/refund path after the specified five-minute rule.

The reveal animation never determines rarity and cannot provide reroll interaction. Legendary reveals may use a 600–900 ms staged build but include a skip-after-assignment control.

### 9.14 Marketplace

Browse supports filters, sorting, search, and virtualized cards. Buy confirmation includes exact listing price, requested 10% creator royalty in the in-game path, seller, asset, class, and wallet impact. Locked/listed/sold/stale states are obvious and recover gracefully after signature or indexer delays.

### 9.15 Wallet/profile and history

Profile includes:

- wallet and network;
- USDC balance;
- owned agent count;
- paid/casual/season statistics;
- pity status per banner;
- active receipts, refunds, gacha requests, and listings;
- transaction history links;
- session management/revoke;
- accessibility and control settings.

### 9.16 Admin UI

Admin remains visually distinct and functional rather than arcade-promotional. Settlement preview reads immutable program-derived winner, destinations, and values. High-risk actions use typed review, wallet signature, and post-action verification. No UI field allows arbitrary winner or payout substitution.

## 10. Gesture-first movement

### 10.1 Touch contract

- Swipe up/down/left/right in the unobstructed gameplay surface to submit one cardinal grid-step intent.
- No permanent virtual joystick.
- Diagonal gestures axis-lock to the dominant axis only when dominance exceeds the configured ratio; ambiguous diagonals fail with no action.
- One pointer gesture submits at most one movement intent.
- Movement does not repeat merely because the finger remains down.
- A small bounded input queue may retain at most one next direction while an accepted hop is resolving; the queue cannot bypass authoritative action sequencing.

Initial tuning values for device testing:

- minimum travel: 24 CSS px;
- minimum axis dominance: 1.35:1;
- maximum tap-to-swipe recognition window: 420 ms;
- velocity may lower travel threshold to no less than 16 CSS px;
- gestures beginning outside the gameplay surface are ignored.

These are client-recognition values, not game-authority rules, and may be calibrated through usability tests without changing on-chain movement.

### 10.2 Pointer ownership

On pointer-down, the frontend assigns the pointer to exactly one owner:

- movement surface;
- Kick button;
- ability button;
- pause/HUD action;
- modal/sheet;
- browser/system-safe region.

Ownership never changes mid-gesture. A touch beginning on a control cannot become movement after sliding away. Multi-touch does not submit multiple gameplay actions; the earliest valid owned pointer wins until release.

### 10.3 Side buttons

- Kick and class ability occupy the lower right reachable arc by default.
- Left-handed mode mirrors both controls and reserves the opposite side for swipes.
- Kick is visually stable across agents.
- Ability uses class-specific original icon and color accent.
- Ready, pressed, submitting, accepted, cooldown, rejected, disabled, dead, and reconnecting states are distinct.
- Cooldown shows a radial/vertical mask plus numeric value below ten seconds.
- Pressing a blocked/invalid target gives a short reason without consuming visual readiness unless authoritative state reports cooldown consumed.

### 10.4 Desktop controls

- Arrow keys and WASD: cardinal movement.
- Space: Kick.
- E or Q: class ability, configurable.
- Escape: interruption sheet.
- Prevent key repeat from issuing uncontrolled actions; use the same bounded queue and action nonce path as touch.
- Visible keyboard focus never disappears on menus or sheets.

## 11. Gameplay feedback

### 11.1 Accepted movement

- character squash anticipation: 35–55 ms;
- hop translation: 90–140 ms visual duration;
- small landing squash: 45–70 ms;
- camera follows with critically damped motion;
- optional soft haptic on acceptance/landing;
- authoritative tile state remains discrete even while visuals interpolate.

### 11.2 Rejected movement

- 70–100 ms bump in requested direction;
- low-volume blocked tick;
- optional small edge spark at blocker;
- no camera progression or score anticipation;
- brief textual reason only when rejection is not visually obvious.

### 11.3 Prediction correction

Small correction: finish or reverse within 100–140 ms. Large/sequence-gap correction: ground snap with a visible network pulse and rebuilt authoritative state. Never drag an avatar slowly through occupied or hazardous tiles to hide desynchronization.

### 11.4 Kick and ability

- Button compresses immediately on owned pointer-down.
- Cast telegraph may begin visually, but irreversible effect waits for authoritative acceptance.
- Accepted displacement uses strong directional stretch, dust blocks, camera impulse, and medium haptic.
- Rejection resets quickly and exposes reason.
- Cooldown ring starts from authoritative ready timestamp.

## 12. Motion language

### 12.1 Motion families

| Family        | Character                                  | Uses                                  |
| ------------- | ------------------------------------------ | ------------------------------------- |
| Hop           | Fast anticipation, short arc, firm landing | Movement, navigation active tile      |
| Press         | Downward compression and shadow collapse   | Buttons, tabs, cards                  |
| Slide         | Axis-aligned with slight overshoot         | Sheets, carousel, room cards          |
| Pop           | Scale from 0.82–0.94 with overshoot        | Badges, new record, reward card       |
| Stamp         | Fast scale/rotation impact                 | Death headline, error, sold-out       |
| Build         | Voxel pieces assemble                      | Boot logo, assigned gacha reveal      |
| Camera travel | Smooth damped target/orbit                 | Route transitions, agent focus, spawn |

### 12.2 Duration tokens

| Token       |   Duration | Typical use                         |
| ----------- | ---------: | ----------------------------------- |
| `instant`   |  70–100 ms | Press/reject feedback               |
| `quick`     | 140–190 ms | Popover, tab, small card            |
| `screen`    | 220–300 ms | Route overlay/camera transition     |
| `celebrate` | 360–520 ms | Result/card/confetti entrance       |
| `spectacle` | 600–900 ms | Assigned Epic/Legendary reveal only |

Normal navigation should be interactable again within 300 ms. Spectacle never blocks a financial/refund action and is skippable after authoritative assignment.

### 12.3 Easing

- Entrances: expressive back/overshoot capped to avoid rubbery UI.
- Exits: fast cubic acceleration.
- Camera: critically damped spring or smooth exponential response, no visible bouncing.
- Gameplay hop: authored curve synchronized with grid-step feedback.
- Countdown/progress: linear time representation.

### 12.4 Screen transitions

Transitions coordinate UI and world:

- Home -> Agent: room panel drops, camera orbits/zooms to selected animal, carousel labels pop in.
- Agent -> Payment review: world dims 20–35%, review card rises from bottom.
- Spawn: card stamps closed, camera dives to safe-zone player, HUD fades in during final 120 ms.
- Gameplay -> Death: hazard reaction, 80–140 ms impact beat, world desaturates/dims, revival card stamps in.
- Home -> Leaderboard/Market/Gacha: camera pans to a themed world landmark while sheet slides from the associated dock direction.
- Back: reverse spatial relationship when safe, not a generic fade.

No full white flashes. Avoid long crossfades that blur voxel geometry.

### 12.5 Confetti and particles

- Voxel squares/diamonds only, using palette colors.
- Pool objects; no per-frame DOM creation.
- Respect reduced motion and device quality.
- Celebration particles never obscure exact reward value or CTA.
- Confetti is reserved for assigned collectible, personal best, room record, daily win, successful claim, and season milestone.

## 13. 60 FPS performance contract

### 13.1 Frame budget

At 60 Hz, combined client work targets 16.67 ms:

- Three.js render/update: <= 10 ms typical;
- UI style/layout/paint: <= 3 ms typical during gameplay;
- input/network/reconciliation: <= 2 ms typical;
- safety margin: >= 1.5 ms.

At the supported low/mobile baseline, 30 FPS is the minimum fallback only after quality adaptation. UI input handling should remain responsive even when 3D render rate is reduced.

### 13.2 Rules

- Animate transforms and opacity by default.
- Do not animate layout-affecting width/height/top/left in gameplay.
- Avoid large live backdrop filters, filter blur, and multi-layer box shadows.
- Use CSS containment and separate overlay layers.
- Keep frame-level game state outside React render cycles.
- Pool particles, floating labels, world markers, and agent effects.
- Use texture atlases/instancing/LOD for repeated icons and world elements where appropriate.
- Pause nonessential menu animation while hidden/backgrounded.
- Respect device pixel-ratio caps and dynamic quality tiers.
- Preload only the selected/neighbor agents, core HUD icons, and current environment; stream the catalog progressively.

### 13.3 Motion quality tiers

- High: complete particles, agent trails, soft environmental shadows.
- Balanced: reduced particles/trails, standard transitions.
- Performance: no blur, minimal shadows, limited particles, simplified carousel previews.
- Reduced motion: no camera sweeps/overshoot/confetti; use short fades and direct state changes.

Gameplay timing and authority never change with visual quality.

## 14. Audio and haptics

### 14.1 Audio grammar

Use original/licensed sounds:

- dry block click for navigation;
- bright two-tone play confirmation;
- soft hop/land variation;
- blocked wooden tick;
- heavier Kick thump;
- class-specific ability cue;
- distinct road, river, and train danger cues;
- short record fanfare;
- rarity reveal layers;
- low nonalarm transaction pending loop;
- clear success/failure resolution.

No Crossy Road audio may be sampled or reproduced.

### 14.2 Haptics

- Light: navigation press, accepted hop.
- Medium: Kick/ability acceptance, card snap.
- Heavy: death impact, Legendary reveal, room record.
- Warning pattern: final revival seconds and connection loss, used sparingly.

Haptics are optional, user-controlled, and unavailable-platform safe.

## 15. Component specifications

### 15.1 Arcade button

Required variants:

- primary sun;
- casual green;
- danger/revive coral;
- neutral navy;
- paper secondary;
- icon square;
- compact HUD.

Required states:

- idle;
- hover where applicable;
- focused;
- pressed;
- loading/submitting;
- success;
- disabled with explanation;
- destructive confirmation.

Press moves the face downward and collapses lower-edge depth. Disabled controls do not retain a bright pressed affordance.

### 15.2 Sheet/card

- Header, body, disclosure, and action regions remain structurally consistent.
- Mobile sheets enter from bottom and may become full-height.
- Desktop focused sheets enter from side or center near the world subject.
- Financial sheets cannot be dismissed by an accidental movement swipe while signing/submitting.
- Scroll affordance and close/back remain visible.

### 15.3 Status pill

Status pills are compact and reserved for `LIVE`, `PAID`, `FREE`, `LOCKED`, `LISTED`, `PENDING`, `FINAL`, `REFUNDABLE`, connection, and network. They include icon/shape and text.

### 15.4 Toast/event banner

- Gameplay banners appear below top HUD, never over movement/ability zones.
- Transaction toasts stack outside active controls and persist until meaningful next state.
- Error messages include recovery action where available.
- Do not use ephemeral toasts for payment failures or refundable states; those require durable cards/history.

### 15.5 Numeric display

- Use tabular numerals.
- Abbreviate only supplementary pool/player values; transaction values remain exact.
- Count-up animations never change or delay authoritative final value accessibility.
- UTC countdown includes explicit `UTC` in detailed views.

## 16. Network, transaction, and error states

### 16.1 Connection

- Healthy connection is visually quiet.
- Degraded: small amber pulse and `SYNCING`.
- Disconnected: persistent `RECONNECTING — WORLD STILL LIVE` banner.
- Restored: brief green confirmation, authoritative state rebuild, then removal.
- Wrong network: blocking sheet outside active gameplay; active gameplay session behavior follows safe recovery rules.

### 16.2 Transaction state machine

Every financial flow maps technical stages into stable UI states:

```text
Review
  -> Awaiting wallet
  -> Submitted to base
  -> Confirmed / preparing dependent state
  -> Complete
  -> or Failed / Retryable / Refundable
```

Closing/reopening the application restores the state from authoritative accounts/indexer rather than losing the transaction behind a completed animation.

### 16.3 Errors

Error families and treatments:

- Input/gameplay: small local feedback (`Tile occupied`).
- Connection/routing: persistent banner with reconnect state.
- Wallet rejection: return to review without implying payment.
- Financial failure: durable sheet/history entry with signature and retry/refund.
- Sold out/pity unavailable: gacha banner disabled with direct explanation.
- Unsupported version: update-required blocker before writes.
- Maintenance/pause: branded safe screen with allowed refunds/claims still available.

Use human language first, technical code/signature second in expandable details.

## 17. Accessibility

- All menus and financial flows work with keyboard and assistive technology.
- Canvas gameplay has a documented control description and status announcements that do not spam every remote movement.
- Focus is trapped in blocking dialogs and restored to the invoking control.
- Visible focus uses a high-contrast stepped outline.
- Text resizing to 200% remains usable on non-gameplay surfaces.
- Controls do not depend on hover.
- Reduced-motion mode replaces camera sweeps, confetti, overshoot, and continuous idle movement.
- Color-independent rarity/status indicators are mandatory.
- Captions/text equivalents cover important audio warnings.
- Haptic-only information is forbidden.
- Left-handed controls, sensitivity tuning, audio channels, haptics, and graphics quality are settings.
- Gesture alternatives on mobile may include an optional four-button accessibility pad, disabled by default; this does not change authoritative movement.

## 18. Asset pipeline and visual provenance

### 18.1 VoxelAnimals

All files under `VoxelAnimals/` are private licensed source material. The production pipeline:

1. inventories source files and hashes;
2. maps source models to stable variant IDs;
3. normalizes scale, axis, origin, and ground contact;
4. assigns reviewed materials;
5. exports optimized GLB;
6. applies mesh/texture compression where supported;
7. renders portrait, card, bust, and marketplace previews;
8. records output hashes and converter version;
9. validates class, rarity, season, and supply mapping;
10. prevents raw Unity/OBJ/VOX files from public build output.

### 18.2 UI assets

Maintain a manifest with:

- stable asset ID;
- semantic role;
- file/source path;
- SVG/viewbox or image dimensions;
- theme variants;
- content hash;
- license/provenance;
- fallback policy;
- preload group.

Production builds fail for missing core navigation/action assets or accidental emoji icon strings.

### 18.3 Reference separation

User-provided screenshots/video and official store references are research inputs only. Do not copy reference pixels into production files. Every shipped UI image must trace to Lana Roads source art, VoxelAnimals output, or a documented licensed dependency.

## 19. Implementation component boundaries

Recommended visual modules:

```text
apps/web/src/
  app-shell/          persistent canvas, routes, safe areas, global overlays
  design-system/      tokens, typography, icon, button, card, sheet, status
  motion/             durations, easing, route choreography, reduced motion
  input/              swipe recognizer, pointer ownership, keyboard mapping
  game-hud/           score, record, Kick, ability, network state
  rooms/              paid/casual cards and entry review
  agents/             carousel, collection, detail, lock state
  death/              paid revival and casual results
  leaderboard/        podium and virtualized rows
  gacha/              banner, odds, request, reveal, refund
  marketplace/        browse, listing, purchase flows
  wallet/             connect, transaction queue, history, session
  admin/              operational surfaces
  assets/             public manifest and generated loaders
```

No single `App.tsx`, HUD component, scene manager, or global animation timeline owns all behavior. Route choreography composes small reversible transitions.

## 20. Analytics and usability validation

Collect privacy-conscious aggregate metrics for:

- time from load to interactive home;
- room-card comprehension and paid/casual mis-entry cancellation;
- wallet connect/entry funnel stages;
- swipe recognition/rejection by direction and device class;
- accidental Kick/ability presses;
- left-handed mode usage;
- movement correction frequency;
- death-to-revive review and wallet-rejection rates;
- gacha odds-view and cancellation behavior;
- dropped frames by visual quality tier;
- reconnect and state-restoration success.

Analytics never replaces authoritative gameplay/economic events and avoids keystroke-level or sensitive wallet telemetry.

## 21. Visual testing

### 21.1 Screenshot coverage

Capture deterministic visual baselines for every reference viewport and state:

- boot/loading;
- disconnected wallet and wrong network;
- paid/casual home cards;
- agent carousel across all rarity treatments;
- entry review and every transaction state;
- gameplay HUD, cooldown, blocked move, reconnect;
- paid death at 60/10/0 seconds and each price length case;
- casual death;
- record/result/rollover;
- leaderboards and empty/loading/provisional states;
- gacha tiers, pity, sold out, assigned, refund;
- marketplace browse/detail/buy/list/stale;
- settings/accessibility/admin;
- reduced motion and high contrast.

### 21.2 Interaction tests

- Pointer ownership prevents button-origin movement.
- Swipe thresholds reject taps/ambiguous diagonals.
- One gesture emits at most one intent.
- Ability and Kick buttons remain reachable at all safe-area sizes.
- Left-handed mirror changes controls, not gameplay direction.
- Financial dialogs suspend gameplay input.
- Back/navigation cannot accidentally repeat payment.
- Restored transaction states match authoritative progress.
- Route resources/listeners are released.

### 21.3 Performance tests

- Profile transitions with representative world and nearby players, not an empty canvas.
- Measure p50/p95 frame time and input-to-visual feedback.
- Test thermal behavior over 20-minute mobile sessions.
- Verify no unbounded DOM nodes, particles, textures, event listeners, or animation handles.
- Test background/foreground and address-bar resize without layout jumps.

## 22. Legal and ethical presentation

- Do not use Crossy Road trademarks as product branding or imply affiliation with Hipster Whale.
- Preserve original Lana Roads wordmark, icons, UI art, sounds, layouts, and written copy.
- Paid competition, intentional pay-to-win classes, revival escalation, random paid gacha, current odds, pity, supply, and refund rules are disclosed before spending.
- Do not use misleading odds animation, fake scarcity timers, disguised prices, preselected purchases, confirm-shaming, or visually hidden cancellation.
- Age/access/geographic restrictions appear before unavailable financial actions, not after wallet approval.

## 23. Acceptance criteria

- The product reads as a vibrant voxel arcade game in the first frame.
- Direction A / Voxel Arcade is consistently applied across all player surfaces.
- The world remains the visual anchor through core navigation.
- Mobile movement uses four-direction swipes with no default virtual joystick.
- Kick and ability use large reachable side buttons with optional left-hand mirroring.
- Paid and casual rooms cannot be confused.
- Every financial action displays exact USDC and consequences before signature.
- Agent carousel uses real VoxelAnimals-derived renders/models, not emoji or reference-game assets.
- No production UI uses emoji as icons.
- Original icon and audio systems replace all wireframe/reference placeholders.
- Screen transitions coordinate overlays and camera, complete normal navigation within 300 ms, and remain interruptible.
- Representative gameplay and transitions meet measured frame budgets with adaptive quality.
- Reduced motion, keyboard, focus, touch, safe-area, contrast, and color-independent states pass testing.
- Reconnect, failure, refund, pending, sold-out, cutoff, and stale-data states receive complete designed treatment.
- Visual assets have provenance and raw purchased source files never enter public build output.
- The result is recognizably inspired by Crossy Road's interaction clarity without shipping copied branding or proprietary assets.
