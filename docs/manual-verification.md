# Manual verification

Most Computer System behavior is verified by host tests or the headless Bedrock
Dedicated Server harness. Manual testing is reserved for behavior that depends
on a real player's visual, audio, or interaction experience.

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
- Terminate: `PASS` — chat reported `reason=ServerClosed` with an empty final
  input.
- Normal close: `PASS` — chat reported `reason=ClientClosed` with an empty final
  input.

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
