# Issue #113 — Interactive CS-ABI frame latency and bounded atomic CPU slices

GitHub Issue: https://github.com/tsuyoshi-otake/computer-system/issues/113

Status: host-implemented and host-verified. The real-BDS measurement of the
largest atomic `guest_cpu` host operation remains open, and the cross-Computer
host-time share described under "Deferred" is not implemented.

Depends on and refers to #16 (multi-user load evidence), #29 (input admission
and frame scaling), #64 (the frozen reduced NetHack prototype), and #106 (the
opt-in wasm compute-worker engine).

## Why this Issue exists

The reduced NetHack prototype from #64 is the only guest today that exercises
the complete key → simulate → render → present loop, so it was used as the
measurement subject for interactive foreground latency. It is a measurement
subject only: its C sources stay frozen and this Issue changes no guest code.

Measuring it turned up one correctness defect that silently killed a guest
process, one structural mismatch between the scheduler's guest-cycle budget and
`ComputerWorkMonitor`'s host-time caps, and one saturating counter that froze OS
CPU accounting.

## Measured baseline

One Computer, CS486DX standard profile, real `ComputerWorkMonitor`, per-slice
`CpuProcessSliceResult` sampled through the `TickWorkScope` observer. Measured
on host on 2026-07-24 before the fixes below.

| Action                              | Guest instructions | Modeled cycles | Slices |
| ----------------------------------- | ------------------ | -------------- | ------ |
| Unbound key (no render, no present) | 1,849              | 6,851–9,695    | 1      |
| Refused move (wall bump)            | 1,593              | —              | 1      |
| Ordinary accepted move              | 85,589 p95         | ~283,000       | 1      |
| Full-frame repaint                  | 599,742            | 1,187,623      | 2      |
| Level generation and first frame    | 2,301,051          | 4,310,986      | 5      |

Modeled instructions and cycles are authoritative guest cost. Host microseconds
below are one workstation's measurement of host admission, not guest timing.

- The largest observed slice was exactly **1,650,000** modeled cycles, which is
  `cpuCyclesPerTick` (33 MHz / 20 TPS). The per-tick budget binds, so before
  this Issue the budget was the only pre-execution knob.
- `guest_cpu` lane: 231 admitted slices, **20 overruns**, largest single atomic
  host operation **77,156 µs** against a documented
  `maximumAtomicHostMicroseconds` of **2,000**.
- Modeled CPI 2.1–3.8.
- `terminal` lane steady state 71–350 µs per present. A process's first two
  frames cost 39–42 ms of host time, which is host warm-up rather than a
  steady-state cost.

## Implemented boundary

### D1 — one wakeup owner for `terminal_keys`

`terminal_keys` was tracked twice: the key codes entered the `CsAbiRuntime` FIFO
and a scheduler event was queued to wake a process parked in `cs_key_wait()`.
`BoundedEventQueue.enqueue` does not coalesce by name, so two batches arriving
in one tick while the process was `waiting_event` queued two events while the
guest drained the whole FIFO from the first one. The surplus event resumed the
wait with an empty FIFO, and the resume wrote a fabricated `-EAGAIN` out of a
blocking syscall specified to return a key code, which ended the process.

- `BoundedEventQueue` now answers `hasQueued(name)` and releases a name from
  both `take` paths, so the queue itself is the authority for a pending wakeup.
- `ComputerRuntime` consults it before queueing another wakeup for the same
  name, so one pending wakeup exists at a time.
- `cs_key_wait`'s resume writes the no-key value `0` instead of an errno, so a
  surplus wakeup can never hand a blocking syscall an error code.
- `enqueueKeyBatch` rejects a NUL key code, so `0` stays unambiguously "no key".

### D2a — bounded atomic CPU sub-slices

`ComputerWorkMonitor` requires its callers to submit an already bounded atomic
operation, but `RoundRobinScheduler.runTick` submitted the entire per-tick cycle
budget as one unpreemptable `tryRun`. `tryRun` admits before running and can
only count an overrun afterwards, so `maximumAtomicHostMicroseconds` could not
bound an interactive CPU slice at all. Lowering `cpuCyclesPerTick` is not an
option: it is the guest's modeled clock rate, and changing it would rewrite
guest timing.

`SchedulerLimits.maximumAtomicCpuCycles` (default **330,000**, one fifth of the
per-tick budget) now bounds one host operation. A dispatch is divided into
`ceil(budget / atomicBudget)` sub-slices, each submitted as its own `tryRun`, so
admission can act between them. A process that dispatches its work
asynchronously (`dispatchesWorkAsynchronously`, which the #106 remote CS486
process sets) still receives its whole dispatch in one operation, because its
host operation is a message send rather than the guest execution itself.

