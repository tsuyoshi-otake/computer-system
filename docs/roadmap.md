# Implement Computer System for Minecraft Bedrock Edition

## Objective

Build a ComputerCraft-inspired Minecraft Bedrock Add-On named **Computer
System**. User programs use a sandboxed MicroPython-compatible language, while
device behavior, APIs, terminal semantics, filesystems, events, networking,
peripherals, pocket computers, and turtles remain as close to ComputerCraft as
Bedrock permits.

## Product decisions

- Product name: Computer System
- Add-On namespace: `computer_system`
- Operating system: Computer System OS
- User language: Computer System Python
- Repository visibility: private
- Runtime: Behavior Pack, Resource Pack, and TypeScript Script API
- Compatibility target: user-visible ComputerCraft behavior rather than its
  Java/Lua implementation details
- API style: Python `snake_case`, with ComputerCraft-style `camelCase` aliases
  where useful for porting programs

## Architecture

Keep the core independent from Minecraft APIs so it can be tested on the host:

```text
Minecraft adapters
        |
Application services
        |
Computer / VM / filesystem / terminal / peripheral domains
```

Major components:

- computer registry and lifecycle manager
- Python lexer and parser with a shared CS486 compiler/runtime backend
- fair instruction-budgeted scheduler
- bounded event and timer queues
- terminal cell buffer and Bedrock terminal view
- transactional virtual filesystem
- paged Dynamic Properties persistence
- peripheral bus
- wired and wireless network services
- turtle movement and inventory transaction services

## Supported item scope

### Computers

- [ ] Computer
- [ ] Advanced Computer
- [ ] Command Computer

### Peripherals and media

- [ ] Disk Drive
- [ ] Floppy Disk
- [ ] Wireless Modem
- [ ] Ender Modem
- [ ] Wired Modem
- [ ] Networking Cable
- [ ] Monitor
- [ ] Advanced Monitor
- [ ] Speaker
- [ ] Printer
- [ ] Printed Page
- [ ] Printed Pages
- [ ] Printed Book

### Pocket computers

- [ ] Pocket Computer
- [ ] Advanced Pocket Computer
- [ ] Wireless Pocket Computer
- [ ] Ender Pocket Computer
- [ ] Noisy Pocket Computer

### Turtles

- [ ] Turtle
- [ ] Advanced Turtle

### Turtle upgrades

- [ ] Mining Turtle
- [ ] Melee Turtle
- [ ] Digging Turtle
- [ ] Felling Turtle
- [ ] Farming Turtle
- [ ] Wireless Turtle
- [ ] Ender Turtle
- [ ] Noisy Turtle
- [ ] Crafty Turtle

### Hidden content

- [ ] Treasure Disk
- [ ] Secret program disks
- [ ] Developer Computer
- [ ] Debug Turtle
- [ ] Unknown Peripheral

## Language scope

Initial Computer System Python support:

- literals: integers, floats, strings, booleans, and `None`
- collections: lists, tuples, and dictionaries
- arithmetic, comparison, boolean, attribute, and subscript expressions
- assignments
- `if`, `elif`, and `else`
- `while` and `for`
- `break` and `continue`
- functions and returns
- positional and keyword arguments
- `try`, `except`, `finally`, and `raise`
- imports from an explicit module allowlist
- basic formatted strings

Initially excluded:

- classes and decorators
- generators
- `async` and `await`
- native extensions and arbitrary packages
- `eval` and `exec`
- direct access to the host JavaScript runtime

## ComputerCraft-style APIs

Initial modules:

- `os`
- `term`
- `fs`
- `shell`
- `redstone`
- `peripheral`
- `rednet`
- `settings`
- `textutils`
- `colors` and `colours`
- `disk`
- `gps`
- `turtle`

Lua values map to Python as follows:

- `nil` becomes `None`
- array-like tables become lists
- map-like tables become dictionaries
- multiple return values become tuples
- coroutine suspension becomes an explicit VM wait state
- unhandled Lua-style errors become Python exceptions and a crashed computer

## Stateful control flow

Computer states:

```text
off -> booting -> running
                   |-> sleeping -> running
                   |-> waiting_event -> running
                   |-> stopping -> off
                   |-> rebooting -> booting
                   |-> crashed
missing block -> orphaned -> restored or administratively removed
```

Every lifecycle, VM, peripheral, storage, and turtle branch must terminate in an
observable success, wait, retry, stopped, or failed state. No caught or
suppressed error may leave a device accidentally marked as running.

## Load and safety constraints

- round-robin execution across runnable computers
- per-computer and global instruction budgets
- bounded call depth, collections, strings, events, and timers
- no immediate retry loops
- deduplicated in-flight storage and network work
- topology recomputation only for changed wired-network components
- no every-tick full inventory scan for pocket computers
- no implicit chunk loading for turtles
- command computers are administrator-only and command-audited
- unsupported Bedrock behavior fails explicitly instead of silently producing an
  incorrect approximation

## Known compatibility boundaries

- Bedrock UI cannot expose every raw keyboard and mouse event exactly like a
  Java ComputerCraft terminal. The production terminal must use an explicit cell
  buffer and map cancel, disconnect, competing-form, and failure outcomes into
  VM-visible results.
- Stable APIs do not expose arbitrary world-facing text rendering. Monitors use
  a bounded world frame and touch mapping plus the terminal UI fallback.
- Speakers can play registered sounds and pitched notes, but arbitrary DFPWM or
  PCM streaming is not part of the initial release.
- A computer block cannot expose six independent analog output strengths with
  the available block-level redstone producer. Digital outputs remain per-side;
  independent analog output uses Redstone Interface peripherals.
