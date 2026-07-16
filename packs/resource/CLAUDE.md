# Resource Pack guidance

## Child scopes

| Child scope                             | Responsibility                                                 |
| --------------------------------------- | -------------------------------------------------------------- |
| [`ui/core-ui/`](ui/core-ui/CLAUDE.md)   | Protocol-v0007 JSON UI decoder and component/screen contract   |
| [`textures/ui/`](textures/ui/CLAUDE.md) | Generated/allowlisted cursor, field, and button texture assets |

- Preserve the Resource Pack UUID/dependency/minimum-engine contract and
  increment its version for any shipped UI, texture, geometry, atlas,
  localization, or artwork change.
- Keep localization identifiers aligned with Behavior Pack and code. Missing
  locale entries fail validation rather than silently shipping raw keys.
- Derived item icons, block geometry, atlas entries, and block-face textures
  come from the allowlisted generators in `tools/`. Never use authored isometric
  Web plates directly as block-face UVs.
- Validate PNG format, dimensions, transparency, paths, atlas references, JSON
  UI identifiers, and exact output allowlists before build completion.
- Resource Pack visual success requires real GDK verification; JSON/build
  success alone does not prove layout, cursor, texture, or form behavior.

## Verification

Run `npm run build`, relevant asset-generator tests, and verify the affected UI
or artwork in the real GDK client after confirming the pack version changed.
