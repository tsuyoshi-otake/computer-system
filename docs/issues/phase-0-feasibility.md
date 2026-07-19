# Phase 0: Prove Bedrock feasibility gates

Parent: #1

> Historical note: the connected-display probe below proved Script API touch
> feasibility. The production Desktop/Advanced hardware was later redesigned as
> a one-block all-in-one with a built-in CRT; the standalone probe is retired.

## Goal

Build minimal, disposable Bedrock prototypes for the parts whose feasibility or
compatibility cannot be established from documentation alone. Record evidence
before production architecture depends on an unsupported behavior.

## Questions to answer

### Runtime and packaging

- [x] Pin a current stable Bedrock version, pack format, and Script API module
      versions.
- [x] Prove that a bundled TypeScript runtime loads without experimental
      toggles.
- [x] Run instruction-budgeted work for 20 simulated computers without watchdog
      termination.
- [x] Measure bundle size, tick cost, and memory warning signals.

### Terminal input and UI

- [x] Display a 51x19 terminal model through the supported UI surface.
- [x] Update output while the terminal remains open.
- [x] Submit line input and convert it into terminal events.
- [x] Prove terminate, cancel, disconnect, and competing-form finalization
      paths.
- [x] Document which raw keyboard and pointer events cannot be represented.

### Monitor

- [x] Discover a 3x2 connected monitor surface.
- [x] Render bounded text updates on the world-facing surface or establish the
      best fallback.
- [x] Convert a player interaction into monitor cell coordinates.
- [x] Measure update cost at near and far distances.

### Redstone

- [x] Receive redstone changes and determine six relative-side input levels.
- [x] Generate and switch six-bit digital output permutations.
- [x] Demonstrate two different digital output sides simultaneously.
- [x] Demonstrate the Redstone Interface fallback for independent analog levels.
- [x] Confirm that unsupported analog combinations fail explicitly.

### Persistent identities and storage

- [x] Store an ID on a non-stackable computer or floppy ItemStack.
- [x] Move it between player inventory, container, dropped entity, and placed
      block.
- [x] Save paged world Dynamic Properties and recover the last complete
      generation.
- [x] Reload the world and prove stable identity without accidental duplication.

### Portable computer lifecycle

- [x] Open a terminal from an item-use interaction.
- [x] Reconcile held, inventory, container, dropped, disconnected, and
      duplicated states.
- [x] Prove reconciliation without an every-tick full inventory scan.

### Turtle operations

- [x] Move a turtle representation by one block without duplication.
- [x] Reject occupied and unloaded destinations with an observable result.
- [x] Inspect, break, place, and collect a representative block drop.
- [x] Transfer an item to an adjacent container.
- [x] Force an intermediate failure and prove rollback or explicit recovery
      ownership.

### Speaker

- [x] Play registered sounds with volume and pitch.
- [x] Play a bounded note sequence without a retry or callback storm.
- [x] Decide and document whether arbitrary PCM/DFPWM is unsupported or has a
      safe substitute.

## Deliverables

- [x] A feasibility matrix with `supported`, `supported_with_constraint`, or
      `not_supported` for every question.
- [x] Minimal prototype packs and reproducible test instructions.
- [x] Performance observations for a low-end-safe budget baseline.
- [x] Updated compatibility boundaries in #1 and `docs/roadmap.md`.
- [x] A concrete go/no-go decision and fallback for every non-green result.

## Evidence checkpoint

- The GDK client recognized and activated both packs from the current shared
  creator-content directory.
- The stable Script API bundle loaded without Beta API experiments.
- A tester completed the in-game runtime command through the 20-computer probe.
- Host tests cover fair scheduling, transactional paged storage recovery,
  terminal finalization, redstone output constraints, monitor bounds, portable
  lifecycle, and the machine-readable probe protocol.
- `npm run test:bds` passed on Bedrock Dedicated Server 1.26.33.2. Both runtime
  sessions produced `min=2000` and `max=2000` across 20 computers and 40 ticks.
- World Dynamic Property persistence passed a full restart: the sequence
  advanced from 1 to 2.
- The final Phase 0 bundle was 48,776 bytes. Both BDS sessions measured the
  20-computer scheduler below the 1 ms clock resolution for every tick, stayed
  within the 50 ms tick budget, and emitted zero memory warning signals.
- Item identity survived container, dropped-entity, placed-block, and
  block-to-item round trips. Turtle inspection, break, placement, drop recovery,
  inventory transfer, conflict, unloaded, and rollback paths passed.
- Visual, audio, and interaction-only checks are isolated in
  `docs/manual-verification.md`; automation does not control the Minecraft
  client.

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

## Go decision

**GO for Phase 1.** Every Phase 0 capability has reproducible evidence and each
non-green result has a production fallback. The DDUI form remains a disposable
probe: the ComputerCraft-inspired cell-buffer view, real multiplayer turtle
contention, low-end soak testing, and visible production blocks belong to their
later implementation phases rather than this feasibility gate.
