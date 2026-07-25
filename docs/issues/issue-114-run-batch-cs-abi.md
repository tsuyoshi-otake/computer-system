# Issue #114: `run --batch` and the isolated CS ABI worker subset

GitHub Issue:
[Make the wasm compute engine reachable from hosted CS-Linux programs via run --batch](https://github.com/tsuyoshi-otake/computer-system/issues/114)

Depends on [Issue #106](issue-106-wasm-batch-executor.md) (the opt-in Rust wasm
compute-worker engine) and [Issue #63](../../README.md) (CS ABI 1.0).

Status on 2026-07-26: stage 1 implemented, host-verified, and verified on a real
BDS acceptance fixture (item 8). Automatic migration of a running process to a
compute worker (stage 2) is **not implemented** and remains a separate decision
to be made from stage 1 measurements.

Verifying item 8 surfaced a separate pre-existing defect: hosted CS-Linux stdout
is silently truncated after the first few code points of a tick when it is
**not** a batch process. It is diagnosed in item 8, it is not caused or fixed by
this work, and it needs its own Issue.

## Problem this addresses

The Issue #106 wasm engine was reachable, but almost nothing production-shaped
reached it. A compute worker owns no guest filesystem, terminal, or scheduler,
so `tools/cs486-compute-worker-cpu-engine.ts` refused every syscall, and it
additionally refused any process carrying a startup image. Every hosted CS-Linux
C program - anything `cc` links with a `main` symbol, which is nearly every
useful program - receives a CS ABI startup image, so `computerRuntime.ts` never
passed a `remoteFactory` for it and it always ran locally on `Cs486Process`.
What did reach a worker was limited to executions that use no CS ABI at all: MCP
`cs486` jobs, compile-then-run, CS QBASIC, background `run &`, and DOS `run`.

## Implemented boundary

`run [--batch] [--stats] program [arguments ...]` is CS-Linux only.

`--batch` is a declaration the guest makes about the program: **this process
uses no operating-system service**. It is not a request to run on wasm. Where a
batch process executes - a compute worker or the local engine, `typescript` or
`wasm-rust` - remains host operator configuration exactly as before, so the
Issue #106 rule that engine selection is an explicit opt-in with no silent
fallback is unchanged.

A batch process is serviced for exactly three CS ABI operations:

| Selector       | Behaviour                                               |
| -------------- | ------------------------------------------------------- |
| `exit` (0)     | Terminates with the shared normalized exit status       |
| `heapInfo` (7) | Returns the create-time heap placement; a pure read     |
| `fsWrite` (10) | fd 1 and fd 2 only; appends to the process's own output |

Everything else - every other selector, every other descriptor, and every
syscall name that is not `cs` - is refused. An unserviceable selector or
descriptor raises `Cs486Fault("UnsupportedOperationError", ...)` naming the
operation and directing the user to re-run without `--batch`; a foreign syscall
name returns `EPERM` through EAX exactly as it does under `CsAbiRuntime`. No
operation is approximated.

`createCsAbiBatchSyscallHandler` in `src/application/runtime/csAbi.ts` is the
single implementation of that subset. The in-session shell path, the TypeScript
compute worker, and the wasm compute worker all use it; only guest memory and
register access underneath it is per engine. That makes the subset's semantics
structurally shared rather than reimplemented per engine.

Differences from `CsAbiRuntime` that are intentional and observable:

- Batch output is one ordered stream. fd 1 is not line buffered and fd 2 is not
  a separate sink, so the two interleave in exact write order and there is no
  buffered remainder that terminating the process could drop.
- A worker has no terminal lane to admit against, so the `EAGAIN` that terminal
  admission can produce under `CsAbiRuntime` does not occur.

Entry-point refusals, all applied before anything executes:

- CS-DOS `run` has no batch concept and reports the DOS usage line.
- A pipeline or a redirect (`|`, `|&`, `<`, `>`, `>>`, `2>`, `2>>`, `2>&1`).
- Backgrounding with `&`.
- A shell utility rather than a compiled executable.
- An executable that is not a hosted CS-Linux program exporting `main`.

## Explicitly out of scope

- Automatic migration of an already-running process to a compute worker
  (snapshot-based stage 2). Not implemented, not designed here.
- Any widening of the serviced subset. A batch process that needs a file, a key,
  the clock, or the terminal is a program to re-run without `--batch`, not a
  reason to add a service to the worker.
- Interactive programs. `nethack`, `vi`, and the Python REPL are input bound;
  they cannot be batch programs and would not become faster if they were. Their
  behaviour without `--batch` is unchanged by this work.

## Acceptance

### 1. Isolated handler semantics

Verify: `npx vitest run tests/runtime/csAbiBatchHandler.test.ts`

Expect: `exit` normalizes its status, `heapInfo` writes the create-time
placement, fd 1 and fd 2 append to one ordered stream, an oversized count is
`ENOSPC`, an unpaired surrogate is `EINVAL`, a foreign syscall name is `EPERM`,
and every unserviceable selector and descriptor raises
`UnsupportedOperationError` with the re-run instruction.

### 2. Guest entry point and refusals

Verify: `npx vitest run tests/os/linuxBatchRun.test.ts`

Expect: `run --batch` and `run --batch --stats` accept a hosted executable in
either option order; DOS, a pipeline, a redirect, `&`, a shell utility, and a
non-hosted executable each fail with a guest-profile message and no partial
execution.

### 3. Foreground routing

Verify: `npx vitest run tests/computer/batchForegroundRouting.test.ts`

Expect: a batch foreground process is offered to the compute plane with its
process image and heap placement, and runs locally with the same isolated
handler when no compute plane exists. The local path is not a fallback: the
declaration is about OS services, not about engines.

### 4. Both worker engines

Verify: `npx vitest run tests/tools/cs486ComputeCpuEngine.test.ts`

Expect: 16 passing. The TypeScript engine and, when the Rust artifact is built,
the wasm engine produce the same ordered output, exit status, memory limit, and
memory usage for the same batch program, and both reject a syscall when the
process was created without a batch layout.

### 5. Differential equivalence

Verify: `npm run verify:cs486-wasm-equivalence`

Expect: `divergenceCount: 0` with the batch CS ABI corpus
(`tools/wasm-corpora/batch-cs-abi-corpus.ts`) included. Observed on 2026-07-26:
`divergenceCount: 0`, `comparisons: 363092`, `configurations: 576`,
`programs: 48`, engine `rust`.

Zero divergences is only evidence if the corpus reaches something. Verify:
`npx vitest run tests/tools/cs486BatchCsAbiCorpus.test.ts`

Expect: 6 passing. Each corpus program's terminal state on the reference
`Cs486Process` is pinned, so a program that stops exercising the subset fails
here instead of quietly making the harness vacuous.

### 6. Host gate

Verify: `npm run validate`

Expect: all pass. Observed on 2026-07-26 (Node v26.2.0, win32): formatting,
ESLint, TypeScript, `315` test files / `2638` tests, the Bedrock pack build, and
the 16-chapter Pages build all pass.

### 7. A/B measurement

Verify: `npm run benchmark:cs486:wasm-ab`

Expect: a recorded speed ratio for a hosted-C shaped workload. This measurement,
not a build, is what decides whether stage 2 is worth doing.

Observed on 2026-07-26 (Node v26.2.0, win32, AMD Ryzen 7 9700X, 2,000,000
instructions, 21 samples per engine, `instruction-slice`). `wasm-rust` median
host time versus the `typescript` engine on the `hosted-c-mid` corpus, which is
the shape a `run --batch` program has:

| CPU      | Stats    | ts median ms (p95) | wasm-rust median ms (p95) | Ratio |
| -------- | -------- | ------------------ | ------------------------- | ----- |
| cs386sx  | enabled  | 26.74 (28.39)      | 6.45 (6.85)               | 4.14x |
| cs386sx  | disabled | 25.58 (26.66)      | 5.88 (6.40)               | 4.35x |
| cs486dx  | enabled  | 38.17 (48.37)      | 16.60 (17.59)             | 2.30x |
| cs486dx  | disabled | 35.90 (46.11)      | 15.99 (18.06)             | 2.25x |
| cs486dx2 | enabled  | 38.02 (50.43)      | 16.86 (25.48)             | 2.26x |
| cs486dx2 | disabled | 36.56 (53.83)      | 15.78 (24.01)             | 2.32x |

Both engines produced the same `executedInstructions` (2,000,000), `guestCycles`
(3,969,225), `guestRamSha256`, and `registerChecksum` in every row, so the ratio
is host throughput only and not a difference in guest work.

Reading: on the CS486 profiles a batch program gets roughly 2.3x the host
throughput, and the modeled guest cost is identical, so the guest sees the same
`run --stats` numbers and only host wall time shrinks. CS386SX is faster still
(~4.2x) because its simpler memory model gives the TypeScript engine less to
amortize. This is a real but bounded win for compute-bound programs; it is not
an argument for stage 2 on its own, because stage 2 would have to pay snapshot
transfer cost to obtain the same 2.3x.

### 8. Real BDS

`run --batch` is a foreground interactive command. The MCP queued debug path
refuses it on purpose
(`run: --batch is unavailable for queued debug execution`), because that queue
attaches no CS ABI startup image and would otherwise run a process with no argv,
no heap, and a policy narrower than the one it was admitted with. So this
evidence has to come from a real Web Terminal session, not from
`bds_execute_computer_command`.

Verify: start an isolated managed companion on its own ports and its own empty
`BDS_MCP_WORKDIR` so the operator's interactive world is untouched
(`BDS_MCP_PORT=19140`, `WEB_COMPANION_PORT=8390`, `BDS_MCP_RUNTIME_WORKERS=2`,
`WEB_COMPANION_CPU_ENGINE=typescript`), then
`bds_start({ acceptanceFixture: true, resetWorld: true })`,
`bds_wait_for_log('CS_STORAGE_MIGRATION {"state":"complete"')`,
`bds_provision_acceptance_fixture`, and poll `whoami` through
`bds_execute_computer_command` until the CSBIOS sequence finishes and the shell
answers. Author `/tmp/b.c` (a 20,000-iteration integer loop, then
`printf("t=%d", t)`) and `/tmp/o.c` (`fopen("/tmp/b.c", "r")`, then print
whether it succeeded) with bounded `echo` redirects and build both with `cc`.
Then `bds_open_web_terminal`, drive each command with
`bds_send_tui_input({ kind: "line" })`, and read the result with
`bds_get_tui_screen` once the shell prompt is idle again.

Expect: a batch program completes with its full output and materially less host
wall time, and every unserviceable operation fails with a guest message that
names what to do instead.

Observed on 2026-07-26, isolated acceptance fixture `c-ryntpx`, `typescript`
engine, 2 compute workers, `rangeEnforcement: "disabled_for_debug"`, Web
Terminal session in `writer` mode:

| Command                      | Terminal result                                                                                                  |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `run --batch --stats /tmp/b` | `t=59998`, `1408796 instructions`, `halted`, `host: 498.000 ms wall elapsed`                                     |
| `run --stats /tmp/b`         | no program output, `1402881 instructions`, `halted`, `host: 2332.000 ms wall elapsed`                            |
| `run --batch /tmp/o`         | `UnsupportedOperationError: batch process cannot use CS ABI operation 8; re-run this program without batch mode` |
| `run --batch /tmp/b \| cat`  | `run: --batch cannot be used with a pipeline or a redirect` (exit 2)                                             |
| `run --batch ls`             | `run: /home/cs/ls: Permission denied` - `run` resolves a path and never searches `PATH`                          |

The batch program finished in 498 ms of host wall time against 2332 ms for the
same executable without `--batch`, which is the A/B ratio of item 7 appearing on
a real server.

Two things this run does **not** prove, stated so the table is not read for more
than it says.

The `CPU cycles` column is `1000000` on both rows because foreground cumulative
cycles are clamped at 1,000,000 before they are displayed (`computerRuntime.ts`
`foreground.cpuCycles = Math.min(1_000_000, ...)`), so both programs are simply
above the clamp. Equality of modeled guest work is proved by item 5, not here.

The two rows also disagree on stdout and on instruction count, and that is a
**pre-existing defect in the non-batch terminal write path**, not a batch
behaviour. Reduced on the same fixture (`c-svt7re`) with a program that only
prints `start\n` and `t=59998\n` and does no computation at all:

| Command              | Terminal result       |
| -------------------- | --------------------- |
| `run /tmp/s`         | `st`                  |
| `run /tmp/s` (again) | `sta`                 |
| `run --batch /tmp/s` | `start` and `t=59998` |

Root cause: the `terminal` work lane admits 4 units per tick
(`computerWorkMonitor.ts` `laneUnitsPerTick.terminal`), the hosted libc writes
stdout one code point per `cs_write`, and `CsAbiRuntime.write` answers a
deferred terminal lane with `EAGAIN` instead of suspending the way its own
`writeStandardIo` branch does with `wait_event`. The guest libc does not retry
`EAGAIN` (`fputc` sets `stream->error` and returns `EOF`), so everything after
the first few code points of a tick is dropped silently, and the aborted
`printf` also explains the lower instruction count. Host tests never see it
because they run with no `TickWorkScope`. The batch path has no per-write host
admission at all, so it is unaffected. The non-batch code involved is byte for
byte the code at `HEAD` - the whole Issue #114 diff in
`src/application/runtime/csAbi.ts` is additive - so this predates this work and
belongs to its own Issue and its own fix.

### 9. Interactive non-regression

An interactive program is exactly what `--batch` must not change. NetHack is the
largest hosted CS-Linux program in the tree, it is input bound, and it uses the
CS ABI operations a batch process is refused.

Verify: on the same isolated acceptance fixture, run `nethack` with no
`--batch`, read the screen with `bds_get_tui_screen`, then release it with
`bds_send_tui_input({ kind: "interrupt" })` and confirm the shell answers again.

Expect: the map renders and the terminal returns to an idle prompt with a live
shell.

Observed on 2026-07-26, fixture `c-emq8gw`: `ls /usr/games` lists `nethack`; the
running screen shows the dungeon map with `@`, two `C` monsters, a `$` pile, and
the `Dlvl:1 HP:20(20) Lv:1 XP:0 T:0` status line; the interrupt prints `^C` and
returns `cs@c-emq8gw:~$`; a following `echo done` completes with exit 0.
