# Lana Roads 2.0 â€” Source Asset Catalog and Runtime Policy

**Status:** Coding-agent source of truth for supplied art assets

**Repository asset roots:** `SourceAssets/` and `VoxelAnimals/`

**Last inventory:** 2026-08-13

## 1. Purpose

This document tells coding agents what source art exists, what it may be used for, which licensing evidence is present, and how selected sources become optimized Three.js runtime assets.

The source packs are stored in this private repository under `SourceAssets/`, except the original purchased Unity pack retained at `VoxelAnimals/` for compatibility. Binary model, texture, scene, and editor payloads use Git LFS. Presence in the repository does **not** by itself grant production approval or permission to redistribute these packs outside this private project.

Read this document before importing, converting, renaming, copying, committing, or shipping third-party art. Also read the [master frontend specification](./FRONTEND.md).

## 2. Non-negotiable rules

1. A source being downloadable, free, or present locally does not prove redistribution rights.
2. Preserve embedded license and readme files with each private source pack.
3. Do not commit a raw third-party pack unless repository policy and its license explicitly allow distribution.
4. Only optimized, reviewed runtime derivatives belong in the web app.
5. Exact Crossy Road characters, scenes, branding, icons, audio, textures, or proprietary compositions are reference-only and must not ship.
6. Gameplay authority never comes from mesh dimensions, animation, material, filename, or client randomness.
7. Canonical simulation data owns tile footprint, collision, timing, speed, direction, death, score, and occupancy.
8. Every shipped derivative needs a stable ID, source record, license status, output hash, and optimization report.
9. If license evidence is missing or ambiguous, mark the source `HOLD` and use an approved alternative.
10. Do not silently replace one source with another under the same runtime asset ID.

## 3. Status vocabulary

| Status             | Meaning                                                                                            |
| ------------------ | -------------------------------------------------------------------------------------------------- |
| `APPROVED-SOURCE`  | Commercial or permissive-use evidence is present; selected assets may enter conversion and review. |
| `CURATED`          | Convert only selected models, not the complete pack.                                               |
| `HOLD`             | Production use is blocked until license/provenance evidence is recorded.                           |
| `REFERENCE-ONLY`   | Private study only; do not copy, derive from, or ship.                                             |
| `REJECTED-RUNTIME` | Metadata, duplicate format, accessory, aggregate scene, or unsuitable standalone runtime asset.    |

`APPROVED-SOURCE` does not mean raw files should be committed. It means selected derivatives may proceed through art, legal, performance, and gameplay review.

## 4. Workspace overview

Paths below are repository-relative. `VoxelAnimals/` remains at the root; every other raw source pack is nested below `SourceAssets/`.