Sub-slicing is exactly equivalent to one undivided slice. `Cs486Process` pays
`Math.min(cycles, cpuCycleBudget - cpuCycles)` per instruction and carries the
remainder in `cycleDebt`, which the next slice pays down first, so N sub-slices
summing to B execute the same instruction sequence with the same totals as one
slice of B. What changes is only how much guest work one host operation carries.

### D3 — cumulative CPU accounting no longer saturates

`foreground.cpuCycles` was assigned `Math.min(1_000_000, …)` over a
**cumulative** counter, and `accountLiveOsProcess` derives its per-tick delta
from that counter. Once a guest process passed 1,000,000 cumulative modeled
cycles its CPU time stopped advancing in OS process state; the 4,310,986-cycle
launch above reported 1,000,000. `accountLiveOsProcess` now receives the
uncapped modeled total, while the separately bounded reported field keeps its
existing cap.

## Rejected alternative — a presentation host-budget reserve

A reserve was implemented in `ComputerRuntime.runTick`'s observer that withheld
`2 × maximumAtomicHostMicroseconds` of the tick's soft host budget so a long
guest operation could not starve the present of the frame it was computing, plus
two `TickWorkScope` accessors to expose the remaining budget.

It was measured A/B under a synthetic stepping host clock and made the reported
symptom worse: the heaviest move took **14 ticks** with the reserve
(`softLimitDeferrals` 0, terminal lane never deferred) against **5 ticks**
without it (`softLimitDeferrals` 5, terminal deferred once). The frame cannot
exist before the guest computes it, so withholding CPU budget to protect
presentation budget delays the very frame it protects.

The reserve and both accessors were removed. `computerRuntime.ts` records the
rejection at the call site so it is not reintroduced.

## Measurement method note

A per-call stepping host clock is not a valid model for admission latency.
`TickWorkScope.tryRun` reads the clock four times per operation, so a clock that
advances a fixed step per read charges host time per _operation_ rather than per
unit of work, and dividing one dispatch into five sub-slices multiplies its
synthetic host cost fivefold with no production counterpart. Latency
non-regression evidence therefore uses clock-free modeled tick counts.

## Verification evidence

Verify on 2026-07-25: `npm test -- tests/runtime/scheduler.test.ts`.

Expect: a dispatch divides into bounded atomic sub-slices; an asynchronous
executor receives its whole dispatch in one operation; divided and undivided
dispatches produce identical `cpuCycles`, `executedInstructions`,
`admittedCpuCycles`, pending-cycle state, and process state, both for a
non-terminating loop and for a program that completes; division stops when the
process stops for its own reason or a sub-slice is refused; a non-positive
atomic bound is rejected; and a queued event name is reported until consumed and
not after a resuming filter discards it.

Result: PASS, 24 tests.

Verify on 2026-07-25: `npm test -- tests/runtime/csAbi.test.ts`.

Expect: a surplus key wait resumes with the no-key value `0` rather than an
errno, a following key poll still reports no key, and a NUL key code is rejected
without leaving a partial batch behind.

Result: PASS, 21 tests.

Verify on 2026-07-25:
`npm test -- tests/computer/interactiveFrameLatency.test.ts`.

Expect: the modeled tick count to each presented frame is identical with the
default divided dispatch and with an atomic bound equal to the whole per-tick
budget; the first frame after launch arrives within 4 modeled ticks; and every
ordinary interactive key produces a new frame within 3 modeled ticks.

Result: PASS, 2 tests. Launch to first frame 4 ticks; each measured key 1–3
ticks; byte-identical divided and undivided.

Verify on 2026-07-25: `npm run validate`.

Expect: formatting, ESLint, TypeScript, all Vitest tests, the production Bedrock
pack build, and the 16-chapter Pages build pass.

Result: PASS. 311 test files / 2,591 tests, the 12 hosted-C payload checks, the
current guest NetHack executable check, the production Bedrock pack, and all 16
Pages chapters.

## Real-BDS measurement, 2026-07-25

Environment: real BDS, isolated acceptance world on its own dedicated work
directory, `typescript` CPU engine (`cpuEngine` null, no wasm engine and no
compute workers), one Computer running an interactive CS-ABI foreground driven
by a real browser Web Terminal session. The acceptance fixture Computer reports
`cs486dx2 66000000 Hz; memory 8388608 bytes` in its own boot journal, so its
per-tick budget is 3,300,000 modeled cycles and a dispatch divides into ten
330,000-cycle sub-slices, not the five of the 33 MHz baseline above. Two
`bds_status` samples 3,260 ticks apart, 9,320 completed ticks in total, 0
diagnostics across 3,536 captured log lines.

