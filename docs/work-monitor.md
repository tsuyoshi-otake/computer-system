# Computer WorkMonitor design

Issue #16 tracks this work. `ComputerWorkMonitor` is the BDS-thread admission
and observability boundary for Computer System work. It measures host time, but
deterministic guest CPU cycles and device wire clocks remain independent model
inputs. Host timing must never change a program's modeled result.

## P0 contract

Each host tick opens exactly one `TickWorkScope`. A caller submits an already
bounded atom with a lane, deterministic unit count, and optional Computer ID.
Admission checks the lane unit ceiling first, then the tick soft and emergency
host-time guards. A deferral does not run the atom and returns the next retry
tick; the caller retains finalization ownership. Exceptions are measured once
and rethrown. `finish()` is required on every host branch.

The fixed lanes are control, event delivery, guest CPU, guest compilation, MCP
debug execution, RS-232C, I2C, SPI, redstone input/output, topology, terminal,
and persistence. The cumulative snapshot contains admitted/deferred/failed
counts, deterministic units, host microseconds, maximum atom time, overruns, and
a fixed-bucket tick histogram. It has no per-user or per-Computer maps, so
monitor storage remains O(1).

Production currently admits the runtime scheduler as one bounded `guest_cpu`
atom, RS-232C delivery as one bounded `rs232` atom, and up to four individual
persistence checks. The shared CPU scheduler separately caps both cycles and
machine instructions. Normal `run` and MCP Python/CS486 execution are resumable
scheduler jobs, so a command cannot execute its complete instruction ceiling on
the BDS event callback stack. The RS-232C ready queue is an intrusive O(1)
deque; disconnect removes its exact node, so stale churn cannot consume the next
tick's dequeue budget.

I2C and SPI transactions are synchronous bounded atoms today: both cap one
transfer at 256 bytes and validate adapter response length. Their WorkMonitor
lanes are reserved for the Bedrock adapter/job increment. Until that increment,
their host cost is included in the enclosing `guest_cpu` measurement; separate
I2C/SPI metrics must not be claimed. Redstone and topology adapters follow the
same rule. The next increment must add explicit deferred protocol outcomes or
resumable jobs before enforcing those separate lane admissions; silently
dropping a transaction is not allowed.

## Scaling model

- Scheduler execution is bounded by fixed global cycle and instruction budgets
  per tick. Current iteration cost is O(S), where S is scheduled processes; the
  executed guest work remains capped even when S grows.
- RS-232C delivery is O(K) per tick for fixed dequeue and byte budgets. Link
  lookup, enqueue, dequeue, and queued-link removal are O(1).
- Persistence checks are O(K) per tick for a fixed K of four. One snapshot save
  is still an atomic overrun risk and remains visible in the persistence lane.
- I2C scan covers at most the usable 7-bit address space. SPI chip select is
  fixed at 0..7. Transfer payloads are capped at 256 bytes.
- WorkMonitor metrics and histograms are fixed-size O(1) state. They do not add
  cardinality proportional to Computers, sessions, or players.

This bounds deterministic work, but it is not proof that an arbitrary player
count is safe. Remaining dominant risks are O(S) scheduler traversal, atomic
persistence serialization, synchronous compiler/linker work, terminal fan-out,
and future adapter callbacks. Scale acceptance therefore requires a real-BDS
soak with percentiles and overrun counts, not only unit tests.

## Verification rubric

- `Verify:` Run `npx vitest run tests/runtime/computerWorkMonitor.test.ts`.
  `Expect:` Lane overflow and host-time guards defer without executing work;
  exceptions are accounted once; tick scopes cannot overlap.
- `Verify:` Run
  `npx vitest run tests/runtime/scheduler.test.ts tests/computer/computerHost.test.ts`.
  `Expect:` Cycle and instruction ceilings hold; terminal and MCP guest commands
  progress on later ticks and every completion or interruption is observable.
- `Verify:` Run
  `npx vitest run tests/io/serialLinkBroker.test.ts tests/io/peripheralProtocols.test.ts`.
  `Expect:` RS-232C churn cannot starve an active link and I2C/SPI payload and
  response limits fail explicitly.
- `Verify:` Run `npm run test:mcp:serial:bds` with isolated free ports and a new
  dedicated BDS work directory. `Expect:` A real BDS reports
  `serial_matrix/PASS` for three machines, all six ttyS/COM mappings, 36 ordered
  links, and 72 bidirectional transmissions.
- `Verify:` Run `npm run validate`. `Expect:` Formatting, lint, types, all host
  tests, and pack build pass.
- `Verify:` Run `npm run test:mcp:bds`, then execute one bounded benchmark on
  each registered hardware profile through MCP. `Expect:` Commands complete
  across host ticks, modeled cycles remain reproducible, BDS stays responsive,
  and WorkMonitor reports no unexplained emergency deferrals. This final
  observation still requires a future MCP metrics probe before it can be
  automated end to end.