| Source folder                                      | Category            | Approximate contents                         | License evidence                                                                        | Status                       | Intended role                                      |
| -------------------------------------------------- | ------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------- | ---------------------------- | -------------------------------------------------- |
| `VoxelAnimals/`                                    | agents              | 40 OBJ animals plus Unity/MagicaVoxel source | user-confirmed purchased Unity Asset Store commercial rights; no license file in folder | `APPROVED-SOURCE`, `CURATED` | primary playable agents                            |
| `SourceAssets/Voxel_Animal_Asset_Pack/`            | agents and props    | 110 OBJ/MTL/PNG sets                         | none found                                                                              | `HOLD`                       | possible secondary agents, collectibles, and props |
| `SourceAssets/Low_Poly_Cars_DevilsWorkShop_V03/`   | vehicles            | 11 vehicle/accessory names in FBX, OBJ, DAE  | embedded commercial-use license                                                         | `APPROVED-SOURCE`, `CURATED` | initial traffic hazards                            |
| `SourceAssets/Free_Low_Poly_Vehicles_Rgsdev/`      | vehicles            | 22 FBX files                                 | embedded CC0 license                                                                    | `APPROVED-SOURCE`, `CURATED` | expanded traffic and service vehicles              |
| `SourceAssets/Free_Cars/`                          | vehicles            | 11 FBX vehicles and two atlas textures       | none found                                                                              | `HOLD`                       | candidate stylized traffic                         |
| `SourceAssets/SportsCar_Yellow/`                   | vehicle             | one 220-vertex car in several formats        | descriptive readme only                                                                 | `HOLD`                       | candidate rare sports-car variant                  |
| `SourceAssets/pack_cartoon_cars/`                  | vehicles            | combined FBX and Blender source              | none found                                                                              | `HOLD`                       | candidate vehicle source after separation          |
| `SourceAssets/KayKit_BlockBits_1.0_FREE/`          | terrain             | 40 designs in FBX, glTF, and OBJ             | embedded CC0 license                                                                    | `APPROVED-SOURCE`, `CURATED` | terrain prototypes and materials                   |
| `SourceAssets/KayKit_Forest_Nature_Pack_1.0_FREE/` | environment         | 105 designs in FBX, glTF, and OBJ            | embedded CC0 license                                                                    | `APPROVED-SOURCE`, `CURATED` | trees, rocks, bushes, and grass                    |
| `SourceAssets/chicken_-_crossy_road/`              | reference character | glTF scene and binary                        | embedded CC-BY-4.0 record                                                               | `REFERENCE-ONLY`             | scale/readability study only                       |
| `SourceAssets/crossy_road_3d_scene/`               | reference scene     | glTF scene and binary                        | embedded CC-BY-4.0 record                                                               | `REFERENCE-ONLY`             | composition/readability study only                 |

## 5. Detailed inventory

### 5.1 `VoxelAnimals/` â€” primary agents

- 40 OBJ models named `animal-0` through `animal-39`.
- Shared material/texture sources, Unity files, and a MagicaVoxel source.
- The user supplied this purchased Unity Asset Store pack and confirmed commercial rights.

Use this as the primary source for playable agent NFTs. Agents may share a mechanical class while using different models, colors, rarity presentation, portraits, trails, and effects. Every agent retains the same authoritative grid footprint, and rarity never changes same-class mechanics.

Before implementation:

- create a contact sheet mapping source numbers to recognizable animals;
- assign semantic IDs such as `agent.bear.01` independently of source numbering;
- normalize scale, pivot, forward axis, ground contact, shadow, and animation anchor;
- preserve proof of purchase privately outside the web bundle.

### 5.2 `SourceAssets/Voxel_Animal_Asset_Pack/` â€” secondary voxel source

Recognized animal candidates include axolotl, bear, bunny, cat, chicken, cow, crocodile, dog, elephant, fish, fox, frog, mole, monkey, mouse, panda, parrot, penguin, piglet, turtle, unicorn, and worm.

Recognized props include apple, bamboo, banana, candy, carrot, cheese, corn, honey, melon, boxes, grass, flowers, mushroom grass, trees, and a walk tile.

Technical notes:

- exports generally include OBJ, MTL, and PNG;
- ignore `__MACOSX`, `._*`, and `.DS_Store` metadata during conversion;
- a `scene.vox` source is present.

Status is `HOLD`: no license/readme was found. Do not commit or ship derivatives until the user supplies a store page, receipt, or license grant.

### 5.3 `SourceAssets/Low_Poly_Cars_DevilsWorkShop_V03/` â€” initial vehicles

Complete candidates:

- `Low_Poly_Vehicles_car01`, `car02`, and `car03`;
- `Low_Poly_Vehicles_carPolice`;
- `Low_Poly_Vehicles_pickupTruck01` and `pickupTruck02`;
- `Low_Poly_Vehicles_bus`.

`car_modeEngine`, `car_modLights`, `car_modPipes`, and `car_modSpoiler` are accessory-only sources. They are not complete hazards and must not be registered as vehicles.

The embedded license grants ongoing, non-exclusive worldwide commercial use for games and interactive content. Creator credit to Ajay Karat / Devil's Work.shop is appreciated but not required.

Start with three compact variants, one pickup, and the bus. Treat the police car as an uncommon visual variant and retain the other pickup for future cosmetic variety.

