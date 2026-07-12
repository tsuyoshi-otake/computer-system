# Manual verification

Most Computer System behavior is verified by host tests or the headless Bedrock
Dedicated Server harness. Manual testing is reserved for behavior that depends
on a real player's visual, audio, or interaction experience.

## Phase 2 Computer vertical-slice checklist

Build and deploy both packs, create a clean world, and obtain
`computer_system:computer_item` plus `computer_system:advanced_computer_item`.
Record the exact client and server versions with each result.

Verify lifecycle and persistence:

- Place each Computer family and confirm interaction opens its 51x19 terminal.
- Run `edit /startup.py`, enter a program, and finish with `.save`.
- Break the Computer, confirm exactly one non-stackable item is returned, place
  it elsewhere, and confirm its numeric computer ID and file remain unchanged.
- Reload the world and confirm `startup.py` runs from a fresh VM.
- Run an infinite program, press Terminate, and confirm Minecraft remains
  responsive and the lifecycle reaches `off` exactly once.

Verify redstone using a startup program that waits for `redstone`, reads `left`,
and calls `redstone.set_output("right", value)`:

- Toggle each of the six adjacent inputs and confirm the reported side and
  analog level are correct.
- Mirror left input to right output and confirm only the right output face emits
  digital power 15.
- Reload and repeat to prove identity, program, and output configuration
  survive.

Verify the shared terminal from a Computer, Pocket Computer, and Monitor touch:

- All 51 columns and 19 rows remain visible with monospace alignment.
- Cursor position/blink and every foreground/background combination from the 16
  ComputerCraft palette colors are visually distinguishable.
- The terminal and primary Input, Submit, Terminate, and Close controls require
  no scrolling at the reference resolution.
- Continuous output does not freeze Minecraft or expose a partial redraw queue.
- Every submitted line reaches the VM once; rapid double submission creates two,
  not zero, one, or more than two, events.
- Terminate, normal Close, player disconnect, a competing form, server close,
  and an injected presentation failure each produce exactly one visible/VM
  result.

Do not mark Phase 2 complete when any item above is `NOT_RECORDED`; host tests
do not substitute for layout, controller focus, background-color, or
responsiveness evidence.

## Phase 0 terminal checklist

Run this command as a player in the `Computer System Phase 0` test world:

```text
/scriptevent computer_system:probe ui
```

Verify:

- The form title is `Computer System Phase 0 Terminal`.
- The terminal reports `Size: 51x19`.
- Rows through `19:` are present and remain readable.
- The fixed-width rows do not wrap or clip in a way that prevents terminal use.
- `Observable updates` changes while the form remains open.
- Text typed into `Command` appears in the live `Input:` status.
- Submitting `hello computer` briefly produces `> hello computer` and clears the
  input.
- `Terminate` closes the form and produces a terminal chat result.
- The normal close control also produces a terminal chat result.

Record `PASS` or `FAIL` for size/readability, live updates, input/submit,
terminate, and normal close. Include a short note for any clipping, wrapping,
focus, or controller-navigation problem.

### Result: Windows GDK 1.26.33

- Size/readability: `PASS_WITH_CONSTRAINT` — all rows through `19:` were
  readable, but the input field and action buttons required vertical scrolling
  at 1280x1024.
- Live updates: `PASS_WITH_CONSTRAINT` — the counter advanced and live input was
  reflected, while rapid full-label replacement occasionally exposed a partial
  redraw frame.
- Input/submit: `PASS` — `hello computer` appeared in the live input status and
  Submit cleared the client-writable field. The transient echo was shorter than
  the capture interval and was not independently captured.
- Terminate: `PASS` — the client returned `ServerClosed`; the terminal session
  now reports `result=terminated` with an empty final input.
- Normal close: `PASS` — the client returned `ClientClosed`; the terminal
  session now reports `result=cancelled` with an empty final input.

Disconnect and competing-form outcomes are host-tested because deliberately
disconnecting the player is not required for routine manual verification. An
invalid player maps to `disconnected`, and `UserBusy` maps to `competing_form`;
the first terminal result always owns cleanup.

## Later manual-only checks

The following checks remain manual when their probes are implemented:

- monitor text readability and interaction alignment;
- computer, pocket computer, and turtle visual appearance;
- registered sound audibility, pitch, attenuation, and note timing;
- overall keyboard, mouse, touch, and controller usability.

Logic behind these surfaces still requires automated tests. A manual result must
not substitute for state-transition, persistence, scheduling, or failure-path
coverage.

## Phase 0 speaker checklist

Stand somewhere quiet and run:

```text
/scriptevent computer_system:probe speaker
```

Verify:

- Two short registered notes are audible at the player's position.
- The second note is clearly higher than the first.
- Chat reports two calls and pitches `0.5,2`.

The automated BDS suite proves that both stable API calls are accepted. This
manual check covers only audibility and perceived pitch; it does not replace the
automated result.

## Phase 0 Pocket Computer checklist

Run this command as a player:

```text
/scriptevent computer_system:probe pocket
```

Verify:

- Chat reports that one Pocket Computer was granted with an instance ID.
- The item appears with a clock icon and cannot stack above one.
- Holding and using the item opens `Computer System Phase 0 Terminal`.
- Dropping the item closes ownership cleanly; picking it up and using it opens
  the terminal again.

Automated tests cover identity persistence and lifecycle transitions. This check
covers the real player's item-use interaction and presentation only.

### Result: Windows GDK 1.26.33

- Item grant and presentation: `PASS` — the Pocket Computer was granted and
  appeared as a usable held item.
- Item use: `PASS` — using the held Pocket Computer opened the Computer System
  terminal.
- Drop and pickup reuse: `NOT_RECORDED` — identity preservation through an item
  entity is covered by BDS, but the player interaction was not separately
  recorded in this manual run.

## Phase 0 Monitor checklist

Run this command while facing south with three blocks of clear space ahead:

```text
/scriptevent computer_system:probe monitor
```

Verify:

- A 3x2 black Monitor surface appears three blocks south of the player.
- Touching the near (north) face reports `monitor_touch north x y` in chat.
- Touching near the top-left reports coordinates near `1,1`; touching near the
  bottom-right reports coordinates near `51,18`.
- Each valid touch opens the Computer System terminal UI fallback.

The BDS suite verifies discovery and update bounds. This manual check covers the
real block-face coordinates and player-facing fallback interaction.

### Result: Windows GDK 1.26.33

- Connected surface: `PASS` — the generated 3x2 Monitor surface was available
  for player interaction.
- Touch mapping: `PASS` — separate touches reported `monitor_touch north 45 3`
  and `monitor_touch north 38 3`, proving that the mapped cell changes with the
  interaction position.
- Terminal fallback: `PASS` — a valid Monitor touch opened the Computer System
  terminal UI.
