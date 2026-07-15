# Computer WorkMonitor design

Issue #16 tracks this work. `ComputerWorkMonitor` is the BDS-thread admission
and observability boundary for Computer System work. It measures host time, but
guest CPU cycles and device wire clocks remain independent deterministic model
inputs. Host timing never changes a guest program's modeled result.

## Production contract

Each host tick opens exactly one `TickWorkScope`. A caller submits an already
bounded atom with a lane, deterministic unit count, and optional Computer ID.
Admission checks the lane ceiling and then the tick soft and emergency guards. A
deferral does not run the atom, returns a retry tick, and leaves finalization
with the caller. Exceptions are measured once and rethrown. Every host branch
finishes the scope.

The fixed lanes are control, event delivery, guest CPU, guest compilation, MCP
debug execution, RS-232C, I2C, SPI, redstone input/output, topology, terminal,
and persistence. Cumulative metrics contain admitted/deferred/failed counts,
deterministic units, host microseconds, maximum atom time, and overruns. The
fixed tick histogram derives conservative p50, p95, and p99 upper bounds. There
are no per-user or per-Computer metric maps, so monitor storage stays O(1).

Bedrock callbacks which are intrinsically bounded by a fixed face count use the
external observation boundary. It rejects an atom larger than the lane limit and
measures redstone and topology work without changing device state or guest
timing.

## Bounded execution paths

- The shared scheduler inspects at most 64 processes per tick by default. Event
  preparation, CPU slices, and returned views use only that rotating window;
  none enumerates the full scheduled population. Cycle and machine-instruction
  budgets remain separate.
- Normal Python/CS486 execution and MCP debug execution are scheduler jobs.
  Debug slices use `mcp_debug`, not `guest_cpu`, and every limit, detach,
  interrupt, and completion path has one callback/event owner.
- `as`, `cc`, `c++`, `basicc`, `basic`, and `ld` submit explicit compile jobs. A
  shell invocation cannot compile on its initiating event callback. The job is
  admitted on a later tick in `guest_compile`; BASIC then hands the compiled
  executable to the normal bounded CPU scheduler. Source, object-count, memory,
  and instruction ceilings still apply.
- RS-232C uses an intrusive O(1) ready-link deque and admits work only when the
  deque is non-empty. Link, dequeue, and byte budgets are fixed. I2C and SPI
  charge bounded payload/address units and return `deferred` plus `retryTick`
  when a lane is exhausted; overflow is never silently dropped.
- Terminal mutations performed by native modules and shell result rendering are
  charged to `terminal`. Redstone guest access and fixed-face Bedrock input/
  output synchronization are charged separately. Topology refresh covers the six
  fixed faces.
- Persistence checks visit at most four Computers per tick. A dirty revision
  creates a transaction with explicit target cleanup, manifest, page, commit,
  and obsolete-generation cleanup stages. Each job step performs at most one
  Dynamic Property operation. The head changes only after all new pages exist,
  and a record changed while saving remains dirty for another generation.

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
- `Verify:` `npm run validate` `Expect:` formatting, lint, types, all host
  tests, and the pack build pass.
- `Verify:` run `npm run test:mcp:serial:bds` with free isolated ports and a new
  dedicated `BDS_MCP_WORKDIR`. `Expect:` three machines, six faces, 36 links,
  and 72 transmissions pass; WorkMonitor p50/p95/p99 are present, emergency
  deferrals are zero, and the isolated BDS reaches `idle` after cleanup.