### 5.4 `SourceAssets/Free_Low_Poly_Vehicles_Rgsdev/` â€” expanded vehicles

Individual FBX models include Ambulance, Bus, Firetruck, Hatchback, Limousine, Monster Truck, Pickup, Muscle, Muscle 2, Roadster, Sedan, Sports, SUV, Taxi, Van, four Police variants, Truck, and Truck with trailer.

Do not use `All vehicles.fbx` at runtime. Individual models keep culling, pooling, manifests, and bundles deterministic.

The embedded license declares CC0/public-domain use, including commercial projects. Creator: Raphael GonÃ§alves / Rgsdev; credit is optional.

Prioritize Sedan/Hatchback, Taxi, Van, Bus, Truck, and one service vehicle. Emergency vehicles remain cosmetic variants unless canonical gameplay defines a distinct hazard. Long models require footprint-readability tests.

### 5.5 `SourceAssets/Free_Cars/` â€” unverified vehicles

Contains Ambulance, Bus, two regular cars, two ice-cream trucks, Pickup, Police Car, Sport Car, Taxi, `SMAT`, and two shared textures.

Status is `HOLD`: â€œFreeâ€ in a filename is not licensing evidence. If cleared, the ice-cream trucks and taxi may offer useful silhouette variety.

### 5.6 `SourceAssets/SportsCar_Yellow/` â€” unverified lightweight car

Contains FBX, OBJ, Collada 1.4/1.5, PNG, and PSD. The readme reports 220 vertices, 222 polygons, UV mapping, a 1024Ã—1024 diffuse texture, and mobile readiness.

Status is `HOLD`: the descriptive readme does not include an explicit license grant. If cleared, use it as a visual compact-car variant with canonical mechanics.

### 5.7 `SourceAssets/pack_cartoon_cars/` â€” unverified combined scene

Contains `pack_cartoon_cars.fbx` and `pack_cartoon_cars.blend`. Status is `HOLD` because no license/readme was present. Separate, name, normalize, and review individual models after clearance; never load the complete source scene in the browser.

### 5.8 `SourceAssets/KayKit_BlockBits_1.0_FREE/` â€” blocks and terrain

Useful designs include grass, dirt, gravel, sand, snow, water, lava, stone, metal, glass, wood, ore stones, bricks, colored blocks, decorative blocks, and striped blocks.

FBX, glTF/BIN, and OBJ/MTL are duplicate delivery formats for the same 40 designs. Use one source format per conversion. The embedded license is CC0; creator credit to Kay Lousberg / KayKit is optional.

Use for tile/material prototypes and world dressing, not authoritative map geometry. Recolor into the Lana Roads palette. Prefer instanced procedural geometry when it is smaller than many nearly identical meshes.

### 5.9 `SourceAssets/KayKit_Forest_Nature_Pack_1.0_FREE/` â€” environment

Includes 22 bush variants, grass mesh/color variants, more than 60 rock variants, and leafy/bare tree families. The 105 designs are redundantly delivered as FBX, glTF/BIN, and OBJ/MTL.

The embedded license is CC0; creator credit to Kay Lousberg / KayKit is optional.

Curate approximately four trees, four rocks, three bushes, and two grass clusters per initial biome. Use instancing, palette variants, rotation, mirroring, and scale bands. Decorative vegetation cannot obscure hazard approach, occupied tiles, or the local player.

### 5.10 `SourceAssets/chicken_-_crossy_road/` â€” reference-only

Contains `scene.gltf`, `scene.bin`, and a license identifying a Sketchfab model by `micaela.reyes0059` under CC-BY-4.0.

It is `REFERENCE-ONLY` because it explicitly represents a Crossy Road character. Do not ship, trace, recolor, derive an agent from it, or use it in marketing. Private inspection is limited to broad camera-scale and silhouette-readability study.

### 5.11 `SourceAssets/crossy_road_3d_scene/` â€” reference-only

