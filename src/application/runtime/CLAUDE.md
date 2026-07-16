# Guest runtime guidance

## Scheduler and host admission

- Guest CPU/device time is deterministic modeled time. Host elapsed time is only
  for admission and observability; never convert host delay into guest cycles,
  disk latency, memory timing, or wire timing.
- `ComputerWorkMonitor` owns one host-time scope per BDS tick and fixed lanes
  for CPU, compilation, MCP, block I/O, RS-232C, I2C, SPI, redstone, topology,
  terminal, and persistence. Bound each lane and expose overload explicitly.
- Normal `run`, MCP CS486, and Python execution are resumable scheduler jobs
  with fixed machine-instruction ceilings. A timeout, status 124, yielded job,
  or incomplete process is not a language-performance result.
- Admit native shell/terminal work before it executes. Do not apply a budget
  check after side effects and turn success into an uncaught host-budget
  failure.
- Keep runnable-only bookkeeping O(runnable), dedupe in-flight work, cap queues
  and concurrency, and finalize cancellation, timeout, process exit, machine
  shutdown, and scheduler disposal exactly once.

## Block and peripheral I/O

- The `block_io` lane admits only due HDD/FDD completions from one bounded
  deadline heap; never poll idle devices. WorkMonitor may defer a due completion
  but may not rewrite its guest deadline.
- Bound request size, queue depth, deadline storage, and completions delivered
  per tick. Disconnect/eject/generation changes must remove or explicitly fail
  stale requests without leaking completion ownership.
- The I/O application owns serial/I2C/SPI protocol and cleanup semantics. This
  runtime only admits their outcomes and accounts the selected WorkMonitor lane.

## Computer System Python

- Parse Python directly to CS486 control flow plus the allowlisted `python`
  syscall ABI in `pythonCs486.ts`. Calls, returns, branches, waits, instruction
  accounting, and cycle debt belong to `Cs486Process`; never reintroduce a
  Python instruction pointer, bytecode VM, or second scheduler.
- Require a hardware profile with MicroPython enabled. CS386SX returns 127.
  Python uses the same timing unit, process lifecycle, memory limits, and cycle
  statistics as ASM, BASIC, C, and C++.
- Module lookup is deterministic and bounded: importer directory, `/lib/python`,
  then `/usr/lib/computer-system/python`. Initialize `.py` modules once. Reject
  missing, circular, duplicate, oversized, or excessive imports explicitly and
  keep resolution O(source + modules).
- Imported `.o` modules must be valid versioned `CS486OBJ` files and expose only
  the current zero-argument EAX-return ABI. Charge extension instructions to the
  same process.
- The native `shell` module is an internal capability only for the built-in
  shell selected by an empty `/startup.py`. It is unavailable to user-authored
  startup, foreground Python, filesystem-loaded extension modules, and MCP
  Python.
- Carry the immutable process credential snapshot into every Python guest
  filesystem operation. No import, extension, syscall, wait, or resume path may
  regain a broader credential.

## Modeled statistics

- `run --stats` and Python statistics are authoritative modeled guest cost. Keep
  instruction, L1/L2 hit/miss, bus transfer, unaligned access, pipeline flush,
  and cycle counters synchronized with the CPU model.
- Host benchmark sequencing, concurrency, tick percentiles, capacity probes, and
  interaction evidence belong to `tools/` and `docs/benchmarks/`.

## Verification

Use `tests/runtime/` for scheduler, CPU process, Python compiler/runtime, native
modules, cache/timing, pause/resume, cancellation, credential propagation, and
capacity-plus-one coverage. Block-I/O admission is directly covered by
`tests/application/runtime/blockIoScheduler.test.ts`. See `docs/work-monitor.md`
for the measurement contract and `tools/CLAUDE.md` for real-BDS benchmark
procedure.
