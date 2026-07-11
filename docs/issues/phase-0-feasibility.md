# Phase 0: Prove Bedrock feasibility gates

Parent: #1

## Goal

Build minimal, disposable Bedrock prototypes for the parts whose feasibility or
compatibility cannot be established from documentation alone. Record evidence
before production architecture depends on an unsupported behavior.

## Questions to answer

### Runtime and packaging

- [x] Pin a current stable Bedrock version, pack format, and Script API module
      versions.
- [ ] Prove that a bundled TypeScript runtime loads without experimental
      toggles.
- [ ] Run instruction-budgeted work for 20 simulated computers without watchdog
      termination.
- [ ] Measure bundle size, tick cost, and memory warning signals.

### Terminal input and UI

- [ ] Display a 51x19 terminal model through the supported UI surface.
- [ ] Update output while the terminal remains open.
- [ ] Submit line input and convert it into terminal events.
- [ ] Prove terminate, cancel, disconnect, and competing-form finalization
      paths.
- [ ] Document which raw keyboard and pointer events cannot be represented.

### Monitor

- [ ] Discover a 3x2 connected monitor surface.
- [ ] Render bounded text updates on the world-facing surface or establish the
      best fallback.
- [ ] Convert a player interaction into monitor cell coordinates.
- [ ] Measure update cost at near and far distances.

### Redstone

- [ ] Receive redstone changes and determine six relative-side input levels.
- [ ] Generate and switch six-bit digital output permutations.
- [ ] Demonstrate two different digital output sides simultaneously.
- [ ] Demonstrate the Redstone Interface fallback for independent analog levels.
- [ ] Confirm that unsupported analog combinations fail explicitly.

### Persistent identities and storage

- [ ] Store an ID on a non-stackable computer or floppy ItemStack.
- [ ] Move it between player inventory, container, dropped entity, and placed
      block.
- [ ] Save paged world Dynamic Properties and recover the last complete
      generation.
- [ ] Reload the world and prove stable identity without accidental duplication.

### Pocket computer lifecycle

- [ ] Open a terminal from an item-use interaction.
- [ ] Reconcile held, inventory, container, dropped, disconnected, and
      duplicated states.
- [ ] Prove reconciliation without an every-tick full inventory scan.

### Turtle operations

- [ ] Move a turtle representation by one block without duplication.
- [ ] Reject occupied and unloaded destinations with an observable result.
- [ ] Inspect, break, place, and collect a representative block drop.
- [ ] Transfer an item to an adjacent container.
- [ ] Force an intermediate failure and prove rollback or explicit recovery
      ownership.

### Speaker

- [ ] Play registered sounds with volume and pitch.
- [ ] Play a bounded note sequence without a retry or callback storm.
- [ ] Decide and document whether arbitrary PCM/DFPWM is unsupported or has a
      safe substitute.

## Deliverables

- [ ] A feasibility matrix with `supported`, `supported_with_constraint`, or
      `not_supported` for every question.
- [ ] Minimal prototype packs and reproducible test instructions.
- [ ] Performance observations for a low-end-safe budget baseline.
- [ ] Updated compatibility boundaries in #1 and `docs/roadmap.md`.
- [ ] A concrete go/no-go decision and fallback for every non-green result.

## Acceptance rubric

`Verify:` Install the feasibility pack in a clean Bedrock world and execute each
reproduction listed above, including reload and forced-failure cases.

`Expect:` Every question has observable evidence, every stateful branch reaches
an explicit terminal or waiting state, and no later phase relies on an
unverified Bedrock capability.

## Exit gate

Phase 1 may begin after this issue records enough evidence to freeze the
platform adapters and compatibility boundaries. A failed proof does not block
the project when a tested fallback preserves the intended gameplay.
