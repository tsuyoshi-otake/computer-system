# Computer domain guidance

## Identity

- New Computer IDs use collision-checked lowercase `c-xxxxxx` Crockford Base32.
  The six-character payload encodes the stable 30-bit numeric ID; decoding and
  validation are deterministic.
- Do not renumber legacy `computer-N` identities or reinterpret an unsupported
  identity schema. Migration policy lives in the application/storage layers.
- Keep block, item, integrated display, portable, storage, terminal, and runtime
  references bound to the same stable identity.

## Lifecycle

- `nextState` defines the allowed lifecycle graph. Unsupported transitions fail
  before mutation; no caller may assign a lifecycle state directly to bypass it.
- Every transitional state has a named owner and an explicit terminal successor.
  Crash, shutdown, reboot, and block removal cannot strand a Computer in an
  intermediate state.
- Minecraft presence affects lifecycle only through explicit domain events such
  as `block_missing` and `block_restored`; adapters must not assign states or
  infer transitions from browser connection state.

## Hardware and faces

- A Computer snapshot persists CPU model/clock/RAM, display-profile ID, and OS
  profile. Default filesystem capacity is selected from Portable display plus
  machine family (20/40/80 MiB), may be overridden through filesystem limits,
  and is not a disk-profile field in this aggregate.
- The domain defines the family defaults. Restore compatibility is deliberately
  narrow: the exact legacy 20 kHz default and the legacy Portable display
  inference. Do not broaden those heuristics to customized profiles.
- Machine faces define the fixed six-side indices, orientation transforms, and
  opposite-side mapping. Connection ownership and topology policy live above
  this value model.
- Keep Computer aggregate operations bounded and free of Minecraft types.

## Verification

Use `tests/computer/identity.test.ts`, `tests/computer/lifecycle.test.ts`,
`tests/computer/machineFace.test.ts`, and
`tests/computer/hardwareProfiles.test.ts`. Cover malformed IDs, numeric round
trips, collision handling, every legal and illegal lifecycle edge, explicit
block-presence events, face rotation/opposites, and unchanged state after
rejection.
