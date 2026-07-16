# Display application guidance

## Delta broker

- `ComputerDisplayDeltaBroker` is the sole destructive dirty-tile drain owner.
  Drain each Computer once and publish the same immutable update to every
  attached consumer; never drain a framebuffer independently per Web or Bedrock
  session.
- A late consumer receives a complete queued keyframe before deltas. Increment
  epochs when the display mode/device is replaced so stale updates cannot apply.
- Release broker state after the final consumer detaches and after power-off,
  fault, shutdown, or Computer removal.
- Keep per-pass Computer, dirty-tile, byte, consumer, and queued-keyframe
  budgets fixed. Dirty marking is O(1); a viewer must not introduce
  O(framebuffer) work per tick.

## Boundary

- Framebuffer bytes are transient domain state and are never serialized through
  World Dynamic Properties or session payloads as persistence.
- The next graphics integration is a Web Canvas adapter over broker output. It
  does not replace the current fixed-cell `TerminalBuffer` as text source of
  truth.

## Verification

Use `tests/computer/computerDisplayDeltaBroker.test.ts` for shared draining,
identical fan-out, late keyframes, epoch replacement, detach/release, capacity
limits, and bounded batches. Domain VRAM/power-off behavior lives in
`tests/domains/display.test.ts`.
