# Issue #41: staged CSBIOS boot sequence

Tracking: <https://github.com/tsuyoshi-otake/computer-system/issues/41>

Status on 2026-07-19: implemented and verified by the complete host gate, a
two-boot real-BDS probe, and a real Chrome CS-DOS power-on observation. The
separate live-player/GDK and Chrome CS-Linux observations remain explicit manual
acceptance.

## Implemented boundary

Power-on from `off` now enters one deterministic, scheduler-driven
`CsBiosBootSequence`. At 20 TPS the visible schedule spans 70 ticks
(approximately 3.5 seconds):

1. power-on black;
2. original CS-VGA identification;
3. short black transition;
4. `CSBIOS Revision 1.1` header and eight bounded same-row memory updates;
5. factual device detection;
6. explicit fixed-disk or floppy source and CS-Linux/CS-DOS target;
7. handoff black;
8. selected `Starting ...` line; and
9. one final handoff that clears the BIOS frame and releases the guest.

The display is fixed at 80x25 with the cursor hidden during POST. Each rendered
cell is written to both `TerminalBuffer` and `DisplayDevice` VRAM. The Computer
lifecycle remains `booting`, scheduled guest work stays paused, and terminal,
completion, debug, resize, and interrupt admission fail explicitly until
handoff. `terminal_closed` remains admitted so its security finalizer cannot be
stranded.

The sequence reports only active modeled state: CPU, clock, data/address bus,
RAM, cache, console, floppy media, disk quota, display adapter, VRAM, panel,
boot source, and OS target. It does not reproduce AMI vendor text, advertise a
setup utility, or fabricate an FPU, memory-module layout, BIOS date, or
third-party video adapter.

## Ownership and bounds

`ComputerRuntime` owns preparation, sequence advancement, handoff, cancellation,
and failure. Shutdown, reboot, detach, and crash cancel any pending sequence
through explicit terminal paths. A handoff failure faults the display and
crashes/detaches the prepared runtime instead of leaving an intermediate state
observable as complete.

One scheduler pass advances at most 64 pending Computers. Deferred entries
rotate through the Set, so the bound does not starve the 65th or later Computer.
Sequence work is O(K) per host tick for `K <= 64`; each fixed 80x25 frame
rewrite is independently bounded.

The real-browser pass also exposed a host relay defect: the Web companion
generated strict `web-power`, `web-floppy-eject`, and `web-abort-line` commands,
but `BdsDebugSession.isAllowedWebRelayCommand()` omitted those exact forms. The
allowlist now admits only their bounded session/request/action grammars and
continues to reject unknown actions, short request IDs, extra arguments,
newlines, and arbitrary BDS commands.

## Acceptance evidence

- `Verify:` Run
  `npx vitest run tests/computer/csBios.test.ts tests/os/systemBoot.test.ts`.
  `Expect:` Exact stages and handoff timing pass for Linux and DOS; terminal and
  VRAM stay synchronized; early input is rejected; shutdown and terminal-close
  paths finalize; low-RAM preparation fails explicitly; the 64-entry bound
  rotates fairly.
  - `Result (2026-07-19):` PASS, including all seven CSBIOS cases.
- `Verify:` Run `npx vitest run tests/computer tests/os`. `Expect:` All Computer
  and OS tests pass after callers adopt the bounded staged-boot contract.
  - `Result (2026-07-19):` PASS, 61 files and 470 tests.
- `Verify:` Run `npx vitest run tests/tools/bdsDebugSession.test.mjs`. `Expect:`
  The Web relay allowlist accepts only the exact power, safe-boot, shutdown,
  floppy-eject, abort-line, input, completion, resize, close, interrupt, and
  takeover grammars.
  - `Result (2026-07-19):` PASS, 10 tests; the real Chrome power request then
    produced one `CS_WEB_POWER` result with `outcome: accepted` and
    `lifecycle/state: booting`.
- `Verify:` Run `npm run validate` with Node.js 24 or later. `Expect:`
  Formatting, ESLint, TypeScript, all Vitest tests, Bedrock pack production
  build, and the 16-chapter Pages build pass.
  - `Result (2026-07-19):` PASS on Node.js 26.2.0: 164 test files and 1,139
    tests, plus both production builds.
- `Verify:` Start the local BDS/Web companion, power on a CS-DOS Computer from
  `off`, and observe the attached Web Terminal in Chrome. `Expect:` It shows the
  synchronized 3.5-second staged sequence; CSBIOS truthfully selects the fixed
  disk or a present bootable floppy; input remains unavailable until the OS
  screen replaces POST exactly once.
  - `Result (2026-07-19):` PASS with official BDS 1.26.33.2 and Chrome. The
    observed frames were: 200 ms black; 650 ms CS-VGA; 1.35 s CSBIOS plus
    memory; 2.35 s devices; 2.75 s fixed-disk/CS-DOS selection; 3.25 s
    `Starting Computer System DOS 1.0...`; and 4.0 s `C:\>`. The sampled 250 ms
    Web publication interval accounts for observation after the scheduler's
    exact 3.5-second handoff.
- `Verify:` Run the smallest applicable real-BDS lifecycle probe. `Expect:` Boot
  remains bounded, the OS becomes observable only after CSBIOS handoff, and
  shutdown/reboot still reaches its explicit terminal state.
  - `Result (2026-07-19):` PASS on two consecutive boots. Both complete suites
    had zero failures; Linux authentication reached its prompt in 164 ticks on
    both boots, the vertical Computer terminated `off`, and the second boot
    restored the persisted snapshot.

## Exclusions and residual risk

This work does not emulate an AMI ROM, byte-compatible firmware, BIOS Setup,
real x86 POST instructions, third-party VGA firmware, or Windows startup. CSBIOS
is an original visual and lifecycle model over the existing sandboxed Computer
state. The current placed Chrome acceptance machine was configured for CS-DOS,
so a separate Chrome CS-Linux observation and live-player/GDK visual pass remain
open; CS-Linux timing/content is covered by the exact host state-machine tests
and the real-BDS authentication probe.
