# Phase 3: Implement redstone and local peripherals

Parent: #1 Blocked by: #4

## Scope

- [ ] Implement the Peripheral Bus and attach/detach events.
- [x] Add the bounded six-face RS-232C, SPI, and I2C controller foundations,
      fixed Linux/DOS device numbering, and machine-relative topology mapping.
- [ ] Implement the Redstone Interface and independent analog output fallback.
- [x] Implement the identity-carrying 1.44 MiB Floppy Disk item, transactional
      media persistence, FAT12, DOS/Linux access, removable A:/`/mnt/floppy`,
      bootable CS-DOS system disks, modeled I/O timing, and Web Terminal FDD
      sounds.
- [ ] Implement the generic Disk Drive and `/disk`, `/disk2` mount behavior.
- [ ] Implement Monitor and Advanced Monitor using the validated rendering
      adapter.
- [ ] Implement Speaker notes and registered sounds within validated limits.
- [ ] Implement Printer, Printed Page, Printed Pages, and Printed Book.
- [ ] Implement `peripheral`, `disk`, `colors`, and relevant terminal APIs.

## Acceptance rubric

`Verify:` Attach and detach every peripheral, mount multiple disks, render and
interact with a connected monitor, play notes, print and reopen a multipage
document, and produce independent analog output through two interfaces.

`Expect:` Events are delivered once, resources remain bounded, saved media
survives reload, and unsupported behavior returns an explicit error.

## Floppy Disk verification evidence (2026-07-16)

- `Verify:` `rtk npm run validate`. `Expect:` formatting, ESLint, TypeScript,
  all host tests, Bedrock pack build, and all 16 manual chapters pass.
  `Observed:` PASS; 138 test files and 841 tests passed.
- `Verify:` run `rtk npm run test:bds` against BDS 1.26.33.2 in a fresh
  `BDS_WORKDIR` and allow both restart sessions to complete. `Expect:` every
  headless probe passes twice, persistence advances, and host work remains below
  its tick budget. `Observed:` PASS; storage sequence advanced 1 → 2, Computer
  snapshot and ItemStack identity survived restart, maximum tick duration was 1
  ms against the 50 ms budget, and no memory-warning signal was recorded.
- `Verify:` open an authenticated production Web Terminal in real Chrome, stream
  bounded Floppy audio snapshots, activate the page with a user gesture, and
  search the manual for `FORMAT A: /S`. `Expect:` A: terminal output renders,
  the FDD indicator follows live activity, Web Audio unlocks without an RP sound
  asset, and the manual documents the bootable-format command. `Observed:` PASS;
  Chrome rendered CS-DOS A:, `spinning_up`, `seek`, and `read` FDD states, and
  two relevant manual search results. Synthetic AudioContext tests additionally
  cover no replay, oscillator/noise generation, the 16-voice cap, stop-all, and
  close.
- `Verify:` inspect the built Floppy Disk item in Minecraft for Windows and
  listen to insert/eject/read/write activity through the Web Terminal. `Expect:`
  the supplied blue pixel-art icon is legible in inventory, the item remains
  non-stackable and identity-bearing across insert/eject/reload, and the
  synthesized drive sounds are audible after a browser gesture. `Observed:`
  pending manual GDK client verification; no client-only visual or audibility
  claim is inferred from the successful BDS and Chrome checks.
