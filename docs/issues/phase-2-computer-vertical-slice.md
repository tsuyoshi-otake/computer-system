# Phase 2: Deliver the Bedrock Computer vertical slice

Parent: #1
Blocked by: #2 and #3

## Scope

- [ ] Create installable Behavior Pack and Resource Pack artifacts.
- [ ] Add Computer and Advanced Computer blocks and items.
- [ ] Transfer stable computer identity between block and item forms.
- [ ] Integrate the VM scheduler with Bedrock ticks and lifecycle events.
- [ ] Implement the Computer System OS shell and editor.
- [ ] Connect the terminal buffer to the validated Bedrock UI adapter.
- [ ] Implement paged, transactional Dynamic Properties persistence.
- [ ] Implement `startup.py`, shutdown, reboot, terminate, and crash reporting.
- [ ] Implement six-sided redstone input and validated digital output behavior.

## Acceptance rubric

`Verify:` In a clean Bedrock world, place a computer, create `startup.py`, mirror
left redstone input to right output, break and replace the computer, reload the
world, and terminate an infinite program.

`Expect:` Identity and files remain stable, startup runs after reload, redstone
events and output work, all lifecycle paths are visible, and Minecraft remains
responsive.
