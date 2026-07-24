# Computer WorkMonitor design

Issue #16 tracks this work. `ComputerWorkMonitor` is the BDS-thread admission
and observability boundary for Computer System work. It measures host time, but
guest CPU cycles and device wire clocks remain independent deterministic model
inputs. Host timing never changes a guest program's modeled result.

For managed BDS, this boundary still admits and finalizes work on the Bedrock
thread, while eligible isolated CS instruction slices execute on the
Computer-affine runtime worker. CS386SX and CS486 profiles share that placement
policy; worker count changes aggregate host concurrency, not guest timing.

## Production contract

Each host tick opens exactly one `TickWorkScope`. A caller submits an already
bounded atom with a lane, deterministic unit count, and optional Computer ID.
Admission checks the lane ceiling and then the tick soft and emergency guards. A
deferral does not run the atom, returns a retry tick, and leaves finalization
with the caller. Exceptions are measured once and rethrown. Every host branch
finishes the scope.

The fixed lanes are control, event delivery, guest CPU, guest compilation, MCP
debug execution, RS-232C, I2C, SPI, redstone input/output, topology, terminal,
block I/O, and persistence. Cumulative metrics contain admitted/deferred/failed
counts, deterministic units, host microseconds, maximum atom time, and overruns.
The fixed tick histogram derives conservative p50, p95, and p99 upper bounds.
There are no per-user or per-Computer metric maps, so monitor storage stays
O(1).

Bedrock callbacks which are intrinsically bounded by a fixed face count use the
external observation boundary. It rejects an atom larger than the lane limit and
measures redstone and topology work without changing device state or guest
timing.

## Bounded execution paths

- The shared scheduler inspects at most 64 processes per tick by default. Event
  preparation, CPU slices, and returned views use only that rotating window;
  none enumerates the full scheduled population. Cycle and machine-instruction
  budgets remain separate.
- An OS job stopped by SIGSTOP remains registered but is removed from CPU
  service in O(1); timer/event preparation continues, and SIGCONT restores fair
  service without changing guest elapsed time. The OS process table is a
  separate per-Computer bounded view and never causes a global scheduled-process
  scan.
- Normal Python/CS486 execution and MCP debug execution are scheduler jobs.
  Debug slices use `mcp_debug`, not `guest_cpu`, and every limit, detach,
  interrupt, and completion path has one callback/event owner.
- `as`, `cc`, `c++`, and `ld` submit explicit compile jobs. DOS-only `QBASIC`
  submits the same bounded frontend work when a program starts. A shell
  invocation cannot compile on its initiating event callback. The job is
  admitted on a later tick in `guest_compile`; CS QBASIC 1.0 then hands the
  compiled executable to the normal bounded CPU scheduler. Source, object-count,
  memory, and instruction ceilings still apply. ASM preprocessing is
  additionally capped at 1,000,000 aggregate source characters, 100,000 lexical
  tokens, 64 includes, include depth 8, 256 macros, macro depth 16, 32
  parameters, and 100,000 expanded tokens. Character and token capacity is
  checked before source, definition, or macro output is appended. Because
  included text is not represented by the root source length, an ASM job
  reserves the lane's 256-unit maximum before expansion. The linker caps
  sections, initialized bytes, symbols, relocations, cumulative static data, and
  output instructions; symbol resolution is Map-backed and object layouts are
  computed once.
- RS-232C uses an intrusive O(1) ready-link deque and admits work only when the
  deque is non-empty. Link, dequeue, and byte budgets are fixed. I2C and SPI
  charge bounded payload/address units and return `deferred` plus `retryTick`
  when a lane is exhausted; overflow is never silently dropped.
- Terminal mutations performed by native modules and shell result rendering are
  charged to `terminal`. Redstone guest access and fixed-face Bedrock input/
  output synchronization are charged separately. Topology refresh covers the six
  fixed faces.
- CS ABI framebuffer presentation performs only constant-time dimension and
  memory-range checks before `terminal` admission. A deferred frame returns
  `EAGAIN` without reading framebuffer cells or mutating terminal state. Once
  admitted, the bounded framebuffer decode and `applyFrame` form one measured
  atom; malformed cells return `EINVAL` without partial mutation. Guest memory
  accesses retain their deterministic CPU/cache timing and host measurements do
  not feed back into that timing.
- `block_io` admits only due HDD/FDD completions from one global
  minimum-deadline heap. Idle devices are not polled. Seek, rotational,
  controller, transfer, and media timings use deterministic guest nanoseconds;
  WorkMonitor host deferral never moves the guest deadline. A shell process
  waits on the exact completion event, so host congestion cannot wake it before
  the device finalizes. The `persistence` lane remains separate because Dynamic
  Property work is host storage, not guest disk service.
- Persistence checks visit at most four Computers per tick. A dirty revision
  creates a transaction with explicit target cleanup, manifest, page, commit,
  and obsolete-generation cleanup stages. Each job step performs at most one
  Dynamic Property operation. Pages are content-addressed and unchanged pages
  are reused across generations. The head changes only after all new pages
  exist, and a record changed while saving remains dirty for another generation.
- Graceful shutdown/reboot maintains a fixed set of stopping Computers and
  advances at most 16 entries by one phase per tick. New block I/O is rejected
  after stop admission closes, while requests already admitted continue through
  the normal deadline heap. Data and final sync cross the real persistence
  boundary; a failed save faults the Computer instead of becoming a clean stop.

## MCP observability

The Bedrock host publishes a `CS_WORK_MONITOR` record every 20 ticks. The local
MCP companion validates and normalizes it to the fixed lane schema before
exposing it as `bds_status.workMonitor`. The status includes lane totals,
deferrals, overruns, and p50/p95/p99 without Computer or player cardinality.
Malformed or unbounded records are not cached, and telemetry records do not
count as BDS diagnostics.

## Verification rubric

- `Verify:`
  `npx vitest run tests/runtime/scheduler.test.ts tests/runtime/workMonitorScale.test.ts`
  `Expect:` 10,000 processes still inspect and return only 64 records per tick,
  every process progresses in 157 ticks, and no soft/emergency deferral occurs.
- `Verify:`
  `npx vitest run tests/computer/computerHostPersistence.test.ts tests/io/peripheralProtocols.test.ts`
  `Expect:` every production lane records real work; I2C overflow is explicit;
  compile and MCP jobs advance on later ticks.
- `Verify:`
  `npx vitest run tests/computer/persistence.test.ts tests/phase0/transactionalPagedStore.test.ts`
  `Expect:` one property operation per transaction step, previous-generation
  recovery, bounded cleanup, and mutation-during-save dirty retention.
- `Verify:`
  `npx vitest run tests/runtime/computerWorkMonitor.test.ts tests/tools/bdsDebugSession.test.mjs`
  `Expect:` fixed-histogram percentiles and normalized MCP status records pass.
- `Verify:` `npx vitest run tests/runtime/csAbi.test.ts` `Expect:` deferred
  framebuffer presentation performs zero framebuffer reads, admitted valid
  frames update atomically, and admitted malformed frames return `EINVAL`
  without terminal mutation.
- `Verify:` `npm run validate` `Expect:` formatting, lint, types, all host
  tests, and the pack build pass.
- `Verify:` run `npm run test:mcp:serial:bds` with free isolated ports and a new
  dedicated `BDS_MCP_WORKDIR`. `Expect:` three machines, six faces, 36 links,
  and 72 transmissions pass; WorkMonitor p50/p95/p99 are present, emergency
  deferrals are zero, and the isolated BDS reaches `idle` after cleanup.
