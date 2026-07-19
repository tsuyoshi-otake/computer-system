# Display domain guidance

## Profiles

- Persist only a versioned display-profile ID, never framebuffer bytes, dirty
  queues, epochs, or display revision.
- Portable uses `portable-vga-256k`: 80x25 text, 320x200x8, and 640x480x4 in 256
  KiB VRAM on an 800x480 physical LCD.
- Desktop uses `desktop-vga-512k`; Advanced uses `advanced-vga-512k`. Both add
  640x480x8 in 512 KiB VRAM on a built-in 640x480 CRT. All profiles stop at
  640x480.
- Accept only mode IDs supported by the selected profile, then verify their
  computed framebuffer requirement fits its VRAM before allocation or switch.

## Device state

- `DisplayDevice` follows `off` -> POST in text mode -> text/graphics. It
  allocates transient VRAM on POST and releases it on power-off or fault. A
  reset or power-off recovers from `faulted`; repeated release is deterministic
  and leak-free.
- Pixel/tile writes validate coordinates and byte ranges before mutation. Dirty
  tile marking is O(1) and drains through a fixed-capacity ring in bounded O(D)
  batches.
- The domain device owns framebuffer/mode state; application brokers own fan-out
  and adapters own rendering. A consumer must not destructively drain the device
  independently.
- `takeDirtyTiles` is the destructive drain and defaults to at most 64 tiles and
  16,384 payload bytes. The application broker is its sole production owner.

## Verification

Use `tests/domains/display.test.ts`. Cover every profile/mode, exact VRAM
bounds, invalid coordinates/modes, dirty-ring capacity/order, POST allocation,
power-off release, and snapshot exclusion of transient bytes.
