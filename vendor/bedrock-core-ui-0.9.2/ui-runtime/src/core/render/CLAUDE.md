# Vendored render-core guidance

- Validate the complete form/render tree before presentation. Reject invalid node
  types, duplicate identity, malformed parents, unsupported props, excessive
  depth/count, and invalid control payload without publishing a partial tree.
- Lifecycle/session state must have one owner. Mount, update, traversal,
  presentation, response, cancel, error, and unmount must each reach an explicit
  terminal/next state and release retained presenters/subscriptions exactly once.
- Current lifecycle code takes the input lock before build/presentation, while
  those failure branches only log and rely on later session teardown for release.
  Treat local failure cleanup as a hardening gap; do not claim exactly-once
  release until an executable regression proves it.
- Keep traversal and phase work bounded and deterministic. Avoid presenter work
  that rescans the complete tree per node or schedules immediate recursive render
  loops.
- Presenters translate validated runtime nodes to protocol-v0007 only; they do not
  own application state or infer guest success from client rendering.
- Preserve stable traversal/order/event association across phases. The current
  response path has no session/tree generation token, so explicit stale-response
  rejection is unimplemented; add the token and tests before claiming it.

## Verification

Run a configured target that actually includes
`core/render/__tests__/validateForm.test.ts` and
`core/render/presenters/__tests__/presentModal.test.ts`, then rebuild vendor and
Resource Pack. The default project Vitest config excludes vendor tests. Protocol
or lifecycle changes require real GDK open/respond/cancel/close evidence.
