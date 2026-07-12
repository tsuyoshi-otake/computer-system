# Phase 2: Deliver the Bedrock Computer vertical slice

Parent: #1 Blocked by: #2 and #3

## Scope

- [x] Create installable Behavior Pack and Resource Pack artifacts.
- [x] Add Computer and Advanced Computer blocks and items.
- [x] Transfer stable computer identity between block and item forms.
- [x] Integrate the VM scheduler with Bedrock ticks and lifecycle events.
- [x] Implement the Computer System OS shell and editor.
- [x] Replace the Phase 0 probe implementation with a production terminal view
      coordinator shared by Computers, Pocket Computers, and the Monitor
      fallback.
- [ ] Verify the dedicated ComputerCraft-inspired terminal view on the supported
      GDK client at the reference resolution.
- [x] Model and render 51x19 fixed cells, monospace rows, cursor state, and all
      16 ComputerCraft foreground palette colors.
- [ ] Verify background colors and that neither the terminal nor primary input
      controls scroll at the reference resolution.
- [x] Coalesce changed cells, bound redraw work, convert submitted lines into VM
      events, and finalize terminate, cancel, disconnect, competing-form,
      server-close, and failure paths explicitly.
- [x] Implement paged, transactional Dynamic Properties persistence.
- [x] Implement `startup.py`, shutdown, reboot, terminate, and crash reporting.
- [x] Implement six-sided redstone input and validated digital output behavior.

## Automated evidence

- `npm run validate` passes formatting, lint, type checking, 37 test files with
  135 tests, and the production pack build.
- Lifecycle tests cover boot, scheduling, sleep, event wait, completion,
  shutdown, reboot, terminate, syntax failure, and runtime crash ownership.
- Identity tests cover transactional reload, block-item-block transfer,
  duplicate rejection, immutable family, and placement rollback.
- Dynamic Properties tests cover paging, generation isolation, dirty-write
  suppression, checksum validation, and previous-generation recovery.
- Terminal tests cover the 51x19/16-color contract, a 128-cell flush budget, one
  event per submitted line, and exactly one final event for every close path.
- Pack tests generate both Computer items plus 128 hidden block variants for all
  independent six-face digital output masks.

`npm run test:bds` currently stops before launch because `BDS_HOME` is not set
in this workspace. The clean-world and player-experience rubric below therefore
remains an explicit release gate rather than being inferred from host tests.
When configured, the runner requires two passing `computer_vertical` records and
proves identity, snapshot, startup, redstone output, and termination across the
server restart.

## Acceptance rubric

`Verify:` In a clean Bedrock world, place a computer, create `startup.py`,
mirror left redstone input to right output, break and replace the computer,
reload the world, and terminate an infinite program.

Open the same terminal from a Computer and Pocket Computer, then from a Monitor
touch. Exercise typed input, continuous output, all 16 colors, cursor movement,
Terminate, normal Close, disconnect, and a competing form.

`Expect:` Identity and files remain stable, startup runs after reload, redstone
events and output work, all lifecycle paths are visible, and Minecraft remains
responsive.

The terminal remains fixed-cell and usable without primary-control scrolling,
continuous output stays within its redraw budget, every submitted line becomes
one VM event, and every close path produces exactly one VM-visible result.
