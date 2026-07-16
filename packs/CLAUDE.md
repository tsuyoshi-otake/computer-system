# Bedrock pack guidance

## Authored sources and generated output

- `packs/behavior/` and `packs/resource/` contain versioned authored pack
  inputs. Production output is assembled into `dist/` by `tools/build.mjs`;
  never commit `dist/` as an authored pack.
- Keep Behavior Pack and Resource Pack UUIDs, dependencies, minimum engine
  versions, module versions, and cross-pack references synchronized.
- Increment the Resource Pack version whenever shipped UI, textures, geometry,
  atlas entries, or artwork changes. Increment the Behavior Pack version when
  shipped behavior/script contracts change as required by Bedrock cache/update
  semantics.
- Derived item icons, block geometry, atlas entries, and block-face textures
  come from the allowlisted generators in `tools/`. Do not hand-edit a generated
  artifact without updating its source/generator and deterministic tests.
- Authored isometric machine plates and CPU plates remain Web/manual assets; do
  not repurpose them as block-face UV maps.

## Bedrock compatibility

- Keep JSON/UI protocol and vendored Bedrock Core UI runtime versions aligned.
  Resource Pack protocol-v0007 decoder changes must ship with the matching
  runtime build.
- BDS 1.26 rejects a custom block with both `minecraft:redstone_consumer` and
  `minecraft:redstone_producer`. Computer blocks retain the producer and use the
  bounded six-face input poll; do not restore the incompatible consumer.
- Unsupported engine behavior fails during build/probe rather than shipping a
  silently degraded pack. Validate identifiers, paths, dimensions, texture
  sizes/formats, and generated file allowlists.

## Verification

Run `npm run build`, inspect generated pack manifests/assets, and use the real
GDK client for visible or interaction changes. Resource Pack success includes UI
layout and texture verification; Behavior Pack success includes real-BDS Script
API readiness and the smallest affected probe.
