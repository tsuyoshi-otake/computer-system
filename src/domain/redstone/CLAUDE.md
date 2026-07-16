# Redstone domain guidance

- Redstone sides use the fixed six-face vocabulary shared with machine faces.
  Reject invalid sides before reading or changing state.
- Power is an integer in the supported Bedrock signal range. Validate and clamp
  only where the public contract explicitly calls for clamping; otherwise reject
  out-of-range input without mutation.
- Inputs use a side-keyed Map and outputs use a six-bit mask for O(1) access.
  Input changes are transient and return previous/current/changed; only output
  mutation increments `revision`. `ComputerRecord` persists the output mask, not
  sampled inputs.
- Domain redstone state does not poll neighbors or choose producer/consumer pack
  components. The Bedrock adapter owns sampling and compatibility constraints.

## Verification

Use `tests/domains/redstone.test.ts` and Phase 0 output-constraint tests. Cover
all six sides, 0/15 boundaries, invalid names/power, output-mask persistence,
input exclusion from Computer snapshots, revision changes only for output, and
unchanged state after rejection.