Verify: run an interactive CS-ABI foreground on real BDS through a Web Terminal
session, then read the `guest_cpu` lane of `bds_status`.

Expect: an observed largest atomic `guest_cpu` host operation, comparable
against the 77,156 µs measured on the workstation before this change and against
the documented 2,000 µs `maximumAtomicHostMicroseconds`.

Result:

| Measurement                                | Value                     |
| ------------------------------------------ | ------------------------- |
| Largest atomic `guest_cpu` host operation  | 1,428,000 µs              |
| `guest_cpu` admitted / deferred / overruns | 681 / 193 / 659           |
| Largest atomic `terminal` host operation   | 735,000 µs                |
| `terminal` admitted / deferred / overruns  | 288 / 252 / 271           |
| Tick host µs p50 / p95 / p99               | 125 / 24,000 / 24,001     |
| Emergency / soft limit deferrals           | 896 / 66 over 9,320 ticks |

Both maxima are warm-up atoms rather than steady state. No new maximum appeared
during the 3,260-tick (163 s) interval between the two samples, and in that
interval the `guest_cpu` lane spent 3.005 s of host time across 57 admitted
operations while the `terminal` lane spent 133 ms across 38 presents.

**What this resolves.** The largest atomic `guest_cpu` host operation on real
BDS is now measured. Sub-slicing did divide the dispatch: every operation is at
most `maximumAtomicCpuCycles` (330,000) modeled cycles instead of this
Computer's whole 3,300,000-cycle tick budget, and no diagnostic, refusal, or
lost process accompanied it.

**What it does not resolve, and why.** The atomic bound is denominated in guest
cycles, so it does not bound host microseconds. Real BDS pays far more host time
per modeled cycle than the workstation the 77,156 µs figure came from, and the
documented 2,000 µs `maximumAtomicHostMicroseconds` for `guest_cpu` was exceeded
by roughly 714× at the largest atom, with 659 of 681 admitted operations
overrunning. A cycle-denominated atomic bound therefore cannot enforce that
lane's documented host-time cap on real hardware. Closing that gap is a separate
decision — either a host-time-aware sub-slice that measures the previous
sub-slice and shrinks the next one, or a restatement of the lane's documented
cap to what a cycle bound can deliver. Neither is implemented, and neither is
claimed here.

**D1 on real BDS.** The same session accepted continuous key batches from the
browser client; `event_delivery` admitted 14,019 units across 9,320 ticks, more
than one event per tick, so batches did arrive together within single ticks. The
CS-ABI process remained the foreground throughout, past 236 guest turns, and the
session reported no terminated process. Before D1 two batches arriving in one
tick ended the process. This is a real-BDS signal for D1, not a replacement for
its host test.

## Open verification

- **A host-time bound for the `guest_cpu` lane.** The measurement above shows
  the cycle-denominated atomic bound does not keep a real-BDS `guest_cpu`
  operation inside the lane's documented 2,000 µs. Deciding between a
  host-time-aware sub-slice and a restated cap remains open.
- **#106 real-BDS p95 tick comparison** between the `wasm-rust` and `typescript`
  engines remains open. The wasm engine stays opt-in and `typescript` stays the
  default.
- **#16 multi-user load evidence** remains open. Sequential host success is not
  multi-user capacity evidence.

## Deferred

- **A per-Computer host-time share.** Bounding one Computer's atomic operation
  does not by itself guarantee that a second Computer with ready work is
  admitted in the same tick; that needs an explicit fairness parameter and the
  #16 multi-user evidence to justify its value. Not implemented.

## Explicit exclusions

- **Guest algorithmic work stays frozen under #64.** The two O(cells) paths, the
  per-turn full-width status rewrite, the present-retry path that escalates to a
  full repaint, and the help screen consuming a key whose present was deferred
  are all guest C sources. They require explicit reauthorization of game
  implementation and are untouched here.
- **The #106 wasm engine and compute workers do not apply.** An interactive
  CS-ABI foreground is pinned to the Bedrock VM and is one serial chain, so its
  parallel speedup is 1.00×. The real-BDS measurement above does not change
  that: it says the binding constraint is host throughput per modeled cycle, not
  parallelism. Whether an interactive foreground could be relocated to a faster
  host while keeping its terminal round trip inside one tick is an unanswered
  design question, not a result, and it is not in scope here.
- **`>` producing no frame is not a defect.** During measurement the descend key
  produced no terminal change, identically before and after this change.
  Descending is guarded by the player standing on the down staircase, so the
  branch correctly did not fire and no frame changed; the measurement harness
  simply polled to its own limit.