Contains `scene.gltf`, `scene.bin`, and a license identifying a Sketchfab model by `ROMANProJects` under CC-BY-4.0.

It is `REFERENCE-ONLY` due to explicit Crossy Road scene identity. Do not ship its geometry, textures, layout, or a close reconstruction. Study only broad principles such as lane contrast, camera angle, obstacle readability, and density.

## 6. Approved first-pass art kit

### Agents

- Select 6â€“10 visually distinct models from `VoxelAnimals/`.
- Include one free starter and representatives for class/rarity presentation.
- Produce GLB models, portraits, shadows, and standard animation anchors.

### Vehicles

- Use three compact variants, one pickup, and one bus from Devil's Work.shop.
- Add Sedan/Hatchback, Taxi, Van, and one Truck from Rgsdev only after initial lane tests.
- Police and service vehicles remain cosmetic unless gameplay explicitly defines otherwise.

### Environment

- Use procedural/instanced road, safe-zone, rail, and river foundations.
- Curate a small CC0 KayKit set for trees, rocks, bushes, grass, and material prototypes.
- Build gameplay-significant trains, logs, markings, crossings, and blockers as original normalized assets where supplied packs do not match canonical footprints.

## 7. Runtime manifest

Every converted output needs a record similar to:

```ts
type RuntimeAssetRecord = {
  id: string;
  kind: "agent" | "vehicle" | "terrain" | "prop" | "effect";
  sourcePack: string;
  sourceFile: string;
  licenseStatus: "approved" | "hold" | "reference-only";
  attribution?: string;
  outputFile: string;
  outputSha256: string;
  tileFootprint?: { width: number; length: number };
  triangles: number;
  materials: number;
  textureBytes: number;
  preloadGroup: "boot" | "menu" | "gameplay-near" | "gameplay-lazy";
  fallbackAssetId: string;
};
```

Use stable semantic IDs such as `agent.bear.01`, `vehicle.compact.a`, `vehicle.pickup.a`, `vehicle.bus.a`, `terrain.tree.a`, and `prop.rock.round.a`. Do not expose pack names, spaces, source numbering, rarity, or economic values in protocol-facing IDs unless genuinely stable.

## 8. Conversion pipeline

1. Confirm the source status in this catalog.
2. Record source file and license/provenance evidence.
3. Import one preferred source format into Blender or the approved tool.
4. Remove duplicate, hidden, inaccessible, and editor-only geometry.
5. Apply transforms; normalize scale, forward axis, pivot, and ground contact.
6. Separate combined scenes into independently poolable assets.
7. Align visuals to canonical tile footprints without deriving collision from meshes.
8. Consolidate materials and remap colors into the Lana Roads palette.
9. Generate optimized GLB and compressed textures.
10. Inspect triangles, materials, textures, and output size.
11. Test from the real gameplay camera on a mobile/low-quality tier.
12. Add the manifest record, output hash, fallback, and preload behavior.
13. Review legal status, silhouette, footprint alignment, draw calls, and memory.
14. Commit only approved derivatives and required attribution, not unnecessary raw packs.

## 9. Rendering policy

- Instance repeated vehicles, rocks, trees, grass, tiles, and props.
- Pool moving hazards; do not create/dispose objects per lane crossing.
- Share geometry/materials between visual variants where feasible.
- Atlas compatible textures and keep material counts low.
- Use bounded emissive materials, not a dynamic light per vehicle.
- Cap shadows, particles, trails, and accessories by distance and quality.
- Never render every source variant merely because it exists.
- Missing assets use footprint-correct approved fallbacks.

## 10. Licensing register

