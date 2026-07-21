# Issue #47: nice, nohup, and bounded watch

Status: implemented and host-verified.

## Implemented boundary

- `nice [-n VALUE] command` accepts -20 through 19, reserves negative values for
  root, scales scheduler admission without bypassing the global budget, and
  persists NI in the OS process record rendered by `ps` and `top`.
- `nohup` wraps only the already-supported bounded background `sleep`, Python,
  and linked `run` forms ending in `&`. The process is reparented to PID 1 and
  survives terminal SIGHUP; shutdown/kill paths still have finalization
  ownership. Arbitrary background commands and host-style job control remain
  unsupported.
- `watch [-n seconds] [-c count] -- command` is foreground-owned, tick-paced,
  finite by default, capped at 3,600 executions and 3,600 seconds, and rejects
  nested lifecycle, TUI, background, and foreground work.

## Acceptance evidence

- Verify: `npm test -- tests/os/linuxProcessUtilities.test.ts` Expect: nice
  validation/metadata, nohup detachment, tick-paced watch completion, and count
  rejection pass.
- Verify:
  `npm test -- tests/computer/backgroundJobs.test.ts tests/runtime/scheduler.test.ts`
  Expect: background finalization and scheduler fairness remain green.
- Verify: `npm run validate` Expect: the complete repository validation gate
  passes.
