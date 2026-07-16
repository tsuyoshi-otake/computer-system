# Vendored UI runtime source guidance

## Child scopes

| Child scope                                                        | Responsibility                                                               |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| [`components/Form/`](components/Form/CLAUDE.md)                    | Form controls, payload codecs, option identity, and events                   |
| [`core/render/`](core/render/CLAUDE.md)                            | Render tree validation, lifecycle, traversal, phases, and presenters         |

- Preserve upstream 0.9.2 JSX/runtime API, hook ordering, node identity, data
  model, and protocol-v0007 serialization. Local changes remain minimal and
  documented.
- Runtime source contains no Computer System guest policy, credentials, shell,
  lifecycle, or terminal truth. It converts declared UI state into the vendored
  protocol and returns semantic events.
- Bound tree depth/node count, retained hooks/state, form controls/options,
  serialized payloads, subscriptions, render passes, and output. Validate before
  publishing a frame/form.
- Do not start render/update loops from effects. Detailed response/failure cleanup
  ownership belongs to `core/render/`.

## Verification

Run `npm run build:vendor-ui`, project TypeScript/build, relevant
`tests/bedrock/customTerminalView.test.mjs`,
`tests/bedrock/customNanoView.test.mjs`, and `tests/tools/terminalUi.test.mjs`,
plus a configured regression that includes any affected vendor `__tests__`. The
default project Vitest config does not include them. Protocol, lifecycle, form,
input, or visual changes also require real GDK UI verification.
