# Bedrock adapter test guidance

- Host `.mjs` tests primarily inspect source structure, protocol wiring, and
  bounded adapter contracts; they do not execute Minecraft Script API.
- Assert adapters remain thin and call application owners for identity,
  credentials, terminal, lifecycle, persistence, writer access, and
  finalization.
- Probe wiring emits explicit PASS and failure records, bounds details, and
  never includes passwords, bearer tokens, one-use URLs, private origins, or
  host paths.
- Cover form cancellation/competing form/player disconnect, exact close request,
  writer/viewer enforcement, safe-boot gating, direct all-in-one Desktop access,
  Portable identity, and BDS 1.26 redstone component compatibility where
  statically visible.
- Never report a host source-inspection pass as proof of native form layout,
  player interaction, authentication, disconnect, or Script API readiness.

## Focused verification

Run `npm test -- tests/bedrock`, then the smallest `npm run test:bds`,
`npm run test:bds:disconnect`, authentication MCP acceptance, or real GDK check
required by the changed behavior.
