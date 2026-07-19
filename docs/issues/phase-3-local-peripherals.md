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
- [x] Retire the standalone display peripheral; Desktop and Advanced now use a
      built-in CRT in their one-block all-in-one chassis.
- [ ] Implement Speaker notes and registered sounds within validated limits.
- [ ] Implement Printer, Printed Page, Printed Pages, and Printed Book.
- [ ] Implement `peripheral`, `disk`, `colors`, and relevant terminal APIs.

## Acceptance rubric

`Verify:` Attach and detach every peripheral, mount multiple disks, interact
directly with both integrated Desktop CRT machines, play notes, print and reopen
a multipage document, and produce independent analog output through two
interfaces.

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

## Web Terminal keyboard indicators and Eject control (2026-07-18)

- `Verify:` run
  `rtk npm exec vitest run tests/tools/terminalInput.test.mjs tests/tools/webUi.test.mjs`.
  `Expect:` Caps Lock, Num Lock, and Scroll Lock render an accessible unknown
  state, consume browser modifier state as on/off, and reset to unknown after
  page focus is lost; Eject retains its explicit disabled reason and responsive
  contract. `Observed:` PASS; 2 test files and 19 tests passed.
- `Verify:` run
  `rtk npm exec vitest run tests/tools/webCompanionServer.test.mjs tests/bedrock/terminalAdapters.test.mjs`.
  `Expect:` only the active writer can relay a bounded Eject request, explicit
  ejected and empty outcomes finalize once, a demoted writer is rejected, and
  Bedrock owns the media return. `Observed:` PASS; 2 test files and 60 tests
  passed.
- `Verify:` open the authored Web Terminal from a local HTTP server in real
  Chrome at 1750 x 963 and 390 x 844, then inspect the top bar, footer, and
  computed control bounds. `Expect:` PWR/HDD/FDD, Eject, and Power remain
  visible, keyboard states expose text alternatives, no horizontal overflow is
  introduced, and the mobile Eject target is at least 44 pixels high.
  `Observed:` PASS; the mobile Eject target measured 50.08 x 44 pixels, its
  empty-drive title was present, and neither the document nor status bar
  overflowed horizontally. Chrome automation did not toggle the host's physical
  Caps Lock state, so the real on transition remains covered by the
  deterministic modifier-state unit test rather than a physical-key claim.
- `Verify:` run `rtk npm run validate`. `Expect:` formatting, ESLint,
  TypeScript, all host tests, the Bedrock pack, and all 16 manual chapters pass.
  `Observed:` PASS; 149 test files and 999 tests passed.
- `Verify:` with `BDS_HOME` configured, connect a real writer-owned Web Terminal
  to a Computer with an inserted Floppy Disk and activate Eject. `Expect:` the
  exact request finishes once, the FDD state becomes absent, and the
  identity-carrying item returns to the connected player. `Observed:` pending;
  this environment had no `BDS_HOME`, so no new BDS/GDK interaction claim is
  made.
