# Phase 2: Deliver the Bedrock Computer vertical slice

Parent: #1 Blocked by: #2 and #3

## Scope

- [ ] Create installable Behavior Pack and Resource Pack artifacts.
- [ ] Add Computer and Advanced Computer blocks and items.
- [ ] Transfer stable computer identity between block and item forms.
- [ ] Integrate the VM scheduler with Bedrock ticks and lifecycle events.
- [ ] Implement the Computer System OS shell and editor.
- [ ] Replace the Phase 0 DDUI probe with a dedicated ComputerCraft-inspired
      terminal view shared by Computers, Pocket Computers, and the Monitor
      fallback.
- [ ] Render 51x19 fixed cells, monospace glyphs, cursor state, and all 16
      ComputerCraft palette colors without scrolling the terminal or primary
      input controls at the reference resolution.
- [ ] Coalesce changed cells, bound redraw work, convert submitted lines into VM
      events, and finalize terminate, cancel, disconnect, competing-form,
      server-close, and failure paths explicitly.
- [ ] Implement paged, transactional Dynamic Properties persistence.
- [ ] Implement `startup.py`, shutdown, reboot, terminate, and crash reporting.
- [ ] Implement six-sided redstone input and validated digital output behavior.

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
