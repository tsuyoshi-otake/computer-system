# Issue #118 — a deferred terminal write must suspend, not discard guest stdout

GitHub Issue: https://github.com/tsuyoshi-otake/computer-system/issues/118

Status: implemented and host-verified.

Refs #63 (CS ABI 1.0), #29 (bounded input admission), #113 (one `terminal_keys`
wakeup owner), #12 (CS-Linux).

## The defect

`CsAbiRuntime.write` treated a **transient** host admission deferral on the
`terminal` lane as a **permanent** I/O error. It answered the guest with
`EAGAIN` and dropped the text the guest had already handed over:

```ts
const ran = this.options.runHostWork("terminal", 1, () => {
  /* emit */
});
return ran
  ? completeSuccess(context, count)
  : completeErrno(context, csAbiErrno.eagain); // <- text is gone
```

The same runtime already did the right thing one screen further down:
`writeStandardIo` returns `{kind: "wait_event", filter: "csabi_fd1"}` on
`would-block` and retries on resume, so only the terminal-backed branch gave up.

It was reachable rather than theoretical. The `terminal` lane is budgeted at 4
units per tick, guest libc emits one `cs_write` per character through `fputc`,
and `fputs`/`fputc`/`fwrite` treat any short or negative `cs_write` result as a
sticky stream error and return without retrying. The first deferral therefore
cost the guest its text.

## Implemented boundary

A refused terminal write is retained whole and the process suspends:

- `CsAbiRuntime` keeps one `PendingTerminalWrite` (count, descriptor, text) and
  returns `{kind: "wait_event", filter: csAbiTerminalWriteEvent}`. The `resume`
  callback only writes `eax`, because a resume cannot re-park; the retry lives
  in the wakeup owner instead.
- At most one write can be pending per runtime, because the process that owns it
  is parked until the write is emitted. It cannot issue a second one.
- `ComputerRuntime.runTick` is the **one wakeup owner**. It retries the retained
  write under a fresh `terminal` admission and delivers `csabi_term_write` only
  after the words are really on the terminal. A parked process still appears in
  `tick.computers`, so the owner runs at the scheduler cursor's pace, exactly
  like the existing `terminal_keys` wakeup.
- `CsAbiRuntime.finalize()` is the **one finalization owner** for a write that
  outlives its process. It emits the retained text before flushing stdout and is
  idempotent. Every foreground teardown path reaches it through
  `finalizeForegroundResources`: normal completion, terminal disconnect
  (`SIGHUP`), the shutdown deadline (`SIGKILL`), and cancellation (`SIGTERM`).
- Guest timing is untouched. Host admission decides only _when_ the host writes;
  it never rewrites a modeled cycle, and the guest observes a completed write of
  exactly the count it requested.

`EAGAIN` remains for a sink that genuinely cannot accept a write. No path
discards refused text any more.

## Explicit exclusions

- `present()` is out of scope. Its `EAGAIN` refuses a frame whose pixels stay in
  guest RAM, so nothing the guest owns is consumed by the refusal.
- The isolated `run --batch` path (#114) is unaffected: its worker handler
  buffers inside the worker and never consults the `terminal` lane.
- The MCP synchronous hosted path and the pipeline path cannot deadlock on the
  new suspension. The former uses a `runHostWork` stub that never defers; the
  latter goes through `writeStandardIo`, which already had its own wait.

## Verification evidence

Verify on 2026-07-26:
`node node_modules/vitest/vitest.mjs run tests/runtime/cs486CHostedLibcPosix.test.ts -t "refused"`
— the Issue's own reproduction, built against the shipped
`/usr/src/cs-libc/libc.c`, with a `runHostWork` stub that refuses exactly the
second `terminal` admission the way a saturated WorkMonitor lane does. The
program returns a bitmask of what libc observed: bit 1/2/4 for a short `printf`,
bit 8 for a failed `fflush`, bit 16 for `ferror(stdout)`.

Expect: `{kind: "completed", value: 0}`, one suspension, and `AAA` / `BBB` /
`CCC` on three separate terminal rows.

Result: PASS. With the defect restored, the same test fails with
`{kind: "completed", value: 17}` — the exact value recorded in the Issue,
meaning the first `printf` returned short and `ferror(stdout)` was set while the
process still completed normally.

Verify on 2026-07-26:
`node node_modules/vitest/vitest.mjs run tests/runtime/csAbi.test.ts`.

Expect: a deferred fd-1 write parks on `csabi_term_write` instead of returning
`-EAGAIN`, keeps the terminal unchanged and `hasPendingTerminalWrite` true, a
refused retry returns `false` and keeps the write, the admitted retry emits the
text and claims exactly one `terminal` unit, a second flush returns `false`, and
`resume` reports the full count. A write still pending when its process dies is
emitted by `finalize()`, which is idempotent.

Result: PASS, 23 tests.

Verify on 2026-07-26:
`node node_modules/vitest/vitest.mjs run tests/computer/csAbiRuntime.test.ts -t "keeps deferring"`
— the end-to-end path with no stubs: a guest-compiled C program prints 12 lines
through real cs-libc, driven by a real `ComputerWorkMonitor` whose `terminal`
lane is cut to 1 unit per tick, through `ComputerRuntime.runTick`.

Expect: the monitor records terminal-lane deferrals, all 12 `cs-line-N` lines
reach the screen, and `echo $?` reports `0`.

Result: PASS. 245 terminal claims, 123 admitted and 122 deferred, with every
line intact. With the defect restored the same run loses the output entirely —
not even `cs-line-0` survives.

Verify on 2026-07-26:
`node node_modules/vitest/vitest.mjs run tests/runtime tests/computer tests/os`.

Expect: no regression in the scheduler, CS ABI, hosted C, shell, or Computer
aggregate suites.

Result: PASS, 188 files and 1,715 tests.

Verify on 2026-07-26: `npm run validate`.

Expect: formatting, ESLint, TypeScript, all Vitest tests, the production Bedrock
pack build, and the 16-chapter Pages build pass.

Result: PASS.
