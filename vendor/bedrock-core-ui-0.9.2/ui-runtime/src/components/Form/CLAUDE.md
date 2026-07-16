# Vendored form component guidance

- Preserve stable control discriminants, IDs, ordering, option identity, payload
  shapes, default/selected values, and event semantics expected by protocol-v0007
  Resource Pack decoders.
- Validate label/value/options/range/step/index lengths and finite numbers before
  serialization. Reject malformed or capacity-exceeding controls explicitly;
  never coerce them through client quirks.
- Dropdown, inline select, option, toggle, slider, input, and button controls keep
  deterministic mapping between rendered index and semantic value across rerender.
- Declarative Form components define controls and semantic values. Render
  presenters, not these components, own physical response, cancel, transport,
  unmount, and listener finalization.
- Do not add Computer password/token logic or terminal command handling here.
  Secret masking and authorization are application/adapter responsibilities.

## Verification

No Form-local test suite is currently configured. Add a focused regression to an
executable vendor/project target; run `npm run build:vendor-ui`, the relevant
Bedrock custom-view and `tests/tools/terminalUi.test.mjs` tests, then perform real
GDK checks for every affected control state and cancellation path.
