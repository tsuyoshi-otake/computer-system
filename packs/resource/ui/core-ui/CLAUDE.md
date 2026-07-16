# Resource Pack core UI guidance

- These JSON UI files decode protocol-v0007 output from the vendored Bedrock Core
  UI runtime. Update the runtime source, compiled modules, decoder JSON, textures,
  and Resource Pack version as one compatibility change.
- Preserve stable screen/component/control IDs, collection/property names, event
  bindings, data shapes, and ordering expected by the runtime serializer.
- Keep controls bounded to the native CustomForm/JSON UI capability. Unsupported
  layout/input behavior fails explicitly; do not encode a second terminal/editor
  state machine in JSON.
- The fixed-cell application terminal remains authoritative. JSON UI renders
  protocol data and returns semantic input only.
- Avoid unbounded generated control trees, per-cell animations, polling, or
  duplicate event bindings. Every close/cancel path returns one adapter result.

## Verification

Run `npm run build:vendor-ui`, `npm run build`, relevant Bedrock adapter tests,
then open the production form in the real GDK client. Verify protocol decode,
layout, cursor/input, close exactly once, and no content/error regressions.
