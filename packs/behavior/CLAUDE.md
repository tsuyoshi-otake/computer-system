# Behavior Pack guidance

- Preserve the Behavior Pack UUID/module/dependency relationship expected by the
  Resource Pack and deployment tooling. Validate minimum engine and Script API
  compatibility before a version bump.
- Authored loot tables and localization contain stable Computer System
  identifiers. A block/item rename updates code, Resource Pack, recipes/loot,
  localization, tests, migration/compatibility notes, and manual together.
- Production scripts are generated from `src/` into `dist/behavior_pack`; do not
  add or hand-edit compiled script bundles under `packs/behavior/`.
- BDS 1.26 rejects a custom block with both `minecraft:redstone_consumer` and
  `minecraft:redstone_producer`. Computer blocks retain the producer and use the
  bounded six-face input poll; do not restore the incompatible consumer.
- Loot/item identity transfer must preserve the exact Computer payload through
  application adapters; static loot JSON must not fabricate or strip identity.

## Verification

Run `npm run build` and the smallest real-BDS probe for manifest, identifier,
loot, block, item, redstone, or script-contract changes. Confirm Script API
readiness and inspect bounded errors/warnings.
