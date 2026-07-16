# Runtime and CPU test guidance

- This scope owns scheduler/WorkMonitor, CS486 process, instruction/cache/bus
  timing, Python compilation/execution/imports, native modules,
  CS486OBJ/IR/linker/debugger core, and limits.
- Modeled guest cycles and diagnostics are authoritative. Do not use host
  wall-clock thresholds as CPU/language performance assertions.
- Scheduler tests cover runnable-only bookkeeping, fairness, pause/resume,
  cancellation, timeout, shutdown, exactly-once finalization, queue limits, and
  capacity-plus-one without starving admitted work.
- WorkMonitor scale tests make fixed per-tick work and absence of
  whole-population scans observable under large Computer counts. The sibling
  `tests/application/runtime/` scope owns block-I/O admission tests.
- Python tests prove direct CS486 lowering with no second VM/scheduler, shared
  cycle/process accounting, waits/resume, immutable credential propagation,
  bounded imports, module-once, circular/missing/oversized failure, object ABI,
  and CS386SX status 127.
- `pythonCs486Harness.ts` is a helper around the production process, not an
  alternate execution engine.
- Toolchain core tests cover v1 read compatibility, v2 sections/relocations,
  typed symbols/signatures, SSA validation/dominance, deterministic capped
  passes, linear-scan spills/frame bounds, corrupt input, and no partial output.

## Focused verification

Run `npm test -- tests/runtime`. Add
`tests/application/runtime/blockIoScheduler.test.ts` when changing the
WorkMonitor/block-I/O boundary. Use MCP guest execution for any claimed language
or hardware benchmark.