| Pack                    | Evidence                                     | Action                                          |
| ----------------------- | -------------------------------------------- | ----------------------------------------------- |
| VoxelAnimals            | user-confirmed paid Unity Asset Store rights | retain receipt privately; no raw redistribution |
| Devil's Work.shop cars  | embedded commercial-use license              | credit optional; retain license                 |
| Rgsdev vehicles         | embedded CC0 declaration                     | credit optional; retain license                 |
| KayKit Block Bits       | embedded CC0 license                         | optional Kay Lousberg credit                    |
| KayKit Forest Nature    | embedded CC0 license                         | optional Kay Lousberg credit                    |
| Crossy Road chicken     | embedded CC-BY-4.0 record                    | reference-only; do not ship                     |
| Crossy Road scene       | embedded CC-BY-4.0 record                    | reference-only; do not ship                     |
| Voxel Animal Asset Pack | none found                                   | `HOLD` pending proof                            |
| Free Cars               | none found                                   | `HOLD` pending proof                            |
| SportsCar Yellow        | descriptive readme only                      | `HOLD` pending explicit license                 |
| Cartoon Cars            | none found                                   | `HOLD` pending proof                            |

Create a credits page before launch for required attribution and voluntary creator credits selected by the team.

## 11. Archive extraction record

On 2026-08-13, these archives were inspected for unsafe paths, extracted to new sibling folders, verified by exact file count, and deleted at the user's request:

| Deleted archive                              | SHA-256                                                            | Destination                                        | Files |
| -------------------------------------------- | ------------------------------------------------------------------ | -------------------------------------------------- | ----: |
| `chicken_-_crossy_road.zip`                  | `60E599B323C18C41253C273AC3DB02FA6B8C3809BE331D67AAFCC68D66200BDB` | `SourceAssets/chicken_-_crossy_road/`              |     3 |
| `crossy_road_3d_scene.dae.zip`               | `75B80C097CB4B041ABB779E9B8E0047D49F80A06BE2A1A7A28B89E2965865DEC` | `SourceAssets/crossy_road_3d_scene/`               |     3 |
| `Free Cars.zip`                              | `642229E30CAB6A603AF6DBD8B23FAD23B45F9A26E574B6B0FFD6A90516191A24` | `SourceAssets/Free_Cars/`                          |    13 |
| `Free Low Poly Vehicles Pack by Rgsdev.zip`  | `9091E478BD211A7CF8B562F04E8F061A2188D323E2FA0878F3F1641E5E67C800` | `SourceAssets/Free_Low_Poly_Vehicles_Rgsdev/`      |    27 |
| `KayKit_BlockBits_1.0_FREE.zip`              | `0729D8E701B79EA20B329EAE170BFE2C6AB7843D88B24F208E6675BCB8524334` | `SourceAssets/KayKit_BlockBits_1.0_FREE/`          |   251 |
| `KayKit_Forest_Nature_Pack_1.0_FREE (1).zip` | `2EE83E63BB7695F2D884EC27DDF6FCE020789A452E7D5C5B0BBDFC4F6EA1FC8C` | `SourceAssets/KayKit_Forest_Nature_Pack_1.0_FREE/` |   641 |
| `pack_cartoon_cars.zip`                      | `1D015EBBECE634DF53872F551B63D4A45FF3DEE56791C44DC334A8ECEFA9CDC6` | `SourceAssets/pack_cartoon_cars/`                  |     2 |
| `Voxel_Animal_Asset_Pack.zip`                | `C806138B4BAAB99B10A176CA05EC6B5289B799F24FD5398BC5CFC69F49FDBDEB` | `SourceAssets/Voxel_Animal_Asset_Pack/`            |   430 |

The ZIP deletion is not recoverable from this workspace. The verified extracted folders are the retained copies.

## 12. Coding-agent checklist

- [ ] Read this catalog and `docs/FRONTEND.md`.
- [ ] Confirm the source is not `HOLD` or `REFERENCE-ONLY`.
- [ ] Confirm the model belongs to the curated roster.
- [ ] Record license/provenance evidence.
- [ ] Use a stable semantic runtime ID.
- [ ] Keep authority and collision independent from visuals.
- [ ] Convert only required models and one source format.
- [ ] Optimize and inspect the output.
- [ ] Test gameplay-camera readability on mobile.
- [ ] Add fallback, preload, manifest metadata, hash, and attribution.
- [ ] Commit no unnecessary raw third-party files.
