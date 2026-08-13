# Lana Roads Voxel Arcade UI — Generated Source Atlases

These transparent PNG sheets were generated with Codex's built-in image generation tool as original Lana Roads 2.0 visual source material.

## Files

- `lana-roads-ui-icons-v1.png` — navigation, wallet/status, gameplay action, ability, and hazard icon concepts.
- `lana-roads-ui-components-v1.png` — blank buttons, lower-edge depth pieces, panels, tabs, progress/cooldown frames, and modular UI surfaces.
- `lana-roads-ui-effects-v1.png` — voxel confetti, impact bursts, dust, speed streaks, rarity frames, warnings, rewards, and connection effects.

## Intended use

These are source atlases and art-direction references. Before runtime use:

1. Review and select individual assets.
2. Extract each selection non-destructively into its own transparent file.
3. Clean edge glow/fringing where necessary.
4. Normalize canvas, optical scale, outline, and padding.
5. Redraw structural controls as deterministic SVG/CSS/nine-slice assets when scaling or accessibility requires it.
6. Give each final asset a stable manifest ID and semantic label.
7. Test against light/dark world scenes and supported mobile resolutions.

Do not load a complete atlas as one giant runtime texture without an explicit optimized atlas manifest. Do not infer gameplay behavior from generated artwork.

## Constraints

- No generated text is authoritative or intended for display.
- No emoji, external game branding, or proprietary reference assets were supplied to the generation tool.
- Crossy Road informed broad arcade interaction grammar only; these assets are original Lana Roads concepts.
- Keep editable/source and finalized runtime assets in separate versioned directories.

## Generation metadata

- Tool: Codex built-in `image_gen`
- Date: 2026-08-13
- Direction: Voxel Arcade
- Output: transparent RGBA PNG
- Palette intent: navy, sky/aqua, grass, sun, coral, violet, paper

The complete prompts are recorded in `prompts.md`.