- Turtles cannot move into unloaded chunks and do not force-load them initially.

## Milestones

### Tracking issues

- [Phase 0: Prove Bedrock feasibility gates](https://github.com/tsuyoshi-otake/computer-system/issues/2)
- [Phase 1: Build the host-side Computer System runtime](https://github.com/tsuyoshi-otake/computer-system/issues/3)
- [Phase 2: Deliver the Bedrock Computer vertical slice](https://github.com/tsuyoshi-otake/computer-system/issues/4)
- [Phase 3: Implement redstone and local peripherals](https://github.com/tsuyoshi-otake/computer-system/issues/5)
- [Phase 4: Implement networking and pocket computers](https://github.com/tsuyoshi-otake/computer-system/issues/6)
- [Phase 5: Implement turtles and upgrades](https://github.com/tsuyoshi-otake/computer-system/issues/7)
- [Phase 6: Add command computers, hidden content, and release hardening](https://github.com/tsuyoshi-otake/computer-system/issues/8)

### M1: Repository and host-side runtime

- [x] TypeScript package, lint, formatting, type-checking, and Vitest setup
- [x] domain boundaries and Minecraft adapter interfaces
- [x] Python lexer and parser
- [x] bytecode compiler and deterministic VM
- [x] fair scheduler, events, timers, terminal buffer, and in-memory filesystem
- [x] initial `os`, `term`, and `fs` modules

### M2: Bedrock Computer vertical slice

- [x] Behavior Pack and Resource Pack
- [x] Computer and Advanced Computer blocks
- [x] stable computer IDs and block/item identity transfer
- [x] Computer System OS shell and editor
- [x] Bedrock terminal UI
  - dedicated ComputerCraft-inspired 51x19 cell presentation rather than the
    Phase 0 DDUI probe
  - fixed cells, monospace glyphs, cursor state, 16-color palette, and primary
    input controls without scrolling at the reference resolution
  - coalesced bounded redraws and explicit close/disconnect/competing-form
    finalization
  - native GDK CustomForm remains a bounded fallback; the Web Terminal provides
    the full-width keyboard-first interface and one-writer multi-session control
- [x] paged and transactional filesystem persistence
- [x] `startup.py`, shutdown, reboot, and crash reporting

### M3: Redstone and local peripherals

- [ ] six-sided redstone input and digital output
- [ ] Peripheral Bus
- [ ] Redstone Interface
- [ ] Disk Drive and Floppy Disk
- [ ] Monitor and Advanced Monitor
- [ ] Speaker
- [ ] Printer and printed media

### M4: Networking and pocket computers

- [ ] Wired Modem and Networking Cable topology
- [ ] Wireless and Ender Modems
- [ ] `rednet` send, broadcast, receive, host, and lookup
- [ ] Pocket Computer variants and lifecycle reconciliation

### M5: Turtles

- [ ] one-block transactional movement and turning
- [ ] inspection, digging, placing, and attacking
- [ ] 16-slot inventory and container transfers
- [ ] fuel
- [ ] left and right upgrade slots
- [ ] all listed turtle upgrade combinations
- [ ] movement and inventory conflict tests

### M6: Commands, hidden content, and release hardening

- [ ] administrator-gated Command Computer
- [ ] hidden content and acquisition rules
- [ ] multiplayer load tests
- [ ] migration and corrupted-storage recovery tests
- [ ] documentation and distributable Add-On package

## Acceptance rubric

### Runtime safety

`Verify:` Run an infinite-loop program for 10 minutes alongside terminating and
event-waiting programs.

`Expect:` Minecraft remains responsive, other computers make progress, and the
infinite program can be terminated.

### Scheduler fairness

`Verify:` Run CPU-bound programs on 20 computers and record executed
instructions per computer over 1,200 ticks.

`Expect:` Every runnable computer receives slices and none is starved.

### Lifecycle finalization

`Verify:` Exercise successful boot, syntax error, runtime error, sleep, event
wait, shutdown, reboot, missing block, and persistence failure branches.

`Expect:` Every branch reaches an observable state with one owner responsible
for further progress or cleanup.

### Filesystem durability

`Verify:` Save files, interrupt a staged generation write, reload the world, and
remount floppy disks.

`Expect:` The latest complete generation loads, partial data is ignored, and
computer and disk identities remain stable.

### Computer vertical slice

`Verify:` Run a `startup.py` program which displays the computer ID and mirrors
the left redstone input to the right digital output.

`Expect:` The program starts after boot and world reload, handles redstone
events, updates the terminal, and changes the output.

### Networking

`Verify:` Test direct, broadcast, protocol-filtered, timed-out, wired, wireless,
Ender, and cross-dimension messages.

`Expect:` Messages reach exactly the eligible computers with no duplicates and
timeouts return control to the caller.

### Turtle transactions

`Verify:` Make two turtles target the same block while one digs or transfers
items, including a forced intermediate failure.

`Expect:` At most one operation commits and no block, item, fuel, or turtle ID
is duplicated or lost.

### Build quality

`Verify:` Run formatting checks, lint, TypeScript checking, unit tests,
compatibility tests, pack validation, and the production build.

`Expect:` Every command exits successfully and produces installable Behavior
Pack and Resource Pack artifacts.

## Initial deliverable

The first playable deliverable is the Computer vertical slice:

```python
import os
import redstone
import term

term.clear()
term.set_cursor_pos(1, 1)
print("Computer System OS")
print("Computer ID:", os.get_computer_id())

while True:
    redstone.set_output("right", redstone.get_input("left"))
    os.pull_event("redstone")
```

It is complete only when it runs in a Bedrock world, survives reload through
`startup.py`, remains interruptible, and passes the rubric above.
