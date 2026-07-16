# Compatibility test guidance

- `computercraft.test.ts` protects only the documented ComputerCraft-facing
  subset. It does not authorize new production policy inside Phase 0 facades.
- Keep API names/results and rejection behavior compatible where promised while
  preserving Computer System bounds, sandboxing, and explicit unsupported cases.
- When a facade changes, search its production/tool/probe consumers and run the
  owning focused tests. Do not translate a modern failure into legacy success.

## Focused verification

Run `npm test -- tests/compatibility` plus the focused consumer suite for any
changed facade.
