# Issue #16: CS486 hot-burst execution

GitHub Issue:
[Prevent guest execution from stalling BDS ticks under multi-user load](https://github.com/tsuyoshi-otake/computer-system/issues/16)

Status on 2026-07-24: implemented and host-verified in the working tree. The
broader Issue remains open for real-BDS multi-Computer capacity evidence.

## Implemented boundary

The production `runCpuSlice` path now admits decoded register, integer ALU,
compare, conditional-branch, and direct-jump instructions to one bounded hot
loop. Each original instruction still performs its modeled instruction fetch,
branch accounting, cycle charge, instruction-count charge, and cycle-debt
transition.

Admission is prepared once per immutable executable in eight fixed O(N) passes.
An entry is eligible only when every possible conditional-branch outcome is
guaranteed to remain in the hot subset for at least eight instructions.
Executables with no eligible entry select the unchanged per-instruction loop
once per process; short mixed CPU/memory/stack/syscall sequences therefore do
not pay a speculative burst call for every instruction.

Memory, stack, call/return, multiply/divide, syscall, output, halt, executable
boundary, and fault-capable instructions remain owned by the existing
`executeNext` path. The hot-burst implementation itself does not raise a guest
clock, rewrite modeled guest time from host elapsed time, change admission
limits, or move one Computer across workers while it is running.

## Half-realtime production admission follow-up

The shipped Behavior Pack now selects `guestRealtimeDivisor: 2`, giving each
model at most one half of its persisted nominal clock: 400,000 cycles/tick for
CS386SX, 825,000 for CS486DX, and 1,650,000 for CS486DX2 at 20 TPS. The
per-runtime and per-execution-resource instruction ceilings are both 1,650,000,
which covers the CS486DX2 worst case of one modeled cycle per instruction
without allowing one worker resource to exceed 33 MHz of aggregate modeled CPU
work. Scheduler dispatch further caps each asynchronous instruction reservation
at its offered cycle credit, so lower-clock Computers do not consume an entire
worker lane before execution settles. Worker count scales independent resource
capacity. Each resource now owns an independent round-robin cursor, so an uneven
Computer-to-worker distribution cannot bias long-term service toward the first
Computer IDs assigned to a saturated worker.

## Acceptance evidence

### Half-realtime limits and resource fairness

`Verify:`

```powershell
npm test -- tests/runtime/scheduler.test.ts tests/runtime/schedulerPause.test.ts tests/runtime/workMonitorScale.test.ts tests/bedrock/behaviorPackConfig.test.mjs tests/computer/hardwareProfiles.test.ts tests/computer/runtimeWorkerAssignment.test.ts tests/tools/cs486ComputeWorkerPool.test.mjs tests/tools/cs486ComputeServer.test.mjs tests/tools/cs486ConcurrencyBenchmark.test.mjs tests/tools/webManual.test.mjs
```

`Expect:` the shipped divisor is exactly 2; all three hardware profiles derive
their exact half-rate cycle credits; per-runtime, per-resource, and worker
instruction ceilings are 1,650,000; four asynchronous 400,000-cycle reservations
fit on one resource without over-reserving instructions; and a saturated
three-to-one resource distribution gives every Computer on the crowded resource
equal service over a complete rotation.

Observed on 2026-07-24: 10 files and 76 tests passed.

### Half-rate host load margin

`Verify:`

```powershell
npm run benchmark:cs486 -- --instructions 1650000 --samples 7 --mode cpu-slice --instrumentation disabled
npm run benchmark:cs486 -- --instructions 1650000 --samples 7 --mode cpu-slice --instrumentation enabled
npm run benchmark:cs486:concurrency
```

`Expect:` each direct slice retains identical guest evidence in both
instrumentation modes and completes the maximum 1,650,000-instruction production
admission within one 50 ms tick on the measured host. The concurrency run
retains all 42 compared executions while two workers each process five
330,000-instruction shares without oversubscribing their 1,650,000-instruction
resource ceiling.

Observed on Node.js 26.2.0:

| CPU model | Statistics | Median slice | P95 slice | Throughput |
| --------- | ---------- | -----------: | --------: | ---------: |
| CS386SX   | disabled   |     13.36 ms |  15.65 ms |  123.5 M/s |
| CS486DX   | disabled   |     15.82 ms |  22.72 ms |  104.3 M/s |
| CS486DX2  | disabled   |     15.99 ms |  17.84 ms |  103.2 M/s |
| CS386SX   | enabled    |     16.24 ms |  17.96 ms |  101.6 M/s |
| CS486DX   | enabled    |     16.73 ms |  22.87 ms |   98.6 M/s |
| CS486DX2  | enabled    |     18.27 ms |  38.56 ms |   90.3 M/s |

The shipped configuration disables microarchitecture statistics by default. In
the two-worker benchmark, 10 Computers completed 3,300,000 aggregate
instructions per modeled tick with identical evidence across worker counts. It
measured 1.9854x end-to-end speedup, 99.27% worker efficiency, a 10.67 ms median
and 10.98 ms p95 batch-average per tick, and a 40.0 MiB RSS increase while both
benchmark pools were alive. These are short host-only capacity measurements;
they do not include BDS, loopback transport, disk, terminal, or other add-on
work.

### Deterministic semantics and terminal ownership

`Verify:`

```powershell
npx vitest run tests/runtime/cs486HotBurst.test.ts tests/runtime/cs486CpuSlice.test.ts tests/runtime/cs486BranchFastPath.test.ts tests/runtime/cs486NumericPredecode.test.ts tests/runtime/memoryHierarchy.test.ts
```

`Expect:` all three CPU models produce the same cycles, registers, instruction
address, RAM, output, process state, cache/bus counters, and pipeline-flush
counters as the per-instruction reference. Cycle debt prevents the next
instruction from starting. Reaching the executable boundary completes through
the existing finalization owner, and a cold divide-by-zero instruction crashes
exactly once through the existing fault owner.

Observed on 2026-07-24: 223 tests passed.

### Runtime regression gate

`Verify:`

```powershell
npm test -- tests/runtime
```

`Expect:` the complete runtime/CPU/toolchain suite passes without changing
modeled guest timing.

Observed on 2026-07-24: 94 files and 966 tests passed.

### Host implementation throughput

`Verify:`

```powershell
npm run benchmark:cs486 -- --instructions 2000000 --samples 7 --mode cpu-slice --instrumentation disabled
npm run benchmark:cs486 -- --instructions 2000000 --samples 7 --mode cpu-slice --instrumentation enabled
```

`Expect:` every sample in each mode has identical guest cycles, registers, RAM
digest, instruction pointer, pending-cycle state, and process state. The enabled
run additionally retains exact cache/bus/pipeline counters. Host instructions
per second is responsiveness evidence only.

Observed on Node.js 26.2.0:

| CPU model |    Statistics disabled |     Statistics enabled |
| --------- | ---------------------: | ---------------------: |
| CS386SX   | 125.9 M instructions/s | 117.2 M instructions/s |
| CS486DX   | 102.2 M instructions/s |  97.4 M instructions/s |
| CS486DX2  | 107.3 M instructions/s |  96.5 M instructions/s |

An alternating 2,000,000-instruction A/B check against the same source with
hot-burst admission forced off measured the branch/ALU corpus at 1.34x to 1.50x.
A mixed memory/stack corpus had no eligible hot-burst entry and remained on the
per-instruction process path; repeated alternating medians varied by about three
percent in both directions, so no mixed-workload speedup is claimed.

### Complete host gate

`Verify:`

```powershell
npm run validate
```

`Expect:` formatting, ESLint, TypeScript, all Vitest tests, the production
Bedrock pack build, and the 16-chapter Pages build pass.

Observed on 2026-07-24: 303 test files and 2,499 tests passed; hosted-C and
guest-NetHack generated payloads were current; the vendor UI, production packs,
and 16-chapter Pages site built successfully.

## Residual evidence

The live BDS/Web companion was intentionally not restarted during this CPU
change. Multi-Computer tick percentiles, response latency, capacity-plus-one
rejection, and in-game interaction responsiveness remain part of the open Issue
#16 load evidence and are not inferred from this sequential host benchmark.
